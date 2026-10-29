/** Chromium reads the OS proxy configuration, including whether the proxy is enabled. */
export function httpProxyFromResolution(resolution) {
  const first = String(resolution || "").split(";")[0].trim();
  const match = /^PROXY\s+([^\s/]+)$/i.exec(first);
  if (!match) return undefined;
  try {
    const url = new URL(`http://${match[1]}`);
    if (!url.hostname || !url.port || url.username || url.password || url.pathname !== "/") return undefined;
    return url.origin;
  } catch { return undefined; }
}

export async function resolveSystemProxy(resolve) {
  async function forUrl(url) {
    try { return httpProxyFromResolution(await resolve(url)) ?? ""; } catch { return ""; }
  }
  const [http, https] = await Promise.all([
    forUrl("http://example.com/"), forUrl("https://example.com/"),
  ]);
  return { http, https };
}

/** Validate a desktop-only proxy choice. Credentials and non-HTTP proxies are intentionally unsupported. */
export function validateProxySettings(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid proxy settings");
  if (input.mode === "system" || input.mode === "direct") return { mode: input.mode, url: "" };
  if (input.mode !== "manual" || typeof input.url !== "string") throw new Error("Invalid proxy settings");
  let url;
  try { url = new URL(input.url.trim()); } catch { throw new Error("Invalid proxy address"); }
  if (url.protocol !== "http:" || !url.hostname || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid proxy address");
  return { mode: "manual", url: url.origin };
}

export function chromiumProxySettings(settings) {
  if (settings.mode === "direct") return { mode: "direct" };
  if (settings.mode === "manual") return { mode: "fixed_servers", proxyRules: settings.url, proxyBypassRules: "<local>;127.0.0.1;[::1]" };
  return { mode: "system" };
}
