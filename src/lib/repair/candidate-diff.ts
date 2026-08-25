import type { CodeFile, ControlledRuntimeAdapter, ControlledRuntimeExecutionReport } from "@/src/lib/analysis/types";
import { executeRepairVerificationExperiment, type RepairVerificationExperimentReport } from "../runtime/controlled-runtime.ts";

export type RepairTextEdit = {
  fileName: string;
  expected: string;
  replacement: string;
  occurrence?: number;
  reason: string;
  sourceIds: string[];
};

export type RepairCodeSuggestion = {
  id: string;
  fileName: string;
  originalCode: string;
  suggestedCode: string;
  reason: string;
  evidenceIds: string[];
  confidence: number;
  deterministic: boolean;
  occurrence?: number;
};

export type RepairCandidatePatch = {
  id: string;
  status: "ready" | "rejected";
  baselineHash: string;
  candidateHash: string;
  changedFiles: string[];
  candidateFiles: CodeFile[];
  unifiedDiff: string;
  evidence: string[];
  rejectionReason?: string;
};

export type RepairCandidateExperiment = {
  patch: RepairCandidatePatch;
  experiment?: RepairVerificationExperimentReport;
};

export async function buildRepairCandidatePatch(
  candidateId: string,
  files: CodeFile[],
  edits: RepairTextEdit[],
): Promise<RepairCandidatePatch> {
  const safeId = candidateId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  if (!safeId || !files.length || !edits.length) return rejected(safeId || "invalid", files, "候选补丁需要项目文件和至少一项确定性编辑。");
  const byName = new Map(files.map((file) => [file.name, file]));
  const grouped = new Map<string, RepairTextEdit[]>();
  for (const edit of edits) {
    if (!edit.expected || edit.expected === edit.replacement) return rejected(safeId, files, `编辑 ${edit.fileName} 没有有效原文或替换没有变化。`);
    if (!byName.has(edit.fileName)) return rejected(safeId, files, `编辑目标不在当前项目中：${edit.fileName}`);
    grouped.set(edit.fileName, [...(grouped.get(edit.fileName) ?? []), edit]);
  }
  const candidateFiles = files.map((file) => ({ ...file }));
  const diffs: string[] = [];
  for (const [fileName, fileEdits] of grouped) {
    const candidate = candidateFiles.find((file) => file.name === fileName)!;
    const before = candidate.content;
    let after = before;
    for (const edit of fileEdits) {
      const matches = indexesOf(after, edit.expected);
      const occurrence = edit.occurrence ?? 1;
      if (!matches.length) return rejected(safeId, files, `${fileName} 中找不到预期原文，候选已过期。`);
      if (edit.occurrence == null && matches.length !== 1) return rejected(safeId, files, `${fileName} 中预期原文出现 ${matches.length} 次，必须指定 occurrence，避免改错位置。`);
      const index = matches[occurrence - 1];
      if (index == null) return rejected(safeId, files, `${fileName} 中不存在第 ${occurrence} 个目标。`);
      after = `${after.slice(0, index)}${edit.replacement}${after.slice(index + edit.expected.length)}`;
    }
    candidate.content = after;
    diffs.push(buildUnifiedDiff(fileName, before, after));
  }
  const baselineHash = await hashCodeWorkspace(files);
  const candidateHash = await hashCodeWorkspace(candidateFiles);
  if (baselineHash === candidateHash) return rejected(safeId, files, "候选代码哈希与基线一致，没有可验证变更。", baselineHash);
  return {
    id: safeId,
    status: "ready",
    baselineHash,
    candidateHash,
    changedFiles: [...grouped.keys()],
    candidateFiles,
    unifiedDiff: diffs.join("\n"),
    evidence: [
      `基线 ${baselineHash.slice(0, 16)} -> 候选 ${candidateHash.slice(0, 16)}。`,
      `${edits.length} 项精确编辑，只应用于内存候选和受控运行临时副本。`,
      ...edits.map((edit) => `${edit.fileName}: ${edit.reason} · ${edit.sourceIds.join(", ")}`),
    ],
  };
}

