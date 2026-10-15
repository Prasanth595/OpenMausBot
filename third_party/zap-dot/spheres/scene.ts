import { type SpherePalette, spherePalette } from './color'

const BLINK_S = 0.15

import { attrib, createProgram, type Program, uniform } from './gl'
import { BRIDGE_FRAG, BRIDGE_VERT, SPHERE_FRAG, SPHERE_VERT, TRAIL_FRAG, TRAIL_VERT } from './glsl'

export type SphereShape = 'circle' | 'squircle' | 'pill' | 'hexagon'
export const SPHERE_SHAPES: SphereShape[] = ['circle', 'squircle', 'pill', 'hexagon']
const SHAPE_CODE: Record<SphereShape, number> = { circle: 0, squircle: 1, pill: 2, hexagon: 3 }

export type SphereMood = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'error' | 'killed'

export type SphereSpec = {
  id: string
  x: number
  y: number
  radius: number
  /** Solid body colour (hex). Each agent has its own. */
  color?: string
  /** Legacy: hue shift in degrees from the accent (used when no colour is given). */
  hueShift?: number
  /** 0 = vivid, 1 = asleep (dormant / killed agents). */
  dim?: number
  /** Draw the face (eyes). Defaults on for spheres big enough to read it. */
  eyes?: boolean
  /** Shell shape (the default circle, or a user's pick). */
  shape?: SphereShape
  /** Eye style (pill like Grok by default). */
  eyeStyle?: EyeStyle
  /** Gentle floating in place. */
  bob?: boolean
  glow?: number
}

type Vec = { x: number; y: number }
type Ripple = { x: number; y: number; t0: number; strength: number }
type Spray = { x: number; y: number; r: number; t0: number; vx?: number; vy?: number }

export type EyeStyle = 'pill' | 'dot' | 'square'
export const EYE_STYLES: EyeStyle[] = ['pill', 'dot', 'square']
const EYE_CODE: Record<EyeStyle, number> = { pill: 0, dot: 1, square: 2 }

type Sphere = {
  id: string
  pos: Vec
  vel: Vec
  target: Vec
  radius: number
  baseRadius: number
  hueShift: number
  color: string | undefined
  dim: number
  targetDim: number
  palette: SpherePalette
  /** null = automatic (face when the sphere is big enough to read it). */
  eyes: boolean | null
  shape: SphereShape
  eyeStyle: EyeStyle
  /** Expression: 0 normal · 1 happy · 2 worried (smoothed toward exprTarget). */
  expr: number
  exprTarget: number
  exprUntil: number
  hover: number
  jelly: number
  jellyVel: number
  orbit: number
  shakeUntil: number
  hopAt: number
  look: Vec
  lookTarget: Vec
  lookHold: number
  blinkAt: number
  blinkStart: number
  sleep: number
  targetSleep: number
  mood: SphereMood
  paletteKey: string
  slosh: Vec
  sloshVel: Vec
  prevVel: Vec
  stretch: number
  stretchDir: Vec
  ripples: Ripple[]
  energy: number
  targetEnergy: number
  pulse: number
  spray: Spray[]
  seed: number
  bob: boolean
  glow: number
  stiffness: number
  damping: number
  /** Droplets are temporary and removed when merged. */
  droplet?: Droplet
  /** A merged droplet's trail, left behind to dry. Not drawn as a sphere. */
  ghost?: boolean
  /** Being born out of a parent (cell-division style). */
  birth?: {
    parentId: string
    t0: number
    duration: number
    dir: Vec
    finalR: number
    target: Vec
    released: boolean
  }
  /** This sphere is budding a child: its film stretches toward it. */
  budding?: { dir: Vec; t0: number; duration: number }
}

type Droplet = {
  from: string
  to: string
  t0: number
  duration: number
  p0: Vec
  p1: Vec
  ctrl: Vec
  resolve: () => void
  phase: 'bud' | 'travel' | 'merge' | 'done'
  /** The gooey strand back to the parent: stretches, thins, snaps, recoils. */
  tether: { snapped: boolean; snapT: number; snapAt: Vec; anchor: Vec }
}

export type SceneOptions = {
  dpr?: number
  quality?: 'low' | 'high'
  reducedMotion?: boolean
  /** Seconds for a trail to dry and vanish. */
  dryTime?: number
  /** Run the animation loop automatically. */
  autoplay?: boolean
  transparent?: boolean
  /** Eyes follow the cursor anywhere on the page (default on). */
  followPointer?: boolean
  /** Thicker (>1) or thinner movement trails. Default 1. */
  trailWidth?: number
  /** How solid movement trails are, 0–1 (default 0.55; delegation strands are always 1). */
  trailStrength?: number
}

const FIXED_DT = 1 / 120

/**
 * A canvas of liquid spheres: physics (springs, slosh, stretch), ripples, glossy trails
 * and delegation droplets, rendered in one WebGL2 context. Time is owned by the scene so
 * the playground can freeze it and render deterministic filmstrips.
 */
export class SphereScene {
  readonly canvas: HTMLCanvasElement
  readonly gl: WebGL2RenderingContext
  time = 0
  width = 0
  height = 0
  dpr: number
  quality: 'low' | 'high'
  reducedMotion: boolean
  dryTime: number
  trailWidth: number
  trailStrength: number
  /** Called after each render (e.g. to blit into other canvases). */
  onFrame?: () => void

