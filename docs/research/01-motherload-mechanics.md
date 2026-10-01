# 01 — Motherload Mechanics Bible (for HoleFactory)

Research brief. No game code. It covers the original **Motherload** (XGen Studios, 2004), the **Goldium Edition**, and what **Super Motherload** (2013) changed. It ends with an analysis of why the loop works and what HoleFactory must keep.

**How this was checked.** Direct page fetches were blocked by the sandbox's egress proxy (fandom.com, speedrun.com, gamefaqs, wikipedia, tvtropes, jayisgames and cheat sites all returned `EGRESS_BLOCKED`). Every "verified" fact below was cross-checked through **web-search result extracts** of the cited pages, so each one is a search-engine summary of the page and not a first-hand read. Most numbers agree across two or more sources. Claims from a single source, or where sources disagree, are flagged. Claims from my own knowledge that no search confirmed are marked **(unverified)**.

Main sources (cited inline below as [S1]…[S14]):

- [S1] Motherload fan wiki: https://motherload.fandom.com/wiki/Motherload (and its subpages: Minerals, Artifacts, Damage, Lava, Transmissions, Ending, Marsquake, Shops, Autobuy_2000, Emendation_Station_3500, Quantum_Teleporter, Matter_Transmitter, Reserve_Fuel_Tank, Hull_Repair_Nanobots, Stone, Dynamite, Challenge, Cheats)
- [S2] XGen Studios wiki: https://xgenstudios.fandom.com/wiki/Motherload, https://xgenstudios.fandom.com/wiki/Dangers_in_game_'Motherload', https://xgenstudios.fandom.com/wiki/Mr._Natas
- [S3] Kongregate wiki: https://kongregate.fandom.com/wiki/Motherload
- [S4] Speedrun.com forums (source-code-level findings): gas pockets https://www.speedrun.com/motherload/forums/3ex73 · earthquakes https://www.speedrun.com/motherload/forums/37zwa · terrain gen https://www.speedrun.com/motherload/forums/ptg8m · source code https://speedrun.com/motherload/thread/7d1n8/1 · Goldium https://www.speedrun.com/motherload/forums/kfpm9
- [S5] Villains wiki, Mr. Natas: https://villains.fandom.com/wiki/Mr._Natas
- [S6] XGen Goldium page: http://www.xgenstudios.com/motherload-goldium/ · GameFAQs Goldium review https://gamefaqs.gamespot.com/pc/946781-motherload-goldium-edition/reviews/158599 · BGG/VGG Goldium wiki https://boardgamegeek.com/wiki/page/thing:129742
- [S7] Super Motherload, Wikipedia: https://en.wikipedia.org/wiki/Super_Motherload · Steam: https://store.steampowered.com/app/269110/Super_Motherload/
- [S8] Steam guide "General Guide by Noeh": https://steamcommunity.com/sharedfiles/filedetails/?id=236148756
- [S9] Steam guide "Chains vs. Combos": https://steamcommunity.com/sharedfiles/filedetails/?id=240623273
- [S10] PlayStation Blog, "How to Earn a Fortune in Super Motherload": https://blog.playstation.com/2013/12/04/how-to-earn-a-fortune-in-super-motherload/
- [S11] Super Motherload reviews: Destructoid https://www.destructoid.com/reviews/review-super-motherload/ · Co-Optimus https://www.co-optimus.com/review/1313/super-motherload-co-op-review.html · Push Square https://www.pushsquare.com/reviews/ps4/super_motherload · Tilting at Pixels https://tiltingatpixels.com/post/Super-Motherload/
- [S12] PlayStationTrophies Super Motherload threads: https://www.playstationtrophies.org/forum/topic/210606-super-motherload-~-trophy-guide-and-roadmap/ and https://www.playstationtrophies.org/forum/topic/289832-if-i-die-in-hardcore-is-everything-lost/
- [S13] GameFAQs Super Motherload boards (special upgrades, endings): https://gamefaqs.gamespot.com/boards/734973-super-motherload/68228945 · https://gamefaqs.gamespot.com/boards/734973-super-motherload/67866630
- [S14] Speedrun leaderboards: https://www.speedrun.com/motherload

---

## 0. Quick facts

| Item | Value | Source |
|---|---|---|
| Developer | XGen Studios, Edmonton, Alberta, Canada | [S2], https://en.wikipedia.org/wiki/XGen_Studios |
| Release | Flash, browser; **29 Sep 2004** (one source); hosted on XGen's site, Miniclip, Kongregate and others | search extract of [S1]/backloggd https://backloggd.com/games/motherload/ |
| Genre | 2D side-view mining platformer with a shop and upgrade economy | [S1] |
| Setting | A terraformed Mars. You are a contract miner for "Mr. Natas" (Satan spelled backwards) | [S1], [S5] |
| Goldium Edition | Paid CD-ROM/Windows edition, **1 Dec 2004**. Now $9.99 from XGen, and bundled on Steam with Super Motherload | [S6] |
| Successor | **Super Motherload**: PS4 launch title **15 Nov 2013**, PS3 Dec 2013, Windows (Steam) 4 Apr 2014 | [S7] |
| Flash EOL | Unplayable on XGen's own site after Flash support ended in 2021; still playable through emulated portals | search extract (CrazyGames) |
| Speedruns | Any% (Speedrun Edition) about **14:45**; Any% Set Seed about **10:48** | [S14] |

---

## 1. Controls and pod physics

