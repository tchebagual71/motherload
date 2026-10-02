// GLSL for the look materials (04 §1.3: shader code lives only in render/materials/).
// Injected into MeshToonMaterial via onBeforeCompile. Defines:
//   PIXEL_LAB      hard ramp, Bayer-dithered light falloff, view normal → layout(location = 1)
//   HF_TERRAIN     custom attributes hfColor (sRGB u8 + AO) and hfExtra (emissive, flags, phase)
//   HF_HULL        model outline hull (BackSide, expanded in clip space)
//   HF_ROLE_*      METAL, GLASS, EMISSIVE
import { MINE_H } from '../../shared/canon';
import { LIGHT, SHADING } from '../palette';
import { MAX_LAMPS } from '../quality';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);

export const VERTEX_PARS = /* glsl */ `
varying vec3 vHfWorld;
varying vec3 vHfWNormal;
uniform float uHfOutlinePx;
uniform vec2 uHfResolution;
uniform float uHfOreHulls;
#ifdef HF_TERRAIN
attribute vec4 hfColor;
attribute vec4 hfExtra;
varying vec4 vHfColor;
varying vec4 vHfExtra;
vec3 hfSrgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
#endif
/** Push the vertex outward in screen space by uHfOutlinePx along its view-space normal. */
void hfExpandOutline(vec3 nView) {
  vec2 d = (projectionMatrix * vec4(nView, 0.0)).xy * uHfResolution;
  float l = length(d);
  if (l > 1e-5) gl_Position.xy += (d / l) * (uHfOutlinePx * 2.0 / uHfResolution) * gl_Position.w;
}
`;

export const VERTEX_MAIN = /* glsl */ `
  vec3 hfNv = normalize(transformedNormal);
  #ifdef FLIP_SIDED
  hfNv = -hfNv; // three flips normals for BackSide; hulls expand along the true outward normal
  #endif
  vec4 hfWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  hfWp = instanceMatrix * hfWp;
  #endif
  hfWp = modelMatrix * hfWp;
  vHfWorld = hfWp.xyz;
  vHfWNormal = normalize((vec4(hfNv, 0.0) * viewMatrix).xyz);
  #ifdef HF_TERRAIN
  vHfColor = vec4(hfSrgbToLinear(hfColor.rgb), hfColor.a);
  vHfExtra = hfExtra;
  if ((int(hfExtra.y * 255.0 + 0.5) & 1) != 0) {
    #ifdef PIXEL_LAB
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    #else
    if (uHfOreHulls < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    else hfExpandOutline(hfNv);
    #endif
  }
  #endif
  #ifdef HF_HULL
  hfExpandOutline(hfNv);
  #endif
`;

