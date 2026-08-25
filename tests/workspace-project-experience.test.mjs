import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  exportWorkspaceProjectBackup,
  parseWorkspaceProjectBackup,
} from "../src/lib/workspace/project-store.ts";

const project = {
  id: "project-a",
  name: "Baseline",
  source: "files",
  createdAt: 1,
  updatedAt: 2,
  files: [{ id: "project-a:file-a", name: "src/main.ts", language: "TypeScript", content: "export const ok = true;" }],
};

test("workspace backup round-trips with integrity evidence", () => {
  const backup = exportWorkspaceProjectBackup([project], project.id);
  const restored = parseWorkspaceProjectBackup(JSON.stringify(backup));
  assert.equal(restored.projects.length, 1);
  assert.equal(restored.projects[0].name, "Baseline");
  assert.equal(restored.projects[0].files[0].content, "export const ok = true;");
  assert.match(restored.checksum, /^fnv1a-[0-9a-f]{8}$/);
});

test("workspace backup rejects modified project content", () => {
  const backup = exportWorkspaceProjectBackup([project], project.id);
  backup.projects[0].files[0].content = "modified without checksum";
  assert.throws(() => parseWorkspaceProjectBackup(JSON.stringify(backup)), /完整性校验失败/);
});

test("desktop navigation keeps its layout while Command and Shift opens a shortcut dial", async () => {
  const [navigator, page, styles] = await Promise.all([
    readFile(new URL("../app/components/WorkspaceNavigator.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(navigator, /"standard" \| "compact"/);
  assert.doesNotMatch(navigator, /NavigationMode = .*dial/);
  assert.match(navigator, /input, textarea, select/);
  assert.match(navigator, /event\.metaKey && event\.shiftKey/);
  assert.match(navigator, /event\.key === "Meta" \|\| event\.key === "Shift"/);
  assert.match(navigator, /Command 加 Shift/);
  assert.match(navigator, /移动选择 · 松开进入 · Esc 取消/);
  assert.doesNotMatch(navigator, /dial-launcher/);
  assert.match(navigator, /dial-segment-ring/);
  assert.match(navigator, /dial-selection-wedge/);
  assert.match(page, /codeflow-navigation-mode/);
  assert.match(page, /stored === "standard" \|\| stored === "compact"/);
  assert.match(page, /当前项目解析概览/);
  assert.match(styles, /\.navigation-dial/);
  assert.match(styles, /\.flow-sidebar-summary/);
});
