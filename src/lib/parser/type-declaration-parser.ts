import type {
  CodeFile,
  TypeDeclarationField,
  TypeDeclarationInfo,
} from "@/src/lib/analysis/types";

type PythonClassBlock = {
  name: string;
  bases: string[];
  startIndex: number;
  endIndex: number;
  indent: number;
};

export function parseTypeDeclarationsFromFile(file: CodeFile): TypeDeclarationInfo[] {
  if (file.language === "Python") return parsePythonDeclarations(file);
  return [];
}

function parsePythonDeclarations(file: CodeFile): TypeDeclarationInfo[] {
  const lines = file.content.split(/\r?\n/);
  const classes = collectPythonClasses(lines);

  return classes
    .filter((block) => block.indent === 0)
    .map((block) => {
      const body = lines.slice(block.startIndex + 1, block.endIndex);
      const directIndent = firstBodyIndent(body);
      const fields = directIndent === null
        ? []
        : collectPythonFields(body, block.startIndex + 1, directIndent);
      const methods = directIndent === null
        ? []
        : collectPythonMethods(body, directIndent);
      const configuration = collectPythonConfiguration(body);
      const kind = classifyPythonDeclaration(block.bases, fields);

      return {
        id: `${file.id}:type:${block.name}:${block.startIndex + 1}`,
        name: block.name,
        fileId: file.id,
        fileName: file.name,
        language: file.language,
        kind,
        role: inferDeclarationRole(block.name, kind),
        baseTypes: block.bases,
        fields,
        methods,
        configuration,
        startLine: block.startIndex + 1,
        endLine: Math.max(block.startIndex + 1, block.endIndex),
        confidence: kind === "数据模型" || kind === "ORM 模型" ? 94 : 88,
        parser: "PythonTypeDeclarationScanner",
        evidence: [
          `class ${block.name}${block.bases.length ? `(${block.bases.join(", ")})` : ""}`,
          `${fields.length} 个直接字段`,
          ...(configuration.length ? configuration : []),
        ],
      };
    });
}

function collectPythonClasses(lines: string[]): PythonClassBlock[] {
  const headers = lines.flatMap((line, index) => {
    const match = line.match(/^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/);
    if (!match) return [];
    return [{
      name: match[2],
      bases: (match[3] ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      startIndex: index,
      endIndex: lines.length,
      indent: indentation(match[1]),
    }];
  });

  return headers.map((header) => {
    for (let index = header.startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      if (indentation(line) <= header.indent) return { ...header, endIndex: index };
    }
    return header;
  });
}

function collectPythonFields(
  body: string[],
  absoluteBodyStart: number,
  directIndent: number,
): TypeDeclarationField[] {
  return body.flatMap((line, index) => {
    if (indentation(line) !== directIndent) return [];
    const annotated = line.match(/^\s*([A-Za-z_]\w*)\s*:\s*(.+?)(?:\s*=\s*(.+))?\s*$/);
    if (annotated) {
      const defaultValue = annotated[3]?.trim();
      return [{
        name: annotated[1],
        type: annotated[2].trim(),
        required: defaultValue === undefined || defaultValue === "...",
        ...(defaultValue === undefined ? {} : { defaultValue }),
        line: absoluteBodyStart + index + 1,
      }];
    }
    const ormField = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*((?:mapped_)?column|relationship)\s*\((.*)$/i);
    if (!ormField) return [];
    return [{
      name: ormField[1],
      type: inferOrmFieldType(ormField[3]),
      required: !/nullable\s*=\s*True/.test(ormField[3]),
      defaultValue: `${ormField[2]}(...)`,
      line: absoluteBodyStart + index + 1,
    }];
  });
}

function collectPythonMethods(body: string[], directIndent: number) {
  return body.flatMap((line) => {
    if (indentation(line) !== directIndent) return [];
    const match = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    return match ? [match[1]] : [];
  });
}

function collectPythonConfiguration(body: string[]) {
  return body.flatMap((line) => {
    const normalized = line.trim();
    if (/^(?:model_config\s*=|from_attributes\s*=|orm_mode\s*=)/.test(normalized)) {
      return [normalized];
    }
    return [];
  });
}

function classifyPythonDeclaration(
  bases: string[],
  fields: TypeDeclarationField[],
): TypeDeclarationInfo["kind"] {
  const baseText = bases.join(" ").toLowerCase();
  if (/declarativebase|sqlmodel|db\.model|models?\.model/.test(baseText) || fields.some((field) => /column|relationship/i.test(field.defaultValue ?? ""))) {
    return "ORM 模型";
  }
  if (
    baseText.includes("basemodel") ||
    bases.some((base) =>
      /(?:create|update|out|request|payload)$/i.test(base) ||
      (base !== "Base" && /Base$/i.test(base)),
    )
  ) {
    return "数据模型";
  }
  return "类";
}

function inferDeclarationRole(name: string, kind: TypeDeclarationInfo["kind"]) {
  if (/Request$|Create$|Payload$|Input$/.test(name)) return "输入契约";
  if (/Update$|Patch$/.test(name)) return "更新契约";
  if (/Out$|Response$|Result$|View$/.test(name)) return "输出契约";
  if (/Base$/.test(name)) return "共享字段基类";
  if (/Tree/.test(name)) return "层级数据结构";
  if (kind === "ORM 模型") return "数据库实体";
  if (kind === "数据模型") return "数据传输契约";
  return "对象与行为封装";
}

function inferOrmFieldType(argumentsText: string) {
  const typeName = argumentsText.match(/^\s*([A-Za-z_][\w.]*)/)?.[1];
  return typeName ?? "ORM field";
}

function firstBodyIndent(body: string[]) {
  const indents = body
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map(indentation)
    .filter((value) => value > 0);
  return indents.length ? Math.min(...indents) : null;
}

function indentation(value: string) {
  const prefix = value.match(/^\s*/)?.[0] ?? "";
  return prefix.replace(/\t/g, "    ").length;
}
