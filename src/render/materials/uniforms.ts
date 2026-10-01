// Shared shader uniforms: one object per uniform, referenced by every look material, so a frame
// updates each value once (03 §8.8 lighting, 04 §5.4).
import { Color, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType, Vector2, Vector3, Vector4 } from 'three';
import { MINE_H } from '../../shared/canon';
import { AMBIENT_FLOOR, LIGHT, SHADING, SPECIAL, SURFACE, UI, ambientAt, stratumAt } from '../palette';
import { MAX_LAMPS } from '../quality';

export interface HfUniforms {
  uHfTime: { value: number };
  uHfPod: { value: Vector3 };
  /** xy = drill direction, z = strength. */
  uHfCone: { value: Vector4 };
  uHfAmbient: { value: DataTexture };
  uHfAmbientFloor: { value: number };
  uHfLampColor: { value: Color };
  /** xy = position, z unused, w = radius. */
  uHfLamps: { value: Vector4[] };
  uHfLampColors: { value: Color[] };
  uHfLampCount: { value: number };
  uHfSunDir: { value: Vector3 };
  uHfSunColor: { value: Color };
  uHfHemiSky: { value: Color };
  uHfHemiGround: { value: Color };
  uHfShadowTint: { value: Color };
  uHfOutlineInk: { value: Color };
  uHfMagma: { value: Color[] };
  /** Toon outline width in render pixels and the render target size. */
  uHfOutlinePx: { value: number };
  uHfResolution: { value: Vector2 };
  /** 1 = draw merged ore/relic hulls (outline scope). */
  uHfOreHulls: { value: number };
}

/** Ambient LUT: one texel per mine row; rgb = band ambient tint (normalised), a = ambient A (03 §8.8). */
export function createAmbientLut(): DataTexture {
  const data = new Uint8Array(MINE_H * 4);
  for (let r = 0; r < MINE_H; r++) {
    const tint = stratumAt(r).ambientTint;
    const rr = (tint >> 16) & 0xff, gg = (tint >> 8) & 0xff, bb = tint & 0xff;
    const m = Math.max(rr, gg, bb, 1);
    data[r * 4] = Math.round((rr / m) * 255);
    data[r * 4 + 1] = Math.round((gg / m) * 255);
    data[r * 4 + 2] = Math.round((bb / m) * 255);
    data[r * 4 + 3] = Math.round(ambientAt(r) * 255);
  }
  const tex = new DataTexture(data, MINE_H, 1, RGBAFormat, UnsignedByteType);
  tex.colorSpace = NoColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function createUniforms(): HfUniforms {
  return {
    uHfTime: { value: 0 },
    uHfPod: { value: new Vector3(0, 0, 0) },
    uHfCone: { value: new Vector4(0, -1, 1, 0) },
    uHfAmbient: { value: createAmbientLut() },
    uHfAmbientFloor: { value: AMBIENT_FLOOR },
    uHfLampColor: { value: new Color(LIGHT.lamp) },
    uHfLamps: { value: Array.from({ length: MAX_LAMPS }, () => new Vector4(0, 0, 0, 1)) },
    uHfLampColors: { value: Array.from({ length: MAX_LAMPS }, () => new Color(0)) },
    uHfLampCount: { value: 0 },
    uHfSunDir: { value: sunDirection(new Vector3()) },
    uHfSunColor: { value: new Color(SURFACE.sun) },
    uHfHemiSky: { value: new Color(SURFACE.hemiSky) },
    uHfHemiGround: { value: new Color(SURFACE.hemiGround) },
    uHfShadowTint: { value: new Color(SHADING.shadowTint) },
    uHfOutlineInk: { value: new Color(UI.plum) },
    uHfMagma: { value: [new Color(SPECIAL.magmaCrust), new Color(SPECIAL.magmaMid), new Color(SPECIAL.magmaCore)] },
    uHfOutlinePx: { value: 3 },
    uHfResolution: { value: new Vector2(1, 1) },
    uHfOreHulls: { value: 1 },
  };
}

/**
 * Sun direction (unit, toward the sun). 03 §8.8 gives azimuth = yaw + 135°, elevation 50°; with the
 * camera on the +x/+z side we read the azimuth from the camera's back-left so the visible faces get
 * the classic three tones: tops lit, fronts mid, right sides in the plum shadow step.
 */
export function sunDirection(out: Vector3): Vector3 {
  const el = (50 * Math.PI) / 180;
  const az = (-40 * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}
