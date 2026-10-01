# HoleFactory: Art Direction Research Brief (02)

**Scope:** Research on *Little Rocket Lab* and adjacent cozy, readable isometric games, turned into an art-direction proposal for HoleFactory that can be built procedurally and/or from CC0 low-poly kits in a WebGL2/WebGPU engine, with iPhone as the primary target.

**Verification note:** In this session WebSearch worked but WebFetch was blocked by the network egress proxy for every domain tried. Facts marked with a URL were checked against search-result text from that source. Claims marked **(unverified)** come from general knowledge or screenshot recollection and should be checked before anyone relies on them. All hex values, angles and budgets are **proposals** made for HoleFactory. They are not measurements taken from other games.

---

## 0. TL;DR: the decisions this brief recommends

| Topic | Recommendation |
|---|---|
| **Key finding** | *Little Rocket Lab* (LRL) is **not a 3D game**. It is **isometric, SNES-style pixel art** made in Unity. The "3D isometric" quality the user wants from it is a *feel*: chunky, toy-like, bright, cozy, grid-readable. HoleFactory should rebuild that feel in **real low-poly 3D**, and can optionally offer a **"Pixel Lab" render filter** (low-res render + 1-px outlines) as a direct homage. |
| World model | **"Diorama Cutaway."** The surface is a 3D isometric plateau where the factory sits, and the mine is the **cut-away front face** of that plateau: a vertical 2D dig plane exactly like Motherload, extruded into 3D blocks with a recessed back wall. |
| Projection | **Orthographic** (constant tile size, so touch targets stay consistent, no perspective distortion, stable pixel snapping). |
| Camera angles | Surface: **yaw 45°, pitch 35°** (≈ true-iso 35.26°). Underground: **yaw 20°, pitch 20°** (the dig face reads almost head-on, like Motherload). Blend the two using the pod's **depth** (rows 0 to 4), not time. Build mode tilts to **pitch 55°** to show belts that tall machines would otherwise hide. |
| Zoom | Measured in **world units visible across a 375-pt portrait screen**: surface default 10 (range 6–22); underground default 9 (range 7–13). Points per unit stay constant across orientations. |
| Shading | **Flat-shaded vertex colours** from a single shared palette, plus a **3-step toon ramp** with **hue-shifted (plum) shadows**, **voxel vertex AO** on terrain, **inverted-hull outlines** on gameplay objects only, and **emissive ores** whose glow rises with depth. |
| Lighting | Surface: one directional sun and a hemisphere light; one shadow map (blob shadows on low tier). Underground: the sun fades out and a **shader "light bubble"** around the pod, plus up to 16 cheap point lights (lamps, lava, machines), replaces real dynamic lights. Ambient falls from 1.0 at the surface to a floor of 0.12. |
| Palette | Rust-orange Mars surface with peach sky and a **blue sunset halo** (true of Mars). **Eight strata bands** run from rust, ochre, iron clay, violet shale, blue basalt and obsidian down to the magma mantle. Each ore has a unique colour **and** silhouette. Machines have **cream bodies with role-coloured accents**. |
| UI | Chunky, rounded, "toy-button" UI (radius 16–24 pt, a 4-pt pressed "lip"), cream panels with plum ink, Fredoka + Nunito (SIL OFL). Hit targets ≥ 44 pt, primary buttons 56–72 pt, all built for 375-pt portrait first. |
| Assets | Code-first procedural kitbash (terrain, belts, lifts, ores, rocks, machines from rounded primitives), backed by **CC0** kits: **Kenney** (Conveyor, Factory, Space, Space Station, City Industrial, Mini Characters, Particle, UI Sci-Fi), **Quaternius** (Ultimate Space Kit, Sci-Fi Essentials, Modular Sci-Fi MegaKit), **KayKit** (Space Base Bits, Resource Bits, Block Bits). Everything gets recoloured into our palette at build time. |

---

## 1. Little Rocket Lab: deep dive

