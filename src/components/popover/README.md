# popover

Generic, business-logic-free floating UI.

## Layout

One folder, one module: this directory is the whole boundary for generic floating UI.

| File | Role |
| --- | --- |
| `Popover.tsx` | Shell: trigger- or point-anchored. Positions, dismisses, returns focus, plays motion. Knows nothing about menus. |
| `PopoverMenu.tsx` | The menu composed on top of the shell: public item model and props, the shell wiring, and the root level. |
| `menu-level.tsx` | The recursive half: a level's rows plus the one submenu those rows can open, each submenu in an animated sheet of its own. |
| `menu-rows.tsx` | Row chrome (rows, bands) and the selectors the keyboard walks them with. |
| `positioning.ts` | Geometry helpers — no React, and only `isRtlElement` reads the DOM, so the placement rules stay unit-testable without a browser. |
| `popover-types.ts` | Types shared by shell and menu: `PopoverProps`, `PopoverDismissOptions`, anchors, variants. |
| `popover-motion.module.css` | Open/close motion, shared by both. |
| `popover.module.css` | Chrome of the shell (`variant="styled"`). |
| `popover-menu.module.css` | Chrome of the menu: rows, bands, submenu. |
| `index.ts` | Public entry: `Popover`, `PopoverMenu` and their types. |
| `*.test.ts` | Document behavior (`PopoverMenu.behavior.test.ts`), items and markup (`PopoverMenu.test.ts`), geometry (`positioning.test.ts`). |

Dependencies run one way only:

```text
PopoverMenu  →  Popover  →  positioning · popover-types · popover-motion
```

`Popover` never imports `PopoverMenu`, and nothing in this folder imports app code — that is what keeps it generic and testable. App menus stay in their own components (`Sidebar.tsx`, `ChatView.tsx`, `MessageActions.tsx` are the fuller examples) and reach the menu as `items` data. Outward the folder leans on `@/lib/cn` plus two shared helpers: `../MenuMotion` for motion timing and `@/hooks/use-popover-dismiss` for hit testing.

`Popover` has no direct consumer in the app today: every menu goes through `PopoverMenu`. It stays exported for headless or custom floating surfaces, and its tests drive it directly.

### Keeping it that way

- Menu semantics (menu roles, roving focus, submenus, separators, bands) belong to `PopoverMenu`; the shell stays menu-free.
- Too big a file? Split it *inside* the folder (`menu-rows.tsx`, `menu-level.tsx`, …) and re-export what consumers need. Do not move `PopoverMenu` into a folder of its own: it shares `positioning.ts`, `popover-types.ts` and the motion CSS with the shell, so a split only turns those into cross-folder imports and rewrites every consumer without gaining a boundary.
- `index.ts` is the public entry (`import { PopoverMenu } from "./popover"`); call sites that import the deep path (`./popover/PopoverMenu`) still resolve to the same names.

## Usage

### Basic popover with trigger

```tsx
import { Popover } from "./popover";

<Popover
  ariaLabel="More info"
  trigger={() => <span>ⓘ</span>}
  placement="below"
>
  Hello
</Popover>
```

Render-prop children get `{ open, close }`:

```tsx
<Popover ariaLabel="Actions" trigger={() => <span>Open</span>}>
  {({ close }) => <button onClick={() => close()}>Done</button>}
</Popover>
```

### Context (point-anchored) menu

No trigger; anchor is a viewport point:

```tsx
<Popover
  ariaLabel="Context menu"
  anchor={{ kind: "point", x: e.clientX, y: e.clientY }}
  focusFirstOnOpen
  restoreFocusOnClose
>
  ...
</Popover>
```

### Menu

```tsx
import { PopoverMenu } from "./popover";

<PopoverMenu
  ariaLabel="Approval mode"
  items={[
    { key: "ask", title: "Ask", content: "Ask before acting", leading: <Icon />, onSelect: () => setMode("ask") },
    { key: "auto", role: "menuitemradio", checked: true, title: "Auto", onSelect: () => setMode("auto") },
  ]}
  trigger={() => <Icon />}
  placement="below"
  onSelect={(key) => console.log(key)}
/>
```

Submenu, header band, and disabled rows:

```tsx
items={[
  { key: "group", header: { title: "Modes", content: <a href="...">Learn more</a> } },
  { key: "more", title: "More", submenu: [{ key: "sub", title: "Sub action" }] },
  { key: "off", title: "Off", disabled: true, hint: "Why unavailable" },
]}
```

Submenus nest to any depth: a submenu's rows are ordinary menu items, so any
of them may bring a `submenu` of its own. Each level keeps its own hover,
focus and motion state, so a level opens beside its row, closes on its own,
and one level closing takes only the levels below it with it.

```tsx
items={[
  { key: "voice", title: "Voice", submenu: [{ key: "nova", title: "Nova" }] },
  { key: "advanced", title: "Advanced", submenu: [{ key: "audio", title: "Audio", submenu: [{ key: "gain", title: "Gain" }] }] },
]}
```

## Key props

`Popover`: `open` / `defaultOpen` / `onOpenChange`, `anchor`, `placement` (`above | below | before | after | auto`), `align` (`start | end | center`), `offset` (default 6), `width` (default 280), `dismiss` (`outsidePress`, `escape`, `tabCloses`, `leave`), `variant` (`styled | headless`), `portal` (default `true`), `motionKind` (`pop | menu`), `quick`, `focusFirstOnOpen`, `restoreFocusOnClose`, `triggerDisabled`.

`PopoverMenu` adds: `items`, `sheetAriaLabel`, `renderItem` / `renderHeader`, `submenuClassName`, `onClose`.

## Notes

- Controlled or uncontrolled: pass `open` + `onOpenChange`, or `defaultOpen`.
- `variant="headless"` drops default chrome for custom styling.
- `quick` skips motion entirely (useful for tests).
- Keyboard: `ArrowUp/Down`, `Home/End` move; `ArrowRight` opens a submenu and `ArrowLeft`/`Escape` walk back one level at a time (RTL-aware; at the root `Escape` closes the menu); `Tab` closes by default; outside press dismisses.
- Focus: an open lands on the first runnable row — a radio menu on its current choice, `ArrowUp` on the last; with focus still on the trigger after a pointer open, `Tab` and the arrows move it into the sheet instead of skipping past the portal. `Shift+Tab` on the trigger stays with the browser.
- Pointer: resting on a trigger row opens its submenu (keyboard and click opens are immediate); leaving the row closes it again unless the pointer crosses into the sheet, and moving to a sibling trigger shrinks the open one out as the new one grows in.
