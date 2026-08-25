const defaultCompilerOptions = {
  allowJs: true,
  checkJs: false,
  esModuleInterop: true,
  jsx: 4,
  module: 99,
  moduleResolution: 100,
  noEmit: true,
  skipLibCheck: true,
  strict: false,
  target: 99,
};

export async function analyzeTypeScriptProject(files, options = {}) {
  const ts = await import("typescript");
  const sourceFiles = files.filter((file) => isTypeScriptLike(file));
  const virtualFiles = new Map(
    sourceFiles.map((file) => [normalizePath(file.name), { ...file, name: normalizePath(file.name) }]),
  );
  const rootNames = Array.from(virtualFiles.keys());
  const compilerOptions = { ...defaultCompilerOptions, ...options.compilerOptions };
  const host = createVirtualCompilerHost(ts, virtualFiles, compilerOptions);
  const program = ts.createProgram(rootNames, compilerOptions, host);
  const checker = program.getTypeChecker();
  const functionFacts = [];

  for (const fileName of rootNames) {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) continue;
    collectFunctionFacts(ts, checker, sourceFile, functionFacts);
  }

  const edges = buildCompilerEdges(functionFacts);
  const diagnostics = collectDiagnostics(ts, program, rootNames);

  return {
    adapterName: "NodeTypeScriptServiceAdapter",
    mode: "Compiler API",
    functionCount: functionFacts.length,
    edgeCount: edges.length,
    diagnosticCount: diagnostics.length,
    functions: functionFacts,
    edges,
    diagnostics,
    evidence: [
      "typescript loaded in Node-only adapter",
      `${rootNames.length} virtual source files`,
      `${functionFacts.length} compiler function facts`,
      `${edges.length} compiler call edges`,
    ],
  };
}

function createVirtualCompilerHost(ts, virtualFiles, compilerOptions) {
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const normalized = normalizePath(fileName);
    const virtualFile = virtualFiles.get(normalized);
    if (virtualFile) {
      return ts.createSourceFile(normalized, virtualFile.content, languageVersion, true, scriptKindForFile(ts, virtualFile));
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  host.fileExists = (fileName) => virtualFiles.has(normalizePath(fileName)) || originalFileExists(fileName);
  host.readFile = (fileName) => virtualFiles.get(normalizePath(fileName))?.content ?? originalReadFile(fileName);
  host.writeFile = () => {};

  return host;
}

function collectFunctionFacts(ts, checker, sourceFile, facts) {
  function visit(node) {
    const match = matchFunctionNode(ts, node, sourceFile);
    if (match) {
      const signature = checker.getSignatureFromDeclaration(match.node);
      const returnType = signature ? checker.typeToString(checker.getReturnTypeOfSignature(signature)) : "unknown";
      const calls = collectCalls(ts, match.node);
      const start = sourceFile.getLineAndCharacterOfPosition(match.node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(match.node.getEnd());
      const params = match.node.parameters.map((param) => {
        const paramType = checker.getTypeAtLocation(param);
        const typeName = checker.typeToString(paramType);
        return `${param.name.getText(sourceFile)}: ${typeName}`;
      });

      facts.push({
        id: `${sourceFile.fileName}:${match.name}:${start.line + 1}`,
        name: match.name,
        shortName: match.shortName,
        fileName: sourceFile.fileName,
        kind: match.kind,
        startLine: start.line + 1,
        endLine: end.line + 1,
        params,
        returnType,
        calls,
        confidence: signature ? 94 : 82,
        evidence: [
          "compiler node boundary",
          signature ? "type checker signature" : "syntax-only signature",
          calls.length ? "call expressions collected" : "no downstream calls",
        ],
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function matchFunctionNode(ts, node, sourceFile) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return { node, name: node.name.text, shortName: node.name.text, kind: "FunctionDeclaration" };
  }

  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const shortName = propertyName(ts, node.name, sourceFile);
    const owner = classOwnerName(ts, node);
    return {
      node,
      name: owner ? `${owner}.${shortName}` : shortName,
      shortName,
      kind: ts.isMethodDeclaration(node) ? "MethodDeclaration" : "AccessorDeclaration",
    };
  }

  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body) {
    const shortName = functionExpressionName(ts, node, sourceFile);
    if (!shortName) return null;
    return {
      node,
      name: shortName,
      shortName,
      kind: ts.isArrowFunction(node) ? "ArrowFunction" : "FunctionExpression",
    };
  }

  return null;
}

function collectCalls(ts, node) {
  const calls = new Set();

  function visit(child) {
    if (ts.isCallExpression(child)) {
      const expression = child.expression;
      if (ts.isIdentifier(expression)) calls.add(expression.text);
      if (ts.isPropertyAccessExpression(expression)) calls.add(expression.name.text);
    }
    ts.forEachChild(child, visit);
  }

  if (node.body) visit(node.body);
  return Array.from(calls);
}

function buildCompilerEdges(functionFacts) {
  const byName = new Map();
  const byShortName = new Map();
  functionFacts.forEach((fact) => {
    byName.set(fact.name, fact);
    byShortName.set(fact.shortName, fact);
  });

  return functionFacts.flatMap((fact) =>
    fact.calls
      .map((call) => byName.get(call) ?? byShortName.get(call))
      .filter((target) => target && target.id !== fact.id)
      .map((target) => ({
        from: fact.id,
        to: target.id,
        kind: "call",
        confidence: Math.min(fact.confidence, target.confidence),
        evidence: `${fact.name}() calls ${target.name}()`,
      })),
  );
}

function collectDiagnostics(ts, program, rootNames) {
  const rootSet = new Set(rootNames.map(normalizePath));
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || rootSet.has(normalizePath(diagnostic.file.fileName)))
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      const position = diagnostic.file && typeof diagnostic.start === "number"
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : null;
      return {
        fileName: diagnostic.file?.fileName ?? "program",
        line: position ? position.line + 1 : 0,
        category: ts.DiagnosticCategory[diagnostic.category],
        code: diagnostic.code,
        message,
      };
    });
}

function functionExpressionName(ts, node, sourceFile) {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return propertyName(ts, parent.name, sourceFile);
  if (ts.isBinaryExpression(parent) && ts.isPropertyAccessExpression(parent.left)) return parent.left.name.text;
  return "";
}

function propertyName(ts, name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText(sourceFile);
}

function classOwnerName(ts, node) {
  let current = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) && current.name) return current.name.text;
    current = current.parent;
  }
  return "";
}

function scriptKindForFile(ts, file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (name.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.language === "JavaScript" || name.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isTypeScriptLike(file) {
  return ["TypeScript", "JavaScript"].includes(file.language) || /\.(tsx?|jsx?)$/i.test(file.name);
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}
