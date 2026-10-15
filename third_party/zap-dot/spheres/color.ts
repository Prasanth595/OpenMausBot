/** Sphere colours. Each agent has its own solid body colour; gloss is added in the shader. */
export type RGB = [number, number, number]

export function oklchToLinear(L: number, C: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function hexToLinear(hex: string): RGB {
  const h = hex.replace('#', '')
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, (x) => x + x) : h, 16)
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)]
}

export function linearToSrgbHex([r, g, b]: RGB): string {
  const enc = (c: number) =>
    Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${enc(r)}${enc(g)}${enc(b)}`
}

/** The accent (project agent) colour. Tokens live in tokens.css (--zap-accent). */
export const ACCENT = '#C8FF00'
/** Kept for callers that still pass a hue shift: degrees in OKLCH from the accent. */
export const ACCENT_HUE = 124.5

export type SpherePalette = {
  body: RGB
  rim: RGB
  eye: RGB
  /** CSS colours for non-WebGL renderings (status dots, legends). */
  css: string
  cssEye: string
}

const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/**
 * Palette from a body colour (hex) or, for older callers, a hue shift from the accent.
 * `dim` (0–1) desaturates and darkens for dormant or stopped agents.
 */
export function spherePalette(color: string | number = ACCENT, dim = 0): SpherePalette {
  let body = typeof color === 'number' ? oklchToLinear(0.93, 0.226, ACCENT_HUE + color) : hexToLinear(color)
  if (dim > 0) {
    const grey = lum(body)
    body = mixRgb(body, [grey, grey, grey], dim * 0.8)
    body = body.map((c) => c * (1 - dim * 0.55)) as RGB
  }
  const rim = mixRgb(body, [1, 1, 1], 0.55)
  // Black eyes (Grok-bot style); light ones only if the liquid itself is near-black.
  const eye: RGB = lum(body) < 0.04 ? [0.9, 0.9, 0.9] : [0.0015, 0.0015, 0.002]
  return { body, rim, eye, css: linearToSrgbHex(body), cssEye: linearToSrgbHex(eye) }
}
