import type { CodeFile, ControlledRuntimeAdapter } from "@/src/lib/analysis/types";

export type RuntimeInstrumentationReport = {
  status: "instrumented" | "already-instrumented" | "unsupported";
  files: CodeFile[];
  changedFiles: string[];
  evidence: string[];
};

const MARKER = "CODEFLOW_AUTO_INSTRUMENTATION_V1";

export function instrumentRuntimeProject(files: CodeFile[], adapter: ControlledRuntimeAdapter, entryPath: string): RuntimeInstrumentationReport {
  const entry = files.find((file) => file.name === entryPath);
  if (!entry) return { status: "unsupported", files, changedFiles: [], evidence: ["运行入口不在项目文件中，未自动插桩。"] };
  if (entry.content.includes(MARKER)) return { status: "already-instrumented", files, changedFiles: [], evidence: ["入口已包含 CodeFlow 自动插桩标记。"] };
  const content = instrumentEntry(entry.content, adapter);
  if (!content) return { status: "unsupported", files, changedFiles: [], evidence: [`${adapter} 入口结构无法安全定位，保留未插桩副本。`] };
  return {
    status: "instrumented",
    files: files.map((file) => file.name === entryPath ? { ...file, content } : { ...file }),
    changedFiles: [entryPath],
    evidence: [
      `${entryPath} 已在内存运行副本中加入入口/退出插桩。`,
      "轨迹写入 CODEFLOW_TRACE_PATH 指向的沙箱内 NDJSON 文件，不占用目标程序 stdout。",
      "入口/退出与 Node/Python 动态模块、eval 边界使用独立 sidecar trace；其他语言边界保持静态候选直至专用动态证据到达。",
    ],
  };
}

