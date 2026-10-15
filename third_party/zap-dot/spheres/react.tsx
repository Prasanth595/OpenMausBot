'use client'

import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { spherePalette } from './color'
import { webgl2Available } from './gl'
import { type EyeStyle, type SceneOptions, type SphereMood, SphereScene, type SphereShape } from './scene'
import { requestSprite, spriteBox, spriteFor, spriteKey, subscribeSprites } from './sprite'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/**
 * Hosts a SphereScene on a canvas that tracks its container size. `onReady` runs once
 * with the scene (and again if WebGL is lost and recreated).
 */
export function SphereCanvas({
  className,
  style,
  options,
  onReady,
  onResize,
  fallback,
  label,
}: {
  label?: string
  className?: string
  style?: CSSProperties
  options?: SceneOptions
  // biome-ignore lint/suspicious/noConfusingVoidType: a React-style effect callback that may return a cleanup
  onReady?: (scene: SphereScene) => void | (() => void)
  onResize?: (scene: SphereScene, w: number, h: number) => void
  fallback?: React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduced = usePrefersReducedMotion()
  const [failed, setFailed] = useState(false)
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const resizeRef = useRef(onResize)
  resizeRef.current = onResize

  // Scene is created once per mount; options changes are applied via the scene API.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    if (!webgl2Available()) {
      setFailed(true)
      return
    }
    let scene: SphereScene
    try {
      scene = new SphereScene(canvas, { ...options, reducedMotion: options?.reducedMotion ?? reduced })
    } catch {
      setFailed(true)
      return
    }
    const rect = wrap.getBoundingClientRect()
    scene.resize(rect.width, rect.height)
    const cleanup = readyRef.current?.(scene)
    scene.render()
    const ro = new ResizeObserver(([e]) => {
      if (!e) return
      scene.resize(e.contentRect.width, e.contentRect.height)
      resizeRef.current?.(scene, e.contentRect.width, e.contentRect.height)
      scene.render()
    })
    ro.observe(wrap)
    const lost = (ev: Event) => {
      ev.preventDefault()
      setFailed(true)
    }
    canvas.addEventListener('webglcontextlost', lost)
    return () => {
      ro.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      if (typeof cleanup === 'function') cleanup()
      scene.destroy()
    }
  }, [reduced])

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: /\b(absolute|fixed)\b/.test(className ?? '') ? undefined : 'relative', ...style }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {failed ? (
        fallback
      ) : (
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />
      )}
    </div>
  )
}

/** Rounded pointy-top hexagon as a CSS clip path, in px (matches the shader's hexagon). */
function hexClip(w: number, h: number) {
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) / 2
  const r = R * 0.22
  const pts = [-90, -30, 30, 90, 150, 210].map(
    (a) => [cx + R * Math.cos((a * Math.PI) / 180), cy + R * Math.sin((a * Math.PI) / 180)] as const,
  )
  const lerp = (a: readonly [number, number], b: readonly [number, number], t: number): [number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ]
  const side = Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1])
  const t = r / side
  let d = ''
  pts.forEach((v, i) => {
    const prev = pts[(i + 5) % 6]!
    const next = pts[(i + 1) % 6]!
    const a = lerp(v, prev, t)
    const b = lerp(v, next, t)
    d += `${i === 0 ? 'M' : 'L'}${a[0].toFixed(2)} ${a[1].toFixed(2)} Q${v[0].toFixed(2)} ${v[1].toFixed(2)} ${b[0].toFixed(2)} ${b[1].toFixed(2)} `
  })
  return `path('${d}Z')`
}

const hashSeed = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * CSS-only liquid sphere: list avatars, chips, the no-WebGL fallback. Shows a face from 16px,
 * in any shape and eye style, and acts out its mood (blinks, bobs while working, hops while
 * waiting, squints when happy, shakes on errors) with CSS animations — cheap enough for lists.
 */
