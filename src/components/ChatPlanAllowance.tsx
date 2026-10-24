import { useEffect, useRef, useState } from "react";
import { api } from "@/state/api";
import type { Bot, ModelSelection, Task, TaskUsage } from "@/state/store";
import { formatTokens } from "@/lib/usage";
import { t } from "@/lib/i18n";
import { useUsageDisplay } from "@/lib/usage-display-preferences";

type PlanWindow = {
  available: boolean;
  remainingPercent: number | null;
  usedPercent: number | null;
  resetsAt: string | null;
};

type PlanProvider = {
  id: string;
  name: string;
  ok: boolean;
  fiveHour: PlanWindow;
};

type PlanUsageReport = { providers: PlanProvider[] };

export type ChatPlanAllowance = {
  name: string;
  available: boolean;
  remainingPercent: number | null;
  usedPercent: number | null;
  resetsAt: string | null;
};

/** The current thread context, not the cumulative subscription usage. */
export function contextAllowanceLabel(usage?: TaskUsage): string | null {
  const tokens = usage?.context?.tokens;
  return typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0
    ? `ctx ${formatTokens(tokens)}`
    : null;
}

/** Only the thread's effective subscription engine (its own override, else the bot's) gets an allowance. */
export function chatPlanAllowance(selection: Pick<ModelSelection, "instanceId">, report: PlanUsageReport): ChatPlanAllowance | null {
  const provider = report.providers.find((row) => row.id === selection.instanceId);
  if (!provider) return null;
  return {
    name: provider.name,
    available: provider.ok && provider.fiveHour.available && provider.fiveHour.remainingPercent !== null,
    remainingPercent: provider.fiveHour.remainingPercent,
    usedPercent: provider.fiveHour.usedPercent,
    resetsAt: provider.fiveHour.resetsAt,
  };
}

function resetDistance(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at) || at <= now) return null;
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes < 1) return "less than a minute";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h${mins ? ` ${mins}m` : ""}` : `${mins}m`;
}

function UsageDetails({ allowance, context }: { allowance: ChatPlanAllowance | null; context: string | null }) {
  const contextChip = context && <span
    className="shrink-0 tabular-nums"
    title="Current conversation context sent with the next model request. This is not your total session usage."
  >{context}</span>;
  if (!allowance) return <>{contextChip}</>;
  if (!allowance.available || allowance.remainingPercent === null) {
    return <>
      <span className="shrink-0">{allowance.name} allowance unavailable</span>
      {contextChip}
    </>;
  }
  const used = Math.max(0, Math.min(100, allowance.usedPercent ?? (100 - allowance.remainingPercent)));
  const reset = resetDistance(allowance.resetsAt, Date.now());
  return <>
    <span className="shrink-0 font-medium text-ink">{allowance.name}</span>
    <span className="shrink-0 tabular-nums">{Math.round(allowance.remainingPercent)}% left{reset ? ` · resets in ${reset}` : ""}</span>
    {contextChip}
    <div className="h-1 min-w-12 max-w-28 flex-1 overflow-hidden rounded-full bg-inset" role="meter" aria-label={`${allowance.name} five-hour allowance`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(allowance.remainingPercent)}>
      <div className={used >= 90 ? "h-full bg-danger" : used >= 70 ? "h-full bg-warning" : "h-full bg-success"} style={{ width: `${used}%` }} />
    </div>
  </>;
}

export function ChatPlanAllowance({ bot, task }: { bot: Pick<Bot, "modelSelection">; task?: Pick<Task, "modelSelection" | "usage"> }) {
  const selection = task?.modelSelection ?? bot.modelSelection;
  const display = useUsageDisplay();
  const [report, setReport] = useState<PlanUsageReport | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (display === "never") return;
    let active = true;
    const load = async () => {
      try {
        const next = await api<PlanUsageReport>("/api/plan-usage", { background: true });
        if (active) setReport(next);
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [display]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
      if (event.type === "pointerdown" && root.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  if (display === "never") return null;
  const allowance = report ? chatPlanAllowance(selection, report) : null;
  const context = contextAllowanceLabel(task?.usage);
  if (!allowance && !context) return null;
  const details = <UsageDetails allowance={allowance} context={context} />;

  if (display === "always") {
    return <div className="pointer-events-auto mx-5 mb-2 flex items-center gap-2 text-[11px] text-ink-secondary" data-testid="chat-plan-allowance">
      {details}
    </div>;
  }
  return <div ref={root} className="pointer-events-auto relative mx-5 mb-1 flex" data-testid="chat-usage-tab">
    <button
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => setOpen((value) => !value)}
      className="rounded px-1.5 py-0.5 text-[10px] text-ink-secondary hover:bg-control/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >{t("chat.usage.menu")}</button>
    {open && <div
      role="dialog"
      aria-label={t("chat.usage.menu")}
      data-testid="chat-usage-popup"
      className="absolute bottom-full left-0 z-20 mb-1 flex w-72 max-w-[calc(100vw-2.5rem)] flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-hairline bg-panel p-3 text-[11px] text-ink-secondary shadow-lg"
    >{details}</div>}
  </div>;
}
