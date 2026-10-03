# HoleFactory

A cozy-top, eerie-depths mining game for phones: fly a scrappy dig pod down a cross-section of Mars, bet fuel and hull on what glints below, and turn the tunnels you dig into a small automated factory that lifts ore home.

- **Gameplay:** keeps the dig–return–sell–upgrade loop of classic dig-and-return games, with original names, story and art, and adds Factorio-style drills, belts and lifts on the lodes you discover.
- **Platform:** portrait-first and web-first. It is a TypeScript + three.js PWA you install to the Home Screen; App Store and Play Store builds via Capacitor come later.
- **Scope:** single player with local saves; no monetisation in v1.

## Status

- **M0 "Style & Feel Test": done and reviewed.** Both looks (Clean Toon, Pixel Lab) with the A/B chip, gallery and questionnaire; the owner's device round and look pick are the M0 exit (canon §5.1).
- **MVP vertical slice: feature-complete and reviewed** on branch `claude/build-m0`, with review fixes landing.
- **Next: v1.0** (canon §5.3; [docs/PLAN.md](docs/PLAN.md) §6).

**What you can play (MVP build):** the pod loop down to the temporary Seal at 4,000 ft (refuel, dig, sell, upgrade, salvage), and the factory opening. After Dot's survey ping, dig down to her copper lode beside the old survey shaft and collect the free Starter Kit at the Supply Shed. Then press BUILD to place an Auto-Drill on the lode and a Bucket Lift up the shaft; Pip finishes each ghost by hovering beside it. Paint Yard belts from the Headframe to the Smelter and on to the Bin: ore now reaches the surface by itself and the first ingot comes out. An Assembler then turns ingots into Wire and Hull Plates, the parts for the first tier-3 upgrade.

## Run

Node 22 or newer.

```sh
npm i
npm run dev                  # Vite dev server (--host), http://localhost:5173/
npm run build                # production build into dist/ (MVP scope)
HF_SCOPE=m0 npm run build    # m0 | mvp | v1: the canon §5.5 scope baked into the build (default mvp)
npm run preview              # serve dist/ at http://localhost:4173/
npm run size                 # after a build: initial JS against the canon §3.14 budget
npm run typecheck            # tsc: the pure sim project, then the app
npx vitest run               # unit, replay, bot-smoke and soak tests
npx playwright test          # e2e at iPhone sizes (Chromium + SwiftShader); builds and previews on :4173 first
```

- `?test=1` installs the `window.__hf` test API (`src/debug/testHook.ts`). The e2e boot is `/?test=1&seed=7&tier=low&standalone=1`: a fixed seed, the low tier, and no install-first title. `?debug=1` adds the Debug menu.
- Playwright needs its Chromium once: `npx playwright install chromium`.
- `/bench.html` on a preview build runs the browser factory bench (ADR-0002; [docs/design/bot-report.md](docs/design/bot-report.md)). `/jetsam.html` is the memory probe.

## Read

- [docs/PLAN.md](docs/PLAN.md) is the master plan: what we're building, the roadmap, risks and open questions. Start here.
- [docs/design/](docs/design/) holds the detailed spec, beginning with [00-canon.md](docs/design/00-canon.md), the single source of truth.
- [docs/research/](docs/research/) holds the background research briefs.