  private spheres = new Map<string, Sphere>()
  private order: string[] = []
  private progs: { sphere: Program; bridge: Program; trail: Program }
  private quad: WebGLBuffer
  private trailBuf: WebGLBuffer
  private raf = 0
  private last = 0
  private stillQueued = false
  private dead = false
  private acc = 0
  private running = false
  private visible = true
  private observer?: IntersectionObserver
  private onVisibility = () => this.syncLoop()
  private uid = 0
  /** Last cursor position in canvas px and when it moved (performance.now ms). */
  private pointer: { x: number; y: number; at: number } | null = null
  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect()
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, at: performance.now() }
  }
  private onPointerDown = (e: PointerEvent) => {
    this.onPointerMove(e)
    if (this.reducedMotion) return
    // Everyone glances at the click and blinks; the one you touched ripples.
    for (const s of this.spheres.values()) {
      if (s.ghost || s.droplet) continue
      s.blinkAt = Math.min(s.blinkAt, this.time + 0.05 + (hashString(s.id) % 100) / 1000)
    }
    const hit = this.pick(this.pointer!.x, this.pointer!.y)
    if (hit) {
      const s = this.spheres.get(hit)!
      this.ripple(hit, {
        x: (this.pointer!.x - s.pos.x) / s.radius,
        y: -(this.pointer!.y - s.pos.y) / s.radius,
        strength: 0.9,
      })
    }
  }

  constructor(canvas: HTMLCanvasElement, opts: SceneOptions = {}) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    // Lets dev tooling re-render before capturing frames.
    ;(canvas as unknown as { __scene?: SphereScene }).__scene = this
    this.dpr = Math.min(opts.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1), 2)
    this.quality = opts.quality ?? 'high'
    this.reducedMotion = opts.reducedMotion ?? false
    this.dryTime = opts.dryTime ?? 2.4
    this.trailWidth = opts.trailWidth ?? 1
    this.trailStrength = opts.trailStrength ?? 0.55
    this.progs = {
      sphere: createProgram(gl, SPHERE_VERT, SPHERE_FRAG),
      bridge: createProgram(gl, BRIDGE_VERT, BRIDGE_FRAG),
      trail: createProgram(gl, TRAIL_VERT, TRAIL_FRAG),
    }
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.trailBuf = gl.createBuffer()!
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(([e]) => {
        this.visible = !!e?.isIntersecting
        this.syncLoop()
      })
      this.observer.observe(canvas)
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility)
    if (typeof window !== 'undefined' && opts.followPointer !== false) {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true })
      window.addEventListener('pointerdown', this.onPointerDown, { passive: true })
    }
    if (opts.autoplay !== false) this.start()
  }

  // ── Public API ───────────────────────────────────────────────────────────

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.canvas.width = Math.max(1, Math.round(width * this.dpr))
    this.canvas.height = Math.max(1, Math.round(height * this.dpr))
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
  }

  add(spec: SphereSpec) {
    const hueShift = spec.hueShift ?? 0
    const dim = spec.dim ?? 0
    const seed = (hashString(spec.id) % 1000) / 37
    const s: Sphere = {
      id: spec.id,
      pos: { x: spec.x, y: spec.y },
      vel: { x: 0, y: 0 },
      prevVel: { x: 0, y: 0 },
      target: { x: spec.x, y: spec.y },
      radius: spec.radius,
      baseRadius: spec.radius,
      hueShift,
      color: spec.color,
      dim,
      targetDim: dim,
      palette: spherePalette(spec.color ?? hueShift, dim),
      paletteKey: `${spec.color ?? hueShift}:${dim}`,
      eyes: spec.eyes ?? null,
      shape: spec.shape ?? 'circle',
      eyeStyle: spec.eyeStyle ?? 'pill',
      expr: 0,
      exprTarget: 0,
      exprUntil: 0,
      hover: 0,
      jelly: 0,
      jellyVel: 0,
      orbit: 0,
      shakeUntil: 0,
      hopAt: 0,
      look: { x: 0, y: 0 },
      lookTarget: { x: 0, y: 0 },
      lookHold: 0,
      blinkAt: this.time + 1.5 + (seed % 3),
      blinkStart: -10,
      sleep: dim > 0.6 ? 1 : 0,
      targetSleep: dim > 0.6 ? 1 : 0,
      mood: 'idle',
      slosh: { x: 0, y: 0 },
      sloshVel: { x: 0, y: 0 },
      stretch: 0,
      stretchDir: { x: 1, y: 0 },
      ripples: [],
      energy: 0,
      targetEnergy: 0,
      pulse: 0,
      spray: [],
      seed,
      bob: spec.bob ?? true,
      glow: spec.glow ?? 1,
      stiffness: 36,
      damping: 11,
    }
    this.spheres.set(spec.id, s)
    this.order.push(spec.id)
    return s.id
  }

  has(id: string) {
    return this.spheres.has(id)
  }

  remove(id: string) {
    this.spheres.delete(id)
    this.order = this.order.filter((o) => o !== id)
  }

  update(id: string, patch: Partial<Omit<SphereSpec, 'id'>>) {
    const s = this.spheres.get(id)
    if (!s) return
    if (patch.radius != null) {
      s.baseRadius = patch.radius
      if (s.radius < 2) s.radius = patch.radius
    }
    if (patch.hueShift != null) s.hueShift = patch.hueShift
    if (patch.color != null) s.color = patch.color
    if (patch.eyes != null) s.eyes = patch.eyes
    if (patch.shape != null) s.shape = patch.shape
    if (patch.eyeStyle != null) s.eyeStyle = patch.eyeStyle
    if (patch.dim != null) {
      s.targetDim = patch.dim
      if (s.mood !== 'killed') s.targetSleep = patch.dim > 0.6 ? 1 : 0
    }
    if (patch.bob != null) s.bob = patch.bob
    if (patch.glow != null) s.glow = patch.glow
    if (patch.x != null && patch.y != null) this.moveTo(id, patch.x, patch.y)
    this.paintStill()
  }

  /** Glide to a point (springy); `instant` teleports without a trail. */
  moveTo(
    id: string,
    x: number,
    y: number,
    opts: { instant?: boolean; stiffness?: number; damping?: number } = {},
  ) {
    const s = this.spheres.get(id)
    if (!s) return
    s.target = { x, y }
    if (opts.stiffness) s.stiffness = opts.stiffness
    if (opts.damping) s.damping = opts.damping
    if (opts.instant || this.reducedMotion) {
      s.pos = { x, y }
      s.vel = { x: 0, y: 0 }
    }
  }

  position(id: string): Vec | undefined {
    const s = this.spheres.get(id)
    return s ? { ...s.pos } : undefined
  }

  /** A ripple across the surface — start, stop and finish moments. */
  ripple(id: string, opts: { x?: number; y?: number; strength?: number } = {}) {
    const s = this.spheres.get(id)
    if (!s) return
    if (this.reducedMotion) {
      s.pulse = Math.max(s.pulse, 0.6)
      return
    }
    s.ripples.push({ x: opts.x ?? 0, y: opts.y ?? 0, t0: this.time, strength: opts.strength ?? 1 })
    if (s.ripples.length > 4) s.ripples.shift()
    // A little kick to the liquid so it jiggles, away from where the ripple starts.
    const kick = 1.6 * (opts.strength ?? 1)
    const ox = opts.x ?? 0
    const oy = opts.y ?? 0
    const len = Math.hypot(ox, oy)
    if (len > 0.05) {
      s.sloshVel.x += (-ox / len) * kick
      s.sloshVel.y += (-oy / len) * kick
    } else s.sloshVel.y -= kick * 0.6
    s.pulse = Math.max(s.pulse, 0.25 * (opts.strength ?? 1))
  }

  pulse(id: string, amount = 0.6) {
    const s = this.spheres.get(id)
    if (s) s.pulse = Math.max(s.pulse, amount)
  }

  setEnergy(id: string, energy: number) {
    const s = this.spheres.get(id)
    if (s) s.targetEnergy = Math.max(0, Math.min(1, energy))
  }

  /** Map an agent state to energy, dimming and the right ripple. */
  setMood(id: string, mood: SphereMood) {
    const s = this.spheres.get(id)
    if (!s) return
    const energy = {
      idle: 0.05,
      thinking: 0.55,
      working: 0.9,
      waiting: 0.25,
      done: 0.15,
      error: 0.3,
      killed: 0,
    }[mood]
    const wasActive = s.targetEnergy > 0.4
    s.targetEnergy = energy
    if (mood === 'killed') {
      s.targetDim = 0.85
      s.targetSleep = 1
    } else if (s.mood === 'killed') {
      s.targetDim = 0
      s.targetSleep = 0
    }
    s.mood = mood
    if (mood === 'done') {
      s.blinkAt = this.time + 1.9
      s.exprTarget = 1
      s.exprUntil = this.time + 1.8
      this.burst(s)
    } else if (mood === 'error') {
      s.exprTarget = 2
      s.exprUntil = this.time + 2.6
      s.shakeUntil = this.time + 0.5
    } else if (mood === 'waiting') {
      s.hopAt = this.time + 0.3
    }
    if (mood === 'thinking' || mood === 'working') {
      if (!wasActive) this.ripple(id, { strength: 0.9 })
    } else if (mood === 'done') this.ripple(id, { strength: 1.2 })
    else if (mood === 'error' || mood === 'waiting') this.ripple(id, { strength: 0.6 })
    else if (wasActive) this.ripple(id, { strength: 0.5 })
    this.paintStill()
  }

  /**
   * Delegation: a droplet buds off `fromId`, travels (leaving its trail) and merges into
   * `toId`, which ripples. Resolves when merged.
   */
  delegate(fromId: string, toId: string, opts: { duration?: number } = {}): Promise<void> {
    const from = this.spheres.get(fromId)
    const to = this.spheres.get(toId)
    if (!from || !to) return Promise.resolve()
    if (this.reducedMotion) {
      this.pulse(fromId, 0.4)
      this.pulse(toId, 0.8)
      return Promise.resolve()
    }
    const dx = to.pos.x - from.pos.x
    const dy = to.pos.y - from.pos.y
    const dist = Math.hypot(dx, dy) || 1
    const dir = { x: dx / dist, y: dy / dist }
    const perp = { x: -dir.y, y: dir.x }
    const r = Math.max(5, Math.min(from.radius, to.radius) * 0.4)
    const p0 = {
      x: from.pos.x + dir.x * (from.radius - r * 0.4),
      y: from.pos.y + dir.y * (from.radius - r * 0.4),
    }
    const p1 = { x: to.pos.x - dir.x * (to.radius * 0.35), y: to.pos.y - dir.y * (to.radius * 0.35) }
    const bend = (hashString(fromId + toId + this.uid) % 2 ? 1 : -1) * dist * 0.18
    const ctrl = { x: (p0.x + p1.x) / 2 + perp.x * bend, y: (p0.y + p1.y) / 2 + perp.y * bend }
    const id = `__drop${++this.uid}`
    return new Promise((resolve) => {
      this.add({
        id,
        x: p0.x,
        y: p0.y,
        radius: r,
        color: from.color,
        hueShift: from.hueShift,
        bob: false,
        glow: 0.8,
        eyes: false,
      })
      const d = this.spheres.get(id)!
      d.droplet = {
        from: fromId,
        to: toId,
        t0: this.time,
        duration: opts.duration ?? Math.min(1.6, 0.7 + dist / 600),
        p0,
        p1,
        ctrl,
        resolve,
        phase: 'bud',
        tether: {
          snapped: false,
          snapT: 0,
          snapAt: { ...p0 },
          anchor: { x: from.pos.x + dir.x * from.radius * 0.9, y: from.pos.y + dir.y * from.radius * 0.9 },
        },
      }
      this.ripple(fromId, { x: dir.x * 0.8, y: -dir.y * 0.8, strength: 0.7 })
      // Launch: the sender squishes toward the throw.
      from.budding = { dir, t0: this.time, duration: 0.32 }
      // Both look at each other while the droplet travels.
      from.lookTarget = { x: dir.x, y: -dir.y }
      from.lookHold = this.time + (opts.duration ?? 1.2) + 0.4
      to.lookTarget = { x: -dir.x, y: dir.y }
      to.lookHold = this.time + (opts.duration ?? 1.2) + 0.8
    })
  }

  /**
   * A new agent is born out of `parentId`: the parent's film stretches, a bud pushes out
   * through a neck that pinches off, and the newborn glides to (spec.x, spec.y) growing to size.
   */
  spawn(parentId: string, spec: SphereSpec, opts: { duration?: number } = {}) {
    const parent = this.spheres.get(parentId)
    if (!parent || this.reducedMotion) {
      this.add(spec)
      this.pulse(spec.id, 0.8)
      if (parent) this.pulse(parentId, 0.5)
      return
    }
    const dx = spec.x - parent.pos.x
    const dy = spec.y - parent.pos.y
    const d = Math.hypot(dx, dy) || 1
    const dir = { x: dx / d, y: dy / d }
    const duration = opts.duration ?? 1.25
    this.add({
      ...spec,
      x: parent.pos.x + dir.x * parent.radius * 0.2,
      y: parent.pos.y + dir.y * parent.radius * 0.2,
      radius: spec.radius * 0.25,
      bob: false,
    })
    const c = this.spheres.get(spec.id)!
    c.radius = spec.radius * 0.25
    c.baseRadius = spec.radius * 0.25
    c.birth = {
      parentId,
      t0: this.time,
      duration,
      dir,
      finalR: spec.radius,
      target: { x: spec.x, y: spec.y },
      released: false,
    }
    c.bob = spec.bob ?? true
    parent.budding = { dir, t0: this.time, duration: duration * 0.6 }
    this.ripple(parentId, { x: dir.x * 0.7, y: -dir.y * 0.7, strength: 0.9 })
    parent.lookTarget = { x: dir.x, y: -dir.y }
    parent.lookHold = this.time + duration + 0.6
  }

  /** The sphere under a point (CSS px), for clicks and hovers. */
  pick(x: number, y: number): string | undefined {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const s = this.spheres.get(this.order[i]!)!
      if (s.droplet || s.ghost) continue
      if (Math.hypot(x - s.pos.x, y - s.pos.y) <= s.radius) return s.id
    }
    return undefined
  }

  start() {
    this.running = true
    this.syncLoop()
  }

  stop() {
    this.running = false
    this.syncLoop()
  }

  /** Advance the simulation by `dt` seconds with a fixed internal step (deterministic). */
  step(dt: number, opts: { clamp?: boolean } = {}) {
    this.acc += opts.clamp ? Math.min(dt, 0.25) : dt
    while (this.acc >= FIXED_DT) {
      this.simulate(FIXED_DT)
      this.acc -= FIXED_DT
    }
  }

  /**
   * Stop and detach. Pass `loseContext` only for canvases you own and will discard —
   * a React canvas can be re-used by the next mount (StrictMode) and must keep its context.
   */
  destroy(opts: { loseContext?: boolean } = {}) {
    this.dead = true
    this.stop()
    this.observer?.disconnect()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove)
      window.removeEventListener('pointerdown', this.onPointerDown)
    }
    const gl = this.gl
    for (const p of Object.values(this.progs)) gl.deleteProgram(p.program)
    gl.deleteBuffer(this.quad)
    gl.deleteBuffer(this.trailBuf)
    if (opts.loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

  /**
   * While paused (offscreen, hidden tab) changes should still show: settle the simulation a
   * moment and draw one frame. Batched per tick so a burst of updates paints once.
   */
  private paintStill() {
    if (this.raf || this.stillQueued || this.dead) return
    this.stillQueued = true
    queueMicrotask(() => {
      this.stillQueued = false
      if (this.raf || this.dead) return
      this.step(0.35, { clamp: true })
      this.render()
    })
  }

  private syncLoop() {
    const hidden = typeof document !== 'undefined' && document.hidden
    const shouldRun = this.running && this.visible && !hidden
    if (shouldRun && !this.raf) {
      this.last = performance.now()
      const tick = (now: number) => {
        this.step((now - this.last) / 1000, { clamp: true })
        this.last = now
        this.render()
        this.raf = requestAnimationFrame(tick)
      }
      this.raf = requestAnimationFrame(tick)
    } else if (!shouldRun && this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  private simulate(dt: number) {
    this.time += dt
    const rm = this.reducedMotion
    for (const id of [...this.order]) {
      const s = this.spheres.get(id)
      if (!s) continue
      if (s.ghost) {
        s.spray = s.spray.filter((d) => this.time - d.t0 < this.dryTime)
        if (!s.spray.length) this.remove(id)
        continue
      }

      if (s.birth) this.advanceBirth(s, dt)
      if (s.droplet) this.advanceDroplet(s, dt)
      else if (s.birth && !s.birth.released) {
        // Position is driven by the bud while attached.
      } else {
        // Spring toward the target (+ a gentle float).
        const bob = s.bob && !rm ? Math.sin(this.time * 0.9 + s.seed) * s.baseRadius * 0.035 : 0
        const tx = s.target.x
        const ty = s.target.y + bob
        const ax = (tx - s.pos.x) * s.stiffness - s.vel.x * s.damping
        const ay = (ty - s.pos.y) * s.stiffness - s.vel.y * s.damping
        s.vel.x += ax * dt
        s.vel.y += ay * dt
        s.pos.x += s.vel.x * dt
        s.pos.y += s.vel.y * dt
      }

      // Slosh: the liquid inside lags behind acceleration, overshoots and settles.
      const accX = (s.vel.x - s.prevVel.x) / dt
      const accY = (s.vel.y - s.prevVel.y) / dt
      s.prevVel = { ...s.vel }
      if (!rm) {
        const k = 60
        const c = 3.6
        const gain = 0.0012 / Math.max(0.6, s.baseRadius / 60)
        // Screen y is down; the shader's y is up.
        s.sloshVel.x += (-k * s.slosh.x - c * s.sloshVel.x - accX * gain) * dt
        s.sloshVel.y += (-k * s.slosh.y - c * s.sloshVel.y + accY * gain) * dt
        s.slosh.x = clamp(s.slosh.x + s.sloshVel.x * dt, -1, 1)
        s.slosh.y = clamp(s.slosh.y + s.sloshVel.y * dt, -1, 1)
      }

      // Velocity stretch (≤4%), springing back to round.
      const speed = Math.hypot(s.vel.x, s.vel.y)
      const targetStretch = rm ? 0 : Math.min(0.04, (speed / Math.max(s.baseRadius, 1)) * 0.0045)
      s.stretch += (targetStretch - s.stretch) * Math.min(1, dt * 14)
      if (speed > 1) s.stretchDir = { x: s.vel.x / speed, y: -s.vel.y / speed }

      this.animateFace(s, speed, dt)
      // Hover: looks at you, swells a touch, eyes widen.
      const p = this.pointer
      const over =
        p && performance.now() - p.at < 4000 && Math.hypot(p.x - s.pos.x, p.y - s.pos.y) < s.radius * 1.05
          ? 1
          : 0
      s.hover += (over - s.hover) * Math.min(1, dt * 10)
      if (this.time > s.exprUntil) s.exprTarget = s.mood === 'error' ? 2 : 0
      s.expr += (s.exprTarget - s.expr) * Math.min(1, dt * 9)
      // Jelly: squash when stopping, stretch when starting, spring back.
      if (!rm && speed > 1) {
        const along = ((s.vel.x - s.prevVel.x) * s.vel.x + (s.vel.y - s.prevVel.y) * s.vel.y) / (speed * dt)
        s.jellyVel += along * 0.00012 * Math.max(0.5, 60 / Math.max(10, s.baseRadius))
      }
      s.jellyVel += (-90 * s.jelly - 7 * s.jellyVel) * dt
      s.jelly = clamp(s.jelly + s.jellyVel * dt, -0.07, 0.07)
      // Orbiting droplets fade in while thinking or working.
      const busy = s.mood === 'thinking' || s.mood === 'working' ? 1 : 0
      s.orbit += (busy - s.orbit) * Math.min(1, dt * 3)
      for (const d of s.spray) {
        if (d.vx == null || d.vy == null) continue
        d.x += d.vx * dt
        d.y += d.vy * dt
        d.vx *= Math.exp(-dt * 2.6)
        d.vy = d.vy * Math.exp(-dt * 2.6) + s.baseRadius * 4 * dt
      }
      s.energy += (s.targetEnergy - s.energy) * Math.min(1, dt * 2.5)
      s.dim += (s.targetDim - s.dim) * Math.min(1, dt * 3)
      s.pulse *= Math.exp(-dt * 3.2)
      const breathe = rm ? 0 : Math.sin(this.time * 1.4 + s.seed) * 0.007 * (1 - s.orbit * 0.5)
      if (!s.droplet && !s.birth)
        s.radius +=
          (s.baseRadius * (1 + s.pulse * 0.04 + s.hover * 0.045 + breathe) - s.radius) * Math.min(1, dt * 18)
      s.ripples = s.ripples.filter((r) => this.time - r.t0 < 2.2)

      // Movement trail and trail-generated flick droplets removed. Impact/joy spray is retained.
      s.spray = s.spray.filter((d) => this.time - d.t0 < this.dryTime)

      const key = `${s.color ?? s.hueShift.toFixed(2)}:${s.dim.toFixed(2)}`
      if (key !== s.paletteKey) {
        s.palette = spherePalette(s.color ?? s.hueShift, s.dim)
        s.paletteKey = key
      }
    }
  }

  private advanceBirth(s: Sphere, dt: number) {
    const b = s.birth!
    const parent = this.spheres.get(b.parentId)
    const u = (this.time - b.t0) / b.duration
    if (!b.released) {
      const e = smooth(0, 0.5, u)
      const pr = parent?.radius ?? b.finalR
      const from = parent?.pos ?? s.pos
      const x = from.x + b.dir.x * pr * (0.2 + 1.05 * e)
      const y = from.y + b.dir.y * pr * (0.2 + 1.05 * e)
      s.vel = { x: (x - s.pos.x) / dt, y: (y - s.pos.y) / dt }
      s.pos = { x, y }
      s.target = { x, y }
      s.radius = s.baseRadius = b.finalR * (0.25 + 0.5 * e)
      if (u >= 0.55) {
        b.released = true
        s.target = { ...b.target }
        s.baseRadius = b.finalR
        s.stiffness = 20
        s.damping = 7
        this.ripple(s.id, { x: -b.dir.x * 0.8, y: b.dir.y * 0.8, strength: 1.1 })
        if (parent) {
          this.ripple(parent.id, { x: b.dir.x * 0.8, y: -b.dir.y * 0.8, strength: 0.8 })
          // The neck snaps: droplets fly out sideways from the pinch point.
          const pinch = {
            x: parent.pos.x + b.dir.x * parent.radius * 1.05,
            y: parent.pos.y + b.dir.y * parent.radius * 1.05,
          }
          this.splash(s, pinch, { x: -b.dir.y, y: b.dir.x }, 3, 0.8)
          this.splash(s, pinch, { x: b.dir.y, y: -b.dir.x }, 3, 0.8)
          this.beam(parent, 1.4)
        }
        // Boing: the newborn pops to size with a jelly wobble, opens its eyes and smiles.
        s.jellyVel += 1.6
        s.blinkAt = this.time + 0.12
        this.beam(s, 1.6)
      }
    } else if (u >= 1.6) {
      s.birth = undefined
      s.stiffness = 36
      s.damping = 11
    }
  }

  /** A directional splash at a point (impacts, snaps). */
  private splash(owner: Sphere, at: Vec, dir: Vec, count: number, power = 1) {
    if (this.reducedMotion) return
    const base = Math.atan2(dir.y, dir.x)
    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * 1.9
      const sp = owner.baseRadius * (1.4 + Math.random() * 1.6) * power
      owner.spray.push({
        x: at.x,
        y: at.y,
        r: owner.baseRadius * (0.05 + Math.random() * 0.06),
        t0: this.time,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - owner.baseRadius * 0.6,
      })
    }
  }

  /** A happy look for a moment (eyes ^ ^). */
  private beam(s: Sphere, seconds = 1) {
    s.exprTarget = 1
    s.exprUntil = this.time + seconds
  }

  /** A happy little splash of droplets. */
  private burst(s: Sphere) {
    if (this.reducedMotion) return
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4
      const sp = s.baseRadius * (1.6 + Math.random() * 1.4)
      s.spray.push({
        x: s.pos.x + Math.cos(a) * s.radius * 0.95,
        y: s.pos.y + Math.sin(a) * s.radius * 0.95,
        r: s.baseRadius * (0.045 + Math.random() * 0.05),
        t0: this.time,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - s.baseRadius * 0.8,
      })
    }
    this.ripple(s.id, { strength: 1.2 })
  }

  /** Visual-only offsets: error shake, waiting hop. */
  private renderOffset(s: Sphere): Vec {
    if (this.reducedMotion) return { x: 0, y: 0 }
    let x = 0
    let y = 0
    if (this.time < s.shakeUntil) {
      const k = (s.shakeUntil - this.time) / 0.5
      x += Math.sin(this.time * 55) * s.radius * 0.06 * k
    }
    if (s.mood === 'waiting' && s.hopAt) {
      const t = this.time - s.hopAt
      if (t >= 0 && t < 0.36) y -= Math.sin((t / 0.36) * Math.PI) * s.radius * 0.16
      if (t >= 2.6) s.hopAt = this.time
      if (t >= 0.36 && t < 0.4) s.jellyVel -= 0.9
    }
    return { x, y }
  }

  /** Eyes: look where it's going (or at whoever it's talking to), wander a little, blink. */
  private animateFace(s: Sphere, speed: number, dt: number) {
    s.sleep += (s.targetSleep - s.sleep) * Math.min(1, dt * 6)
    if (s.eyes === false || this.reducedMotion) {
      s.look = { x: 0, y: 0 }
      return
    }
    if (this.time > s.lookHold) {
      const p = this.pointer
      const fresh = p && performance.now() - p.at < 2600
      if (speed > s.baseRadius * 0.6) {
        s.lookTarget = { x: s.vel.x / speed, y: (-s.vel.y / speed) * 0.7 }
      } else if (fresh && p) {
        // Watch the cursor: direction to it, more extreme the further away it is.
        const dx = p.x - s.pos.x
        const dy = p.y - s.pos.y
        const d = Math.hypot(dx, dy)
        if (d < s.radius * 0.9) s.lookTarget = { x: (dx / s.radius) * 0.35, y: (-dy / s.radius) * 0.3 }
        else {
          const mag = Math.min(1, Math.max(0.25, d / (s.radius * 5)))
          s.lookTarget = { x: (dx / d) * mag, y: (-dy / d) * mag * 0.85 }
        }
      } else if (s.mood === 'thinking') {
        s.lookTarget = { x: -0.45 + Math.sin(this.time * 0.7 + s.seed) * 0.15, y: 0.75 }
      } else if (s.mood === 'working') {
        s.lookTarget = { x: Math.sin(this.time * 1.6 + s.seed) * 0.8, y: -0.25 }
      } else if (s.mood === 'waiting') {
        s.lookTarget = { x: 0, y: -0.15 }
      } else {
        // Idle: glance around every few seconds.
        const k = Math.floor((this.time + s.seed) / 2.6)
        const r1 = ((hashString(`${s.id}:${k}`) % 1000) / 1000) * 2 - 1
        const r2 = ((hashString(`${s.id}:${k}:y`) % 1000) / 1000) * 2 - 1
        s.lookTarget = { x: r1 * 0.55, y: r2 * 0.35 }
      }
    }
    const rate = Math.min(1, dt * 11)
    s.look.x += (s.lookTarget.x - s.look.x) * rate
    s.look.y += (s.lookTarget.y - s.look.y) * rate
    if (this.time >= s.blinkAt && s.sleep < 0.5) {
      s.blinkStart = this.time
      const r = (hashString(`${s.id}:${Math.floor(this.time * 10)}`) % 1000) / 1000
      // Occasionally a quick double blink.
      s.blinkAt = this.time + (r < 0.15 ? 0.28 : 2.4 + r * 3.6)
    }
  }

  private blinkAmount(s: Sphere): number {
    const t = (this.time - s.blinkStart) / BLINK_S
    if (t < 0 || t > 1) return 0
    return Math.sin(t * Math.PI)
  }

  private advanceDroplet(s: Sphere, dt: number) {
    const d = s.droplet!
    const to = this.spheres.get(d.to)
    if (to) {
      // Follow the target if it moved.
      const dx = to.pos.x - d.p0.x
      const dy = to.pos.y - d.p0.y
      const dist = Math.hypot(dx, dy) || 1
      d.p1 = { x: to.pos.x - (dx / dist) * to.radius * 0.35, y: to.pos.y - (dy / dist) * to.radius * 0.35 }
    }
    const u = clamp((this.time - d.t0) / d.duration, 0, 1)
    const e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2
    const x = (1 - e) ** 2 * d.p0.x + 2 * (1 - e) * e * d.ctrl.x + e ** 2 * d.p1.x
    const y = (1 - e) ** 2 * d.p0.y + 2 * (1 - e) * e * d.ctrl.y + e ** 2 * d.p1.y
    s.vel = { x: (x - s.pos.x) / dt, y: (y - s.pos.y) / dt }
    s.pos = { x, y }
    if (d.phase === 'done') return
    d.phase = u < 0.14 ? 'bud' : u > 0.86 ? 'merge' : 'travel'
    // The tether snaps once stretched far enough; the parent flinches, beads fly.
    const fromS = this.spheres.get(d.from)
    if (fromS && !d.tether.snapped) {
      const ax =
        fromS.pos.x +
        ((s.pos.x - fromS.pos.x) / (Math.hypot(s.pos.x - fromS.pos.x, s.pos.y - fromS.pos.y) || 1)) *
          fromS.radius *
          0.9
      const ay =
        fromS.pos.y +
        ((s.pos.y - fromS.pos.y) / (Math.hypot(s.pos.x - fromS.pos.x, s.pos.y - fromS.pos.y) || 1)) *
          fromS.radius *
          0.9
      d.tether.anchor = { x: ax, y: ay }
      const len = Math.hypot(s.pos.x - ax, s.pos.y - ay)
      if (len > fromS.radius * 1.15 + s.baseRadius * 2.2 || u > 0.55) {
        d.tether.snapped = true
        d.tether.snapT = this.time
        d.tether.snapAt = { x: (ax + s.pos.x) / 2, y: (ay + s.pos.y) / 2 }
        this.ripple(d.from, {
          x: (ax - fromS.pos.x) / fromS.radius,
          y: -(ay - fromS.pos.y) / fromS.radius,
          strength: 0.5,
        })
        for (let k = 0; k < 3; k++) {
          const t = 0.3 + k * 0.2
          s.spray.push({
            x: ax + (s.pos.x - ax) * t + (Math.random() - 0.5) * s.baseRadius * 0.6,
            y: ay + (s.pos.y - ay) * t + (Math.random() - 0.5) * s.baseRadius * 0.6,
            r: s.baseRadius * (0.12 + Math.random() * 0.1),
            t0: this.time,
          })
        }
      }
    }
    // Grow out of the parent, shrink into the target.
    const grow = smooth(0, 0.14, u)
    const shrink = 1 - smooth(0.9, 1, u)
    s.radius = s.baseRadius * (0.55 + 0.45 * grow) * shrink
    if (u >= 1) {
      ;(d as Droplet).phase = 'done'
      if (to) {
        const ang = Math.atan2(-(d.p1.y - to.pos.y), d.p1.x - to.pos.x)
        this.ripple(d.to, { x: Math.cos(ang) * 0.75, y: Math.sin(ang) * 0.75, strength: 1.4 })
        to.pulse = Math.max(to.pulse, 0.9)
        // Impact: squash away from the hit, a splash flung back out, a blink and a smile.
        const inDir = { x: to.pos.x - d.p1.x, y: to.pos.y - d.p1.y }
        const il = Math.hypot(inDir.x, inDir.y) || 1
        to.budding = { dir: { x: inDir.x / il, y: inDir.y / il }, t0: this.time, duration: 0.3 }
        const contact = { x: to.pos.x - (inDir.x / il) * to.radius, y: to.pos.y - (inDir.y / il) * to.radius }
        this.splash(to, contact, { x: -inDir.x / il, y: -inDir.y / il }, 6, 0.9)
        to.blinkAt = this.time + 0.05
        this.beam(to, 0.9)
      }
      // Keep the trail drying after the droplet is gone.
      this.remove(s.id)
      if (s.spray.length) {
        const ghost = `${s.id}_trail`
        this.add({
          id: ghost,
          x: s.pos.x,
          y: s.pos.y,
          radius: s.baseRadius,
          color: s.color,
          hueShift: s.hueShift,
          bob: false,
          eyes: false,
        })
        const g = this.spheres.get(ghost)!
        g.spray = s.spray
        g.ghost = true
        // Draw the drying trail beneath everything else.
        this.order = [ghost, ...this.order.filter((o) => o !== ghost)]
      }
      d.resolve()
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  render() {
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const list = this.order.map((id) => this.spheres.get(id)!).filter(Boolean)
    for (const s of list) if (s.droplet && s.droplet.phase !== 'done') this.drawTether(s)
    for (const s of list) for (const d of s.spray) this.drawSpray(s, d)
    for (const s of list) {
      if (s.birth) {
        const u = (this.time - s.birth.t0) / s.birth.duration
        if (u < 0.68) this.drawBridge(s, this.spheres.get(s.birth.parentId), 1 - smooth(0.42, 0.68, u))
      }
    }
    for (const s of list) {
      const d = s.droplet
      if (!d || d.phase === 'done') continue
      if (d.phase === 'bud')
        this.drawBridge(s, this.spheres.get(d.from), 1 - smooth(0, 0.14, (this.time - d.t0) / d.duration))
      if (d.phase === 'merge')
        this.drawBridge(s, this.spheres.get(d.to), smooth(0.86, 1, (this.time - d.t0) / d.duration))
    }
    // Merging droplets slip under their target; the rest draw on top.
    // Buds still inside their parent draw underneath it.
    const budding = list.filter(
      (s) => s.birth && !s.birth.released && (this.time - s.birth.t0) / s.birth.duration < 0.3,
    )
    const merging = [...budding, ...list.filter((s) => s.droplet?.phase === 'merge')]
    const solid = list.filter((s) => !s.droplet && !s.ghost && !budding.includes(s))
    const flying = list.filter((s) => s.droplet && s.droplet.phase !== 'merge' && s.droplet.phase !== 'done')
    for (const s of [...merging, ...solid, ...flying]) {
      if (s.radius <= 0.5) continue
      if (s.orbit > 0.02) this.drawOrbit(s, 'back')
      this.drawSphere(s)
      if (s.orbit > 0.02) this.drawOrbit(s, 'front')
    }
    this.onFrame?.()
  }

  private drawSphere(s: Sphere) {
    const gl = this.gl
    const p = this.progs.sphere
    gl.useProgram(p.program)
    const u = (n: string) => uniform(gl, p, n)
    const margin = 1.0 + 0.55 * s.glow
    const off = this.renderOffset(s)
    gl.uniform2f(u('uCenter'), (s.pos.x + off.x) * this.dpr, (s.pos.y + off.y) * this.dpr)
    gl.uniform1f(u('uRadius'), s.radius * this.dpr)
    gl.uniform1f(u('uMargin'), margin)
    gl.uniform2f(u('uResolution'), this.canvas.width, this.canvas.height)
    gl.uniform1f(u('uTime'), this.reducedMotion ? this.time * 0.15 : this.time)
    gl.uniform1f(u('uSeed'), s.seed)
    gl.uniform3fv(u('uBody'), s.palette.body)
    gl.uniform3fv(u('uRim'), s.palette.rim)
    gl.uniform3fv(u('uEye'), s.palette.eye)
    gl.uniform1f(u('uEyes'), (s.eyes ?? s.radius >= 7) && !s.droplet ? 1 : 0)
    gl.uniform2f(u('uLook'), s.look.x, s.look.y)
    gl.uniform1f(u('uBlink'), this.blinkAmount(s))
    gl.uniform1f(u('uSleep'), s.sleep)
    // Small spheres keep a bigger core so the liquid still reads.
    gl.uniform1f(u('uShape'), s.droplet ? 0 : SHAPE_CODE[s.shape])
    gl.uniform1f(u('uExpr'), s.expr)
    gl.uniform1f(u('uWide'), s.hover)
    gl.uniform1f(u('uEyeStyle'), EYE_CODE[s.eyeStyle] ?? 0)
    gl.uniform1f(u('uCore'), 1)
    // Budding a child: the film stretches toward it, then springs back.
    let stretch = clamp(s.stretch + s.jelly, -0.08, 0.08)
    let sdir = s.stretchDir
    if (s.budding) {
      const bu = (this.time - s.budding.t0) / s.budding.duration
      if (bu >= 1.4) s.budding = undefined
      else {
        stretch = Math.max(stretch, 0.13 * Math.sin(Math.PI * Math.min(1, bu)) * (bu < 1 ? 1 : 0))
        sdir = { x: s.budding.dir.x, y: -s.budding.dir.y }
      }
    }
    gl.uniform2f(u('uStretchDir'), sdir.x, sdir.y)
    gl.uniform1f(u('uStretch'), stretch)
    gl.uniform2f(u('uSlosh'), s.slosh.x, s.slosh.y)
    gl.uniform1f(u('uEnergy'), s.energy)
    gl.uniform1f(u('uGlowAmt'), 0.42 * s.glow * (1 - s.dim * 0.7))
    gl.uniform1f(u('uPx'), 1 / Math.max(1, s.radius * this.dpr))
    gl.uniform1f(u('uPulse'), s.pulse)
    const rip = new Float32Array(16)
    s.ripples.slice(-4).forEach((r, i) => {
      rip.set([r.x, r.y, this.time - r.t0, r.strength], i * 4)
    })
    gl.uniform4fv(u('uRipples'), rip)
    const a = attrib(gl, p, 'aPos')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(a)
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private drawBridge(drop: Sphere, other: Sphere | undefined, strength: number) {
    if (!other || strength <= 0.01) return
    const gl = this.gl
    const p = this.progs.bridge
    gl.useProgram(p.program)
    const u = (n: string) => uniform(gl, p, n)
    const d = this.dpr
    const pad = drop.radius * 2
    const minX = Math.min(drop.pos.x - drop.radius, other.pos.x - other.radius) - pad
    const minY = Math.min(drop.pos.y - drop.radius, other.pos.y - other.radius) - pad
    const maxX = Math.max(drop.pos.x + drop.radius, other.pos.x + other.radius) + pad
    const maxY = Math.max(drop.pos.y + drop.radius, other.pos.y + other.radius) + pad
    gl.uniform4f(u('uBox'), minX * d, minY * d, maxX * d, maxY * d)
    gl.uniform2f(u('uResolution'), this.canvas.width, this.canvas.height)
    gl.uniform3f(u('uA'), drop.pos.x * d, drop.pos.y * d, drop.radius * d * 0.98)
    gl.uniform3f(u('uB'), other.pos.x * d, other.pos.y * d, other.radius * d * 0.995)
    gl.uniform1f(u('uK'), drop.baseRadius * d * 1.1 * strength)
    gl.uniform3fv(u('uBody'), drop.palette.body)
    gl.uniform3fv(u('uRim'), drop.palette.rim)
    const a = attrib(gl, p, 'aPos')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(a)
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** The droplet's gooey tether to its parent: stretches thin in the middle, then snaps and recoils. */
  private drawTether(s: Sphere) {
    const d = s.droplet!
    const from = this.spheres.get(d.from)
    if (!from) return
    const tt = d.tether
    const R = Math.max(s.baseRadius, 3)
    let a: Vec = tt.anchor
    let b: Vec = s.pos
    let k = 1
    if (tt.snapped) {
      // Recoil: both halves shrink back into their owners over ~0.3s.
      const r = smooth(0, 0.32, this.time - tt.snapT)
      if (r >= 1) return
      k = 1 - r
      this.drawStrand(
        { x: tt.anchor.x, y: tt.anchor.y },
        {
          x: tt.anchor.x + (tt.snapAt.x - tt.anchor.x) * k,
          y: tt.anchor.y + (tt.snapAt.y - tt.anchor.y) * k,
        },
        R * 0.5 * k,
        s.palette,
        true,
      )
      a = { x: s.pos.x + (tt.snapAt.x - s.pos.x) * k, y: s.pos.y + (tt.snapAt.y - s.pos.y) * k }
      b = s.pos
      this.drawStrand(a, b, R * 0.6 * k, s.palette, true)
      return
    }
    this.drawStrand(a, b, R * 0.85, s.palette, false)
  }

  private drawStrand(a: Vec, b: Vec, width: number, palette: SpherePalette, recoil: boolean) {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1 || width < 0.4) return
    const R = Math.max(width, 2)
    const stretch = clamp(len / (R * 6), 0, 1)
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    const sag = len * 0.06 * (recoil ? 0.3 : 1)
    const N = 22
    const pts: RibbonPoint[] = []
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const bow = Math.sin(Math.PI * t) * sag
      // Honey string: thick at the ends, necking in the middle as it stretches.
      const neck = 1 - Math.sin(Math.PI * t) * (0.25 + 0.6 * stretch)
      pts.push({
        x: a.x + (b.x - a.x) * t + nx * bow,
        y: a.y + (b.y - a.y) * t + ny * bow + bow * 0.4,
        w: width * neck * 0.5,
        age: 0,
        along: 0,
        dist: (len * t) / R,
      })
    }
    this.drawRibbon(pts, palette)
  }

  /** Three droplets on a tilted ring: behind the agent on one side, in front on the other. */
  private drawOrbit(s: Sphere, layer: 'back' | 'front') {
    const off = this.renderOffset(s)
    for (let i = 0; i < 3; i++) {
      const a = this.time * 2.1 + s.seed + (i * Math.PI * 2) / 3
      const z = Math.sin(a)
      if ((layer === 'back') !== z < 0) continue
      const tilt = -0.26
      const ex = Math.cos(a) * s.radius * 1.5
      const ey = Math.sin(a) * s.radius * 0.4
      const x = s.pos.x + off.x + ex * Math.cos(tilt) - ey * Math.sin(tilt)
      const y = s.pos.y + off.y + ex * Math.sin(tilt) + ey * Math.cos(tilt)
      const r = s.radius * 0.13 * (0.78 + 0.3 * z) * s.orbit
      if (r < 0.6) continue
      this.drawSphere({
        ...s,
        pos: { x, y },
        radius: r,
        ripples: [],
        slosh: { x: 0, y: 0 },
        stretch: 0,
        jelly: 0,
        pulse: 0,
        energy: 0,
        glow: 0.3,
        eyes: false,
        droplet: undefined,
        budding: undefined,
        mood: 'idle',
        shakeUntil: 0,
      } as Sphere)
    }
  }

  private drawSpray(owner: Sphere, d: Spray) {
    const age = this.time - d.t0
    const life = 1 - smooth(this.dryTime * 0.5, this.dryTime, age)
    const r = d.r * life
    if (r < 0.6) return
    const fake = {
      ...owner,
      pos: { x: d.x, y: d.y },
      radius: r,
      ripples: [],
      slosh: { x: 0, y: 0 },
      stretch: 0,
      jelly: 0,
      pulse: 0,
      energy: 0,
      glow: 0,
      eyes: false,
      droplet: undefined,
      budding: undefined,
      mood: 'idle',
      shakeUntil: 0,
    } as Sphere
    this.drawSphere(fake)
  }

  private drawRibbon(points: RibbonPoint[], palette: SpherePalette, strength = 1) {
    const n = points.length
    if (n < 2) return
    const gl = this.gl
    const p = this.progs.trail
    const d = this.dpr
    const data = new Float32Array(n * 2 * 7)
    const light = { x: -0.6, y: -0.8 }
    for (let i = 0; i < n; i++) {
      const pt = points[i]!
      const prev = points[Math.max(0, i - 1)]!
      const next = points[Math.min(n - 1, i + 1)]!
      let tx = next.x - prev.x
      let ty = next.y - prev.y
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl
      ty /= tl
      const nx = -ty
      const ny = tx
      const hl = nx * light.x + ny * light.y
      for (const side of [-1, 1]) {
        const o = (i * 2 + (side > 0 ? 1 : 0)) * 7
        data[o] = (pt.x + nx * pt.w * side) * d
        data[o + 1] = (pt.y + ny * pt.w * side) * d
        data[o + 2] = side
        data[o + 3] = pt.along
        data[o + 4] = pt.age
        data[o + 5] = pt.dist
        data[o + 6] = hl
      }
    }
    gl.useProgram(p.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW)
    const stride = 7 * 4
    const bind = (name: string, size: number, offset: number) => {
      const loc = attrib(gl, p, name)
      if (loc < 0) return
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4)
    }
    bind('aPos', 2, 0)
    bind('aU', 1, 2)
    bind('aAlong', 1, 3)
    bind('aAge', 1, 4)
    bind('aDist', 1, 5)
    bind('aHl', 1, 6)
    const u = (nm: string) => uniform(gl, p, nm)
    gl.uniform2f(u('uResolution'), this.canvas.width, this.canvas.height)
    gl.uniform3fv(u('uBody'), palette.body)
    gl.uniform3fv(u('uRim'), palette.rim)
    gl.uniform1f(u('uDry'), this.dryTime)
    gl.uniform1f(u('uTime'), this.time)
    gl.uniform1f(u('uStrength'), strength)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, n * 2)
    for (const name of ['aU', 'aAlong', 'aAge', 'aDist', 'aHl']) {
      const loc = attrib(gl, p, name)
      if (loc >= 0) gl.disableVertexAttribArray(loc)
    }
  }
}

type RibbonPoint = { x: number; y: number; w: number; age: number; along: number; dist: number }

function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x))
}

function smooth(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function hashString(s: string | number): number {
  const str = String(s)
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
