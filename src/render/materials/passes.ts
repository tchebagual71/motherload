// Full-screen pass and backdrop shaders (GLSL3 ShaderMaterials; 04 §5.7 pass order).
import { AlwaysDepth, Color, GLSL3, NoBlending, ShaderMaterial, Vector2, Vector3, type Texture } from 'three';
import type { Look } from '../../shared/types';
import { SHADING, SURFACE } from '../palette';

const FULLSCREEN_VS = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Pixel Lab edge pass (03 §9.3): depth step > 0.25 → the nearer pixel becomes base × 0.45 + 25% ink;
 * a crease (normal dot < 0.75) brightens the light-facing side × 1.15. Copies depth to gl_FragDepth
 * so pass 3 depth-tests against the opaque scene without sampling an attached texture.
 */
export function createEdgeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-pixel-edge',
    glslVersion: GLSL3,
    uniforms: {
      tColor: { value: null as Texture | null },
      tNormal: { value: null as Texture | null },
      tDepth: { value: null as Texture | null },
      uNear: { value: 1 },
      uFar: { value: 400 },
      uOrtho: { value: 1 },
      uInk: { value: new Color(SHADING.outline) },
      uDepthStep: { value: 0.25 },
      uCrease: { value: 0.75 },
    },
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform highp sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uOrtho;
uniform vec3 uInk;
uniform float uDepthStep;
uniform float uCrease;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

