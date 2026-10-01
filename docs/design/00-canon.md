# 00 — HoleFactory Canon (rev 2)

**Status:** binding single source of truth; it wins over every other document and brief. Values change only with a §8 line. **[tune]** = playtest may move it. **Provisional** = analytic estimate until the economy bot measures it.

**Ownership (R0b).** This file owns constants, rules, the glossary (§2), touch constants (§3.12), the scope ledger (§5.5) and the change log (§8). Everything else has one owner, cited as:
- `01` = `docs/design/01-game-design.md`: pod mechanics, world generation, upgrade table, story, onboarding;
- `02` = `02-factory.md`: buildings, items, recipes, factory economy, Away-budget formula, sim rules;
- `03` = `03-ux-art-audio.md`: gestures, layouts, ore codes, UI, art, audio;
- `04` = `04-tech-architecture.md`: engine, data model, save format, rendering, testing, CI, tasks.

Section numbers largely follow each document's rev-1 numbering (04 §3 is renumbered).

**Conventions**
- Row r = 0-based mine row below the Rim; it spans 12.5r to 12.5(r + 1) ft.
- mu = mass unit (Hematite = 1 mu, shown as 10 kg).
- t1–t7 = upgrade tiers. Phases A–E2: §4.3.1.
- "Original" = the 2004 game (brief 06). Its values are reference; its names and text never ship.

---

## 1. Decisions

| # | User decision (final) | Consequence |
|---|---|---|
| D1 | **Surface Yard + slab mine.** Isometric 3D plateau; underground 2D grid (x, depth) rendered as a 3D cut-away slab. | Two build planes, one ray–plane pick per touch, no voxels. Lifts, chutes, lamps and shoring are back-wall mounts the pod flies past. |
| D2 | **Auto-Drills automate only pod-discovered Lodes**; ore rises by belts and lifts; the early game is pure Motherload. | Scattered ore is pod-only. First automation follows the scripted lode at 575 ft (≈ 20 min). |
| D3 | **Portrait-first.** | Designed at 375×667 and 393×852 pt. Web never locks orientation; M0/MVP show "Turn your phone upright" (§4.5); v1 adds landscape rails. Capacitor locks portrait. |
| D4 | **Web first:** TypeScript + three.js PWA; Capacitor later. | three r186 classic `WebGLRenderer` (WebGL2) + GLSL: `MeshToonMaterial` + `onBeforeCompile` (Toon), `ShaderMaterial` passes (Pixel Lab). TSL, `WebGPURenderer` and WebGPU are post-launch. |
| D5 | **Build "Clean Toon" and "Pixel Lab" for the M0 style test; the user picks.** | One scene and palette; `look = toon \| pixel`. Render contract §5.1. Art production starts after the pick. |
| D6 | **Cozy top, eerie depths;** original story and names. | Warm surface; from the first Hardrock, Channel Zero, static, silence. Never demonic or religious; E10+ / PEGI 7. Rules §2.12. |
| D7 | **Offline progress: modest and capped.** | v1 Away budget (§4.3.6). MVP: the factory sleeps while the player is away. |

| # | Assumption / interpretation (user-overridable) | Consequence |
|---|---|---|
| A1 | Single-player | No netcode; the factory stays deterministic for tests and catch-up |
| A2 | Local saves + export code; no accounts or cloud | §3.15 |
| A3 | No monetisation in v1, none designed out | Empty `store` interface; no ads, IAP or paid skips |
| A4 | Procedural geometry + CC0 packs | Palette-snap pipeline; `assets/CREDITS.md` |
| A5 | Destruction loses the trip's cargo plus a fee; nothing rolls back | §4.2 |
| I1 | "Drill dies" = hull 0 or fuel 0 | No wear meter |
| I2 | "Purchase your vehicle" = part upgrades on 7 lines | Chassis post-launch |
| I3 | Gems and relics travel only in pod cargo; cut gems and gem parts stay on the surface | §4.9 |

---

## 2. Glossary

Names are exact; every document uses them.

### 2.1 World, cast and story

| Name | Meaning |
|---|---|
| **HoleFactory** | The game (trademark check, §7) |
| **Claim 7**, Hollow Basin, Mars | The mine site |
| **Hollowell Mining Co-op** ("the Co-op") | Small family employer; pays the depth incentives |
| **Dot Hollowell** | Dispatcher; cozy surface voice and tutorial guide |
| **Seven** (Claim Operator) / **Pip** (PIP-7) | The silent player / their dig pod |
| **Marlow**, pod *Bucket* | Rival lease-holder on **Claim 6**; trades lode surveys; never trapped, lost or retiring |
| **Wren Hollowell** | Dot's grandmother, Co-op founder; appears only in writing |
| **Deepreach Concern** | Defunct predecessor; its crews vanished |
| **Channel Zero** | Dead radio band; counts from the first Hardrock |
| **the Surveyor** | The Claimant's projected voice on Channel Zero; polite, archaic; no body |
| **the Claimant** | The boss: an ancient boring machine-organism that "filed the first claim on Mars" |
| **the Hollow Heart**; **the Seal** / **the Notch** | Arena (rows 585–607); bedrock row 584 / its gap at x 46–47 |
| **the Static Zone** | Altimeter scramble, rows ≥ 465 (5,813 ft) |
| **the Yard** / **the Rim** | Surface plateau / pod-only road along row 0 |
| **the First Deed** | Unsellable story item; delivering it ends the game |
| **Starter Kit** | Free on discovering the scripted lode: Auto-Drill Kit Mk I, Lift Foot Kit Mk I, Lift Rail, 2 Belt Kits (5 slots, 14 mu); at the Supply Shed |
| **Dot's survey shaft** | Pre-dug shaft to the scripted lode, with a rusted Headframe (§3.2) |
| **Tutorial Patch** | Worldgen post-pass, rows 1–8 × x 5–11 |
| **`FirstLiftDelivery`** | Event: first lode ore delivered to a Headframe by a lift ("first lode automated") |
| **Return Tick** | Fuel-bar marker of estimated climb cost; bar red below 1.25× it (§4.4) |
| **Co-op Credit** | Free 5 L when cash < $5 and fuel < 2 L, once per 10 min |
| **Co-op debt** | Unpaid salvage fee, taken from the next Assay sale |
| **Co-op Plans** | Unlock-ladder checklist in Dot's office (no research building) |
| **Shopping list** | Chip listing the Kits a ghost plan needs |
| **Unknown seam** | Lode rock of an out-of-scope lode; undrillable, undiscoverable |
| **Hoard Alcove** / **Deepreach Locker** / **Heartstone** | Arena niche holding the hoard / arena supply locker / indestructible arena rock |
| **Safe Mode** / **Perf Report** | Crash-recovery boot screen / in-app performance export code |

### 2.2 Minerals (pod-mined specimens)

Values and masses equal the original ladder. Tiers 1–6 are **bulk** (may ride logistics); 7–10 are **gems** (pod-only underground). Visual codes: 03 §8.4 (Iridium hex prism; Peridot pear cut).

| Tier | Name | Value | Mass | First / common (row) |
|---|---|---|---|---|
| 1 | **Hematite** | $30 | 1 | r1 / r1 |
| 2 | **Copper** | $60 | 1 | r1 / r1 |
| 3 | **Cobalt** | $100 | 1 | r1 / r1 |
| 4 | **Gold** | $250 | 2 | r1 / r125 |
| 5 | **Iridium** | $750 | 3 | r60 / r190 |
| 6 | **Thorium** | $2,000 | 4 | r125 / r255 |
| 7 | **Peridot** | $5,000 | 6 | r190 / r320 |
| 8 | **Fire Opal** | $20,000 | 8 | r255 / r385 |
| 9 | **Diamond** | $100,000 | 10 | r320 / r450 |
| 10 | **Echo Quartz** | $500,000 | 12 | r385 / r515 |

### 2.3 Relics and core hoard

Relics: from r76 at 1 per 500 cells × ⅔; mass 1; pod-only; Assay only. **≥ 6 Lost Pod Recorders per seed.**

| Relic | Value | Hoard item (R22; 1 slot, 1 mu each) | Value |
|---|---|---|---|
| **Fossil Shell** | $1,000 | **Wren's Survey Chain** | $250k |
| **Prospector's Strongbox** | $5,000 | **Brass Theodolite** | $350k |
| **Lost Pod Recorder** (plays a Deepreach log) | $10,000 | **Deepreach Logbook** | $450k |
| **Sigil Tablet** | $50,000 | **Claimant Lens** | $750k |
| | | **Heartstone Core** | $1.2M |
| | | **the First Deed** | unsellable |

Hoard sellable total **$3.0M**; no value equals an original loot value.

### 2.4 Rim services

Four 4×3 buildings on Yard rows 1–3, each with a Rim pad. **Pad arming:** a pad (or Depot dock, or Locker) arms when the pod enters it and disarms when its sheet opens; it re-arms after the pod leaves the footprint or is airborne ≥ 0.2 s. Respawn lands disarmed. A sign tap always opens the sheet. Saving is automatic.

