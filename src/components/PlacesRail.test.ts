// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RailPlace, RailState } from "../../electron/cloud-rail.mjs";
import { setLocale } from "@/lib/i18n";
import { placeInitials, refreshPlaces } from "@/lib/places";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./cloud-buy/CloudMascotScene", () => ({ CloudMascotScene: () => null }));
const { PlacesRail, matchingPlaces, placeLabel, shownPlaces } = await import("./PlacesRail");
const { DesktopWorkspaceSwitcher } = await import("./DesktopWorkspaceSwitcher");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const place = (id: string, name: string, extra: Partial<RailPlace> = {}): RailPlace => ({ id, name, color: null, kind: "cloud", opens: true, ...extra });
const PLACES: RailPlace[] = [
  place("home", "My Cloud", { color: "purple", active: true }),
  place("a", "Client A", { color: "teal" }),
  place("acme", "Acme", { kind: "team", attention: true }),
  place("pending:c-b", "Client B", { opens: false, progress: 0, waiting: true }),
  place("c", "Client C", { progress: 0.4 }),
  place("vps", "Office", { kind: "server" }),
];
let host: HTMLDivElement, root: Root | null = null;
let rail: RailState;
const workspaces = { state: vi.fn(async () => ({ local: false, name: "My Cloud" })), menu: vi.fn(async () => {}), places: vi.fn(async () => rail),
  open: vi.fn(async () => {}), add: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) };
const cloudAdd = { state: vi.fn(async () => ({ signedIn: true, hasCloud: true, supported: false, canAdd: false, offer: null, count: 1, home: { name: "My Cloud", color: null } })),
  start: vi.fn(), reopen: vi.fn(), copyLink: vi.fn(), open: vi.fn(), interest: vi.fn(async () => {}), sheet: vi.fn(async () => {}) };
async function mount(element: ReturnType<typeof createElement>) {
  root = createRoot(host);
  await act(async () => { await refreshPlaces(); root!.render(element); });
  await act(async () => { await Promise.resolve(); });
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => { (element as HTMLElement).click(); await Promise.resolve(); }); };
beforeEach(() => {
  setLocale("en");
  rail = { places: PLACES, add: { cloud: true, link: true, address: false } };
  Object.assign(window, { ogb: { workspaces, cloudAdd } });
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); document.body.innerHTML = ""; });

it("a circle per place, with its initials on its colour; the place on screen is marked, one that needs the person has a dot, one being set up a ring", async () => {
  await mount(createElement(PlacesRail));
  const circles = [...host.querySelectorAll("[data-rail-place]")];
  expect(circles.map((circle) => circle.textContent)).toEqual(["MC", "CA", "A", "CB", "CC", "O"]);
  expect(host.querySelector('[data-rail-place="home"]')?.getAttribute("aria-current")).toBe("page");
  expect(host.querySelector('[data-rail-place="home"] span')?.getAttribute("style")).toContain("var(--identity-purple)");
  expect(host.querySelector('[data-rail-place="acme"] [data-rail-dot]')).toBeTruthy();
  expect(host.querySelector('[data-rail-place="pending:c-b"] [data-rail-ring]')?.getAttribute("data-rail-ring")).toBe("waiting");
  expect(host.querySelector('[data-rail-place="c"] [data-rail-ring]')?.getAttribute("data-rail-ring")).toBe("40");
  expect(host.querySelector('[data-rail-place="c"]')?.getAttribute("aria-label")).toBe("Client C: setting up");
  expect(host.querySelector('[data-rail-place="pending:c-b"]')?.getAttribute("aria-label")).toBe("Client B: waiting for payment");
  expect(host.querySelector("[data-rail-more-button]")).toBeNull();
  expect(host.querySelector("[data-rail-add]")?.getAttribute("aria-label")).toBe("Add a Cloud or your own server");
});

it("a click opens the place through main by its id; the one on screen and one not ready yet open nothing", async () => {
  await mount(createElement(PlacesRail));
  await click(host.querySelector('[data-rail-place="a"]'));
  await click(host.querySelector('[data-rail-place="home"]'));
  await click(host.querySelector('[data-rail-place="pending:c-b"]'));
  expect(workspaces.open.mock.calls).toEqual([["a"]]);
});

