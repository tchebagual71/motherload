// What an HFSV file holds: the complete resumable World state (canon §3.15: resume snapshots only).
// PURE MODULE (types only).
import type { RngState } from '../../shared/rng';
import type { Scope } from '../../shared/types';
import type { GenMeta } from '../../terrain/generate';
import type { TerrainGrid } from '../../terrain/grid';
import type { PodState } from '../../pod/types';
import type { StoryState, Wallet } from '../../world/api';

/** Rim pad arming state (canon §2.4), in RIM_BUILDINGS order. */
export interface PadSnapshot {
  latched: boolean[];
  neutralSteps: number;
}

export interface SaveState {
  seed: number;
  scope: Scope;
  /** Deep Heat A/B flag (canon §4.4). */
  deepHeat: boolean;
  stepNo: number;
  meta: GenMeta;
  /** terrain, flags, lodes and lodeIndex are saved/restored; mount and occupant belong to the factory. */
  grid: TerrainGrid;
  pod: PodState;
  wallet: Wallet;
  story: StoryState;
  /** The saved RNG stream (Hop Beacon targets). */
  rng: RngState;
  pads: PadSnapshot;
  /** Factory bytes (FACT section, MVP+); absent in M0 saves and M0 builds. */
  factory?: Uint8Array;
  /** The pod's ghost-completion timer (PODS, version ≥ 1; 02 §2.6): job id (0 = none) and steps held. */
  ghost?: { id: number; steps: number };
}
