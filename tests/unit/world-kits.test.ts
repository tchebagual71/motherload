// Kits in the bay (canon §3.7, §4.8; 02 §2.6–2.7): meter units, least-full-first use, merging refunds, and the
// deconstruct sink's slot reservation.
import { describe, expect, it } from 'vitest';
import { createPod } from '../../src/pod';
import type { CargoItem } from '../../src/shared/types';
import { CargoKitSink, CargoKitSource, cargoKitCount, cargoKitUnits, newKitsFor, putKitUnits, takeKitUnits } from '../../src/world/kits';

const belt = (units?: number): CargoItem => (units === undefined ? { kind: 'kit', id: 'belt' } : { kind: 'kit', id: 'belt', units });

describe('cargo Kits: meter units (02 §2.6)', () => {
  it('counts metered Kits in units (absent = full) and others whole', () => {
    const cargo: CargoItem[] = [belt(), belt(3), { kind: 'kit', id: 'autoDrill' }, { kind: 'mineral', tier: 2 }];
    expect(cargoKitUnits(cargo, 'belt')).toBe(11);
    expect(cargoKitCount(cargo, 'belt')).toBe(2);
    expect(cargoKitUnits(cargo, 'autoDrill')).toBe(1);
    expect(cargoKitUnits(cargo, 'router')).toBe(0);
  });

  it('takes from the least-full Kit first; an emptied Kit leaves the bay', () => {
    const cargo: CargoItem[] = [belt(), belt(3), { kind: 'mineral', tier: 1 }, belt(5)];
    takeKitUnits(cargo, 'belt', 5);
    expect(cargo).toEqual([belt(), { kind: 'mineral', tier: 1 }, belt(3)]);
    takeKitUnits(cargo, 'belt', 4);
    expect(cargo).toEqual([belt(7), { kind: 'mineral', tier: 1 }]);
    expect(() => takeKitUnits(cargo, 'belt', 8)).toThrow(/short/);
  });

  it('takes whole unmetered Kits', () => {
    const cargo: CargoItem[] = [{ kind: 'kit', id: 'liftRail' }, { kind: 'kit', id: 'liftRail' }];
    new CargoKitSource({ ...createPod(), cargo }).take('liftRail', 1);
    expect(cargo).toEqual([{ kind: 'kit', id: 'liftRail' }]);
  });

  it('merges refunded units into partial Kits (fullest first), then adds Kits', () => {
    const cargo: CargoItem[] = [belt(2), belt(6)];
    expect(newKitsFor(cargo, 'belt', 8)).toBe(0);
    expect(newKitsFor(cargo, 'belt', 9)).toBe(1);
    putKitUnits(cargo, 'belt', 9);
    expect(cargo).toEqual([belt(), belt(), belt(1)]);
    putKitUnits(cargo, 'router', 2);
    expect(cargo.slice(3)).toEqual([
      { kind: 'kit', id: 'router' },
      { kind: 'kit', id: 'router' },
    ]);
  });
});

describe('deconstruct sink: room per refund (02 §2.7)', () => {
  it('reserves the slots each yes promised, so two stacks never share the last slot', () => {
    const pod = createPod(); // Satchel: 7 slots
    for (let i = 0; i < 6; i++) pod.cargo.push({ kind: 'mineral', tier: 1 });
    const sink = new CargoKitSink(pod);
    expect(sink.canPut('liftFoot', 1)).toBe(true);
    expect(sink.canPut('liftRail', 1)).toBe(false);
    sink.put('liftFoot', 1);
    expect(pod.cargo.at(-1)).toEqual({ kind: 'kit', id: 'liftFoot' });
  });

  it('metered units that merge need no free slot', () => {
    const pod = createPod();
    for (let i = 0; i < 6; i++) pod.cargo.push({ kind: 'mineral', tier: 1 });
    pod.cargo.push(belt(3));
    const sink = new CargoKitSink(pod);
    expect(sink.canPut('belt', 5)).toBe(true);
    expect(sink.canPut('belt', 1)).toBe(false);
    sink.put('belt', 5);
    expect(pod.cargo.at(-1)).toEqual(belt());
  });
});
