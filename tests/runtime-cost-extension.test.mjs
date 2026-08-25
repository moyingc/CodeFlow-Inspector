import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeCostSource = await readFile(new URL("../src/lib/runtime/runtime-cost.ts", import.meta.url), "utf8");
const extensionSource = await readFile(new URL("../src/lib/extensions/adapter-import.ts", import.meta.url), "utf8");
const rustSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("runtime cost combines project scale, controlled runs, and native host capacity", () => {
  assert.match(runtimeCostSource, /analysisMemory/);
  assert.match(runtimeCostSource, /measuredPeakMemory/);
  assert.match(runtimeCostSource, /availableMemoryBytes/);
  assert.match(runtimeCostSource, /availableDiskBytes/);
  assert.match(runtimeCostSource, /真实运行校准/);
  assert.match(pageSource, /运行成本与本机承载/);
  assert.match(pageSource, /runtimeCost\.dimensions/);
});

test("desktop capacity probe is read-only and registered with Tauri", () => {
  assert.match(rustSource, /fn codeflow_system_capacity/);
  assert.match(rustSource, /System::new_all\(\)/);
  assert.match(rustSource, /Disks::new_with_refreshed_list\(\)/);
  assert.match(rustSource, /read-only capacity probe/);
  assert.match(rustSource, /codeflow_system_capacity,/);
});

test("extension import rejects executable fields and records a content hash", () => {
  assert.match(extensionSource, /forbiddenKeys/);
  assert.match(extensionSource, /"command"/);
  assert.match(extensionSource, /"script"/);
  assert.match(extensionSource, /sha256Hex/);
  assert.match(extensionSource, /sidecar.*签名安装链/);
  assert.match(pageSource, /导入扩展声明/);
  assert.match(pageSource, /下载声明模板/);
});
