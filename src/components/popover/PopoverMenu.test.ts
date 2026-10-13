import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

// Drawn open: motion and dismissal are not what is tested here.
vi.mock("../MenuMotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../MenuMotion")>()),
  useMenuMotion: () => ({ shown: true, closing: false, className: "", exitProps: {} }),
  useHeldMenuMotion: (value: unknown) => ({ shown: value !== null, value, closing: false, className: "", exitProps: {} }),
  isReducedMotion: () => true,
}));
vi.mock("@/hooks/use-popover-dismiss", () => ({
  popoverClosesOnKey: () => false,
  popoverClosesOnPointer: () => false,
  usePopoverDismiss: () => {},
}));
vi.mock("./popover-motion.module.css", () => ({
  default: { menuIn: "menuIn", menuOut: "menuOut", menuAnimating: "menuAnimating", rowFlow: "rowFlow" },
}));
// Static chrome resolves to stable names too, so assertions only check that
// a style hook is present, never what it computes to. Split per component
// like the modules.
vi.mock("./popover.module.css", () => ({
  default: {
    root: "root",
    shell: "shell",
    placeAbove: "placeAbove",
    placeBefore: "placeBefore",
    placeAfter: "placeAfter",
    placeBelow: "placeBelow",
    menuShell: "menuShell",
    menuShellBare: "menuShellBare",
    menuInner: "menuInner",
  },
}));
vi.mock("./popover-menu.module.css", () => ({
  default: {
    subInline: "subInline",
    subShell: "subShell",
    subShellBare: "subShellBare",
    subInner: "subInner",
    row: "row",
    rowFill: "rowFill",
    rowActive: "rowActive",
    rowOff: "rowOff",
    rowLeading: "rowLeading",
    rowLeadingTone: "rowLeadingTone",
    rowLeadingRoomy: "rowLeadingRoomy",
    rowLeadingActive: "rowLeadingActive",
    rowLeadingMedia: "rowLeadingMedia",
    rowMain: "rowMain",
    rowTitle: "rowTitle",
    rowContent: "rowContent",
    rowContentTone: "rowContentTone",
    rowTail: "rowTail",
    rowTailSlot: "rowTailSlot",
    rowValue: "rowValue",
    clamp: "clamp",
    dot: "dot",
    dotAccent: "dotAccent",
    dotDanger: "dotDanger",
    chev: "chev",
    separator: "separator",
    separatorRoomy: "separatorRoomy",
    header: "header",
    headerDivider: "headerDivider",
    headerTitle: "headerTitle",
    headerContent: "headerContent",
    heading: "heading",
  },
}));

import { PopoverMenu, type PopoverMenuHeader, type PopoverMenuItem } from "./PopoverMenu";

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

