# 02 — HoleFactory Factory & Logistics (rev 2)

**Status:** owner of buildings, items, all recipes (Pod Works included), factory economy numbers, the Away-budget formula and the factory sim rules (canon header, R0b). It obeys `docs/design/00-canon.md` rev 2; where they differ, the canon wins. **[tune]** = playtest may move it. **Provisional** = analytic estimate until the economy bot (04 §11.2) measures it.
**References:** "canon §n" = `docs/design/00-canon.md`; "01 / 03 / 04 §n" = the sibling design docs. Numbers: `scratchpad/rev2/factory_rev2.py`, `factory_rev2b.py` (balance, 40-seed Depot-coverage Monte Carlo, power, away examples).

---

## 0. Conventions

### 0.1 Units

| Quantity | Unit |
|---|---|
| Time | tick = 50 ms (20 Hz); 1 min = 1,200 ticks; machine times are integer ticks |
| Belt position | 1 tile = 240 u; v = 12 u/tick (1 tile/s) on every tier; spacing S = 240 / 120 / 60 u for Mk I / II / III (canon §3.11) |
| Rates | items/min at power satisfaction s = 1 |
| Power (v1) | integer kW; s_Q ∈ [0, 65,536] (Q16). MVP: s_Q ≡ 65,536 |
| Money | integer dollars; Export pays ⌊value × 9 / 10⌋ per item |
| Book value | display and Away cap only: sale value; else Σ inputs (cut gems, gem parts, Drums, Packs, consumables) or Shed price (Kits) |

### 0.2 Factory defaults (user-overridable)

| # | Default | Why |
|---|---|---|
| F1 | **Recipes unlock by possession:** once all input types have existed in the factory or Stockpile (plus the §9 rungs) | No research building (canon §6) |
| F2 | **Nameplate power demand:** every connected, enabled, intact consumer counts, working or not | No tick-to-tick oscillation |
| F3 | **Pod Works crafts only the six consumables;** Kits come only from the Supply Shed | ≥ 90 s per craft (canon §4.3.4) makes Kit crafting pointless |
| F4 | **Co-op Generator (v1) pre-placed at x 0–1, Yard rows 7–8** | Keeps every seed's survey set (§2.2) clear |

---

## 1. Philosophy and interlock

### 1.1 Three rules
1. **Down is free, up costs.** The pod falls at 0 L; v1 Chutes move 300 items/min down unpowered. Items rise only by Bucket Lift: Kits per 32 rows, 30 / 90 / 240 per min, 1 kW per 16 rows and Shear exposure (v1).
2. **The pod owns the frontier and the jackpots.** Scattered ore, gems and relics are pod-only underground. Only the pod excavates, discovers lodes, carries Kits, docks and Realigns. v1 occupants run only in rows 0–63 or within radius 10 of a Depot (canon §4.1).
3. **The factory owns volume and parts.** From t3 every upgrade needs Stockpile parts, and **Iridium Ingots and Thorium Rods come only from lode ore** (canon §4.3.3), so t5+ requires automation. Factory income stays ≤ 0.40 × PRI (canon §4.3.2).

### 1.2 Interlock by phase
Share = typical factory share at the phase milestone (§5.3), provisional; canon target 0.15–0.30 in B–D.

| Phase (rows) | Pod's job | Factory's job | Pod needs from factory | Factory needs from pod | Clock (canon §4.4) | Share |
|---|---|---|---|---|---|---|
| **A** 0–59 | Pure Motherload; scripted lode (r46) via the survey shaft; Starter Kit | Survey-set chain; first Wire; first Hull Plate from specimens | Nothing (t1–t2 cash) | Discovery, Kits, builds | Fuel | 0.19 (exempt) |
| **B** 60–128 | Cu, Co (+ Kerogen v1) lodes; Hematite lodes r50–64; v1 Depot #1, first Shear | Basic parts (A1–A6); v1 Refinery, Power Plant, Shoring | t3–t4 basic parts | Excavation, Kits, Depot Kit, Realign | Fuel | 0.14 |
| **C** 129–261 | Hardrock routing; Poor Iridium lode (ping r180) | Mk II (v1); Pressure Vessels, Drill Bits; v1 Pod Works, Silo | t4 parts incl. Keg = 4 PV | Poor Iridium discovery; braces | Fuel until the Keg, then cargo, Hardrock | 0.21 |
| **D** 262–395 | Magma (58R); bulk to Depots; Poor Thorium lode (ping r310, v1) | Mk III (v1); Magma Taps; first Reactor Cores | t5 parts; Packs in Depots (from cargo) | Mk III, Tap placement | Hull, weight | 0.20 |
| **E1** 396–479 | Methane, gems, Static Zone (r465) | Reactor Cores; Gem Cutter; Gas Taps | t6 parts; Patch Kits, Mega Pops | Gems; Deep Eye reveals | Hull, weight, cargo | 0.11 |
| **E2** 480–583 | Deep gems, Notch, arena | Gem parts | t7 parts | Peridot, Fire Opal, Diamond | Hull, weight, cargo | 0.05 |

### 1.3 What rides logistics
Canon §4.9 owns the table. Every node's `accept(item, side)` checks the item class: underground nodes refuse gems, relics, cut gems, gem parts and Weld Packs; Export refuses everything without an Export price (relics, cut gems, gem parts, Kits, Drums, Packs, consumables). A refused item waits at the line head (visible back-pressure), never destroyed. Consumables never ride belts: Pod Works puts them straight into the Stockpile.

### 1.4 Why the push-your-luck trip survives
1. Gems and relics reach cash only in pod cargo; from D they dominate value.
2. Lode rock is pod-proof; scattered cells cannot host a drill.
3. Factory ≤ 0.40 × PRI (B–E2); perfect play ≤ 0.55 (§5.2).
4. v1 frontier: nothing runs below max(63, deepest dock row + 10); ≤ 6 Depots, never a shop, save or respawn point.
5. Depots serve once per trip, repair ≤ 90 HP, and take Weld Packs only from cargo (1 slot, 3 mu per 15 HP); an unshored Shear spills 25%.
6. Kits compete with ore for slots and mass; death destroys carried Kits.
7. Bulk dropped at a Depot pays 90% at Export, after lift latency.
8. Away income ≤ 5 × PRI per rolling 24 h (§8), ≈ 8% of a three-session day.

### 1.5 Build order

| Tier | Features |
|---|---|
| M0 | Visual stand-ins only (§3.8) |
| MVP | Rules 1–3 without power, Chutes or Depots ("up" costs Kits and Mk I throughput); phases A–D to the r320 Seal; factory sleeps while away (§8) |
| v1.0 | Power, Chutes, Depots and the frontier, Shears, phases E1–E2, Away budget |
| post | Gem Lift (breaks 1.4.1 by design, so it must carry a cost), Pneumatic Tube, Cargo Rail |

### 1.6 Risks
- Pod-first players may ignore the factory until t3: the survey shaft, Starter Kit and survey set make the first chain ≤ 8 min (canon §5.2).
- MVP lifts cost no power: deep Mk I lifts are braked only by 30/min and Rail Kits.
- Phase-B share (0.14) is just under the 0.15 floor at provisional PRI; re-tune with bot PRI using the canon lever order.

---

## 2. Grid and placement

### 2.1 Two build planes

| | Surface Yard | Underground slab |
|---|---|---|
| Pick plane | y = 0 | z = 0 |
| Size | Canon §3.1 | Rows 1–583 (MVP to r319) |
| Footprints | 1×1, 2×2, 3×3; Rim buildings 4×3, fixed | ≤ 2×2; Depot 3×2 |
| Rotation | 4 directions | None; ports are fixed by rule (§2.3) |
| Cell contents | 1 building | ≤ 1 mount + ≤ 1 occupant; both only when the mount is a Lamp or Shoring Brace (canon §3.1) |
| Build method | Yard crane: instant, cash + Stockpile parts | Ghost, built from a Kit by the pod or (v1) an activated Depot |
| Belts | Any direction, auto-corner; a straight crossing becomes a Junction; a T auto-places a Router (Even); no side-loading | Horizontal, on a solid floor |

