# Economy bot report: MVP minimal bot, trip soak and ADR-0002 bench

**Status:** first measured numbers from the MVP minimal bot (04 §11.2, MVP-16), the trip soak (MVP-18) and the ADR-0002 factory bench (04 §3.4, MVP-17). The bot replaces the *provisional* PRI estimates in canon §4.3.1 only after review: these are one bot's numbers on 5 seeds, with the known biases listed in §6. Where a number disagrees with the canon, the canon stays in force until someone changes it on purpose.
**Build:** branch `mvpB-world`, MVP scope (r320 temporary Seal), 2026-10-03.
**References:** "canon §n" = `docs/design/00-canon.md`; "01 / 02 / 04 §n" = the sibling design docs.

---

## 1. How to reproduce

| What | Command | Time |
|---|---|---|
| Bot smoke (default suite) | `npx vitest run tests/unit/bot.test.ts` | ≈ 3 s |
| Bot long run (this report) | `HF_BOT=1 HF_BOT_SEEDS=7,1,2,3,4 npx vitest run tests/unit/bot.test.ts` (optional `HF_BOT_MINUTES=240`, `HF_BOT_OUT=summary.json`) | ≈ 2 min |
| Trip soak, 2 game-hours (default suite) | `npx vitest run tests/unit/soak.test.ts` (`HF_SOAK_HOURS=n` for longer) | ≈ 14 s |
| Factory bench, Node | `HF_BENCH=1 npx vitest run tests/unit/factory-bench.test.ts` | ≈ 10 s |
| Factory bench, browser | `HF_SCOPE=mvp npm run build && npx vite preview --port 5311`, then open `/bench.html` (or `node tools/bench/runBrowserBench.mjs http://localhost:5311/`) | ≈ 6 min live |

Code: `tools/bot/` (bot, pilot, planner, Yard planner, metrics, report), `tools/bench/`, `src/debug/bench*.ts`, `bench.html`.

---

## 2. What the bot is

A headless player over the **real `World`** (no rendering). Every move is a `PodIntent` through `World.step`; every trade and build is a `WorldApi` / `FactoryApi` call a player's taps reach. No teleports, debug cash or debug tiers.

**A trip:** refuel → descend (down its main shaft, falling fast and braking in time to land under 5.88 tiles/s) → dig toward the best *seen* mineral (value ÷ (steps + overhead), Dijkstra over pod moves) or deepen the main shaft (blasting Hardrock in it with Pop Charges once it has them) → turn back on the profile's rule → climb → Assay (sell, or Stockpile specimens the workshop needs) → Pump → Yard work → Garage → Supply Shed.

**Turn-back rule:** bay full, hull below the profile's floor, or fuel ≤ greed × climb + margin. "Climb" is the larger of the Return Tick (01 §3.5) and the fuel of the bot's planned way home, including the Rim drive to the Assay and Pump: the Return Tick ignores sideways routing, and a pod that obeys it literally runs dry on tortuous tunnels.

**Upgrades:** Bay 2, Drill 2, Tank 2, Engine 2, Hull 2, then Drill 3, Tank 3, Bay 3, Hull 3, Engine 3, Radiator 3, Scanner 3, Drill 4, Bay 4, Hull 4, Engine 4, Radiator 4, Tank 4, then t5s. A part-blocked tier is skipped; a cash-blocked one is saved for.

