import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Exercise the installed router, not an Android renderer. This guards against
// duplicate tab navigators; native addViewAt still needs device acceptance.
const require = createRequire(import.meta.url);
const { StackRouter } = require("expo-router/build/react-navigation/routers/StackRouter");
const options = {
  routeNames: ["(tabs)", "login", "register"],
  routeParamList: {},
  routeGetIdList: {},
};
function fixture(initialRouteName = "(tabs)") {
  const router = StackRouter({ initialRouteName });
  return { router, state: router.getInitialState(options) };
}
const account = { name: "(tabs)", params: { screen: "account" } };

for (const flow of [["login"], ["login", "register"]]) {
  test(`successful ${flow.join(" → ")} returns to the existing tabs key`, () => {
    const { router, state: initial } = fixture();
    const originalKey = initial.routes[0].key;
    let state = initial;
    for (const name of flow)
      state = router.getStateForAction(state, { type: "PUSH", payload: { name } }, options);
    const result = router.getStateForAction(state, { type: "POP_TO", payload: account }, options);
    assert.equal(result.routes.length, 1);
    assert.equal(result.routes[0].name, "(tabs)");
    assert.equal(result.routes[0].key, originalKey);
    assert.equal(result.routes[0].params.screen, "account");
    assert.equal(result.index, 0);
  });
}

test("direct login entry falls back to one tabs route without retaining the form", () => {
  const { router, state } = fixture("login");
  const result = router.getStateForAction(state, { type: "POP_TO", payload: account }, options);
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].name, "(tabs)");
  assert.equal(result.routes[0].params.screen, "account");
});

test("old replace action demonstrates why replacing login duplicates the tabs", () => {
  const { router, state } = fixture();
  const login = router.getStateForAction(state, { type: "PUSH", payload: { name: "login" } }, options);
  const result = router.getStateForAction(login, { type: "REPLACE", payload: account }, options);
  assert.deepEqual(result.routes.map((route: { name: string }) => route.name), ["(tabs)", "(tabs)"]);
  assert.notEqual(result.routes[0].key, result.routes[1].key);
});

test("login and registration success use the explicit dismiss-to-account route", () => {
  for (const file of ["dev-login-screen.tsx", "dev-auth-flow.tsx"]) {
    const source = readFileSync(new URL(`../src/auth/${file}`, import.meta.url), "utf8");
    assert.match(source, /router\.dismissTo\("\/\(tabs\)\/account"\)/);
    assert.doesNotMatch(source, /router\.replace\("\/account"\)/);
  }
});

test("login navigates from a deferred focused effect, never directly in submit", () => {
  const source = readFileSync(new URL("../src/auth/dev-login-screen.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("login.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let checked = false;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") {
      assert.doesNotMatch(node.getText(ast), /router\./);
      assert.match(node.getText(ast), /setPassword\(""\)/);
      checked = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(checked);
  assert.match(source, /return deferAuthNavigation\(/);
  assert.match(source, /demoSession\.snapshot\(\)\.status === "authenticated"/);
  assert.match(source, /authenticated \? "Đang mở tài khoản…"/);
  assert.doesNotMatch(source, /"Vào tài khoản"/);
});
