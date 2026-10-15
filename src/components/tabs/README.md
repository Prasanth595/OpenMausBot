# Tabs

Headless, business-logic-free tab bar: `TabGroup` + `TabList` + `Tab` +
`TabPanels`/`TabPanel`. No bot/place/panel knowledge, and **no styles at all** —
the package ships behaviour, ARIA and state; the caller ships the look.

First consumer: `ComputerPanel` (`src/components/ComputerPanelTabs.tsx` owns
that panel's classes).

## Files

- `TabGroup.tsx` — selection context. Renders **no element**: the parts below
  it keep the caller's layout.
- `TabList.tsx` — the bar: `role="tablist"`, roving tabindex, `Arrow`/`Home`/
  `End`, and the row behaviour (measure → decide narrow → collapse, scrollbar
  state). Renders a plain element plus one measuring wrapper.
- `Tab.tsx` — one trigger: `role="tab"`, `aria-selected`, `data-*` state, an
  optional function child or `as={Fragment}` render prop.
- `TabPanels.tsx` / `TabPanel.tsx` — optional content, wired to their tabs.
- `renderPart.tsx` — the `as`/`Fragment` renderer and prop merging.
- `types.ts` — `TabDisplay`, `TabCollapse`, `TabsScrollbar`, `TabState`,
  `TabPanelState`, `DataAttributes`.
- `TabGroup.test.ts` — behaviour tests (selection, keyboard, narrow decision,
  panel wiring, render props, state contract).

## Usage

```tsx
<TabGroup value={view} onChange={setView}>
  <TabList aria-label="Bot panel view" className="…">
    <Tab value="computer" className="…">Computer</Tab>
    <Tab value="browser" className="…" data-tour="computer-browser">Browser</Tab>
  </TabList>
  <TabPanels className="…">
    <TabPanel value="computer" className="…">…</TabPanel>
    <TabPanel value="browser" className="…">…</TabPanel>
  </TabPanels>
</TabGroup>
```

A bar without panels is a first-class use — leave `TabPanels` out and drive the
content yourself from the controlled `value`. `TabPanel` also works outside a
`<TabPanels>` wrapper, so a caller can put one panel where its own layout wants
it (that is what `ComputerPanel` does, one panel per view).

Full control of the markup:

```tsx
<Tab value="a" as={Fragment} className="…">
  {({ selected, hover, focus, disabled, narrow, display }) => (
    <button className={clsx(hover && "underline", selected && "bg-blue-500")}>Tab 1</button>
  )}
</Tab>
```

## Props

`TabGroup<T extends string>` (renders no element):

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `value` | `T` | — | Controlled selection (required). |
| `onChange` | `(value: T) => void` | — | Required. Fires only when selection moves. |
| `onInput` | `(value: T) => void` | — | Fires on every press, before `onChange`: activating an inactive tab fires `onInput` then `onChange`; re-pressing the active tab fires only `onInput` (e.g. to scroll its panel back to top). Disabled tabs fire neither. |
| `id` | `string` | `useId()` | Stable base for the generated `…-tab-<value>` / `…-panel-<value>` ids. |

`TabList` (extends `div` props, so `aria-label`, `title` and `data-*` pass
through):

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `as` | `ElementType` | `"div"` | `Fragment` merges the part's props into the single element child. |
| `className` | `string` | — | Classes for the tablist itself. |
| `viewportClassName` | `string` | — | Classes for the measuring wrapper (the full-width box the list measures its room from) — e.g. `flex-1 min-w-0` in a flex host. |
| `minTabWidth` | `number` | `120` | Space one tab needs in its full form, px. The list collapses once its room is under `count × minTabWidth`. |
| `collapse` | `"text" \| "icon" \| "none"` | `"text"` | Which compact form tabs take when narrow: drop the icons (`text-only`), drop the labels (`icon-only`), or never collapse. |
| `scrollbar` | `"auto" \| "hidden" \| "scrolling"` | `"auto"` | Which scrollbar state the list publishes. Paints nothing. |

`Tab` (extends `button` props): `value` (required), `disabled`, `autoFocus`,
`as`, `className`, `children` — a node, or a function of `TabState`.

`TabPanel` (extends `div` props): `value` (required), `unmount` (default
`true`), `as`, `className`, `children` — a node, or `({ selected }) => node`.
`TabPanels` is only a wrapper: `as`, `className`, children.

## State contract

The package never sets a class. Everything a caller needs to style comes from
attributes, so Tailwind variants (`data-[selected]:…`) or plain CSS both work:

| Element | Attributes |
| --- | --- |
| `TabList` | `data-narrow` (true while collapsed), `data-scrollbar`, `data-scrolling` (only in `"scrolling"` mode, 700ms after the last scroll) |
| `Tab` | `data-value`, `data-selected`, `data-hover`, `data-focus`, `data-disabled`, `data-display` (`icon-text` \| `icon-only` \| `text-only`) |
| `TabPanel` | `data-selected` |

A `Tab` function child receives the same state
(`{ selected, hover, focus, disabled, narrow, display }`), and `as={Fragment}`
merges the part's props — roles, ids, handlers, data attributes — onto the
caller's single element child, with their classes kept and theirs-then-ours
handler order.

## Behaviour

- **Selection** is value-based and controlled: `value` + `onChange`, with
  `onInput` for every press. Disabled tabs are unreachable by pointer and
  keyboard.
- **Keyboard**: roving tabindex (the selected tab is the single tab stop,
  disabled tabs are skipped), automatic activation on `ArrowRight/Down`,
  `ArrowLeft/Up`, `Home`, `End`. Modifier-held keys are ignored.
- **Narrow**: the list measures its own viewport and collapses on its own
  decision — `count × minTabWidth` versus the room it was given. No caller
  breakpoints, no media queries, no `window` checks. A caller can override one
  tab by passing its own `data-display`, or switch the policy off with
  `collapse="none"`.
- **Scrollbar**: the row is the caller's to make scrollable; the list only
  publishes the state. `"scrolling"` reveals for 700ms after a scroll, so a
  caller can draw a transient bar that is never painted at rest.
- **Panels**: `role="tabpanel"`, `aria-labelledby` from the tab, and the same id
  the tab's `aria-controls` points at. Unselected panels unmount by default;
  `unmount={false}` keeps them mounted with `hidden`.

## Recipes

The panel's own look, as the reference:

```tsx
// One hugging row that scrolls without drawing a bar
<TabList className="mx-auto grid w-fit max-w-full min-w-0 grid-flow-col auto-cols-max
                   overflow-x-auto rounded-2xl bg-inset p-1
                   [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" …>

// A tab: pill segment, states, and the collapsed form
<Tab className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-1
                text-[12px] whitespace-nowrap text-ink-secondary transition-colors hover:text-ink
                data-[selected]:bg-raised data-[selected]:text-ink data-[selected]:shadow-sm
                data-[display=text-only]:[&>svg]:hidden" …>
  <Monitor size={13} />
  <span className="min-w-0 truncate" title={label}>{label}</span>
</Tab>
```

- **Fit vs equal columns**: `grid-flow-col auto-cols-max` sizes each tab to its
  own content (and `w-fit` makes the bar hug them); `auto-cols-fr` fills the
  row with same-share tabs.
- **Wrapping bars**: skip the grid entirely and let the caller's own
  `flex flex-wrap gap-2` lay the tabs out — the package adds no layout.
- **Icon-only**: `collapse="icon"`, and keep the label in the accessibility
  tree yourself (e.g. `data-[display=icon-only]:sr-only` on the label span).

## Verify

- `pnpm vitest run src/components/tabs/TabGroup.test.ts`
