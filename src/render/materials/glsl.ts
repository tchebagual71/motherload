// GLSL for the look materials (04 §1.3: shader code lives only in render/materials/).
// Injected into MeshToonMaterial via onBeforeCompile. Defines:
//   PIXEL_LAB      hard ramp, Bayer-dithered light falloff, view normal → layout(location = 1)
//   HF_TERRAIN     custom attributes hfColor (sRGB u8 + AO) and hfExtra (emissive, flags, phase)
//   HF_HULL        model outline hull (BackSide, expanded in clip space)
//   HF_ROLE_*      METAL, GLASS, EMISSIVE
//   HF_FACTORY     instanced factory pieces: per-vertex hfPart (emissive, flags, chevron phase) and per-instance
//                  hfInst (working / rusted / tint / status; chevrons: tail fade, head fade, tint, turn)
import { Color } from 'three';
import { BELT_SPEED_TILES_PER_S, MINE_H } from '../../shared/canon';
import { LIGHT, ROLE, SHADING, UI } from '../palette';
import { MAX_LAMPS } from '../quality';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);
/** A palette colour as a linear-space GLSL vec3 (three's working colour space). */
const vec3Of = (hex: number): string => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/** hfPart.y flag bits of factory geometry (render/factory/models.ts). */
export const PART_FLAG = {
  /** Specular sun glint (the 'metal' role). */
  METAL: 1,
  /** Rust decal: drawn only on the survey set's rusted skin (EntityView.rusted). */
  RUST: 2,
  /** Furnace glow: emissive from hfPart.x (idle) to 1 while the machine works. */
  GLOW: 4,
  /** Status LED: colour from the instance status (03 §8.11: starved = amber). */
  LED: 8,
  /** Vertex-shader breathing 1.00 ↔ 1.03 while working (03 §8.11). */
  BREATHE: 16,
  /** Belt chevron: scrolls at the belt speed, hfPart.z = phase (03 §8.7). */
  CHEVRON: 32,
  /** Never outlined (decals, LEDs). */
  NOHULL: 64,
} as const;
/** hfInst.z tint modes. */
export const INST_TINT = { NONE: 0, BULLDOZE: 1, SELECTED: 2 } as const;
/**
 * Added to hfInst.z: the instance (and its outline) is not drawn. A Yard building that hides the cursor, the
 * selection or a belt being painted is drawn as a see-through copy in the late pass instead (03 §4.9).
 */
