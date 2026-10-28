import { cn } from "@/lib/cn";
import { useCallback, useLayoutEffect, useRef, type RefObject, type TextareaHTMLAttributes } from "react";
import { type MentionPeer } from "@/lib/mentions";
import { MentionText } from "./MentionText";

export function MentionTextarea({ inputRef, peers, everyone = false, wrapperClassName, matchInputStyle = false, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  wrapperClassName?: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  peers: readonly MentionPeer[];
  everyone?: boolean;
  /** Copy the textarea's type and padding onto the mirror, for a composer whose sizes differ from the stylesheet's. */
  matchInputStyle?: boolean;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const sync = useCallback(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    mirror.style.width = `${input.clientWidth}px`;
    mirror.scrollTop = input.scrollTop;
    mirror.scrollLeft = input.scrollLeft;
  }, [inputRef]);
  const matchStyle = useCallback(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!mirror) return;
    if (!matchInputStyle || !input) {
      mirror.style.fontSize = "";
      mirror.style.lineHeight = "";
      mirror.style.padding = "";
      return;
    }
    const style = getComputedStyle(input);
    mirror.style.fontSize = style.fontSize;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.padding = style.padding;
  }, [inputRef, matchInputStyle]);
  const resize = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    matchStyle();
    const scrollTop = input.scrollTop;
    const line = parseFloat(getComputedStyle(input).lineHeight) || 24;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, line * 6)}px`;
    input.scrollTop = scrollTop;
    sync();
  }, [inputRef, matchStyle, sync]);
  useLayoutEffect(resize, [props.value, resize]);
  useLayoutEffect(() => {
    let width = inputRef.current?.clientWidth;
    const observer = new ResizeObserver(() => {
      // Observe width only, so setting the measured height cannot create a resize loop.
      const nextWidth = inputRef.current?.clientWidth;
      if (nextWidth !== width) { width = nextWidth; resize(); }
      else sync();
    });
    if (inputRef.current) observer.observe(inputRef.current);
    return () => observer.disconnect();
  }, [inputRef, resize, sync]);
  return <div className={cn("mention-editor relative min-w-0 flex-1 self-center", wrapperClassName)}>
    <div ref={mirrorRef} dir={props.dir} aria-hidden="true" className="mention-editor-mirror pointer-events-none absolute inset-0 overflow-hidden">
      <MentionText text={String(props.value ?? "")} peers={peers} everyone={everyone} />{"\n"}
    </div>
    <textarea {...props} ref={inputRef} onScroll={(event) => { sync(); props.onScroll?.(event); }} />
  </div>;
}