**Factory (the onboarding chain and a parts workshop):**
1. After Dot's r32 ping it goes to find the scripted lode (Tin Ear: an adjacent cell). Until the ping it ignores her shaft, as a first-time player would.
2. It claims the Starter Kit, digs the access shaft and the 2×2 drill site, places the Auto-Drill and Bucket Lift ghosts from build mode, waits by them, then climbs Dot's shaft slowly so the Lift Rail completes. It belts the Headframe to the Smelter. This leads to `FirstLiftDelivery` and the first ingot (U3).
3. **Wire:** the survey Bin makes way for an Assembler on A2. Wire goes through an overflow Router into a Wire Bin, and the surplus goes to an Export Terminal.
4. **Workshop:** Yard Expansion I, then the lossy path. Assay-Stockpiled specimens go to an intake Bin, then a Smelter, then two filter Routers that sort iron, cobalt and gold ingots into their own Bins. A Hull Plate Assembler (A3) and a parts Bin follow. The whole Yard is planned up front by a routing planner (`tools/bot/layout.ts`), which reserves every machine's unused output port so no belt boxes it in.
5. **Assembly:** a Gear Assembler (A1) feeds a Motor Assembler (A6), which also draws Hull Plates and Wire. A Circuit Assembler (A5) draws Wire and gold.
6. **Control:** each Rim visit it sets the unload filters, as a player would by tapping. The intake Bin unloads the specimen the next four upgrades need most, and the Motor and Circuit feeds run only while those parts are wanted.

**Profiles** ([tune] knobs; 01 §2.2 trip model, 04 §11.2):

| Knob | proficient | slow-median |
|---|---|---|
| Think time (paid standing still) | 20% | 60% |
| Extra seconds per shop | 3 | 20 |
| Turn back at fuel ≤ greed × climb + margin | 1.3 × + 0.4 L | 1.1 × + 0.2 L |
| Hull floor | 30% | 20% |
| Target scoring | exact, 1,400-step sight | ±60% noise, 700-step sight |
| Aimless extra digs per mineral | 0 | 3.6 |
| Landing speed / fall top speed | 4.6 / 12 tiles/s | 5.2 / 8 tiles/s |
| Pop Charges kept (from r110) | 4 | 2 |
| **Measured dug tiles per mineral** | **2.87–3.01** (target ≈ 3) | **4.48–4.95** (target ≈ 5.1) |

---

## 3. Headline results (5 seeds × 2 profiles × 4 game-hours; the proficient run stops 30 min after the Seal)

1. **PRI** (canon §4.3.1, median of the two profiles, then of the seeds): **A $416/min** (provisional 250), **B $570** (1,400), **C $2,275** (4,000), **D $4,470** (proficient only; provisional 30,000 assumes t5 gear and rows 262–395, the MVP stops at r319).
2. **`FirstLiftDelivery` ≤ 35:00 on all 10 runs:** proficient 7:53–12:36, slow-median 14:31–31:49. **Starter Kit claimed → FLD: 1:27–1:40 (proficient), 2:08–2:54 (slow-median)**, inside canon §5.2's 8 minutes.
3. **P1** (slow-median ≥ 1 fuel or hull warning per 5 trips, canon §4.4): **passes A, B and C** with 0.72 / 0.68 / 0.59 warned trips per trip. The slow-median profile never reached phase D in 4 h, so D is untested. Every warning was a fuel warning; no run took a hull warning (the bot routes around Magma and never lands hard).
4. **Factory share** (canon §4.3.2, 02 §5.6): proficient **0% / 5% / 3% / 2%** (A–D), slow-median **0% / 16% / 9%**. That is below the 8–25% MVP band for the proficient player. The bot automates only the scripted lode, and most of its Wire goes into parts rather than Export (§5.2).
5. **Lode-parts share at the last t4 purchase: 57–60% (proficient), 70–76% (slow-median)**, which meets canon §5.2's ≥ 50%.
6. **Depth (reaching r319, the last MVP row):** proficient median **2:27** (1:45, 1:52, 2:27, 3:33, 3:54), three seeds of five within the 3.5 h exit. Slow-median **does not reach it in 4 h** (deepest r223–243).
7. **Progression is parts-gated, not cash-gated:** at 4 h the proficient bot holds $325k–703k and the slow-median $89k–251k, while every run tops out at **Drill 4 Hull 4 Engine 4 Tank 3 Radiator 1 Bay 4 Scanner 3**. t5 and the Keg need Pressure Vessels and Drill Bits, which come only from Iridium lode ore, and this bot does not automate the Poor Iridium lode (§6).
8. **No soft-lock and no deaths** in the long run, and none in the 2-hour soak. Longest stall without any progress: 1:28 (proficient), 3:05 (slow-median). Longest trip: 4:44 / 11:24.

