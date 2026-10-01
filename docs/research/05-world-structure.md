# 05 — World Structure and Underground Readability (HoleFactory)

**Scope:** how 3D and isometric games keep digging and multi-level spaces readable, especially on small screens. The brief also surveys touch controls in mobile digging games. It then compares three candidate world structures for HoleFactory: (A) a diorama slice, (B) a layered voxel volume, and (C) hybrids. It ends with a recommendation and a full specification: grid sizes, chunking, render budget, camera behaviour, pod controls, and factory layout rules.

**Verification note (read first).** WebSearch was unavailable in this session because the shared search budget had run out. WebFetch was blocked by the egress proxy for almost every games site (Wikipedia, Steam, wikis, TouchArcade, PC Gamer, Game Developer, reddit, archive.org, the App Store, caniuse, MDN). Only **developer.apple.com** and **GitHub** were reachable. As a result:
- Claims with a URL marked **[V]** were checked first-hand in this session.
- Claims marked **[S0x]** come from sibling research briefs 01–03 in this folder, which checked them through web-search extracts. Their URLs are repeated in §9.
- **Every other statement about a third-party game is from my own knowledge and is marked (unverified).** The design numbers (grid sizes, budgets, camera values) are **proposals** for HoleFactory, not measurements. Performance figures are **estimates**.

---

## 0. TL;DR

**Recommendation: C1 "Diorama Slice+".** This is option A (a Motherload 2D dig plane rendered as 3D blocks with a cut face, under a 3D surface plateau) with four upgrades:
1. A **back-wall utility layer**, so lifts, chutes and tubes share shafts with the pod without blocking it. This borrows the "utility layers" idea from Oxygen Not Included.
2. A **rim road**: the Motherload surface strip, which joins the slice to the factory plateau.
3. A **multi-plane data model**, so a second "factory gallery" plane can be added in v2 without a rewrite.
4. A **2D whole-mine map texture** for an instant overview.

The full voxel volume (B) loses on every criterion except "feels 3D". It also breaks Motherload's core rule that you can see what is below you.

| Decision | Value (proposed) |
|---|---|
| Gameplay space underground | 2D grid, **48 wide × 608 rows** (x × depth), 1 tile = 12.5 ft, so the bottom is about −7,600 ft. Bedrock barrier at row 584 with a gap in the right-most column (Motherload homage [S01]); boss "Core" chamber in rows 585–607 |
| Sky | 64 rows of flight space above the rim (+800 ft), not chunked |
| Surface plateau | **48 (x) × 32 (z) buildable tiles** behind the cut face. Starts at 48 × 8 and expands in 8-row strips. A 1-tile **rim road** (z = 0) carries the four Motherload shops' service pads |
| Cell layers | Terrain (front) + in-plane occupant (machines) + **wall-mount** (lifts, chutes, tubes, lamps, shoring) + flags. About 6 bytes per cell, about 175 KB for the whole mine |
| Chunks | **16 × 16 cells** underground (3 × 38 = 114 chunks; 4–6 visible). Surface 16 × 16 (x × z), 6 chunks |
| Block depth | Solid cells span z ∈ [−1.0, +0.5] (1.5 units deep). Dug cells show the back wall at z = −1.0. Wall mounts sit in z ∈ [−1.0, −0.45]; the pod and machines in z ∈ [−0.45, +0.45] |
| Projection | Orthographic baseline. Prototype a long-lens perspective (FOV 20–30°) as an A/B option for extra parallax (§5.6) |
| Camera underground | Yaw 20°, pitch 20°, **fixed**. View width 9.5 tiles (portrait), zoom 7–13. Pod kept 36% from the top while descending, 62% while climbing |
| Camera surface | Play: yaw 45°, pitch 35°, fixed front. Build: pitch 55° with **four 90° yaw snaps** (build mode only). The two modes blend over rows 0–4 by pod depth [S02] |
| Occlusion | None possible underground (nothing sits between the camera and the dig plane). Surface: height cap 1.6 units, alpha-fade near the build cursor, an x-ray silhouette pass for belts and the pod |
| Pod controls | Floating left-thumb stick (r = 52 pt, dead zone 8 pt). **Push into rock to drill** (4-sector snap with ±10° hysteresis, 120 ms hold). Stick up = thrust. Right-thumb item buttons ≥ 56 pt. Optional one-handed "tap adjacent tile to drill" |
| Budget (underground frame) | About 25–40 draw calls, 20–60k triangles. Re-mesh on dig is 1–2 chunks of 256 cells, estimated ≤ 0.5 ms in JS |

---

## 1. The problem: why underground 3D is hard to read on a phone

1. **Rock surrounds everything you care about.** Underground, the pod, the ore and the escape shaft are all inside solid matter. Any camera that is not looking at a cut plane sees only the outside of the rock.
2. **Isometric depth ambiguity is exact.** In true isometric (yaw 45°, pitch 35.264°), one block **one level lower** lands at the *same screen position* as a block one step diagonally nearer the camera. Worked example at a 10-tile view width on a 393-pt-wide phone, where 1 unit ≈ 39.3 pt:
   - a level step moves 39.3 × cos 35.26° = **32.1 pt** down the screen;
   - a cube's top-face diamond is 55.6 × 32.1 pt.

   So each screen point is a line of candidate cells. Dwarf Fortress, Timberborn and Going Medieval all need layer slicing because of this (unverified for the specific games; the geometry is exact).
3. **Gravity has to read as "screen-down".** Motherload's tension comes from falling, fall damage, and thrusting against weight [S01]. Those only read well when world-down is screen-down. A top-down or steep isometric camera turns "down" into "into the screen", where falling is invisible.
4. **Touch picking needs one plane.** Finger input has no hover and covers the target. If a tap could mean several cells (iso stacking), every build action needs a disambiguation step.
5. **The phone's budget.** A 6.1-inch iPhone is about 393 × 852 pt (unverified per model). Apple's HIG sets a **default control size of 44 × 44 pt and a minimum of 28 × 28 pt**, with about **12 pt of padding around bezelled controls and 24 pt around bezel-less ones** [V: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json]. Game tiles must stay near 40–50 pt whenever the player interacts with them.
6. **What Motherload must always show:**
   - the pod;
   - about 12 rows below it and 7 above (the "see what's coming" rule [S02]);
   - ore and visible hazards nearby;
   - the route back up;
   - fuel against distance (HUD).

   Hidden information should be hidden only by design (gas pockets [S01]), never by the camera.

---

## 2. Technique catalogue: how games keep underground and multi-level space readable

