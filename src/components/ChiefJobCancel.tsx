import { useEffect, useRef, useState } from "react";
import { api } from "@/state/api";
import type { JobCancellationResult, JobCancellationSnapshot } from "../../shared/job-cancellation";

interface NativeJobView {
  roots: string[];
  nodes: Array<{ id: string; rootId?: string; parentId?: string; botId: string; threadId: string; status: string; sourceRequest?: string }>;
}

export function chiefJobRoots(job: NativeJobView, botId: string, threadId: string): string[] {
  const roots = new Set(job.roots);
  return job.nodes.filter(node => roots.has(node.id) && !node.parentId && node.botId === botId && node.threadId === threadId &&
    job.nodes.some(member => (member.id === node.id || member.rootId === node.id) &&
      !["completed", "failed", "cancelled"].includes(member.status))).map(node => node.id);
}

export function ChiefJobCancelActions({ chief, canWrite, roots, pending, onCancel, sourceRequests = {} }: {
  chief: boolean; canWrite: boolean; roots: string[]; pending: string | null; onCancel(rootId: string): void;
  sourceRequests?: Record<string, string>;
}) {
  if (!chief || !canWrite || roots.length === 0) return null;
  return <div className="flex flex-wrap justify-end gap-2">
    {roots.map(rootId => <button key={rootId} type="button" disabled={pending !== null}
      onClick={() => onCancel(rootId)} title={`${sourceRequests[rootId] ? `${sourceRequests[rootId]}\n` : ""}Cancel job ${rootId}, including running hand-offs`}
      className="pointer-events-auto max-w-full rounded-full border border-danger/30 bg-raised px-3 py-1 text-left text-[12px] font-medium text-danger disabled:opacity-50">
      <span className="block max-w-[min(28rem,70vw)] truncate">{pending === rootId ? "Cancelling job…" : sourceRequests[rootId]
        ? `Cancel: ${sourceRequests[rootId]}` : roots.length === 1 ? "Cancel job" : `Cancel job ${rootId.slice(0, 8)}`}</span>
    </button>)}
  </div>;
}

export function ChiefJobCancel({ botId, threadId, activeLeafId, busy, waiting, receipts = [] }: {
  botId: string; threadId: string; activeLeafId?: string | null; busy: boolean; waiting: boolean;
  receipts?: JobCancellationResult[];
}) {
  const [roots, setRoots] = useState<string[]>([]);
  const [sourceRequests, setSourceRequests] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const revision = useRef(0);
  useEffect(() => {
    const current = ++revision.current;
    const abort = new AbortController();
    setRoots([]); setSourceRequests({}); setPending(null); setMessage("");
    void api<NativeJobView>(`/api/threads/${encodeURIComponent(threadId)}/job?since=0`, { signal: abort.signal, background: true })
      .then(job => { if (revision.current === current) {
        setRoots(chiefJobRoots(job, botId, threadId));
        setSourceRequests(Object.fromEntries(job.nodes.flatMap(node => !node.parentId && node.sourceRequest ? [[node.id, node.sourceRequest] as const] : [])));
      } })
      .catch(() => {});
    return () => { abort.abort(); revision.current++; };
  }, [botId, threadId, activeLeafId, busy, waiting]);

  const cancel = async (rootId: string) => {
    const current = revision.current;
    setPending(rootId); setMessage("");
    const base = `/api/bots/${encodeURIComponent(botId)}/jobs/${encodeURIComponent(rootId)}`;
    try {
      const snapshot = await api<JobCancellationSnapshot>(`${base}/cancellation`);
      const result = await api<JobCancellationResult>(`${base}/cancel`, { method: "POST", body: JSON.stringify(snapshot) });
      if (revision.current !== current) return;
      setMessage(result.state === "partial" ? "Cancellation is partial. Read the job status for work still active." : "Job cancelled. Partial reports are retained.");
      if (result.state === "cancelled") setRoots(previous => previous.filter(id => id !== rootId));
    } catch (error) {
      if (revision.current === current) setMessage(error instanceof Error ? error.message : "Cancellation was not confirmed.");
    } finally { if (revision.current === current) setPending(null); }
  };
  const latestReceipt = receipts.at(-1);
  const savedMessage = latestReceipt ? latestReceipt.state === "partial"
    ? "Cancellation is partial. Local work has not confirmed it stopped; partial reports are retained."
    : "Job cancelled. Partial reports are retained." : "";
  return <div className="pointer-events-auto px-5 pb-2">
    <ChiefJobCancelActions chief canWrite roots={roots} sourceRequests={sourceRequests} pending={pending} onCancel={rootId => { void cancel(rootId); }} />
    {(message || savedMessage) && <p role="status" className="mt-1 text-right text-[12px] text-ink-secondary">{message || savedMessage}</p>}
  </div>;
}