### 2.2 Surface rules
- **Yard rows:** row k spans z ∈ [−1−k, −k]; only purchased rows are buildable; nothing goes on the Rim strip. Rim buildings: canon §2.4.
- **Headframe:** 2×2 on Yard rows 1–2 covering column c, at x {c, c+1} or {c−1, c}, where column c holds a lift or (v1) chute whose top cell is row 0. Valid c: **5–9, 14–29, 34–39, 44–47** (31 columns clear of paved pads and Rim buildings); one Headframe per column.
- **Survey set** (R17; $0, deconstructable): survey column c = x0 − 1 if valid, else x0 + 3 (x0 = the scripted lode's left column; one is always valid). Rusted Headframe at x {c, c+1} ({c−1, c} if c + 1 is invalid), Yard rows 1–2; Smelter on the same columns, rows 4–5; Storage Bin, rows 7–8. Rows 3 and 6 stay empty, so two 1-tile belts ($10) complete Headframe → Smelter → Bin. "Rusted" is a skin; all three work normally.
- **Ports:** a building's facing edge is its output edge. Output = a belt starting adjacent to it and pointing away; input = a belt whose last tile points into any other edge. Bins and Silos: inputs on all edges; the output edge is an unload port with an item filter (Off by default). Export: inputs on all edges, no output. Pod Works: inputs on all edges, output straight to the Stockpile. Headframe: §3.4.

### 2.3 Underground layers

| Kind | Layer | Pieces | Blocks pod | Needs |
|---|---|---|---|---|
| Occupant | z −0.45…+0.45 | Auto-Drill, Depot (not its bay), Magma Tap, Gas Tap | yes | Footprint excavated and seen; support §2.4 |
| Floor mount | mount slot | Belt, Router | no | Excavated, seen; solid below (terrain, Hardrock, lode rock, Seal) |
| Wall mount | z −1.0…−0.45 | Lift, Chute, Lamp, Shoring Brace | no | Excavated, seen |

**Anchored cells** (canon §3.3): the flag is set on the cell directly beneath every Belt, Router and occupant cell and cleared when that piece goes. The pod's drill refuses it; explosives and methane skip it; a dig in progress on a cell that becomes anchored is cancelled. Lamp, Shoring, lift and chute cells never anchor.

### 2.4 Resource buildings and the Depot

| Building | Footprint | Beneath | Extra |
|---|---|---|---|
| Auto-Drill | 2×2 on rows top−2…top−1, columns {lx, lx+1} or {lx+1, lx+2} of the lode at (lx, top) | Lode rock | Discovered; one per lode; v1 Mk III at r ≥ 262 |
| Magma Tap | 2×2 with one bottom cell directly above a Magma cell | Magma, which becomes `tapped` | — |
| Gas Tap | 2×2 with one bottom cell directly above a **revealed** Methane cell | Methane, which becomes `capped` | Needs a Deep Eye or Claimsight reveal |
| Depot | 3×2 at x0…x0+2, rows rTop…rTop+1; dock = (x0+1, rTop+1) | 3 solid cells, which become anchored | Chimney (x0+1, rTop−1) excavated; limits canon §4.1 |

### 2.5 Placement validation
One synchronous validator (§10.10) serves the red-ghost preview, the confirm and ghost completion.

| Code | Rule |
|---|---|
| E_LOCKED | Building or Mk not unlocked (§9) |
| E_YARD | Outside purchased Yard rows, on the Rim, or under a Rim building |
| E_OCCUPIED | Cell taken (per the §2.3 sharing rule) |
| E_SOLID / E_UNSEEN | Underground cell not excavated / never seen |
| E_FLOOR | Floor mount with no solid cell below |
| E_LODE | Drill not on a discovered lode's top, or the lode already has a drill |
| E_HEAT | v1: Mk I/II drill at rows ≥ 262 |
| E_DEPOT | Depot count, band, spacing, dock row, base or chimney (canon §4.1) |
| E_POD | Occupant footprint overlaps any cell the pod's box touches (checked at completion) |
| E_COLUMN | Lift or chute column not fully excavated, crossing another mount, or an invalid Headframe column |
| E_ARENA | Rows ≥ 584 |
| E_FUNDS / E_PARTS / E_KIT | Cash, Stockpile parts or Kit short |

Toast text: 03 §6.2. A v1 occupant outside the frontier is legal but idle ("No power — outside Depot range").

### 2.6 Build methods
**Surface:** `place()` debits cash and takes Stockpile parts in one synchronous call; a failed call changes nothing. "Instant build" skips the confirm (03 §4.3).

**Underground ghost jobs:** ghosts go on any excavated, seen cells (build mode freezes the pod), ≤ 256; one job completes at a time, oldest first.

Kits per job: machine (drill, tap, Depot), whole footprint, 1 matching Kit (which carries the Mk); belt run ≤ 8 tiles in one row, Belt Kit metered per tile; Router, Lamp (Kit metered ×4) or Shoring, 1 cell each; lift foot + ≤ 31 rows, Lift Foot Kit; each further ≤ 32 rows, Lift Rail; chute ≤ 16 rows, Chute Kit metered per row.

A job completes when the pod, carrying the Kit, has stayed within 2 tiles (Chebyshev, any job cell) for 60 consecutive pod steps (1.0 s). The pod step then calls `completeGhost`, which validates, removes the Kit, places the structure and writes mount, occupant and anchored in one call; on any error nothing is consumed and the timer restarts. The 45-row survey lift is two jobs: foot at the bottom, rail on the way up.

**Depot auto-build (v1):** an activated Depot builds, from stocked Kits, ghosts whose anchor cell (lift or chute section: bottom cell; others: footprint bottom-left) lies within Chebyshev 10 of its dock, one job per 100 ticks × s; never a Depot Kit; paused while away.

### 2.7 Costs, refunds, undo

| Action | Surface | Underground |
|---|---|---|
| Place | Cash + parts on confirm | Ghost is free; the Kit is consumed at completion |
| Deconstruct | 100%: cash to the wallet, parts and contents to the Stockpile; blocked if it lacks room | Kit to cargo (pod within 2 tiles, free slot, player's choice) else the Stockpile; metered Kits merge; buffers to the Stockpile; a Depot must be emptied or scrapped (second confirm) |
| Items on a removed belt tile | To the Stockpile if room, else destroyed (value shown in the confirm) | Same |
| Upgrade Mk | Paint over; pay or refund the difference | Higher-Mk Kit as a job; old Kit refunded |
| Undo / redo (≥ 50 steps) | Exact inverse | Unbuilt ghost → removed; built → deconstruct; deconstruct → ghost |
| Depot price | — | $2,000 × 3^(n−1) + parts (§3.1), where n = Depots + Depot Kits owned + 1 |

### 2.8 Build order

| Tier | Features |
|---|---|
| M0 | Surface ghost on 48 × 8 with rotation; underground ghost highlight (no rules) |
| MVP | §2.1–2.7 except Depot rules, auto-build, Chute jobs and E_HEAT; survey set; anchored cells; undo/redo |
| v1.0 | Depot rules and auto-build, Chute jobs, E_HEAT, Shoring and Lamp jobs; copy/paste, mass delete and multi-select (03 §4.7) |
| post | Blueprints and share codes; Drone Bay |

### 2.9 Risks
- Anchored cells annoy players who belt their shaft floor: the refusal toast offers "Remove belt (refund)".
- Remote ghosts pile up: 256 cap; the Shopping list chip (03) lists the Kits still needed.

---

## 3. Building roster

### 3.1 Master table
Costs and power draws are owned here; rates are canon §3.11; scope §3.8.

| Building | Where / footprint | Cost | Unlock (§9) | kW (v1) |
|---|---|---|---|---|
| **Belt** Mk I / II / III | 1×1; underground floor mount | Per tile $5 / $40 + 1 Gear / $150 + 1 Gear + 1 Wire; Belt Kit (8 tiles) $80 / $320 + 8 Gear / $1,200 + 8 Gear + 8 Wire | U2 / U8 / U10 | 0 |
| **Router** | 1×1, both planes | $40; Router Kit $60 | U3 | 0 |
| **Storage Bin** | Surface 2×2 | $250 | U2 | 0 |
| **Silo** | Surface 3×3 | $6,000 + 10 Hull Plate | U8 | 0 |
| **Smelter** | Surface 2×2 | $300 | U2 | 3 |
| **Assembler** | Surface 2×2 | $500 | U3 | 3 |
| **Export Terminal** | Surface 2×2 | $400 | U3 | 1 |
| **Headframe** | Surface 2×2, Yard rows 1–2 (§2.2) | $200 | U2 | 0 |
| **Auto-Drill** Mk I / II / III | Underground 2×2 on a lode | Kit: $500 / $3,000 + 4 Motor / $15,000 + 6 Drill Bit + 2 Coolant Coil | U2 / U8 / U10 | 3 / 6 / 10 |
| **Bucket Lift** Mk I / II / III | Wall mount: foot + column | Lift Foot Kit: $400 / $3,000 + 4 Motor / $12,000 + 4 Motor + 2 Pressure Vessel. **Lift Rail** $100 per extra 32 rows (any Mk) | U2 / U8 / U10 | ⌈H/16⌉ |
| **Depot** | Underground 3×2 | Depot Kit: $2,000 × 3^(n−1), plus parts by n: n1 none; n2 12 Hull Plate; n3 10 Motor + 8 Circuit; n4 8 Pressure Vessel + 6 Drill Bit; n5 12 Reactor Core; n6 30 Reactor Core | U6 | 2 |
| **Chute** | Wall-mount column | Chute Kit (16 rows) $150 | U6 | 0 |
| **Shoring Brace** | Wall mount 1×1 | Shoring Kit $400 | U6 | 0 |
| **Lamp** | Wall mount 1×1 | Lamp Kit (×4) $100 | U6 | 0 |
| **Refinery** | Surface 2×2 | $2,500 + 4 Hull Plate | U7 | 3 |
| **Pod Works** (≤ 2) | Surface 3×3 | $12,000 + 6 Motor + 4 Circuit | U8 | 6 |
| **Gem Cutter** | Surface 2×2 | $20,000 + 6 Drill Bit + 2 Circuit | U9 | 5 |
| **Co-op Generator** | Surface 2×2, pre-placed (F4) | — | U0 | +10 |
| **Solar Array** | Surface 2×2 | $1,500 | U2 | +4 |
| **Power Plant** | Surface 2×2 | $6,000 + 4 Motor + 2 Coolant Coil | U7 | +20 while burning |
| **Magma Tap** | Underground 2×2 on Magma | Kit $25,000 + 5 Pressure Vessel + 8 Coolant Coil | U10 | +60 |
| **Gas Tap** | Underground 2×2 on revealed Methane | Kit $60,000 + 4 Reactor Core + 2 Pressure Vessel | U11 | 4 |

Parts on Mk II/III and late buildings are 7–12% of cash. Draws make the onboarding chain (Mk I drill + 45-row lift + Smelter + Export) exactly the Co-op Generator's 10 kW.

### 3.2 Throughput and buffers
Recipes: §4.2.

| Building | Throughput (s = 1) | Buffers |
|---|---|---|
| Belt Mk I / II / III | 60 / 120 / 240 per min; 1 / 2 / 4 items per tile compressed | — |
| Router | ≤ 1 item per tick | 1 |
| Bin / Silo | Unload port 240/min | 200 / 1,000 mixed |
| Smelter | 30 ore → 15 ingots/min, or 10 specimens → 20 ingots/min | In 4 ore or 2 specimens; out 6 |
| Assembler, Refinery, Gem Cutter | 60 ÷ recipe s crafts/min | In 2 crafts per ingredient; out 2 crafts |
| Pod Works | One craft at a time | In 2 crafts; out to the Stockpile |
| Export Terminal | 240/min at 90% | 50 |
| Headframe | Follows its lift or chute | 4 |
| Auto-Drill Mk I / II / III | 8 / 10 / 24 ore/min × purity | Out 4 |
| Bucket Lift | §3.4 | Lip 1; in flight rate × transit |
| Chute | 300/min; 8 rows/s | In flight |
| Depot | Hopper out 240/min; pod unload 5/s | §3.5 |
| Power Plant / Gas Tap | 1 Drum/min burned / 4 Drums/min made | In 5 / out 4 |

### 3.3 Hazard vulnerability (v1)

| Building | Shear (unshored) | Methane breach in its 3×3 | Magma |
|---|---|---|---|
| Underground Belt / Router | Sheared if its run splits at a Shoring boundary or its port partner moves differently | Damaged | — |
| Auto-Drill, Taps | Sheared unless its rows and its resource's rows shift alike (≈ 68% at intensity 1) | Damaged (a capped cell never explodes) | Mk I/II drills idle at r ≥ 262 |
| Lift, Chute | Sheared if any two rows shift differently (≥ 90% at intensity 1, H ≥ 8) | Damaged | — |
| Depot | Sheared; spills 25% | Damaged; nothing spills | — |
| Lamp / Shoring Brace | Lamp moves with its row, never Sheared; Shoring cells never shift | Lamp Damaged; Brace immune | — |
| Surface | Immune (rows 0–5 and the Yard never shift) | Immune | Immune |

Repair costs 1 Weld Pack per Sheared or Damaged structure (§7.3).

### 3.4 Vertical movers
**Bucket Lift.** H = foot row − top row.

| | Mk I | Mk II | Mk III |
|---|---|---|---|
| Rate | 30/min | 90/min | 240/min |
| Ticks per row | 40/3 | 8 | 5 |
| Transit, H = 45 / 100 | 30 s / 67 s | 18 s / 40 s | 11 s / 25 s |
| Items in flight, H = 300 | 100 | 180 | 300 |

Kits: 1 Lift Foot Kit (H ≤ 31, i.e. 32 rows of column) + ⌈(H − 31)/32⌉ Lift Rails (H = 45 → 1 Rail); power ⌈H/16⌉ kW (r45 → 3). Inputs: belts into the foot from left or right, an adjacent drill, tap or Depot output, or another lift's top (relay). Outputs: a row-0 top feeds its Headframe; an underground top feeds an adjacent belt tail, Depot side port or lift foot. **`FirstLiftDelivery`** fires the first time a lift delivers lode ore to a Headframe.

**Chute (v1).** Inlet at the top cell: a belt from left or right, an adjacent output, or a chute-mode Headframe. Outlet at the bottom cell: the occupant directly below (a Depot via its chimney, or a Router's top side), else left/right belt tails. Transit ⌈5H/2⌉ ticks. Refuses gems, relics, cut gems, gem parts, Weld Packs and consumables (canon §4.8).

**Headframe.** Lift mode: pushes lift items onto belts leaving its three Yard-side edges, round-robin. Chute mode (v1, Fac C8; column c holds a chute): takes belts into its Yard-side edges and feeds the chute at ≤ 300/min; refused classes wait on the belt.

### 3.5 Depot (v1)
Canon §4.1 owns limits, cost, service and risk; canon §3.11 owns the pool sizes.

| Item | Rule |
|---|---|
| Geometry | Centre column = non-blocking **bay**; dock cell bottom-centre, entered through the chimney; side columns block |
| Ports | West (x0−1) and East (x0+3) at the dock row, In or Out (auto from the connection; tap to flip); the chimney takes In from a Chute |
| Input routing | Bulk specimens and lode ore (incl. Kerogen) → hopper (40); Drums → fuel pool (10 L each, cap 200 L); Kits → stock (20; a metered Kit counts 1); all else, Weld Packs included, refused |
| Dock session | Pad arming per canon §2.4; the dock sheet pauses the pod. **Once per trip per Depot:** a second dock that trip opens a read-only "Serviced this trip" sheet; Rim arrival re-arms all. In session: refuel 10 L/s; repair 10 HP/s [tune] from the HP pool; unload bulk 5 items/s; unload Kits, Drums, Packs (Packs → HP pool, 15 HP each, cap 90); take Kits, whole Drums or Packs; Realign/Repair nearby clusters from the pool (§7.3). Gems and relics greyed "Pod-only". Works unpowered |
| Activation | First dock enables auto-build (§2.6) |
| Power / frontier | 2 kW; occupants with a footprint cell within Chebyshev 10 of the dock are connected (§6.2) |

### 3.6 Auto-Drills and lodes
- **Lodes:** canon §2.9, §3.2 (23, incl. fixed Poor Iridium r195–259 and Poor Thorium r325–389); MVP Kerogen and Thorium lodes are Unknown seams.
- **Discovery** is the World's (Scanner radius, canon §2.6), via `discoverLode(id, purityKnown)`. With Tin Ear, purity shows "?" until a Dowser-or-better scan or the first ore; fixed lodes always show it.
- **Rate** = Mk rate × purity × s; expected purity 0.95 (Thorium 0.70).
- **No depletion.** NG+ (post) re-rolls lodes below r40; drills on vanished lodes refund as Kits to the Stockpile.

### 3.7 Kits
Prices: §3.1 (book = price); slots and mass: canon §4.8. Bought Kits go **To cargo** or **To Stockpile** (for chute delivery to Depots, v1, or loading at the Shed). **Starter Kit:** canon §2.1, free once on discovering the scripted lode (book $1,160). **Depot Kit:** pod only; never chuted, lifted or auto-built.

### 3.8 Build order

| Tier | Features |
|---|---|
| M0 | Blockouts: 6 machines, 2 belts with instanced items, 1 back-wall lift with scrolling buckets |
| MVP | Canon §5.5 MVP buildings and their Kits; Starter Kit; survey set; Assay "Stockpile" toggle |
| v1.0 | Canon §5.5 v1 buildings, Headframe chute mode, Supply Shed Drums and Packs |
| post | Canon §5.4 items 2, 5–9 |

### 3.9 Risks
- 22 building types plus Mk tiers: shared body and role-colour kit (03 §8.6).
- Mk I lift latency (30 s for 45 rows, 200 s for 300) reads as "broken": the logistics overlay shows "in transit: n" (03 §4.10).

---

## 4. Items and recipes

### 4.1 Items

| Class | Items (value or book value) | Rides |
|---|---|---|
| Bulk specimen | Canon §2.2, tiers 1–6 | Canon §4.9 |
| Gem | Peridot, Fire Opal, Diamond, Echo Quartz (canon §2.2) | Pod; Yard after Assay "Stockpile"; Export 90% |
| Relic, hoard item | Canon §2.3 | Pod → Assay only |
| Lode ore | Hematite Ore $3, Copper Ore $6, Cobalt Ore $10, Gold Ore $25, Iridium Ore $75, Thorium Ore $200, Kerogen $2 | Logistics; Export |
| Ingot | Iron $8, Copper $16, Cobalt $26, Gold $65, Iridium $195, Thorium Rod $520 | Logistics; Export |
| Part | Gear $5, Wire $10, Hull Plate $55, Coolant Coil $60, Motor $110, Circuit $125, Drill Bit $265, Pressure Vessel $400, Reactor Core $1,500 | Logistics; Export; Garage |
| Cut gem | Cut Peridot, Cut Fire Opal, Cut Diamond; book = the gem's value | Yard only; unsellable, non-exportable |
| Gem part | Lens $5,125, Opal Plating $20,110, Diamond Bit $100,530 (book) | Yard only; unsellable, non-exportable; Garage |
| Service | Fuel Drum (10 L), book $10; Weld Pack (15 HP), book $225 | Canon §4.9 |
| Kit | §3.1; book = price | Pod, logistics, Depot stock |
| Consumable | The six in canon §2.7; book = Pod Works input value | Stockpile → Supply Shed → pod |

### 4.2 Recipes

| # | Inputs → output | s | × |
|---|---|---|---|
| S1–S6 | Smelter: 2 lode ore → 1 ingot (Hematite, Copper, Cobalt, Gold, Iridium; Thorium Ore → Thorium Rod) | 4 | 1.30 |
| S7–S10 | Smelter: 1 specimen of tier 1–4 (Hematite, Copper, Cobalt, Gold) → 2 ingots of that metal | 6 | 0.52 |
| A1 | 1 Iron Ingot → 2 Gear | 2 | 1.25 |
| A2 | 1 Copper Ingot → 2 Wire | 2 | 1.25 |
| A3 | 2 Iron Ingot + 1 Cobalt Ingot → Hull Plate | 5 | 1.31 |
| A4 | 2 Wire + 1 Cobalt Ingot → Coolant Coil | 5 | 1.30 |
| A5 | 3 Wire + 1 Gold Ingot → Circuit | 6 | 1.32 |
| A6 | 2 Gear + 2 Wire + 1 Hull Plate → Motor | 8 | 1.29 |
| A7 | 1 Iridium Ingot + 2 Gear → Drill Bit | 8 | 1.29 |
| A8 | 2 Hull Plate + 1 Iridium Ingot → Pressure Vessel | 10 | 1.31 |
| A9 | 2 Thorium Rod + 1 Circuit → Reactor Core (v1) | 15 | 1.29 |
| A10 | 3 Hull Plate + 1 Coolant Coil → Weld Pack (v1) | 8 | 1.0 |
| A11 | 1 Cut Peridot + 1 Circuit → Lens (v1) | 10 | 1.0 |
| A12 | 1 Cut Fire Opal + 2 Hull Plate → Opal Plating (v1) | 12 | 1.0 |
| A13 | 1 Cut Diamond + 2 Drill Bit → Diamond Bit (v1) | 15 | 1.0 |
| G1–G3 | Gem Cutter: Peridot / Fire Opal / Diamond → its cut form (v1) | 60 | 1.0 |
| R1 | Refinery: 5 Kerogen → 1 Fuel Drum (v1) | 6 | 1.0 |
| P1 | Power Plant: 1 Fuel Drum → 20 kW for 60 s (v1) | 60 | — |
| T1 | Gas Tap: capped methane → 1 Fuel Drum (v1) | 15 | — |

A1–A13 run in the Assembler; × = output value ÷ input value (§4.1 prices; book values for A10–A13, G, R). The first smeltable item into an empty Smelter buffer sets its recipe. Not smeltable: Iridium and Thorium specimens, gems, Kerogen. Echo Quartz has no cut form. Assembly stays in canon §4.3.3's ×1.25–1.4 band; Packs, Drums, cut gems and gem parts add no value.

### 4.3 Tree
★ = used by a pod upgrade; ◆ = used by a Pod Works consumable.
```
Hematite Ore ×2 ─Smelter→ Iron Ingot
    ├─ Gear ×2 ★◆ ─┬→ Motor ★◆ (+2 Wire +1 Hull Plate)
    │              └→ Drill Bit ★ (+1 Iridium Ingot) ──→ Diamond Bit ★ (+1 Cut Diamond)
    └─ Hull Plate ★◆ (+1 Cobalt Ingot) ─┬→ Pressure Vessel ★◆ (+1 Iridium Ingot)
                                        ├→ Weld Pack ◆ (+1 Coolant Coil) → Depot HP pool, Realign
                                        └→ Opal Plating ★ (+1 Cut Fire Opal)
Copper Ore ×2 → Copper Ingot → Wire ×2 ─┬→ Coolant Coil ★◆ (+1 Cobalt Ingot)
                                        └→ Circuit ★◆ (3 Wire +1 Gold Ingot) ─┬→ Reactor Core ★◆ (+2 Thorium Rod)
                                                                              └→ Lens ★ (+1 Cut Peridot)
Cobalt Ore ×2 → Cobalt Ingot · Gold Ore ×2 → Gold Ingot
Iridium Ore ×2 → Iridium Ingot (lode only) · Thorium Ore ×2 → Thorium Rod (lode only) ◆
Kerogen ×5 ─Refinery→ Fuel Drum ◆ → Depot fuel pool, Power Plant
Gem (pod) ─Assay "Stockpile"→ Bin → Gem Cutter → cut gem → gem part (Garage only)
Specimen tiers 1–4 (pod) → Stockpile → Smelter (1 → 2 ingots): the anti-soft-lock path
```

### 4.4 Upgrade parts and Pod Works
- **Upgrade bills:** counts 01 §5.1; families, ranges and ruled exceptions (Keg = 4 Pressure Vessels; Scanner t7 = 8 Lens + 1 Opal Plating; Drill t7 = 1 Diamond Bit + 1 Reactor Core) canon §4.3.5. The Garage takes parts from the Stockpile inside the purchase call, all or nothing.
- **Pod Works** (v1, ≤ 2) obeys canon §4.3.4: inputs ≥ 40% of the shop price, ≥ 90 s per craft.

| # | Consumable (shop price) | Recipe | Input $ | % of shop | Time | From phase |
|---|---|---|---|---|---|---|
| PW1 | Pop Charge ($2,000) | 8 Hull Plate + 3 Circuit + 1 Fuel Drum | $825 | 41 | 90 s | C |
| PW2 | Hop Beacon ($2,000) | 4 Circuit + 3 Coolant Coil + 2 Motor | $900 | 45 | 90 s | C |
| PW3 | Jerrycan ($2,000) | 2 Pressure Vessel + 3 Fuel Drum | $830 | 42 | 90 s | C |
| PW4 | Patch Kit ($7,500) | 6 Pressure Vessel + 2 Weld Pack + 2 Circuit | $3,100 | 41 | 120 s | C |
| PW5 | Mega Pop ($5,000) | 2 Thorium Rod + 2 Pressure Vessel + 2 Circuit | $2,090 | 42 | 120 s | D |
| PW6 | Homing Beacon ($10,000) | 1 Reactor Core + 4 Pressure Vessel + 8 Circuit | $4,100 | 41 | 150 s | D |

Output goes to the Stockpile, loaded at the Supply Shed ("Restock from Stockpile"); ceiling 2 × 40 crafts/h.

### 4.5 Build order

| Tier | Features |
|---|---|
| M0 | Item registry stub (u16, append-only; 04 §4.3); 6 ore + 6 ingot meshes |
| MVP | All items except Thorium Ore/Rod, Kerogen, Reactor Core, cut gems, gem parts, Fuel Drum and Weld Pack. Recipes S1–S5, S7–S10, A1–A8 |
| v1.0 | The rest, PW1–PW6 included |
| post | Crate (15 identical items) for the Crate Packer |

### 4.6 Risks
- Possession unlocks can open a long list: the picker groups by family and pins the next Garage tier's recipes.
- Book values on unsellable items may read as cash: the Stockpile UI labels them "Upgrade use only" (03 §6.3).

---

## 5. Throughput and balance (provisional until the bot)

### 5.1 One lode, smelted and exported

| Mk | Poor / Normal / Rich (ore/min) |
|---|---|
| I | 4 / 8 / 16 |
| II | 5 / 10 / 20 |
| III | 12 / 24 / 48 (Thorium has no Rich) |

Export $/min per ore/min (×1.17): Hematite $3.51, Copper $7.02, Cobalt $11.70, Gold $29.25, Iridium $87.75, Thorium $234. Example: Normal Iridium at Mk II = $878/min.

### 5.2 Guardrail check (canon §4.3.1–4.3.2)
RFI and MFI per canon §4.3.1 (MFI = brute-force best assembled mix). **v1 coverage** = mean share of that lode value able to run (band-0 lodes plus ≤ 6 optimally placed Depots; 40 seeds). **MVP** = Mk I only, no Kerogen or Thorium, play to r319.

| Phase | Mk | RFI $/min (× PRI) | MFI $/min (× PRI) | v1 coverage (range) → RFI / MFI × PRI | MVP RFI / MFI × PRI |
|---|---|---|---|---|---|
| A | I | 94 (0.38) | 121 (0.48) | 1.00 → 0.38 / 0.48 | 0.38 / 0.48 |
| B | I | 305 (0.22) | 460 (0.33) | 0.82 (0.51–1.00) → 0.18 / 0.27 | 0.22 / 0.33 |
| C | II | 1,527 (0.38) | 2,113 (0.53) | 0.71 (0.27–1.00) → 0.27 / 0.38 | 0.31 / 0.42 |
| D | III | 11,601 (0.39) | 14,665 (0.49) | 0.67 (0.41–0.97) → 0.26 / 0.33 | 0.07 / 0.09 |
| E1 | III | 20,048 (0.16) | 25,249 (0.20) | 0.66 (0.37–0.94) → 0.11 / 0.13 | — |
| E2 | III | 32,702 (0.07) | 41,737 (0.08) | 0.64 (0.43–0.87) → 0.04 / 0.05 | — |

B–E2 meet the hard cap (RFI ≤ 0.40, MFI ≤ 0.55) even at full coverage; A is exempt. C and D sit closest; the bot checks the 90th-percentile seed.

### 5.3 Typical factories at milestones
Smelt and export at v1 coverage; power from §6.3.

| Milestone | Lodes running (metal purity Mk) | Ore/min | $/min | × PRI | Share | v1 kW |
|---|---|---|---|---|---|---|
| **M1** A, first lode (~0:30) | Cu N I (scripted) | 8 | 58 | 0.23 | 0.19 | 10 |
| **M2** B, r≈110 | M1 + Fe N I, Fe P I, Cu P I, Co N I | 32 | 223 | 0.16 | 0.14 | 44 |
| **M3** C, r≈230 | M2 (Cu P → II, Co N → II) + Co P I, Au N II, Ir P II | 54 | 1,032 | 0.26 | 0.21 | 102 |
| **M4** D, r≈360 | M3 − Fe P − Co P (Fe N → II) + Au R III, Ir N III, Th P III | 132 | 7,296 | 0.24 | 0.20 | 187 |
| **M5** E1, r≈450 | M4 with Ir P → III, + Ir N III, Th N III | 187 | 15,632 | 0.13 | 0.11 | 251 |
| **M6** E2, r≈550 | M5 + Th P III, Th N III | 223 | 24,056 | 0.05 | 0.05 | 317 |

Assembled export adds ×1.2–1.4. MVP phase C (M3's lodes at Mk I): 48 ore/min, $855/min, share 0.18, inside the reported 8–25% band (canon §5.2).

### 5.4 Parts versus lode time
Bills: 01 §5.1 counts with R13, R23. Lode-minutes = the slowest metal at that milestone's factory.

| Tranche | Parts $ | Lode ore needed | Lode-minutes |
|---|---|---|---|
| All t3 | $1,780 | Fe 68, Co 40, Cu 48 | ≈ 6 at M2 (or specimens) |
| All t4 | $4,980 | Fe 190, Co 102, Cu 52, **Ir 8 (Keg)** | Ir 2.0 (Poor Ir, Mk I); Fe ≈ 16 at M3 |
| All t5 | $18,870 | **Ir 94**, Fe 268, Co 116 | Ir 19 at M3 (Poor Ir, Mk II); 2.6 at M4 |
| All t6 | $89,135 | **Th 224**, Cu 186, Au 124 | Th 19 at M4 (Poor Th, Mk III); 6.2 at M5 |
| All t7 | gem parts + Reactor Cores | ≈ 26 Peridot, 6 Fire Opal, 1 Diamond (pod-delivered) | Gem-limited |

Gates: a Mk III drill Kit (6 Drill Bits) = 12 Iridium ore = 2.4 min of the Poor Iridium lode at Mk II; the methane gear check (t6 Hull + Radiator, 17 Reactor Cores) = 68 Thorium ore = 5.7 min of the Poor Thorium lode.

### 5.5 Logistics capacity
One Smelter (30 ore/min) serves 3.75 Mk I, 3 Mk II or 1.25 Mk III Normal drills. One Mk I lift (30/min) carries 3 Mk I Normal drills; M3's 54 ore/min needs 2 Mk I lifts or 1 Mk II. A Mk I belt (60/min) bottlenecks only Mk III Rich drills sharing a line.

### 5.6 Market, Export and bot measures
- **Market:** flat 90%, no saturation, drift or quotas; Export prices are never a lever (canon §4.3.2). Export calls `wallet.credit('export', ⌊value × 9/10⌋)` per item in the sale tick.
- **Factory $** (share and cap) = Export cash (live + away) + 90% of the book value of factory-made items consumed by Garage, Supply Shed and Yard-crane purchases.
- **Pod-only check** (canon §4.3.2): under R12 a run with no Auto-Drills stalls at t4 (no Iridium Ingots), so the bot runs a **minimum-factory profile** (drills only on Iridium and Thorium lodes, no Export, other parts from specimens); it must reach the credits ≥ 30% later than the standard profile.
- **MVP lode-parts share** (canon §5.2) = ingots smelted from lode ore ÷ all ingots smelted, from game start to the last t4 purchase; target ≥ 0.50.

### 5.7 Build order

| Tier | Features |
|---|---|
| MVP | Factory side of the minimal bot (04 §11.2): share per phase, RFI/MFI checks, lode-parts share |
| v1.0 | Full bot: coverage, power, Shears, Away budget, minimum-factory profile, 90th-percentile seed |

### 5.8 Risks
- Provisional PRI may be off by 1.2–2.3× (canon §5.6), dropping B–D shares to ≈ 0.07–0.12: re-tune with bot PRI before content lock, levers in canon order.
- Lode-only Iridium or Thorium walls t5, t6 or the Keg: **fallback (R12)** Iridium and Thorium specimens smelt 1 → 1 ingot (S11–S12).
- A fully covered C seed reaches RFI 0.38 / MFI 0.53: still under the cap; the bot checks the 90th-percentile seed.
- MVP phase-D share is 0.07 (Seal at r320, Mk I): reported, not gated (canon §5.2).

---

## 6. Power (v1)

### 6.1 MVP
No power (canon §4.13); s_Q ≡ 65,536; `kw` fields exist, hidden.

### 6.2 Model
- **One pool, no wires.** Each tick, supply = Σ generator kW; demand = Σ nameplate kW of connected, enabled consumers not Sheared or Damaged; s_Q = 65,536 if demand = 0, else min(65,536, ⌊65,536 × supply / demand⌋). s scales drill and craft progress, lift clock and admission, Export sales, the Depot hopper and auto-build; no bonus above 1.
- **Connected** (canon §4.13): surface buildings and mounts always; underground occupants (Magma Taps included) if any footprint cell is in rows 0–63 or within Chebyshev 10 of a Depot dock. Unconnected occupants stop ("No power — outside Depot range") and count in neither demand nor supply.
- Every consumer and Power Plant has On/Off. Power chip and overlay: 03 §4.10.

| Generator | kW | Cost | $/kW | Condition |
|---|---|---|---|---|
| Co-op Generator | 10 | pre-placed | — | Always |
| Solar Array | 4 | $1,500 | 375 | Always (no day–night in v1) |
| Power Plant | 20 | $6,000 + parts | ≈ 330 + Drums | Takes 1 Drum per 1,200-tick burn; none → 0 kW |
| Magma Tap | 60 | $25,000 + parts | ≈ 460 | Connected and intact |

### 6.3 Provisioning by milestone

| Milestone | Demand (kW) | Supply that reaches s = 1 | Fuel |
|---|---|---|---|
| M1 | 10 (drill 3, lift 3, Smelter 3, Export 1) | Co-op Generator alone | — |
| M2 | 44 | 10 + 4 Solar + 1 Power Plant = 46 | 1 Drum/min: 5 Kerogen/min (a Normal lode at Mk I gives 8) or $30/min of Shed Drums |
| M3 | 102 | 10 + 8 Solar + 3 Power Plants = 102 | 3 Drums/min |
| M4 | 187 | 10 + 6 Solar + 2 Power Plants + 2 Magma Taps = 194 | 2 Drums/min |
| M5 | 251 | 10 + 6 Solar + 2 Power Plants + 3 Magma Taps = 254 | 2 Drums/min |
| M6 | 317 | 10 + 7 Solar + 2 Power Plants + 4 Magma Taps = 318 | 2 Drums/min |

The first Assembler (U3, 3 kW) drops M1 to s = 0.77: the cue for a Solar Array.

### 6.4 Build order

| Tier | Features |
|---|---|
| MVP | `kw` per building; s_Q plumbed through every rate at 65,536 |
| v1.0 | Pool, connectivity, generators, toggles, Power overlay, power chip |
| post | Day–night solar curve |

### 6.5 Risks
- Lifts dominate late demand (M6: 138 of 317 kW): the overlay lists kW per lift.
- Magma Taps need Depot coverage, so a player who spends Depots on lodes may run short deep: the Power overlay marks Magma Pockets in reach.

---

## 7. Hazards versus the factory

### 7.1 Effects
Per-building vulnerability: §3.3.
- **Hardrock, Magma (MVP):** no damage. Hardrock blocks shafts (route a relay or blast; explosives never hurt buildings or anchored cells). v1: Mk I/II drills idle at r ≥ 262; Magma Taps turn pockets into power.
- **Methane (v1):** a breach Damages every building with a cell in the 3×3 (Shoring immune; Depots spill nothing); Gas Taps cap revealed pockets.
- **Shear (v1):** schedule canon §4.7; Sheared structures stop and keep contents; Depots spill 25%. Shoring before, Realign after.
- Hard Landings and pod collisions never touch buildings; nothing happens while away (canon §4.3.6).

### 7.2 Shear resolution (v1)
The World applies a Shear at Rim arrival in one synchronous call. Terrain, cell flags, lode ids, mounts, occupants and factory entities all shift together.
1. **Inputs:** `rowShift[584] ∈ {−1, 0, +1}` (canon §4.7 roll) and `fixedMask` = cells inside any intact Shoring Brace area (x ± 2, rows y − 8 … y + 7).
2. **Shift:** in each row with d ≠ 0 the non-fixed cells form a ring in ascending x (47 wraps to 0); every layer moves d steps along it; fixed cells stay. A bijection, so the sharing rule holds.
3. **Classify:** each structure stores `alignedCells`. It is **intact** if every cell moved by the same Δ and its support holds (resource cells moved by Δ; floor mounts still above solid); intact structures set `alignedCells += Δ`. Otherwise it is **Sheared**.
4. **Ports** re-evaluate; a link whose partner moved differently becomes "Disconnected" (icon, no damage).
5. **Spill:** a Sheared Depot loses ⌊n/4⌋ of each item type in hopper and kit stock and ⌊pool/4⌋ of its fuel and HP pools.
6. **Report:** structure, depth, status, Packs needed (UI 03). The first Shear's 2 Weld Packs go into cargo, or the Stockpile if the bay is full.

### 7.3 Realign and Repair
- **Cluster:** the underground structures linked by ports (drill → belt → lift foot → lift → Headframe …) that contain the target.
- **Anchor:** the cluster's fixed cell (rows 0–5, e.g. a Rim lift's top, or a shored cell), else its bottom-most lift foot or Depot dock, else the drill's lode. Δa = the anchor's current column − its aligned column.
- **Action:** the pod, within 2 tiles of any Sheared or Damaged structure in the cluster, holds Realign 2 s (120 steps). Cost: **1 Weld Pack per Sheared or Damaged structure in the cluster**, from cargo or from the HP pool of the Depot the pod is docked at (15 HP = 1 Pack; the dock sheet offers clusters with a structure within 2 tiles of the dock). Short → blocked ("Need 3 Weld Packs").
- **Effect:** Sheared structures re-form at `alignedCells + Δa` (drills and taps on their resource's current position); Damaged ones restart. Target cells clear like a blast (ore destroyed; Magma, Methane safe); lode rock, the Seal or another cluster's cell blocks ("Realign Depot 2 first"). Missing floor support gets a free strut.

### 7.4 Build order

| Tier | Features |
|---|---|
| MVP | Hardrock and Magma interplay; anchored cells; explosives skip them |
| v1.0 | Methane Damaged, Shears, Shoring, Realign/Repair, Shear Report, E_HEAT |

### 7.5 Risks
- An unshored 45-row lift is Sheared by ≥ 90% of Shears: the first Shear Report gifts Packs and highlights brace slots (3 Braces cover it).
- Mixed anchors can leave a "Disconnected" link after a Realign: clear iconography (03 §4.10).

---

## 8. Away budget (canon §4.3.6)

### 8.1 Formula
Saved (04 §4.9): `maxSavedWall`, `awayFrom`, `lastInputWall`, and the **away ledger** of 96 quarter-hour buckets {bucket, creditedS, value$}, bucket = ⌊wall ms / 900,000⌋.

1. **Start:** `visibilitychange → hidden` (recorded by the critical save), or 5 min without input while visible. awayFrom = max(now, maxSavedWall). A visible-idle away stops the live factory ("Factory resting" chip).
2. **End:** `visible`, cold load, or the first input after a visible idle. Δ = max(0, now − awayFrom). Cold load from a save not written while away: awayFrom = max(savedAt, maxSavedWall).
3. **Allowances** over buckets newer than ⌊now / 900,000⌋ − 96: timeLeft = 8 h − Σ creditedS; valueLeft = 5 × PRI(phase) − Σ value; phase = deepest row reached (canon §4.3.1).
4. **Credited time:** T = min(Δ, timeLeft); T1 = min(T, 60 s); T2 = T − T1.
5. **Factory ticks:** N = 20 × T1 + 10 × T2 (seconds). η = 0.5 halves simulated time, not rates.
6. **Run** `catchUp` for N ticks (§8.2) under away rules: Export accepts nothing new (sells only its buffer); output must fit in Bins, Silos and Depot stock; no Shears, hazards or Depot auto-build.
7. **Value:** V = Export cash + Δ(book value of every item in the factory: storage, buffers, lines, queues, Depot stock and pools); the run stops when V reaches valueLeft (§8.3).
8. **Credit:** cash to the wallet; T and V into the buckets covering [now − T, now], pro rata by time; the next save sets maxSavedWall = max(maxSavedWall, now).
9. **Report:** welcome-back card when T ≥ 60 s (§8.5); "Night Shift" (01 §8) when V ≥ 3 × PRI.

**MVP:** steps 1–2 only. The factory sleeps while away and nothing is credited.

### 8.2 Catch-up: exact ticks, then the rate model
`catchUp(saveBytes, Δt, {exactTickLimit}) → {saveBytes, report}` is pure and deterministic. The host passes exactTickLimit = ⌊budget ÷ measured ms per tick⌋ (budget 1.5 s mid, 3 s low) and runs it on main in ≤ 8 ms slices behind the card (pod paused) or in a one-shot worker.
- **Exact:** the first min(N, exactTickLimit) ticks are real ticks (§10) with the away rules on.
- **Rate model (CFM):** the rest run in 1,200-tick steps over the logistics graph, in integer milli-items:
  1. Graph: nodes = drills, taps, machines, storages, Export, Depots, Routers, Headframes; edges = belt lines (belt rate), lifts and chutes (rate × s).
  2. Per step, nodes in topological order (Kahn; ties by id; cycles cut at the lowest id): sources produce rate × purity × s; machines convert ≤ (60 / recipe s) × s crafts, input-limited; Routers split by mode (Even equal; Overflow primary to capacity, then clockwise; Filter by type); storages accept to free capacity; Export accepts nothing.
  3. Power: s per step from nameplate demand; a Power Plant burns 1 Drum per step if one reaches it, else supplies 0.
  4. Conservation: only sources and recipe outputs create items; only recipe inputs and Export sales destroy them; a full storage refuses and backs up its edge.
  5. Line, lift and machine contents stay as the exact phase left them; each storage keeps ⌊milli-items / 1,000⌋ per item.

### 8.3 Applying the value cap
V is tracked incrementally: drill output +; recipe output − inputs; Export sale cash − the item's book value; Drum burn −. Exact ticks stop after the first tick where V ≥ valueLeft; CFM scales the capping step's deliveries by the remaining fraction (floor per sink and item, ascending id). The report records when the cap or storage bound.

### 8.4 Worked examples
Provisional PRI; V per factory-minute = the §5.3 factory's output at book value (M2 $248, M3 $1,147, M4 $8,106, M5 $17,369); all output stored.

| # | Situation | T | Factory min | Credited | × PRI | What binds |
|---|---|---|---|---|---|---|
| 1 | App switch, 45 s (M2, B) | 45 s | 0.75 | $186 | 0.13 | — (no card) |
| 2 | Phone face-up, no input for 30 min (M3, C): 5 min live, then away | 25 min | 13.0 | $14,911 | 3.7 | — |
| 3 | Night, 8 h (M3, C): 2 free Bins (400 items, ≈ $42.5 each) | 8 h | 240.5 | $17,000 | 4.3 | Storage after 29 min |
| 4 | Night, 8 h (M3, C): 1 free Silo | 8 h | 240.5 | $20,000 | 5.0 | Value cap after 34 min |
| 5 | Night, 8 h (M4, D): 2 free Silos | 8 h | 240.5 | $150,000 | 5.0 | Value cap after 36 min |
| 6 | Night, 8 h (M5, E1): 4 free Silos | 8 h | 240.5 | $625,000 | 5.0 | Value cap after 1 h 11 m |
| 7 | A 4-h afternoon gap within 24 h of #4 | 0 | 0 | $0 | 0 | Time and value already used |
| 8 | Clock set +8 h while hidden, then back | as #4, once | — | ≤ valueLeft | ≤ 5.0 | Later aways credit 0 until real time passes the false time |

Selling an Export buffer turns book value into 90% cash, so it lowers V slightly. **Daily check** (canon §4.3.6 #8): three 20-min sessions earn 60 × PRI from the pod; away adds ≤ 5 × PRI (8.3%).

### 8.5 Welcome-back report
Layout 03 §6.3. Content: away time and credit split ("Away 7 h 42 m — 1 min at full speed, the rest at half speed, 8 h max per day"); Export cash; stored items (≤ 6 rows, "+n more"); per-Depot changes; ≤ 3 warnings, most severe first ("Bin 3 full after 29 m", "Away limit reached after 33 m", "Smelter 1 starved after 40 m", "Power at 84%").

### 8.6 Build order

| Tier | Features |
|---|---|
| MVP | Away detection (hidden, or 5-min idle) → the factory sleeps; `awayFrom` and `maxSavedWall` saved |
| v1.0 | Ledger, `catchUp` (exact + CFM), value cap, report and card, Night Shift |
| post | "Silo full" push notification (canon §5.4 #11) |

### 8.7 Risks
- CFM diverges from exact ticks on complex Router networks: ±3% test tolerance on reference factories (§10.11).
- A full night uses the whole 24-h allowance, so daytime gaps that day credit nothing: the intended "modest" ceiling (canon §7 #13).

---

## 9. Unlock ladder (Co-op Plans)
Triggers are events. Co-op Plans (Dot's office) lists every rung with its trigger, and locked entries stay visible in the build sheet ("Reach 1,612 ft"). Rung ids are stable save flags (04 §4.8); U4–U5 are unused.

| Rung | Trigger (first time) | Unlocks | Scope |
|---|---|---|---|
| U0 | New game | Yard 48 × 8 with the survey set (§2.2); v1: Co-op Generator | MVP |
| U1 | Pod passes r32 | Dot's survey ping marks the scripted lode | MVP |
| U2 | Any lode discovered | Auto-Drill Mk I, Bucket Lift Mk I, Lift Rail, Headframe, Belt Mk I, Bin, Smelter, Assay "Stockpile", Expansion I; v1 Solar Array. (**Starter Kit:** scripted lode only) | MVP |
| U3 | First ingot produced | Assembler, Router, **Export Terminal**; A1–A4 (v1: A10) | MVP |
| — | Possession (F1) | A5–A8 (MVP); A9, A11–A13 (v1) | MVP / v1 |
| U6 | First reach r80 | Depot, Chute, Shoring Brace, Lamp (Shears become eligible, canon §4.7) | v1 |
| U7 | First Kerogen lode discovered | Refinery, Power Plant | v1 |
| U8 | First reach r129 | Mk II Belt, Drill and Lift; Silo; Pod Works; Yard Expansion II | v1 |
| U9 | First gem sold or Stockpiled | Gem Cutter | v1 |
| U10 | First reach r262 | Mk III Belt, Drill and Lift; Magma Tap; Yard Expansion III | v1 |
| U11 | First Methane cell revealed by Deep Eye or Claimsight | Gas Tap | v1 |

### 9.1 Build order

| Tier | Features |
|---|---|
| MVP | U0–U3; possession unlocks A5–A8; Co-op Plans list |
| v1.0 | U6–U11; v1 additions to U0 and U2 |
| post | NG+ keeps every unlock |

### 9.2 Risks
- U2 opens 9 entries at once: until the first ingot, the build sheet highlights only the three the survey set needs (drill, lift, belt).

---

## 10. Simulation rules (single-threaded, 20 Hz, deterministic)

### 10.1 Authority and data model
- **Authority** (canon §4.10): one main-thread `World` owns terrain, pod, wallet, story and factory; every write is synchronous. The factory module is pure TypeScript (no DOM, time, randomness or I/O). It exposes **commands** (§10.10; all-or-nothing, returning `Ok{…}` or `Err{code}`), **`tick()`** and read-only typed-array **views** (line items and gaps, queue clocks, status, power) for the renderer. It calls **ports**: `grid` (reads terrain and seen; writes mount, occupant, anchored), `wallet`, `cargo` (in commands only) and `events.emit` (`FirstLiftDelivery`, `StatusChanged`, `RecipeUnlocked`, `ShearReport`, …).
- **Structure vs flow:** structure (entities, ports, ghosts, grid writes) changes only in commands; flow (lines, queues, inventories, progress, s) in `tick()` and Stockpile commands. ADR-0002's fallback would move flow only (04 §3).
- **Semantics** (layouts: 04 §4.3–4.6). Ids are u16 from a serialised LIFO free list; item types are u16 from the append-only registry. A **line** is a maximal chain of same-tier belt tiles with one upstream feeder and one downstream target; it breaks at tier changes, Routers, machine ports, lift feet, chute tops and every 128 tiles; corners and Junctions do not break it (a Junction tile belongs to both lines, which never interact). A **node** is anything with `accept(item, side)` and an output buffer. Topology changes rebuild only affected lines, batched once per tick; items keep their positions, and any that would break spacing go to the Stockpile (surface) or the nearest Depot stock, else are destroyed and logged.

### 10.2 Step and tick order
- **World step n (60 Hz):** queued input → pod step (movement, dig, ghost proximity → `completeGhost`) → factory `tick()` if n mod 3 = 2 → events to story and UI. One accumulator (≤ 5 steps, ≤ 2 ticks per frame); the 0.25-s clamp drops wall time, never ticks, so per-tick outcomes never change. UI commands run between steps, logged as (step, seq).
- **Tick phases** (awake entities, ascending id):

| Phase | Work |
|---|---|
| P1 Power | s_Q from tick-start state; a Power Plant at burn timer 0 takes a buffered Drum |
| P2 Timers | Drill/tap progress; craft completion and starts; lift/chute clocks and lip admission; Export sales; Depot hopper and auto-build |
| P3 Move | Every awake line moves (§10.3); order-independent |
| P4 Head transfers | Each node pulls from its input lines from its round-robin pointer while it accepts; then line → line in line-id order |
| P5 Node outputs | Each node pushes its output buffer to line tails or adjacent targets; lift tops and chute bottoms deliver due items |
| P6 Bookkeeping | Sleep/wake, per-line flow counters (60 × 1-s buckets), events |

An item can cross a Router in one tick (P4 in, P5 out); a machine input received in P4 starts crafting in the next P2.

### 10.3 Transport lines (gap encoding)
State: n; items[] (ring, head first); gap[] (gap[0] = head to item 0, gap[i] = item i−1 to item i); L (≤ 30,720 u); v = 12; S = 240 / 120 / 60; firstSlack; tailPos = Σgap.

```
move(line):                          // P3
  r = v
  for j = firstSlack .. n-1:
    slack = (j == 0) ? gap[0] : gap[j] - S
    d = min(r, slack); gap[j] -= d; tailPos -= d; r -= d
    if r == 0: break                 // items behind j move rigidly
  advance firstSlack past gaps with no slack
  if nothing moved: sleep(line, n == 0 ? EMPTY : JAMMED)

exitHead(line):                      // P4, only if n > 0 and gap[0] == 0
  if target.accept(items[0], side):
    pop; gap[0] = old gap[1]; firstSlack = max(0, firstSlack - 1); wake(line)

insertTail(line, item):              // P4/P5
  g = L - tailPos
  if n == 0 or g >= S: append(item, gap = g); tailPos = L; wake(line); return true
  return false
```

A compressed line delivers one item per S / v ticks (20 / 10 / 5) = 60 / 120 / 240 per min; every gap is ≥ S except gap[0] ≥ 0. Item i renders at Σgap[0..i] from the head, extrapolated by v × alpha when the line moved last tick.

### 10.4 Router
Sides: 4 on the surface; underground left, right and top (input only, from a chute outlet). Each side is In, Out or unused from its connections. 1-item buffer; pointers rrIn, rrOut. **P4:** if empty, take the head item of the first In line from rrIn with gap[0] = 0; rrIn = next side. **P5:** **Even** tries Outs from rrOut, the first that accepts takes it, rrOut = the side after; **Overflow** tries the primary Out (tap to set; default straight across from the first In), then clockwise; **Filter(X)** sends X only to the primary Out and others Even across the rest, holding if the required Out is blocked. 1 Out + ≥ 2 Ins = fair merger.

### 10.5 Other nodes

| Node | accept() | Push (P5) |
|---|---|---|
| Smelter | Smeltable items matching the recipe (any, if the buffer is empty) | Output-edge lines, round-robin |
| Assembler, Refinery, Gem Cutter | Recipe ingredients, ≤ 2 crafts' worth each | Output-edge lines, round-robin |
| Pod Works | Recipe ingredients | Lowest-id Bin or Silo with room; else blocked |
| Bin, Silo | Any surface item while total < capacity | Unload port: the filtered item, 1 per 5 ticks (`nextAllowedTick`) |
| Export | Export-priced items while buffer < 50; none during catch-up | Sells in P2 (below) |
| Headframe | Lift top / (chute mode) chute-allowed Yard items | Yard-side lines round-robin / chute inlet |
| Auto-Drill, Gas Tap | — | Adjacent belt tails, lift lip or Depot In port, round-robin; a full buffer stops progress |
| Depot | §3.5 routing | Hopper → Out port, 1 item per 5 ticks × s |
| Lift lip | 1 item | Admission in P2 (§10.6) |
| Power Plant | Fuel Drums, ≤ 5 | — |

- **Drill:** acc += Mk rate × purity% × s_Q per tick; one ore per 1,200 × 100 × 65,536 (Normal at s = 1: Mk I every 150 ticks, Mk II 120, Mk III 50).
- **Craft:** acc += s_Q per tick while inputs are present; done at ticks × 65,536. Per-tick accumulators over awake machines; no timing wheel.
- **Export:** while the buffer is non-empty, credit += 240 × s_Q per tick; each 1,200 × 65,536 sells the oldest item (remainder kept) via `wallet.credit`.

### 10.6 Lifts and chutes
State: FIFO of (item, entryClock); clock, credit, transit, stalled.
- **P2:** unless stalled, clock += s_Q (chutes 65,536). While the lip holds an item, credit += rate × s_Q; at ≥ 1,200 × 65,536 push (item, clock) and keep the remainder. No credit accrues with an empty lip.
- **P5:** while the head item has clock − entryClock ≥ transit, offer it to the top or bottom target; refusal sets stalled and stops, acceptance pops and clears it.
- **Transit** = ticks × 65,536 with integer ticks: Mk I ⌊(40H + 2)/3⌋, Mk II 8H, Mk III 5H, chute ⌊(5H + 1)/2⌋. A stalled lift freezes (no clock, no admission). Bucket render offset = (clock − entryClock) / transit. A Mk upgrade keeps the queue and rescales transit; a removed lift's items follow the §10.1 rule.

### 10.7 Back-pressure and conservation
Full sink → `accept()` false → head waits at 0 → line compresses → upstream `insertTail` fails → output buffer fills → progress stops → lift stalls. Only Export, recipe inputs and explicit scrap or destroy remove items. **Invariant** (every tick in debug and tests): created − sold − consumed − scrapped = items in lines + buffers + queues + storages.

### 10.8 Sleep, wake and rate limiters

| Entity | Sleeps when | Woken by |
|---|---|---|
| Line | Empty, or head blocked and fully compressed | Tail insert; its target frees space |
| Machine | No craft running and inputs missing; or output full and nothing accepts | Input accepted; output space |
| Drill, tap | Output full and nothing accepts; unconnected (v1) | Output space; power topology change |
| Lift, chute | Queue and lip empty; or stalled | Lip filled; target space |
| Storage, Export | Nothing to push or sell | Input accepted; filter changed |

Awake sets are per-kind bitsets iterated in ascending id; waking an id above the cursor processes it this phase, a lower id next tick, which reproduces an always-awake run exactly. **Rate-limiter rule** (Tech m7): every limiter is an absolute `nextAllowedTick` or a credit that accrues only while work is pending and keeps < 1 unit after paying out; no free-running counters. `SIM_NO_SLEEP` must give identical hashes.

### 10.9 Determinism and state hash
- Integers only in sim state (< 2^53; Q16 rates; ⌊ ⌋ divisions); no `Math.random`, `Date`, `performance` or floats; never iterate a `Map` or `Set`.
- Inputs are the seed, the save and the command log (step, seq, command); replays are bit-exact in browsers and Node 22. The pod sees factory state only through the occupant and anchored layers, written synchronously between steps, so pod replays stay exact while building.
- **State hash:** FNV-1a 32 over the canonical **FENT, FLIN, FINV, FQUE** sections (04 §4.9) every 1,200 ticks.
- No sim LOD: every band runs the full sim.

### 10.10 Command API
Synchronous calls; they replace the rev-1 cross-thread protocol. Undo/redo stores inverse commands.

| Command | Effect (all-or-nothing) | Errors |
|---|---|---|
| `place(kind, mk, cell, rot)` | Surface: validate, debit cash, take parts, create | §2.5 |
| `paintBelts(path, tier)` | Surface belts with auto Junctions and T-Routers; one undo step | E_FUNDS, E_OCCUPIED |
| `placeGhost` / `removeGhost` | Underground ghost job | §2.5 |
| `completeGhost(id, podBox)` | From the pod step: validate (E_POD on every cell the pod touches), take the Kit, create, write the grid | Any §2.5 code |
| `deconstruct(id, refundTo)` | §2.7 refunds | E_STOCKPILE_FULL |
| `upgrade(id, mk)` | §2.7 | E_LOCKED, E_FUNDS, E_PARTS, E_KIT |
| `setRecipe`, `setRouterMode`, `setEnabled`, `setPortDir`, `setUnloadFilter` | Configuration; undoable | — |
| `stockpileTake(bill)` / `stockpilePut(items)` | Garage, Shed, crane, Assay "Stockpile", Shear gift | E_PARTS / E_STOCKPILE_FULL |
| `discoverLode(id, purityKnown)` | Marks the lode discovered; triggers U2 | — |
| `tileChanged(cells)` | After a dig, blast or Realign: re-check support; drop ghosts on solid cells | — |
| `depotDock`, `depotUnload`, `depotTake`, `depotUndock`; `resetDepotService` at Rim arrival | §3.5 dock session | E_SERVED |
| `applyShear(rowShift, fixedMask)` | §7.2 | — |
| `realign(clusterId, payFrom)` / `repair(id, payFrom)` | §7.3 | E_PACKS, E_BLOCKED |
| `setAway(on)` | §8 away rules (MVP: sleep) | — |

### 10.11 Tests (Vitest, Node 22)
1. **Lines:** exactly 60 / 120 / 240 per min over 12,000 ticks; gap encoding = a naive per-item reference (10k fast-check cases).
2. **Router:** Even alternation; blocked Out; Overflow priority; Filter hold; fair merge 30 ± 1 per min per input.
3. **Smelter:** recipe switching on a mixed line; 2 ingots per specimen per 120 ticks; Iridium specimens refused.
4. **Lift:** Mk I 30/min, Mk II 90/min average; transit formula; stall freezes; s = 0.5 halves throughput.
5. **Back-pressure:** remove Export → Bins fill → drills stop, with the conservation invariant every tick.
6. **Sleep:** `SIM_NO_SLEEP` hash equality over 36,000 ticks; save at 6,000 + load + 6,000 = a straight 12,000.
7. **Golden hash:** seed + scripted command log, 36,000 ticks.
8. **Commands:** one case per §2.5 code; `completeGhost` atomicity (across any save point, exactly one of Kit or building exists); E_POD with the pod straddling two cells.
9. **Power:** s_Q maths, nameplate demand, burn timer, Depot radius 10 in / 11 out, row 63 in / 64 out.
10. **Shear:** shift bijection; intact/Sheared table; cluster cost and positions; Depot spill.
11. **Away:** ledger window edges; T, T1, T2, N; cap stop tick; Export refusal; CFM within ±3% of exact sink totals (30 min, 5 reference factories); Δ < 0 → 0; clock rollback credits nothing.
12. **Bench** (ADR-0002 gate, canon §3.14): 2,000 buildings / 10k items, p95 tick ≤ 1.5 ms on the low device; CI fails above 2× baseline.

### 10.12 Build order

| Tier | Features |
|---|---|
| M0 | `TransportLine` module + instanced items on 2 belts; lift bucket-scroll stub |
| MVP | World integration and commands; P1–P6; lines, Routers, MVP nodes, lift queues; back-pressure, sleep/wake, determinism, golden hash; MVP away sleep; tests 1–8 and 12; ADR-0002 bench in MVP week 3 |
| v1.0 | Power, Depots, chutes, Shears and Realign, `catchUp`; tests 9–11; the flow-state worker only if the ADR-0002 gate failed |
| post | Crate items (1 entry = 15 items), Pneumatic Tube endpoints, Cargo Rail carts |

### 10.13 Risks
- The single-thread tick misses 1.5 ms on the low device: ADR-0002 flow-state worker (canon §4.10).
- Large pastes trigger many line rebuilds: rebuilds are batched once per tick.
- Integer maths above 2^31 is slower than `|0` paths: Float64-held integers; profile on the low tier.
