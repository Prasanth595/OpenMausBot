// Plays the Admin's half of the home contract (server/cloud-home.ts) against a home on this host: HMAC-SHA256 signed
// requests with the bootstrap secret, a pairing window and its redeem, the health and box reads, and the pairing
// lockout. Prints status codes and fixed fields only, never the secret, a pairing code, a credential or a token.
//   node admin.mjs box | wait-box <seconds> | health | pair | lockout
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:http";

const port = Number(process.env.HOME_PORT ?? 18080);
const host = process.env.HOME_HOST ?? "home.spike.invalid";
const secret = readFileSync(process.env.SECRET_FILE ?? "", "utf8").trim();

function call(method, path, { body = "", headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = request({
      host: "127.0.0.1", port, method, path, timeout: 20_000,
      headers: { host, ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}), ...headers },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({ status: 0, text: error.message }));
    req.end(body || undefined);
  });
}

/** Must match server/cloud-home.ts cloudRequestSignature. */
function signedHeaders(method, target, body, key) {
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("base64url");
  const bodyHash = createHash("sha256").update(body).digest("base64url");
  const signature = createHmac("sha256", key).update(`v1\n${timestamp}\n${nonce}\n${method}\n${target}\n${bodyHash}`).digest("base64url");
  return { "x-omb-cloud-timestamp": timestamp, "x-omb-cloud-nonce": nonce, "x-omb-cloud-signature": `v1=${signature}` };
}

const signed = (method, path, body = "", extra = {}, key = secret) => call(method, path, { body, headers: { ...signedHeaders(method, path, body, key), ...extra } });
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function box() {
  const response = await signed("GET", "/api/cloud/box");
  return { status: response.status, ...(parse(response.text) ?? { text: response.text.slice(0, 200) }) };
}

const [command, arg] = process.argv.slice(2);
if (command === "box") print(await box());
else if (command === "wait-box") {
  // The boot self-check runs 5 s after the server starts; the report carries its count once it has run.
  const until = Date.now() + Number(arg ?? 90) * 1000;
  let last = await box();
  while (Date.now() < until && last.status === 200 && last.box === "bwrap" && !last.checks) { await sleep(2000); last = await box(); }
  print(last);
} else if (command === "health") {
  const response = await signed("GET", "/api/cloud/health");
  const report = parse(response.text);
  const unsigned = await call("GET", "/api/cloud/health");
  print({
    status: response.status, unsignedStatus: unsigned.status, version: report?.version ?? null, image: report?.image ?? null,
    box: report?.box ? { box: report.box.box, reason: report.box.reason, checks: report.box.checks, failed: report.box.failed, hardening: report.box.hardening } : null,
    fields: report ? Object.keys(report).sort() : [],
  });
} else if (command === "pair") {
  // A Team Cloud pairs a person only with the Admin's claim of who they are on the team (server/cloud-team.ts).
  const team = process.env.TEAM_ID ? { team: { id: process.env.TEAM_ID }, member: { email: "owner@spike.invalid", role: "owner" } } : {};
  const body = JSON.stringify({ label: "own-server spike", ttlSeconds: 120, ...team });
  const opened = await signed("POST", "/api/cloud/pairing", body);
  const window = parse(opened.text);
  let redeem = null, session = null;
  if (window?.code) {
    const redeemed = await call("POST", "/api/auth/pair", { body: JSON.stringify({ code: window.code, label: "own-server spike" }) });
    const token = parse(redeemed.text)?.token;
    redeem = { status: redeemed.status, token: typeof token === "string" ? `${token.length} chars` : null };
    if (typeof token === "string") session = { status: (await call("GET", "/api/auth/session", { headers: { authorization: `Bearer ${token}` } })).status };
  }
  const replay = await call("GET", "/api/cloud/box", { headers: { "x-omb-cloud-timestamp": "1", "x-omb-cloud-nonce": "x".repeat(22), "x-omb-cloud-signature": `v1=${"A".repeat(43)}` } });
  print({ pairing: { status: opened.status, code: window?.code ? "issued" : null, error: window?.error ?? null }, redeem, session, badSignatureStatus: replay.status });
} else if (command === "lockout") {
  // A bad pairing signature counts toward the lockout (10 a minute, then 60 s), keyed on the client address the edge
  // forwards. The edge (deploy/fly/Caddyfile) takes that address from Fly-Client-IP whenever the peer is on a private
  // range, which on Fly is always Fly's proxy. A wrong key gives a bad signature.
  const bad = (headers = {}) => signed("POST", "/api/cloud/pairing", "{}", headers, "x".repeat(43)).then((response) => response.status);
  const sameForged = [];
  for (let i = 0; i < 11; i += 1) sameForged.push(await bad({ "fly-client-ip": "198.51.100.7" }));
  const newForged = await bad({ "fly-client-ip": "198.51.100.8" });
  const shared = [];
  for (let i = 0; i < 10; i += 1) shared.push(await bad());
  const team = process.env.TEAM_ID ? { team: { id: process.env.TEAM_ID }, member: { email: "owner@spike.invalid", role: "owner" } } : {};
  const adminAfter = (await signed("POST", "/api/cloud/pairing", JSON.stringify({ label: "own-server spike", ttlSeconds: 60, ...team }))).status;
  print({ sameForgedAddress: sameForged, newForgedAddress: newForged, noHeaderTen: shared, validAdminPairingAfterwardsNoHeader: adminAfter });
} else {
  process.stderr.write("usage: admin.mjs box | wait-box <seconds> | health | pair | lockout\n");
  process.exitCode = 2;
}
