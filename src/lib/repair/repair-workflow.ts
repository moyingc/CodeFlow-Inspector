import type { CodeFile } from "@/src/lib/analysis/types";
import type { RepairCandidateExperiment, RepairCandidatePatch } from "./candidate-diff.ts";
import { hashCodeWorkspace } from "./candidate-diff.ts";

export type RepairApproval = {
  candidateId: string;
  approvedAt: number;
  approvedBy: "local-user";
  experimentRunIds: string[];
  evidence: string[];
};

export type RepairRollbackSnapshot = {
  id: string;
  candidateId: string;
  projectId: string;
  baselineHash: string;
  candidateHash: string;
  baselineFiles: CodeFile[];
  createdAt: number;
};

export type RepairWriteBackResult = {
  files: CodeFile[];
  rollback: RepairRollbackSnapshot;
  evidence: string[];
};

export function approveRepairExperiment(result: RepairCandidateExperiment, now = Date.now()): RepairApproval {
  if (result.patch.status !== "ready") throw new Error("候选 Diff 未就绪，不能批准。");
  if (!result.experiment || result.experiment.status !== "passed") throw new Error("A/B 实验尚未通过，不能批准写回。");
  if (!result.experiment.outputEquivalent || !result.experiment.allSandboxed) throw new Error("输出等价或强隔离门禁未通过，不能批准写回。");
  return {
    candidateId: result.patch.id,
    approvedAt: now,
    approvedBy: "local-user",
    experimentRunIds: result.experiment.runIds,
    evidence: [
      "用户只批准当前候选哈希，不授权后续自动修改。",
      ...result.experiment.evidence,
    ],
  };
}

export async function writeBackApprovedRepair(input: {
  projectId: string;
  currentFiles: CodeFile[];
  patch: RepairCandidatePatch;
  approval: RepairApproval;
  now?: number;
}): Promise<RepairWriteBackResult> {
  if (input.patch.status !== "ready") throw new Error("候选 Diff 未就绪，禁止写回。");
  if (input.approval.candidateId !== input.patch.id) throw new Error("批准记录与候选不匹配，禁止写回。");
  const currentHash = await hashCodeWorkspace(input.currentFiles);
  if (currentHash !== input.patch.baselineHash) throw new Error("项目已在审批后发生变化，请重新生成 Diff 和 A/B 实验。");
  const candidateHash = await hashCodeWorkspace(input.patch.candidateFiles);
  if (candidateHash !== input.patch.candidateHash) throw new Error("候选副本完整性校验失败，禁止写回。");
  const now = input.now ?? Date.now();
  return {
    files: input.patch.candidateFiles.map((file) => ({ ...file })),
    rollback: {
      id: `repair-rollback-${input.patch.id}-${now}`,
      candidateId: input.patch.id,
      projectId: input.projectId,
      baselineHash: input.patch.baselineHash,
      candidateHash: input.patch.candidateHash,
      baselineFiles: input.currentFiles.map((file) => ({ ...file })),
      createdAt: now,
    },
    evidence: [
      `写回 ${input.patch.changedFiles.length} 个本地项目文件。`,
      `基线 ${input.patch.baselineHash.slice(0, 16)} -> 候选 ${input.patch.candidateHash.slice(0, 16)}。`,
      "原始项目磁盘目录未被直接覆盖；本地项目数据库保留一键回滚快照。",
    ],
  };
}

export async function rollbackRepairWriteBack(currentFiles: CodeFile[], snapshot: RepairRollbackSnapshot) {
  const currentHash = await hashCodeWorkspace(currentFiles);
  if (currentHash !== snapshot.candidateHash) throw new Error("写回后项目又发生了变化，为避免覆盖新修改，一键回滚已拒绝。");
  const baselineHash = await hashCodeWorkspace(snapshot.baselineFiles);
  if (baselineHash !== snapshot.baselineHash) throw new Error("回滚快照完整性校验失败。");
  return snapshot.baselineFiles.map((file) => ({ ...file }));
}