export const FRAGMENT_PARS = /* glsl */ `
#define HF_MINE_H ${f(MINE_H)}
#define HF_R ${f(LIGHT.bubbleRadius)}
#define HF_COS_CONE ${f(Math.cos((LIGHT.coneAngleDeg * Math.PI) / 180))}
#define HF_MAX_LAMPS ${MAX_LAMPS}
// 03 §9.2 outline "base × 0.35" is an sRGB-space darkening: 0.35^2.2 in linear.
#define HF_OUTLINE_K ${f(Math.round(Math.pow(0.35, 2.2) * 1000) / 1000)}
varying vec3 vHfWorld;
varying vec3 vHfWNormal;
#ifdef HF_TERRAIN
varying vec4 vHfColor;
varying vec4 vHfExtra;
#endif
uniform sampler2D uHfAmbient;
uniform float uHfAmbientFloor;
uniform vec3 uHfPod;
uniform vec4 uHfCone;
uniform vec3 uHfLampColor;
uniform vec4 uHfLamps[HF_MAX_LAMPS];
uniform vec3 uHfLampColors[HF_MAX_LAMPS];
uniform int uHfLampCount;
uniform vec3 uHfSunDir;
uniform vec3 uHfSunColor;
uniform vec3 uHfHemiSky;
uniform vec3 uHfHemiGround;
uniform vec3 uHfShadowTint;
uniform vec3 uHfOutlineInk;
uniform vec3 uHfMagma[3];
uniform float uHfTime;
uniform vec2 uHfDitherWorld;
uniform vec2 uHfDitherPod;
uniform int uHfPodLampCount;
#ifdef PIXEL_LAB
layout(location = 1) out highp vec4 hfNormalOut;
#endif

float hfBayer(vec2 p) {
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 q = ivec2(mod(floor(p), 4.0));
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
/**
 * Quantise to n steps with ordered dithering (Pixel Lab light falloff, 03 §9.3). The phase (whole
 * texels) pins the Bayer matrix to the gradient's own frame, so it does not re-dither as the camera
 * scrolls (uHfDitherWorld, uHfDitherPod).
 */
float hfDither(float v, float n, vec2 phase) {
  return clamp(floor(v * n + hfBayer(gl_FragCoord.xy + phase)) / n, 0.0, 1.0);
}
/** Ramp edge: smoothed 0.04 in Toon, hard in Pixel Lab (03 §8.7). */
float hfEdge(float t, float x) {
  #ifdef PIXEL_LAB
  return step(t, x);
  #else
  return smoothstep(t - ${f(SHADING.rampSmooth / 2)}, t + ${f(SHADING.rampSmooth / 2)}, x);
  #endif
}
float hfHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float hfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hfHash(i), hfHash(i + vec2(1.0, 0.0)), u.x), mix(hfHash(i + vec2(0.0, 1.0)), hfHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
/** Molten surface: crust → mid → core by two scrolling noise octaves (03 §8.5). */
vec3 hfMagma(vec3 wp) {
  vec2 p = wp.xy * 1.7 + vec2(0.0, uHfTime * 0.35);
  float n = hfNoise(p) * 0.62 + hfNoise(p * 2.3 - vec2(uHfTime * 0.25, 0.0)) * 0.38;
  vec3 c = mix(uHfMagma[0], uHfMagma[1], smoothstep(0.22, 0.52, n));
  return mix(c, uHfMagma[2], smoothstep(0.58, 0.82, n));
}

/** Pod bubble + drill cone + lamps, as a coloured light (03 §8.8). */
vec3 hfLampLight(vec3 wp) {
  vec2 d2 = wp.xy - uHfPod.xy;
  float d = length(d2);
  float pod = 0.95 * (1.0 - smoothstep(0.35 * HF_R, HF_R, d));
  float c = dot(d2, uHfCone.xy) / max(d, 1e-3);
  pod += 0.6 * uHfCone.z * smoothstep(HF_COS_CONE, HF_COS_CONE + 0.12, c) * (1.0 - smoothstep(3.5, 7.0, d)) * step(0.3, d);
  #ifdef PIXEL_LAB
  pod = hfDither(pod, 5.0, uHfDitherPod);
  #endif
  vec3 light = min(pod, 1.0) * uHfLampColor;
  for (int i = 0; i < HF_MAX_LAMPS; i++) {
    if (i >= uHfLampCount) break;
    vec4 L = uHfLamps[i];
    float k = 1.0 - smoothstep(0.3 * L.w, L.w, length(wp.xy - L.xy));
    #ifdef PIXEL_LAB
    k = hfDither(k, 4.0, i < uHfPodLampCount ? uHfDitherPod : uHfDitherWorld);
    #endif
    light = max(light, uHfLampColors[i] * k);
  }
  return light;
}

/**
 * Shade an albedo at world point wp with world normal n:
 * underground L = A + (1 − A)·max(bubble, lamps); surface = sun through the 3-step toon ramp with a
 * plum shadow step + hemisphere fill; the sun fades over rows 0–6 (03 §8.3, §8.7, §8.8).
 */
vec3 hfShade(vec3 albedo, vec3 wp, vec3 n) {
  float depth = -wp.y;
  vec4 amb = texture2D(uHfAmbient, vec2(clamp(depth / HF_MINE_H, 0.0, 1.0), 0.5));
  float A = max(amb.a, uHfAmbientFloor);
  vec3 ambient = A * mix(vec3(1.0), amb.rgb, 0.4);
  vec3 lamp = hfLampLight(wp);
  vec3 ldir = normalize(vec3(uHfPod.xy - wp.xy, 1.6));
  float facing = 0.78 + 0.22 * hfEdge(0.25, dot(n, ldir));
  vec3 under = albedo * (ambient + (1.0 - A) * lamp * facing);

  float ndl = dot(n, uHfSunDir);
  float hemiK = n.y * 0.5 + 0.5;
  vec3 hemi = mix(uHfHemiGround, uHfHemiSky, hemiK);
  vec3 sun = mix(vec3(1.0), uHfSunColor, 0.45);
  float level = 0.80 + 0.1 * hfEdge(${f(SHADING.rampSteps[1])}, ndl) + 0.12 * hfEdge(${f(SHADING.rampSteps[2])}, ndl);
  vec3 lit = albedo * (sun * level + hemi * 0.12);
  vec3 shade = mix(albedo * (0.6 + hemi * 0.12), uHfShadowTint * 0.6, ${f(SHADING.shadowAmount)});
  vec3 surf = mix(shade, lit, hfEdge(${f(SHADING.rampSteps[0])}, ndl));
  float sunK = 1.0 - smoothstep(0.0, 6.5, depth);
  return mix(under, surf, sunK);
}
`;

