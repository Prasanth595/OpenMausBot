import { z } from "zod";

const actionSchema = z.string().trim().min(1).max(80);
const laneSchema = z.object({
  approval: z.enum(["auto", "ask"]),
  actions: z.array(actionSchema).min(1).max(64),
  external_effects: z.boolean(),
}).strict();

export const autonomyPolicySchema = z.object({
  schema: z.literal("openmaus.autonomy-control-plane.v1"),
  mode: z.literal("bounded-autonomy"),
  default_approval: z.literal("ask"),
  session_persistence: z.object({
    provider: z.literal("managed-browser-profile"),
    state_at_rest: z.literal("encrypted"),
    restart_recovery: z.literal(true),
    human_sign_in_handoff: z.literal(true),
    credentials_model_visible: z.literal(false),
    profile_scope: z.literal("client-project-bot"),
  }).strict(),
  lanes: z.object({
    observe: laneSchema,
    reversible: laneSchema,
    consequential: laneSchema,
  }).strict(),
  invariants: z.array(z.string().trim().min(1).max(120)).min(1).max(32),
  recovery: z.object({
    checkpoint_required_before_step: z.literal(true),
    idempotency_key_required: z.literal(true),
    on_restart: z.literal("resume_last_verified_checkpoint"),
    on_stale_session: z.literal("pause_and_request_human_sign_in"),
    on_policy_error: z.literal("downgrade_to_ask"),
  }).strict(),
}).strict();

export type AutonomyPolicy = z.infer<typeof autonomyPolicySchema>;

/** Invalid or missing policy is deliberately returned as undefined so callers can fail closed to Ask. */
export function parseAutonomyPolicy(value: unknown): AutonomyPolicy | undefined {
  const parsed = autonomyPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}


export type AutonomyLane = "observe" | "reversible" | "consequential" | "unknown";

const OBSERVE_ACTIONS = new Set(["navigate", "read", "search", "inspect", "screenshot", "download_non_executable"]);
const REVERSIBLE_ACTIONS = new Set(["draft", "local_edit", "local_test", "create_checkpoint", "create_evidence"]);
const CONSEQUENTIAL_ACTIONS = new Set(["send", "publish", "deploy", "merge", "payment", "dns", "delete", "permission_change", "credential_change"]);

/** Classify by the runtime action name; unknown actions fail closed. */
export function autonomyLaneForAction(action: string): AutonomyLane {
  const normalized = action.trim().toLowerCase();
  if (OBSERVE_ACTIONS.has(normalized)) return "observe";
  if (REVERSIBLE_ACTIONS.has(normalized)) return "reversible";
  if (CONSEQUENTIAL_ACTIONS.has(normalized)) return "consequential";
  return "unknown";
}
