/**
 * Liquid sphere shaders (WebGL2 / GLSL ES 3.00).
 *
 * The outline is a mathematically perfect circle (only a ≤4% velocity stretch).
 * Everything "liquid" happens inside and on the surface:
 *  - refracted view rays sample a swirling, domain-warped noise volume (the juice)
 *  - thin-edge translucency + backlit rim (the gummy glow)
 *  - studio environment reflection with a softbox window + hotspot (the gloss)
 *  - a caustic crescent opposite the light (light focused through the liquid)
 *  - normal-only ripples and slosh, so the surface moves while the silhouette doesn't
 */

const COMMON = /* glsl */ `
precision highp float;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Hue-preserving tone curve: scales all channels by one factor so saturated
// greens stay saturated instead of washing out to pastel.
vec3 tmHue(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  if (m <= 1e-4) return c;
  float t = 1.0 - exp(-m * 1.35);
  return c * (t / m);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Studio environment seen in reflection direction R (dark room, coloured floor bounce).
vec3 studioEnv(vec3 R, vec3 tint) {
  float up = R.y * 0.5 + 0.5;
  vec3 col = mix(vec3(0.002), vec3(0.05), smoothstep(0.3, 1.0, up));
  col += tint * 0.45 * smoothstep(0.0, -0.9, R.y);
  return col;
}

// Light sources reflected on the glossy coat, as 0..1 coverage (laid on as white).
float softbox(vec3 R) {
  vec2 s = R.xy / (1.0 + max(R.z, -0.9));
  vec2 c = s - vec2(-0.66, 0.6);
  // Rotated so the window lies along the rim, like a reflection curving round the side.
  c = mat2(0.7071, 0.7071, -0.7071, 0.7071) * c;
  float box = sdRoundBox(c, vec2(0.075, 0.2), 0.07);
  // Brighter toward the top of the window, like a real softbox.
  float grad = 0.72 + 0.28 * smoothstep(-0.15, 0.15, c.y);
  float core = (1.0 - smoothstep(-0.035, 0.015, box)) * grad;
  float halo = (1.0 - smoothstep(0.0, 0.2, box)) * 0.12;
  return core * 0.95 + halo;
}

// A broad, faint sky sheen across the upper half of the coat.
float sheen(vec3 R) {
  return smoothstep(0.25, 0.95, R.y) * smoothstep(-0.2, 0.6, -R.x * 0.4 + R.z * 0.6) * 0.09;
}

float stripLight(vec3 R) {
  vec2 s = R.xy / (1.0 + max(R.z, -0.9));
  float strip = sdRoundBox(s - vec2(0.64, -0.06), vec2(0.022, 0.26), 0.022);
  return (1.0 - smoothstep(-0.015, 0.05, strip)) * 0.2;
}
`

export const SPHERE_VERT = /* glsl */ `#version 300 es
in vec2 aPos;               // unit quad corner (-1..1)
uniform vec2 uCenter;       // px
uniform float uRadius;      // px
uniform float uMargin;      // quad extent in radii
uniform vec2 uResolution;   // px
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x, -aPos.y) * uMargin;      // local coords, y up
  vec2 px = uCenter + aPos * uMargin * uRadius;
  vec2 clip = (px / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`

