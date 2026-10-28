// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const { CloudLendingFor } = await import("./CloudLendingFor");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null = null;
beforeEach(() => { setLocale("en"); host = document.createElement("div"); document.body.append(host); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); });

const snapshot = { available: true, screenAvailable: false, screenReady: false, state: { enabled: false, folders: [], screen: false } };
function bridge(places: Array<{ id: string; name: string }>, chosen = "home") {
  return {
    state: vi.fn(async () => snapshot), chooseFolder: vi.fn(async () => null), save: vi.fn(async () => snapshot), stop: vi.fn(async () => snapshot),
    places: vi.fn(async () => ({ places, chosen })), choose: vi.fn(async () => {}),
  };
}
async function mount(lending: ReturnType<typeof bridge>) {
  root = createRoot(host);
  await act(async () => { root!.render(createElement(CloudLendingFor, { bridge: lending as never })); });
  await act(async () => { await Promise.resolve(); });
}

it("with two Clouds or more of the person's own, the lending card says which one it is for, and choosing another asks main and reads that one", async () => {
  const lending = bridge([{ id: "home", name: "My Cloud" }, { id: "c-a", name: "Client A" }]);
  await mount(lending);
  const select = host.querySelector("[data-lending-for] select") as HTMLSelectElement;
  expect([...select.options].map((option) => option.textContent)).toEqual(["My Cloud", "Client A"]);
  expect(select.value).toBe("home");
  const reads = lending.state.mock.calls.length;
  await act(async () => {
    select.value = "c-a";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
  expect(lending.choose).toHaveBeenCalledWith("c-a");
  expect(lending.state.mock.calls.length).toBeGreaterThan(reads);
  await act(async () => { await Promise.resolve(); });
  expect(host.textContent, "the card says which Cloud's bots it lends to").toContain("Your bots on Client A open the websites");
  expect(host.textContent).not.toContain("Your bots on My Cloud");
});

it("one Cloud, or an older app: just the card, as before", async () => {
  await mount(bridge([{ id: "home", name: "My Cloud" }]));
  expect(host.querySelector("[data-lending-for]")).toBeNull();
});