---

## 4. Tables (from `HF_BOT=1 HF_BOT_SEEDS=7,1,2,3,4`)

### 4.1 PRI by phase (pod $/min: Assay sales + incentives per minute of play in the phase)

| Phase | proficient (median of seeds) | slow-median (median of seeds) | PRI (canon §4.3.1) | Provisional |
|---|---:|---:|---:|---:|
| A | 592 | 234 | 416 | 250 |
| B | 939 | 271 | 570 | 1,400 |
| C | 3,394 | 888 | 2,275 | 4,000 |
| D | 4,470 | — | 4,470 | 30,000 |

### 4.2 Factory share and P1 by phase

| Phase | proficient share | slow-median share | proficient warned trips | slow-median warned trips | P1 (slow-median ≥ 1 per 5 trips) |
|---|---:|---:|---:|---:|---|
| A | 0% | 0% | 8/40 (0.20) | 13/18 (0.72) | pass |
| B | 5% | 16% | 6/75 (0.08) | 48/71 (0.68) | pass |
| C | 3% | 9% | 8/112 (0.07) | 48/81 (0.59) | pass |
| D | 2% | — | 0/84 (0.00) | — | — |

### 4.3 Per run

| Seed | Profile | Played | r40 | r80 | r129 | r200 | r319 (Seal) | Starter Kit → claimed | FirstLiftDelivery | ≤ 35:00 | First t3 | Lode-parts share at last t4 | Dug tiles / mineral | Trips | Deaths | Longest trip | Longest stall | Tiers D H E T R C S |
|---:|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---|
| 7 | proficient | 4:00:00 | 7:00 | 31:21 | 58:20 | 1:51:33 | 3:32:58 | 7:01 → 8:58 | 10:26 | yes | 27:13 | 59% | 2.94 | 78 | 0 | 4:39 | 1:28 | 4 4 4 3 1 4 3 |
| 7 | slow-median | 4:00:00 | 18:37 | 24:28 | 1:49:39 | 3:06:20 | — | 23:13 → 28:55 | 31:49 | yes | 59:37 | 76% | 4.66 | 34 | 0 | 11:05 | 2:46 | 4 4 4 3 1 4 3 |
| 1 | proficient | 4:00:00 | 4:30 | 25:06 | 49:07 | 1:32:50 | 3:54:27 | 6:12 → 7:44 | 9:15 | yes | 26:27 | 60% | 3.01 | 77 | 0 | 4:44 | 1:32 | 4 4 4 3 1 4 3 |
| 1 | slow-median | 4:00:00 | 13:04 | 33:08 | 1:25:10 | 2:45:30 | — | 13:49 → 16:38 | 19:13 | yes | 1:01:36 | 74% | 4.59 | 34 | 0 | 10:34 | 2:48 | 4 4 4 3 1 4 3 |
| 2 | proficient | 2:23:00 | 6:56 | 25:05 | 34:23 | 1:30:49 | 1:52:25 | 8:41 → 10:56 | 12:36 | yes | 23:59 | 57% | 2.87 | 48 | 0 | 4:23 | 1:13 | 4 4 4 3 1 4 3 |
| 2 | slow-median | 4:00:00 | 8:39 | 29:11 | 1:57:16 | 3:00:27 | — | 8:40 → 13:15 | 15:24 | yes | 55:49 | 70% | 4.95 | 34 | 0 | 11:10 | 3:05 | 4 4 4 3 1 4 3 |
| 3 | proficient | 2:16:00 | 2:43 | 22:05 | 40:12 | 1:15:22 | 1:45:22 | 4:21 → 6:14 | 7:53 | yes | 23:51 | 60% | 2.88 | 45 | 0 | 4:32 | 1:22 | 4 4 4 3 1 4 3 |
| 3 | slow-median | 4:00:00 | 7:21 | 21:47 | 1:52:26 | 2:50:06 | — | 7:22 → 12:16 | 14:59 | yes | 47:02 | 73% | 4.61 | 33 | 0 | 11:24 | 2:56 | 4 4 4 3 1 4 3 |
| 4 | proficient | 2:57:00 | 8:37 | 25:41 | 48:42 | 1:24:45 | 2:26:39 | 8:38 → 10:45 | 12:19 | yes | 24:33 | 60% | 2.89 | 63 | 0 | 4:35 | 1:19 | 4 4 4 3 1 4 3 |
| 4 | slow-median | 4:00:00 | 6:53 | 36:55 | 1:31:42 | 2:49:57 | — | 6:54 → 11:45 | 14:31 | yes | 59:51 | 74% | 4.48 | 35 | 0 | 10:37 | 2:53 | 4 4 4 3 1 4 3 |