it("draws a title over its content, clamped to one line by default", () => {
  const html = render([
    { key: "cloud", title: "Connect your phone", content: "to your Cloud (always on)", onSelect: () => {} },
    { key: "here", title: "Connect your phone", content: "to this computer", lines: { content: -1 }, onSelect: () => {} },
  ]);
  expect(html).toMatch(/rowTitle clamp[^>]*>Connect your phone</);
  expect(html).toMatch(/rowContent rowContentTone clamp[^>]*>to your Cloud \(always on\)</);
  // -1 wraps freely: the content keeps its tone but carries no clamp class
  expect(html).toMatch(/rowContent rowContentTone">to this computer</);
});

it("clamps to the requested count through a style variable", () => {
  const html = render([{ key: "a", title: "Take turns", content: "a long reason", lines: { title: 2, content: 3 }, onSelect: () => {} }]);
  expect(html).toContain('style="--row-lines:2"');
  expect(html).toContain('style="--row-lines:3"');
});

it("drops a slot when its line count is zero", () => {
  const html = render([
    { key: "a", title: "Copy", content: "hidden content", lines: { content: 0 }, onSelect: () => {} },
    { key: "b", title: "hidden title", content: "kept", lines: { title: 0 }, onSelect: () => {} },
  ]);
  expect(html).not.toContain("hidden content");
  expect(html).not.toContain("hidden title");
  expect(html).toContain(">kept</span>");
});

it("keeps value and trailing in the tail band, in order", () => {
  const html = render([{ key: "a", title: "Account", value: "Pro", trailing: createElement("span", { id: "chip" }), onSelect: () => {} }]);
  const tail = html.slice(html.indexOf("rowTail"));
  expect(tail.indexOf("rowValue")).toBeLessThan(tail.indexOf("rowTailSlot"));
  expect(tail).toContain(">Pro</span>");
  expect(tail).toContain('id="chip"');
});

it("draws an item's attention dot on the item itself, in its tone", () => {
  const html = render([
    { key: "ready", title: "Restart to update", attention: true, attentionTone: "accent", onSelect: () => {} },
    { key: "failed", title: "Update failed", attention: true, onSelect: () => {} },
    { key: "plain", title: "Settings", onSelect: () => {} },
  ]);
  const item = (label: string) => html.split('role="menuitem"').find((chunk) => chunk.includes(`>${label}</span>`)) ?? "";
  expect(item("Restart to update")).toContain("dotAccent");
  expect(item("Update failed")).toContain("dotDanger");
  expect(item("Settings")).not.toMatch(/dotAccent|dotDanger/);
});

it("marks a submenu parent with a chevron and popup semantics", () => {
  const html = render([
    {
      key: "support",
      title: "Help and support",
      submenu: [{ key: "help", title: "Help Center", onSelect: () => {} }],
      onSelect: () => {},
    },
  ]);
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain("<svg");
  expect(html).toContain('data-menu-key="support"');
});

it("draws headings and separators without business knowledge", () => {
  const html = render([
    { key: "a", title: "Copy", onSelect: () => {} },
    { key: "b", title: "Download", heading: "Share", separatorBefore: true, onSelect: () => {} },
  ]);
  expect(html).toContain('role="separator"');
  expect(html).toContain(">Share</div>");
});

it("draws a header band as a group marker above the rows, never as a row", () => {
  const html = render([
    { key: "band", header: { title: "Where this conversation works", content: createElement("a", { href: "#levels" }, "Learn more") } },
    { key: "auto", title: "Auto", onSelect: () => {} },
    { key: "cloud", title: "Cloud computer", onSelect: () => {} },
  ]);
  const band = html.slice(html.indexOf("data-popover-header"), html.indexOf('data-menu-key="auto"'));
  expect(band).toContain('class="header headerDivider"');
  expect(band).toContain('class="headerTitle"');
  expect(band).toContain(">Where this conversation works</div>");
  expect(band).toContain('class="headerContent"');
  expect(band).toContain('<a href="#levels">Learn more</a>');
  // The band is the item: no button, no row, no menu key for it.
  expect(html).not.toContain('data-menu-key="band"');
  expect(html.indexOf("data-popover-header")).toBeLessThan(html.indexOf('data-menu-key="auto"'));
});

it("keeps the band's divider off when the caller says so, and lets row fields fall away", () => {
  const html = render([
    {
      key: "band",
      header: { title: "Places", divider: false },
      title: "ignored row title",
      leading: createElement("span", { "data-icon": "ignored" }),
      onSelect: () => {},
    },
    { key: "auto", title: "Auto", onSelect: () => {} },
  ]);
  expect(html).toContain('class="header"');
  expect(html).not.toContain("headerDivider");
  expect(html).not.toContain("ignored row title");
  expect(html).not.toContain("ignored");
  expect(html).toContain(">Places</div>");
});

it("hands the band to renderHeader while the divider stays default chrome", () => {
  const html = render(
    [{ key: "band", header: { title: "Places" } }, { key: "auto", title: "Auto", onSelect: () => {} }],
    {
      renderHeader: (header: PopoverMenuHeader, defaults: { className: string }) =>
        createElement("div", { "data-popover-header": "", className: defaults.className }, `Section: ${String(header.title)}`),
    },
  );
  expect(html).toContain("Section: Places");
  expect(html).toContain('class="header headerDivider"');
  expect(html).not.toContain("headerTitle");
});

it("lets renderItem replace the row while staying keyboard-discoverable", () => {
  const html = render(
    [{ key: "custom", title: "Custom", onSelect: () => {} }],
    {
      renderItem: (item: PopoverMenuItem) =>
        createElement(
          "button",
          { type: "button", role: "menuitem", "data-menu-key": item.key, className: "my-row" },
          item.title,
        ),
    },
  );
  expect(html).toContain('class="my-row"');
  expect(html).toContain('data-menu-key="custom"');
  expect(html).not.toContain('class="row"');
});

it("carries a hint, per-slot override classes and radio semantics as item state", () => {
  const html = render([
    {
      key: "delete",
      title: "Delete",
      hint: "Delete this bot",
      leading: createElement("span", { "data-icon": "trash" }),
      overrideClassNames: { row: "text-danger", leading: "text-danger" },
      onSelect: () => {},
    },
    { key: "turns", title: "Take turns", role: "menuitemradio", checked: false, ariaDisabled: true, onSelect: () => {} },
    { key: "live", title: "Live", role: "menuitemradio", checked: true, onSelect: () => {} },
  ]);
  const row = (title: string) => {
    const start = html.indexOf(`>${title}</span>`);
    return html.slice(html.lastIndexOf("<button", start), html.indexOf("</button>", start) + 9);
  };
  const del = row("Delete");
  // the override replaces the row's fill and the leading paint
  expect(del).toContain('class="row text-danger"');
  expect(del).not.toContain("rowFill");
  expect(del).toContain('class="rowLeading text-danger"');
  expect(del).not.toContain("rowLeadingTone");
  expect(del).not.toContain("rowLeadingMedia");
  expect(del).toContain('title="Delete this bot"');
  const turns = row("Take turns");
  expect(turns).toContain('role="menuitemradio"');
  expect(turns).toContain('aria-checked="false"');
  expect(turns).toContain('aria-disabled="true"');
  expect(turns).toContain("rowOff");
  const live = row("Live");
  expect(live).toContain('aria-checked="true"');
  expect(live).not.toContain('aria-disabled="true"');
});

it("gives the leading slot its tone and size defaults unless overridden", () => {
  const html = render([
    { key: "a", title: "Copy", leading: createElement("span", { "data-icon": "i" }), onSelect: () => {} },
    { key: "b", title: "Paste", leading: createElement("span", { "data-icon": "i" }), overrideClassNames: { leading: "text-accent" }, onSelect: () => {} },
  ]);
  expect(html).toContain('class="rowLeading rowLeadingTone rowLeadingMedia"');
  expect(html).toContain('class="rowLeading text-accent"');
});

it("inerts a disabled trigger", () => {
  const html = render([{ key: "a", title: "Copy", onSelect: () => {} }], { defaultOpen: false, triggerDisabled: true });
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-disabled="true"');
});

it("headless variant carries no surface chrome", () => {
  const html = render([{ key: "a", title: "Copy", onSelect: () => {} }], { variant: "headless" });
  expect(html).toContain("data-popover-variant=\"headless\"");
  expect(html).not.toContain("bg-menu");
  expect(html).not.toContain("border-hairline");
});
