# 03 — HoleFactory Mobile UX, Art & Audio (rev 2)

**Status:** design document under canon rev 2 (`docs/design/00-canon.md`), which wins on any conflict; review outcomes live in canon §8.
**Owns (canon R0b):** gestures, layouts, wireframes, pod touch controls, build-mode UX, camera behaviour on top of canon §3.4, HUD and screens, ore colour/shape/emissive codes, accessibility, art direction for both M0 looks, assets, UI language, audio direction, music stem names, the keyboard map.
**Cites:** canon §x; 01 = `01-game-design.md`; 02 = `02-factory.md`; 04 = `04-tech-architecture.md` (renderer, pass order, input and audio engines, tests). **Touch constants live only in canon §3.12**; this file names them and never restates them differently.
**Conventions:** pt = CSS px; ppu = pt per world unit; rows above / below = full mine rows between the pod's cell and the clear-rect edge at the canon anchor, truncated to 0.1. **[UX]** = overridable default (§12). Numbers: `scratchpad/rev2/ux/layout2.py`, `hud2.py`.

---

## 1. Layout system and device matrix

### 1.1 Layout rules
| Rule | Value |
|---|---|
| Viewport | `viewport-fit=cover`; root `position:fixed; inset:0`; full-bleed canvas (under a 30% ink scrim behind the status bar); DOM HUD padded by `env(safe-area-inset-*)`, re-read on every resize |
| Clear rect | Canon §3.12, from `visualViewport.height + offsetTop`, never `100dvh`, so a floating Safari toolbar never covers controls |
| HUD, control zone | Canon §3.12; ink scrim gradient 0 → 25% behind the controls **[UX]** |
| Underground ppu | Canon §3.4; Safari-tab R = 18.6 rows if H ≥ 800, else 16.2 **[UX]**; cell face = ppu × cos 20° |
| Edge exclusions | No drag starts within 24 pt of the left edge (back-swipe; right edge too when left-handed) or in inset_bottom |
| Scroll containment | Canon §3.12 Input. Sheet bodies, lists and trays are `[data-scroll]` with `touch-action: pan-y` (trays `pan-x`) and `overscroll-behavior: contain`; the `touchmove` guard also blocks at a container's boundary in the gesture direction, so the page never rubber-bands |

Classes: **Phone-P** (min side < 600, H ≥ W), **Phone-L** (min side < 600, W > H), **Tablet** (min side ≥ 600).

### 1.2 Device matrix (portrait, underground play, standalone)
Visibility rule: canon §3.4. Insets typical; the build reads `env()`.

| Device | Viewport | Insets T/B | Size | ppu / face | Above | Below total / fully clear | Above under ticker / full card |
|---|---|---|---|---|---|---|---|
| iPhone SE 2/3 | 375×667 | 20/0 | **S** | 38 / 35.7 | 5.4 | 10.4 / **6.2** | 4.5 / 3.1 |
| iPhone 12–14 | 390×844 | 47/34 | M | 41 / 38.5 | 6.3 | 12.2 / 7.0 | 5.5 / 4.2 |
| iPhone 14 Pro–16 | 393×852 | 59/34 | M | 41 / 38.5 | 6.3 | 12.1 / **6.9** | 5.4 / 4.2 |
| iPhone 16 Pro | 402×874 | 62/34 | M | 41 / 38.5 | 6.4 | 12.4 / 7.2 | 5.6 / 4.4 |
| Pro Max / Plus | 430×932 | 59/34 | M | 41 / 38.5 | 7.0 | 13.4 / 8.2 | 6.2 / 4.9 |
| Android 20:9 | 412×915 | 24/16 | M | 41 / 38.5 | 7.1 | 13.7 / 9.0 | 6.3 / 5.1 |
| Android 360 | 360×800 | 24/16 | M | 41 / 38.5 | 6.1 | 11.8 / 7.1 | 5.3 / 4.0 |
| Fold cover | ≈344×882 | 24/16 | M | 41 / 38.5 | 6.8 | 13.2 / 8.5 | 6.0 / 4.8 |
| SE, Safari tab | ≈375×548 | 20/0 | S | 32 / 30.1 | 5.1 | 9.9 / 4.9 | 4.0 / 2.4 |
| 15, Safari tab | ≈393×746 | 59/0 | M | 41 / 38.5 | 5.3 | 10.3 / 6.0 | 4.5 / 3.2 |

- While moving, a radio card is the 28-pt ticker (§6.5), so every standalone phone meets the rule; the 76-pt full card opens only when grounded and idle. At size M the SE would keep 5.8 clear rows, hence S on 667-pt phones.
- **Safari tab:** the 32-ppu floor leaves the SE 4.9 clear rows; the rule is a standalone guarantee and the install-first title (§6.7) is the mitigation.

### 1.3 Phone landscape
- **M0, MVP:** full-screen "Turn your phone upright" card with a portrait glyph; pod paused (`interrupt`), factory running (canon §4.5); back in portrait → "Tap to resume" (§3.8).
- **v1 rails** replace it ("Portrait plays best" chip once): two 88-pt rails inside the side insets (left: vertical fuel and hull bars, cargo; right: info, menu, ruler); stick zone left min(0.55 W, 300) pt; slots bottom-right. Camera canon §3.4: 3.2 above / 8.1 below, 17.5 cells between rails on 852×393. Sheets use a centred 430-pt column.

### 1.4 Tablets and foldables (v1)
UI 1.2; ppu = clamp(min(ch ÷ (18.6 cos 20°), (W − 128) ÷ (cap cos 20°)), 49.2, 64), cap canon §3.12. The rest is a **diorama frame** (cut rock + brass bezel, ≥ 64 pt a side) that holds the controls in landscape. iPad 10th: 56.6 ppu portrait (6.8 above / 13.0 below), 49.2 landscape (5.1 / 10.0). Before v1: the phone layout with the 13-tile cap, letterboxed 3:4 in landscape.

### 1.5 Handedness, control size, text scale
| Setting | Values | Effect |
|---|---|---|
| Handedness | Right / Left | Mirrors stick zone, slots, context button, ruler, dock (✓ dominant), loupe side, one-handed layout; not the HUD. Left-handed rail ≥ 24 pt from the edge |
| Control size | S / M / L | Stick radius 44/52/60; slots 56/60/64; gaps 10/12/14; context 48/52/56. M; S on 667-pt phones |
| THRUST layout | fixed | THRUST 64 left of a 2×2 cluster of 52-pt slots, gaps 12; zone unchanged |
| Text scale | 100 / 115 (MVP), 130 (v1) | HUD digits 15 pt × scale, capped 15 pt below 380-pt width, else 17 |
| Default | OS | Hidden `font: -apple-system-body` ≥ 19 px → 115%, ≥ 23 px → 130% (v1); Android root `font-size` |

### 1.6 Build order
M0: §1.1, Phone-P at 375×667 and 393×852, upright card. MVP: all Phone-P rows, handedness, sizes, text 100/115, Safari-tab ppu. v1: rails, tablets, foldables, 130%. Post: Capacitor portrait lock.

### 1.7 Risks
- Insets vary: never hard-coded; Playwright sets them per size (04).
- iOS 26 Safari's floating toolbar is unverified: `visualViewport` rect + device check (§13).
- 360-pt Android is narrower than the SE: HUD widths are specified at 360.

---

## 2. Wireframes (portrait, right-handed)
pt from the top-left. `▕` ruler rail (MVP); `░` control zone; `┄` stick-zone top (0.45 H); PC / MP / JC / PK = Pop Charge, Mega Pop, Jerrycan, Patch Kit.

### 2.1 Pod mode, iPhone SE 375×667 (S, ppu 38)
```
 x:0 24             206    274  322  351 375
 ┌────────────────────────────────────────┐ y0
 │ status bar (world under 30% scrim)     │
 ├────────┬───────┬───────┬────────┬──────┤ y20  HUD: fuel 84 · hull 68 · cargo 64 · info 83 · ≡ 44
 │F 6.0 L │✚ 10   │▣ 4    │ $1,250 │  ≡   │
 │▓▓▓▓|░░ │▓▓▓▓▓▓ │▓▓▓▓░░ │ ▼312ft │      │      | = Return Tick; cargo bar = 4 of 7 slots
 ├────────┴───────┴───────┴────────┴──────┤ y64  clear rect (603 pt, 16.9 rows)
 │ Dot · Pip's tank is nearly dry, S… ›  ▕│ y68–96 ticker
 │ −5 … −1  5.4 above (4.5 w/ ticker)    ▕│ rail x351–375, hit x331–375, y72–463
 │  0 · · · · · · ·[ PIP ]· · · · · · ·  ▕│ y275 (35% anchor)
 │ +1 … +6  6.2 rows fully clear         ▕│
 │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  ▕│ y300 spawn-zone top
 │                           ┌──────┐     │ y475–523 context 48, x274–322
 ├░░░░░░░░░░░░░░░░░░░░░░░░░░│CONTXT│░░░░░░┤ y517 zone top (S: 150)
 │░ spawn x24–206 ░░░░░░░░░░└──────┘░░░░░░│
 │░░░░░░░░░░░░░░░░░░░░░░░┌─────┐ ┌─────┐░░│ y533–589 slots 56, x237–293 / 303–359
 │░░░░( ◯ ) rest hint░░░░│ PC  │ │ MP  │░░│
 │░░░░░░░░░░░░░░░░░░░░░░░└─────┘ └─────┘░░│
 │░░░░░░░░░░░░░░░░░░░░░░░┌─────┐ ┌─────┐░░│ y599–655
 │░░░░░░░░░░░░░░░░░░░░░░░│ JC  │ │ PK  │░░│
 │░░░░░░░░░░░░░░░░░░░░░░░└─────┘ └─────┘░░│
 └────────────────────────────────────────┘ y667  4.2 rows under controls
```

