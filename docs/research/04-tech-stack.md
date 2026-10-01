# HoleFactory: Tech Stack Research Brief (04)

Date: 2026-10-01. Scope: choose the engine, language, build, UI, sim architecture, testing and performance budgets for a touch-first, 3D isometric (orthographic) mining and factory game. The game ships first as an iPhone Safari game and home-screen web app (PWA), also runs on modern Android, and is later wrapped as App Store and Play Store apps.

**How this was verified.**
- Facts were checked on the web where the egress proxy allowed it (github.com, npm registry, some news and blog sites). webkit.org, threejs.org, MDN, docs.godotengine.org, docs.unity3d.com and capacitorjs.com were blocked from this container. Claims that rest on search snippets or memory are marked **(unverified)**.
- Bundle sizes, package versions and headless-Chromium behaviour were **measured in this container** (§3.2, §9). Those numbers are first-hand.

---

## 0. TL;DR: the decision

| Layer | Recommendation | Why (one line) |
|---|---|---|
| Language | **TypeScript** (strict), ES2022 target | Same code in the browser, a Web Worker, Node (tests) and Capacitor. Best headless test story in a Linux container. |
| Renderer | **three.js r186+ `WebGPURenderer` (`three/webgpu`) with TSL node materials. Ship v1 with the WebGL2 backend as the default (`forceWebGL: true`). WebGPU is opt-in per device after real-device A/B tests.** | One shader codebase (TSL) compiles to GLSL and WGSL. Smallest mature 3D engine: 171 KB brotli for a minimal `three/webgpu` scene, 108 KB for classic WebGL (measured). WebGPU on iOS is only 1 year old and missing on iOS ≤ 18. |
| Fallback renderer (if the week-1 spike fails) | three.js classic `WebGLRenderer` + `MeshToonMaterial`/`onBeforeCompile` | Most battle-tested path on iOS Safari. 63 KB brotli smaller. |
| Build | **Vite 8** (Rolldown bundler, verified in npm deps) + `vite-plugin-pwa` 1.x (Workbox) | Fast dev server with HMR, ES-module workers, asset hashing, service-worker precache. |
| UI | **DOM overlay** (HTML/CSS) for HUD, shops, menus and build palette, using **Preact 11 + @preact/signals**. **In-canvas** only for world-anchored things (ghost previews, belt arrows, item icons, damage numbers via instanced sprites). | Crisp text at any DPR, CSS `env(safe-area-inset-*)`, accessibility and fast iteration, at ~5–6 KB. Keeps the GPU budget for the world. |
| Sim architecture | Pure, deterministic, **data-oriented** sim core (typed arrays, struct-of-arrays, no per-item objects), driven by commands. **Pod and dig physics: main thread, fixed 60 Hz. Factory sim: Web Worker, fixed 20 Hz.** Render interpolates both. No `SharedArrayBuffer`, so no COOP/COEP headers needed. | Input latency stays on the main thread. Belts, machines and offline catch-up can't cause frame hitches. Each core runs headless in Vitest. |
| World rendering | **16×16-tile chunks**, one merged `BufferGeometry` per chunk (hidden-face culling + vertex AO baked into vertex colours). `InstancedMesh` for ores, belt items, props. Belts animated by UV scroll in the shader (0 CPU per belt). | ~1 draw call per visible chunk. Re-meshing a chunk took 0.038 ms here (~400 quads), well under a 1 ms mobile budget. |
| Saves | Versioned binary (magic + version + sections), tiles RLE'd, **deflate-raw via `CompressionStream`** (fflate fallback). **IndexedDB** with 2 rotating slots + CRC32. Autosave on `visibilitychange`/`pagehide` and every 30 s. Export/import string. Capacitor: Filesystem plugin. | Saves are tens of KB. iOS can kill a tab with no warning event. |
| Tests | **Vitest 5** unit/property tests on the sim (Node). **Playwright 1.63** smoke + screenshot tests in headless Chromium on SwiftShader WebGL2 (verified working here). One WebGPU smoke test (no pixel compare). Real-device checklist on iPhone. | Fully automatable in a Linux container. GPU timing still needs real devices. |
| Native wrap | **Capacitor 8.5** (iOS 15+, Android minSdk 24 / target 36, verified from the package). Plugins: Haptics, Status Bar, Screen Orientation, Filesystem, Preferences. | Same web build. Native haptics, orientation lock, status-bar hide and durable storage. |
| Engines rejected | Babylon.js (3× larger, more than we need), PlayCanvas (cloud-editor-centric, 392 KB brotli, weak tree-shaking), Godot 4 web (WebGL2-only, ~6–10 MB download, iOS web audio regressions), Unity Web (heaviest, iOS memory crashes), Defold (great on mobile but weak 3D toolchain), native-only Godot/Unity (loses instant Safari play and the Linux/agent test loop). | Details in §2. |

**Minimum targets:**
- iOS/iPadOS 17+ Safari. iOS 26 is assumed to require iPhone 11 / A13 or newer (unverified).
- Chrome/Android WebView 121+ on Android 10+.
- WebGL2 required. WebGPU optional.

---

## 1. Platform reality check (late 2026)