### 1.1 Facts
- **Developer:** Teenage Astronauts, a solo studio run by **Kyle Schmitz** (ex-Ubisoft) in Winnipeg, Canada. **Publisher:** No More Robots. **Engine:** Unity. Character art and most hand-drawn illustrations are by **Eirill Dragland**. Sources: https://godisageek.com/2024/12/little-rocket-lab-interview-it-helped-me-rediscover-why-i-got-into-programming-in-the-first-place/ , https://www.thesixthaxis.com/2024/12/13/interview-little-rocket-lab-and-making-factory-automation-cute-and-cosy/
- **Release:** PC (Steam) and Xbox / Game Pass on **7 Oct 2025** (https://thinkygames.com/news/factorio-meets-stardew-valley-in-the-newly-released-my-little-rocket-lab/). **Switch and Switch 2 on 10 Dec 2025** at $19.99. The Switch 2 Edition is a free upgrade with a **120 fps** mode (https://www.gematsu.com/2025/11/little-rocket-lab-for-switch-2-switch-launches-december-10 , https://nintendoeverything.com/little-rocket-lab-will-have-a-nintendo-switch-2-edition/). One review reports the Switch 1 version at 60 fps, 1080p docked / 720p handheld (https://gertlushgaming.co.uk/little-rocket-lab-review-automation-adventure/). **No iOS/Android version** as of this research (unverified).
- **Reception:** about 90% positive on Steam from around 1,290 reviews at the time the search snippet was indexed (via search summary of https://store.steampowered.com/app/2451100/Little_Rocket_Lab/).
- **Pitch:** "Stardew Valley meets Factorio." You play Morgan, an aspiring engineer who returns home to the run-down mining town of **St. Ambroise** to finish the family dream: a rocket (https://hardcoregamer.com/review-little-rocket-lab/ , https://www.pcgamer.com/games/life-sim/factorio-but-cozy-little-rocket-lab-is-a-factory-builder-with-plenty-of-stardew-valley-vibes/).
- **Origin:** the game began as a Harvest Moon 64 / Stardew-style life sim with automation. Farming was later cut and the factory became the goal (The Sixth Axis interview above).

### 1.2 Art style: what it actually is
- **Pixel art, not polygons.** The developer explicitly aimed for a "throwback to the bright cheerful pixel art aesthetic of old school SNES games" (Sixth Axis / GodIsAGeek interviews). Reviewers describe it as "16-bit, chibi", "lovely pixel-art style", and "Cutesy pixel art graphics with a friendly, bright atmosphere" (https://www.tech-gaming.com/little-rocket-lab/ , https://www.metacritic.com/game/little-rocket-lab/). A ResetEra announcement thread is titled "Factory game + cute pixel art" (https://www.resetera.com/threads/little-rocket-lab-announced-pc-xbox-game-pass-switch-2025-factory-game-cute-pixel-art.1057272/).
- **Isometric perspective.** "It's made with an isometric perspective, and the pixel art resolution is a little closer to the farming life-sim" (Thinky Games, above). One reviewer calls the world "3D isometric" with "a grid over it to help with placing" (Gert Lush Gaming, above). That is probably loose wording; the game is 2D-iso pixel art, **(unverified whether it uses 3D geometry under pixel sprites)**. This loose wording is probably where the user's "3D isometric" expectation comes from.
- **Palette and lighting:** "soft edges, painterly colors, and a subtle bloom that gives every frame a hazy, nostalgic glow". The palette is otherwise vivid, and the town's evenings add variety (https://www.cgmagonline.com/review/game/little-rocket-lab-switch-2/ , https://gamecritics.com/ben-schwartz/little-rocket-lab-review/), which implies a time-of-day tint.
- **Characters:** chibi proportions with manga-flavoured portraits for dialogue (gamepressure summary; Dragland illustrations).
- **From screenshots (unverified):** saturated greens, warm wood browns, teal water and peach/pink accents. Outlines are dark and coloured, not pure black. Shadows are soft drop shadows under objects. Machines are boxy and rounded like toys, with readable silhouettes. Items ride visibly on belts. The isometric camera is fixed with no rotation. The likely 2:1 pixel-iso grid is equivalent to an orthographic camera at **yaw 45°, pitch 30°** (see §4).

### 1.3 Factory mechanics (as documented on the community wiki)
| Element | Detail | Source |
|---|---|---|
| Manual mining | Hammer on ore deposits (iron = light blue, coal = black) to get the first 10 of each | https://littlerocketlab.wiki.gg/wiki/Getting_Started |
| Drill (L1) | Automatically mines a deposit and outputs onto a belt (Tier 1 research) | https://littlerocketlab.wiki.gg/wiki/Research |
| Furnace (L1) → Assembler (L1) | Assembler can't touch the furnace; at least one tile of belt is needed between them. You pick a recipe (e.g., Iron Plate). | Getting Started |
| Power | Assembler L1 needs **500 W**. Power poles **auto-connect** when close enough. The early grid runs off Auntie's wind turbines. | Getting Started, https://littlerocketlab.wiki.gg/wiki/Power |
| Conveyor belt | **90 items/min** | https://littlerocketlab.wiki.gg/wiki/Conveyor_Belt |
| Splitter | A *robotic arm* that splits by a configurable ratio, max **45 items/min** (Tier 1) | https://littlerocketlab.wiki.gg/wiki/Splitter |
| Underpass | Carries items under obstacles and pedestrian paths (Tier 1) | Research |
| Item Dispenser | Dispenses items onto belts (Tier 1) | Research |
| Cable Crane | Moves items from tile A to tile B **up to 12 tiles**, passing over buildings (Tier 3) | https://littlerocketlab.wiki.gg/wiki/Cable_Crane |
| Sorter | 2 inputs, 2 configurable outputs (Tier 4) | https://littlerocketlab.wiki.gg/wiki/Sorter |
| Water Pump | Mid-game (Tier 5) | https://littlerocketlab.wiki.gg/wiki/Water_Pump |
| Wooden Chest | 20 stacks, **cannot be automated** (manual only) | https://littlerocketlab.wiki.gg/wiki/Wooden_Chest |
| Research | Tiered, done at the **University** and the **Observatory** | Research |
| Equipment | Head, gloves, boots. **Magnet Boots** stop belts from dragging you along: the player walks on the factory floor. | https://littlerocketlab.wiki.gg/wiki/Equipment |
| Economy | "No significant economic constraints". Space limits stop mega-factories, and belt layout can feel cramped. | Search summaries of reviews (Gamecritics, Hardcore Gamer) |

### 1.4 Town and exploration structure
- St. Ambroise has **six major areas plus a few interiors**. The **Mines** lie under the town and hold stone, ore and gem nodes guarded by **slimes**. A **cave system connects the beach to the mountain area**, and combat is a hammer bonk. Side quests include "Tracking Down Tia", a rescue in the Mines (https://littlerocketlab.wiki.gg/wiki/Mines , https://littlerocketlab.wiki.gg/wiki/Side_Quests).
- **Relevance:** LRL already pairs a cozy surface hub (town and factory) with a dangerous underground (mines). That maps directly onto Motherload's surface (shops) and underground (dig).

### 1.5 UI and feedback
- **Good:** build placement is grid-based, belts and parts rotate with buttons, there are "smart snapping tools and compassionate placement options", the quest journal can be pinned on screen, and text is large and legible on Switch (search summaries of Gert Lush, Loot Level Chill, PlayDay reviews).
- **Criticisms to avoid:** "belt placement being awkward and item selection feeling too precise", and "when the game wants you to think big, the small controls should disappear but sometimes they don't" (https://lootlevelchill.com/reviews/little-rocket-lab-review/ via search summary). **Lesson for touch:** use drag-to-paint belts, generous hit areas, a context-hiding HUD in build mode, and a zoomed-out planning view.
- Crafting and buildings live in Morgan's **journal** (Getting Started).

### 1.6 What HoleFactory should take from LRL, and what it should not
**Take:** a bright, warm palette; a fixed isometric camera; a visible build grid in build mode only; toy-like chibi proportions (a big-headed pod); items visibly riding belts; soft bloom; an evening tint; a cozy surface hub with a dangerous underground; and low punishment in factory play (keep the tension in the dig, where Motherload put it).
**Do not take:** a pixel-perfect sprite pipeline (it doesn't fit our 3D camera blend), cramped controls, or tiny tap targets.

---

## 2. Adjacent references: what to borrow

| Game | Camera / projection | Look | Borrow for HoleFactory | Source |
|---|---|---|---|---|
| **Shapez 2** (tobspr) | 3D; "sticky" camera snaps to **30° (isometric look) or 45°** | Started from a **Mini Motorways-like** look: limited geometry, desaturated palette, *no metallic objects, reflections or bevels*. Uses LODs. | Its four pillars: **readability (tell buildings apart at ~30 m), building uniqueness, uniformity, "coolness"**. **No black-box machines**: you can see what a machine does. Colorblind scheme that adds texture. | https://steamcommunity.com/games/1318690/announcements/detail/3821928016070944259 , https://shapez2.wiki.gg/wiki/Style_Guide , https://www.ngohq.com/2026/04/23/shapez-2-review/ |
| **Builderment** (iOS/Android) | Top-down 3D (exact angle unverified) | Low-poly, "oddly relaxing"; satisfying robot arms moving in unison | Mobile UX: **long-press multi-select tool** (mass upgrade, copy, rotate), **double-tap a belt to select its whole path**, **automatic underground-belt placement while dragging**, **larger belt arrows** | https://toucharcade.com/2021/06/11/toucharcade-game-of-the-week-builderment/ , https://apps.apple.com/us/app/builderment/id1558592038 |
| **Dorfromantik** | Perspective, tilted iso-like, free rotate | Low-poly hex tiles + **hand-drawn textures**, cozy palettes you unlock | Unlockable palettes; a pleasing zoomed-out diorama shot | https://therefinedgeek.com.au/index.php/2022/08/05/dorfromantik-hexagonal-biomes/ |
| **Townscaper** | Perspective, orbit | Pastel colours with **soft outlines**, strong AO; outline trick of "every odd pixel is a line" texture mapping | Soft coloured outlines; AO-heavy look; WebGL recreation exists | https://reindernijhoff.net/2021/11/townscapers-rendering-style-in-webgl/ |
| **Islanders** | Perspective, free | Minimalist low-poly, flat colour, colourful biomes | Value-driven readability with almost no texture | https://en.wikipedia.org/wiki/Islanders_(video_game) |
| **Mini Motorways** | Near top-down | White/flat block colour; colour-coded destinations; **per-city palettes**; colorblind mode | Colour = function (role colours); one palette per depth band | https://toucharcade.com/2019/09/30/apple-arcade-mini-motorways-review/ |
| **Deep Rock Galactic: Survivor** | Top-down / isometric 3D | DRG's low-poly cave look; **destructible terrain** mined with a pickaxe | The closest 3D reference for **readable mining from above**: ore glints and lit caves | https://en.wikipedia.org/wiki/Deep_Rock_Galactic:_Survivor , https://gameguidespro.com/deep-rock-galactic-survivor-review/ |
| **Monument Valley** | **Orthographic, fixed 30° axonometric**, Unity | **Flat-shaded, untextured low-poly + pre-baked AO**; a new palette per level | Proof that flat colour + baked AO + ortho looks premium on iPhone | https://www.kodeco.com/13582558-how-to-make-a-game-like-monument-valley , https://www.blendernation.com/2015/02/09/behind-the-scenes-isometric-illusion/ |
| **Ooblets** | 3D third-person | Vivid, bold low-poly; simple friendly faces; colour and negative space carry the detail | Pod and NPC charm: simple faces/lights, bold colour | https://www.sanderverdickt.com/ooblets |
| **Tiny Glade** | Perspective | Painterly, soft rounded shapes, warm light, **real-time GI via software ray tracing** (custom Bevy/Vulkan) | Mood target only. The GI is far beyond a mobile-web budget, so fake it with warm hemisphere + AO. | https://en.wikipedia.org/wiki/Tiny_Glade , https://news.ycombinator.com/item?id=42191172 |
| **Dome Keeper** (Godot) | 2D side view | Pixel art; muted alien palettes; rock hardness varies (multiple hits) | Side-view dig feedback: **hardness = more hits/longer drill**; palette per planet | https://godotengine.org/showcase/dome-keeper/ , https://www.pcgamer.com/dome-keeper-review/ |
| **SteamWorld Dig** | 2D side view | Lantern **light radius shrinks over time**; going dark forces a return to the surface | Our underground "light bubble" around the pod (optionally tied to an upgrade) | https://steamcommunity.com/sharedfiles/filedetails/?id=249930731 |
| **Motherload / Super Motherload** | 2D side view | Original 2004 Flash; Super Motherload (2013) is a painted 2D remake | Gameplay ground truth: lava from about −3,000 ft, gas from about −4,750 ft, the final area below −7,300 ft | https://motherload.fandom.com/wiki/Motherload , https://en.wikipedia.org/wiki/Super_Motherload |

**Synthesis:** take **Shapez 2's readability rules**, **Monument Valley's ortho + flat + baked AO**, **Mini Motorways' colour-as-function**, **Builderment's touch UX**, **SteamWorld Dig's light bubble**, and **LRL's warmth, chibi proportions and bloom**.

---

## 3. World model: the "Diorama Cutaway"

Motherload works because it is a **side-view cross-section**: you see what is below you. A fully 3D voxel underground breaks that (occlusion, a 3-axis dig, harder touch control). So:

1. **The mine is a 2D grid (X = horizontal, Y = depth)**, identical to Motherload in gameplay. It is rendered as 1-unit 3D blocks whose **front faces sit on the gameplay plane (z = 0)**.
2. **Behind every cell there is a non-interactive "back wall"** (z = −1, darker, AO-shaded). A dug cell becomes a **recessed hole**. You see the tunnel floor, ceiling and side faces of the neighbouring blocks, which reads as real 3D depth at near-zero cost.
3. **The surface is a 3D plateau (X × Z)** extending *behind* the cut face, for example 48 wide × 24 deep tiles. The Motherload buildings (fuel station, mineral processor, upgrade shop, item shop, save point) and the Factorio-style factory both live here. The mine shaft opens on the plateau's front edge.
4. **Underground logistics live in the dig plane:** horizontal belts in tunnels, **vertical bucket-elevator lifts** in shafts, pumps, lamps and small machines in excavated cells. These are all in-plane, so touch placement is 2D and unambiguous.
5. Seen whole, it is a **cutaway diorama / ant farm** (Townscaper and LRL coziness), which also makes a strong App Store hero shot.

---

## 4. Camera specification

**Projection: orthographic.**
- Tile size is constant on screen, so touch targets don't change with depth or position.
- No perspective distortion on long belts.
- Pixel snapping works, which the Pixel Lab filter needs.
- Matches the iso pixel-art read of LRL and the ortho/30° look of Monument Valley.

**Angle reference:**
- True isometric pitch is **35.264°** (arcsin(tan 30°)) with yaw 45° (https://en.wikipedia.org/wiki/Isometric_projection , https://gist.github.com/nitaku/032c1724a0433ae0f85f).
- Pixel-art "2:1 isometric" corresponds to **pitch 30°**, because the diamond's height/width = sin(pitch) = 0.5 (derived).
- Shapez 2 snaps to 30°/45° (Shapez 2 wiki changelog).

| Mode | Yaw | Pitch | Default view width (world units across 375 pt portrait) | Zoom range | Notes |
|---|---|---|---|---|---|
| **Surface (play)** | 45° | 35° | 10 (1 unit ≈ 37.5 pt; ground diamond ≈ 53 × 30 pt) | 6 – 22 | Classic LRL-like iso. Optional 90° rotation snaps (4 views) on two-finger twist; off by default. |
| **Surface (build mode)** | 45° | **55°** | same | 6 – 22 | Tween 250 ms easeOutCubic on entering build mode. A steeper pitch shows belt tops and items between tall machines; the grid overlay appears. |
| **Underground** | **20°** | **20°** | 9 (1 unit ≈ 41.7 pt) | 7 – 13 | The cut face reads almost frontally, so left/right on the joystick = left/right on screen. Side and top faces of blocks still show 3D depth. |
| **Overview / map** | 45° | 60° | up to 40 | — | Pinch out past max to snap into a stylised map (optional). |

**Surface ↔ underground blend:** with `d` = pod depth in rows below the surface line, `t = smoothstep(0, 4, d)`:
- `yaw = lerp(45°, 20°, t)`
- `pitch = lerp(35°, 20°, t)`
- `width = lerp(10, 9, t)`

Because the blend is driven by **position, not time**, flying up and down scrubs it continuously and reversibly, so it never "snaps". **Prototype both this blend and a fixed single camera (yaw 30°, pitch 28°)** and choose by playtest. Expose all values as debug sliders.

**Follow behaviour:**
- Critically damped spring, ω ≈ 8 rad/s.
- Look-ahead of 1.5 units in the movement direction.
- **While digging down, keep the pod about 35–38% from the top of the screen** so roughly 12 rows below are visible versus 7 above (Motherload's "see what's coming" rule).
- When flying up, shift to about 60% from the top.

**Zoom invariance:** keep **points-per-world-unit** constant when rotating between portrait and landscape. Landscape simply shows more width; it doesn't shrink the tiles.

**Portrait first:** the vertical shaft suits a tall phone screen. Landscape is supported mainly for factory building on the surface.

---

## 5. Scale and grid
- **1 tile = 1 world unit.** If HoleFactory keeps Motherload's feet readout, a working convention is **1 row ≈ 12.5 ft**, so −7,300 ft ≈ 584 rows **(unverified Motherload convention; the gameplay brief should confirm)**.
- **Pod:** about 0.86 W × 0.78 H × 0.8 D units, fitting a 1-tile tunnel with visible clearance. Chibi proportions: an oversized cockpit dome (0.46 radius), a big drill cone (0.4 long).
- **Belt:** 1 tile wide, deck height 0.12. **Items** about 0.32 units, so 3–4 are visible per tile at full belt.
- **Machines:** surface footprints of 1×1 (poles, lamps), 2×2 (smelter, assembler, auto-drill) and 3×3 (refinery, launch pad, sell depot). Underground machines max out at 1×2 / 2×2 cells.
- **Build grid:** shown only in build mode. Lines are 1 px white at 18% opacity. Ground tiles use a **±4% value checker** (#E2804F / #D97748) so the grid stays faintly readable even with lines off.
- **Silhouette rule (from Shapez 2):** every placeable building needs a silhouette and roof colour that is **unique at the default zoom**. Test by rendering all buildings as flat black silhouettes at 10 units view width; each must be identifiable.

---

## 6. Palette (hex)

### 6.1 Surface, Mars daytime
| Token | Hex | Use |
|---|---|---|
| `sky.top` | `#F2B58E` | screen-space background gradient (top) |
| `sky.bottom` | `#FADCC0` | horizon haze |
| `sky.sunsetHalo` | `#8EC0EC` | dusk halo around the sun. Mars sunsets really are blue: fine dust forward-scatters blue light near the sun while the sky stays butterscotch (https://www.jpl.nasa.gov/news/nasas-curiosity-rover-views-serene-sundown-on-mars/ , https://www.science.org/content/article/watch-curiosity-rover-records-blue-sunset-mars) |
| `sky.nightTop` / `sky.nightLow` | `#261E3D` / `#4A3763` | night gradient (optional day–night cycle) |
| `ground.top` / `ground.topAlt` | `#E2804F` / `#D97748` | regolith top faces, grid checker |
| `ground.side` | `#B85A37` | cliff and plateau side faces |
| `ground.shadow` | `#7E3A33` | shadowed ground (hue-shifted toward plum) |
| `dust.light` | `#F4B07F` | dust particles, rim highlights |
| `rock.lit` / `rock.dark` | `#A8553E` / `#6B2F2C` | boulders and decor rocks |
| `crater.rim` | `#C96A43` | crater decals |
| `frost` | `#EAF4F7` | optional frost patches and polar decor |
| `light.sun` | `#FFE3C4` | directional light colour |
| `light.hemiSky` / `light.hemiGround` | `#F7CDAA` / `#7E3A33` | hemisphere light |
| `shadow.tint` | `#5B3A66` | toon-ramp shadow tint (35% blend) |

### 6.2 Underground strata (shift with depth)
Depth bands are anchored to Motherload's hazard and ore depths (Platinum 750 ft, Einsteinium 1,562, Emerald 2,375, Ruby 3,187, Diamond 4,000, Amazonite 4,812; lava from about −3,000 ft, gas from about −4,750 ft, final area below −7,300 ft; https://motherload.fandom.com/wiki/Minerals , https://motherload.fandom.com/wiki/Motherload).

| Band | Depth (ft) | Front face | Side/top face | Back wall | Accent / cracks | Ambient tint |
|---|---|---|---|---|---|---|
| B0 Rust Regolith | 0 – 250 | `#D9774A` | `#B35A36` | `#7A3A2C` | `#F0A070` | `#C9805E` |
| B1 Ochre Sandstone | 250 – 1,000 | `#C98A4B` | `#9E6535` | `#6A4128` | `#E7B677` | `#A57A50` |
| B2 Iron Clay | 1,000 – 2,000 | `#A44B3B` | `#7C342C` | `#4F2321` | `#D07158` | `#7D4038` |
| B3 Violet Shale | 2,000 – 3,000 | `#74506F` | `#553A54` | `#36243A` | `#A07AA0` | `#5A4060` |
| B4 Blue Basalt (lava starts) | 3,000 – 4,500 | `#46557A` | `#333F5E` | `#1F263D` | `#7486B5` | `#3A4565` |
| B5 Obsidian Deep (gas starts) | 4,500 – 6,000 | `#2F2840` | `#221C30` | `#15111F` | `#5E4F80` | `#2A2238` |
| B6 Magma Mantle | 6,000 – 7,300 | `#4A2026` | `#34161C` | `#1E0B10` | `#FF6A2B` (emissive veins) | `#4A1E1A` |
| B7 Core (boss) | < −7,300 | `#24101A` | `#1A0B12` | `#12070C` | `#FF2E55` (emissive) | `#3A0E18` |

Implementation notes:
- Band boundaries are **wavy and dithered** across 3–6 rows (1D noise on X), not straight lines.
- Each cell gets a deterministic hue jitter of ±3% and a value jitter of ±5%, seeded by `hash(x, y)`.
- The palette goes warm to cool to hot, so depth is **readable from colour alone** and the deep zone is visually "hellish", in keeping with Mr. Natas.

**Special blocks:**
- Boulder (undrillable): `#6A6370` face / `#4D4754` side / `#8E8796` chamfer highlight. Use the lighter set `#8B8496` in B4–B7 so it stays visible.
- Lava: core `#FFB238`, mid `#FF6A1A`, crust `#7A1E10`; emissive 1.5–2.5, UV-scrolled noise.
- Gas pocket: invisible by default, as in Motherload (unverified). An optional scanner upgrade reveals a `#B8E34A` shimmer at 20% alpha.
- Map edge / bedrock: `#1A1420`.

### 6.3 Ores and artifacts: colour **and** shape coded
| Ore (Motherload name) | Colour | Emissive (0–1) | Silhouette (accessibility) |
|---|---|---|---|
| Ironium | `#8C8F9A` + rust flecks `#C0683E` | 0 | clustered cubes |
| Bronzium | `#D9822B` | 0 | rounded nuggets |
| Silverium | `#E3E8EE` | 0.05 | flat flakes/plates |
| Goldium | `#FFC53D` | 0.15 | fat nuggets + sparkle |
| Platinum | `#B9D3EA` | 0.20 | hexagonal prisms |
| Einsteinium | `#7CFF6B` | 0.9, pulsing 0.8 Hz | glowing capsules/rods |
| Emerald | `#1ED18A` | 0.40 | long hex prisms |
| Ruby | `#FF3B5C` | 0.45 | faceted rhombic gems |
| Diamond | `#E8FCFF` | 0.60 + prism sparkle | octahedra |
| Amazonite | `#3FE0D0` | 0.70 | tall rhombic crystals |
| Artifacts (bones, treasure, relics) | `#F2E6C9` / `#FFD66B` | 0.20 | unique hand-made props |

Emissive rises with value and depth, so **deep ores act as beacons in the dark**. Colorblind check: Emerald, Einsteinium and Amazonite have similar hues, so they must differ by luminance **and** silhouette, and the cargo UI must show shape icons.

### 6.4 Factory role colours (Mini Motorways / Shapez 2 "colour = function")
All machines share a **cream body `#EDE3D2`** with **plum-grey trims `#4A3F55`**, which pop against rust ground. The roof and accents carry the **role colour**:

| Role | Colour | Examples |
|---|---|---|
| Logistics | Mustard `#F6C343`; belt deck `#3A3346`; chevrons `#FFE9A8` | belts, lifts, splitters, undergrounds |
| Extraction | Orange `#FF7A3D` | auto-drills, pumps |
| Processing | Coral `#FF5A4E` + furnace mouth `#FFB238` (emissive) | smelters, refiners |
| Assembly | Teal `#2EC4B6` | assemblers, fabricators |
| Power | Electric blue `#4DA8FF`; cables `#2B2B3A` | generators, poles, batteries |
| Storage / Market | Lilac `#9B7BFF` | silos, sell depot |
| Player pod | White `#F4F1EA`, visor `#46E0D2` (emissive 0.3), accent `#FF7A3D` | pod + upgrades |

### 6.5 UI palette (with computed WCAG contrast)
| Token | Hex | Note |
|---|---|---|
| `ui.panel` | `#FFF6E9` | cream |
| `ui.panelLip` | `#E6D3BA` | 4-pt bottom "lip" |
| `ui.ink` | `#2B1E2F` | text on cream ≈ **14.7:1** |
| `ui.inkSoft` | `#6B5A6E` | secondary text |
| `ui.primary` | `#2EC4B6` | use **ink** text (≈ 7.3:1) |
| `ui.primaryDeep` | `#0F7A71` | use **white** text (≈ 5.2:1). White on `#2EC4B6` fails AA. |
| `ui.warn` | `#FF7A3D` | ink text ≈ 6.1:1 |
| `ui.danger` | `#FF4D5E` | hull critical |
| `ui.money` | `#FFC845` | cash |
| `ui.fuel` | `#FFB020` → `#FF4D5E` when < 20% | fuel gauge |
| `ui.hull` | `#3DDC84` → `#FF4D5E` | hull gauge |
| `ui.cargo` | `#9B7BFF` | cargo |
| `ui.scrim` | `rgba(43,30,47,0.55)` | modal backdrop |

---

## 7. Materials and shading

1. **One material for (almost) everything:** an unlit-base custom toon shader that reads **vertex colours**. These come either from a procedural palette lookup or from a **single 256×256 palette atlas** that UV-indexes swatches, which is compatible with how Kenney (single colormap) and KayKit (single 1024² gradient atlas, downsample to 128²) texture their kits (https://kenney.nl/assets/conveyor-kit , https://kaylousberg.itch.io/space-base-bits). Benefits: instancing and batching, tiny memory use, and palette swaps per band or season.
2. **Flat shading:** faceted normals (non-indexed geometry, or `flatShading`) for the low-poly read, as in Monument Valley and Islanders.
3. **Toon ramp, 3 steps:** `NdotL` thresholds at 0.0 and 0.45, with values shadow 0.62, mid 0.84, lit 1.0. Smooth each edge over 0.04 so it doesn't alias on phones. The shadow step is multiplied toward `#5B3A66` at 35% (**hue-shifted shadows**, the cozy look). three.js `MeshToonMaterial` + `gradientMap` covers this out of the box; a TSL node material gives the same result with WebGL2/WebGPU parity.
4. **Ambient occlusion:**
   - Terrain uses **per-vertex voxel AO** (the 0fps algorithm: 3 neighbours per vertex, 4 levels mapped to brightness 1.0 / 0.82 / 0.68 / 0.55), computed when a chunk is meshed (https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/). This is the biggest readability win per millisecond.
   - Kit meshes get AO baked into vertex colours offline (Blender), like Monument Valley's pre-baked AO.
   - Each machine and unit gets a soft contact-shadow decal.
5. **Outlines:**
   - **Inverted-hull** on the pod, machines, ores, NPCs and selected/ghost objects only. Extrude in clip space for a constant **1.5 px at DPR 1** (scaled by DPR). Colour = base × 0.35, shifted toward plum, never pure black (LRL/Townscaper soft outlines).
   - **Terrain gets no outlines.** Instead, a 0.04-unit chamfer on block top edges, tinted 8% lighter, gives the convex-edge highlight in the t3ssel8r style (https://www.davidhol.land/articles/3d-pixel-art-rendering/).
   - High tier only: an optional **depth+normal edge-detect post pass**, mandatory in Pixel Lab mode.
6. **Emissive:** ores (table above), lava, furnace mouths, cockpit visor, machine status LEDs and thruster flames. On low/mid tier, emissive objects get **additive billboard halo sprites** (fake bloom). High tier adds real bloom (§8.4).
7. **Belts:** a UV-scrolling chevron strip (no per-frame geometry), with scroll speed tied to belt throughput. Items are an **InstancedMesh** per item type.
8. **Glass/metal:** no PBR metalness or reflections (a Shapez 2 rule). Glass is a flat teal colour with a single fixed white specular "sticker" quad.

---

## 8. Lighting

### 8.1 Surface
- **Directional sun:** `#FFE3C4`, relative intensity 1.0, from screen-upper-left behind the camera (azimuth camera-yaw + 135°, elevation 50°), so shadows fall toward lower-right and never hide the pod's front.
- **Hemisphere:** sky `#F7CDAA`, ground `#7E3A33`, intensity 0.55.
- **Shadows:** one shadow map with an ortho frustum fitted to the visible area (about 24×24 units). **1024² on mid tier, 2048² on high**, PCF 3×3. On **low tier**, blob shadows only (radial decal, alpha 0.35, colour `#3B2233`).
- **Optional day–night cycle** (LRL has evenings), e.g. a 12-minute loop:
  - Dusk: sun `#FFB27A` at 0.7, a blue halo `#8EC0EC` in the sky gradient near the sun's screen position.
  - Night: sun off, hemisphere `#4A3763`/`#261E3D` at 0.35, factory lamps and machine LEDs carry the scene (a cozy night factory).

### 8.2 Underground: darkness with depth
The sun fades to 0 between rows 0 and 6. Terrain is shaded by a **custom "light bubble" shader**, not real lights:

```
light(p) = A(depth) + (1 - A(depth)) * max(bubble(p), lamps(p))
bubble(p) = 0.95 * (1 - smoothstep(0.35R, R, |p - pod|))
          + 0.6  * cone(p, podFacing, 40°, 7 rows)   // headlight
lamps(p)  = Σ_i≤16  colour_i * (1 - smoothstep(0.3r_i, r_i, |p - lamp_i|))
```

| Depth (ft) | 0 | 50 | 250 | 1,000 | 2,000 | 3,000 | 4,500 | 6,000 | 7,300 |
|---|---|---|---|---|---|---|---|---|---|
| Ambient `A` | 1.00 | 0.80 | 0.55 | 0.38 | 0.28 | 0.22 | 0.17 | 0.14 | 0.12 |

- **Pod bubble radius `R`:** 4.5 rows base. An optional "Headlight" upgrade adds 0.75 per level (SteamWorld Dig precedent; a design decision, not in Motherload).
- **Placed lamps** (a factory item): r = 3.5, `#FFD9A0`. Placing them along shafts gives the factory a visible, cozy reason to exist underground.
- **Lava cells:** r = 2, `#FF7A2E`.
- **Working machines:** r = 1.5 in their role colour.
- **Never fully black:** the 0.12 floor, plus an accessibility setting **"Bright Mines"** that raises the floor to 0.35.
- The back wall gets an extra ×0.75 (fake depth fog), so tunnels read as recessed.

### 8.3 Light budget
- One real shadow-casting light on the surface; zero underground.
- Up to **16 shader lamps** (uniform array, CPU-sorted by distance to the camera).
- The pod's light is a uniform. Real `SpotLight`s are only for cinematic moments on high tier.

### 8.4 Post
- **High tier:** bloom at half resolution, threshold 0.85, strength 0.6, radius 0.4, plus a 15% vignette that gets stronger underground (up to 30%).
- **Low/mid:** no full-screen passes beyond the final blit. Use a CSS/HTML vignette overlay and halo sprites instead.

---

## 9. VFX catalogue (mobile budgets)
**Global live-particle cap:** low tier 250, mid 500, high 900.

Pools:
- One `InstancedMesh` for **chunk debris** (cubes, max 128).
- One instanced billboard batch for **soft sprites** (dust, smoke, steam, halos; max 384), using Kenney Particle Pack textures (CC0, 80 sprites; https://kenney.nl/assets/particle-pack).
- One batch of stretched additive quads for **sparks** (max 96).

| Effect | Trigger | Look | Numbers |
|---|---|---|---|
| Drill debris | while drilling | tiny cubes in the **current band's face/side colours**, ballistic, one bounce, shrink-fade | 10–14/s, life 0.6 s, size 0.06–0.12 |
| Drill dust | while drilling | soft puffs tinted with the band ambient colour, alpha 0.5→0 | 4/s, life 0.8 s, grow 1→2.2× |
| Sparks | hard rock, boulder hits, hull damage | additive `#FFE07A`→`#FF8A3D` streaks | burst 10–20, life 0.25 s |
| Block break | cell cleared | 6 larger chunks + 1 dust ring | — |
| Ore pop and suction | ore collected | gem pops out (scale 0→1.2→1, 120 ms), arcs to the pod with a trail in the ore colour, HUD cargo bumps "+1" | 0.35 s flight |
| Thruster | flying up | two stacked cones, additive, flicker scale ±12% at 20 Hz, `#FFD36B` core → `#FF6A2B` tip; smoke puffs on take-off | — |
| Landing | ground contact | dust ring + squash (§10) | 8 puffs |
| Lava glow | lava cells | emissive UV-scrolled noise; embers rising `#FF8A3D` | 1 ember/s per visible lava cell, max 24 |
| Lava contact | damage | orange flash, steam puffs `#FFF6EE` | — |
| Gas explosion | gas pocket | `#C8FF4D` flash + expanding ring + 0.3 s shake (amplitude 0.25 units) | — |
| Smelter smoke/steam | machine working | chimney puffs `#FFF6EE`→transparent, drift with wind | 1.5/s per visible machine, LOD off when > 12 machines |
| Assembler | working | arm swing + small spark pips | — |
| Sell burst | selling at the depot | `$` coins burst in `#FFC845`, counter roll-up | 12 coins |
| Low fuel | < 20% | HUD pulse + red screen-edge vignette pulse at 1 Hz | — |
| Hull hit | damage | white flash on the pod (80 ms), **50 ms hit-stop**, shake scaled by damage | — |
| Dust storm (optional) | surface weather | full-screen orange haze + streak sprites, visibility 70% | — |

---

## 10. Animation style ("bouncy toy")
| Element | Motion | Numbers |
|---|---|---|
| Pod landing | squash, then spring back | scaleY 0.85 / scaleXZ 1.1 → 1.0 over 180 ms (spring ζ 0.45) |
| Pod thrust | stretch | scaleY 1.06, scaleXZ 0.97 while thrusting |
| Pod tilt | lean into movement | ±8° roll toward the horizontal velocity, 120 ms ease |
| Drilling | vibration + drill spin | position jitter ±0.02 at 30 Hz; drill cone rotates 12 rev/s |
| Idle pod | breathing bob + antenna light | ±0.03 units at 0.6 Hz; antenna LED blinks every 2 s |
| Working machine | "breathing" | uniform scale pulse 1.00↔1.03 at 1–2 Hz; LEDs on; chimney puffs |
| Idle/starved machine | still | LEDs amber; status bubble icon (no power / no input / output full) |
| Build placement | pop-in | scale 0 → 1.15 → 1.0 over 250 ms (easeOutBack) + dust ring |
| Deconstruct | shrink + poof | 1.0 → 0 over 180 ms + 6 puffs |
| Belt items | slight bob | ±0.01 at 4 Hz, phase offset by item index |
| Lift buckets | chain loop | bucket spacing 0.5 units; speed = throughput |
| UI buttons | press | translateY 3 pt + lip 4 → 1 pt, 60 ms; release with an overshoot spring |
| Number pops | float + fade | rise 24 pt over 600 ms; outline 2 pt `#2B1E2F` |

General rules:
- Ease with springs or easeOutBack.
- Avoid linear motion except for belts.
- **Reduced Motion** (`prefers-reduced-motion`) disables shake, squash and hit-stop.

---

## 11. UI style (375-pt portrait first)

**Principles:**
- Chunky and rounded, like toy buttons.
- Everything a thumb can reach sits in the bottom 45% of the screen.
- **Hit targets ≥ 44×44 pt** (Apple HIG; https://knowledge.evinced.com/mobile-validations/tappable-area). Primary actions 56–72 pt.
- Respect `env(safe-area-inset-*)`: about 47–59 pt top on Dynamic Island phones and 34 pt bottom for the home indicator (exact insets per device, unverified).

**Shapes:**
- Corner radius: cards 16 pt, sheets 24 pt, pills 999 pt.
- Border: 2 pt in a 20% darker shade of the fill.
- Raised **4-pt lip** under every button and panel; on press, the lip shrinks to 1 pt and the face moves down 3 pt.

**Type** (Google Fonts, SIL OFL 1.1, self-hosted):
| Style | Font | Size/line |
|---|---|---|
| Display (sell totals, titles) | Fredoka SemiBold | 28/32 |
| Title | Fredoka Medium | 20/24 |
| HUD numbers | Fredoka SemiBold, tabular digits (check `tnum` support; otherwise use fixed-width digit spans) | 18–22 |
| Body | Nunito Bold | 15/20 |
| Caption (non-critical only) | Nunito ExtraBold | 12/16 |

**Portrait layout, 375 × 812 pt:**
```
┌───────────────────────────────────────┐  ← safe-area top
│ [⛽■■■■■□□] [🛡■■■■■■■]   $12,450  ▼1,250ft│  HUD bar, 48 pt, cream pills
│ [cargo 7/12 ◆◆◆◇]               [⚙] [⏸]│  secondary row, 36 pt
│                                       │
│            (world view)                │
│      pod kept ~36% from the top        │
│                                       │
│  status bubbles float over machines    │  constant 28–32 pt screen size
│                                       │
│ ┌─────┐                    [ITEM 52]   │
│ │ ◯   │  floating joystick  [ BUILD 56]│  control zone ~190 pt
│ │stick│  r = 52 pt, knob 28 │ THRUST  │
│ └─────┘  dead-zone 8 pt     │  72 pt  │
└───────────────────────────────────────┘  ← home-indicator inset 34 pt
```

**Controls:**
- The joystick is **floating**: it appears where the left thumb lands, anywhere in the left 55%.
- An alternative scheme should be tested: tap-and-hold an adjacent tile to drill toward it.

**Build mode:**
- The HUD collapses to cash only (fixing LRL's "controls should disappear" problem).
- A bottom **hotbar** of 64-pt cards in a horizontal scroll, organised by category tabs (Logistics, Extraction, Processing, Assembly, Power, Storage).
- A **bottom sheet** with detents at 50% and 92% for the full catalogue, cards 72×88 pt with **3D-rendered item icons** (rendered at runtime from the actual models so icons match the world).
- **Drag-to-paint belts** with auto-underground (Builderment).
- **Double-tap a belt to select its path**; **long-press for multi-select** (Builderment).
- A ghost preview offset **48 pt above the finger** so the thumb never covers the placement; a rotate button (48 pt) next to the ghost.
- The camera pitches to 55° and the grid appears.

**Shops** (Motherload's fuel / process / upgrade / items):
- Full-height sheets with large product cards.
- Upgrades show a **3D pod preview** that rotates and swaps parts live.
- Each upgrade tier changes the pod's look (drill material/colour, hull plates, tank size, radiator fins, cargo pod size). The six Motherload part types are drill, hull, engine, fuel tank, radiator and cargo bay (https://www.mobygames.com/game/36620/motherload/).

**Icons:**
- Prefer runtime-rendered 3D icons.
- Kenney *Game Icons* / UI packs are CC0.
- game-icons.net offers 4,180 SVGs but under **CC BY 3.0, so attribution is required** (https://game-icons.net/about.html).

**Haptics:**
- **iOS Safari does not implement `navigator.vibrate`** (https://github.com/web-platform-tests/interop/issues/837 and search summaries).
- Feedback must therefore be visual and audio. Add native haptics only if wrapped as an app (e.g. Capacitor Haptics, unverified API).

---

## 12. Optional "Pixel Lab" filter (direct LRL homage)
- Render the 3D scene to a **low-res target** (e.g. ~270 px wide in portrait, so 1 tile ≈ 30 px, about LRL density).
- Run a **1-px depth+normal outline** at that resolution, then **nearest-neighbour upscale** to the screen.
- **Snap the ortho camera to the texel grid** so edges don't shimmer.
- Use a **sharp-bilinear** upscale to avoid uneven pixel sizes on non-integer DPRs.
- The UI stays crisp in HTML/CSS.
- This is the t3ssel8r technique (https://www.davidhol.land/articles/3d-pixel-art-rendering/ , https://brunich.itch.io/3d-pixel-art-shadergame-kit-t3ssel8r-style-renderer).
- **Bonus:** it is *cheaper* than full-res rendering on phones, so it could even be the default on low-tier devices.
- **Caveat:** the surface↔underground camera rotation causes pixel "crawl" in this mode. Hide it by quantising yaw in 2.5° steps during the blend, or fade in a dither.
- **Decision for the user:** clean low-poly toon (default) or Pixel Lab, or ship both as a setting.

---

## 13. Performance budgets and quality tiers
| | Low (e.g. iPhone 8/XR/SE2, older Android) | Mid (iPhone 11–13 class) | High (A16+/recent flagships) |
|---|---|---|---|
| Render scale (DPR cap) | 1.0–1.25 (or Pixel Lab) | 1.5 | 2.0 |
| Shadows | blob only | 1024² surface | 2048² surface |
| Bloom | halo sprites | halo sprites | real bloom, half-res |
| Outlines | pod + selected only | inverted hull | inverted hull + optional post edges |
| Particles cap | 250 | 500 | 900 |
| Target fps | 60, with a 30 battery mode | 60 | 60 (120 where the browser allows, unverified for iOS Safari) |

**Budgets:**
- ≤ 120 draw calls typical, ≤ 200 max.
- ≤ 150k visible triangles.
- ≤ 64 MB GPU textures.

**Terrain:**
- Chunked meshes of 16×16 cells with **hidden-face culling** and vertex AO; re-mesh only the dirty chunk on dig (≤ 256 cells, under 1 ms target).
- Only 2–4 chunks are visible underground.

**Instancing:**
- Belts, items and ores use `InstancedMesh`; static kit props use `BatchedMesh` or merged geometry per chunk.

**Renderer:**
- three.js `WebGPURenderer` (production-ready since r171, with automatic WebGL2 fallback; shaders written in **TSL** compile to WGSL or GLSL; https://threejs.org/manual/en/webgpurenderer.html , https://www.utsubo.com/blog/threejs-2026-what-changed).
- Safari 26 shipped WebGPU on iOS/iPadOS 26 in Sept 2025 (https://webkit.org/blog/17333/webkit-features-in-safari-26-0/). **Treat WebGL2 as the baseline**, because older iOS versions remain common.

**Thermals:**
- Offer a 30-fps battery mode.
- Throttle particles and machine animation when the tab is backgrounded, and when there are more than 40 visible machines (LOD: stop the breathing animation, keep LEDs).

---

## 14. CC0 and permissive asset sources (specific packs)

| Source | Pack | Contents useful to HoleFactory | License |
|---|---|---|---|
| **Kenney** | **Conveyor Kit** (v2.2, 90 assets) | belts, rollers, factory/warehouse pieces; single colormap texture | **CC0** — https://kenney.nl/assets/conveyor-kit |
| Kenney | **Factory Kit** (140+ assets) | conveyors, industrial machines, warehouse items, animation and colour variants | **CC0** — https://kenney.nl/assets/factory-kit |
| Kenney | **Space Kit** (150+ assets, 2020) | spaceport buildings, **rocks, ores**, ships, characters | **CC0** — https://kenney.nl/assets/space-kit |
| Kenney | **Space Station Kit** (90 assets) | modular sci-fi interiors (shop interiors, lifts) | **CC0** — https://kenney.nl/assets/space-station-kit |
| Kenney | **Modular Space Kit** (40 objects, some animated) | sci-fi segments | **CC0** — https://kenney.nl/assets/modular-space-kit |
| Kenney | **City Kit (Industrial)** (2025, 40 files) | industrial buildings, chimneys, tanks | **CC0** — https://kenney.nl/assets/city-kit-industrial |
| Kenney | **Mini Characters** (12 characters, 32 animations each) | colonist NPCs and shopkeepers | **CC0** — https://kenney.nl/assets/mini-characters |
| Kenney | **Particle Pack** (80 sprites) | smoke, sparks, flares, light cookies | **CC0** — https://kenney.nl/assets/particle-pack |
| Kenney | **UI Pack – Sci-Fi** (v2.0, Aug 2024, 130 assets, 5 colours, vector + bitmap) | panels, buttons, progress bars | **CC0** — https://kenney.nl/assets/ui-pack-sci-fi |
| Kenney | Nature Kit (330+), Train Kit, Game Icons, Input Prompts, audio packs (Sci-Fi Sounds, Impact Sounds, Interface Sounds) | decor rocks, rail-style lifts, icons, SFX | **CC0** (pack names/counts beyond those cited: unverified) |
| **Quaternius** | **Ultimate Space Kit** (90+ models, Mar 2023) | **rovers**, mechs, astronauts, alien plants, planets; animated characters | **CC0** — https://quaternius.com/packs/ultimatespacekit.html , https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| Quaternius | **Sci-Fi Essentials Kit** (37 free Standard / 65 in Source) | crates, screens, robots | **CC0** — https://quaternius.com/packs/scifiessentialskit.html |
| Quaternius | **Modular Sci-Fi MegaKit** (270+ pieces; Standard free, Pro $9.99, Source $14.99) | grid-fitting walls, floors, doors, props for shop interiors and underground stations | **CC0** — https://quaternius.com/packs/modularscifimegakit.html |
| **KayKit** (Kay Lousberg) | **Space Base Bits** (48+ models; 1024² gradient atlas → 128²) | modular bases "to launch your interplanetary mining colony" | **CC0** (free tier; paid Extra/Source tiers add more) — https://kaylousberg.itch.io/space-base-bits , https://github.com/KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0 |
| KayKit | **Resource Bits** (75+ models) | wood, stone, **iron, copper, silver, gold**, fuel. These suit belt items and cargo; the Extra tier ($4.99) adds gems and containers. | **CC0** — https://kaylousberg.itch.io/resource-bits |
| KayKit | **Block Bits** (32+ free; Extra $4.99; Source $7.49) | blocky terrain for "survival-mining games" (reference for our procedural blocks) | **CC0** (don't resell unmodified) — https://kaylousberg.itch.io/block-bits |
| KayKit | Prototype Bits | greybox props | **CC0** — https://github.com/KayKit-Game-Assets/KayKit-Prototype-Bits-1.0 |
| **Poly Pizza** | aggregator (10,000+ low-poly models; includes Quaternius and Kenney mirrors; has an API) | quick lookups | **Mixed: CC0 or CC-BY 4.0 per model.** Record credits for CC-BY: "Title" by User (poly.pizza) CC-BY 4.0 — https://poly.pizza |
| **OpenGameArt** | mirrors of Kenney/Quaternius + community | — | **Mixed; filter CC0** — https://opengameart.org/content/all-cc0-uploader-kenney |
| **game-icons.net** | 4,180 SVG icons | UI icons | **CC BY 3.0 (attribution required)** — https://game-icons.net/about.html |
| **Google Fonts** | Fredoka, Nunito, Baloo 2 | UI type | **SIL OFL 1.1** (unverified per-family; check each family page) |

**Licence hygiene:**
- Keep `/assets/CREDITS.md` with pack, version, URL, licence and date.
- Stay CC0-only where possible; CC-BY must appear on an in-game credits screen.
- Never ship the raw kit `.blend`/`.fbx` files for resale.

---

## 15. Production pipeline (procedural first, kits second)
1. **Procedural in code (most of the game):**
   - Terrain blocks, back walls, strata noise and vertex AO.
   - Belts (box plus scrolling chevrons), lifts (rails plus instanced buckets), pipes (tube sweeps), poles and cables (catenary lines).
   - Ores: jittered polyhedra by type (cube, octahedron, hex-prism, capsule).
   - Rocks: icosphere plus noise, flat-shaded.
   - **Machines kitbashed from primitives**: `RoundedBoxGeometry`, cylinders, tori, cones, all in role colours. This guarantees one consistent style, minimal download and easy upgrade variants.
2. **CC0 kits for the long tail:** shop buildings, the rocket/launch pad, rovers, NPCs, decor and UI frames.
3. **Normalisation script at build time (Node + glTF-Transform):**
   - Import GLB/glTF.
   - Bake each material or atlas texel into **vertex colours**, snapped to the nearest HoleFactory palette swatch.
   - Strip textures, normals → flat, weld/dedupe, quantise.
   - **Meshopt-compress** (decoded in three.js with `MeshoptDecoder`).
   - Bake AO (optional, Blender CLI).
   - Write one `.glb` per category.
   - Exact CLI flags: unverified, check the glTF-Transform docs.
4. **Style test scene (milestone 0, before content):**
   - One surface plateau with 6 machines and belts.
   - The shaft transition.
   - 3 strata bands with ores and lava.
   - Toggles for toon vs Pixel Lab, camera A/B, and tiers.
   - Profile on an iPhone 12 (mid) and an iPhone SE2/XR (low).

---

## 16. Risks
1. **Expectation gap:** LRL is pixel art. The user said "3D isometric like LRL". **Mitigation:** show the style test in both toon and Pixel Lab modes early.
2. **Camera blend disorientation** on every trip down the shaft. **Mitigation:** blend by position, keep the yaw change ≤ 25°, and A/B test against a fixed camera.
3. **Isometric occlusion** of belts behind machines. **Mitigation:** the build-mode pitch-up, x-ray silhouettes (a stencil pass drawing hidden belts/items as a 40% overlay), and keeping machines ≤ 1.6 units tall.
4. **Dark underground on bright outdoor phone screens.** **Mitigation:** the 0.12 ambient floor, emissive ores, the "Bright Mines" setting, and a HUD that always stays cream.
5. **Colour-only coding** (ores, roles). **Mitigation:** shape coding plus icons, and a colorblind palette variant (Shapez 2 precedent).
6. **Mixed kits clashing.** **Mitigation:** a palette-snapping pipeline, our shader and outlines on everything, and a ban on kit textures.
7. **iOS thermal throttling.** **Mitigation:** tiers, the 30-fps mode, DPR caps and Pixel Lab on low tier.

## 17. Open questions for the user
1. Should HoleFactory be **clean low-poly 3D**, or **3D rendered to look like pixel art** (closer to LRL)? Or offer both?
2. **Portrait-first** (natural for digging down) or landscape-first?
3. Is the **diorama cutaway** right, with the surface factory as a plateau behind the mine face? Or should the surface base be its own screen?
4. Should underground factory pieces live only in the 2D dig plane (belts in tunnels, lifts in shafts)?
5. Should Motherload's **hidden hazards** (gas/lava) stay hidden, or get visual tells or scanner upgrades?
6. Add a **headlight / light-radius upgrade** (not in Motherload)?
7. **Tone:** keep Motherload's sinister deep-core / Mr. Natas arc (hot, red, ominous bands), or stay fully cozy?
8. **Characters:** LRL-style town NPCs, or Motherload-style shop buildings only? Day–night cycle and dust storms on the surface?
