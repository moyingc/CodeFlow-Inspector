import type { CodeFile, ControlledRuntimeAdapter } from "../analysis/types.ts";
import type { SecurityAttackSample } from "./security-assertions.ts";

export type ProtocolFramework = "fastapi" | "django" | "flask" | "express" | "spring";

export type ProtocolExperimentPlan = {
  framework: ProtocolFramework;
  files: CodeFile[];
  adapter: ControlledRuntimeAdapter;
  entryPath: string;
  stdin: string;
  targetFile: string;
  targetRoute: string;
  evidence: string[];
};

type ProtocolTarget = {
  framework: ProtocolFramework;
  file: CodeFile;
  applicationName: string;
  routes: Array<{ method: string; path: string }>;
};

export function detectProtocolTargets(files: CodeFile[]): ProtocolTarget[] {
  return files.flatMap((file) => {
    if (/\bFastAPI\s*\(/.test(file.content)) {
      const applicationName = file.content.match(/\b([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/)?.[1] ?? "app";
      return [{ framework: "fastapi" as const, file, applicationName, routes: pythonRoutes(file.content, applicationName) }];
    }
    if (/\bFlask\s*\(/.test(file.content)) {
      const applicationName = file.content.match(/\b([A-Za-z_]\w*)\s*=\s*Flask\s*\(/)?.[1] ?? "app";
      return [{ framework: "flask" as const, file, applicationName, routes: flaskRoutes(file.content, applicationName) }];
    }
    if (/\b(?:express\s*\(|require\(["']express["']\)|from\s+["']express["'])/.test(file.content)) {
      const applicationName = file.content.match(/\b([A-Za-z_$][\w$]*)\s*=\s*express\s*\(/)?.[1] ?? "app";
      return [{ framework: "express" as const, file, applicationName, routes: javascriptRoutes(file.content, applicationName) }];
    }
    if (/settings\.py$/i.test(file.name) && files.some((item) => /(?:^|\/)manage\.py$/i.test(item.name))) {
      const manage = files.find((item) => /(?:^|\/)manage\.py$/i.test(item.name)) ?? file;
      return [{ framework: "django" as const, file: manage, applicationName: djangoSettingsModule(manage.content, file.name), routes: djangoRoutes(files) }];
    }
    if (/\bSpringApplication\.run\s*\(|@SpringBootApplication\b/.test(file.content)) {
      const applicationName = file.content.match(/\bclass\s+([A-Za-z_]\w*)/)?.[1] ?? "Application";
      return [{ framework: "spring" as const, file, applicationName, routes: springRoutes(files) }];
    }
    return [];
  });
}

export function prepareProtocolExperiment(files: CodeFile[], sample: SecurityAttackSample): ProtocolExperimentPlan | null {
  if (sample.protocol === "generic-json") return null;
  const target = detectProtocolTargets(files)[0];
  if (!target) return null;
  const route = selectRoute(target.routes, sample);
  const request = requestEnvelope(sample, route);
  const harness = target.framework === "fastapi" ? fastApiHarness(target)
    : target.framework === "flask" ? flaskHarness(target)
      : target.framework === "django" ? djangoHarness(target)
        : target.framework === "express" ? expressHarness(target)
          : springHarness(target);
  const entryPath = target.framework === "spring" ? "src/main/java/CodeFlowProtocolHarness.java"
    : ["fastapi", "flask", "django"].includes(target.framework) ? ".codeflow/security_protocol_harness.py"
      : ".codeflow/security_protocol_harness.cjs";
  const harnessFile: CodeFile = {
    id: `codeflow-protocol-${target.framework}-${sample.id}`,
    name: entryPath,
    language: ["fastapi", "flask", "django"].includes(target.framework) ? "Python" : target.framework === "spring" ? "Java" : "JavaScript",
    content: harness,
    size: harness.length,
    imports: target.framework === "fastapi" ? ["fastapi", "starlette"] : target.framework === "flask" ? ["flask"] : target.framework === "django" ? ["django"] : target.framework === "spring" ? ["spring-test"] : ["supertest"],
    environmentRefs: [],
    deviceRefs: [],
  };
  return {
    framework: target.framework,
    files: [...files, harnessFile],
    adapter: ["fastapi", "flask", "django"].includes(target.framework) ? "python" : target.framework === "spring" ? "java" : "node",
    entryPath,
    stdin: JSON.stringify(request),
    targetFile: target.file.name,
    targetRoute: route.path,
    evidence: [
      `${target.framework} 进程内测试适配器命中 ${target.file.name} 的 ${route.method} ${route.path}。`,
      "协议请求在受控项目副本中执行，不创建常驻 localhost 服务。",
    ],
  };
}

function pythonRoutes(content: string, applicationName: string) {
  const pattern = new RegExp(`@${escapeRegExp(applicationName)}\\.(get|post|put|patch|delete)\\s*\\(\\s*["']([^"']+)["']`, "gi");
  return [...content.matchAll(pattern)].map((match) => ({ method: match[1].toUpperCase(), path: match[2] }));
}

function javascriptRoutes(content: string, applicationName: string) {
  const pattern = new RegExp(`\\b${escapeRegExp(applicationName)}\\.(get|post|put|patch|delete)\\s*\\(\\s*["']([^"']+)["']`, "gi");
  return [...content.matchAll(pattern)].map((match) => ({ method: match[1].toUpperCase(), path: match[2] }));
}

function flaskRoutes(content: string, applicationName: string) {
  const pattern = new RegExp(`@${escapeRegExp(applicationName)}\\.route\\s*\\(\\s*["']([^"']+)["']([^)]*)`, "gi");
  return [...content.matchAll(pattern)].map((match) => ({ method: match[2].match(/["'](GET|POST|PUT|PATCH|DELETE)["']/i)?.[1].toUpperCase() ?? "GET", path: match[1] }));
}

function djangoRoutes(files: CodeFile[]) {
  return files.filter((file) => /urls\.py$/i.test(file.name)).flatMap((file) => [...file.content.matchAll(/\bpath\s*\(\s*["']([^"']*)["']/g)].map((match) => ({ method: "GET", path: `/${match[1]}`.replace(/\/+/g, "/") })));
}

function springRoutes(files: CodeFile[]) {
  return files.flatMap((file) => [...file.content.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']*)["']/g)].map((match) => ({ method: match[1].toUpperCase(), path: match[2] || "/" })));
}

function selectRoute(routes: ProtocolTarget["routes"], sample: SecurityAttackSample) {
  const preferredMethod = ["unauthenticated", "cross-tenant", "path-traversal", "open-redirect"].includes(sample.kind) ? "GET" : "POST";
  return routes.find((route) => route.method === preferredMethod) ?? routes[0] ?? { method: preferredMethod, path: "/" };
}

function requestEnvelope(sample: SecurityAttackSample, route: { method: string; path: string }) {
  const parsed = safeObject(sample.payload);
  const existing = safeObject(parsed.request);
  const headers = safeObject(existing.headers);
  if (typeof parsed.authorization === "string") headers.authorization = parsed.authorization;
  return {
    method: typeof existing.method === "string" ? existing.method : route.method,
    path: typeof existing.path === "string" ? existing.path : route.path,
    headers,
    cookies: safeObject(existing.cookies),
    query: safeObject(existing.query),
    body: Object.keys(safeObject(existing.body)).length ? safeObject(existing.body) : parsed,
    canary: sample.canary,
  };
}

function fastApiHarness(target: ProtocolTarget) {
  const moduleName = target.file.name.replace(/\.py$/i, "").replace(/[\\/]/g, ".");
  return `# fastapi-test-client\nimport importlib, json, pathlib, sys\nsys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))\nfrom fastapi.testclient import TestClient\npayload = json.loads(sys.stdin.read() or "{}")\nmodule = importlib.import_module(${JSON.stringify(moduleName)})\napplication = getattr(module, ${JSON.stringify(target.applicationName)})\nclient = TestClient(application, raise_server_exceptions=False)\nresponse = client.request(str(payload.get("method", "GET")).upper(), payload.get("path", "/"), headers=payload.get("headers") or {}, cookies=payload.get("cookies") or {}, params=payload.get("query") or {}, json=payload.get("body"))\nprint(json.dumps({"codeflowHttpStatus": response.status_code, "body": response.text[:65536], "headers": dict(response.headers)}, ensure_ascii=False))\n`;
}

function flaskHarness(target: ProtocolTarget) {
  const moduleName = target.file.name.replace(/\.py$/i, "").replace(/[\\/]/g, ".");
  return `# flask-test-client\nimport importlib, json, pathlib, sys\nsys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))\npayload=json.loads(sys.stdin.read() or "{}")\nmodule=importlib.import_module(${JSON.stringify(moduleName)})\napplication=getattr(module,${JSON.stringify(target.applicationName)})\nwith application.test_client() as client:\n response=client.open(payload.get("path","/"),method=str(payload.get("method","GET")).upper(),headers=payload.get("headers") or {},query_string=payload.get("query") or {},json=payload.get("body"))\n print(json.dumps({"codeflowHttpStatus":response.status_code,"body":response.get_data(as_text=True)[:65536],"headers":dict(response.headers)},ensure_ascii=False))\n`;
}

function djangoHarness(target: ProtocolTarget) {
  return `# django-test-client\nimport json, os, pathlib, sys\nsys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", ${JSON.stringify(target.applicationName)})\nimport django\ndjango.setup()\nfrom django.test import Client\npayload=json.loads(sys.stdin.read() or "{}")\nclient=Client(headers={str(k):str(v) for k,v in (payload.get("headers") or {}).items() if v is not None})\nmethod=str(payload.get("method","GET")).lower()\ncaller=getattr(client,method)\nkwargs={"data":payload.get("body") or payload.get("query") or {},"content_type":"application/json"}\nresponse=caller(payload.get("path","/"),**kwargs)\nprint(json.dumps({"codeflowHttpStatus":response.status_code,"body":response.content.decode("utf-8","replace")[:65536],"headers":dict(response.headers)},ensure_ascii=False))\n`;
}

function expressHarness(target: ProtocolTarget) {
  const relative = `../${target.file.name}`.replace(/\\/g, "/");
  return `const supertest = require("supertest");\nconst loaded = require(${JSON.stringify(relative)});\nconst application = loaded.${target.applicationName} || loaded.app || loaded.default || loaded;\nlet raw = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => raw += chunk);\nprocess.stdin.on("end", async () => { const payload = JSON.parse(raw || "{}"); try { let request = supertest(application)[String(payload.method || "GET").toLowerCase()](payload.path || "/"); for (const [key,value] of Object.entries(payload.headers || {})) if (value != null) request = request.set(key, String(value)); if (Object.keys(payload.query || {}).length) request = request.query(payload.query); if (payload.body !== undefined) request = request.send(payload.body); const response = await request; console.log(JSON.stringify({codeflowHttpStatus: response.status, body: typeof response.text === "string" ? response.text.slice(0,65536) : response.body, headers: response.headers})); } catch (error) { console.error("CODEFLOW_PROTOCOL_ERROR", error && error.message ? error.message : String(error)); process.exitCode = 2; } });\n`;
}

function springHarness(target: ProtocolTarget) {
  const packageName = target.file.content.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? "";
  const applicationClass = packageName ? `${packageName}.${target.applicationName}` : target.applicationName;
  return `// spring-mockmvc\nimport org.springframework.mock.web.MockServletContext;\nimport org.springframework.test.web.servlet.MockMvc;\nimport org.springframework.test.web.servlet.request.MockMvcRequestBuilders;\nimport org.springframework.test.web.servlet.setup.MockMvcBuilders;\nimport org.springframework.web.context.support.AnnotationConfigWebApplicationContext;\npublic class CodeFlowProtocolHarness { public static void main(String[] args) throws Exception { Class<?> type=Class.forName(${JSON.stringify(applicationClass)}); try(AnnotationConfigWebApplicationContext context=new AnnotationConfigWebApplicationContext()){ context.setServletContext(new MockServletContext()); context.register(type); context.refresh(); MockMvc mvc=MockMvcBuilders.webAppContextSetup(context).build(); String payload=new String(System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8); String method=payload.replaceAll("(?s).*\\\"method\\\"\\s*:\\s*\\\"([^\\\"]+).*","$1"); String path=payload.replaceAll("(?s).*\\\"path\\\"\\s*:\\s*\\\"([^\\\"]+).*","$1"); var builder=MockMvcRequestBuilders.request(org.springframework.http.HttpMethod.valueOf(method),java.net.URI.create(path)).contentType("application/json").content(payload); var response=mvc.perform(builder).andReturn().getResponse(); System.out.println("{\\\"codeflowHttpStatus\\\":"+response.getStatus()+",\\\"body\\\":"+json(response.getContentAsString())+"}"); } } static String json(String value){return "\\\""+value.replace("\\\\","\\\\\\\\").replace("\\\"","\\\\\\\"").replace("\\n","\\\\n")+"\\\"";} }\n`;
}

function djangoSettingsModule(manageContent: string, settingsPath: string) {
  return manageContent.match(/DJANGO_SETTINGS_MODULE["']\s*,\s*["']([^"']+)/)?.[1] ?? settingsPath.replace(/\.py$/i, "").replace(/[\\/]/g, ".");
}

function safeObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return safeObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