| Building (Rim x) | Services |
|---|---|
| **Pump House** (1–4; spawn x 7) | Fuel $1/L; Co-op Credit |
| **Assay Office** (10–13) | Sells specimens, gems, relics at 100%; Sell/Stockpile toggle; collects Co-op debt; Dot's office (log, Co-op Plans, expansions, stats) |
| **Garage** (30–33) | Upgrades; repair $15/HP; a hull tier repairs free |
| **Supply Shed** (40–43) | Consumables; Kits; Starter Kit; v1: **Weld Pack $500, Fuel Drum $30** |

### 2.5 Strata bands

B0 Rust Flats r0–19 · B1 Ochre Beds 20–63 · B2 Clay Deeps 64–128 · B3 Violet Shale 129–261 (Hardrock) · B4 Blue Basalt 262–395 (Magma) · B5 Obsidian Hush 396–479 (Methane) · B6 Ember Mantle 480–583 · the Seal 584 · B7 the Hollow Heart 585–607. Edges dither over 3–6 rows. Palettes 03 §8.3; music groups B0–1 / B2–3 / B4–5 / B6–7 (03 §11.2).

### 2.6 Pod upgrade lines

Six original lines plus **Scanner**. No Headlight line: light is a fixed 4.5-tile bubble plus a fixed 40°/7-row drill cone (0.6) and the Bright Mines setting. Parts: §4.3.5; counts 01 §5.1; visuals (3 geometry steps + per-tier trim) 03 §8.6.

| Tier / price | **Drill** s/tile (steps) | **Hull** HP | **Engine** hp / hover cap mu / climb max | **Tank** L | **Radiator** × | **Bay** slots | **Scanner** |
|---|---|---|---|---|---|---|---|
| t1 $0 | Stub Bit 0.483 (29) | Tin Can 10 | Putter 150/100/7.0 | Thimble 10 | Desk Fan 1.0 | Satchel 7 | Tin Ear |
| t2 $750 | Corkscrew 0.333 (20) | Rivet Hull 17 | Chugger 160/125/8.0 | Canteen 15 | — | Basket 15 | — |
| t3 $2,000 | Twin Screw 0.233 (14) | Boilerplate 30 | Thumper 170/160/9.0 | Jug 25 | Box Fan 0.9 | Trunk 25 | Dowser |
| t4 $5,000 | Auger 0.183 (11) | Ironclad 50 | Growler 180/220/10.5 | Keg 40 | Coil Sink 0.75 | Crate Rack 40 | — |
| t5 $20,000 | Grinder Bit 0.133 (8) | Bulwark 80 | Roarer 190/320/12.0 | Cask 60 | Twin Coil 0.6 | Wagon 70 | Echo Sounder |
| t6 $100,000 | Glasscutter 0.100 (6) | Bastion 120 | Twin Roarer 200/460/13.5 | Vat 100 | Frost Loop 0.4 | Freight Hold 120 | Deep Eye |
| t7 $500,000 | Starbore 0.083 (5) | Starshell 180 | Thunderhead 210/620/15.0 | Cryo Flask 150 | Cryo Lattice 0.2 | — | Claimsight |

Cost to max: **$3,887,750**. Scanner: Tin Ear (lode on adjacency; Sniffer 2) · Dowser (lodes r6 + purity; Sniffer 3) · Echo Sounder (directional Sniffer 4; relic ping 6) · Deep Eye (exact methane 3; lodes 12) · Claimsight (exact methane 6; relics shown 8).

### 2.7 Consumables

No slots, no mass; carry ≤ 9 each; 4 quick slots; cooldown 7 steps; arming §3.12. v1 Pod Works recipes: 02 §4.4.

| Name | Price | Effect | Use |
|---|---|---|---|
| **Jerrycan** | $2,000 | +25 L | any time |
| **Patch Kit** | $7,500 | +30 HP | any time |
| **Pop Charge** | $2,000 | Clears 3×3; boss ≤ 120 | grounded |
| **Mega Pop** | $5,000 | Clears 5×5; boss ≤ 240 | grounded |
| **Hop Beacon** | $2,000 | Random Rim x at +6…+14 rows; unbraked landing 5–6 HP | grounded |
| **Homing Beacon** | $10,000 | Safe to the Pump House pad | grounded |

### 2.8 Factory buildings and items

Definitions, costs, power and recipes: 02 §3–§4. Canon numbers: §3.11.
- **MVP buildings:** Belt Mk I, Router, Storage Bin, Smelter, Assembler, Export Terminal, Headframe, Auto-Drill Mk I, Bucket Lift Mk I (+ Lift Rail).
- **v1 buildings:** Belt/Auto-Drill/Bucket Lift Mk II–III, Silo, Depot, Chute, Shoring Brace, Lamp, Refinery, Pod Works (≤ 2), Gem Cutter, Co-op Generator, Solar Array, Power Plant, Magma Tap, Gas Tap. The Headframe gains a chute-mouth mode.
- **Lode ore** (0.1 × specimen): Hematite Ore $3, Copper Ore $6, Cobalt Ore $10, Gold Ore $25, Iridium Ore $75, Thorium Ore $200; **Kerogen** $2.
- **Ingots** (2 × ore × 1.3): Iron $8, Copper $16, Cobalt $26, Gold $65, Iridium $195, Thorium Rod $520.
- **Parts:** Gear, Wire, Hull Plate, Coolant Coil, Circuit, Motor, Drill Bit, Pressure Vessel, Reactor Core.
- **Cut gems:** Cut Peridot, Cut Fire Opal, Cut Diamond (Echo Quartz has no cut form). **Gem parts:** Lens, Opal Plating, Diamond Bit. Both are **unsellable and non-exportable**. Book value = Σ inputs × 1.0, for display and the away cap only: Lens $5,125; Opal Plating $20,110; Diamond Bit $100,530.
- **Depot service items:** **Fuel Drum** (10 L, 5 mu), **Weld Pack** (15 HP, 3 mu). The pod uses them only at a Depot dock (Packs also pay for Realign); Power Plants burn Drums.
- **Kits:** Belt (8 tiles), Router, Auto-Drill, Lift Foot, Lift Rail, Depot, Chute (16 rows), Shoring, Lamp (×4), Magma Tap, Gas Tap; plus the Starter Kit bundle.
- **Stockpile** = contents of all Bins and Silos; the Garage, Supply Shed and Yard crane draw from it directly.

### 2.9 Lodes

A **Lode** is a 3×2 block of undrillable, unblastable **lode rock** with one metal (or Kerogen) and a **Purity**: Poor ×0.5 (40%), Normal ×1 (45%), Rich ×2 (15%); Thorium Poor 60 / Normal 40. Fixed purity: the scripted Copper (Normal) and the R12 Iridium and Thorium lodes (Poor). One Auto-Drill sits on its top. **Discovered** = within Scanner radius; shown on the map.

### 2.10 Hazards

Hardrock (r129), Magma Pocket (r262), Methane Pocket (r396; looks like dirt), **Deep Floor** (r ≥ 516: hazard p = 1, no plain dirt; 01 §3.8), Shear (v1; §4.7), Hard Landing, Static Zone (r465). Effects: §3.3.

### 2.11 Names that never ship

- Ironium, Bronzium, Silverium, Goldium, Einsteinium, Amazonite; Mr. Natas, Natas HI Inc., Satan imagery.
- Propellent Vendor, Mineral Processor, Autobuy, Emendation Station, Reserve Fuel Tank, Hull Repair Nanobots, Quantum Teleporter, Matter Transmitter, Core Teleporter.
- Every original part name: Silvide Drill, mineral-named drills and hulls, Energy-Shielded Hull, V4–V16 Jag engines, Micro … Leviathan and Liquid Compression tanks and bays, Stock Fan, Dual Fans, Single/Dual Turbine, Puron, Tri-Turbine Freon Array.
- Pod #3422-2, Pod #10043, "the motherload" as a phrase, the −66,666 ft readout.
- CoreLode's "fuel cell", "nano-welders", "discount/priority teleporter/transporter".

### 2.12 Story originality rules (R21)

1. No beat fires at an original transmission depth (0, 500, 1,000, 1,750, 2,100, 2,500, 3,100, 3,500, 4,100, 4,500, ~5,800, 6,200, 7,000 ft). **Exceptions:** the three incentive beats, which carry only the incentive, and the game-start card, which carries only "refuel at the Pump House".
2. Other beats trigger from HoleFactory systems (§3.9).
3. No character follows an original arc: no retiring veteran, no trapped or lost operator, no "jackpot, then silence", no employer turning on you.
4. Hazard warnings attach to the hazard's first tell, never to a depth. There is no altimeter-certification line.
5. **Radio cards:** ≤ 90 characters; ≤ 4 per beat. A 1-line ticker (sender + 28 characters) while moving; the full card when grounded and idle ≥ 0.6 s or on "›". Auto-advance after max(4 s, 60 ms × characters). Never blocks input. Enforced by CI lint.

---

## 3. Constants

### 3.1 World geometry

