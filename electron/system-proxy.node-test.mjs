import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveSystemProxy } from "./system-proxy.mjs";
import { createSystemProxyApplier } from "./node-system-proxy.mjs";

test("system proxy changes are reflected in Node and disabled when direct", async () => {
  const env = {}, calls = [];
  const apply = createSystemProxyApplier(env, values => {
    calls.push({ ...values });
    return () => calls.push("restore");
  });
  const active = await resolveSystemProxy(async () => "PROXY 127.0.0.1:7897; DIRECT");
  assert.equal(apply(active), true);
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:7897");
  assert.equal(env.NODE_USE_ENV_PROXY, "1");
  assert.match(env.NO_PROXY, /localhost/);
  assert.match(env.NO_PROXY, /127\.0\.0\.1/);
  assert.equal(apply(await resolveSystemProxy(async () => "DIRECT")), true);
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.NODE_USE_ENV_PROXY, undefined);
  assert.ok(calls.includes("restore"));
});

test("unrecognised or malformed proxy resolutions never become proxy URLs", async () => {
  assert.deepEqual(await resolveSystemProxy(async () => "SOCKS 127.0.0.1:7890"), { http: "", https: "" });
  assert.deepEqual(await resolveSystemProxy(async () => "PROXY user:secret@localhost:8080"), { http: "", https: "" });
  const env = {}, apply = createSystemProxyApplier(env, () => () => {});
  assert.equal(apply({ http: "file:///tmp/x", https: "" }), false);
  assert.equal(env.HTTP_PROXY, undefined);
});

test("desktop proxy settings validate addresses and map modes to Chromium", async () => {
  const { validateProxySettings, chromiumProxySettings } = await import("./system-proxy.mjs");
  assert.deepEqual(chromiumProxySettings(validateProxySettings({ mode: "direct" })), { mode: "direct" });
  assert.deepEqual(chromiumProxySettings(validateProxySettings({ mode: "system" })), { mode: "system" });
  const manual = validateProxySettings({ mode: "manual", url: " http://127.0.0.1:7897 " });
  assert.equal(manual.url, "http://127.0.0.1:7897");
  assert.equal(chromiumProxySettings(manual).proxyRules, manual.url);
  for (const url of ["socks5://localhost:1080", "http://user:secret@localhost:7897", "http://localhost", "http://localhost:7897/path", "http://localhost:7897/?x=1"]) {
    assert.throws(() => validateProxySettings({ mode: "manual", url }));
  }
  assert.throws(() => validateProxySettings({ mode: "other" }));
});
