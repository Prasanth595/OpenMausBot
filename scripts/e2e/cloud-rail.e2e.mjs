#!/usr/bin/env node
// E1: the rail of places (PR #3725) end to end, in the real desktop app driven by Playwright.
//
// Linux only (GitHub Actions, or a disposable Linux box): it launches Electron, which never runs on a developer's Mac.
//   xvfb-run -a --server-args="-screen 0 1600x1000x24" node scripts/e2e/cloud-rail.e2e.mjs
// Needs `pnpm exec vite build && pnpm build:server` (the app's page and server) and, for the two local servers,
// `node scripts/build-npm-package.mjs` (the package a self-hoster installs).
//
// OMB_E2E_SERVERS='[{"label":"Test server A","pairLink":"https://…/pair#code=…"},{…}]' uses two servers of the
// caller's (each link is single use and lasts 5 minutes); without it two are started here with
// `openmausbot serve --no-pair` and their links minted with `openmausbot pair --label …` just before use.
// OMB_E2E_OUT (default /tmp/e2e-out) receives the screenshots, report.json and the logs.
//
// The app is the stock Electron binary renamed `openmausbot`, with resources/{app,ui,server,skills} laid out as the
// installer lays them out, so `app.isPackaged` is true and it starts its own server child like the shipped app. Its
// HOME, user data and data folder are fresh temporary folders: nothing of the machine it runs on is read.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
  console.error("cloud-rail.e2e: Linux only. It launches the desktop app, which must not run on a developer's computer.");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright-core");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(process.env.OMB_E2E_OUT || "/tmp/e2e-out");
const WORK = mkdtempSync(join(tmpdir(), "omb-e2e-rail-"));
const KEEP = process.env.OMB_E2E_KEEP === "1";
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const PRODUCT = "OpenMausBot";
const DEVICE_LABEL = "E1 rail e2e";
const SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
/** The rail shows at this width and up (Tailwind md); below it the switcher stays. */
const RAIL_BREAKPOINT = 768;
/** Analytics never leaves the app: its own switch is off, and these hosts do not resolve for Chromium either. */
const BLOCKED_HOSTS = ["us.i.posthog.com", "us-assets.i.posthog.com", "app.posthog.com", "*.posthog.com"];
const FIRST_RUN_DONE = {
  profile: { name: "E1 Tester" },
  onboarding: { completedAt: "2026-10-01T00:00:00.000Z", version: 1, reelSeen: true, hintsSeen: ["met-chief-v1", "onboarding-cloud-v1"] },
};

mkdirSync(join(OUT, "logs"), { recursive: true });
for (const entry of readdirSync(OUT)) if (entry.endsWith(".png") || entry === "report.json") rmSync(join(OUT, entry), { force: true });

const report = {
  name: "E1 rail of places (PR #3725)",
  startedAt: new Date().toISOString(),
  commit: git(["rev-parse", "HEAD"]),
  branch: process.env.GITHUB_REF_NAME || git(["rev-parse", "--abbrev-ref", "HEAD"]),
  run: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  electron: require("electron/package.json").version,
  playwright: require("playwright-core/package.json").version,
  mode: process.env.OMB_E2E_SERVERS ? "remote servers (OMB_E2E_SERVERS)" : "two local servers",
  servers: [],
  scenarios: [],
  findings: [],
  dialogs: [],
  externalOpens: [],
};
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const writeReport = () => writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");

function git(args) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word) => (word ? Array.from(word)[0] ?? "" : "");
  return (first(words[0]) + (words.length > 1 ? first(words[1]) : "")).toLocaleUpperCase();
}

// ── The two servers ─────────────────────────────────────────────────────────────────────────────────────────────

function portFree(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
  });
}

/** A port and the next one (the server's webhook port) both free. */
async function freePort(from) {
  for (let port = from; port < from + 400; port += 2) if (await portFree(port) && await portFree(port + 1)) return port;
  throw new Error(`no two free ports from ${from}`);
}

/** A loopback port nothing listens on: the connected-apps service everything here is pointed at, so none is reached. */
async function closedPort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, "127.0.0.1", done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

async function getJson(url, timeoutMs = 5_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/** The npm package a self-hoster runs (`npx openmausbot`), packed and unpacked as npm does. */
function npmPackage() {
  if (process.env.OMB_E2E_PACKAGE_DIR) return resolve(process.env.OMB_E2E_PACKAGE_DIR);
  const built = join(ROOT, "release", "npm");
  if (!existsSync(join(built, "package.json"))) throw new Error("release/npm is missing: run `node scripts/build-npm-package.mjs` after `pnpm build:server && pnpm exec vite build`");
  const packed = join(WORK, "npm");
  mkdirSync(packed, { recursive: true });
  const tarball = execFileSync("npm", ["pack", "--silent", "--pack-destination", packed], { cwd: built, encoding: "utf8" }).trim().split("\n").pop();
  execFileSync("tar", ["-xzf", join(packed, tarball), "-C", packed]);
  return join(packed, "package");
}

const serverProcs = [];

async function startLocalServer(cli, { key, label, port, brokerPort }) {
  const home = join(WORK, `server-${key}`, "home");
  const dataDir = join(WORK, `server-${key}`, "data");
  mkdirSync(home, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  // Past its own first run, as a server someone set up and then paired this computer with.
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(FIRST_RUN_DONE, null, 2));
  const env = {
    PATH: SYSTEM_PATH, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local", "share"),
    LANG: "en_US.UTF-8", TZ: "UTC", OMB_WEBHOOK_PORT: String(port + 1),
    // Nothing reaches a production service: no connected-apps service, no HighLevel relay (analytics is the page's own).
    OMB_COMPOSIO_BROKER_URL: `http://127.0.0.1:${brokerPort}`, OMB_HIGHLEVEL_RELAY_URL: "off",
  };
  const out = createWriteStream(join(OUT, "logs", `server-${key}.log`));
  // Its own process group, so stopping it by this PID stops the server process it supervises too.
  const child = spawn(process.execPath, [join(cli, "cli.js"), "serve", "--no-pair", "--port", String(port), "--data-dir", dataDir, "--label", label],
    { cwd: home, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  serverProcs.push(child);
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    if (child.exitCode !== null) throw new Error(`server ${key} exited (${child.exitCode}); see logs/server-${key}.log`);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok) break; } catch {}
    if (attempt > 180) throw new Error(`server ${key} did not answer on ${origin}`);
    await delay(500);
  }
  const environment = await getJson(`${origin}/.well-known/openmausbot/environment`);
  return {
    key, label, origin, environmentId: environment.environmentId, serverLabel: environment.label, version: environment.version, source: "local",
    /** A fresh single-use link, minted just before it is used: a code lasts five minutes. */
    pairLink() {
      const minted = spawnSync(process.execPath, [join(cli, "cli.js"), "pair", "--label", DEVICE_LABEL, "--port", String(port)],
        { cwd: home, env: { ...env, OMB_PORT: String(port) }, encoding: "utf8" });
      const link = /this computer:\s+(\S+)/.exec(minted.stdout)?.[1];
      if (minted.status !== 0 || !link) throw new Error(`openmausbot pair failed for ${key}: ${minted.stdout}${minted.stderr}`);
      return link;
    },
    /** Its paired devices, as `openmausbot sessions` reads them on that machine. */
    sessions: () => getJson(`${origin}/api/auth/sessions`).then((body) => body.sessions ?? []),
  };
}

