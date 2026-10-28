import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Archive, ArchiveRestore, BellOff, ChevronLeft, ChevronRight, Clock, FolderInput, Link2, Link2Off, Loader2,
  MoreHorizontal, Pencil, Pin, PinOff, RefreshCw, SquarePen, Trash2,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { llmThreadTitlesEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { reducedMotion } from "@/lib/onboarding";
import { nextRename } from "@/lib/rename";
import { localizedTaskTitle } from "@/lib/task-title";
import { threadRefUrl } from "@/lib/thread-refs";
import { currentTaskBot, openBotThread, useStore, type Action, type Bot, type Task } from "@/state/store";
import { ConfirmDialog } from "./ConfirmDialog";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import {
  isArchived, isSnoozed, isWorking, nextSixPm, orderedThreadList, threadRowActions, tomorrowNineAm,
} from "./SidebarThreadRow";

type TabTask = Task & { queued?: boolean };
type ThreadActions = ReturnType<typeof threadRowActions>;

const displayTitle = (task: TabTask) => localizedTaskTitle(task.title || t("task.newShort"));

/** What a tab says besides its name: a spinner for a running turn or a dot for an unread reply, in words for a reader. */
function tabStatus(task: TabTask): string {
  // A turn waiting on the person still reports busy, so the waiting state has to be read before the working one.
  if (task.activity === "waiting-on-you") return t("task.waiting");
  if (isWorking(task)) return t("chat.activity.working");
  if (task.waitingForTeammates) return t("task.waitingOnTeammate");
  if (task.queued) return t("task.queued");
  return task.unread ? t("task.unread") : "";
}

function ThreadTab({ task, ownerId, active, tabbable, folders, actions, onOpen, onNew, onFocus, register }: {
  task: TabTask;
  ownerId: string;
  active: boolean;
  /** The strip's roving tab stop: the focused tab, or the open one when nothing in the strip has focus. */
  tabbable: boolean;
  folders: Bot["projects"];
  actions: ThreadActions;
  onOpen: (task: TabTask) => void;
  onNew: () => void;
  onFocus: (threadId: string) => void;
  register: (threadId: string, element: HTMLButtonElement | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [deleting, setDeleting] = useState(false);
  const finishing = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const title = displayTitle(task);
  const status = tabStatus(task);
  const working = isWorking(task);
  const waitingOnYou = task.activity === "waiting-on-you";
  /** A turn waiting on the person is not running, even though the bot reports itself busy. */
  const running = working && !waitingOnYou;
  const archived = isArchived(task);
  const snoozed = isSnoozed(task);

  const startRename = () => { finishing.current = false; setDraft(task.title); setRenaming(true); };
  const finishRename = (save: boolean) => {
    if (finishing.current) return;
    finishing.current = true;
    const next = save ? nextRename(task.title, draft) : null;
    setRenaming(false);
    if (next) actions.onRename(task, next);
  };
  // A right click on a tab opens the same menu its ⋯ button does, as a sidebar row's does.
  const openMenu = () => rowRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
  const copyLink = () => { void copyText(threadRefUrl({ botId: ownerId, threadId: task.threadId })); };
  const moveTo = (folderId: string | null) => actions.onMove(task, folderId);
  const items: SidebarMenuItem[] = [
    {
      key: "new",
      heading: t("botPanel.conversations.title"),
      label: t("botPanel.conversations.new"),
      icon: <SquarePen size={16} />,
      onSelect: onNew,
    },
    { key: "rename", label: t("task.renameAria"), icon: <Pencil size={16} />, onSelect: startRename },
    ...(actions.onRegenerateTitle ? [{
      key: "regenerate",
      label: t("task.regenerateTitle"),
      icon: <RefreshCw size={16} />,
      onSelect: () => actions.onRegenerateTitle?.(task, () => {}),
    } satisfies SidebarMenuItem] : []),
    ...(folders?.length ? [{
      key: "move",
      label: t("folder.move"),
      icon: <FolderInput size={16} />,
      submenu: [
        { key: "folder:none", label: t("folder.none"), active: !task.projectId, onSelect: () => moveTo(null) },
        ...folders.map((folder) => ({
          key: `folder:${folder.id}`,
          label: `${folder.emoji ? `${folder.emoji} ` : ""}${folder.name}`,
          active: task.projectId === folder.id,
          onSelect: () => moveTo(folder.id),
        })),
      ],
      onSelect: () => {},
    } satisfies SidebarMenuItem] : []),
    {
      key: "pin",
      label: task.pinned === true ? t("sidebar.bot.unpin") : t("sidebar.bot.pin"),
      icon: task.pinned === true ? <PinOff size={16} /> : <Pin size={16} />,
      onSelect: () => actions.onPin(task, task.pinned !== true),
    },
    { key: "link", label: t("task.copyLink"), icon: <Link2 size={16} />, onSelect: copyLink },
    ...(task.link ? [{ key: "unlink", label: t("task.removeLink"), icon: <Link2Off size={16} />, onSelect: () => actions.onLink(task, null) } satisfies SidebarMenuItem] : []),
    {
      key: "archive",
      label: archived ? t("task.unarchive") : t("task.archive"),
      icon: archived ? <ArchiveRestore size={16} /> : <Archive size={16} />,
      disabled: working,
      onSelect: () => actions.onArchive(task, archived ? null : Date.now()),
    },
    {
      key: "snooze",
      label: t("task.snooze"),
      icon: <Clock size={16} />,
      disabled: working,
      submenu: [
        { key: "snooze:activity", label: t("task.snoozeUntilActivity"), onSelect: () => actions.onSnooze(task, 0) },
        { key: "snooze:tonight", label: t("task.snoozeTonight"), onSelect: () => actions.onSnooze(task, nextSixPm()) },
        { key: "snooze:tomorrow", label: t("task.snoozeTomorrow"), onSelect: () => actions.onSnooze(task, tomorrowNineAm()) },
      ],
      onSelect: () => {},
    },
    ...(snoozed ? [{ key: "unsnooze", label: t("task.stopSnoozing"), icon: <BellOff size={16} />, onSelect: () => actions.onSnooze(task, null) } satisfies SidebarMenuItem] : []),
    {
      key: "delete",
      label: t("task.deleteAria"),
      icon: <Trash2 size={16} />,
      separatorBefore: true,
      disabled: working,
      onSelect: () => setDeleting(true),
    },
  ];

  return (
    <div
      ref={rowRef}
      data-thread-tab-item={task.threadId}
      className="group/tab flex min-w-0 shrink-0 items-center"
      onContextMenu={(event) => { event.preventDefault(); openMenu(); }}
    >
      {renaming ? (
        <input
          autoFocus
          value={draft}
          maxLength={80}
          dir="auto"
          aria-label={t("task.renameAria")}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finishRename(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); finishRename(true); }
            else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishRename(false); }
          }}
          className="h-7 w-40 min-w-0 rounded-full border border-accent/50 bg-inset px-2.5 text-[12px] text-ink outline-none"
        />
      ) : (
        <button
          ref={(element) => register(task.threadId, element)}
          type="button"
          role="tab"
          aria-selected={active}
          tabIndex={tabbable ? 0 : -1}
          data-thread-tab={task.threadId}
          title={status ? `${title} · ${status}` : title}
          onClick={() => onOpen(task)}
          onFocus={() => onFocus(task.threadId)}
          onDoubleClick={startRename}
          className={cn(
            "flex h-7 max-w-[11rem] min-w-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
            active ? "bg-raised font-medium text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
          )}
        >
          {running && <Loader2 size={12} aria-hidden="true" className="shrink-0 animate-spin text-success" />}
          {waitingOnYou && <Clock size={12} aria-hidden="true" className="shrink-0 text-accent" />}
          {!running && !waitingOnYou && task.unread && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />}
          <span dir="auto" className="truncate">{title}</span>
          {task.pinned === true && <Pin size={10} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
          {status && <span className="sr-only">{status}</span>}
        </button>
      )}
      <SidebarPopoverMenu
        items={items}
        ariaLabel={t("task.actions", { title })}
        triggerLabel={t("task.actions", { title })}
        triggerTitle={t("task.actions", { title })}
        triggerClassName={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100",
          active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100",
        )}
        renderTrigger={({ open }) => <MoreHorizontal size={13} className={cn(open && "text-ink")} />}
      />
      <ConfirmDialog
        open={deleting}
        title={t("task.deleteConfirm")}
        body={t("task.deleteBody", { title })}
        confirmLabel={t("task.deleteAria")}
        onCancel={() => setDeleting(false)}
        onConfirm={() => { if (!working) actions.onDelete(task); setDeleting(false); }}
      />
    </div>
  );
}

