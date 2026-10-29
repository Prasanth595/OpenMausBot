import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createDesktopProxy } from "./desktop-proxy.mjs";

test("desktop proxy saves a validated choice and prepares the server environment", async () => {
  const handlers = new Map(), configured = [], applied = [];
  let saved;
  const desktopProxy = createDesktopProxy({
    app: { getPath: () => "/tmp/test-user-data" },
    session: { defaultSession: {
      setProxy: async settings => configured.push(settings),
      resolveProxy: async () => "PROXY 127.0.0.1:7897; DIRECT",
    } },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    localOnly: (_channel, handler) => handler,
    jsonFile: () => ({ read: () => saved, write: value => { saved = value; } }),
    log: () => {},
    applyNodeProxy: proxy => applied.push(proxy),
  });
  assert.deepEqual(handlers.get("desktop-proxy:read")(), { mode: "direct", url: "" });
  await desktopProxy.configure();
  assert.deepEqual(configured[0], { mode: "direct" });
  assert.throws(() => handlers.get("desktop-proxy:save")(null, { mode: "manual", url: "socks5://localhost:1080" }));
  handlers.get("desktop-proxy:save")(null, { mode: "manual", url: "http://localhost:7897" });
  await desktopProxy.configure();
  assert.equal(configured[1].proxyRules, "http://localhost:7897");
  const env = { HTTP_PROXY: "http://old:8080", ALL_PROXY: "socks://old:1080" };
  const proxy = await desktopProxy.prepareChild(env);
  assert.deepEqual(proxy, { http: "http://127.0.0.1:7897", https: "http://127.0.0.1:7897" });
  assert.equal(env.HTTP_PROXY, undefined);
  assert.equal(env.ALL_PROXY, undefined);
  assert.deepEqual(JSON.parse(env.OMB_SYSTEM_PROXY), proxy);
  assert.deepEqual(applied, [proxy]);
});