export const INST_HIDDEN = 8;

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
/** Push the vertex outward in screen space by uHfOutlinePx × k along its view-space normal. */
void hfExpandOutline(vec3 nView, float k) {
  vec2 d = (projectionMatrix * vec4(nView, 0.0)).xy * uHfResolution;
  float l = length(d);
  if (l > 1e-5) gl_Position.xy += (d / l) * (uHfOutlinePx * k * 2.0 / uHfResolution) * gl_Position.w;
}
#ifdef HF_FACTORY
attribute vec4 hfPart;
attribute vec4 hfInst;
varying vec4 vHfPart;
varying vec4 vHfInst;
uniform float uHfTime;
/** Breathing amplitude (0.03; 0 with reduced motion, battery mode or > 40 visible machines). */
uniform float uHfFactoryBreath;
/** 1 = factory hulls outline only the selected piece (low-tier outline scope "pod + selected", 04 §5.5). */
uniform float uHfFactoryHullSel;
#endif
`;

/**
 * Factory piece deformation in local space (after begin_vertex): rust skin, chevron scroll along a straight
 * tile or a corner's quarter arc, machine breathing. A dropped vertex is moved outside the clip volume later.
 */
export const VERTEX_BEGIN = /* glsl */ `
  float hfDrop = 0.0;
  #ifdef HF_FACTORY
  int hfFl = int(hfPart.y + 0.5);
  vHfPart = hfPart;
  vHfInst = hfInst;
  if (hfInst.z > ${f(INST_HIDDEN - 0.5)}) hfDrop = 1.0;
  if ((hfFl & ${PART_FLAG.RUST}) != 0 && hfInst.y < 0.5) hfDrop = 1.0;
  #ifdef HF_HULL
  if ((hfFl & ${PART_FLAG.NOHULL}) != 0) hfDrop = 1.0;
  if (uHfFactoryHullSel > 0.5 && hfInst.z < 1.5) hfDrop = 1.0;
  #endif
  if ((hfFl & ${PART_FLAG.BREATHE}) != 0 && hfInst.x > 0.5 && uHfFactoryBreath > 0.0) {
    #ifdef USE_INSTANCING
    float hfPh = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3 + instanceMatrix[3].y;
    #else
    float hfPh = 0.0;
    #endif
    transformed.y *= 1.0 + uHfFactoryBreath * (0.5 + 0.5 * sin(uHfTime * 4.4 + hfPh));
  }
  if ((hfFl & ${PART_FLAG.CHEVRON}) != 0) {
    float hfS = fract(uHfTime * ${f(BELT_SPEED_TILES_PER_S)} + hfPart.z);
    float hfFade = 1.0;
    if (hfInst.x > 0.5) hfFade = min(hfFade, hfS / 0.16);
    if (hfInst.y > 0.5) hfFade = min(hfFade, (1.0 - hfS) / 0.16);
    vec3 hfC = transformed * clamp(hfFade, 0.0, 1.0);
    float hfTurn = hfInst.w;
    if (abs(hfTurn) < 0.5) {
      hfC.x += hfS - 0.5;
    } else {
      // Quarter arc about the corner shared by the entry edge (x = −0.5) and the exit edge (z = −turn·0.5).
      vec3 hfQ = hfC + vec3(0.0, 0.0, hfTurn * 0.5);
      float hfA = hfTurn * hfS * 1.5707963;
      float hfCa = cos(hfA), hfSa = sin(hfA);
      hfC = vec3(-0.5 + hfQ.x * hfCa + hfQ.z * hfSa, hfQ.y, -hfTurn * 0.5 - hfQ.x * hfSa + hfQ.z * hfCa);
    }
    transformed = hfC;
  }
  #endif
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
    else hfExpandOutline(hfNv, 1.0);
    #endif
  }
  #endif
  #ifdef HF_HULL
  #ifdef HF_FACTORY
  hfExpandOutline(hfNv, hfInst.z > 1.5 ? 2.2 : 1.0);
  #else
  hfExpandOutline(hfNv, 1.0);
  #endif
  #endif
  if (hfDrop > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
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
uniform float uHfTerrainDim;
#ifdef HF_FACTORY
varying vec4 vHfPart;
varying vec4 vHfInst;
/** Status LED colours by EntStatus index: working, idle, blocked, noRecipe, noOutput (03 §8.11). */
vec3 hfLedColor(float status) {
  if (status < 0.5) return ${vec3Of(0x7cff6b)};
  if (status < 1.5) return ${vec3Of(UI.amber)};
  if (status < 2.5) return ${vec3Of(UI.danger)};
  if (status < 3.5) return ${vec3Of(UI.amber)};
  return ${vec3Of(UI.danger)};
}
#endif
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
  #ifdef HF_FACTORY
  int hfPf = int(vHfPart.y + 0.5);
  hfEm = vHfPart.x;
  if ((hfPf & ${PART_FLAG.GLOW}) != 0) hfEm = mix(vHfPart.x, 1.0, clamp(vHfInst.x, 0.0, 1.0));
  if ((hfPf & ${PART_FLAG.LED}) != 0) {
    hfAlbedo = hfLedColor(vHfInst.w);
    hfEm = 0.9;
  }
  if (vHfInst.z > 0.5 && vHfInst.z < 1.5) {
    hfAlbedo = mix(hfAlbedo, ${vec3Of(0xff4d5e)}, 0.72);
    hfEm = max(hfEm, 0.4);
  } else if (vHfInst.z > 1.5) {
    hfAlbedo = mix(hfAlbedo, vec3(1.0), 0.2);
  }
  #endif
  #ifdef HF_HULL
  hfAlbedo = mix(hfAlbedo * HF_OUTLINE_K, uHfOutlineInk, 0.35);
  hfN = vec3(0.0, 0.0, 1.0);
  #ifdef HF_FACTORY
  hfEm = 0.0;
  if (vHfInst.z > 1.5) {
    hfAlbedo = ${vec3Of(ROLE.chevron)};
    hfEm = 1.0;
  } else if (vHfInst.z > 0.5) {
    hfAlbedo = ${vec3Of(0xb3263a)};
    hfEm = 1.0;
  }
  #endif
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
  #if defined(HF_FACTORY) && !defined(HF_HULL)
  if ((hfPf & ${PART_FLAG.METAL}) != 0) {
    vec3 hfView = normalize(cameraPosition - vHfWorld);
    float hfSpec = dot(reflect(-uHfSunDir, hfN), hfView);
    float hfSunK = 1.0 - smoothstep(0.0, 6.5, -vHfWorld.y);
    hfLit += hfAlbedo * 0.35 * hfEdge(0.86, hfSpec) * hfSunK;
  }
  #endif
  reflectedLight.directDiffuse = mix(hfLit, hfAlbedo, clamp(hfEm, 0.0, 1.0)) + hfAlbedo * max(hfEm - 1.0, 0.0) * 0.5;
  #ifdef HF_TERRAIN
  // Logistics overlay (03 §4.10): the terrain recedes to 30% toward the plum ink so belts and lifts read.
  reflectedLight.directDiffuse = mix(uHfOutlineInk * 0.3, reflectedLight.directDiffuse, uHfTerrainDim);
  #endif
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
