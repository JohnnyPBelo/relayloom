import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import {
  getLanguage,
  resolveLanguage,
  setLanguage,
  translate,
} from "../apps/web/src/i18n/core";
import { messageRows, messages } from "../apps/web/src/i18n/messages";

test("language variants resolve to supported choices and invalid selection preserves the current language", () => {
  assert.equal(resolveLanguage("pt-BR"), "pt-PT");
  assert.equal(resolveLanguage("en-US"), "en-GB");
  assert.equal(resolveLanguage("es-MX"), "es-ES");
  assert.equal(resolveLanguage("fr-FR"), undefined);
  assert.equal(resolveLanguage(12 as any), undefined);
  const before = getLanguage();
  assert.throws(() => setLanguage("fr-FR"));
  assert.equal(getLanguage(), before);
});
test("context and interpolation preserve raw names without recursively translating parameters", () => {
  assert.equal(translate("Páginas", {}, "en-GB"), "Sites");
  assert.equal(translate("Páginas", {}, "en-GB", "studio"), "Pages");
  assert.equal(translate("Páginas", {}, "pt-PT", "studio"), "Páginas");
  assert.equal(
    translate("Convite de {name}", { name: "Guardar {count}" }, "en-GB"),
    "Invitation from Guardar {count}",
  );
  assert.equal(translate("__proto__", {}, "en-GB"), "__proto__");
  assert.equal(
    translate("an unknown diagnostic", {}, "es-ES"),
    "an unknown diagnostic",
  );
});
test("every catalog entry is unique, nonempty and retains all named parameters in both languages", () => {
  const seen = new Set<string>(),
    parameters = (s: string) =>
      [
        ...new Set(
          [...s.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]),
        ),
      ].sort();
  for (const [source, en, es] of messageRows) {
    assert.ok(!seen.has(source), "duplicate source: " + source);
    seen.add(source);
    assert.ok(en.trim() && es.trim(), "empty translation: " + source);
    for (const translated of [en, es])
      assert.deepEqual(
        parameters(translated),
        parameters(source),
        "missing parameter: " + source,
      );
  }
  assert.equal(Object.keys(messages).length, seen.size);
});
test("literal UI lookups and state-label maps all have catalog entries", () => {
  const missing: string[] = [];
  function keys(n: ts.Node): string[] {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
      return [n.text];
    if (ts.isConditionalExpression(n))
      return [...keys(n.whenTrue), ...keys(n.whenFalse)];
    if (ts.isParenthesizedExpression(n)) return keys(n.expression);
    return [];
  }
  function file(p: string) {
    const sf = ts.createSourceFile(
      p,
      readFileSync(p, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      p.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function check(key: string, node: ts.Node) {
      if (!Object.hasOwn(messages, key))
        missing.push(
          p +
            ":" +
            (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1) +
            " " +
            key,
        );
    }
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n)) {
        const fn = n.expression.getText(sf);
        if (fn === "t" && n.arguments[0])
          for (const key of keys(n.arguments[0])) check(key, n);
        if (
          fn === "tc" &&
          n.arguments.length >= 2 &&
          ts.isStringLiteral(n.arguments[0])
        )
          for (const key of keys(n.arguments[1]))
            check(n.arguments[0].text + "::" + key, n);
      }
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        ["labels", "groupStatus"].includes(n.name.text) &&
        n.initializer &&
        ts.isObjectLiteralExpression(n.initializer)
      )
        for (const prop of n.initializer.properties)
          if (ts.isPropertyAssignment(prop))
            for (const key of keys(prop.initializer)) check(key, n);
      ts.forEachChild(n, visit);
    }
    visit(sf);
  }
  function directory(p: string) {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const child = p + "/" + e.name;
      if (e.isDirectory()) {
        if (e.name !== "i18n") directory(child);
      } else if (/\.tsx?$/.test(e.name)) file(child);
    }
  }
  directory("apps/web/src");
  assert.deepEqual(missing, []);
});
