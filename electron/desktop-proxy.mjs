import path from "node:path";
import { createSystemProxyApplier } from "./node-system-proxy.mjs";
import { chromiumProxySettings, resolveSystemProxy, validateProxySettings } from "./system-proxy.mjs";

export function createDesktopProxy({ app, session, ipcMain, localOnly, jsonFile, log, applyNodeProxy = createSystemProxyApplier() }) {
  const store = () => jsonFile(path.join(app.getPath("userData"), "proxy-settings.json"));
  function read() {
    try { return validateProxySettings(store().read()); }
    catch { return { mode: "direct", url: "" }; }
  }
  ipcMain.handle("desktop-proxy:read", localOnly("desktop-proxy:read", () => read()));
  ipcMain.handle("desktop-proxy:save", localOnly("desktop-proxy:save", (_event, input) => {
    const settings = validateProxySettings(input);
    store().write(settings);
    return settings;
  }));
  const resolve = () => resolveSystemProxy(url => session.defaultSession.resolveProxy(url));
  async function prepareChild(env) {
    const proxy = await resolve();
    applyNodeProxy(proxy);
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy", "NODE_USE_ENV_PROXY"]) delete env[key];
    env.OMB_SYSTEM_PROXY = JSON.stringify(proxy);
    return proxy;
  }
  function monitor(proc, initial) {
    let state = JSON.stringify(initial);
    const timer = setInterval(async () => {
      try {
        const next = await resolve();
        const encoded = JSON.stringify(next);
        if (encoded !== state) {
          applyNodeProxy(next);
          proc.postMessage({ type: "openmausbot:system-proxy", proxy: next });
          state = encoded;
        }
      } catch (error) { log(`system proxy refresh failed: ${error?.message ?? error}`); }
    }, 10_000);
    timer.unref?.();
    proc.once("exit", () => clearInterval(timer));
  }
  return { prepareChild, monitor, configure: () => session.defaultSession.setProxy(chromiumProxySettings(read())) };
}