### 1.1 Input (PC original)
- **Arrow keys or WASD.** Left/Right drives along the ground. Pushing Left/Right into an adjacent solid block while on the ground drills it sideways. **Down** while on the ground drills the block below. **Up** fires the thruster/propeller to fly. [S1]/XGen controls page http://www.xgenstudios.com/game.php?keyword=motherload
- **I** opens the inventory. Item hotkeys: **R** = Hull Repair Nanobots (confirmed). **C** = Plastic Explosives (confirmed by boss-fight guides: "mash C"). **F** = Reserve Fuel (player comments). **X** = Dynamite, **Q** = Quantum Teleporter, **M** = Matter Transmitter (unverified, but consistent with player comments). [S1], https://www.chaptercheats.com/cheat/pc/18391/motherload/hint/28778
- Explosives and teleporters **can only be used while touching the ground**. [S1] (Quantum Teleporter and Matter Transmitter pages)

### 1.2 Dig directions
- You can drill **down, left and right. Never up.** Going up means flying through an already open shaft or open air. (Core genre rule; stated on [S1]: "move up to fly and into dirt to dig".)
- You can drill only while **resting on the ground**. You cannot drill while airborne (unverified, but consistent with all gameplay descriptions). A drill step moves the pod into the tile it clears, so the tunnel is exactly the pod's path.
- **Stone/boulders cannot be drilled at all** in the original, whatever drill you own. You go around them or blast them with Dynamite or Plastic Explosives. They appear from roughly **−1,600 ft** ([S1] Stone page) or **−1,750 ft** ([S2] Dangers page). Sources disagree; use about −1,600 to −1,750 ft. Goldium's **Multi-Drill** blueprint is the only drill that cuts rock ([S6]).
- **Impenetrable bottom barrier** at roughly −7,200 to −7,300 ft. The only way through is a gap at the **right-most edge of the map**, which leads to the boss arena. [S1] Ending page

### 1.3 Drill speed and soil hardness
- Each drill has a rated speed in ft/s (table in §6). Wiki text: drills "make you drill faster and help offset the harder soil as you get deeper", so **effective dig time per tile rises with depth** and drill upgrades exist to cancel that out. [S1] Autobuy_2000
- One extract says "as you get deeper, the gravity gets stronger". This is a **single, low-confidence claim (unverified)**. Treat hardness-by-depth as the real mechanic.

### 1.4 Flight, weight and engine
- Flight is thrust against gravity. **Engine horsepower and cargo weight** decide climb speed. As cargo gets heavier, climb slows "until the point at which your propellers can only slow your descent". [S1] Minerals/engine extract
- Hard ceiling: with the best engine (V16 Jag, 210 hp), it is "very difficult to take off with **5,800 kg**, and impossible above roughly **6,200 kg**". [S1]
- So in the late game **weight, not cargo slots, is the binding limit**. A full Leviathan Bay of Diamonds (120 × 100 kg = 12,000 kg) cannot be lifted. About 51 Amazonite (6,120 kg) is the practical maximum load, worth about **$25.5M**.
- You can **discard** minerals by clicking them in the inventory, which frees slots and sheds weight. [S1]

### 1.5 Fall damage (verified, [S1] Damage page)
- Falls of **≤ 24 ft** (just under 2 tiles) are safe.
- **Six damage steps**, from **3 HP** (25–36 ft) up to **8 HP** (576 ft or more, i.e. terminal velocity). Damage depends on impact speed. The four middle steps presumably step 4, 5, 6, 7 HP (unverified).
- A fall alone never kills a full-health pod; even the Stock Hull has 10 HP. But an 8 HP fall takes 80% of a stock hull. That makes "don't drop down your own shaft" a real early-game skill.

---

## 2. Fuel, hull, failure and saving

### 2.1 Fuel model
- Fuel drains **continuously over time** and **faster while drilling or flying**. Upward thrust is the heaviest drain. [S1]; same advice is official for the sequel [S10]: "Fuel consumption is highest when digging and flying… stay still while figuring out puzzles".
- Exact litres per second per action were **not found**. Source-code threads exist on speedrun.com [S4] but were unreachable. One extract says the stock **10 L Micro Tank runs dry after about 30 s of continuous mining**. That is a single source, read it as a rough order of magnitude **(low confidence)**.
- Fuel price at the station is **about $1 per litre** [S1]. A Reserve Fuel Tank item gives 25 L for $2,000, about **$80 per litre** [S1]. The 80× markup is deliberate and prices "fuel insurance" very high.
- The game start is a tutorial beat: the pod arrives **nearly empty**. "We forgot to refuel you on the way over! Drive over to the fuel station (Left) and fill 'er up!" Start cash is **$20**. An older version started at $0 with full fuel. [S3], [S1]

### 2.2 Zero fuel
- **Fuel reaching 0 means the pod explodes: game over.** The cargo on board is lost and you reload your last save. [S1], [S2]
- Contrast: Super Motherload's Normal mode made zero fuel **non-lethal** (you can't drill but can still fly back). Its Hardcore mode kept the explosion. See §10.

### 2.3 Hull damage sources

| Source | Damage | Notes |
|---|---|---|
| Falls | 3–8 HP | See §1.5 |
| Lava pockets | **≈58 or ≈41 HP** (two possible values, ±1–2) with the stock radiator | Visible tiles. First seen around **−3,000 ft**. Reduced by radiator %. [S1] Lava/Damage pages |
| Natural gas pockets | `int((|depth| − 3000) / 15) × radiatorMultiplier` → 117 HP at −4,750 ft, 133 at −5,000, 160 at −5,400 (stock radiator) | **Look exactly like normal dirt.** Explode like dynamite (green blast) when drilled. Earliest **−4,750 ft**, rare until −4,950. [S4] gas thread, [S1] |
| Boss attacks | Fireballs and other weapons | No numbers found |

Gas damage code, as quoted from the decompiled source on speedrun.com [S4]:
```
function hitGasPocket() { atv.damage(int((- depth + 3000) / 15) * atv.radiatorCooling[atv.radiator]); }
radiatorCooling = new Array(1, 0.9, 0.75, 0.6, 0.4, 0.2)
```