export async function generateCandidateDiffFromSuggestions(
  candidateId: string,
  files: CodeFile[],
  suggestions: RepairCodeSuggestion[],
): Promise<RepairCandidatePatch> {
  const accepted = suggestions.filter((suggestion) => suggestion.deterministic && suggestion.confidence >= 80);
  if (!accepted.length) {
    return rejected(candidateId, files, "没有置信度不低于 80% 且标记为确定性的建议代码；描述型配方不会自动改源码。");
  }
  if (accepted.length !== suggestions.length) {
    return rejected(candidateId, files, `候选中有 ${suggestions.length - accepted.length} 条不确定建议，必须拆分后单独审查。`);
  }
  return buildRepairCandidatePatch(candidateId, files, accepted.map((suggestion) => ({
    fileName: suggestion.fileName,
    expected: suggestion.originalCode,
    replacement: suggestion.suggestedCode,
    occurrence: suggestion.occurrence,
    reason: suggestion.reason,
    sourceIds: [suggestion.id, ...suggestion.evidenceIds],
  })));
}

export async function executeGeneratedRepairCandidate(input: {
  projectId: string;
  projectName: string;
  candidateId: string;
  files: CodeFile[];
  edits: RepairTextEdit[];
  adapter: ControlledRuntimeAdapter;
  entryPath: string;
  stdin?: string;
  onResult?: (report: ControlledRuntimeExecutionReport) => void;
}): Promise<RepairCandidateExperiment> {
  const patch = await buildRepairCandidatePatch(input.candidateId, input.files, input.edits);
  if (patch.status !== "ready") return { patch };
  const experiment = await executeRepairVerificationExperiment(
    input.projectId,
    input.projectName,
    patch.id,
    input.files,
    patch.candidateFiles,
    input.adapter,
    input.entryPath,
    input.stdin,
    input.onResult,
  );
  return { patch, experiment };
}

export async function executeGeneratedRepairSuggestions(input: {
  projectId: string;
  projectName: string;
  candidateId: string;
  files: CodeFile[];
  suggestions: RepairCodeSuggestion[];
  adapter: ControlledRuntimeAdapter;
  entryPath: string;
  stdin?: string;
  onResult?: (report: ControlledRuntimeExecutionReport) => void;
}): Promise<RepairCandidateExperiment> {
  const patch = await generateCandidateDiffFromSuggestions(input.candidateId, input.files, input.suggestions);
  if (patch.status !== "ready") return { patch };
  const experiment = await executeRepairVerificationExperiment(
    input.projectId,
    input.projectName,
    patch.id,
    input.files,
    patch.candidateFiles,
    input.adapter,
    input.entryPath,
    input.stdin,
    input.onResult,
  );
  return { patch, experiment };
}

function indexesOf(source: string, target: string) {
  const indexes: number[] = [];
  let cursor = 0;
  while (cursor <= source.length - target.length) {
    const index = source.indexOf(target, cursor);
    if (index < 0) break;
    indexes.push(index);
    cursor = index + Math.max(1, target.length);
  }
  return indexes;
}

function buildUnifiedDiff(fileName: string, before: string, after: string) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
  const contextStart = Math.max(0, prefix - 3);
  const oldEnd = Math.min(oldLines.length, oldLines.length - suffix + 3);
  const newEnd = Math.min(newLines.length, newLines.length - suffix + 3);
  const body = [
    ...oldLines.slice(contextStart, prefix).map((line) => ` ${line}`),
    ...oldLines.slice(prefix, oldLines.length - suffix).map((line) => `-${line}`),
    ...newLines.slice(prefix, newLines.length - suffix).map((line) => `+${line}`),
    ...newLines.slice(newLines.length - suffix, newEnd).map((line) => ` ${line}`),
  ];
  return `--- a/${fileName}\n+++ b/${fileName}\n@@ -${contextStart + 1},${oldEnd - contextStart} +${contextStart + 1},${newEnd - contextStart} @@\n${body.join("\n")}`;
}

export async function hashCodeWorkspace(files: CodeFile[]) {
  const canonical = [...files].sort((a, b) => a.name.localeCompare(b.name)).map((file) => `${file.name}\0${file.content}`).join("\0");
  const bytes = new TextEncoder().encode(canonical);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

function rejected(id: string, files: CodeFile[], reason: string, baselineHash = "") : RepairCandidatePatch {
  return { id, status: "rejected", baselineHash, candidateHash: "", changedFiles: [], candidateFiles: files, unifiedDiff: "", evidence: [reason], rejectionReason: reason };
}
