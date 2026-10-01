# 01 — HoleFactory Game Design Document (rev 2)

**Status:** design document under canon rev 2 (`docs/design/00-canon.md`), which wins on any conflict. Review outcomes are recorded once, in the canon change log (§8 there).
**Owns (canon R0b):** pod mechanics, world generation, the upgrade table, story and script, onboarding; also vision, loops, progression targets, failure and assists, milestones.
**Citations:** canon §x = `00-canon.md`; 02 = `02-factory.md` (buildings, items, all recipes incl. Pod Works, factory numbers, Away formula); 03 = `03-ux-art-audio.md` (gestures, layouts, ore codes, UI, art, audio); 04 = `04-tech-architecture.md`. Section numbers follow rev 1.
**Markers:** **[GDD]** = this document's default, user-overridable (§9). **Provisional** = analytic until the MVP bot measures it (canon §4.3). Radii are Chebyshev. "Median player" = first-time phone player on Standard.

---

## 1. Vision

### 1.1 Statement
HoleFactory is a pocket-sized push-your-luck mining game. You pilot Pip down a living cross-section of Mars, betting fuel and hull on what glints below. The tunnels you dig become the bones of a factory that lifts bulk ore home, while something at the core politely counts every bucket. Each trip fits a coffee break, and every hole keeps paying.

### 1.2 Pillars

| # | Pillar | In the build | Fails if… |
|---|---|---|---|
| P1 | **One more tile** | Fuel, hull and cargo against greed on every trip; failure costs the cargo and a fee | The slow-median bot gets < 1 fuel or hull warning per 5 trips in any phase A–E2 (canon §4.4) |
| P2 | **The hole is yours** | Dug space persists and becomes infrastructure: lifts hang in your shafts | Testers dig dedicated logistics shafts more often than they reuse pod shafts |
| P3 | **Pod finds, factory grinds** | The pod explores, excavates, discovers lodes, carries Kits, gems and relics; automation hauls bulk ore and makes parts | Factory income > 0.40 × PRI in B–E2, a pod-only run < 30% slower to the credits (canon §4.3.2), or a gem reaches the surface without the pod |
| P4 | **Cozy top, eerie depths** | Warm surface and dispatcher; deeper is quieter, stranger, more personal | Testers call the surface tense or the deep cute |
| P5 | **Thumb-sized** | Every action works with one thumb on a 375×667 portrait phone; 5–15 min sessions | Mis-digs ≥ 3% (canon §5.1) or any canon §5.2 UX exit fails |

### 1.3 Player fantasy
"I'm the new operator for a small family mining co-op on Mars, flying a scrappy dig pod. Every trip I bet fuel and hull on what's glinting below. Back home my little factory hums: lifts I hung in my own tunnels bring ore up while I dig. And somewhere near the core, something very polite is writing down everything I take."

### 1.4 Sacred vs modernised

**Sacred (2004 mechanics only):** the descend–mine–return–sell–upgrade loop; fuel as master clock with harsh failure; climbing that costs fuel and slows with mass (§3.3); limited cargo with destroy-on-full; the ten-tier geometric ladder via the original cell rule (§4.2); dig down, left and right only when grounded; six lines on the $750 → $500k ladder (+ Scanner); Hardrock, Magma, Methane and fall damage with the original formulas; emergency items far above service prices (Jerrycan $80/L vs $1/L); the $1k / $3k / $25k depth incentives, as mechanics only; the original physics and start state at 60 Hz.

| Modernised | Why |
|---|---|
| Death = cargo + salvage fee (debt if short); no reload | World and factory persist (canon §4.2) |
| Floating stick, push-to-dig, quick slots, armed pads, sign taps | Touch-first (P5; 03 §3) |
| Original story, cast and boss, triggered by HoleFactory systems | IP and tone (D6, canon §2.12) |
| Width 32 → 48, per-cell odds unchanged | Room for logistics |
| Sniffer signposts methane; Shears roll only at the Rim (v1) | Fairness; never entombs the pod |
| Lodes, lifts and Depots under income caps; capped offline (v1) | The factory request, bounded by P3 and D7 |

### 1.5 Build order
- **M0:** P1 and P5 proven: 3 full trips on the user's iPhone, mis-digs < 3%.
- **MVP:** P2–P4 visible: survey shaft → first lode automated, parts from lodes, cozy-to-uneasy beats to the r320 Seal.
- **v1.0:** all pillars, including the eerie depths, Marlow, the Surveyor and the Claimant.

### 1.6 Risks

| Risk | Mitigation |
|---|---|
| The factory becomes the real game | Income caps (canon §4.3.2); gems, relics, scattered ore pod-only; the deep frontier is pure Motherload (canon §4.1) |
| The factory feels optional | Iridium Ingots and Thorium Rods only from lodes (canon §4.3.3); pod-only ≥ 30% slower check (§5.6) |
| Cozy tone undercuts tension | Cargo loss and fee on every death; original damage numbers |

---

## 2. Loops

### 2.1 Loop stack

| Loop | Length | Core decision | Reward | Tension |
|---|---|---|---|---|
| Moment | 0.08–0.5 s per tile; a decision every 2–5 s | Which cell next? Fall or brake? Keep or discard? | Ore pop, cargo tick, a new row | Fuel bar, hull, Sniffer hiss, amber fall tint |
| Trip | 1–10 min (§2.2) | When to turn back | Haul at the Assay | Return fuel vs depth vs mass |
| Session | 5–15 min | Which upgrade? What to build? | One purchase, one factory step, a depth record | Parts ETA, cash gap |
| Meta | ≈ 6.5 h to the credits (§5.7) | Line order, lodes, Depots | Tiers, phases A–E2, beats | Gear checks: Hardrock, Magma, Methane, the Claimant |

### 2.2 The trip
1. **Prep** on the Rim: refuel, consumables, Kits.
2. **Descent** down your own shaft: falling is free; landing above 5.88 tiles/s hurts.
3. **Frontier:** dig, triage cargo, read tells.
4. **Turn back:** the Return Tick (Training default) floors the climb cost (§3.5).
5. **Ascent:** heavier cargo climbs slower and costs more.
6. **Rim arrival:** save, trip summary, Depot sessions re-armed, Shear roll (v1), Next Goals.
7. **Sell** at the Assay, **upgrade** at the Garage. v1: dock once per trip per Depot (canon §4.1).

**Trip model (provisional).** Canon §3.6 constants; review F's profiles: proficient = 3 dug tiles per mineral, 20% think time; slow-median = 5.1 tiles, 60% think, +20 s shopping. Fill = min(slots, 0.6 × hover cap ÷ E[mass]). The bot replaces these numbers (script: `scratchpad/rev2/gdd/trip.py`).

| Phase · tiers D/E/T/Bay · row | Fill | Trip min, prof.–slow | Fuel left at bay-full, prof. / slow | Slow + Deep Heat | Binding clock |
|---|---|---|---|---|---|
| A early · 1/1/1/2 · r30 | 15 | 0.8–2.5 | 23% / runs dry first | — | Fuel |
| A late · 2/1/2/2 · r45 | 15 | 0.7–2.2 | 59% / 42% | — | Fuel (greed); falls vs 10–17 HP |
| B · 3/2/3/3 · r110 | 25 | 1.2–3.3 | 65% / 51% | — | Fuel (slow, greedy); cargo |
| C, Jug · 4/4/3/4 · r200 | 40 | 1.8–4.5 | 50% / 31% | 19% | Fuel + cargo; Hardrock routing |
| C, Keg · 4/4/4/4 · r220 | 40 | 1.9–4.8 | 67% / 56% | 45% | Cargo; Hardrock routing |
| D · 5/5/5/5 · r340 | 70 | 3.3–7.8 | 62% / 52% | 33% | Hull (Magma 58R); weight |
| E1 · 6/6/6/6 · r440 | 73 | 3.9–8.7 | 76% / 71% | 60% | Hull (Methane); weight |
| E2 · 7/7/7/6 · r540 | 77 | 4.3–9.6 | 83% / 80% | 72% | Hull; weight; Deep Floor |

This is canon §4.4's shape: fuel binds while the bay outruns the tank and while the Jug carries C. P1 is enforced by the bot's warning test, not by this model.

### 2.3 The session
- **Shape:** 1–4 trips, one factory action, one purchase; ≈ 40 sessions of ~10 min to the credits.
- **Fit:** A–B trips (≤ 4.5 min) fit a 5-min session; longer trips rely on the resume gate (canon §4.5).
- **Goal chip** (MVP): one Dot-voiced line under the HUD naming one action (03 §6.2).
- **Next Goals** (MVP, every Rim arrival, ≤ 3 items): next affordable tier with its part check, a parts ETA ("Hull Plate ×5: ready in ~4 min"), the next lode or beat.
- **Trip summary** (MVP): deepest row, haul, fuel used, HP lost, time. **Welcome back** (v1): at ≥ 60 s credited away (canon §4.3.6).

### 2.4 The meta

| Phase | Rows (ft) | Median clock | Pod goals | Factory touch (02) | Beats (§7.4) | Gear check to leave |
|---|---|---|---|---|---|---|
| A | 0–59 (0–750) | 0:00–0:30 | t2 Bay, Tank, Drill | Survey shaft; scripted Copper lode automated; Wire | S0–S2, S5, S6 | Tank ≥ 15 L |
| B | 60–128 (750–1,612) | 0:30–1:10 | All t2, first t3s | Hematite (r50–64), Copper, Cobalt lodes; lossy path; Depot #1 (v1) | S3; Recorders from r76; S13, S15 (v1) | Pop Charges stocked for Hardrock |
| C | 129–261 (1,612–3,275) | 1:10–2:15 | All t3, t4 except the Keg until Iridium | Cobalt, Gold, Poor Iridium lodes; Mk II (v1); Shoring, Pod Works (v1) | S7, S8, S9; Marlow S12 (v1) | Hull ≥ t4 + Radiator ≥ t4 (one Magma breach) |
| D | 262–395 (3,275–4,950) | 2:15–3:20 | All t5; t6 Hull, Radiator | Gold/Iridium lodes; Mk III (v1); Magma Taps; more Depots | S4; S11 (MVP); S10 (v1) | Hull t5 + Radiator t5 (one Methane breach at r396) |
| E1 | 396–479 (4,950–6,000) | 3:20–4:30 | t6 everywhere | Iridium/Thorium lodes; Reactor Cores; Gas Taps | S14, S16, S17, S19–S21; Static Zone | Hull t6 + Radiator t6 |
| E2 | 480–583 (6,000–7,300) | 4:30–6:00 | t7 | Thorium ×4; gem parts | S18, S22 | Claimant loadout (§7.6) |
| Finale | 584–607 | 6:00–6:30 | The Claimant | — | Arena lines | — |

