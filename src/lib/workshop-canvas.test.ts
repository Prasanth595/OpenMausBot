import { describe, expect, it } from "vitest";

import {
  beginShape,
  commitShapes,
  emptyHistory,
  eraseAt,
  hitTest,
  pointSegmentDistanceSq,
  redo,
  renderShapes,
  sketchToPngFile,
  undo,
  WORKSHOP_COLORS,
  type Shape,
  type ToolId,
} from "./workshop-canvas";

function shape(tool: ToolId, extra: Partial<Shape> = {}): Shape {
  const base = beginShape(tool, "#ef4444", 3, { x: 10, y: 10 }, "pump");
  return { ...base, ...extra } as Shape;
}

describe("shapes", () => {
  it("builds the pen's first point and extends drag shapes", () => {
    const pen = shape("pen");
    expect(pen.kind).toBe("pen");
    const grown = extend(pen) as Extract<Shape, { kind: "pen" }>;
    expect(grown.points).toEqual([{ x: 10, y: 10 }, { x: 40, y: 40 }]);

    const box = extend(shape("box")) as Extract<Shape, { kind: "box" }>;
    expect(box.from).toEqual({ x: 10, y: 10 });
    expect(box.to).toEqual({ x: 40, y: 40 });
    expect(box.color).toBe("#ef4444");
  });

  it("refuses the eraser as a shape — it is an action", () => {
    expect(() => beginShape("eraser", "#ef4444", 3, { x: 0, y: 0 })).toThrow(/action/);
  });

  it("labels carry their text", () => {
    const label = shape("label") as Extract<Shape, { kind: "label" }>;
    expect(label.text).toBe("pump");
  });
});

function extend(base: Shape): Shape {
  if (base.kind === "pen") return { ...base, points: [...base.points, { x: 40, y: 40 }] };
  if (base.kind === "label") return base;
  return { ...base, to: { x: 40, y: 40 } };
}

describe("hit testing", () => {
  it("measures point-to-segment distance", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(pointSegmentDistanceSq({ x: 5, y: 3 }, a, b)).toBe(9);
    expect(pointSegmentDistanceSq({ x: 15, y: 0 }, a, b)).toBe(25);
    expect(pointSegmentDistanceSq({ x: 5, y: 0 }, a, b)).toBe(0);
  });

  it("catches a pen stroke a small distance away", () => {
    const pen = {
      kind: "pen", id: "p", color: "#fff", width: 2,
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
    } as Extract<Shape, { kind: "pen" }>;
    expect(hitTest(pen, { x: 25, y: 4 })).toBe(true);
    expect(hitTest(pen, { x: 25, y: 40 })).toBe(false);
  });

  it("treats a box as interior-on, edge-on, outside-off", () => {
    const box = shape("box", { from: { x: 0, y: 0 }, to: { x: 30, y: 30 } }) as Extract<Shape, { kind: "box" }>;
    expect(hitTest(box, { x: 15, y: 15 })).toBe(true);
    expect(hitTest(box, { x: 30, y: 16 })).toBe(true);
    expect(hitTest(box, { x: 60, y: 15 })).toBe(false);
  });

  it("sizes the ellipse knob by shape and slack, centered", () => {
    const ellipse = shape("ellipse", { from: { x: 0, y: 0 }, to: { x: 40, y: 20 } }) as Extract<Shape, { kind: "ellipse" }>;
    expect(hitTest(ellipse, { x: 20, y: 10 })).toBe(true);
    expect(hitTest(ellipse, { x: 22, y: 11 })).toBe(true);
    expect(hitTest(ellipse, { x: 40, y: 30 })).toBe(false);
  });

  it("erases whole shapes with one pass and leaves the untouched", () => {
    const pen = shape("pen", {
      points: [{ x: 0, y: 0 }, { x: 30, y: 0 }],
    }) as Extract<Shape, { kind: "pen" }>;
    const line = shape("line", { from: { x: 100, y: 100 }, to: { x: 140, y: 100 } }) as Extract<Shape, { kind: "line" }>;
    const after = eraseAt([pen, line], { x: 15, y: 1 });
    expect(after.map((s) => s.id)).toEqual([line.id]);
  });

  it("estimates label area deterministically", () => {
    const label = shape("label") as Extract<Shape, { kind: "label" }>;
    expect(hitTest(label, { x: 12, y: 4 })).toBe(true);
    expect(hitTest(label, { x: 12, y: 40 })).toBe(false);
  });
});

