import type { FormalVerificationRecord, ProjectContractReport } from "@/src/lib/analysis/types";

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type TauriWindow = Window & {
  __TAURI__?: { invoke?: TauriInvoke; core?: { invoke?: TauriInvoke } };
  __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
};

export async function runFormalPolicySuite(projectId: string): Promise<FormalVerificationRecord[]> {
  const invoke = nativeInvoke();
  if (!invoke) throw new Error("形式化证明只在 Tauri 桌面程序中执行，Web 预览不会调用本机 Z3。");
  return invoke("codeflow_run_formal_policy_suite", { projectId });
}

export async function runProjectContractProofs(projectId: string, contracts: ProjectContractReport): Promise<FormalVerificationRecord[]> {
  const invoke = nativeInvoke();
  if (!invoke) throw new Error("项目契约证明只在 Tauri 桌面程序中执行。");
  const obligations = contracts.contracts.flatMap((contract) => contract.clauses
    .filter((clause) => clause.smtEligible && (Boolean(clause.smtFormula) || clause.kind === "security"))
    .map((clause) => {
      const exposed = /taint-status=exposed/i.test(clause.evidence);
      const sanitized = /taint-status=sanitized/i.test(clause.evidence);
      const symbol = clause.id.replace(/[^a-zA-Z0-9_]/g, "_");
      const securityFormula = `(set-logic QF_UF)\n(declare-const tainted_${symbol} Bool)\n(declare-const sanitized_${symbol} Bool)\n(assert (= tainted_${symbol} true))\n(assert (= sanitized_${symbol} ${sanitized ? "true" : exposed ? "false" : "false"}))\n(assert (not (=> tainted_${symbol} sanitized_${symbol})))\n(check-sat)\n(get-model)`;
      return {
        obligationId: `verify-${clause.id}`,
        title: clause.description,
        fileName: clause.fileName,
        functionId: clause.functionId,
        line: clause.line,
        callChain: clause.callChain ?? [clause.functionId],
        formula: clause.smtFormula ?? securityFormula,
      };
    }));
  if (!obligations.length) return [];
  return invoke("codeflow_run_project_smt_batch", { request: { projectId, obligations } });
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const tauriWindow = window as TauriWindow;
  return tauriWindow.__TAURI__?.core?.invoke ?? tauriWindow.__TAURI__?.invoke ?? tauriWindow.__TAURI_INTERNALS__?.invoke ?? null;
}
