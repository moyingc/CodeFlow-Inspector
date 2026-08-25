import type { CodeFile } from "@/src/lib/analysis/types";

export type ProjectDependencyInput = {
  name: string;
  version: string;
  versionConstraint: string;
  ecosystem: string;
  sourceFile: string;
  resolution: "manifest" | "lockfile";
  exact: boolean;
};

export type ProjectKnowledgeMatch = {
  dependencyName: string;
  dependencyVersion: string;
  sourceFile: string;
  advisoryId: string;
  sourceId: string;
  severity: string;
  title: string;
  cweIds: string[];
  affectedRange: string;
  matchStatus: "confirmed" | "review";
  confidence: number;
  kevPriority: boolean;
  evidence: string;
};

export type ProjectKnowledgeMatchReport = {
  status: "web-preview" | "no-active-pack" | "clear" | "matched";
  activePackId: string | null;
  dependencyCount: number;
  confirmedCount: number;
  reviewCount: number;
  matches: ProjectKnowledgeMatch[];
  evidence: string[];
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function extractProjectDependencies(files: CodeFile[]): ProjectDependencyInput[] {
  const dependencies: ProjectDependencyInput[] = [];
  files.forEach((file) => {
    const base = file.name.split("/").pop()?.toLowerCase() ?? "";
    if (base === "package.json") extractPackageJson(file, dependencies);
    else if (base === "package-lock.json" || base === "npm-shrinkwrap.json") extractPackageLock(file, dependencies);
    else if (base === "yarn.lock") extractYarnLock(file, dependencies);
    else if (base === "pnpm-lock.yaml") extractPnpmLock(file, dependencies);
    else if (/^requirements(?:-[^.]+)?\.txt$/.test(base)) extractRequirementLines(file, dependencies, "PyPI");
    else if (base === "poetry.lock") extractPoetryLock(file, dependencies);
    else if (base === "cargo.toml") extractTomlSection(file, dependencies, "crates.io");
    else if (base === "cargo.lock") extractCargoLock(file, dependencies);
    else if (base === "go.mod") extractGoModules(file, dependencies);
    else if (base === "go.sum") extractGoSum(file, dependencies);
    else if (base === "pom.xml") extractMaven(file, dependencies);
    else if (base.endsWith(".lockfile")) extractGradleLock(file, dependencies);
  });
  const unique = new Map<string, ProjectDependencyInput>();
  dependencies.forEach((item) => {
    const key = `${item.ecosystem.toLowerCase()}:${item.name.toLowerCase()}`;
    const current = unique.get(key);
    if (!current || (!current.exact && item.exact) || (current.resolution === "manifest" && item.resolution === "lockfile")) {
      unique.set(key, item);
    }
  });
  return Array.from(unique.values()).slice(0, 500);
}

export async function matchProjectDependencies(files: CodeFile[]): Promise<ProjectKnowledgeMatchReport> {
  const dependencies = extractProjectDependencies(files);
  const invoke = nativeInvoke();
  if (!invoke) return emptyReport("web-preview", dependencies.length, "依赖漏洞匹配只在本地桌面数据库中执行。");
  return invoke("codeflow_match_project_dependencies", { dependencies });
}

function extractPackageJson(file: CodeFile, output: ProjectDependencyInput[]) {
  try {
    const manifest = JSON.parse(file.content) as Record<string, unknown>;
    ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].forEach((key) => {
      const values = manifest[key];
      if (!values || typeof values !== "object" || Array.isArray(values)) return;
      Object.entries(values as Record<string, unknown>).forEach(([name, version]) => {
        output.push(dependency(name, String(version), "npm", file.name, "manifest"));
      });
    });
  } catch {
    // Invalid manifests remain visible through the existing environment diagnostics.
  }
}

function extractPackageLock(file: CodeFile, output: ProjectDependencyInput[]) {
  try {
    const lock = JSON.parse(file.content) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
    Object.entries(lock.packages ?? {}).forEach(([path, value]) => {
      if (!path.includes("node_modules/") || !value.version) return;
      output.push(dependency(path.slice(path.lastIndexOf("node_modules/") + 13), value.version, "npm", file.name, "lockfile", true));
    });
    if (!lock.packages) Object.entries(lock.dependencies ?? {}).forEach(([name, value]) => {
      if (value.version) output.push(dependency(name, value.version, "npm", file.name, "lockfile", true));
    });
  } catch {
    // Invalid lockfiles remain visible through environment diagnostics.
  }
}

