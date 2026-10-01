# 06 — Completeness Critique of Research Briefs 01–05 (HoleFactory)

**Role.** Completeness critic. I read briefs 01 (Motherload mechanics), 02 (art direction), 03 (factory design), 04 (tech stack) and 05 (world structure) in full. This document lists (1) contradictions between briefs, (2) claims that look wrong or unverified and matter, (3) gaps I could fill with new evidence, and (4) gaps that still block a full game-design + technical build plan, with a recommendation for each.

**Verification in this session.**
- WebSearch was **exhausted** (the shared 200-call budget was used up by the earlier briefs). WebFetch and curl to Wikipedia, Apple, Steam, XGen, the wikis, the App Store and USPTO were **blocked** by the egress proxy.
- **Reachable and used:** GitHub code search, and raw files on `raw.githubusercontent.com`. That gave three new primary-ish sources:
  - **[CL]** CoreLode `docs/calibration.md` and `docs/fidelity-checklist.md`: a 2026 clean-room TypeScript remake whose author disassembled the original `motherload.swf` (archive.org item `motherload_202209`, AS2 bytecode) and tagged each constant **[CODE]** (read from bytecode), **[WIKI]** or **[CAL]** (still tuned by feel). https://raw.githubusercontent.com/2Tricky4u/CoreLode/HEAD/docs/calibration.md , https://raw.githubusercontent.com/2Tricky4u/CoreLode/HEAD/docs/fidelity-checklist.md , repo https://github.com/2Tricky4u/CoreLode
  - **[MO]** Mocha2007's independent JS port of the original `generateEarth()` plus the mineral table: https://raw.githubusercontent.com/Mocha2007/mocha2007.github.io/HEAD/tools/motherload.js
  - **[BCD]** MDN browser-compat-data JSON (the data behind caniuse/MDN tables): https://github.com/mdn/browser-compat-data (files `api/Navigator.json`, `api/GPU.json`, `api/WakeLock.json`, `api/CompressionStream.json`, `api/AudioSession.json`, `api/StorageManager.json`, `api/PushManager.json`, `api/OffscreenCanvas.json`, `api/Element.json`, `api/ScreenOrientation.json`, `css/properties/overscroll-behavior.json`, `css/types/length.json`, `html/elements/input.json`).
- [CL] and [MO] were produced independently and **agree line for line** on the world-generation algorithm, the mineral values and masses, and the boss-loot values. Where only [CL] has a number (physics, fuel, damage), I label it "[CL] code-derived (single source)".
- Derived numbers below come from my own scripts (`scratchpad/crit/oredist.py` and an inline physics calculation). Anything from my own knowledge that I could not check is marked **(unverified)**.

---

## 0. TL;DR: the ten findings that matter most

1. **Brief 01's numbers are mostly right, but several "facts" conflict with the original's bytecode.** Marsquakes are **row shifts** (each row moves ±1 tile horizontally), not "score ≥ 100k → mine regenerates". Gas starts at about **−4,950 ft** (not −4,750). Lava starts at about **−3,275 ft** (not −3,000). There is **no depth-hardness term** in drilling. A lava hit is **29 × radiator**, doubled to 58 on some hits (not "58 or 41"). The ending loot has **cash values up to $25M** (not "worth nothing"). The weight cap implied by the code formula is about **230 mass units (≈2,300 "kg")**, not 6,200 kg. Details in §2 and §3.
2. **The mineral depth bands conflict between briefs.** 01 says Ruby −4,000 / Diamond −4,400 / Amazonite −5,500 ft. 02 and 03 say 3,187 / 4,000 / 4,812 ft. **The bytecode settles it:** a new tier becomes *possible* every 65 rows (812.5 ft), so 02/03's numbers are the true **first-possible** depths, and 01's are the depths where each ore becomes **common**. Both are needed (§3.2).
3. **Fuel is now quantified.** Burn is **P/50,000 L per frame when flying** and **P/25,000 when digging** (P = engine hp, 42 fps), and **0 when idle** ([CL], idle still CAL). A stock tank is about **83 tiles of pure digging** or **79 s of hover**. Bigger engines burn more. Late game, fuel stops binding: the top rig digs about **5,300 tiles per tank**. This undermines brief 03's "Depot refuelling is the biggest interlock" (§3.1, §5 P0-4).
4. **Brief 03's factory economy breaks the pod loop by an order of magnitude.** The free scripted Bronzium lode (15/min) earns about **$900/min**, which roughly equals the pod's entire income in that phase. One Goldium lode earns **$3,750/min**. An overnight offline Silo of Goldium is worth **$250k**, at a point where upgrades cost $2k–5k. Crafted Dynamite needs about $50–75 of inputs against Motherload's $2,000 shop price. Every rate needs a balancing model (§3.6).
5. **The persistent world conflicts with Motherload's failure model.** In 01, death means "reload last save". In 04, autosave runs every 30 s. 03 and 05 have a persistent factory that keeps running. None of the briefs defines what death costs when the world can't be rolled back (§5 P0-2).
6. **Depots risk recreating Super Motherload's bases.** Brief 01 warned that bases weakened the loop. A Depot that accepts cargo, refuels, repairs, and lifts the cargo up removes the user's explicit rule: "return to the surface before you run out of fuel or drill dies". The briefs never set quantitative limits (§5 P0-1).
7. **The ore is finite.** An original 32-wide mine holds only about **44 Amazonite, 67 Diamond and 102 Ruby** in total (about **$32.5M** of ore and artifacts). In a persistent mine that never regenerates, the pod's jackpot loop runs out. No brief has a renewal mechanic (§3.2, §5 P1-1).
8. **The canonical numbers don't match across briefs.** World width is 32 / 48 / 64. The plateau is 48×24 or 48×32. Camera widths are 9 / 9.5 / 10 / 11. Strata bands are uneven depth ranges in one brief and 8 × 76 rows in another. Sim bands are 64 rows or 16 rows. Block depth is 1.0 or 1.5 units. Underground footprint is "max 2×2" in one brief, yet the Depot is 3×2. §6 proposes one source of truth.
9. **Mobile layout gaps.** No brief handles the **iPhone SE (375×667)**, **iPad/tablets**, **foldables**, **left-handed** play, or the fact that the HUD plus control zone hides about **40% of the screen**, so the "12 rows below / 7 above" rule cannot be met in clear view (§3.7, §5 P1-6).
10. **The user's own words raise three questions no brief asked:** "or **drill dies**" (drill durability?), "upgrade and **purchase your vehicle**" (multiple vehicles?), and the factory's purpose being "to **bring resources to the surface**". There is also **IP**: Motherload names, dialogue and shop names belong to XGen Studios, which still sells the game. CoreLode shows the clean-room approach (§5 P0-7, §7).