/** Replaces the toon light accumulation: our light model, emissive, outlines. */
export const FRAGMENT_LIGHTS = /* glsl */ `
  vec3 hfN = normalize(vHfWNormal);
  #ifdef DOUBLE_SIDED
  hfN *= faceDirection;
  #endif
  vec3 hfAlbedo = diffuseColor.rgb;
  float hfAo = 1.0;
  float hfEm = 0.0;
  #ifdef HF_TERRAIN
  hfAo = vHfColor.a;
  hfEm = vHfExtra.x * 2.55;
  int hfFl = int(vHfExtra.y * 255.0 + 0.5);
  float hfPhase = vHfExtra.z * 6.2832;
  if ((hfFl & 2) != 0) hfAlbedo = hfMagma(vHfWorld);
  if ((hfFl & 4) != 0) hfEm *= 0.8 + 0.2 * sin(uHfTime * 5.0265 + hfPhase);
  if ((hfFl & 8) != 0) hfEm += 0.8 * pow(max(0.0, 1.0 - fract(uHfTime / 3.0 + vHfExtra.z) * 5.0), 2.0);
  if ((hfFl & 16) != 0) hfEm *= 0.5 + 1.2 * pow(max(0.0, sin(uHfTime * 3.0 + hfPhase)), 6.0);
  if ((hfFl & 1) != 0) {
    hfAlbedo = mix(hfAlbedo * HF_OUTLINE_K, uHfOutlineInk, 0.35);
    hfEm = 0.0;
    hfN = vec3(0.0, 0.0, 1.0);
  }
  #endif
  #ifdef HF_HULL
  hfAlbedo = mix(hfAlbedo * HF_OUTLINE_K, uHfOutlineInk, 0.35);
  hfN = vec3(0.0, 0.0, 1.0);
  #endif
  #ifdef HF_ROLE_EMISSIVE
  hfEm = 1.0;
  #endif
  vec3 hfLit = hfShade(hfAlbedo * hfAo, vHfWorld, hfN);
  #ifdef HF_ROLE_GLASS
  hfLit = mix(hfLit, hfAlbedo, 0.4) + 0.06;
  #endif
  #ifdef HF_ROLE_METAL
  vec3 hfView = normalize(cameraPosition - vHfWorld);
  float hfSpec = dot(reflect(-uHfSunDir, hfN), hfView);
  float hfSunK = 1.0 - smoothstep(0.0, 6.5, -vHfWorld.y);
  hfLit += hfAlbedo * 0.35 * hfEdge(0.86, hfSpec) * hfSunK;
  #endif
  reflectedLight.directDiffuse = mix(hfLit, hfAlbedo, clamp(hfEm, 0.0, 1.0)) + hfAlbedo * max(hfEm - 1.0, 0.0) * 0.5;
  reflectedLight.indirectDiffuse = vec3(0.0);
`;

export const FRAGMENT_TERRAIN_COLOR = /* glsl */ `
  #ifdef HF_TERRAIN
  diffuseColor.rgb *= vHfColor.rgb;
  #else
  #include <color_fragment>
  #endif
`;

export const FRAGMENT_END = /* glsl */ `
  #include <dithering_fragment>
  #ifdef PIXEL_LAB
  hfNormalOut = vec4(normalize(normal) * 0.5 + 0.5, 1.0);
  #endif
`;
