// Per-look material factories (04 §1.3): MeshToonMaterial + onBeforeCompile for Toon and Pixel Lab
// (PIXEL_LAB define), one customProgramCacheKey per variant.
import { AdditiveBlending, BackSide, Color, MeshBasicMaterial, MeshToonMaterial, type Material, type WebGLProgramParametersWithUniforms } from 'three';
import type { Look } from '../../shared/types';
import type { MatRole } from '../models/api';
import { FRAGMENT_END, FRAGMENT_LIGHTS, FRAGMENT_PARS, FRAGMENT_TERRAIN_COLOR, VERTEX_BEGIN, VERTEX_MAIN, VERTEX_PARS } from './glsl';
import type { HfUniforms } from './uniforms';

/**
 * Every shaded material kind: model roles, terrain, model outline hulls, and the instanced factory pieces with
 * their outline hulls (render/factory: per-vertex hfPart, per-instance hfInst).
 */
export type ShadedKind = Exclude<MatRole, 'flame'> | 'terrain' | 'hull' | 'factory' | 'factoryHull';

const ROLE_DEFINES: Partial<Record<ShadedKind, readonly string[]>> = {
  metal: ['HF_ROLE_METAL'],
  glass: ['HF_ROLE_GLASS'],
  emissive: ['HF_ROLE_EMISSIVE'],
  terrain: ['HF_TERRAIN'],
  hull: ['HF_HULL'],
  factory: ['HF_FACTORY'],
  factoryHull: ['HF_HULL', 'HF_FACTORY'],
};

export interface ShadedOptions {
  /** Read three's `color` attribute (models); terrain uses its own hfColor attribute. */
  vertexColors: boolean;
  /** Base colour (used when the geometry has no colour attribute). */
  color?: number;
}

function inject(src: string, token: string, replacement: string): string {
  if (!src.includes(token)) throw new Error(`look material: shader chunk ${token} not found`);
  return src.replace(token, replacement);
}

export function createShadedMaterial(kind: ShadedKind, look: Look, uniforms: HfUniforms, opts: ShadedOptions): MeshToonMaterial {
  const m = new MeshToonMaterial({
    vertexColors: kind !== 'terrain' && opts.vertexColors,
    color: new Color(opts.color ?? 0xffffff),
  });
  const defines: Record<string, string> = {};
  for (const d of ROLE_DEFINES[kind] ?? []) defines[d] = '';
  if (look === 'pixel') defines.PIXEL_LAB = '';
  m.defines = defines;
  if (kind === 'hull' || kind === 'factoryHull') m.side = BackSide;
  if (kind === 'decal') {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -2;
  }
  m.name = `hf-${kind}-${look}${opts.vertexColors ? '' : '-flat'}`;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader;
    vs = inject(vs, '#include <common>', `#include <common>\n${VERTEX_PARS}`);
    vs = inject(vs, '#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BEGIN}`);
    vs = inject(vs, '#include <fog_vertex>', `#include <fog_vertex>\n${VERTEX_MAIN}`);
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = inject(fs, '#include <common>', `#include <common>\n${FRAGMENT_PARS}`);
    fs = inject(fs, '#include <color_fragment>', FRAGMENT_TERRAIN_COLOR);
    fs = inject(fs, '#include <lights_fragment_begin>', FRAGMENT_LIGHTS);
    fs = inject(fs, '#include <lights_fragment_maps>', '');
    fs = inject(fs, '#include <lights_fragment_end>', '');
    fs = inject(fs, '#include <dithering_fragment>', FRAGMENT_END);
    shader.fragmentShader = fs;
  };
  const key = `hf:${kind}:${look}`;
  m.customProgramCacheKey = (): string => key;
  return m;
}

/** Thrust flames and other additive glows: same for both looks (Pixel Lab draws them in pass 3). */
export function createFlameMaterial(vertexColors: boolean, color = 0xffffff): Material {
  const m = new MeshBasicMaterial({
    vertexColors,
    color: new Color(color),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  m.name = 'hf-flame';
  return m;
}