- **WebGPU on iOS:**
  - "Supported and enabled by default in macOS Tahoe 26, iOS 26, iPadOS 26, and visionOS 26" (gpuweb Implementation Status wiki, https://github.com/gpuweb/gpuweb/wiki/Implementation-Status). Safari 26 shipped in Sept 2025 (https://www.utsubo.com/blog/threejs-2026-what-changed via search snippet).
  - **Every iOS browser is WebKit** (Chrome/Firefox on iOS included; EU alternative engines exist since iOS 17.4 but are rare), so iOS ≤ 18 users have **no WebGPU**.
- **WebGPU on Android Chrome:** ARM/Qualcomm/Intel GPUs on **Android 12+ since Chrome 121**. Imagination GPUs on Android 16+ since Chrome 139. **Samsung Xclipse still in development ("probably 154")**. **Firefox Android: Nightly only** (same wiki).
  - Many low-end phones (Android 10/11, PowerVR, or blocklisted drivers) therefore get **WebGL2 only**.
  - Conclusion: **WebGL2 is the baseline, WebGPU is an enhancement.**
- **three.js:**
  - Current release is **r186 (npm 0.186.0, 2026-09-08; 0.186.1, 2026-09-24)**. Cadence is ~every 2 months: r183 Feb 2026, r184 Apr, r185 Jun (npm registry).
  - r185 added WebXR on the WebGPU backend and made TSL compilation "3.0×" faster. r183 added per-instance opacity for `BatchedMesh` and deprecated `Clock` (https://github.com/mrdoob/three.js/releases).
  - `WebGPURenderer` tries WebGPU and **falls back to WebGL2 automatically**. `ShaderMaterial`, `RawShaderMaterial` and `onBeforeCompile` are **not supported** by `WebGPURenderer` on either backend; shaders must be TSL (search summary of https://threejs.org/manual/en/webgpurenderer.html and https://www.utsubo.com/blog/webgpu-threejs-migration-guide).
- **Babylon.js:**
  - **9.0 released 2026-03-26** (npm + https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/). Current npm version 9.29.0.
  - New features: Frame Graph, clustered lighting (WebGL2 + WebGPU), volumetric lighting (WebGPU compute), node particle editor.
  - Also new: "Babylon Lite", a **WebGPU-only** small runtime (https://www.babylonjs.com/lite/). Not usable for us because we need WebGL2.
- **PlayCanvas engine:** v2.23.0 (npm, 2026-10-01). WebGL2 + WebGPU. "1–2 MB runtime" per a 2026 comparison (search snippet). Measured brotli size in §3.2.
- **Godot:**
  - 4.x web export uses the **Compatibility renderer (WebGL 2.0 only)**; Forward+/Mobile are not supported on web.
  - Single-threaded export has been the default since 4.3 and fixes the old Safari/iOS problems.
  - **C# projects cannot be exported to web.**
  - Web audio defaults to "Sample" playback, with no AudioEffects (https://github.com/godotengine/godot-docs/blob/master/tutorials/export/exporting_for_web.rst).
  - Godot 4.7 (June 2026) is said to ship WASM SIMD by default and a wasm64 option (search snippet, unverified).
- **Capacitor:**
  - **8.0.0 released 2025-12-08**. **8.5.x is current** (8.5.2 on 2026-09-11). 8.5 was a "breaking minor" that adopted UIScene (https://ionic.io/blog/capacitor-8-5-released). 9.0 is in alpha (npm).
  - From the 8.5.2 package: iOS deployment target **15.0**. Android **minSdk 24, compile/target SDK 36**.

---

## 2. Engine-by-engine evaluation

Legend: ✅ good, ⚠️ caveat, ❌ blocker for our goals.

### 2.1 three.js (`WebGLRenderer` and `WebGPURenderer` + TSL)
- **iOS Safari performance:**
  - ✅ Thin abstraction with low per-draw CPU overhead. Monument Valley-style flat/ortho scenes are routinely 60 fps on A13+ (unverified, general experience).
  - WebGL on iOS runs on ANGLE→Metal (Safari 15+; unverified).
- **Known iOS issues:**
  - Instancing in `WebGPURenderer`'s **WebGL2 fallback failed at ≥508 instances on iOS ≤16.2** (uniform-buffer limits), fixed in r183 (https://github.com/mrdoob/three.js/issues/32597).
  - `BatchedMesh` `sortObjects` flicker on iOS WebGPU, fixed in r175 (https://github.com/mrdoob/three.js/issues/29581, https://github.com/mrdoob/three.js/issues/29041).
  - Lesson: the **WebGPU backend and the WebGL2 fallback both have iOS-specific edge cases**, so test both on devices.
- **WebGPU on iOS 26:** ✅ via `WebGPURenderer`. ⚠️ Our WebGPU test also logged `Instance dropped in popErrorScope` in headless Chromium (§9). Treat WebGPU as opt-in at first.
- **Bundle size (measured, esbuild minified, minimal ortho scene with 1,000-instance `InstancedMesh` and lights):**
  - `three` + `WebGLRenderer`: **524 KB raw / 130 KB gzip / 108 KB brotli**.
  - `three/webgpu` + `WebGPURenderer` (both backends): **772 KB raw / 210 KB gzip / 171 KB brotli**.
  - Full untreeshaken builds: `three.module.js` 724 KB min / 184 KB gzip; `three.webgpu.js` 1,056 KB min / 289 KB gzip.
- **Tooling:**
  - Plain npm library that works with Vite, TS types bundled in `@types/three` (unverified).
  - The three.js Inspector gained Timeline/Memory tabs in r184 (releases page).
  - No editor (fine for a procedural, code-first art pipeline, per brief 02).
- **Headless test:** ✅ Verified in this container. WebGL2 renders correctly on SwiftShader. `WebGPURenderer` with `forceWebGL:true` renders correctly. The native WebGPU backend runs (draw calls counted) but **screenshots came out blank white** (§9).
- **Capacitor:** ✅ Static files in WKWebView / Android WebView, nothing special.
- **Verdict: chosen.**

### 2.2 Babylon.js 9
- **iOS Safari:** ✅ Mature, "batteries included": GUI, physics plugins, inspector, Frame Graph, WebGPU + WebGL2. Microsoft-backed with a long track record on iOS (unverified specifics).
- **WebGPU on iOS 26:** ✅ Supported by the `WebGPUEngine` (unverified on device).
- **Bundle (measured, tree-shaken ES modules):** a minimal Engine + Scene + ortho camera + 2 lights + PBR box + thin instances = **1,831 KB raw / 425 KB gzip / 320 KB brotli**. That is **~3× three.js WebGL**. Babylon Lite is WebGPU-only, so it can't serve iOS ≤ 18.
- **Tooling:** Playground, Node Material Editor, Inspector, strong TS.
- **Headless:** ✅ Rendered under SwiftShader here, at ~47–55 rAF/s versus 60 for three/PlayCanvas in the same harness (not a GPU benchmark).
- **Capacitor:** ✅. Babylon Native also exists for a native path (unverified current state).
- **Verdict:** a strong runner-up, but too heavy for what is mostly flat-shaded instanced boxes.

### 2.3 PlayCanvas engine 2.x
- **iOS:** ✅ Built for mobile web from the start (playable ads, mobile web games). WebGPU + WebGL2.
- **Bundle (measured):** ESM build bundled with esbuild = **1,965 KB raw / 504 KB gzip / 392 KB brotli**. Tree-shaking barely helps, because the `Application` pulls in most systems. The full `playcanvas.min.mjs` is 2,491 KB / 639 KB gzip.
- **Tooling:** the strengths are the **cloud editor** (SaaS, collaborative) and the open-source engine. Engine-only use is fine, but the ecosystem assumes the editor. Version-control and agent workflows are smoother with plain code.
- **Headless:** ✅ Rendered here.
- **Capacitor:** ✅.
- **Verdict:** viable, but bigger, and its main advantage (the editor) doesn't fit a code-first pipeline.

### 2.4 Godot 4 web export (4.5–4.7)
- **iOS Safari:**
  - ⚠️ WebGL2-only Compatibility renderer, so **no WebGPU on web**. Single-threaded export by default.
  - Docs still note "Safari and iOS have persistent WebGL 2.0 issues" (godot-docs, above).
  - **A regression made web games with audio crash or reload after 1–3 minutes on iOS Safari/Chrome**, reproduced on 4.4.1-stable and 4.5-dev5 on an iPhone 15 Pro running iOS 18.5. It was a 4.5 release blocker (https://github.com/godotengine/godot/issues/107390). Fixed status not verified.
- **Bundle:** the engine `.wasm` alone is ~35–45 MB raw / ~6–10 MB compressed, before game data (**unverified**). Docs say WASM gzips to about a quarter of its size (godot-docs).
  - Custom export templates with modules stripped shrink this.
  - Even so, it is **20–50× the three.js download**, which hurts first launch on cellular and PWA install.
- **Tooling:** ✅ Excellent editor, GDScript, scenes, animation and tilemaps. Runs headless on Linux for exports (unverified for this container).
- **Headless test:** ⚠️ Possible (it's a canvas page), but game logic lives in WASM. Unit-testing the sim from Node isn't possible; you need GUT/gdUnit inside Godot.
- **Capacitor:** ⚠️ Possible, but pointless: Godot exports **native** iOS/Android directly, with better performance.
- **Verdict:** best if we went native-first. As a web-first engine it costs too much download and iOS risk.

### 2.5 Unity 6 Web
- **iOS:** ⚠️ Unity 6 lists mobile browsers as supported (unverified). In practice, iOS Safari tab kills from memory are the top complaint. A 2026 guide recommends setting **Memory Size to 256 MB (384 if needed)** (https://bugnet.io/blog/how-to-fix-unity-webgl-build-crashing-on-safari-ios).
- **WebGPU:** experimental/preview in Unity 6.x (unverified).
- **Bundle:** typically **5–15 MB brotli** for a small URP game (unverified). Slow first load and slow WASM compile on low-end Android.
- **Tooling:** best-in-class editor, but **Windows/macOS GUI editor, license activation in CI**. iOS builds need Xcode.
- **Headless test:** ⚠️ Possible, but a heavy CI image. Logic is C# compiled to WASM.
- **Capacitor:** ❌ Pointless; use Unity's native iOS/Android targets.
- **Verdict:** rejected for web-first.

### 2.6 Defold
- **iOS:** ✅ Lean C++ engine with Lua scripting. Very small HTML5 builds (~1.1–1.5 MB compressed engine, **unverified**). Strong native iOS/Android exports from one project, and excellent on low-end Android (unverified, reputation).
- **3D:** ⚠️ Supports 3D models, custom materials and render scripts, but tooling and examples are 2D-first. Isometric toon/outline/AO pipelines would be largely custom. Smaller 3D community.
- **WebGPU:** unknown/experimental (unverified).
- **Headless:** ✅ HTML5 build runs in Chromium. Unit tests in Lua.
- **Verdict:** the best "tiny native + web" engine, but the 3D isometric toolchain is weak. Revisit only if we abandon real 3D for 2D pre-rendered isometric.

### 2.7 Native builds (Godot / Unity on iOS and Android)
- **Pros:**
  - Full Metal/Vulkan performance and **120 Hz ProMotion**. For >60 Hz on iPhone, native apps set `CADisableMinimumFrameDurationOnPhone` (unverified exact key behaviour).
  - Real haptics, no tab kills (still subject to app memory limits), Game Center, and **no PWA storage eviction**.
- **Cons:**
  - **No instant play in Safari**, so the user's "iPhone Safari / home screen" priority is lost.
  - App Store review for every iteration.
  - macOS/Xcode required for iOS builds.
  - The Linux-container + Playwright agent loop doesn't apply.
- **Verdict:** not for v1. The Capacitor wrap covers store presence. If profiling later shows the web ceiling is too low, port the **sim core** (TS, pure) unchanged and swap the renderer. The determinism and data-oriented design make that feasible.

### 2.8 Comparison table

| | three.js (WebGPURenderer, WebGL2 default) | Babylon.js 9 | PlayCanvas 2.23 | Godot 4.x web | Unity 6 Web | Defold | Native Godot/Unity |
|---|---|---|---|---|---|---|---|
| WebGPU on iOS 26 | ✅ (auto, with WebGL2 fallback) | ✅ | ✅ | ❌ WebGL2 only | ⚠️ experimental (unverified) | ⚠️ unknown | n/a (Metal) |
| First-load engine (brotli) | **171 KB** (108 KB classic) measured | **320 KB** measured | **392 KB** measured | ~6–10 MB (unverified) | ~5–15 MB (unverified) | ~1–1.5 MB (unverified) | store download |
| iOS risk | Low–med | Low–med | Low–med | Med–high (audio regression #107390) | High (memory) | Low | Low |
| Linux headless test | ✅ verified | ✅ verified | ✅ verified | ⚠️ | ⚠️ heavy | ✅ | ❌ device/simulator |
| Sim unit tests in Node | ✅ | ✅ | ✅ | ❌ (GDScript) | ❌ (C#) | ⚠️ (Lua) | ❌ |
| Capacitor wrap | ✅ | ✅ | ✅ | pointless | pointless | pointless | n/a |
| Agent/code-first friendliness | ✅✅ | ✅ | ⚠️ editor-centric | ⚠️ scene files | ❌ | ⚠️ | ❌ |

---

## 3. Recommended stack in detail

### 3.1 Language and build
- **TypeScript, strict.** npm currently lists TypeScript **7.0.2**, the native compiler. If TS 7 tooling (ESLint plugins, Vite type-check plugin) lags, pin 5.9 (unverified ecosystem state).
- **Vite 8.3** (Rolldown 1.2 under the hood, verified from npm deps) with:
  - `vite-plugin-pwa` 1.3 (Workbox) to precache the app shell.
  - ES-module workers via `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })`. Module workers are supported in Safari 15+ (unverified).
  - `build.target: 'es2022'`, which covers Safari 16+.
  - Brotli/gzip precompression for hosts that serve `.br`.
- **Monorepo layout** (pnpm workspaces or a single package with path aliases):
  - `packages/sim`: pure TS, no DOM, deterministic. Runs in a Worker, Node and the main thread.
  - `packages/render`: three.js, chunk mesher, instancing, TSL materials.
  - `packages/ui`: Preact components and CSS.
  - `app/`: boot, input, audio, platform adapters (web, capacitor).
  - `tests/e2e`: Playwright.
- **Asset pipeline:**
  - glTF (`.glb`) with **meshopt** compression (gltfpack).
  - **KTX2/Basis** textures only if real textures appear. Brief 02 relies on vertex colours and a 256² palette atlas, so plain PNG is fine at this size.
  - Audio as **AAC `.m4a`** (or MP3) for universal Safari/Chrome decode.

### 3.2 Renderer choice and configuration
- `import { WebGPURenderer } from 'three/webgpu'`, with TSL for the toon ramp, vertex AO, emissive ore pulse, inverted-hull outlines and the pod "light bubble". The outline is a second instanced draw with front-face culling, as in brief 02.
- **Backend policy:**
  - v1 default is `forceWebGL: true` on all platforms.
  - Enable WebGPU only when all of these hold:
    1. `navigator.gpu` exists;
    2. the adapter is not `isFallbackAdapter`;
    3. a 2 s startup self-test renders without `uncapturederror`;
    4. remote config allow-lists the platform. Initial plan: allow iOS 26 on A15+ only after a device benchmark beats WebGL2.
  - Persist the decision. Expose `?renderer=webgl|webgpu` for testing.
- **Context settings:**
  - `antialias: true` (MSAA 4×) at a capped DPR. Apple and most Android GPUs are tile-based, so MSAA resolves on-chip and is cheaper than post-AA (unverified for the ANGLE-Metal path).
  - `alpha: false`, `stencil: false`, `powerPreference: 'default'`, `preserveDrawingBuffer: false`.
  - **No full-screen post passes on mid/low tiers.** Bloom = additive halo sprites (brief 02).
- **Spike gate (week 1):**
  - Build the diorama test scene twice: `WebGPURenderer`/`forceWebGL` and classic `WebGLRenderer`.
  - Test scene: 12 visible chunks, 3,000 belt items, 60 machines, 1 shadow map.
  - Measure on an iPhone 12/13 and a low-end Android.
  - If `WebGPURenderer`'s WebGL2 backend is **>15% slower in CPU frame time** than `WebGLRenderer`, switch to classic `WebGLRenderer` (GLSL `onBeforeCompile` toon) and defer TSL.

### 3.3 UI layer: DOM overlay, minimal in-canvas
- **DOM (Preact 11 + signals):**
  - HUD (fuel, hull, cargo, depth, cash), shop screens (fuel, mineral sell, upgrades, items), build palette and hotbar, inventory, settings and dialogs.
  - Text stays crisp at DPR 3 and is laid out with flex/grid.
  - Safe areas via `env(safe-area-inset-*)`. VoiceOver labels on buttons. Pure CSS animation for "bouncy toy" UI.
- **Rules to keep DOM cheap:**
  1. Update HUD numbers at most **10 Hz** from a signal fed by the sim snapshot, never per frame.
  2. Animate only `transform`/`opacity`.
  3. No DOM element tracks a world position every frame, except ≤ 10 pooled "pinned" labels moved with `translate3d`.
  4. `contain: strict` on HUD containers.
  5. `pointer-events: none` on the HUD root, `auto` on interactive children, so world touches pass through to the canvas.
- **In-canvas (three.js):**
  - Placement ghosts, grid, belt direction chevrons, item sprites on belts.
  - Floating "+$120" pickups as instanced billboards with an MSDF/bitmap digit atlas.
  - Selection outlines, the drill-progress ring.
- **Input routing:** one `pointerdown` handler on the canvas runs a gesture state machine (tap, drag-to-belt, pinch zoom, two-finger pan, long-press for info), per brief 03 §4. UI elements stop propagation.

### 3.4 Simulation architecture
- **Data-oriented, not a generic ECS library.** The factory needs specialised structures:
  - gap-encoded `TransportLine`s;
  - timed ring-buffer queues for lifts;
  - a timing wheel for machine completion;
  - per-network power satisfaction (brief 03 §5).
- These are struct-of-arrays in typed arrays with free lists and stable integer IDs. A generic ECS (bitECS 0.4, koota 0.6) adds indirection and buys little here. Use plain SoA tables (`Float32Array`/`Int32Array` columns) for the few homogeneous entity kinds: pods, machines, drones.
- **World grid:** `Uint8Array tileType`, `Uint8Array tileDamage`, `Uint8Array tileFlags` (lit, built-on, scanned), indexed `y * W + x`, chunked 16×16 for meshing and 64-row depth bands for sim LOD.
  - 64 wide × 1,000 deep = 64k tiles ≈ 192 KB for three bytes per tile. Original Motherload: 32 × ~600 (brief 01).
- **Threads:**
  - **Main thread:**
    - input, pod physics and digging at **fixed 60 Hz**;
    - camera, render interpolation and UI;
    - authoritative **terrain** (the pod digs it).
    - Tile edits go to the worker as commands.
  - **Worker (`sim.worker.ts`):**
    - factory sim at **fixed 20 Hz** with deterministic integer math;
    - offline catch-up;
    - save serialisation and compression.
    - Receives commands (`PlaceBuilding`, `Remove`, `TileChanged`, `DepositCargo`, `SetRecipe`) stamped with a sim tick.
    - Returns:
      - per-tick **events** (`ItemDelivered`, `MachineStarved`, `CashEarned`);
      - a compact **render snapshot**: a transferable `ArrayBuffer` with positions, types and states of visible items and machines, bounded by camera rect plus margin.
  - **No `SharedArrayBuffer`.** It needs COOP/COEP cross-origin isolation, which complicates static hosting, third-party embeds and Capacitor's custom scheme. Transferables at 20 Hz with ≤ 64 KB snapshots are cheap.
  - `SimHost` interface with two implementations: `WorkerSimHost` and `InlineSimHost`. Tests and very old devices use inline.
- **Fixed step + interpolation** (Gaffer "Fix Your Timestep", https://gafferongames.com/post/fix_your_timestep/):
  - `acc += min(frameDelta, 250ms)`, then `while (acc >= dt) { step(); acc -= dt }`, `alpha = acc/dt`.
  - Cap at 5 steps per frame.
  - Render pods at `lerp(prev, curr, alpha)`. Belt items: the worker sends `(lineId, offset, speed)`, and the renderer extrapolates `offset + speed × (now − snapshotTime)`. Items glide smoothly at any frame rate.
  - Low Power Mode (30 fps) and ProMotion don't change game speed.
- **Determinism:**
  - Seeded PRNG (e.g. `sfc32`) per subsystem, integer or fixed-point factory math, stable iteration order (sorted IDs).
  - Pod physics may use floats but always with the fixed `dt`.
  - Benefits: golden-hash regression tests, replayable bug reports, consistent offline catch-up.
- **Off-screen LOD and sleep** follow brief 03 §5: sleeping machines, steady-state rate model per depth band.

### 3.5 World rendering: chunked meshing and instancing
- **Terrain:**
  - Each solid tile is a block in a shallow 3D slab (the "diorama cutaway", brief 02 §3).
  - Per 16×16 chunk, emit only exposed faces (front always; top, left, right and bottom when the neighbour is air), with **vertex AO** (3 neighbours per corner) and palette colour in vertex attributes (`Uint8` normalised colour + AO). One `BufferGeometry` per chunk, `Uint16` indices.
  - **Measured: 0.038 ms per chunk remesh (~395 quads, x86 container core).** Even at 10× slower on a low-end Android it stays under 0.5 ms.
  - Remesh only dirty chunks, at most 2 per frame. Neighbour chunks are remeshed only when the edited tile is on a border.
- **Ores/minerals:** one `InstancedMesh` per ore silhouette (brief 02: colour + shape coded), with per-instance colour and emissive.
- **Belts:**
  - Static belt geometry merged per chunk (or `BatchedMesh`), with UV-scroll animation in TSL from a `time` uniform.
  - **Items on belts:** a single `InstancedMesh` per item mesh family. Each frame, write only visible items into a pre-sized `InstancedBufferAttribute` (vec3 position + float typeIndex = 16 B instead of a 64 B mat4).
  - 4,000 visible items ≈ 64 KB upload per frame. Use `instanceMesh.count` to draw only the live prefix.
- **Machines:** `InstancedMesh` per machine type, with per-instance state (working, starved, blocked) driving emissive LEDs. Idle "breathing" animation is done in the vertex shader from instance ID + time (no CPU).
- **Culling:** the ortho camera gives a rectangular view, so cull per chunk with an AABB-vs-rect test. Turn off three's per-object frustum culling for instanced meshes we cull manually.
- **Shadows:** surface only. One 1024² directional shadow map (mid tier) with a tight frustum around the camera rect. Underground, blob shadows plus the light bubble (brief 02).

### 3.6 Save format and persistence
- **Layout:** `HFSV` magic, `u16 version`, `u32 seed`, `f64 savedAt`, then TLV sections: `TILE` (RLE type + damage), `ENTS` (SoA tables), `LINE` (transport lines), `INV`, `ECON`, `POD`, `META`. Each section is length-prefixed so old builds skip unknown sections. Explicit migration functions for each version.
- **Compression:** `CompressionStream('deflate-raw')` (Safari 16.4+/Chrome 80+, unverified versions) with **fflate** (~8 KB) as a fallback.
  - Measured: a 156 KB raw save of random terrain plus 2,000 entities deflates to **45 KB in 3.5 ms**. Real terrain (large uniform strata) compresses far better.
- **Storage:**
  - **IndexedDB** (via `idb-keyval` 6.x) with 2 rotating slots + CRC32 + "last known good".
  - Autosave on `visibilitychange→hidden`, on `pagehide`, every 30 s, and after shop transactions.
  - Call `navigator.storage.persist()` after the first meaningful session (§4.4).
  - **Export/import save** as a base64 string or file via the Web Share API, so players can survive eviction and move between Safari and the home-screen app.
- **Capacitor:** write the same blob with `@capacitor/filesystem` 8.1 (`Directory.Data`). Small settings go in `@capacitor/preferences` 8.0. Don't rely on WKWebView IndexedDB as the only copy (it can be purged under storage pressure, unverified).

### 3.7 Audio
- One `AudioContext`, created lazily and **resumed inside a `pointerup`/`touchend`/`click` handler**.
  - Per the HTML user-activation rules, a touch `pointerdown` is **not** activation-triggering; `pointerup`/`touchend` are (HTML spec, unverified wording).
- **SFX:** short decoded buffers, ≤ 2 s each. Decoded PCM is float32, so 1 min of stereo 48 kHz = 48,000 × 60 × 2 × 4 ≈ **23 MB**.
- **Music:** stream through a single `<audio>` element routed via `MediaElementAudioSourceNode` → `GainNode`. On iOS, `HTMLMediaElement.volume` is read-only, which is why volume goes through the GainNode (unverified on iOS 26).
- Format: **AAC `.m4a`** for everything.
- Detailed iOS quirks are in §4.3.

### 3.8 Platform adapters
`Platform` interface with `WebPlatform` and `CapacitorPlatform` implementations: `haptic(kind)`, `saveBlob()`, `loadBlob()`, `lockOrientation()`, `setStatusBar()`, `share()`, `thermalState()` (native only), `keepAwake()`.

---

## 4. iOS-specific gotchas (and what we do about each)

### 4.1 Per-tab memory limits and crash behaviour
- **What happens:**
  - iOS jetsams the Safari **WebContent process** when its footprint (JS heap + DOM + decoded images + **GPU allocations attributed to the page**) passes a device-dependent limit.
  - The page reloads with no warning. After repeated kills, Safari shows **"A problem repeatedly occurred on …"** (https://github.com/danishi/liminal-space/pull/10, https://medium.com/@shilpecsaxena9098/how-we-stopped-ios-safari-from-crashing-our-e-commerce-site-beeb948ded34).
  - No memory-pressure event reaches JS. `performance.memory` and `measureUserAgentSpecificMemory` are not available in Safari (unverified).
- **Reported numbers (vary by device and iOS):**
  - A 2026 article measured pages crashing at **~100 MB on an iPhone SE (3rd gen)** and **~200 MB on an 8th-gen iPad**, presumably for a specific allocation pattern (https://lapcatsoftware.com/articles/2026/1/7.html, search snippet; the page was blocked here).
  - A Unity guide cites an effective **~300–500 MB WebGL heap ceiling** (bugnet, above).
  - Treat the safe total budget as **≤ 300 MB on 4 GB iPhones** and much less on 3 GB devices.
- **Mitigations:**
  - Hard budgets (§8).
  - Single `AudioContext`, streamed music.
  - Dispose GPU resources when leaving the surface or underground scenes. Never hold two worlds at once.
  - No large `ImageBitmap` caches. Typed arrays sized once.
  - **Crash-loop detection:** write `session.running=1` at boot and clear it on `pagehide`. If it's still set at next boot, the last session was killed, so drop one quality tier and show "We lowered graphics to keep the game stable".
  - Autosave often, since a kill loses everything since the last save.

### 4.2 WebGL context loss (and WebGPU device loss)
- iOS can drop GL contexts when the app is backgrounded, the GPU process restarts or memory is tight (unverified frequency).
- Listen for `webglcontextlost` and call `preventDefault()` so restoration is allowed. On `webglcontextrestored`, rebuild every GPU resource from CPU-side data.
  - The design makes this free: chunk meshes come from the tile array, instances from the sim snapshot, materials from code.
  - three.js `WebGLRenderer` re-initialises its state on restore. Verify that our custom attributes re-upload.
- For WebGPU, handle `device.lost` by recreating the renderer. three.js exposes a device-lost hook (unverified API name).
- **Test it:** a Playwright test calls `WEBGL_lose_context.loseContext()`, then `restoreContext()`, and asserts the frame re-renders (§7).

### 4.3 Audio unlock and Web Audio quirks
- **Unlock:** `AudioContext` starts `suspended`, so call `resume()` inside a user-activation event and play a 1-sample silent buffer there.
- **Interrupted state:** WebKit has a non-standard `state === 'interrupted'` (phone call, Siri, other audio apps, backgrounding). On `visibilitychange→visible`, try `resume()`. If it stays suspended, resume on the next tap.
- **Silent switch:**
  - By default a page's Web Audio is in the "ambient" session and **is muted by the hardware silent switch**.
  - Setting `navigator.audioSession.type = 'playback'` before creating the context makes it play through the switch (Safari 17+; confirmed on iOS 26 in community PRs: https://github.com/sinaida-space/infinite-voidsong/pull/24, https://adactio.com/links/19938).
  - **Recommendation:** keep the default **ambient** behaviour. Native iOS games respect the switch, and ambient also mixes with the player's own music. Offer a setting "Play sound in silent mode" that sets `'playback'` (which also pauses other apps' audio).
- **Sample rate:** let the context choose (48 kHz on modern iPhones). Don't force 44.1 kHz.
- **Formats:** AAC/MP3 are safe. Ogg Vorbis/Opus `decodeAudioData` support on Safari is version-dependent (unverified), so avoid them.

### 4.4 PWA storage eviction and `navigator.storage.persist()`
- **ITP 7-day cap:** since iOS 13.4 / Safari 13.1, Safari deletes **all script-writable storage** (IndexedDB, Cache API, service worker registration, localStorage) for an origin after **7 days of browser use without user interaction**. **Home-screen web apps are exempt** (https://www.itnews.com.au/news/apple-cops-flak-for-deleting-local-browser-storage-after-7-days-539833; MDN via search snippet).
- **Quotas (iOS 17+ / macOS 14+):**
  - Browser apps: each origin can use up to **~60% of disk**.
  - Other apps embedding WebKit: **~15%**.
  - Home-screen web apps: same 60% as the browser (MDN Storage quotas page, via search snippet: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- **`navigator.storage.persist()`:** Safari (17+) and Chromium grant or deny **silently**, based on engagement heuristics, with no prompt (web.dev https://web.dev/articles/storage-for-the-web, MDN). Call it after the first save and record the result. If not persisted and not standalone, show a gentle "Add to Home Screen to keep your progress safe" sheet.
- **Separate storage after install:** the home-screen app's storage is **separate from Safari's** (widely reported, unverified on iOS 26). A player who starts in Safari and then installs **loses their save** unless we migrate it.
  - Fix: on first standalone launch with no save, offer "Import from Safari" via the export/import code, or a short-lived server relay if we ever add accounts.
- **iOS 26:** sites added to the Home Screen open as web apps by default, even without a manifest (WWDC25/Safari 26, unverified here because webkit.org was blocked).
- **In-app browsers** (Instagram, TikTok and similar WKWebViews) can't install and may have ephemeral storage. Detect them via UA heuristics and show "Open in Safari".

### 4.5 Standalone, fullscreen and the status bar
- **The Fullscreen API on iPhone works only for `<video>`.** `element.requestFullscreen()` on a canvas isn't available on iPhone Safari; it is on iPadOS (unverified for iOS 26).
  - So "fullscreen" on iPhone = **home-screen standalone mode**. Manifest `display: "fullscreen"` falls back to `standalone` on iOS (unverified).
- **Manifest:** `display: "standalone"`, `background_color`, `theme_color`, icons, plus an `apple-touch-icon` (180×180).
- **Status bar:** `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` lets the canvas draw under the status bar, with white status text. Pad the HUD with `env(safe-area-inset-top)`. The status bar can't be hidden in a PWA (in landscape, iOS hides it automatically on iPhone). Capacitor's `StatusBar.hide()` / `setOverlaysWebView` can hide it.
- **Orientation:** web apps on iOS can't lock orientation. `screen.orientation.lock()` is unsupported and manifest `orientation` is ignored (unverified).
  - Design for **portrait-first** (a vertical shaft suits it, and brief 02 is 375-pt portrait-first) with a responsive landscape layout.
  - Capacitor builds lock via Info.plist or `@capacitor/screen-orientation`.
- **Safari browser chrome (non-standalone):**
  - The address/tab bar overlays the bottom and resizes the visual viewport.
  - Use `position: fixed; inset: 0` for the app root plus `100dvh` (Safari 15.4+, unverified), and listen to `visualViewport` resize.
  - **The left-edge swipe navigates back** in Safari (not in standalone), so keep drag-start zones ≥ 24 px from the left edge, or push a history entry and confirm before leaving.
- **Screen Wake Lock** (`navigator.wakeLock.request('screen')`): supported since Safari 16.4. Home-screen-app bugs were reportedly fixed in 18.4 (unverified). Request it while a run is active.

### 4.6 Safe-area insets and the Dynamic Island
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, then `padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)` on the HUD root. Only the 3D canvas goes edge-to-edge.
- **Typical portrait insets (unverified approximations):**
  - top: ~47 pt on notch phones (iPhone 12/13), ~59 pt with the Dynamic Island (14 Pro/15/16), ~62 pt on 16 Pro;
  - bottom: ~34 pt (home indicator).
  - Landscape: ~47–62 pt left and right, ~21 pt bottom.
  - Use `env()` and never hard-code these.
- Keep the **fuel/hull gauges out of the top-center** (Dynamic Island). Keep primary thumb controls above the home-indicator zone (≥ 34 pt + 8 pt margin). Bottom-edge swipes go to the system and fire `pointercancel`.

### 4.7 120 Hz ProMotion and `requestAnimationFrame`
- **Safari caps page rendering (rAF) at ~60 fps by default** on ProMotion devices. The "Prefer Page Rendering Updates near 60fps" feature flag must be turned off by the user for 120 Hz, and the flag reportedly **doesn't apply to home-screen web apps, which stay at 60 fps** (https://www.macrumors.com/how-to/enable-smoother-120hz-browsing-in-safari/; the PWA claim is from the same search set, unverified).
- iPhone 12/13 (non-Pro) are 60 Hz panels anyway.
- **Design rule:** target **60 fps**. The sim is frame-rate independent (fixed step), so if 120 Hz rAF shows up we either take it (high tier) or cap rendering at 60 by skipping alternate frames to save battery. Always compute deltas from the rAF timestamp, never assume 16.67 ms.
- **Hidden tabs:** rAF stops when hidden. Pause the sim on `visibilitychange` (the factory switches to offline catch-up on return, brief 03).

### 4.8 Low Power Mode
- iOS **throttles rAF (and CSS animations) to ~30 fps in Low Power Mode**. Cross-origin iframes are also throttled before user interaction, which matters if the game is ever embedded in a portal (https://popmotion.io/blog/20180104-when-ios-throttles-requestanimationframe/, https://bugs.webkit.org/show_bug.cgi?id=215745).
- There is no API to detect it. Infer it from a steady ~33 ms rAF cadence.
- **Handling:**
  - Fixed-step sim keeps game speed correct.
  - Interpolation keeps motion smooth.
  - When a 30 fps cadence is detected, drop optional effects (the frame budget doubles, but thermals and battery are the user's stated priority).
  - Show "Battery saver detected: 30 fps" in settings, not as a popup.

### 4.9 Haptics
- **Safari has no Vibration API** (`navigator.vibrate` is undefined on iOS; https://github.com/web-platform-tests/interop/issues/718).
- **iOS 18+ hack:**
  - Toggling a `<input type="checkbox" switch>` produces a system haptic tick.
  - Libraries trigger it by programmatically clicking an associated `<label>`; clicking the input directly doesn't work (https://github.com/ionic-team/ionic-framework/issues/29942, https://x.com/firt/status/2028807962295230776).
  - Expect it to work only inside user-gesture handlers (unverified). That's fine for UI taps (place building, buy upgrade) but **not** for sim-driven events (ore collected while holding the drill).
  - Treat it as optional polish behind a feature check.
- **Android web:** `navigator.vibrate(ms)` works in Chrome after user activation.
- **Capacitor:** `@capacitor/haptics` 8.0.2 offers `impact({style: Light|Medium|Heavy})`, `notification({type: Success|Warning|Error})`, `selectionStart/Changed/End` and `vibrate()`. Map:
  - drill tick → selection;
  - ore pickup → impact Light;
  - cargo full → notification Warning;
  - hull hit → impact Heavy;
  - upgrade bought → notification Success.

### 4.10 Pointer Events vs touch events
- Use **Pointer Events** only (Safari 13+): `pointerdown/move/up/cancel`, `setPointerCapture`, multi-touch by `pointerId`.
- Set `touch-action: none` on the canvas so the browser doesn't pan or zoom.
- **Always handle `pointercancel`.** iOS sends it when a system gesture (home-indicator swipe, Control Center, notification pull) takes over. Release held buttons, such as "drill" or "thrust", on cancel, otherwise the pod keeps flying.
- Treat `pointerType === 'touch'` with `width/height` as the finger contact size. Use it for the fat-finger tolerance in brief 03 §4.2.
- Hold-to-thrust and drill buttons: listen on the button and capture the pointer, so dragging off doesn't stick.

### 4.11 Preventing pinch and double-tap zoom, rubber-banding, callouts
- iOS Safari **ignores `user-scalable=no` / `maximum-scale`** for accessibility (since iOS 10, unverified for standalone mode). Use CSS and events instead:
  - `html, body { overscroll-behavior: none; touch-action: none; position: fixed; inset: 0; overflow: hidden; }`. `overscroll-behavior` is supported in Safari 16+, unverified. This stops pull-to-refresh and rubber-band.
  - On interactive DOM controls, `touch-action: manipulation` removes the double-tap-zoom delay.
  - `document.addEventListener('gesturestart', e => e.preventDefault())` plus `gesturechange` (WebKit-only pinch events) blocks page pinch-zoom. Our own pinch-to-zoom uses two-pointer math on the canvas.
  - `-webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;` on the app, plus `contextmenu` `preventDefault`, stops the long-press magnifier, callout and text selection.
  - Any `touchmove` listener that calls `preventDefault` must be registered `{ passive: false }`.
  - **Text inputs must use font-size ≥ 16 px**, or iOS auto-zooms on focus (relevant for naming saves or blueprints).

### 4.12 Thermal throttling
- Sustained GPU+CPU load heats A-series SoCs. Clocks drop after minutes of play, so frame time creeps up even with no scene change (unverified magnitudes).
- No web API exposes thermal state. Capacitor could expose `ProcessInfo.thermalState` (iOS) and `PowerManager.getCurrentThermalStatus()` (Android 10+) through a ~30-line custom plugin.
- **Policy:** budget for **≤ 60% of the frame** (≈ 10 ms of 16.7) at nominal clocks, so a 30–40% thermal slowdown still holds 60 fps.
- Dynamic resolution (§4.13) is the first lever, effects tier the second, a 30 fps cap the last.
- Stop rendering entirely in menus and shop screens. Render on demand there, because the static diorama doesn't need 60 fps.

### 4.13 devicePixelRatio cost and dynamic resolution
- Modern iPhones are **DPR 3**. iPhone 12/13: 390×844 pt, 1170×2532 px (unverified exact).
- Pixel counts:

  | Render scale | Resolution | Pixels | Share of DPR 3 |
  |---|---|---|---|
  | DPR 3 | 1170×2532 | **2.96 MP** | 100% |
  | DPR 2 | 780×1688 | **1.32 MP** | 44% |
  | DPR 1.5 | 585×1266 | **0.74 MP** | 25% |

- Fragment cost and framebuffer memory scale linearly. A DPR 2 colour + depth + 4× MSAA target is ~1.32 M × 4 samples × 8 B ≈ **42 MB** if the backend materialises the MSAA buffer (unverified for ANGLE-Metal); DPR 3 would be ~95 MB.
- **Policy:**
  - `renderer.setPixelRatio(min(devicePixelRatio, tierCap))`: tier caps of **2.0 (high), 1.5 (mid, default for iPhone 12/13), 1.0–1.25 (low)**.
  - Dynamic scaling in **0.125 steps** within `[tierCap × 0.6, tierCap]`, driven by an EMA of CPU-side frame work time plus a count of rAF deltas over 18 ms. Neither iOS WebGL nor WebGPU timer queries are dependable for GPU time (`EXT_disjoint_timer_query_webgl2` is not exposed on iOS, unverified).
  - Step down after 30 of 60 frames are over budget. Step up after 5 s under 70% budget, with hysteresis.
  - Apply the change by resizing the drawing buffer (not CSS size) at most once per 2 s to avoid realloc churn.
- The UI stays at native DPR because it's DOM, so text is always sharp even at a low 3D render scale. This is a big reason to choose a **DOM overlay**.

---

## 5. Android notes (low-end focus)
- **Reference low-end devices:** Galaxy A15/A16 class (Helio G99, Mali-G57 MC2, 4 GB, 1080×2340, ~90 Hz) and Redmi/Galaxy A0x class (Helio G85, Mali-G52 MC2, 3–4 GB, 720×1600). Specs from memory, unverified.
  - JS throughput on Cortex-A55/A76-class cores is **~4–6× slower than an A15** (unverified).
  - Budget the sim against the low-end Android device, not the iPhone.
- **WebGPU:** Android 12+ ARM/Qualcomm only (gpuweb wiki). Mali-G5x drivers are a risk, so default to WebGL2.
- **Android WebView in Capacitor** is the Play-updated Chromium System WebView, so features follow Chrome. WebGPU-in-WebView status is unverified. Assume WebGL2.
- `navigator.vibrate` works. Fullscreen API works (`requestFullscreen` + `screen.orientation.lock` in fullscreen). Manifest `display: fullscreen` + `orientation` are honoured for installed PWAs (unverified).
- Low-RAM devices kill background tabs aggressively, so the same autosave discipline applies.

---

## 6. Capacitor wrapping plan
- **Versions:** `@capacitor/core|ios|android` **8.5.2**. iOS deployment target 15.0. Android minSdk 24, target 36 (verified from the package).
- **Plugins:**
  - `@capacitor/haptics` 8.0.2;
  - `@capacitor/status-bar` 8.0.3;
  - `@capacitor/screen-orientation` 8.0.1;
  - `@capacitor/filesystem` 8.1.3;
  - `@capacitor/preferences` 8.0.1;
  - for IAP, RevenueCat's Capacitor SDK (unverified current version).
- **Bundle everything locally** (`webDir: dist`). No remote-URL shells. App Store guideline 4.2 (minimum functionality) rejects thin web wrappers; a complete offline game with native haptics and a native save is defensible (unverified review outcome).
- **iOS WKWebView:**
  - Same WebKit as that iOS version's Safari, so the same memory and WebGL caveats apply.
  - The 7-day ITP cap doesn't apply to an app's own WKWebView (unverified), but we still use the Filesystem plugin for saves.
  - For >60 fps rAF in WKWebView, testing is needed. Native apps need `CADisableMinimumFrameDurationOnPhone=true` in Info.plist; whether WKWebView rAF honours it is unverified.
- **Platform detection:** `Capacitor.isNativePlatform()` selects `CapacitorPlatform`.

---

## 7. Testing strategy

### 7.1 Unit and property tests (Vitest 5, Node 22+)
- The sim core is pure TS, so these tests are fast with no browser:
  - **Belts:**
    - item conservation (in = out + stored) under random build sequences;
    - gap-encoded lines equal a naive per-item reference sim over 10k random ticks (property test with `fast-check`);
    - lift ring buffers, timing wheel and power satisfaction.
  - **Motherload rules:** fuel burn per second (idle vs moving vs drilling), dig time by hardness and drill tier, cargo weight and capacity, fall damage thresholds, gas/lava damage formulas (brief 01), sell prices, upgrade costs.
  - **Determinism golden hash:** seed + scripted command log, run 36,000 ticks (30 min at 20 Hz), FNV-1a hash of the state equals the committed golden value.
  - **Save round-trip:** save → load → identical hash. Version migrations from fixture saves of every past version.
  - **Offline catch-up:** the closed-form result stays within tolerance of the full sim for stable chains.
  - **Perf guard:** `bench` blocks (Vitest bench) for factory tick with 2,000 buildings and 10k items. Fail CI if > 2× the baseline.

### 7.2 Browser tests (Playwright 1.63, headless Chromium)
- **Environment finding (this container):**
  - `npx playwright install` **failed**: `cdn.playwright.dev` is not on the egress allow-list (HTTP 403).
  - **Workaround verified:** install `@sparticuz/chromium` (v153, from the npm registry, which is allowed), then `executablePath: await chromium.executablePath()` → `/tmp/chromium`, launched via `playwright.chromium.launch({ executablePath, args })`.
  - Request `cdn.playwright.dev` on the allow-list for CI, or use a CI image with browsers baked in.
- **Verified flags and behaviour (Chrome 153 headless shell):**
  - `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`:
    - **WebGL2 works**, renderer string `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`;
    - three.js `WebGLRenderer` and `WebGPURenderer({forceWebGL:true})` both rendered the isometric test scene correctly in screenshots;
    - 1,000 instances = 1 draw call / 12,000 triangles in WebGL; 2 draw calls in WebGPURenderer.
  - Chrome 137 removed the automatic SwiftShader fallback for WebGL; `--enable-unsafe-swiftshader` is now required. Playwright adds it by default for its own Chromium builds (https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md, https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM, search snippet).
  - **WebGPU:**
    - With default flags `requestAdapter()` returned **null**.
    - With `--enable-unsafe-webgpu` it returned a **SwiftShader fallback adapter** (`isFallbackAdapter: true`). three.js used the WebGPU backend (draw calls counted), but **`page.screenshot()` captured a blank white canvas** and the console logged `Instance dropped in popErrorScope`.
    - So **pixel tests must run on the WebGL2 path**. WebGPU gets a functional smoke test only (no errors, draw calls > 0, adapter info logged).
    - Plain `http://localhost` counts as a secure context for `navigator.gpu`; `about:blank` didn't expose it.
  - Babylon 9 and PlayCanvas 2.23 also ran under SwiftShader (rAF ~47–60/s). SwiftShader frame rates are **not** a GPU benchmark.
- **Test suite:**
  1. **Boot smoke:**
     - viewport 390×844, `isMobile`, `hasTouch`, `deviceScaleFactor: 1` (speed);
     - `?seed=1&renderer=webgl&fx=low&dpr=1&test=1`;
     - assert no console errors, canvas present, non-uniform pixels, HUD shows fuel 100%.
  2. **Scripted loop** via a `window.__hf.test` API (enabled only with `test=1`):
     - drive down 10 tiles, collect ore, return, sell;
     - assert cash increased and fuel decreased by the expected amounts.
     - Uses the real input path: `page.touchscreen.tap` / dispatched pointer events on the thrust and drill buttons.
  3. **Screenshot tests:**
     - fixed seed, frozen time (`__hf.test.freeze(t)`), animations off;
     - surface shop, underground at depth 50, build mode with belts;
     - `toHaveScreenshot({ maxDiffPixelRatio: 0.01 })`, with baselines generated in the same container image.
  4. **Context-loss test:** `gl.getExtension('WEBGL_lose_context').loseContext()`, wait, then `restoreContext()`. Assert the frame renders again and the sim is intact.
  5. **Save/persistence:** play, autosave, reload, assert identical state hash. Fill storage to quota with a mocked `QuotaExceededError` and assert a graceful message.
  6. **Visibility:** emulate `visibilitychange` hidden → visible and assert the sim paused and offline catch-up ran.
  7. **Gesture tests:** pinch (two touch pointers) changes the zoom. `pointercancel` releases the thrust button.
  8. **Bundle budget:** a CI step fails if the initial JS exceeds 350 KB brotli.
- **Not testable headless:** iOS memory kills, audio unlock and silent switch, Low Power Mode, thermal behaviour, haptics, safe-area rendering and real GPU cost. Playwright's WebKit on Linux is not iOS Safari.
  - Keep a **real-device checklist** for each release on an iPhone 12/13 (iOS 17 and 26), a recent Pro (ProMotion), an iPhone SE 2/3 (small screen, 3–4 GB) and a low-end Android.
  - Safari Web Inspector (macOS) is the profiler. A cloud real-device farm (BrowserStack/Sauce) is optional (unverified pricing).
- **In-game diagnostics overlay** (`?debug=1`): FPS, CPU frame ms, sim ms per tick (worker-reported), draw calls/triangles (`renderer.info.render`), geometries/textures counts, estimated GPU MB (own accounting), render scale, backend, and a 30 fps-cadence flag.

---

## 8. Performance budgets

Assumptions:
- **Mid iPhone** = iPhone 12/13 (A14/A15, 4 GB, 60 Hz, DPR 3).
- **Low Android** = Helio G85/G99 + Mali-G52/G57, 3–4 GB, 720p–1080p, Chrome WebGL2.
- These are design budgets to profile against in the week-1 spike, not measured device results. They line up with brief 02 §13 and brief 03 §5.

| Budget | Mid iPhone (12/13) | Low-end Android | Notes |
|---|---|---|---|
| Target frame rate | 60 fps (30 in LPM) | 60 fps target, 30 fps acceptable floor (auto "battery" tier) | Sim speed is independent of fps |
| Main-thread CPU per frame | **≤ 8 ms** (render submit ≤ 4 ms, pod sim ≤ 0.5 ms, UI ≤ 1 ms, rest slack) | **≤ 10 ms** | Leaves thermal headroom (§4.12) |
| GPU per frame | ≤ 10 ms | ≤ 12 ms | Dynamic resolution keeps it there |
| Render scale (DPR cap) | **1.5 default** (0.74 MP), 2.0 on high tier, dynamic down to 1.0 | **1.0–1.25** (≈0.6–0.9 MP), dynamic down to 0.75 | MSAA 4× on the default framebuffer |
| Draw calls | **≤ 120 typical, ≤ 200 peak** | **≤ 70 typical, ≤ 100 peak** | Chunks ≈ 4–12, instanced families ≈ 20–40, outlines double the gameplay objects only |
| Visible triangles | **≤ 150k** | **≤ 60k** | Chunks ≈ 1–2k tris each. Machines use LOD on low tier |
| Instances (belt items drawn) | ≤ 4,000 | ≤ 1,500 (crate-packing + LOD) | 16 B per instance, so ≤ 64 KB per frame upload |
| Texture memory (GPU) | **≤ 64 MB** | **≤ 32 MB** | Palette atlas 256² ≈ 0.25 MB. Shadow map 1024² depth ≈ 4 MB (iPhone only). UI is DOM |
| Total GPU memory incl. framebuffers | ≤ 150 MB | ≤ 100 MB | DPR 1.5 + MSAA ≈ 24 MB framebuffer (unverified materialisation) |
| JS heap (main + worker) | **≤ 120 MB** | **≤ 80 MB** | Pre-sized typed arrays, no per-item objects |
| Total page footprint target | **≤ 300 MB** | **≤ 250 MB** | Far below observed iOS kill thresholds (§4.1) |
| Decoded audio | ≤ 16 MB (SFX only) | ≤ 8 MB | Music streamed |
| Factory sim per tick (20 Hz, worker) | **≤ 2 ms** at 2,000 buildings / 10k items | **≤ 5 ms** | Brief 03 budget. Measured belt-tick microbench: 8.6 µs per tick for 500 lines / 20k items on an x86 core |
| Pod physics per step (60 Hz, main) | ≤ 0.3 ms | ≤ 0.6 ms | Grid collision only |
| Chunk remesh | ≤ 1 ms each, ≤ 2 per frame | ≤ 2 ms each, 1 per frame | Measured 0.038 ms per chunk on an x86 core |
| Particles | ≤ 500 | ≤ 250 | Brief 02 |
| Initial download (JS, brotli) | **≤ 350 KB** (three/webgpu ≈ 171 KB + game ≈ 120 KB + UI ≈ 15 KB) | same | CI-enforced |
| First playable payload | ≤ 2.5 MB total (meshes, palette, SFX) | same | Music and deep-band assets lazy-loaded |
| Time to interactive (4G) | ≤ 3 s | ≤ 5 s | Service-worker cache makes repeat launches ~instant |
| Save size / save time | ≤ 100 KB compressed, ≤ 10 ms in worker | ≤ 20 ms | Measured 45 KB / 3.5 ms for a pessimistic random world |

**Quality tiers:** pick a tier at first boot from a 2 s micro-benchmark plus `hardwareConcurrency`/`deviceMemory` (Chrome only) and the UA. Re-evaluate after crash-loop detection or sustained over-budget frames. Store the tier, and let players override it.

---

## 9. Evidence log: measurements made in this container
- **npm versions (2026-10-01):**
  - three 0.186.1;
  - @babylonjs/core 9.29.0;
  - playcanvas 2.23.0;
  - @capacitor/core 8.5.2 (9.0 alpha exists);
  - vite 8.3.2 (deps include `rolldown ~1.2.11`);
  - vitest 5.0.3;
  - @playwright/test 1.63.0;
  - typescript 7.0.2;
  - preact 11.0.0;
  - fflate 0.8.3, idb-keyval 6.3.0, vite-plugin-pwa 1.3.0, bitecs 0.4.0, koota 0.6.6.
- **Bundle sizes (esbuild `--minify`, ES2022, gzip -9, brotli q11):**

  | Bundle | Raw | Gzip | Brotli |
  |---|---|---|---|
  | three WebGL | 524 KB | 130 KB | 108 KB |
  | three/webgpu | 772 KB | 210 KB | 171 KB |
  | Babylon (tree-shaken) | 1,831 KB | 425 KB | 320 KB |
  | PlayCanvas | 1,965 KB | 504 KB | 392 KB |

- **Headless Chromium 153 (`@sparticuz/chromium`) + Playwright 1.63:**
  - WebGL2 via SwiftShader: ✅ screenshots correct.
  - WebGPU: adapter null by default. A fallback adapter with `--enable-unsafe-webgpu`. The canvas screenshot was blank and the console showed `Instance dropped in popErrorScope`.
  - `forceWebGL` path: ✅.
- **Microbenchmarks (Node 22, x86 container core):**
  - 16×16 chunk remesh 0.038 ms (~395 quads);
  - gap-encoded belt tick 8.6 µs (500 lines / 20k items);
  - save 156 KB → 45 KB deflate in 3.5 ms.
- Scratch code: `/tmp/claude-0/-home-user-motherload/b31bea83-cc99-5356-abc6-4ac8586eb639/scratchpad/bench/` (`src/*.js`, `probe*.mjs`, `simbench.mjs`, `out/*.png`).

---

## 10. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| WebGPURenderer's WebGL2 backend slower or buggier on iOS than classic WebGLRenderer | Med | Week-1 spike gate (§3.2). Renderer code is isolated in `packages/render` |
| iOS tab memory kills | Med | Budgets (§8), crash-loop tier drop, frequent autosave |
| Save loss (ITP, Safari→PWA split, WKWebView purge) | Med | `persist()`, install prompt, export/import code, Capacitor Filesystem, optional cloud sync later |
| Thermal slowdown on long sessions | High | 60% frame budget, dynamic resolution, render-on-demand in menus, 30 fps battery mode |
| Low-end Android JS too slow for a big factory | Med | Worker sim, sleep/wake, crate packing, steady-state LOD (brief 03), instancing caps |
| Apple policy on wrapped web apps / EU PWA changes (Apple briefly removed EU home-screen apps in iOS 17.4 betas, unverified) | Low–Med | Real game content, native plugins, local bundle. The web build stays the primary channel |
| Playwright browsers blocked in CI egress | Known | `@sparticuz/chromium` from npm (verified), or allow-list `cdn.playwright.dev` |

---

## 11. Suggested first milestones (tech only)
1. **Week 1 spike:**
   - Vite + TS + three/webgpu.
   - Chunked diorama terrain (64×200), ortho camera, pod moving on a fixed step, DOM HUD with safe areas.
   - Playwright boot + screenshot test passing in the container.
   - Device measurements on an iPhone 12/13 and a low-end Android. Decide WebGPURenderer vs WebGLRenderer.
2. **Week 2:**
   - Sim core package with dig, fuel, cargo and sell (Motherload loop) under Vitest.
   - Save/load with IndexedDB and export code.
   - PWA manifest + service worker. Audio unlock.
3. **Week 3:**
   - Worker factory sim: belts (gap-encoded), one smelter, a lift to the surface depot.
   - Instanced items, snapshot interpolation.
   - Determinism golden test.
4. **Week 4:**
   - Quality tiers, dynamic resolution, crash-loop detection, debug overlay.
   - Capacitor iOS/Android shells with haptics.

---

## Sources (consulted)
- WebGPU implementation status: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- three.js releases: https://github.com/mrdoob/three.js/releases
- three.js iOS-related issues:
  - https://github.com/mrdoob/three.js/issues/32597
  - https://github.com/mrdoob/three.js/issues/29581
  - https://github.com/mrdoob/three.js/issues/29041
- three.js WebGPU (search snippets):
  - https://threejs.org/manual/en/webgpurenderer.html
  - https://www.utsubo.com/blog/threejs-2026-what-changed
  - https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- Babylon.js 9:
  - https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/
  - https://www.babylonjs.com/lite/
- PlayCanvas:
  - https://playcanvas.com/products/engine
  - https://newreleases.io/project/github/playcanvas/engine/release/v2.22.0
- Godot web export:
  - https://github.com/godotengine/godot-docs/blob/master/tutorials/export/exporting_for_web.rst
  - https://github.com/godotengine/godot/issues/107390
  - https://godotengine.org/article/progress-report-web-export-in-4-3/
- Unity on iOS Safari: https://bugnet.io/blog/how-to-fix-unity-webgl-build-crashing-on-safari-ios
- iOS memory:
  - https://lapcatsoftware.com/articles/2026/1/7.html
  - https://github.com/danishi/liminal-space/pull/10
  - https://medium.com/@shilpecsaxena9098/how-we-stopped-ios-safari-from-crashing-our-e-commerce-site-beeb948ded34
- 120 Hz:
  - https://www.macrumors.com/how-to/enable-smoother-120hz-browsing-in-safari/
  - https://birchtree.me/blog/how-to-enable-120hz-mode-in-safari-mac-iphone-and-ipad/
- Low Power Mode:
  - https://popmotion.io/blog/20180104-when-ios-throttles-requestanimationframe/
  - https://bugs.webkit.org/show_bug.cgi?id=215745
- Audio session:
  - https://adactio.com/links/19938
  - https://github.com/sinaida-space/infinite-voidsong/pull/24
  - https://github.com/w3c/mediasession/issues/378
- Storage:
  - https://web.dev/articles/storage-for-the-web
  - https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
  - https://www.itnews.com.au/news/apple-cops-flak-for-deleting-local-browser-storage-after-7-days-539833
- Haptics:
  - https://github.com/web-platform-tests/interop/issues/718
  - https://github.com/ionic-team/ionic-framework/issues/29942
  - https://x.com/firt/status/2028807962295230776
- SwiftShader / headless:
  - https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
  - https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM
  - https://issues.chromium.org/issues/40277080
  - https://blog.promaton.com/testing-3d-applications-with-playwright-on-gpu-1e9cfc8b54a9
- Capacitor:
  - https://ionic.io/blog/capacitor-8-5-released
  - npm package inspection of @capacitor/ios and @capacitor/android 8.5.2
- Fixed timestep: https://gafferongames.com/post/fix_your_timestep/
