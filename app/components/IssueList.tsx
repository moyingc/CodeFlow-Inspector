import type { AnalysisIssue } from "@/src/lib/analysis/types";

export function IssueList({ issues, empty }: { issues: AnalysisIssue[]; empty: string }) {
  if (!issues.length) return <p className="empty-state">{empty}</p>;
  const groups = groupIssues(issues);
  return (
    <div className="issue-list grouped-issue-list">
      {groups.map((group) => (
        <div className={`issue-row severity-${group.severity.toLowerCase()}`} key={group.key}>
          <div>
            <strong>{group.title}</strong>
            <span>{categoryLabel(group.category)} · {group.severity} · {group.status} · {group.confidence}%</span>
          </div>
          <p>{group.message}</p>
          <details className="issue-location-details">
            <summary>{group.locations.length} 个受影响位置</summary>
            <ul>
              {group.locations.map((location) => <li key={location}>{location}</li>)}
            </ul>
          </details>
        </div>
      ))}
    </div>
  );
}

function groupIssues(issues: AnalysisIssue[]) {
  const groups = new Map<string, {
    key: string;
    title: string;
    category: AnalysisIssue["category"];
    severity: AnalysisIssue["severity"];
    status: AnalysisIssue["status"];
    confidence: number;
    message: string;
    locations: string[];
  }>();

  issues.forEach((issue) => {
    const key = `${issue.category}:${normalizedIssueTitle(issue.title)}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        key,
        title: canonicalIssueTitle(issue.title),
        category: issue.category,
        severity: issue.severity,
        status: issue.status,
        confidence: issue.confidence,
        message: issue.message,
        locations: [issue.evidence],
      });
      return;
    }
    current.confidence = Math.max(current.confidence, issue.confidence);
    current.severity = strongerSeverity(current.severity, issue.severity);
    current.status = strongerStatus(current.status, issue.status);
    if (!current.locations.includes(issue.evidence)) current.locations.push(issue.evidence);
  });

  return Array.from(groups.values()).sort((a, b) =>
    severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence,
  );
}

function normalizedIssueTitle(title: string) {
  return canonicalIssueTitle(title).toLocaleLowerCase().replace(/[\s_-]+/g, " ");
}

function canonicalIssueTitle(title: string) {
  const normalized = title.trim().replace(/[\s_-]+/g, " ");
  if (/sql\s*注入(?:水路|路径|风险)?/i.test(normalized)) return "SQL 注入风险";
  if (/命令(?:执行|注入)(?:水路|路径|风险)?/i.test(normalized)) return "命令执行风险";
  if (/路径穿越/.test(normalized)) return "路径穿越风险";
  return normalized;
}

function strongerSeverity(a: AnalysisIssue["severity"], b: AnalysisIssue["severity"]) {
  return severityRank(a) >= severityRank(b) ? a : b;
}

function severityRank(severity: AnalysisIssue["severity"]) {
  return { Low: 1, Medium: 2, High: 3, Critical: 4 }[severity];
}

function strongerStatus(a: AnalysisIssue["status"], b: AnalysisIssue["status"]) {
  const rank = { Unknown: 1, Possible: 2, Likely: 3, Confirmed: 4 };
  return rank[a] >= rank[b] ? a : b;
}

function categoryLabel(category: AnalysisIssue["category"]) {
  return {
    security: "安全",
    flow: "数据流",
    environment: "运行环境",
    performance: "性能",
    quality: "稳定性",
  }[category];
}
