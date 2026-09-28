import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guards the Server -> Client Component boundary, which `tsc` and `next build`
 * do not check: a Server Component may pass a Client Component only
 * serializable props (data, JSX, Server Actions). Passing a function, a class
 * or a component such as a lucide icon compiles fine but fails at render time
 * ("Functions cannot be passed directly to Client Components ...").
 *
 * This walks every Server Component with the TypeScript AST and flags props
 * given to Client Components that are:
 *  - inline functions (arrow / function expressions),
 *  - functions or components declared in the same file,
 *  - identifiers imported from lucide-react or from any module that is not a
 *    "use server" module (Server Actions are the one allowed function).
 * `serverAction.bind(null, id)` is allowed.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");

type Kind = "client" | "server-actions" | "other";
type Origin = Kind | "lucide" | "package";

interface Violation {
  file: string;
  line: number;
  component: string;
  prop: string;
  reason: string;
}

function listTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return listTsx(full);
    return /\.(tsx|ts)$/.test(name) ? [full] : [];
  });
}

function directive(source: ts.SourceFile): string | null {
  const first = source.statements[0];
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) return first.expression.text;
  return null;
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // package
  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Analyses in-memory sources (path -> code) so fixtures can be tested too.
 * `originOf` says what an import specifier points at from a given file.
 */
export function findBoundaryViolations(files: Map<string, string>, originOf: (fromFile: string, spec: string) => Origin): Violation[] {
  const violations: Violation[] = [];

  for (const [file, code] of files) {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    if (directive(source) === "use client" || !file.endsWith(".tsx")) continue;

    // Local name -> where it comes from.
    const imports = new Map<string, { module: string; kind: Origin }>();
    const localFunctions = new Set<string>();
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const spec = statement.moduleSpecifier.text;
        const kind = originOf(file, spec);
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly) continue;
        if (clause.name) imports.set(clause.name.text, { module: spec, kind });
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) if (!el.isTypeOnly) imports.set(el.name.text, { module: spec, kind });
        }
      }
      if (ts.isFunctionDeclaration(statement) && statement.name) localFunctions.add(statement.name.text);
      if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            localFunctions.add(decl.name.text);
          }
        }
      }
    }

    const check = (tag: ts.JsxTagNameExpression, attributes: ts.JsxAttributes) => {
      if (!ts.isIdentifier(tag)) return;
      const target = imports.get(tag.text);
      if (!target || target.kind !== "client") return;

      for (const attr of attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer || !ts.isJsxExpression(attr.initializer)) continue;
        const expr = attr.initializer.expression;
        if (!expr) continue;
        const prop = attr.name.getText(source);
        const flag = (reason: string) =>
          violations.push({
            file: path.relative(ROOT, file),
            line: source.getLineAndCharacterOfPosition(attr.getStart()).line + 1,
            component: tag.text,
            prop,
            reason,
          });

        if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
          flag("inline function");
        } else if (ts.isIdentifier(expr)) {
          const origin = imports.get(expr.text);
          if (localFunctions.has(expr.text)) flag("function declared in this Server Component");
          else if (origin?.kind === "lucide") flag("icon component (lucide-react)");
          else if (origin && origin.kind !== "server-actions" && origin.kind !== "client" && /^[A-Z][a-z]/.test(expr.text)) {
            flag(`component or class imported from ${origin.module}`);
          } else if (origin && origin.kind === "other" && /^[a-z]/.test(expr.text)) {
            flag(`function imported from ${origin.module} (not a Server Action)`);
          }
        } else if (
          ts.isCallExpression(expr) &&
          ts.isPropertyAccessExpression(expr.expression) &&
          expr.expression.name.text === "bind" &&
          ts.isIdentifier(expr.expression.expression)
        ) {
          const origin = imports.get(expr.expression.expression.text);
          if (origin?.kind !== "server-actions") flag(".bind() on something that is not a Server Action");
        }
      }
    };

    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node)) check(node.tagName, node.attributes);
      else if (ts.isJsxOpeningElement(node)) check(node.tagName, node.attributes);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return violations;
}

function originFromDisk(fromFile: string, spec: string): Origin {
  if (spec === "lucide-react") return "lucide";
  const resolved = resolveImport(fromFile, spec);
  if (!resolved) return "package";
  const source = ts.createSourceFile(resolved, readFileSync(resolved, "utf8"), ts.ScriptTarget.Latest, true);
  const d = directive(source);
  return d === "use client" ? "client" : d === "use server" ? "server-actions" : "other";
}

describe("Server -> Client Component boundary", () => {
  it("no Server Component passes functions, classes or icon components to a Client Component", () => {
    const files = new Map(listTsx(SRC).map((f) => [f, readFileSync(f, "utf8")]));
    const violations = findBoundaryViolations(files, originFromDisk);
    expect(violations.map((v) => `${v.file}:${v.line} <${v.component} ${v.prop}={...}> - ${v.reason}`)).toEqual([]);
  });

  it("catches the goods-receipt bug pattern and allows Server Actions and data", () => {
    const page = path.join(SRC, "__fixture__", "page.tsx");
    const origins = new Map<string, Origin>([
      ["lucide-react", "lucide"],
      ["./form", "client"],
      ["./actions", "server-actions"],
      ["./helpers", "other"],
    ]);
    const code = `
      import { RotateCcw } from "lucide-react";
      import { Form } from "./form";
      import { reverseReceipt, save } from "./actions";
      import { formatValue, EMPTY_VALUES } from "./helpers";
      function localHandler() {}
      export default function Page() {
        return (
          <>
            <Form triggerIcon={RotateCcw} action={reverseReceipt.bind(null, "id")} />
            <Form onPick={() => 1} onSave={save} data={{ a: 1 }} icon="reverse" initialValues={EMPTY_VALUES} />
            <Form onChange={localHandler} format={formatValue} bad={formatValue.bind(null)} />
          </>
        );
      }`;
    const found = findBoundaryViolations(new Map([[page, code]]), (_from, spec) => origins.get(spec) ?? "package");
    expect(found.map((v) => `${v.prop}: ${v.reason}`)).toEqual([
      "triggerIcon: icon component (lucide-react)",
      "onPick: inline function",
      "onChange: function declared in this Server Component",
      "format: function imported from ./helpers (not a Server Action)",
      "bad: .bind() on something that is not a Server Action",
    ]);
  });
});
