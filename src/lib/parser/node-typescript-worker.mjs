import { analyzeTypeScriptProject } from "./node-typescript-service.mjs";

const chunks = [];

for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

try {
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const report = await analyzeTypeScriptProject(payload.files ?? [], payload.options ?? {});
  process.stdout.write(JSON.stringify({ ok: true, report }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : "",
      },
    }),
  );
  process.exitCode = 1;
}
