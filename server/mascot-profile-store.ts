import {
  addOrSelectCustomMascot,
  createMascotProfile,
  legacyMascotBody,
  mascotProfileSchema,
  selectBuiltinMascot,
  type CustomMascotShape,
  type MascotProfile,
} from "../shared/mascot-profile.ts";
import type { BotRecord } from "./store.ts";

export type BotMascotState = Pick<BotRecord, "mascotBody" | "mascotProfile">;
export type { CustomMascotShape };
type BotMascotInput = Partial<BotMascotState>;

function isEmptyCursorProfile(profile: MascotProfile): boolean {
  return profile.shapes.length === 0 && profile.selected.kind === "builtin" && profile.selected.bodyId === "cursor";
}

/** Normalize the canonical profile while keeping absence distinct from an explicit legacy cursor selection. */
export function normalizeStoredBotMascotState(bot: BotMascotState): boolean {
  let changed = false;
  const parsed = mascotProfileSchema.safeParse(bot.mascotProfile);
  if (parsed.success) {
    bot.mascotProfile = parsed.data;
  } else {
    bot.mascotProfile = createMascotProfile(bot.mascotBody);
    changed = true;
  }

  if (isEmptyCursorProfile(bot.mascotProfile) && bot.mascotBody === undefined) return changed;

  const legacyBody = legacyMascotBody(bot.mascotProfile);
  if (bot.mascotBody !== legacyBody) changed = true;
  bot.mascotBody = legacyBody;
  return changed;
}

export function mascotStateForCreation(input: BotMascotInput): BotMascotState {
  const mascotProfile = input.mascotProfile === undefined
    ? createMascotProfile(input.mascotBody)
    : mascotProfileSchema.parse(input.mascotProfile);
  return {
    mascotProfile,
    ...(input.mascotProfile !== undefined || input.mascotBody !== undefined
      ? { mascotBody: legacyMascotBody(mascotProfile) }
      : {}),
  };
}

export function mascotStateForProfile(profile: MascotProfile): BotMascotState {
  const mascotProfile = mascotProfileSchema.parse(profile);
  return { mascotProfile, mascotBody: legacyMascotBody(mascotProfile) };
}

export function mascotStateForBody(profile: MascotProfile | undefined, bodyId: string | null): BotMascotState {
  const mascotProfile = selectBuiltinMascot(profile, bodyId ?? "cursor");
  return { mascotProfile, mascotBody: legacyMascotBody(mascotProfile) };
}

export function mascotStateWithCustomShape(profile: MascotProfile | undefined, shape: CustomMascotShape): BotMascotState {
  const mascotProfile = addOrSelectCustomMascot(profile, structuredClone(shape));
  return { mascotProfile, mascotBody: legacyMascotBody(mascotProfile) };
}
