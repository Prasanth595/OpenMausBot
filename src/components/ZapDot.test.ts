import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CssSphere } from "../../third_party/zap-dot/spheres/react";
import { spriteBox, spriteKey } from "../../third_party/zap-dot/spheres/sprite";

const render = (props: Partial<Parameters<typeof CssSphere>[0]> = {}) =>
  renderToStaticMarkup(createElement(CssSphere, { size: 40, color: "#C8FF00", mood: "idle", seed: "bot-1", ...props }));

describe("reference Zap face and sprite geometry", () => {
  it("uses the reference pill eyes, positions and phase with no mouth", () => {
    const html = render();
    expect(html.match(/class="zs-eye"/g)).toHaveLength(2);
    expect(html).toContain("width:3.4000000000000004px;height:9.200000000000001px");
    expect(html).toContain("calc(47.5% + 0px - 4.6000000000000005px");
    expect(html).toContain("background:#050505");
    expect(html).not.toContain("<path");
    expect(render()).toBe(html);
    expect(render({ seed: "bot-2" })).not.toBe(html);
  });

  it("changes expression and motion without replacing the identity color", () => {
    expect(render({ mood: "thinking" })).toContain("zs-bob");
    expect(render({ mood: "working" })).toContain("zs-orbit");
    expect(render({ mood: "waiting" })).toContain("zs-hop");
    expect(render({ mood: "done" })).toContain("zs-joy");
    expect(render({ mood: "error" })).toContain("zs-shake");
    for (const mood of ["idle", "thinking", "working", "waiting", "done", "error"] as const) {
      expect(render({ mood })).toContain("#c8ff00");
    }
    const offline = render({ mood: "killed" });
    expect(offline).not.toContain("zs-eye");
    expect(offline).not.toContain("zs-orbit");
    expect(offline).toContain("height:1px");
  });

  it("preserves the reference capsule proportions, rounded hex path and halo bounds", () => {
    expect(render({ shape: "pill" })).toContain("width:52.800000000000004px;height:40px");
    expect(render({ shape: "squircle" })).toContain("border-radius:34%");
    expect(render({ shape: "hexagon" })).toContain("clip-path:path(&#x27;M");
    expect(spriteBox(40, 0.8)).toBe(60);
    const spec = { size: 40, color: "#C8FF00", hueShift: 0, shape: "circle" as const, eyeStyle: "pill" as const, dim: 0, glow: 0.8 };
    expect(spriteKey(spec)).toBe(spriteKey({ ...spec, color: "#c8ff00" }));
    expect(spriteKey(spec)).not.toBe(spriteKey({ ...spec, dim: 0.85 }));
  });
});