export function CssSphere({
  size,
  color,
  hueShift = 0,
  dim = 0,
  eyes,
  shape = 'circle',
  eyeStyle = 'pill',
  mood,
  seed,
  className,
  glow = 0.8,
  look: gaze,
}: {
  size: number
  color?: string
  hueShift?: number
  dim?: number
  eyes?: boolean
  shape?: SphereShape
  eyeStyle?: EyeStyle
  /** Animate a state; omit for a still sphere. */
  mood?: SphereMood
  /** Desynchronises blinks between spheres in a list. */
  seed?: string
  className?: string
  /** The sphere's own halo (0.8 like the agent map); 0 for none, e.g. in the flat sidebar. */
  glow?: number
  /**
   * Where the eyes look, -1…1 on each axis (e.g. toward the cursor). The eyes move at most 15%
   * of the sphere's size; null or omitted keeps them where the mood puts them.
   */
  look?: { x: number; y: number } | null
}) {
  const p = spherePalette(color ?? hueShift, dim)
  const asleep = dim > 0.6 || mood === 'killed'
  // The real sphere, drawn once by WebGL; the gradient below is only the stand-in until it lands.
  const sprite = {
    size: Math.round(size),
    color,
    hueShift,
    shape,
    eyeStyle,
    dim: asleep ? Math.max(dim, 0.85) : dim,
    glow,
  }
  const key = spriteKey(sprite)
  const img = useSyncExternalStore(
    subscribeSprites,
    () => spriteFor(key),
    () => null,
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key covers the spec
  useEffect(() => requestSprite(sprite), [key])
  const box = spriteBox(Math.round(size), glow)
  const radius = shape === 'squircle' ? '34%' : '50%'
  const w = shape === 'pill' ? size * 1.32 : size
  const face = eyes ?? size >= 16
  const ew = Math.max(1.5, size * 0.085)
  const dot = eyeStyle === 'dot'
  const sq = eyeStyle === 'square'
  const eyeW = dot ? ew * 1.45 : sq ? ew * 1.35 : ew
  const eyeH = asleep ? Math.max(1, size * 0.02) : dot ? ew * 1.45 : sq ? ew * 1.6 : Math.max(3, size * 0.23)
  const happy = mood === 'done' && !asleep
  const worried = mood === 'error' && !asleep
  const delay = `-${(hashSeed(seed ?? `${color}${size}`) % 5000) / 1000}s`
  const clip = shape === 'hexagon' ? hexClip(w, size) : undefined
  const anim =
    !mood || asleep
      ? undefined
      : mood === 'working' || mood === 'thinking'
        ? 'zs-bob'
        : mood === 'waiting'
          ? 'zs-hop'
          : mood === 'error'
            ? 'zs-shake'
            : mood === 'done'
              ? 'zs-joy'
              : undefined
  const busy = (mood === 'working' || mood === 'thinking') && !asleep && size >= 14
  // Eyes drift up-right while thinking, as if working something out; `look` points them elsewhere.
  const clamp = (v: number) => Math.max(-1, Math.min(1, v))
  const look =
    gaze && !asleep
      ? { x: clamp(gaze.x) * size * 0.15, y: clamp(gaze.y) * size * 0.1 }
      : mood === 'thinking'
        ? { x: size * 0.035, y: -size * 0.035 }
        : { x: 0, y: 0 }
  return (
    <span
      aria-hidden
      className={`zs ${anim ?? ''} ${className ?? ''}`}
      style={{
        position: 'relative',
        display: 'inline-block',
        flexShrink: 0,
        width: w,
        height: size,
        filter:
          img || glow === 0
            ? undefined
            : `drop-shadow(0 0 ${Math.max(2, size * 0.22)}px color-mix(in oklab, ${p.css} ${asleep ? 14 : 34}%, transparent))`,
        animationDelay: anim === 'zs-joy' || anim === 'zs-shake' ? undefined : delay,
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: shape === 'pill' ? size : radius,
          clipPath: img ? undefined : clip,
          background: img
            ? undefined
            : `radial-gradient(${shape === 'pill' ? 'ellipse' : 'circle'} at 40% 34%, color-mix(in oklab, ${p.css} 92%, #fff) 0, ${p.css} 45%, color-mix(in oklab, ${p.css} 78%, #000) 88%, color-mix(in oklab, ${p.css} 70%, #fff) 100%)`,
        }}
      >
        {img ? (
          <span
            className={img.strip && !asleep ? 'zs-swirl' : undefined}
            style={{
              position: 'absolute',
              left: (w - box) / 2,
              top: (size - box) / 2,
              width: box,
              height: box,
              backgroundImage: `url(${img.strip && !asleep ? img.strip : img.still})`,
              backgroundSize: img.strip && !asleep ? `${img.frames * 100}% 100%` : '100% 100%',
              backgroundRepeat: 'no-repeat',
              animationDelay: delay,
              pointerEvents: 'none',
            }}
          />
        ) : null}
        {face
          ? [-1, 1].map((side) => (
              <span
                key={side}
                className={!mood || asleep || happy ? undefined : 'zs-eye'}
                style={{
                  position: 'absolute',
                  // --zs-gx / --zs-gy (-1…1), set by a parent, let the eyes follow something.
                  left: `calc(50% + ${side * size * (dot ? 0.13 : 0.122) + look.x}px - ${eyeW / 2}px + var(--zs-gx, 0) * ${(size * 0.075).toFixed(2)}px)`,
                  top: `calc(47.5% + ${look.y}px - ${(happy ? ew * 1.6 : eyeH) / 2}px + var(--zs-gy, 0) * ${(size * 0.06).toFixed(2)}px)`,
                  transition: 'left 180ms ease-out, top 180ms ease-out',
                  width: happy ? ew * 2.2 : eyeW,
                  height: happy ? ew * 1.6 : eyeH,
                  marginLeft: happy ? -(ew * 0.6) : 0,
                  borderRadius: happy ? `${ew * 2}px ${ew * 2}px 0 0` : sq ? Math.max(0.5, ew * 0.28) : ew,
                  background: happy ? 'transparent' : '#050505',
                  borderTop: happy ? `${Math.max(1.2, ew * 0.75)}px solid #050505` : undefined,
                  borderLeft: happy ? `${Math.max(1.2, ew * 0.75)}px solid #050505` : undefined,
                  borderRight: happy ? `${Math.max(1.2, ew * 0.75)}px solid #050505` : undefined,
                  transform: worried ? `rotate(${side * -14}deg)` : undefined,
                  animationDelay: delay,
                }}
              />
            ))
          : null}
        {img ? null : (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse 30% 19% at 33% 25%, rgba(255,255,255,.92) 0 40%, rgba(255,255,255,0) 100%)',
            }}
          />
        )}
      </span>
      {busy ? (
        <span
          className="zs-orbit"
          style={{ position: 'absolute', inset: -size * 0.16, animationDelay: delay }}
        >
          <span
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              width: Math.max(2.5, size * 0.13),
              height: Math.max(2.5, size * 0.13),
              marginLeft: -Math.max(2.5, size * 0.13) / 2,
              borderRadius: '50%',
              background: p.css,
              boxShadow: `0 0 4px ${p.css}`,
            }}
          />
        </span>
      ) : null}
    </span>
  )
}

