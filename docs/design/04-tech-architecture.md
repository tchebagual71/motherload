# 04 — HoleFactory Technical Architecture (rev 2)

**Status:** owns the engine, data model, save format, rendering pipeline, audio engine, testing, CI/CD and tasks (canon R0b). `docs/design/00-canon.md` rev 2 wins on any conflict; review outcomes live in its change log.
**Citations:** canon §x = `00-canon.md`; 01 / 02 / 03 §x = sibling documents; "ledger" = canon §5.5. Rev-1 top-level numbering is kept; §3 is renumbered (rev-1 §3.3–3.6, the worker loop, protocol and snapshots, are deleted) and rev-1 §15 is deleted.
**Verified in this container (2026-10-01; † = rev-2 re-run in `scratchpad/rev2/techpins`, `tscheck`):**
- † The §1.1 pins resolve, and `tsc -b` with `composite` + `emitDeclarationOnly` exits 0 on TS 6.0.3.
- chromium-1194 matches Playwright 1.56.1; WebKit exists only in the CI image.
- CDP gives two-point touch and safe-area overrides.
- Node 22 lacks `indexedDB`, `Worker` and `locks`.
- Vite exposes only `VITE_` variables.

---

## 0. Decisions at a glance

| Area | Decision |
|---|---|
| Build | TypeScript 6.0.3 strict, Vite 8.3.2, one package; boundaries enforced by 4 `tsc -b` projects and lint |
| Simulation | One main-thread `World {terrain, pod, wallet, story, factory}`, synchronous writes; pod 60 Hz + factory 20 Hz from one accumulator (canon §4.10). ADR-0002 alone may add a v1 worker |
| Renderer | three r186 classic `WebGLRenderer` (WebGL2) + GLSL (canon D4) |
| UI | Preact 11 + signals DOM overlay, ≤ 10 Hz bridge |
| Save | `HFSV` TLV + CRC32; critical saves synchronous and raw; IndexedDB, 2 copies; Safe Mode (canon §3.15) |
| Audio | ZzFX SFX; streamed AAC (G1, ending); generative G2–G4 sequencer |
| Hosting | Pages via `actions/deploy-pages` of the CI-tested artifact; `HF_BASE` env; manifest `id: "holefactory"` |
| Tests | Vitest + fake-indexeddb; minimal bot + trip soak (MVP), full bot (v1); Playwright Chromium + CI-only `webkit-smoke` |

---

## 1. Stack

### 1.1 Pinned versions
Exact pins, committed lockfile, `npm ci` everywhere, Node 22.22, npm 10.9. three moves only at milestone boundaries; everything else in a monthly PR through full CI.

| Package | Pin |
|---|---|
| typescript | 6.0.3 (typescript-eslint 8.71 requires < 6.1) |
| three / @types/three | 0.186.1 / 0.186.0 |
| vite / vite-plugin-pwa / workbox-window | 8.3.2 / 1.3.0 / 7.4.1 |
| @vite-pwa/assets-generator | **1.0.4** (vite-plugin-pwa peer `^1.0.0`; 2.0.0 fails ERESOLVE) |
| preact / @preact/signals / @preact/preset-vite | 11.0.0 / 2.11.3 / 2.10.6 |
| zzfx | 1.3.2 |
| vitest / @vitest/coverage-v8 / fast-check / **fake-indexeddb** | 5.0.3 / 5.0.3 / 4.10.2 / 6.2.5 |
| @playwright/test | 1.56.1 (chromium-1194; image `v1.56.1-noble`) |
| eslint / typescript-eslint / eslint-plugin-boundaries / prettier | 10.11.0 / 8.71.0 / 7.2.0 / 3.9.9 |
| size-limit + @size-limit/file | 14.1.0 |
| @gltf-transform/cli + functions / meshoptimizer | 4.5.1 / 1.3.0 |
| Capacitor 8.5.2; haptics 8.0.2, status-bar 8.0.3, screen-orientation 8.0.1, filesystem 8.1.3, preferences 8.0.1 | post-launch only |

fflate is removed: `CompressionStream('deflate-raw')` exists on every canon §3.13 floor and in Node 22.

### 1.2 Renderer
- **Renderer and context:** classic `WebGLRenderer`, WebGL2 only (canon §3.13). Context: `antialias: look === 'toon'`, `alpha: false`, `stencil: false`, and `depth: false` for Pixel Lab.
- **No A/B gate.** ADR-0001 records the choice and the M0-07 device probe (`bench.html`: CPU submit, dropped frames, shader-compile ms) under the §10.1 protocol.
- **Compilation:** `renderer.compileAsync` behind the loader for every variant of the active look; M0 builds compile both looks.

### 1.3 Shader rules
- **One location:** GLSL lives only in `render/materials/`, behind `create*Material` factories and `createPixelLabPasses`.
- **Toon** extends `MeshToonMaterial` through `onBeforeCompile` (ramp, vertex AO, light bubble, lamps, emissive), with a `customProgramCacheKey` per variant.
- **Pixel Lab** compiles the same materials with a `PIXEL_LAB` define (hard ramp; view normal to `layout(location = 1)`); its passes are GLSL3 `ShaderMaterial`s.
- **Terrain** samples only the 64 × 1 ambient LUT and the palette. Its one loop is the lamp loop (≤ 16; 8 on low). Positions are `highp`, colours `mediump`.

### 1.4 Rejected alternatives

- **`WebGPURenderer` + TSL:** +63 KB br (18% of initial JS), least-tested MRT path, API churn; WebGPU is post-launch.
- **Worker-hosted factory (rev 1):** races (Kit lost across a save, pod inside a new machine, unreplayable trips) to offload a tick < 0.1 ms at MVP scale (brief 04 §9). Only ADR-0002 reopens it.
- **Other engines** (Babylon, PlayCanvas, Godot, Unity, Defold): size, iOS memory or toolchain (brief 04).
- **Other options:** OffscreenCanvas rendering adds latency; SharedArrayBuffer needs COOP/COEP; ECS libraries, React, canvas UI, idb-keyval, Comlink, Jest and TS 7 bring no benefit or don't fit.

### 1.5 Build order

| Tier | Work |
|---|---|
| M0 | All pins except Capacitor; ADR-0001; device probe |
| MVP | No new runtime dependencies; asset pipeline in use |
| post | Capacitor; TS 7 once lint allows; TSL/WebGPU, 120 Hz |

### 1.6 Risks
- **An iOS update regresses WebGL2.** Mitigation: three is pinned; upgrades wait for a `bench.html` device run.
- **Preact 11 is a new major.** Mitigation: a small API surface; Preact 10 is the fallback.
- **Compile hitches on low Android.** Mitigation: `compileAsync` behind the loader.

---

## 2. Repository layout and module boundaries

### 2.1 Tree

```
motherload/  index.html  bench.html  jetsam.html  tsconfig.{json,sim,worker,app,node}.json
├─ public/ (icons, fonts, audio)   assets/ (source .glb, palette, CREDITS.md)   docs/adr/
├─ src/
│  ├─ shared/ terrain/ pod/ economy/ story/ factory/ world/ save/codec/   PURE (factory: 02 §10)
│  ├─ save/     sections, migrations/, stores/, codes, safeMode
│  ├─ render/   the only three.js importer
│  ├─ input/ ui/ audio/ platform/ pwa/ app/ (loop, TimeController, GameFacade, catchUpHost)
│  ├─ workers/  v1 only: catchup.worker; flow.worker if ADR-0002 fails
│  ├─ debug/    menu, overlay, Perf Report, __hf.test (dynamic import)
│  └─ config/   scope.ts, flags.ts, tiers.ts, channel.ts
├─ tests/  unit/ golden/ fixtures/saves/ e2e/
├─ tools/  bot/ bench/ assets/ ci/ (fixtures, registry ids, canon refs, radio-card lint)
└─ .github/workflows/  ci.yml deploy.yml nightly.yml update-snapshots.yml
```

### 2.2 Dependency rules

| Module | May import | Must not import |
|---|---|---|
| shared | shared | anything else; DOM; three |
| terrain, economy, story / pod | shared / + terrain | DOM, three, factory |
| factory | shared; terrain types and pure queries | pod, economy, story, DOM, three |
| world | shared and every pure module | DOM, three |
| save | shared, world serialisers; `stores/` may use IndexedDB | render, ui |
| render | shared; `Readonly` views | mutating calls; ui |
| ui | shared, `app/facade`, `app/viewModels` | three; sim modules |
| app / debug | everything | debug is never imported statically |

**Enforcement**
1. **TS projects:** `sim` (the pure modules) has `lib: ["ES2022"]` and `types: []`, so DOM globals and timers fail to compile; `worker` adds WebWorker, `app` adds DOM, `node` covers tools. Each sets `composite`, `emitDeclarationOnly` and `outDir: ".tsbuild/<name>"`; the root has `files: []`; CI runs `tsc -b`.
2. **eslint-plugin-boundaries** encodes the table.
3. **Purity lint:** sim code bans `Date`, `performance`, timers and `Math.random`; pod and terrain steps also ban `Math.{pow,exp,log,sin,cos,tan,atan2,hypot}`; factory bans `new Map`, `new Set` and `for…in`.
4. **Platform lint:** outside `platform/`, `requestIdleCallback`, `cancelIdleCallback`, `scheduler` (absent in Safari) and `navigator.vibrate` (absent on iOS) are banned.
5. **Render** only reads a `RenderFrame`; `.style` writes happen only in `ui/`.

### 2.3 Build order

| Tier | Work |
|---|---|
| M0 | Full tree and every rule |
| MVP | migrations, bot, bench, asset tools |
| v1.0 | Optional workers (§3.4–3.5) |
| post | Capacitor platform and native projects |

### 2.4 Risks
- **Rule erosion.** Mitigation: CI enforces the rules.
- **Slow type checks.** Mitigation: incremental `tsc -b`.