### 2.5 The first 20 minutes (MVP script)
Start (canon §3.6): $20, hull 10/10, fuel 6/10 L, Rim x 7. Every hint is a goal chip, toast or ghost thumb; no modal lasts > 3 s. Radio cards are §7.4's S-numbers. Bold numbers are canon §5.2 onboarding beats. Cash is approximate.

| Clock | Beat | Player does | Goal chip / toast / card | After |
|---|---|---|---|---|
| 0:00–0:20 | Cold open | Skippable 2 s shot: Yard, Rim, rusted Headframe over Dot's shaft; first touch spawns the stick | S0 | $20, 6 L |
| 0:20–1:00 | **1** Refuel | Onto the Pump House pad (arms), stick neutral 0.3 s → Fill → close; the disarmed pad stays shut | "Fill up at the Pump House" | $16, 10 L |
| 1:00–1:20 | First dig | Rolls off the pad; pushes down into the Tutorial Patch (x 5–11) | "Roll off the pad, then push down"; on the pad: "Paved — dig beside the pad" | — |
| 1:20–3:20 | Trip 1 | Rows 1–8 (no air, ≥ 5 bulk specimens); fills the 7-slot Satchel; the next ore crumbles | "Bay full — head up" | ≈ 3 L used |
| 3:20–3:50 | Ascent | Stick up; amber tint when falling fast | "Push up to fly" | Trip summary |
| 3:50–4:20 | **2** First sale | Assay pad → Sell all | "Sell at the Assay Office" | ≈ $400 |
| 4:20–7:40 | Trip 2 | Rows 9–20; the seeded Gold; first cavern fall (3–5 HP) | "Gold pays 8× Hematite" | ≈ $1,000 |
| 7:40–8:20 | **3** First t2 | Garage: Basket (Bay 15); the pod's trim changes | "Upgrade at the Garage" | ≈ $250 |
| 8:20–11:40 | Trip 3 | Basket on a 10-L Thimble: 20% warning; Return Tick; passing r32 fires S1 (lode marked, shaft named) | "Fuel low: the tick shows your way home" | ≈ $1,100 |
| 11:40–12:20 | Service | Refuel; repair at $15/HP | — | — |
| 12:20–16:00 | Trip 4 | Brakes down Dot's shaft; r40 → **4** S2; at the bottom (r45) Tin Ear finds the lode diagonally → **5** S5; digs B1 ore | Near the mouth: "Dot's shaft: long drop. Hold ↑ to brake" | ≈ $2,900 |
| 16:00–16:30 | Rim | Sells; Canteen (15 L) + Corkscrew; Starter Kit at the Supply Shed (5 slots, 14 mu) | "Collect your Starter Kit" | ≈ $1,400 |
| 16:30–17:30 | Access dig | Straight down at the chevrons (column x0 + 1) to r44: 45 digs, ≈ 15 s, ≈ 4 L; then the 2×2 above the lode (down, sideways, down, back) | "Dig down at the chevrons" | At the lode |

**Survey shaft handling (canon §5.6 risk).** The pod cannot dig up, so the 2×2 drill site is reached by the access dig; the shaft carries the lift.
- **Gap skim** (§3.2) stops a pod driving along the Rim from dropping into the shaft (or any 1-wide shaft).
- Within 2 tiles of the mouth, a toast teaches braking. An unbraked fall costs 7 of 10 HP: survivable, and the climb out costs ≈ 0.9 L (t1, empty).
- Falling in early fires S1, S2 and S5 on the way down; the Starter Kit is simply ready sooner.
- B1 ore in the shaft walls averages $59 per mineral against B0's $56: no meaningful shortcut.

### 2.6 Minutes 17–35: first automation to first t3

| Clock | Beat | Player does | Goal chip / card | After |
|---|---|---|---|---|
| 17:30–18:30 | **6** Drill | Build mode (pod frozen) → Auto-Drill ghost on the lode → confirm → within 2 tiles for 1.0 s | "Place the drill on the lode" | Mk I, 8 ore/min (Normal) |
| 18:30–20:00 | **6** Lift | Endpoint placement in Dot's shaft: foot at r45, top under the rusted Headframe; Foot Kit + 1 Rail; flies up past the ghosts | "Hang the lift in Dot's shaft" | Lift Mk I, H = 45 (02 §3.4) |
| 20:00–20:30 | **6** Belt | Drill output → lift foot (02 §3.4) | "Belt the drill to the lift" | — |
| 20:30–21:00 | Climb | Up the shaft past the mounts | — | Rim |
| 21:00–22:30 | **6** `FirstLiftDelivery` | Yard crane: belt Headframe → Smelter; first ore reaches the Headframe → S6 | "Belt the Headframe to the Smelter" | 6 min after pickup |
| 22:30–24:00 | **6** First Wire | First Copper Ingot unlocks Export, Router and Assembler (02 §9); Assembler on Wire | "Build an Assembler: Wire" | Wire flowing |
| 24:00–27:30 | Trip 5 | Regular trip into B2 | — | — |
| 27:30–30:00 | **6** First Hull Plate | Assay: Stockpile Hematite and Cobalt → Bin → Smelter (lossy path) → Iron + Cobalt Ingots → Hull Plate | "Stockpile iron and cobalt" | Parts from specimens |
| 30:00–33:30 | Trip 6 | Earns the t3 cash | — | ≈ $3,000 |
| 33:30–34:30 | **7** First t3 | Twin Screw: $2,000 + 2 Hull Plate + 10 Wire ("Wire 10/10 from your lode ✓") | — | Parts loop learned |

### 2.7 Onboarding acceptance (median of ≥ 5 first-time phone players)

| Step | Target |
|---|---|
| Refuel / first sale / first t2 | ≤ 1:30 / ≤ 5:00 / ≤ 10:00 |
| 500 ft / scripted lode discovered | ≤ 16:00 / ≤ 20:00 |
| Starter Kit pickup → `FirstLiftDelivery` | ≤ 8 min (canon §5.2) |
| `FirstLiftDelivery` | ≤ 35:00 (canon §5.2) |
| First Wire / first Hull Plate / first t3 with parts | ≤ 38:00 / ≤ 45:00 / ≤ 50:00 |
| Testers stuck > 60 s without a goal chip | 0 |
| Destructions in the first 20 min | ≤ 1 |

The other canon §5.2 exits (UX, soak, parts-from-lodes share) apply unchanged.

### 2.8 Build order

| Tier | Content |
|---|---|
| M0 | Trip loop only: refuel, dig, sell, cash-only t2–t3; no Dot text |
| MVP | §2.5–2.6 script: Tutorial Patch, seeded Gold, survey shaft, access chevrons, Starter Kit, goal chip, Next Goals, trip summary |
| v1 | Welcome-back card; Depot dock step; Shear roll at Rim arrival |
| Post | Push notifications |

### 2.9 Risks

| Risk | Mitigation |
|---|---|
| 17:30–22:30 is build-heavy for pod-first players | One Kit per step, ≤ 2 placements; context flow ≤ 90 s (canon §5.2); ghost thumbs |
| The lossy path confuses | Dot names Wire (S6); the goal chip names the Stockpile toggle; Next Goals shows the bill |
| Players ignore the shaft | Next Goals points at the mark; any route to r45 beside the lode discovers it |

---

## 3. The pod

### 3.1 Controls
Constants: canon §3.12 (stick, slots, arming, touch table); gestures, layouts and one-handed mode: 03 §3. Pod rules: stick_x drives; stick_y > 0.35 thrusts (canon §3.6); pushing into a diggable neighbour while grounded digs (§3.4). Default quick slots: Pop Charge, Mega Pop, Jerrycan, Patch Kit. No haptics on iOS web, so every tell is visual and audible (canon §4.12).

### 3.2 Movement
Constants: canon §3.6. Derived values and GDD rules:

| Item | Value |
|---|---|
| Horizontal accel, stock and empty | 6.9 tiles/s²; full speed in 0.65 s; Rim end to end ≈ 11 s |
| Terminal / cap | 13.5 / 16.8 tiles/s |
| Sky | 64 rows; thrust fades linearly to 0 over the top 8 [GDD] |
| **Gap skim** [GDD] | Grounded, \|v_x\| ≥ 1.5 tiles/s, stick not in the Down sector: the pod rides over a 1-wide gap. Slower, stopped or pushing Down: it drops in. |
| Belts | Do not carry the pod [GDD] |
| Collisions | Occupants block; mounts (belts, routers, lifts, chutes, Lamps, Shoring) do not (canon §3.1) |

### 3.3 Engine, weight and climb
- T_e = g(M0 + C_e), M0 = 200 mu. At m = C_e the pod only hovers; above it, full thrust only slows a fall and the HUD shows **TOO HEAVY** (discard).
- The cargo pill shows slots plus mass as % of hover cap (amber 50%, red 75%).

| Engine | hp | Cap mu | V_up | Climb at 0 / 25 / 50 / 75% cap (tiles/s) | Burn, full (L/s) | L per 100 rows at 0 / 50 / 75% |
|---|---|---|---|---|---|---|
| t1 Putter | 150 | 100 | 7.0 | 6.75 / 4.50 / 2.70 / 1.23 | 0.126 | 1.9 / 4.7 / 10.2 |
| t2 Chugger | 160 | 125 | 8.0 | 8.00 / 5.47 / 3.21 / 1.44 | 0.134 | 1.7 / 4.2 / 9.3 |
| t3 Thumper | 170 | 160 | 9.0 | 9.00 / 6.75 / 3.86 / 1.69 | 0.143 | 1.6 / 3.7 / 8.4 |
| t4 Growler | 180 | 220 | 10.5 | 10.50 / 8.74 / 4.79 / 2.03 | 0.151 | 1.4 / 3.2 / 7.4 |
| t5 Roarer | 190 | 320 | 12.0 | 12.00 / 11.57 / 6.00 / 2.45 | 0.160 | 1.3 / 2.7 / 6.5 |
| t6 Twin Roarer | 200 | 460 | 13.5 | 13.50 / 13.50 / 7.22 / 2.85 | 0.168 | 1.2 / 2.3 / 5.9 |
| t7 Thunderhead | 210 | 620 | 15.0 | 15.00 / 15.00 / 8.21 / 3.15 | 0.176 | 1.2 / 2.1 / 5.6 |