async function provideServers(brokerPort) {
  const raw = process.env.OMB_E2E_SERVERS?.trim();
  if (raw) {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length !== 2) throw new Error("OMB_E2E_SERVERS must list exactly two servers");
    return Promise.all(list.map(async (entry, index) => {
      const link = new URL(String(entry.pairLink));
      if (!/(?:^#|&)code=/.test(link.hash)) throw new Error(`server ${index + 1}: the pairing link needs its #code=`);
      const environment = await getJson(`${link.origin}/.well-known/openmausbot/environment`, 15_000);
      let used = false;
      return {
        key: index === 0 ? "a" : "b", label: String(entry.label || `Test server ${index === 0 ? "A" : "B"}`).trim().slice(0, 60), origin: link.origin,
        environmentId: environment.environmentId, serverLabel: environment.label, version: environment.version, source: "remote",
        pairLink() {
          if (used) throw new Error(`the pairing link for ${link.origin} was already used`);
          used = true;
          return link.href;
        },
        sessions: null,
      };
    }));
  }
  const cli = npmPackage();
  const portA = await freePort(18811);
  const portB = await freePort(portA + 10);
  return [
    await startLocalServer(cli, { key: "a", label: "Server A", port: portA, brokerPort }),
    await startLocalServer(cli, { key: "b", label: "Server B", port: portB, brokerPort }),
  ];
}

async function stopServers() {
  for (const child of serverProcs) if (child.exitCode === null && child.pid) try { process.kill(-child.pid, "SIGTERM"); } catch {}
  for (const child of serverProcs) {
    for (let i = 0; i < 40 && child.exitCode === null; i++) await delay(250);
    if (child.exitCode === null && child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
}

// ── The app ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The installed layout: Electron under the app's own name, resources/app (package.json and electron/**, as
 * electron-builder packs them), resources/ui (the page), resources/server (the server bundle), resources/skills. */
function stageApp() {
  for (const [dir, what] of [["dist", "the page (pnpm exec vite build)"], ["dist-server", "the server (pnpm build:server)"]]) {
    if (!existsSync(join(ROOT, dir))) throw new Error(`${dir} is missing: build ${what} first`);
  }
  const binary = require("electron");
  const appDir = join(WORK, "app");
  cpSync(dirname(binary), appDir, { recursive: true, verbatimSymlinks: true });
  renameSync(join(appDir, basename(binary)), join(appDir, "openmausbot"));
  const resources = join(appDir, "resources");
  rmSync(join(resources, "default_app.asar"), { force: true });
  const app = join(resources, "app");
  mkdirSync(app, { recursive: true });
  const { name, version, description, homepage, author, license, desktopName, main, type } = PKG;
  writeFileSync(join(app, "package.json"), JSON.stringify({ name, productName: PRODUCT, version, description, homepage, author, license, desktopName, main, type }, null, 2));
  cpSync(join(ROOT, "electron"), join(app, "electron"), { recursive: true, filter: (source) => !/\.(?:node-)?test\.[cm]?js$/.test(source) });
  cpSync(join(ROOT, "dist"), join(resources, "ui"), { recursive: true });
  cpSync(join(ROOT, "dist-server"), join(resources, "server"), { recursive: true });
  cpSync(join(ROOT, "skills"), join(resources, "skills"), { recursive: true });
  if (existsSync(join(ROOT, "dist-companion"))) cpSync(join(ROOT, "dist-companion"), join(resources, "companion"), { recursive: true });
  return join(appDir, "openmausbot");
}

const DIRS = {
  home: join(WORK, "desktop", "home"),
  config: join(WORK, "desktop", "config"),
  data: join(WORK, "desktop", "data"),
  runtime: join(WORK, "desktop", "runtime"),
};
DIRS.userData = join(DIRS.config, PRODUCT);

/** A person past the first run who answered its questions (analytics off, no product emails), with no places yet. */
function seedDesktop() {
  for (const dir of Object.values(DIRS)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(DIRS.userData, "desktop-prefs.json"), JSON.stringify({
    seen: ["cloud-pro-update-2026-10"], shown: {}, analytics: false, language: "en",
    updatesConsent: { status: "declined", version: "2026-10-23", at: Date.parse("2026-10-01T00:00:00Z") },
  }));
  writeFileSync(join(DIRS.data, "config.json"), JSON.stringify(FIRST_RUN_DONE, null, 2));
}

function appEnv(brokerPort) {
  const passed = ["DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS"].filter((key) => process.env[key]);
  return {
    ...Object.fromEntries(passed.map((key) => [key, process.env[key]])),
    PATH: SYSTEM_PATH, HOME: DIRS.home, XDG_CONFIG_HOME: DIRS.config, XDG_CACHE_HOME: join(DIRS.home, ".cache"), XDG_DATA_HOME: join(DIRS.home, ".local", "share"),
    XDG_RUNTIME_DIR: DIRS.runtime, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "UTC",
    OMB_DATA_DIR: DIRS.data, OMB_LINUX_GPU: "off",
    OMB_COMPOSIO_BROKER_URL: `http://127.0.0.1:${brokerPort}`, OMB_HIGHLEVEL_RELAY_URL: "off",
  };
}

let launches = 0;
async function launchApp(binary, brokerPort, knownLocalOrigin = null) {
  launches += 1;
  const electronApp = await electron.launch({
    executablePath: binary,
    args: ["--password-store=basic", "--disable-dev-shm-usage", "--lang=en-US", `--host-resolver-rules=${BLOCKED_HOSTS.map((host) => `MAP ${host} ~NOTFOUND`).join(", ")}`],
    env: appEnv(brokerPort),
    cwd: DIRS.home,
    timeout: 120_000,
  });
  const out = createWriteStream(join(OUT, "logs", `app-launch-${launches}.log`));
  electronApp.process().stdout?.pipe(out);
  electronApp.process().stderr?.pipe(out);
  await answerNativeDialogs(electronApp);
  const page = await mainPage(electronApp);
  page.setDefaultTimeout(30_000);
  await waitForApp(page, "the first page");
  const windowId = await (await electronApp.browserWindow(page)).evaluate((w) => w.id);
  // This app's own page: the one its preload calls its own. A window that reopens on a server's page keeps the address
  // this computer's page had before.
  const ownPage = await page.evaluate(() => window.ogb?.app?.ownPage === true);
  const localOrigin = ownPage ? new URL(page.url()).origin : knownLocalOrigin;
  if (!localOrigin) throw new Error(`the app opened on ${page.url()}, and this computer's own page is not known yet`);
  await electronApp.evaluate(({ BrowserWindow }, id) => { const w = BrowserWindow.fromId(id); w.setBounds({ x: 40, y: 30, width: 1440, height: 900 }); w.show(); w.focus(); }, windowId);
  await page.waitForTimeout(800);
  const paths = await electronApp.evaluate(({ app }) => ({ userData: app.getPath("userData"), home: app.getPath("home"), isPackaged: app.isPackaged, name: app.getName(), version: app.getVersion() }));
  return { electronApp, page, localOrigin, windowId, paths };
}

/** Native dialogs answered as the person would here, each one recorded: Connect and Forget for the steps this test
 * takes, the safe choice (Cancel, Not now) for anything else. No browser is ever opened. */
async function answerNativeDialogs(electronApp) {
  const stubbed = await electronApp.evaluate(({ dialog, shell }) => {
    const seen = (globalThis.__e1 ??= { dialogs: [], external: [] });
    const answer = (options = {}) => {
      const buttons = Array.isArray(options.buttons) && options.buttons.length ? options.buttons.map(String) : ["OK"];
      const message = String(options.message ?? "");
      const yes = message.startsWith("Connect to ") ? "Connect" : message.startsWith("Forget “") ? "Forget" : null;
      let response = yes ? buttons.indexOf(yes) : -1;
      if (response < 0) response = Number.isInteger(options.cancelId) ? options.cancelId : Number.isInteger(options.defaultId) ? options.defaultId : 0;
      seen.dialogs.push({ at: new Date().toISOString(), type: options.type ?? null, message, detail: String(options.detail ?? "").slice(0, 400), buttons, chose: buttons[response] ?? String(response) });
      return { response, checkboxChecked: false };
    };
    const optionsOf = (first, second) => (second && typeof second === "object" ? second : first);
    const put = (target, key, value) => {
      try { target[key] = value; } catch {}
      if (target[key] !== value) try { Object.defineProperty(target, key, { value, configurable: true, writable: true }); } catch {}
      return target[key] === value;
    };
    return {
      showMessageBox: put(dialog, "showMessageBox", async (first, second) => answer(optionsOf(first, second))),
      showMessageBoxSync: put(dialog, "showMessageBoxSync", (first, second) => answer(optionsOf(first, second)).response),
      showErrorBox: put(dialog, "showErrorBox", (title, content) => {
        seen.dialogs.push({ at: new Date().toISOString(), type: "error-box", message: String(title), detail: String(content ?? "").slice(0, 400), buttons: [], chose: null });
      }),
      showOpenDialog: put(dialog, "showOpenDialog", async () => ({ canceled: true, filePaths: [] })),
      openExternal: put(shell, "openExternal", async (url) => { seen.external.push(String(url)); }),
    };
  });
  const missing = Object.entries(stubbed).filter(([, ok]) => !ok).map(([key]) => key);
  if (missing.length) throw new Error(`could not answer native dialogs in main: ${missing.join(", ")}`);
}

async function collectMainRecords() {
  if (!current) return;
  try {
    const seen = await current.electronApp.evaluate(() => {
      const records = globalThis.__e1 ?? { dialogs: [], external: [] };
      return { dialogs: records.dialogs.splice(0), external: records.external.splice(0) };
    });
    report.dialogs.push(...seen.dialogs);
    report.externalOpens.push(...seen.external);
  } catch {}
}

/** The window that shows a place (the startup screen is a data: page). */
async function mainPage(electronApp, timeoutMs = 180_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const page of electronApp.windows()) if (!page.isClosed() && /^https?:\/\//.test(page.url())) return page;
    await delay(250);
  }
  throw new Error(`no app window showed a page (windows: ${electronApp.windows().map((page) => page.url()).join(", ")})`);
}

/** The app is drawn: its sidebar is on screen. */
async function waitForApp(page, what, timeoutMs = 90_000) {
  try {
    await page.locator("[data-sidebar-top-row]").first().waitFor({ state: "visible", timeout: timeoutMs });
  } catch (error) {
    throw new Error(`${what}: the app never drew its sidebar at ${page.url()} (${String(error.message).split("\n")[0]})`);
  }
  await page.waitForTimeout(700);
}

async function serverMenu() {
  return current.electronApp.evaluate(({ Menu }) => {
    const server = Menu.getApplicationMenu()?.items.find((item) => item.label === "Server");
    return server?.submenu?.items.filter((item) => item.type !== "separator").map((item) => ({ label: item.label, type: item.type, checked: item.checked, enabled: item.enabled })) ?? null;
  });
}

const ticked = (items) => (items ?? []).filter((item) => item.type === "radio" && item.checked).map((item) => item.label);
const radios = (items) => (items ?? []).filter((item) => item.type === "radio").map((item) => item.label);

/** A native menu item chosen as a click on it would: in the Server menu by its label (or `label — host`), or anywhere by role. */
async function chooseMenuItem({ label = null, role = null }) {
  return current.electronApp.evaluate(({ Menu, BrowserWindow }, { label: wanted, role: wantedRole, id }) => {
    const top = Menu.getApplicationMenu()?.items ?? [];
    const pool = wanted ? (top.find((item) => item.label === "Server")?.submenu?.items ?? []) : top.flatMap((item) => item.submenu?.items ?? []);
    const item = pool.find((candidate) => wanted ? candidate.label === wanted || candidate.label.startsWith(`${wanted} — `) : String(candidate.role ?? "").toLowerCase() === wantedRole);
    if (!item) throw new Error(`no menu item ${wanted ?? wantedRole} (${pool.map((candidate) => candidate.label).join(" | ")})`);
    const w = BrowserWindow.fromId(id);
    item.click(undefined, w, w?.webContents);
    return item.label;
  }, { label, role, id: current.windowId });
}

async function windowTitle() {
  return current.electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.getTitle() ?? null, current.windowId);
}

