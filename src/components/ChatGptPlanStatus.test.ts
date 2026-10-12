// @vitest-environment happy-dom
// The ChatGPT plan welcome is a modal. Opened inside a collapsed engine card it
// is invisible but still makes the page inert (#2693).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ChatGptPlanStatus } from "./ChatGptPlanStatus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let showModal: ReturnType<typeof vi.spyOn>;

function mount(open: boolean) {
  act(() => root.render(createElement("details", { open, "data-engine-card": "chatgpt" },
    createElement("summary", null, "ChatGPT"),
    createElement(ChatGptPlanStatus, { instanceId: "chatgpt" }))));
  return host.querySelector("details")!;
}
const welcome = () => host.querySelector<HTMLDialogElement>("dialog[data-chatgpt-plan-welcome]");
const toggle = (details: HTMLDetailsElement, open: boolean) => act(() => {
  details.open = open;
  details.dispatchEvent(new Event("toggle"));
});

beforeEach(() => {
  localStorage.clear();
  showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  showModal.mockRestore();
});

it("does not open the welcome modal while its engine card is collapsed", () => {
  mount(false);
  expect(welcome()).not.toBeNull();
  expect(showModal).not.toHaveBeenCalled();
  expect(welcome()!.open).toBe(false);
});

it("opens the welcome once the collapsed card is expanded", () => {
  const details = mount(false);
  toggle(details, true);
  expect(showModal).toHaveBeenCalledTimes(1);
  expect(welcome()!.open).toBe(true);
  toggle(details, true);
  expect(showModal).toHaveBeenCalledTimes(1);
});

it("opens the welcome immediately when nothing encloses it in a closed disclosure", () => {
  mount(true);
  expect(showModal).toHaveBeenCalledTimes(1);
});

it("opens immediately with no enclosing disclosure, as in the model picker", () => {
  act(() => root.render(createElement(ChatGptPlanStatus, { instanceId: "chatgpt" })));
  expect(showModal).toHaveBeenCalledTimes(1);
});

it("does not open after unmounting when the card is expanded later", () => {
  const details = mount(false);
  act(() => root.render(createElement("details", { "data-engine-card": "chatgpt" }, createElement("summary", null, "ChatGPT"))));
  toggle(host.querySelector("details")!, true);
  expect(details.isConnected).toBe(true);
  expect(showModal).not.toHaveBeenCalled();
});

it("does not open once another mount of the welcome was acknowledged", () => {
  const details = mount(false);
  localStorage.setItem("omb:chatgpt-plan-welcome:chatgpt", "1");
  toggle(details, true);
  expect(showModal).not.toHaveBeenCalled();
});

it("stays closed after the welcome was acknowledged", () => {
  localStorage.setItem("omb:chatgpt-plan-welcome:chatgpt", "1");
  const details = mount(false);
  toggle(details, true);
  expect(welcome()).toBeNull();
  expect(showModal).not.toHaveBeenCalled();
});
