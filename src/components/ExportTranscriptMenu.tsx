import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Share } from "lucide-react";

import { cn } from "@/lib/cn";
import {
  copyTranscriptToClipboard,
  downloadMarkdownTranscript,
  formatTranscriptMarkdown,
  slugifyTranscriptFilename,
} from "@/lib/export-transcript";
import { PopoverMenu, type PopoverMenuItem } from "./popover/PopoverMenu";
import type { Message } from "@/state/store";

export interface ExportTranscriptMenuProps {
  /** Title of the conversation (bot name or channel name). */
  title: string;
  /** Messages to export. */
  messages: readonly Message[];
  /** Optional fallback bot name for 1:1 chats. */
  botName?: string;
  /** Whether this is a group room / channel. */
  isGroup?: boolean;
  /** Optional custom CSS classes for the trigger button. */
  className?: string;
}

/**
 * A dropdown menu button in the chat header allowing users to export the current
 * conversation transcript either by copying to clipboard or downloading as Markdown.
 */
export function ExportTranscriptMenu({
  title,
  messages,
  botName,
  isGroup = false,
  className,
}: ExportTranscriptMenuProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const hasMessages = messages && messages.length > 0;

  /** Copy formatted Markdown transcript to clipboard with visual feedback. */
  const handleCopy = async () => {
    if (!hasMessages) return;
    const markdown = formatTranscriptMarkdown({
      title,
      messages,
      botName,
      isGroup,
    });
    const success = await copyTranscriptToClipboard(markdown);
    setCopyFailed(!success);
    if (success) {
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    }
  };

  /** Trigger browser download for the formatted Markdown transcript file. */
  const handleDownload = () => {
    if (!hasMessages) return;
    const markdown = formatTranscriptMarkdown({
      title,
      messages,
      botName,
      isGroup,
    });
    const filename = slugifyTranscriptFilename(title);
    downloadMarkdownTranscript(filename, markdown);
  };

  const items: PopoverMenuItem[] = hasMessages
    ? [
        {
          key: "copy",
          // The band over the rows, as the chat header's own export menu has it.
          heading: "Export Conversation",
          title: copied ? "Copied to clipboard!" : "Copy as Markdown",
          leading: copied ? <Check className="text-success" /> : <Copy />,
          // The confirmation replaces the label in place, so the sheet stays
          // up long enough to read it.
          keepOpen: true,
          onSelect: () => { void handleCopy(); },
        },
        ...(copyFailed
          ? [{ key: "copy-failed", render: <div role="status" className="px-3 py-2 text-[12px] text-ink-secondary">Clipboard unavailable. Download the Markdown file instead.</div> } satisfies PopoverMenuItem]
          : []),
        { key: "download", title: "Download as .md", leading: <Download />, onSelect: handleDownload },
      ]
    : [{ key: "empty", heading: "Export Conversation", render: <div className="px-3 py-2 text-[12px] text-ink-secondary">No messages to export yet.</div> }];

  return (
    <PopoverMenu
      items={items}
      ariaLabel="Export conversation"
      placement="below"
      align="end"
      width={220}
      triggerTitle="Export conversation as Markdown"
      triggerClassName={cn("rounded-md p-1.5 transition-colors hover:bg-raised", className)}
      trigger={({ open }) => (
        <span className={cn("flex items-center justify-center", open ? "text-accent" : "text-ink-secondary hover:text-ink")}>
          <Share size={18} />
        </span>
      )}
    />
  );
}
