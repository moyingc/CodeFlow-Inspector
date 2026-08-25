import type { CodeFile } from "@/src/lib/analysis/types";

export const directoryInputProps = {
  webkitdirectory: "",
  directory: "",
} as Record<string, string>;

const FILE_READ_BATCH_SIZE = 24;
const FILE_READ_BATCH_BYTES = 8 * 1024 * 1024;

export type CodeFileReadProgress = {
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes: number;
};

export const languageByExtension: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  cs: "C#",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  c: "C",
  h: "C/C++",
  php: "PHP",
  rb: "Ruby",
  kt: "Kotlin",
  swift: "Swift",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  sql: "SQL",
  json: "JSON",
  toml: "TOML",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
};

export async function readCodeFiles(
  incomingFiles: File[],
  onProgress?: (progress: CodeFileReadProgress) => void,
) {
  const readable = incomingFiles.filter((file) => {
    const name = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return isReadableProjectFile(name, file.size);
  });
  const totalBytes = readable.reduce((sum, file) => sum + file.size, 0);
  const result: CodeFile[] = [];
  let completedBytes = 0;
  let offset = 0;
  while (offset < readable.length) {
    const batch: File[] = [];
    let batchBytes = 0;
    while (offset < readable.length && batch.length < FILE_READ_BATCH_SIZE) {
      const candidate = readable[offset];
      if (batch.length > 0 && batchBytes + candidate.size > FILE_READ_BATCH_BYTES) break;
      batch.push(candidate);
      batchBytes += candidate.size;
      offset += 1;
    }
    const parsedBatch = await Promise.all(batch.map(readCodeFile));
    result.push(...parsedBatch);
    completedBytes += batch.reduce((sum, file) => sum + file.size, 0);
    onProgress?.({
      completedFiles: offset,
      totalFiles: readable.length,
      completedBytes,
      totalBytes,
    });
    await yieldToBrowser();
  }
  return result;
}

function readCodeFile(file: File) {
  return new Promise<CodeFile>((resolve, reject) => {
    const reader = new FileReader();
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    reader.onload = () => {
      const content = String(reader.result ?? "");
      resolve({
        id: `${path}-${file.lastModified}-${simpleHash(content)}`,
        name: path,
        language: detectLanguage(path, content),
        content,
        size: file.size,
        hash: simpleHash(content),
        lastModified: file.lastModified,
        imports: extractFileImports(path, content),
        environmentRefs: extractEnvironmentRefs(path, content),
        deviceRefs: extractDeviceApiRefs(content),
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取 ${path}`));
    reader.readAsText(file);
  });
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function isReadableProjectFile(path: string, size: number) {
  void size;
  const normalized = path.replace(/\\/g, "/");
  if (/(^|\/)(node_modules|\.git|\.next|dist|build|target|venv|\.venv|__pycache__|coverage|vendor)(\/|$)/.test(normalized)) {
    return false;
  }
  const extension = normalized.split(".").pop()?.toLowerCase() ?? "";
  return Boolean(
    languageByExtension[extension] ||
      /(package\.json|requirements\.txt|go\.mod|Cargo\.toml|pyproject\.toml|Makefile|CMakeLists\.txt)$/.test(
        normalized,
      ),
  );
}

export function detectLanguage(name: string, content: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (languageByExtension[extension]) return languageByExtension[extension];
  if (/^\s*def\s+\w+/m.test(content)) return "Python";
  if (/^\s*func\s+\w+/m.test(content)) return "Go";
  if (/^\s*(export\s+)?function\s+\w+/m.test(content)) return "JavaScript";
  return "Plain Text";
}

export function extractFileImports(name: string, content: string) {
  const imports = new Set<string>();
  const normalizedName = name.toLowerCase();

  for (const match of content.matchAll(/\bimport\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g)) imports.add(match[1]);
  for (const match of content.matchAll(/\brequire\(["']([^"']+)["']\)/g)) imports.add(match[1]);
  for (const match of content.matchAll(/^\s*from\s+([\w.]+)\s+import\s+/gm)) imports.add(match[1]);
  for (const match of content.matchAll(/^\s*import\s+([\w.]+)/gm)) imports.add(match[1]);
  for (const match of content.matchAll(/^\s*#include\s+[<"]([^>"]+)[>"]/gm)) imports.add(match[1]);
  for (const match of content.matchAll(/^\s*package\s+([\w./-]+)/gm)) imports.add(match[1]);
  for (const match of content.matchAll(/^\s*use\s+([\w:]+)(?:::|\s*;)/gm)) imports.add(match[1]);

  if (normalizedName.endsWith("package.json")) {
    try {
      const manifest = JSON.parse(content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.peerDependencies,
        manifest.optionalDependencies,
      ].forEach((deps) => Object.keys(deps ?? {}).forEach((dependency) => imports.add(dependency)));
    } catch {
      for (const match of content.matchAll(/"([^"]+)":\s*"[^"]+"/g)) imports.add(match[1]);
    }
  }
  if (/(requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml)$/.test(normalizedName)) {
    for (const line of content.split(/\r?\n/)) {
      const dep = line.trim().match(/^([A-Za-z0-9_.@/-]+)/)?.[1];
      if (dep && !/^(module|require|\[|version|name)$/.test(dep)) imports.add(dep);
    }
  }

  return Array.from(imports).slice(0, 80);
}

export function extractEnvironmentRefs(name: string, content: string) {
  const refs = new Set<string>();
  const normalized = `${name}\n${content}`;
  for (const match of normalized.matchAll(/\bprocess\.env\.([A-Z0-9_]+)\b/g)) refs.add(match[1]);
  for (const match of normalized.matchAll(/\bos\.environ(?:\.get)?\(["']([A-Z0-9_]+)["']\)/g)) refs.add(match[1]);
  for (const match of normalized.matchAll(/\bos\.environ\[['"]([A-Z0-9_]+)['"]\]/g)) refs.add(match[1]);
  for (const match of normalized.matchAll(/\bos\.getenv\(["']([A-Z0-9_]+)["']\)/g)) refs.add(match[1]);
  for (const match of normalized.matchAll(/\bgetenv\(["']?([A-Z0-9_]+)["']?\)/g)) refs.add(match[1]);
  for (const match of normalized.matchAll(/\b(import\.meta\.env\.[A-Z0-9_]+)\b/g)) refs.add(match[1]);
  if (/package\.json|next\.config|vite\.config|wrangler|dockerfile|compose|requirements|pyproject|go\.mod|Cargo\.toml|CMakeLists/i.test(name)) {
    refs.add(`manifest:${name.split("/").pop() ?? name}`);
  }
  if (/\b(PORT|DATABASE_URL|API_KEY|SECRET|TOKEN|NODE_ENV|PYTHONPATH|CLASSPATH)\b/.test(content)) refs.add("runtime-env");
  return Array.from(refs).slice(0, 60);
}

export function extractDeviceApiRefs(content: string) {
  const refs = new Set<string>();
  const patterns = [
    /\b(Serial\.(?:read|available|write|begin))\b/g,
    /\b(digital(?:Read|Write)|analog(?:Read|Write)|pinMode|attachInterrupt)\b/g,
    /\b(GPIO|PWM|UART|I2C|SPI|ADC|DAC)\b/g,
    /\b(relay|motor|sensor|watchdog|heartbeat|safeStop)\b/gi,
  ];
  patterns.forEach((pattern) => {
    for (const match of content.matchAll(pattern)) refs.add(match[1]);
  });
  return Array.from(refs).slice(0, 60);
}

export function simpleHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}