### 2.2 Pod mode, iPhone 15/16 393×852 (M, ppu 41)
```
 x:0 24             216    285  337  369 393
 ├────────┬───────┬───────┬────────┬──────┤ y59  HUD: fuel 88 · hull 72 · cargo 68 · info 89 · ≡ 44
 │F 6.0 L │✚ 10   │▣ 4    │ $1,250 │  ≡   │
 │▓▓▓▓|░░ │▓▓▓▓▓▓ │▓▓▓▓░░ │ ▼312ft │      │
 ├────────┴───────┴───────┴────────┴──────┤ y103 clear rect (749 pt, 19.4 rows)
 │ goal chip "Sell at the Assay Office"  ▕│ y107–135
 │ −6 … −1  6.3 rows above               ▕│ rail x369–393, hit x349–393, y111–598
 │  0 · · · · · · ·[ PIP ]· · · · · · ·  ▕│ y365
 │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  ▕│ y383 spawn-zone top
 │ +1 … +6  6.9 rows fully clear         ▕│
 │                           ┌──────┐     │ y610–662 context 52, x285–337
 ├░░░░░░░░░░░░░░░░░░░░░░░░░░│CONTXT│░░░░░░┤ y652 zone top (M: 166 + 34)
 │░░░░░░░░░░░░░░░░░░░░░░░┌─────┐ ┌─────┐░░│ y674–734 slots 60, x245–305 / 317–377
 │░░░░( ◯ )░░░░░░░░░░░░░░│ PC  │ │ MP  │░░│ y746–806 JC / PK
 │░░░░░░░░░░░░ home indicator ░░░░░░░░░░░░│ y818–852
 └────────────────────────────────────────┘ y852  12.1 rows below in all
```
- **THRUST layout:** slots 52 at x261–313 / 325–377, y690–742 / 754–806; THRUST 64 at x185–249, y742–806; context x293–345, y626–678; ruler to y614; still 6.9 clear rows. Controls win a pointer-down over the spawn zone.
- **One-handed:** the same cluster in the dominant corner; rail x24–48 (hit x24–68); a 40% ring at the virtual origin (pod x, 596).

### 2.3 Surface build mode (pitch 55°, ≥ 39 ppu)
```
375×667                          y      393×852                             y
├────────────────────────────────┤20    ├───────────────────────────────────┤59
│ $1,250                    [◫]  │      │ $1,250      46/51 kW (v1)   [◫]   │ status only
├────────────────────────────────┤64    ├───────────────────────────────────┤103
│ ◇◇[Smelter]◇◇     ╭loupe 88╮   │      │ ◇◇[Smelter]◇◇◇      ╭loupe 88╮    │ 120 pt above,
│ ◇◇◇▶▶▶▶▶◇◇        ╰────────╯   │      │ ◇◇◇▶▶▶▶▶▶◇◇         ╰────────╯    │ non-dominant side
│ ◇◇◇◇◇◇◇▼ + cursor (lifted 44)  │      │ ◇◇◇◇◇◇◇◇▼ + cursor                │
│[⟳]◇◇◇◇◇◇◉ finger               │327   │[⟳]◇◇◇◇◇◇◇◉ finger                 │478 yaw (Yard)
│[+] Rim ══[Pump]═[Assay]══      │379   │[+] Rim ═══[Pump]═[Assay]═══       │530 zoom, x16–60
│[−]           ┌$60 · 12 tiles┐  │431   │[−]              ┌$60 · 12 tiles┐  │582 pending chip
├────────────────────────────────┤483   ├───────────────────────────────────┤634
│[✕][↶][↷] [Pan][↻][✗]  [ ✓  ]   │      │[✕][↶][↷]   [Pan][↻][✗]   [ ✓  ]   │ dock 56
├────────────────────────────────┤539   ├───────────────────────────────────┤690
│[Yard│Mine] Logistics Process → │      │[Yard│Mine] Logistics Process Sto→ │ tabs 44
│[Belt][Router][Bin][Headfr][⊡]→ │      │[Belt][Router][Bin][Headfr][⊡][…]→ │ cards 64×76, ⊡ locked
└────────────────────────────────┘667   └───────────────────────────────────┘818
```
World area: SE ≈ 9.6 × 13.1 units, 15 ≈ 10.1 × 16.6. Dock at 375: ✕ x8, ↶ x56, ↷ x104, Pan x159, ↻ x207, ✗ x255 (44 each), ✓ x311–367; +18 for the right group at 393.

### 2.4 Underground build mode (8° / 12°, ≥ 47 ppu)
```
375×667 (8.5 rows × 8.1 cells)          393×852 (10.9 rows × 8.4 cells)
├────────────────────────────────┤64    ├───────────────────────────────────┤103
│ Cargo: Belt×2 · Rail×1 · Drill │28    │ In cargo: Belt×2 · Rail×1 · Drill │ chip
│ ██ ██ ██ ║ ██ ██ ██ ██         │      │ ██ ██ ██ ║ ██ ██ ██ ██ ██         │ ║ lift ghost
│ ██ ░░ ▶▶ ▶▶ ▶▶ ░░ ██           │      │ ██ ░░ ▶▶ ▶▶ ▶▶ ░░ ██ ██           │ belt, row-locked
│ ██ ██ [DRILL] ██ ██ ██         │      │ ██ ██ [DRILL]  ██ ██ ██ ██        │ snapped to lode
│[+]██ ▓LODE▓ ██ ██ ██           │      │[+]██ ▓LODE▓▓  ██ ██ ██ ██         │
│[−]  [PIP] ┌Kits 3 needed, 2 ⚠┐ │      │[−] [PIP] frozen ┌Kits 3 needed, 2┐│
├────────────────────────────────┤483   ├───────────────────────────────────┤634
│[✕][↶][↷] [Pan]    [✗]  [ ✓  ]  │      │[✕][↶][↷]   [Pan]     [✗]   [ ✓  ] │ no ↻ underground
├────────────────────────────────┤539   ├───────────────────────────────────┤690
│[Mine│Yard] Logistics Extract → │      │[Mine│Yard] Logistics Extraction → │
│[Belt][Router][Lift][Drill][⊡]→ │      │[Belt][Router][Lift][Drill][⊡][…]→ │ Kits carried
└────────────────────────────────┘667   └───────────────────────────────────┘818
```

### 2.5 Shop sheets
Layout and content: §6.4. The sheet starts under the HUD row (y72 on the SE, y111 on the 15), so cash stays live; the body scrolls (`[data-scroll]`) and BUY is pinned (y742–806 on the 15).

### 2.6 Build order
M0: 2.1–2.2 without ruler, goal chip or Sniffer; Yard ghost. MVP: the rest, THRUST and one-handed variants. v1: rails, tablets.

### 2.7 Risks
- On the SE, 4.2 rows sit behind S controls: M0 measures ore reading through them (§13); fallback 50% opacity.
- The context button rises 6–42 pt above the zone top, covering ≤ 1.4 cells while shown.

---

## 3. Pod controls

### 3.1 Pointer arbitration and the floating stick
A pointer-down in pod mode resolves in order:
1. **On a control** (slot, context button, HUD pill, ruler hit strip, card "›"): the control.
2. **Second pointer:** pinch inside the canon §3.12 pinch window, anywhere; else ignored. Zoom stays in canon §3.4 ranges, persists per mode, resets at each Rim departure if above default.
3. **In the spawn zone** (canon §3.12; SE x24–206, y ≥ 300; 15 x24–216, y ≥ 383): a stick spawns, centred on the touch.
4. **A world tap** (canon §3.12), from any zone, hit-tests signs, buildings, marks and (one-handed) dig neighbours with ≥ 44-pt boxes and discards its stick, which never left the dead zone by > 2 pt (m′ < 0.06, under every gate).

Stick: radius, knob, dead zone per canon §3.12; m′ = (m − d)/(1 − d), d = dead zone ÷ R; the base slides when the thumb passes 1.25 R **[UX]**; release or `pointercancel` → 0, base fades in 150 ms; a 40% rest-hint ring for the first 3 trips.

### 3.2 Drive, dig and sectors
| Sector (screen θ) | Enter | Leave | Grounded | Airborne |
|---|---|---|---|---|
| Right | −45°…45° | −55°…55° | Drive; into diggable → dig | Steer |
| Up | 45°…135° | 35°…145° | Thrust (s_t, canon §3.6) | Thrust + steer |
| Left | 135°…225° | 125°…235° | Drive / dig | Steer |
| Down | 225°…315° | 215°…325° | Dig down, s_x = 0 | Steer, no thrust |

- Engage, gate, timing, never-up: canon §3.6. Steady Drill: 01 §6.4.
- **Column snap [UX]:** a down-dig targets the cell under the pod's centre; the pod eases ≤ 0.5 tile to it.
- **Axis lock [UX]:** grounded in Left/Right, stick_y below 0.35 is ignored, so the pod never hops mid-tunnel.
- **Mis-dig:** the stick leaves its sector within 250 ms of engage, or the opposite dig follows within 1 s.

### 3.3 Thrust
Stick-up is the default and only required thrust; analog s_t brakes falls cheaply. **THRUST option** (off; Hold or Toggle) gives s_t = 1.0; Toggle latches until tapped, a Down input or any dig.