| Item | Value |
|---|---|
| Tile | 1 world unit = 12.5 ft. x right (0–47); y up, y = 0 at the Rim, row r centred at −(r + 0.5); z toward the camera. |
| Mine | **48 × 608.** Row 0 turf; diggable 0–583; Seal 584; Hollow Heart 585–607 (authored). Sky 64 rows. |
| Yard | **48 × 32** buildable at z ∈ [−33, −1]; starts 48 × 8. Expansions +8 rows: I $2,500 (MVP); II $25,000, III $250,000 (v1). |
| Rim | 48 × 1 at z ∈ [−1, +0.5]; pod-only. Paved cells under the four pads are undiggable. |
| Slab | Solid cells z −1.0…+0.5. Mount layer z −1.0…−0.45; pod and occupants −0.45…+0.45. |
| Cell | terrain u8, flags u8 (seen, charted, anchored, …), mount u16, occupant u16. ≤ 1 mount and ≤ 1 occupant per cell; both only if the mount is a Lamp or Shoring Brace. Occupants block the pod; mounts (Belt, Router, lift, chute, Lamp, Shoring) do not. |
| Footprints | Underground ≤ 2×2 (Depot 3×2). Surface 1×1, 2×2, 3×3; Rim buildings 4×3. Height ≤ 1.6 units (Headframes, Rim landmarks ≤ 3). |
| Chunks / bands | 16 × 16 chunks (mine 114, Yard 6), remesh dirty only. 64-row bands (0–9) for worldgen sub-seeds and Depot spacing. |
| Map | 48 × 608 DataTexture. Charted = within 8 tiles of any cell the pod occupied. |
| Pod | 0.86 × 0.78 × 0.8 units; fits a 1-wide shaft |

### 3.2 World generation

**Full world from M0 (R5):** every build generates the whole v1 world (48 × 608, 23 lodes, Seal, Hollow Heart). Scope hides content; it never changes generation. In the MVP, Kerogen and Thorium lodes show as Unknown seams, and the r320 temporary Seal is a collision and render overlay. Generation **freezes at the MVP**; later changes are save migrations. CI checks identical terrain and lode bytes under every scope.

**Cell pass, rows 1–583:** `sfc32`; band sub-seed `hash(seed, band)`; the original `generateEarth` rule verbatim with o = r + 5, H = 600:
1. mineral seed p = 1/5, tier spread ⌊o/65⌋ + 2, 80/16/4% branches;
2. relics: ¼ of the 4% branch when o > 80;
3. hazard replaces dirt with p = 1/⌊(H − o)/H × 15⌋: Hardrock (r129–261); Hardrock/Magma 50/50 (r262–395); Hardrock 50 / Magma 25 / Methane 25 (r ≥ 396);
4. ⅓ cavern override to air.

Totals are 1.5× the original. Expected ore and relic value ≈ **$49.5M**; counts in 01 §4.3.

**Post-passes, in order**
1. **Tutorial Patch:** rows 1–8 × x 5–11, no air, ≥ 5 bulk specimens.
2. **Seeded Gold:** one at rows 12–20, x 2–12.
3. **Lodes** (table below). All lode cells in x 2–43. No two lodes are both < 8 rows and < 6 columns apart.
4. **Forced diggable:** the 3×2 above each lode has no hazard.
5. **Dot's survey shaft:** air in rows 0–45 of column c, beside the scripted lode (x0 − 1 or x0 + 3), where c is a valid Headframe column (02 §2.2). The Yard starts with a rusted Headframe on c, a Storage Bin and a Smelter ($0, deconstructable).
6. **Recorders:** ensure ≥ 6 Lost Pod Recorders.
7. **Seal** (Notch open at x 46–47) and the Hollow Heart stamp (01 §7.6).

Distribution tests exclude cells set by passes 1–5 (04 §11.1).

**Lode table (R12, R17)**: 20 metal + 3 Kerogen.

| Rows | Lodes | Scope |
|---|---|---|
| 0–64 | **Copper, scripted:** Normal, top r46, cells in x 14–33. **Hematite ×2** at rows 50–64. | MVP |
| 65–129 | Copper ×2, Cobalt, Kerogen | MVP; Kerogen v1 |
| 130–194 | Cobalt, Gold, Kerogen | MVP; Kerogen v1 |
| 195–259 | Gold, **Iridium (Poor, fixed)**, Kerogen | MVP; Kerogen v1 |
| 260–324 | Gold, Iridium; tops ≤ r315 | MVP |
| 325–389 | Iridium, **Thorium (Poor, fixed)** | v1 |
| 390–454 | Iridium, Thorium | v1 |
| 455–519 | Thorium ×2 | v1 |
| 520–583 | Thorium ×2 | v1 |

**Map pings (Dot):** the scripted lode at the first pass of r32; the Poor Iridium lode at r180; the Poor Thorium lode at r310 (v1).

### 3.3 Hazards and damage

| Hazard | Rule |
|---|---|
| Hardrock (r129) | Drill refused ("clink"); blast it |
| Magma Pocket (r262) | Breach: 2 hits of 29 × R, 6 steps apart (**58R**); no adjacency damage |
| Methane Pocket (r396) | Breach: **⌊(12.5 × y_pod − 3000)/15⌋ × R** once (130R → 286R). Clears the 3×3 except Hardrock, lode rock, Seal and anchored cells; destroys ore there; buildings there become **Damaged** (Shoring Brace immune). |
| Hard Landing | v > **5.88 tiles/s**: −⌊0.5952 v⌋ HP (3 at threshold, 8 at terminal) |
| Explosives | Clear terrain, Magma and Methane safely; destroy ore and relics; **never** hurt the pod or buildings or touch lode rock, Seal, Heartstone or anchored cells |
| **Anchored cell** | Directly beneath an underground Belt, Router or occupant. Undrillable ("thunk", "Supports a belt — remove it first"); explosives and methane skip it. Lamps, Shoring, lift and chute cells do not anchor. |
| Radiator R | ×1.0 / 0.9 / 0.75 / 0.6 / 0.4 / 0.2 |

### 3.4 Camera

Orthographic; ppu = pt per world unit; tiles across at 393 pt. Perspective FOV 20° is an M0-only A/B flag.

| Mode | Yaw / pitch | ppu | Zoom |
|---|---|---|---|
| Surface play | 45° / 35° | 36 (≈ 11 tiles) | 24–60 |
| Surface build | 45° + n·90° / 55° | ≥ 39; ≥ 44 with a 1×1 tool. Tap metric: inscribed circle ≥ 35 pt + nudge arrows. | 39–64; 4 yaw snaps |
| Underground play | 20° / 20° | **41**; 38 if viewport < 700 pt tall; Safari tab min(cap, ch ÷ (R cos 20°)), floor 32 | 30–56 |
| Underground build | 8° / 12° | ≥ 47 | 47–60 |
| Arena | 20° / 20° | **26** (≈ 16 tiles) | fixed |
| Phone landscape (v1) | 20° / 20° | 34; grounded anchor 30% | — |

