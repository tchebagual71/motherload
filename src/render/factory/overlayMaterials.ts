// Build-mode overlay materials (03 §4.3, §4.10; 04 §5.4): translucent ghosts (valid = role colour 50%, invalid =
// #FF4D5E 45% + hatch, queued jobs = pulsing blueprint, x-ray = a building faded to 40% because it hides the
// cursor), the ghosts' depth prepass and crisp silhouette outline, and status bubbles (28-pt discs with one glyph).
// All draw in the late pass (Pixel Lab pass 3), depth-tested; only the prepass writes depth.
import { BackSide, Color, DataTexture, DoubleSide, MeshBasicMaterial, NearestFilter, NoColorSpace, RGBAFormat, ShaderMaterial, UnsignedByteType, Vector2 } from 'three';
import { ROLE, UI } from '../palette';
import { PART_FLAG } from '../materials/glsl';

export { BUBBLE_GLYPH } from './status';

/** Ghost styles (hfGhost.y). XRAY: a real building drawn see-through over what it hides (03 §4.9). */
export const GHOST_STYLE = { VALID: 0, INVALID: 1, JOB: 2, ACTIVE: 3, XRAY: 4 } as const;
export const INVALID_HEX = 0xff4d5e;
/** Deep red of an invalid ghost's outline (the bulldoze hull colour). */
export const INVALID_EDGE_HEX = 0xb3263a;
export const GHOST_ALPHA = { valid: 0.5, invalid: 0.45, job: 0.42, xray: 0.4 } as const;
/** Ghost outline width: CSS px × render DPR in Toon (as the model hulls), one RT texel in Pixel Lab. */
export const GHOST_EDGE_PX = 1.5;

/**
 * Ghost vertex transform shared by the body, its depth prepass and its outline, written once so all three land
 * on bit-identical depths (the body tests LessEqual against the prepass).
 */
const GHOST_VERTEX_PARS = /* glsl */ `
attribute vec4 hfPart;
attribute vec2 hfGhost;
vec4 hfGhostWorld() {
  vec4 wp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  return modelMatrix * wp;
}
// Ghosts are blueprints: no rust skin, decals or LEDs.
bool hfGhostDropped() {
  int fl = int(hfPart.y + 0.5);
  return (fl & ${PART_FLAG.RUST | PART_FLAG.LED | PART_FLAG.CHEVRON}) != 0;
}
`;

export function createGhostMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-ghost',
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
${GHOST_VERTEX_PARS}
varying vec3 vN;
varying vec3 vC;
varying vec2 vG;
varying vec3 vW;
void main() {
  vec4 wp = hfGhostWorld();
  vec3 n = normal;
  #ifdef USE_INSTANCING
  n = mat3(instanceMatrix) * n;
  #endif
  vW = wp.xyz;
  vN = normalize(n);
  #ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
  #else
  vC = vec3(1.0);
  #endif
  // Keep the piece's own value pattern (roof, body, trim) under the tint so the blueprint reads as the building.
  float luma = dot(color, vec3(0.3, 0.55, 0.15));
  vC *= 0.45 + 0.75 * sqrt(clamp(luma, 0.0, 1.0));
  // X-ray: the building's own colours, only faded.
  if (hfGhost.y > 3.5) vC = color;
  vG = hfGhost;
  gl_Position = projectionMatrix * viewMatrix * wp;
  if (hfGhostDropped()) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vC;
varying vec2 vG;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  // Tops lit, fronts mid, sides darker, so a translucent blueprint still reads as a solid.
  float l = 0.42 + 0.58 * max(dot(n, normalize(vec3(-0.45, 1.0, 0.7))), 0.0);
  l = mix(l, 1.1, step(0.8, n.y) * 0.4);
  vec3 c = vC * l;
  float a = vG.x;
  float style = vG.y;
  if (style > 0.5 && style < 1.5) {
    // Invalid: diagonal hatch (03 §4.3) over the shaded faces.
    float h = step(0.55, fract((gl_FragCoord.x + gl_FragCoord.y) / 10.0));
    c = mix(c, c * 0.7, h);
    a = mix(a, a + 0.25, h);
  } else if (style > 1.5 && style < 3.5) {
    // Queued job: pulsing blueprint with world-fixed scan lines; the job being built pulses faster.
    float speed = style > 2.5 ? 9.0 : 3.0;
    float pulse = 0.5 + 0.5 * sin(uTime * speed);
    float scan = step(0.82, fract((vW.y - vW.z) * 4.0 - uTime * 0.6));
    c = mix(c, vec3(1.0), 0.18 * pulse + 0.25 * scan);
    a *= 0.7 + 0.45 * pulse;
  }
  gl_FragColor = vec4(c, clamp(a, 0.0, 0.9));
}`,
  });
}

/**
 * Ghost depth prepass: the ghost's nearest surface only, no colour. The body then draws just its front layer
 * (no double-blended inner faces) and the outline hull is rejected everywhere inside the silhouette.
 */
export function createGhostDepthMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-ghost-depth',
    // Sorted with the late pass by renderOrder (before the outline and the body).
    transparent: true,
    depthWrite: true,
    colorWrite: false,
    vertexShader: /* glsl */ `
