import { createRoot } from "react-dom/client";
import type { AddCloudView, RailPlace, RailState } from "../../electron/cloud-rail.mjs";
import App from "../../src/App";
import { setAnalyticsEnabled, setEmailGateDone } from "../../src/lib/analytics";
import { setAdvancedMode } from "../../src/lib/interface-mode";
import { markSimpleModePromptSeen } from "../../src/lib/simple-mode-prompt";
import { applySkin, type SkinId } from "../../src/lib/skins";
import "../../src/styles.css";

// Served only by scripts/verify-cloud-rail.ts: the real app, as a Cloud's page in the desktop window sees it, with the
// desktop bridge a hosted Cloud's page gets (its rail and add-a-Cloud sheet answered here). ?skin= picks the skin,
// ?mode=simple Simple mode, ?sheet=add|server|cloud|name opens ＋'s sheet there (?adding=setting_up: a Cloud being
// bought), ?places=many the list past eight (?more opens it).
const params = new URLSearchParams(location.search);
setAnalyticsEnabled(false);
setEmailGateDone("skipped");
markSimpleModePromptSeen();
setAdvancedMode(params.get("mode") !== "simple");
applySkin((params.get("skin") ?? "midnight") as SkinId);

const place = (id: string, name: string, extra: Partial<RailPlace> = {}): RailPlace => ({ id, name, color: null, kind: "cloud", opens: true, ...extra });
const FEW: RailPlace[] = [
  place("home", "My Cloud", { color: "blue", active: true }),
  place("a", "Client A", { color: "teal" }),
  place("b", "Bakery", { color: "orange", attention: true }),
  place("acme", "Acme team", { kind: "team", color: "purple" }),
  place("pending:c", "Client C", { color: "red", opens: false, progress: 0.55 }),
  place("mini", "Mac mini", { kind: "server" }),
];
const MANY = [...FEW, ...["Delta", "Echo Studio", "Fable", "Gamma Ltd", "Harbor"].map((name, n) => place(`x${n}`, name, { color: (["teal", "yellow", "red", "purple", "blue"] as const)[n] }))];
const rail: RailState = { places: params.get("places") === "many" ? MANY : FEW, add: { cloud: true, link: true, address: false } };
const offer = { recommended: "pro", refundDays: 14, plans: [
  { tier: "starter", label: "Starter", amount: 1500, allowances: { cpus: 2, cpuKind: "shared" as const, memoryMb: 2048, diskGb: 10, maxDiskGb: 20, computers: 15, computerHours: 100, voiceCharacters: 30_000, sleeps: true as const } },
  { tier: "pro", label: "Pro", amount: 4900, allowances: { cpus: 4, cpuKind: "shared" as const, memoryMb: 4096, diskGb: 10, maxDiskGb: 100, computers: 15, computerHours: 300, voiceCharacters: 60_000 } },
  { tier: "max", label: "Max", amount: 9900, allowances: { cpus: 8, cpuKind: "shared" as const, memoryMb: 8192, diskGb: 10, maxDiskGb: 100, computers: 15, computerHours: 800, voiceCharacters: 180_000 } },
] };
const adding = params.get("adding") === "setting_up"
  ? { adding: { name: "Client C", color: "rose" as const, tier: "pro", startedAt: Date.now(), status: "setting_up" as const, progress: 0.55, link: true as const } } : {};
const addView: AddCloudView = { signedIn: true, hasCloud: true, supported: true, canAdd: true, offer, count: 3, home: { name: "My Cloud", color: "blue" }, ...adding };
const ok = async () => {};
Object.assign(window, { ogb: {
  platform: "darwin",
  app: { version: "0.1.130", ownPage: false },
  getCapabilities: async () => ({ host: { platform: "darwin", label: "macOS", session: "unknown", packaged: true }, windowChrome: "mac-inset",
    screenPreview: { available: false, interaction: "none" }, dictation: { available: false, engine: "none", onDevice: false },
    localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" } }),
  onCapabilitiesChanged: () => () => {},
  applySkin: ok, setUnreadCount: () => {}, permStatus: async () => ({}),
  workspaces: {
    state: async () => ({ local: false, name: "My Cloud", origin: "https://omb-u-1.fly.dev", color: "blue" }),
    menu: ok, line: async () => null, places: async () => rail, open: ok, add: ok, onChanged: () => () => {},
  },
  cloudAdd: { state: async () => addView, start: async () => ({ outcome: "opened" }), reopen: async () => true, copyLink: async () => true, open: ok, interest: ok, sheet: ok },
} });

createRoot(document.getElementById("root")!).render(<App />);

// The macOS window's traffic lights, drawn where the system draws them, so the picture shows what sits beside them.
const lights = document.createElement("div");
lights.setAttribute("aria-hidden", "true");
lights.style.cssText = "position:fixed;left:16px;top:17px;display:flex;gap:8px;z-index:100;pointer-events:none";
for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
  const dot = document.createElement("span");
  dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};display:block`;
  lights.append(dot);
}
document.body.append(lights);

const click = (selector: string) => new Promise<void>((resolve) => {
  const tick = () => { const target = document.querySelector<HTMLElement>(selector); if (target) { target.click(); resolve(); } else setTimeout(tick, 100); };
  tick();
});
const sheet = params.get("sheet");
if (sheet) void click("[data-rail-add]").then(() => (sheet === "server" ? click('[data-place-add-choice="server"]') : sheet === "add" ? undefined : click('[data-place-add-choice="cloud"]')))
  .then(() => (sheet === "name" ? click("[data-plan-buy='pro']") : undefined));
if (params.has("more")) void click("[data-rail-more-button]");