### 4.4 Phase detail per run (minutes in phase · pod $/min · factory $/min · trips · warned trips · deaths)

| Seed | Profile | A | B | C | D |
|---:|---|---|---|---|---|
| 7 | proficient | 23 min · $510 · f $0 · 14 trips · 2 warned · 0 deaths | 35 min · $939 · f $51 · 15 trips · 4 warned · 0 deaths | 106 min · $3,394 · f $95 · 29 trips · 4 warned · 0 deaths | 75 min · $4,470 · f $72 · 20 trips · 0 warned · 0 deaths |
| 7 | slow-median | 24 min · $209 · f $0 · 5 trips · 4 warned · 0 deaths | 86 min · $297 · f $37 · 14 trips · 12 warned · 0 deaths | 130 min · $1,374 · f $94 · 15 trips · 9 warned · 0 deaths | — |
| 1 | proficient | 7 min · $664 · f $0 · 4 trips · 0 warned · 0 deaths | 43 min · $1,649 · f $47 · 20 trips · 1 warned · 0 deaths | 89 min · $3,008 · f $93 · 25 trips · 2 warned · 0 deaths | 102 min · $2,625 · f $72 · 28 trips · 0 warned · 0 deaths |
| 1 | slow-median | 32 min · $168 · f $0 · 7 trips · 6 warned · 0 deaths | 53 min · $1,115 · f $47 · 8 trips · 5 warned · 0 deaths | 155 min · $751 · f $88 · 19 trips · 9 warned · 0 deaths | — |
| 2 | proficient | 9 min · $550 · f $0 · 5 trips · 3 warned · 0 deaths | 25 min · $556 · f $25 · 11 trips · 1 warned · 0 deaths | 67 min · $2,294 · f $101 · 20 trips · 0 warned · 0 deaths | 41 min · $5,833 · f $72 · 12 trips · 0 warned · 0 deaths |
| 2 | slow-median | 10 min · $234 · f $0 · 2 trips · 2 warned · 0 deaths | 107 min · $271 · f $58 · 17 trips · 13 warned · 0 deaths | 123 min · $764 · f $83 · 15 trips · 8 warned · 0 deaths | — |
| 3 | proficient | 20 min · $592 · f $0 · 12 trips · 1 warned · 0 deaths | 20 min · $596 · f $46 · 7 trips · 0 warned · 0 deaths | 54 min · $3,663 · f $119 · 15 trips · 1 warned · 0 deaths | 41 min · $4,097 · f $72 · 11 trips · 0 warned · 0 deaths |
| 3 | slow-median | 8 min · $294 · f $0 · 2 trips · 1 warned · 0 deaths | 104 min · $192 · f $47 · 17 trips · 8 warned · 0 deaths | 128 min · $888 · f $92 · 14 trips · 13 warned · 0 deaths | — |
| 4 | proficient | 9 min · $636 · f $0 · 5 trips · 2 warned · 0 deaths | 40 min · $962 · f $62 · 22 trips · 0 warned · 0 deaths | 85 min · $3,762 · f $84 · 23 trips · 1 warned · 0 deaths | 43 min · $5,448 · f $72 · 13 trips · 0 warned · 0 deaths |
| 4 | slow-median | 8 min · $329 · f $0 · 2 trips · 0 warned · 0 deaths | 84 min · $177 · f $33 · 15 trips · 10 warned · 0 deaths | 148 min · $1,815 · f $92 · 18 trips · 9 warned · 0 deaths | — |

