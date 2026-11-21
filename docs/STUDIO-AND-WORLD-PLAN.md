# Studio and World plan

What to build next for the dance **Studio** (`#/studio`) and the home **World** (the block village at `#/`).
Vocabulary follows [concepts/MODES.md](concepts/MODES.md).

## Where things stand (main, 2026-11-20)

| Area | Already there |
|------|---------------|
| World | Block village with houses, trees and a pond; a wandering crowd with pathfinding and personal space; click a character to select it; Move panel with emoji tiles; free camera; lighting presets |
| Studio | Mix clips with weights and speeds; A↔B crossfade with auto-sweep; save the current mix as a one-step combo that the Move panel lists under "My combos" |
| Creator | Wardrobe, 3D, 2D. "Make it me" lives only on the unmerged local `feat/schematic-props` branch |

## Phase 1: essentials (done)

All four are merged into `feat/studio-world-essentials` and were checked together in the browser.

| # | Feature | Branch | What it adds | Done when |
|---|---------|--------|--------------|-----------|
| 1 | Studio routine timeline | `feat/studio-routine` | Build a routine from several mixes: add the current mix as a step, set each step's length, reorder, remove, preview, save as a multi-step combo | A three-step routine plays in the Studio and from the Move panel |
| 2 | Studio photo and video | `feat/studio-capture` | Photo button (PNG, optional transparent background) and Record button (WebM of the stage) | Both files download and open; recording stops cleanly on leaving the Studio |
| 3 | World residents | `feat/world-residents` | Pick which skins live in the village and how many; remembered between visits | Toggling a skin adds or removes that character without a reload |
| 4 | World day and night | `feat/world-day-night` | Time-of-day slider and auto cycle: sky, sun angle and brightness, lamp posts glow at night; remembered between visits | Dragging the slider moves smoothly from noon to night in the home view |

Rules for all four: logic in pure modules with `node:test` coverage, import boundaries from
[concepts/TAXONOMY.md](concepts/TAXONOMY.md) respected, wiring in `src/main.ts` kept to a few lines,
`npm run typecheck` and `npm test` green.

## Phase 2: makes it feel alive

Built features are merged into `feat/studio-world-essentials`; in-progress ones have a worktree each.

| Feature | Status | Notes |
|---------|--------|-------|
| Group dance in the Studio | Built | Up to two backup dancers copy the lead in a line, triangle or stagger, together or a beat behind. Residents are picked first |
| Studio backdrops | Built | Solid colors, gradients, a spotlight or your own color; the floor can be hidden. The village behind the stage is not done |
| Turntable and framing buttons | Built | A turntable at three speeds and Full body / Close-up / Wide framings; both take in the backup dancers. Named camera bookmarks are not done |
| Resident behavior | Built | Greetings, plaza gatherings (with saved combos) and a night routine. Unit-tested, not yet watched in a browser. Benches are not done |
| Studio panel polish | In progress | Collapsible sections with summaries, clips first, group framing fixes, a REC badge |
| Weather | In progress | Rain and snow particles that share the day and night lighting |
| Held items | Not started | A torch, tool or flower in hand, previewed from the Wardrobe |

## Phase 3: building and sharing

| Feature | Status | Notes |
|---------|--------|-------|
| One save file | In progress | Residents, village layout, routines and time of day in one export and import |
| Share code | In progress | A code that recreates a routine, shared per combo from the Studio and the Move panel |
| Send to World / Open in Studio | In progress | Shortcuts in the Creator so a finished skin shows up at once, with outfits that are remembered |
| Village editor | Not started | Paint tiles and place houses in `VILLAGE_MAP`; saved per user |
| Schematic props | Not started | Bring back `.schem` props (removed in PR 7) as scenery placed through the village editor |

## Open items

- `feat/schematic-props` (local) holds 11 unmerged commits of "Make it me" work plus uncommitted edits. It is 55
  commits behind `main` and needs a rebase and its own PR; nothing in this plan touches it.
- Bundled skins and Mixamo clips are test-only ([ATTRIBUTION-ASSESSMENT.md](ATTRIBUTION-ASSESSMENT.md)); video
  export makes that matter more before a public release.
