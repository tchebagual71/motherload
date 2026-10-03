# HoleFactory — Master Plan

**Status** (2026-10-03): **M0 "Style & Feel Test" done and reviewed. MVP vertical slice feature-complete and reviewed** on branch `claude/build-m0`, with review fixes landing. Next step: **v1.0** (§6). Details in [Where we are](#where-we-are).
**How to read this:** a plain-language summary for your approval. Every number comes from the design documents in [`design/`](design/), which are the detailed spec; if they ever disagree with this page, they win, and [`design/00-canon.md`](design/00-canon.md) wins over all of them.

---

## Where we are

- **M0** is built and reviewed: the dig prototype in both looks (Clean Toon and Pixel Lab), with the A/B chip, gallery, questionnaire, Perf Report and jetsam probe. Your device round and look pick (§6 M0 "Exit") decide the art direction; until then the defaults in §8 apply.
- **MVP** is feature-complete and reviewed. You can play the pod loop down to the temporary Seal at 4,000 ft, then the factory opening:
  1. dig to Dot's copper lode;
  2. collect the Starter Kit;
  3. press BUILD to place the drill and the lift;
  4. paint Yard belts to the Smelter;
  5. get the first ingot;
  6. build an Assembler for Wire and Hull Plates.

  The economy bot, trip soak and factory bench numbers are in [`design/bot-report.md`](design/bot-report.md). How to run and test the build is in the [README](../README.md#run).
- **Next: v1.0.** Engineering carried into it:
  - **Code-split the first load.** Initial JS is ≈ 310 KB brotli of the 350 KB budget (canon §3.14), and `npm run size` gates it in CI. Build mode, the factory renderer and the M0-only style test should load on demand. Out-of-scope code should also stop shipping: scope gating is runtime only today ([`design/04-tech-architecture.md` §12.1](design/04-tech-architecture.md)).

---

## 1. What we're building

HoleFactory is a pocket-sized mining game for your iPhone. You fly **Pip**, a scrappy dig pod, down a cross-section of Mars, betting fuel and hull on what glints below, then racing back up to sell. That is the 2004 *Motherload* loop, kept faithfully. The twist is the factory: the tunnels you dig become the bones of a small Factorio-style operation. Drills on rich ore "lodes" feed lifts you hang in your own shafts, carrying ore up to a cozy surface yard where smelters and assemblers make the parts your next upgrade needs. The pod still owns the dangerous, valuable work; the factory grinds the bulk. A trip fits a coffee break; the full story takes about 6.5 hours.

**Your decisions (final)**

| Topic | What you chose | What it means in the build |
|---|---|---|
| World shape | 3D isometric factory Yard on the surface + underground dig grid shown as a 3D cut-away slab | Two build areas: the Yard on top, the mine wall below. No voxels. |
| Automation | Auto-drills may automate lodes the pod discovered | Loose ore, gems and relics stay pod-only; the first stretch is pure *Motherload* |
| Orientation | Portrait first | Designed for 375×667 (iPhone SE) and 393×852 (iPhone 15/16); landscape in v1 |
| Platform | Web first (TypeScript + three.js PWA); Capacitor store apps later | Plays in Safari, installs to the Home Screen; store builds are the first post-launch item |
| Art style | Build "Clean Toon" and "Pixel Lab" in M0; you pick | Art production starts after your pick |
| Tone | Cozy top, eerie depths; original story and names | Warm surface, stranger and quieter deep; around E10+ / PEGI 7 |
| Offline | Modest, capped | v1 "Away budget" (§3.4); in the MVP the factory sleeps while you're away |

**Defaults we assumed** (all overridable, see §8): single player; local saves with an export code, no accounts or cloud; no monetisation in v1 (no ads, purchases or timers, nothing designed out); pod destruction loses the cargo plus a salvage fee and nothing rolls back; "the drill dies" = hull or fuel at zero; "purchase your vehicle" = part upgrades on 7 lines; gems and relics travel only in the pod; models are procedural plus free CC0 kits recoloured to one palette.

---

## 2. Heads-up

> **1. Little Rocket Lab is isometric *pixel art*, not 3D.** A 3D game can get close in two ways, so M0 builds both and you choose:
> - **Clean Toon:** smooth 3D, soft toy shading and outlines.
> - **Pixel Lab:** the same 3D scene drawn at low resolution, so every tile is crisp pixels, with a pixel-font UI.
>
> You flip between them with one button on your own iPhone, play timed sessions of each and answer a short questionnaire. If you can't decide, the default is Clean Toon, with Pixel Lab kept as a "Retro filter" if it costs ≤ 5% of frame time.
>
> **2. Motherload's names and story belong to XGen Studios.** HoleFactory keeps the *mechanics* (fuel as the clock, costly climbs, limited cargo, the ten-tier mineral ladder, hazards, depth bonuses) and ships **none** of the original names, text, art or audio. New names, for example:
> - **Pip** the pod, dispatcher **Dot Hollowell**, the **Hollowell Mining Co-op**, **Claim 7** in Hollow Basin.
> - Minerals **Hematite, Copper, Cobalt, Gold, Iridium, Thorium, Peridot, Fire Opal, Diamond, Echo Quartz**.
> - Shops **Pump House, Assay Office, Garage, Supply Shed**; parts like the **Stub Bit** drill and **Tin Can** hull.
> - **Channel Zero** (a dead radio band), **the Surveyor** (a polite voice) and **the Claimant** (the final boss).
>
> No story beat fires at an original transmission depth (except the three depth-bonus messages and the game-start "refuel" hint, which carry nothing else), no character follows an original arc, and no public URL contains "motherload". Legal and trademark checks come before any store release.

---

## 3. The game in one page

### 3.1 The trip loop
1. **Prep on the Rim:** refuel, grab consumables and building Kits.
2. **Descend** through your own shafts: falling is free, landing too fast hurts.
3. **Dig:** push into a tile to drill it — down, left or right, never up. Ore pops into your bay.
4. **Turn back:** the core bet. While you learn, a "Return Tick" on the fuel bar estimates the climb cost.
5. **Climb:** heavier cargo climbs slower and burns more fuel.
6. **Sell** at the Assay Office, **upgrade** at the Garage. From tier 3, upgrades also need factory parts.

Trips last 1–10 minutes; a session is 1–4 trips, one factory task and one purchase.

### 3.2 The slab world

```
   THE YARD  (isometric 3D plateau; 48 wide, 8 rows deep, expands to 32)
   ┌──────────────────────────────────────────────┐
   │  Bin ◀── Smelter ◀── Assembler ──▶ Export    │  placed instantly by the yard crane
   │            ▲                                 │
   │      [Headframe]                             │
 ══╧═[Pump]══[Assay]══╪═══════════[Garage]═[Shed]═╧══  the Rim: pod-only road (row 0)
   │                  ║ lift                      │
   │   Pip ▼          ║            ▓▓▓            │  THE MINE SLAB
   │   ░░░░░░░        ║  ═belt═[DRILL]            │  48 tiles wide, a 2D grid
   │                  ║         ▓LODE▓            │  shown as a 3D cut-away
   │  Hardrock from 1,612 ft · Magma 3,275 ft     │
   │  Methane 4,950 ft · Static Zone 5,813 ft     │
   │ ═══════════ the Seal (≈ 7,300 ft) ══════ ▢   │  ▢ = the Notch
   │            the Hollow Heart: finale arena    │
   └──────────────────────────────────────────────┘
```

- **48 tiles wide, 608 rows deep** (12.5 ft per row), through eight colour-coded strata from **Rust Flats** to the **Ember Mantle** and **the Hollow Heart**.
- Whatever you dig stays dug. Loose ore, gems and relics are finite (≈ $49.5M); lodes never run out but produce at a fixed rate.
- Lifts, belts, lamps and braces hang on the back wall; the pod flies past them. Machines like drills block it.

### 3.3 The pod
- **Seven upgrade lines × seven tiers:** Drill, Hull, Engine, Tank, Radiator, Bay, Scanner; $750 (t2) up to $500,000 (t7), ≈ $3.9M to max. Every purchase visibly changes Pip.
- **Fuel** is the clock early; later, hull, weight and cargo take over.
- **Hazards:** Hardrock (blast it), Magma pockets (two hits), Methane that looks exactly like dirt (a Sniffer warns you), hard landings.
- **Consumables:** Jerrycan, Patch Kit, Pop Charge, Mega Pop, Hop Beacon, Homing Beacon — emergency-priced.
- **Destruction:** lose the trip's cargo and pay a salvage fee of **8% of your installed upgrades** (min $25), which includes a refuel and repair. A shortfall becomes "Co-op debt", taken from your next sale. Everything else is kept. Optional Hardcore (v1) doubles the fee and drops one upgrade a tier.

### 3.4 How the factory interlocks with the pod

| Rule | In plain words |
|---|---|
| **Down is free, up costs** | The pod falls free; v1 Chutes drop items free. Items rise only by **Bucket Lift**, which costs a Kit per 32 rows, is speed-limited (30 / 90 / 240 items/min by Mk) and in v1 uses power. |
| **Pod finds, factory grinds** | Only the pod digs, discovers lodes and carries Kits underground to build. A drill sits only on a discovered lode, a 3×2 block the pod can't dig. |
| **Gems ride with the pod** | Gems and relics reach cash only in the pod's cargo, and from ≈ 3,300 ft down they dominate the value — so the push-your-luck trip stays the heart of the game. |
| **The factory matters** | Tier 3+ upgrades need parts, and Iridium Ingots and Thorium Rods come **only from lode ore**, so tier 5+ needs automation. A pod-only run must be ≥ 30% slower to the credits. |
| **Income cap** | Factory cash ≤ **40% of the pod's typical income rate** for the depth phase (15–30% of total is typical; perfect play ≤ 55%). The first ~30 minutes are exempt. |
| **Depots (v1)** | Underground service stations: **≤ 6**, one per 64-row band, price tripling ($2,000, $6,000, … + parts). Each serves the pod **once per trip**: fuel from stocked Drums, repairs from a pool capped at 90 HP, bulk drop-off. Weld Packs enter only from pod cargo. Never a shop, save or respawn. Machines run only near the surface or within 10 tiles of a Depot, so the deepest frontier is always pure *Motherload*. |
| **Away budget (v1)** | Away = app hidden, or 5 min with no input. First 60 s at full speed, then half. At most **8 h credited per rolling 24 h**, worth at most **≈ 5 minutes of your current digging income**. Export sells only its 50-item buffer; everything else must fit in storage. A welcome-back card shows any credit over 60 s. Changing the clock doesn't help. **MVP:** the factory sleeps. |

### 3.5 The story (premise only)
You're **Seven**, new operator for the Hollowell Mining Co-op, a family outfit run on a ledger, patched machinery and a kettle. Dot talks you through your first dig and your first automated lode. Claim 7 is the deepest in the Basin; its previous owner, the **Deepreach Concern**, folded forty years ago when its deep crews stopped answering, and the Recorders you dig up play their old logs. From your first Hardrock, a dead band, **Channel Zero**, starts counting your depth — then your lift buckets, exactly. The deeper you go, the quieter and stranger it gets, until a very polite voice introduces itself. It ends at the core with a single boss fight in the Hollow Heart, using only explosives and piloting. Unsettling, never gory, demonic or religious. A rival next door, **Marlow**, adds warmth and trades lode surveys (v1). Radio cards are ≤ 90 characters and never block your controls.

### 3.6 Look and feel
A sunny, dusty-peach surface; strata that darken and cool (ochre, clay, violet shale, blue basalt, obsidian) before warming into ember red, then ledger-green and brass at the finale. Pip carries a bubble of light and deep ores glow. Every ore has its own shape as well as colour, for colour-blind players. Everything moves like a bouncy toy. "Kettle On" (kalimba, nylon guitar) plays up top and fades through the rock; drones and a music-box theme take over deeper.

---

## 4. Playing on an iPhone

| Area | How it works |
|---|---|
| **Layout** | One 44-pt row under the notch: fuel, hull, cargo, cash/depth, menu. A slim depth ruler on the right edge opens the map. The bottom ≈ 166 pt holds semi-transparent controls. Installed, at least 6 clear rows always show below the pod. |
| **Pod controls** | A floating stick appears where your thumb lands, lower left: sideways drives, up thrusts, into a tile digs. Lower right: four quick slots (Pop Charge, Mega Pop, Jerrycan, Patch Kit). Explosives show their blast area while held, fire on release, cancel on a slide. A context button offers **Cargo**, **Place drill** or **BUILD**. Shop signs are tappable. |
| **Options** | Left-handed mirroring, S/M/L control sizes, one-handed mode, THRUST button, Landing Assist, Steady Drill, Bright Mines, reduced motion, larger text. |
| **Build controls** | BUILD freezes the pod; the factory keeps running. Tap a card, tap to drop a "ghost", ✓ to confirm. The cursor floats 44 pt above your finger with a magnifier, so your thumb never hides the tile. Drag to paint belts; two fingers pan and zoom; ≥ 50 undo steps. Underground, a ghost becomes real when Pip brings the Kit within 2 tiles for 1 s. "Route to surface" proposes a whole belt-and-lift path. |
| **Interruptions** | A call, Control Center, app switch or rotation freezes the pod mid-air and shows **"Tap to resume"**, with a 3-2-1 countdown if you were airborne. Shops, map and build mode pause the pod. In M0/MVP, sideways shows "Turn your phone upright". |
| **Sound** | The silent switch mutes the game (a setting overrides it) and your own music keeps playing. Every warning is also visual; iPhone web has no vibration. |
| **Install & saves** | The title screen recommends **Add to Home Screen**; doing so copies your save code, and the first Home Screen launch offers one-tap **"Paste save"**. Saving is automatic, so a force-quit loses ≤ 30 s. Two rotating copies, a **Safe Mode** recovery screen and export as code or file. MVP 1 slot, v1 3. |
| **Phones** | iOS 17+ (iPhone XS/XR/SE 2 and newer); Android 10+ with Chrome. |

---

## 5. How it's built

- **Stack:** TypeScript + Vite; three.js (WebGL2) for 3D; Preact for HUD and menus; ZzFX synthesized sound; an installable PWA.
- **One simulation:** a single `World` on the main thread owns terrain, pod, money, story and factory; pod at 60 Hz, factory at 20 Hz, one clock, fully deterministic so tests replay games exactly. If an MVP benchmark (2,000 buildings, 10,000 items, ≤ 1.5 ms per tick on a budget Android) fails, v1 moves only the factory's item flow to a background thread.
- **Two looks, one scene:** same geometry, palette and lighting; production switches looks only in Settings.
- **Saves:** compact binary in IndexedDB, migrated between versions from the MVP. The world generator freezes at the MVP, so updates never reshuffle your mine.

```
  touch ─▶ Input ─▶ ┌─────────── World (main thread) ───────────┐
                    │ terrain · pod 60 Hz · factory 20 Hz        │──▶ Save (IndexedDB,
                    │ wallet · story                             │     2 copies)
                    └──────┬────────────────────────┬────────────┘
                     read-only views          ≤ 10 updates/s
                           ▼                        ▼
                 Renderer (three.js)       HUD & menus (Preact)
```

**Testing:** unit and replay tests (pod physics, world statistics over 200 seeds, every factory rule, corrupt saves); an **economy bot** that plays as a "proficient" and a "slow-median" player and measures income, factory share and fuel/hull tension — its numbers replace today's *provisional* estimates; browser tests at every phone size in both looks, plus a Safari-engine smoke test on every change; and a real-device checklist each milestone on **your iPhone** and a budget Android, with an in-app **Perf Report** code you paste back to us.

**Hosting:** GitHub Pages, deployed from the exact build CI tested, at `tchebagual71.github.io/motherload/` during development; a repo rename or custom domain comes before any public link (§8 #2). After launch, App Store and Play Store builds via Capacitor add haptics, a portrait lock and file saves.

---

## 6. Roadmap

Sizes are **engineer-days of relative size, not commitments** ([`design/04-tech-architecture.md` §14](design/04-tech-architecture.md)). Calendar figures assume two parallel tracks; with one engineer, double them. Total ≈ 28 weeks to v1.0.

### M0 — "Style & Feel Test" (≈ 3 weeks)
- **Goal:** prove digging feels great on your phone, and pick the art style.
- **You can play:** a generated mine to ≈ 1,600 ft with a Hardrock/Magma strip for explosives; refuel, dig, sell, cash-only upgrades (Drill, Engine, Tank, Bay to tier 3); destruction and salvage; a Yard with ghost buildings and moving belts; both looks with an A/B button, a six-view gallery and a questionnaire; four sounds.
- **Scope:** the full-size world generator (frozen from the MVP on), pod physics, touch controls, interruption handling, save core, PWA install, CI, Perf Report.
- **Exit:** frame budgets met underground in both looks on low and mid phones; **you pick the look**; tiles ≥ 35 pt on an SE; ores identified ≥ 90% in dim light; accidental digs < 3%; 3 full trips on your iPhone; Perf Reports from both phones; tests green.
- **Size:** **37 engineer-days** vs ≈ 30 of capacity: ≈ 3.7 weeks, or 3 with a third contributor in weeks 1–2 (≈ 2.5 days can spill into MVP week 1).
- **You:** tell us your phone (§8); install the build; play alternating 5-minute sessions (A-B-A-B); answer the questionnaire; **pick Clean Toon, Pixel Lab or both**; send the Perf Report code.

### MVP — vertical slice (+ ≈ 9 weeks)
- **Goal:** the first ≈ 3 hours of the real game, down to 4,000 ft.
- **You can play:** the scripted opening (Dot's ping, her copper lode beside her old survey shaft, a free Starter Kit) through your first drill, lift and belt until **ore arrives at the surface by itself**; Wire and Hull Plates for your first tier-3 upgrade; six lines to tier 5 plus the first two Scanners; all consumables; story beats to 3,500 ft with Channel Zero and six Deepreach logs; 15 milestones; map and depth ruler; install-first saving; art on your chosen look, "Kettle On" and 20 sounds. A temporary seal stops play at 4,000 ft.
- **Scope:** Belt, Router, Storage Bin, Smelter, Assembler, Export Terminal, Headframe, Auto-Drill Mk I, Bucket Lift Mk I; ghost-and-confirm, undo, logistics overlay; quality tiers, Safe Mode, economy bot, factory benchmark. No power, Depots or Mk II.
- **Exit** (≥ 5 first-time phone players unless noted): first lode automated ≤ 35 min, and ≤ 8 min after the Starter Kit; 4,000 ft ≤ 3.5 h; ≥ 50% of tier-3/4 parts from lode ore; factory share reported (target 8–25%); fuel/hull-tension test passes (bot); a 10-tile belt ≤ 15 s and drill + lift + Headframe ≤ 90 s, also one-handed on an SE; 0 HP lost to interruptions; 60-minute soaks crash-free; saves survive a forced kill.
- **Size:** **85.25 engineer-days** vs ≈ 90 (5% slack).
- **You:** play-test at the two device rounds (weeks 5 and 9); help find first-time testers if you can; before content lock, confirm or change the gameplay defaults in [`design/01-game-design.md` §9](design/01-game-design.md).

### v1.0 — web launch (+ ≈ 16 weeks)
- **Goal:** the complete game to the core and the credits (≈ 6.5 h median).
- **You can play:** full depth (≈ 7,300 ft) with Methane, the Static Zone and Shears (ground shifts, rolled only when you're on the surface) with Shoring and Realign; Depots, Chutes, power, Mk II/III, Refinery, Pod Works, Gem Cutter, Magma and Gas Taps; tiers 6–7; Marlow, the Surveyor and the Claimant finale; the Away budget; 3 save slots and Hardcore; landscape and tablets; full accessibility; generative deep music.
- **Exit (bot unless noted):** income cap holds in every phase; pod-only ≥ 30% slower; away ≤ 25% of pod income for a 3-sessions-a-day player; tension test passes at every depth; boss fight 4–6 min median with ≥ 60% of median players winning by attempt 3; a real 8-hour away test on a device.
- **Size:** **88 engineer-days** in a 16-week window; the 72-day reserve covers content integration, bot-driven balancing, bug fixing and a 4-day background-thread task if the benchmark failed.
- **Carried over from the MVP:** load build mode and other heavy parts on demand, since the first load already uses ≈ 310 of its 350 KB ([Where we are](#where-we-are)).
- **You:** play-test the device rounds; confirm the story and arena defaults before the boss is built; decide the repo rename or domain before any public link.

### Post-launch (priority order, not yet estimated)
1. App Store and Play Store builds via Capacitor, after legal checks.
2. Pneumatic Tube.
3. New Game+ "New Claim".
4. Blueprints and share codes.
5. Then crate packing, cargo rail, drones, gamepad, localisation, cloud save, WebGPU/120 Hz and, only if you choose, monetisation.

---

## 7. Top risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Income estimates are off** (an independent check suggests 1.2–2.3× in places), skewing every factory cap | The MVP bot measures real income; caps are re-checked before content lock and tuned via drill rates, lode counts and purity — never sale prices |
| 2 | **The factory takes over, or feels optional** | Hard caps; gems, relics and the deep frontier stay pod-only; lode-only Iridium/Thorium make it necessary. Fallback if that walls players: Iridium and Thorium specimens smelt 1 → 1 ingot |
| 3 | **Mid-game loses tension** (fuel stops mattering ≈ 1,600–3,300 ft) | The bot checks a slow player still gets a fuel or hull warning every ≤ 5 trips; if not, the ready "Deep Heat" option (fuel burns up to ×1.5 deeper) switches on |
| 4 | **Touch misfires** on small phones | M0 gate: accidental digs < 3%; build-mode two-finger grace; MVP build targets tested one-handed on an SE |
| 5 | **iPhone performance or memory limits** | Per-tier budgets; Perf Report and memory probe on your phone; automatic quality tiers; benchmark with a background-thread fallback |
| 6 | **Lost saves** (iOS suspends, Safari eviction, shared web address) | Synchronous saves on hide and death; install-first flow; export codes; two copies + Safe Mode; own domain or store build before any public link |
| 7 | **M0 is 23% over its 3-week capacity** | Decided at kickoff: a third contributor for two weeks, or spill ≈ 2.5 days into MVP week 1 |
| 8 | **Too close to the original game** | Original names and story only; story rules checked automatically; legal review before stores; "motherload" kept out of public URLs and marketing |

---

## 8. Open questions for you

**None of these blocks starting M0.** The one thing M0 needs early is **which phone you'll test on** — and even that has a default; only the device round at the end of M0 waits for your phone. Everything else proceeds on its default unless you say otherwise.

| # | Question | Default |
|---|---|---|
| 1 | **Which phone(s) do you own (model + iOS version)?** | Tune in the browser at 375×667 and 393×852; buy a Galaxy A15/A16 as the low-end test phone |
| 2 | **Rename the repo to `holefactory` (or use a custom domain) before any public link?** | Development stays at `/motherload/`; the app's install id is already "holefactory", so installs survive the move |
| 3 | Names: Hollowell Mining Co-op, Dot, Pip, the Surveyor, the Claimant, the mineral ladder | Keep, pending trademark checks |
| 4 | Which art look? | Picked at the end of M0; if undecided, Clean Toon with Pixel Lab as a "Retro filter" |
| 5 | What does "the drill dies" mean? | Hull or fuel reaches zero |
| 6 | What does "purchase your vehicle" mean? | Part upgrades on 7 lines |
| 7 | Can lifts carry gems? | No; a Gem Lift is a post-launch idea |
| 8 | Can bulk ore be dropped at Depots? | Yes, tiers 1–6, paid at the 90% Export rate |
| 9 | Does fuel matter late in the game? | Until the tier-4 tank; "Deep Heat" only if the tension test fails |
| 10 | Death penalty | 8% salvage fee, always charged (shortfall → debt), plus the cargo; optional Hardcore |
| 11 | Scanner as a 7th upgrade line? | Yes |
| 12 | Can hazards damage buildings? | Yes, softened by Shoring and Realign; no "cozy" toggle |
| 13 | Away numbers | 60 s full speed, then half; ≤ 8 h and ≤ 5 minutes' typical income per rolling 24 h; storage-limited |
| 14 | MVP depth | 4,000 ft |
| 15 | Methane fairness | A non-directional Sniffer from the start; exact cells from the t6 Scanner |
| 16 | Tablets | Capped view (13 tiles portrait / 18 landscape), UI at 1.2× |
| 17 | Monetisation after v1 | None planned; not designed out |
| 18 | When do store builds come? | After the web v1.0 launch |

---

## 9. Document map

| Document | What it covers |
|---|---|
| [design/00-canon.md](design/00-canon.md) | Single source of truth: constants, rules, names, touch measurements, the scope ledger (what ships when), open items, change log |
| [design/01-game-design.md](design/01-game-design.md) | Pod mechanics, world generation, upgrade table, the opening script, story and radio script, finale, milestones |
| [design/02-factory.md](design/02-factory.md) | Buildings, items and recipes; factory balance; power; Depots and Shears; the Away-budget formula; simulation rules |
| [design/03-ux-art-audio.md](design/03-ux-art-audio.md) | Phone layouts, gestures, build-mode UX, HUD and screens, accessibility, both art looks and the style test, music and sound |
| [design/04-tech-architecture.md](design/04-tech-architecture.md) | Stack, architecture, save format, rendering, performance, testing, CI/CD, hosting, engineer-day task breakdown |
| [research/](research/) | Six background briefs: original mechanics, art direction, factory design, tech stack, world structure, critique |
