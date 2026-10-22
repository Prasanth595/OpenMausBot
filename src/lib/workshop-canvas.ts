// The Workshop sketch canvas, as pure logic.
//
// Shapes are an append-only list; the eraser is an action over that list, not
// a pixel brush, so every edit stays a small, undoable, replayable object.
// Rendering, reading, and export all consume the same array, and the panel
// component stays a thin layer of pointer events over these functions.
export type Point = { x: number; y: number };

export type ToolId = "pen" | "eraser" | "line" | "arrow" | "box" | "ellipse" | "label";

export type Shape =
  | { kind: "pen"; id: string; color: string; width: number; points: Point[] }
  | { kind: "line"; id: string; color: string; width: number; from: Point; to: Point }
  | { kind: "arrow"; id: string; color: string; width: number; from: Point; to: Point }
  | { kind: "box"; id: string; color: string; width: number; from: Point; to: Point }
  | { kind: "ellipse"; id: string; color: string; width: number; from: Point; to: Point }
  | { kind: "label"; id: string; color: string; width: number; x: number; y: number; text: string };

export interface History {
  past: Shape[][];
  present: Shape[];
  future: Shape[][];
}

/** Suggested canvas size; the panel scales it into its layout box. */
export const SKETCH_WIDTH = 960;
export const SKETCH_HEIGHT = 560;
export const LABEL_FONT_PX = 14;
export const LABEL_LINE_HEIGHT = 18;

/** A hue range tuned to stay readable on both the dark canvas and a white
 * exported background. */
export const WORKSHOP_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#3b82f6", "#8b5cf6", "#ec4899", "#e5e7eb",
] as const;

export const DEFAULT_COLOR = WORKSHOP_COLORS[0];

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `s${Math.random().toString(36).slice(2)}`;
}

export function beginShape(
  tool: ToolId,
  color: string,
  width: number,
  at: Point,
  text?: string,
): Shape {
  const id = newId();
  switch (tool) {
    case "pen":
      return { kind: "pen", id, color, width, points: [at] };
    case "line":
    case "box":
    case "ellipse":
    case "arrow":
      return { kind: tool, id, color, width, from: at, to: at };
    case "label":
      return { kind: "label", id, color, width, x: at.x, y: at.y, text: text ?? "" };
    case "eraser":
      throw new Error("the eraser is an action, not a shape — call eraseAt instead");
  }
}

/** Drag feedback: pen appends, the other drags move `to`. Labels ship complete. */
export function extendShape(shape: Shape, at: Point): Shape {
  if (shape.kind === "pen") {
    const points = [...shape.points, at];
    return { ...shape, points };
  }
  if (shape.kind === "line" || shape.kind === "box" || shape.kind === "ellipse" || shape.kind === "arrow") {
    return { ...shape, to: at };
  }
  return shape;
}

/** Squared distance from p to the segment a→b. */
export function pointSegmentDistanceSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/** True when a shape sits under the pointer. Erasing removes whole shapes —
 * tap a stroke and it goes, drag over several and every touched one goes. */
export function hitTest(shape: Shape, at: Point, slack = 6): boolean {
  const reach = slack + shape.width / 2;
  switch (shape.kind) {
    case "pen":
      return shape.points.some((point, index) =>
        index === 0
          ? (at.x - point.x) ** 2 + (at.y - point.y) ** 2 <= reach * reach
          : pointSegmentDistanceSq(at, shape.points[index - 1]!, point) <= reach * reach,
      );
    case "line":
    case "arrow":
      return pointSegmentDistanceSq(at, shape.from, shape.to) <= reach * reach;
    case "box": {
      const minX = Math.min(shape.from.x, shape.to.x) - reach;
      const maxX = Math.max(shape.from.x, shape.to.x) + reach;
      const minY = Math.min(shape.from.y, shape.to.y) - reach;
      const maxY = Math.max(shape.from.y, shape.to.y) + reach;
      return at.x >= minX && at.x <= maxX && at.y >= minY && at.y <= maxY;
    }
    case "ellipse": {
      const cx = (shape.from.x + shape.to.x) / 2;
      const cy = (shape.from.y + shape.to.y) / 2;
      const rx = Math.abs(shape.to.x - shape.from.x) / 2 + reach;
      const ry = Math.abs(shape.to.y - shape.from.y) / 2 + reach;
      if (rx === 0 || ry === 0) return false;
      return ((at.x - cx) / rx) ** 2 + ((at.y - cy) / ry) ** 2 <= 1;
    }
    case "label": {
      // Rough monospace box — hit removal never needs exact glyph metrics.
      const half = reach / 2;
      const left = shape.x - half;
      const top = shape.y - LABEL_FONT_PX - half;
      return (
        at.x >= left &&
        at.x <= left + shape.text.length * LABEL_FONT_PX * 0.6 + reach &&
        at.y >= top &&
        at.y <= top + LABEL_LINE_HEIGHT + reach * 2
      );
    }
  }
}

export function eraseAt(shapes: Shape[], at: Point): Shape[] {
  return shapes.filter((shape) => !hitTest(shape, at));
}