async function setWindow(change) {
  return current.electronApp.evaluate(({ BrowserWindow }, { id, change: next }) => {
    const w = BrowserWindow.fromId(id);
    if (next.bounds) w.setBounds(next.bounds);
    if (next.size) w.setSize(...next.size);
    if (typeof next.zoomLevel === "number") w.webContents.setZoomLevel(next.zoomLevel);
    return { bounds: w.getBounds(), minimum: w.getMinimumSize(), zoomLevel: w.webContents.getZoomLevel() };
  }, { id: current.windowId, change });
}

const railPlacesFromMain = () => current.page.evaluate(async () => (window.ogb?.workspaces?.places ? window.ogb.workspaces.places() : null));
const savedPlaces = () => current.page.evaluate(async () => (window.ogb?.environments?.state ? window.ogb.environments.state() : null));

/** What the rail draws: each circle's id, kind, label, letters, whether it is the place on screen, its fill and ring. */
async function railOnScreen() {
  return current.page.evaluate(() => {
    const rail = document.querySelector("[data-places-rail]");
    if (!rail) return { present: false, visible: false, circles: [], add: false };
    const box = rail.getBoundingClientRect();
    return {
      present: true,
      visible: getComputedStyle(rail).display !== "none" && box.width > 0,
      width: Math.round(box.width),
      circles: [...rail.querySelectorAll("[data-rail-place]")].map((button) => {
        const mark = button.querySelector("span");
        return {
          id: button.getAttribute("data-rail-place"), kind: button.getAttribute("data-rail-kind"), label: button.getAttribute("aria-label"),
          title: button.getAttribute("title"), letters: (mark?.textContent ?? "").trim(), active: button.getAttribute("aria-current") === "page",
          icon: Boolean(mark?.querySelector("svg")), fill: mark ? getComputedStyle(mark).backgroundColor : null,
          ring: getComputedStyle(button).boxShadow !== "none",
        };
      }),
      add: Boolean(rail.querySelector("[data-rail-add]")),
    };
  });
}

/** The sidebar's own switcher (the place on screen, and the native Server menu behind it): every one drawn. */
async function switcherOnScreen() {
  return current.page.evaluate(() => [...document.querySelectorAll("[data-tour='server-switcher']")]
    .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"; })
    .map((element) => ({ label: element.getAttribute("aria-label"), title: element.getAttribute("title"), text: element.textContent?.trim().slice(0, 80) ?? "", besideRail: Boolean(element.closest("[data-switcher-beside-rail]")) })));
}

/** The switcher the rail stands in for: how many are kept beside the rail, and how many of those are drawn now. */
async function switcherBesideRail() {
  return current.page.evaluate(() => {
    const kept = [...document.querySelectorAll("[data-switcher-beside-rail]")];
    const drawn = kept.flatMap((wrapper) => [...wrapper.querySelectorAll("button, [role='img']")]).filter((element) => element.getBoundingClientRect().width > 0);
    return { kept: kept.length, drawn: drawn.length };
  });
}

