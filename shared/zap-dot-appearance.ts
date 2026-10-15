import { botMascotBody, type MascotBodyId } from "./mascot-bodies";

export type ZapDotShape = "circle" | "squircle" | "pill" | "hexagon";

export const ZAP_DOT_COLORS = {
  green: "#C8FF00",
  blue: "#4DA3FF",
  red: "#FF6A3D",
  orange: "#FFB020",
  purple: "#B98CFF",
  cyan: "#9BE7FF",
  pink: "#FF5FCB",
  yellow: "#FFE14D",
  teal: "#2EE6C9",
  coral: "#FF8FAB",
} as const;

const SHAPES = {
  cursor: "circle",
  blob: "squircle",
  circle: "circle",
  squircle: "squircle",
  capsule: "pill",
  drop: "circle",
  shield: "squircle",
  hexagon: "hexagon",
  diamond: "hexagon",
  star: "hexagon",
} satisfies Record<MascotBodyId, ZapDotShape>;

export function zapDotShape(body: string | null | undefined): ZapDotShape {
  return SHAPES[botMascotBody(body)];
}