---

## 3. Runtime architecture

### 3.1 One authoritative World (canon §4.10)
- **Ownership:** `World` owns everything on the main thread, with synchronous writes: no mirrors, reservations, cash counters, snapshots or sequence ids.
- **Factory module** (02 §10.1): pure commands (`Ok`/`Err{code}`), `tick()` and read-only views. `World` implements its ports, so the module stays worker-ready.
- **`GameFacade`** calls commands synchronously, so ghosts, toasts and purchases resolve in the same frame. The pod step calls `completeGhost`, keeping E_POD and Kit use atomic (02 §10.11 test 8).
- **Threads:** the service worker caches (§9.2). v1 may add `catchup.worker` (§3.5), and `flow.worker` comes only from a failed ADR-0002.

### 3.2 Main loop

```
onRaf(t):
  dt = min(t − tLast, 250); tLast = t                    // canon §3.5 clamp
  intent = input.sampleFrame(t)
  if !time.suspended(): acc += dt
  n = 0
  while acc ≥ STEP and n < 5:                            // STEP = 1/60 s
    world.step(intent, time.podRunning(), time.factoryAwake())
      // queued commands (stepNo, seq) → pod step → factory.tick() when stepNo % 3 == 2 → events
    acc −= STEP; n++
  if n == 5: acc = min(acc, STEP)                        // drop wall time, never ticks
  alpha = acc / STEP
  save.tick(t); ui.bridge.tick(t); audio.tick(t)
  if renderer.shouldRender(): renderer.render(buildFrame(alpha))
```

- **Caps and timing:** ≤ 5 steps per frame gives ≤ 2 ticks per frame (canon §3.5). Counters are in steps, so behaviour is identical at 30 and 60 fps.
- **Rendering:** none while the context is lost; one frame per change under a full-screen sheet.

### 3.3 Factory views and item motion
- **Structure:** commands bump `topologyVersion` with changed ids; render rebuilds only those instances.
- **Belt items:** Σgap from the head at the last tick, extrapolated by v × α_f when the line moved (02 §10.3). α_f = (steps since the tick + alpha) ÷ 3, clamped so an item never passes the item ahead or the head.
- **Lift buckets:** (clock − entryClock) ÷ transit (02 §10.6), extrapolated the same way.
- **Culling:** a per-chunk line and queue index limits work to the camera rect + 1 chunk.

### 3.4 ADR-0002: the factory-thread gate

| Item | Rule |
|---|---|
| Fixture | MVP-17, built through commands: 2,000 buildings, 10k moving items, 128-tile lines, 24 lifts, every MVP node |
| Run | `bench.html?mode=factory`, live loop with rendering: 1,200 warm-up + 6,000 timed ticks, §10.1 protocol, on the Galaxy A15/A16 (iPhone also reported) |
| Gate | p95 tick ≤ 1.5 ms (canon §3.14) → single-threaded through v1 |
| Fallback | V1-17: **flow state** (lines, queues, inventories, progress, s) moves to `flow.worker`. Main stays sole writer of the cell grid, cash and the Stockpile ledger: it posts structure diffs and applies the worker's sale and Stockpile deltas |
| When | MVP week 3; re-run at v1 feature-complete (power, Depots) |

### 3.5 Away catch-up host (v1)
Formula: 02 §8; this is the host only.
- **Signature:** the pure `catchUp(saveBytes, Δt, {exactTickLimit}) → {saveBytes, report}`.
- **Exact ticks:** limit = ⌊budget ÷ ms per tick⌋, budget 1.5 s (mid) / 3 s (low). Ms per tick is the session's factory p50, or the ADR-0002 figure at cold load; the report records it.
- **Default host:** main thread, ≤ 8 ms slices per rAF, behind the welcome-back card. The `catchUp` reason holds the pod; commands queue.
- **One-shot `catchup.worker`:** used if ADR-0002 moved flow state to a worker, or if slicing would exceed 3 s.
- **Afterwards:** the result replaces the live World, fills the card (02 §8.5), and a routine save follows.

### 3.6 Determinism
- **Factory:** 02 §10.9.
- **Pod and terrain:** doubles at fixed dt, using only `+ − × ÷`, `sqrt` and `floor/ceil/min/max/abs/sign/trunc`. Transcendental constants are `canon.ts` literals. IEEE-754 makes replays bit-exact in Node, Chrome and Safari.
- **Coupling:** the pod reads the factory only through occupant and ANCHORED, written between steps, so replays survive mid-trip building.
- **RNG:** `sfc32` streams `hash(seed, id)`: `GEN_BAND_0…9`, `GEN_POST`, `SHEAR`, `HOP_BEACON`, `HARDCORE`, `BOSS` (saved); `FX` (unsaved).
- **Wall clock:** only `app/` reads `Date.now()`.

### 3.7 Time model (canon §4.5)
`TimeController` keeps a set of reasons. The factory runs under every reason except away.

| Reason | Raised by | Pod |
|---|---|---|
| `sheet`, `build`, `map`, `menu`, `cargo`, `settings`, `death` (3 s), `ctxlost` | The overlay or condition | Paused, velocity kept |
| `interrupt` | `visibilitychange → visible`, cold load, `blur`, AudioContext `interrupted`, orientation/aspect change, `pointercancel` on stick or THRUST, landscape phone (upright card) | Paused; "Tap to resume" |
| `catchUp` (v1), `arenaCountdown` | Away credit; resume in the Hollow Heart | Paused; 3 s countdown |
| away | Hidden, or visible 5 min without input | Suspended or idle. Factory: MVP sleeps ("Factory resting"); v1 Away budget |

- **Resume gate:** airborne or |v| > 3 tiles/s → 1.5 s countdown, also when leaving an overlay airborne at |v_y| > 5.88.
- The arena refuses sheet, build and map; cards and camera shots never add a reason.

### 3.8 Build order

| Tier | Work |
|---|---|
| M0 | World (terrain, pod), loop, TimeController + `interrupt` + upright card, TransportLine demo, replay recorder |
| MVP | Factory in the loop, commands, views, ADR-0002 (week 3), away sleep, goldens |
| v1.0 | `catchUp` host, arena countdown, flow worker only if the gate failed |
| post | OffscreenCanvas render worker, if main-thread CPU binds on low |

### 3.9 Risks
- **Main-thread overload on low.** Mitigation: the tick gate, remesh caps, the Perf Report split; fallback flow worker.
- **A transcendental call slips into pod code.** Mitigation: lint; replay goldens in Node, Chromium and `webkit-smoke`.
- **Long catch-up.** Mitigation: exact ticks are capped at 3 s.

---

## 4. Data model and persistence

### 4.1 World grid
The mine is 48 × 608 = 29,184 cells (`i = row × 48 + x`), full size in every scope (canon §3.2).

| Layer | Type | Bytes | Writer |
|---|---|---|---|
| terrain | `Uint8Array` | 29,184 | terrain (dig, blast, Shear) |
| tflags | `Uint8Array` | 29,184 | terrain; ANCHORED by the factory grid port |
| mount, occupant | `Uint16Array` × 2 | 116,736 | factory grid port |