export const SPHERE_FRAG = /* glsl */ `#version 300 es
${COMMON}
in vec2 vUv;
out vec4 outColor;

uniform float uTime;
uniform float uSeed;
uniform vec3 uBody;         // liquid colour (linear)
uniform vec3 uRim;          // lighter tint
uniform vec3 uEye;          // eye ink (linear)
uniform vec2 uStretchDir;
uniform float uStretch;
uniform vec2 uSlosh;        // lagging liquid offset (y up)
uniform float uEnergy;
uniform float uGlowAmt;
uniform float uPx;
uniform float uPulse;
uniform vec4 uRipples[4];   // xy origin (unit disc), z age (s), w strength
uniform float uEyes;        // 1 = draw the face
uniform vec2 uLook;         // where the eyes look (-1..1, y up)
uniform float uBlink;       // 0 open .. 1 closed
uniform float uSleep;       // 1 = eyes closed (stopped / dormant)
uniform float uCore;        // liquid core radius (fraction of the shell)
uniform float uShape;       // 0 circle · 1 squircle · 2 pill · 3 hexagon
uniform float uExpr;        // 0 normal · 1 happy (^ ^) · 2 worried
uniform float uWide;        // 0..1 eyes widen (hovered)
uniform float uEyeStyle;    // 0 pill · 1 dot · 2 square

// Shell shapes in unit space (≈1 = edge). Distances are approximate but smooth.
float sdShape(vec2 p) {
  if (uShape < 0.5) return length(p) - 1.0;
  if (uShape < 1.5) {
    vec2 a = abs(p);
    return pow(pow(a.x, 4.0) + pow(a.y, 4.0), 0.25) - 1.0;
  }
  if (uShape < 2.5) {
    vec2 q = p;
    q.x -= clamp(q.x, -0.32, 0.32);
    return length(q) - 0.84;
  }
  // Rounded hexagon (pointy top).
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  vec2 q = abs(p.yx);
  q -= 2.0 * min(dot(k.xy, q), 0.0) * k.xy;
  q -= vec2(clamp(q.x, -k.z * 0.82, k.z * 0.82), 0.82);
  return length(q) * sign(q.y) - 0.16;
}

vec2 shapeGrad(vec2 p) {
  vec2 e = vec2(0.002, 0.0);
  return vec2(sdShape(p + e.xy) - sdShape(p - e.xy), sdShape(p + e.yx) - sdShape(p - e.yx)) / (2.0 * e.x);
}

float sdCapsuleV(vec2 p, float h, float r) {
  p.y -= clamp(p.y, -h, h);
  return length(p) - r;
}

void main() {
  // Velocity stretch (≤4%), springing back to round.
  vec2 p = vUv;
  float s = 1.0 + uStretch;
  float al = dot(p, uStretchDir);
  vec2 pe = p - al * uStretchDir;
  vec2 q = (al / s) * uStretchDir + pe * sqrt(s);
  float aa = uPx * 1.25;

  // ── The liquid: the whole drop. It sloshes a touch and rings gently after a ripple. ──
  float sl = length(uSlosh);
  vec2 sdir = sl > 1e-3 ? uSlosh / sl : vec2(1.0, 0.0);
  vec2 off = -uSlosh * 0.025;
  vec2 cq = q - off;
  float ca = dot(cq, sdir);
  vec2 cp = cq - ca * sdir;
  cq = ca * sdir / (1.0 + sl * 0.05) + cp * (1.0 + sl * 0.025);
  float ang = atan(cq.y, cq.x);
  float wob = 0.003 * sin(2.0 * ang + uTime * 0.9 + uSeed) + 0.004 * uEnergy * sin(3.0 * ang + uTime * 2.4 + uSeed);
  for (int i = 0; i < 4; i++) {
    vec4 rp = uRipples[i];
    if (rp.w <= 0.0) continue;
    float env = rp.w * exp(-rp.z * 2.6) * smoothstep(0.0, 0.06, rp.z);
    float phase = dot(rp.xy, vec2(3.0, 5.0));
    wob += env * (0.018 * sin(4.0 * ang + phase) * cos(rp.z * 17.0) + 0.012 * sin(3.0 * ang - phase) * cos(rp.z * 11.0 + 1.0));
  }
  float R0 = 1.0 + wob;
  float dc = sdShape(cq / R0) * R0;
  float body = 1.0 - smoothstep(-aa, aa * 0.25, dc);

  // Soft outer glow from the liquid.
  float g = exp(-max(dc, 0.0) * 7.5) * (1.0 - body);
  float glowA = g * uGlowAmt * (0.5 + 0.5 * uEnergy + uPulse);
  vec4 outside = vec4(uBody * glowA, glowA * 0.8);
  if (body <= 0.0) { outColor = outside; return; }

  // Dome normal over the outline; the surface lags motion and carries ripples.
  float cr = clamp(1.0 + dc / R0, 0.0, 0.9999);
  float cz = sqrt(1.0 - cr * cr);
  float cl = length(cq);
  vec2 cg = uShape < 0.5 ? cq / max(cl, 1e-4) : normalize(shapeGrad(cq / R0) + 1e-6);
  vec3 cn = vec3(cg * cr, cz);
  cn.xy += uSlosh * 0.2 * (1.0 - cz);
  float rippleLight = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 rp = uRipples[i];
    if (rp.w <= 0.0) continue;
    vec2 dv = cq - rp.xy;
    float dist = length(dv);
    float x = dist - rp.z * 1.3;
    float env = exp(-x * x * 10.0) * rp.w * exp(-rp.z * 1.4) * smoothstep(0.0, 0.12, rp.z);
    cn.xy += (dv / max(dist, 1e-3)) * sin(x * 16.0) * env * 0.15;
    rippleLight += max(sin(x * 16.0 + 1.3), 0.0) * env;
  }
  vec3 wq = vec3(cq * 2.0, uTime * 0.35 + uSeed);
  cn.xy += (vec2(vnoise(wq), vnoise(wq + 17.0)) - 0.5) * 0.045;
  cn = normalize(cn);

  // Minimal, solid-colour shading: soft key from the top left, deeper toward the bottom.
  vec3 Lk = normalize(vec3(-0.5, 0.7, 0.55));
  float wrap = clamp(dot(cn, Lk) * 0.55 + 0.45, 0.0, 1.0);
  vec3 liquid = uBody * (0.58 + 0.5 * wrap);
  // Subsurface glow where the drop is thin.
  liquid = mix(liquid, uRim, pow(cr, 3.0) * 0.3);
  // Light focused through the drop pools at the bottom right.
  vec2 cdir = normalize(vec2(0.5, -0.86));
  float caus = smoothstep(0.3, 1.0, dot(cg, cdir)) * smoothstep(0.45, 0.88, cr) * (1.0 - smoothstep(0.9, 0.99, cr));
  liquid = mix(liquid, uRim * 1.15, caus * 0.55);
  liquid += uRim * rippleLight * 0.12;
  liquid *= 1.0 + uPulse * 0.2;
  vec3 col = pow(clamp(liquid, 0.0, 1.0), vec3(1.0 / 2.2));

  // ── Eyes: black capsules on the liquid ──
  float eyeMask = 0.0;
  if (uEyes > 0.5) {
    vec2 c = off + vec2(0.0, 0.05) + uLook * vec2(0.18, 0.13);
    float h = mix(0.15 + 0.03 * uWide, 0.014, max(uBlink, uSleep));
    float er = 0.085 + 0.01 * uWide;
    float squeeze = 1.0 + abs(uLook.x) * 0.35;
    vec2 eL = (q - c - vec2(-0.245, 0.0)) * vec2(squeeze, 1.0);
    vec2 eR = (q - c - vec2(0.245, 0.0)) * vec2(squeeze, 1.0);
    float dN;
    if (uEyeStyle < 0.5) dN = min(sdCapsuleV(eL, h, er), sdCapsuleV(eR, h, er));
    else if (uEyeStyle < 1.5) {
      float hr = mix(0.0, -0.075, max(uBlink, uSleep));   // dots squash flat when blinking
      dN = min(sdCapsuleV(eL * vec2(1.0, 1.0 / max(0.12, 1.0 + hr / 0.085)), 0.0, er * 1.25 + 0.01 * uWide),
               sdCapsuleV(eR * vec2(1.0, 1.0 / max(0.12, 1.0 + hr / 0.085)), 0.0, er * 1.25 + 0.01 * uWide));
    } else {
      vec2 bx = vec2(0.075 + 0.008 * uWide, max(0.012, h * 0.85));
      dN = min(sdRoundBox(eL, bx, 0.04), sdRoundBox(eR, bx, 0.04));
    }
    // Happy: upside-down U arcs.
    float ar = 0.11;
    float aL = abs(length(eL + vec2(0.0, 0.06)) - ar) - 0.036;
    float aR = abs(length(eR + vec2(0.0, 0.06)) - ar) - 0.036;
    aL = max(aL, -(eL.y + 0.04));
    aR = max(aR, -(eR.y + 0.04));
    float dH = min(aL, aR);
    // Worried: shorter capsules tilted inward.
    float tl = 0.32;
    vec2 wL = mat2(cos(tl), -sin(tl), sin(tl), cos(tl)) * eL;
    vec2 wR = mat2(cos(-tl), -sin(-tl), sin(-tl), cos(-tl)) * eR;
    float dW = min(sdCapsuleV(wL, h * 0.6, er * 0.9), sdCapsuleV(wR, h * 0.6, er * 0.9));
    float d = mix(dN, dH, clamp(uExpr, 0.0, 1.0));
    d = mix(d, dW, clamp(uExpr - 1.0, 0.0, 1.0));
    float eye = 1.0 - smoothstep(-aa * 1.2, aa * 1.2, d);
    eyeMask = 1.0 - smoothstep(-aa, 0.04, d);
    col = mix(col, pow(uEye, vec3(1.0 / 2.2)), eye);
  }

  // ── Gloss on the liquid surface itself: reflection, window, hotspot, sheen ──
  vec3 V = vec3(0.0, 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - clamp(cn.z, 0.0, 1.0), 5.0);
  vec3 R = reflect(-V, cn);
  col = mix(col, pow(studioEnv(R, uBody), vec3(1.0 / 2.2)), F * 0.4);
  float hl = softbox(R) * 0.9 + stripLight(R) + sheen(R);
  hl += pow(max(dot(R, normalize(vec3(-0.72, 0.62, 0.32))), 0.0), 260.0) * 1.4;
  hl += pow(max(dot(R, normalize(vec3(0.62, -0.58, 0.52))), 0.0), 180.0) * 0.45;
  // Keep the gloss off the eyes.
  hl *= 1.0 - eyeMask * 0.92;
  col = mix(col, vec3(1.0), clamp(hl, 0.0, 1.0));

  // Refraction band and a bright wet rim hugging the edge, strongest toward the light.
  float band = smoothstep(0.82, 0.9, cr) * (1.0 - smoothstep(0.91, 0.96, cr));
  col *= 1.0 - band * 0.12 * (1.0 - caus);
  float rimLit = 0.45 + 0.55 * clamp(dot(cg, normalize(vec2(-0.6, 0.8))) * 0.5 + 0.5, 0.0, 1.0);
  // A very thin glossy border: hairline shadow just inside, then a crisp light ring at the edge.
  float bw = max(0.022, uPx * 1.6);                       // border width (≥ ~1.5px)
  float edgeD = -dc;                                      // distance inside the edge
  float shadowLine = (1.0 - smoothstep(0.0, uPx * 1.2, abs(edgeD - bw * 1.6))) * 0.35;
  col *= 1.0 - shadowLine;
  float border = 1.0 - smoothstep(bw * 0.7, bw * 1.15, edgeD);
  col = mix(col, mix(pow(uRim, vec3(1.0 / 2.2)), vec3(1.0), 0.35 + 0.35 * rimLit), border * (0.65 + 0.35 * rimLit));

  col += (hash13(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0;
  outColor = vec4(col, 1.0) * body + outside * (1.0 - body);
}
`

