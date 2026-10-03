// Build-mode overlay materials (03 §4.3, §4.10; 04 §5.4): translucent ghosts (valid = role colour 50%, invalid =
// #FF4D5E 45% + hatch, queued jobs = pulsing blueprint) and status bubbles (28-pt discs with one glyph). All draw in
// the late pass (Pixel Lab pass 3), depth-tested, never depth-writing.
import { Color, DataTexture, DoubleSide, MeshBasicMaterial, NearestFilter, NoColorSpace, RGBAFormat, ShaderMaterial, UnsignedByteType } from 'three';
import { ROLE, UI } from '../palette';
import { PART_FLAG } from '../materials/glsl';

/** Ghost styles (hfGhost.y). */
export const GHOST_STYLE = { VALID: 0, INVALID: 1, JOB: 2, ACTIVE: 3 } as const;
export const INVALID_HEX = 0xff4d5e;
export const GHOST_ALPHA = { valid: 0.5, invalid: 0.45, job: 0.42 } as const;

export function createGhostMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-ghost',
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
attribute vec4 hfPart;
attribute vec2 hfGhost;
varying vec3 vN;
varying vec3 vC;
varying vec2 vG;
varying vec3 vW;
void main() {
  vec4 wp = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  n = mat3(instanceMatrix) * n;
  #endif
  wp = modelMatrix * wp;
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
  vG = hfGhost;
  gl_Position = projectionMatrix * viewMatrix * wp;
  int fl = int(hfPart.y + 0.5);
  // Ghosts are blueprints: no rust skin, decals or LEDs.
  if ((fl & ${PART_FLAG.RUST | PART_FLAG.LED | PART_FLAG.CHEVRON}) != 0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
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
  } else if (style > 1.5) {
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
 * Status glyphs (03 §4.10): no input (hollow circle), output full (boxes), no recipe (?), disconnected (broken
 * link), and the Logistics overlay's jam head (⊘).
 */
export const BUBBLE_GLYPH = { NO_INPUT: 0, FULL: 1, NO_RECIPE: 2, DISCONNECTED: 3, JAM: 4 } as const;

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
