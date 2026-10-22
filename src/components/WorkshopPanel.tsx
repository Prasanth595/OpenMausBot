// The Workshop: sketch an idea, hand it to a bot, keep its figures.
//
// The panel is a thin layer over src/lib/workshop-canvas.ts — it owns
// pointer events and shell chrome only, while stroke math, erasing and
// history live in the pure library. The sketch travels to the bot through
// the composer's own pipeline (attachment upload + composeMessage + a store
// `send`), and previews ride the crate's operator doors, so there is no
// second transport anywhere.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { composeMessage, imageAttachmentFromFile } from "@/lib/composer-attachments";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, useStore, visibleMessages, type Bot, type Message } from "@/state/store";
import {
  DEFAULT_COLOR,
  SKETCH_HEIGHT,
  SKETCH_WIDTH,
  WORKSHOP_COLORS,
  beginShape,
  commitShapes,
  emptyHistory,
  eraseAt,
  extendShape,
  redo,
  renderShapes,
  sketchToPngFile,
  undo,
  type History,
  type Shape,
  type ToolId,
} from "@/lib/workshop-canvas";

/** The prompt the bot receives with the sketch attached. It carries a
 * trigger term ("isometric", "workshop figure") on purpose: the anatomy
 * skill mounts through the turn's own text matching, so the prompt and the
 * skill unlock each other without wiring. */
export function promptForSketch(note: string): string {
  const trimmed = note.trim();
  const lead = "Here is my sketch — build it as a detailed isometric workshop figure.";
  return trimmed ? `${lead}\n\n${trimmed}` : lead;
}

/** Sketched-figure files preview only through this gate: bare generated
 * names only, same discipline as attachment image URLs — a hostile name can
 * never become a local URL, and a remote-looking answer renders nothing. */
export function figurePreviewUrl(name: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) return null;
  if (!name.endsWith(".svg")) return null;
  return `/api/workshop/files/${encodeURIComponent(name)}`;
}

const TOOL_LABELS: Record<ToolId, Parameters<typeof t>[0]> = {
  pen: "workshop.tool.pen",
  line: "workshop.tool.line",
  arrow: "workshop.tool.arrow",
  box: "workshop.tool.box",
  ellipse: "workshop.tool.ellipse",
  label: "workshop.tool.label",
  eraser: "workshop.tool.eraser",
};

const TOOL_ORDER: ToolId[] = ["pen", "line", "arrow", "box", "ellipse", "label", "eraser"];

const TOOL_GLYPHS: Record<ToolId, string> = {
  pen: "✎",
  line: "／",
  arrow: "↗",
  box: "▢",
  ellipse: "◯",
  label: "A",
  eraser: "⌫",
};

function botCanOpenImages(
  bot: Bot | null | undefined,
  instances: Array<{ instanceId: string; capabilities?: { images?: boolean } }>,
): boolean {
  return Boolean(bot && instances.find((entry) => entry.instanceId === bot.modelSelection.instanceId)?.capabilities?.images);
}

type CrateListing = { enabled: boolean; files: Array<{ name: string; bytes: number; updatedAt: string }> };