${GHOST_VERTEX_PARS}
void main() {
  gl_Position = projectionMatrix * viewMatrix * hfGhostWorld();
  if (hfGhostDropped()) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`,
    fragmentShader: /* glsl */ `
void main() {
  gl_FragColor = vec4(0.0);
}`,
  });
}

/**
 * Ghost silhouette outline (03 §4.3): an inverted hull pushed out by uPx target pixels in screen space, depth-tested
 * against the ghost's prepass so only the rim shows. Valid and queued ghosts: their tint × 0.55 toward plum ink;
 * invalid: a deep red edge, so a red ghost still reads against red-brown rock and a coral roof at pitch 55°.
 */
export function createGhostOutlineMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-ghost-outline',
    transparent: true,
    depthWrite: false,
    side: BackSide,
    uniforms: { uPx: { value: GHOST_EDGE_PX }, uRes: { value: new Vector2(1, 1) } },
    vertexShader: /* glsl */ `
${GHOST_VERTEX_PARS}
uniform float uPx;
uniform vec2 uRes;
varying vec3 vC;
varying float vStyle;
void main() {
  vec4 wp = hfGhostWorld();
  gl_Position = projectionMatrix * viewMatrix * wp;
  vec3 n = normal;
  #ifdef USE_INSTANCING
  n = mat3(instanceMatrix) * n;
  #endif
  vec3 nv = normalize(mat3(viewMatrix) * n);
  vec2 d = (projectionMatrix * vec4(nv, 0.0)).xy * uRes;
  float l = length(d);
  if (l > 1e-5) gl_Position.xy += (d / l) * (uPx * 2.0 / uRes) * gl_Position.w;
  #ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
  #else
  vC = vec3(1.0);
  #endif
  vStyle = hfGhost.y;
  if (hfGhostDropped()) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`,
    fragmentShader: /* glsl */ `
varying vec3 vC;
varying float vStyle;
void main() {
  vec3 ink = ${linear(UI.plum)};
  vec3 c = vStyle > 0.5 && vStyle < 1.5 ? ${linear(INVALID_EDGE_HEX)} : mix(vC * 0.55, ink, 0.35);
  gl_FragColor = vec4(c, 0.92);
}`,
  });
}

/** Atlas cell size; GLYPHS are in BUBBLE_GLYPH order (status.ts). */
const GLYPH_PX = 16;
const GLYPHS: readonly string[][] = [
  [
    '................',
    '................',
    '.....######.....',
    '....########....',
    '...###....###...',
    '...##......##...',
    '..###......###..',
    '..##........##..',
    '..##........##..',
    '..###......###..',
    '...##......##...',
    '...###....###...',
    '....########....',
    '.....######.....',
    '................',
    '................',
  ],
  [
    '................',
    '................',
    '.....######.....',
    '.....#....#.....',
    '.....#....#.....',
    '.....######.....',
    '................',
    '..######.######.',
    '..#....#.#....#.',
    '..#....#.#....#.',
    '..#....#.#....#.',
    '..######.######.',
    '................',
    '................',
    '................',
    '................',
  ],
  [
    '................',
    '.....######.....',
    '....########....',
    '...###....###...',
    '...##......##...',
    '..........###...',
    '.........###....',
    '.......####.....',
    '......###.......',
    '......##........',
    '......##........',
    '................',
    '......##........',
    '......##........',
    '................',
    '................',
  ],
  [
    '................',
    '................',
    '..#####.........',
    '.##...##........',
    '.#.....#........',
    '.#.....#..#.....',
    '.##...##...#....',
    '..#####.....#...',
    '...#.....#####..',
    '....#...##...##.',
    '.....#..#.....#.',
    '........#.....#.',
    '........##...##.',
    '.........#####..',
    '................',
    '................',
  ],
  [
    '................',
    '.....######.....',
    '....##....##....',
    '...#........#...',
    '..#........###..',
    '..#.......###...',
    '.#.......###..#.',
    '.#......###...#.',
    '.#.....###....#.',
    '.#....###.....#.',
    '..#..###.....#..',
    '..#.###......#..',
    '...###......#...',
    '....##....##....',
    '.....######.....',
    '................',
  ],
];

/** (16·n) × 16 RGBA atlas: glyph pixels opaque white, the rest clear. */
export function createGlyphAtlas(): DataTexture {
  const w = GLYPH_PX * GLYPHS.length;
  const data = new Uint8Array(w * GLYPH_PX * 4);
  GLYPHS.forEach((rows, g) => {
    for (let y = 0; y < GLYPH_PX; y++) {
      for (let x = 0; x < GLYPH_PX; x++) {
        if (rows[y][x] !== '#') continue;
        // Texture rows run bottom-up.
        const o = ((GLYPH_PX - 1 - y) * w + g * GLYPH_PX + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 255;
      }
    }
  });
  const t = new DataTexture(data, w, GLYPH_PX, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const GLYPHS_COUNT = GLYPHS.length;

function linear(hex: number): string {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

/** Camera-facing bubble: cream disc, plum ring, glyph in the status colour (hfGlyph.x = glyph, .y = 1 alert). */
export function createBubbleMaterial(atlas: DataTexture): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-bubble',
    transparent: true,
    depthWrite: false,
    uniforms: { tGlyphs: { value: atlas } },
    vertexShader: /* glsl */ `
attribute vec2 hfGlyph;
varying vec2 vUv;
varying vec2 vG;
void main() {
  vUv = uv * 2.0 - 1.0;
  vG = hfGlyph;
  vec4 wp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * wp;
  // Pull bubbles toward the camera so the machine they float over never clips them.
  gl_Position.z -= 0.02 * gl_Position.w;
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D tGlyphs;
varying vec2 vUv;
varying vec2 vG;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  vec3 cream = ${linear(UI.cream)};
  vec3 ink = ${linear(UI.plum)};
  vec3 alert = vG.y > 0.5 ? ${linear(UI.danger)} : ${linear(UI.amber)};
  vec3 c = r > 0.8 ? ink : cream;
  vec2 g = vUv / 0.62 * 0.5 + 0.5;
  if (abs(vUv.x) < 0.62 && abs(vUv.y) < 0.62) {
    float m = texture2D(tGlyphs, vec2((vG.x + g.x) / ${GLYPHS_COUNT}.0, g.y)).a;
    c = mix(c, vG.y > 0.5 ? alert : ink, m);
  }
  gl_FragColor = vec4(c, 0.96);
}`,
  });
}

/** Flat translucent overlay (cursor marker, highlights, selection brackets). */
export function overlayMaterial(hex: number, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false, side: DoubleSide });
}

export const OVERLAY_HEX = {
  cursor: UI.cream,
  bulldoze: INVALID_HEX,
  highlight: ROLE.logistics,
  select: ROLE.chevron,
} as const;