Gas damage table [S4]:

| Depth | Stock 0% | Dual Fans 10% | Single Turbine 25% | Dual Turbine 40% | Puron 60% | Tri-Turbine 80% |
|---|---|---|---|---|---|---|
| −4,750 ft | 117 | 105 | 88 | 70 | 47 | 23 |
| −5,000 ft | 133 | 120 | 100 | 80 | 53 | 27 |
| −5,200 ft | 147 | 132 | 110 | 88 | 59 | 29 |
| −5,400 ft | 160 | 144 | 120 | 96 | 64 | 32 |
| about −7,200 ft (extrapolated) | ~280 | ~252 | ~210 | ~168 | ~112 | ~56 |

Lava damage table [S1]:

| Radiator | Hit A | Hit B |
|---|---|---|
| Stock (0%) | 58 | 41 |
| Dual Fans (10%) | 52 | 37 |
| Single Turbine (25%) | 43 | 31 |
| Dual Turbine (40%) | 35 | 25 |
| Puron Cooling (60%) | 23 | 16 |
| Tri-Turbine Freon (80%) | 11 | 8 |

Survival thresholds the wikis state: to survive lava you need **at least a Steel Hull (50) plus Single Turbine**. To survive gas you need **at least an Einsteinium Hull (120) plus Dual Turbine**. [S1], [S2]. These thresholds act as hidden gear checks on depth.

### 2.4 Repair
- Emendation Station 3500 repairs at **about $15 per HP** [S1]. Hull Repair Nanobots give +30 HP for $7,500, about **$250 per HP** in the field. Again a deliberate premium on emergency safety.