/** The place the sidebar's switcher names. Advanced mode: its switcher button. Simple mode (a new install's default): the
 * profile menu, whose first rows are the place on screen and Switch to… (the native Server menu). */
async function switcherPlace(entry = null, shotName = null) {
  const { page } = current;
  const account = page.locator("[data-sidebar-account]").first();
  if (!await account.isVisible().catch(() => false)) {
    const drawn = await switcherOnScreen();
    return { mode: "advanced", place: drawn.map((item) => item.text).find(Boolean) ?? null, drawn };
  }
  await account.click();
  const menu = page.locator("[role='menu']").filter({ has: page.locator("[data-menu-key]") }).last();
  await menu.waitFor({ state: "visible", timeout: 5_000 });
  const place = (await menu.locator("[data-menu-key='place']").first().textContent().catch(() => null))?.trim() ?? null;
  const keys = await menu.locator("[data-menu-key]").evaluateAll((items) => items.map((item) => item.getAttribute("data-menu-key")));
  if (entry && shotName) await shot(entry, shotName);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  return { mode: "simple", place, keys };
}

/** Which server this page really is: its address, and the identity and sign-in the server itself answers there. */
async function pageIdentity() {
  return current.page.evaluate(async () => {
    const environment = await fetch("/.well-known/openmausbot/environment", { cache: "no-store" }).then((response) => response.json()).catch(() => null);
    const session = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" }).then((response) => response.json()).catch(() => null);
    return { origin: location.origin, path: location.pathname, environmentId: environment?.environmentId ?? null, label: environment?.label ?? null,
      session: session ? { kind: session.kind ?? null, id: session.id ?? null, scopes: session.scopes ?? null } : null, ownPage: window.ogb?.app?.ownPage ?? null };
  });
}

async function sidebarTint() {
  return current.page.evaluate(() => {
    const element = document.querySelector("[data-place-tint]");
    return element ? { value: element.style.getPropertyValue("--place-tint"), background: getComputedStyle(element).backgroundImage.slice(0, 160) } : null;
  });
}

// ── Steps ───────────────────────────────────────────────────────────────────────────────────────────────────────

let current = null;
let shots = 0;
async function shot(entry, name) {
  shots += 1;
  const file = `${String(shots).padStart(2, "0")}-${name}.png`;
  await current.page.waitForTimeout(400);
  // Zoomed in, Playwright clips the page's picture to its CSS size and cuts off its right side: take what the window
  // shows from main instead.
  const zoomed = await current.electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.webContents.getZoomLevel() ?? 0, current.windowId);
  if (zoomed) {
    const png = await current.electronApp.evaluate(async ({ BrowserWindow }, id) => (await BrowserWindow.fromId(id).webContents.capturePage()).toPNG().toString("base64"), current.windowId);
    writeFileSync(join(OUT, file), Buffer.from(png, "base64"));
  } else {
    await current.page.screenshot({ path: join(OUT, file) });
  }
  entry.screenshots.push(file);
  return file;
}

/** Back to this computer's page through the native Server menu, as the person would from a server's page. */
async function backToThisComputer() {
  const { page, localOrigin } = current;
  await dismissOverlays();
  if (new URL(page.url()).origin === localOrigin) return;
  await chooseMenuItem({ label: "This computer" });
  await page.waitForURL((url) => url.origin === localOrigin, { timeout: 60_000 });
  await waitForApp(page, "this computer's page");
}

/** Settings → Servers on this computer's page, opened by the Server menu's Connect to a server…. */
async function openServersSettings() {
  await backToThisComputer();
  await chooseMenuItem({ label: "Connect to a server…" });
  await current.page.getByLabel(ADDRESS, { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
}

const SETTINGS = "[role='dialog'][aria-labelledby='app-settings-title']";
const ADDRESS = "Server address or pairing link";

async function closeSettings() {
  const { page } = current;
  const dialog = page.locator(SETTINGS).first();
  for (let i = 0; i < 4 && await dialog.isVisible().catch(() => false); i++) {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 1_500 }).catch(() => {});
  }
}

/** Nothing a step before left open over the window: Settings, ＋'s sheet, the buying sheet. */
async function dismissOverlays() {
  const { page } = current;
  for (const selector of [SETTINGS, "[data-place-add-sheet]", "[data-cloud-add-dialog]"]) {
    const overlay = page.locator(selector).first();
    for (let i = 0; i < 3 && await overlay.isVisible().catch(() => false); i++) {
      await page.keyboard.press("Escape");
      await overlay.waitFor({ state: "hidden", timeout: 1_500 }).catch(() => {});
    }
  }
}

/** The narrow layout as the person reaches it: the window at its minimum, then View → Zoom In until the page is below the
 * rail's breakpoint; the sidebar is a drawer there, opened with Open bot list. Measures the switcher in the drawer, then
 * puts the window back. `before()` reads what to check before the drawer opens. */
async function narrowLayout(entry, name, before) {
  const { page } = current;
  const sized = await setWindow({ size: [700, 900] });
  await page.waitForTimeout(800);
  const asked = await page.evaluate(() => window.innerWidth);
  entry.notes.push(`asked for a 700 px window: ${sized.bounds.width} px, page ${asked} CSS px (minimum ${sized.minimum.join("×")})`);
  if (asked >= RAIL_BREAKPOINT) finding("narrow-unreachable", `The window cannot be narrower than its minimum width (${sized.minimum[0]} px), which is wider than the ${RAIL_BREAKPOINT} px below which the rail hides: at 100% zoom the rail never hides. Only zooming in (View → Zoom In) reaches the narrow layout.`, { askedFor: 700, window: sized.bounds.width, page: asked, minimum: sized.minimum });
  let width = asked;
  for (let i = 0; i < 6 && width >= RAIL_BREAKPOINT; i++) {
    await chooseMenuItem({ role: "zoomin" }).catch(async (error) => {
      entry.notes.push(`View → Zoom In not found (${String(error.message).slice(0, 120)}); zooming the page directly`);
      await setWindow({ zoomLevel: (await setWindow({})).zoomLevel + 0.5 });
    });
    await page.waitForTimeout(500);
    width = await page.evaluate(() => window.innerWidth);
  }
  entry.notes.push(`after View → Zoom In: the page is ${width} CSS px wide`);
  const seen = await before();
  await shot(entry, name);
  const opener = page.getByRole("button", { name: "Open bot list" });
  if (await opener.getAttribute("aria-expanded").catch(() => null) !== "true") await opener.click();
  // The drawer slides in: measure once it has stopped moving.
  const measure = () => page.evaluate(() => [...document.querySelectorAll("[data-sidebar-top-switcher] [data-tour='server-switcher']")].map((element) => {
    const box = element.getBoundingClientRect();
    return { text: element.textContent?.trim().slice(0, 60) ?? "", left: Math.round(box.left), right: Math.round(box.right), viewport: window.innerWidth,
      beside: Boolean(element.closest("[data-switcher-beside-rail]")) };
  }).filter((item) => item.right > 0 && item.left < item.viewport));
  let switcher = await measure();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const again = await measure();
    if (JSON.stringify(again) === JSON.stringify(switcher)) break;
    switcher = again;
  }
  await shot(entry, `${name}-drawer`);
  await page.keyboard.press("Escape");
  await chooseMenuItem({ role: "resetzoom" }).catch(() => setWindow({ zoomLevel: 0 }));
  await setWindow({ bounds: { x: 40, y: 30, width: 1440, height: 900 }, zoomLevel: 0 });
  await page.waitForTimeout(800);
  return { width, before: seen, switcher };
}