| Phase | Full bay × E[mass] | Share of that phase's engine cap |
|---|---|---|
| A–B | ≈ 1 mu per slot | Never binds |
| C | 40 × 1.59 = 64 mu | 29% of t4 |
| D | 70 × 2.58 = 181 mu | 56% of t5 |
| E1 | 120 × 3.75 = 450 mu | 98% of t6: weight caps the fill |
| E2 | 120 × 4.77 = 572 mu | 92% of t7; a full Echo Quartz load caps at 51 pieces |

### 3.4 Digging
Rules: canon §3.6 (grounded; down, left, right, never up; 7-step engage; cell clears at 37.5%; hardness 1.0).

| Cell | Result |
|---|---|
| Dirt, specimen, gem, relic | Cleared; contents to cargo, or destroyed if the bay is full ("Bay full") |
| Air | No dig; the pod moves |
| Magma / Methane | Breach (§3.6) |
| Hardrock | Refused: "clink" + sparks |
| Lode rock | Refused: "thunk"; discovered if within Scanner radius |
| Unknown seam (MVP) | Refused: "thunk"; never discovered |
| Anchored cell | Refused: "thunk", "Supports a belt — remove it first" (canon §3.3) |
| Paved Rim cell under a pad | Refused: "Paved — dig beside the pad" |
| Seal, Heartstone | Refused: dull ring |

| Drill | Steps | s/tile | L per tile (same-tier engine) | Tiles per same-tier tank |
|---|---|---|---|---|
| t1 Stub Bit | 29 | 0.483 | 0.122 | 82 |
| t2 Corkscrew | 20 | 0.333 | 0.090 | 167 |
| t3 Twin Screw | 14 | 0.233 | 0.067 | 375 |
| t4 Auger | 11 | 0.183 | 0.055 | 722 |
| t5 Grinder Bit | 8 | 0.133 | 0.043 | 1,410 |
| t6 Glasscutter | 6 | 0.100 | 0.034 | 2,976 |
| t7 Starbore | 5 | 0.083 | 0.029 | 5,102 |

### 3.5 Fuel
- **Burn** (canon §3.6): moving 0.00084 P max(s_t, |s_x|) L/s; digging 0.00168 P L/s; idle, build mode, sheets and map 0.
- **Braked descent** at ≈ 5.5 tiles/s needs s_t ≈ 0.40 empty at t1 (≈ 0.23 at t5): ≈ 0.9 L per 100 rows at t1. Free fall is free but lands for up to 8 HP.
- **Warnings** at 20 / 10 / 5%: pulse, vignette, rising beep. Fuel 0 destroys the pod.
- **By phase** (canon §4.4): fuel binds in A–B and in C until the Keg. The Keg needs 4 Pressure Vessels (Iridium, lode-only), so the Jug carries most of C (§2.2).
- **Return Tick:** marker at L_ret = Σ over the rows to the Rim of 0.00084 P × heat(r) ÷ v_climb(current load). The bar turns red below 1.25 × L_ret. It ignores digging and routing: a floor, not a promise. Example: r200, t3 engine, 50% load → 7.4 L (Jug 25 L). Setting **Training** (default) / On / Off: Training is on until the first t3 Tank or 10 trips; any assist forces it on; Hardcore forces it off (canon §4.4).
- **Deep Heat** (MVP A/B flag, off): heat(r) = min(1.5, 1 + 0.25 per 1,000 ft below 1,612 ft) on all burn: ×1.0 at r129, ×1.25 at r209, ×1.5 from r289. Adopted only if the P1 test fails.

### 3.6 Hull, damage and falls
Damage rules: canon §3.3 (Hard Landing; Magma 58R; Methane ⌊(12.5 y − 3000)/15⌋ × R once, 130R at r396 → 286R at r583; explosives never). Claimant attacks: §7.6. Hull is tracked to 0.1 HP and the HUD shows the ceiling [GDD]; warning below 25%; damage saves within 1 s.

| Unbraked fall from rest (rows) | ≤ 2.2 | 2.3–3.1 | 3.2–5.6 | 5.7–10.1 | 10.2–18.8 | 18.9–70 | > 70 |
|---|---|---|---|---|---|---|---|
| Damage (HP) | 0 | 3 | 4 | 5 | 6 | 7 | 8 |

**Gear checks: breaches survivable from full hull**

| Hull / Radiator | Magma (58R) | Methane r396 (130R) | r500 (217R) | r583 (286R) |
|---|---|---|---|---|
| t3 Boilerplate 30 / Box Fan 0.9 | 0 | 0 | 0 | 0 |
| t4 Ironclad 50 / Coil Sink 0.75 | **1** | 0 | 0 | 0 |
| t5 Bulwark 80 / Twin Coil 0.6 | 2 | **1** | 0 | 0 |
| t5 Bulwark 80 / Frost Loop 0.4 | 3 | 1 | 0 | 0 |
| t6 Bastion 120 / Frost Loop 0.4 | 5 | 2 | **1** | **1** |
| t7 Starshell 180 / Frost Loop 0.4 | 7 | 3 | 2 | 1 |
| t7 Starshell 180 / Cryo Lattice 0.2 | 15 | 6 | 4 | 3 |

### 3.7 Cargo
Canon §3.7 owns slots, discard and exclusions.

| Bay | Satchel | Basket | Trunk | Crate Rack | Wagon | Freight Hold |
|---|---|---|---|---|---|---|
| Slots | 7 | 15 | 25 | 40 | 70 | 120 |

- One slot per specimen, gem, relic, hoard item, Drum, Pack or Kit (Depot Kit 2); mass sums for thrust (Kit masses canon §4.8).
- Discard: rows expand on tap; "Discard 1"; "Discard all" on a 600-ms hold; gems and relics confirm; undo until the panel closes. The panel pauses the pod. The context button reads "Cargo" while TOO HEAVY and for 5 s after "Bay full" (03 §3.5).

### 3.8 Hazards (pod side)

| Hazard | Onset | Pod effect | Tell (visual + audio) | Counterplay |
|---|---|---|---|---|
| Hardrock | r129 | Dig refused | Chamfered silhouette; clink | Route around; Pop / Mega Pop |
| Lode rock | per lode | Dig refused; discovery | Veined 3×2; thunk + chime | Auto-Drill |
| Magma Pocket | r262 | 2 × 29R | Glow, embers, crackle; first-glow toast "Magma bites twice. Blast it cold or go around." | Avoid; blast |
| Methane Pocket | r396 | Depth-scaled × R once; clears the 3×3 except Hardrock, lode rock, Seal, anchored cells; destroys ore there; buildings Damaged (Shoring immune) | Looks like dirt. Sniffer 0–3 bars, LED, hiss (S16); Echo Sounder arrow; Deep Eye / Claimsight exact cells | Blast revealed cells; Gas Tap (v1); tank it |
| Deep Floor | r516 | No plain dirt (hazard p = 1): every dirt-looking cell is Methane | Sniffer saturates | Caverns, minerals, blasts, Claimsight, t7 tanking |
| Hard Landing | always | §3.6 | Amber tint above 5.88 tiles/s | Brake; Landing Assist |
| Cavern drop | always | Fall through air | Dark recess, no floor faces | Brake |
| Shear (v1) | after first reach of r80 | Never underground; the next descent meets shifted rows (canon §4.7) | Rim rumble; Shear Report | Re-dig from above; Shoring |
| Static Zone | r465 | Altimeter scramble only (§4.9) | Glyph flicker, static swell | Navigate by terrain |
| Overweight | m > C_e | Cannot climb | TOO HEAVY | Discard |

**Shear trap rule.** A pod climbing back through an old sheared shaft can dead-end (no digging up), but it can always reach a floor and use a beacon, or dig sideways and down. QA verifies a beacon-usable floor is reachable after every Shear outcome.

### 3.9 Consumables in use
Canon §2.7 owns prices and effects.
- ≤ 9 each; no slots or mass; kept on death. Pop, Mega, Hop and Homing are grounded-only.
- Explosives clear the 3×3 / 5×5 centred on the pod; they destroy ore and relics inside and never touch lode rock, the Seal, Heartstone, anchored cells, buildings or the pod. If the floor clears, the pod falls.
- Hop Beacon: random Rim x, +6…+14 rows; an unbraked landing is 5–6 HP (8.6–11.0 tiles/s).
- Homing Beacon: lands safely on the Pump House pad (disarmed).

### 3.10 Rim services and trip end
Canon §2.4 owns buildings, pads and arming.

| Building | Pod-side sheet content |
|---|---|
| Pump House | 5 / 10 / 25 / 50 L / Fill (buys what cash allows); Co-op Credit |
| Assay Office | Sell all; per-item Sell/Stockpile; relic captions and Recorder logs; Co-op debt line; Dot's office |
| Garage | 7 line cards: stat delta, cash and parts check ("Wire 10/10 from your lode ✓"); Repair all; tiers buyable out of order, no trade-in [GDD] |
| Supply Shed | Consumables (×1 / ×5 / to 9); Kits (buy or load from the Stockpile); Starter Kit |

- **Sign tap** [GDD reading of canon §2.4]: with the pod grounded on the Rim, a sign tap auto-drives it to the pad at full speed (normal burn) and opens the sheet on arrival, armed or not. Stick input cancels.
- **Trip end** = the first frame grounded on the Rim after any time at r ≥ 1: save, trip summary, Depot sessions re-armed, Shear roll (v1), Next Goals, Return Tick trip count +1.
- **Co-op Credit:** free 5 L when cash < $5 and fuel < 2 L, once per 10 min.

### 3.11 Destruction
Hull ≤ 0 or fuel = 0 → salvage beacon (no violence) and tow drone → 3 s card (lost cargo, fee, debt) → respawn disarmed on the Pump House pad, refuelled and repaired. The factory never pauses. Rules: §6.

### 3.12 Factory touch points (pod side)

| Touch point | Scope | Pod rule |
|---|---|---|
| Kits | MVP | Bought or loaded at the Supply Shed; underground buildings come only from Kits in cargo, built with the pod within 2 tiles of the ghost for 1.0 s (canon §4.8) |
| Excavation | MVP | Ghosts need excavated, seen cells; only the pod excavates |
| Lode discovery | MVP | Scanner radius: Tin Ear = any of the 8 neighbours [GDD] … Deep Eye 12 |
| Stockpile parts | MVP | Garage t3+ draws parts from the Stockpile |
| Lossy path | MVP | Stockpiled tier 1–4 specimens smelt 1 → 2 ingots; Iridium and Thorium only from lode ore (canon §4.3.3) |
| Depot dock | v1 | Once per trip per Depot: Drum refuel, HP-pool repair (≤ 90), bulk unload, Kits in and out; Packs enter only from cargo (canon §4.1) |
| Realign / Repair | v1 | Within 2 tiles, hold 2 s; 1 Weld Pack per Sheared or Damaged structure in the cluster, from cargo or a docked Depot's pool (canon §4.7; 02 §7.3) |
| Gas / Magma Tap Kits | v1 | On a revealed Methane cell or a Magma cell; the pod excavates around it without breaching (02 §2.4) |