- **Blend:** t = smoothstep(0, 4, rows below the Rim) lerps yaw, pitch, ppu, ambient, fog.
- **Follow:** spring ω = 8 rad/s; dead zone ±1 tile; look-ahead 1.5.
- **Anchors** (from the clear rect's top): Rim 68%; sky 50%; grounded, digging or falling 35%; climbing 62%, entered at v_up > 1.0 tiles/s for 0.3 s and left at < 0.3 for 0.3 s (0.6 s blend).
- A touch freezes framing until it ends. Milestone shots wait for the next Rim arrival.
- **Visibility rule** (descending, portrait): ≥ **6 fully clear rows below** the pod (above the control zone, under no card), ≥ 10 counting the translucent zone; ≥ 5 above (≥ 4 fully clear while a card shows).

### 3.5 Simulation rates

| Item | Value |
|---|---|
| Authority | One main-thread simulation (§4.10) |
| Pod and world | Fixed **60 Hz**; accumulator clamp 0.25 s; ≤ 5 steps per frame |
| Factory | Fixed **20 Hz** from the same accumulator; ≤ 2 ticks per frame |
| Render / HUD | Display rate, interpolated: 60 fps, 30 in battery mode (120 Hz post-launch) / DOM ≤ 10 Hz |
| Determinism | Factory integer maths, seeded PRNG, stable ids, golden hashes; pod floats at fixed dt |

### 3.6 Pod constants (60 Hz)

| Constant | Value |
|---|---|
| Gravity / drag / ground friction | **11.537 tiles/s²**; airborne vx, vy × **0.985958** per step; grounded vx × **0.957612** with no drive input |
| Fall | Terminal ≈ 13.5 tiles/s; cap 16.8 |
| Mass / thrust | M0 = **200 mu**; m = Σ cargo mass; **T_e = g(M0 + C_e)**, C_e = hover cap |
| Vertical | a_y = s_t T_e/(M0 + m) − g, then drag, clamp v_y ≤ V_up. s_t = clamp((stick_y − 0.35)/0.65, 0, 1); THRUST button = 1.0. |
| Horizontal | a_x = s_x × 0.4 T_e/(M0 + m); \|v_x\| ≤ **4.5 tiles/s** [tune] |
| Fuel | Moving **0.00084 P max(s_t, \|s_x\|) L/s**; digging **0.00168 P L/s**; idle **0** |
| Dig | Grounded; stick m′ ≥ 0.45 into a diggable neighbour for **7 steps (117 ms)**; chained digs skip the wait. 90° sectors, ±10° hysteresis. Down, left, right; **never up**; s_x = 0 in the Down sector. Dig time t1–t7 **29/20/14/11/8/6/5 steps**; the cell clears at 37.5%. Hardness ×1.0 (hook). |
| Other | Bounce v_y × −0.2; item cooldown 7 steps; amber tint at \|v_y\| > 5.88 |
| Start | **$20, hull 10/10, fuel 6/10 L**, Rim x 7 |

Derived range, climb and gear-check tables: 01 §3.3–3.6.

### 3.7 Cargo

1 slot per specimen, gem, relic, hoard item, Drum, Pack or Kit (Depot Kit 2). Digging into a full bay destroys the mineral ("Bay full"). **Discard:** rows expand on tap; "Discard 1" 44-pt button; "Discard all" 600-ms hold; gems and relics confirm; undo until the panel closes. Never in cargo: lode ore, ingots, parts, cut gems, gem parts.

### 3.8 Economy base values

Fuel $1/L · repair $15/HP · Assay 100% · Export 90% · incentives on first reach: 500 ft (r40) +$1,000, 1,000 ft (r80) +$3,000, 3,500 ft (r280) +$25,000 · no score (stats only).

### 3.9 Story beats

Each fires once; script 01 §7.

| Trigger | Sender | Content |
|---|---|---|
| Game start | Dot | Refuel instruction only |
| r32 / 500, 1,000, 3,500 ft | Dot | Survey ping / incentive only |
| Scripted lode found; `FirstLiftDelivery` | Dot | Starter Kit; first delivery |
| First Hardrock; first lift > 100 rows | Channel Zero | Counting begins; "the count matches your buckets" |
| r180 / r310 (v1) | Dot | Poor Iridium / Poor Thorium lode pings |
| First Mk II drill; first Depot; first Gas Tap (v1) | Marlow | Rival trading surveys |
| First Sheared structure (v1) | Channel Zero; Dot | "Re-surveyed"; tremors explained |
| First Sniffer bar; first Deep Eye reveal; first Echo Quartz sale (v1) | Dot | Methane warning; — ; — |
| r430 (v1) | — | Deepreach crew roster etched in lode rock |
| First Auto-Drill below r450 (v1) | Channel Zero | Drill reports in chains and links |
| First Depot dock below r450 (v1) | the Surveyor | First speech |
| Static Zone r465 (v1) | — | Mechanic only |
| The Notch (v1) | the Surveyor | Arena intro |
| MVP Seal r320 | Dot | "Co-op drilling rights end here — for now." |
| Recorder sales | Deepreach logs | In order of sale |

### 3.10 Boss (v1)

| Item | Value |
|---|---|
| Fight | One **Claimant**, **3,000 HP**, three stagger phases (01 §7.6); the Surveyor is its voice |
| Damage | Explosives only (Pop ≤ 120, Mega ≤ 240, distance falloff) |
| Flinch | ≤ **240 per opening** → ≥ 13 openings |
| Tells | Off-screen attacks: 44-pt edge chevron + panned cue ≥ **1.2 s** before contact. Bore Arm ≤ 10 tiles/s. |
| Supplies | **4 Deepreach Lockers**: 3 Pop + 1 Mega each, once per attempt (to the 9 cap); perfect-damage pool 5,640 |
| Rules | Leaving resets the fight. Pause allowed (3 s resume countdown); no build or map. |
| Hoard | In the Hoard Alcove. Dying with hoard items: they re-settle there and the Claimant re-forms at **750 HP**. |
| Ending | Deliver the First Deed to the Assay Office |

### 3.11 Factory constants

| Item | Value |
|---|---|
| Tick | 20 Hz; machine times are integer ticks |
| Belt | **1 tile/s, every tier**; spacing **1.0 / 0.5 / 0.25 tile** → 60 / 120 / 240 items/min |
| Auto-Drill | **8 / 10 / 24** ore/min × purity; Mk III required at r ≥ 262 (v1) |
| Mk unlocks | Mk I first lode; Mk II first reach r129; Mk III r262 (drills, belts, lifts) |
| Smelter | 2 ore → 1 ingot, 4 s; 1 specimen (tiers 1–4) → 2 ingots, 6 s |
| Lift / Chute | Up 30/90/240 per min (foot Kit 32 rows + 1 Lift Rail per 32) / down 300 per min, free |
| Storage | Bin 200; Silo 1,000 |
| Export | 90%; 240 items/min; 50-item buffer |
| Depot | Hopper 40; fuel pool 200 L; **HP pool 90**; 20 Kits; radius 10 (Chebyshev); refuel 10 L/s; unload 5/s |
| Shoring / Lamp | Holds x ± 2, rows y − 8…y + 7 / radius 3.5 |
| Power (v1) | Co-op Generator +10 kW, Solar +4, Power Plant +20 (1 Drum/60 s), Magma Tap +60; Gas Tap 4 Drums/min; draws 02 §3.1 |

### 3.12 Layout, input and touch constants

| Rule | Value |
|---|---|
| HUD | One **44-pt** row under the top inset (52 pt at 130% text): fuel, hull, cargo, cash, depth, menu; fuel and hull clear of the Dynamic Island. 24-pt depth ruler on the right edge (44-pt hit); tap → map. |
| Clear rect | Viewport − top inset − HUD row (bottom inset and control zone inside it) |
| Control zone | 166 pt + bottom inset (S/M/L 150/166/182); controls at 60% opacity. 667-pt phones default to S. |
| Stick / slots | Floating stick radius 52 (44/52/60), knob 28, dead zone 8. Quick slots 56–64 pt, gaps ≥ 12 (10 at S). THRUST option: 64-pt button left of a 2×2 cluster of 52-pt slots. |
| One-handed | Stick vector from a virtual origin (pod x, 0.70 H); tap a diggable neighbour = one dig; 2×2 slot cluster in the dominant corner; ruler on the non-dominant edge. Left-handed mirrors everything. |
| Landscape phone | W > H and min side < 600 pt. M0/MVP: "Turn your phone upright" card (pod paused, `interrupt`). v1: side rails. |
| Tablet | UI 1.2; view capped at 13 tiles (portrait) / 18 (landscape) |
| Matrix | 375×667, 360×800, 390×844, 393×852, 430×932, 412×915, iPad P/L, one foldable |
| Accessibility | Bright Mines (ambient 0.35), reduced motion, shape-coded ores, hold/toggle thrust; text 100/115% (MVP), 130% (v1) |
| Input | Pointer Events; `touch-action: none` on the canvas; `pointercancel` releases all held controls; document `touchmove` blocked only outside `[data-scroll]` |

**Touch constants** (03 and 04 cite this table)

| Constant | Value |
|---|---|
| Tap | Up < 250 ms, < 10 pt movement |
| World tap (pod mode) | < 200 ms, < 10 pt, any zone; ≥ 44-pt hit boxes; discards any stick it spawned |
| Long-press | 450 ms, < 10 pt; never on quick slots in play |
| Slot reassign | Cargo panel, or ≥ 600 ms press while paused or grounded on the Rim |
| Explosive / beacon | Down shows the footprint; 250 ms ring around the pod (arena 150); fire on release; early release or slide > 24 pt cancels |
| Pinch (play) | Two pointers down within 150 ms, neither moved 10 pt |
| Second-finger grace (build) | 120 ms after the first down, first moved < 10 pt |
| Lifted point | 44 pt above the finger from touch-down |
| Loupe | 88 pt, 2×, 120 pt above; flips to the non-dominant side |
| Edge auto-pan | 40-pt margin, ramp 2 → 8 tiles/s |
| Yaw twist snap | 30° |
| Pad / dock / Locker | Stick neutral 0.3 s on an **armed** pad (§2.4) |
| Stick spawn zone | x 24 … min(0.55 W, 300) pt; y 0.45 H … H − bottom inset |
| Resume gate | `interrupt`; 1.5 s countdown if airborne or \|v\| > 3 tiles/s |
| Hit target | ≥ 44 × 44 pt (HUD pills: full row height) |

### 3.13 Platforms and devices

- **Floors:** iOS/iPadOS 17.0+ (iPhone XS/XR/SE 2 and newer), Safari or Home Screen; Android 10+ with Chrome/WebView 121+; desktop Chrome/Edge 121+, Safari 17+, Firefox 128 ESR+ (untuned). **WebGL2 required.**
- **Device set (R4):** the user's iPhone(s) (§7 #1) plus one low-tier Android (Galaxy A15/A16, bought if needed); BrowserStack optional per milestone. Evidence comes through the in-app Perf Report.

### 3.14 Performance budgets

| Budget | Low (XR/XS, SE 2/3; Helio G85–G99) | Mid (iPhone 11–14; SD 7-class) | High (A17+; SD 8 Gen 2+) |
|---|---|---|---|
| Frames | 60, floor 30 | 60 (30 in LPM) | 60 |
| Dropped-frame rate | ≤ 5% | ≤ 2% | ≤ 1% |
| Main-thread p95 per frame (factory included) | ≤ 10 ms | ≤ 8 ms | ≤ 6 ms |
| GPU per frame | ≤ 12 ms | ≤ 10 ms | ≤ 8 ms |
| DPR cap (floor) | 1.0–1.25 (0.75) | 1.5 (0.9) | 2.0 (1.2) |
| Draw calls typical / peak | 70 / 100 | 120 / 200 | 160 / 250 |
| Triangles / belt items / particles | 60k / 1,500 / 250 | 150k / 4,000 / 500 | 250k / 6,000 / 900 |
| GPU texture / total | 32 / 100 MB | 64 / 150 MB | 96 / 200 MB |
| JS heap (Chrome) | 80 MB | 120 MB | 160 MB |
| Pod step / remesh | 0.6 ms / 2 ms ×1 per frame | 0.3 / 1 ms ×2 | 0.2 / 1 ms ×2 |
| Shadows / bloom | blob / halo | 1024² / halo | 2048² / half-res |

- **Factory tick** at 2,000 buildings / 10k items: p95 ≤ **1.5 ms** on the low device (ADR-0002, §4.10).
- **Remesh:** +4 per frame for chunks touching the pod's 3×3 or a blast.
- **iOS memory:** no MB budgets; 60-min soak with no crash or crash-loop drop. Low-tier page ≤ 150 MB until the jetsam probe measures the kill point, then ≤ 60% of it.
- **Payload:** initial JS ≤ **350 KB brotli / 430 KB gzip**; first playable ≤ 2.5 MB (music, debug and deep-band assets excluded); TTI on 4G ≤ 3 s (mid/high), ≤ 5 s (low), measured on device.
- **Measurement:** 60 s warm-up + 60 s capture; battery ≥ 50%, unplugged, LPM off; ABAB × 3, median run. Dropped frame = rAF interval > 1.25 × display interval (never raw p95 vs 16.7 ms).
- **Tiers:** default iOS mid; Android `deviceMemory` ≤ 4 low, else mid. A background title-screen benchmark moves ±1 tier at the next Rim arrival. Crash loops and sustained overload drop one tier.

### 3.15 Save

| Item | Value |
|---|---|
| Store / slots | IndexedDB, `persist()` after the first save. MVP 1 slot, v1 3; each 2 rotating copies + CRC32 + last-known-good. |
| Format | `HFSV` + u16 version + TLV. Routine saves deflate-raw (`CompressionStream`), ≤ 100 KB; critical saves raw; readers accept both. Migrations from MVP version 1; M0 saves never migrate. Resume snapshots only. |
| Critical | `visibilitychange → hidden`, `pagehide`, death, respawn: serialised synchronously and written uncompressed in the handler, **≤ 4 ms main-thread on low** |
| Other | ≤ 1 s: shop, dock or build confirm, hull damage, Rim arrival, `vite:preloadError` (then one reload). Every 30 s while dirty. |
| Safety | Boot tracking → **Safe Mode** after two boots die on one copy; bounds and invariant checks; imports dry-run 1,200 ticks before writing; fast-check fuzzing |
| Export | `HF1:` + base64url, or `holefactory-slot<n>-YYYYMMDD.hfsave` via Web Share |
| Safari → Home Screen (MVP) | Non-standalone title screen leads with "Install for full screen and safe saves"; the Add-to-Home sheet auto-copies the export code; first standalone launch offers one-tap "Paste save" |
| Identity | Manifest `id: "holefactory"`; `HF_BASE` env-driven; dev at `/motherload/` (§7 #2) |

---

## 4. Rules

### 4.1 Depots (v1)

| Rule | Value |
|---|---|
| Limits | ≤ 6; ≤ 1 per band; dock rows ≥ 64 apart; first dock row 40; none ≥ r584 |
| Shape | 3×2 on solid ground; dock = bottom-centre, entered through an excavated chimney above |
| Cost | **$2,000 × 3^(n−1)** + parts (02 §3.1); Depot Kit (2 slots, 20 mu) by pod only |
| Service | **Once per trip per Depot** (one dock session; re-armed at Rim arrival). Refuel from Drums, repair from the HP pool (cap 90), unload bulk to the hopper, drop or take Kits, Drums, Packs. Works unpowered. |
| Stock | Only from the player's logistics or pod cargo. **Weld Packs only from cargo**; underground belts, lifts and chutes refuse them. Drums may ride chutes. |
| Activation | First dock; then auto-builds ghosts within radius 10 from stocked Kits (1 per 5 s) |
| Cannot | Sell, buy, upgrade, save, respawn; take gems or relics; serve without stock |
| Floors | Drum inputs ≥ $10 (≥ $1/L); Weld Pack inputs ≥ $225 (≥ $15/HP) |
| Risk | Unshored + Shear: spills 25% of hopper and stock, stops. Methane in its 3×3: Damaged, no spill. |
| Frontier | Occupants run only in rows 0–63 or within radius 10 of a Depot. Below **max(63, deepest dock row + 10)** is pure Motherload. |

### 4.2 Death, salvage and saves

- **Destruction:** hull ≤ 0 or fuel = 0. Warnings: fuel 20/10/5%, hull < 25%.
- **Lost:** all cargo, except hoard items, which re-settle in the Hoard Alcove. **Kept:** parts, consumables, world, factory, Depot stock, Stockpile.
- **Salvage fee = max($25, round(0.08 × IPV)), always charged** (IPV = installed tiers' prices). It includes a full refuel and repair. A shortfall becomes **Co-op debt**. Examples: five t2 lines $300; all t4 (Scanner t3) $2,560; all t6 $56,000.
- **Respawn** on the Pump House pad (disarmed) after a 3 s card; the factory never pauses.
- **Hardcore** (permanent): fee ×2; one random line at t ≥ 2 loses a tier.
- **Resume-only saves:** death, respawn and hull damage are saved at once (§3.15); killing the app loses ≤ 30 s and undoes nothing.

### 4.3 Economy

The headless bot (04 §11.2) checks these rules; the MVP bot runs two scripted profiles (proficient, slow-median) and reports PRI per phase, factory share and per-trip warnings.

#### 4.3.1 PRI and the guardrail table

**PRI(phase)** = bot-measured median, over the two profiles, of pod income (Assay sales + incentives) per minute of play. The phase is set by the deepest row reached. Until the bot reports, the **provisional** values below apply (rev-1 analytic method; E split per GDD C8).

| Phase | Rows | Tiers | PRI $/min | Away cap / 24 h (5×) | RFI × PRI | MFI × PRI |
|---|---|---|---|---|---|---|
| A | 0–59 | t1–2 | 250 | $1,250 | exempt (0.38) | exempt (0.48) |
| B | 60–128 | t2–3 | 1,400 | $7,000 | 0.22 | 0.33 |
| C | 129–261 | t3–4 | 4,000 | $20,000 | 0.38 | 0.53 |
| D | 262–395 | t4–5 | 30,000 | $150,000 | 0.39 | 0.49 |
| E1 | 396–479 | t5–6 | 125,000 | $625,000 | 0.16 | 0.20 |
| E2 | 480–583 | t6–7 | 500,000 | $2.5M | 0.07 | 0.08 |

**RFI** = every lode to the phase floor at the canon Mk, smelted and exported. **MFI** = the same with the best assembled export mix. Both use Mk II = 10/min, the §3.2 lode table and expected purity.

#### 4.3.2 Factory guardrails

- **Factory share** = factory $ ÷ (pod $ + factory $) over a phase. Typical target **0.15–0.30** in B–D.
- **Hard cap, B–E2** (A exempt): realised factory income ≤ **0.40 × PRI**; perfect play ≤ **0.55 × PRI** (proxies RFI, MFI).
- **The factory must matter:** a pod-only run is ≥ 30% slower to the credits.
- **Levers, in order:** drill rate, lode count, purity mix, ore value; never Export prices.

#### 4.3.3 Value ladder

Lode ore 0.1 × specimen; smelting ×1.3; each assembly step ×1.25–1.4; Export 90%. **Lossy path:** a tier 1–4 specimen → 2 ingots (≈ −47%), so basic parts never soft-lock. **Iridium Ingots and Thorium Rods come only from lode ore.** Gem cutting and gem parts add no value (§2.8).

#### 4.3.4 Consumable floors

Pod Works inputs ≥ **40%** of the shop price and ≥ **90 s** per craft; ≤ 2 Pod Works.

#### 4.3.5 Parts on upgrades

- t1–t2 cash only. t3–t6 parts worth **10–20%** of the price; t7 ≤ **25%**; 2–15 items of ≤ 2 types. Counts: 01 §5.1.
- Families: t3–t4 Basic (Gear, Wire, Hull Plate, Coolant Coil, Motor, Circuit); t5 Iridium (Drill Bit, Pressure Vessel + Circuit); t6 Reactor Core; t7 gem parts + Reactor Core.
- **Ruled exceptions:** Keg (Tank t4) = **4 Pressure Vessels** (≈ 32%, R13); Scanner t7 = **8 Lens + 1 Opal Plating** ($61,110 book, 12.2%); Drill t7 = **1 Diamond Bit + 1 Reactor Core** ($102,030, 20.4%).
- Signatures: Drill Hull Plate → Motor → Drill Bit → Diamond Bit · Hull Hull Plate → Pressure Vessel → Reactor Core → Opal Plating · Engine Motor → Reactor Core → Opal Plating · Tank Hull Plate → Pressure Vessel → Reactor Core · Radiator Coolant Coil → Reactor Core → Lens · Cargo Hull Plate → Pressure Vessel · Scanner Circuit → Lens + Opal Plating.

#### 4.3.6 Away budget (v1; formula 02 §8)

1. **Away** = hidden, or visible with no input for 5 min.
2. The first **60 s** of any away period run at 100%; the rest at **η = 0.5**.
3. Credited away time ≤ **8 h per rolling 24 h**.
4. Away value (Export cash + stored-goods value) ≤ **5 × PRI(phase) per rolling 24 h**.
5. While away, Export sells only its 50-item buffer; other output must fit in Bins, Silos and Depot stock.
6. Credit only wall time beyond the highest wall-clock value ever saved.
7. "Night Shift" milestone = away report ≥ 3 × PRI.
8. Bot: away income ≤ 25% of pod income for 3 × 20-min sessions/day (the cap gives ≤ 8.3%).
9. Catch-up: exact ticks within **1.5 s (mid) / 3 s (low)**, then the rate model; pure `catchUp(saveBytes, Δt) → {saveBytes, report}` in ≤ 8 ms slices behind the card, or a one-shot worker.
10. The welcome-back card shows at ≥ **60 s** credited. No Shears or hazards while away.

### 4.4 Fuel as the clock

- **Fuel binds in A–B, and in C until the t4 tank (Keg). C binds on cargo and Hardrock routing.** From D: hull (Magma 58R, Methane 130–286R), weight and cargo.
- The Keg needs Iridium, first available from the Poor Iridium lode (r195–259), so the Jug carries most of C.
- **P1 test:** the slow-median bot gets ≥ 1 fuel or hull warning per 5 trips in every phase A–E2.
- **Deep Heat** (MVP A/B flag, off): fuel burn × (1 + 0.25 per 1,000 ft below 1,612 ft), capped ×1.5 (at 3,612 ft). Adopt only if P1 fails.
- **Return Tick default "Training":** on until the first t3 Tank or 10 trips, then off; always on with any assist enabled; off in Hardcore.

### 4.5 Time model

| Context | Pod | Factory |
|---|---|---|
| Playing | runs | runs |
| Sheets, build mode, map, cargo, settings, pause | paused (velocity kept) | runs |
| **`interrupt`** | paused; "Tap to resume" in the thumb zone | runs |
| Landscape phone (M0/MVP) | paused (`interrupt`) | runs |
| Arena | pause allowed, 3 s countdown; no build or map | runs |
| Away | hidden: suspended | MVP sleeps; v1 Away budget |

- **`interrupt`** is raised by `visibilitychange → visible`, cold load, window `blur`, AudioContext `interrupted`, orientation or aspect change, and `pointercancel` on the stick or THRUST.
- **Resume gate:** airborne or |v| > 3 tiles/s → 1.5 s 3-2-1 countdown, else resume at once. Leaving a sheet, map or build mode while airborne with |v_y| > 5.88 gets the same countdown.
- While the player is present the factory never pauses; cards and camera shots never block input.

### 4.6 Finiteness

Scattered ore, gems and relics are finite (≈ $49.5M, 13× the max-out cost). Lodes are infinite and rate-capped. NG+ "New Claim" is post-launch.

### 4.7 Shears (v1)

| Rule | Value |
|---|---|
| Roll | After first reach of r80; only at Rim arrival after a trip reaching r ≥ 80; never two returns running; never with the pod underground |
| Schedule | First Shear guaranteed on the **4th eligible return** at intensity 1; its report gifts **2 Weld Packs** and highlights brace slots. Then **p = 0.10**, pity **6** (≈ 5–6 returns apart). Stops for good once the pod enters the Hollow Heart. |
| Shift | i = 1/2/3 at 60/30/10%; per-row chance 1/(5 − i); ±1 at 50/50; rows 6–583; wraps x 0↔47. Shoring areas stay fixed; the rest of the row rotates around them. |
| Damage | Misaligned structures become **Sheared** (stop, keep contents; Depots spill 25%) |
| Realign / Repair | Within 2 tiles, hold 2 s; **1 Weld Pack per Sheared or Damaged structure** in the port-linked cluster, from cargo or a docked Depot's HP pool (02 §7.3) |
| Report | 2 s Rim rumble, then the Shear Report card |

### 4.8 Kits

- Underground buildings are built only from Kits: the pod carries them and stays within 2 tiles of the ghost for 1.0 s, or (v1) an activated Depot builds them from stock within its radius.
- Slots / mass: small Kits (Belt, Router, Shoring, Lamp, Chute) 1 / 1 mu; Lift Rail 1 / 2 mu; machine Kits (Auto-Drill, Lift Foot, Taps) 1 / 5 mu; Depot Kit 2 / 20 mu, pod-only.
- v1 chutes carry anything down for free except gems, relics, cut gems, gem parts and Weld Packs. Lifts, belts and chutes may deliver Kits and Drums to a Depot.

### 4.9 What may ride logistics

| Item class | Pod | Underground logistics | Surface / Stockpile | Assay | Export |
|---|---|---|---|---|---|
| Bulk specimens | yes | yes | yes | 100% | 90% |
| Gems | yes | no | after Assay "Stockpile" | 100% | 90% |
| Relics, hoard | yes | no | no | 100% (Deed: delivery) | no |
| Lode ore, ingots, parts | no | yes | yes | no | 90% |
| Cut gems, gem parts | no | no | yes | no | no |
| Kits, Fuel Drums | yes | yes | yes | no | no |
| Weld Packs | yes | no | yes | no | no |

### 4.10 Simulation authority (R1)

- **One authoritative simulation on the main thread:** `World {terrain, pod, wallet, story, factory}`; every write is synchronous. Pod 60 Hz and factory 20 Hz share one accumulator.
- The factory module is pure, with a command API (`place`, `deconstruct`, `setRecipe`, …) and read-only views for rendering, so it stays worker-ready.
- **ADR-0002 gate:** bench 2,000 buildings / 10k items on the low device. p95 tick ≤ 1.5 ms → single-threaded through v1. Otherwise v1 moves **flow state only** (lines, queues, inventories) to a worker; main remains sole writer of the cell grid, cash and the Stockpile ledger.
- Removed: the cross-thread split, Reserve/Commit/Cancel, `w2mCash`/`CashTotal`, the snapshot protocol, seq idempotency.

### 4.11 Build rules

- The pod never drives on the Yard. Build mode opens anywhere except the arena; the pod freezes.
- The yard crane places surface buildings instantly from cash and Stockpile parts. Deconstruct refunds 100% to the Stockpile (blocked if it is full).
- Underground ghosts need excavated, seen cells (§4.8).
- Required UX: ghost-and-confirm with "Instant build"; drag-painted belts; undo/redo ≥ 50 steps; one-thumb building (03 §4). v1: copy/paste, mass delete, multi-select.

### 4.12 Hazard tells

Every tell is visual **and** audible. **Sniffer** (all Scanner tiers): 0–3 HUD bars for undiscovered methane within radius, green antenna LED at 2 Hz, hiss; directional from Echo Sounder; exact cells from Deep Eye. Methane is never revealed by adjacency alone. Magma glows; Hardrock is chamfered; falls tint amber; low fuel and hull pulse with a vignette.

### 4.13 Power (v1)

The MVP has no power ("up" costs Lift Rails and throughput). v1: one global pool, no wires; s = min(1, supply ÷ demand) scales every consumer; no surplus bonus. Surface buildings and mounts are always connected; underground occupants only in **rows 0–63** or within radius 10 of a Depot dock.

### 4.14 IP

Mechanics only; original names, text, art, audio (§2.11–2.12). Marketing may say at most "inspired by classic dig-and-return games". No public URL contains "motherload". Before store release: legal review and trademark checks on "HoleFactory" and "Hollowell".

---

## 5. Scope and build order

### 5.1 M0 "Style & Feel Test" (≈ 3 weeks)

Content: the M0 rows of §5.5; generated world with a play floor at r128 plus a debug Hardrock/Magma strip.

**Style-test render contract (R27)**
- **Shared:** same tier; dynamic resolution and bloom off; one tuning day per look.
- **Toon:** DPR min(device, 2); outlines on everything.
- **Pixel Lab:** RT pixel = integer k device px, k = round(DPR × face_pt / 30) (SE k = 2; iPhone 15 k = 4); native-DPR canvas; nearest blit; Pixel UI skin; zoom snaps to integer RT px per tile. Pass order (04 §5.7): opaque → MRT; edge pass; transparent/additive → single-attachment target; blit.
- **Sessions:** A-B-A-B, 5 min each, frame times logged.
- **Switch:** M0 44-pt A/B chip, both pipelines precompiled, flip ≤ 1 frame, no three-finger tap. Production: settings only, rebuilt via the context-loss path (≤ 500 ms) with `antialias: look === 'toon'`.

**Exit:** §3.14 low and mid frame budgets met underground in both looks; **the user picks the look**; tile face ≥ 35 pt on the SE (≥ 38 on 6.1-inch) standalone; the §3.4 visibility rule holds; ore identification on rows +6…+9 at B3 ambient ≥ 90%; mis-digs < 3% in 10 min; 3 trips on the user's iPhone; Perf Report and jetsam probe from both devices; CI green (both looks, `webkit-smoke`, rotation spec).

### 5.2 MVP vertical slice (+9 weeks)

Content: the MVP rows of §5.5; play stops at the r320 temporary Seal.

**Onboarding beats:** 1 refuel · 2 first dig and sale · 3 first t2 · 4 500 ft incentive · 5 survey ping → scripted lode → Starter Kit · 6 drill + lift up the survey shaft → `FirstLiftDelivery` → first **Wire** from the lode; first **Hull Plate** from Stockpiled Hematite + Cobalt specimens; Export unlocks at the first ingot · 7 first t3 with parts.

**Exit** (median of ≥ 5 first-time phone players unless noted)
- `FirstLiftDelivery` ≤ **35:00**; Starter Kit pickup → delivery ≤ **8 min**.
- 4,000 ft in ≤ 3.5 h.
- ≥ **50%** of parts consumed by t3–t4 purchases from lode ore (bot + testers). Factory share reported, target **8–25%**. No Mk II.
- P1 test passes A–D (bot).
- 10-tile belt with one turn ≤ 15 s, ≤ 1 undo; drill + lift + Headframe from the context flow ≤ 90 s; 0 pinch-painted belts and 0 unintended sheet opens per 10 min; 0 HP lost to the interruption scripts; all also one-handed on an SE.
- 60-min soak on both devices: no crash or tier drop. Saves survive a forced kill; hull damage persists 10/10 home-swipe-kills.
- Every low-tier budget met on the low-tier Android.

### 5.3 v1.0 (web/PWA, +16 weeks)

Content: the v1 rows of §5.5. **Exit (bot unless noted):** hard cap B–E2; pod-only ≥ 30% slower to credits; away ≤ 25% of pod income; P1 passes A–E2; boss targets (01 §7.6); an 8-h real away test on a device.

### 5.4 Post-launch backlog (priority order)

1 Capacitor store builds (haptics, portrait lock, Filesystem saves) · 2 Pneumatic Tube · 3 NG+ "New Claim" · 4 blueprints and share codes · 5 Crate Packer · 6 Cargo Rail · 7 Drone Bay · 8 Deep Bore Rig · 9 Gem Lift · 10 extra chassis · 11 push notifications · 12 Co-op Orders · 13 sky easter eggs · 14 day–night and dust storms · 15 gamepad · 16 localisation · 17 cloud save · 18 leaderboards · 19 second underground plane · 20 TSL/WebGPU, 120 Hz · 21 PR previews, CDP perf trend · 22 monetisation if chosen.

### 5.5 Scope ledger

Settles every scope question. A feature enters at the tier shown and persists; "→" marks expansion. 04's `config/scope.ts` and all build-order rows cite it.

| Feature | Scope | Owner |
|---|---|---|
| Full generator (48 × 608, all lodes, Seal, Hollow Heart); frozen at MVP | M0 | §3.2 |
| r128 play floor; debug Hardrock/Magma strip; perspective A/B | M0 only | §5.1 |
| r320 Seal overlay; Unknown seams | MVP only | §3.2 |
| Tutorial Patch, seeded Gold, survey shaft + rusted Headframe/Bin/Smelter, Starter Kit | MVP | §3.2 |
| Relics from r76; ≥ 6 Recorders | MVP | §2.3 |
| Rows 320–607, Methane + Sniffer tiers, Static Zone, Notch, arena | v1 | 01 §4 |
| Shears, Shoring, Realign/Repair, Shear Report | v1 | §4.7 |
| Ruler + basic map (charted cells, lodes, pings, lifts; scrub in build) → full map (filters, relic pings, Depots, problems) | MVP → v1 | 03 §4.11, §6.6 |
| Pod physics, dig, fuel, hull, falls, cargo | M0 | §3.6 |
| Hardrock, Magma, explosives: demo strip → generated | M0 → MVP | §3.3 |
| Pump House, Assay sale, Garage Drill/Engine/Tank/Bay t1–t3 (cash), salvage | M0 | 01 §3 |
| Six lines t1–t5 + Tin Ear/Dowser, parts from t3, all consumables (bought) | MVP | 01 §5 |
| Return Tick, Landing Assist, Steady Drill, Co-op Credit/debt, sign tap, discard | MVP | 01 §3, §6 |
| t6–t7, Echo Sounder/Deep Eye/Claimsight, Hardcore, Finale Assist | v1 | 01 §5–6 |
| Pod visuals: 3 geometry steps + trim band | MVP → v1 all lines | 03 §8.6 |
| Deep Heat flag (off) | MVP | §4.4 |
| Beats to 3,500 ft, pings, Recorder logs 1–6, office log; goal chip, Next Goals, trip summary | MVP | §3.9, 01 §2, §7 |
| Remaining beats, Marlow, Surveyor, boss, Lockers, hoard, ending, credits, free play | v1 | 01 §7 |
| Milestones 15 → all | MVP → v1 | 01 §8 |
| Belt/item render demo; lift stub | M0 | 02 §3.8 |
| Belt Mk I, Router, Bin, Smelter, Assembler, Export, Headframe, Auto-Drill Mk I, Lift Mk I + Rail; Kits; Assay Stockpile; parts to Pressure Vessel; unlocks U0–U3; Co-op Plans | MVP | 02 §3–4, §9 |
| Mk II/III, Silo, Depot, Chute + chute mouth, Shoring, Lamp, Refinery, Pod Works, Gem Cutter, power buildings, Taps; Kerogen/Thorium lodes; Reactor Core, gem parts, Drums, Packs; Shed Drums/Packs | v1 | 02 §3–6 |
| Power pool | v1 | §4.13 |
| Away budget + welcome-back card (MVP: factory sleeps while away) | v1 | §4.3.6 |
| Yard Expansion I → II, III | MVP → v1 | §3.1 |
| Yard ghost + rotation; underground ghost highlight | M0 | 03 §4.12 |
| Ghost-and-confirm, drag belts, undo/redo, refunds, dock band, loupe, underground build camera, Route to surface, Bulldoze | MVP | 03 §4 |
| Logistics overlay → bottleneck tint, Hazard and Power overlays | MVP → v1 | 03 §4.10 |
| Copy/paste, mass delete, multi-select, mass upgrade | v1 | 03 §4.7 |
| HUD row, control zone, stick, sectors, dev keyboard, `interrupt` gate, upright card | M0 | §3.12, §4.5 |
| Slot arming, cargo panel, context button, THRUST option, handedness, sizes, one-handed | MVP | 03 §3 |
| Sheets: Pump, Assay, 4-line Garage → Shed, Dot's office, inspect | M0 → MVP | 03 §6.3 |
| Radio cards with ticker and lint | MVP | §2.12 |
| Text scale 100/115 → 130 | MVP → v1 | §3.12 |
| Landscape rails, tablets, foldables | v1 | 03 §1.3–1.4 |
| Accessibility MVP set → complete (VoiceOver labels, colour-blind ores) | MVP → v1 | 03 §7 |
| Both looks, A/B chip, gallery, questionnaire | M0 | §5.1 |
| Art on the picked look: B0–B4 → B5–B7, boss, all buildings | MVP → v1 | 03 §8, §10 |
| Audio: unlock + 4 ZzFX SFX → ≤ 20 SFX + "Kettle On" loop → full SFX, generative G2–G4 (6 d) | M0 → MVP → v1 | 03 §11, 04 §8 |
| Scaffold, classic renderer, Preact HUD, PWA, Pages, manifest id | M0 | 04 §1, §9 |
| Debug overlay, Perf Report, jetsam probe, tier override | M0 | 04 §10, §13 |
| Save v0 → v1 format, export/import, Import from Safari, install-first title, Safe Mode → 3 slots | M0 → MVP → v1 | §3.15 |
| Quality auto-detect, dynamic resolution, battery mode, crash-loop drop | MVP | §3.14 |
| Factory in the main loop + bench, ADR-0002 → flow-state worker only if the gate fails | MVP → v1 | §4.10 |
| Minimal bot (2 profiles, ≈ 2 d) + 1-day trip soak → full bot | MVP → v1 | §4.3, 04 §11.2 |
| Build-once CI deploy, 2 releases' assets kept, `update-snapshots.yml`, `webkit-smoke`, CI-only baselines | M0 | 04 §11–12 |
| Gamepad; PR previews; CDP trend; WebGPU; 120 Hz | post | §5.4 |

### 5.6 Risks

| Risk | Mitigation / fallback |
|---|---|
| Provisional PRI is off: review F's two-profile model gives ≈ 2.3× (A), 1.9× (B), 1.3–1.4× (C), 1.2× (D), 1.4× (E1) | The MVP bot measures PRI; all × PRI rules are re-checked before content lock |
| Lode-only Iridium/Thorium walls t5–t6 or the Keg | **Fallback (R12):** Iridium and Thorium specimens smelt 1 → 1 ingot |
| Phase C stays slack | Deep Heat if P1 fails |
| Factory share < 0.15 in play | The factory matters via lode-only parts; share is reported, not gated, in the MVP |
| Survey shaft gives an early 45-row drop (7 of 10 HP) and easy B1 ore | 01 §2.5 onboarding handles it |
| Single-thread factory misses 1.5 ms | Flow-state worker in v1 (ADR-0002) |
| iOS suspends before a critical save commits | Synchronous raw write; 10/10 device test |

---

## 6. Out of scope for v1

Multiplayer, accounts, cloud, leaderboards, IAP, ads, timers, store builds, native engines, WebGPU · voxel mine, second underground plane, extra depth, pod on the Yard, play-mode camera rotation · drill wear, multiple vehicles, Headlight line, depth hardness, Deep Heat unless P1 fails · power wires, fluids, circuits, trains, inserters, two-lane belts, research labs, quality/modules · selling cut gems or gem parts, Depot sell/upgrade/save/respawn · enemies besides the boss, voiced dialogue, non-English text, anything original-derived (§2.11–2.12) · mine regeneration (except lodes), Shears while away, gem logistics.

---

## 7. Open items for the user

Building proceeds on each default.

| # | Question | Default |
|---|---|---|
| 1 | **Which phone(s) do you own (model + iOS version)?** Needed for M0 device testing. | Tune in Playwright at 375×667 and 393×852; buy a Galaxy A15/A16 as the low-tier device |
| 2 | **Rename the repo to `holefactory` (or use a custom domain) before any public link?** | Dev stays at `/motherload/`; manifest `id` is already `holefactory` |
| 3 | Names: Hollowell Mining Co-op, Dot, Pip, the Surveyor, the Claimant, the mineral ladder | Keep, pending trademark checks |
| 4 | Which art look? | Picked at the M0 exit; if undecided, Clean Toon, with Pixel Lab as a "Retro filter" if it costs ≤ 5% frame time |
| 5 | "Drill dies" | Hull or fuel zero (I1) |
| 6 | "Purchase your vehicle" | Part upgrades on 7 lines (I2) |
| 7 | Lifts carry gems? | No; Gem Lift post-launch (I3) |
| 8 | Bulk specimens dropped at Depots? | Yes, tiers 1–6, at the 90% Export rate |
| 9 | Late-game fuel | Binds in A–B and C until the Keg; Deep Heat only if P1 fails |
| 10 | Death penalty | 8% salvage fee, always charged (shortfall → Co-op debt) + cargo loss; optional Hardcore |
| 11 | Scanner as a 7th line | Yes |
| 12 | Hazards hurt infrastructure? | Yes, softened by Shoring and Realign; no cozy toggle |
| 13 | Away numbers | 60 s at 100%, then 50%; ≤ 8 h and ≤ 5 × PRI per rolling 24 h; storage-limited |
| 14 | MVP depth | 4,000 ft (r320) |
| 15 | Methane fairness | Non-directional Sniffer at stock; exact reveal from Deep Eye |
| 16 | Tablets | Capped view (13/18 tiles), UI scale 1.2 |
| 17 | Monetisation after v1 | None planned; not designed out |
| 18 | Store timing | Post-launch, after web v1.0 |

---

## 8. Change log

**Rev 1 (2026-10-01):** initial canon (`scratchpad/canon/ore48.py`, `pod60.py`).

**Rev 2 (2026-10-01):** applies `scratchpad/plan/rulings.md` to the fidelity (F), UX, Tech and consistency (Con) reviews. Numbers: `scratchpad/rev2/econ_rev2.py`. Format: id → change → where.

- R0b/c (Con M2, M4) → one owner per fact (recipes and economy numbers in 02; no "economy document"); no challenge sections → header.
- R1 (Tech B1) → single main-thread `World`, shared accumulator, ADR-0002 worker gate, pure `catchUp`; protocol deleted; Con M15, Tech C3 moot → §3.5, §4.10.
- R2 (Tech M1) → classic WebGL renderer; TSL/WebGPU post → D4, §5.4.
- R3 (Tech B2) → pin and `tsc -b` fixes → 04 §1.
- R4 (Tech M2, M3, m3, m8, m9) → dropped-frame metric, ABAB, device set, Perf Report, jetsam probe, iOS soak, iOS tier mid → §3.13–3.14, §5.
- R5 (Tech M4) → full world from M0; frozen at MVP; Unknown seam → §3.2.
- R6 (Tech M5, M6; replaces Tech C1) → synchronous raw critical saves ≤ 4 ms, Safe Mode, dry-run imports, fuzzing; fflate cut → §3.15.
- R7 (Tech M7–M9) → build-once deploy, CI baselines, `webkit-smoke`, preload-error save → §3.15, §5.5.
- R8 (Tech M10–M12, m1–m10) → minimal MVP bot + trip soak; full bot v1; previews, CDP, WebGPU, 120 Hz post → §4.3, §5.4–5.5.
- R9 (Con M16) → manifest `id: "holefactory"`; repo-rename item → §3.15, §7.
- R10 (F10, GDD C8, Fac C3) → PRI = bot median, E1/E2, provisional table, factory share, hard cap 0.40/0.55, A exempt → §4.3.1–4.3.2.
- R11 (F1; supersedes Fac C7, Con m1) → Away budget; MVP factory sleeps while away → D7, §4.3.6, §4.5.
- R12 (F3, F17; overrides Con on Fac C4) → Poor Iridium (195–259) and Thorium (325–389) lodes, pings r180/r310, lossy path tiers 1–4, Mk II 10/min, pod-only check, fallback → §3.2, §3.11, §4.3, §5.6.
- R13 (F4) → fuel wording, Keg = 4 PV, Deep Heat flag, P1 test → §4.3.5, §4.4.
- R14 (F5, Fac C9) → Depot once per trip, Packs cargo-only, HP pool 90, Shed Drums/Packs → §2.4, §4.1.
- R15 (F7; supersedes GDD C2, Fac C5, Con M1) → cut gems/gem parts unsellable, non-exportable, book Σ inputs → §2.8, §4.9.
- R16 (F8, Fac C6) → MVP exit: lode-parts ≥ 50%, share 8–25% reported, no Mk II → §5.2.
- R17 (F9, F17, Con B1, M3, M18, Fac C2, GDD C6) → survey shaft, Starter Kit, rows 0–63 power-free, frontier, Tutorial Patch x 5–11, seeded Gold, Hematite 50–64, `FirstLiftDelivery` ≤ 35:00, beat 6 → §2.1, §3.2, §4.1, §4.13, §5.2.
- R18 (F11) → fee always charged; Co-op debt → §4.2.
- R19 (F13) → first Shear on 4th return + 2 Packs; p 0.10, pity 6; none after the arena → §4.7.
- R20 (F14) → Return Tick "Training" → §4.4.
- R21 (F2, F15, UX M5) → originality rules; system-triggered beats; Marlow a rival ("Old" dropped); Unknown operator and altimeter line cut; E-phase beats; ≥ 6 Recorders; card limits → §2.1, §2.12, §3.9.
- R21 → incentive beats carry only the incentive; methane warning moved to the first Sniffer bar, tremors to the first Shear; game-start card kept as instruction only → §2.12, §3.9.
- R22 (F6, F12, GDD C3, C9, Con M19, UX m7) → single 3,000-HP Claimant, flinch, tells, 26 ppu, Lockers, pause, 6-item hoard, Deed ending, re-form at 750 → §2.3, §3.4, §3.10, §4.2.
- R22 → F2e's $400k Logbook equals an original value; set to $450k; hoard $28.65M → $3.0M → §2.3.
- R23 (Con M17, GDD C1) → t7 ≤ 25%; Scanner and Drill t7 recipes; Echo Quartz has no cut form → §2.8, §4.3.5.
- R24 (Fac C1, Tech C7) → belts 1 tile/s; spacing 1.0/0.5/0.25 → §3.11.
- R25 → anchored cells (Con M6) §3.3; Pack per structure (M5) §4.7; ruler + map MVP (M7, UX C5) §5.5; Import from Safari MVP (M8, UX M12) §3.15; missing MVP tasks (M9) §5.5; ore codes to 03, Peridot pear cut (M10, UX m8) §2.2; pod visuals (M11) §2.6; music split, V1-27 6 d (M13) §5.5; ledger (M20) §5.5; GDD C4 Hop 5–6 HP §2.7; GDD C5 3×2 forced diggable, C7 Tutorial Patch §3.2; Fac C8 chute mouth §2.8; UX C1–C7 §3.4, §3.12; UX C8 rejected §5.4; Tech C2, C4 §3.14; Tech C5 M0 3 weeks + 4 SFX + perspective flag §5.1.
- Con m3 → new names ratified (Starter Kit, Tutorial Patch, Return Tick, Co-op Credit, Hoard Alcove, Deepreach Locker, Heartstone, Co-op Plans, Shopping list) → §2.1.
- Con m2 → ratified: Rim anchor 68%, sky 50%, dig gate 0.45, Down-sector s_x = 0, Shoring methane-immune, Depot chimney, Lamp/Shoring-only sharing → §3.1–3.6, §4.1.
- Con m4–m8 → lode x-range; test exclusions; text scale and crash-loop in MVP; clear-rect wording; Band rename; CHARTED radius; export file name → §3.1–3.2, §3.12, §3.15, §5.5.
- Rev 2 → lode spacing read as "not both < 8 rows and < 6 columns apart"; cut gems, gem parts and Weld Packs off underground logistics → §3.2, §4.8–4.9.
- R26 (UX B1–B3, M1–M12, m1–m12; overrides Con M14) → touch table, `interrupt` gate, pad arming, spawn zone, landscape card, visibility rule, one-handed, discard, camera hysteresis, MVP UX exits → §2.4, §3.4, §3.7, §3.12, §4.5, §5.2.
- R27 (UX M6, M7, Tech M11, Con M12; supersedes Tech C6) → style-test render contract → D5, §5.1.
