import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseTypeDeclarationsFromFile } from "../src/lib/parser/type-declaration-parser.ts";

test("Python Pydantic and ORM declarations preserve their actual semantics", () => {
  const content = `
from pydantic import BaseModel

class TaskBase(BaseModel):
    title: str
    priority: int = 1

class TaskCreate(TaskBase):
    pass

class TaskOut(TaskBase):
    id: int
    class Config:
        from_attributes = True

class Task(Base):
    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
`;
  const declarations = parseTypeDeclarationsFromFile({
    id: "schemas",
    name: "backend/app/schemas.py",
    language: "Python",
    content,
  });

  assert.equal(declarations.length, 4);
  assert.deepEqual(declarations.find((item) => item.name === "TaskBase")?.fields.map((field) => field.name), ["title", "priority"]);
  assert.equal(declarations.find((item) => item.name === "TaskCreate")?.role, "输入契约");
  assert.deepEqual(declarations.find((item) => item.name === "TaskCreate")?.baseTypes, ["TaskBase"]);
  assert.match(declarations.find((item) => item.name === "TaskOut")?.configuration.join(" ") ?? "", /from_attributes/);
  assert.equal(declarations.find((item) => item.name === "Task")?.kind, "ORM 模型");
});

test("Python schema files are represented as data models instead of empty function files", async () => {
  const [parser, localParser, page] = await Promise.all([
    readFile(new URL("../src/lib/parser/type-declaration-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/parser/local-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(parser, /PythonTypeDeclarationScanner/);
  assert.match(parser, /basemodel/);
  assert.match(parser, /collectPythonFields/);
  assert.match(parser, /from_attributes/);
  assert.match(parser, /输入契约/);
  assert.match(parser, /输出契约/);
  assert.match(localParser, /declarations-only/);
  assert.match(localParser, /该文件是数据模型或类型契约文件/);
  assert.match(page, /个可执行函数和 \{file\.declarations\.length\} 个类型\/数据模型/);
  assert.match(page, /该模型没有新增字段/);
});
