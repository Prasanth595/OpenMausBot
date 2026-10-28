// The verified session's `clouds` (contract v1, additive): every Cloud this person owns and every team's Cloud they are
// in, the account's primary Cloud first. Only the Admin lists a Cloud; a page never names one.
import { CLOUD_SETUP_STEPS, homeOrigin } from "./cloud-home.mjs";
import environments from "./environments.cjs";

export const MAX_CLOUDS = 20;
export const CLOUD_LIST_STATUSES = Object.freeze(["checkout", "setting_up", "ready", "stopped", "payment_problem", "ended", "offline"]);
/** The Admin's colour swatches, and the saved colour (environments.cjs ENTRY_COLORS) each is shown in here; slate is
 * the plain one. */
export const CLOUD_SWATCH_COLORS = Object.freeze({ blue: "blue", green: "teal", amber: "yellow", rose: "red", violet: "purple", slate: null });
export const CLOUD_SWATCHES = Object.freeze(Object.keys(CLOUD_SWATCH_COLORS));
export const CLOUD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const CLOUD_NAME_LIMIT = 40;
const TEAM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TIER = /^[a-z][a-z0-9-]{0,23}$/;
const RUNS_ON = Object.freeze(["cloud", "server"]);
/** Each status as the app's machine summary (cloud-home.mjs CLOUD_MACHINE_STATUSES) reads it; a Cloud still at checkout
 * has none yet, and one offline is opened, so its own screen says it does not answer. */
const MACHINE_STATUS = Object.freeze({ setting_up: "provisioning", ready: "ready", stopped: "stopped", payment_problem: "payment-problem", ended: "stopped", offline: "ready" });
/** How far along each setup step is, for an Admin that names the step only. */
const STEP_PROGRESS = Object.freeze({ reserving: 0.15, storage: 0.4, starting: 0.65, checking: 0.9 });

const record = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A Cloud's name as the Admin keeps it: 1 to 40 characters, spaces folded, nothing a page could take for markup. */
export function cleanCloudListName(value) {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name && [...name].length <= CLOUD_NAME_LIMIT && !/[\p{Cc}<>]/u.test(name) ? name : null;
}

function setupOf(input) {
  if (!record(input)) return null;
  const step = CLOUD_SETUP_STEPS.includes(input.step) ? input.step : null;
  const progress = typeof input.progress === "number" && Number.isFinite(input.progress) ? Math.max(0, Math.min(1, input.progress)) : null;
  return step || progress !== null ? { ...(step ? { step } : {}), ...(progress !== null ? { progress } : {}) } : null;
}

/** One Cloud, or null when anything the app acts on is malformed (never trusted in part); a malformed colour, tier or
 * setup is simply left out. */
function parseCloudEntry(input) {
  if (!record(input) || typeof input.id !== "string" || !CLOUD_ID.test(input.id)) return null;
  const name = cleanCloudListName(input.name);
  if (!name || !environments.TEAM_ROLES.includes(input.role) || !CLOUD_LIST_STATUSES.includes(input.status) || !RUNS_ON.includes(input.runsOn) || typeof input.primary !== "boolean") return null;
  const origin = input.origin === null || input.origin === undefined ? null : homeOrigin(input.origin);
  if ((input.origin !== null && input.origin !== undefined && !origin) || (["ready", "offline"].includes(input.status) && !origin)) return null;
  const teamId = input.teamId === null || input.teamId === undefined ? null : typeof input.teamId === "string" && TEAM_ID.test(input.teamId) ? input.teamId : undefined;
  if (teamId === undefined) return null;
  const setup = input.status === "setting_up" ? setupOf(input.setup) : null;
  return { id: input.id, name, color: Object.hasOwn(CLOUD_SWATCH_COLORS, input.color) ? input.color : null, role: input.role,
    tier: typeof input.tier === "string" && TIER.test(input.tier) ? input.tier : null, runsOn: input.runsOn, status: input.status, origin, teamId,
    primary: input.primary, ...(setup ? { setup } : {}) };
}

/** A Cloud this person owns that is no team's: a world of their own. */
export const ownCloud = cloud => Boolean(cloud) && cloud.teamId === null && cloud.role === "owner";

/**
 * The session's list, at most MAX_CLOUDS, each Cloud once; null when the Admin sends none (it predates many Clouds, and
 * the session's `cloud` and `teams` say everything). At most one Cloud is primary, and only one of the person's own.
 */
export function parseCloudList(input) {
  if (!Array.isArray(input)) return null;
  const clouds = [], seen = new Set();
  let primary = false;
  for (const entry of input.slice(0, MAX_CLOUDS)) {
    const cloud = parseCloudEntry(entry);
    if (!cloud || seen.has(cloud.id)) continue;
    seen.add(cloud.id);
    const first = cloud.primary && !primary && ownCloud(cloud);
    if (first) primary = true;
    clouds.push(first === cloud.primary ? cloud : { ...cloud, primary: false });
  }
  return clouds;
}

/** Every Cloud of the person's own besides the primary (My Cloud): each a place of its own, as a team's Cloud is. */
export function otherOwnClouds(clouds) {
  return Array.isArray(clouds) ? clouds.filter(cloud => ownCloud(cloud) && !cloud.primary) : [];
}

/** The Cloud as the app's machine summary (cloud-home.mjs parseCloudSummary's shape); null while it is still at checkout. */
export function cloudMachine(cloud) {
  const status = cloud ? MACHINE_STATUS[cloud.status] : undefined;
  if (!status) return null;
  return { status, ...(cloud.origin ? { origin: cloud.origin } : {}), ...(status === "provisioning" && cloud.setup?.step ? { setup: { step: cloud.setup.step } } : {}) };
}

/** How far along a setup step is (0 to 1). */
export const stepProgress = step => (Object.hasOwn(STEP_PROGRESS, step) ? STEP_PROGRESS[step] : 0);

/** How far a Cloud being set up is (0 to 1), from the Admin's progress or else its step; 0 while it waits for its
 * payment, null once it is not being set up. */
export function cloudSetupProgress(cloud) {
  if (cloud?.status === "checkout") return 0;
  if (cloud?.status !== "setting_up") return null;
  return cloud.setup?.progress ?? stepProgress(cloud.setup?.step);
}

/** The colour a Cloud is shown in here: its swatch's, or none (slate, or no colour chosen). */
export const swatchColor = swatch => (Object.hasOwn(CLOUD_SWATCH_COLORS, swatch) ? CLOUD_SWATCH_COLORS[swatch] : null);

/** A Cloud of the person's own besides My Cloud, as a saved place (environments.cjs withOwnCloud): its id, name, colour and address. */
export function ownCloudPlaces(clouds) {
  return otherOwnClouds(clouds).filter(cloud => cloud.origin).map(cloud => ({ id: cloud.id, role: cloud.role, name: cloud.name, color: swatchColor(cloud.color), origin: cloud.origin }));
}
