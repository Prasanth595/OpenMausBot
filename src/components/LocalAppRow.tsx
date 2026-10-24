import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { updateMcpServers, useMcpServers, type McpServerSummary } from "@/lib/mcp-servers";
import { api, useStore } from "@/state/store";
import { LOCAL_APPS } from "../../shared/local-apps";
import { openBotSettings } from "./bot-panel/panel-link";

export function useLocalApps(): Map<string, McpServerSummary> {
  const { servers } = useMcpServers();
  return new Map((servers ?? []).flatMap((server) => {
    if (!server.localApp) return [];
    const slugs = Object.entries(LOCAL_APPS).filter(([slug, recipe]) => (recipe.server ?? slug) === server.localApp).map(([slug]) => slug);
    return (slugs.length ? slugs : [server.localApp]).map((slug) => [slug, server] as const);
  }));
}

export function localAppRunning(server: McpServerSummary | undefined): boolean {
  return Boolean(server?.enabled && !server.runsOn);
}

export function LocalAppRow({ slug, label, server, onChange }: { slug: string; label: string; server?: McpServerSummary; onChange: () => void }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipe = Object.hasOwn(LOCAL_APPS, slug) ? LOCAL_APPS[slug] : undefined;
  if (!recipe) return null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = server?.name ?? recipe.server ?? slug;
      if (!server) {
        const added = await api("/api/mcp/servers", { method: "POST", body: JSON.stringify({ name, command: recipe.command, args: recipe.args, env: values, localApp: name }) });
        updateMcpServers(added.servers ?? []);
      }
      const probe: { ok: boolean; error?: string } = await api(`/api/mcp/servers/${name}/test`, { method: "POST" });
      if (!probe.ok) throw new Error(t("localApps.testFailed", { reason: probe.error ?? "" }));
      const enabled = await api(`/api/mcp/servers/${name}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
      updateMcpServers(enabled.servers ?? []);
      setValues({});
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const failed = error && <p role="alert" className="mt-1.5 text-[12px] text-danger">{error}</p>;
  const button = "inline-flex h-7 shrink-0 items-center gap-2 rounded-full bg-control/80 px-3 text-[13px] font-medium leading-5 text-ink hover:bg-raised-hover disabled:opacity-40";

  if (server?.runsOn) {
    return <p data-local-app={slug} className="mt-1 text-[12px] text-ink-secondary">{t("mcp.runsOn", { computer: server.runsOn.label })}</p>;
  }

  if (server?.enabled) {
    return (
      <div data-local-app={slug} className="text-[12px] text-ink-secondary">
        <p className="mt-1 flex items-center gap-1.5 text-ink"><Check size={13} strokeWidth={2.5} className="shrink-0 text-success" />{t("localApps.running")}</p>
        <details className="mt-1">
          <summary className="cursor-pointer">{t("localApps.access")}</summary>
          <p className="mt-2 leading-relaxed">{t("localApps.accessHint", { name: server.name })}</p>
          <div className="mt-2 flex flex-wrap gap-2">{state.bots.filter((bot) => !bot.hidden).map((bot) => <button key={bot.id} type="button" onClick={() => { dispatch({ type: "togglePlugins", open: false }); openBotSettings(dispatch, "access", { botId: bot.id, page: "mcp" }); }} className="rounded-lg bg-control px-2.5 py-1.5 text-ink hover:bg-raised-hover">{t("localApps.botSettings", { name: bot.name })}</button>)}</div>
        </details>
      </div>
    );
  }

  if (server) {
    return (
      <div data-local-app={slug} className="text-[12px] text-ink-secondary">
        <div className="mt-1 flex items-center justify-between gap-2">
          <p>{t("localApps.saved", { name: server.name })}</p>
          <button type="button" disabled={busy} onClick={() => void start()} className={button}>{busy && <Loader2 size={14} className="animate-spin" />}{t("localApps.start")}</button>
        </div>
        {failed}
      </div>
    );
  }

  if (!open) {
    return (
      <div data-local-app={slug}>
        <button type="button" onClick={() => setOpen(true)} className="mt-1 text-[12px] font-medium text-ink-secondary underline underline-offset-2 hover:text-ink">{t("localApps.runHere")}</button>
      </div>
    );
  }

  return (
    <form
      data-local-app={slug}
      className="mt-2 text-[12px] text-ink-secondary"
      onSubmit={(event) => { event.preventDefault(); void start(); }}
    >
      <p className="leading-relaxed">{t("localApps.intro", { app: label })}</p>
      {recipe.signIn && <p className="mt-1.5 leading-relaxed">{t(`localApps.signIn.${recipe.signIn}`)}</p>}
      <code className="mt-1.5 block break-all rounded-lg bg-inset px-2.5 py-1.5 font-mono text-[11.5px] text-ink">{[recipe.command, ...recipe.args].join(" ")}</code>
      <a href={recipe.source} target="_blank" rel="noreferrer" className="mt-1 inline-block underline underline-offset-2 hover:text-ink">{t("localApps.source")}</a>
      {recipe.env.map((entry) => (
        <label key={entry.name} className="mt-2 block">
          <span className="flex items-center justify-between gap-2 font-mono text-[11.5px] text-ink">
            {entry.name}
            {entry.url && <a href={entry.url} target="_blank" rel="noreferrer" className="font-sans text-ink-secondary underline underline-offset-2 hover:text-ink">{t("localApps.getIt")}</a>}
          </span>
          <input
            type={entry.secret ? "password" : "text"}
            required
            autoComplete="off"
            value={values[entry.name] ?? ""}
            onChange={(event) => setValues((current) => ({ ...current, [entry.name]: event.target.value }))}
            className="mt-1 h-8 w-full rounded-full bg-inset px-3 text-[12.5px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      ))}
      {failed}
      <div className="mt-2 flex items-center gap-2">
        <button type="submit" disabled={busy || recipe.env.some((entry) => !values[entry.name]?.trim())} className="inline-flex h-7 shrink-0 items-center gap-2 rounded-full bg-accent px-3 text-[13px] font-medium leading-5 text-accent-ink disabled:opacity-40">
          {busy && <Loader2 size={14} className="animate-spin" />}{t("localApps.start")}
        </button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setValues({}); setError(null); }} className={button}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