/** The place's colour in its own Settings: the profile menu's Settings, then Appearance (Advanced) or More looks (Simple). */
async function openPlaceLookSettings() {
  const { page } = current;
  await page.locator("[data-sidebar-account]").first().click();
  await page.locator("[data-menu-key='settings']").first().click();
  await page.locator(SETTINGS).first().waitFor({ state: "visible" });
  const appearance = page.locator("[data-settings-section='appearance']");
  if (await appearance.isVisible().catch(() => false)) await appearance.click();
  else await page.locator("xpath=//*[normalize-space(text())='More looks']/ancestor::*[.//button][1]//button[normalize-space(.)='Change']").first().click();
  await page.locator("[data-place-look]").waitFor({ state: "visible", timeout: 15_000 });
}

/** The app's own Connect flow: Settings → Servers → Connect to a server, with the server's pairing link and a name. */
async function pairThroughConnect(entry, server) {
  const { page } = current;
  await openServersSettings();
  await page.getByLabel(ADDRESS, { exact: true }).fill(server.pairLink());
  await page.getByLabel("Name (optional)", { exact: true }).fill(server.label);
  await shot(entry, `connect-${server.key}`);
  const form = page.locator("form").filter({ has: page.getByLabel(ADDRESS, { exact: true }) });
  await form.getByRole("button", { name: "Connect", exact: true }).click();
  await page.waitForURL((url) => url.origin === server.origin && url.pathname !== "/pair", { timeout: 90_000 });
  await waitForApp(page, `${server.label}'s page`);
}

async function openCircle(server, id) {
  const { page } = current;
  await page.locator(`[data-rail-place="${id}"]`).click();
  await page.waitForURL((url) => url.origin === server.origin, { timeout: 60_000 });
  await waitForApp(page, `${server.label}'s page`);
}

/** The window shows this server: its address, the server's own identity there, signed in, and the Server menu's tick. */
async function expectShowing(entry, server, menuShot = null) {
  const seen = await pageIdentity();
  const menu = await serverMenu();
  const title = await windowTitle();
  const named = await current.page.getByText(server.label, { exact: true }).first().isVisible().catch(() => false);
  if (!named) finding("place-unnamed", "In Simple mode (a new install's default) a server's own page names it nowhere on screen: no rail there, and the switcher is the profile menu, whose first row names the place only once it is opened. The window title (OpenMausBot — Hosted: …) does name it.", { page: server.origin });
  const switcher = await switcherPlace(entry, menuShot);
  check(entry, `the window shows ${server.label}'s address`, seen.origin === server.origin, { shown: seen.origin, expected: server.origin });
  check(entry, `the page is ${server.label} itself (the environment id it answers)`, seen.environmentId === server.environmentId, { shown: seen.environmentId, expected: server.environmentId });
  check(entry, `signed in to ${server.label}, not its sign-in page`, seen.session?.kind === "session" && seen.path !== "/pair", seen.session);
  check(entry, `the Server menu ticks ${server.label}`, ticked(menu).length === 1 && ticked(menu)[0].startsWith(`${server.label} — `), ticked(menu));
  check(entry, `the window's title names ${server.label}`, typeof title === "string" && title.includes(server.label), title);
  check(entry, `the sidebar's switcher names ${server.label}`, switcher.place === server.label, switcher);
  return seen;
}

function check(entry, name, ok, detail = null) {
  entry.checks.push({ name, ok: Boolean(ok), ...(detail !== null && detail !== undefined ? { detail } : {}) });
  return Boolean(ok);
}

function finding(id, text, evidence) {
  if (!report.findings.some((item) => item.id === id)) report.findings.push({ id, text, evidence });
}

class Skip extends Error {}

async function scenario(id, title, run) {
  const entry = { id, title, status: "running", checks: [], screenshots: [], notes: [] };
  report.scenarios.push(entry);
  writeReport();
  log(`▶ ${id}: ${title}`);
  const started = Date.now();
  try {
    await run(entry);
    entry.status = entry.checks.some((item) => !item.ok) ? "fail" : "pass";
  } catch (error) {
    if (error instanceof Skip) {
      entry.status = "skip";
      entry.notes.push(error.message);
    } else {
      entry.status = "fail";
      entry.error = String(error?.stack ?? error).split("\n").slice(0, 6).join("\n");
      try { await shot(entry, `${id}-error`); } catch {}
    }
  }
  entry.ms = Date.now() - started;
  await collectMainRecords();
  log(`${{ pass: "✓", skip: "–" }[entry.status] ?? "✗"} ${id} (${entry.status}, ${entry.ms} ms)${entry.error ? `\n${entry.error}` : ""}`);
  for (const item of entry.checks.filter((one) => !one.ok)) log(`   ✗ ${item.name}: ${JSON.stringify(item.detail ?? null)}`);
  writeReport();
}