float viewDepth(float d) {
  if (uOrtho > 0.5) return uNear + d * (uFar - uNear);
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

float depthAt(ivec2 q, ivec2 hi) {
  return viewDepth(texelFetch(tDepth, clamp(q, ivec2(0), hi), 0).r);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(tColor, 0) - 1;
  float raw = texelFetch(tDepth, p, 0).r;
  float d0 = viewDepth(raw);
  vec3 c = texelFetch(tColor, p, 0).rgb;
  vec3 n0 = texelFetch(tNormal, p, 0).xyz * 2.0 - 1.0;
  const vec3 lightSide = vec3(-0.45, 0.6, 0.66);
  ivec2 offs[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
  // An isolated far texel is a rasterisation crack (T-junction at a chamfered corner): fill it from
  // its nearest neighbour instead of letting it read as a hole with a "+" of outline around it.
  float nearest = 1e9;
  int nearestI = 0;
  int nearer = 0;
  for (int i = 0; i < 4; i++) {
    float dq = depthAt(p + offs[i], hi);
    if (d0 - dq > uDepthStep) nearer++;
    if (dq < nearest) { nearest = dq; nearestI = i; }
  }
  if (nearer == 4) {
    ivec2 q = clamp(p + offs[nearestI], ivec2(0), hi);
    outColor = vec4(texelFetch(tColor, q, 0).rgb, 1.0);
    gl_FragDepth = texelFetch(tDepth, q, 0).r;
    return;
  }
  float farther = 0.0;
  float crease = 0.0;
  for (int i = 0; i < 4; i++) {
    float dq = depthAt(p + offs[i], hi);
    // A real silhouette continues for a second texel; a 1-texel crack does not.
    float dq2 = depthAt(p + 2 * offs[i], hi);
    farther = max(farther, min(dq, dq2) - d0);
    if (abs(dq - d0) < uDepthStep) {
      vec3 nq = texelFetch(tNormal, clamp(p + offs[i], ivec2(0), hi), 0).xyz * 2.0 - 1.0;
      if (dot(n0, nq) < uCrease && dot(n0 - nq, lightSide) > 0.0) crease = 1.0;
    }
  }
  // 03 §9.3 "base × 0.45 + 25% ink", with × 0.45 meant in sRGB (0.45^2.2 in linear).
  if (farther > uDepthStep) c = mix(c * 0.173, uInk, 0.25);
  else if (crease > 0.5) c = min(c * 1.15, vec3(1.0));
  outColor = vec4(c, 1.0);
  gl_FragDepth = raw;
}
`,
    depthTest: true,
    depthWrite: true,
    depthFunc: AlwaysDepth,
    blending: NoBlending,
  });
}

const VIGNETTE_GLSL = /* glsl */ `
float hfVignette(vec2 uv, float aspect, float amount) {
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  return 1.0 - amount * smoothstep(0.35, 0.95, length(q) * 1.15);
}
`;

/** Pixel Lab final blit: nearest, integer k device px per RT texel, integer offset, dithered vignette. */
export function createPixelBlitMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-pixel-blit',
    glslVersion: GLSL3,
    uniforms: {
      tSrc: { value: null as Texture | null },
      uK: { value: 1 },
      uOffset: { value: new Vector2() },
      uVignette: { value: 0.15 },
    },
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform float uK;
uniform vec2 uOffset;
uniform float uVignette;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
${VIGNETTE_GLSL}
float bayer(vec2 p) {
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 q = ivec2(mod(p, 4.0));
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
void main() {
  ivec2 size = textureSize(tSrc, 0);
  vec2 p = floor(gl_FragCoord.xy);
  vec2 t = floor((p + uOffset) / uK) + 1.0;
  ivec2 ti = clamp(ivec2(t), ivec2(0), size - 1);
  vec3 c = texelFetch(tSrc, ti, 0).rgb;
  vec2 uv = (t + 0.5) / vec2(size);
  float v = hfVignette(uv, float(size.x) / float(size.y), uVignette);
  v = floor(v * 12.0 + bayer(t)) / 12.0;
  outColor = linearToOutputTexel(vec4(c * v, 1.0));
}
`,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
}

/** Clean Toon final blit: the resolved MSAA target, bilinear, with the vignette. */
export function createToonBlitMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-toon-blit',
    glslVersion: GLSL3,
    uniforms: {
      tSrc: { value: null as Texture | null },
      uVignette: { value: 0.15 },
      uAspect: { value: 1 },
    },
    vertexShader: FULLSCREEN_VS,
    fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform float uVignette;
uniform float uAspect;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
${VIGNETTE_GLSL}
void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  outColor = linearToOutputTexel(vec4(c * hfVignette(vUv, uAspect, uVignette), 1.0));
}
`,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
}

/**
 * Sky backdrop (03 §8.2): a painted diorama backdrop drawn as a far-depth fullscreen triangle. Each
 * fragment maps to a camera-facing vertical plane behind the look-at point (so the horizon stays
 * level at any yaw): world height = uBase.y + ndc.y · uHalf.y / cos(pitch), plane x = uBase.x +
 * ndc.x · uHalf.x. Gradient sky, a blue Mars-sunset halo around the low sun, two parallax layers of
 * mesa silhouettes, dusty ground below the horizon, dark rock deep down.
 */
export function createSkyMaterial(look: Look): ShaderMaterial {
  const pixel = look === 'pixel';
  const mix = (a: number, b: number, t: number): Color => new Color(a).lerp(new Color(b), t);
  return new ShaderMaterial({
    name: `hf-sky-${look}`,
    glslVersion: GLSL3,
    defines: pixel ? { PIXEL_LAB: '' } : {},
    uniforms: {
      uTop: { value: new Color(SURFACE.skyTop) },
      uBottom: { value: new Color(SURFACE.skyBottom) },
      uHalo: { value: new Color(SURFACE.sunsetHalo) },
      uSunColor: { value: new Color(SURFACE.sun) },
      uDust: { value: new Color(SURFACE.dust) },
      uGround: { value: mix(SURFACE.groundShadow, SURFACE.groundSide, 0.45) },
      uDeep: { value: new Color(0x2b1e2f) },
      uFar: { value: mix(SURFACE.rockLit, SURFACE.dust, 0.55) },
      uFarTop: { value: mix(SURFACE.groundTop, SURFACE.dust, 0.5) },
      uNear: { value: mix(SURFACE.rockDark, SURFACE.dust, 0.3) },
      uNearTop: { value: mix(SURFACE.rockLit, SURFACE.dust, 0.2) },
      uHorizon: { value: -3 },
      uBase: { value: new Vector2() },
      uHalf: { value: new Vector2(1, 1) },
      uCosP: { value: 1 },
      /** x offset from uBase.x, world height, radius (world units). */
      uSun: { value: new Vector3(2.4, 2.6, 0.75) },
    },
vertexShader: /* glsl */ `
out vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}
`,
    fragmentShader: /* glsl */ `