/** Neck between two drops (droplet budding off / merging in): the smooth-union region only. */
export const BRIDGE_VERT = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec4 uBox;          // minx, miny, maxx, maxy (px)
uniform vec2 uResolution;
out vec2 vPx;
void main() {
  vec2 t = aPos * 0.5 + 0.5;
  vPx = mix(uBox.xy, uBox.zw, t);
  vec2 clip = (vPx / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`

export const BRIDGE_FRAG = /* glsl */ `#version 300 es
${COMMON}
in vec2 vPx;
out vec4 outColor;
uniform vec3 uA;            // x, y, r (px)
uniform vec3 uB;
uniform float uK;           // smoothing (px)
uniform vec3 uBody;
uniform vec3 uRim;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  float dA = length(vPx - uA.xy) - uA.z;
  float dB = length(vPx - uB.xy) - uB.z;
  float d = smin(dA, dB, uK);
  // Only shade the neck: inside the union but outside both circles.
  float inside = 1.0 - smoothstep(-0.75, 0.75, d);
  float neck = smoothstep(-0.5, 0.75, min(dA, dB));
  float a = inside * neck;
  if (a <= 0.001) discard;
  // Pseudo-3D normal from the field gradient.
  vec2 e = vec2(1.0, 0.0);
  vec2 grad = vec2(
    smin(length(vPx + e.xy - uA.xy) - uA.z, length(vPx + e.xy - uB.xy) - uB.z, uK) - d,
    smin(length(vPx + e.yx - uA.xy) - uA.z, length(vPx + e.yx - uB.xy) - uB.z, uK) - d);
  float depth = clamp(-d / (min(uA.z, uB.z) * 0.6), 0.0, 1.0);
  vec3 n = normalize(vec3(grad * vec2(1.0, -1.0) * (1.2 - depth), depth + 0.15));
  float F = 0.03 + 0.97 * pow(1.0 - clamp(n.z, 0.0, 1.0), 5.0);
  vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
  vec3 col = mix(uBody, uRim, (1.0 - depth) * 0.3);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col = mix(col, pow(studioEnv(R, uBody), vec3(1.0 / 2.2)), F * 0.5);
  col = mix(col, vec3(1.0), clamp(softbox(R) * 0.8, 0.0, 1.0));
  outColor = vec4(col, 1.0) * a;
}
`

/** Slime trail: a ribbon with a tube normal → glossy specular stripe that dries away. */
export const TRAIL_VERT = /* glsl */ `#version 300 es
in vec2 aPos;       // px
in float aU;        // -1..1 across
in float aAlong;    // 0 head .. 1 tail
in float aAge;      // seconds since laid down
in float aDist;     // distance from head in radii
in float aHl;       // highlight offset across the tube (-1..1)
uniform vec2 uResolution;
out float vU;
out float vAlong;
out float vAge;
out float vDist;
out float vHl;
void main() {
  vU = aU; vAlong = aAlong; vAge = aAge; vDist = aDist; vHl = aHl;
  vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`

export const TRAIL_FRAG = /* glsl */ `#version 300 es
${COMMON}
in float vU;
in float vAlong;
in float vAge;
in float vDist;
in float vHl;
out vec4 outColor;
uniform vec3 uBody;
uniform vec3 uRim;
uniform float uDry;   // seconds to dry
uniform float uTime;
uniform float uStrength;   // 1 = hero strand (delegation, spawn), lower = subtle movement trail

void main() {
  float dryness = clamp(vAge / uDry, 0.0, 1.0);
  float wet = 1.0 - smoothstep(0.0, 0.7, dryness);
  // Plateau–Rayleigh: the strand necks between beads as it ages, then the beads shrink away.
  float freq = 1.6 + 0.4 * hash13(vec3(floor(vDist * 0.5), 2.0, 7.0));
  float wave = 0.5 + 0.5 * cos(vDist * freq * 6.2831);
  float neck = smoothstep(0.12, 0.6, dryness);
  float width = mix(1.0, 0.18 + 0.82 * pow(wave, 1.6), neck);
  width *= 1.0 - smoothstep(0.65, 1.0, dryness);
  if (width <= 0.02) discard;
  float u = vU / width;
  if (abs(u) >= 1.0) discard;
  float h = sqrt(1.0 - u * u);                       // tube profile

  // Liquid body: thicker centre is deeper, thin edges glow in the rim tint.
  vec3 body = mix(uRim, uBody, h);
  body *= 0.55 + 0.45 * h;
  // Light flowing along the strand.
  float flow = 0.5 + 0.5 * sin(vDist * 3.0 - uTime * 4.0);
  body += uRim * flow * 0.12 * wet * h;
  vec3 col = pow(clamp(body, 0.0, 1.0), vec3(1.0 / 2.2));
  // Glossy specular stripe on the lit side + a faint secondary on the other.
  float spec = exp(-pow((u - vHl * 0.45) * 3.6, 2.0)) * (0.25 + 0.75 * wet);
  float spec2 = exp(-pow((u + vHl * 0.55) * 6.0, 2.0)) * 0.25 * wet;
  col = mix(col, vec3(1.0), clamp(spec * 0.9 + spec2, 0.0, 1.0));
  // Bright wet edges.
  col = mix(col, pow(uRim, vec3(1.0 / 2.2)), smoothstep(0.75, 1.0, abs(u)) * 0.4 * wet);

  float edge = 1.0 - smoothstep(0.85, 1.0, abs(u));
  float a = edge * (0.82 + 0.18 * h) * (1.0 - vAlong * 0.15) * (1.0 - smoothstep(0.8, 1.0, dryness));
  a *= uStrength;
  outColor = vec4(col * a, a);
}
`
