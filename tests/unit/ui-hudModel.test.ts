import { describe, expect, it } from 'vitest';
import type { PodState } from '../../src/pod/types';
import { fuelWarnLevel, hudAlert, hudModel, massTone } from '../../src/ui/hudModel';
import type { PodStats, Wallet } from '../../src/world/api';

const stats = (over: Partial<PodStats> = {}): PodStats => ({
  maxFuel: 10,
  maxHull: 10,
  engineHp: 150,
  hoverCap: 100,
  vUp: 7,
  digSteps: 29,
  radiator: 1,
  baySlots: 7,
  cargoMass: 0,
  scannerLodeRadius: 1,
  ...over,
});
const pod = (over: Partial<PodState> = {}): PodState =>
  ({ fuel: 6, hull: 10, cargo: [], row: -1, ...over }) as PodState;
const wallet = (over: Partial<Wallet> = {}): Wallet => ({ cash: 20, debt: 0, lifetimeEarned: 0, ...over });

describe('hudModel', () => {
  it('shows the start state (canon §3.6: $20, 10/10, 6/10 L)', () => {
    const m = hudModel(pod(), stats(), wallet());
    expect(m.fuelText).toBe('6.0 L');
    expect(m.fuelFrac).toBeCloseTo(0.6, 6);
    expect(m.fuelWarn).toBe(-1);
    expect(m.hullText).toBe('10');
    expect(m.hullLow).toBe(false);
    expect(m.cargoText).toBe('0');
    expect(m.cash).toBe('$20');
    expect(m.depth).toBe('0ft');
    expect(m.underground).toBe(false);
    expect(m.inDebt).toBe(false);
  });

  it('raises fuel warnings at 20 / 10 / 5 %', () => {
    expect(fuelWarnLevel(0.21)).toBe(-1);
    expect(fuelWarnLevel(0.19)).toBe(0);
    expect(fuelWarnLevel(0.09)).toBe(1);
    expect(fuelWarnLevel(0.04)).toBe(2);
    expect(hudModel(pod({ fuel: 0.4 }), stats(), wallet()).fuelWarn).toBe(2);
  });

  it('flags the hull below 25 %', () => {
    expect(hudModel(pod({ hull: 2.6 }), stats(), wallet()).hullLow).toBe(false);
    expect(hudModel(pod({ hull: 2.4 }), stats(), wallet()).hullLow).toBe(true);
  });

  it('colours the cargo bar by mass against the hover cap and flags TOO HEAVY above it', () => {
    expect(massTone(0.49)).toBe('ok');
    expect(massTone(0.5)).toBe('amber');
    expect(massTone(0.75)).toBe('red');
    const at = (mass: number) => hudModel(pod(), stats({ cargoMass: mass }), wallet());
    expect(at(100).tooHeavy).toBe(false); // at the cap the pod still hovers
    expect(at(101).tooHeavy).toBe(true);
    expect(at(60).massTone).toBe('amber');
  });

  it('counts cargo slots for the bar', () => {
    const cargo = Array.from({ length: 4 }, () => ({ kind: 'mineral' as const, tier: 1 }));
    const m = hudModel(pod({ cargo }), stats(), wallet());
    expect(m.cargoText).toBe('4');
    expect(m.cargoFrac).toBeCloseTo(4 / 7, 6);
  });

  it('switches the info pill to depth-first underground and flags debt', () => {
    const m = hudModel(pod({ row: 25 }), stats(), wallet({ cash: 12_345, debt: 300 }));
    expect(m.underground).toBe(true);
    expect(m.depth).toBe('313ft');
    expect(m.cash).toBe('$12.3k');
    expect(m.inDebt).toBe(true);
  });
});

describe('hudAlert (UI-10: only newly crossed warnings are announced)', () => {
  const at = (p: Partial<PodState>, s: Partial<PodStats> = {}) => hudModel(pod(p), stats(s), wallet());

  it('stays silent for ordinary ticks and on the first frame', () => {
    expect(hudAlert(null, at({ fuel: 0.4 }))).toBeNull();
    expect(hudAlert(at({ fuel: 6 }), at({ fuel: 5.9, row: 12 }))).toBeNull();
    expect(hudAlert(at({ fuel: 1.9 }), at({ fuel: 1.8 }))).toBeNull(); // still the same warning level
  });

  it('announces each fuel level, the hull warning and TOO HEAVY once, when crossed', () => {
    expect(hudAlert(at({ fuel: 2.1 }), at({ fuel: 1.9 }))).toBe('Fuel low, 1.9 L left');
    expect(hudAlert(at({ fuel: 1.1 }), at({ fuel: 0.9 }))).toBe('Fuel very low, 0.9 L left');
    expect(hudAlert(at({ fuel: 0.6 }), at({ fuel: 0.4 }))).toBe('Fuel critical, 0.4 L left');
    expect(hudAlert(at({ fuel: 0.4 }), at({ fuel: 6 }))).toBeNull(); // refuelled: nothing to say
    expect(hudAlert(at({ hull: 2.6 }), at({ hull: 2.4 }))).toBe('Hull low, 3 HP left');
    expect(hudAlert(at({}, { cargoMass: 100 }), at({}, { cargoMass: 101 }))).toBe('Too heavy to climb');
    expect(hudAlert(at({ hull: 3, fuel: 2.1 }), at({ hull: 2, fuel: 1.9 }))).toBe('Hull low, 2 HP left. Fuel low, 1.9 L left');
  });
});
