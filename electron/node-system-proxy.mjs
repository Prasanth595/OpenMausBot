import { setGlobalProxyFromEnv } from "node:http";
import os from "node:os";

/** Reconfigure Node's fetch and HTTP agents; subprocesses inherit the same settings. */
export function createSystemProxyApplier(env = process.env, setProxy = setGlobalProxyFromEnv) {
  let restore = () => {};
  return (proxy) => {
    if (!proxy || typeof proxy.http !== "string" || typeof proxy.https !== "string") return false;
    for (const value of [proxy.http, proxy.https]) {
      if (!value) continue;
      try { const url = new URL(value); if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/") return false; }
      catch { return false; }
    }
    restore();
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy", "NODE_USE_ENV_PROXY"]) delete env[key];
    const localIps = Object.values(os.networkInterfaces()).flatMap(interfaces => (interfaces ?? []).map(entry => entry.address));
    env.NO_PROXY = ["localhost", "127.0.0.1", "[::1]", ".local", ...localIps].join(",");
    if (proxy.http) env.HTTP_PROXY = proxy.http;
    if (proxy.https) env.HTTPS_PROXY = proxy.https;
    if (proxy.http || proxy.https) env.NODE_USE_ENV_PROXY = "1";
    restore = setProxy(env);
    return true;
  };
}
