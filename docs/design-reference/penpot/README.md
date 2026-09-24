# RECS Replay Penpot Offline Harness

This folder is the offline design reference for implementation agents when the Penpot MCP connection is unavailable. It records the stable Penpot identifiers, exported frames, design tokens, reusable component measurements, and screen behavior needed to implement RECS Replay without guessing.

## Source

```text
Penpot file: RECVods
File ID: d8ac01df-6646-81d2-8008-a541da18e21b
Page: Page 1
Page ID: 18fa6d94-c385-80af-8008-a5415672a126
```

The live Penpot file remains the source of truth. This package is a point-in-time fallback. Do not modify the Penpot source merely to make it match an implementation.

## Agent Usage

The Penpot design skill and MCP connection are currently set up for Codex and OpenCode, not Claude Code. Claude Code sessions use the offline snapshot.

When Penpot MCP is available:

1. Read the Penpot design skill and high-level API overview.
2. Locate frames by the IDs in `manifest.yaml`, not by current selection.
3. Export the relevant live frames and compare them with the checked-in files.
4. Refresh changed assets and metadata using `REFRESH.md`.
5. Treat the source frames as read-only unless the user explicitly requests design changes.

When Penpot MCP is unavailable (including in Claude Code):

1. Read `manifest.yaml`, `tokens.json`, `components.yaml`, and `screens.md`.
2. Inspect the matching image in `frames/` when its manifest status is `exported`.
3. Use the exact IDs, dimensions, tokens, typography, and layout behavior recorded here.
4. Do not claim pixel-level Penpot verification. Report that implementation used the offline snapshot and state its capture date.
5. If a required frame is marked `missing`, stop visual-fidelity work for that screen rather than inventing undocumented design.

## Precedence

If references disagree, use this order:

1. A freshly inspected live Penpot frame.
2. A checked-in frame export whose ID and dimensions match `manifest.yaml`.
3. Measured values in `tokens.json` and `components.yaml`.
4. Behavioral and responsive guidance in `screens.md`.
5. The implementation-prompt prose.

Never copy placeholder content such as `Video Title`, `Video Category`, or the keyboard demonstration into production. These describe layout, not final archive content.

## Known Design Gaps

- There is no complete desktop search-results frame. Derive it from the desktop navigation, video-card, chapter-row, palette, typography, and spacing patterns.
- The keyboard artwork is a design demonstration only. Production must use and test the real software keyboard.
- Some mobile card typography appears to have been scaled from desktop. Preserve hierarchy and type roles rather than copying accidental fractional font sizes.
- Some Penpot layer names contain spelling mistakes such as `Seach Bar` and `Timeline CHater`. Use correct implementation names.

## Offline Verification Language

Use wording such as:

> Compared the implementation with the checked-in Penpot snapshot captured from file `d8ac01df-6646-81d2-8008-a541da18e21b`; live MCP verification was unavailable.

Do not say the implementation was verified against live Penpot unless the live frames were exported and inspected during that run.