describe("history", () => {
  it("commits, undoes, and redoes one action at a time", () => {
    const shape1 = shape("pen") as Shape;
    let history = commitShapes(emptyHistory(), [shape1]);
    expect(history.present).toEqual([shape1]);

    const shape2 = shape("box") as Shape;
    history = commitShapes(history, [shape1, shape2]);
    history = undo(history);
    expect(history.present.map((s) => s.id)).toEqual([shape1.id]);

    history = redo(history);
    expect(history.present.map((s) => s.id)).toEqual([shape1.id, shape2.id]);

    history = undo(history);
    history = undo(history);
    expect(history.present).toEqual([]);
    // nothing further to undo
    expect(undo(history)).toBe(history);
  });

  it("drops the redo branch when a new action lands", () => {
    const shape1 = shape("line") as Shape;
    let history = commitShapes(emptyHistory(), [shape1]);
    history = commitShapes(history, []);
    // undo to bring back shape1
    history = undo(history);
    expect(history.future.length).toBe(1);
    // adding again kills the branch
    const shape2 = shape("pen") as Shape;
    history = commitShapes(history, [shape1, shape2]);
    expect(history.future).toEqual([]);
  });

  it("erases are history entries, so undo restores erased shapes", () => {
    const pen = shape("pen", { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }) as Shape;
    let history = commitShapes(emptyHistory(), [pen]);
    history = commitShapes(history, eraseAt(history.present, { x: 5, y: 0 }));
    expect(history.present).toEqual([]);
    history = undo(history);
    expect(history.present.map((s) => s.id)).toEqual([pen.id]);
  });
});

describe("rendering", () => {
  function recorder() {
    const calls: string[] = [];
    const strokeStyleChain = (color: unknown) => calls.push(`stroke:${String(color)}`);
    return {
      calls,
      beginPath: () => calls.push("begin"),
      moveTo: (x: number, y: number) => calls.push(`move:${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`line:${x},${y}`),
      stroke: () => calls.push("stroke"),
      closePath: () => calls.push("close"),
      fillRect: (x: number, y: number, w: number, h: number) => calls.push(`fillRect:${x},${y},${w},${h}`),
      fillText: (text: string, x: number, y: number) => calls.push(`text:${text}@${x},${y}`),
      ellipse: (x: number, y: number, rx: number, ry: number) => calls.push(`ellipse:${x},${y},${rx},${ry}`),
      set fillStyle(value: unknown) { calls.push(`fill:${typeof value === "string" ? value : String(value)}`); },
      set strokeStyle(value: unknown) { strokeStyleChain(value); },
      set lineWidth(value: number) { calls.push(`width:${value}`); },
      set font(value: string) { calls.push(`font:${value}`); },
      set lineCap(value: string) { calls.push(`cap:${value}`); },
      set lineJoin(value: string) { calls.push(`join:${value}`); },
    };
  }

  it("draws a pen smooth and an arrow with a head", () => {
    const ctx = recorder();
    const pen = shape("pen", {
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 30 }],
    }) as Extract<Shape, { kind: "pen" }>;
    const arrow = shape("arrow", { from: { x: 0, y: 0 }, to: { x: 0, y: 40 } }) as Extract<Shape, { kind: "arrow" }>;
    renderShapes(ctx, [pen, arrow]);
    expect(ctx.calls[0]).toBe("cap:round");
    expect(ctx.calls.includes("close")).toBe(false);
    // pen (1) + arrow main line (1) + two head wings (2)
    const strokes = ctx.calls.filter((call) => call === "stroke").length;
    expect(strokes).toBe(4);
    const wing = ctx.calls.find((call) => call.startsWith("line:") && !call.startsWith("line:0,40"));
    expect(wing).toBeTruthy();
  });

  it("boxes close, ellipses use their center, labels get text at their anchor", () => {
    const ctx = recorder();
    const box = shape("box", { from: { x: 0, y: 0 }, to: { x: 40, y: 20 } }) as Extract<Shape, { kind: "box" }>;
    const ellipse = shape("ellipse", { from: { x: 0, y: 0 }, to: { x: 40, y: 20 } }) as Extract<Shape, { kind: "ellipse" }>;
    const label = shape("label") as Extract<Shape, { kind: "label" }>;
    renderShapes(ctx, [box, ellipse, label]);
    expect(ctx.calls.some((call) => call === "begin")).toBe(true);
    expect(ctx.calls.some((call) => call === "close")).toBe(true);
    expect(ctx.calls.some((call) => call.startsWith("ellipse:20,10,20,10"))).toBe(true);
    expect(ctx.calls.some((call) => call === "text:pump@10,10")).toBe(true);
    expect(ctx.calls.some((call) => call.startsWith("font:"))).toBe(true);
  });
});

describe("export", () => {
  it("returns null quietly where there is no canvas (node tests)", async () => {
    expect(await sketchToPngFile([])).toBeNull();
  });
});

describe("palette", () => {
  it("ships readable swatches and a default", () => {
    expect(WORKSHOP_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(WORKSHOP_COLORS.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
  });
});
