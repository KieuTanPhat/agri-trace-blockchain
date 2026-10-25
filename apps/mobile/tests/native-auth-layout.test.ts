import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Source regression checks for the scoped mounting workaround, not an Android
// renderer simulation. Native login/logout still needs device verification.
test("auth form and account branches keep explicit native boundaries and distinct identities", () => {
  const account = readFileSync(new URL("../app/(tabs)/account.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("../src/auth/auth-scaffold.tsx", import.meta.url), "utf8");
  assert.match(account, /key=\{`profile-\$\{auth\.profile\.id\}`\} stableNativeChildren/);
  assert.match(account, /key="guest" stableNativeChildren/);
  assert.match(form, /<Card stableNativeChildren/);
});

test("button loading updates preserve keyed native slot boundaries", () => {
  const ui = readFileSync(new URL("../src/components/ui.tsx", import.meta.url), "utf8");
  assert.match(ui, /<Pressable\s+collapsable=\{false\}\s+collapsableChildren=\{false\}/);
  for (const slot of ["background", "leading", "trailing"])
    assert.match(ui, new RegExp(`<View key="${slot}" collapsable=\\{false\\}`));
  assert.match(ui, /<Text\s+key="label"/);
  const source = ts.createSourceFile("ui.tsx", ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let checked = false;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "Pressable") {
      const children = node.children.filter(child => !ts.isJsxText(child) || child.text.trim());
      assert.equal(children.length, 4);
      assert.ok(children.every(ts.isJsxElement), "busy must not insert/remove direct native children");
      checked = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(checked, true);
});