---

## 1. Contradictions between briefs

| # | Topic | What the briefs say | Evidence / resolution | Impact |
|---|---|---|---|---|
| X1 | **Mineral first depths** | 01: Plat −800, Einst −1,600, Emerald −2,400, Ruby −4,000, Diamond −4,400, Amazonite −5,500 ("min depth est."). 02 and 03: 750 / 1,562 / 2,375 / 3,187 / 4,000 / 4,812 | The bytecode tier spread is `random(⌊row/65⌋+2)`, so a new tier becomes possible every 65 rows ([CL], [MO]). **02/03 = first possible; 01 = roughly where the ore becomes common.** See the §3.2 table | Strata palette anchors, unlock pacing, Phase A–E boundaries |
| X2 | **Marsquakes** | 01: trigger at score ≥ 100k, 5% roll per shop visit, underground "almost fully regenerated". 03: "Motherload quakes begin at 1,000 ft" (stated twice). 05: none | Code: `earthQuake(intensity)` **shifts each row from 11 to H−15 horizontally by ±1 tile, with wraparound,** with chance 1/(5−intensity) per row. The pod is never entombed. The trigger schedule is **unknown [CAL]**; radio chatter mentions quakes at −1,000 ft ([CL]). Neither 01 nor 03 is right | Big design hook: **row shear breaks vertical lifts, chutes and tubes**. It is a better, canon-faithful infrastructure threat than "collapses" |
| X3 | **Hazard onsets** | 01: stone −1,600/−1,750, lava ≈ −3,000, gas −4,750. 02 strata: lava 3,000, gas 4,500 (B5). 03: rock ≈ 1,750, lava ≈ 3,000. 05: rows 128–140 / 240 / 380 | Code gates are H/4.5, H/2.25 and 2H/3 (H = 600) → rows 134 / 267 / 401, i.e. **≈ −1,612 / ≈ −3,275 / ≈ −4,950 ft** ([CL], [MO]) | Strata bands, gear checks, the Heat-Shielded drill and Gas Tap unlock depths |
| X4 | **World size** | 01: 32 × ~600 (original). 04: example grid 64 × 1,000, spike 64 × 200. 05: 48 × 608, bedrock at row 584. 02: plateau 48 wide | Original array is 36 × 600 including side walls, **32 playable**, barrier at row 588 ([CL]). Pick one; 05's 48 × 608 is the best-argued | Ore density, map texture, save size, budgets |
| X5 | **Surface plateau** | 02: 48 × 24 deep. 03: about 48 × 24 to start, then purchased plots. 05: 48 × 32 buildable, starting at 48 × 8, +8-row expansions | Design choice. 05 is the most specific | Build space, chunk count |
| X6 | **Camera view widths** | 02: surface 10, underground 9, build mode same width at pitch 55°. 05: surface play 11, build 10, underground 9.5, underground build 8 at yaw 8°/pitch 12° | Design choice. Note: at width 10 on a 375-pt SE, a tile is 37.5 pt/unit and the diamond is about 43 pt tall at pitch 55°, **below 03's "1 tile ≥ 44 pt" build rule**. Define "tile size" as the short axis of the picked face | Touch accuracy |
| X7 | **Camera rotation** | 02: optional 90° snaps in *play*, off by default. 03: rotation button generally. 05: play fixed; **4 snaps in build mode only** | Recommend 05: rotation in build mode only | Input mapping (stick-x = world-x must hold in play) |
| X8 | **Strata bands** | 02: 8 uneven bands (0–250, 250–1,000, 1,000–2,000, 2,000–3,000, 3,000–4,500, 4,500–6,000, 6,000–7,300, core). 05: "8 bands × 76 rows" | Use 02's hazard-anchored bands, corrected to the X3 onsets (§6) | Art pipeline, sim LOD bands |
| X9 | **Block depth** | 02: front at z = 0, back wall at z = −1 (1 unit). 05: solids span z −1.0 to +0.5 (1.5 units), mounts at −1.0 to −0.45 | Pick 05 (the wall-mount layer needs the extra depth) | Mesher, lighting |
| X10 | **Underground footprints** | 02: "underground machines max out at 1×2 / 2×2". 03 and 05: Depot **3×2** | Allow 3×2 for the Depot only | Dig-out cost for the first Depot |
| X11 | **Sim chunking** | 03: 32 × 32 tile chunks and 64-tile depth bands. 04: 16 × 16 mesh chunks and 64-row sim bands. 05: 16-row sim bands aligned to render chunks | Decouple them: 16 × 16 render chunks, **64-row sim LOD bands** (fewer band transitions) | Sim/worker design |
| X12 | **Power in the MVP** | 03 §6.4: "MVP: no power". 03 §6.2: Bucket Lift "power 1 kW per 10 tiles", Tube "5 kW", and the headline rule "up costs power" | Internal inconsistency. In the MVP, "up costs" must be paid in **cash, build cost or throughput**, not power | Teaching order |
| X13 | **Quality tiers vs. OS floor** | 02 low tier: "iPhone 8/XR/SE2". 04: minimum iOS/iPadOS 17 | iPhone 8 tops out at iOS 16, so it is **out of scope** (own knowledge, high confidence). iOS 26 also drops XS/XR (supports iPhone 11/SE 2 and later; unverified here) | Device test matrix |
| X14 | **Thrust input default** | 02 layout: a dedicated 72-pt THRUST button is primary; ITEM button 52 pt. 05: **stick-up = thrust**, THRUST button optional; items 56–64 pt | Recommend 05, with 02's button as a setting | Control layout |
| X15 | **Post-processing** | 02: "Pixel Lab" (render to a low-res target, edge pass, upscale) could be the **default on low tier**. 04: "no full-screen post passes on mid/low tiers" | The low-res pass is net cheaper, so allow it as an exception. Re-measure in the week-1 spike | Low-tier renderer |
| X16 | **Save semantics** | 01: death = roll back to the last save at the save robot. 04: autosave every 30 s, on hide, and after shop transactions. [CL]: original saves only at the station | **Unresolved.** Needs two save kinds; see P0-2 | Core loop tension |
| X17 | **"Down is free"** | 03: chutes are free, and kits must be **carried down by the pod** (uses cargo weight). 03 also has Gravity Chutes that drop any item to buildings below | A chute from the surface can deliver kits, fuel canisters and repair kits to Depots, which **bypasses the pod-carry interlock**. Needs a rule | Interlock integrity |
| X18 | **Score** | 01: score feeds marsquakes; conflicting ×5 vs ×50; recommends dropping score | Code: dirt 25 pts, mineral = value × 5 (capped at the Diamond index, so Amazonite and artifacts score 500k) ([CL]). [MO]'s "×50" is a commented guess. Quakes are **not** tied to score in code (X2) | Remove score safely |

