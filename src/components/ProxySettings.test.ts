// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ProxySettings } from "./ProxySettings";

afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });

it("shows direct by default and saves a selected proxy without restarting", async () => {
  setLocale("zh");
  const save = vi.fn(async (value: { mode: "direct" | "system" | "manual"; url: string }) => value);
  vi.stubGlobal("ogb", { desktopProxy: { read: async () => ({ mode: "direct", url: "" }), save } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(ProxySettings)));
  expect(container.textContent).toContain("代理设置");
  const select = container.querySelector("select")!;
  expect(select.value).toBe("direct");
  await act(async () => { select.value = "manual"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const input = container.querySelector("input")!;
  const button = container.querySelector("button")!;
  expect(input.type).toBe("url");
  expect(select.closest("label")!.parentElement).toBe(button.parentElement);
  expect(input.closest("label")!.parentElement).toBe(button.parentElement);
  await act(async () => { select.value = "system"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { container.querySelector("button")!.click(); });
  expect(save).toHaveBeenCalledWith({ mode: "system", url: "" });
  expect(container.textContent).toContain("重启 OpenMausBot 后生效");
  await act(async () => root.unmount());
  container.remove();
});
