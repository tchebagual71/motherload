// Rim pad arming state machine (canon §2.4, §3.12 touch table; 03 §6.4).
import { describe, expect, it } from 'vitest';
import { createPod } from '../../src/pod';
import { NO_INTENT, type PodState } from '../../src/pod/types';
import { PAD_NEUTRAL_STEPS, PAD_REARM_AIRBORNE_STEPS, POD_H } from '../../src/shared/canon';
import { PUMP_PAD, PadArming, isNeutral, isOnRim, padIndexAt } from '../../src/world/pads';

const ASSAY = 1;

/** A pod grounded on the Rim at x. */
function rimPod(x: number): PodState {
  const p = createPod();
  p.x = x;
  return p;
}

/** Run `n` neutral steps; returns the pads that fired. */
function neutral(pads: PadArming, pod: PodState, n: number): number[] {
  const fired: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = pads.step(pod, true);
    if (f >= 0) fired.push(f);
  }
  return fired;
}

describe('pad geometry', () => {
  it('a pad holds the pod centre within [x0, x1 + 1)', () => {
    expect(padIndexAt(0.99)).toBe(-1);
    expect(padIndexAt(1)).toBe(PUMP_PAD);
    expect(padIndexAt(4.99)).toBe(PUMP_PAD);
    expect(padIndexAt(5)).toBe(-1);
    expect(padIndexAt(12)).toBe(ASSAY);
    expect(padIndexAt(7.5)).toBe(-1);
  });

  it('on the Rim = grounded with the centre above y = 0', () => {
    const p = rimPod(3);
    expect(isOnRim(p)).toBe(true);
    p.grounded = false;
    expect(isOnRim(p)).toBe(false);
    p.grounded = true;
    p.y = -(5 + 1) + POD_H / 2;
    expect(isOnRim(p)).toBe(false);
  });

  it('neutral = no stick and no THRUST', () => {
    expect(isNeutral(NO_INTENT)).toBe(true);
    expect(isNeutral({ ...NO_INTENT, sx: 0.3 })).toBe(false);
    expect(isNeutral({ ...NO_INTENT, thrust: true })).toBe(false);
    expect(isNeutral({ ...NO_INTENT, fireSlot: 0 })).toBe(true);
  });
});

describe('PadArming', () => {
  it('fires after PAD_NEUTRAL_STEPS neutral steps on an armed pad, then stays disarmed', () => {
    const pads = new PadArming();
    const pod = rimPod(3);
    expect(pads.isArmed(pod, PUMP_PAD)).toBe(true);
    expect(neutral(pads, pod, PAD_NEUTRAL_STEPS - 1)).toEqual([]);
    expect(neutral(pads, pod, 1)).toEqual([PUMP_PAD]);
    expect(pads.isArmed(pod, PUMP_PAD)).toBe(false);
    expect(neutral(pads, pod, 600)).toEqual([]);
  });

  it('stick input resets the neutral count', () => {
    const pads = new PadArming();
    const pod = rimPod(3);
    neutral(pads, pod, PAD_NEUTRAL_STEPS - 1);
    expect(pads.step(pod, false)).toBe(-1);
    expect(neutral(pads, pod, PAD_NEUTRAL_STEPS - 1)).toEqual([]);
    expect(neutral(pads, pod, 1)).toEqual([PUMP_PAD]);
  });

  it('re-arms only after the pod fully leaves the footprint', () => {
    const pads = new PadArming();
    const pod = rimPod(3);
    neutral(pads, pod, PAD_NEUTRAL_STEPS);
    pod.x = 5.3; // centre outside, but the 0.86-wide body still overlaps x < 5
    expect(neutral(pads, pod, 30)).toEqual([]);
    pod.x = 4.5; // back in: still latched
    expect(neutral(pads, pod, 30)).toEqual([]);
    pod.x = 5.5; // fully out
    neutral(pads, pod, 1);
    pod.x = 4.5;
    expect(neutral(pads, pod, PAD_NEUTRAL_STEPS)).toEqual([PUMP_PAD]);
  });

  it('re-arms after ≥ 0.2 s airborne, not after a shorter hop', () => {
    const pads = new PadArming();
    const pod = rimPod(3);
    neutral(pads, pod, PAD_NEUTRAL_STEPS);
    pod.grounded = false;
    pod.airSteps = PAD_REARM_AIRBORNE_STEPS - 1;
    neutral(pads, pod, 1);
    pod.grounded = true;
    pod.airSteps = 0;
    expect(neutral(pads, pod, 60)).toEqual([]);
    pod.grounded = false;
    pod.airSteps = PAD_REARM_AIRBORNE_STEPS;
    neutral(pads, pod, 1);
    pod.grounded = true;
    pod.airSteps = 0;
    expect(neutral(pads, pod, PAD_NEUTRAL_STEPS)).toEqual([PUMP_PAD]);
  });

  it('a latch from a closed sheet holds until the pod leaves', () => {
    const pads = new PadArming();
    const pod = rimPod(12);
    neutral(pads, pod, 5);
    pads.latch(ASSAY);
    expect(neutral(pads, pod, 120)).toEqual([]);
  });

  it('snapshots round-trip', () => {
    const pads = new PadArming();
    pads.latch(2);
    pads.neutralSteps = 7;
    const copy = new PadArming(pads.snapshot());
    expect(copy.latched).toEqual([false, false, true, false]);
    expect(copy.neutralSteps).toBe(7);
  });
});