### 2.5 Death and saving
- Hull at 0 or fuel at 0 means the pod explodes, **game over**, and you **restart from your last save**. [S1]
- **Saving** happens at a hovering save robot **above the Mineral Processor** on the surface. One extract names it "Quantum Particle State Analyzer 6000" (name unverified). [S1]
- The online version used a **username/password account save** that stores cash and pod stats. One forum source says **the mine itself regenerates on reload** (https://forums.whirlpool.net.au/archive/404118, single source). This matches the game's "fresh random map" structure.
- Death is therefore a **roll-back to the last surface save**. You lose the current trip's cargo and everything since the save. It is not a permadeath reset.

---

## 3. Surface buildings and layout

The surface is a flat strip at the top of a 32-tile-wide map. Four shops run **left to right** [S1] Shops page:

| # | Building | Function | Notes |
|---|---|---|---|
| 1 | **Propellent Vendor 12000** (fuel station) | Buy fuel, about $1/L | Far left. The pod spawns next to it |
| 2 | **Mineral Processor 3000** | Sell all minerals and artifacts for cash (and score) | The **save robot hovers above it** |
| 3 | **Autobuy 2000** ("Junk Shop") | Buy pod upgrades in 6 lines: Drill, Hull, Engine, Fuel Tank, Radiator, Cargo Bay | Upgrades replace the previous tier. Selling old parts was not found **(unverified)** |
| 4 | **Emendation Station 3500** | Hull repair (about $15/HP) and 6 consumable items | Far right |

You enter a shop by driving onto or into its pad, which opens a modal menu (unverified detail). **Marsquake rolls happen on shop entry or exit** (§7).

Design note for HoleFactory: the shops are spaced along the full surface width, so a "service run" (fuel, sell, upgrade, repair) is a short drive with mild friction. Fuel sits deliberately at the far left, next to spawn.

---

## 4. Minerals

Values, weights and depth bands come from [S1] Minerals and [S2]. Depth bands are the wiki's *estimates*. Generation is random and rare minerals can appear out of order. Amazonite, for example, "may be found at −3,000 ft, though too rare to be realistic" [S1].

| Mineral | Sell value | Weight | Min depth (est.) | Common depth (est.) | $/kg | Notes |
|---|---|---|---|---|---|---|
| Ironium | $30 | 10 kg | −25 ft | −25 ft | 3 | Most common filler ore |
| Bronzium | $60 | 10 kg | −25 ft | −25 ft | 6 | Orange |
| Silverium | $100 | 10 kg | −25 ft | −25 ft | 10 | White |
| Goldium | $250 | 20 kg | −25 ft | −250 ft | 12.5 | Yellow. "Regular between −600 and −1,000 ft" |
| Platinum ("Platinium") | $750 | 30 kg | −800 ft | −1,700 ft | 25 | |
| Einsteinium | $2,000 | 40 kg | −1,600 ft | −2,600 ft | 50 | |
| Emerald | $5,000 | 60 kg | −2,400 ft | −4,000 ft | 83 | |
| Ruby | $20,000 | 80 kg | −4,000 ft | −4,800 ft | 250 | |
| Diamond | $100,000 | 100 kg | −4,400 ft | −5,700 ft | 1,000 | |
| Amazonite | $500,000 | 120 kg | −5,500 ft | −6,200 ft | 4,167 | Most valuable |

- **Cargo usage.** Each mineral or artifact takes **1 cargo slot**. Bay capacity is listed in "cu ft" but works as an item count; the stock bay "can only store 7 minerals" [S1]. Weight is tracked separately and affects flight (§1.4).
- **Full cargo.** Drilling a mineral when the bay is full **destroys it**: "it simply disappears" [S1]. This creates real tension over which ore to dig.
- **Value curve.** Each tier is worth ×1.7 to ×5 the one before: Iron→Bronze ×2, Bronze→Silver ×1.7, Silver→Gold ×2.5, Gold→Plat ×3, Plat→Einst ×2.7, Einst→Emerald ×2.5, Emerald→Ruby ×4, Ruby→Diamond ×5, Diamond→Amazonite ×5. The jumps get bigger at depth. Value per kg rises about **1,400×** from Ironium to Amazonite, while weight rises only 12×.
- **Score.** Sales also add score. Sources conflict on the multiplier: one table has Ironium = 150 points (5×), another has 1,500 (50×). Score matters mechanically for one thing: **marsquakes start at 100,000 points** (§7).
- **Generation.** Terrain is generated down to **−7,500 ft**. A speedrun forum states "a **1 in 3** chance any given block will be air" [S4] (single source, may include open caverns). Mineral spawn rates differ between versions before and after v0.930 [S4].

### 4.1 Artifacts and treasures [S1] Artifacts page

| Artifact | Value | Notes |
|---|---|---|
| Dinosaur Bones | $1,000 | |
| Treasure (chest) | $5,000 | |
| Martian Skeleton | $10,000 | |
| Religious Artifact | $50,000 | 500,000 points. Worth more than any mineral except Diamond and Amazonite |

- Artifacts are very rare: "you may need to dig 1,000 ft just to find 1 or 2". They take one cargo slot each. Weights were not found **(unverified)**.
- Speedrunners route around the chance of a relic spawn; it is the main "jackpot" random event of a run [S4].
- **Goldium Edition** adds buried **Ancient Blueprints** (one per pod part, between −4,000 ft and the bottom) and easter eggs (§9).
- Ending "loot" is a cosmetic, story-only list of items worth nothing (§8.3).

---

## 5. Hazards

| Hazard | Starts | Visible? | Effect | Counter |
|---|---|---|---|---|
| **Stone/boulders** | −1,600 to −1,750 ft | Yes (grey) | Undrillable. Turns the map into a maze | Route around it, or Dynamite (3×3) / Plastic Explosive (5×5). Goldium Multi-Drill |
| **Lava pockets** | about −3,000 ft | **Yes** | 41 or 58 HP hit (stock radiator) | Avoid, or radiator plus a big hull. Explosives also clear lava safely |
| **Natural gas pockets** | −4,750 ft (rare until −4,950) | **No, looks like dirt** | Depth-scaled explosion, 117 to about 280 HP | Radiator plus hull. Explosives clear them safely. Luck |
| **Falls** | Always | n/a | 3–8 HP | Thrust to brake |
| **Fuel exhaustion** | Always | Fuel gauge | Explosion, game over | Plan the return trip. Reserve tank, teleporters |
| **Cargo overflow** | Always | Cargo gauge | Minerals destroyed | Discard low-value ore |
| **Weight limit** | Late game | Implicit | Can't climb | Engine upgrades. Discard ore |
| **Marsquakes** | Score ≥ 100k | Screen shake and a flashing "!" | Underground is almost fully regenerated, so tunnels are lost | None (5% roll per shop visit) |
| **Altimeter failure** | −5,800 ft | n/a | Depth readout scrambles to "?XXXXX" | Story and tension device |
| **Bottom barrier** | about −7,200 to −7,300 ft | Yes | Impenetrable except at the right-most edge | Find the gap |
| **Boss** | Hell (shown as −66,666 ft) | Yes | Fireballs and more | Explosives only (§8.3) |

Heat: no separate "heat by depth" meter was documented in the original. The radiator only reduces **lava and gas** damage [S1] Autobuy_2000. Treat any ambient heat/DoT as a HoleFactory invention, not Motherload canon.

Explosives clear stone, lava and gas **without harming the pod**, but they **also destroy any minerals and artifacts in the blast** [S1] Dynamite page.

---

## 6. Upgrades (Autobuy 2000)

Six upgrade lines, sold on **the same price ladder**: $750 → $2,000 → $5,000 → $20,000 → $100,000 → $500,000. Stats and prices come from [S1] Autobuy_2000, [S2], GameFAQs/chaptercheats extracts.

| Tier price | Drill (ft/s) | Hull (HP) | Engine (hp) | Fuel tank (L) | Radiator (dmg cut) | Cargo bay (slots) |
|---|---|---|---|---|---|---|
| Stock ($0) | Stock Drill **20** | Stock Hull **10** | Stock Engine **150** | Micro Tank **10** | Stock Fan **0%** | Micro Bay **7** |
| $750 | Silvide Drill **28** | Ironium Hull **17** | V4 1600 cc **160** | Medium Tank **15** | — | Medium Bay **15** |
| $2,000 | Goldium Drill **40** | Bronzium Hull **30** | V4 2.0 L Turbo **170** | Huge Tank **25** | Dual Fans **10%** | Huge Bay **25** |
| $5,000 | Emerald Drill **50** | Steel Hull **50** | V6 3.8 L **180** | Gigantic Tank **40** | Single Turbine **25%** | Gigantic Bay **40** |
| $20,000 | Ruby Drill **70** | Platinum Hull **80** | V8 Supercharged 5.0 L **190** | Titanic Tank **60** | Dual Turbine **40%** | Titanic Bay **70** |
| $100,000 | Diamond Drill **95** | Einsteinium Hull **120** | V12 6.0 L **200** | Leviathan Tank **100** | Puron Cooling **60%** | Leviathan Bay **120** |
| $500,000 | Amazonite Drill **120** | Energy-Shielded Hull **180** | V16 Jag **210** | Liquid Compression Tank **150** | Tri-Turbine Freon Array **80%** | — |

Notes:
- Lines: Drill, Hull, Engine and Fuel have 7 tiers (stock plus 6). Radiator has 6 (no $750 tier). Cargo has 6 (no $500k tier). Cargo's $5,000 Gigantic Bay appeared in only some extracts, but the wiki says "6 cargo bays", so it fits. One extract says "9 fuel tanks". That may count Goldium extras such as the Fuel Integrator blueprint **(unverified)**.
- **Cost to max everything:** 4 lines × $627,750 + radiator $627,000 + cargo $127,750 = **$3,265,750**.
- **Key design insight:** each upgrade price equals **one mineral of the same-named tier**: Platinum $750, Einsteinium $2k, Emerald $5k, Ruby $20k, Diamond $100k, Amazonite $500k. Several drill and hull names also reuse mineral names (Goldium/Emerald/Ruby/Diamond/Amazonite drills; Ironium/Bronzium/Platinum/Einsteinium hulls). Reaching a new mineral band means about one rare find buys the next tier, which keeps **trips per upgrade roughly constant** across a 600× price range.
- Engine growth is small (150 → 210 hp, +40%), while late cargo gets much heavier (10 → 120 kg per item). The engine is the part that turns weight into a decision.
- Drill speed grows 6× (20 → 120 ft/s). That offsets harder deep soil, so it improves both dig time and fuel used per tile.

### 6.1 Consumable items (Emendation Station 3500) [S1]

| Item | Price | Effect | Use condition |
|---|---|---|---|
| Reserve Fuel Tank | $2,000 | +25 L fuel instantly (about $80/L) | Any time |
| Hull Repair Nanobots | $7,500 | +30 HP (about $250/HP) | Any time |
| Dynamite | $2,000 | Clears a **3×3** area around the pod. Max **120** damage to the boss | On ground |
| Plastic Explosives (C4) | $5,000 | Clears **5×5**. Max **240** damage to the boss | On ground |
| Quantum Teleporter | $2,000 | Teleports near the surface by the fuel station, but **may fling you up or down at high speed** (5–9 fall damage, or down a mine shaft) | On ground |
| Matter Transmitter | $10,000 | Teleports **safely** next to the fuel station | On ground |

The two teleporters form a classic cheap-and-risky vs. expensive-and-safe pair. Every item is an **emergency valve** for the fuel/hull clocks, and every one is priced well above its surface-service equivalent.

---

## 7. Map, depth milestones, story and endings

### 7.1 Map geometry
- **1 tile = 12.5 ft.** The map is **32 tiles wide (400 ft)** [S1]. Terrain is generated to **−7,500 ft**, about **600 rows** [S4]. That gives about 19,200 tiles, with about a third of them air [S4].
- The playable bottom is at about −7,200 to −7,300 ft. There is an impenetrable barrier with a gap at the right-most column, leading to "Hell". In Hell the altimeter shows a fixed **−66,666 ft** [S1] Ending.
- The surface (y = 0) holds the four shops and the save robot. You can also fly **above** the surface; the Goldium easter eggs trigger at +5,000 ft and +10,000 ft altitude (§9).

### 7.2 Depth timeline (first time past each depth)
Sources disagree by a few hundred feet on some of Pod #3422-2's messages. Both versions are given.

| Depth | Event | Cash | Source |
|---|---|---|---|
| 0 ft (start) | Mr. Natas intro: "forgot to refuel you… fill 'er up!" and "strange activity" hiring problems | Start with $20 | [S3] |
| −25 ft | Ironium/Bronzium/Silverium/Goldium begin | | [S1] |
| −250 ft | Goldium becomes common | | [S1] |
| −500 ft | Natas congratulates you | **+$1,000** | [S1], [S3] |
| −800 ft | Platinum appears | | [S1] |
| −1,000 ft | Natas congratulates you. Mentions core vibrations causing quakes (one extract) | **+$3,000** | [S1], [S3] |
| −1,600 ft | Einsteinium appears. Stone begins (−1,600 to −1,750) | | [S1], [S2] |
| −1,750 ft | Unidentified source: "The eyes… oh my god, THE EYES!!!" | | [S1] Transmissions |
| −2,100 ft | Martian Digging Pod #3422-2 (friendly veteran) greets you and talks about retirement | | [S1] |
| −2,400 ft | Emerald appears | | [S1] |
| −2,500 ft | Distress call: "unidentified source screams for help" (one extract). Another extract places #3422-2's radiator/lava tip here | | [S1] |
| −3,000 ft | Lava pockets begin | | [S1] |
| −3,100 ft | #3422-2 warns about lava and recommends radiators (alternative depth) | | [S1] |
| −3,500 ft | Natas congratulates you, warns about **natural gas**, and says the altimeter is rated to about **6,000 ft**: don't go deeper | **+$25,000** | [S1], [S3] |
| −4,000 ft | Ruby appears. Emerald is common. Goldium blueprints can start appearing | | [S1], [S6] |
| −4,100 ft | Pod #3422-2 is **trapped**: a quake damaged its drill | | [S1] |
| −4,400 ft | Diamond appears | | [S1] |
| −4,500 ft | Pod #10043: "Oh BABY!!! THIS IS IT!!! I HIT THE MOTHERLOAD!!!!" then screams, and the signal cuts | | [S1] |
| −4,750 ft | Gas pockets can appear (common from −4,950) | | [S1] |
| −5,500 ft | Amazonite appears | | [S1] |
| −5,800 ft | Altimeter scrambles to "?XXXXX". Natas **demands you turn back** (twice in all) | | [S1], [S5] |
| about −7,200 to −7,300 ft | Through the right-edge gap into Hell (−66,666). Natas reveals himself. **Boss fight** | | [S1] Ending |

Verified depth bonuses total **$29,000** (500/1000/3500 ft). Other bonuses may exist; one extract mentions a "$20,000 transmission reward" without a depth **(unverified)**.

### 7.3 Story arc and boss
- **Narrative device:** short radio "transmissions" fired once at depth thresholds. Natas starts out generous, giving cash and safety tips. Then come other miners' horror messages: eyes, screams, trapped pods, "I hit the motherload" followed by silence. Natas's tone shifts to "turn back", and finally the reveal: he planned to kill you for taking "the motherload" from him and has already killed **thousands** of digging pods. [S1], [S5]
- **Boss form 1:** "Mr. Natas", a towering suited humanoid with Satanic features, **1,000 HP** (one source). He sinks into the ground and transmits that he is "master of all EVIL!". **Form 2** appears about 3 s later: Satan, a cyborg demon with **2,000 HP**. On death he freezes with a roar, kneels and crumples. [S1] Ending, [S5], chaptercheats hint
- **Damage only from explosives** placed at his feet. His hitbox is "deceptively small" and edge hits do little. Dynamite max 120, Plastic max 240. Minimum perfect-hit cost: 14 Plastic ($70k) or 26 Dynamite ($52k). Players bring Nanobots to heal. **No pause or inventory menu** during the fight. [S1]
- **Ending:** you inherit Natas's fortune. The reward list is flavour items: his Kevlar Suit, Staff of Hell, Laser Monocle, Satan's Hooves, Horns, both Evil Eyes, Boiler of Eternal Infernos, a "Martian Reward for Restoring Peace", and **250,000 shares of Natas HI Inc.** [S1] Ending, [S5]
- **Endings:** the original has **one ending**. Goldium adds a New Game+ loop (§9). Super Motherload has 3 endings (§10).

---

## 8. Economic pacing (derived from the numbers; trip estimates are mine)

### 8.1 Value of a full bay
| Bay (slots) | Typical fill at that stage | Approx. gross per trip |
|---|---|---|
| Micro (7) | Iron/Bronze/Silver, some Goldium, near the surface | **$300–$900** |
| Medium (15) | Goldium-rich, −250 to −1,000 ft | **$2,000–$4,000** |
| Huge (25) | Goldium plus Platinum, −800 to −1,700 ft | **$6,000–$15,000** |
| Gigantic (40) | Platinum plus Einsteinium, −1,600 to −2,600 ft | **$30,000–$80,000** |
| Titanic (70) | Einsteinium/Emerald, some Ruby, −2,400 to −4,800 ft (weight starts to bind: 70 × 60 kg = 4,200 kg) | **$150,000–$500,000** |
| Leviathan (120) | Ruby/Diamond/Amazonite. **Weight-capped at about 6,200 kg** | **$1M–$25M** (limited by lift, not slots) |

### 8.2 Shape of the money curve (estimates, unverified)
- **Trips 1–3:** about $300–900 each, so the first $750 upgrade comes after 1–3 trips. The **−500 ft (+$1,000) and −1,000 ft (+$3,000) bonuses** each equal several early trips. They act as a deliberate "go deeper" lure that pays for the $2k tier.
- **Mid game:** each tier costs roughly one or two full bays from the depth band it unlocks, so **1–4 trips per upgrade** throughout. The ladder is geometric (×2.5–×5 per tier) and so are mineral values, which is why the cadence feels even.
- **−3,500 ft bonus ($25k)** arrives as the $20k tier opens. It is another depth-for-cash bribe, right before lava/gas gear checks force radiator plus hull spending.
- **End game:** a single Diamond ($100k) or Amazonite ($500k) buys a whole tier, so money stops being the constraint. Survival (gas), weight and the boss's explosive cost take over.
- **Total spend to max** is about $3.27M plus boss explosives ($52–70k minimum) plus repairs and fuel. A competent casual playthrough is a few hours **(unverified)**. Speedruns finish in 10–15 min using set seeds or relic luck [S14].

---

## 9. Goldium Edition (what it added)

[S6], [S1] Challenge page, [S4] Goldium thread:
- **Platform:** Windows CD-ROM, 1 Dec 2004. Offline play and saving, fullscreen, no ads, expanded soundtrack, slightly improved graphics.
- **Challenge mode:** 12 timed challenges (collect N of a mineral, reach a depth, and 3 final **mazes**). The GameFAQs review criticises the last maze as rote memorisation.
- **Ancient Blueprints**, buried between −4,000 ft and the bottom, one per pod part. They look like a blue parchment scroll:
  - **Multi-Drill**: Amazonite speed (or faster), **drills rock**
  - **Regenerative Hull**: stronger than Energy-Shielded, **slow HP regen**
  - **Hyper-Drive**: faster than the V16, **unlimited teleport to the surface**
  - **Fuel Integrator**: bigger than Liquid Compression, **harvests fuel from gas pockets** (still takes damage)
  - **Magma Converter**: better than Tri-Turbine, **earns money from lava hits** (still takes damage)
  - **Portable Wormhole**: bigger than Leviathan, effectively **unlimited cargo**
- **Easter eggs:** fly to **+10,000 ft** for a "Guardian Angel" that **halves all damage**, including the boss's. An "Oil-Bird" black angel from about −500 ft gives a chance of cash per dirt tile dug. One extract mentions a "Mr. Dog" transmission at **+5,000 ft** paying $5,000 (edition unverified).
- **New Game+:** after beating the game, restart with mineral prices **½** and points **×2**. The next loop is ⅓ price and ×3 points, and so on. Boss HP and damage rise on each replay.

Takeaway: Goldium's additions are **hazard-to-resource converters** (gas→fuel, lava→money, ore→repair). They are the closest thing in the franchise to "automation", and they slot naturally into a factory game.

---

## 10. Super Motherload (2013): what changed

Sources: [S7]–[S13].

| Area | Original Motherload | Super Motherload |
|---|---|---|
| Platforms | Browser Flash | PS4 (launch, 15 Nov 2013), PS3, Windows (Steam, 4 Apr 2014). Later Steam rebinding update |
| Players | Solo | **1–4 local couch co-op**, single shared screen. **Shared fuel tank**, separate cargo, hull and cash. Players compete for combos |
| World | Random, 32 wide × about 7,500 ft | **Procedural**, plus handcrafted **bomb puzzles**. Much deeper: bases at **0 / Alpha −1,836 / Beta −4,338 / Gamma −5,789 / Delta −7,463 ft**, and the core is around −13k ft (one guide) |
| Return trip | Always to the surface | **Underground bases are checkpoints** with fuel, sell, repair and upgrade, spaced further apart with depth. No need to surface every trip |
| Fuel at 0 | Explode, game over | **Normal:** can't drill but can fly to a base. **Hardcore:** explode, no respawn, lose progress since the last base |
| Death | Reload last save | **Normal:** respawn at the last activated base. **Hardcore:** that character is gone permanently |
| Barriers | Stone (blast only) | Rock **and steel/metal plates**. **Electron bombs** melt plates, and the hot remnants still hurt |
| Explosives | Dynamite 3×3, C4 5×5 | **TNT 3×3, C4 5×5, Shaft bomb 1×9**, line/"T" bombs, Electron bombs, Air Bombs. Bombs are made from **Explodium** ore ($1) combos |
| Economy twist | Flat price per ore | **Chains:** the same ore consecutively gives an instant cash bonus per ore. **Combos/Smelting:** two specific ores in sequence become an **alloy** worth more. Examples: Sterling Silver = Bronzium + Silverium; White Gold = Sterling Silver + Goldium; Katana Gold = Bronzium + Goldium; Rare Earth Magnet = Ironium + Platinium. Achievement for a 50-ore chain |
| Upgrades | 6 lines × 6–7 tiers | Drill, speed, fuel, cargo, hull and more, from about $1.5k up to $1M+. Plus **special upgrades**: Fuel Converter ($500k, Ironium→fuel), Hull Converter ($500k, Bronzium→repair), Alchemy ($100k, cheap ore→Platinum), Rubber Hull ($250k, bouncy), **Rock Drill ($2M)**, **Metal Drill ($25M)**, Magma Money, Oil Extractor (dirt→cash, found near the core), Force Field, Hull Regen, Double Cargo, Air Bombs |
| Story | Text transmissions, Natas = Satan | Alternate **Cold-War Mars**, **Solarus Corporation**, story by Kurtis Wiebe (Image Comics). **Fully voiced** Soviet and American cast. Horror sci-fi mystery about "strange occurrences" at Solarus bases |
| Endings | 1 (kill Natas) | **3 endings**: side with Abaddon or Tiberius and destroy Mars or Earth within a 30 s timer, or let it expire and both are destroyed. Endings unlock characters (Abaddon, Ana Banketik, Demitri Ubekov, Laika, Simulacrum) |
| Input | Keyboard | Gamepad. DualShock 4 **touch-pad swipes detonate bombs by direction** (a useful precedent for mobile swipe input) |
| Reception | Cult classic | Destructoid 8/10. Common criticism: Normal mode's safety net and bases soften the tension |

Takeaways for HoleFactory:
1. Super Motherload's **bases weakened the core push-your-luck loop**. HoleFactory's factory logistics (lifts, belts, depots) play the same role, so they must cost something and be risky and earned, never free.
2. **Chains, combos and smelting** are direct precedent for adding processing steps: alloys worth more than their inputs. Factorio-style smelters and assemblers fit the series' DNA.
3. **Converters** (ore→fuel, ore→repair, lava→money, gas→fuel) are proven franchise ideas. They map well to factory machines.

---

## 11. Analysis: why the Motherload loop works

1. **Three clocks, one decision.** Every trip runs two draining meters (**fuel**, **hull**) against one filling meter (**cargo**). Every second underground asks "one more tile, or turn back now?" That is a push-your-luck game with a continuous risk dial.
2. **Asymmetric return cost.** Going down is cheap: gravity is free and drilling is the main cost. Coming up costs thrust fuel, and **richer cargo is heavier**, so you climb slower and burn more fuel. Success makes the trip home harder. This is the most elegant rule in the game.
3. **Total loss on failure.** Losing the cargo (and, in the original, everything since the save) is what makes the return trip tense. Super Motherload's Normal mode removed it and lost bite.
4. **The tunnel is an investment.** Your shaft is persistent infrastructure: the deeper and straighter it is, the cheaper later trips become. Marsquakes take it away again. This is a natural hook for a factory game: the player already thinks of the hole as something they built.
5. **Geometric parity between values and prices.** Mineral values and upgrade prices follow the same ladder, with names reused, so trips per upgrade stay about 1–4 from $750 to $500k. Upgrades come at a steady rhythm and each one is felt at once (faster drill, longer range, bigger haul).
6. **Gear checks disguised as hazards.** Stone (−1,600), lava (−3,000) and gas (−4,750) each demand a specific purchase (explosives, radiator plus hull). Depth gates progress with no explicit locks.
7. **Hidden information.** Gas looks like dirt, so even a well-equipped run carries real risk. Lava is visible, so skill can avoid it. The mix of readable and unreadable danger keeps late trips tense.
8. **Cargo triage.** Limited slots, destroy-on-full, discard to make room and weight limits make players compare values per slot and per kg, especially late.
9. **Emergency valves at punitive prices.** Reserve fuel (80× the price), nanobots (about 17×) and teleporters let a player rescue a bad trip, but at a cost that teaches planning.
10. **Narrative pull from depth.** Cash bonuses, then creepy transmissions, then a scrambled altimeter, then "turn back": the story is a curiosity engine and a reason to go deeper than the economy alone requires. The boss gives the mine an end point.
11. **Short loop length.** One trip lasts minutes, with a shop stop between trips. That suits **mobile session lengths** very well.
12. **Very small input set.** Four directions plus a few item keys. This translates cleanly to touch.

---

## 12. Ranked: ESSENTIAL to preserve vs. SAFE to modernize

### ESSENTIAL (ranked: lose any of these and it stops being Motherload)
1. **The trip loop:** surface → descend → mine → return → sell → upgrade → repeat. The surface (or a player-built hub) must stay the place where value is realised.
2. **Fuel as the master clock**, with harsh failure at 0 (pod lost and **this trip's cargo lost**). An "assist/casual" difficulty can soften it, but the default must keep the bite.
3. **Asymmetric return:** climbing costs fuel and is slowed by **cargo weight**, scaled against engine power.
4. **Limited cargo** with triage (destroy-on-full or discard), so a full bay forces a return.
5. **A depth-stratified, geometric value curve** (10 ore tiers, about ×2–5 per tier) with hazards that scale with depth.
6. **Dig down, left and right only; never up.** Up is flight through open space only. Tunnel shape becomes a planning problem. (In 3D isometric this becomes "down plus 4 horizontal directions, never up"; see the open questions.)
7. **Six upgrade lines on a geometric ladder** (drill, hull, engine, fuel, radiator, cargo), each with an immediately felt stat.
8. **Hull plus hazard trio:** stone (blast or route around), lava (visible, radiator-mitigated), gas (hidden, depth-scaled), plus fall damage.
9. **Emergency consumables** (reserve fuel, repair, teleport home safe or risky, small and large explosives) priced well above surface services.
10. **Depth milestones with cash bonuses and a transmission-driven mystery** ending in a boss and a definite ending.

### SAFE to modernize (ranked from "change freely" to "change carefully")
1. **Saving:** autosave on the surface or at a hub, plus cloud save. Keep failure a loss of the trip; there's no need for manual save robots.
2. **Controls:** touch-first (virtual stick or d-pad, hold-to-thrust, swipe-to-bomb as in Super Motherload's DS4 touchpad, quick-slot items instead of hotkeys).
3. **Shop UI:** compare-and-buy cards, previews, and no modal blocking where possible.
4. **Score:** replace with achievements, depth records and leaderboards.
5. **Theme and naming:** Mr. Natas/Satan can become a corporate antagonist (a corp-horror tone like Super Motherload's Solarus). This also helps store age ratings **(unverified)**.
6. **Map width:** 32 tiles was a 2004 screen limit. HoleFactory can widen the map to make space for factory infrastructure.
7. **Hidden gas:** keep the threat but allow telegraphing (scanner upgrade, faint hiss/particles), so deaths feel fair on small screens.
8. **Fall damage tuning and "gravity grows with depth":** tune freely.
9. **Marsquakes:** in a factory game, erasing the map would also erase built infrastructure. Reimagine them as **localized collapses** that damage belts or lifts and need repair, rather than a full reset.
10. **Underground bases / outposts (Super Motherload):** allowed only if **player-built, resource-costly and logistics-dependent** (fuel piped down, ore lifted up). Free checkpoints would kill rules 1–3 above.
11. **Converters, chains, alloys and smelting** (Goldium and Super Motherload): safe and recommended. They fit the Factorio layer: smelters make alloys, converters turn hazards into resources.

---

## 13. Implications for HoleFactory (brief)

- **Automation should extend reach, not replace the trip.** Let factory logistics automate *shallow, low-value* ore (Ironium–Goldium) and *processing*. Keep *deep, high-value* ore pod-only, or make it hard to automate (hazards break belts, lifts have throughput and weight limits). The pod stays the protagonist.
- **The Motherload price ladder can drive factory tiers too.** Factory machines can follow the same ×2.5–5 ladder and mineral-name tiers, keeping the "one rare find ≈ one tier" rhythm.
- **Weight and fuel are already logistics problems.** Lifts with kg capacity and fuel pipelines to depth outposts translate Motherload's two core constraints into Factorio terms.
- **Hazards become infrastructure threats.** Lava breaches, gas explosions and collapses (the reimagined marsquakes) create repair/defence loops similar to Factorio's biters, but themed to the mine.
- **Mobile pacing:** keep each pod trip at 2–5 minutes, and let factory production run while the pod is out (and possibly offline, which is a design decision).

---

## Appendix A: cheat codes (original)

Reported codes: `blingbling` (+$100,000), `supersize` (next cargo bay), `penetrable`, `warp9`, `toocool`, `guzzle`, `digdug`, `ntouchable`, `fillerup` [S1] Cheats page / chaptercheats. Effects other than the first two were not confirmed; names suggest drill, engine, radiator, fuel, hull and refuel boosts **(unverified)**.

## Appendix B: confidence summary
- **High** (multiple consistent sources): mineral values and weights; all upgrade names, stats and prices; item prices and effects; shop names and order; artifact values; fall, lava and gas damage numbers; −500/−1,000/−3,500 bonuses; boss HP and explosive damage; marsquake rule; map width and tile size; Goldium blueprints; Super Motherload features, bases, endings and modes.
- **Medium** (single source or minor disagreement): stone start depth (−1,600 vs −1,750); exact depths of Pod #3422-2 messages; save robot name; fuel about $1/L; repair about $15/HP; air ratio of 1 in 3; the 5,800–6,200 kg lift cap.
- **Low / unverified:** fuel drain rates per action (only the "about 30 s on stock tank" anecdote); gravity increasing with depth; middle fall-damage steps; X/Q/M hotkeys; artifact weights; extra transmissions or bonuses beyond those listed; trips-per-upgrade estimates (derived by me); casual playtime.