export function emptyHistory(): History {
  return { past: [], present: [], future: [] };
}

/** One history entry per finishing action — an added shape or an erase pass. */
export function commitShapes(history: History, present: Shape[]): History {
  return { past: [...history.past, history.present], present, future: [] };
}

export function undo(history: History): History {
  if (!history.past.length) return history;
  const present = history.past[history.past.length - 1]!;
  return { past: history.past.slice(0, -1), present, future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  if (!history.future.length) return history;
  const present = history.future[0]!;
  return { past: [...history.past, history.present], present, future: history.future.slice(1) };
}

/** Pure shapes → Canvas2D calls. The recorder in the tests feeds a minimal
 * ctx; the panel hands in a real one. Label boxes are drawn so the export
 * stays legible on any background. */
export function renderShapes(
  ctx: {
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    fillText(text: string, x: number, y: number): void;
    closePath(): void;
    set fillStyle(value: unknown);
    set strokeStyle(value: unknown);
    set lineWidth(value: number);
    set font(value: string);
    set lineCap(value: string);
    set lineJoin(value: string);
    ellipse?(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  },
  shapes: Shape[],
): void {
  const rounded = (shape: Shape): Point[] => {
    if (shape.kind !== "pen") return [];
    const points = shape.points;
    if (points.length <= 2) return points;
    // Quadratic smoothing: use segment midpoints as control joins so
    // freehand ink reads as ink, not as dot-to-dot.
    const smoothed: Point[] = [points[0]!];
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      smoothed.push({ x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 });
    }
    smoothed.push(points[points.length - 1]!);
    return smoothed;
  };

  const strokePath = (color: string, width: number, points: Point[]): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  };

  for (const shape of shapes) {
    switch (shape.kind) {
      case "pen": {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        strokePath(shape.color, shape.width, rounded(shape));
        break;
      }
      case "line":
        strokePath(shape.color, shape.width, [shape.from, shape.to]);
        break;
      case "arrow": {
        strokePath(shape.color, shape.width, [shape.from, shape.to]);
        const dx = shape.to.x - shape.from.x;
        const dy = shape.to.y - shape.from.y;
        const length = Math.hypot(dx, dy);
        if (length === 0) break;
        const head = Math.max(8, Math.min(22, length * 0.3));
        const angle = Math.atan2(dy, dx);
        const wing = (direction: number) => ({
          x: shape.to.x - head * Math.cos(angle + direction * 0.45),
          y: shape.to.y - head * Math.sin(angle + direction * 0.45),
        });
        strokePath(shape.color, shape.width, [shape.to, wing(1)]);
        strokePath(shape.color, shape.width, [shape.to, wing(-1)]);
        break;
      }
      case "box": {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.width;
        const x = Math.min(shape.from.x, shape.to.x);
        const y = Math.min(shape.from.y, shape.to.y);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.abs(shape.to.x - shape.from.x), y);
        ctx.lineTo(x + Math.abs(shape.to.x - shape.from.x), y + Math.abs(shape.to.y - shape.from.y));
        ctx.lineTo(x, y + Math.abs(shape.to.y - shape.from.y));
        ctx.closePath();
        ctx.stroke();
        break;
      }
      case "ellipse": {
        if (!ctx.ellipse) {
          // Node test recorders may not implement ellipse; fall back to a box.
          renderShapes(ctx, [{ ...shape, kind: "box" }]);
          break;
        }
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.width;
        ctx.beginPath();
        ctx.ellipse(
          (shape.from.x + shape.to.x) / 2,
          (shape.from.y + shape.to.y) / 2,
          Math.abs(shape.to.x - shape.from.x) / 2,
          Math.abs(shape.to.y - shape.from.y) / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        break;
      }
      case "label": {
        ctx.font = `${LABEL_FONT_PX}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(0,0,0,0.035)";
        ctx.fillRect(shape.x - 4, shape.y - LABEL_FONT_PX, shape.text.length * LABEL_FONT_PX * 0.6 + 8, LABEL_LINE_HEIGHT);
        ctx.fillStyle = shape.color;
        ctx.fillText(shape.text, shape.x, shape.y);
        break;
      }
    }
  }
}

export interface SketchExport {
  shapes: Shape[];
  width: number;
  height: number;
}

/** The panel calls this to turn the sketch into the attachment File the
 * composer pipeline uploads. Node environments (tests, SSR) have no canvas —
 * it returns null there instead of throwing. */
export async function sketchToPngFile(
  shapes: Shape[],
  width = SKETCH_WIDTH,
  height = SKETCH_HEIGHT,
): Promise<{ file: File; bytes: number } | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (typeof doc === "undefined" || typeof doc.createElement !== "function") return null;
  const canvas = doc.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof ctx.canvas.toBlob !== "function") return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  renderShapes(ctx, shapes);
  const blob = await new Promise<Blob | null>((resolve) => ctx.canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    file: new File([blob], `workshop-sketch-${stamp}.png`, { type: "image/png" }),
    bytes: blob.size,
  };
}