| # | Technique | How it works | Examples (all unverified unless tagged) | Phone strengths | Phone weaknesses | Use in HoleFactory? |
|---|---|---|---|---|---|---|
| 1 | **Fixed side cross-section (2D)** | The world *is* a vertical plane. Camera looks straight at it | Motherload [S01], Super Motherload [S01], SteamWorld Dig, Dome Keeper, Dig or Die, Mines of Mars, Terraria, Oxygen Not Included, Mr. Driller | Perfect readability. Gravity = screen-down. One-plane picking | Looks flat unless rendered with depth cues | **Yes, as the gameplay model** |
| 2 | **3D-rendered cross-section ("ant farm" diorama)** | Technique 1 drawn with 3D geometry: recessed rooms, side walls visible, a slightly angled or perspective camera | Fallout Shelter (3D vault rooms in a rock face, pinch-zoom, tap/drag dwellers); Idle Miner Tycoon and Deep Town: Mining Factory (portrait vertical cross-sections with an elevator to the surface); Tiny Tower (2D cut-away tower with an elevator) | Keeps all of #1's readability and *looks* 3D. Proven on phones in portrait | Rooms must stay shallow, or side walls hide the contents | **Yes, as the presentation** |
| 3 | **Horizontal layer slicing (z-levels)** | Hide everything above a chosen height. You see a floor plan of one level; lower levels are shaded or hidden | Dwarf Fortress (classic shows one z-level; the 2022 Steam edition shades lower levels); Timberborn (a height slicer for tunnels and multi-level builds); Going Medieval (level up/down to see cellars and dug-out hills); Shapez 2 (**3 build floors joined by lifts** [S03]) | Full 3D freedom. Works when there are few layers (Shapez 2: 3) | Vertical relationships become invisible. With 600 layers it needs a "which level am I on" UI. Gravity and falling are unreadable | No for the mine. **Concept reused** as "surface vs mine" build planes |
| 4 | **Global "underground view" mode** | A toggle hides or ghosts the surface and shows tunnels, pipes and metro | Cities: Skylines, SimCity 4 | One tap, very clear for infrastructure | It is a separate *mode*, not a play view | **Yes, as the Logistics overlay** (§5.8) |
| 5 | **Section plane with solid caps** | A clip plane cuts the geometry and a stencil pass draws a solid cap where solids are cut | CAD tools; three.js example: back faces increment and front faces decrement the stencil, then a cap plane draws where stencil ≠ 0 [V: https://github.com/mrdoob/three.js/blob/dev/examples/webgl_clipping_stencil.html] | Works on any mesh at runtime | About 2 extra passes per plane, plus stencil and overdraw on mobile | Not needed: C1's meshes are **pre-cut**, so the cap is real geometry |
| 6 | **Wall and roof cutaway near the avatar** | Walls and roofs between the camera and the player are lowered, hidden or cut | The Sims (walls up / cutaway / down); Project Zomboid; Minecraft Dungeons (roofs and foreground hide when the hero goes under) | Keeps the avatar visible in 3D interiors | Popping. Needs authored wall heights | Surface only (tall buildings near the cursor fade) |
| 7 | **X-ray silhouettes** | Occluded avatars and items are drawn as a flat-colour outline (a depth-test-greater pass) | Common in ARPGs (Diablo-likes) and Minecraft Dungeons | 1 extra draw per silhouetted mesh; very cheap | Clutter if overused | Surface: the pod and belts hidden behind machines |
| 8 | **Dithered (screen-door) fade** | Fragments in a Bayer-pattern mask are discarded, so occluders look semi-transparent without sorting | Zelda: Breath of the Wild and Animal Crossing: New Horizons (near-camera objects dither out) | No transparency sorting | Uses `discard`, which can reduce tile-GPU hidden-surface-removal benefit (unverified detail). Apple says A11+ GPUs "improve fragment discard performance" [V: https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering] | Fallback only. Prefer a few sorted alpha fades |
| 9 | **Top-down horizontal dig plane** | Digging happens in a horizontal 2D plane; walls are raised blocks; the camera is angled top-down | Deep Rock Galactic: Survivor (walk into walls to mine, one cave plane per stage; also [S02]); Core Keeper (top-down mining plus belts, drills and robot arms); Dungeon Keeper (tag tiles, imps dig) | Readable 3D digging. Even DRG's 3D sequel flattens digging to one plane | No vertical axis, so no gravity, falling or thrust. Not Motherload | No. It is **evidence** that readable 3D digging stays planar |
| 10 | **Discrete depth layers (2–3 planes)** | The world has a front and a back plane; you switch through doors, or the game switches automatically | Spelunky 2 (back layer reached through doors; the inactive layer hidden); LittleBigPlanet (3 depth lanes; automatic lane-switching was often called imprecise) | Adds depth without a full 3D volume | Lane switching is fiddly on touch. Occlusion between lanes | Not for the pod. Possible **v2 "factory gallery" plane** (C4) |
| 11 | **Open-pit heightmap** | Terrain is a heightmap and mining lowers columns | Captain of Industry (excavator designations, truck haulage) | 3D look. Cheap | No tunnels or overhangs. Deep pits hide the pod behind near walls | No |
| 12 | **Rotating 2D faces** | A 3D object whose four sides are each 2D planes; rotation switches plane | Fez | Striking 3D feel | Confusing for a 600-row mine; content is split across 4 faces | No (noted as C3's extreme form) |
| 13 | **Data overlays** | Colour-coded overlays show one system at a time over a dimmed world | Oxygen Not Included (oxygen, power, plumbing, ventilation, conveyor and automation overlays); Factorio alt-mode [S03] | Shows complex layered logistics in a 2D plane | Needs a mode toggle | **Yes**: Logistics, Hazard and Power overlays |

### 2.1 Reference notes and lessons (all unverified unless tagged)

- **Motherload (2004).** 2D side view. The map is **32 tiles wide and about 600 rows (−7,500 ft)**; 1 tile = 12.5 ft; shops sit along the surface strip; drilling is down, left and right only [S01]. *Lesson:* the side cross-section is the game. Width was a 2004 screen limit and can grow [S01 §12].
- **Super Motherload (2013).** 2D. Underground bases are checkpoints. The DualShock 4 touchpad swipes set bomb direction [S01]. *Lesson:* swipe gestures suit **discrete one-shot actions** (bombs), not continuous drilling.
- **SteamWorld Dig.** 2D side view. A surface town strip leads to a deep mine, and the lamp radius shrinks until you return [S02]. *Lesson:* light radius is a readable second clock. The art brief already proposes a pod "light bubble".
- **Dome Keeper.** 2D side view. You drill by moving into rock, and harder rock takes more hits. Carried resources trail behind on a tether and slow the keeper; a wave timer forces you back up. *Lesson:* weight-slowed return is readable in side view. It is Motherload's asymmetric-return rule, made visible.
- **Dig or Die.** 2D side-view sandbox with structural support physics and water simulation; players build bases into the cross-section. *Lesson:* complex construction plus physics stays legible in a 2D slice.
- **Oxygen Not Included.** 2D side-view colony. Pipes, wires, conveyor rails and automation each sit on a **separate layer in the same cell** as buildings and walkable space, so duplicants walk past pipes, and overlays isolate each system. *Lesson:* this is the model for HoleFactory's **wall-mount layer**. Logistics can share a cell with the pod's path without blocking it.
- **Fallout Shelter (2015, iOS first).** The closest visual precedent for HoleFactory's look: 3D rooms sunk into a rock cut face, with a perspective camera whose parallax shows room side walls as you pan. Rooms join on a grid and elevators carry dwellers between floors. *Lesson:* a 2D grid drawn as a 3D diorama reads instantly on a phone and still "feels 3D".
- **Idle Miner Tycoon / Deep Town: Mining Factory.** Portrait vertical cross-sections. Mine floors stack downward; an **elevator or lift is the logistics spine** to the surface warehouse; surface buildings smelt and craft (Deep Town). *Lesson:* portrait plus a vertical lift line is a proven mobile layout for "bring resources up".
- **Tiny Tower.** Portrait cut-away tower with a tap-to-ride elevator. *Lesson:* vertical scrolling in portrait is natural on phones.
- **Mines of Mars.** A Motherload-like 2D mining and crafting game on Mars for mobile and PC, with on-screen stick controls. *Lesson:* direct Motherload-style control works on touch. Details are unverified.
- **Mr. Driller.** 2D. Drill down, left or right through coloured blocks; air depletes (a fuel analogue); unsupported blocks fall. *Lesson:* tight one-tile grid steps read perfectly at phone scale.
- **Deep Rock Galactic: Survivor.** 3D, angled top-down. Mining is automatic when you walk into walls. Each stage is a single cave plane, and you descend between stages [S02]. *Lesson:* a 3D studio still chose a **planar** dig space for readability.
- **Minecraft Dungeons.** Fixed isometric-style 3D camera with no rotation. Foreground and roof geometry hides when the hero is beneath it, and occluded heroes get outlines. No digging. *Lesson:* a fixed camera plus avatar cutaway is enough for readable 3D, but only because the play space is a plane.
- **Timberborn.** Perspective camera with free rotation. A height **layer slicer** hides geometry above a chosen level, which supports tunnels (dynamite digs down) and stacked platforms. *Lesson:* slicing works for a **builder with no avatar under time pressure**. Motherload is a real-time avatar game.
- **Going Medieval.** Voxel terrain. You dig into hills for cellars and build multi-storey keeps, with layer up/down controls. *Lesson:* same as Timberborn. Fine for colony sims, too much bookkeeping for a 2–5 minute action trip.
- **Dwarf Fortress.** z-levels. Classic mode shows one level; the Steam edition shades the levels below. *Lesson:* this is the far end of the scale, notoriously hard to read, and needs a strong mental model.
- **Shapez 2.** Three build floors joined by lifts [S03]; the camera snaps to 30° or 45° [S02]. *Lesson:* layer switching is fine with **≤ 3 layers**. HoleFactory's two build planes (surface and mine) sit inside that limit.
- **Little Rocket Lab.** **2D isometric pixel art, not 3D geometry**; fixed camera. Players complained the camera "can't rotate", which is "REALLY rough for a factory game" [S02, S03]. Its mines are separate areas under the town [S02]. *Lesson:* the user's "3D isometric" is a look and feel. A diorama slice with a real 3D surface delivers it, and build-mode rotation fixes LRL's main complaint.
- **Hole.io (Voodoo).** One finger dragged anywhere moves the hole (a floating relative stick) with no buttons. *Lesson:* a floating stick anywhere in a zone beats a fixed d-pad on phones.

### 2.2 Cross-cutting rules distilled

1. **R1. Keep the gameplay space planar; make the 3D presentational.** Fallout Shelter, Oxygen Not Included, DRG: Survivor, Core Keeper and Motherload all do this.
2. **R2. Gravity is screen-down** whenever falling and flight matter.
3. **R3. Nothing may ever sit between the camera and the play plane.** Achieve this by construction (a pre-cut diorama), not with runtime tricks.
4. **R4. Show layered systems with overlays, not geometry** (Oxygen Not Included, Cities: Skylines).
5. **R5. If you must slice, use ≤ 3 layers with an explicit toggle** (Shapez 2).
6. **R6. One touch maps to one plane**, using a ray–plane intersection.
7. **R7. Give the vertical world an always-visible depth ruler or minimap** [S03].
8. **R8. Hidden information must be hidden by design (gas), never by the camera.**

---

## 3. Touch controls in mobile digging and mining games

| Game (platform) | Movement | Dig / mine action | Other controls | Notes |
|---|---|---|---|---|
| Motherload (Flash) | Arrows / WASD | **Push into a block while grounded = drill** (down, left, right; never up). Up = thrust | Item hotkeys | [S01] |
| Super Motherload (PS4) | Stick | Push into a block | **Touchpad swipe = detonate bomb in that direction** | [S01] |
| Terraria (mobile) | Left virtual stick | Tap or hold a tile to mine (auto-targeting "smart cursor") | Right-side jump and use buttons | (unverified) |
| Minecraft Bedrock (touch) | D-pad or stick | **Hold on a block to break it**; tap to place | Optional crosshair "split controls" | (unverified) |
| Mines of Mars (mobile) | On-screen stick | Move into rock | Item and jetpack buttons | (unverified) |
| Pocket Mine (mobile, portrait) | — | **Tap blocks** to break them as you descend | Card power-ups | (unverified) |
| Hole.io | **Floating drag-anywhere stick** | Automatic (swallow on contact) | None | (unverified) |
| Archero / Brawl Stars | Floating stick (one or two) | Auto-attack when idle (Archero); tap = auto-aim, drag = manual aim (Brawl Stars) | — | (unverified) |
| Fallout Shelter | Pan / pinch | — (no avatar) | Drag a dweller to a room; tap to collect | (unverified) |
| Craft the World (mobile) | — | **Drag a rectangle to designate digging**; dwarves dig | Build menus | (unverified) |
| Oxygen Not Included (PC) | — | Drag-rectangle dig designation | Overlays | (unverified). A model for "designate excavation" by factory drones, if ever added |
| Idle Miner / Deep Town | — | Tap to upgrade; idle | — | (unverified) |

**Lessons for HoleFactory's pod:**
1. Motherload's **"push into rock = drill"** maps directly onto a floating stick. No dig button is needed, which keeps controls at one thumb plus item buttons.
2. Make drilling **intentional**: require the pod to be grounded and the stick held toward a solid neighbour for about 120 ms (proposed). Snap to 4 sectors with ±10° hysteresis so "down" never flickers into a side dig.
3. **Thrust = stick up**, analog: thrust ∝ max(0, y − 0.35). Stick-x steers in the air. This keeps Motherload's Up+Left/Right flight. Offer an optional dedicated 72-pt THRUST button [S02] for players who prefer it.
4. Use **swipes only for discrete actions**, such as a bomb direction swipe on the item button (Super Motherload precedent).
5. Offer **"tap an adjacent tile to drill toward it"** (Pocket Mine / Terraria style) as a one-handed and accessibility mode.
6. **Web platform constraints, checked first-hand:**
   - `navigator.vibrate` is **not supported in Safari** (`version_added: false`, and iOS mirrors desktop). Chrome Android has supported it since v32, and since v60 it needs a user gesture [V: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Navigator.json]. So there are **no web haptics on iPhone**; use audio and visual feedback, or Capacitor Haptics in a native wrapper.
   - `Element.requestFullscreen` on iOS Safari is **"only available on iPad, not on iPhone"**. Even there, "swiping down exits fullscreen mode, making it unsuitable for … games" [V: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Element.json]. **Full screen on iPhone means a home-screen PWA or a native wrapper.**
   - `ScreenOrientation.lock` is **unsupported in Safari** (`version_added: false`) but supported in Chrome Android 38+ [V: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/ScreenOrientation.json]. The game **must handle both orientations** (or show a "rotate" prompt) in Safari.
   - On the canvas, set `touch-action: none`, `user-select: none` and `-webkit-touch-callout: none` to stop double-tap zoom, callouts and selection (standard practice, unverified per iOS version). Keep the stick zone at least 24 pt from the left edge to avoid back-swipe gestures, and out of the bottom home-indicator inset (about 34 pt [S02], unverified per device).

---

## 4. Candidate world structures

Every option below assumes the same Motherload rules [S01]: dig down, left and right (never up); thrust against cargo weight; fuel and hull clocks; return to the surface to sell.

### 4.1 Option A: "Diorama slice"

**What it is.** The gameplay grid is 2D (x × depth), exactly like Motherload. It is rendered as 3D blocks whose front faces form a **cut face**. Dug cells are recessed, so you see tunnel floors, ceilings, side walls and a back wall. A 3D surface plateau extends behind the cut face and holds the factory and shops. This is what the art brief calls the "Diorama Cutaway" [S02].

| Criterion | Assessment |
|---|---|
| **Readability (6.1-inch phone)** | **Excellent.** At 9.5 tiles across 393 pt, 1 unit ≈ 41.4 pt and a block's front face is ≈ 39 × 39 pt at yaw/pitch 20° (cos 20° × 41.4). That is above the HIG minimum of 28 pt and close to the 44-pt default [V HIG]. About 19 rows are visible in portrait: about 7 above the pod and 12 below. Gravity is screen-down. Ores sit visibly in the cut face, as in Motherload |
| **Pod touch controls** | **Trivial mapping.** Stick-x = world x (on-screen x tilts only about 7° at yaw 20°/pitch 20°). Stick down = drill down. Stick up = thrust. One thumb |
| **Factory: underground** | In-plane only: belts on tunnel floors, lifts and chutes in 1-wide shafts, depots and drills in dug chambers [S03]. **Weakness:** if logistics occupy the same cells as the pod's path, lifts block shafts. The player must dig parallel shafts, and lines can tangle with the pod's route |
| **Factory: surface** | Full 2D build grid on the x × z plateau (LRL-like) [S02, S03]. Picking is a ray–plane hit on y = 0 |
| **Rendering cost** | **Lowest.** About 29k cells in total. A 16 × 16 chunk is at most 256 cells; 4–6 chunks are visible. A dig re-meshes 1–2 chunks (estimated 0.1–0.5 ms in JS). Terrain uses about 4–6 draw calls and about 10–40k triangles |
| **Implementation** | **Lowest.** 2D grid algorithms (flood fills, hazard cellular automata, A* routing, falling physics). Motherload's 2D physics carries over as is |
| **Motherload fidelity** | **5/5.** It *is* Motherload's grid |
| **Feels 3D** | **3/5 as plain A.** It depends on recess depth, camera angle, lighting and the surface plateau. The risk is "a 2D game with 3D tiles" |

### 4.2 Option B: "Layered voxel"

**What it is.** A full 3D voxel volume (x × z × depth), for example 48 × 48 × 608 ≈ **1.4M voxels**. The pod digs in 5 directions (N, E, S, W and down) and thrusts up. The camera is isometric; everything above the pod's layer is cut away or faded (Timberborn / Going Medieval / Dwarf Fortress style).

| Criterion | Assessment |
|---|---|
| **Readability** | **Poor for Motherload play.** With the cut at the pod's layer you see a *floor plan* of that layer, but **what lies below the pod is solid and hidden**. Motherload's core "read the ore below and plan a route" becomes a scanner UI minigame. True-iso depth ambiguity (§1.2) makes stacked shafts and falls unreadable. Top faces are about 55 × 32 pt at 10 tiles across: tappable, but ambiguous in depth. Flying up a shaft shows as the pod's tile changing layers, so altitude and falling are invisible unless the camera switches to a side view |
| **Pod touch controls** | **Awkward.** Grid axes are diagonal on screen (yaw 45°), so stick directions have to be rotated or quantised to diagonals (a classic iso-movement complaint, unverified). It needs at least stick + DRILL DOWN + THRUST, plus layer-follow camera logic. That is two thumbs and more errors |
| **Factory: underground** | Belts in x–z on each layer and lifts as vertical columns, i.e. Satisfactory-style 3D layout. Building needs **layer selection out of 600 layers**, iso picking ambiguity, and connections between layers that cannot be seen. It is the hardest possible UX on a phone |
| **Factory: surface** | Same as A (plateau) |
| **Rendering cost** | **High.** 16³ chunks: 3 × 3 × 38 = 342 chunks; 12–30 visible. Each layer change needs a **cut cap** re-mesh (a 48 × 48 slab) or stencil caps (2 extra passes per plane [V three.js]). Culled or greedy meshing of a 16³ chunk is roughly 1–4 ms in JS (estimate), so it needs a Web Worker (meshing approaches: [V: https://github.com/mikolalysenko/mikolalysenko.github.com/blob/master/MinecraftMeshes/index.html]). About 40–120k triangles; RAM 1.4–6 MB of voxels plus meshes. Hazard simulation (lava, gas) in 3D costs about 48× more cells than in 2D |
| **Implementation** | **Highest:** 3D physics and collision, 3D hazard automata, the slice camera, layer UI, iso picking, a 3D factory placer, and save diffs. Roughly 3× A (estimate) |
| **Motherload fidelity** | **2/5.** It keeps the economy but loses the cross-section, the visible fall and climb, and route planning by sight |
| **Feels 3D** | **5/5** |

### 4.3 Option C: hybrids

**C1. "Diorama Slice+" (recommended).** Option A plus the following:
1. **A wall-mount utility layer** in every underground cell, the Oxygen Not Included idea. Lifts, chutes, pneumatic tubes, lamps and shoring mount on the **back wall** (z ∈ [−1.0, −0.45]). **The pod flies past them**, so the main shaft can also be the lift line. That turns Motherload's "the tunnel is an investment" [S01 §11] into factory infrastructure.
2. **A rim road.** The top row's road surface is the Motherload surface strip with the four shops' service pads. It is the one place where the dig plane meets the factory plateau. Lift heads end in **Headframes** just behind the rim.
3. **A multi-plane data model** (`planes[k]`). v1 ships with k = 0 only; it leaves room for C4.
4. **A whole-mine map texture.** The mine is literally a 48 × 608 image, so the overview, minimap and depth ruler come from a **48 × 608 RGBA DataTexture** (about 117 KB). Each dig updates one texel.
5. **Deeper blocks (1.5 units).** This gives chunkier side faces: about 21 pt visible at 20° (1.5 × sin 20° × 41.4 pt). Add the 3D feel kit from §5.9.

Scores: readability 5, touch 5, underground factory 4 (the wall layer removes A's blocking problem), surface factory 5, rendering 5, implementation 4, fidelity 5, 3D feel 4.

**C2. "Thick slice" (3 lanes deep).** The underground is 48 × 3 × 608. The pod moves in x/depth and switches between the front, middle and back lanes; the camera cuts away lanes in front of the pod.
- Precedent: LittleBigPlanet's 3 lanes, a common source of control complaints (unverified).
- Touch: lane switching needs another gesture, and swipe up/down already mean thrust/drill.
- Readability: ore in other lanes is hidden by the lane cut.
- Cost: 87.5k voxels with lane cut caps.
- Scores: readability 3, touch 3, underground factory 4, surface 5, rendering 4, implementation 3, fidelity 4, 3D feel 4.

**Verdict:** the wall layer in C1 gives most of the benefit (logistics behind the pod) with none of the lane switching.

**C3. "Bounded 3D shaft" (for example 12 × 12 × 608).** A narrow 3D column with a section plane that follows the pod's z-lane. The camera orbits in 90° steps (Fez-like) to dig in other directions.
- Feels very 3D (5).
- Readability 3, touch 2 (you rotate the camera to steer), implementation 2, fidelity 3.
- The whole mine is a narrow column, which wastes the factory space.

**Verdict:** possibly a **late-game set piece** (the boss Core as a 3D chamber), not the main world.

**C4. "Two-plane" (mining plane + factory gallery).** A second 2D plane sits 2 tiles behind the mining plane, joined by "cross-cut" adits. Factory logistics live in the gallery; a "Factory view" toggle cuts away the mining plane (technique #10/#4).
- Gives the most underground build space without ever blocking the pod.
- Needs either a gallery-excavation mechanic (tunnel-borer machines, drones) or pod access through adits.
- Scores: readability 4, touch 5 (the pod never leaves plane 0), underground factory 5, implementation 3.

**Verdict: the v2 expansion path.** C1's `planes[]` model makes it additive.

**C5. "Open-pit surface + slice".** The top ~10 rows are a 3D heightmap quarry (Captain of Industry style), with the slice below. It adds a second terrain system for little gain, and deep pit walls occlude.

**Verdict:** rejected.

### 4.4 Scorecard (5 = best; for rendering and implementation, 5 = cheapest)

| Criterion | A Diorama slice | **C1 Diorama Slice+** | C2 Thick slice | C3 Bounded shaft | C4 Two-plane (v2) | B Layered voxel |
|---|---|---|---|---|---|---|
| Readability, 6.1-inch phone | 5 | **5** | 3 | 3 | 4 | 2 |
| Pod touch controls | 5 | **5** | 3 | 2 | 5 | 2 |
| Underground factory layout | 3 | **4** | 4 | 3 | 5 | 2 |
| Surface factory layout | 4 | **5** | 5 | 5 | 5 | 4 |
| Rendering cost | 5 | **5** | 4 | 3 | 4 | 2 |
| Implementation simplicity | 5 | **4** | 3 | 2 | 3 | 1 |
| Motherload fidelity | 5 | **5** | 4 | 3 | 5 | 2 |
| Feels 3D | 3 | **4** | 4 | 5 | 4 | 5 |
| **Total / 40** | 35 | **37** | 30 | 26 | 35 | 20 |

### 4.5 Quantitative comparison (estimates)

| | A / C1 | C2 (3 lanes) | C3 (12 × 12 shaft) | B (48 × 48 volume) |
|---|---|---|---|---|
| Cells or voxels | 29,184 | 87,552 | 87,552 | 1,400,832 |
| RAM for world data (4–6 B/cell) | 117–175 KB | 350–525 KB | 350–525 KB | 5.6–8.4 MB |
| Chunk shape | 16 × 16 | 16 × 16 × 3 | 12 × 12 × 16 | 16 × 16 × 16 |
| Chunks in total / visible | 114 / 4–6 | 114 / 4–6 | 38 / 2–3 | 342 / 12–30 |
| Terrain draw calls (typical) | 4–6 | 6–9 + lane cap | 3–6 + section cap | 12–30 + cut cap |
| Terrain triangles visible | 10–40k | 20–50k | 15–40k | 40–120k |
| Re-mesh per dig | 1–2 chunks × 256 cells, ≈ 0.1–0.5 ms | ≈ 0.3–1 ms | ≈ 0.5–1.5 ms | 1–4 chunks × 4,096 voxels, ≈ 1–4 ms each (worker) + cap re-mesh on every layer change |
| Touch picking | ray ∩ plane, exact | ray ∩ active lane | ray ∩ section plane | voxel ray march + layer rule (ambiguous) |
| Hazard simulation cells (lava, gas, collapse) | 29k (2D) | 88k | 88k | 1.4M (3D) |
| Engineering for world + camera + controls + placement (person-weeks, rough) | A 4–6 / **C1 5–7** | 8–10 | 9–12 | 14–20 |

---

## 5. Recommended specification: C1 "Diorama Slice+"

### 5.1 Coordinates

- **Axes:** x to the right (0–47); y up, with y = 0 at the rim road and underground row r at y = −r − 0.5 (cell centre); z toward the camera.
- **Cut face:** z = +0.5 (the front faces of solid underground cells).
- **Plateau:** occupies z ∈ [−33, −1] at ground height y = 0.
- **Rim road:** the top of row 0, z ∈ [−1.0, +0.5].
- **Units:** 1 tile = 1 world unit; the HUD shows depth as rows × 12.5 ft [S01].

### 5.2 Grid sizes

| Element | Size (proposed) | Rationale |
|---|---|---|
| **Underground width** | **48 tiles** (3 chunks) | Motherload's 32 [S01] plus room for lift shafts, 3 × 2 Depots, 2 × 2 drills and shoring [S03]. Rim-to-rim is about 12 s at about 4 tiles/s pod speed (tunable). About 5 portrait screens wide |
| **Underground depth** | **608 rows** (38 chunks) | Keeps Motherload's −7,500 ft scale (about 600 rows [S01]). Diggable rows 0–583. **Bedrock barrier at row 584** with a gap at x = 47 (Motherload's right-edge gap [S01]). Boss Core in rows 585–607 |
| **Strata bands** | 8 bands × 76 rows | Matches the art brief's 8 strata colours [S02] and the hazard onsets [S01]: stone at about −1,600 to −1,750 ft (row ~128–140), lava at about −3,000 ft (row ~240), gas at about −4,750 ft (row ~380) |
| **Sky** | 64 rows (+800 ft) flight ceiling | Room to fly. Not chunked; rendered as a gradient plus parallax mesas |
| **Surface plateau (buildable)** | **48 × 32 = 1,536 tiles** (6 chunks of 16 × 16) | Starts at 48 × 8, with three +8-row land expansions bought with cash (LRL-style space limits [S02]). If testing shows crowding, widen to 64 × 32 by adding 8-tile wings beside the slice |
| **Rim road** | 48 × 1 | Pod-only lane. The four Motherload shops [S01] stand at plateau rows z −2 to −4 with service pads on the road. Proposed x positions: Fuel 1–3 (spawn), Mineral Processor 9–11, Autobuy 30–32, Emendation 40–42 |
| **Backdrop** | Non-interactive mesas and skyline beyond z = −33 and beyond x ∉ [0, 47] | One merged low-poly mesh, 1 draw call |

### 5.3 Cell data model

```
Plane { w=48, h=608,
  terrain : Uint8Array(w*h)   // stratum / ore / stone / lava / gas / bedrock / empty
  flags   : Uint8Array(w*h)   // dug, revealed(gas), damaged, support, lit, ...
  mount   : Uint16Array(w*h)  // wall-layer entity id (lift / chute / tube / lamp / shoring), 0 = none
  occupant: Uint16Array(w*h)  // in-plane building id (depot / drill / packer), 0 = none
}
World { planes: Plane[] /* v1: [0] only; v2 C4 adds [1] = factory gallery */, surface: Grid48x32 }
```
- **Size:** 6 B × 29,184 cells ≈ **175 KB**; the surface ≈ 6 KB.
- **Saves:** seed plus run-length-encoded dug and mount diffs, typically under 50 KB, which suits cloud saves.
- **Rules per cell:** at most one mount and at most one occupant. A cell with an occupant blocks the pod; a cell with only a mount does not.

### 5.4 Chunking and meshing

- **Underground chunk = 16 × 16 cells.**
  - Keep meshes for visible chunks plus a 1-chunk margin (at most about 12 resident) and pool the rest.
  - A dig dirties its chunk, plus its neighbour(s) for AO and side faces when the cell is on a chunk border.
- **Mesh contents per chunk:**
  1. Front faces of solid cells (z = +0.5), greedy-merged per stratum where there is no ore.
  2. Floor, ceiling and side faces only on solid/dug boundaries, 1.5 units deep.
  3. A back-wall quad (z = −1.0) for dug cells, darker, with vertex AO.
  4. Bevelled tunnel edges chosen by **2D autotiling** (marching squares, 16 cases, or a 47-tile blob set). 2D tile-art techniques apply directly because the slice is 2D, and they give the rounded "toy" edges of the art brief [S02].
  5. Ore gems merged into the chunk mesh with an emissive vertex attribute, so they cost no extra draw calls.
- **Animated elements:**
  - Lava and gas tells: one shared material each, instanced.
  - Mounts, belts, items and machines: `InstancedMesh` per type, matching the factory brief's sim, where lifts are ring buffers and the renderer scrolls bucket textures [S03].
- **Sim bands:** 16-row bands line up with render chunks, so off-screen factory bands can run on the factory brief's steady-state rate model [S03].
- **Surface chunk = 16 × 16 (x × z):** mostly static terrain plus instanced buildings and belts.

### 5.5 Render budget per frame (typical, proposed)

| Item | Underground | Surface (factory view) |
|---|---|---|
| Terrain | 4–6 | 6 + 1 backdrop |
| Ores / lava / gas FX | 1–3 | — |
| Mounts (lift, tube, chute, lamp) | 2–4 | — |
| Belts + items | 2–3 | 4–8 |
| Machines (instanced per type) | 5–10 | 20–60 |
| Pod (body, drill, flame) | 2–3 | 2–3 |
| Particles | 1–2 | 1–3 |
| Overlays / x-ray passes | 0–2 | 2–6 |
| **Total** | **≈ 25–40 draw calls**, 20–60k triangles | **≈ 60–120 draw calls**, ≤ 150k triangles (the art brief's limits [S02]) |

### 5.6 Camera specification

**Projection: orthographic** (constant touch-target size; Pixel Lab filter compatible [S02]).

**Perspective option worth an A/B test.** Underground, the camera tracks parallel to the z = 0 play plane, so even a **perspective** camera keeps tile size almost constant.
- With FOV 20° and about 19 rows of view height, the camera sits about 54 units away. Tile size then varies only about ±3% horizontally and ±6% vertically across the screen (computed: half-width 4.75 × tan 20° = 1.73 units of depth change → 1.73/54).
- In exchange, tunnel side faces shift as you pan, the "Fallout Shelter parallax", which is the strongest cheap 3D cue available.
- Test ortho against FOV 20° and 30°.

| Mode | Yaw | Pitch | View width (tiles across a portrait screen) | Zoom range | Rotation |
|---|---|---|---|---|---|
| Surface, play | 45° | 35° | 11 | 6–22 | **Fixed front** (the cut face always faces the camera) |
| Surface, build | 45° + n·90° | 55° | 10 when a tool is armed (diamond ≥ 44 pt), else 9–20 | 8–22 | **4 snaps** via a two-finger twist or a button. This fixes LRL's no-rotation complaint [S03]. Returns to the front view on exit |
| Underground, play | 20° | 20° | **9.5** (about 41 pt/unit; face about 39 pt) | 7–13 | **Fixed** |
| Underground, build | 8° | 12° | 8 (face ≈ 48 pt ≥ 44 pt [V HIG]) | 7–10 | Fixed, near-frontal for precise in-plane placement |
| Map | — | — | Whole width (48 tiles) | Scroll | 2D schematic drawn from the 48 × 608 DataTexture. Pinch out past the minimum zoom to enter |

**Surface ↔ underground blend.** Interpolate by **pod depth, not time**, with `t = smoothstep(0, 4, rows below rim)` [S02]. Scrubbing up and down the top four rows reverses smoothly. Over the same span, sky light, ambient (1.0 → floor 0.12) and fog blend too [S02].

**Follow:**
- Critically damped spring, ω ≈ 8 rad/s (about 0.5 s to settle).
- Horizontal dead zone ±1 tile.
- Look-ahead 1.5 tiles along velocity.
- Vertical anchor: the pod sits **36% from the top** of the safe view while grounded, digging or falling, and **62%** while climbing faster than 1 tile/s. Switching anchors takes 0.6 s.
- Clamp the camera centre so the view never shows more than 1 tile of bedrock frame beyond x ∈ [0, 48].

**Zoom invariance:** keep points per unit constant across portrait and landscape; landscape just shows more columns [S02]. Orientation cannot be locked in Safari [V MDN], so both must work.

**Occlusion handling:**
1. **Underground: impossible by construction.**
   - Nothing exists in z > +0.5.
   - In-plane entities stay inside their cells' z-extent and height.
   - Wall mounts are always behind the pod (z < −0.45).
   - Particles are capped at 60% alpha and short lifetimes.
2. **The pod on the rim** is in front of the whole plateau, so it is never occluded in play mode.
3. **Surface factory:**
   - Machine height cap 1.6 units [S02]. Tall landmarks (shops, Headframes, chimneys, up to 3 units) are allowed only on the rim rows, where nothing important is in front of them.
   - In build mode, any building whose screen bounds cover the cursor or ghost and that is nearer the camera fades to 35% alpha in a **sorted alpha pass**. Usually only 1–4 objects, so there is no `discard`; screen-door dithering is the fallback.
   - **X-ray silhouette pass** (depth test GREATER, flat role colour) for belts and items hidden behind machines in build mode [S02], and for the pod if it is ever hidden.
4. **Cut caps:** not needed; geometry is pre-cut, so stencil caps (technique #5) are never used.

**Transitions and moments:**
- When a depth milestone is reached, a 2-s "establishing shot" yaws to 35° to show the depth of the diorama, then returns. Input is never blocked; any touch skips it.
- After 3 s idle on the rim, the camera pulls back to 14 tiles to show the factory; any touch cancels it.

### 5.7 Pod touch controls (portrait first)

| Control | Spec (proposed) |
|---|---|
| Stick | **Floating**: spawns where the left thumb lands in the left 55% of the screen, below the HUD, ≥ 24 pt from the left edge and above the home-indicator inset. Radius 52 pt, knob 28 pt, **dead zone 8 pt** [S02]. Drag past the radius and the base follows the thumb |
| Drive | Grounded: stick-x → wheel speed (analog) |
| Drill | Grounded **and** the stick held into a solid neighbour for **≥ 120 ms** → drill that direction. Sectors are 90° wide with **±10° hysteresis**; never up [S01]. Holding down keeps drilling straight down |
| Thrust | Stick y > 0.35 → thrust ∝ (y − 0.35)/0.65. Stick-x steers in the air. Optional 72-pt THRUST button on the right [S02] |
| Items | Right thumb: 2–4 quick slots of **56–64 pt** with **≥ 12 pt padding** [V HIG]. Fuel, repair, dynamite / C4, teleport [S01]. **Swipe on a bomb slot to choose a direction** (Super Motherload precedent [S01]) |
| One-handed mode | Tap a tile next to the pod to drill toward it; hold above the pod to thrust; the stick is optional |
| Feedback | No web vibration on iPhone [V MDN]. Use drill audio pitch by hardness, screen micro-shake at ≤ 2 px, and debris particles. Native wrapper: haptic ticks per tile |
| Mode switch | **Drive vs Build** are separate modes [S03]. Build mode opens from a button or automatically when docking at a Depot or a rim pad |

### 5.8 Factory layout rules

**Surface plateau (48 × 32):**
- Full 2D placement grid (ray ∩ y = 0).
- Single-lane belts, drag-to-paint, ports, ghost-and-confirm [S03].
- Processing and assembly live here (Smelters, Assemblers, Refinery, Export Terminal, storage) [S03].

**Rim interface:**
- **Headframes** (2 × 2 at plateau rows 1–2) receive Bucket Lifts whose top end is at row 0. They output to surface belts heading back into the plateau.
- A lift's shaft mouth in the rim road gets a **grate hatch**. The pod drives over it; pressing down on it opens it (0.3 s) so the pod can descend the shared shaft.

**Underground, in the 2D plane (ray ∩ z = 0):**
| Layer | Pieces | Pod interaction |
|---|---|---|
| **Wall mount** (back wall, z ∈ [−1.0, −0.45]) | Bucket Lift (vertical, endpoint pair), Gravity Chute, Pneumatic Tube (any direction, endpoint pair), Lamps, Shoring | **The pod passes in front.** One mount per cell, so parallel lifts need parallel shafts |
| **Floor** (bottom 0.15 of an empty cell) | Belts (horizontal only [S03]), Cargo Rail | The pod drives over them. Whether belts push the pod is an open question |
| **In-plane occupant** | Depot 3 × 2 (pod dock), Auto-Drill 2 × 2 on a lode, Crate Packer, Gas or Geothermal Tap [S03] | **Blocks the pod**, except through the Depot's dock cell |
| **Through rock** | Pneumatic Tube segments inside solid cells | Shown as a **glass-pipe inlay flush with the cut face** (z ≈ +0.45), so they stay visible, which suits the ant-farm look |

**Overlays (technique #13):**
- **Logistics:** dims terrain to 30%; shows flow arrows and items/min per lift and belt; tints bottlenecks red [S03].
- **Hazard:** scanner reveals and support / collapse risk.
- **Power:** Depot radii [S03].

### 5.9 Making it feel 3D (C1 kit)

1. **Recess depth 1.5 units** with vertex AO, so tunnel floors, ceilings and side faces are about 21 pt thick on screen.
2. **Camera blend** from the surface iso view (45°/35°) to the underground view (20°/20°), plus milestone establishing shots.
3. **A real 3D plateau and factory** with build-mode rotation snaps. The plateau is the "hero" diorama and App Store shot.
4. **Lights inside the recess:**
   - the pod's headlight cone and thrust flame light the back wall and side faces;
   - wall lamps form pools of light;
   - lava glows.

   Light falling across faces at different z is the strongest depth cue.
5. **Moving parts at different depths:** lift buckets on the back wall, the pod in the middle, debris flung **toward the camera** (+z) on each dig.
6. **A 3D pod:** it tilts and rolls with acceleration, the drill spins, and the chibi proportions follow the art brief [S02].
7. **The slab's edges:** at x = 0 and x = 47 the camera reveals the slab's side as a cliff, which reminds the player the mine is a cut block. An optional stylised "specimen frame" or glass edge (a lab diorama, fitting "HoleFactory").
8. **Optional long-lens perspective** for panning parallax (§5.6).

### 5.10 Readability checklist (pass or fail in the prototype)

| Check | Target |
|---|---|
| Tile front-face size, underground play (6.1-inch portrait) | ≥ 38 pt (≥ 36 pt on a 375-pt-wide SE) |
| Tile size whenever a build tool is armed | ≥ 44 pt [V HIG] |
| Rows visible below / above the pod while descending | ≥ 11 / ≥ 6 |
| Ore identification at default zoom (colour **and** shape [S02]) | ≥ 95% correct at a 1-s glance (playtest) |
| Unintended digs (mis-drills) | < 3% of dig actions (telemetry) |
| Frame time, iPhone 11 class, underground | 60 fps; re-mesh p95 ≤ 1 ms |

---

## 6. Risks and mitigations

1. **"It's just 2D" disappointment.** The user asked for 3D isometric.
   - Show the C1 greybox early, with the surface plateau, camera blend, deep recesses, lighting and debris.
   - Stress that LRL itself is 2D isometric pixel art [S02].
   - Keep C4 (a second plane) and a C3-style 3D boss chamber as visible "3D depth" milestones.
2. **Shared shafts make logistics too easy.** The pod and lifts share shafts, so infrastructure costs less digging. Mitigate with the one-mount-per-cell rule, lift throughput and weight caps, and quake damage to mounts [S03].
3. **Camera blend disorientation.** Blend by position, keep the yaw change ≤ 25°, and A/B test against a single fixed camera (yaw 30°, pitch 28°) [S02].
4. **Width 48 dilutes Motherload's density.** Scale ore density per row by 32/48 for the same ore per screen, or keep density and accept richer rows. Tune in playtests.
5. **Surface occlusion as the factory grows.** Height cap, rotation snaps, sorted fades and x-ray pass (§5.6).
6. **iPhone web limits.** No fullscreen, no orientation lock, no vibration [V MDN]. Ship as a home-screen PWA or a Capacitor wrapper; design for both orientations.

---

## 7. Prototype and validation plan (2 weeks)

1. **P1, C1 greybox (week 1).** A 48 × 128 slice plus a 48 × 8 plateau. Includes chunk meshing with recess and AO, the camera blend, the floating stick with drill hysteresis, a wall-mount lift sharing the shaft, and the DataTexture minimap. Test on an iPhone SE (375 pt) and a 6.1-inch iPhone; check the §5.10 targets.
2. **P2, B spike (2 days).** A 32 × 32 × 64 voxel volume with layer cut, iso camera and stick + DRILL + THRUST. Run the same task: "dig to row 50, find a Goldium, return". Compare completion time, mis-digs and a SUS-style questionnaire. The purpose is to **confirm the decision with evidence**, not to ship B.
3. **P3, camera A/B.** Ortho vs perspective FOV 20° and 30° underground; blended vs fixed camera.
4. **P4, factory placement.** Place a Depot, a Drill and a Lift-to-surface underground in build mode (8°/12° camera), and a Smelter line on the surface with rotation snaps. Measure taps per task and errors.

---

## 8. Open questions for the user

1. On the surface, should the pod **stay on the rim road** (Motherload-like; recommended for v1) or **drive freely around the 3D factory plateau** (LRL-like walking; costs a second control mapping and pathing around belts)?
2. Should lifts and tubes **share shafts with the pod** (wall-mount layer; recommended), or should infrastructure block the pod so players must dig dedicated shafts?
3. World width: keep **48** (recommended), stay at Motherload's **32**, or go to **64**?
4. Depth: keep Motherload's full **~600 rows**, or shorten for mobile sessions, given that lifts and Depots extend reach?
5. **Orthographic** (crisp, Pixel-Lab compatible) or a **long-lens perspective** (more 3D parallax) underground? (A/B in the prototype.)
6. **Portrait-only** play, or full landscape support from day one? Safari cannot lock orientation.
7. Is a **v2 second underground plane** (a factory gallery behind the mine face) desirable, or should the underground stay a single plane forever?
8. Should belts **carry the pod** when it drives over them (playful, like LRL's magnet-boots problem [S02]) or ignore it?

---

## 9. Sources

**Verified first-hand in this session [V]:**
- Apple HIG, Accessibility (control sizes 44 × 44 default, 28 × 28 minimum; padding 12 / 24 pt): https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json (human page: https://developer.apple.com/design/human-interface-guidelines/accessibility)
- Apple, "Tailor your apps for Apple GPUs and tile-based deferred rendering" (TBDR; A11+ "improve fragment discard performance"): https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering
- MDN browser-compat-data:
  - `navigator.vibrate`: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Navigator.json
  - `Element.requestFullscreen`: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Element.json
  - `ScreenOrientation.lock`: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/ScreenOrientation.json
- three.js stencil-cap clipping example: https://github.com/mrdoob/three.js/blob/dev/examples/webgl_clipping_stencil.html
- Voxel meshing comparison tool (stupid, culled and greedy meshing): https://github.com/mikolalysenko/mikolalysenko.github.com/blob/master/MinecraftMeshes/index.html

**From sibling briefs (verified there through search extracts):**
- [S01] `01-motherload-mechanics.md`: Motherload map 32 wide × about 600 rows, 12.5 ft per tile, dig rules, right-edge barrier gap, hazards by depth, Super Motherload touchpad bombs (https://motherload.fandom.com/wiki/Motherload, https://www.speedrun.com/motherload/forums/ptg8m, https://en.wikipedia.org/wiki/Super_Motherload).
- [S02] `02-art-direction.md`: Little Rocket Lab is 2D isometric pixel art (https://thinkygames.com/news/factorio-meets-stardew-valley-in-the-newly-released-my-little-rocket-lab/); its mines (https://littlerocketlab.wiki.gg/wiki/Mines); Shapez 2 30°/45° snaps (https://shapez2.wiki.gg/wiki/Changelog); DRG: Survivor destructible terrain (https://en.wikipedia.org/wiki/Deep_Rock_Galactic:_Survivor); SteamWorld Dig light radius (https://steamcommunity.com/sharedfiles/filedetails/?id=249930731); camera, palette and performance budgets.
- [S03] `03-factory-design.md`: Shapez 2's 3 floors joined by lifts (https://5gamers.com/en/shapez-2/mechanic/space-platforms, https://shapez2.wiki.gg/wiki/Conveyor_Belt); LRL "can't rotate the camera" complaint (https://www.resetera.com/threads/little-rocket-lab-is-an-incredible-cozy-town-sim-factory-automation-game-xb-steam-game-pass-switch-dec-10.1321141/page-2); underground building roster and sim architecture.

**Unverified (own knowledge; no page could be fetched):** every specific claim above about Fallout Shelter, Oxygen Not Included, Timberborn, Going Medieval, Dwarf Fortress, Dome Keeper, Dig or Die, Mines of Mars, Mr. Driller, Minecraft Dungeons, Core Keeper, Dungeon Keeper, Spelunky 2, LittleBigPlanet, Captain of Industry, Fez, Cities: Skylines, SimCity 4, The Sims, Project Zomboid, Breath of the Wild, Animal Crossing, Terraria mobile, Minecraft Bedrock, Pocket Mine, Hole.io, Archero, Brawl Stars, Craft the World, Idle Miner Tycoon, Deep Town and Tiny Tower. Also unverified: iPhone point dimensions, and all performance timings marked as estimates.
