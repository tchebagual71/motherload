// Phone-class geometry (03 §1.1, canon §3.12). Pure.

/** Phones have a min side below this many pt; tablets are at or above it. */
export const PHONE_MAX_MIN_SIDE = 600;

/** Canon §3.12: landscape phone = W > H and min side < 600 pt (M0/MVP show the upright card). */
export function isLandscapePhone(width: number, height: number): boolean {
  return width > height && Math.min(width, height) < PHONE_MAX_MIN_SIDE;
}

export function isPortrait(width: number, height: number): boolean {
  return height >= width;
}
