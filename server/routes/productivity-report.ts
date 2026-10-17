// /api/reports/productivity: what a repository put in production, per hour,
// day or month, for the owner to take to a review. Opt-in: off until
// OMB_REPORT_REPO names a GitHub repository (owner/name). Listed in ROUTES
// (table.ts): the collector is built on first use, from the data folder and
// the environment; nothing in index.ts. Admin scope (request-auth's default).
//
//   OMB_REPORT_REPO              owner/name, read through `gh` (required)
//   OMB_REPORT_PRODUCTION_TAG    tag that marks production (optional)
//   OMB_REPORT_GATE_CONTEXT      commit-status context of the merge gate (optional; combined status otherwise)
//   OMB_REPORT_RELEASE_LOG       a release watcher's log file (optional; GitHub deployments otherwise)
//   OMB_REPORT_TZ                IANA time zone of the buckets (default: this machine's)
//   OMB_REPORT_HOLIDAYS          "BR" for Brazil's national holidays (default: none)
//   OMB_REPORT_BOT_ROLES         JSON {"<bot id or name>": "engineering" | "operations"}
import { DATA_DIR } from "../config.ts";
import { oldestUsageAt, ProductivityCollector } from "../productivity-collector.ts";
import { executiveSummary, exportFileName, reportMarkdown, reportPdf } from "../productivity-export.ts";
import { configureGithubSources } from "../productivity-github.ts";
import { readUsage } from "../usage-ledger.ts";
import { configureReport, exportReadiness, GRANULARITIES, resolveReportPeriod, type Granularity } from "../../shared/productivity.ts";
import { PASS, type RouteContext } from "./table.ts";

const BASE = "/api/reports/productivity";

export function reportEnv(env: NodeJS.ProcessEnv = process.env): { repo: string; enabled: boolean } {
  const repo = env.OMB_REPORT_REPO?.trim() ?? "";
  return { repo, enabled: /^[\w.-]+\/[\w.-]+$/.test(repo) };
}

function parseRoles(raw: string | undefined): Record<string, "engineering" | "operations"> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, "engineering" | "operations"] => entry[1] === "engineering" || entry[1] === "operations"));
  } catch {
    return {};
  }
}

let collector: ProductivityCollector | null = null;

function service(repo: string): ProductivityCollector {
  if (collector) return collector;
  const env = process.env;
  configureReport({ repo, timeZone: env.OMB_REPORT_TZ?.trim() || undefined, holidays: env.OMB_REPORT_HOLIDAYS?.trim() || undefined, botRoles: parseRoles(env.OMB_REPORT_BOT_ROLES) });
  configureGithubSources({ gateContext: env.OMB_REPORT_GATE_CONTEXT, productionTag: env.OMB_REPORT_PRODUCTION_TAG });
  const log = env.OMB_REPORT_RELEASE_LOG?.trim() ?? "";
  collector = new ProductivityCollector({
    dataDir: DATA_DIR,
    logs: { gz: log ? `${log}.1.gz` : "", out: log },
    // "Precisa de você" and digest timings are not wired upstream yet: their KPIs read as unknown
    ownerPending: () => ({ open: [], resolved: [] }),
    botNames: () => {
      const names = new Map<string, string>();
      const to = new Date();
      for (const row of readUsage(DATA_DIR, { from: new Date(to.getTime() - 90 * 86_400_000), to })) if (row.botName) names.set(row.botId, row.botName);
      return names;
    },
    usage: (range) => readUsage(DATA_DIR, range),
    digests: () => [],
    oldestDigestAt: () => null,
    usageFrom: () => oldestUsageAt(DATA_DIR),
    log: (line) => console.log(line),
  });
  collector.start();
  return collector;
}

export async function productivityReportRoutes({ req, res, url, path, method, json, readBody }: RouteContext): Promise<typeof PASS | void> {
  if (path !== BASE && !path.startsWith(`${BASE}.`) && !path.startsWith(`${BASE}/`)) return PASS;
  const { repo, enabled } = reportEnv();
  res.setHeader("cache-control", "no-store");
  if (!enabled) { json(res, 200, { enabled: false }); return; }
  const productivity = service(repo);
  if (path === `${BASE}/goals` && (method === "GET" || method === "PUT")) {
    if (method === "GET") { json(res, 200, { goals: productivity.getGoals() }); return; }
    const body = await readBody(req, 4096);
    if (!body || typeof body !== "object") { json(res, 400, { error: "send the goals as a JSON object" }); return; }
    json(res, 200, { goals: productivity.setGoals((body as { goals?: unknown }).goals ?? body) });
    return;
  }
  if (method !== "GET" || ![BASE, `${BASE}.md`, `${BASE}.pdf`].includes(path)) return PASS;
  const granularity = (url.searchParams.get("granularity") ?? "day") as Granularity;
  if (!GRANULARITIES.includes(granularity)) { json(res, 400, { error: "granularity must be hour, day or month" }); return; }
  const rawCount = url.searchParams.get("count");
  const count = rawCount === null ? null : Number(rawCount);
  if (count !== null && (!Number.isInteger(count) || count <= 0)) { json(res, 400, { error: "count must be a positive whole number" }); return; }
  const resolved = resolveReportPeriod({ granularity, from: url.searchParams.get("from"), to: url.searchParams.get("to"), count, now: Date.now() });
  if ("error" in resolved) { json(res, 400, { error: resolved.error }); return; }
  if (url.searchParams.get("refresh") === "1") productivity.requestSync();
  const report = { ...productivity.report(granularity, resolved.period), enabled: true };
  report.summary = { "pt-BR": executiveSummary(report, "pt-BR"), en: executiveSummary(report, "en") };
  if (path === BASE) { json(res, 200, report); return; }
  const pdf = path.endsWith(".pdf");
  // a stale or unverified report goes out only when asked (force=1), with the warning on its first page
  const readiness = exportReadiness(report, report.generatedAt);
  if (!readiness.ready && url.searchParams.get("force") !== "1") { json(res, 409, { error: "export-blocked", blockers: readiness.blockers, ageMs: readiness.ageMs }); return; }
  res.writeHead(200, {
    "content-type": pdf ? "application/pdf" : "text/markdown; charset=utf-8",
    "content-disposition": `attachment; filename="${exportFileName(report, pdf ? "pdf" : "md")}"`,
    "cache-control": "no-store",
  });
  res.end(pdf ? reportPdf(report) : reportMarkdown(report));
}