---

## 2. Claims that look wrong or unverified, and matter

| # | Brief | Claim | Status / correction |
|---|---|---|---|
| W1 | 01 §1.3 | "Effective dig time per tile rises with depth (harder soil)" | **Likely wrong.** Code: the dig engages after more than 5 held frames; the tile breaks 15 px into a 40 px traversal at the drill's px/frame speed (2 → 12 px/frame). [CL] lists no depth or hardness term. Dig time is **0.48 s per tile at stock and 0.08 s at the top tier**, independent of depth. Hardness by depth is a free HoleFactory design choice, not canon |
| W2 | 01 §1.4, §8.1 | Lift cap of about 5,800–6,200 kg with the V16; a "full Amazonite load" of about 51 pieces | **Conflicts with the code formula.** Thrust accel = P/(m·1.5) per frame vs gravity 9.81/30 per frame, with m = 198 + Σ cargo mass, and mineral masses 1–12 (the wiki's "kg" are ×10). Hover limit ≈ P/0.49 − 198 → **108 mass units (stock) to 230 (V16)**, i.e. about 1,080–2,300 wiki-kg. [CL] marks the thrust clamp as CAL, so either the wiki or the clamp is off by about 2.7×. **HoleFactory needs its own lift curve anyway**, so treat 6,200 kg as unreliable |
| W3 | 01 §2.1 | "Fuel drains continuously over time" | Code: **idle burn 0** (CAL, "no idle-burn site found"). Burn applies only while flying or digging, and **scales with engine hp**. This matters because idle-free fuel makes "stop to build" penalty-free |
| W4 | 01 §2.3 | Lava ≈ 58 **or 41** HP | Code: `damage(29 × radiatorCooling)` at two call sites, so **29 per hit, 58 on a double hit** ([CL]) |
| W5 | 01 §2.3, §5 | Gas from −4,750 ft | Code gate is row > 400, **≈ −4,950 ft** (matches 01's own "rare until −4,950"). The damage formula `int(−(depth+3000)/15) × radiator` is confirmed by [CL] |
| W6 | 01 §7.3 | Ending loot is "flavour items worth nothing" | Code: **sellable**. Kevlar Suit $50k, Staff $100k, Monocle $200k, Hooves $300k, Horns $400k, each Evil Eye $500k, Boiler $600k, Peace Reward $1M, Shares **$25M** ([CL], [MO] agree) |
| W7 | 01 §2.1 | Pod arrives "nearly empty" | Code: **6.0 of 10 L**, $20, 10 HP ([CL]) |
| W8 | 01 §4.1 | Artifact weights unknown | Code: **mass 1** each (= "10 kg") ([CL], [MO]). Artifacts appear only **below row 80 (≈ −940 ft)**, at 1 in 500 of mineral seeds |
| W9 | 01 §7.2 | Natas "demands you turn back" at −5,800 | Code schedule: start, 500 (+$1k), 1,000 (+$3k), 1,750, 2,100, 2,500, 3,100, 3,500 (+$25k), 4,100, 4,500, **6,200** ("violating the terms of your employment"), **7,000** ("terminated"). The altimeter scrambles below **−5,813** and shows −66,666 below −7,300 ([CL]) |
| W10 | 02 §6.2 | Gas pocket "invisible by default (unverified)" | **Confirmed.** Tile 31 renders as dirt ([CL]) |
| W11 | 04 §4.3 | `navigator.audioSession` "Safari 17+" | [BCD]: **Safari / iOS 16.4** |
| W12 | 04 §4.5 | Wake Lock "since 16.4, home-screen bugs fixed in 18.4 (unverified)" | [BCD]: full support from **iOS 18.4**; partial from 16.4–18.3 with the note "**Does not work in standalone Home Screen Web Apps**" (webkit bug 254545). Confirmed |
| W13 | 04 §4.11 | `overscroll-behavior` (Safari 16+) stops rubber-banding | [BCD]: Safari 16 **partial**, "no effect on scroll containers that have no scrollable overflow". On a fixed, non-scrolling root it may not suppress bounce, so rely on `touch-action:none` plus non-passive `preventDefault` |
| W14 | 04 §4.9 | iOS 18 `<input type=checkbox switch>` haptic hack | [BCD]: the `switch` attribute exists from **Safari 17.4**. The haptic-on-toggle behaviour remains **unverified**. Keep it as optional polish |
| W15 | 04 §3.6 | `CompressionStream('deflate-raw')` (unverified versions) | [BCD]: **Safari 16.4**, Chrome Android 80+. Confirmed. With the iOS 17 floor, the fflate fallback is only needed for old Android WebViews |
| W16 | 04, 05 | Fullscreen, orientation lock and vibration on iPhone | [BCD] confirms: `requestFullscreen` is iPad-only from 16.4 (partial; swipe-down exits); `ScreenOrientation.lock` is unsupported in Safari (Chrome Android 38+); `navigator.vibrate` is unsupported in Safari (Chrome Android 32+, needs a gesture since 60) |
| W17 | 04 | (missed) | [BCD]: **OffscreenCanvas + WebGL2 in workers from Safari 17**, so render-in-worker is possible on the iOS floor. Not needed for v1, but it is an option if main-thread CPU becomes the bottleneck. **Push notifications** work in home-screen web apps from **iOS 16.4** (useful for "Silo full", if offline progress ships) |
| W18 | 04 §0 | "iOS 26 requires iPhone 11 / A13 or newer (unverified)" | Consistent with my own knowledge (XS/XR dropped; SE 2nd/3rd gen kept). Still **unverified** here because Apple and Wikipedia were blocked |
| W19 | 03 §1 | Factorio turbo belt 60/s and assembler speeds "(unverified)" | Correct from my knowledge, and immaterial to the plan |
| W20 | 05 §2.1 | Statements about ~30 third-party games are all unverified | Low impact; they are used as inspiration, not as numbers |

---

## 3. Gaps I could fill

### 3.1 Pod physics and fuel (original bytecode, [CL]; single source unless noted)

**Engine:** fixed **42 fps**. Tile = 50 px; **1 ft = 4 px**; 12.5 ft per tile. All constants below are **per 1/42 s frame**. A 60 Hz sim (brief 04) must convert them, for example drag^(42/60) and gravity × (42/60)², or simply run the pod at 42 Hz as CoreLode does.

| Constant | Value |
|---|---|
| Gravity | +9.81/30 = 0.327 px/frame² (≈ 144 ft/s²); yVel hard cap 20 px/frame |
| Air drag | velocity × 0.98 per frame (airborne); ground friction 0.94 |
| Terminal fall | ≈ 16.35 px/frame ≈ **171.7 ft/s ≈ 13.7 tiles/s** |
| Thrust | accel = enginePower / mass / 1.5, mass = **198 + Σ cargo mass** (exact clamp CAL) |
| Fuel, flying | −P/50,000 L per frame (stock 0.126 L/s; V16 0.176 L/s) |
| Fuel, digging | −P/25,000 L per frame (exactly 2× flying) |
| Fuel, idle | 0 (CAL) |
| Landing | if yVel > 7: damage floor(yVel/2) (3 HP minimum, about 8 HP at terminal); bounce yVel × −0.2 |
| Dig engage | hold into diggable ground **> 5 frames (≈ 119 ms)**, which validates 05's 120 ms proposal. Sideways digging only when grounded; never up; boulders refuse with a "clink" |
| Item cooldown | 5 frames |
| Start | $20, 10 HP, **6 of 10 L** fuel |
| Repair | $15/HP. **Buying a hull repairs it free.** Fuel $1/L (wiki; the menu offers 5/10/25/50 L/Fill) |
| Original day/night cycle | 2,880 frames ≈ **68.6 s** (none of the briefs mention it; it supports 02's optional cycle) |
| Hidden item | "Core Teleporter", hotkey 0, $1, teleports to the core (debug/cheat) |

**Upgrade grid in code units** ([CL]): drill 2 / 2.8 / 4 / 5 / 7 / 9.5 / 12 px/frame (the wiki's "20…120 ft/s" labels are ×10); hull 10–180; engine 150–210; tank 10–150 L; bay 7–120; radiator multipliers 1.0 / 0.9 / 0.75 / 0.6 / 0.4 / 0.2. These match brief 01's table.

**Derived per tier** (my calculation from the above; climb speed is an upper bound because the thrust clamp is CAL):

| Tier | Engine hp | Fly L/s | Dig L/s | s/tile dig | L/tile dig | Hover max cargo (mass units ≈ wiki kg/10) | Empty climb (tiles/s, upper bound) |
|---|---|---|---|---|---|---|---|
| 1 | 150 | 0.126 | 0.252 | 0.48 | 0.120 | 108 | 7.5 |
| 2 | 160 | 0.134 | 0.269 | 0.34 | 0.091 | 128 | 8.9 |
| 3 | 170 | 0.143 | 0.286 | 0.24 | 0.068 | 149 | 10.3 |
| 4 | 180 | 0.151 | 0.302 | 0.19 | 0.058 | 169 | 11.7 |
| 5 | 190 | 0.160 | 0.319 | 0.14 | 0.043 | 189 | 13.1 |
| 6 | 200 | 0.168 | 0.336 | 0.10 | 0.034 | 210 | 14.5 |
| 7 | 210 | 0.176 | 0.353 | 0.08 | 0.028 | 230 | 16.0 |

**Design consequences none of the briefs saw:**
- **Range scales mostly with the drill, not the tank.** Fuel per dug tile falls 4.3× from stock to top drill. A stock 10 L tank digs about **83 tiles** (about 1,040 ft of pure digging, before the return flight). A 150 L tank with the top drill digs about **5,300 tiles**.
- **Late game, fuel stops being the master clock.** Hull (gas), weight and the boss take over, as brief 01 §8.2 sensed. So 03's "Depot refuel = biggest interlock" only bites early to mid game unless HoleFactory retunes fuel (P0-4).
- **Bigger engines burn more fuel.** That is a real trade-off HoleFactory can keep.
- **Idle burn is 0**, so pausing in a tunnel to build costs no fuel. That suits a "pod parks, player builds" flow.

### 3.2 World generation and the ore/hazard distribution ([CL] + [MO], two independent sources)

The algorithm per cell, for rows 6–587 in a 600-row array where row 5 is the surface turf:
1. **Mineral seed with probability 1/5.**
   - 80%: `min(6 + random(k), 15)`;
   - 16%: `min(7 + random(k), 15)`;
   - 4%: either an **artifact** (¼ of these, only below row 80) or `min(8 + random(k), 15)`;
   - where **k = ⌊row/65⌋ + 2**.
2. **Otherwise dirt.** Below row 133.3 a hazard can replace it with probability 1/⌊(600−row)/600 × 15⌋ (rising from 1/11 to certainty near the bottom):
   - rows 134–266: **boulder**;
   - rows 267–400: boulder or **lava** (50/50);
   - rows > 400: boulder 50%, lava 25%, **gas 25%**.
3. **Finally, every cell has a 1/3 chance to become air (caverns),** overriding everything.
4. A 2-tile hole in the barrier row (588) at the right edge leads to the arena.

The `min(…,15)` clamp means **Amazonite absorbs the overflow at depth**. The uniform spread means **Ironium stays common at every depth**, so cargo triage stays alive deep down.

**First possible appearance** (depth ≈ (row − 5) × 12.5 ft):

| Item | Row | ≈ ft |
|---|---|---|
| Ironium, Bronzium, Silverium, Goldium | 6 | surface |
| Platinum | 65 | 750 |
| Artifacts | 81 | 950 |
| Einsteinium | 130 | 1,562 |
| **Boulders** | 134 | **1,612** |
| Emerald | 195 | 2,375 |
| Ruby | 260 | 3,187 |
| **Lava** | 267 | **3,275** |
| Diamond | 325 | 4,000 |
| Amazonite | 390 | 4,812 |
| **Gas** | 401 | **4,950** |

**Percent of all cells per 65-row band** (computed analytically from the algorithm; mineral density is constant at about 13.2%):

| Rows (≈ ft) | Iron | Bronze | Silver | Gold | Plat | Einst | Emer | Ruby | Diam | Amaz | Rock | Lava | Gas | E[$]/cell | E[$]/mineral | E[mass]/mineral |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6–70 (12–812) | 5.17 | 6.20 | 1.62 | 0.32 | 0.02 | – | – | – | – | – | – | – | – | 8 | 59 | 1.03 |
| 71–135 (825–1,625) | 3.47 | 4.17 | 4.31 | 1.08 | 0.19 | 0.01 | – | – | – | – | 0.15 | – | – | 31 | 233 | 1.11 |
| 136–200 (1,638–2,438) | 2.62 | 3.14 | 3.24 | 3.24 | 0.82 | 0.14 | 0.01 | – | – | – | 5.15 | – | – | 45 | 343 | 1.40 |
| 201–265 (2,450–3,250) | 2.10 | 2.52 | 2.60 | 2.60 | 2.60 | 0.66 | 0.11 | 0.01 | – | – | 6.21 | – | – | 73 | 552 | 1.79 |
| 266–330 (3,262–4,062) | 1.75 | 2.11 | 2.17 | 2.17 | 2.17 | 2.17 | 0.56 | 0.09 | 0.01 | – | 3.85 | 3.75 | – | 143 | 1,083 | 2.25 |
| 331–395 (4,075–4,875) | 1.51 | 1.81 | 1.86 | 1.86 | 1.86 | 1.86 | 1.86 | 0.48 | 0.08 | 0.00 | 4.92 | 4.92 | – | 375 | 2,840 | 2.87 |
| 396–460 (4,888–5,688) | 1.32 | 1.58 | 1.63 | 1.63 | 1.63 | 1.63 | 1.63 | 1.63 | 0.42 | 0.08 | 7.25 | 3.83 | 3.42 | 1,282 | 9,715 | 3.58 |
| 461–525 (5,700–6,500) | 1.17 | 1.41 | 1.45 | 1.45 | 1.45 | 1.45 | 1.45 | 1.45 | 1.45 | 0.44 | 12.99 | 6.50 | 6.50 | 4,108 | 31,125 | 4.34 |
| 526–587 (6,512–7,275) | 1.06 | 1.27 | 1.31 | 1.31 | 1.31 | 1.31 | 1.31 | 1.31 | 1.31 | 1.66 | 26.67 | 13.33 | 13.33 | 10,028 | 75,970 | 5.08 |

**Expected totals on a full 32-wide original map:**
- Ironium 419, Bronzium 502, Silverium 419, Goldium 325, Platinum 250, Einsteinium 191, Emerald 143, Ruby 102, **Diamond 67, Amazonite 44**.
- About 5 of each artifact.
- Hazards: about 1,372 boulders, 660 lava, 471 gas.
- **Total sale value ≈ $32.5M**, about 10× the $3.27M needed to max every upgrade.
- On 05's 48-wide map with the same density: about 1.5×, i.e. about 66 Amazonite and about $49M.

**Implications:**
- (a) **The deepest band is about 53% hazards.** About 1 in 7.5 cells is hidden gas below about −6,500 ft. That is the original's brutality, and on a phone it needs 02/05's "fair tells" decision.
- (b) A **persistent** mine is a **finite** jackpot supply (P1-1).
- (c) This table gives the economy model its pod-income input directly: expected $ per dug cell by depth.

### 3.3 Hazards and quakes (code)

- **Boulders** cannot be drilled ("clink"). Explosives clear them (3×3 / 5×5, wiki).
- **Lava** deals 29 × radiator per hit (58 on a double hit). **Gas** deals `int((depth−3000)/15) × radiator` and looks like dirt.
- **Earthquakes:** each row from 11 to H−15 shifts ±1 tile horizontally (wraparound) with chance 1/(5−intensity). The pod is never entombed. Cadence is unknown, with radio chatter from −1,000 ft.
- **HoleFactory mapping (recommended):** a quake **shears** vertical infrastructure. A lift whose shaft rows shift goes "Misaligned", and Shoring prevents the shift in its 5×5 area. This keeps canon, gives Shoring a precise rule, and replaces 01's "regenerate" and 03's "cave-in" with one mechanic.

### 3.4 Other original facts the plan can use

- **Original surface layout** (tile x in a 36-wide array, buildings at rows 2–4):
  - fuel at x 3–5;
  - Mineral Processor (with the save robot) at x 10–13;
  - Autobuy at x 22–25;
  - Emendation at x 30–32;
  - arena entrance at x 32–33 of row 588 ([MO] `generateEarth`).
- **Sky easter eggs** at +5,000 / +10,000 / +100,000 ft ([CL] checklist). 05's 64-row sky (+800 ft) cannot hold them; decide whether to keep them.
- **NG+:** sale value ÷ level, points × level, boss HP and damage × level ([CL]).
- **CoreLode** is itself a precedent: a clean-room web remake with **renamed** content ("fuel cell", "nano-welders", "discount teleporter", "priority transporter", ores renamed "ferrite → relic"), a 42 Hz deterministic sim, a DOM overlay UI, IndexedDB saves, touch and gamepad support, and **QoL options that default OFF in a "Purist Mode"**. It shows that brief 04's architecture is proven for this genre in TypeScript, and it is a **direct competitor** on the web. Other recent remakes found on GitHub: `gmontero10/motherload` ("mobile web recreation", Feb 2026) and `mjbrisebois/motherload-remake` (May 2026).

### 3.5 Web-platform facts for the iOS floor ([BCD])

| Feature | iOS Safari | Note for HoleFactory |
|---|---|---|
| WebGPU (`navigator.gpu`) | **26** | 04's "WebGL2 baseline, WebGPU opt-in" holds |
| OffscreenCanvas WebGL2 | **17** | Render-in-worker is available on the iOS 17 floor (optional) |
| CompressionStream `deflate-raw` | 16.4 | Native save compression |
| `navigator.audioSession` | 16.4 | Silent-switch control |
| Push API | 16.4, **home-screen apps only** | Optional "Silo full / Depot damaged" notifications |
| Screen Wake Lock | 18.4 full (16.4–18.3 partial, not in standalone) | Request during dives |
| `storage.persist()` | 15.2 | — |
| `dvh` units | 15.4 | — |
| `overscroll-behavior` | 16, partial | Don't rely on it alone |
| `<input switch>` | 17.4 | Haptic side-effect unverified |
| `requestFullscreen` | iPad only (16.4, partial) | iPhone fullscreen means home-screen PWA or Capacitor |
| `ScreenOrientation.lock`, `navigator.vibrate` | **No** | — |

### 3.6 Economy sanity check of brief 03's numbers (my calculation)

Inputs: brief 01 §8.1 trip gross, at 3–5 minutes per trip including the shop; brief 03's rates (Auto-Drill Mk I 15/min × purity, Lift Mk I 30/min, Export fee 5%, Silo 1,000 items, offline cap 8 h at 50–75%).

| Phase (03) | Pod income (01 trips) | One factory source as proposed | Ratio |
|---|---|---|---|
| B, 500–1,500 ft (upgrades $2k–5k) | $2k–4k per trip ≈ **$500–1,300/min** | Scripted Bronzium lode, Normal: 15 × $60 = **$900/min** (smelted ≈ $1,170/min) | ≈ 0.7–2× pod |
| B/C, Goldium lode | same | 15 × $250 = **$3,750/min** | ≈ 3–7× pod |
| C/D, Einsteinium lode (Impure) | Gigantic bay $30k–80k per 5 min ≈ $6k–16k/min | 7.5 × $2,000 = **$15,000/min** | ≈ 1–2.5× pod |
| Offline, overnight | — | Silo-capped: 1,000 Bronzium = **$60k**; Goldium = **$250k**; Einsteinium = **$2M** | 12–100 upgrade tiers' worth while asleep |

- Consumables: 03's crafted **Dynamite** (1 Coalite $10 + 1 Bronze Wire, which is ⅓ of a Bronze Ingot ≈ $40 raw or $65 at sell price, ≈ $50–75 of inputs) replaces a **$2,000** shop item, about **30–40× cheaper**. That breaks 01's "emergency valves at punitive prices" (essential #9).
- The **Fuel Canister** ($40) has **no litre value** defined.
- The **Repair Kit** has **no HP value** defined.
- The **Gem Cutter** at 1.5× turns a Diamond into +$50k and an Amazonite into +$250k per gem, which inflates late income by 50%.

**Conclusion:** 03's target of "factory ≤ 40–50% of income" is right, but its numbers violate it at every phase. Recommended rule for the economy model:
- **Factory $/min at phase N ≤ 0.4 × (pod $/min at phase N)**, with pod $/min computed from the §3.2 E[$]/cell table × the cells dug per minute (§3.1).
- That implies **early lode rates of about 2–6 items/min in total**, not 15 per drill.
- Alternatively, keep 15/min but make lode ore a separate low-grade item, e.g. "Bronzium ore (lode) $8".
- Make Silo caps **value-aware**.
- Price crafted consumables at **≥ 25–50% of the shop price** in input value, or gate them by slow Pod Works throughput.

### 3.7 Mobile viewport arithmetic (what the briefs' layouts actually leave visible)

The HUD (02: 48 + 36 pt) and control zone (about 190 pt) are opaque:

| Device (portrait, own-knowledge sizes, unverified) | Screen pt | Insets top/bottom | Clear world height | pt/tile (05's 9.5 tiles across) | Clear rows |
|---|---|---|---|---|---|
| iPhone SE 2/3 | 375 × 667 | 20 / 0 | 373 pt | 39.5 | **≈ 9.4** |
| iPhone 15/16 (6.1-inch) | 393 × 852 | 59 / 34 | 485 pt | 41.4 | **≈ 11.7** |

05's pass/fail target of "≥ 11 rows below and ≥ 6 above" (17+ rows) is only met if the control zone is **translucent and counted**. Fixes:
- one 44-pt HUD row;
- a translucent stick zone;
- frame the camera against the **clear rect**, not the screen;
- zoom out about 10% on 667-pt-tall devices.

**Tablets:** with 02/05's "constant points per tile" rule, an iPad shows about 20 × 28 tiles in portrait (own estimate). That is about 2× a phone's view, which reveals more of the mine. Decide whether tablets get a capped view or a larger UI scale.

---

## 4. What the briefs got right (keep these as settled)

- The C1 "Diorama Slice+" world (02 + 05): a 2D gameplay plane, 3D presentation, a surface plateau, and a wall-mount layer. It is consistent across 02, 03 and 05, and the original's 2D grid maps onto it 1:1.
- The tech stack (04): TypeScript, three.js `WebGPURenderer` with the WebGL2 backend by default, a DOM overlay, a factory sim in a worker, Capacitor later. CoreLode independently validates the TS + DOM-overlay + fixed-tick + IndexedDB pattern for this genre.
- Touch idioms: a floating stick with push-into-rock to drill (05; the 120 ms hold matches the original's 5-frame rule), ghost-and-confirm, two-finger camera, endpoint-pair lifts and undo (03).
- The essential/modernisable split in 01 §12, and the "pod-only jackpots" principle in 03.

---

## 5. Remaining gaps that block a full GDD and tech plan (prioritised, with recommendations)

### P0: decide before writing the plan

1. **Depot and "return to surface" integrity** (01 vs 03; the user's explicit rule).
   - The user wants "return to the surface before you run out of fuel or drill dies" *and* a factory that brings "resources to the surface". 03's Depot (unload + refuel + repair + lift up) recreates Super Motherload's bases.
   - **Recommend:**
     - Depots refuel and repair only from **stocked consumables delivered by the player's own logistics**.
     - Depots **accept only lode-grade/bulk ore** for lifting. **Gems and artifacts must be carried to the surface by the pod**, or "insured" via an expensive late-game Gem Lift with a 1-item buffer.
     - Cargo left at a Depot is **at risk** from hazards until it is sold.
     - The deep frontier below the deepest Depot is pure Motherload.
   - Quantify: max Depot count per 1,000 ft, and Depot build cost relative to the current upgrade tier.
2. **Failure and save model in a persistent world.**
   - **Recommend:**
     - (a) A **resume snapshot** saved often for app kills (04's 30 s autosave), plus a **checkpoint** at surface or Depot docking.
     - (b) **Pod death:** cargo lost, the pod is towed or rebuilt for a **salvage fee** (for example 10–20% of the pod's current part value, or the cost of the next upgrade tier). The player respawns at the surface. The factory **is not rolled back**.
     - (c) An optional "Purist/Hardcore" mode where death costs a random installed part tier.
   - Define what the factory does while the pod is dead (keeps running).
3. **Economy model.** Build a spreadsheet or sim script before content:
   - pod $/min by phase (from §3.1 + §3.2);
   - factory $/min caps (≤ 0.4×);
   - offline cap by value;
   - consumable crafting floors;
   - upgrade prices × component requirements.
   - Brief 03's numbers must be retuned (§3.6).
4. **Is fuel still the master clock late?** Code-faithful fuel stops binding after the top drill. Pick one:
   - (a) accept that hull, weight and gas take over late, and design the late interlock around **weight** (lifts for bulk ore) and **hull** (Depot repairs);
   - (b) make depth cost fuel, e.g. +x% burn per 1,000 ft of "heat" (a HoleFactory invention, flagged by 01 §5);
   - (c) shrink the late tanks.
   - Brief 03's "biggest interlock" depends on this decision.
5. **Canonical numbers.** Adopt §6 so that art, sim and tech stop disagreeing.
6. **Time model.**
   - Does the world pause in build mode, shop menus or the map? Recommend: the pod and hazards pause in modal shops; the factory keeps running; build mode underground pauses the pod's clock (idle burn is 0 anyway).
   - Does the factory tick while the pod is in a shop? Yes.
   - Fixed rate: pod 42 Hz (canon constants) vs 60 Hz (04). Pick one and convert.
7. **IP and naming.**
   - Motherload names (Ironium, Goldium, Amazonite, Mr. Natas, Autobuy 2000, Emendation Station 3500, Propellent Vendor 12000, transmissions text) are XGen Studios' expressive content. XGen still sells Goldium and re-hosts the web game (01 [S6]; CoreLode's checklist references xgenstudios.com/play/motherload).
   - Game mechanics are generally not protectable, but names, text and art are (general legal knowledge, **unverified for this case; get counsel**).
   - **Recommend:** clean-room names and script (CoreLode precedent), the same ×2–×5 value ladder, and no use of "Motherload" in marketing beyond "inspired by".
   - Also check the **"HoleFactory"** name: GitHub has no repos with that name; App Store and trademark checks were blocked here.
8. **User-intent questions** (§7 Q1–Q3): drill durability, vehicle purchase, and the factory's purpose.

### P1: needed for a complete plan

1. **Finite ore and renewal.** Choose one:
   - quakes re-roll undug cells (not canon);
   - deeper procedurally generated "claims" or new mine sites bought with factory output (fits the factory);
   - a season or NG+ reset of the mine only, with the factory kept;
   - lode-only renewal, keeping gems finite.
   - Also decide the ore density on a 48-wide map (05 §6.4).
2. **Quake trigger.** Define the cadence (e.g. a chance per minute that rises with depth reached, first after the −1,000 ft transmission) and the canon row-shift effect on mounts and Shoring (§3.3).
3. **Kit delivery and chute rules** (X17). Either kits can only be placed from the pod's cargo, or chutes may deliver only to Depots the pod has "activated". Also decide whether lifts can carry gems (P0-1), and set kit weights.
4. **Merged upgrade table.** Motherload's 7 tiers × 6 lines plus 03's component requirements, starting at a named tier (03's "Mk III" doesn't map to Motherload tiers). Decide whether a **Scanner** (gas tells, lode survey) and a **Headlight** (02's light bubble) become extra lines, which would break 01's "six lines".
5. **Gas capping needs detection.** 03's "pod caps gas pockets" requires a way to find invisible gas (scanner, hiss, or "reveal on adjacent dig"). This ties to 02/05's fairness question.
6. **Device and layout matrix.**
   - iPhone SE 375 × 667, notch/Dynamic Island phones, Pro Max, iPad portrait and landscape, Android 20:9 and 19.5:9, foldable inner screens.
   - Rules for HUD clear-rect framing (§3.7), a **left-handed mirror** option, a control-size setting (CoreLode has one), and UI scaling with system text size.
7. **Build ownership on the surface.** 05 Q1: does the pod drive on the plateau? If build mode is camera-only, can you build on the surface mid-dive? Recommend yes (the pod is paused or idle), which affects the time model.
8. **Cross-thread authority** (04). Define the single writer for:
   - **cash**: worker or main?
   - **Depot inventories** that the pod reads and writes: refuel, unload;
   - **terrain**: main thread, but quakes move mounts that the worker owns.
   - Recommend: one authoritative sim thread for terrain + economy + factory, with the pod's physics predicted on the main thread and reconciled. Or a two-phase command/ack for dock transactions.
9. **Unified roadmap.** 02 (style test M0), 03 (8-building MVP), 04 (4 tech weeks) and 05 (2-week prototypes) have separate milestones. Merge them into one vertical slice: surface + 600-row slice + pod loop + Smelter/Belt/Lift/Depot + save + PWA.

### P2: polish-level gaps (no brief covers them)

- **Audio direction:** a SFX list per action, a depth-reactive music plan, ambience. 04 covers tech only. CoreLode synthesises everything with ZzFX and Web Audio, a zero-asset option.
- **Narrative:** a clean-room transmission script, the antagonist (01 suggests corporate horror), tone vs. cozy (02 Q7), and age rating.
- **Onboarding:** a scripted first 20 minutes. 03's Phase A is pure Motherload, and the factory is introduced via the first lode; needs step-by-step beats.
- **Monetisation:** premium vs F2P (03 Q7). This decides whether offline progress, speed-ups, IAP plumbing (RevenueCat) and ads exist.
- **Accounts and cloud save:** export codes only (04), iCloud via Capacitor, or a backend. Also leaderboards (01 suggests them) and Game Center.
- **Telemetry and privacy:** 05 wants mis-dig telemetry, but there is no analytics or consent plan. App Store privacy labels.
- **Localisation and accessibility:** colourblind (02) and reduced motion (02) are covered. Missing: text scaling, VoiceOver for menus, hold-vs-toggle thrust, and a one-handed mode (05 has a draft).
- **Controller and keyboard** support (desktop dev/test, iPad with keyboard, MFi). Cheap with the Gamepad API.

---

## 6. Proposed single source of truth (reconciles X1–X15)

| Parameter | Proposed canonical value | Basis |
|---|---|---|
| Tile | 1 world unit = 12.5 ft | Original (1 ft = 4 px, 50 px per tile) |
| Mine | **48 wide × 608 rows**; diggable rows 0–583; barrier at row 584 with a 2-tile gap at the right edge; arena 585–607 | 05, original barrier at array row 588 |
| Ore algorithm | Original `generateEarth` with tier step **65 rows**; adjust density for 48 wide | §3.2 |
| Hazard onsets | Boulders **−1,612 ft** (row 129 of the 0-based mine), lava **−3,275 ft** (row 262), gas **−4,950 ft** (row 396) | §3.2 (0-based row ≈ original row − 5) |
| Strata bands (art) | B0 0–250, B1 250–800, B2 800–1,600 (stone begins), B3 1,600–3,275, B4 3,275–4,950 (lava), B5 4,950–6,000 (gas), B6 6,000–7,300, B7 arena | 02's palette, re-anchored to code onsets |
| Pod constants | Original per-frame constants at 42 Hz, or converted for 60 Hz; HoleFactory-specific lift curve | §3.1 |
| Surface plateau | 48 × 32 buildable, starting at 48 × 8 | 05 |
| Block depth | 1.5 units (z −1.0 to +0.5); mounts at z −1.0 to −0.45 | 05 |
| Camera | Underground play yaw 20°/pitch 20°, **9.5 tiles** across, framed to the clear rect; underground build 8°/12°, 8 tiles; surface play 45°/35°, 11 tiles, fixed; surface build 45° + n·90°, pitch 55°, ≥ 44 pt on the short axis | 05 (supersedes 02's widths) |
| Render chunks / sim bands | 16 × 16 / 64 rows | 04 |
| Footprints underground | ≤ 2×2, except the Depot at 3×2 | 03, 05 |
| Device floor | iOS/iPadOS 17+ (iPhone XS/XR and newer); iOS 26 tier = iPhone 11+; Android 10+, Chrome 121+ | 04; drop 02's iPhone 8 |
| Controls | Floating stick; push-into-rock to drill with a > 5-frame (≈ 120 ms) hold; stick-up thrust; optional THRUST button; items 56–64 pt | 05 + original |

---

## 7. Consolidated open questions for the user (deduplicated across briefs, highest impact first)

1. **"Drill dies":** in Motherload the pod dies when the **hull** reaches 0. Do you want **drill wear/durability** as a separate clock (new), or did you mean hull?
2. **"Purchase your vehicle":** only part upgrades (Motherload), or **multiple pods/vehicles** (e.g. a cheap scout, a heavy hauler, a late drill rig)?
3. **Factory's role:** should automation move **only bulk ore** while the pod must still bring gems home (recommended), or may lifts carry everything?
4. **Death penalty** with a persistent factory: salvage fee (recommended), lose a part tier, or classic reload?
5. **Names and IP:** keep Motherload's exact names and story (legal risk), or clean-room equivalents with the same feel (recommended)?
6. **Art:** clean low-poly toon (recommended), "Pixel Lab" (LRL-like), or both? (02 Q1, 03 Q1)
7. **Orientation:** portrait-first with landscape support (all briefs recommend this)?
8. **Offline progress:** none, value-capped (recommended), or idle? **Monetisation:** premium or free-to-play?
9. **Hazard fairness:** keep invisible gas (canon) or add tells/scanner? Should hazards damage factory buildings?
10. **Platform:** web/PWA first, then Capacitor (04), or straight to the App Store?

---

## 8. Sources

New in this critique:
- CoreLode calibration (bytecode-derived constants): https://raw.githubusercontent.com/2Tricky4u/CoreLode/HEAD/docs/calibration.md
- CoreLode fidelity checklist: https://raw.githubusercontent.com/2Tricky4u/CoreLode/HEAD/docs/fidelity-checklist.md
- CoreLode README/architecture: https://raw.githubusercontent.com/2Tricky4u/CoreLode/HEAD/README.md (repo https://github.com/2Tricky4u/CoreLode)
- Mocha2007 port of `generateEarth()` and the mineral table: https://raw.githubusercontent.com/Mocha2007/mocha2007.github.io/HEAD/tools/motherload.js
- MDN browser-compat-data: https://github.com/mdn/browser-compat-data (raw JSON files listed in the header)
- Other remakes found via GitHub search: https://github.com/gmontero10/motherload , https://github.com/mjbrisebois/motherload-remake , https://github.com/h1ddengames/Motherload-Clone
- Local scripts: `scratchpad/crit/oredist.py` (ore and hazard distribution), plus the inline physics calculation in this session.

Briefs critiqued: `01-motherload-mechanics.md`, `02-art-direction.md`, `03-factory-design.md`, `04-tech-stack.md`, `05-world-structure.md`, all in this folder. Their own sources are listed in each brief.

Blocked or unavailable this session: WebSearch (budget exhausted); WebFetch and curl to wikipedia.org, apple.com, support.apple.com, steampowered.com, xgenstudios.com, wiki.gg, apps.apple.com and uspto.gov (egress 403).