function extractYarnLock(file: CodeFile, output: ProjectDependencyInput[]) {
  let names: string[] = [];
  file.content.split(/\r?\n/).forEach((line) => {
    if (line && !/^\s/.test(line) && line.endsWith(":")) {
      names = line.slice(0, -1).split(/,\s*/).map((item) => packageNameFromSelector(item.replace(/^['"]|['"]$/g, ""))).filter(Boolean);
      return;
    }
    const version = line.match(/^\s+version\s+["']([^"']+)["']/)?.[1];
    if (version) names.forEach((name) => output.push(dependency(name, version, "npm", file.name, "lockfile", true)));
  });
}

function extractPnpmLock(file: CodeFile, output: ProjectDependencyInput[]) {
  file.content.split(/\r?\n/).forEach((line) => {
    const selector = line.match(/^\s{2,}["']?\/?((?:@[^/\s]+\/)?[^@:\s]+)@([^:\s(]+)(?:\([^)]*\))?["']?:\s*$/);
    if (selector) output.push(dependency(selector[1], selector[2], "npm", file.name, "lockfile", true));
  });
}

function extractRequirementLines(file: CodeFile, output: ProjectDependencyInput[], ecosystem: string) {
  file.content.split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*(?:===|==|~=|>=|<=|>|<)?\s*([^\s;#]+)?/);
    if (match) output.push(dependency(match[1], match[2] ?? "", ecosystem, file.name, "manifest"));
  });
}

function extractTomlSection(file: CodeFile, output: ProjectDependencyInput[], ecosystem: string) {
  let inDependencies = false;
  file.content.split(/\r?\n/).forEach((line) => {
    const section = line.trim().match(/^\[([^\]]+)\]$/)?.[1] ?? "";
    if (section) inDependencies = /(?:^|\.)dependencies$/.test(section);
    if (!inDependencies) return;
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/);
    if (match) output.push(dependency(match[1], match[2] ?? match[3] ?? "", ecosystem, file.name, "manifest"));
  });
}

function extractPoetryLock(file: CodeFile, output: ProjectDependencyInput[]) {
  let name = "";
  file.content.split(/\r?\n/).forEach((line) => {
    if (line.trim() === "[[package]]") name = "";
    const nextName = line.match(/^name\s*=\s*"([^"]+)"/)?.[1];
    if (nextName) name = nextName;
    const version = line.match(/^version\s*=\s*"([^"]+)"/)?.[1];
    if (name && version) output.push(dependency(name, version, "PyPI", file.name, "lockfile", true));
  });
}

function extractCargoLock(file: CodeFile, output: ProjectDependencyInput[]) {
  let name = "";
  file.content.split(/\r?\n/).forEach((line) => {
    if (line.trim() === "[[package]]") name = "";
    const nextName = line.match(/^name\s*=\s*"([^"]+)"/)?.[1];
    if (nextName) name = nextName;
    const version = line.match(/^version\s*=\s*"([^"]+)"/)?.[1];
    if (name && version) output.push(dependency(name, version, "crates.io", file.name, "lockfile", true));
  });
}

function extractGoModules(file: CodeFile, output: ProjectDependencyInput[]) {
  file.content.split(/\r?\n/).forEach((line) => {
    const match = line.trim().replace(/^require\s+/, "").match(/^([^\s()]+)\s+v([0-9][^\s]*)$/);
    if (match && match[1] !== "go" && match[1] !== "module") output.push(dependency(match[1], match[2], "Go", file.name, "manifest", true));
  });
}

function extractGoSum(file: CodeFile, output: ProjectDependencyInput[]) {
  file.content.split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(/^([^\s]+)\s+v([^\s/]+)(?:\/go\.mod)?\s+h1:/);
    if (match) output.push(dependency(match[1], match[2], "Go", file.name, "lockfile", true));
  });
}

function extractMaven(file: CodeFile, output: ProjectDependencyInput[]) {
  const pattern = /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/g;
  for (const match of file.content.matchAll(pattern)) output.push(dependency(`${match[1]}:${match[2]}`, match[3] ?? "", "Maven", file.name, "manifest"));
}

function extractGradleLock(file: CodeFile, output: ProjectDependencyInput[]) {
  file.content.split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(/^([^:#\s]+):([^:\s]+):([^=\s]+)=/);
    if (match) output.push(dependency(`${match[1]}:${match[2]}`, match[3], "Maven", file.name, "lockfile", true));
  });
}

function dependency(name: string, rawVersion: string, ecosystem: string, sourceFile: string, resolution: ProjectDependencyInput["resolution"], forcedExact = false): ProjectDependencyInput {
  const versionConstraint = rawVersion.trim();
  const exact = forcedExact || isExactVersion(versionConstraint);
  return { name: name.trim(), version: exact ? cleanVersion(versionConstraint) : versionConstraint, versionConstraint, ecosystem, sourceFile, resolution, exact };
}

function cleanVersion(version: string) {
  return version.trim().replace(/^v/, "").split(/[+\s]/)[0] ?? "";
}

function isExactVersion(version: string) {
  return /^(?:v)?\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version.trim());
}

function packageNameFromSelector(selector: string) {
  if (selector.startsWith("@")) {
    const separator = selector.indexOf("@", 1 + selector.indexOf("/"));
    return separator > 0 ? selector.slice(0, separator) : selector;
  }
  const separator = selector.indexOf("@");
  return separator > 0 ? selector.slice(0, separator) : selector;
}

function emptyReport(status: ProjectKnowledgeMatchReport["status"], dependencyCount: number, evidence: string): ProjectKnowledgeMatchReport {
  return { status, activePackId: null, dependencyCount, confirmedCount: 0, reviewCount: 0, matches: [], evidence: [evidence] };
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const current = window as Window & {
    __TAURI__?: { invoke?: TauriInvoke; core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  return current.__TAURI_INTERNALS__?.invoke ?? current.__TAURI__?.core?.invoke ?? current.__TAURI__?.invoke ?? null;
}
