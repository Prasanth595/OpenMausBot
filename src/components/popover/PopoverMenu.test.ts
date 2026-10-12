import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

// Drawn open: motion and dismissal are not what is tested here.
vi.mock("../MenuMotion", () => ({
  useMenuMotion: () => ({ shown: true, closing: false, className: "", exitProps: {} }),
}));
vi.mock("@/hooks/use-popover-dismiss", () => ({
  popoverClosesOnKey: () => false,
  popoverClosesOnPointer: () => false,
  usePopoverDismiss: () => {},
}));

import { PopoverMenu, type PopoverMenuItem } from "./PopoverMenu";

// Inline sheet: no portal, no document needed.
const render = (items: PopoverMenuItem[], extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(PopoverMenu, {
      items,
      ariaLabel: "Menu",
      placement: "below",
      portal: false,
      defaultOpen: true,
      trigger: () => "trigger",
      ...extra,
    }),
  );

it("draws an item's second line and note under its label", () => {
  const html = render([
    { key: "cloud", label: "Connect your phone", subtitle: "to your Cloud (always on)", onSelect: () => {} },
    {
      key: "here",
      label: "Connect your phone",
      subtitle: "to this computer",
      note: "Your Cloud shows here once it is ready.",
      onSelect: () => {},
    },
    { key: "plain", label: "Settings", onSelect: () => {} },
  ]);
  expect(html).toMatch(/Connect your phone<\/span><span[^>]*>to your Cloud \(always on\)<\/span>/);
  expect(html).toMatch(/to this computer<\/span><span[^>]*>Your Cloud shows here once it is ready\.<\/span>/);
  expect(html).toContain('<span class="flex-1 truncate">Settings</span>');
});

it("draws an item's attention dot on the item itself, in its tone", () => {
  const html = render([
    { key: "ready", label: "Restart to update", attention: true, attentionTone: "accent", onSelect: () => {} },
    { key: "failed", label: "Update failed", attention: true, onSelect: () => {} },
    { key: "plain", label: "Settings", onSelect: () => {} },
  ]);
  const item = (label: string) => html.split('role="menuitem"').find((chunk) => chunk.includes(`>${label}</span>`)) ?? "";
  expect(item("Restart to update")).toContain("rounded-full bg-accent");
  expect(item("Update failed")).toContain("rounded-full bg-danger");
  expect(item("Settings")).not.toMatch(/rounded-full bg-(accent|danger)/);
});

it("marks a submenu parent with a chevron and popup semantics", () => {
  const html = render([
    {
      key: "support",
      label: "Help and support",
      submenu: [{ key: "help", label: "Help Center", onSelect: () => {} }],
      onSelect: () => {},
    },
  ]);
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain("<svg");
  expect(html).toContain('data-menu-key="support"');
});

it("draws headings and separators without business knowledge", () => {
  const html = render([
    { key: "a", label: "Copy", onSelect: () => {} },
    { key: "b", label: "Download", heading: "Share", separatorBefore: true, onSelect: () => {} },
  ]);
  expect(html).toContain('role="separator"');
  expect(html).toContain(">Share</div>");
});

it("lets renderItem replace the row while staying keyboard-discoverable", () => {
  const html = render(
    [{ key: "custom", label: "Custom", onSelect: () => {} }],
    {
      renderItem: (item: PopoverMenuItem) =>
        createElement(
          "button",
          { type: "button", role: "menuitem", "data-menu-key": item.key, className: "my-row" },
          item.label,
        ),
    },
  );
  expect(html).toContain('class="my-row"');
  expect(html).toContain('data-menu-key="custom"');
  expect(html).not.toContain("min-h-8");
});

it("headless variant carries no surface chrome", () => {
  const html = render([{ key: "a", label: "Copy", onSelect: () => {} }], { variant: "headless" });
  expect(html).toContain("data-popover-variant=\"headless\"");
  expect(html).not.toContain("bg-menu");
  expect(html).not.toContain("border-hairline");
});
