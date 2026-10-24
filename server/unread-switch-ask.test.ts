import { describe, expect, it } from "vitest";

import { notifyKindSilencedByUnreadSwitch } from "../src/lib/unread-indicators.ts";
import { ASK_NOTIFICATIONS } from "./ask-routing.ts";

describe("the unread switch never silences an ask", () => {
  it.each([...ASK_NOTIFICATIONS])("%s", (kind) => {
    expect(notifyKindSilencedByUnreadSwitch(false, kind)).toBe(false);
  });
});
