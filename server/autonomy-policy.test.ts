import { describe, expect, it } from "vitest";

import { parseAutonomyPolicy } from "./autonomy-policy.ts";

const validPolicy = {
  schema: "openmaus.autonomy-control-plane.v1",
  mode: "bounded-autonomy",
  default_approval: "ask",
  session_persistence: {
    provider: "managed-browser-profile",
    state_at_rest: "encrypted",
    restart_recovery: true,
    human_sign_in_handoff: true,
    credentials_model_visible: false,
    profile_scope: "client-project-bot",
  },
  lanes: {
    observe: { approval: "auto", actions: ["navigate", "read"], external_effects: false },
    reversible: { approval: "auto", actions: ["draft", "local_test"], external_effects: false },
    consequential: { approval: "ask", actions: ["send", "deploy"], external_effects: true },
  },
  invariants: ["fail_closed_on_unknown_action"],
  recovery: {
    checkpoint_required_before_step: true,
    idempotency_key_required: true,
    on_restart: "resume_last_verified_checkpoint",
    on_stale_session: "pause_and_request_human_sign_in",
    on_policy_error: "downgrade_to_ask",
  },
} as const;

describe("autonomy policy validation", () => {
  it("accepts the bounded policy shape", () => {
    expect(parseAutonomyPolicy(validPolicy)).toEqual(validPolicy);
  });

  it("fails closed for malformed or widened policy values", () => {
    expect(parseAutonomyPolicy({ ...validPolicy, default_approval: "full" })).toBeUndefined();
    expect(parseAutonomyPolicy({ ...validPolicy, recovery: { ...validPolicy.recovery, on_policy_error: "continue" } })).toBeUndefined();
    expect(parseAutonomyPolicy({ ...validPolicy, unexpected: true })).toBeUndefined();
  });
});
