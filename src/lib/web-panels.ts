// Pinned web panels: a few pages (a local dashboard, a CI page) the person
// keeps one click away in the sidebar. Renderer-only data — no bot sees it,
// no server stores it. Only plain http(s) pages without credentials are
// accepted, because the URL is framed in the app and handed to the browser.

export interface WebPanel {
  id: string;
  name: string;
  url: string;
}

export const MAX_WEB_PANELS = 6;
export const MAX_WEB_PANEL_NAME = 40;

export type WebPanelInput = { name: string; url: string };
export type WebPanelCheck =
  | { ok: true; name: string; url: string }
  | { ok: false; error: "name" | "url" };

/** A trimmed name of 1–40 characters and an absolute http(s) URL with no
 * user name or password in it. */
export function validateWebPanel(input: WebPanelInput): WebPanelCheck {
  const name = input.name.trim();
  if (!name || name.length > MAX_WEB_PANEL_NAME) return { ok: false, error: "name" };
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    return { ok: false, error: "url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: "url" };
  if (parsed.username || parsed.password || !parsed.hostname) return { ok: false, error: "url" };
  return { ok: true, name, url: parsed.href };
}

/** The stored list, keeping only entries that still validate, at most six.
 * Never throws: a corrupt value reads as no panels. */
export function parseWebPanels(raw: string | null | undefined): WebPanel[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const panels: WebPanel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (panels.length >= MAX_WEB_PANELS) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, name, url } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id) || typeof name !== "string" || typeof url !== "string") continue;
    const check = validateWebPanel({ name, url });
    if (!check.ok) continue;
    seen.add(id);
    panels.push({ id, name: check.name, url: check.url });
  }
  return panels;
}

export function newWebPanelId(existing: readonly WebPanel[]): string {
  let n = existing.length + 1;
  const taken = new Set(existing.map((panel) => panel.id));
  while (taken.has(`panel-${n}`)) n++;
  return `panel-${n}`;
}