### 3.13 Pod acceptance tests (Vitest golden values)
Terminal 13.50 ± 0.05 tiles/s · t1 dig 29 steps · t1/t1 litres per tile 0.1218 ± 0.001 · climb at 50% cap t1 2.70, t5 6.00, t7 8.21 (± 0.05) · landing at 5.88 tiles/s → 3 HP, terminal → 8 HP · no dig in < 7 steps, none upward · gap skim crosses at 1.5 tiles/s, drops at 1.4 · Return Tick example 7.40 ± 0.05 L · Deep Heat ×1.25 at r209.

### 3.14 Build order

| Tier | Content |
|---|---|
| M0 | §3.1–3.7 core; Pump House, Assay, Garage Drill/Engine/Tank/Bay t1–t3 (cash); salvage; Hardrock/Magma demo strip |
| MVP | Six lines t1–t5 + Tin Ear/Dowser; parts; bought consumables; relics; gap skim; Return Tick (Training); Deep Heat flag; sign tap; Co-op Credit and debt; discard rules |
| v1 | Methane + Sniffer tiers, Static Zone, Shears on shafts, Depot dock, Realign, Taps, t6–t7, Hardcore |
| Post | Extra chassis (I2), gamepad |

### 3.15 Risks

| Risk | Mitigation |
|---|---|
| Stick-up thrust vs diagonal dig | ±10° hysteresis, 117-ms engage, M0 mis-dig metric |
| Weight unreadable | % of hover cap on the cargo pill; TOO HEAVY |
| The Return Tick answers the turn-back question | Training default; floor estimate only |
| Gap skim makes shafts awkward to enter | Stop or push Down to drop in; MVP feel test |

---

## 4. World

### 4.1 Layout
Canon §3.1: mine 48 × 608; row 0 turf; diggable rows 0–583; the Seal at 584 (Notch x 46–47); the Hollow Heart 585–607 (authored, §7.6); sky 64 rows; Yard 48 × 32 (starts 48 × 8); indestructible frame beyond x 0–47.

### 4.2 Generation
Every build generates the full v1 world; scope hides content and never changes generation; generation freezes at the MVP and later changes are save migrations (canon §3.2).
1. **Seed:** u32; `sfc32`; band b (64 rows) uses `hash(seed, b)`; bands generate independently.
2. **Row 0:** turf.
3. **Cell pass, rows 1–583** (original rule; o = r + 5, H = 600, k = ⌊o/65⌋ + 2; tier index 6 Hematite … 15 Echo Quartz):
   - a. p = 1/5 mineral seed: 80% tier min(6 + rand(k), 15); 16% min(7 + rand(k), 15); 4%: if o > 80, ¼ a relic (uniform over 4), else min(8 + rand(k), 15).
   - b. Otherwise dirt. From r129 a hazard replaces it with p = 1/v, v = ⌊(H − o)/H × 15⌋ (p = 1 when v ≤ 1, i.e. r ≥ 516): r129–261 Hardrock; r262–395 Hardrock/Magma 50/50; r ≥ 396 Hardrock 50 / Magma 25 / Methane 25.
   - c. Cavern override: p = 1/3 → air.
4. **Post-passes** (canon order):

| # | Pass (rule: canon §3.2) | GDD detail |
|---|---|---|
| 1 | Tutorial Patch (rows 1–8 × x 5–11) | Air → dirt; then dirt → Hematite or Copper (seeded) until ≥ 5 bulk |
| 2 | Seeded Gold (rows 12–20, x 2–12) | Replaces a dirt or mineral cell |
| 3 | Lodes | Top row uniform so both rows lie in the range (Hematite tops 50–63; r260–324 tops ≤ 315). Scripted Copper: top r46, x0 ∈ 14–28 [GDD: keeps the access column x0 + 1 off the Garage pad] |
| 4 | Forced diggable 3×2 above each lode | Hazards there → dirt |
| 5 | Dot's survey shaft (rows 0–45 of c = x0 − 1 or x0 + 3; rusted Headframe, Bin, Smelter) | Seeded side when both are valid Headframe columns (02 §2.2); every x0 in 14–28 has one |
| 6 | ≥ 6 Lost Pod Recorders | ≥ 6 in rows 76–319 (all six MVP logs reachable) and ≥ 2 in rows 396–583; converts other relics in range first, then dirt |
| 7 | Seal and Hollow Heart | Stamp §7.6 |

5. **Validation:** 04 §11.1 (distribution tests exclude cells set by passes 1–5; identical terrain and lode bytes under every scope; scripted lode, Patch and Notch present).

### 4.3 Per-band distribution (generator expectation before post-passes)
Mineral density is a constant 13.33% of cells and air 33.3%; dirt falls from 53% (B0–B2) to 9% (B6). 80% of all value lies in B6.

| Band | Cells | Hem | Cu | Co | Au | Ir | Th | Per | FOp | Dia | EQ | Relics | Hardrock | Magma | Methane | E[$]/mineral | E[mass] | Value |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B0 | 912 | 49 | 58 | 12 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | $56 | 1.02 | $6.8k |
| B1 | 2,112 | 109 | 131 | 34 | 7 | 0.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | $59 | 1.03 | $16.5k |
| B2 | 3,120 | 109 | 131 | 135 | 31 | 5 | 0.2 | 0 | 0 | 0 | 0 | 3.3 | 0 | 0 | 0 | $223 | 1.10 | $92.9k |
| B3 | 6,384 | 151 | 181 | 186 | 186 | 108 | 26 | 4 | 0.2 | 0 | 0 | 8.4 | 362 | 0 | 0 | $445 | 1.59 | $379k |
| B4 | 6,432 | 104 | 125 | 129 | 129 | 129 | 129 | 79 | 22 | 3.5 | 0.3 | 8.4 | 283 | 283 | 0 | $2,172 | 2.58 | $1.86M |
| B5 | 4,032 | 52 | 62 | 64 | 64 | 64 | 64 | 64 | 64 | 29 | 6 | 5.2 | 324 | 162 | 162 | $14,540 | 3.75 | $7.82M |
| B6 | 4,992 | 55 | 66 | 68 | 68 | 68 | 68 | 68 | 68 | 68 | 61 | 6.8 | 1,101 | 550 | 550 | $59,057 | 4.77 | $39.3M |
| **Total** | 27,984 | 629 | 754 | 629 | 488 | 375 | 287 | 215 | 154 | 101 | 67 | 32.5 | 2,071 | 996 | 713 | — | — | **$49.5M** |

### 4.4 Strata (canon §2.5; palettes 03 §8.3, music 03 §11.2)

| Band | Rows / ft | Hazards | Story register |
|---|---|---|---|
| B0 Rust Flats | 0–19 / 0–250 | — | Dot, chatty |
| B1 Ochre Beds | 20–63 / 250–800 | — | Survey shaft; first lode |
| B2 Clay Deeps | 64–128 / 800–1,612 | — | Recorders begin |
| B3 Violet Shale | 129–261 / 1,612–3,275 | Hardrock | Channel Zero counts; Gran's notes |
| B4 Blue Basalt | 262–395 / 3,275–4,950 | + Magma | Marlow's rivalry (v1); MVP Seal |
| B5 Obsidian Hush | 396–479 / 4,950–6,000 | + Methane; Static Zone from r465 | Roster in the rock; drills read back |
| B6 Ember Mantle | 480–583 / 6,000–7,300 | Deep Floor from r516 | The Surveyor |
| B7 the Hollow Heart | 585–607 | The Claimant | Finale |

### 4.5 Minerals
Canon §2.2 owns names, values and masses; 03 §8.4 owns colour, shape and emissive codes (the cargo UI always shows shape icons). Rarity = 1 cell in N in the mineral's richest band.

| # | Mineral | Class | Value | Mass | First / common ≥ 1% (row, ft) | On map | Rarity |
|---|---|---|---|---|---|---|---|
| 1 | Hematite | bulk | $30 | 1 | r1 / r1 | 629 | 1/19 (B0) |
| 2 | Copper | bulk | $60 | 1 | r1 / r1 | 754 | 1/16 (B0) |
| 3 | Cobalt | bulk | $100 | 1 | r1 / r1 | 629 | 1/23 (B2) |
| 4 | Gold | bulk | $250 | 2 | r1 / r125 (1,562) | 488 | 1/34 (B3) |
| 5 | Iridium | bulk | $750 | 3 | r60 (750) / r190 (2,375) | 375 | 1/50 (B4) |
| 6 | Thorium | bulk | $2,000 | 4 | r125 (1,562) / r255 (3,187) | 287 | 1/50 (B4) |
| 7 | Peridot | gem | $5,000 | 6 | r190 (2,375) / r320 (4,000) | 215 | 1/63 (B5) |
| 8 | Fire Opal | gem | $20,000 | 8 | r255 (3,187) / r385 (4,812) | 154 | 1/63 (B5) |
| 9 | Diamond | gem | $100,000 | 10 | r320 (4,000) / r450 (5,625) | 101 | 1/74 (B6) |
| 10 | Echo Quartz | gem | $500,000 | 12 | r385 (4,812) / r515 (6,437) | 67 | 1/82 (B6) |

### 4.6 Relics and the hoard
Relics appear from r76 at 1 per 500 cells × ⅔ (≈ 8.1 of each per map before pass 6); mass 1; pod-only; Assay only. Sale captions show in the Assay sheet (≤ 90 characters).

| Relic | Value | Sale effect |
|---|---|---|
| Fossil Shell | $1,000 | "A fossil shell! Mars had seas once. This one's going on my windowsill." |
| Prospector's Strongbox | $5,000 | "A Deepreach strongbox. Payroll, by the weight. Finders, keepers." |
| Lost Pod Recorder | $10,000 | Plays the next Deepreach log (§7.5) |
| Sigil Tablet | $50,000 | "Those marks are chains and links. Somebody's been counting a long time." |