export function WorkshopPanel() {
  const { state, dispatch } = useStore();
  const [history, setHistory] = useState<History>(emptyHistory());
  const [draft, setDraft] = useState<Shape | null>(null);
  const [tool, setTool] = useState<ToolId>("pen");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [width, setWidth] = useState(3);
  const [labelDraft, setLabelDraft] = useState("");
  const [note, setNote] = useState("");
  const [targetBotId, setTargetBotId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [listing, setListing] = useState<CrateListing | null>(null);
  const [crateReachable, setCrateReachable] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragModeRef = useRef<"draw" | "erase" | null>(null);
  const eraseWorkingRef = useRef<Shape[] | null>(null);
  const eraseChangedRef = useRef(false);
  const liveScrollRef = useRef<HTMLDivElement>(null);

  const shapes = history.present;
  const targetBot = state.bots.find((bot) => bot.id === targetBotId) ?? null;

  // ── painting ───────────────────────────────────────────────────────
  const paintScene = useCallback((toPaint: Shape[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The app canvas shows a paper ground; the exported PNG is plain white —
    // deliberate, since the export is what bots read and stamps sit better
    // on flat paper here.
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderShapes(ctx, toPaint);
  }, []);

  useEffect(() => {
    paintScene([...shapes, ...(draft ? [draft] : [])]);
  }, [shapes, draft, paintScene]);

  /** Map a pointer event into sketch coordinates, scaling the fixed logical
   * size down into whatever the layout box made of the canvas. */
  const sketchPoint = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * SKETCH_WIDTH),
      y: Math.round(((event.clientY - rect.top) / rect.height) * SKETCH_HEIGHT),
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const at = sketchPoint(event);
    if (tool === "label") {
      if (!labelDraft.trim()) return;
      setHistory((current) => commitShapes(current, [...current.present, beginShape("label", color, width, at, labelDraft.trim())]));
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "eraser") {
      dragModeRef.current = "erase";
      eraseWorkingRef.current = shapes;
      eraseChangedRef.current = false;
      const firstPass = eraseAt(shapes, at);
      eraseChangedRef.current = firstPass.length !== shapes.length;
      eraseWorkingRef.current = firstPass;
      paintScene(firstPass);
      return;
    }
    dragModeRef.current = "draw";
    setDraft(beginShape(tool, color, width, at));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragModeRef.current) return;
    const at = sketchPoint(event);
    if (dragModeRef.current === "erase") {
      const working = eraseWorkingRef.current ?? shapes;
      const next = eraseAt(working, at);
      if (next.length !== working.length) {
        eraseChangedRef.current = true;
        eraseWorkingRef.current = next;
        paintScene(next);
      }
      return;
    }
    setDraft((current) => (current && current.kind !== "label" ? extendShape(current, at) : current));
  };

  const onPointerUp = () => {
    const mode = dragModeRef.current;
    dragModeRef.current = null;
    if (mode === "erase" && eraseChangedRef.current && eraseWorkingRef.current) {
      const committed = eraseWorkingRef.current;
      eraseWorkingRef.current = null;
      eraseChangedRef.current = false;
      setHistory((current) => commitShapes(current, committed));
      return;
    }
    eraseWorkingRef.current = null;
    eraseChangedRef.current = false;
    if (mode === "draw") {
      setDraft((current) => {
        if (current) setHistory((committed) => commitShapes(committed, [...committed.present, current]));
        return null;
      });
    }
  };

  // ── crate listing ──────────────────────────────────────────────────
  const refreshListing = useCallback(() => {
    api("/api/workshop")
      .then((body) => {
        setListing({ enabled: Boolean(body?.enabled), files: Array.isArray(body?.files) ? body.files : [] });
        setCrateReachable(true);
      })
      .catch((error: unknown) => {
        // The flag-off door says 403 with a plain error — that is the gate,
        // not a breakage, and the panel answers it with the Enable affordance.
        if (error instanceof Error && "status" in error && (error as { status?: number }).status === 403) {
          setListing({ enabled: false, files: [] });
          setCrateReachable(true);
          return;
        }
        setListing(null);
        setCrateReachable(false);
      });
  }, []);

  useEffect(() => {
    refreshListing();
  }, [refreshListing]);

  // Keep the figures column honest while a turn runs: refresh when the
  // target thread sees new messages, and tick every few seconds while the
  // bot is busy.
  const targetThreadMessages = useMemo(() => (targetBot ? visibleMessages(targetBot) : []), [targetBot]);
  const lastMessageId = targetThreadMessages.length ? targetThreadMessages[targetThreadMessages.length - 1]!.id : undefined;
  useEffect(() => {
    if (lastMessageId) refreshListing();
  }, [lastMessageId, refreshListing]);
  useEffect(() => {
    if (!targetBot?.busy) return;
    const timer = setInterval(refreshListing, 5_000);
    return () => clearInterval(timer);
  }, [targetBot?.busy, refreshListing]);

  // ── handoff ────────────────────────────────────────────────────────
  const retrospective = useMemo(() => targetThreadMessages.slice(-6), [targetThreadMessages]);
  const busy = Boolean(targetBot?.busy);
  const imageReady = botCanOpenImages(targetBot, state.instances);

  useEffect(() => {
    const pane = liveScrollRef.current;
    if (pane) pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
  }, [retrospective.length, busy]);

  const send = async () => {
    if (!targetBot || sending || !shapes.length || busy) return;
    setSending(true);
    setActionError(null);
    try {
      const exported = await sketchToPngFile(shapes);
      if (!exported) throw new Error(t("workshop.error.export"));
      const attachment = await imageAttachmentFromFile(exported.file);
      if (!attachment) throw new Error(t("workshop.error.upload"));
      const body = composeMessage(promptForSketch(note), [attachment]);
      dispatch({
        type: "send",
        botId: targetBot.id,
        text: body,
        sendId: globalThis.crypto?.randomUUID?.() ?? `w${Date.now().toString(36)}`,
        onError: () => setActionError(t("workshop.error.send")),
      });
      setNote("");
      setHistory((current) => commitShapes(current, []));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("workshop.error.upload"));
    } finally {
      setSending(false);
    }
  };

  const removeFigure = (name: string) => {
    api(`/api/workshop/files/${encodeURIComponent(name)}`, { method: "DELETE" })
      .then(() => refreshListing())
      .catch(() => setCrateReachable(false));
  };

  const enableWorkshop = async () => {
    await api("/api/config", { method: "PATCH", body: JSON.stringify({ features: { workshop: true } }) });
    refreshListing();
  };

  const close = () => dispatch({ type: "toggleWorkshop", open: false });
  const gateShowing = listing && !listing.enabled;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workshop-title"
        tabIndex={-1}
        className="animate-pop-in flex h-[min(820px,calc(100dvh-2rem))] w-full max-w-[1240px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
      >
        <header className="flex items-start justify-between gap-4 px-6 pb-3 pt-6 sm:px-8 sm:pt-7">
          <div>
            <h2 id="workshop-title" className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{t("workshop.title")}</h2>
            <p className="mt-1 text-[13px] text-ink-secondary">{t("workshop.subtitle")}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refreshListing}
              className="rounded-full px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised"
            >{t("workshop.figures.refresh")}</button>
            <button
              onClick={close}
              aria-label={t("workshop.close")}
              className="rounded-full px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised"
            >✕</button>
          </div>
        </header>

        {gateShowing ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 pb-10 text-center">
            <h3 className="text-[17px] font-semibold text-ink">{t("workshop.gate.title")}</h3>
            <p className="max-w-[440px] text-[13px] leading-relaxed text-ink-secondary">{t("workshop.gate.body")}</p>
            <button
              onClick={enableWorkshop}
              className="mt-2 rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-white hover:brightness-110"
            >{t("workshop.gate.enable")}</button>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.8fr)] divide-x divide-hairline/40">
            {/* sketch */}
            <section className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-1">
                {TOOL_ORDER.map((id) => (
                  <button
                    key={id}
                    onClick={() => setTool(id)}
                    title={t(TOOL_LABELS[id])}
                    className={cn(
                      "size-8 rounded-lg text-[14px] text-ink-secondary transition-colors",
                      tool === id ? "bg-raised text-ink" : "hover:bg-raised/60",
                    )}
                  >{TOOL_GLYPHS[id]}</button>
                ))}
                <div className="mx-1 h-6 w-px bg-hairline/60" />
                {WORKSHOP_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    onClick={() => setColor(swatch)}
                    aria-label={swatch}
                    className={cn(
                      "size-5 rounded-full border border-black/20 transition-transform",
                      color === swatch && "scale-110 ring-2 ring-accent/60",
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
                <div className="mx-1 h-6 w-px bg-hairline/60" />
                {[2, 3, 6, 10].map((w) => (
                  <button
                    key={w}
                    onClick={() => setWidth(w)}
                    className={cn("rounded-lg px-2 py-1 text-[12px]", width === w ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60")}
                  >{w}px</button>
                ))}
                <div className="ms-auto flex items-center gap-1">
                  <button
                    disabled={!history.past.length}
                    onClick={() => setHistory((current) => undo(current))}
                    className="rounded-lg px-2 py-1 text-[13px] text-ink-secondary hover:bg-raised/60 disabled:opacity-40"
                  >{t("workshop.pin.undo")}</button>
                  <button
                    disabled={!history.future.length}
                    onClick={() => setHistory((current) => redo(current))}
                    className="rounded-lg px-2 py-1 text-[13px] text-ink-secondary hover:bg-raised/60 disabled:opacity-40"
                  >{t("workshop.pin.redo")}</button>
                  <button
                    disabled={!shapes.length && !draft}
                    onClick={() => {
                      setDraft(null);
                      setHistory((current) => commitShapes(current, []));
                    }}
                    className="rounded-lg px-2 py-1 text-[13px] text-ink-secondary hover:bg-raised/60 disabled:opacity-40"
                  >{t("workshop.pin.clear")}</button>
                </div>
              </div>
              <div className="relative min-h-[260px] flex-1 overflow-hidden rounded-2xl border border-hairline/60 bg-[#101014]">
                <canvas
                  ref={canvasRef}
                  width={SKETCH_WIDTH}
                  height={SKETCH_HEIGHT}
                  className="size-full touch-none"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerUp}
                />
              </div>
              {tool === "label" && (
                <input
                  value={labelDraft}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  placeholder={t("workshop.pin.labelHint")}
                  className="w-full rounded-xl border border-hairline/60 bg-raised/40 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-secondary/70 focus:border-accent/60"
                />
              )}
              {actionError && <p className="text-[12px] text-danger">{actionError}</p>}
            </section>

            {/* bot */}
            <section className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4 sm:p-5">
              <select
                value={targetBotId ?? ""}
                onChange={(event) => setTargetBotId(event.target.value || null)}
                className="w-full rounded-xl border border-hairline/60 bg-raised/40 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent/60"
              >
                <option value="">{t("workshop.bot.noneSelected")}</option>
                {state.bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {botCanOpenImages(bot, state.instances)
                      ? t("workshop.bot.optionImageReady", { name: bot.name })
                      : t("workshop.bot.optionNoImages", { name: bot.name })}
                  </option>
                ))}
              </select>
              {!state.bots.length && (
                <p className="text-[12px] text-ink-secondary">{t("workshop.bot.noBots")}</p>
              )}
              <div>
                <span className="text-[12px] font-medium text-ink-secondary">{t("workshop.bot.noteLabel")}</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder={t("workshop.bot.notePlaceholder")}
                  className="mt-1 w-full resize-none rounded-xl border border-hairline/60 bg-raised/40 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-secondary/70 focus:border-accent/60"
                />
              </div>
              <button
                disabled={!shapes.length || !targetBot || !imageReady || sending || busy}
                onClick={send}
                className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >{sending ? t("workshop.bot.sending") : t("workshop.bot.send")}</button>
              {targetBot && !imageReady && (
                <p className="text-[12px] text-danger">{t("workshop.bot.noImageSupport")}</p>
              )}

              <div className="flex min-h-[220px] flex-1 flex-col">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[12px] font-medium text-ink-secondary">{t("workshop.live.title")}</span>
                  {targetBot && (
                    <button
                      onClick={() => {
                        dispatch({ type: "select", id: targetBot.id });
                        dispatch({ type: "toggleWorkshop", open: false });
                      }}
                      className="rounded-full px-3 py-1 text-[12px] text-accent hover:bg-accent/10"
                    >{t("workshop.live.openChat")}</button>
                  )}
                </div>
                <div ref={liveScrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl border border-hairline/40 bg-raised/20 p-3">
                  {!targetBot && <p className="text-[12px] text-ink-secondary">{t("workshop.live.idle")}</p>}
                  {targetBot && retrospective.map((message) => <LiveLine key={message.id} message={message} />)}
                  {busy && (
                    <div className="flex items-center gap-2 text-[12px] text-ink-secondary">
                      <span className="inline-block size-1.5 animate-pulse rounded-full bg-accent" />
                      {t("workshop.bot.working")}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* figures */}
            <section className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-ink-secondary">{t("workshop.figures.title")}</span>
                {listing?.files.length ? (
                  <button onClick={refreshListing} className="text-[12px] text-ink-secondary hover:text-ink">{t("workshop.figures.refresh")}</button>
                ) : null}
              </div>
              {!crateReachable && <p className="text-[12px] text-danger">{t("workshop.error.list")}</p>}
              <div className="min-h-0 flex-1 space-y-2">
                {listing?.files.length ? listing.files.map((file) => {
                  const preview = figurePreviewUrl(file.name);
                  return (
                    <div key={file.name} className="rounded-xl border border-hairline/40 bg-raised/20 p-2">
                      <div className="flex items-center gap-2">
                        {preview ? (
                          <a
                            href={preview}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg bg-black/30 p-1"
                            title={t("workshop.figures.open")}
                          >
                            <img src={preview} alt={file.name} className="h-16 w-24 object-contain" />
                          </a>
                        ) : (
                          <code className="rounded-lg bg-black/30 px-2 py-1 text-[11px] text-ink-secondary">{file.name}</code>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] text-ink" title={file.name}>{file.name}</div>
                          <div className="text-[11px] text-ink-secondary">{Math.max(1, Math.ceil(file.bytes / 1024))} KB</div>
                        </div>
                        <button
                          onClick={() => removeFigure(file.name)}
                          className="rounded-lg px-2 py-1 text-[11px] text-ink-secondary hover:text-danger"
                        >{t("workshop.figures.remove")}</button>
                      </div>
                    </div>
                  );
                }) : (
                  <p className="text-[12px] text-ink-secondary">{t("workshop.figures.empty")}</p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** One line in the live turn view: who said it and what it said, trimmed to
 * what matters for watching a figure get built. */
export function LiveLine({ message }: { message: Message }) {
  const isBot = message.role === "bot";
  const text = (message.text ?? "").slice(0, 600);
  return (
    <div className={cn(
      "max-w-full rounded-xl px-3 py-2 text-[12px] leading-relaxed",
      isBot ? "bg-raised text-ink" : "bg-accent/10 text-ink",
    )}>
      <div className="max-h-40 overflow-hidden whitespace-pre-wrap">{text}</div>
    </div>
  );
}