/**
 * A bot's threads as tabs beside its name in the chat header, opposite the model picker. The bot panel's Conversations
 * card is the same list with a preview; this one is the quick switch for a bot with several threads.
 */
export function ThreadTabs({ bot, dispatch }: { bot: Bot; dispatch: Dispatch<Action> }) {
  const { state } = useStore();
  const generatedTitles = llmThreadTitlesEnabled(state.config);
  const actions = useMemo(() => threadRowActions(bot.id, dispatch, generatedTitles), [bot.id, dispatch, generatedTitles]);
  const threads: TabTask[] = useMemo(() => {
    // The bot object carries the open thread's live state; another thread has only what its own task holds. Merging
    // the bot into every tab would paint the open thread's running turn across all of them.
    const openThread = currentTaskBot(bot);
    return orderedThreadList(
      (bot.tasks ?? []).filter((task) => !task.routineRunId && (!isArchived(task) || task.threadId === bot.threadId)),
    ).map((task) => {
      const live = task.threadId === bot.threadId ? openThread : null;
      return {
        ...task,
        busy: live ? live.busy : Boolean(task.busy),
        activity: live ? live.activity : task.activity,
        waitingForTeammates: live ? live.waitingForTeammates : task.waitingForTeammates,
        turnStartedAt: live ? live.turnStartedAt ?? undefined : task.turnStartedAt,
        queued: Boolean(state.pendingQueued[task.threadId]?.length),
      };
    });
  }, [bot, state.pendingQueued]);
  const elements = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [edges, setEdges] = useState({ overflow: false, start: false, end: false, rtl: false });
  const active = bot.threadId;
  const showing = threads.length >= 2;

  // The open tab is always reachable, even when the strip has scrolled past it.
  useEffect(() => {
    elements.current.get(active)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  /** The strip hides its scrollbar, so its edge buttons are the only visible cue that tabs continue off-screen. */
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const rtl = typeof getComputedStyle === "function" && getComputedStyle(list).direction === "rtl";
    const max = Math.max(0, list.scrollWidth - list.clientWidth);
    const left = list.scrollLeft;
    // Standard RTL scrolls negative away from its start edge; engines that scroll positive start at the far end.
    const offset = rtl ? (left <= 0 ? -left : max - left) : left;
    const next = { overflow: max > 1, start: offset > 1, end: offset < max - 1, rtl };
    setEdges((previous) => previous.overflow === next.overflow && previous.start === next.start
      && previous.end === next.end && previous.rtl === next.rtl ? previous : next);
  }, []);

  // Every hook has to run before the early return, or a strip that gains its second thread breaks hook order.
  const register = useCallback((threadId: string, element: HTMLButtonElement | null) => {
    if (element) elements.current.set(threadId, element);
    else elements.current.delete(threadId);
  }, []);

  useEffect(() => {
    measure();
    const list = listRef.current;
    const onResize = () => measure();
    list?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", onResize);
    // The header hides this strip below 30rem through a container query, which fires no window resize.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    if (list) observer?.observe(list);
    return () => {
      list?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [measure, showing]);

  // A rename or a late font can change the strip's content width without resizing its box, so keep the edges honest.
  useEffect(measure);

  if (!showing) return null;

  const open = (task: TabTask) => {
    if (task.threadId !== active) openBotThread(dispatch, bot, task.threadId, false);
  };
  /** Keys move focus only: switching posts to the server, so it waits for Enter, Space or a click. */
  const focusTab = (task: TabTask) => {
    setFocusId(task.threadId);
    const element = elements.current.get(task.threadId);
    element?.focus();
    element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Only a tab moves the strip: the keys in a tab's rename field or its ⋯ button belong to them.
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
    const current = event.target.dataset.threadTab ?? active;
    const index = threads.findIndex((task) => task.threadId === current);
    if (index < 0) return;
    const count = threads.length;
    const rtl = typeof getComputedStyle === "function" && getComputedStyle(event.currentTarget).direction === "rtl";
    const step = (delta: number) => focusTab(threads[(index + delta + count) % count]!);
    if (event.key === "ArrowRight") { event.preventDefault(); step(rtl ? -1 : 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); step(rtl ? 1 : -1); }
    else if (event.key === "Home") { event.preventDefault(); focusTab(threads[0]!); }
    else if (event.key === "End") { event.preventDefault(); focusTab(threads[count - 1]!); }
  };
  const scrollStrip = (direction: 1 | -1) => {
    const list = listRef.current;
    if (!list || typeof list.scrollBy !== "function") return;
    const amount = Math.max(40, Math.round(list.clientWidth * 0.75));
    // RTL scrolls negative from its start edge in every current engine.
    list.scrollBy({
      left: (edges.rtl ? -1 : 1) * direction * amount,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  };
  const focusable = threads.some((task) => task.threadId === focusId) ? focusId : active;
  const project = bot.projects?.find((folder) => folder.id === (bot.tasks ?? []).find((task) => task.threadId === active)?.projectId);
  const startNew = () => dispatch({ type: "newTask", botId: bot.id, ...(project ? { projectId: project.id } : {}) });

  const edgeClass = "flex size-6 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-30";

  return (
    <div data-chathead-tabs className="flex min-w-0 items-center @max-[30rem]/chathead:hidden">
      {edges.overflow && (
        <button
          type="button"
          data-thread-tabs-back
          aria-label={t("chat.tabs.earlier")}
          title={t("chat.tabs.earlier")}
          disabled={!edges.start}
          onClick={() => scrollStrip(-1)}
          className={edgeClass}
        >
          {edges.rtl ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronLeft size={14} aria-hidden="true" />}
        </button>
      )}
      <div
        ref={listRef}
        role="tablist"
        aria-label={t("botPanel.conversations.title")}
        onKeyDown={onKeyDown}
        // Leaving the strip hands the tab stop back to the open thread, so a switch from elsewhere is not left behind.
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusId(null);
        }}
        className="flex min-w-0 max-w-[min(22rem,40cqw)] items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {threads.map((task) => (
          <ThreadTab
            key={task.threadId}
            task={task}
            ownerId={bot.id}
            active={task.threadId === active}
            tabbable={task.threadId === focusable}
            folders={bot.projects}
            actions={actions}
            onOpen={open}
            onNew={startNew}
            onFocus={setFocusId}
            register={register}
          />
        ))}
      </div>
      {edges.overflow && (
        <button
          type="button"
          data-thread-tabs-forward
          aria-label={t("chat.tabs.later")}
          title={t("chat.tabs.later")}
          disabled={!edges.end}
          onClick={() => scrollStrip(1)}
          className={edgeClass}
        >
          {edges.rtl ? <ChevronLeft size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
