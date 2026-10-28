import { describe, expect, it } from "vitest";

import { carvedFace } from "../../src/components/carved-face.ts";
import { carvedEyesFor, fitPose } from "../../src/components/cursor-carved-face.tsx";
import { FACE_CENTRE } from "../../src/components/cursor-face-data.ts";
import { HALLOWEEN_BODIES } from "../../shared/halloween-bodies.ts";
import { MASCOT_BODIES, MASCOT_BODY_IDS, type MascotBodyId } from "../../shared/mascot-bodies.ts";
import { applyFit, boundsOf, flatten } from "./geometry.ts";
import { maskFromPolylines } from "./raster.ts";
import { fieldFromMask, sampleSdf } from "./sdf.ts";

type Point = [number, number];

const RASTER = 512;
const CLEARANCE = 1.5;
const ROTATE = /rotate\((-?[\d.]+) (-?[\d.]+) (-?[\d.]+)\)/;

const clipD = (id: MascotBodyId) => MASCOT_BODIES[id].clip.match(/ d="([^"]+)"/)![1];
const fitOf = (id: MascotBodyId) => {
  const [, tx, ty, scale] = MASCOT_BODIES[id].fit.match(/translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)/)!;
  return { tx: Number(tx), ty: Number(ty), scale: Number(scale) };
};
const outline = (id: MascotBodyId) => applyFit(flatten(clipD(id)), fitOf(id));

function rotate([x, y]: Point, transform: string): Point {
  const [, deg, cx, cy] = transform.match(ROTATE)!.map(Number);
  const a = (deg * Math.PI) / 180;
  return [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];
}

function pill(x: number, y: number, w: number, h: number, r: number): Point[] {
  const corners: Array<[number, number, number]> = [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]];
  return corners.flatMap(([cx, cy, from]) =>
    Array.from({ length: 7 }, (_, i): Point => {
      const a = ((from + i * 15) * Math.PI) / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }));
}

/** Every inked point of the face with the half-width of ink around it, in face-space units. */
function inkedPoints(id: MascotBodyId, pose: { gx: number; gy: number; wide: number; smile: number }): Array<[Point, number]> {
  const eyes = carvedEyesFor(id);
  const face = carvedFace(eyes, fitPose(eyes, { ...pose, shut: 0 }));
  const points: Array<[Point, number]> = face.eyes.flatMap((e) => pill(e.x, e.y, e.width, e.height, e.rx).map((p): [Point, number] => [rotate(p, e.transform), 0]));
  const [x0, y0, qx, qy, x1, y1] = face.smile.d.match(/-?[\d.]+/g)!.map(Number);
  if (face.smile.opacity > 0) {
    for (let t = 0; t <= 1; t += 0.125) {
      const at: Point = [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * qx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * qy + t * t * y1];
      points.push([rotate(at, face.smile.transform), eyes.w * 0.18]);
    }
  }
  if (face.open.opacity > 0) {
    for (let k = 0; k < 12; k++) points.push([[face.open.cx + face.open.rx * Math.cos((k * Math.PI) / 6), face.open.cy + face.open.ry * Math.sin((k * Math.PI) / 6)], 0]);
  }
  return points;
}

const GAZE = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];

describe("the carved face on each mascot body", () => {
  it.each(MASCOT_BODY_IDS)("stays inside the %s through every glance, pointer gaze, startle and smile", (id) => {
    const sdf = fieldFromMask(maskFromPolylines(outline(id), RASTER), RASTER);
    const { x, y, scale } = MASCOT_BODIES[id].anchor;
    let worst = { clearance: Infinity, pose: "" };
    for (const gx of GAZE) for (const gy of GAZE) for (const wide of [0, 0.25, 0.5, 0.75, 1]) for (const smile of [1.5, -0.8]) {
      for (const [[fx, fy], ink] of inkedPoints(id, { gx, gy, wide, smile })) {
        const clearance = sampleSdf(sdf, x + scale * (fx - FACE_CENTRE[0]), y + scale * (fy - FACE_CENTRE[1])) - ink * scale;
        if (clearance < worst.clearance) worst = { clearance, pose: JSON.stringify({ gx, gy, wide, smile }) };
      }
    }
    expect(worst.clearance, worst.pose).toBeGreaterThanOrEqual(CLEARANCE);
  });

  it("gives the roomy bodies a face as tall, for their height, as the carved Halloween faces", () => {
    const halloween = (["pumpkin", "ghost", "cat", "spider"] as const).map((id) => {
      const { minY, maxY } = boundsOf(flatten(HALLOWEEN_BODIES[id].clip));
      return HALLOWEEN_BODIES[id].eyes.h / (maxY - minY);
    });
    for (const id of ["blob", "circle", "squircle", "hexagon"] as const) {
      const { minY, maxY } = boundsOf(outline(id));
      const ratio = (carvedEyesFor(id).h * MASCOT_BODIES[id].anchor.scale) / (maxY - minY);
      expect(ratio, id).toBeGreaterThanOrEqual(Math.min(...halloween));
      expect(ratio, id).toBeLessThanOrEqual(Math.max(...halloween));
    }
  });
});