/** A single liquid sphere in its own canvas (empty states, previews). */
export function AgentSphere({
  size,
  color,
  shape,
  eyeStyle,
  hueShift = 0,
  dim = 0,
  mood = 'idle',
  className,
  label,
}: {
  size: number
  color?: string
  shape?: SphereShape
  eyeStyle?: EyeStyle
  hueShift?: number
  dim?: number
  mood?: SphereMood
  className?: string
  label?: string
}) {
  const sceneRef = useRef<SphereScene | null>(null)
  const pad = size * 0.45
  const box = size + pad * 2
  useEffect(() => {
    sceneRef.current?.setMood('me', mood)
  }, [mood])
  useEffect(() => {
    sceneRef.current?.update('me', { hueShift, dim, color, shape, eyeStyle })
  }, [hueShift, dim, color, shape, eyeStyle])
  return (
    <SphereCanvas
      className={className}
      style={{ width: box, height: box, margin: -pad }}
      options={{ quality: size > 48 ? 'high' : 'low' }}
      fallback={
        <span style={{ position: 'absolute', inset: pad }}>
          <CssSphere
            size={size}
            color={color}
            hueShift={hueShift}
            dim={dim}
            shape={shape}
            eyeStyle={eyeStyle}
            mood={mood}
          />
        </span>
      }
      onReady={(scene) => {
        sceneRef.current = scene
        scene.add({
          id: 'me',
          x: box / 2,
          y: box / 2,
          radius: size / 2,
          color,
          shape,
          eyeStyle,
          hueShift,
          dim,
        })
        scene.setMood('me', mood)
        return () => {
          sceneRef.current = null
        }
      }}
      label={label}
    />
  )
}

export type { SphereMood }
