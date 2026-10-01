import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { MINE_H } from '../../src/shared/canon';
import { LAYER_LATE, LAYER_MAIN, MaterialKit, addOutlineHulls, applyLookMaterials, hullGeometry, setHullsEnabled, syncHull } from '../../src/render/materials';
import { createShadedMaterial } from '../../src/render/materials/look';
import { createAmbientLut } from '../../src/render/materials/uniforms';
import { ambientAt } from '../../src/render/palette';
import { QUALITY, outlineScope, oreHullsEnabled, toonDpr } from '../../src/render/quality';

function compileToon(kind: Parameters<typeof createShadedMaterial>[0], look: 'toon' | 'pixel'): { vs: string; fs: string; key: string; defines: Record<string, unknown> } {
  const kit = new MaterialKit();
  const m = createShadedMaterial(kind, look, kit.uniforms, { vertexColors: true });
  const shader = {
    vertexShader: ShaderLib.toon.vertexShader,
    fragmentShader: ShaderLib.toon.fragmentShader,
    uniforms: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, null as unknown as WebGLRenderer);
  return { vs: shader.vertexShader, fs: shader.fragmentShader, key: m.customProgramCacheKey(), defines: m.defines ?? {} };
}

function coloured(role: string): Mesh {
  const g = new BoxGeometry(1, 1, 1);
  g.setAttribute('color', new BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  const m = new Mesh(g, new MeshLambertMaterial({ vertexColors: true }));
  m.userData.mat = role;
  return m;
}

describe('render materials', () => {
  it('injects the light model into three r186 toon chunks for every kind and look', () => {
    for (const kind of ['terrain', 'solid', 'metal', 'glass', 'emissive', 'decal', 'hull'] as const) {
      for (const look of ['toon', 'pixel'] as const) {
        const { vs, fs, key, defines } = compileToon(kind, look);
        expect(vs).toContain('vHfWorld = hfWp.xyz');
        expect(fs).toContain('vec3 hfShade(');
        expect(fs).toContain('reflectedLight.directDiffuse = mix(hfLit');
        expect(fs).not.toContain('#include <lights_fragment_begin>');
        expect(key).toBe(`hf:${kind}:${look}`);
        expect('PIXEL_LAB' in defines).toBe(look === 'pixel');
      }
    }
  });

  it('writes the view normal to a second attachment only in Pixel Lab', () => {
    expect(compileToon('solid', 'pixel').fs).toContain('hfNormalOut = vec4(normalize(normal)');
    expect(compileToon('terrain', 'pixel').fs).toContain('layout(location = 1) out highp vec4 hfNormalOut');
  });

  it('swaps tagged meshes to shared per-look materials and layers transparent ones late', () => {
    const kit = new MaterialKit();
    const root = new Group();
    const body = coloured('solid');
    const flame = coloured('flame');
    const plain = new Mesh(new BoxGeometry(), new MeshLambertMaterial({ color: 0x123456 }));
    const flat = new Mesh(new BoxGeometry(), new MeshLambertMaterial({ color: 0xff0000 }));
    flat.userData.mat = 'metal';
    root.add(body, flame, plain, flat);
    applyLookMaterials(root, 'toon', kit);
    expect(body.material).toBe(kit.role('toon', 'solid', true));
    expect(flame.layers.isEnabled(LAYER_LATE)).toBe(true);
    expect(body.layers.isEnabled(LAYER_MAIN)).toBe(true);
    expect((plain.material as MeshLambertMaterial).color.getHex()).toBe(0x123456);
    expect(flat.material).toBe(kit.role('toon', 'metal', false, 0xff0000));
    applyLookMaterials(root, 'pixel', kit);
    expect(body.material).toBe(kit.role('pixel', 'solid', true));
    expect(body.material).not.toBe(kit.role('toon', 'solid', true));
    // Re-applying keeps the remembered base colour of flat-coloured meshes.
    expect(flat.material).toBe(kit.role('pixel', 'metal', false, 0xff0000));
  });

  it('adds outline hulls that show only in Toon and respect the scope toggle', () => {
    const kit = new MaterialKit();
    const root = new Group();
    const body = coloured('solid');
    const decal = coloured('decal');
    root.add(body, decal);
    const hulls = addOutlineHulls(root, 'buildings', kit);
    expect(hulls).toHaveLength(1);
    expect(body.children[0]).toBe(hulls[0]);
    applyLookMaterials(root, 'toon', kit);
    expect(hulls[0].visible).toBe(true);
    applyLookMaterials(root, 'pixel', kit);
    expect(hulls[0].visible).toBe(false);
    setHullsEnabled(root, 'buildings', false, 'toon');
    applyLookMaterials(root, 'toon', kit);
    expect(hulls[0].visible).toBe(false);
  });

  it('welds hull normals so flat-shaded corners expand diagonally', () => {
    const g = new BoxGeometry(1, 1, 1).toNonIndexed();
    const h = hullGeometry(g);
    expect(h.getAttribute('position')).toBe(g.getAttribute('position'));
    const n = h.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      expect(Math.abs(n.getX(i))).toBeCloseTo(1 / Math.sqrt(3), 3);
      expect(Math.abs(n.getY(i))).toBeCloseTo(1 / Math.sqrt(3), 3);
    }
  });

  it('keeps hulls in step with geometry swaps, in-place rewrites and draw ranges', () => {
    const kit = new MaterialKit();
    const body = coloured('solid');
    const [hull] = addOutlineHulls(body, 'pod', kit);
    const before = hull.geometry;
    syncHull(hull);
    expect(hull.geometry).toBe(before);
    // In-place rewrite (pod tier change): flatten the box in y, bump the version.
    const pos = body.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * 0.1);
    pos.needsUpdate = true;
    body.geometry.setDrawRange(0, 18);
    syncHull(hull);
    expect(hull.geometry.drawRange.count).toBe(18);
    // Swap (drill variant): the hull follows to a cached hull of the new geometry.
    const other = coloured('solid').geometry;
    body.geometry = other;
    syncHull(hull);
    expect(hull.geometry.getAttribute('position')).toBe(other.getAttribute('position'));
  });

  it('bakes the ambient LUT from the palette', () => {
    const lut = createAmbientLut();
    const data = lut.image.data as Uint8Array;
    expect(lut.image.width).toBe(MINE_H);
    for (const r of [0, 4, 19, 40, 300, 600]) expect(data[r * 4 + 3] / 255).toBeCloseTo(ambientAt(r), 1);
  });
});

describe('render quality', () => {
  it('pins Toon to DPR min(device, 2) in the style test and caps by tier otherwise', () => {
    expect(toonDpr(3, 'mid', true)).toBe(2);
    expect(toonDpr(3, 'mid', false)).toBe(1.5);
    expect(toonDpr(3, 'low', false)).toBe(1.25);
    expect(toonDpr(1, 'high', false)).toBe(1);
  });

  it('scopes outlines per tier, everything in the style test', () => {
    expect(outlineScope('low', false)).toBe('pod');
    expect(outlineScope('mid', false)).toBe('gameplay');
    expect(outlineScope('low', true)).toBe('all');
    expect(oreHullsEnabled('pod')).toBe(false);
    expect(QUALITY.low.lamps).toBe(8);
    expect(QUALITY.high.particles).toBe(900);
  });
});