### 4.5 Upgrade timeline (median over the 5 seeds)

| Upgrade | proficient | slow-median |
|---|---:|---:|
| Bay 2 (Basket) | 1:44 | 6:27 |
| Drill 2 / Tank 2 | 3:50 / 4:23 | 11:37 / 12:36 |
| Engine 2 / Hull 2 | 5:55 / 8:10 | 12:36 / 40:26 |
| First t3 (Drill 3: 2 Hull Plate + 10 Wire) | 24:33 (23:51–27:13) | 59:37 (47:02–1:01:36) |
| Drill, Hull, Engine, Tank, Bay all t3 | 56:16 (51:05–1:15:46) | 2:03:38 (1:41:15–2:14:17) |
| Drill, Hull, Engine, Bay all t4 | 1:34:59 (1:25:43–1:41:35) | 3:18:09 (2:54:21–3:42:10) |
| Any t5, Tank 4 (Keg) | never | never |

01 §2.7 targets for first-time players: first t3 with parts ≤ 50:00. The proficient bot gets there at about 24 min; the slow-median bot misses it on 4 of 5 seeds (47–62 min).

---

## 5. Findings

### 5.1 PRI is lower than provisional from phase B
Phase A comes in above the provisional $250, at $416. Dot's shaft and the r40 incentive land early, and both profiles sell Tutorial Patch ore quickly. **B is 59% and C 43% below provisional.** The trip model in 01 §2.2 assumes t3 gear in B and t4 in C. In the bot, t3 arrives with the workshop, about 56 min (proficient) or 2 h (slow-median) in, so most of B is flown on t2 gear with a 15–25 L tank. Two consequences:
- Every "× PRI" factory rule (the 0.40 × PRI hard cap, RFI and MFI) is tighter in absolute dollars than 02 §5.2 assumed. Re-check the C cap with these values before content lock (canon §5.6 risk 1).
- Phase D cannot be measured meaningfully in the MVP: rows 262–319 at t4 gear, against a provisional value for t5 gear down to r395.

### 5.2 The factory share sits low for a parts-making player
The factory's dollars are Export cash plus 90% of the book value of parts the Garage consumed. Lode copper becomes Wire and mostly ends in upgrades. The Export only takes the Wire Bin's overflow, and once all t4s are bought that is a steady $72/min (8 Wire/min). With only the scripted lode automated, the share is 2–5% for the proficient player and 9–16% for the slow-median, because the slow player's pod income is lower. 02 §5.3's 14–21% shares assume 4–6 lodes exporting ingots. Treat this as a *bot* limitation, not a balance verdict: the next bot step is to automate the band-1–2 lodes (04 §11.2 "then adds lodes").

### 5.3 Fuel binds, and hull never warns
P1 passes in A–C on fuel warnings alone (slow-median: 0.59–0.72 warned trips per trip). The proficient profile's 1.3 × rule plus the routed-home estimate warns on only 0.07–0.20 of trips. No run ever dropped below 25% hull: the bot sees Magma and routes around it (or blasts the Hardrock next to it), and it lands under 5.88 tiles/s. A careless human will take Magma breaches the bot never does, so the hull side of P1 needs playtesters, or a bot profile that misjudges pockets.

### 5.4 The Jug caps the MVP's deep end
Every run stops at Tank 3 (Jug, 25 L), because the Keg needs 4 Pressure Vessels made from Iridium lode ore. From r280, a proficient round trip down the main shaft and back costs about 18 of its 25 L, which leaves seconds of digging at the frontier. That is why reaching r319 spreads from 1:45 to 3:54. canon §4.4 expects the Jug to carry most of C and the Keg to arrive with the Poor Iridium lode (r195–259). With no Iridium automation the bot shows exactly what happens to a player who skips that lode: the MVP's last 50 rows turn into a slog.

### 5.5 The onboarding chain is fast
The Starter Kit is claimed 1:30–6:00 after the lode is found, and `FirstLiftDelivery` follows the claim by 1:27–2:54. The 8-minute exit (canon §5.2) has room for a human's slower build mode. The bot spends 3 s (proficient) or 8 s (slow-median) per build-mode command; a human placing the drill, lift and Headframe from the context flow is budgeted 90 s.

