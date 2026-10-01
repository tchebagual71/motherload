# 03 — Factory & Logistics Design Brief for HoleFactory

**Scope:** what to borrow from Factorio and from touch-friendly factory games, how to make it work on a phone, how to keep the sim fast on an iPhone, and a vertical-specific factory proposal that fits the Motherload loop.
**Method / verification note:** I checked facts with WebSearch (US results, Oct 2026). WebFetch was blocked by the egress proxy for factorio.com, the wikis, Steam and most other hosts. As a result, many numbers rest on search-result snippets and the linked pages. Claims I could not confirm are marked **(unverified)**. Design numbers I made up for HoleFactory are marked **(proposed)**.

---

## 0. TL;DR — the ten decisions this brief recommends

1. **"Down is free, up costs."** The vertical world's logistics identity: gravity chutes are free, lifts and tubes cost power and money, and the Depot is where the pod meets the factory. No other factory game has this, and it shows up clearly on screen.
2. **Split the world in two (hybrid layout).** A **surface plateau** is a top-down isometric grid like Little Rocket Lab, where all the complex processing and assembly happens. The **underground** is a vertical cut-face like Motherload, holding only extraction and vertical transport: drills, lifts, chutes, tubes, depots and short belts. The hard building happens where touch building is easiest.
3. **Single-lane belts, no inserters.** Machines have input/output ports that connect directly to belts, as in Builderment, Shapez and Mindustry. This cuts the entity count and the number of taps by about half compared with Factorio.
4. **Endpoint-pair transport for long vertical runs.** Lifts, pneumatic tubes and rails are placed as two ends, A and B, not tile by tile. Underground distances are hundreds of tiles, and nobody should drag a finger across 300 tiles.
5. **Ghost-plan, then confirm.** Every build gesture makes a translucent plan, and a ✓/✗ bar commits it. Undo/redo is always visible. Together these fix the fat-finger problem Mindustry users reported.
6. **One finger builds, two fingers move the camera** whenever a tool is armed. With no tool armed, one finger pans. The world's tiles are never smaller than 44 pt at build zoom.
7. **Power v1 is a global pool, with no wires.** Depots double as underground "service radius" hubs, and lava pockets become geothermal power. Cut circuits, fluids-in-pipes, train signals and quality.
8. **The pod stays essential.** Only the pod excavates space, surveys lodes, carries building kits down, repairs quake and lava damage, clears gas pockets, and harvests the gem jackpots (Ruby, Diamond, Amazonite stay pod-only). Only the factory makes pod-upgrade components, deep refuelling and bulk income.
9. **Sim architecture:** a fixed 20 Hz factory tick. Belts use gap-encoded transport lines. Lifts, tubes and rails run as timed queues. Machines are event-scheduled and sleep when idle. Off-screen chains collapse to a steady-state rate model, which also gives you capped offline progress.
10. **A roster of 20 buildings with an 8-building MVP.** The recipe tree turns Motherload's 10 minerals into about 15 intermediate goods, and each step multiplies value by about 1.3–1.6×.

---

## 1. Factorio's core mechanics: what they are and the key numbers