- **Terrain codes** (u8, append-only): 0 AIR · 1 DIRT · 2 TURF · 3 PAVED · 10–19 specimens · 20–23 relics · 30 HARDROCK · 31 MAGMA · 32 METHANE · 33/34 tapped/capped · 40 LODE_ROCK · 50 SEAL · 51 HEARTSTONE · 52–63 arena. The stratum is derived at mesh time, never stored.
- **tflags bits:** 0 SEEN · 1 DUG · 2 REVEALED · 3 SCORCHED · 4 CHARTED (within 8 tiles of the pod's path) · 5 ANCHORED (canon §3.3).
- **mount (u16):** 1–0x7FFF = entity id (lift, chute, Lamp, Shoring, Router). Bit 15 set = a belt cell: `junction 14 · tierA 12–13 · dirA 10–11 · tierB 8–9 · dirB 6–7`.
- **occupant (u16):** an entity id; any non-zero occupant blocks the pod.
- **Yard** (48 × 32): `ybuild: Uint16Array` holds ids. `ybelt: Uint16Array` uses the same belt layout (bit 15 = present), so a Junction keeps its crossing belt.
- **Scope overlay** (`terrain/scope.ts`): collision, drilling, rendering and the map read through `scopeView(i)`, which never writes. It shows the M0 floor (r128), the MVP Seal (r320, rows below hidden) and MVP Unknown seams (Kerogen, Thorium). The M0 debug strip is a debug command that writes the save, not generation.
- **Lode table:** always 23 records `{x u8, topRow u16, ore u8, purity u8, discovered u8, drillId u16}`.
- **Map:** 48 × 608 RGBA8 DataTexture (117 KB); one texel per changed cell; at most one upload per frame.

### 4.2 Chunks and bands
Render chunks are 16 × 16 (114 mine, 6 Yard). An edit dirties its chunk plus neighbours whose AO or sides read the cell. 64-row bands (0–9) serve worldgen sub-seeds, Depot spacing and profiling; there is no sim LOD.

### 4.3 Factory entities
- **Ids and tables:** u16 ids (1–32,767) from a saved LIFO free list, so ids are stable. `kind` and `local` arrays map an id to its row in a per-kind struct-of-arrays table (`nodes`, `lifts`, `chutes`, `wallMounts`).
- **Node columns:** `type u16, mk u8, plane u8, x u8, y u16, rot u8, status u8, recipe u16, progressAcc f64, outBuf u16×4, inBufOff u32, rrIn u8, rrOut u8, nextAllowedTick f64` (rate limiters: 02 §10.8). Awake sets are per-kind bitsets.
- **Items:** u16 ids from an append-only registry. CI fails on a changed meaning or on more than 256 items (the palette size).

### 4.4 Transport lines
- **Per line:** ring `off u32, cap u16, head u16, n u16`; `len u16` (240 u per tile, ≤ 30,720); spacing `S` 240/120/60 u by Mk at v = 12 u per tick (canon §3.11); `firstSlack u16`, `target u32`, `feeder u32`; `moved u8`; 60 one-second flow buckets.
- **Pools:** `itemPool`/`gapPool` in power-of-two blocks (8–512), one free list per size; capacity ⌈len / S⌉ + 1. `tilePool` holds cells head → tail.

### 4.5 Lifts and chutes
`fifoOff u32, fifoCap u16, fifoHead u16, fifoN u16` index `qItem: Uint16Array` and `qEntry: Float64Array` (Q16 integers), plus `clock, credit, transit` (f64), `stalled, rows, mk`. Capacity ⌈rate × transit⌉ + 2 (rules 02 §10.6).

### 4.6 Inventories and the Stockpile
Storage contents (Bins, Silos, Depot stock, machine buffers) are sorted `(item u16, count u32)` runs in one pool, ≤ 32 per storage. `stockpileTotals: Uint32Array(256)` updates on every Bin or Silo change; shops take through `stockpileTake`.

### 4.7 Wallet and ledger
- **Wallet:** `{cash, debt}` in safe-integer dollars; debt is collected at the next Assay sale (canon §4.2).
- **Records:** lifetime counters by source and sink; a 64-entry ring `{wallMs, stepNo, kind, amount, ref}`.
- **Invariant** (debug, tests, soak): cash = start + Σearned − Σspent; cash, debt ≥ 0.

### 4.8 Story flags, counters, pod state
- **Flags:** 512 bits with stable ids (beats, incentives, onboarding, rungs U0–U11, milestones, boss, ending).
- **Counters:** `Uint32Array(32)`: trips, deaths, deepest row, eligible returns, Shear pity, Return Tick training, Recorder index, boss attempts, last Co-op Credit.
- **Pod:** position, velocity, fuel, hull (f64); 7 tiers; 6 consumable counts (≤ 9); quick slots; cargo (≤ 120 slots); dig state; armed-pad id. Depot per-trip service flags are factory state (02 §10.10).

### 4.9 Save file format
**Header** (32 B): `HFSV` · version u16 (M0 = 0, never migrated; MVP ships 1) · flags u16 (bit 0 deflate-raw, 0 for critical saves; 1 Hardcore; 2 imported) · CRC32 of the uncompressed payload · uncompressed length u32 (≤ 1 MiB) · build id u32 · savedAt f64 · seed u32. The payload is `FourCC u32 · length u32 · bytes` sections.

| Section | Contents | Raw size |
|---|---|---|
| `META` / `RNGS` | Play ms, scope, slot summary, `ASSISTED_DEBUG` / sfc32 states | 0.3 KB |
| `TERR` / `LODE` | terrain + tflags (no generator dependency) / lode table | 57 KB |
| `PODS` / `ECON` / `STRY` | Pod, cargo, ghost timer / wallet, debt, counters, ring / flags, counters, card log | 3 KB |
| `AWAY` | maxSavedWall, awayFrom, lastInputWall; v1 adds the 96-bucket ledger (02 §8.1) | 1.6 KB |
| `FENT` / `FLIN` | Entity tables, free list, factory tick / lines, paths, items, gaps | ≤ 70 / ≤ 50 KB |
| `FINV` / `FQUE` / `FGHO` | Inventory runs / lift and chute FIFOs / ghost jobs | ≤ 24 KB |

- **Derived layers:** mount, occupant and ANCHORED are rebuilt from FENT and FLIN on load and must match TERR (§4.13).
- **Readers** skip unknown FourCCs; serialisers live with their owner module. The state hash covers FENT, FLIN, FINV, FQUE (02 §10.9).
- **Size:** raw ≈ 60–200 KB; deflate-raw 25–60 KB, within canon's 100 KB.

### 4.10 Slots, stores, origin-scoped names
- **Channel prefixes:** `VITE_CHANNEL` (`prod`, `dev`) prefixes every origin-scoped name: IndexedDB `hf-<ch>`, localStorage `hf-<ch>.*`, locks `hf-<ch>-slot-<n>`, caches `hf-<ch>-media` and `-icons`.
- **Shared origin:** `tchebagual71.github.io` is shared with the account's other Pages sites, which can read or clear these saves. Accepted for dev and playtests; a custom domain or Capacitor comes first for any public link (canon §7 #2).
- **Stores:** `slots` `{latest, seqA, seqB, lastGood, summary}`; `files` (HFSV buffers keyed `slot1/a`); `kv` (settings, mirrored in localStorage for boot).
- **Write:** one transaction puts the non-latest copy, flips `latest`, bumps seq and calls `tx.commit()`.
- **Read:** latest first (magic, version, inflate, CRC, §4.13). On failure, the other copy, with "Save damaged — restored the previous copy (n min older)".
- **Slots and tabs:** 1 slot in the MVP, 3 in v1. `navigator.locks` (`ifAvailable`) makes a second tab read-only.
- **Export:** `HF1:` + base64url, or `holefactory-slot<n>-YYYYMMDD.hfsave` via Web Share.
- **Import:** the §4.13 dry run, then a non-latest write and a flip.
- **Capacitor (post):** the same bytes in Filesystem, written as temp then renamed.

### 4.11 Migrations and the generation freeze
- **Migrations:** pure `vN_to_vN+1(sections)`, stepwise from MVP version 1. M0 saves show "This test save can't be loaded", with export.
- **Fixtures:** CI fails if `SAVE_VERSION` rises without the previous fixture and a migration.
- **Generation freeze** (canon §3.2): from the MVP tag, `tests/golden/worldgen.json` holds TERR and LODE hashes for 5 seeds; changing them requires a migration.
- **Newer files** are never overwritten.
- **Scope on load** (INT-6): a world always plays under the build's scope (`config/scope.ts`). A save from an older scope migrates forward on load by restamping its scope only, since scope hides content and never changes generation (m0 → mvp keeps the world, including the dug or undug M0 debug strip, and lifts the r128 floor). A save from a newer scope is refused like a newer `SAVE_VERSION` (`world/loadScope.ts`).

### 4.12 Autosave triggers and the critical path (canon §3.15)

| Priority | Triggers | Path |
|---|---|---|
| Critical | `visibilitychange → hidden`, `pagehide`, death, respawn | Inside the handler: synchronous serialise into a reused ByteWriter, CRC, raw write in one transaction on the open connection, `tx.commit()`. ≤ 4 ms on low |
| High (≤ 1 s) | Shop, dock or build confirm; hull damage; Rim arrival; `vite:preloadError` (save, await commit ≤ 1 s, then one sessionStorage-guarded reload) | Serialise, `CompressionStream('deflate-raw')`, write |
| Routine | Every 30 s while dirty (a running factory is dirty) | Same as High |

One compressed write is in flight at a time and later requests coalesce. A critical save never waits; a monotonic seq lets the newest write win. `persist()` is requested after the first save.

### 4.13 Boot tracking, Safe Mode, hardening, import

| Mechanism | Rule |
|---|---|
| Boot tracking | `hf-<ch>.boot = {slot, copy, phase, n}` at `load`, `migrate`, `firstTick` and `firstFrame`; cleared after 10 s of running |
| Safe Mode | Two consecutive boots die before `firstFrame` on one copy → a DOM-only screen: "Load previous copy (n min older)", "Export this save code", "New game (export first)" |
| Bounds | Lengths vs remaining bytes and canon maxima: entities ≤ 32,767, line ≤ 128 tiles, ≤ 32 runs, cargo ≤ 120, ghosts ≤ 256, lodes = 23, Depots ≤ 6, consumables ≤ 9 |
| Invariants | Conservation (02 §10.7); rebuilt grid layers without overlaps; the ledger equation; the pod in air inside the world. Failure = corrupt → other copy |
| Import dry run | Decode, migrate, invariants, then 1,200 headless ticks on a scratch World, sliced behind "Checking save…" (≤ 1.8 s for the bench fixture on low). Nothing is written before it passes |
| Fuzzing | fast-check mutates import codes; no exception may escape the decoder |

### 4.14 Build order

| Tier | Work |
|---|---|
| M0 | Grid, scope overlay, map; HFSV v0 (6 sections), critical path, 2 copies |
| MVP | v1 format + fixture, factory and AWAY sections, export/import + dry run, Import from Safari, `persist()`, locks, channel prefixes, Safe Mode, hardening, fuzzing, generation freeze |
| v1.0 | 3 slots, Hardcore, Depot/Shear/away-ledger state, v2 migration |
| post | Capacitor store; cloud save |

### 4.15 Risks
- **iOS suspends before the commit.** Mitigation: the synchronous raw path, the 10/10 device test, the 30-s cadence.
- **A CRC-valid file crashes the sim.** Mitigation: invariants and Safe Mode.
- **Full terrain arrays cost ≈ 10 KB more than diffs.** Accepted, to avoid a generator dependency.

---

## 5. Rendering

### 5.1 Scene graph

```
Scene
├─ Sky        gradient + mesa backdrop (1–2 draws)
├─ Yard       6 chunks, Rim strip, 4 Rim buildings (merged), Headframes (instanced)
├─ Mine       ≤ 16 pooled chunk meshes (visible + 1 margin); ores, back wall, hull shells merged
├─ Mounts     rails merged per chunk; instanced buckets, chutes, Lamps, Shoring
├─ Belts      tiles merged per chunk (UV-scroll chevrons, one speed)
├─ Buildings  InstancedMesh per (type, Mk, LOD) + state attribute
├─ Items      ≤ 6 InstancedMesh families
├─ Pod        body, cone, dome, flame; per-line parts + trim band (03 §8.6)
├─ FX         debris ≤ 128, sprites ≤ 384, sparks ≤ 96, halos, digits
└─ Overlay    grid, ghosts, selection, x-ray, bubbles, logistics arrows
```

World objects use `matrixAutoUpdate = false`; culling is per chunk against the ortho view.

### 5.2 Chunk meshing
- **Geometry:** greedy-merged front faces at z = +0.5; solid–air faces over −1.0…+0.5; a back wall at −1.0; 0.04 chamfer; ore and relic polyhedra (12–48 tris) with hulls.
- **Vertex (24 B):** position f32×3, normal i8×4, colour u8×4 (alpha = AO), extra u8×4. AO by the 0fps rule (1.0/0.82/0.68/0.55) with diagonal flip. Band edges from seeded noise (palettes 03 §8.3).
- **Scheduling:** nearest dirty chunks first, 1 per frame (low) or 2 (mid/high), + 4 touching the pod's 3×3 or a blast (canon §3.14). Pooled attributes, `addUpdateRange`. Budget ≤ 2 / 1 ms (brief 04: 0.038 ms per chunk on x86).

### 5.3 Instancing
- **Per-instance data:** buildings get `instanceMatrix` (on topology change) + a u8 `state` vec4 (status, Mk, anim, LED; per tick). Items, buckets and halos get a 16-B `vec4` per frame (§3.3); item colour comes from a **256 × 1 palette texture**.
- **Caps and LOD:** items 1,500 / 4,000 / 6,000 by tier (canon §3.14), farthest dropped first; 12-tri LODs above 2,000 visible.
- **Extras:** breathing, LEDs and spin run in the vertex shader. Item meshes render once at boot into a DOM icon atlas (`hf-<ch>-icons`).

### 5.4 Materials and light
- **Surface:** colour × the 3-step ramp (values 03 §8.7–8.8; smoothed in Toon, hard in Pixel Lab). Shadow maps on mid (1024²) and high (2048²), blobs on low.
- **Details:** emissive ores, Magma, LEDs and flame; one-speed belt chevrons; ghosts at 45% (red if invalid); x-ray at depth `GREATER`, 40%.
- **Underground:** `L = A(y) + (1 − A(y)) × max(bubble, lamps)`.
  - A(y) is the 64 × 1 LUT from 03 §8.8, floored at 0.35 by Bright Mines.
  - bubble = 0.95 × (1 − smoothstep(0.35R, R, d)) + 0.6 × cone(40°, 7 rows), R = 4.5 (canon §2.6).
  - lamps = max over ≤ 16 (8 on low) CPU-sorted lights: Lamp r 3.5, Magma r 2, working machine r 1.5.
  - Back wall × 0.75.

### 5.5 Outlines
- **Toon:** inverted hull, 1.5 px × render scale in clip space. A second instanced draw per family; ore hulls merged into chunks; terrain uses the chamfer.
- **Scope:** production low = pod + selected, mid/high add buildings, ores and relics. The style test outlines everything in both looks (canon §5.1).
- **Pixel Lab:** the §5.7 edge pass with 03 §9.3 thresholds and colours, terrain included.

### 5.6 Context loss
`webglcontextlost` → `preventDefault`, the `ctxlost` reason, "Restoring graphics…". On restore, everything is rebuilt from CPU data (renderer, canvas, materials, LUTs, map, instances, visible chunks) in ≤ 500 ms on mid; `setLook()` reuses the path. Three losses within 60 s drop a tier.

### 5.7 The two looks (canon §5.1 contract)
**Pixel Lab pass order** (no blended draw ever targets an MRT target):

| # | Pass | Target |
|---|---|---|
| 1 | Opaque and alpha-tested | `RT_A`: colour + normal RGBA8 (`count: 2`) + `DepthTexture` |
| 2 | Edge pass: reads RT_A, writes outlined colour and `gl_FragDepth` copied from RT_A | `RT_B`: RGBA8 + its own depth |
| 3 | Transparent and additive (halos, particles, ghosts, x-ray), `depthWrite: false` | `RT_B` |
| 4 | Nearest blit, offset by the sub-texel remainder in whole device px | Canvas, native DPR, no AA |

- **Depth is copied, not shared:** sampling an attached texture is a WebGL2 feedback loop, and `OES_draw_buffers_indexed` is unverified on iOS.
- **RT size** = ⌈W·DPR/k⌉ × ⌈H·DPR/k⌉ + 2-texel margin, fixed per viewport; k = round(DPR × face_pt / 30), face_pt = ppu × cos 20°.
- **Snapping:** zoom snaps to whole RT px per tile face; the camera snaps to texels; yaw/pitch quantise to 2.5° in the blend.

| Device | k | px per face | RT | Pixel Lab | Toon, DPR 2 (test) | Toon, DPR 1.5 (mid) |
|---|---|---|---|---|---|---|
| SE (DPR 2, 38 ppu) | 2 | 35.7 | 377 × 669 | 13 MB | 40 MB | 23 MB |
| iPhone 15 (DPR 3, 41 ppu) | 4 | 28.9 | 297 × 641 | 28 MB | 54 MB | 30 MB |

GPU memory is our own estimate: Toon 40 B/px (MSAA colour + depth, 2 swap buffers); Pixel Lab canvas 8 B/px; RTs 20 B/px.

**Switching**
- **M0 A/B chip** (44 pt; no three-finger tap): the context is `antialias: false`. Toon renders to an MSAA-4 target at DPR min(device, 2) and blits. Both pipelines stay compiled and resident (est. 49 / 76 MB), so a flip takes ≤ 1 frame.
- **Timed A-B-A-B segments** start through the production path, so logged costs equal production.
- **Production:** settings only. `setLook()` rebuilds via §5.6 (≤ 500 ms) with `antialias: look === 'toon'`. A kept Retro filter must cost ≤ 5% frame time (canon §7 #4).

### 5.8 Quality tiers

| | Low | Mid | High |
|---|---|---|---|
| DPR cap (floor) | 1.0–1.25 (0.75) | 1.5 (0.9) | 2.0 (1.2) |
| Shadows / glow | Blob / halos | 1024² / halos | 2048² / half-res bloom |
| Lamps; particles / items | 8; 250 / 1,500 | 16; 500 / 4,000 | 16; 900 / 6,000 |
| LOD0 within | 0.5 screen | 1 screen | 1.5 screens |

- **Defaults** (canon §3.14): iOS mid; Android `deviceMemory` ≤ 4 low, else mid; desktop mid.
- **Title-screen benchmark** (600 frames) moves ±1 tier at the next Rim arrival: up to High at p50 submit ≤ 2.0 ms and drops ≤ 1%; down to Low at p50 > 4.5 ms or drops > 5%. Player overrides win; the style test pins the tier.
- **Dynamic resolution** (production Toon): 0.125 steps; down when ≥ 30 of 60 frames are over budget; up after 5 s under 70%; resizes ≥ 2 s apart.
- **Battery mode:** a 33-ms cadence for 3 s → 30 fps, half the particles, no idle animation.

### 5.9 Draw calls and triangles
- **Draw calls** (mid, Toon, typical): underground 27–52; surface play 61–112 (a 15–30-draw shadow pass); surface build 60–119 (overlays ≤ 8). All within canon's mid 120/200. Low stays ≤ 70 without building outlines and with blob shadows; Pixel Lab swaps hull draws for 2 passes.
- **Triangle caps:** chunk 2,000; 2×2 LOD0/LOD1 600/200; 3×3 900/300; Rim building 2,500; pod 1,500; item 12–20; ore 12–48.

### 5.10 Build order

| Tier | Work |
|---|---|
| M0 | Classic renderer, mesher, light, both looks + A/B chip + pass order, outlines, tier override, context-loss rebuild |
| MVP | Art on the picked look, factory instancing, icons, ghosts and x-ray, tier defaults + benchmark, dynamic resolution, battery mode, settings-only switch |
| v1.0 | Deep bands, boss, Hazard/Power overlays, high-tier shadows and bloom, Retro-filter check |
| post | WebGPU/TSL, 120 Hz, day–night |

### 5.11 Risks
- **Texel crawl in the blend.** Mitigation: snapping and quantisation; dither-fade if needed.
- **Hulls double the draw count.** Mitigation: tier scope; merged ore hulls.
- **The M0 dual pipeline overstates Toon memory.** Accepted; timed segments use production.

---

## 6. Input
Gestures and layouts belong to 03 §3–4 and all constants to canon §3.12. This section is the implementation.

### 6.1 Pipeline and pod mode
- **Arbiter:** Pointer Events feed one state machine per mode, emitting a per-frame `PodIntent {sx, sy, thrustHeld, digTap?}` or `BuildGesture`s. The dev keyboard (03 §3.7) emits the same intents.
- **Stick:** captured by the first `pointerdown` in the spawn zone. Value = (|d| − dead)/(R − dead), base follows past R. s_t = clamp((sy − 0.35)/0.65, 0, 1). Dig sectors are 90° with ±10° hysteresis, the 7-step engage, and s_x = 0 in Down.
- **World tap and pinch:** a world tap hit-tests ≥ 44-pt boxes and discards its stick; pinch uses canon's rule anywhere.
- **Slots and THRUST:** DOM buttons with their own capture. Explosives and beacons arm on the pod ring and fire on release; a slide > 24 pt cancels. No long-press in play.
- **One-handed:** a virtual origin at (pod x, 0.70 H); tapping a diggable neighbour digs once.
- **Release:** `pointercancel`, `lostpointercapture`, `blur` and `visibilitychange` release all controls. On the stick or THRUST, `pointercancel` also raises `interrupt`.

### 6.2 Build-mode state machine

```
IDLE    ─down p1→ PENDING (cursor at the lifted point, 44 pt above, from touch-down)
PENDING ─p2 down ≤ 120 ms, p1 moved < 10 pt→ CAMERA2
PENDING ─up < 250 ms, < 10 pt→ TAP (select / place at the lifted cell; inside a ghost = drag handle)
PENDING ─450 ms, < 10 pt→ LONGPRESS (MVP inspect; v1 rectangle select)
PENDING ─moved ≥ 10 pt→ STROKE (tool armed, ✋ Pan off) | PAN1
STROKE  ─p2 ≤ 120 ms after p1→ discard stroke → CAMERA2;  later p2 → keep ghosts → CAMERA2
CAMERA2 : pan + pinch; surface twist ≥ 30° → yaw snap ±90°;  one finger up → HOLD1 (pans until all lift)
any     ─pointercancel→ IDLE (uncommitted stroke discarded)
```

- **Rules:** only LONGPRESS leaves PENDING on time alone. A stroke's first cell is under the lifted point.
- **Aids:** loupe 88 pt, 2×, 120 pt above, on the non-dominant side; edge pan 40-pt margin, 2 → 8 tiles/s.
- **Picking and checks:** a ray–plane hit (Yard y = 0, mine z = 0). Each candidate runs the synchronous validator (02 §2.5), so red ghosts show their reason in the same frame. Rotation is ↻ or R only.

### 6.3 Browser gesture suppression
1. **Page:** `viewport-fit=cover`. `html, body` fixed with `overflow: hidden`, `overscroll-behavior: none`, and no selection, callout or tap highlight. The canvas uses `touch-action: none`.
2. **Scrollers:** sheets and trays are `[data-scroll]` with `pan-y`/`pan-x` and `overscroll-behavior: contain`.
3. **`touchmove`:** the document listener calls `preventDefault()` only outside `[data-scroll]` or at a scroller's boundary. `gesturestart`, `gesturechange` and `contextmenu` are always prevented.
4. **Safari details:** inputs ≥ 16 px; no drag zone within 24 pt of the left edge; a `pushState` "Leave HoleFactory?" guard.
5. **Clear rect:** from `visualViewport.height + offsetTop`, recomputed on resize.

### 6.4 Build order

| Tier | Work |
|---|---|
| M0 | Arbiter, stick, spawn zone, world tap, sectors, thrust, `interrupt` release, `[data-scroll]`, upright card, dev keyboard, mis-dig counter |
| MVP | Build machine, lifted point and loupe, edge pan, pinch, yaw snap, ✋ Pan, zoom buttons, slot arming, THRUST option, one-handed, handedness, control sizes |
| v1.0 | Rectangle select, multi-select, landscape and tablet zones |
| post | Gamepad |

### 6.5 Risks
- **Thrust vs down-dig ambiguity.** Mitigation: hysteresis, the 117-ms engage and the M0 mis-dig exit.
- **Edge swipes cancel the stick.** `interrupt` freezes the pod instead of dropping it.

---

## 7. UI layer

### 7.1 Architecture
- **Structure:** `#app` holds the canvas and `#ui` (`pointer-events: none`; interactive children `auto`). Preact components, `@preact/signals` state.
- **Read path:** `ui/bridge.ts` reads `app/viewModels` and writes signals at ≤ 10 Hz. Factory signals update on change at ≤ 2 Hz. UI never imports sim modules or three.
- **Write path:** `GameFacade` returns synchronous `Result`s. Error copy comes from 03 §6.2, keyed by the 02 §2.5 codes.
- **Layout:** safe-area CSS variables with canon §3.12 geometry; HUD compact formats per 03 §6.1; landscape (v1) and tablets as CSS-grid variants. The Pixel UI skin is a root class.
- **Cost rules:** animate only `transform`/`opacity`; `contain: strict` on the HUD; ≤ 10 pooled world labels; `tabular-nums`; 2 preloaded woff2 subsets (≈ 50 KB).
- **Accessibility:** real `<button>`s with labels; the canvas is `aria-hidden`; text scale 100/115% (MVP) and 130% (v1); reduced motion.

### 7.2 Build order

| Tier | Work |
|---|---|
| M0 | HUD row, control zone, ruler visual, Pump/Assay/Garage sheets, salvage card, settings, A/B chip, upright card |
| MVP | Supply Shed, Dot's office (Co-op Plans, milestones, Expansion I), cargo panel, context button, build sheet + dock band, inspect, radio cards, goal chip, install-first title, export/import |
| v1.0 | 3-slot menu, landscape rails, tablets, welcome-back card, overlay legends, 130%, VoiceOver |

### 7.3 Risks
- **Layout thrash.** Mitigation: a single signal writer; `.style` lint.
- **HUD overflow on 375 pt.** Mitigation: the overflow spec (§11.3).

---

## 8. Audio engine

### 8.1 Engine
Direction, stems and SFX designs belong to 03 §11.
- **Graph:** master → compressor (−18 dB, 3:1) → destination; buses music, ambience, sfx, ui+voice (ducking 03 §11.6).
- **Voices:** 24 (12 on low). Priority alarms > hazard tells > pod > UI > factory > ambience; the lowest is stolen first, then the oldest. Per-sound cooldowns (pickup 40 ms).
- **SFX:** ZzFX presets rendered at unlock; CC0 layers (≤ 400 KB AAC) lazy-load outside the 2.5 MB budget.
- **G1 "Kettle On" and the ending:** streamed AAC `<audio>` → MediaElementSource → depth low-pass → gain (iOS `media.volume` is read-only).
- **G2–G4 sequencer:** a 25-ms timer schedules ≤ 100 ms ahead on the AudioContext clock. 4 stems play authored 8–16-bar patterns with seeded variation; notes (ZzFX or ≤ 1 s samples) sit in a ≤ 4 MB LRU holding the current and next group; groups crossfade with equal power over 24 rows. Decoded audio ≤ 8 / 16 MB (low / mid).
- **iOS:**
  - `audioSession.type` is `'ambient'`, or `'playback'` for "Sound in silent mode", set before the context;
  - the first `pointerup`/`touchend`/`keydown` resumes, plays a silent sample and starts G1;
  - `interrupted` raises `interrupt`;
  - hidden suspends.

  Every tell is also visual (canon §4.12).

### 8.2 Build order

| Tier | Work |
|---|---|
| M0 | Unlock + 4 ZzFX SFX (dig, thrust, land, sell) on the user's iPhone |
| MVP | Buses, compressor, limiter, ≤ 20 SFX, "Kettle On" + low-pass, ambience B0–B4, voice blips, silent-mode setting |
| v1.0 | Full SFX + CC0 layers, generative G2–G4 (6 d), ambience B5–B7, Channel Zero processing, boss and ending music |

### 8.3 Risks
MediaElementSource quirks (fallback: two pre-filtered G1 files, +1.3 MB lazy); scheduler jitter (100 ms look-ahead); an aimless score (authored patterns only).

---

## 9. PWA, hosting and Capacitor

### 9.1 Manifest and head
- **Manifest:** `id: "holefactory"` (canon §3.15); `scope` = `HF_BASE`; `start_url` = `HF_BASE?src=pwa`; standalone; portrait (Android only); theme `#F2B58E`; icons 192, 512, maskable 512.
- **Head:** `apple-touch-icon`, `black-translucent` status bar, and a CSP meta (Pages sends no headers): `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'`.

### 9.2 Service worker (Workbox `generateSW`, prompt)
- **Precache:** the shell (`index.html`, initial JS/CSS, fonts, palette, core `.glb`, MVP chunks), ≤ 2.5 MB without music, debug and deep-band assets.
- **Runtime:** navigations → shell; media and deep assets `CacheFirst` in `hf-<ch>-media` (40 entries, 60 days); the debug chunk is network-only. Saves are never cached.
- **Updates:** an "Update ready" chip shows only on the Rim or in a menu. A tap runs a critical save, then `skipWaiting`, then a reload.

### 9.3 Install and iOS standalone (MVP unless noted)
- **Install-first title** outside standalone: "Install for full screen and safe saves (recommended)"; "Play in browser" is secondary.
- **Add-to-Home sheet:** auto-copies the export code in its tap; never mid-trip.
- **Import from Safari:** the first standalone launch without a save offers one-tap "Paste save" (`clipboard.readText()`), then the §4.13 dry run.
- **Also:** `persist()` after the first save; an in-app-browser banner; the upright card (no orientation lock or Fullscreen API on iPhone); the HUD below the status-bar inset. Wake Lock is a v1 nice-to-have (iOS 18.4+).

### 9.4 GitHub Pages
- **URL:** `tchebagual71/motherload` → `/motherload/`, `base: process.env.HF_BASE ?? '/motherload/'`. A public link waits for a rename or domain (canon §4.14, §7 #2); the fixed `id` keeps installs across a path change.
- **Publishing:** source = GitHub Actions; `deploy.yml` publishes the CI artifact. No `gh-pages` branch, no PR previews (canon §5.4 #21).
- **Pages behaviour** (unverifiable here): gzip only, no headers, `max-age=600`. Hence hashed names, the meta CSP and the gzip limit.
- **Asset retention:** every deploy replaces the site. `deploy.yml` reads the live `assets-manifest.json`, downloads the previous 2 releases' assets, merges them into `dist/assets/` (hashed names never collide) and writes a new manifest; assets older than 30 days drop out.
- **Visibility:** confirm the repo's visibility before M0-02; Pages on a private repo needs a paid plan.

### 9.5 Capacitor (post-launch, canon §5.4 #1)
- **Build:** `webDir: 'dist'`, `HF_BASE=/`, no service worker.
- **Plugins:** haptics (drill tick, pickup, bay full, hull hit, upgrade); status bar hidden in play; portrait lock on phones; Filesystem saves; Preferences.
- **Platforms:** iOS target 17.0 with `PrivacyInfo.xcprivacy`; Android minSdk 29 / target 36 with a WebView ≥ 121 check.
- **Stores:** "Data Not Collected", IARC PEGI 7, legal checks first (canon §4.14). `store: {}` stays empty (canon A3).

### 9.6 Build order

| Tier | Work |
|---|---|
| M0 | Manifest + `id`, icons, precache, update chip, `vite:preloadError`, build-once deploy with retention |
| MVP | `persist()`, install-first title, Add-to-Home, Import from Safari, in-app banner, CSP, locks |
| v1.0 | Wake Lock, media cache, update-chip polish |
| post | Capacitor and store submissions |

### 9.7 Risks
- **The shared origin.** Mitigation: channel prefixes now; a custom domain or Capacitor before launch.
- **Pages behaviour changes.** Mitigation: the nightly header check.

---

## 10. Performance

### 10.1 Measurement protocol (canon §3.14)
- **Runs:** 60 s of warm-up + 60 s of capture; battery ≥ 50%, unplugged, LPM off, fixed brightness; same tier and route (autopilot or bench scene); A-B-A-B-A-B, median run reported.
- **Dropped-frame rate:** the share of rAF intervals > 1.25 × the display interval (20.8 ms at 60 Hz, 41.7 ms at 30). Never raw p95 against 16.7 ms.
- **Main-thread work:** `performance.now()` around the frame body, split into input, pod, factory, render submit and UI (p50, p95). GPU is judged by dropped frames at a fixed DPR.

### 10.2 Budgets and how they are measured

| Canon §3.14 budget | Measured by |
|---|---|
| Dropped frames, main-thread p95, GPU, GPU memory, pod step, remesh, critical save | Perf Report on devices (§5.7 memory accounting); CI asserts counts and relative CPU only |
| Draw calls, triangles, items, particles | `renderer.info` and counters; Playwright per scripted view |
| JS heap (Chrome) | `performance.memory` on Android and in CI |
| iOS memory | 60-min soak, no crash or crash-loop drop; page ≤ 150 MB on low until the jetsam probe, then ≤ 60% of its kill point |
| Factory tick p95 ≤ 1.5 ms | ADR-0002; CI bench ≤ 2× baseline |
| Initial JS, first playable | size-limit (§12) |
| TTI on 4G | Perf Report marks (navigation → first frame → first input). CI logs a 6× CPU-throttled load as information only |

### 10.3 Perf Report and device set
- **Devices:** the user's iPhone(s) (canon §7 #1) and a Galaxy A15/A16 (bought if needed); BrowserStack (iOS 17 SE, iOS 26 Pro) optional once per milestone.
- **Perf Report** (Debug → Perf, or the style-test result) exports `HFP1:` + base64url(deflate-raw JSON). Contents: build, scope, look, tier, DPR; UA, renderer, `deviceMemory`, standalone, LPM; rAF histogram and dropped rate per ABAB segment; CPU split; compile ms; TTI marks; GPU-memory estimate; heap; thermal drift; save timings; jetsam result.

### 10.4 Jetsam probe (`jetsam.html`)
Allocates 10-MB steps (touching every page) of `ArrayBuffer`s or WebGL textures. It logs each total to localStorage first, so a reopened page shows the kill point. 3 runs per mode; the median goes into the Perf Report; budget = 60% of it.

### 10.5 Tier drops
- **Crash loops:** `hf-<ch>.run` holds `running` at boot, a 10-s heartbeat while visible, and `clean` on hide. Booting from `running` within 30 s of a beat means a visible death: drop a tier and toast. Hidden kills never count.
- **Ladder:** high → mid → low → low + 30 fps; never raised automatically.
- **Overload:** 20 s at the dynamic-resolution floor and still over budget also drops a tier, revertible in settings.

### 10.6 Build order

| Tier | Work |
|---|---|
| M0 | Device probe, Perf Report, jetsam probe, overlay, tier override, count asserts, size-limit |
| MVP | Defaults + benchmark, dynamic resolution, battery mode, tier drops, ADR-0002, 60-min soaks |
| v1.0 | ADR-0002 re-run, stress save, thermal sessions, memory audit, Retro-filter cost |
| post | Native thermal state; CDP trend job |

### 10.7 Risks
- **SwiftShader is not a GPU benchmark.** Mitigation: CI gates counts only.
- **Thermal throttling.** Mitigation: 60%-of-frame budgets, render-on-demand menus, the Perf Report drift line.
- **One iPhone may not represent low-tier iOS.** Mitigation: optional BrowserStack.

---

## 11. Testing strategy

### 11.1 Vitest (Node 22)

| Suite | Asserts |
|---|---|
| `pod/` | 01 §3.13 goldens; never digs in < 7 steps or upward |
| `terrain/` | 200 seeds within 3σ of 01 §4.3, **excluding cells set by post-passes 1–5**; band order independence; canon §3.2 lode rules; scripted lode, Patch, shaft, ≥ 6 Recorders, Notch present; **TERR/LODE bytes identical under m0, mvp and v1**; MVP worldgen goldens |
| `economy/` | Salvage-fee examples, debt collection, cost to max $3,887,750, Export ⌊9/10⌋ |
| `factory/` | 02 §10.11 tests 1–12 |
| Determinism | Factory golden; save at 6,000 + load + 6,000 ≡ 12,000 straight; pod replay with mid-trip builds |
| `save/` codec | Round trip; raw and deflate-raw readers; every fixture migrates; truncation and too-new refusals; bounds and invariants; fast-check import fuzzing |
| `save/` stores | With fake-indexeddb 6.2.5: a corrupt byte falls back to the other copy; the flip is atomic; quota errors surface |
| `catchUp` (v1) | Sliced ≡ one-call bytes; 02 §10.11 test 11 |
| `tools/ci` | Radio cards ≤ 90 characters, ≤ 4 per beat (canon §2.12); canon refs; registry ids and ≤ 256 items; fixtures |

- **Coverage gates** from the MVP: ≥ 85% of lines in pure modules, ≥ 90% in `save/`.
- **`check-canon-refs.mjs`:** each `canon.ts` constant names its canon section, and CI fails if that section lacks the literal value.

### 11.2 Economy bot and trip soak (`tools/bot`)
- **MVP minimal bot (≈ 2 d, canon §4.3):** the pure `World` in Node. Profiles [tune]:
  - proficient: 3 tiles per mineral, 20% think time, returns at bay-full or fuel ≤ 1.3 × climb;
  - slow-median: 5.1 tiles, 60% think, +20 s per shop, returns at fuel ≤ 1.1 × climb.

  It BFSes to value-weighted seen targets and buys from a priority list. At the scripted lode it builds drill → lift → Headframe → Smelter → Bin → Export, then adds lodes.
  - **Outputs:** PRI per phase, factory share (02 §5.6), per-trip warnings, lode-parts share, `FirstLiftDelivery` time and deaths, as CSV + `summary.json`.
  - **Checks:** P1 for A–D (canon §4.4); lode-parts ≥ 0.50 (canon §5.2); hard cap reported; no seed stuck > 10 game-min.
  - **Cadence:** ≈ 1 min per seed per 4 game-hours; nightly 50 seeds × 2 profiles; 5 × 1 h on `economy` PRs.
- **Trip soak (MVP, nightly):** 2 game-hours with the factory running. It asserts conservation every tick, the ledger invariant and no soft-lock; 10-min save/load must match the straight run.
- **v1 full bot:** strategy search and dashboard; full depth; minimum-factory (pod-only ≥ 30% slower) and away (canon §4.3.6 #8) profiles; 90th-percentile seed; P1 A–E2; hard cap B–E2; boss arithmetic.

### 11.3 Playwright (Chromium 141 + SwiftShader)
- **Setup:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` locally (never `playwright install`); `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`; specs run on `vite preview` of the CI `dist/`.
- **Test API:** `?seed=1&tier=low&dpr=1&test=1&look=…` loads `__hf.test` (freeze, step, teleport, give, place, hash, dump, lose context, `readRT()`, autopilot) and honours `?standalone=1`.
- **Contexts:** `serviceWorkers: 'block'` except the offline spec. The canon §3.12 matrix plus 844×390 at DSF 1, and one DSF 2 shot per look.
- **CDP:** safe-area overrides (SE 20/0, 390×844 47/34, 393×852 59/34, 412×915 24/16; others 03 §1.2) and two-point `Input.dispatchTouchEvent`.

| Tier | Specs |
|---|---|
| M0 | Boot (no errors, fuel 6/10, $20) and screenshots in both looks; context loss → same state hash; save reload; draw-call and triangle caps; rotation → upright card, `interrupt`, resume gate |
| MVP | Touch-path trip; pad re-arm (sheet stays closed 1 s; respawn disarmed); build gestures (120-ms grace, 200-ms tap, no pinch-painting, ✋ Pan); sheet scroll at 375×667; HUD overflow at 100/115% with max values; interruption mid-fall → 0 HP; save-kill keeps hull damage; "Paste save" and corrupt-code rejection; offline PWA; quota toast |
| v1 | Away card (mocked clock), Depot, Shear, boss smoke, landscape/tablet and 130% shots, 3 slots |

### 11.4 Visual regression
- **Baselines come only from CI,** in the pinned `mcr.microsoft.com/playwright:v1.56.1-noble` image; local runs use `--update-snapshots=none`.
- **`update-snapshots.yml`** (manual, from M0) regenerates them there and pushes with a GitHub App token (`GITHUB_TOKEN` pushes don't trigger CI), or uploads the PNGs.
- **Views:** surface play, underground r50, hazard strip, surface build; frozen time.
- **Thresholds:** Toon canvas 0.005 / 0.15; Pixel Lab RT_B via `readRT()` 0.01 / 0.2, plus one DSF 2 shot; DOM 0.01 with masked text.

### 11.5 WebKit smoke (CI only, required from M0)
Boot, a scripted trip, save → reload hash equality, the pod replay golden, and DOM-only shots at 375×667 and 393×852. There are no WebGL pixel compares (canvas checks become `fixme` without WebGL2). It catches JavaScriptCore, IDB, pointer and CSS gaps before the phone does.

### 11.6 Real-device checklist (each milestone exit and mid-MVP)
- [ ] §10.1 runs per look with Perf Report codes; jetsam probe 3× per mode.
- [ ] Safari tab and Home Screen; safe areas; Dynamic Island; iOS 26 floating toolbar clear of controls.
- [ ] Audio unlock; silent switch in both settings; recovery after a call.
- [ ] Call banner mid-fall, Control Center mid-thrust, rotate mid-flight: 0 HP each.
- [ ] Hull damage + home-swipe within 200 ms + kill: persists 10/10. A force-kill mid-trip loses ≤ 30 s.
- [ ] Airplane-mode cold launch; 10 min behind a heavy app; LPM → battery mode.
- [ ] Safari export → "Paste save" in the installed app.
- [ ] MVP and later: 60-min soak on both devices; playtest metrics for the canon §5.2 UX exits.

### 11.7 Build order

| Tier | Work |
|---|---|
| M0 | Pod, terrain (scope identity) and economy suites; M0 specs; snapshot workflow; `webkit-smoke` |
| MVP | Factory suites, goldens, fixtures, store tests, fuzzing, coverage gates, minimal bot, trip soak, MVP specs |
| v1.0 | `catchUp` tests, full bot, v1 specs |

### 11.8 Risks
- **Flaky screenshots.** Mitigation: CI-only baselines, frozen time, RT readback.
- **Bot ≠ human.** The bot is a PRI source and regression band; humans own the UX exits. Linux WebKit is not iOS; the device checklist owns iOS.

---

## 12. CI/CD

### 12.1 Workflows
Third-party actions are pinned by SHA.

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | PR, push to `main` | **lint:** eslint, prettier, radio-card lint, canon refs. **typecheck:** `tsc -b`. **unit:** Vitest, with coverage from the MVP. **build (once):** `HF_BASE=/motherload/ VITE_CHANNEL=prod VITE_HF_SCOPE=<milestone>`; size-limit (≤ 350 KB br and 430 KB gzip; precache ≤ 2.5 MB); fixture and registry checks; upload `dist/`. **e2e:** pinned image, against that `dist/`, 2 shards + `webkit-smoke`. **bench:** fails above 2× baseline |
| `deploy.yml` | `ci` green on `main` | The **same** `dist/`; asset retention (§9.4); `upload-pages-artifact` + `deploy-pages`; concurrency group `pages` |
| `nightly.yml` | 03:17 UTC | Bot, trip soak, Pages header check |
| `update-snapshots.yml` | Manual | §11.4 |

- **Scope:** `vite.config.ts` fails unless `VITE_HF_SCOPE ∈ {m0, mvp, v1}` (an unprefixed variable arrives as `undefined`). `config/scope.ts` maps each ledger row to its tier (`enabled(row)`), and the static value tree-shakes out-of-scope code. `HF_BASE` stays Node-side.
- **Targets:** lint + typecheck + unit < 3 min; e2e < 8 min.

### 12.2 Branches and conventions
- **Trunk-based:** protected `main` requires lint, typecheck, unit, build, e2e and `webkit-smoke`; short-lived squash-merged branches; unfinished work behind default-off flags.
- **Versions:** Conventional Commits; 0.1.0 = M0, 0.5.0 = MVP, 1.0.0 = v1; the build id goes in saves and the settings footer.
- **PR checklist:** ledger row; golden-hash changes explained; save bump with fixture and migration; screenshot diffs; device check (y/n).

### 12.3 Build order

| Tier | Work |
|---|---|
| M0 | `ci.yml` (no coverage gates), `deploy.yml` with retention, `update-snapshots.yml`, `webkit-smoke` |
| MVP | Coverage gates, bench job, nightly bot and soak |
| v1.0 | Full-bot dashboards |
| post | PR previews, CDP trend, Capacitor builds |

### 12.4 Risks
- **Image drift.** Mitigation: pin the digest. Fallback: `npx playwright install --with-deps chromium webkit` on hosted runners, with baselines regenerated once.
- **The live site is unreachable at deploy.** The deploy fails closed (`deploy-pages` is atomic); re-run.

---

## 13. Developer tooling

### 13.1 Tools
- **Debug menu** (`?debug=1` or 5 taps on the version label; lazy):
  - world: seed, teleport, reveal, demo strip (M0), Shear trigger (v1);
  - pod: cash, tiers, consumables, item givers, god mode, kill;
  - time: scale 0.25–16×, factory pause and step, simulated away (v1);
  - render: look, tier, camera A/B (fixed, perspective FOV 20° M0-only), force context loss, wireframe, chunk bounds;
  - perf: overlay, Perf Report, jetsam result;
  - data: hashes, dump/load save, input record/replay, and the bug bundle (build, device, tier, 500 log lines, save code, last 2,000 commands).

  Saves after cheats carry `ASSISTED_DEBUG`.
- **Flags** (`config/flags.ts`, `?ff=a,-b`, persisted): `DEEP_HEAT` (off), `SIM_NO_SLEEP`, `CAMERA_FIXED`, `CAMERA_PERSPECTIVE` (M0 only), `RETURN_TICK_MODE`, `LANDING_ASSIST`, `STEADY_DRILL`. Removed: `WEBGPU`, `HAPTIC_SWITCH_HACK`. `config/scope.ts` is the only scope gate.
- **Logging:** `log(channel, level, msg)` into 500-entry rings; production prints warn+ only with `?debug=1`. No remote telemetry; playtest metrics leave through the bug bundle or the Perf Report.

### 13.2 Build order

| Tier | Work |
|---|---|
| M0 | Menu basics, overlay, Perf Report, jetsam page, flags, scope, logger |
| MVP | Givers, reveal, replay, bug bundle, factory stepping, metrics export |
| v1.0 | Shear, away and boss tools |

### 13.3 Risks
Debug code leaking into production (dynamic import, size-limit); cheated saves (`ASSISTED_DEBUG`).

---

## 14. Engineering task breakdown
- **Estimates are relative sizes for planning, not commitments:** engineer-days (d), tests included.
- **Tracks (Tr):** S = sim, persistence, tools; R = render, platform, UI. Capacity = 2 tracks × 5 d/week; one engineer doubles every calendar figure.
- **Counting:** procedural art and the M0 tuning days are counted; script, music and SFX design are not.
- **Ledger** = the canon §5.5 tier of the row a task implements. Unprefixed ids in "Depends" belong to the same table. Checks: `scratchpad/rev2/tasks04.py`.

### 14.1 M0 — Style & Feel Test (canon §5.1)

| ID | Task | d | Tr | Depends | Ledger |
|---|---|---|---|---|---|
| M0-01 | Scaffold, 4 TS projects, `tsc -b`, `npm ci`, lint | 1 | S | — | M0 |
| M0-02 | CI build-once; deploy with retention | 1.5 | R | 01 | M0 |
| M0-03 | Playwright harness, CDP helpers | 1 | R | 01 | M0 |
| M0-04 | Shared core, `canon.ts` + refs check | 1 | S | 01 | M0 |
| M0-05 | Full generator, scope overlay, identity tests | 2 | S | 04 | M0; M0 only |
| M0-06 | Renderer bootstrap, context-loss skeleton | 1 | R | 01 | M0 |
| M0-07 | Device probe (`bench.html`) + Perf Report | 1 | S | 06 | M0 |
| M0-08 | GLSL materials, hulls | 1.5 | R | 06 | M0 |
| M0-09 | Chunk mesher | 1.5 | R | 05, 08 | M0 |
| M0-10 | Yard diorama | 1 | R | 08 | M0 |
| M0-11 | `TransportLine` demo + lift stub | 1 | S | 04, 10 | M0 |
| M0-12 | Pixel Lab passes, A/B chip, `setLook` | 2.5 | R | 08 | M0 |
| M0-13 | Camera, visibility check, perspective A/B | 1.5 | R | 06 | M0; M0 only |
| M0-14 | Input, TimeController, `interrupt`, upright card | 2 | S | 01 | M0 |
| M0-15 | Pod sim, goldens, replay recorder | 2.5 | S | 05, 14 | M0 |
| M0-16 | Rim services, pad arming, salvage | 1.5 | S | 15 | M0 |
| M0-17 | HUD, control zone, sheets | 1.5 | S | 16 | M0→MVP |
| M0-18 | Save v0, critical path | 1 | S | 04, 15 | M0→MVP→v1 |
| M0-19 | Hazard and explosives strip | 0.75 | S | 08, 15 | M0→MVP |
| M0-20 | Ghosts | 0.5 | R | 10, 13 | M0 |
| M0-21 | Debug menu, tier override, flags, logger | 0.75 | S | 06, 13 | M0 |
| M0-22 | Audio unlock + 4 ZzFX SFX | 0.5 | R | 14 | M0→MVP→v1 |
| M0-23 | PWA, `vite:preloadError` | 1 | R | 02 | M0 |
| M0-24 | E2E M0 specs, both looks | 1 | R | 03, 12, 18, 25 | M0 |
| M0-25 | `update-snapshots.yml`; CI-only baselines | 0.25 | R | 02, 03 | M0 |
| M0-26 | `webkit-smoke` | 0.5 | S | 03, 15, 18 | M0 |
| M0-27 | Jetsam probe | 0.25 | S | 07 | M0 |
| M0-28 | Gallery, questionnaire, result code | 1.5 | R | 07, 12, 17 | M0 |
| M0-29 | Look tuning, 1 d per look (ADR-0003) | 2 | S+R | 28 | M0 |
| M0-30 | Device round; user picks the look | 2 | S+R | all | M0 |

**M0 = 37 d** (S 18.75, R 18.25) against 30 d in canon's ≈ 3 weeks: **−7 d (−23%) of slack**.
- **Load, not sequence:** the critical path (01 → 04 → 05 → 15 → 16 → 17 → 28 → 29 → 30) is 15 d.
- **Fix:** a third contributor in weeks 1–2, or ≈ 3.7 weeks. Exit-safe spill to MVP week 1: M0-20, M0-21 extras, M0-18 routine triggers (≈ 2.5 d).

### 14.2 MVP vertical slice (canon §5.2)

| ID | Task | d | Tr | Depends | Ledger |
|---|---|---|---|---|---|
| MVP-01 | Passes 1, 2, 5, 6; freeze; MVP overlays | 1.75 | S | M0-05 | MVP; MVP only |
| MVP-02 | Lines t1–t5, scanners, parts | 2 | S | M0-16, 09 | MVP |
| MVP-03 | Consumables, ring arming | 2 | S | 01, 07 | MVP |
| MVP-04 | Radio cards, beats, U0–U3, logs, milestones | 3 | S | 02, 09 | MVP |
| MVP-05 | Fee, debt, Credit, assists, Deep Heat | 1.5 | S | 02 | MVP |
| MVP-06 | Factory in the World loop; away sleep | 0.5 | S | M0-11, M0-15 | MVP→v1 |
| MVP-07 | Factory core, grid port, serialisers | 2.5 | S | 06 | MVP |
| MVP-08 | Transport lines | 2.5 | S | 07 | MVP |
| MVP-09 | MVP nodes, Stockpile | 3 | S | 08 | MVP |
| MVP-10 | Drill, lift, `FirstLiftDelivery` | 2 | S | 09 | MVP |
| MVP-11 | Validation, ghosts, anchored cells | 2.5 | S | 01, 07 | MVP |
| MVP-12 | Undo/redo, deconstruct | 2 | S | 11 | MVP |
| MVP-13 | Stockpile commands, Starter Kit | 1 | S | 09 | MVP |
| MVP-14 | Determinism suite | 1.5 | S | 10, 15 | MVP |
| MVP-15 | Save v1, import dry run, hardening | 2.5 | S | M0-18, 10, 13 | M0→MVP→v1 |
| MVP-16 | Minimal economy bot (R8) | 2 | S | 02, 05, 10, 13 | MVP→v1 |
| MVP-17 | ADR-0002 bench (week 3) | 1.5 | S | 10 | MVP→v1 |
| MVP-18 | Trip soak | 1 | S | 16 | MVP→v1 |
| MVP-19 | Boot tracking + Safe Mode | 0.5 | S | 15 | M0→MVP→v1 |
| MVP-20 | Art pass B0–B4 | 3 | R | M0-30 | MVP→v1 |
| MVP-21 | Asset pipeline, MVP models | 3 | R | 20 | MVP→v1 |
| MVP-22 | Factory rendering from views | 2.5 | R | 10, 21 | MVP |
| MVP-23 | Build UX (§6.2, 03 §4) | 6 | R | M0-13, M0-20, 11 | MVP |
| MVP-24 | Build sheet, inspect, logistics overlay | 3 | R | 23 | MVP→v1 |
| MVP-25 | Underground build flow from the pod | 1 | R | 03, 11, 26 | MVP |
| MVP-26 | Shop sheets, Dot's office, Co-op Plans | 3.5 | R | 02, 13 | M0→MVP |
| MVP-27 | Onboarding beats 1–7 | 2 | R | 04, 24, 26 | MVP |
| MVP-28 | Quality tiers, dynamic res, battery | 2 | R | M0-07, M0-21 | MVP |
| MVP-29 | Tier drops; context-loss rebuild test | 1 | R | 28 | MVP |
| MVP-30 | Audio MVP | 2.5 | R | M0-22 | M0→MVP→v1 |
| MVP-31 | FX set | 2 | R | 20 | MVP→v1 |
| MVP-32 | Accessibility, handedness, one-handed | 2 | R | 23 | MVP→v1 |
| MVP-33 | Basic map | 1 | R | 01 | MVP→v1 |
| MVP-34 | E2E MVP specs | 2.5 | R | 15, 23, 39 | MVP |
| MVP-35 | Two device rounds (weeks 5, 9) | 3 | S+R | 27, 34, 36 | MVP |
| MVP-36 | Perf pass to low-tier budgets | 2 | R | 22 | MVP |
| MVP-37 | Route to surface | 1.5 | S | 11 | MVP |
| MVP-38 | Depth ruler + scrub | 1 | R | 33 | MVP→v1 |
| MVP-39 | Install-first, Import from Safari | 1 | S | 15 | M0→MVP→v1 |
| MVP-40 | Goal chip, Next Goals, trip summary | 1.5 | S | 04 | MVP |
| MVP-41 | Item-icon renderer | 1 | R | 21 | MVP |
| MVP-42 | Cargo panel + context button | 1 | S | M0-17, 02 | MVP |
| MVP-43 | Pod trim band + geometry steps | 1 | R | 20 | MVP→v1 |

**MVP = 85.25 d** (S 41.75, R 43.5) against 90 d: **+4.75 d (5%) of slack**. Critical path 19.5 d (06 → 07 → 11 → 23 → 24 → 27 → 35).
- **Cut vs rev 1:** worker host and protocol, two-phase ledgers, timing wheel, snapshot interpolation, fflate, previews, CDP job.
- **Added:** minimal bot (R8), soak, Safe Mode, 37–43; build UX 4 → 6.
- **Dependencies fixed:** 02 → 09, 04 → 09, 14 → 15, 25 → 03/26, M0-24 → M0-25.
- **M0 + MVP = 122.25 d against 120 d** (≈ 3.7 + 8.7 weeks against canon's 3 + 9).

### 14.3 v1.0 launch (canon §5.3)

| ID | Task | d | Tr | Depends | Ledger |
|---|---|---|---|---|---|
| V1-01 | Unhide rows 320–607 | 1.5 | S | MVP-01 | v1 |
| V1-02 | Methane, Sniffer tiers, breach → Damaged | 2.5 | S | 01 | v1 |
| V1-03 | Shears, Realign, report | 3.5 | S | 01, MVP-11 | v1 |
| V1-04 | t6–t7, scanners, Hardcore | 2 | S | MVP-02 | v1 |
| V1-05 | Claimant, Lockers, hoard, ending | 6 | S | 01, 04 | v1 |
| V1-06 | Remaining beats, logs, milestones | 2 | S | MVP-04 | v1 |
| V1-07 | Mk II/III, `E_HEAT`, U6–U11 | 2 | S | MVP-10 | v1 |
| V1-08 | Depot (canon §4.1) | 4 | S | 03, MVP-13 | v1 |
| V1-09 | Chute + chute mouth, Shoring, Lamp | 2 | S | 03, MVP-11 | v1 |
| V1-10 | Power, generators, Taps | 4 | S | 08, 11 | v1 |
| V1-11 | v1 buildings, Drums, Packs | 3 | S | 07 | v1 |
| V1-12 | Away budget, `catchUp`, card | 4.5 | S | 10 | v1 |
| V1-13 | Copy/paste, multi-select | 3 | S | MVP-12 | v1 |
| V1-14 | Save v2: 3 slots, Hardcore flag, migration | 1.5 | S | 08 | M0→MVP→v1 |
| V1-15 | Full bot | 4 | S | MVP-16, 12 | MVP→v1 |
| V1-16 | Yard II/III, stress, ADR re-run | 1.5 | S | 11 | MVP→v1 |
| V1-20 | Deep and boss art | 6 | R | 01 | MVP→v1 |
| V1-21 | Remaining models | 5 | R | MVP-21 | MVP→v1 |
| V1-22 | Pod visuals all lines; Garage preview | 2 | R | 04, MVP-43 | MVP→v1 |
| V1-23 | v1 overlays | 2.5 | R | 10 | MVP→v1 |
| V1-24 | Full map | 1.5 | R | MVP-33 | MVP→v1 |
| V1-25 | Landscape rails, tablets, foldables | 3 | R | MVP-24 | v1 |
| V1-26 | Accessibility complete, 130% text | 2 | R | MVP-32 | MVP→v1 |
| V1-27 | Audio v1 incl. generative G2–G4 | 6 | R | MVP-30 | M0→MVP→v1 |
| V1-28 | High tier: 2048² shadows, bloom | 1.5 | R | MVP-28 | v1 |
| V1-29 | Hardening, Retro-filter check | 2 | R | 28 | v1 |
| V1-30 | PWA polish, Wake Lock | 1 | R | MVP-39 | v1 |
| V1-31 | E2E v1 specs | 3 | R | 12, 25 | v1 |
| V1-32 | Device rounds, 8-h away test | 4 | S+R | 05, 15, 31 | v1 |
| V1-33 | Launch, credits, tag | 1.5 | R | 32 | v1 |
| V1-17 | **Conditional** (ADR-0002 failed): flow-state worker | 4 | S | MVP-17 | MVP→v1 |

**v1 = 88 d** (S 49, R 39; V1-17 excluded) against 160 d: **72 d (45%) of slack**, reserved for content integration, bot-driven balance, bug fixing and V1-17. Critical path 27 d (01 → 03 → 08 → 10 → 12 → 15 → 32 → 33). Load is ≈ 9.8 of 16 weeks, so canon's 28-week total holds.

### 14.4 Risks
- **M0 overload (−23%).** Mitigation: the spill list or a third contributor, decided at kickoff.
- **ADR-0002 fails.** V1-17 comes from v1 slack; the command API makes it a host change.
- **Late device answers (canon §7 #1).** M0-30 starts on the Galaxy and BrowserStack; only the look pick waits.
- **Bot PRI moves the economy (canon §5.6).** Re-tuning is 02 data, not engineering.
