// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MausAvatar, type MausAvatarHandle } from "./Avatar";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Zap avatar motion preference", () => {
  it.each([false, true])("gates imperative animation and pointer gaze when reduced motion is %s", (reduced) => {
    vi.useFakeTimers();
    const animate = vi.fn();
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: reduced } as MediaQueryList);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const ref = createRef<MausAvatarHandle>();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() => root.render(createElement(MausAvatar, { ref, color: "green", size: 44 })));
      for (const target of host.querySelectorAll<HTMLElement>(".zap-dot, .zs-eye")) target.animate = animate;
      const wrapper = host.firstElementChild as HTMLElement;
      wrapper.getBoundingClientRect = () => ({ left: 0, top: 0, width: 44, height: 44 } as DOMRect);
      const before = host.querySelector<HTMLElement>(".zs-eye")!.style.left;
      act(() => {
        ref.current!.blink();
        ref.current!.spin();
        wrapper.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 40, clientY: 40 }));
      });
      expect(animate).toHaveBeenCalledTimes(reduced ? 0 : 3);
      const after = host.querySelector<HTMLElement>(".zs-eye")!.style.left;
      if (reduced) expect(after).toBe(before);
      else expect(after).not.toBe(before);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