precision highp float;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uHalo;
uniform vec3 uSunColor;
uniform vec3 uDust;
uniform vec3 uGround;
uniform vec3 uDeep;
uniform vec3 uFar;
uniform vec3 uFarTop;
uniform vec3 uNear;
uniform vec3 uNearTop;
uniform float uHorizon;
uniform vec2 uBase;
uniform vec2 uHalf;
uniform float uCosP;
uniform vec3 uSun;
in vec2 vNdc;
layout(location = 0) out vec4 outColor;
#ifdef PIXEL_LAB
layout(location = 1) out vec4 outNormal;
float bayer(vec2 p) {
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 q = ivec2(mod(floor(p), 4.0));
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
#endif
float shape(float x) {
#ifdef PIXEL_LAB
  return clamp(floor(x * 6.0 + bayer(gl_FragCoord.xy)) / 6.0, 0.0, 1.0);
#else
  return x;
#endif
}
/** Flat-topped trapezoid: half-width w, slope run s, height h. */
float mesa(float x, float c, float w, float s, float h) {
  return h * clamp((w + s - abs(x - c)) / s, 0.0, 1.0);
}
float farRidge(float x) {
  float m = mod(x + 90.0, 180.0) - 90.0;
  float h = mesa(m, -74.0, 10.0, 4.0, 3.6);
  h = max(h, mesa(m, -40.0, 16.0, 3.0, 2.8));
  h = max(h, mesa(m, -6.0, 7.0, 2.5, 4.4));
  h = max(h, mesa(m, 30.0, 18.0, 4.0, 3.2));
  h = max(h, mesa(m, 66.0, 8.0, 3.0, 3.9));
  return max(h, 1.0 + 0.4 * sin(m * 0.21));
}
float nearRidge(float x) {
  float m = mod(x + 60.0, 120.0) - 60.0;
  float h = mesa(m, -48.0, 6.0, 2.0, 2.4);
  h = max(h, mesa(m, -18.0, 9.0, 1.5, 1.8));
  h = max(h, mesa(m, 14.0, 4.0, 1.2, 2.9));
  h = max(h, mesa(m, 40.0, 7.0, 2.0, 2.1));
  return h;
}
/** 0/1 inside a silhouette, with a 1-px edge in Toon and a hard edge in Pixel Lab. */
float inside(float d) {
#ifdef PIXEL_LAB
  return step(0.0, d);
#else
  float aa = max(fwidth(d), 1e-4);
  return clamp(d / aa + 0.5, 0.0, 1.0);
#endif
}
void main() {
  float x = uBase.x + vNdc.x * uHalf.x;
  float h = uBase.y + vNdc.y * uHalf.y / uCosP;
  float above = h - uHorizon;
  vec3 c = mix(uBottom, uTop, shape(smoothstep(0.5, 11.0, above)));
  vec2 ds = vec2(x - (uBase.x + uSun.x), (h - uSun.y) * uCosP) / uSun.z;
  float d = length(ds);
  c = mix(c, uHalo, shape(1.0 - smoothstep(0.7, 4.0, d)) * 0.8);
  c = mix(c, uSunColor, 1.0 - smoothstep(0.92, 1.0, d));
  float far = farRidge(x * 0.35 + 17.0) - above;
  c = mix(c, mix(uFar, uFarTop, step(far, 0.4)), inside(far));
  c = mix(c, uDust, shape(1.0 - smoothstep(0.0, 1.8, above)) * 0.55);
  float near = nearRidge(x * 0.6 + 5.0) - above;
  c = mix(c, mix(uNear, uNearTop, step(near, 0.35)), inside(near));
  // Below the horizon: dusty ground receding toward the viewer, then rock.
  float below = -above;
  vec3 ground = mix(mix(uDust, uGround, shape(smoothstep(0.0, 5.0, below))), uDeep, smoothstep(6.0, 18.0, below));
  c = mix(c, ground, inside(below));
  outColor = vec4(c, 1.0);
#ifdef PIXEL_LAB
  outNormal = vec4(0.5, 0.5, 1.0, 1.0);
#endif
}
`,
    depthWrite: true,
  });
}