---

## 6. Known biases and limits of this bot

- **One lode automated:** the scripted Copper lode only. No Hematite, Cobalt, Gold or Iridium lodes, so there is no t5 and no Keg, and the factory share reads low (§5.2, §5.4).
- **No Coolant Coil Assembler**, so the Radiator stays at t1 (the bot avoids Magma, so it never needs one).
- **Perfect knowledge of what it has seen:** it plans over every seen cell. Unseen cells are assumed to be dirt and re-checked as they come into view.
- **No consumables but Pop Charges.** No Jerrycans, Patch Kits or beacons; with no deaths, none were needed.
- **Think time is idle time standing still**, paid at cell boundaries; it is not hesitation in flight.
- **Profiles are knobs, not people.** 04 §11.8: "the bot is a PRI source and regression band; humans own the UX exits."
- **Seeds:** 5, against the 50 seeds × 2 profiles of the nightly target in 04 §11.2. Runtime is ≈ 25 s per proficient game-4 h and ≈ 8 s per slow-median one, so 50 seeds take ≈ 30 min.

---

## 7. Trip soak (MVP-18)

`tests/unit/soak.test.ts`, seed 11, proficient bot, **2 game-hours** with the factory running:

| Check | Result |
|---|---|
| Factory conservation (02 §10.7) after **every** factory tick | 144,000 ticks, all OK |
| Stockpile ledger (the Bins add up to every Stockpile count), every game-minute | 120 checks OK |
| Pod state finite (x, y, v, fuel, hull) and wallet finite and ≥ 0, every step | OK |
| Save round trip every 10 game-minutes (bytes → World → bytes) | 11 / 11 identical |
| Reloaded World fed the same intents for the next 10 s of mining ≡ straight run | 11 / 11 byte-identical |
| Soft-lock (no dig, find, sale, purchase or trip end for 10 game-minutes) | none; longest stall 1:17 |
| Play | 55 trips, deepest r319, 0 deaths, full workshop (Yard stage 3) |

---

## 8. ADR-0002 factory bench (MVP-17)

**Fixture** (`src/debug/benchFixture.ts`, shared by the Node and browser benches; built entirely through factory commands): 24 Mk I lifts in 12 Headframe pairs (feet at rows 54–500), 165 Rich Auto-Drills, 12 Yard lanes (Headframe → Smelter → A2 → Bin → Export), a 360-tile Yard loop with a merging Router, and storage rows of Mk III belts. Node: **254 entities + 2,213 belt tiles = 2,467 buildings, 9,691 items.** In the browser the survey set gives way and a stock Bin takes its place: **252 + 2,213 = 2,465 buildings, 9,863 items.**

| Run | Ticks | p50 | p95 | p99 | max | Notes |
|---|---:|---:|---:|---:|---:|---|
| Node 22, normal | 6,000 | 0.011 ms | 0.019 ms | 0.030 ms | 0.14 ms | `HF_BENCH=1` factory-bench test |
| Node, SIM_NO_SLEEP | 6,000 | 0.026 | 0.037 | 0.047 | 0.37 | every entity awake |
| Node, dense (1,160 entities) | 6,000 | 0.010 | 0.018 | 0.028 | 0.11 | |
| Node, dense + SIM_NO_SLEEP | 6,000 | 0.132 | 0.159 | 0.188 | 0.52 | the harshest variant |
| Headless Chromium 141, live loop, renderer on | 6,000 | 0.000 | 0.100 | 0.200 | 4.70 | clock step 0.1 ms, so these are quantized |
| Same, batched (30 × 200 back-to-back ticks) | 6,000 | 0.006 | 0.034 | — | 0.040 | mean 0.009 ms/tick |

