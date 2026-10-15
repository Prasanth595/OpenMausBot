import type { CursorState } from "@/components/CursorAvatar";

export type ZapDotMood = "idle" | "thinking" | "working" | "waiting" | "done" | "error" | "killed";

const MOODS = {
  sleeping: "killed",
  waking: "idle",
  idle: "idle",
  listening: "idle",
  thinking: "thinking",
  searching: "thinking",
  working: "working",
  excited: "done",
  surprised: "waiting",
  suspicious: "thinking",
  angry: "error",
  drowsy: "killed",
  happy: "done",
  curious: "waiting",
  confused: "thinking",
  bored: "idle",
  proud: "done",
  shy: "idle",
  sad: "error",
  laughing: "done",
  scared: "error",
  playful: "done",
  celebrate: "done",
  orbit: "working",
  radar: "thinking",
  progress: "working",
  spawning: "idle",
  humming: "idle",
  loading: "thinking",
  dictating: "working",
  writing: "working",
  sending: "working",
  receiving: "working",
  uploading: "working",
  notifying: "waiting",
  alerting: "error",
  dragging: "idle",
  bouncing: "waiting",
  "powering-down": "killed",
} satisfies Record<CursorState, ZapDotMood>;

export function zapMoodForState(state: CursorState): ZapDotMood {
  return MOODS[state] ?? "idle";
}

const EXPRESSION_MOODS: ZapDotMood[] = [
  "idle", "done", "thinking", "working", "killed", "waiting", "thinking", "error",
  "thinking", "waiting", "done", "error", "idle", "killed", "done", "thinking",
  "error", "idle", "done", "waiting", "thinking", "done", "killed", "waiting", "error",
];

export function zapMoodForExpression(index: number): ZapDotMood {
  return EXPRESSION_MOODS[((Math.trunc(index) % EXPRESSION_MOODS.length) + EXPRESSION_MOODS.length) % EXPRESSION_MOODS.length] ?? "idle";
}