### 3.4 Quick slots and explosives
- 4 slots (defaults 01 §3.1): icon, count x/9, cooldown sweep.
- **Explosives and beacons** (canon §3.12): pointer-down draws the footprint around the pod (amber outline; red cells = ore and relics it destroys) and fills an arming ring **around the pod**, not under the thumb (arena: Perfect / Good colours, 01 §7.6). Release after it fills = fire; earlier release or a > 24-pt slide = cancel, nothing spent.
- **Jerrycan, Patch Kit:** release fires, slide-off cancels, no ring **[UX]**; greyed at ≥ 90% tank or hull.
- Grounded-only items show a lock badge in the air; a press shakes the slot with an error tick.
- **Reassign** (canon §3.12): cargo-panel Quick-slots row (tap slot, tap consumable), or a ≥ 600 ms press while paused or grounded on the Rim → a radial of the 6 consumables (slide, release). On the Rim an explosive's ring fills first and fades as the radial opens; nothing fires.
- No aiming: blasts centre on the pod (canon §2.7).

### 3.5 Context button
Centred over the slot cluster; hidden when nothing applies.

| Priority | Shown when | Label → action |
|---|---|---|
| 0 | TOO HEAVY, or ≤ 5 s after "Bay full" | **Cargo** → cargo panel |
| 1 | v1: within 2 tiles of a Sheared or Damaged structure | **Realign (n Weld Packs)**, hold 2 s (canon §4.7); "Need n" when short |
| 2 | Next to a discovered lode, Auto-Drill Kit carried | **Place drill** → Mine build, drill armed and snapped |
| 3 | Grounded, < 0.2 tiles/s, no stick for 0.6 s | **BUILD**, 200-ms fade-in |

Ghost-job progress (canon §4.8) is a non-interactive ring chip beside the pod. BUILD is always on ≡ and B.

### 3.6 One-handed mode (canon §3.12)
- Pointer-down at y ≥ 0.45 H off controls drives a stick measured from the **virtual origin** (pod x, 0.70 H), drawn as a 40% ring; radius and dead zone per size. Above = thrust, sideways = drive and dig, below = dig down. SE origin y 467, inside the thumb arc.
- A tap on one of the pod's 3 diggable neighbours (44-pt boxes) digs once.
- 2×2 cluster of 52-pt slots in the dominant corner, context above; ruler on the non-dominant edge.