**Hoard** (canon §2.3; 1 slot, 1 mu each; in the Hoard Alcove): Wren's Survey Chain $250k, Brass Theodolite $350k, Deepreach Logbook $450k, Claimant Lens $750k, Heartstone Core $1.2M (sellable total $3.0M, Assay only) and the First Deed (unsellable; delivery ends the game). Carried hoard items lost on destruction re-settle in the alcove (§7.6).

### 4.7 Lodes (pod-facing)
Canon §2.9 and §3.2 own the lode rules and table; 02 §3.6 owns drills.

| Rows | Lodes | Scope | Pod notes |
|---|---|---|---|
| 0–64 | Copper (scripted, Normal, top r46); Hematite ×2 (rows 50–64) | MVP | Hematite lies below r49, so the scripted lode is found first in practice; only it grants the Starter Kit |
| 65–129 | Copper ×2, Cobalt, Kerogen | MVP; Kerogen v1 | MVP Kerogen shows as Unknown seam |
| 130–194 | Cobalt, Gold, Kerogen | MVP; Kerogen v1 | — |
| 195–259 | Gold, Iridium (Poor, fixed), Kerogen | MVP; Kerogen v1 | S9 marks the Iridium at r180: Keg and t5 parts |
| 260–324 | Gold, Iridium (tops ≤ r315) | MVP | Above the MVP Seal |
| 325–389 | Iridium, Thorium (Poor, fixed) | v1 | S10 marks the Thorium at r310 |
| 390–454 | Iridium, Thorium | v1 | — |
| 455–583 | Thorium ×4 | v1 | Reactor Cores |

- Lode rock is undrillable and unblastable. Discovery = within Scanner radius (Tin Ear: any of the 8 neighbours [GDD]); Dowser and above show purity.
- **Marks** (map only; a mark is not a discovery): Dot's pings (scripted lode at the first pass of r32; r180; r310) and, in v1, three Marlow survey marks (S12–S14), each on the nearest undiscovered metal lode below the pod's deepest row.

### 4.8 Hazards and Shears
Pod rules §3.8; damage canon §3.3. Shears (v1) follow canon §4.7: rolled at Rim arrival after first reach of r80; the first on the 4th eligible return at intensity 1, gifting 2 Weld Packs and highlighting brace slots (S15); then p = 0.10 with pity 6 (mean ≈ 5.1 eligible returns apart, simulated); none after the first Hollow Heart entry. Pod impact: shifted rows in your shafts are re-dug from above (one dig per shifted row), and hazards can slide in.

### 4.9 The Seal, the Notch and the Static Zone
- **Seal** (r584): indestructible; drills and explosives ring dull.
- **Notch** (x 46–47): found by exploration; log 6 hints "east wall".
- **MVP Seal** at r320: a collision and render overlay (canon §3.2), card S11.
- **Static Zone** (r ≥ 465, v1; mechanic only, no radio beat): HUD depth digits swap 2 of 4 glyphs at 4 Hz; the ruler marker jitters ±3 rows; the map hides the pod marker (terrain stays); radio cards carry a 30% static overlay; no physics effect. In the Hollow Heart the readout shows "DATUM 0" [GDD].

### 4.10 Persistence
Dug and blasted cells, destroyed ore, Shear offsets, discoveries and marks persist. Scattered ore, gems and relics are finite (≈ $49.5M, 13× the max-out cost); lodes are infinite and rate-capped. No renewal in v1; NG+ is post-launch (§7.7).

### 4.11 Map and visibility
- **Light:** fixed 4.5-tile bubble + 40°/7-row drill cone at 0.6 (canon §2.6); ambient floor 0.12 (Bright Mines 0.35). Deep ores are emissive and read beyond the bubble.
- **Map** (canon §3.1; UI 03 §6.6): charted cells, discovered lodes, marks, lifts (MVP); Depots, relic pings, filters (v1). Methane appears only once revealed.
- **Arena:** no map or build mode; pause allowed (canon §3.10).

### 4.12 Build order

| Tier | Content |
|---|---|
| M0 | Full generator (passes 3, 4, 7, all bands); play floor r128; debug Hardrock/Magma strip |
| MVP | Passes 1, 2, 5, 6, then generation frozen; r320 Seal overlay; Unknown seams; relics; basic map |
| v1 | Rows 320–607 in play: Methane, Deep Floor, Static Zone, Notch, Hollow Heart; Kerogen and Thorium lodes; full map |
| Post | New Claim re-roll; sky easter eggs |

### 4.13 Risks

| Risk | Mitigation |
|---|---|
| The Deep Floor (r ≥ 516) is a blast maze (46.7% open or diggable) | Claimsight, t7 tanking, the Notch at the edge; target median r516 → Notch ≤ 3 trips |
| Finite gems run out for grinders | Maxing needs ≤ ~40% of B6 value; telemetry |
| The survey shaft makes early descents easy | §2.5 handling; B1 ore ≈ B0 value |
| Pass 6 skews relic-type frequencies | Converts other relic types first; flagged for the distribution-test exclusion list |

---

## 5. Economy and progression (pod side)

### 5.1 Upgrade table
Prices, stats and names: canon §2.6; parts rules: canon §4.3.5 (incl. the ruled Keg, Scanner t7 and Drill t7 exceptions). **This table owns the counts**; recipes are 02 §4. Percentages use 02 §4.1 values (Wire $10, Hull Plate $55, Coolant Coil $60, Motor $110, Circuit $125, Drill Bit $265, Pressure Vessel (PV) $400, Reactor Core (RC) $1,500) and canon §2.8 book values for gem parts. t1–t2 are cash only.

| Line | t3 ($2,000) | t4 ($5,000) | t5 ($20,000) | t6 ($100,000) | t7 ($500,000) |
|---|---|---|---|---|---|
| Drill | 2 Hull Plate + 10 Wire · 10.5% | 6 Motor · 13.2% | 10 Drill Bit · 13.2% | 6 RC + 9 Drill Bit · 11.4% | **1 Diamond Bit + 1 RC · 20.4%** (ruled) |
| Hull | 5 Hull Plate · 13.8% | 12 Hull Plate · 13.2% | 7 PV · 14.0% | 9 RC · 13.5% | 3 Opal Plating · 12.1% |
| Engine | 2 Motor + 5 Wire · 13.5% | 5 Motor + 2 Circuit · 16.0% | 6 PV + 4 Circuit · 14.5% | 10 RC · 15.0% | 2 Opal Plating + 10 RC · 11.0% |
| Tank | 4 Hull Plate · 11.0% | **4 PV · 32%** (Keg, ruled) | 6 PV · 12.0% | 8 RC · 12.0% | 8 Lens + 6 RC · 10.0% |
| Radiator | 4 Coolant Coil · 12.0% | 10 Coolant Coil · 12.0% | 5 PV + 6 Circuit · 13.8% | 8 RC · 12.0% | 10 Lens · 10.2% |
| Bay | 3 Hull Plate + 10 Wire · 13.2% | 8 Hull Plate + 2 Motor · 13.2% | 5 PV + 4 Drill Bit · 15.3% | 7 RC + 5 PV · 12.5% | — |
| Scanner | 2 Circuit + 5 Wire · 15.0% | — | 10 Circuit + 4 Drill Bit · 11.6% | 8 RC + 6 Circuit · 12.8% | **8 Lens + 1 Opal Plating · 12.2%** (ruled) |

