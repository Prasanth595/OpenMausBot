import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MausAvatar } from "./Avatar";
import { CARVED_INK, REST_POSE, carvedLean, moodPose, stepPose, wantedPose, type CarvedPose } from "./carved-face";
import { carvedEyesFor, fitPose, paintCarvedFace, type CarvedParts } from "./cursor-carved-face";
import { FACE_BOX } from "./cursor-face-data";
import { MASCOT_BODY_IDS, type MascotBodyId } from "../../shared/mascot-bodies";

const face = (markup: string) => markup.slice(markup.indexOf("clip-path="));

describe("the carved face on mascot bodies", () => {
  it("is what every coloured mascot body wears, in dark ink", () => {
    for (const bodyId of MASCOT_BODY_IDS) {
      const markup = face(renderToStaticMarkup(createElement(MausAvatar, { color: "blue", bodyId, animated: false })));
      expect(markup.match(/<rect /g)?.length, bodyId).toBe(2);
      expect(markup, bodyId).toContain("<ellipse");
      expect(markup, bodyId).toContain(`fill="${CARVED_INK}"`);
    }
  });

  it("leaves chrome on its traced face", () => {
    const markup = face(renderToStaticMarkup(createElement(MausAvatar, { color: "chrome", bodyId: "blob", animated: false })));
    expect(markup).not.toContain("<rect ");
    expect(markup.match(/<path /g)?.length).toBe(3);
  });

  it("draws no mouth when the mouth is off", () => {
    const markup = face(renderToStaticMarkup(createElement(MausAvatar, { color: "blue", bodyId: "blob", animated: false, showMouth: false })));
    expect(markup.match(/<rect /g)?.length).toBe(2);
    expect(markup).not.toContain("<ellipse");
    expect(markup).not.toContain("<path ");
  });

  it("startles straight out, and keeps a glance within the body's reach", () => {
    const cursor = carvedEyesFor("cursor");
    const startled = fitPose(cursor, { ...REST_POSE, gx: 1, gy: -1, wide: 1 });
    expect(Math.abs(startled.gx) + Math.abs(startled.gy)).toBe(0);
    expect(fitPose(cursor, { ...REST_POSE, gx: -1 }).gx).toBe(-cursor.reach);
    expect(fitPose(carvedEyesFor("circle"), { ...REST_POSE, gx: -1, gy: 1 })).toMatchObject({ gx: -1, gy: 0.6 });
  });
});

type Painted = Record<string, string>;
const fakeElement = () => {
  const attrs: Painted = {};
  return { attrs, el: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } };
};

function paint(body: MascotBodyId, pose: CarvedPose) {
  const [left, right, smile, open, lean] = [fakeElement(), fakeElement(), fakeElement(), fakeElement(), fakeElement()];
  const parts = { eyes: [left.el, right.el], smile: smile.el, open: open.el } as unknown as CarvedParts;
  paintCarvedFace(parts, carvedEyesFor(body), pose, 1, lean.el as unknown as SVGGElement);
  return { eyes: [left.attrs, right.attrs], lean: lean.attrs.transform };
}

const POSES: CarvedPose[] = [-1, -0.5, 0, 0.5, 1].flatMap((gx) =>
  [-1, 0, 0.6].flatMap((gy) => [0, 0.5, 1].flatMap((wide) => [0, 0.9].map((shut) => ({ gx, gy, wide, shut, smile: 1 })))));

describe("the carved face as a body turns its gaze", () => {
  it("moves the eyes as a level pair of the same shape, turned by one rotation and never squeezed", () => {
    for (const body of MASCOT_BODY_IDS) {
      for (const pose of POSES) {
        const { eyes } = paint(body, pose);
        const [a, b] = eyes.map((e) => ({
          cy: Number(e.y) + Number(e.height) / 2,
          aspect: Number(e.width) / Number(e.height),
          turn: e.transform.match(/^rotate\((-?[\d.]+) [-\d.]+ (-?[\d.]+)\)$/),
        }));
        const at = `${body} ${JSON.stringify(pose)}`;
        expect(a.turn, at).not.toBeNull();
        expect(b.turn?.[1], at).toBe(a.turn?.[1]);
        expect(Math.abs(a.cy - b.cy), at).toBeLessThan(0.02);
        expect(Math.abs(a.aspect / b.aspect - 1), at).toBeLessThan(0.01);
      }
    }
  });

  it("leans the whole body into the glance, as a carved Halloween body does", () => {
    const body = carvedEyesFor("blob");
    const pose = { ...REST_POSE, gx: -1 };
    expect(paint("blob", pose).lean).toBe(carvedLean(fitPose(body, pose), FACE_BOX / 2, FACE_BOX * 0.625));
    expect(paint("blob", pose).lean).toContain("rotate(9)");
    expect(paint("blob", REST_POSE).lean).toContain("rotate(0)");
  });
});

describe("carved pose motion", () => {
  it("eases toward the mood and then reports nothing left to travel", () => {
    const pose = { ...REST_POSE };
    const want = wantedPose({ smile: -0.8, gy: 0.6 }, [1, 0], undefined, false);
    let left = Infinity;
    for (let frame = 0; frame < 240 && left > 0; frame++) left = stepPose(pose, want, 1 / 60, 0);
    expect(left).toBe(0);
    expect(pose).toEqual({ ...want, gx: 1 });
  });

  it("holds the mood's own gaze over a glance, and adds an outside gaze such as the pointer", () => {
    expect(wantedPose({ gx: 0.6, gy: -0.6, glance: 0 }, [-1, 0.25], { x: 0.2 }, false)).toMatchObject({ gx: 0.8, gy: -0.6 });
    expect(wantedPose({ glance: 0 }, [-1, 0.25], undefined, false)).toMatchObject({ gx: 0, gy: 0 });
    expect(wantedPose({}, [-1, 0.25], undefined, true)).toMatchObject({ gx: -1, gy: 0.25, wide: 1 });
  });

  it("closes the lids for a blink at once, then reopens them gradually", () => {
    const pose = moodPose("idle");
    stepPose(pose, moodPose("idle"), 1 / 60, 0.9);
    expect(pose.shut).toBe(0.9);
    stepPose(pose, moodPose("idle"), 1 / 60, 0);
    expect(pose.shut).toBeGreaterThan(0);
    expect(pose.shut).toBeLessThan(0.9);
  });
});