Browser run: iPhone 15 emulation, SwiftShader (CPU), Toon look, low tier, 8,000 prefill + 1,200 warm-up + 6,000 timed ticks, Yard build-camera view. Frames ran at p50 50 ms / p95 83 ms (88% dropped at 60 Hz), because SwiftShader rasterises on the CPU and says nothing about a phone's GPU (04 §10.7). Main-thread work (World steps + render submit) was **0.5 / 0.8 ms** (p50 / p95). Render: 26 draw calls, 13.7k triangles. This branch's renderer does not draw factory buildings or belt items yet (MVP-22), so expect the draw calls to rise once that lands.

**Gate (p95 ≤ 1.5 ms):** passes on this desktop CPU with at least 15× headroom (live p95 0.1 ms at the clock's resolution; batched p95 0.034 ms, about 40×). The deciding run is still owed on the Galaxy A15/A16 (and the user's iPhone): open `bench.html`, wait about 6 minutes and paste back the `HFB1:` code. Mobile Safari clamps `performance.now()` to 1 ms, so on iPhones read the **batched** row; the per-tick row will show 0 / 1 ms steps.

Result code of the headless run (decode with `decodeBench` in `src/debug/bench.ts`):

```
HFB1:bZPdbuM2EIVfRZgrGyDkIUVSJHu1TYIssOs2WKfb3hW0RTuEKVHVj53NIu9e0Jbt3aK8oubM4Hw6A36HAxhKYD36UIEBzGmOQKDfxNaBgQMFAnWs0j34gwMClWt6B2ZrQ-8IjBYMLOObD8EuRI7ZzD-9xMb9kt09_ZGd79nvq4yWf4ss-L3LlnaTCn_Nsw9tG9yfbv3JDwuJIqc5Fdns08fn5Wdy7n10m32cZ19d1_vYLJjMMVvGtQ9uQcUD5Spb2a3t_EIizxPqrh3BwIffHj8_ZLPHGHfBkezrGPa2yWheJL7V0W-H1YutXJfdu4PfuGy2GtdvrovzbIaviIh3eP8wn5Psx96q8wfXzVMCbQemIBBi3IOBIcYGCPwz2uCHbymoeAQCrhn84F0PhglGYO3C8OzD6ZvRYorcN7tU4FIQ8IOrezBayYLA3jdVD-Y72HGI950PAQxNXWvfgKGcQPDbIY0S6OI4uO60xxdnq21naweGMgJ97cJZYgRs37t6HS6f7rWN3ZDu7xPMsgdDdUGg7dzWh_DsN_sejEJEAkfb1WM7lShLpcFv9gmxFQgGCbRagMGc4vlQrpFSmbxarU-Kng4TXHOqOYHa2SZJyCmfRCFFoZgkUNtXMDyXP00xAg0YiYjvZ4Jf7bB5uWHkiHICQCFUqQt5JcOiED9J4oqGHC_-ihZlUq5oqJScjuCMazah_e9UA6Y4o9Wu--L6FCrmePkHyUpeoi4JTGuauMUlP1Xkhb52C1QTIsVbsolfsQshL_NSCIWKlyUrSnnBo1LestO6pOfkijLhHWP3w-5ycc1IXRxKLlAoOtmznF-EomSC6Vs-QivGJAotBVWKicle5vq_Ezf7qott66qToaK8FFKWVGktmCJQ-b4N9tvHt7Tn1GuPdzaE9FAkgaHzttmdHhItSq4J7Ozgnmzfgxm60b3_Cw
```

---

## 9. Next steps

1. **Bot:** automate more lodes. Start with the Poor Iridium lode, which needs a straight lift shaft from r195–259 with Pop Charges, 6–7 Lift Rails, a second Headframe and an Iridium Ingot → A7 / A8 line. That unblocks t5 and the Keg, and makes phase D and the factory share meaningful.
2. **Bot:** add a careless profile, one that misjudges Magma and lands hard, so the hull side of P1 is exercised.
3. **Nightly:** 50 seeds × 2 profiles (`HF_BOT_SEEDS`), with `HF_BOT_OUT` written to CI artifacts; the soak and bench run on the same job.
4. **Device:** the ADR-0002 deciding run on the Galaxy A15/A16, plus the user's iPhone, once MVP-22 draws the factory.
