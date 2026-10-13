import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { popoverClosesOnKey, usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PopoverMenu, type PopoverMenuItem } from "./popover/PopoverMenu";

/** One size and stroke for every icon beside a message and in its menu:
 * thin rounded outlines, like the rest of the chat chrome. */
export const ACTION_ICON = { size: 17, strokeWidth: 1.5 } as const;

/** Class shared by every control that lives in the row: the row decides
 * when it is visible, so the buttons themselves never fade. One muted
 * colour that brightens on hover. */
export const messageActionClass =
  "inline-flex size-7 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

export type MessageMenuItem = {
  key: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  title?: string;
  disabled?: boolean;
  /** A hairline above this row, grouping it off from the row before it. */
  separatorBefore?: boolean;
};

/** Where a message row starts: the element that hovering, focusing or
 * tapping reveals the actions for. */
export const MESSAGE_ROW = "data-message-row";

const INTERACTIVE = "a, button, input, textarea, select, summary, label, [role=button], [contenteditable=true]";
const LONG_PRESS_MS = 450;

function focusVisible(target: EventTarget | null): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** Reply, copy and a "more" menu beside a bubble. They show only while the
 * pointer is over the message, or keyboard focus is inside it, and on a
 * touch screen after a tap or a long press on the message. The menu holds
 * the rest (read aloud, raw markdown, pin, regenerate, copy id) and closes
 * on Escape or a press outside. `forceOpen` keeps the row out while a
 * control in it has to stay reachable, like the stop button of a message
 * being read aloud. Children render in reading order; the row mirrors on
 * the user side so the first control stays nearest the bubble. */
export function MessageActions({
  side,
  forceOpen = false,
  className,
  menu = [],
  children,
}: {
  side: "user" | "bot";
  forceOpen?: boolean;
  className?: string;
  menu?: MessageMenuItem[];
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const mirrored = side === "user";
  const shown = forceOpen || menuOpen || hovered || keyboardFocus || tapped;

  // The message row, not just this strip, reveals the actions.
  useEffect(() => {
    const row = rootRef.current?.closest<HTMLElement>(`[${MESSAGE_ROW}]`) ?? rootRef.current;
    rowRef.current = row;
    if (!row) return;
    let press: { x: number; y: number; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
    const enter = (event: PointerEvent) => { if (event.pointerType !== "touch") setHovered(true); };
    const leave = (event: PointerEvent) => { if (event.pointerType !== "touch") setHovered(false); };
    const focusIn = (event: FocusEvent) => setKeyboardFocus(focusVisible(event.target));
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
      setKeyboardFocus(false);
    };
    const inside = (target: EventTarget | null) => target instanceof Element && Boolean(rootRef.current?.contains(target));
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || inside(event.target)) return;
      if (press) clearTimeout(press.timer);
      press = { x: event.clientX, y: event.clientY, at: Date.now(), timer: setTimeout(() => setTapped(true), LONG_PRESS_MS) };
    };
    const move = (event: PointerEvent) => {
      if (!press || event.pointerType !== "touch") return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
        clearTimeout(press.timer);
        press = null;
      }
    };
    const cancel = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    const up = (event: PointerEvent) => {
      if (!press || event.pointerType !== "touch") return;
      clearTimeout(press.timer);
      const quick = Date.now() - press.at < LONG_PRESS_MS;
      press = null;
      // a tap on a link or a button does its own thing, and a tap that
      // ends a text selection is not asking for the actions
      if (!quick || (event.target instanceof Element && event.target.closest(INTERACTIVE))) return;
      if (window.getSelection()?.toString()) return;
      setTapped((value) => !value);
    };
    row.addEventListener("pointerenter", enter);
    row.addEventListener("pointerleave", leave);
    row.addEventListener("focusin", focusIn);
    row.addEventListener("focusout", focusOut);
    row.addEventListener("pointerdown", down);
    row.addEventListener("pointermove", move);
    row.addEventListener("pointerup", up);
    row.addEventListener("pointercancel", cancel);
    return () => {
      if (press) clearTimeout(press.timer);
      row.removeEventListener("pointerenter", enter);
      row.removeEventListener("pointerleave", leave);
      row.removeEventListener("focusin", focusIn);
      row.removeEventListener("focusout", focusOut);
      row.removeEventListener("pointerdown", down);
      row.removeEventListener("pointermove", move);
      row.removeEventListener("pointerup", up);
      row.removeEventListener("pointercancel", cancel);
    };
  }, []);

  // a tap elsewhere puts a tap-revealed row away again
  usePopoverDismiss(tapped && !menuOpen, rowRef, () => setTapped(false));

  // The menu is the shared PopoverMenu: its rows, its arrow keys, its Escape,
  // its outside press and its focus return, so only the data is built here.
  const menuItems: PopoverMenuItem[] = menu.map((item) => ({
    key: item.key,
    title: item.label,
    leading: item.icon,
    hint: item.title,
    disabled: item.disabled,
    separatorBefore: item.separatorBefore,
    onSelect: item.onSelect,
  }));

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex items-center gap-0.5 self-end pb-0.5 transition-opacity duration-150",
        mirrored && "flex-row-reverse",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
      data-testid="message-actions"
      data-shown={shown ? "true" : undefined}
      onKeyDown={(event) => {
        if (menuOpen || forceOpen || !popoverClosesOnKey(event.nativeEvent) || !keyboardFocus) return;
        // Escape from a focused control hands focus back to the message
        event.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      {children}
      {menu.length > 0 && (
        <PopoverMenu
          items={menuItems}
          ariaLabel={t("chat.messageActions")}
          triggerTitle={t("chat.messageActions")}
          placement="below"
          align={mirrored ? "end" : "start"}
          width={208}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          focusFirstOnOpen
          triggerClassName={cn(messageActionClass, menuOpen && "bg-ink/10 text-ink")}
          trigger={() => <Ellipsis {...ACTION_ICON} aria-hidden="true" />}
        />
      )}
    </div>
  );
}
