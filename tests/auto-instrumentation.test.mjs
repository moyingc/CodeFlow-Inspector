import assert from "node:assert/strict";
import test from "node:test";

import { instrumentRuntimeProject } from "../src/lib/runtime/auto-instrumentation.ts";

const fixtures = [
  ["node", "main.js", "console.log('ok');"],
  ["python", "main.py", "print('ok')"],
  ["rust", "main.rs", "fn main(){println!(\"ok\");}"],
  ["java", "Main.java", "public class Main { public static void main(String[] a) { System.out.println(\"ok\"); } }"],
  ["c", "main.c", "int main(void){return 0;}"],
  ["cpp", "main.cpp", "int main(){return 0;}"],
];

test("six runtime adapters receive sidecar-file instrumentation without mutating baseline files", () => {
  for (const [adapter, name, content] of fixtures) {
    const files = [{ id: name, name, language: adapter, content }];
    const report = instrumentRuntimeProject(files, adapter, name);
    assert.equal(report.status, "instrumented", adapter);
    assert.match(report.files[0].content, /CODEFLOW_AUTO_INSTRUMENTATION_V1/, adapter);
    assert.match(report.files[0].content, /CODEFLOW_TRACE_PATH/, adapter);
    assert.equal(files[0].content, content, `${adapter} baseline mutation`);
  }
});

test("instrumentation preserves language preambles and emits exit hooks", () => {
  const node = instrumentRuntimeProject([{ id: "n", name: "main.js", language: "JavaScript", content: "#!/usr/bin/env node\nconsole.log('ok');" }], "node", "main.js").files[0].content;
  assert.match(node, /^#!\/usr\/bin\/env node\n\/\* CODEFLOW_AUTO/);

  const python = instrumentRuntimeProject([{ id: "p", name: "main.py", language: "Python", content: "from __future__ import annotations\nprint('ok')" }], "python", "main.py").files[0].content;
  assert.ok(python.indexOf("from __future__ import annotations") < python.indexOf("CODEFLOW_AUTO_INSTRUMENTATION_V1"));

  const java = instrumentRuntimeProject([{ id: "j", name: "Main.java", language: "Java", content: "package demo;\nimport java.util.*;\npublic class Main { public static void main(String[] a) {} }" }], "java", "Main.java").files[0].content;
  assert.ok(java.indexOf("import java.util.*;") < java.indexOf("class __CodeFlowTrace"));

  const rust = instrumentRuntimeProject([{ id: "r", name: "main.rs", language: "Rust", content: "#![allow(dead_code)]\nfn main(){}" }], "rust", "main.rs").files[0].content;
  assert.match(rust, /impl Drop for __CodeFlowTraceGuard/);
  assert.ok(rust.indexOf("#![allow(dead_code)]") < rust.indexOf("CODEFLOW_AUTO_INSTRUMENTATION_V1"));
});

test("Java, Rust and native dynamic boundaries are rewritten to trace-producing wrappers", () => {
  const java = instrumentRuntimeProject([{ id: "j", name: "Main.java", language: "Java", content: "public class Main { public static void main(String[] a) throws Exception { Class.forName(\"demo.Plugin\"); System.loadLibrary(\"demo\"); } }" }], "java", "Main.java").files[0].content;
  assert.match(java, /__CodeFlowTrace\.classForName/);
  assert.match(java, /__CodeFlowTrace\.loadLibrary/);
  assert.match(java, /from\\\":\\\"</);

  const rust = instrumentRuntimeProject([{ id: "r", name: "main.rs", language: "Rust", content: "fn main(){unsafe{let _=libloading::Library::new(\"plugin.so\");}}" }], "rust", "main.rs").files[0].content;
  assert.match(rust, /__codeflow_library_new/);
  assert.match(rust, /rust-dynamic/);

  for (const adapter of ["c", "cpp"]) {
    const content = adapter === "c" ? "int main(void){void* h=dlopen(\"plugin.so\",1);dlsym(h,\"run\");return 0;}" : "int main(){void* h=dlopen(\"plugin.so\",1);dlsym(h,\"run\");return 0;}";
    const instrumented = instrumentRuntimeProject([{ id: adapter, name: `main.${adapter}`, language: adapter, content }], adapter, `main.${adapter}`).files[0].content;
    assert.match(instrumented, /__codeflow_dlopen/);
    assert.match(instrumented, /__codeflow_dlsym/);
    assert.match(instrumented, /native-ffi/);
  }
});