// ── The scenarios ───────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  log(`work ${WORK}, out ${OUT}`);
  const brokerPort = await closedPort();
  const servers = await provideServers(brokerPort);
  report.servers = servers.map(({ key, label, origin, environmentId, serverLabel, version, source }) => ({ key, label, origin, environmentId, serverLabel, version, source }));
  writeReport();
  const [A, B] = servers;
  log(`servers: ${servers.map((server) => `${server.label} ${server.origin}`).join(", ")}`);
  const binary = stageApp();
  seedDesktop();
  current = await launchApp(binary, brokerPort);
  report.app = { ...current.paths, localOrigin: current.localOrigin };
  writeReport();
  if (!current.paths.isPackaged) throw new Error("the staged app does not run as the installed app (app.isPackaged is false)");
  if (current.paths.userData !== DIRS.userData) throw new Error(`the app keeps its data in ${current.paths.userData}, not the seeded ${DIRS.userData}`);
  const ids = {};
  const sessionIds = {};

  await scenario("fresh", "Fresh app: one place, so no rail and today's look", async (entry) => {
    const rail = await railOnScreen();
    const listed = await railPlacesFromMain();
    const menu = await serverMenu();
    check(entry, "no rail on screen", !rail.present, rail);
    check(entry, "main lists no places for the rail", Array.isArray(listed?.places) && listed.places.length === 0, listed);
    await shot(entry, "fresh");
    const switcher = await switcherPlace(entry, "fresh-switcher");
    check(entry, "the sidebar keeps its switcher, on This computer", switcher.place === "This computer" && (switcher.mode === "advanced" || switcher.keys.includes("switch-place")), switcher);
    check(entry, "the Server menu has This computer alone, ticked", ticked(menu).join() === "This computer" && radios(menu).length === 1, menu);
    entry.notes.push(`what ＋ would offer here: ${JSON.stringify(listed?.add)}; switcher: ${switcher.mode}`);
  });

  await scenario("pair-a", `Pair ${A.label} through Settings → Servers → Connect`, async (entry) => {
    await pairThroughConnect(entry, A);
    sessionIds.a = (await expectShowing(entry, A)).session?.id ?? null;
    await shot(entry, "server-a-paired");
    await backToThisComputer();
    const place = (await savedPlaces())?.environments.find((item) => item.origin === A.origin);
    ids.a = place?.id;
    check(entry, `${A.label} is saved under the name it was given`, place?.name === A.label, place);
    const rail = await railOnScreen();
    const listed = await railPlacesFromMain();
    // PR #3725 (railPlaces, RAIL_MIN_PLACES = 2): two places besides this computer before there is a rail at all.
    check(entry, "one server besides this computer: no rail yet (the PR's rule)", !rail.present && listed?.places?.length === 0, { rail, listed });
    if (!rail.present) finding("rail-threshold", "This computer + one server shows no rail: PR #3725 counts places besides this computer (RAIL_MIN_PLACES = 2), so the rail starts with two servers or Clouds, as three circles with This computer. The brief expected two circles at this point.", { listed: listed?.places ?? null });
    await shot(entry, "one-server-no-rail");
  });

  await scenario("pair-b", `Pair ${B.label}: three circles, This computer, ${A.label}, ${B.label}`, async (entry) => {
    const { page } = current;
    await pairThroughConnect(entry, B);
    sessionIds.b = (await expectShowing(entry, B)).session?.id ?? null;
    await backToThisComputer();
    ids.b = (await savedPlaces())?.environments.find((item) => item.origin === B.origin)?.id;
    await page.locator("[data-places-rail]").waitFor({ state: "visible", timeout: 15_000 });
    const rail = await railOnScreen();
    const order = rail.circles.map((circle) => circle.label);
    check(entry, "the rail is on screen", rail.visible, { visible: rail.visible, width: rail.width });
    check(entry, "three circles: This computer, then the servers in the order they were added", order.join(" | ") === ["This computer", A.label, B.label].join(" | "), order);
    const [computer, first, second] = rail.circles;
    check(entry, "This computer is a laptop mark", computer?.kind === "computer" && computer.icon && computer.id === "local", computer);
    check(entry, `${A.label}'s circle reads ${initials(A.label)}`, first?.letters === initials(A.label) && first?.id === ids.a && first?.kind === "server", first);
    check(entry, `${B.label}'s circle reads ${initials(B.label)}`, second?.letters === initials(B.label) && second?.id === ids.b && second?.kind === "server", second);
    check(entry, "each circle's tooltip names its place", first?.title === A.label && second?.title === B.label, [first?.title, second?.title]);
    check(entry, "This computer, the place on screen, is marked and ringed", computer?.active && computer.ring && !first?.active && !second?.active, rail.circles.map(({ label, active, ring }) => ({ label, active, ring })));
    check(entry, "＋ comes last", rail.add);
    const aside = await switcherBesideRail();
    check(entry, "beside the rail (wide window) the sidebar's switcher is not drawn", aside.drawn === 0, aside);
    if (first && second && first.letters === second.letters) finding("same-initials", `Two servers whose names start alike get the same letters (${first.letters}): only the tooltip tells them apart.`, { a: first.label, b: second.label });
    if (first && second && first.fill === second.fill) finding("no-colour", "A server connected by hand has no colour (until it gets one), so every such server is the same plain circle in the rail.", { fill: first.fill });
    await shot(entry, "rail-three-circles");
    const menu = await switcherPlace(entry, "rail-and-profile-menu");
    entry.notes.push(`switcher beside the rail: ${JSON.stringify(menu)}`);
    if (menu.mode === "simple" && menu.keys.includes("switch-place")) finding("simple-switch-stays", "In Simple mode the profile menu keeps its place row and Switch to… (the native Server menu) beside the rail: two ways to switch on screen at once. The PR's step-aside applies to Advanced mode's switcher only.", { keys: menu.keys });
  });

  await scenario("switch", "Each circle opens its place: the window, the menu tick and the marked circle agree", async (entry) => {
    const { page, localOrigin } = current;
    for (const server of [A, B]) {
      await backToThisComputer();
      await page.locator("[data-places-rail]").waitFor({ state: "visible", timeout: 15_000 });
      const before = await railOnScreen();
      check(entry, `before ${server.label}: This computer is the marked circle`, before.circles[0]?.active === true && before.circles.filter((circle) => circle.active).length === 1, before.circles.map(({ label, active }) => ({ label, active })));
      check(entry, `before ${server.label}: the Server menu ticks This computer`, ticked(await serverMenu()).join() === "This computer", ticked(await serverMenu()));
      await openCircle(server, ids[server.key]);
      await expectShowing(entry, server, `on-${server.key}-switcher`);
      const rail = await railOnScreen();
      const listed = await railPlacesFromMain();
      // PR #3725's trust rule: a server's own page gets no list, so it draws no rail; the native menu is its switcher.
      check(entry, `${server.label}'s own page gets no rail (the PR's trust rule)`, !rail.present && listed?.places?.length === 0, { rail, listed });
      if (!rail.present) finding("rail-one-way", "Once a circle opens a server connected by hand, that server's page has no rail (by design: its page could otherwise read the names of the other places). So the circle just clicked is never seen marked, and the way back is the sidebar's switcher or the Server menu, not the rail.", { page: server.origin });
      await shot(entry, `on-${server.key}`);
    }
    await backToThisComputer();
    check(entry, "back on this computer's page", new URL(page.url()).origin === localOrigin, page.url());
  });

  await scenario("advanced", "Advanced mode: beside the rail, the sidebar's switcher steps aside", async (entry) => {
    const { page } = current;
    await backToThisComputer();
    // What Settings → Advanced mode writes, then the page as it comes up in that mode.
    await page.evaluate(() => localStorage.setItem("omb-advanced-mode", "1"));
    await page.reload();
    await waitForApp(page, "this computer's page in Advanced mode");
    await page.locator("[data-places-rail]").waitFor({ state: "visible", timeout: 15_000 });
    const aside = await switcherBesideRail();
    check(entry, "the switcher is kept beside the rail, not drawn on a wide window", aside.kept > 0 && aside.drawn === 0, aside);
    const rail = await railOnScreen();
    check(entry, "the same three circles, This computer marked", rail.circles.map((circle) => circle.id).join() === ["local", ids.a, ids.b].join() && rail.circles[0]?.active === true, rail.circles.map(({ id, active }) => ({ id, active })));
    await shot(entry, "rail-advanced");
    await page.evaluate(() => localStorage.setItem("omb-advanced-mode", "0"));
    await page.reload();
    await waitForApp(page, "this computer's page in Simple mode");
  });

  await scenario("add-own-server", "＋ → Add your own server shows its steps", async (entry) => {
    const { page } = current;
    await backToThisComputer();
    await page.locator("[data-rail-add]").click();
    await page.locator("[data-place-add-sheet]").waitFor({ state: "visible" });
    entry.notes.push(`＋ choices: ${JSON.stringify((await railPlacesFromMain())?.add)}`);
    if (await page.locator("[data-place-add='choose']").isVisible()) {
      check(entry, "＋ offers both: Buy a Cloud, Add your own server", await page.locator("[data-place-add-choice='cloud']").isVisible() && await page.locator("[data-place-add-choice='server']").isVisible());
      await shot(entry, "add-sheet");
      await page.locator("[data-place-add-choice='server']").click();
    } else {
      check(entry, "＋ offers both: Buy a Cloud, Add your own server", false, "＋ went straight to one of them");
    }
    const steps = page.locator("[data-place-add='own-server']");
    await steps.waitFor({ state: "visible" });
    const titles = await steps.locator("ol > li p.font-semibold").allTextContents();
    const commands = await steps.locator("[data-own-server-command]").allTextContents();
    check(entry, "three steps: install, open a pairing window, connect it here", titles.join(" | ") === "Install OpenMausBot on it | Open a pairing window | Connect it here", titles);
    check(entry, "the install and pairing commands", commands.join(" | ") === 'npx openmausbot start | npx openmausbot pair --label "My desktop"', commands);
    check(entry, "Connect it here: paste the link, or enter the address", await steps.getByRole("button", { name: "Paste pairing link" }).isVisible() && await steps.getByRole("button", { name: "Enter its address instead" }).isVisible());
    await shot(entry, "add-own-server");
    // Enter its address instead: the sheet makes way for Settings → Servers, where an address is typed.
    await steps.getByRole("button", { name: "Enter its address instead" }).click();
    await page.locator("[data-place-add-sheet]").waitFor({ state: "hidden" });
    const opened = await page.getByLabel(ADDRESS, { exact: true }).waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
    check(entry, "Enter its address instead opens Settings → Servers, at Connect to a server", opened);
    await closeSettings();
  });

  await scenario("add-own-server-paste", "＋ → Add your own server → Paste pairing link connects the server on the clipboard", async (entry) => {
    if (A.source !== "local") throw new Skip("Needs a fresh pairing link, which only a local server can mint during the run.");
    const { electronApp, page } = current;
    await backToThisComputer();
    await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), A.pairLink());
    await page.locator("[data-rail-add]").click();
    await page.locator("[data-place-add-choice='server']").click();
    await page.locator("[data-place-add='own-server']").getByRole("button", { name: "Paste pairing link" }).click();
    await page.waitForURL((url) => url.origin === A.origin && url.pathname !== "/pair", { timeout: 60_000 });
    await waitForApp(page, `${A.label}'s page`);
    await expectShowing(entry, A);
    await backToThisComputer();
    const saved = (await savedPlaces())?.environments.filter((item) => item.origin === A.origin) ?? [];
    check(entry, `still one saved place for ${A.label}, with its name and id`, saved.length === 1 && saved[0].id === ids.a && saved[0].name === A.label, saved);
    const rail = await railOnScreen();
    check(entry, "the rail is as it was: three circles", rail.circles.map((circle) => circle.id).join() === ["local", ids.a, ids.b].join(), rail.circles.map(({ id, label }) => ({ id, label })));
    await shot(entry, "after-paste");
  });

  await scenario("buy-cloud-signed-out", "＋ → Buy a Cloud, signed out: the sign-in and offer; nothing bought", async (entry) => {
    const { page } = current;
    await backToThisComputer();
    const listed = await railPlacesFromMain();
    if (!check(entry, "＋ offers Buy a Cloud in the installed app", listed?.add?.cloud === true, listed?.add)) return;
    await page.locator("[data-rail-add]").click();
    await page.locator("[data-place-add-choice='cloud']").click();
    // Signed out, ＋'s own flow hands over to this computer's buying sheet, which signs in and shows the plans.
    const sheet = page.locator("[data-cloud-add-dialog]");
    await sheet.waitFor({ state: "visible", timeout: 30_000 });
    const view = sheet.locator("[data-cloud-add]").first();
    await view.waitFor({ state: "visible", timeout: 30_000 });
    for (let i = 0; i < 40 && /^checking$/.test(await view.getAttribute("data-cloud-add").catch(() => "") ?? ""); i++) await page.waitForTimeout(500);
    const kind = await sheet.locator("[data-cloud-add]").first().getAttribute("data-cloud-add");
    const plans = await sheet.locator("[data-plan]").count();
    const signIn = await sheet.getByRole("button", { name: "Already have a plan? Sign in" }).isVisible().catch(() => false);
    const account = await page.evaluate(async () => (window.ogb?.cloudAccount?.state ? window.ogb.cloudAccount.state() : null));
    entry.notes.push(`sheet: ${kind}; plans: ${plans}; account: ${account?.status ?? "?"}`);
    check(entry, "the rail's sheet handed over to the buying sheet", await sheet.isVisible() && !await page.locator("[data-place-add-sheet]").isVisible());
    check(entry, "the signed-out offer: plans from the catalog and Sign in", (kind ?? "").startsWith("offer") && plans > 0 && signIn, { kind, plans, signIn });
    check(entry, "still signed out of MausBot Cloud", account?.status === "signed-out", account?.status ?? account);
    await shot(entry, "buy-cloud-signed-out");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => sheet.getByRole("button", { name: "Close", exact: true }).first().click());
    await sheet.waitFor({ state: "hidden", timeout: 10_000 });
    await collectMainRecords();
    check(entry, "no checkout, nor any other page, was opened in a browser", report.externalOpens.length === 0, report.externalOpens);
  });

  await scenario("tint", `A colour for ${A.label}, set in its own Settings: its sidebar and circle follow`, async (entry) => {
    const { page } = current;
    await backToThisComputer();
    await openCircle(A, ids.a);
    const supported = await page.evaluate(() => typeof window.ogb?.workspaces?.look === "function" && typeof window.ogb?.workspaces?.color === "function");
    if (!supported) throw new Skip("The place colour (workspaces.look / workspaces.color) is not in this build of feat/cloud-rail yet.");
    entry.notes.push(`${A.label}'s look before: ${JSON.stringify(await page.evaluate(() => window.ogb.workspaces.look()))}`);
    await openPlaceLookSettings();
    const card = page.locator("[data-place-look]");
    check(entry, `${A.label}'s colour can be changed here (this app keeps it)`, await card.getAttribute("data-place-look") === "local", await card.getAttribute("data-place-look"));
    await card.locator("[data-swatch='violet']").click();
    await card.locator("[data-swatch='violet'][aria-checked='true']").waitFor({ state: "visible", timeout: 10_000 });
    await shot(entry, "tint-chosen");
    await closeSettings();
    const look = await page.evaluate(() => window.ogb.workspaces.look());
    check(entry, "main keeps the colour for this place", look?.color === "purple" && look?.swatch === "violet", look);
    const tint = await sidebarTint();
    check(entry, `${A.label}'s sidebar takes the tint`, Boolean(tint?.value?.includes("purple")), tint);
    await shot(entry, "tint-on-a");
    await backToThisComputer();
    const rail = await railOnScreen();
    const circleA = rail.circles.find((item) => item.id === ids.a), circleB = rail.circles.find((item) => item.id === ids.b);
    check(entry, `${A.label}'s circle takes the colour; ${B.label}'s stays plain`, Boolean(circleA?.fill) && circleA.fill !== circleB?.fill, { a: circleA?.fill, b: circleB?.fill });
    check(entry, "this computer's own page has no tint", !(await sidebarTint()), await sidebarTint());
    await shot(entry, "tint-in-rail");
    await openCircle(B, ids.b);
    check(entry, `${B.label}, with no colour, has no tint`, !(await sidebarTint()), await sidebarTint());
    await backToThisComputer();
    await openCircle(A, ids.a);
    const again = await sidebarTint();
    check(entry, `back on ${A.label}, its tint is still there`, Boolean(again?.value?.includes("purple")), again);
    await shot(entry, "tint-on-a-again");
  });

  await scenario("narrow", "Narrow window: the rail hides and the switcher stays", async (entry) => {
    const { page } = current;
    await backToThisComputer();
    await page.locator("[data-places-rail]").waitFor({ state: "visible", timeout: 15_000 });
    const narrow = await narrowLayout(entry, "narrow", () => railOnScreen());
    check(entry, `below ${RAIL_BREAKPOINT} CSS px the rail hides`, narrow.width < RAIL_BREAKPOINT && narrow.before.present && !narrow.before.visible, { width: narrow.width, present: narrow.before.present, visible: narrow.before.visible });
    check(entry, "the switcher stays: in the sidebar drawer, in the rail's place, naming This computer", narrow.switcher.some((item) => item.beside && item.text.includes("This computer")), narrow.switcher);
    report.narrowSwitcher = { withRail: narrow.switcher };
    check(entry, "wide again: the rail is back", (await railOnScreen()).visible);
  });

  await scenario("restart", "Restart the app: the places and the rail are still there", async (entry) => {
    await backToThisComputer();
    await collectMainRecords();
    await current.electronApp.close();
    current = await launchApp(binary, brokerPort, current.localOrigin);
    const { page } = current;
    await page.locator("[data-places-rail]").waitFor({ state: "visible", timeout: 30_000 });
    const rail = await railOnScreen();
    check(entry, "the same three circles", rail.circles.map((circle) => circle.id).join() === ["local", ids.a, ids.b].join(), rail.circles.map(({ id, label }) => ({ id, label })));
    const menu = await serverMenu();
    check(entry, "the Server menu still lists both servers", [A, B].every((server) => radios(menu).some((label) => label.startsWith(`${server.label} — `))), radios(menu));
    const tinted = report.scenarios.find((item) => item.id === "tint")?.status === "pass";
    if (tinted) {
      const circleA = rail.circles.find((circle) => circle.id === ids.a), circleB = rail.circles.find((circle) => circle.id === ids.b);
      check(entry, `${A.label}'s colour is still on its circle`, Boolean(circleA?.fill) && circleA.fill !== circleB?.fill, { a: circleA?.fill, b: circleB?.fill });
    }
    await shot(entry, "after-restart");
    await openCircle(B, ids.b);
    await expectShowing(entry, B);
    await shot(entry, "after-restart-on-b");
    // Quit while a server is on screen: the app comes back on that server.
    await backToThisComputer();
    await openCircle(A, ids.a);
    await collectMainRecords();
    await current.electronApp.close();
    current = await launchApp(binary, brokerPort, current.localOrigin);
    check(entry, `quit on ${A.label}, reopened on ${A.label}`, new URL(current.page.url()).origin === A.origin, current.page.url());
    await expectShowing(entry, A);
    if (tinted) check(entry, `${A.label}'s tint is there from the start`, Boolean((await sidebarTint())?.value?.includes("purple")), await sidebarTint());
    await shot(entry, "reopened-on-a");
    await backToThisComputer();
    const railBack = await current.page.locator("[data-places-rail]").waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
    check(entry, "back on this computer, the rail is there", railBack, await railOnScreen());
  });

  async function forget(server) {
    const { page } = current;
    await openServersSettings();
    const button = page.getByRole("button", { name: `Forget ${server.label}`, exact: true });
    await button.click();
    await button.waitFor({ state: "detached", timeout: 20_000 });
    await closeSettings();
    await page.waitForTimeout(1_000);
  }

  await scenario("forget-b", `Forget ${B.label}: one server left`, async (entry) => {
    const before = B.sessions ? await B.sessions() : null;
    await forget(B);
    const rail = await railOnScreen();
    const menu = await serverMenu();
    check(entry, `${B.label} is gone from the Server menu, ${A.label} stays`, !radios(menu).some((label) => label.startsWith(`${B.label} — `)) && radios(menu).some((label) => label.startsWith(`${A.label} — `)), radios(menu));
    // The brief expected two circles here; under PR #3725's rule one server besides this computer is no rail.
    check(entry, "one server besides this computer: no rail (the PR's rule)", !rail.present, rail);
    const back = await switcherPlace();
    check(entry, "the switcher is back in the sidebar, on This computer", back.place === "This computer", back);
    if (B.sessions) {
      const after = await B.sessions();
      check(entry, `${B.label} signed this desktop out (its session is gone there)`, before.some((session) => session.id === sessionIds.b) && !after.some((session) => session.id === sessionIds.b), { session: sessionIds.b, before: before.map((session) => session.id), after: after.map((session) => session.id) });
    }
    await shot(entry, "forgot-b");
  });

  await scenario("forget-a", `Forget ${A.label} from the Server menu, on its own page: only this computer, no rail`, async (entry) => {
    const { page, localOrigin } = current;
    await backToThisComputer();
    // No rail with one server: the Server menu opens it, and its Forget “…” item forgets the place on screen.
    await chooseMenuItem({ label: A.label });
    await page.waitForURL((url) => url.origin === A.origin, { timeout: 60_000 });
    await waitForApp(page, `${A.label}'s page`);
    const session = (await pageIdentity()).session?.id ?? null;
    await chooseMenuItem({ label: `Forget “${A.label}”` });
    await page.waitForURL((url) => url.origin === localOrigin, { timeout: 60_000 });
    await waitForApp(page, "this computer's page");
    check(entry, "the window went back to this computer", new URL(page.url()).origin === localOrigin, page.url());
    if (A.sessions) {
      const after = await A.sessions();
      check(entry, `${A.label} signed this desktop out (its session is gone there)`, Boolean(session) && !after.some((item) => item.id === session), { session, after: after.map((item) => item.id) });
    }
    const rail = await railOnScreen();
    const menu = await serverMenu();
    check(entry, "no rail", !rail.present, rail);
    check(entry, "the Server menu is This computer alone, ticked", ticked(menu).join() === "This computer" && radios(menu).length === 1, radios(menu));
    const back = await switcherPlace();
    check(entry, "the switcher is there, on This computer, as on a fresh app", back.place === "This computer", back);
    await shot(entry, "forgot-a");
    // The same narrow layout without a rail, to tell what the rail changes there from what was there before.
    const narrow = await narrowLayout(entry, "narrow-without-rail", async () => null);
    report.narrowSwitcher = { ...report.narrowSwitcher, withoutRail: narrow.switcher };
    const clipped = (items) => (items ?? []).some((item) => item.right > item.viewport);
    if (clipped(report.narrowSwitcher.withRail) || clipped(narrow.switcher)) {
      finding("narrow-pill-clipped", `In the narrow layout the sidebar's switcher pill runs past the window's right edge (${clipped(report.narrowSwitcher.withRail) ? "with" : "without"} the rail${clipped(report.narrowSwitcher.withRail) && clipped(narrow.switcher) ? " and without it, so not the rail's doing" : ""}).`, report.narrowSwitcher);
    }
  });
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  exitCode = 1;
  report.error = String(error?.stack ?? error).split("\n").slice(0, 8).join("\n");
  log(`harness failed: ${report.error}`);
  if (current) try { await current.page.screenshot({ path: join(OUT, "harness-error.png") }); } catch {}
} finally {
  if (current) {
    await collectMainRecords();
    try { await current.electronApp.close(); } catch {}
  }
  await stopServers();
  try { cpSync(join(DIRS.userData, "logs"), join(OUT, "logs", "app"), { recursive: true }); } catch {}
  for (const item of report.scenarios) if (item.status === "running") item.status = "fail";
  report.finishedAt = new Date().toISOString();
  report.summary = Object.fromEntries(["pass", "fail", "skip"].map((status) => [status, report.scenarios.filter((item) => item.status === status).map((item) => item.id)]));
  if (report.summary.fail.length) exitCode = 1;
  writeReport();
  if (!KEEP) rmSync(WORK, { recursive: true, force: true });
  log(`report ${join(OUT, "report.json")}: pass ${report.summary.pass.length}, fail ${report.summary.fail.length}, skip ${report.summary.skip.length}`);
}
process.exit(exitCode);