| System | How it works in Factorio | Key numbers / facts | Source |
|---|---|---|---|
| **Transport belts** | Two parallel lanes per belt. Items ride a lane; belts can feed into the side of another belt ("sideloading"). On curves, inserters always place onto the far lane. | 4 items per lane per tile on a straight belt. Throughput: yellow 15/s (7.5 per lane), red 30/s, blue 45/s; turbo (Space Age) 60/s **(unverified)**. | [Transport belts/Physics](https://wiki.factorio.com/Transport_belts/Physics), [Steam thread](https://steamcommunity.com/app/427520/discussions/0/5971271658113075842/), [Belt transport system](https://wiki.factorio.com/Belt_transport_system) |
| **Underground belts** | An entrance and an exit pair, joined underground. Only the two endpoints matter. | Max gap 4 / 6 / 8 / 10 tiles (yellow, red, blue, turbo). | [Underground belt](https://wiki.factorio.com/Underground_belt), [Turbo underground](https://wiki.factorio.com/Turbo_underground_belt) |
| **Splitters** | 2 belts in, 2 out, 50/50 split by default. Input and output priority and item filter can be set **(unverified details)**. Sideloading onto an underground blocks one lane, a well-known trick for splitting by lane. | — | [Belt lanes discussion](https://steamcommunity.com/app/427520/discussions/2/412448792348619030/) |
| **Inserters** | Arms that move items between belts, chests and machines, with burner, basic, long, fast, filter and bulk/stack tiers. They **sleep** when there is nothing to do and get woken by the chest or belt. | In a large save, 6 of 7 inserters were asleep and UPS nearly doubled (FFF #67). Space Age's stack inserter can place stacks of up to 4 items per belt slot ("belt stack size" research), which can quadruple belt capacity. | [FFF #67](https://www.factorio.com/blog/post/fff-67), [PC Gamer on belt stacking](https://www.pcgamer.com/factorio-20-will-let-items-on-conveyor-belts-stack-something-long-thought-impossible/), [FFF #393](https://www.factorio.com/blog/post/fff-393) |
| **Mining drills** | Placed on ore patches, which are finite. They output to a belt or chest in front of them. | Burner drill 0.25/s; electric drill 0.5/s (0.25/s on uranium). | [Electric mining drill](https://wiki.factorio.com/Electric_mining_drill), [Burner drill](https://wiki.factorio.com/Burner_mining_drill) |
| **Furnaces** | **Pick their recipe automatically from what is fed in**, so there is no setup tap **(unverified but long-standing behaviour)**. | Stone furnace crafting speed 1; steel and electric furnaces 2. | [Factorio cheat sheet](https://factoriocheatsheet.com/) |
| **Assemblers** | Player sets the recipe. Rate formula: items/s = (count ÷ craft time) × crafting speed. | Assembler 1/2/3 crafting speed 0.5 / 0.75 / 1.25 **(unverified)**. | [Mining wiki (formula)](https://wiki.factorio.com/mining) |
| **Power** | Generators (steam, solar, nuclear) feed networks linked by poles. Each network has a "satisfaction" ratio; low power slows every machine on it. | Supply areas: small pole 5×5 (wire reach 7.5); medium 7×7 (reach 9); substation 18×18. | [Small pole](https://wiki.factorio.com/Small_electric_pole), [Medium pole](https://wiki.factorio.com/Medium_electric_pole), [Substation](https://wiki.factorio.com/Substation) |
| **Fluids (2.0)** | Pipes, undergrounds and tanks merge into **segments** that act as one buffer. Fluid pushed into a segment is available at once anywhere along it, and the pull rate depends on how full it is. | Replaced per-pipe flow simulation. | [FFF #416 Fluids 2.0](https://www.factorio.com/blog/post/fff-416) |
| **Research** | Labs consume science packs, which are crafted items, to unlock techs. | — | (general knowledge) |
| **Blueprints** | Copy, cut and paste areas; save to a library or book. 2.0 added **parametrised blueprints** and much better **undo/redo**: redo itself, and undo now reverts the wires, rotations, recipes and filters set by a blueprint. | Ctrl+Y redo was added in FFF #412. | [FFF #412](https://factorio.com/blog/post/fff-412), [FFF #392](https://www.factorio.com/blog/post/fff-392) |
| **Logistic & construction bots** | Roboports form networks that must touch. Logistic bots carry items from provider chests to requester chests. Construction bots build "ghosts" (placed blueprints) using materials from the nearest chest. | — | [XGamingServer bot guide](https://xgamingserver.com/blog/comprehensive-guide-on-factorios-construction-and-logistic-robots/), [Construction robot](https://wiki.factorio.com/construction_robot) |
| **Simulation model** | Fixed 60 UPS. Multiplayer is **deterministic lockstep**: every client runs the full sim and only player inputs are sent. | Determinism is all-or-nothing: a desync diverges for good. | [Wikipedia](https://en.wikipedia.org/wiki/Factorio), [lockstep explainer](https://pingpackettest.com/game/factorio) |

---

## 2. How touch-friendly and simplified factory games adapted these mechanics

### 2.1 Little Rocket Lab (the user's visual reference)
- **Facts:** made by Teenage Astronauts, published by No More Robots. Released 7 Oct 2025 on PC, Xbox and Game Pass, then on Switch on 10 Dec 2025, with a 120 fps Switch 2 version. **It is not on iOS or Android.** ([Nintendo Life](https://www.nintendolife.com/games/switch-eshop/little_rocket_lab), [MobyGames](https://www.mobygames.com/game/248835/little-rocket-lab/), [GameRant](https://gamerant.com/little-rocket-lab-release-date-announcement-xbox-game-pass-day-one-cozy/), [Nintendo Life Switch 2](https://www.nintendolife.com/news/2025/11/no-more-robots-is-putting-out-switch-2s-next-120fps-game))
- **Look:** it is described as a **"sweet pixel art automation game"** with an isometric view on a visible grid ([NerdyBird](https://nerdybirdgames.com/2025/10/09/indie-spotlight-little-rocket-lab/), [Tech-Gaming](https://www.tech-gaming.com/little-rocket-lab/)). **The camera cannot rotate.** One player wrote that "because it's a 2d game you can't rotate the camera which is REALLY rough for a factory game" ([ResetEra](https://www.resetera.com/threads/little-rocket-lab-is-an-incredible-cozy-town-sim-factory-automation-game-xb-steam-game-pass-switch-dec-10.1321141/page-2)). **This matters for HoleFactory:** the user asked for "3D isometric like Little Rocket Lab", but LRL is pixel art with a fixed projection. A true 3D orthographic camera can match LRL's framing and still offer 90° rotation snaps, which fixes the complaint above (see open questions).
- **Mechanics:** conveyors; **cranes** (its inserter equivalent; Cable Cranes move items A→B over buildings at 2 kW); sorters (750 W, two outputs); splitters with adjustable ratios; underpasses; an Item Buffer (a pass-through that also stores); a Level-2 furnace with two inputs; assemblers; power; water ([LRL wiki: Sorter](https://littlerocketlab.wiki.gg/wiki/Sorter), [Cable Crane](https://littlerocketlab.wiki.gg/wiki/Cable_Crane), [Furnace L2](https://littlerocketlab.wiki.gg/wiki/Furnace_(Level_2)), [Hardcore Gamer](https://hardcoregamer.com/review-little-rocket-lab/)).
- **Item compression:** a **Loader packs 15 identical items into a crate**. Crates ride belts at 45/min, which equals 7.5 saturated item belts. Crates cannot pass through underpasses, sorters or splitters; only cable cranes and "bumpers" handle them. Crane throughput is 15/min over 1–4 tiles, 11.25/min over 5–8 and 10/min over 9 or more ([Steam discussion summary](https://steamcommunity.com/app/2451100/discussions/0/767436134178486628/)). From that, a saturated LRL item belt works out to about 90 items/min **(derived, unverified)**.
- **Pacing and space:** no timers and no enemies; "smart snapping tools and compassionate placement options"; you buy more land from the town planner, so **factories live on bounded plots** ([Gameindustry.com](https://www.gameindustry.com/reviews/modern-gamer/little-rocket-lab-is-a-cozy-factory-sim-with-a-whole-lot-of-heart/), [Movies Games and Tech](https://moviesgamesandtech.com/2025/10/27/review-little-rocket-lab/)).
- **Lessons for HoleFactory:** bounded plots make factories small and readable, which suits phones. Crate packing is a compression mechanic you can see. Keep the cozy, no-timer feel for factory building, while the pod's fuel supplies the tension. Add camera rotation.

### 2.2 Builderment (mobile-first; iOS, Android, then Steam)
- Infinite resource nodes with **extractors**; conveyors, underground belts and splitters; final goods go to a **research lab** that unlocks techs; **coal and nuclear plants speed up nearby machines but are not required** (power is a booster, not a gate). Deconstruction refunds **100%** ([Builderment press kit](https://builderment.com/press/), [Google Play](https://play.google.com/store/apps/details?id=com.builderment.builderment&hl=en), [MiniReview](https://minireview.io/simulation/builderment)).
- **Touch UX:** a **long-press select tool** lets you "mass upgrade, configure, copy, rotate… as many buildings as you want simultaneously". Player blueprints can be shared ([TouchArcade GOTW, Jun 2021](https://toucharcade.com/2021/06/11/toucharcade-game-of-the-week-builderment/)).
- **Complaints:** long belts need constant zooming and "finger-spamming", and there is **no minimap** ([Steam reviews](https://steamcommunity.com/app/2414110/reviews/?browsefilter=toprated)).
- **It is deliberately not idle:** nothing happens while the game is closed ([Builderment FAQ](https://builderment.fandom.com/wiki/FAQ:_Can_the_game_run_while_not_playing%3F)).
- **Lessons:** power as an optional speed boost; full refunds encourage experimenting; long-press multi-select. Long-distance placement needs auto-routing or endpoint pairs.

### 2.3 Mindustry (Android and iOS; 5M+ Android downloads)
- 5,000,000+ Android downloads; free on Android, and cheap with no ads or IAP on iOS ([AppBrain](https://www.appbrain.com/app/mindustry/io.anuke.mindustry), [TapTap](https://www.taptap.io/app/142802)).
- **Mobile input:** `MobileInput` relies on context-sensitive taps, **edge panning** while dragging, and line placement. The build plan queue can be edited on the fly: confirm a plan, cancel it, or rotate it ([Mindustry docs](https://mindustrygame.github.io/docs/mindustry/input/MobileInput.html), [DeepWiki input](https://deepwiki.com/Anuken/Mindustry/5-input-and-control)).
- **Fat-finger evidence:** "On a phone, it is extremely easy to accidentally press a block one to the left instead… frustrating when attempting to place a line of blocks." This led to a request for **confirmation before line placement** ([Issue #118](https://github.com/Anuken/Mindustry/issues/118)). There is also a request to "start building instantly (option)" ([Suggestion #1033](https://github.com/Anuken/Mindustry-Suggestions/issues/1033)), so experts want a way to skip confirmation.
- **Schematics:** select an area, then paste or save it, with **rotate and flip** ([DeepWiki schematics](https://deepwiki.com/Anuken/Mindustry/5.2-building-and-schematic-system)).
- **Logistics vocabulary:** Router (splits 3 ways), Sorter (filter), Overflow/Underflow gates, Junction (crossing), Bridge Conveyor (crosses a 3-tile gap), Unloader (pulls from storage), Mass Driver. The **titanium conveyor moves 11 items/s**. The **plastanium conveyor moves items in batches of 10 for about 40 items/s** (compression!). An item can pass through at most 2 adjacent sorters or gates, to stop instant-teleport chains ([Plastanium](https://mindustry-unofficial.fandom.com/wiki/Plastanium_Conveyor), [Titanium](https://mindustry-unofficial.fandom.com/wiki/Titanium_Conveyor), [Bridge](https://mindustry-unofficial.fandom.com/wiki/Bridge_Conveyor), [transport guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3031727399)).
- **Lessons:** plan, confirm, and allow an instant mode; edge-pan while dragging; a Router with several modes beats separate blocks; batch compression for high throughput.

### 2.4 Shapez (mobile port) and Shapez 2
- **Shapez Mobile** was published by Playdigious on 5 Dec 2023. The first 7 levels are free and $4.99 unlocks the rest. It is **touch-only**: no controller, mouse or pencil ([TouchArcade](https://toucharcade.com/2023/09/19/shapez-mobile-release-date-elegant-factory-building-game-iphone-android-preorder-price-playdigious/), [Pocket Gamer](https://www.pocketgamer.com/shapez/launches-on-mobile/), [Help Center](https://playdigious.helpshift.com/hc/en/18-shapez/faq/233-does-shapez-have-controller-support/)).
- **App-store complaints** about the mobile port: two-finger gestures are buggy, laying belts over long distances is hard, belt orientation is finicky, copy/paste is unreliable, and the clunky touch UI makes building slow ([App Store](https://apps.apple.com/au/app/shapez-factory-game/id6450830779), [Google Play](https://play.google.com/store/apps/details?id=com.playdigious.shapez)). **These are exactly the failure modes HoleFactory must design out.**
- **Shapez 1 belt planner** (Update 1.1.15, 17 Jun 2020): Shift+drag places an **L-shaped run** with a green preview, and **R flips which leg comes first** ([Steam news](https://store.steampowered.com/news/app/1318690/view/2444840173638171895), [SteamDB](https://steamdb.info/patchnotes/5178367/)).
- **Shapez 2:** belts **face the direction of the drag** automatically (Alt reverses, Ctrl disables). **Anchors** pin a waypoint mid-drag. There are **3 build floors** joined by **lifts**. Space belts carry **3 independent rows**. **Train launchers and catchers** are placed by dragging from launcher to catcher, with a 1–4 tile gap ([Conveyor Belt wiki](https://shapez2.wiki.gg/wiki/Conveyor_Belt), [Shapez fandom Belt](https://shapezio.fandom.com/wiki/Belt), [Trains](https://shapez2.wiki.gg/wiki/Trains), [5gamers space platforms](https://5gamers.com/en/shapez-2/mechanic/space-platforms)). Its **multi-threaded simulation is up to 40× faster** (v0.0.9); see Devlog 027 "Improving the Simulation" ([Steam devlog](https://steamcommunity.com/games/2162800/announcements/detail/4469355336712585839), [Changelog](https://shapez2.wiki.gg/wiki/Changelog)).
- **Lessons:** drag-direction auto-orientation, an L-planner with a flip button, anchors become "waypoint taps", and drag-placed endpoint-pair transport (launcher/catcher) is the right model for lifts and tubes.

### 2.5 Factory Inc. (PLAYHARD; idle-tycoon hybrid)
- Launched 18 Dec 2018. Has 20+ machines in tiers and offline play. Rated 4.7 on iOS and 4.4 on Google Play (about 230K reviews). Common complaints: **ads for nearly every action** and forced pop-ups ([Google Play](https://play.google.com/store/apps/details?id=com.playhardlab.factory&hl=en_US&gl=US), [App Store](https://apps.apple.com/us/app/factory-inc/id1437875046), [Game Solver](https://game-solver.com/factory-inc/)).
- **Lessons:** linear production lines read well on a portrait phone, and "collect while away" brings players back. But ad-gating every action is the top complaint, so avoid it.

### 2.6 Factorio on Nintendo Switch (controller and touch)
- FFF #370: the port started around Feb 2021. The team **refused to dumb down the GUI** and kept it keyboard-and-mouse-first. The controller uses **free cursor vs auto cursor** modes (auto snaps to entities), and **a touch on the screen jumps the cursor to that spot**. Keyboard/mouse GUI items moved into a **radial "Quick panel"** opened by holding L. Pipette is on B ([FFF #370](https://factorio.com/blog/post/fff-370), [Quick panel](https://wiki.factorio.com/Quick_panel), [Switch version](https://wiki.factorio.com/Nintendo_Switch_version)).
- **Criticism:** right-stick belt placement "often" lands "not quite where intended", and the UI is "clearly a slightly modified window-based interface". On Switch 2, Joy-Con mouse mode is praised ([Savior Gaming](https://saviorgaming.blog/2022/10/28/factorio-nintendo-switch-review/), [forum feedback](https://forums.factorio.com/viewtopic.php?t=103910), [Nintendo Insider](https://www.nintendo-insider.com/factorio-switch-2-review-upgrade-edition-space-age/)).
- **Lessons:** snapping cursors (auto cursor) and radial menus work. Porting a desktop window UI to small screens does not.

### 2.7 Automation Empire (PC)
- Transport tiers are mine carts, drones, trucks, trains and cargo rockets, with carts you add per train ([First impressions](https://blog.rectorsquid.com/automation-empire-first-impressions/), [Steam discussions](https://steamcommunity.com/app/1112790/discussions/0/1661194916739967938/)).
- **Criticism:** once you find the optimal layout, "the rest of the game is spent rebuilding the same build over and over again with **lack of easy design replication**" ([Steam reviews](https://steamcommunity.com/app/1112790/reviews/?browsefilter=toprated)).
- **Lessons:** **copy/paste and blueprints are not optional.** Cart-and-train logistics fit the "cargo rail" fantasy of a mine.

### 2.8 Infinifactory (Zachtronics; 3D, first-person)
- Blocks: conveyors, rotators, **lifters**, welders, pushers, sensors, and so on. **Unsupported blocks fall**, which was needed to make 3D conveyors work ([Wikipedia](https://en.wikipedia.org/wiki/Infinifactory), [Game Developer](https://www.gamedeveloper.com/design/-i-infinifactory-i-and-the-next-generation-of-the-i-minecraft-i-genre-)).
- **Lessons:** gravity as a readable rule ("things fall, lifting costs") makes 3D logistics understandable. That supports the HoleFactory principle "down is free, up costs". Full free-form 3D building is too fiddly for touch.

### 2.9 Satisfactory (PC/console, first-person 3D)
- **Conveyor Lifts** are the vertical counterpart of belts. Lift Mk.1–Mk.6 carry 60 / 120 / 270 / 480 / 780 / 1200 items/min, and Mk.1 spans 7–51 m of height ([Conveyor Lifts wiki](https://satisfactory.wiki.gg/wiki/Conveyor_Lifts)).
- **Node purity** multiplies the miner rate: impure 0.5×, normal 1×, pure 2×, so a Miner Mk.1 gives 30/60/120 per min ([Miner wiki](https://satisfactory.wiki.gg/wiki/Miner)).
- **Power Shards** each add 50% to the clock-speed cap, up to 3 per machine (250%). You first get them by **hunting Power Slugs out in the world**. That is an exploration reward that boosts automation ([Power Shard](https://satisfactory.wiki.gg/wiki/Power_Shard)).
- **Space Elevator:** 5 project phases that each demand large deliveries of crafted parts, for example Phase 2 needs 1,000 Smart Plating, 1,000 Versatile Framework and 100 Automated Wiring ([Space Elevator](https://satisfactory.wiki.gg/wiki/Space_Elevator)).
- **Lessons:** purity-rated nodes (the pod's survey finds the purity); exploration pickups that overclock machines (the pod finds "Catalysts"); a milestone sink ("Deep Bore" project phases).

### 2.10 Extra references (side-view / line-drawing)
- **Mini Metro:** drag between stations to extend lines from either end. **Undo removes the latest endpoint**, and Clear rebuilds a line ([minimetro.io](https://minimetro.io/)). **Mini Motorways** swapped free drawing for a grid "build mode" with a "trash mode". Reviewers complain there is **no way to undo a deletion** ([Wikipedia](https://en.wikipedia.org/wiki/Mini_Motorways), [Steam](https://steamcommunity.com/app/1127500/discussions/0/3191360100924201389)).
- **Oxygen Not Included** (side-view colony sim with conveyor rails, loaders and auto-sweepers, plus gravity) is the closest existing **vertical cut-away logistics** reference **(unverified details; not researched online)**.

---

## 3. Keep / simplify / cut for a phone screen

| Factorio mechanic | Verdict | HoleFactory version | Why |
|---|---|---|---|
| Belts | **Simplify** | **Single lane.** 3 tiers. Auto-orient on drag. Auto-junction when crossing another belt. Underground they run **horizontally along floors** only. | Two lanes and sideloading are expert-only and impossible to read at phone size. Builderment, Shapez, Mindustry and Satisfactory all use single lanes. |
| Underground belts | **Replace** | **Junction** (auto) on the surface. Underground: **Pneumatic Tube** (an endpoint pair that passes through rock). | Crossings are auto-inserted. Long tube jumps solve "get through rock without digging". |
| Splitters + filters + overflow | **Merge** | One **Router** with modes: Even / Overflow / Filter(item). | One block and one tap-to-cycle, like Mindustry's gates and LRL's ratio splitters. |
| Inserters | **Cut** | Machine **ports** connect straight to belts. Storage has a built-in **unload port**. | Halves the entity count and the taps. Inserter timing puzzles are not the point here. |
| Mining drills on finite patches | **Keep, with a twist** | **Auto-Drill on a surveyed Lode** (infinite, purity-rated). Scattered mineral tiles stay **pod-only**. | Keeps Motherload's pod mining whole. The pod finds lodes and the factory works them. |
| Furnaces (auto-recipe) | **Keep** | **Smelter** picks its recipe from the input automatically. | Zero setup taps. |
| Assemblers | **Keep** | **Assembler.** Recipe chosen from a big-icon picker. 1–3 inputs. | Core of the genre. |
| Power poles / wires | **Simplify** | v1: **global power pool** plus **Depot service radius** underground. No poles. | Pole placement is tedious on touch. Builderment shows power can be a booster. |
| Fluids / pipes | **Cut** | Fuel and gas travel as **canisters** on belts. | Pipes double the build layers. |
| Research with science packs | **Simplify** | Unlocks come from **cash + crafted components + pod-found Schematics** (salvaged from artifacts and depth milestones). No lab. | Motherload's shop is the progression spine. Satisfactory's hard-drive idea fits the pod. |
| Blueprints | **Keep (lite)** | Rectangle select → copy / rotate / flip → paste. 6–12 saved layouts. Mass upgrade. | Automation Empire shows what happens without them. |
| Parametrised blueprints, blueprint books | **Cut** | — | Power-user depth with low mobile value. |
| Logistic bots | **Late-game, simplified** | **Drone Bay** at a Depot builds ghost plans inside the Depot's radius. No requester-chest economy. | Gives late-game construction automation; the pod still has to set up each Depot. |
| Circuit network / combinators | **Cut** | At most, a Router "Filter: when Silo > 90% → overflow" toggle **(proposed, v2)**. | Too much UI for phones. |
| Trains + signals | **Simplify** | **Cargo Rail**: point-to-point carts between Depots and stations. No signals; one cart per line per tier. | The bulk-haul fantasy without signal logic. |
| Enemies, pollution, quality, modules | **Cut** (modules → **Catalysts** found by the pod) | Hazards come from the **world** (lava, gas, quakes), not enemies. | Keeps Motherload's danger profile. |
| Handcrafting | **Cut** | The pod never crafts; it buys kits or the factory makes them. | Avoids a second inventory UI. |

---

## 4. Touch UX specification (recommendations)

### 4.1 Input modes and gesture arbitration
- **Two top-level modes: Drive** (pod controls: virtual stick plus drill direction) and **Build** (a toggle button, or automatic when the pod docks at a Depot or surface pad). Factorio's Switch port separates cursor modes the same way; mixing driving with fine building on one screen invites errors.
- **When a build tool is armed:** a **one-finger drag** draws or places. **Two fingers** always pan and pinch the camera. **When no tool is armed:** one finger pans; tap selects; long-press (500 ms) opens multi-select.
- **Second-finger grace window:** hold off committing a one-finger stroke for about **100 ms** or until it moves **8–10 pt** **(proposed)**. If a second finger lands inside that window, cancel the stroke and treat it as a camera gesture. This kills the "pinch accidentally laid a belt" bug that Shapez Mobile users report.
- **Edge auto-pan** while dragging within about 40 pt of the screen edge (Mindustry). Stay out of the iOS home-indicator and system-edge zones. Natively, defer system edge gestures; on the web, use `touch-action: none` on the canvas **(platform details unverified)**.
- **Thresholds (proposed):** tap is under 200 ms and under 10 pt of movement; long-press is 500 ms with a haptic tick on native iOS; double-tap on a building opens its panel; two-finger tap means **undo** (Procreate-style convention, **unverified**, optional).

### 4.2 Precision ("fat finger") toolkit
1. **Build zoom floor:** when a tool is armed, the camera eases to a zoom where **1 tile ≥ 44 pt** (Apple HIG minimum target). Aim for about 52–56 pt on phones ([HIG/WCAG summary](https://testparty.ai/blog/wcag-target-size-guide), [TetraLogical](https://tetralogical.com/blog/2022/12/20/foundations-target-size/); Material uses 48 dp).
2. **Ghost and confirm:** every placement is first a translucent **plan**. A floating **✓ / ✗ / ↻ (rotate) / ⇋ (flip)** bar appears near the last touch, away from the thumb. Add a setting for **"Instant build"** (Mindustry Issue #118 and Suggestion #1033).
3. **Lifted cursor and loupe:** while dragging, draw the target tile **about 1 tile above the fingertip** with a small magnifier loupe, like iOS text selection, so the finger never hides the target.
4. **Port snapping:** belt endpoints within 1 tile of a compatible port snap to it. Lift and tube endpoints snap to valid shaft cells only. Invalid cells show red with a reason ("Needs excavated space", "Out of Depot range").
5. **Nudge arrows** on a selected ghost or building move it one tile at a time without re-dragging.
6. **Undo/redo is always on screen** (bottom-left, 50+ steps). It covers placements, deletions, rotations, recipe and filter changes, and pastes as single steps; FFF #412 showed that blueprint undo must revert settings too. **Deletions are undoable**, unlike Mini Motorways.
7. **100% refund on deconstruct** (Builderment), so mistakes cost nothing.

### 4.3 Belt and path placement
- **Drag-to-path:** belts face the drag direction and **auto-corner**, as in Shapez 2. Crossing an existing belt **auto-inserts a Junction**.
- **L-planner:** for long straight runs, drag from start to end to get an L-shaped ghost, with a **flip-leg button** (Shapez 1 "R").
- **Waypoint taps:** tapping during a drag drops an **anchor** (Shapez 2), so a finger can rest and continue.
- **"Route to…" (auto-path):** tap a source port, then a destination port or a Depot. A* lays a ghost path through **excavated cells only**, preferring existing shafts, and shows the cost. This fixes Builderment's long-belt complaint. Underground, add a one-tap **"Lift to surface / Lift to Depot"** action on any drill or Depot.
- **Endpoint pairs** for Lift, Tube and Rail: place end A, then drag or tap end B (Shapez 2 launcher/catcher style). The ghost shows length, throughput, cost and power.

### 4.4 Selection, copy/paste, blueprints, bulk actions
- **Long-press then drag** draws a selection rectangle (Builderment). The contextual bar offers **Copy / Cut / Delete / Rotate / Flip / Upgrade tier / Save as Blueprint**.
- **Paste:** the ghost follows the camera centre (not the finger) and the player taps ✓. Two-finger pan and pinch stay available while pasting.
- **Bulk delete:** a "Bulldozer" tool. Drag a rectangle; only buildings get selected, and an optional filter chip keeps "belts only".
- **Blueprint library:** 6 slots at first, more through progression, each with a thumbnail. Optional share code **(v2)**.

### 4.5 Menus, hotbar, information
- **Bottom sheet build menu** with 4–5 category tabs (Logistics, Extraction, Processing, Power, Utility) and big icons with tier pips. Place it in the **thumb zone**. Locked items show what unlocks them ("Find a Lode Schematic below 1,200 ft").
- **Hotbar:** 5 recent or pinned slots above the sheet. **Radial quick menu** on long-press of the build button (Factorio Switch Quick panel).
- **Status icons** above every machine: no input, output blocked, no power, out of Depot range, damaged. An **overlay toggle** (Factorio "alt-mode" equivalent) shows recipe icons, flow arrows, and **items/min on every lift, tube and belt line**, with bottlenecks tinted red.
- **Mini-map / depth ruler:** a vertical ruler on the right edge showing the pod, Depots and lift lines. Tap to jump the camera there. This fixes Builderment's missing-minimap complaint and suits a vertical world.
- **Inspect panel:** half-height sheet with the recipe, rates (actual / max), input and output buffers, and Upgrade and Delete buttons.

### 4.6 Camera
- **True 3D orthographic camera at isometric angles** (about 30–35° pitch, 45° yaw), with **90° rotation snaps** via a button. Little Rocket Lab's fixed camera drew complaints.
- **Two framing presets:** **Surface** (top-down isometric plateau, LRL-like) and **Cut-face** (camera looks at the vertical cross-section, pitched slightly down, following the pod). The transition is a smooth dolly when the pod crosses the surface line.
- **Orientation:** a vertical world fits **portrait**. Recommend portrait-first with landscape support (open question).

---

## 5. Simulation performance techniques (for iPhone-class devices)

| Technique | Where it comes from | How HoleFactory should use it |
|---|---|---|
| **Fixed simulation tick, decoupled from render** | Factorio 60 UPS; Fiedler, "Fix Your Timestep" accumulator plus interpolation ([Gaffer on Games](https://gafferongames.com/post/fix_your_timestep/)) | **Factory tick 20 Hz (50 ms)**; pod physics 60 Hz; render at 60/120 Hz (ProMotion) with interpolation **(proposed)**. Low-power mode drops render to 30 fps without changing the sim. |
| **Transport-line segments with gap encoding** | FFF #148 (merge belts into segments in contiguous memory, shift the segment offset instead of each item); FFF #176 (store **distances between items**, so only the end gaps change; **5–10× faster**; undergrounds join one long line) ([FFF #176](https://www.factorio.com/blog/post/fff-176), [FFF #148](https://www.factorio.com/blog/post/fff-148)) | Each connected belt chain is one `TransportLine {items[], gaps[], headGap, tailGap}`. A fully compressed moving line costs O(1) per tick. Rebuild lines only when building. |
| **Timed queues for lifts, tubes and rails** | Derived from the segment idea | A vertical lift of height H is a **ring buffer of (itemId, exitTick)** with capacity = H × density. The sim never moves items spatially; the renderer animates buckets by **scrolling a texture**. Each item costs O(1) when it enters and when it leaves. |
| **Sleep/wake entities** | FFF #67: idle inserters sleep and get woken by belt or chest events; 6/7 asleep nearly **doubled UPS** ([FFF #67](https://www.factorio.com/blog/post/fff-67)) | Machines run as **event-scheduled state machines**: on craft start, schedule completion at tick T in a **timing wheel**. Starved or blocked machines sleep and subscribe to their input or output line. Working machines are not polled every tick. |
| **Network-level aggregation** | FFF #416 fluids as segments, one buffer per segment ([FFF #416](https://www.factorio.com/blog/post/fff-416)); power satisfaction per network | **Power:** one global (or per-Depot) satisfaction ratio computed once per tick. **Depot storage:** one inventory shared by all of a Depot's ports. |
| **Item compression** | LRL crates of 15; Mindustry plastanium batches of 10 (≈40/s); Factorio 2.0 belt stacks up to 4 | **Crate Packer**: 15 identical items → 1 crate. Lifts, tubes and rails carry crates as single entries, so **sim cost falls about 15×** and players see a throughput upgrade. |
| **Steady-state abstraction (off-screen LOD)** | Rate-based closed-form simulation from idle games ([geekextreme](https://www.geekextreme.com/idle-games-offline-progression-math/), [edvins.io](https://edvins.io/rebuilding-the-welcome-back-mechanic-from-idle-games-in-react)) | When a production chain away from the camera has had unchanged inputs and outputs for N seconds, **freeze it into a rate model**: per-item flow = min(bottleneck). Add to buffers analytically. Re-expand to full sim when the camera or pod comes near, or when an event happens (quake, power change, storage full). |
| **Determinism** | Factorio lockstep ([explainer](https://pingpackettest.com/game/factorio)) | **Integer / fixed-point** sim math, a seeded PRNG, and stable update order (sorted entity IDs). Benefits: reproducible bug reports, replay-based regression tests, cheat-resistant saves, a way into future async co-op, and offline catch-up that is consistent by construction. |
| **Multithreading** | Shapez 2: multi-threaded sim **up to 40×** ([Changelog](https://shapez2.wiki.gg/wiki/Changelog)); Factorio 1.1 multithreaded belts ([FFF #364](https://factorio.com/blog/post/fff-364)) | Run the factory sim on a **worker thread** (a Web Worker on web, a job or thread natively). Send a compact per-frame render snapshot (typed arrays). Underground depth bands are natural parallel islands. |
| **Data-oriented layout** | General | Struct-of-arrays, typed arrays, 32×32 tile chunks, no per-item objects. Instanced rendering for belt items, with items drawn only inside the view frustum. |
| **Offline / idle progress** | Idle-game convention: elapsed × rate, often at **~50% efficiency**; closed-form 24 h in about 100–300 ms ([geekextreme](https://www.geekextreme.com/idle-games-offline-progression-math/)). Builderment chose **no** offline progress. | **(Proposed)** On resume: gaps under 10 min, fast-forward the real sim headless in a worker. Longer gaps: closed-form rates at **50–75% efficiency, capped at 8 h**, and **capped by Silo/Depot storage**. Goods pile up and **do not auto-convert to cash** unless an Export Terminal is built. Show a "While you were away" card. Save on app background or `pagehide`, because iOS suspends apps and tabs. |
| **Budgets (proposed)** | — | Target A13 (iPhone 11) or newer: **≤ 2 ms per factory tick**, ≤ 2,000 buildings, ≤ 10,000 live item entries (crates count as 1), 60 fps at 3–4 W. Treat these as starting numbers to profile against. |

---

## 6. HoleFactory factory proposal (vertical-specific)

### 6.1 World structure: "diorama cut-away"
- **Surface plateau (top face of the diorama):** a wide top-down isometric build field, about 48×24 tiles to start, expanded with purchased **plots** (LRL's town planner). It holds Motherload's shops (Fuel, Mineral Processor, Upgrades, Repair) and **all processing**: Smelters, Assemblers, Gem Cutter, Refinery, Pod Works, Power, Export Terminal, Silos, belts in any direction.
- **Underground (front cut-face):** Motherload's vertical slice (x × depth) shown with a few tiles of visual thickness. Gameplay is 2D; the look is 3D. Factory pieces here are limited to **extraction and vertical logistics**: Auto-Drill, Gas Tap, Geothermal Tap, Chute, Lift, Pneumatic Tube, Cargo Rail, Depot, Crate Packer, Shoring, and short horizontal belts on floors.
- **Placement rule underground:** buildings need **excavated cells** (dug out by the pod) and a **solid floor** under them, and they must sit inside a **Depot's service radius** (8 tiles, **proposed**). Tubes are the exception: their two ends need excavated cells, but the tube passes through rock.
- **Gravity rule:** items **fall freely** down Chutes and through empty shafts; moving them **up** needs a Lift, Tube or Rail. The UI shows this with up-arrows (costly, powered) and down-arrows (free).

### 6.2 Building roster (20 buildings; ★ = MVP set of 8)

| # | Building | Where | Size | Function | Throughput / numbers **(proposed)** | Unlock |
|---|---|---|---|---|---|---|
| 1 ★ | **Conveyor** (Mk I/II/III) | Surface (any dir.); underground (horizontal on floors) | 1×1 | Single-lane belt; auto-corner; auto-junction on crossing | 60 / 120 / 240 items/min | Start of factory phase |
| 2 ★ | **Router** | Both | 1×1 | Modes: Even split (2–3 outputs), Overflow, Filter (item) | Pass-through at line speed | With Conveyor |
| 3 | **Gravity Chute** | Underground | 1×N vertical | Drops items straight down to the building or line below; no power | 300 items/min; free | Early |
| 4 ★ | **Bucket Lift** | Underground → surface | Foot 2×1 + Head 2×1 (endpoint pair) + 1-wide excavated shaft | Carries items **up**. Length = shaft height. Head must sit at a Depot, on the surface, or on a floor. | Mk I 30 / Mk II 90 / Mk III 240 items/min; power 1 kW per 10 tiles of height | First lode |
| 5 | **Pneumatic Tube** | Underground | 1×1 ends (pair) | **Any direction, through rock** (no digging). Bridges hazards and undrillable rock. | 60 items/min; range 12 / 24 / 48 tiles by tier; high power (5 kW) | Mid (Schematic found below about 1,750 ft, where undrillable rock starts) |
| 6 | **Cargo Rail + Skip Cart** | Underground tunnels | 1-wide track; stations at Depots | Point-to-point bulk haul of **crates only**; slopes allowed; one cart per line per tier | 4-crate cart (60 items/trip); speed 3 / 6 tiles/s | Late |
| 7 ★ | **Depot** | Underground (and a surface HQ variant) | 3×2 | Forward base: 200-item buffer; **pod dock** (unload cargo, refuel from stored Fuel Canisters, repair with Repair Kits); **service radius 8** (power and build zone); later hosts a Drone Bay | Hub of the underground network | First lode (one free) |
| 8 | **Crate Packer** (toggle: Pack / Unpack) | Both | 1×2 | 15 identical items ↔ 1 crate (LRL-style compression) | 4 crates/min per Packer Mk I | Mid |
| 9 ★ | **Export Terminal** | Surface | 2×2 | Auto-sells at Mineral Processor prices; 50-item buffer; small fee (5%) so pod sales still feel best | Unlimited speed | Start of factory phase |
| 10 | **Silo** | Surface | 2×2 | 1,000-item storage; caps offline accumulation; has an unload port | — | Early |
| 11 ★ | **Auto-Drill** (Mk I/II/Heat-Shielded) | Underground, on a **surveyed Lode** | 2×2 | Extracts the lode's mineral endlessly; rate × purity (Impure 0.5 / Normal 1 / Rich 2, Satisfactory-style) | Mk I 15/min base; Mk II 30/min; Heat-Shielded needed below about 3,000 ft (lava band) | First lode |
| 12 | **Gas Tap** | Underground, on a **capped gas pocket** | 2×2 | Turns a Motherload hazard (gas pocket) into a resource: Gas Canisters | 6 canisters/min | Below about 4,750 ft |
| 13 ★ | **Smelter** | Surface | 2×2 | **Auto-recipe** from input (2 ore → 1 ingot) | 4 s per ingot | Start of factory phase |
| 14 ★ | **Assembler** | Surface | 2×2 | Player-set recipe, 1–3 inputs | Recipe time ÷ speed (Mk I 1×, Mk II 2×) | Start of factory phase |
| 15 | **Gem Cutter** | Surface | 2×2 | Cuts **pod-delivered** gems into Cut Gems (worth more; also needed for top-tier parts) | 20 s per gem | Mid |
| 16 | **Refinery** | Surface or Depot | 2×2 | Coalite or Gas → **Fuel Canisters**, which supply the pod's fuel at Depots and power | 2 Coalite → 1 canister (8 s) | Early-mid |
| 17 | **Pod Works** | Surface | 3×3 | Crafts **pod-upgrade components** and consumables (Repair Kits, Dynamite, Catalyst housings) | Recipe-based | Early-mid |
| 18 | **Power Plant** | Surface | 2×2 | Burns Fuel Canisters (or Solar variant: weak but free) → adds to the global power pool | 20 kW burner / 6 kW solar | Early-mid |
| 19 | **Geothermal Tap** | Underground, on a **lava pocket** | 2×2 | Turns the lava hazard into large amounts of power; needs heat shielding; damaged by quakes | 80 kW | Below about 3,000 ft |
| 20 | **Shoring Frame** | Underground | 1×3 | Protects a 5×5 area from **earthquake** cave-ins (Motherload quakes begin at 1,000 ft) | — | Early-mid |
| (late) | **Drone Bay** (Depot module) | Depot | — | Construction drones build ghost plans **within the Depot radius** (simplified construction bots) | 2–6 drones | Late |

**MVP (first playable factory):** Conveyor, Router, Bucket Lift, Depot, Auto-Drill, Smelter, Assembler, Export Terminal. That is 8 buildings, plus Silo if offline progress ships.

### 6.3 Resources and starter recipe tree

**Raw minerals (Motherload Flash values):** Ironium $30, Bronzium $60, Silverium $100, Goldium $250, Platinum $750, Einsteinium $2,000, Emerald $5,000, Ruby $20,000 (80 kg, from ~3,187 ft), Diamond $100,000 (100 kg, ~4,000 ft), Amazonite $500,000 (120 kg, ~4,812 ft) ([Kongregate wiki](https://kongregate.fandom.com/wiki/Motherload), [Motherload Minerals](https://motherload.fandom.com/wiki/Minerals), [Amazonite](https://motherload.fandom.com/wiki/Amazonite)). Weights for the lower minerals are **(unverified)**.
**New HoleFactory resources (proposed):** **Coalite** (fuel ore, $10, shallow lodes), **Gas** (from capped gas pockets), **Lava heat** (power only).

**Which resources can be drilled (lodes) and which are pod-only:**
- Lodes (factory can automate): Coalite, Ironium, Bronzium, Silverium, Goldium; Platinum (deep, Impure only); Einsteinium (deep, Impure only, heat-shielded drill).
- **Pod-only, never on lodes:** Emerald, Ruby, Diamond, Amazonite, plus artifacts. This keeps Motherload's jackpot loop entirely in the pod's hands.

**Tier 1 — Smelter (2 ore → 1 ingot, 4 s):**
| Output | Input | Sell price **(proposed)** | Uplift vs raw |
|---|---|---|---|
| Iron Ingot | 2 Ironium ($60) | $80 | 1.33× |
| Bronze Ingot | 2 Bronzium ($120) | $160 | 1.33× |
| Silver Ingot | 2 Silverium ($200) | $260 | 1.3× |
| Gold Ingot | 2 Goldium ($500) | $650 | 1.3× |
| Platinum Ingot | 2 Platinum ($1,500) | $1,900 | 1.27× |
| Einsteinium Rod | 2 Einsteinium ($4,000) | $5,000 | 1.25× |

**Tier 2 — Assembler:**
| Output | Recipe | Time | Sell **(proposed)** | Used for |
|---|---|---|---|---|
| Gear ×2 | 1 Iron Ingot | 3 s | $50 each | Motors, Drill Heads, Lift Mk II |
| Bronze Wire ×3 | 1 Bronze Ingot | 3 s | $65 each | Circuits, Power Plant |
| Hull Plate | 2 Iron Ingot + 1 Bronze Ingot | 6 s | $420 | **Pod hull upgrades**, Repair Kits, Depots |
| Circuit | 3 Bronze Wire + 1 Silver Ingot | 8 s | $650 | Pneumatic Tube, Drone Bay, pod Radiator |
| Gold Contacts ×4 | 1 Gold Ingot | 4 s | $200 each | Advanced Circuit |
| Fuel Canister (Refinery) | 2 Coalite **or** 1 Gas | 8 s | $40 | **Pod refuel at Depots**, Power Plant |

**Tier 3 — Assembler / Pod Works:**
| Output | Recipe | Sell **(proposed)** | Used for |
|---|---|---|---|
| Motor | 2 Gear + 1 Circuit + 1 Hull Plate | $1,600 | **Pod Engine upgrades**, Lift Mk II/III, Skip Cart |
| Advanced Circuit | 2 Circuit + 2 Gold Contacts | $2,200 | Pod scanner, Drone Bay, Tube Mk III |
| Drill Head | 1 Platinum Ingot + 2 Gear | $2,400 | **Pod Drill upgrades**, Auto-Drill Mk II |
| Repair Kit | 2 Hull Plate + 1 Circuit | (not sold) | Pod repair at Depots; repairs quake-damaged buildings |
| Dynamite | 1 Coalite + 1 Bronze Wire | (not sold) | Pod consumable: clears undrillable rock (Motherload consumable) |
| Fuel Cell | 1 Einsteinium Rod + 1 Hull Plate | $6,500 | **Pod fuel-tank / energy upgrades**, Geothermal Tap |
| Cut Emerald / Ruby / Diamond (Gem Cutter) | 1 raw gem (pod-delivered) | 1.5× raw | Lens, Diamond Bit, endgame |
| Laser Lens | 1 Cut Ruby + 1 Gold Ingot | — | Pod laser drill (top tier), Tube Mk III |
| Diamond Bit | 1 Cut Diamond + 1 Drill Head | — | Pod top drill, Heat-Shielded Auto-Drill |

**Tier 4 — Milestone sink ("Deep Bore" project, Satisfactory Space-Elevator style, proposed):** 4 phases delivered to a surface Bore Rig. Example: Phase 1 = 100 Hull Plate + 50 Motor; Phase 2 = 200 Circuit + 50 Drill Head + 20 Fuel Cell; Phase 3 = 30 Laser Lens + 10 Diamond Bit; Phase 4 = 1 **Amazonite Core** (1 Amazonite + 10 Fuel Cell + 10 Advanced Circuit). Each phase unlocks a new depth band, schematics, or the final descent. This mirrors Motherload's push to the bottom (the boss specifics of the original's ending are **unverified**).

**Design rule:** each processing step adds about 1.25–1.6× value, so the factory earns through **volume and time**, while the pod earns through **jackpots and risk**. Higher-tier **pod parts need crafted components plus cash**, so the factory is required even for players who only care about digging.

### 6.4 Power: decision
- **MVP: no power.** Machines just run, so new players learn belts, lifts and recipes first.
- **v1: simplified global power pool.** Generators (Power Plant on the surface; Geothermal Tap underground) add kW and consumers subtract kW. If demand is higher than supply, **every machine slows by the satisfaction ratio**, the same idea as Factorio networks but with **no poles or wires**. Underground buildings must be **inside a Depot radius** to receive power; the Depot acts as both pole and substation.
- **Twist:** lava pockets (Motherload's damage hazard from about 3,000 ft) become the best power source. The pod has to scout them and the factory has to shield them.
- **Optional (from Builderment):** power above 100% gives a **small speed bonus** (up to +25%) **(proposed)**. Building extra generation then feels like a reward rather than only a tax.

### 6.5 How the pod and the factory stay locked together

| What only the **pod** can do | What only the **factory** can do |
|---|---|
| **Excavate** cells. No dug space means nothing can be built underground, and Lift shafts must be dug. | Produce the **components that pod upgrades need** (Hull Plate, Motor, Drill Head, Fuel Cell, Laser Lens, Diamond Bit). |
| **Survey Lodes** with a scanner upgrade; purity is revealed by the scan. | **Refuel the pod at depth.** Depots dispense Fuel Canisters made by the Refinery, which extends dive range. This is the biggest interlock with Motherload's fuel tension. |
| **Carry building kits down.** Kits are bought or crafted on the surface and use **pod cargo weight**, a direct tie to Motherload's cargo upgrade. Late game, Drone Bays can build inside an existing Depot radius, but a pod has to place the Depot. | **Repair Kits** at Depots allow mid-dive repairs. |
| **Harvest pod-only minerals:** scattered Motherload mineral tiles, all gems, and artifacts. Artifacts give **Schematics** (unlocks) and **Catalysts** (overclock modules, like Satisfactory's Power Slugs). | **Bulk income** from automated lodes, which smooths out Motherload's feast-and-famine economy. |
| **Respond to hazards:** cap **gas pockets** (otherwise they can blow up nearby buildings when exposed), **clear cave-ins and repair** belts and lifts after **earthquakes** (Motherload quakes begin at 1,000 ft), and **blast undrillable rock** (from about 1,750 ft) with Dynamite to open shafts. | **Vertical transport** that frees the pod from hauling low-value ore. |
| **Deep frontier:** below the deepest Depot, it is pure Motherload: fuel, hull and cargo pressure. | **Gem Cutter** raises the value of the pod's gems, so both directions feed each other. |

**Loop by phase (proposed):**
1. **Phase A, 0–500 ft (first ~20 min):** pure Motherload. The pod digs, sells and upgrades. The surface Smelter unlocks at the first milestone; selling ingots instead of raw ore pays about 30% more, which teaches belts on the easy surface grid.
2. **Phase B, 500–1,500 ft:** the pod finds the **first Lode** (scripted Bronzium, Normal purity). The game gives a free Depot plus Drill plus a Lift kit. The player digs a shaft up (or reuses the entry shaft) and gets the first automated flow to the surface. Hull Plates and Motors are now needed for Hull and Engine Mk III.
3. **Phase C, 1,500–3,000 ft:** **forward Depots** with refuel extend dives. Shoring is needed against quakes. Undrillable rock pushes the player toward **Pneumatic Tubes**. Crate Packers come in once lifts saturate.
4. **Phase D, 3,000–5,000 ft:** the lava band needs **Heat-Shielded drills** and **Geothermal Taps**. Gas pockets: the pod caps them and **Gas Taps** turn them into fuel. Cargo Rail joins the Depots.
5. **Phase E, 5,000 ft and below:** Drone Bays, Deep Bore project phases, Amazonite hunting (pod-only) and the final descent.

**Anti-patterns to guard against (with tuning levers):**
- *The factory makes the pod pointless:* no gem lodes; deep lodes are Impure only; lift throughput caps ore income; Export Terminal fee of about 5%; target factory share **≤ 40–50% of income** at every phase **(proposed, tune in playtests)**.
- *The pod ignores the factory:* gate pod upgrade tiers ≥ Mk III behind crafted parts, and make the deep range depend on Depot refuelling.
- *Hazard frustration:* quake damage only hits **unshored** buildings, shows a clear "Damaged" icon, and repairs cost one Repair Kit each. Add a "Cozy" difficulty that turns off structure damage, keeping LRL's no-pressure feel.

### 6.6 Sim mapping for this design (proposed)
- Surface belts → **gap-encoded TransportLines**. Lifts, Tubes and Rails → **timed ring-buffer queues**. Chutes → instant with a short fixed delay. Depots → a single shared inventory.
- Machines are event-scheduled and sleep when starved or blocked. Power runs as one satisfaction pass per tick.
- **Depth bands** of 64 tiles each are independent chunks for threading and the steady-state LOD. A band with no pod nearby, no hazards and stable flows collapses to a rate model.
- Hazard events (quake, gas, lava) and pod arrival **re-expand** the band to full sim.
- Offline: closed-form rates per band, capped by Silo and Depot storage and by an 8 h cap.

---

## 7. Open questions for the user
1. **Art and camera:** Little Rocket Lab is **pixel art with a fixed isometric camera** and **is not on mobile**. Do you want true 3D low-poly with LRL-style framing and **90° camera rotation**, or a fixed camera that matches LRL exactly?
2. **Orientation:** portrait-first (fits a vertical world and one-handed menus) or landscape-first (closer to the original Flash framing and easier two-thumb driving)?
3. **World layout:** do you agree with the **hybrid** (surface plateau factory plus underground cut-face for extraction and lifts)? The alternative is building everything inside the vertical slice, Oxygen Not Included-style.
4. **Offline progress:** none (like Builderment), modest and storage-capped (recommended), or full idle?
5. **Hazards to infrastructure:** should quakes, gas and lava damage factory buildings (more pod relevance), or only threaten the pod (cozier)?
6. **Power:** happy with MVP no power, then a wireless global pool, or do you want Factorio-style poles?
7. **Monetisation:** premium (like Shapez Mobile's $4.99 unlock) or free-to-play? This decides whether offline and speed-up systems exist at all; Factory Inc.'s ad-gating is the top complaint.
8. **Platform:** web/PWA (closest to the Flash heritage; limited haptics and background behaviour on iOS) or a native or engine build (Unity, Godot) for the App Store? This affects threading and haptics.
9. **Fidelity:** keep Motherload's exact mineral list and prices and its shop names (Fuel, Mineral Processor, Upgrades, Repair), or reskin with original names for IP safety?

---

## 8. Source list (all from WebSearch result pages; WebFetch was blocked)
- Factorio: [FFF #67](https://www.factorio.com/blog/post/fff-67) · [FFF #148](https://www.factorio.com/blog/post/fff-148) · [FFF #176](https://www.factorio.com/blog/post/fff-176) · [FFF #364](https://factorio.com/blog/post/fff-364) · [FFF #370](https://factorio.com/blog/post/fff-370) · [FFF #392](https://www.factorio.com/blog/post/fff-392) · [FFF #393](https://www.factorio.com/blog/post/fff-393) · [FFF #412](https://factorio.com/blog/post/fff-412) · [FFF #416](https://www.factorio.com/blog/post/fff-416) · [FFF #421](https://www.factorio.com/blog/post/fff-421) · [Belt physics](https://wiki.factorio.com/Transport_belts/Physics) · [Underground belt](https://wiki.factorio.com/Underground_belt) · [Electric drill](https://wiki.factorio.com/Electric_mining_drill) · [Substation](https://wiki.factorio.com/Substation) · [Quick panel](https://wiki.factorio.com/Quick_panel) · [PC Gamer belt stacking](https://www.pcgamer.com/factorio-20-will-let-items-on-conveyor-belts-stack-something-long-thought-impossible/) · [Switch review](https://saviorgaming.blog/2022/10/28/factorio-nintendo-switch-review/) · [Switch 2 review](https://www.nintendo-insider.com/factorio-switch-2-review-upgrade-edition-space-age/)
- Little Rocket Lab: [Steam](https://store.steampowered.com/app/2451100/Little_Rocket_Lab/) · [Nintendo Life](https://www.nintendolife.com/games/switch-eshop/little_rocket_lab) · [MobyGames](https://www.mobygames.com/game/248835/little-rocket-lab/) · [ResetEra](https://www.resetera.com/threads/little-rocket-lab-is-an-incredible-cozy-town-sim-factory-automation-game-xb-steam-game-pass-switch-dec-10.1321141/page-2) · [Hardcore Gamer](https://hardcoregamer.com/review-little-rocket-lab/) · [Tech-Gaming](https://www.tech-gaming.com/little-rocket-lab/) · [LRL wiki Sorter](https://littlerocketlab.wiki.gg/wiki/Sorter) · [Cable Crane](https://littlerocketlab.wiki.gg/wiki/Cable_Crane)
- Builderment: [TouchArcade](https://toucharcade.com/2021/06/11/toucharcade-game-of-the-week-builderment/) · [Press kit](https://builderment.com/press/) · [FAQ offline](https://builderment.fandom.com/wiki/FAQ:_Can_the_game_run_while_not_playing%3F)
- Mindustry: [MobileInput docs](https://mindustrygame.github.io/docs/mindustry/input/MobileInput.html) · [Issue #118](https://github.com/Anuken/Mindustry/issues/118) · [Suggestion #1033](https://github.com/Anuken/Mindustry-Suggestions/issues/1033) · [DeepWiki schematics](https://deepwiki.com/Anuken/Mindustry/5.2-building-and-schematic-system) · [Plastanium conveyor](https://mindustry-unofficial.fandom.com/wiki/Plastanium_Conveyor)
- Shapez: [Mobile launch](https://toucharcade.com/2023/09/19/shapez-mobile-release-date-elegant-factory-building-game-iphone-android-preorder-price-playdigious/) · [Belt planner update](https://store.steampowered.com/news/app/1318690/view/2444840173638171895) · [Shapez 2 belts](https://shapez2.wiki.gg/wiki/Conveyor_Belt) · [Trains](https://shapez2.wiki.gg/wiki/Trains) · [Devlog 027](https://steamcommunity.com/games/2162800/announcements/detail/4469355336712585839) · [Changelog](https://shapez2.wiki.gg/wiki/Changelog)
- Others: [Factory Inc. (Play)](https://play.google.com/store/apps/details?id=com.playhardlab.factory&hl=en_US&gl=US) · [Automation Empire reviews](https://steamcommunity.com/app/1112790/reviews/?browsefilter=toprated) · [Infinifactory](https://en.wikipedia.org/wiki/Infinifactory) · [Satisfactory lifts](https://satisfactory.wiki.gg/wiki/Conveyor_Lifts) · [Miner](https://satisfactory.wiki.gg/wiki/Miner) · [Power Shard](https://satisfactory.wiki.gg/wiki/Power_Shard) · [Space Elevator](https://satisfactory.wiki.gg/wiki/Space_Elevator) · [Mini Metro](https://minimetro.io/) · [Mini Motorways](https://en.wikipedia.org/wiki/Mini_Motorways)
- Motherload: [Kongregate wiki](https://kongregate.fandom.com/wiki/Motherload) · [Minerals](https://motherload.fandom.com/wiki/Minerals) · [Shops](https://motherload.fandom.com/wiki/Shops) · [Dangers](https://xgenstudios.fandom.com/wiki/Dangers_in_game_'Motherload')
- Tech and UX: [Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/) · [Idle offline math](https://www.geekextreme.com/idle-games-offline-progression-math/) · [Target sizes](https://tetralogical.com/blog/2022/12/20/foundations-target-size/)
