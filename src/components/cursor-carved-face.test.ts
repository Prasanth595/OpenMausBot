import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MausAvatar } from "./Avatar";
import { CARVED_INK, REST_POSE, moodPose, stepPose, wantedPose } from "./carved-face";
import { CARVED_EYES, carvedEyesFor } from "./cursor-carved-face";
import { MASCOT_BODY_IDS } from "../../shared/mascot-bodies";

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

  it("sits the cursor's face lower, with a shorter glance, and leaves the other bodies alone", () => {
    const cursor = carvedEyesFor("cursor");
    expect(cursor.cy).toBeGreaterThan(CARVED_EYES.cy);
    expect(cursor.reach).toBeLessThan(1);
    for (const body of MASCOT_BODY_IDS.filter((id) => id !== "cursor")) expect(carvedEyesFor(body)).toEqual({ ...CARVED_EYES, reach: 1 });
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