- Total cash to max $3,887,750. Tiers may be skipped (each tier's parts are still due); no trade-in [GDD].
- Every purchase changes the pod: geometry at t3 and t6, trim band at every tier (03 §8.6).
- **Sources:** t3–t4 Basic parts from lode ore or the lossy path (tier 1–4 specimens → 2 ingots). PV and Drill Bit (Iridium) and RC (Thorium) come only from lode ore (canon §4.3.3; fallback §5.9). Gem parts come from pod-delivered gems cut in v1 (02 §4); cut gems and gem parts are unsellable and non-exportable (canon §2.8). Echo Quartz has no cut form.

**Parts bill per tranche (all lines; ingot conversions 02 §5.4)**

| Tranche | Parts | Lode-only share |
|---|---|---|
| All t3 | Wire 30, Hull Plate 14, Coolant Coil 4, Motor 2, Circuit 2 | None: the lossy path covers it |
| All t4 | Hull Plate 20, Motor 13, Coolant Coil 10, PV 4, Circuit 2 | 4 PV (Keg) |
| All t5 | PV 29, Circuit 20, Drill Bit 18 | 47 Iridium parts |
| All t6 | RC 56, Drill Bit 9, Circuit 6, PV 5 | 56 RC (Thorium), 14 Iridium parts |
| All t7 | Lens 26, RC 17, Opal Plating 6, Diamond Bit 1 | 17 RC; gems: 26 Peridot, 6 Fire Opal, 1 Diamond |

### 5.2 Consumables
Canon §2.7 owns prices and effects. Pod Works recipes (v1) are 02 §4.4, under the canon §4.3.4 floors (inputs ≥ 40% of the shop price, ≥ 90 s; ≤ 2 Pod Works).

| Item | Price | Role |
|---|---|---|
| Jerrycan | $2,000 (+25 L) | $80/L vs $1/L at the pump: emergency only |
| Patch Kit | $7,500 (+30 HP) | $250/HP vs $15/HP; the Claimant's sustain |
| Pop Charge / Mega Pop | $2,000 / $5,000 | Through Hardrock; the Claimant's only damage |
| Hop / Homing Beacon | $2,000 / $10,000 | Escape vs a salvage fee and the cargo |

### 5.3 Cash sources and sinks

| Source | Value | Sink | Value |
|---|---|---|---|
| Assay sale | 100% | Fuel | $1/L |
| Export (factory) | 90% (02 §5) | Repair | $15/HP |
| Incentives | $1k r40 · $3k r80 · $25k r280 | Salvage | §6.2; debt from the next Assay sale |
| Relics | $1k–$50k | Yard expansions | I $2.5k (MVP); II $25k, III $250k (v1) |
| Hoard | $3.0M + the First Deed | Depot n | $2k × 3^(n−1) + parts |
| Away (v1) | ≤ 5 × PRI per rolling 24 h (canon §4.3.6) | Kits, buildings | 02 §3 |

### 5.4 Pacing principle
From phase B, cash outruns prices, as in the original: each tranche costs ≤ 11 minutes of provisional PRI. Progression is paced by (1) depth and pilot time, (2) hazard gear checks (§3.6), (3) parts throughput, chiefly lode-only Iridium and Thorium, (4) gem supply for t7. The bot must show parts, not cash, gating C–E2.

| Tranche | Cash, net of incentive | Phase | Minutes of PRI |
|---|---|---|---|
| t2 × 5 lines | $3,750 − $1,000 | A | 11.0 |
| t3 × 7 | $14,000 − $3,000 | B | 7.9 |
| t4 × 6 | $30,000 | C | 7.5 |
| t5 × 7 | $140,000 − $25,000 | D | 3.8 |
| t6 × 7 | $700,000 | E1 | 5.6 (23.3 at D) |
| t7 × 6 | $3,000,000 | E2 | 6.0 (24.0 at E1) |

### 5.5 Progression curve (median, Standard, v1; provisional)
PRI per phase: canon §4.3.1 (A $250 · B $1,400 · C $4,000 · D $30,000 · E1 $125,000 · E2 $500,000 per min, provisional). Factory income and share: 02 §5.3 under canon §4.3.2 (typical 0.15–0.30 in B–D; hard cap 0.40 × PRI in B–E2). MVP factory exit: canon §5.2 (≥ 50% of t3–t4 parts from lode ore; share 8–25% reported).

| Clock | Deepest | Phase | Tiers D H E T R C S | What paces the next step |
|---|---|---|---|---|
| 0:05 | r12 (150 ft) | A | 1 1 1 1 1 1 1 | First sale |
| 0:08 | r24 | A | 1 1 1 1 1 2 1 | Basket |
| 0:16 | r46 (575 ft) | A | 2 1 1 2 1 2 1 | Lode found; Starter Kit |
| 0:22 | r46 | A | — | `FirstLiftDelivery` |
| 0:34 | r70 | B | 3 1 1 2 1 2 1 | First t3 from lode Wire + specimen Hull Plates |
| 1:10 | r129 (1,612 ft) | C | 3 3 3 3 3 3 3 | Pop Charges; Hardrock routing |
| 1:45 | r200 | C | 4 4 4 3 4 4 3 | Keg waits on the Poor Iridium lode |
| 2:15 | r262 (3,275 ft) | D | 4 4 4 4 4 4 3 | Magma check |
| 2:45 | r320 (4,000 ft) | D | 5 5 5 5 5 5 3 | MVP end (Scanner caps at Dowser) |
| 3:20 | r396 (4,950 ft) | E1 | 5 6 5 5 6 5 5 | Methane check; Sniffer |
| 4:30 | r480 (6,000 ft) | E2 | 6 6 6 6 6 6 6 | Reactor Cores from Thorium lodes |
| 5:30 | r560 | E2 | 7 7 7 6 7 6 6 | Gem parts from pod-delivered gems |
| 6:00 | r584 | E2 | 7 7 7 7 7 6 7 | Max-out; Claimant loadout |
| 6:30 | Credits | — | — | First Deed delivered |

### 5.6 Pod-only comparison
Canon §4.3.2 requires a pod-only run ≥ 30% slower to the credits (bot, v1). Since Iridium and Thorium parts are lode-only, a literal pod-only run cannot buy the Keg or any t5+. The bot's pod-only profile is therefore the **minimum-factory profile** (02 §5.6): Auto-Drills only on Iridium and Thorium lodes, no Export, every other part from specimens. Where it should lose time:
- t3–t4: basics from specimens diverted from sale (−47% value each) and extra cargo trips.
- Keg and t5: one Poor Iridium lode, no parallel supply.
- t6: 56 Reactor Cores from a minimal Thorium setup; no Export income for Depots and power.
- E: no away income; fewer Depots.

Rev 1's analytic gap was +12.8% with the old lossy path. If the bot measures < 30%, the levers are canon §4.3.2's, in order: drill rate, lode count, purity mix, ore value; never Export prices.

### 5.7 Playtime targets
- **Credits:** median 6.5 h (acceptable 5–9 h).
- **MVP slice** to the r320 Seal: ≈ 2:45 median (canon exit: 4,000 ft ≤ 3.5 h).
- **Skilled replay:** 3–4 h. **Completion** (all lines max, Full Ledger, all 23 lodes, all milestones): 10–12 h.

### 5.8 Build order

| Tier | Content |
|---|---|
| M0 | Cash only; Drill, Engine, Tank, Bay t1–t3 |
| MVP | Six lines t1–t5 + Tin Ear/Dowser; parts from t3 up to PV; bought consumables; incentives; Expansion I; Co-op debt; minimal bot (PRI per phase, share, warnings) |
| v1 | t6–t7; Reactor Core and gem parts; Pod Works; Expansions II–III; Depots; Away budget; full bot incl. pod-only check |
| Post | Chassis; New Claim; Co-op Orders |

### 5.9 Risks

| Risk | Mitigation |
|---|---|
| Provisional PRI is off (review F: ≈ 1.2–2.3× in A–E1) | MVP bot measures it; every × PRI rule is re-checked before content lock (canon §5.6) |
| E2 PRI × the E2 phase exceeds B6's finite value | E2 income is supply-limited; the curve paces on depth and gear, not cash |
| Lode-only Iridium/Thorium walls t5–t6 or the Keg | **Fallback (R12):** Iridium and Thorium specimens smelt 1 → 1 ingot |
| Cash glut from B | Parts and gear pace; levers are part counts (±25% within canon §4.3.5), never prices |
| The lossy path becomes the default | −47% per specimen; Next Goals shows the lode alternative |

---

## 6. Failure, saving and difficulty

### 6.1 Failure

| Trigger | Warning | Result |
|---|---|---|
| Hull ≤ 0 | < 25% | Destruction |
| Fuel = 0 | 20 / 10 / 5% | Destruction |
| Bay full | "Bay full" | Mineral destroyed |
| Overweight | TOO HEAVY | No climb |

| Lost on destruction | Kept |
|---|---|
| All cargo: specimens, gems, relics, Kits, Drums, Packs; hoard items re-settle in the Hoard Alcove | Installed parts, carried consumables, terrain, factory, Depot stock, Stockpile, cash after the fee |

### 6.2 Salvage fee and Co-op debt
**Fee = max($25, round(0.08 × IPV)), always charged**, where IPV = the prices of the installed tiers over the 7 lines. It includes a full refuel and repair. If cash is short, cash drops to $0 and the rest becomes **Co-op debt**, taken from the next Assay sale(s) and shown as "−$n owed" in the Assay sheet. Parking cash in buildings or a deliberate fuel-0 death therefore gains nothing. Hardcore: fee ×2 and one random line at t ≥ 2 loses a tier.

| Loadout | IPV | Fee | Hardcore |
|---|---|---|---|
| All t1 | $0 | $25 | $50 |
| Five lines t2 | $3,750 | $300 | $600 |
| All t3 | $14,000 | $1,120 | $2,240 |
| All t4, Scanner t3 | $32,000 | $2,560 | $5,120 |
| All t5 | $140,000 | $11,200 | $22,400 |
| All t6 | $700,000 | $56,000 | $112,000 |
| Max (six t7 + Bay t6) | $3,100,000 | $248,000 | $496,000 |

### 6.3 Saving
Canon §3.15 and §4.2: resume snapshots only, so a killed app loses ≤ 30 s and undoes nothing. Every interruption returns through the `interrupt` gate (canon §4.5); the arena pause resumes after a 3 s countdown.

### 6.4 Difficulty and assists

| Option | Effect | Default | Hardcore | Scope |
|---|---|---|---|---|
| Standard | Canon rules | ✓ | — | MVP |
| Hardcore (new game, permanent) | Fee ×2; random tier loss; Return Tick off; no Finale Assist [GDD] | off | — | v1 |
| Return Tick | §3.5: Training / On / Off | Training | forced off | MVP |
| Landing Assist [GDD] | Stick neutral and falling > 5.5 tiles/s → auto-thrust holds 5.5 (normal burn) | off | allowed | MVP |
| Steady Drill [GDD] | Dig engage 7 → 12 steps | off | allowed | MVP |
| Finale Assist [GDD] | Offered after 3 failed attempts: Claimant HP ×0.6, attack damage ×0.5, tells ×1.5 | off | no | v1 |
| Accessibility | 03 §7 | off | allowed | MVP → v1 |

Any assist turns the Return Tick on and adds an "Assisted" tag to the stats card; nothing is locked. No option disables hazard damage to infrastructure (canon §7 #12).

### 6.5 Anti-softlock

| Situation | Way out |
|---|---|
| Broke and dry on the Rim | Co-op Credit (5 L); or destruction: the fee becomes debt and includes refuel and repair |
| Missing basic parts | Lossy path (tiers 1–4) |
| Missing Iridium or Thorium | Dot marks the fixed Poor lodes; fallback §5.9 |
| Below a Shear offset | Reach a floor; Hop or Homing Beacon; or destruction |
| No Weld Packs after a Shear (v1) | The first report gifts 2; the Supply Shed sells them |
| Hoard lost | Re-settles; the Claimant re-forms at 750 HP |
| Arena exit | Fight resets; only consumables used are lost |

### 6.6 Build order

| Tier | Content |
|---|---|
| M0 | Destruction → salvage → respawn; basic snapshot |
| MVP | Fee and Co-op debt; Return Tick Training; Landing Assist; Steady Drill; Co-op Credit; `interrupt` gate |
| v1 | Hardcore; Finale Assist; full accessibility; 3 slots |
| Post | Cloud save |

### 6.7 Risks

| Risk | Mitigation |
|---|---|
| An 8% fee feels toothless late | The cargo is the real penalty (a lost E bay ≈ $1–2M); Hardcore for bite |
| Debt feels punitive when broke | It includes refuel and repair, takes only from Assay sales, and is shown openly |

---

## 7. Story

### 7.1 Premise
- **Setting:** Hollow Basin, Mars. The Hollowell Mining Co-op runs on a family ledger, a yard of patched machinery and a kettle. Wren Hollowell, Dot's grandmother, founded it and bought **Claim 7**, the deepest in the Basin, at auction after the **Deepreach Concern** folded forty years ago, when its deep crews stopped answering. She filed a contest against "prior claims, if any". Her survey chain vanished from the claim the same week.
- **You:** the new Claim Operator, call sign **Seven**, pilot of **Pip**. Dig, sell, build, keep the Co-op afloat.
- **The turn:** from your first Hardrock, the dead band **Channel Zero** reads your depth in chains and links. Then it counts your lift buckets, your drills, your Depots, exactly.
- **The truth:** something under the Basin filed the first claim on Mars and enters everything taken from it in a ledger. **The Surveyor** is its polite voice; **the Claimant** is the thing itself, an ancient boring machine-organism.
- **The resolution:** win back the **First Deed**, with Wren's contest pinned to it, and Claim 7 belongs to the Co-op, to the core.
- **Rules:** canon §2.12 and D6. The threat is being measured and owned; no gore, nothing demonic or religious; E10+ / PEGI 7.

### 7.2 Cast

| Name | Role | Voice | Enters |
|---|---|---|---|
| Dot Hollowell | Dispatcher; tutorial voice (goal chips); heart of the surface | Warm, wry, practical | Game start |
| Seven / Pip (PIP-7) | The silent player / the pod (beeps, drill hum) | — | Game start |
| Marlow (pod *Bucket*) | Rival lease-holder on Claim 6; trades lode surveys; never trapped, lost or retiring | Cocky, generous, competitive | First Mk II drill (v1) |
| Wren Hollowell | Co-op founder; appears only in writing: survey notes (S9, S10), the contest on the Deed | Terse field notes | r180 |
| Deepreach crews | The vanished predecessor, heard through Recorders | Period radio, professional, uneasy | First Recorder sale |
| Channel Zero | Dead band that counts | Flat count, "Mark." | First Hardrock |
| the Surveyor | The Claimant's projected voice; no body | Polite, archaic, exact | First Depot dock below r450 (v1) |
| the Claimant | The boss | No words; low tones | The Notch (v1) |

### 7.3 Tone ladder

| Depth | Tone | Carried by |
|---|---|---|
| 0–1,612 ft | Cozy | Dot, daylight, first automation |
| 1,612–3,275 ft | Uneasy | Channel Zero counts your depth and buckets; Gran's notes; Marlow's rivalry (v1) as warmth |
| 3,275–4,950 ft | Watchful | Magma glow; Deepreach logs; "re-surveyed" Shears (v1) |
| 4,950–5,813 ft | Eerie | Methane hush; the roster in the rock; drills read back |
| 5,813–7,300 ft | Menace | Static Zone; the Surveyor notes everything |
| Hollow Heart | Confrontation | The Claimant |

### 7.4 Beat schedule
Rules: canon §2.12 (original-depth ban with the incentive and game-start exceptions; system triggers; no original arcs; ≤ 90 characters, ≤ 4 cards per beat; ticker; CI lint). Each beat fires once and is logged in Dot's office. Tutorial guidance is goal chips and toasts, not radio. Live values (worst cases linted, `scratchpad/rev2/gdd/cards.py`): {C}/{L} = the pod's depth in chains (66 ft) and links; {n} = lift height in rows, one bucket per row (S8), or rows shifted (S15); {rate} = the drill's ore/min. S7 is Hardrock's first tell; S16 is methane's.

| # | Trigger | Scope | Sender | Cards |
|---|---|---|---|---|
| S0 | Game start | MVP | Dot | "Pip's tank is nearly dry, Seven. Roll left to the Pump House and fill her up." |
| S1 | First pass of r32 | MVP | Dot | "Ping! Pip just woke my old survey beacon. Copper lode, 575 feet down." / "It's on your map. My old survey shaft runs straight down beside it." / "Long drop, that shaft. Hold up on the stick to hover down slow." |
| S2 | 500 ft (r40) | MVP | Dot | "Five hundred feet! Co-op depth incentive: $1,000, paid to your account." |
| S3 | 1,000 ft (r80) | MVP | Dot | "One thousand feet! Co-op depth incentive: $3,000, paid to your account." |
| S4 | 3,500 ft (r280) | MVP | Dot | "Thirty-five hundred feet! The big one: a $25,000 depth incentive, paid." |
| S5 | Scripted lode discovered | MVP | Dot | "That's my lode! Too big for Pip to chew, but an Auto-Drill will work it all day." / "Your Starter Kit is at the Supply Shed, on the house: drill, lift, rail, belts." / "Dig down to it at the chevrons. The lift hangs in my shaft, up to the old Headframe." |
| S6 | `FirstLiftDelivery` | MVP | Dot | "Ore's coming up on its own! I'm just going to stand here and watch the buckets." / "Smelt that copper and the Assembler makes Wire. The Garage wants Wire." |
| S7 | First Hardrock dig refusal | MVP | Channel Zero; Dot | "…{C} chains, {L} links. {C} chains, {L+1} links. Mark." / "That's Channel Zero, a dead band. Nobody's used it in forty years." / "And that clink is Hardrock. No drill bites it. Go around, or pop it with a charge." |
| S8 | First lift taller than 100 rows | MVP | Channel Zero; Dot | "…{n} buckets. {n} links. Mark." / "{n}. That's the bucket count on your new lift, Seven. Exactly. I counted twice." / "Somebody down there keeps books on us. I'd like to know who." |
| S9 | First reach of r180 | MVP | Dot | "Found one of Gran's old survey notes: an iridium lode, thin but real. Marked." / "Iridium Ingots only come from lode ore. Pressure Vessels need them. So does the Keg." |
| S10 | First reach of r310 | v1 | Dot | "Another of Gran's notes: a thorium lode, thin seam. It's on your map." / "Thorium Rods only come from lode ore, and Reactor Cores eat them." |
| S11 | The r320 Seal | MVP only | Dot | "Co-op drilling rights end here — for now. I'm working on it. Keep digging up top." |
| S12 | First Mk II drill | v1 | Marlow; Dot | "Marlow, Claim 6, one lease east. Heard your new drill. Mine's louder." / "Trade you a survey: I mark a lode on your claim, you send me your Hardrock map." / "He's all right, just competitive. Take the survey. He can't dig our side." |
| S13 | First Depot activated | v1 | Marlow | "A Depot! I built mine first, for the record. The Bucket's jealous anyway." / "Here's another survey for your trouble. Lode's marked. Don't thank me, beat me." |
| S14 | First Gas Tap | v1 | Marlow | "You capped methane? I just blast mine and run. Trade me that trick." / "Last survey I've got worth a thing. Marked. Race you to the bottom, Seven." |
| S15 | First Sheared structure | v1 | Channel Zero; Dot | "…re-surveyed. {n} rows corrected. Entered. Mark." / "The ground shrugged while you were topside. The Basin settles in shears." / "Whole rows slide a tile. Braced cells hold. Two Weld Packs on the house." |
| S16 | First Sniffer bar | v1 | Dot | "Pip's Sniffer just twitched. Methane pockets down there look exactly like dirt." / "Bars mean gas within reach. When it hisses, dig slow and blast what you can't trust." |
| S17 | First Deep Eye methane reveal | v1 | Dot | "See that green shimmer? Deep Eye found the gas. Now it's a cell you can blast or tap." |
| S18 | First Echo Quartz sale | v1 | Dot | "Half a million dollars. The scale hummed back at me while I weighed it." / "I'm putting the kettle on and not thinking about that. Well done, Seven." |
| S19 | First reach of r430 | v1 | — | Etched on a lode-rock slab on the back wall at the pod: "DEEPREACH FOUR · ODA · PELL · VANCE · IRO · BEKK · SALT · TOMS · ADAIR · MEASURED" |
| S20 | First Auto-Drill below r450 | v1 | Channel Zero; Dot | "…your drill reports. {rate} links of ore a minute. Entered. Mark." / "It's reading our drill telemetry. In chains and links. I'm pulling that relay." |
| S21 | First Depot dock below r450 | v1 | the Surveyor | "Good evening, Operator Seven. Forgive the intrusion. I am the Surveyor." / "Do continue. Every tile you lift is entered. All of it was claimed long ago." / "Your Depot is noted. Your buckets are noted. You are noted, Operator." |
| S22 | First entry through the Notch | v1 | the Surveyor | "Through the Notch, then. Mind the step; it was cut for something larger." / "Bring your charges, Operator. The claim will be heard." |
| — | Static Zone, r465 | v1 | — | None (mechanic only, §4.9) |
| L1–L8 | Recorder sales | MVP (1–6), v1 (7–8) | Deepreach logs | §7.5 |

### 7.5 Deepreach logs (Lost Pod Recorder, in order of sale)

| # | Cards |
|---|---|
| 1 | "Deepreach One, day forty. Shale's soft, crew's cheerful." / "Somebody keeps scratching tally marks on the tunnel walls. Funny." |
| 2 | "Deepreach Three. Survey stakes at nineteen hundred feet. Brass heads." / "Not ours. Older than the colony. Older than anything I know." |
| 3 | "Deepreach Two. The radio counts on a dead band now. Chains and links." / "It counted our crew this morning. It got the number right." |
| 4 | "Deepreach Six. Every lift bucket we hang, the count goes up by one." / "We stopped hanging buckets. The count kept going." |
| 5 | "Deepreach Five. Head office calls the deep claims 'contested'." / "Contested by whom? Nobody will say. We pull the crews up at shift end." |
| 6 | "Deepreach Seven. If you find this: there's a gap in the floor by the east wall." / "Whatever's under it filed first. It wants its paperwork back." |
| 7 | "Deepreach Eight. We measured it. It measured us back. 'Fair,' it said." |
| 8 | "Deepreach Nine. Tell the next crew: bring charges, not lawyers." |
| 9+ | Static, then one tally tick |

### 7.6 The finale: the Hollow Heart
**Rules (canon §3.10):** one Claimant, 3,000 HP, three stagger phases; the Surveyor is its voice. Damage from explosives only. Leaving ends the attempt and resets the fight. Pause is allowed with a 3 s resume countdown; no build mode or map. Shears stop for good at the first entry (canon §4.7).

**Stamp** (pass 7): `=` Seal · `#` Heartstone · `*` hoard · `H` crust · `L` Locker · `C` Claimant (armoured) · `<` `>` lenses · `F` Furnace · `v` jaw (open only while venting) · `r` rubble.

```
584 ==============================================..
585 ##############################################..   (585–588 identical: Notch chute x 46–47)
589 #....H..........................................
590 #**..H..........................................   Hoard Alcove x 1–4, crust x 5
591 #****H..........................................
592 ######..........................................   (592–594 open, x 1–47)
595 #.L..........................................L..   Lockers on both ledges
596 ########.........CCCCCCCCCCCCCC.........########   West ledge x 0–7, East ledge x 40–47
597 #................CCCCCCCCCCCCCC................#   (597–598 identical)
599 #................<CCCCCCCCCCCC>................#   Lens L x 17, Lens R x 30
600 #..........######CCCCCCCCCCCCCC######..........#   Mid ledges x 11–16, 31–36
601 #................CCCCCCCCCCCCCC................#   (601–602 identical)
603 #........r.......CCCCCFFFFCCCCC.......r........#   Furnace x 22–25
604 #.......Lr...r...vvvvvvvvvvvvvv...r...rL.......#   Floor walk row; Lockers x 8, 39
605 ################################################   (605–607 Heartstone)
    000000000011111111112222222222333333333344444444
    012345678901234567890123456789012345678901234567
```

**Entry.** An 11-row drop from the Notch onto the East ledge (6 HP unbraked), beside a Locker. Camera fixed at 26 ppu (canon §3.4; framing 03 §5). The boss bar has three 1,000-HP segments.

**Damage.** A Pop or Mega Pop detonates centred on the pod (grounded). d = Chebyshev distance from the pod's cell to the nearest **open** weak-point cell.

| Case | Pop / Mega |
|---|---|
| Perfect: d ≤ 1 | 120 / 240 |
| Good: d = 2 (Mega only) | — / 168 |
| Otherwise (the body is armoured) | 0 |

- **Flinch:** each opening absorbs ≤ 240 damage; reaching 240 shuts it at once (a lens snaps shut; the jaw closes and pushes the pod to x 16 or x 31 for 0 HP). Damage past a stagger threshold carries over, so a win needs ≥ 13 openings.
- **Preview:** while grounded, the arming ring shows green (Perfect), amber (Good) or nothing. Position is the aim.
- **Supplies:** the pod carries ≤ 9 Pop + 9 Mega. Each of the 4 Lockers, stopped on 0.3 s while armed, tops up 3 Pop + 1 Mega (to the 9 cap) once per attempt. Perfect pool 5,640 against 3,000 HP: ≈ 53% efficiency wins. Patch Kits (≤ 9 × 30 HP) are the sustain.

| Phase | HP | Opening (weak point) | Attacks | Surveyor line at start |
|---|---|---|---|---|
| I Survey | 3,000 → 2,000 | One lens at a time: open 6 s, 2 s gap, alternating | Bore Arm, Stake Fall, Lens Sight; one per 2.5 s | "The first claim stands. Present yours, Operator." |
| II Assay | 2,000 → 1,000 | Furnace, during the 3.0 s vent after each Furnace Breath (~12 s cycle) | Furnace Breath, Bore Arm, Rubble Rain; one per 3 s | "Inexact. Inexact! Re-survey the floor!" |
| III Claim | 1,000 → 0 | Lenses (open 4 s, gap 3 s) and Furnace vents | Claim Line on entry, Lens Glare, Bore Arm from both walls, Rubble Rain, Furnace Breath; one per 2.5 s | "We were here first. We shall be here last." |

Each stagger (at 2,000 and 1,000 HP) lasts 3 s: no attacks, plates fall as rubble, weak points shut.

| Attack | Phases | Tell (≥ 1.0 s; off-screen: 44-pt edge chevron + panned cue ≥ 1.2 s before contact) | Effect | Dodge |
|---|---|---|---|---|
| Bore Arm | I–III | 1.2 s wall-crack glow and rumble at the pod's row or a ledge row | Arm crosses the row at 10 tiles/s to the body; 25 HP; destroys rubble | Change row |
| Stake Fall | I | 1.2 s: 3 ceiling shadows at the pod's x and x ± 4 | Survey stakes fall at 20 tiles/s; 12 HP each; stand 8 s as 1×3 pillars | Step aside; pillars block Lens Sight |
| Lens Sight | I | Lens glint + rising chime | Beam tracks the pod at 3.5 tiles/s; 1.5 s cumulative lock → "Measured": 30 HP | Break line of sight |
| Furnace Breath | II–III | 1.5 s: furnace brightens, rising roar | Fire rolls along rows 603–604 to both walls in 1.0 s; 40R HP | Ledges or ≥ 2 rows above the floor |
| Rubble Rain | II–III | 1.0 s: grit in 5 marked columns | 10 HP per rock; leaves 1×1 rubble | Step aside |
| Lens Glare | III | 1.0 s: the open lens flares white | Beam along row 599 to the wall; 20 HP | Drop off the mid ledge |
| Claim Line | III entry, re-form | 2 s: floor glows ledger-green; lenses shut 12 s | Rows 603–604 claimed for 5 s: 15 HP/s on contact | Ledges or hover |

A vent that ends naturally with the pod under the jaw pushes it out for 20 HP.

**Victory.** "…Noted. The claim is… contested." The Claimant stills, the crust crumbles, and the pod collects the six hoard items (6 slots, 6 mu) like relics. The climb home is the last push-your-luck trip; delivering the First Deed triggers the ending.

**Death with hoard items.** They re-settle in the alcove, the crust re-seals, and the Claimant re-forms at 750 HP in phase III ("A recount, Operator. The ledger reopens."): ≥ 4 openings. Lockers refill for the new attempt.

**Finale Assist** (§6.4): HP ×0.6 (1,800; re-form 450), attack damage ×0.5, tells ×1.5.

**Tuning targets (v1 acceptance, canon §5.3):** fight 4–6 min median, 2.5–3 min expert; ≥ 60% of median players win by attempt 3 with t6 Hull and Radiator; incoming damage 250–350 HP per attempt at median play; retry loop ≤ 3 min.

### 7.7 Ending, credits and after
**"Claim Settled"** (60–90 s, skippable, non-interactive), on delivering the First Deed:
1. "The First Deed. Filed: the whole Basin, down to the core."
2. "Pinned to it, in Gran's hand: 'Contested. W. Hollowell.' It kept her notice."
3. "Claim 7 is the Co-op's now. All of it, all the way down. Kettle's on."

**Epilogue cards** (by flag): always (v1) "Marlow sends a fruit crate and his Claim 6 survey, stamped NOT FOR YOU."; ≥ 6 logs heard "The Deepreach crews' names go up on the Co-op wall, beside Gran's."; 0 deaths: "Clean Claim" stamp; Hardcore save: "Hardcore Operator" stamp.

**Credits:** the camera pulls back over the diorama with the Yard lights on; then the stats card (deepest row, total earned, trips, deaths, factory output, time).

**Free play:** Channel Zero is silent; the arena is empty but reachable; Dot has post-game lines; lodes keep running; finite ore stays as it is.

**NG+ "New Claim"** (post-launch): rows ≥ 40 re-rolled (lodes too), buildings below r40 refunded as Kits; Yard, parts and cash kept; Claimant HP ×1.5 per loop; optional "Restless Ground" (Shear p 0.20), Deep Heat, "Thin Seams" (specimens ×0.5).

### 7.8 Build order

| Tier | Content |
|---|---|
| M0 | None |
| MVP | S0–S9, S11; logs 1–6; office log; relic captions; ticker and card lint |
| v1 | S10, S12–S22; logs 7–8; Static Zone; arena, Lockers, hoard, ending, epilogues, credits, free play |
| Post | New Claim; voiced lines; localisation |

### 7.9 Risks

| Risk | Mitigation |
|---|---|
| Cards ignored mid-dig | ≤ 90 characters, ticker, sender sting, office log |
| The Claimant is too hard on touch | No aiming; preview ring; flinch-capped openings; Lockers; pause; Finale Assist |
| The Surveyor drifts into horror | Politeness over threat; no body; no body horror |
| The story still echoes the original | Canon §2.12 lint on trigger depths and card length; legal review (canon §4.14) |

---

## 8. Milestones (Dot's office board; local only)

- **MVP (15):** Topped Off (first refuel) · Payday (first sale) · Basket Case (first t2) · Five Hundred Club (500 ft) · Old Ping (discover the scripted lode) · Hands Off (`FirstLiftDelivery`) · Plated (first Hull Plate) · Grand (1,000 ft) · Clink (first Hardrock) · Pop Goes the Shale (clear Hardrock with a charge) · Featherfall (fall ≥ 30 rows, land with 0 damage) · Heavy Hauler (reach the Rim at ≥ 90% hover cap) · Hot Feet (survive a Magma breach) · Big Incentive (3,500 ft) · Wrong Number (hear Channel Zero).
- **v1:** Sniffed Out (reveal Methane with Deep Eye) · Capped (build a Gas Tap) · Full Ledger (hear 6 Deepreach logs) · Held Fast (a Brace keeps a structure out of a Shear) · Rival (receive a Marlow survey) · Hush (enter the Static Zone) · Through the Notch (enter the Hollow Heart) · Recount (stagger the Claimant twice in one attempt) · Claim Settled (deliver the First Deed) · Maxed (every line at max tier) · Night Shift (away report ≥ 3 × PRI) · Clean Claim / Hardcore Operator (credits with 0 deaths / on Hardcore).

### 8.1 Build order
- **MVP:** the 15 above. **v1:** all. **Post:** Game Center / Play Games.

### 8.2 Risks

| Risk | Mitigation |
|---|---|
| Milestones reward grinding | None needs a count above 1, except Maxed |
| "Clean Claim" reads as pressure | Shown only after the credits |

---

## 9. GDD defaults (user-overridable)

| # | Default | Alternative |
|---|---|---|
| G1 | Gap skim at ≥ 1.5 tiles/s over 1-wide gaps (§3.2) | Fall into every gap |
| G2 | Tin Ear adjacency = 8 neighbours | 4 neighbours (the shaft bottom then needs one dig) |
| G3 | Sign tap auto-drives to the pad, then opens the sheet | Sheet opens in place |
| G4 | Tiers buyable out of order; no trade-in | Strict order; 25% trade-in |
| G5 | Belts don't carry the pod | Belts carry it |
| G6 | Sky thrust fades over the top 8 rows | Hard ceiling |
| G7 | Landing Assist, Steady Drill, Finale Assist | Fewer assists |
| G8 | Marlow's three survey marks (v1) | Flavour-only Marlow |
| G9 | Wren in writing only; her contest pinned to the Deed | — |
| G10 | Arena readout "DATUM 0" | Blank readout |
| G11 | Part counts in §5.1 (02 may retune ±25% within canon §4.3.5) | — |
| G12 | Recorders: ≥ 6 in rows 76–319 and ≥ 2 in rows 396–583 | ≥ 6 anywhere |
| G13 | Scripted lode x0 ∈ 14–28; access column x0 + 1 | — |
| G14 | Hull tracked to 0.1 HP, HUD shows the ceiling | Integer hull |
| G15 | Arena stamp, attack set and timings (§7.6) | Retune within the canon §3.10 rules |

### 9.1 Build order
- **Before MVP content lock:** confirm G1–G7 (minus Finale Assist), G11 (t3–t5), G12–G14.
- **Before arena production (v1):** confirm G8–G10, G11 (t6–t7), G15.

### 9.2 Risks

| Risk | Mitigation |
|---|---|
| Unconfirmed defaults harden into canon by inertia | Each G item gets a canon change-log line or a user "no" before its scope tier starts |