it("one place or none, an older app, or a browser: no rail, and the switcher stays", async () => {
  rail = { places: [], add: { cloud: true, link: true, address: true } };
  await mount(createElement("div", null, createElement(PlacesRail), createElement(DesktopWorkspaceSwitcher, { inline: true })));
  expect(host.querySelector("[data-places-rail]")).toBeNull();
  expect(host.querySelector("[data-switcher-beside-rail]")).toBeNull();
  expect(host.querySelector('[data-workspace-switcher="inline"]')).toBeTruthy();
});

it("beside the rail, the switcher at the top of the sidebar steps aside on a wide window", async () => {
  await mount(createElement("div", null, createElement(PlacesRail), createElement(DesktopWorkspaceSwitcher, { inline: true })));
  expect(host.querySelector("[data-places-rail]")?.className).toContain("md:flex");
  expect(host.querySelector("[data-switcher-beside-rail]")?.className).toContain("md:hidden");
});

it("past eight places, ⋯ opens every place, searchable; the place on screen stays among the circles", async () => {
  const many = Array.from({ length: 11 }, (_, n) => place(`p${n}`, `Client ${String.fromCharCode(65 + n)}`, n === 9 ? { active: true } : {}));
  rail = { places: many, add: { cloud: true, link: true, address: false } };
  expect(shownPlaces(many).map((entry) => entry.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p9"]);
  expect(shownPlaces(PLACES)).toEqual(PLACES);
  await mount(createElement(PlacesRail));
  expect(host.querySelectorAll("[data-rail-place]")).toHaveLength(8);
  await click(host.querySelector("[data-rail-more-button]"));
  const list = host.querySelector("[data-rail-more]")!;
  expect(list.querySelectorAll("li")).toHaveLength(11);
  const input = list.querySelector("input")!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(input, "client k");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect([...list.querySelectorAll("li")].map((row) => row.textContent)).toEqual(["CKClient K"]);
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(workspaces.open.mock.calls).toEqual([["p10"]]);
  expect(matchingPlaces(many, "zzz")).toEqual([]);
});

it("＋ offers buying a Cloud or adding the person's own server; the server's three steps end in main's own pairing-link dialog", async () => {
  await mount(createElement(PlacesRail));
  await click(host.querySelector("[data-rail-add]"));
  const sheet = document.querySelector("[data-place-add-sheet]")!;
  expect([...sheet.querySelectorAll("[data-place-add-choice]")].map((choice) => choice.getAttribute("data-place-add-choice"))).toEqual(["cloud", "server"]);
  await click(sheet.querySelector('[data-place-add-choice="server"]'));
  const steps = document.querySelector('[data-place-add="own-server"]')!;
  expect([...steps.querySelectorAll("[data-own-server-command]")].map((code) => code.textContent)).toEqual(["npx openmausbot start", 'npx openmausbot pair --label "My desktop"']);
  expect(steps.textContent).toContain("Paste pairing link");
  expect(steps.textContent).not.toContain("Enter its address instead");
  await click([...steps.querySelectorAll("button")].find((button) => button.textContent === "Paste pairing link"));
  expect(workspaces.add.mock.calls).toEqual([["link"]]);
  expect(document.querySelector("[data-place-add-sheet]")).toBeNull();
});

it("Buy a Cloud, for someone whose Admin sells one Cloud per account: the calm word, never an error", async () => {
  await mount(createElement(PlacesRail));
  await click(host.querySelector("[data-rail-add]"));
  await click(document.querySelector('[data-place-add-choice="cloud"]'));
  await act(async () => { await Promise.resolve(); });
  const flow = document.querySelector('[data-cloud-add="extra-one"]')!;
  expect(flow.textContent).toContain("One Cloud per account for now");
  expect(flow.textContent).toContain("You have My Cloud.");
  expect(cloudAdd.sheet).toHaveBeenCalledWith(true);
});

it("a circle's letters and words", () => {
  expect(["Client A", "Acme", "  my  cloud ", "Ünïcode Øne", "😀 Fun"].map(placeInitials)).toEqual(["CA", "A", "MC", "ÜØ", "😀F"]);
  expect(placeLabel(place("local", "This computer", { kind: "computer" }))).toBe("This computer");
  expect(placeLabel(place("x", "Acme", { attention: true }))).toBe("Acme: needs you");
});