function instrumentEntry(source: string, adapter: ControlledRuntimeAdapter) {
  if (adapter === "node") {
    const prelude = `/* ${MARKER} */\nconst __codeflowTracePath = process.env.CODEFLOW_TRACE_PATH;\nconst __codeflowTraceRecord = (record) => { if (__codeflowTracePath) process.getBuiltinModule("fs").appendFileSync(__codeflowTracePath, JSON.stringify(record)+"\\n"); };\nconst __codeflowTrace = (event) => __codeflowTraceRecord({functionName:"<program>",event,dataNames:[]});\nconst __codeflowBoundary = (kind,target) => __codeflowTraceRecord({functionName:String(target||kind),event:"transfer",dataNames:["dynamic-boundary"],from:"<"+kind+">",to:String(target||"unknown")});\nconst __cfModule = process.getBuiltinModule("module"); const __cfLoad = __cfModule._load; __cfModule._load = function(request,parent,isMain){ if(!String(request).startsWith("node:")) __codeflowBoundary("dynamic-import",request); return __cfLoad.apply(this,arguments); };\nconst __cfEval = globalThis.eval; globalThis.eval = function(code){ __codeflowBoundary("dynamic-code","eval"); return __cfEval(code); };\n__codeflowTrace("enter");\nprocess.on("exit", () => __codeflowTrace("exit"));\n`;
    return insertAfterLeadingLines(source, prelude, [/^\s*#!/]);
  }
  if (adapter === "python") {
    const prelude = `# ${MARKER}\nimport atexit as __cf_atexit, json as __cf_json, os as __cf_os, builtins as __cf_builtins, importlib as __cf_importlib\ndef __codeflow_record(record):\n    path = __cf_os.environ.get("CODEFLOW_TRACE_PATH")\n    if path:\n        with open(path, "a", encoding="utf-8") as stream:\n            stream.write(__cf_json.dumps(record) + "\\n")\ndef __codeflow_trace(event): __codeflow_record({"functionName":"<program>","event":event,"dataNames":[]})\ndef __codeflow_boundary(kind,target): __codeflow_record({"functionName":str(target),"event":"transfer","dataNames":["dynamic-boundary"],"from":"<"+kind+">","to":str(target)})\n__cf_eval = __cf_builtins.eval\ndef __codeflow_eval(code, globals=None, locals=None):\n    __codeflow_boundary("dynamic-code", "eval")\n    return __cf_eval(code, globals, locals)\n__cf_builtins.eval = __codeflow_eval\n__cf_import = __cf_importlib.import_module\ndef __codeflow_import(name, package=None):\n    __codeflow_boundary("dynamic-import", name)\n    return __cf_import(name, package)\n__cf_importlib.import_module = __codeflow_import\n__codeflow_trace("enter")\n__cf_atexit.register(lambda: __codeflow_trace("exit"))\n`;
    return insertAfterLeadingLines(source, prelude, [/^\s*#!/, /^\s*#.*coding[:=]/, /^\s*from\s+__future__\s+import\b/]);
  }
  if (adapter === "rust") {
    const dynamic = /\blibloading::Library::new\s*\(/.test(source);
    const helper = `// ${MARKER}\nfn __codeflow_trace(event:&str){if let Ok(path)=std::env::var("CODEFLOW_TRACE_PATH"){use std::io::Write; if let Ok(mut file)=std::fs::OpenOptions::new().create(true).append(true).open(path){let _=writeln!(file,"{{\\\"functionName\\\":\\\"<program>\\\",\\\"event\\\":\\\"{}\\\",\\\"dataNames\\\":[]}}",event);}}}\nfn __codeflow_boundary(kind:&str,target:&str){if let Ok(path)=std::env::var("CODEFLOW_TRACE_PATH"){use std::io::Write;if let Ok(mut file)=std::fs::OpenOptions::new().create(true).append(true).open(path){let _=writeln!(file,"{{\\\"functionName\\\":\\\"{}\\\",\\\"event\\\":\\\"transfer\\\",\\\"dataNames\\\":[\\\"dynamic-boundary\\\"],\\\"from\\\":\\\"<{}>\\\",\\\"to\\\":\\\"{}\\\"}}",target,kind,target);}}}\nstruct __CodeFlowTraceGuard;\nimpl Drop for __CodeFlowTraceGuard{fn drop(&mut self){__codeflow_trace("exit");}}\n${dynamic ? `// rust-dynamic\nunsafe fn __codeflow_library_new<P:AsRef<std::ffi::OsStr>>(path:P)->Result<libloading::Library,libloading::Error>{__codeflow_boundary("ffi","libloading::Library::new");libloading::Library::new(path)}\n` : ""}`;
    const dynamicSource = dynamic ? source.replace(/\blibloading::Library::new\s*\(/g, "__codeflow_library_new(") : source;
    const injected = dynamicSource.replace(/\bfn\s+main\s*\([^)]*\)\s*\{/, (match) => `${match}\n__codeflow_trace("enter"); let _codeflow_trace_guard=__CodeFlowTraceGuard;`);
    return injected === source ? null : insertAfterLeadingLines(injected, helper, [/^\s*#!\s*\[/]);
  }
  if (adapter === "java") {
    const helper = `/* ${MARKER} */\n// java-reflection\nclass __CodeFlowTrace { static void emit(String event) { try { String path=System.getenv("CODEFLOW_TRACE_PATH"); if(path!=null) java.nio.file.Files.writeString(java.nio.file.Path.of(path), "{\\\"functionName\\\":\\\"<program>\\\",\\\"event\\\":\\\""+event+"\\\",\\\"dataNames\\\":[]}\\n", java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND); } catch(Exception ignored) {} } static void boundary(String kind,String target){try{String path=System.getenv("CODEFLOW_TRACE_PATH");if(path!=null)java.nio.file.Files.writeString(java.nio.file.Path.of(path),"{\\\"functionName\\\":\\\""+target+"\\\",\\\"event\\\":\\\"transfer\\\",\\\"dataNames\\\":[\\\"dynamic-boundary\\\"],\\\"from\\\":\\\"<"+kind+">\\\",\\\"to\\\":\\\""+target+"\\\"}\\n",java.nio.file.StandardOpenOption.CREATE,java.nio.file.StandardOpenOption.APPEND);}catch(Exception ignored){}} static Class<?> classForName(String name)throws ClassNotFoundException{boundary("reflection",name);return Class.forName(name);} static void loadLibrary(String name){boundary("ffi",name);System.loadLibrary(name);} }\n`;
    const rewritten = source.replace(/\bClass\.forName\s*\(/g, "__CodeFlowTrace.classForName(").replace(/\bSystem\.loadLibrary\s*\(/g, "__CodeFlowTrace.loadLibrary(");
    const injected = rewritten.replace(/\bstatic\s+void\s+main\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\{/, (match) => `${match}\n__CodeFlowTrace.emit("enter"); Runtime.getRuntime().addShutdownHook(new Thread(() -> __CodeFlowTrace.emit("exit")));`);
    return injected === source ? null : insertAfterLeadingLines(injected, helper, [/^\s*package\s+[\w.]+\s*;/, /^\s*import\s+(?:static\s+)?[\w.*]+\s*;/]);
  }
  if (adapter === "c" || adapter === "cpp") {
    const dynamic = /\b(?:dlopen|dlsym)\s*\(/.test(source);
    const helper = `/* ${MARKER} */\n#include <stdio.h>\n#include <stdlib.h>\nstatic void __codeflow_trace(const char* event){const char* path=getenv("CODEFLOW_TRACE_PATH");if(path){FILE* f=fopen(path,"a");if(f){fprintf(f,"{\\\"functionName\\\":\\\"<program>\\\",\\\"event\\\":\\\"%s\\\",\\\"dataNames\\\":[]}\\n",event);fclose(f);}}}\nstatic void __codeflow_boundary(const char* kind,const char* target){const char* path=getenv("CODEFLOW_TRACE_PATH");if(path){FILE* f=fopen(path,"a");if(f){fprintf(f,"{\\\"functionName\\\":\\\"%s\\\",\\\"event\\\":\\\"transfer\\\",\\\"dataNames\\\":[\\\"dynamic-boundary\\\"],\\\"from\\\":\\\"<%s>\\\",\\\"to\\\":\\\"%s\\\"}\\n",target,kind,target);fclose(f);}}}\n${dynamic ? `// native-ffi ${adapter === "cpp" ? "cpp-dynamic" : ""}\n#if defined(__unix__) || defined(__APPLE__)\n#include <dlfcn.h>\nstatic void* __codeflow_dlopen(const char* path,int mode){__codeflow_boundary("ffi",path?path:"dlopen");return dlopen(path,mode);}\nstatic void* __codeflow_dlsym(void* handle,const char* symbol){__codeflow_boundary("ffi",symbol?symbol:"dlsym");return dlsym(handle,symbol);}\n#endif\n` : ""}`;
    const rewritten = dynamic ? source.replace(/\bdlopen\s*\(/g, "__codeflow_dlopen(").replace(/\bdlsym\s*\(/g, "__codeflow_dlsym(") : source;
    const injected = rewritten.replace(/\b(?:int|auto)\s+main\s*\([^)]*\)\s*\{/, (match) => `${match}\n__codeflow_trace("enter"); atexit(${adapter === "cpp" ? "[](){__codeflow_trace(\"exit\");}" : "__codeflow_trace_exit"});`);
    if (injected === source) return null;
    if (adapter === "c") {
      const cHelper = helper.replace("static void __codeflow_trace(const char* event)", "static void __codeflow_trace(const char* event)") + `static void __codeflow_trace_exit(void){__codeflow_trace("exit");}\n`;
      return `${cHelper}${injected}`;
    }
    return `${helper}${injected}`;
  }
  return null;
}

function insertAfterLeadingLines(source: string, insertion: string, accepted: RegExp[]) {
  const lines = source.split(/(?<=\n)/);
  let index = 0;
  while (index < lines.length && accepted.some((pattern) => pattern.test(lines[index]))) index += 1;
  return `${lines.slice(0, index).join("")}${insertion}${lines.slice(index).join("")}`;
}