### 3.7 Keyboard map
M0 (development), v1 (iPad, desktop). Gamepad: post-launch (canon §5.4 #15).

| Action | Keys |
|---|---|
| Drive, dig, thrust | Arrows / WASD (W, ↑ = full thrust); Space = THRUST |
| Slots | 1–4 (explosives fire on key-up after the arm); Q = slot picker (Rim or paused) |
| Context, build, map, cargo, menu | E, B, M, Tab, Esc |
| Build: place, cancel, rotate, bulldoze, overlay | Click, Esc / right-click, R, Delete, O |
| Undo, redo | Ctrl/⌘ Z; Ctrl/⌘ Shift Z or Ctrl Y |
| Build camera: pan, zoom, yaw | Right-drag / WASD; wheel / − +; [ ] |
| Debug overlay | ` or F3 (`?debug=1`) |

### 3.8 Interruptions and the resume gate
- Sources and rule: canon §4.5 (`interrupt`); the pod freezes with velocity kept, the factory runs.
- **"Tap to resume" card:** 64 pt, 16-pt margins, centred in the control zone (SE y560–624, 15 y703–767), 40% scrim, reason glyph (call, rotation, app switch). The resuming tap is consumed, never a stick.
- **Countdown** "3 · 2 · 1" (0.5 s each) over the pod; a thumb may take the stick meanwhile and the pod resumes with that input, so a falling pod brakes from the first step. Arena: ≡ pause with a 3-s countdown (canon §3.10).
- **Auto-lock:** standalone Wake Lock exists only from iOS 18.4 and Low Power Mode forces a 30-s lock, so nothing relies on it (requested where available, 04). Rim idle animations stop after 25 s; waking returns through the gate.

### 3.9 Build order
- **M0:** §3.1–3.3; 4 fixed slots (demo-strip explosives use the canon arm); keyboard; `interrupt` gate and card; mis-dig telemetry.
- **MVP:** 6 consumables, reassign, locks, cargo slot row, context 0/2/3, THRUST, sizes, handedness, one-handed, Steady Drill.
- **v1:** Realign context; arena arm colours. **Post:** gamepad, Capacitor haptics.

### 3.10 Risks
- Diagonals near 225° / 315° cause most mis-digs: tune hysteresis and the gate from M0 telemetry.
- Down-sector s_x = 0 may feel sticky: leaving the sector restores drive at once.
- A Rim press past 600 ms arms then cancels: the ring visibly morphs into the radial.

---

## 4. Build-mode UX

### 4.1 Entering, exiting, layout
- **Enter:** BUILD, ≡ → Build, B, Place drill, "Route to surface". The pod freezes (canon §4.5). Arena: "Not in the Hollow Heart".
- **Plane:** the camera's (blend t < 0.5 → Yard, else Mine); the first card tab is the `Yard │ Mine` segment; planes swap in a 0.6-s flight.
- **Layout** (§2.3–2.4): top bar = **status only** (cash, v1 power chip, ◫ overlay). Bottom 56-pt translucent **dock**: `[✕ Done] [↶] [↷] … [Pan] [↻] [✗] [✓]`, 44-pt buttons, ✓ 56 pt on the dominant side, 12 pt from ✗. Above it, non-dominant side: **+ / −** zoom (44, stacked), ⟳ yaw (Yard); dominant side: a 28-pt **pending chip** ("$60 · 12 tiles", "Need 2 Hull Plate", "Kits: 3 needed, 2 carried"), plus the ⌐ L-mode chip for Yard belts.
- **Pan latch** (44 pt): while on, one finger pans and the tool stays armed; it glows, and releases when the first pan ends.
- **Exit:** ✕, Esc, Android Back; the camera returns in 0.35 s, then the resume gate (§3.8); a held build touch never becomes a stick.

### 4.2 Gesture arbitration
Constants: canon §3.12. 04 implements this machine.

| State | Exits |
|---|---|
| PENDING (cursor already on the lifted-point cell) | Move ≥ 10 pt → STROKE (tool) or PAN (no tool, or Pan latch). Second pointer in the grace window → CAMERA, nothing committed. Release before long-press → TAP (time alone never leaves PENDING). Long-press → LONGPRESS |
| STROKE | Paints from the lifted-point cell at touch-down; a late second finger freezes the path as an uncommitted ghost and becomes CAMERA |
| PAN / CAMERA | One finger pans; two pan and pinch; a twist past the snap = 90° yaw (Yard) |
| TAP | Tool: drop or move the ghost; a tap inside the selected ghost makes it a drag handle (never rotates). No tool: inspect |
| LONGPRESS | No tool: multi-select (v1) |

Edge auto-pan only at world-area edges. Two-finger-tap undo: setting, off.

### 4.3 Placement
- **Ghost-and-confirm** (canon §4.11): a card arms the tool, a tap drops a ghost, a drag moves it at the lifted point, ✓ commits, ✗ clears. **Instant build** (setting) commits on lift; painting and Bulldoze still preview.
- **Rotate** (Yard): ↻ or R, 90° clockwise, remembered per type; underground ghosts never rotate (02 §2.1).
- **Validity:** valid = role colour 50%; invalid = magenta-crimson `#E0249A` 45% striped half-and-half with plum ink (8-pt period, whole texels in Pixel Lab) inside a deep-red `#B3263A` outline + toast (§6.2), from the validator (02 §2.5) on every move. No role owns the invalid hue (§8.6), and the stripes and outline carry "invalid" without hue. A ghost job the pod is held on (refused, the build ring stalled) keeps its role tint and takes the stripes and outline.
- **Nudge:** a selected ghost shows 44-pt arrows (4 Yard, 2 underground).

### 4.4 Belts
- Each entered cell appends a belt facing the drag; turns auto-corner; backing up erases; crossings and side ends per 02 §2.1; endpoints snap to ports within 1 cell.
- **L mode (Yard):** an L from start to finger; ⇋ flips the legs.
- **Underground:** row-locked; stops red at the first floorless cell ("Needs a floor"); meters Kits ("16 tiles = 2 Belt Kits").
- v1: double-tap a belt (no tool) selects its line.

### 4.5 Lifts and chutes
1. Arm Bucket Lift; tap the foot cell.
2. Drag up or tap higher: the ghost extends (±1 column slop), stopping red at the first invalid row ("Shaft blocked at row 212").
3. The pending chip shows H, Kits (02 §3.4), rate, transit.
4. A top at row 0 proposes a Headframe (02 §2.2) in a 120 × 90-pt Yard picture-in-picture; ✓ commits both (SE fallback: "Show Yard" flip).
5. Chutes (v1): the same flow downward.

### 4.6 Route to surface and access chevrons
- **Route to surface** (inspect sheet of a drill, lift foot or v1 Depot; after Place drill): A* over excavated, seen cells (pod shafts cost 1, floor runs 2, mounts block). Ghosts: belt to the nearest column open to row 0 (or a lift foot), lift and rails, Headframe column, Yard belt to the nearest Smelter or Bin; plus a **Shopping list** chip opening the Shed's Kits.
- **No open column:** the fewest-digs column gets **access chevrons** (orange, downward, on each cell to dig, pulsing 1 Hz; a mustard post at the Rim mouth) and the goal chip "Lifts need a straight shaft: dig straight down from the Rim at the chevrons". The scripted lode's access dig uses them (01 §2.5).

### 4.7 Delete, multi-select, copy/paste
- **Bulldoze** (Tools, MVP): tap marks a building, drag paints belts, ✓ confirms; the pending chip shows the refund or block (02 §2.7).
- **v1:** mass delete (Bulldoze long-press rectangle; All / Belts / Machines); multi-select (no tool, long-press rectangle → Copy · Cut · Delete · Rotate · Upgrade Mk); mass upgrade; paste ghost follows the camera centre (underground: belts, Routers, Lamps, Shoring).

### 4.8 Undo / redo
↶ ↷ in the dock, ≥ 50 steps, semantics 02 §2.7; survives leaving build mode in a session; toasts name steps ("Undid: Belt ×12 (+$60)").

### 4.9 Fat-finger aids
| Aid | Spec |
|---|---|
| Zoom floor | Arming eases to canon §3.4 floors in 250 ms: 35.0-pt inscribed tap circle at 39 ppu, 39.4 at 44 (1×1 tools) |
| Lifted point, loupe | Canon §3.12; the loupe (3×3 cells, after 150 ms of drag) flips to the non-dominant side, never below the finger |
| Snap | Ports 1 cell; lift columns ±1; drill ghost to the nearest valid 2×2 within 1 cell |
| Tabs, bubbles | Tabs 44 pt; bubbles not interactive: the building (≥ 44-pt box) is the target |

### 4.10 Overlays and status icons
| Overlay | Scope | Shows |
|---|---|---|
| Logistics | MVP | Terrain 30%; moving chevrons; items/min per line and lift ("28/30 /min"); "in transit: 46"; ⊘ at each jam head |
| Bottleneck tint | v1 | Red back from jam heads; grey dashed starved runs; utilisation tint |
| Hazard | v1 | Revealed methane, magma radius, Shoring brackets, Sheared / Damaged |
| Power | v1 | Depot radius squares, kW labels, "Supply 46 / Demand 51 kW · 90%" |

Status bubbles (28 pt), one glyph each: no input (hollow circle), output full (boxes), no power (bolt), out of Depot range (dashed ring), Sheared (zig-zag), Damaged (cross), Disconnected (broken link).

### 4.11 Depth ruler and map navigation
- 24-pt rail on the dominant edge (one-handed: non-dominant), 44-pt hit strip extending inward, from 8 pt below the clear-rect top to 12 pt above the context button; it maps the mine onto its height (MVP rows 0–320).
- Markers: Rim, deepest row, pod (±3-row jitter in the Static Zone), lodes (orange diamonds), marks (pulsing ring), lifts (mustard); v1 Depots and problems. Band colours tint the rail.
- **Play:** tap → map. **Build:** the hit strip shrinks to the rail; dragging scrubs the camera (to discovered rows + 4).

### 4.12 Build order
- **M0:** Yard ghost with rotation on 48 × 8; underground ghost highlight.
- **MVP:** §4.1–4.6, Bulldoze, undo/redo, dock, Pan latch, zoom buttons, §4.9 aids, Mine build camera, Logistics overlay, bubbles, ruler scrub.
- **v1:** §4.7 v1 items, line select, bottleneck tint, Hazard and Power overlays, chutes. **Post:** blueprints.

### 4.13 Risks
- Pinches that lay belts: grace window + two-pointer test (§13).
- A forgotten Pan latch: it glows and self-releases.
- Route to surface can surprise: ghosts only, the player confirms.

---

## 5. Camera (UX layer on canon §3.4)
| Behaviour | Value |
|---|---|
| Angles, ppu, blend, follow, anchors, touch freeze, milestone deferral | Canon §3.4 |
| Slab clamp | ≤ 1 tile of slab frame beyond x ∈ [0, 48] |
| Rim idle pull-back **[UX]** | 3 s idle on the Rim → 28 ppu over 1.2 s; holds after 25 s; any input restores |
| Milestone shot **[UX]** | At the next Rim arrival after 500 / 1,000 / 3,500 ft: 2-s yaw sweep to 35° and back; any touch skips |
| Yard build | 250-ms tween to pitch 55°; 4 yaw snaps (twist or ⟳), 300 ms each; yaw 45° on exit |
| Mine build | 300-ms tween to 8° / 12°; pan bounds = seen cells + 4 |
| Arena | 26 ppu (canon §3.4); centre = lerp(pod, nearest open weak point, 0.35); off-screen attacks: 44-pt edge chevron on the threatened row + panned cue ≥ 1.2 s ahead (canon §3.10) |

Reduced motion disables the pull-back and shots. **Build order:** M0 blend, follow, anchors, touch freeze, perspective flag, Yard tween; MVP Mine build camera, player zoom, pull-back, shots; v1 arena, tablet, landscape. **Risks:** yaw change on descent may discomfort (M0 rating; fallback fixed surface yaw 20°); zoom-in can break the visibility rule, so it resets at each Rim departure.

---

## 6. HUD, screens and feedback

### 6.1 HUD row
Widths at 360 / 375 / 393 / 430: fuel 78/84/88/96, hull 64/68/72/80, cargo 62/64/68/74, info 80/83/89/104, menu 44; margins 8, gaps 4; pills 36 pt tall; hit area = full row height.

| Pill | Content, compact format | States |
|---|---|---|
| Fuel | Litres: 1 decimal below 100 L, integer above; 6-pt bar | Amber `#FFB020`; red `#FF4D5E` < 20%; Return Tick, red bar (canon §4.4); pulse 20/10/5% |
| Hull | ✚ HP (ceiling of the 0.1-HP value), bar | Green `#3DDC84` → red < 25%; 2-pt shake on damage |
| Cargo | ▣ slots used ("25"); bar = used ÷ total | Lilac bar, amber at mass ≥ 50% of hover cap, red ≥ 75%. TOO HEAVY: pill red, ▣ → ⚠, callout under it; "Bay full" callout likewise |
| Info | Surface cash / depth; underground depth / cash; v1 from r380 depth / Sniffer bars (+ Echo arrow), tap peeks cash 2 s. Cash "$9,999" → "$12.3k" → "$999k" → "$1.23M" (steps at $10k, $100k, $1M). Depth "5,813ft" after a 9-pt ▼ | Static Zone glyph swap (01 §4.9) 4 Hz (reduced motion 1 Hz); arena "DATUM 0"; red underline while Co-op debt > 0 (tap: "Co-op debt $300, taken from your next sale") |
| Menu ≡ | Pause sheet | Red badge = factory problem; works in the arena |

Pills: ink `#2B1E2F` 88%, 1.5-pt cream border at 60%, radius 12. Arena: 12-pt boss bar of three 1,000-HP segments (01 §7.6).

### 6.2 Hierarchy, transients and toast text
Tier 1: fuel, hull, cargo, depth, cash. Tier 2: Sniffer, Return Tick, TOO HEAVY, speed tint, goal chip, boss bar. Tier 3: map, cargo, factory status, logs.
- ≤ **1** transient text (ticker or card, toast, goal chip) at a time, radio first, in the top 25% of the clear rect, never blocking input; P0 alerts skip the queue on their pill.
- **Goal chip** (MVP): 28 pt under the HUD, one Dot-voiced action (01 §2.3).

**Toasts for 02 §2.5 codes** (≤ 40 characters, also on the ghost):

| Code | Toast | Code | Toast |
|---|---|---|---|
| E_LOCKED | "Unlocks: {trigger}" | E_HEAT | "Too hot here: needs Mk III" |
| E_YARD | "Outside your Yard" | E_DEPOT | The failing rule ("One Depot per band") |
| E_OCCUPIED | "Something's already here" | E_POD | "Pip is in the way" |
| E_SOLID / E_UNSEEN | "Dig this out first" / "Explore here first" | E_COLUMN | "Shaft blocked at row {r}" / "No Headframe column here" |
| E_FLOOR | "Needs a floor" | E_ARENA | "Not in the Hollow Heart" |
| E_LODE | "Drills sit on a discovered lode" / "This lode has a drill" | E_FUNDS / PARTS / KIT | "Need ${n} more" / "Need {n} {part}" / "Need {n} {Kit} in cargo" |

Pod refusals: anchored "Supports a belt — remove it first" + "Remove belt" (canon §3.3, 02 §2.9); paved "Paved — dig beside the pad" (01 §2.5).

### 6.3 Screen inventory
Pause behaviour: canon §4.5.

| Screen | Entry → layout | Scope |
|---|---|---|
| Title | Diorama. Not standalone: **"Install for full screen and safe saves (recommended)"** leads, "Play in browser" second. Standalone: Continue / New / Import | M0 → MVP install-first → v1 3 slots, Hardcore |
| Add-to-Home | Title, Saves, `persist()` denied → 3 illustrated steps; **auto-copies the export code** ("Your save is copied — paste it in the app") | MVP |
| Import from Safari | First standalone launch, no save → one-tap **Paste save** (`navigator.clipboard.readText`, user-activated), file picker, Skip | MVP |
| Open in Safari | In-app browser → copy-link button | MVP |
| Upright, Tap to resume | §1.3, §3.8 | M0 |
| Pause sheet | ≡ / Esc → Resume · Build · Map · Cargo · Status · Settings · Saves · Help | M0 → MVP |
| Cargo panel | Pill, Cargo context, Tab → 60% sheet; rows ("Gold ×12 · $3,000 · 24 mu") expand on tap to **Discard 1** (44 pt) and **Discard all** (600-ms hold ring); gems and relics confirm; undo until close (canon §3.7); Quick-slots and Kits rows | MVP |
| Pump House | Armed pad or sign tap → gauge; 5/10/25/50 L/Fill at 64 pt; **Co-op Credit** when eligible | M0 → MVP |
| Assay Office | **Sell:** type rows, 44-pt Sell/Stockpile toggle, pinned "Sell all $n", debt line, relic captions, Recorder "▶ log". **Office:** log, stats, milestones, expansions, Co-op Plans (02 §9), Stockpile (cut gems and gem parts: "Upgrade use only", grey book value) | M0 Sell → MVP → v1 |
| Garage | Line list, compare (§6.4), Repair | M0 4 lines → MVP |
| Supply Shed | Consumables (+1 / +5 / to 9); Kits (To cargo / To Stockpile, Shopping list); Starter Kit; v1 Weld Packs, Drums | MVP |
| Map; inspect | §6.6; tap a building → 50% sheet (rates, buffers, recipe, Mk, Delete, Route to surface) | MVP |
| Trip summary; salvage | "312ft · $1,240 · 4.1 L · −0 HP · 3:22" then ≤ 3 Next Goals chips; 3-s salvage card (lost cargo, fee, debt) | MVP; M0 |
| Safe Mode | Two failed boots (canon §3.15) → Load previous copy · Export this code · New game | MVP |
| Depot dock | Pools; Refuel / Repair / Unload / Kits; gems "Pod-only"; a second dock: read-only "Serviced this trip" (02 §3.5) | v1 |
| Shear Report | Structures, status, Packs needed; the first adds "+2 Weld Packs" and **Show braces** (brace slots lit) | v1 |
| Welcome back; ending | Count-up of 02 §8.5 at ≥ 60 s credited; 01 §7.7 | v1 |
| Perf Report, debug, style test | About → export code (04); `?debug=1`; §9.4 | M0 |

### 6.4 Rim pads and shops
- **Pads** (canon §2.4): armed = lights pulse in the building colour; disarmed = dim. A closed sheet leaves its pad disarmed, so it never re-opens; respawn lands disarmed.
- **Sign tap:** ≥ 44-pt box; auto-drive, open on arrival (01 §3.10).
- **Sheets:** 92% bottom sheet; HUD and cash live; primary action pinned in the bottom 120 pt; ✕ 44 pt; swipe-down closes; body `[data-scroll]`.
- **Line cards:** icon, current → next, price, one stat delta, part chips (✓ / ✗ + ETA from factory rates).
- **Compare** shows each line's stats with the player's other parts (e.g. Drill: dig time, fuel per tile, tiles per tank; Bay: "full bay at your depth ≈ $n").

### 6.5 Transmissions
Limits: canon §2.12 #5.
- **Ticker** (moving): 28 pt under the HUD; sender + first 28 characters + "…", 44-pt "›"; never expires while moving.
- **Full card** (grounded, idle ≥ 0.6 s, or "›"): x 8 to W − 8, 76 pt (3 lines of 15/20 Nunito; the Surveyor's 17/22 card 82 pt), 40-pt avatar, body `pointer-events:none`; typed at 40 characters/s with blips; the auto-advance clock starts on open; the next stick input collapses it.

| Sender | Card | Type | Avatar |
|---|---|---|---|
| Dot | Cream `#FFF6E9` | Nunito | Portrait with headset |
| Marlow | Khaki `#E8DDB5` | Nunito | *Bucket*'s scratched visor |
| Channel Zero | `#0B0F0C`, `#7CFFB0` text (15.4:1), scanlines | Space Mono | Oscilloscope trace |
| the Surveyor | Plum `#2A1830`, brass `#E8C27A` (9.8:1) | IM Fell English ≥ 17/22 | Theodolite eye |
| Deepreach log | Tape label `#E9DFC7` | Space Mono | Recorder reel |

S19 (01 §7.4) is a back-wall decal plus a 1-line caption, not a card. Static Zone cards get a 30% static overlay. The Office log replays every beat.

### 6.6 Map
- From the 48 × 608 DataTexture: 7 pt per cell at 375 pt, pinch 3–14, vertical scroll.
- **MVP:** charted cells in band colours, fog, pod, lodes (? / P / N / R), marks, lifts. **v1:** Depots, methane, relic pings, problems, filters.
- **Targets:** markers ≥ 24 pt at any zoom; taps snap to the nearest marker within 22 pt. Lode → "Build here"; "Center on pod". Pod hidden in the Static Zone; no map in the arena.

### 6.7 Settings, saves, install and import
- **Settings** tabs: Controls (incl. Steady Drill, Landing Assist, Return Tick), Display (incl. the production look), Audio, Build, About (credits, Perf Report); defaults §12.
- **Saves:** slot cards (deepest row, cash, time, last saved). Export: code in a monospace `[data-scroll]` box, Copy, Share (canon §3.15 file name). Import: paste box (16-px font, no iOS zoom) or file → validation and dry run → summary → overwrite confirm. Status "Saved 12 s ago" with `persist()` ✓ or "Install to keep saves safe".
- **Install-first flow** (canon §3.15): title → Add-to-Home (code copied) → first standalone launch → Paste save; testable with `?standalone=1&test=1` (04).

### 6.8 Factory problems while digging
| Class | Examples | Delivery |
|---|---|---|
| P0 | Fuel, hull, TOO HEAVY, Bay full | At once on the pill, with audio |
| P1 | Lift Sheared, Export full, Smelters starved, main Bin full | Badge on ≡ and a ruler dot at once; a toast ("Lift at x 21 is blocked") only grounded and idle ≥ 1 s, ≤ 1 per 90 s, fuel ≥ 20% |
| P2 | First delivery, Bin 80% | Trip summary, Office log |

The trip summary adds "Factory: 5 OK · 1 blocked" (tap → build mode at the problem).

### 6.9 Feedback and juice
Every event pairs a visual with a §11.4 sound: ore pop 0 → 1.2 → 1 (120 ms) and a 0.35-s arc to the pod; Bay full crumble and a 3-pt pill shake; hard-landing squash 0.85 / 1.10, dust ring, 50-ms hit-stop; hull damage 80-ms flash, ≤ 2-pt screen shake; sale coin burst and 600-ms count-up; build pop-in 0 → 1.15 → 1; fuel ≤ 20% pill pulse and a 1-Hz red vignette; speed > 5.88 amber tint and streaks. Reduced motion keeps flashes, tints and count-ups only. Haptics: none on iOS web; Android `navigator.vibrate` only via `platform/` (04), off by default.

### 6.10 Build order
- **M0:** HUD row (no ruler, Sniffer, goal chip), pause, Pump, Assay Sell, 4-line Garage + compare, salvage, upright and resume cards, Settings, debug, Perf Report.
- **MVP:** compact formats + overflow test, ruler, cargo panel, §6.3 MVP screens, install-first title, Import from Safari, Safe Mode, ticker and cards, toasts, basic map, goal chip, trip summary.
- **v1:** Sniffer, Static Zone HUD, boss bar, Depot, Shear Report, welcome back, full map, 3 slots, ending.

### 6.11 Risks
- The 360-pt HUD has ≈ 2 pt slack: the overflow test gates builds.
- A full card on the SE leaves 3.1 rows above while grounded; the next stick input collapses it.
- Clipboard reads may prompt on iOS: the file picker is the fallback.

---

## 7. Accessibility
| Need | Feature | Scope |
|---|---|---|
| Colour vision | **Shape-coded ores** (§8.4) in world, icons, legend; glyph bubbles, hatched invalid ghosts, ⊘ jams | MVP |
| | Colour-blind ores palette (§8.4) | v1 |
| Low light | **Bright Mines**: ambient floor 0.35 | MVP |
| Motion | **Reduced motion** (OS): no shake, squash, hit-stop, shots, pull-back, typewriter; particles × 0.5 | MVP |
| Photosensitivity | No full-screen luminance change > 20% over 3 times a second; red flashes ≤ 2 a second; flashes ≤ 80 ms | M0 |
| Motor | Hold / toggle thrust, S/M/L, one-handed, Steady Drill, Landing Assist, arming ring | MVP |
| Reading | Text 100/115 → 130; OS default; radio auto-advance Off | MVP → v1 |
| Hearing | Every tell visual + audible (canon §4.12); captions ("[hiss]", "[crackle — left]") | v1 |
| Screen readers | Sheets `role="dialog"` + `aria-modal` + focus trap; labelled buttons ("Buy Corkscrew drill, 750 dollars"); canvas `aria-hidden`; radio `aria-live="polite"`; a Status button; warnings `aria-live="assertive"` | v1 |
| Contrast | `prefers-contrast: more` → pills and borders at 100% | v1 |

**Build order:** the Scope column. **Risks:** the pod game is not playable with VoiceOver (menus, shops and saves are), and VoiceOver's canvas capture cannot be detected on the web: Help explains turning it off for play.

---

## 8. Art direction: shared foundation

### 8.1 Readability rules
One plane per touch, nothing between camera and play plane · every building reads as a black silhouette at default zoom · colour = function (role roofs) · mid-dark world values so cream UI and emissive ores pop · toy proportions (radius ≥ 0.06, nothing thinner than 0.05 units) · cozy top, eerie depths (canon D6): warmth falls to B5, then danger-ember (B6) and ledger-green and brass (B7); never demonic.

### 8.2 Surface palette
| Token | Hex | Token | Hex |
|---|---|---|---|
| sky.top / bottom | `#F2B58E` / `#FADCC0` | ground.top / topAlt | `#E2804F` / `#D97748` |
| sky.sunsetHalo | `#8EC0EC` | ground.side / shadow | `#B85A37` / `#7E3A33` |
| dust.light | `#F4B07F` | rock.lit / dark | `#A8553E` / `#6B2F2C` |
| light.sun | `#FFE3C4` | hemi sky / ground | `#F7CDAA` / `#7E3A33` |
| shadow.tint (35%) | `#5B3A66` | Rim asphalt / paving | `#5E4A52` / `#C9A98A` |

### 8.3 Strata palette (bands canon §2.5)
| Band (rows) | Front | Side/top | Back wall | Accent | Ambient tint | Ambient A |
|---|---|---|---|---|---|---|
| B0 Rust Flats (0–19) | `#D9774A` | `#B35A36` | `#7A3A2C` | `#F0A070` | `#C9805E` | 1.00 (r0) → 0.80 (r4) → 0.55 |
| B1 Ochre Beds (20–63) | `#C98A4B` | `#9E6535` | `#6A4128` | `#E7B677` | `#A57A50` | 0.55 → 0.42 |
| B2 Clay Deeps (64–128) | `#A44B3B` | `#7C342C` | `#4F2321` | `#D07158` | `#7D4038` | 0.42 → 0.32 |
| B3 Violet Shale (129–261) | `#74506F` | `#553A54` | `#36243A` | `#A07AA0` | `#5A4060` | 0.32 → 0.22 |
| B4 Blue Basalt (262–395) | `#46557A` | `#333F5E` | `#1F263D` | `#7486B5` | `#3A4565` | 0.22 → 0.17 |
| B5 Obsidian Hush (396–479) | `#2F2840` | `#221C30` | `#15111F` | `#5E4F80` | `#2A2238` | 0.17 → 0.14 |
| B6 Ember Mantle (480–583) | `#4A2026` | `#34161C` | `#1E0B10` | `#FF6A2B` veins | `#4A1E1A` | 0.14 → 0.12 |
| the Seal (584) | `#1A1420` | `#120E17` | — | `#4D4754` seams | — | 0.12 |
| B7 Hollow Heart (585–607) | `#2A2230` | `#1D1724` | `#120E17` | `#7CFFB0` + `#E8C27A` | `#1E2A26` | 0.12 + arena lights |

Edges wavy, dithered over 3–6 rows; per-cell jitter hue ±3%, value ±5%; ambient linear per segment; the sun fades over rows 0–6.

### 8.4 Ore and item codes (owned here; names canon §2.2)
| Item | Base | Highlight | Emissive | Silhouette |
|---|---|---|---|---|
| Hematite | `#7E828E` | `#C0683E` flecks | 0 | 3-cube cluster |
| Copper | `#E0782E` | `#FFB27A` | 0 | 2 squashed nuggets |
| Cobalt | `#3F6FE0` | `#9DB8FF` | 0 | 3 tilted flakes |
| Gold | `#FFC53D` | `#FFF1B0` | 0.15 | fat nugget + 4-point sparkle |
| Iridium | `#B8B4C8` | `#D9CCFF` sheen | 0.20 | short hexagonal prisms (the only hex prism) |
| Thorium | `#4FE3FF` | `#D6FBFF` | 0.9, pulse 0.8 Hz | 2 crossed capsule rods |
| Peridot | `#9CD83A` | `#E4FF9A` | 0.40 | **faceted teardrop (pear cut)** |
| Fire Opal | `#F2365F` | `#FFD23A` flecks | 0.45 | rounded cabochon |
| Diamond | `#EEFBFF` | prism sparkle | 0.60 | octahedron |
| Echo Quartz | `#B78CFF` | `#EBDDFF` | 0.70 + ring every 3 s | tall twin-point crystal |
| Relics | bone `#F2E6C9`, brass `#C8963E`, recorder `#FF7A3D`, slate `#5E5A70` | — | 0.2 | ammonite / strongbox / recorder / glyph tablet |
| Hoard (v1) | brass, Heartstone; Deed cream, green seal | — | 0.3 | chain / theodolite / logbook / lens / core / scroll |
| Lode ore / ingots | ore colour | — | ore / 0 | rough chunk / trapezoid bar (Thorium Rod: capsule) |
| Parts | cream + role trim | — | 0 | gear · coil (Wire) · riveted plate · helix (Coolant Coil) · pinned board · can + shaft (Motor) · cone (Drill Bit) · capsule (Pressure Vessel) · glowing cube (Reactor Core) |
| Cut gems, gem parts (v1) | gem colour | — | gem | brilliant cut; Lens disc, Opal Plating tile, Diamond Bit faceted cone |
| Kits / Drums / Packs | role band / amber / white + red cross | — | 0 | crate / barrel / box |

- Min OKLab ΔE × 100 = 14.2 (normal vision); Gold–Peridot falls to 1.3 under protanopia, so shape carries it.
- **Colour-blind palette** (v1): Hematite `#6E7280`, Copper `#E69F00`, Cobalt `#0072B2`, Gold `#F0E442`, Iridium `#C9C3D9`, Thorium `#56B4E9`, Peridot `#009E73`, Fire Opal `#D55E00`, Diamond `#FFFFFF`, Echo Quartz `#CC79A7` (min ΔE 7.6 under deutan / protan / tritan).
- Revealed methane: `#B8E34A` shimmer at 20% + diagonal hatch, never confusable with Peridot.

### 8.5 Special cells
Hardrock: chamfered boulder `#6A6370` / `#4D4754`, chamfer `#8E8796` (B4+ `#8B8496`). Magma: core `#FFB238`, mid `#FF6A1A`, crust `#7A1E10`, emissive 1.5–2.5, scrolling noise, embers. Methane: dirt until revealed. Lode rock: 3×2, band rock −15%, ore-coloured veins (emissive 0.3), a riveted stake once discovered; Unknown seams: grey veins, no stake. Anchored cell: steel bracket decal. Dug cell: back wall at z −1.0 (× 0.75), AO sides, marching-squares bevels. Rim paving `#C9A98A` with painted pad chevrons. Slab edges: cut stone with brass specimen-case trim.

### 8.6 Role colours, buildings and the pod
| Role | Colour | Buildings |
|---|---|---|
| Logistics | Mustard `#F6C343`; deck `#3A3346`; chevrons `#FFE9A8` | Belt, Router, Bucket Lift, Headframe, Chute |
| Extraction | Orange `#FF7A3D` | Auto-Drill, Magma Tap, Gas Tap |
| Processing | Coral `#FF5A4E`; furnace `#FFB238` | Smelter, Refinery, Gem Cutter |
| Assembly | Teal `#2EC4B6` | Assembler, Pod Works |
| Power | Blue `#4DA8FF` | Co-op Generator, Solar Array, Power Plant |
| Storage, market | Lilac `#9B7BFF` | Storage Bin, Silo, Export Terminal, Depot |
| Support | Khaki `#B8A27A`; glow `#FFD9A0` | Shoring Brace, Lamp |

- **Ghost tint:** a valid ghost is its role colour; the invalid tint is magenta-crimson `#E0249A`, a hue no role uses (the old `#FF4D5E` sat 10° of hue from Processing coral `#FF5A4E`, so a valid Smelter ghost read as invalid), and an invalid ghost is always striped with plum ink inside a deep-red outline (§4.3), never told apart by hue alone. Bulldoze marks keep `#FF4D5E`.
- All 22 buildings: cream body `#EDE3D2`, plum-grey trim `#4A3F55`; Mk II mustard stripe; Mk III heat shield + cyan pilot light; the survey set's "rusted" skin adds rust decals. Rim buildings carry big signs (amber pump totem; gold scale with Dot's lit window; teal roll-up door and crane; lilac crates).
- **Pip:** white `#F4F1EA`, visor `#46E0D2` (0.3), accent `#FF7A3D`, Sniffer LED `#7CFF6B` at 2 Hz. Per line (canon §2.6): **3 geometry steps** (t1–2, t3–5, t6–7) **+ a per-tier trim band** on the part collar, so every purchase shows: 21 meshes + 7 trims. Geometry cues: bit shape, hull plates, exhaust count, back tank, radiator fins, cargo pod, scanner dish. Trims follow the metal ladder: t1 steel `#8E8796`, t2 copper `#E0782E`, t3 cobalt `#3F6FE0`, t4 gold `#FFC53D`, t5 iridium `#B8B4C8`, t6 thorium `#4FE3FF` (pulse), t7 diamond `#EEFBFF` (sparkle).

### 8.7 Materials and shading
- `MeshToonMaterial` + `onBeforeCompile` GLSL (canon D4) reading vertex colours from a 256 × 256 palette atlas; flat normals; 3-step ramp at NdotL 0.45 / 0.62 / 0.84 (edges smoothed 0.04); shadow step 35% toward `#5B3A66`; no PBR; glass = flat teal + a white sticker.
- Belts: chevrons scroll at the constant 1 tile/s (canon §3.11); the Mk shows in item spacing and trim; items instanced, ±0.01 bob at 4 Hz.

### 8.8 Lighting
- **Surface:** sun `#FFE3C4` 1.0 (azimuth yaw + 135°, elevation 50°); hemisphere 0.55; shadows canon §3.14.
- **Underground:**
  ```
  light(p) = A(row) + (1 − A) · max(bubble(p), lamps(p))
  bubble(p) = 0.95 · (1 − smoothstep(0.35R, R, |p − pod|)), R = 4.5
            + 0.6 · cone(p, drill direction, 40°, 7 rows)      (canon §2.6)
  lamps(p)  = max over the nearest 8 / 16 / 16 lamps (low / mid / high) of
              colour_i · (1 − smoothstep(0.3 r_i, r_i, |p − lamp_i|))
  ```
  Lamp r 3.5 `#FFD9A0`; Magma r 2 `#FF7A2E`; working machines r 1.5 in role colour; thrust flame r 1.2 `#FFD36B`. Ambient floor 0.12 (Bright Mines 0.35); back walls × 0.75.
- Post: bloom per canon §3.14 (high: half-res, threshold 0.85, strength 0.6); vignette 15% at the surface → 30% deep.

### 8.9 Outlines and AO
Per-vertex voxel AO (1.0 / 0.82 / 0.68 / 0.55); 0.04-unit chamfer 8% lighter; kit AO baked; blob shadows `#3B2233` α 0.35. Outlines depend on the look (§9).

### 8.10 VFX (particle caps canon §3.14; low / mid / high)
Drill debris (band-coloured cubes) + dust 10 / 16 / 22 per s · cell break, landing, build pop 4 / 6 / 8 · sparks (`#FFE07A` → `#FF8A3D`) 8 / 12 / 20 · ore pop + trail 6 / 10 / 14 · thruster cones + smoke 3 / 6 / 8 per s · magma embers ≤ 8 / 16 / 24 · explosion (80-ms flash, debris, smoke ring) 20 / 30 / 40, Mega +50% · methane blast (`#C8FF4D`, v1) 16 / 24 / 40 · Smelter smoke 1 / 1.5 / 1.5 per s each, off above 12 / 16 / 20 machines · teleport 12 / 20 / 30 · speed streaks 0 / 4 / 8 · Shear dust (v1) 20 / 40 / 60 · Static Zone: composite noise, no particles · boss (v1) ≤ 60 / 100 / 160. Over cap, the oldest of the lowest class goes: tells > pod > factory > ambience.

### 8.11 Animation ("bouncy toy")
Springs and easeOutBack; linear only for belts and buckets. Pip: landing squash 0.85 / 1.10 (180 ms, ζ 0.45), thrust stretch 1.06 / 0.97, ±8° lean, drill jitter ±0.02 at 30 Hz, idle bob ±0.03 at 0.6 Hz. Machines: vertex-shader breathing 1.00 ↔ 1.03 (off above 40 visible); starved = still + amber LED. DOM buttons: 3-pt press, lip 4 → 1 pt in 60 ms. Numbers float 24 pt over 600 ms.

### 8.12 Build order
- **M0:** surface palette; B0–B2 + B3 ambient for the identification strip; tiers 1–6 codes; Hardrock, Magma; toon material; bubble + cone; AO; core VFX; placeholder Pip.
- **MVP (picked look):** B3–B4; MVP buildings, items, parts; lode rock, Unknown seams; relics; Pip steps 1–2, trims t1–t5.
- **v1:** B5–B7, methane, Static Zone, all buildings, boss, CVD palette, Pip step 3, trims t6–t7.

### 8.13 Risks
- Dark bands outdoors: 0.12 floor, emissive ores, Bright Mines.
- 22 buildings × Mk tiers: procedural kitbash, shared body, role roof.
- Iridium on Violet Shale: emissive and shape; the M0 identification test includes it.

---

## 9. The M0 style test: Clean Toon vs Pixel Lab

### 9.1 Render contract (canon §5.1)
Identical: build, seed, save, scene, geometry, palette, cameras, lighting, AO, animation, VFX, controls, audio, tier; dynamic resolution and bloom off; one tuning day per look (ore scale, outline thresholds, ramp), logged in an ADR (04). Only the rows below and the UI skin differ.

### 9.2 Clean Toon
| Item | Value |
|---|---|
| Resolution | Test DPR min(device, 2); production tier caps + dynamic resolution (canon §3.14) |
| AA, outlines | MSAA. Inverted hull, 1.5 px × DPR, base × 0.35 shifted to plum, never black; test: everything; production scope per tier from the M0 cost log. Terrain: chamfer highlight |
| Glow, UI | Halo sprites (production high tier adds bloom); rounded toy UI |

### 9.3 Pixel Lab
| Item | Value |
|---|---|
| Render target | k = round(DPR × face_pt ÷ 30) (canon §5.1). SE k = 2: RT 375 × 667, 35.7 px per tile, 1 RT px = 1 pt. iPhone 15 k = 4: RT 295 × 639, 28.9 px per tile, 1.33 pt. 2-texel margin; fixed per viewport |
| Canvas, blit | Native DPR, nearest blit, `antialias: false`; pass order 04 §5.7 |
| Zoom snap | Integer px per tile: nearest, rounded up where a mode has a floor, ≤ 3% over a cap. SE: play 36 (38.3 ppu), Mine build 46, surface 36 / 39 / 44. 15: play 29 (41.2 ppu), Mine build 35 (47.7), surface 27, surface build 30 (40.0) or 33 (1×1 tool) |
| Edge pass | Depth step > 0.25 → nearer pixel = base × 0.45 + 25% `#2B1E2F`; crease (dot < 0.75) → × 1.15; terrain too |
| Dithering | 4×4 Bayer on light falloff, fog, band edges; palette never posterised |
| Camera | Snapped to the RT texel; remainder as an integer device-px blit offset; yaw and pitch step 2.5° during the blend |
| Glow, text, UI | Dithered halo discs; no text in the RT; Pixel UI skin (Pixelify Sans at 16 / 24 / 32 px, 4-pt radii, hard shadows) |

### 9.4 How the user compares
1. Install the M0 build to the Home Screen.
2. A-B-A-B sessions, 5 min each, order by seed parity, Low Power Mode off, frame times and thermal state logged per segment.
3. **A/B chip:** 44 pt at the clear rect's top-left (x8–52, 8 pt under the HUD); flips in ≤ 1 frame (both pipelines precompiled, both RTs alive); no multi-finger gestures.
4. **Gallery:** 6 time-frozen bookmarks (Yard wide; Rim; shaft at row 2; B1 ore at row 40; Hardrock + Magma strip; Yard build with belts); a 64-pt bottom "Flip" button.
5. **Questionnaire** (1–5): ore readability, "feels like Little Rocket Lab", charm, eye comfort, motion, build clarity; then "Which look should ship?" (Toon / Pixel / both). Answers and frame data export as a paste code.
6. Decision: canon §5.1, §7 #4; production switching: settings only.

### 9.5 Build order
M0: both looks, chip, gallery, questionnaire, frame log. MVP: art on the picked look only. v1: a kept Retro filter is polished.

### 9.6 Risks
- SE pixels (36 px per tile) are finer than the 15's (29): the user judges on their own phone; the gallery covers both sizes.
- Fractional DPRs (Android 2.625, k = 3) soften the nearest blit unless the canvas is sized in device pixels (`devicePixelContentBoxSize`); the reference Android checks it.
- "Both" doubles art QA: canon §7 #4's ≤ 5% rule caps it.

---

## 10. Assets, pipeline and UI language

### 10.1 Sources
| Asset | Source |
|---|---|
| Terrain, ores, hazards, lode rock | Procedural (chunk mesher + autotile) |
| Pip (21 meshes + 7 trims), *Bucket*, buildings, belts, lifts, items, parts | Procedural kitbash: shared cream body + role roof |
| Rim buildings, Yard decor, figures | Kenney Space, City (Industrial), Nature kits, Mini Characters; Quaternius Ultimate Space Kit, Modular Sci-Fi MegaKit (Standard); KayKit Space Base Bits |
| Portraits, boss, arena | In-house 2D (Dot, Marlow; 160 × 160 WebP); procedural + hand-modelled boss |
| Particles, glyphs, item icons | Canvas sprites at boot; SVG sprite (~40); runtime 96 × 96 renders of the meshes, cached (≈ 0.6 MB) |

### 10.2 Licences
Each in `assets/CREDITS.md`: Kenney, Quaternius, KayKit free tiers CC0 1.0; Kenney Interface / Impact / Sci-Fi Sounds CC0; Fredoka, Nunito, IM Fell English, Space Mono, Pixelify Sans SIL OFL 1.1; ZzFX / ZzFXM MIT; Freesound and OpenGameArt **CC0 only**. CC-BY needs approval and a credit. No original-game art or audio (canon §4.14).

### 10.3 Recolour pipeline (Node + glTF-Transform)
Import from `assets/src/<pack>/` → bake colour to per-face vertex colour → snap in OKLab to ≈ 80 `palette.json` swatches (report ΔE > 12) → strip textures and UVs, flatten normals, weld, quantise to 1/1024 → meshopt, one `.glb` per category, ≤ 600 KB in the first playable. CI fails on a non-palette colour or a texture.

### 10.4 UI visual language
| Element | Spec |
|---|---|
| Type | Fredoka SemiBold: display, titles, HUD digits (`tabular-nums`). Nunito Bold: body 15/20; captions 12/16, never critical. IM Fell English ≥ 17/22 (Surveyor). Space Mono: Channel Zero, Deepreach logs. Pixelify Sans: Pixel UI only, 16 / 24 / 32 px. Latin subsets, WOFF2, ≤ 140 KB, `font-display: swap` |
| Panels | Cream `#FFF6E9`, 2-pt border 20% darker, 4-pt lip `#E6D3BA`; radius 16 / 24 / 999; no blur shadows |
| Contrast | Ink `#2B1E2F` on cream 14.8:1; ink-soft `#6B5A6E` 5.9:1; ink on teal `#2EC4B6` 7.3:1, on `#FF7A3D` 6.1:1, on `#FF4D5E` 4.9:1; HUD bars on ink: fuel 8.6:1, hull 8.9:1, cargo `#9B7BFF` 5.0:1 |
| Buttons, icons | Primary teal with ink text, 56–64 pt; destructive danger; hit ≥ 44 pt; icons on a 24-pt grid, 2-pt stroke |
| Scrim, motion | `rgba(43,30,47,0.55)`; sheets slide 280 ms (reduced motion: 150-ms fade) |

### 10.5 Build order
M0: procedural terrain, pod, 6 placeholder machines, one kit Rim building through the pipeline, Fredoka and Nunito, palette CI. MVP: MVP buildings, 4 Rim buildings, decor, icons, portraits. v1: boss, arena, v1 buildings, specialty fonts, credits.

### 10.6 Risks
Kits fight the style: palette snap, one shader, outlines, no textures. Icon rendering costs boot time: lazy, cached.

---

## 11. Audio direction (engine 04 §8)

### 11.1 Constraints (iOS first)
- One lazy `AudioContext`; on the first `pointerup` / `touchend` / `keydown`: `resume()`, a 1-sample silent buffer, and `play()` on the music element in the same gesture.
- `navigator.audioSession.type = 'ambient'`: the silent switch mutes us and the player's music keeps playing; **"Sound in silent mode"** sets `'playback'`. Every tell is also visual (canon §4.12).
- `interrupted` raises `interrupt` (canon §4.5); `resume()` on the resuming tap; hidden → suspend, pause music.
- Decoded audio ≤ 8 MB (low) / 16 MB (mid); AAC `.m4a`; nothing important below 150 Hz (missing-fundamental harmonics); tells at 400 Hz–4 kHz.

### 11.2 Music (stem names owned here)
| Group | Rows | Title | Sound | Behaviour |
|---|---|---|---|---|
| G1 | 0–63 | **Kettle On** | 92 BPM, F major; kalimba, nylon guitar, soft bass | Low-pass 16 kHz → 700 Hz and −12 dB by r40 (the surface song through rock); gone by r64 |
| G2 | 64–261 | **Dead Band** | 76 BPM, D Dorian → minor; detuned kalimba, bowed glass | Pulse only while moving; after S7 (01 §7.4) a counting tick (4 + 3) joins Texture |
| G3 | 262–479 | **Hush** | Free time; tremolo drones, bowed metal | At B5 music −18 dB; ambience leads |
| G4 | 480–607 | **The Ledger** | 60 BPM, whole-tone; music-box leitmotif (the Surveyor) | Irregular pulse in the Static Zone |
| Boss | arena | **The Claim** | 120 BPM → 7/8; music box, chains, industrial grind | Layers change at each stagger |
| Ending | — | **Claim Settled** | Kettle On theme + strings | — |

- **Engine split (04 §8):** Kettle On (≈ 110 s, 96 kbps, ≈ 1.3 MB) and Claim Settled stream as AAC, lazy-loaded after the first playable (outside its 2.5 MB). G2–G4 and The Claim are a generative sequencer: stems Pad, Pulse, Lead, Texture playing ZzFX-rendered notes or ≤ 1-s samples; note cache ≤ 4 MB (current + next group); authored 8–16-bar patterns, seeded variation.
- 24-row equal-power crossfades. Pulse follows activity (off after 4 s idle); Pad and Texture follow depth; hull < 25% adds a heartbeat; shops and build mode duck −4 dB with a 4-kHz low-pass. MVP: Kettle On only; ambience alone below r64.

### 11.3 Ambience (noise beds + sparse one-shots)
Rim: pink-noise wind, hum of the ≤ 6 nearest machines, crane clanks. B0–B1: muffled wind, pebbles, drips. B2: damp room tone, creaks. B3: glassy air, ticks, a distant 3-knock after S7. B4: pressure rumble, positional magma within 6 tiles. B5: near silence (−12 dB), a rare thump. B6: warm pulse, ember hiss. B7: mechanical breath. Static Zone (v1): band-passed static at −24 dB.

### 11.4 SFX
**M0 (4 ZzFX, ≈ 0.5 d):** dig, thrust, land, sell. **MVP: 20 ★ designs** (variants are parameters):

| ★ | Sound: trigger → design |
|---|---|
| 1–3 | **Drill:** dig loop + break transient, +2 semitones per tier, band filter · **Clink:** Hardrock, bright ping + sparks · **Thunk:** lode or anchored refusal; discovery adds a 3-note chime |
| 4–7 | **Pickup:** pentatonic pitch by tier, gem shimmer, relic bell · **Bay full:** crumble + bonk · **Engine:** hum with s_t, timbre by tier, groan when TOO HEAVY · **Fall whistle** above 5.88 tiles/s |
| 8–11 | **Landing:** thud, crunch by HP lost · **Hull hit:** clang · **Magma:** crackle bed, 2-hit breach sizzle · **Explosion:** whump; Mega lower, longer |
| 12–15 | **Item use:** glug / weld zap · **Teleport:** warble + pop · **Alarm:** fuel beep faster at 10 / 5%, hull double beep · **Salvage:** pop + tow-drone whirr |
| 16–20 | **Pump:** glug, ding per 5 L · **Sell:** coins by value + bell · **Purchase:** ratchet + fanfare · **Build:** thunk + pop / reverse · **UI voice:** taps, errors, blips, arming tick |

**v1:** Sniffer hiss (gain by bars, panned to the Echo arrow), methane blast, machines (Smelter roar, Assembler clack, Export ka-ching, buckets, belt hum), factory chime, Depot clamp, Realign ratchet, Shear rumble, stings, boss cues (off-screen ones ≥ 1.2 s ahead and panned, canon §3.10).

### 11.5 Transmission voices (blips; no voice acting, canon §6)
One blip per letter, ≤ 18/s; vowels × 1.5; comma 120 ms, stop 280 ms; band-pass 300–3,400 Hz. **Dot:** FM sine at G4, pentatonic walk, 16/s, warm. **Marlow:** soft square at G3, 14/s, gritty. **Channel Zero:** a 40-ms static burst per word, a tick per number. **the Surveyor:** one celesta note per word, whole-tone, slow, reverse swell per sentence. **Deepreach logs:** tape hiss and wow, blips at A3, 12/s. "Voice blips" setting; reduced motion = one blip per word.

### 11.6 Mix
Buses Music / Ambience / SFX / UI + Voice; master compressor −18 dB, 3:1; ≈ −16 LUFS. **24 voices (12 low)**, priority alarms > hazard tells > pod > UI > factory > ambience. Ducking: radio −6 dB music, −3 ambience; alarm −8; sell −4. Defaults: Master 80, Music 60, SFX 80, Ambience 70, Voice 70.

### 11.7 Synthesis versus recorded
ZzFX first (MIT, ~1 KB, deterministic, per-tier variants). CC0 recorded layers under ★1, 8, 9, 10, 17 and v1 methane and Shear (≤ 400 KB AAC, lazy after the first playable). Commissioned music only for Kettle On and Claim Settled (placeholder: a ZzFXM sketch).

### 11.8 Build order
M0: unlock, ambient session, 4 SFX. MVP: 20 ★, Kettle On + depth low-pass, ambience to B4, blips, mix, silent-mode setting. v1: G2–G4 and boss (6 d, 04), ending, v1 SFX, captions, Static Zone audio. Post: native audio session, voiced lines.

### 11.9 Risks
- `MediaElementSource` low-pass quirks on iOS: two pre-filtered Kettle On copies crossfaded by depth (+1.3 MB, lazy).
- Aimless generative music: authored patterns, seeded variation only.
- Silent-switch players hear no tells: visual parity (canon §4.12) is a QA gate.

---

## 12. Overridable UX defaults
Canon values (anchors, dig gate, touch constants, visibility rule) change only via canon §8.

**Playtest-tunable:**

| Default | Value | § |
|---|---|---|
| Control scrim | 0 → 25% ink (fallback: 50% control opacity) | 1.1 |
| Safari-tab R | 18.6 / 16.2 rows | 1.1 |
| Stick follow, rest hint | 1.25 R; first 3 trips | 3.1 |
| Column snap, axis lock | On | 3.2 |
| Jerrycan / Patch Kit | Release fires, no ring | 3.4 |
| Context button | Priorities 0–3; BUILD after 0.6 s idle | 3.5 |
| Countdown | 0.5 s per digit, stick pre-input | 3.8 |
| Pan latch; zoom stack | Releases after one pan; non-dominant side | 4.1 |
| Rim pull-back; milestone shot | 28 ppu after 3 s, holds after 25 s; 2-s sweep at the next Rim arrival | 5 |
| HUD formats and widths; Sniffer line | §6.1 (overflow test gates); from r380 | 6.1 |

**Settings (default):** control size M (S on 667-pt phones), handedness Right, THRUST off (Hold), one-handed off, instant build off, two-finger undo off, radio auto-advance on, quality Auto (iOS mid), battery mode off, Bright Mines off, colour-blind ores off, reduced motion and text scale from the OS, voice blips on, sound in silent mode off, volumes 80 / 60 / 80 / 70 / 70, Android vibration off.

---

## 13. UX acceptance tests
Targets are canon §5.1–5.2; this section defines the measurement.

| Target | Method |
|---|---|
| Mis-digs < 3% (M0) | Local telemetry (§3.2) |
| Ore identification ≥ 90% (M0) | Debug strip at forced B3 ambient: 40 random cells on rows +6…+9 per look, Iridium and Peridot included |
| Visibility rule; rotation (M0) | Playwright per matrix size, with and without the ticker; rotate mid-flight → upright card, factory ticking, back → resume gate |
| 0 HP lost to interruptions (MVP) | Device scripts: call banner mid-fall, Control Center mid-thrust, app switch mid-fall, rotate mid-flight, Siri, lock |
| Pads; scroll | Close a sheet, wait 1 s: still closed (also after respawn). At 375×667 scroll the Garage, build tray and cargo panel to their ends |
| HUD overflow | Every matrix width at 100 / 115 / 130% with $99.9M, 7,300ft, 120, 150 L, TOO HEAVY: no `scrollWidth` > `clientWidth` |
| Arming; world taps | Release at 200 ms: nothing; slide 30 pt: cancel; 300 ms: fires; Rim press ≥ 600 ms: radial only. A sign tap in the spawn zone auto-drives with no stick output |
| Build tasks (MVP) | Belt, context-flow and pinch targets of canon §5.2, also one-handed on an SE; CDP two-pointer test: second finger at 100 ms → camera, nothing committed |
| Safari tab, install | iOS 26 device check: no control under the toolbar. `?standalone=1&test=1`: the sheet copies the code; Paste save restores the slot |
