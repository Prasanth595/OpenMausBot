import { webgl2Available } from './gl'
import { type EyeStyle, SphereScene, type SphereShape } from './scene'

/**
 * Pictures of the real WebGL sphere, for places that can't afford a canvas each (avatars,
 * chips, list rows). One hidden scene renders every colour/shape/size once; CssSphere wears the
 * picture and adds its own eyes and moods on top, so small dots look exactly like the big ones.
 *
 * Each sphere gets a still (kept in localStorage, so the next page load has it at once) and,
 * from 18px up, a strip of frames of its liquid moving, which CSS plays back and forth.
 */

export type SpriteSpec = {
  size: number
  /** A hex colour, or a hue shift from the accent when there is none. */
  color: string | undefined
  hueShift: number
  shape: SphereShape
  eyeStyle: EyeStyle
  dim: number
  glow: number
}

export type Sprite = { still: string; strip: string | null; frames: number }

/** Frames in a moving strip; must match `steps(n - 1)` on `.zs-swirl` in tokens.css. */
export const SWIRL_FRAMES = 12
/** Only dots this big get a moving strip; smaller ones can't show it and it costs 12 renders. */
const SWIRL_FROM = 22
/** Seconds of the shader's clock between two frames. */
const FRAME_DT = 0.2
const STORE = 'zap.spheres.v1'
const STORE_MAX = 160
/** Milliseconds of drawing per idle slice, so the page never stalls. */
const SLICE = 6

/** How much bigger than the sphere the picture is (room for the glow). */
export const spriteBox = (size: number, glow: number) => Math.ceil(size * (1 + 0.55 * glow)) + 2

const cache = new Map<string, Sprite>()
const listeners = new Set<() => void>()
/** Stills first (every dot needs one), moving strips after (a nicety). */
const stills: { key: string; spec: SpriteSpec }[] = []
const strips: { key: string; spec: SpriteSpec }[] = []
const pending = new Set<string>()
let scene: SphereScene | null = null
let broken = false
let scheduled = false

export const spriteKey = (s: SpriteSpec) =>
  `${s.color?.toLowerCase() ?? `h${s.hueShift}`}|${s.shape}|${s.eyeStyle}|${Math.round(s.size)}|${s.dim.toFixed(2)}|${s.glow}`

// Stills from earlier visits, so dots look right from the first frame.
const stored: Record<string, string> = (() => {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
})()
for (const [key, still] of Object.entries(stored)) cache.set(key, { still, strip: null, frames: 1 })

/** Saving is batched: one write once things are quiet, not one per dot. */
let saveTimer: ReturnType<typeof setTimeout> | null = null
function remember(key: string, still: string) {
  stored[key] = still
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    idle(() => {
      try {
        const keys = Object.keys(stored)
        for (const old of keys.slice(0, Math.max(0, keys.length - STORE_MAX))) delete stored[old]
        localStorage.setItem(STORE, JSON.stringify(stored))
      } catch {
        // Full or blocked storage: the sprites still work for this page.
      }
    })
  }, 2500)
}

const idle = (fn: () => void) =>
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? window.requestIdleCallback(fn, { timeout: 500 })
    : setTimeout(fn, 16)

export function spriteFor(key: string): Sprite | null {
  return cache.get(key) ?? null
}

export function subscribeSprites(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const wantsStrip = (spec: SpriteSpec) => spec.size >= SWIRL_FROM && spec.dim < 0.6

/** Ask for a picture (and, for bigger dots, its moving strip); listeners hear once it's drawn. */
export function requestSprite(spec: SpriteSpec) {
  if (broken || typeof window === 'undefined') return
  const key = spriteKey(spec)
  const have = cache.get(key)
  if (pending.has(key) || (have && (have.strip || !wantsStrip(spec)))) return
  pending.add(key)
  ;(have ? strips : stills).push({ key, spec })
  schedule()
}

function schedule() {
  if (scheduled) return
  scheduled = true
  idle(drain)
}

function sceneOnce(): SphereScene | null {
  if (scene || broken) return scene
  try {
    if (!webgl2Available()) throw new Error('no webgl2')
    const canvas = document.createElement('canvas')
    scene = new SphereScene(canvas, {
      autoplay: false,
      followPointer: false,
      quality: 'high',
      dpr: Math.min(2, Math.max(1, window.devicePixelRatio || 1)) * 1.5,
    })
  } catch {
    broken = true
    scene = null
  }
  return scene
}

function place(sc: SphereScene, key: string, spec: SpriteSpec) {
  const box = spriteBox(spec.size, spec.glow)
  sc.resize(box, box)
  sc.add({
    id: key,
    x: box / 2,
    y: box / 2,
    radius: spec.size / 2,
    color: spec.color,
    hueShift: spec.hueShift,
    shape: spec.shape,
    eyeStyle: spec.eyeStyle,
    dim: spec.dim,
    eyes: false,
    bob: false,
    glow: spec.glow,
  })
}

/** Draw in small idle slices: all the stills first, then the moving strips. */
function drain() {
  scheduled = false
  const sc = sceneOnce()
  if (!sc) {
    stills.length = 0
    strips.length = 0
    pending.clear()
    return
  }
  const t0 = performance.now()
  let drew = false
  while ((stills.length || strips.length) && performance.now() - t0 < SLICE) {
    const strip = !stills.length
    const { key, spec } = (strip ? strips : stills).shift()!
    place(sc, key, spec)
    try {
      if (!strip) {
        sc.render()
        const still = sc.canvas.toDataURL('image/png')
        cache.set(key, { still, strip: null, frames: 1 })
        remember(key, still)
        // The moving strip comes later, once every dot on the page has its still.
        if (wantsStrip(spec)) strips.push({ key, spec })
        else pending.delete(key)
      } else {
        const w = sc.canvas.width
        const h = sc.canvas.height
        const out = document.createElement('canvas')
        out.width = w * SWIRL_FRAMES
        out.height = h
        const ctx = out.getContext('2d')!
        for (let i = 0; i < SWIRL_FRAMES; i++) {
          if (i) sc.step(FRAME_DT)
          sc.render()
          ctx.drawImage(sc.canvas, i * w, 0)
        }
        const prev = cache.get(key)
        cache.set(key, {
          still: prev?.still ?? out.toDataURL('image/png'),
          strip: out.toDataURL('image/png'),
          frames: SWIRL_FRAMES,
        })
        pending.delete(key)
      }
      drew = true
    } catch {
      pending.delete(key)
    }
    sc.remove(key)
  }
  if (stills.length || strips.length) schedule()
  if (drew) for (const fn of listeners) fn()
}
