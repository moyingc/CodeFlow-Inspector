import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./node-typescript-worker.mjs", import.meta.url));

export function analyzeTypeScriptProjectViaNode(files, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Node parser bridge timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      let payload;
      try {
        payload = JSON.parse(stdout || "{}");
      } catch (error) {
        reject(new Error(`Node parser bridge returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }

      if (!payload.ok) {
        reject(new Error(payload.error?.message || stderr || `Node parser bridge exited with code ${code}`));
        return;
      }

      resolve({
        ...payload.report,
        bridgeName: "NodeParserBridge",
        transport: "child_process",
        stderr: stderr.trim(),
      });
    });

    child.stdin.end(
      JSON.stringify({
        files,
        options: {
          compilerOptions: options.compilerOptions,
        },
      }),
    );
  });
}
