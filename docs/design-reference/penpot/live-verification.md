# Penpot snapshot verification — 2026-09-25

## Result and evidence boundaries

**The complete local snapshot is intact; live verification is blocked.** Local checks completed at `2026-09-25T02:40:00Z`. The persisted capture remains `2026-09-23T14:54:19Z`; this check does not advance its capture date.

- Loaded `penpot-design` and the Penpot High-Level Overview. Read `REFRESH.md`, `manifest.yaml`, `tokens.json`, `components.yaml`, `screens.md`, and the package README.
- Inspected all 13 saved WebP images. `shasum -a 256`, `stat -f '%N %z bytes'`, and `sips -g pixelWidth -g pixelHeight` confirmed every hash, byte size, and pixel dimension against the manifest.
- `git diff --exit-code HEAD -- docs/design-reference/penpot` passed before this report/verification metadata was added. All 13 images are tracked. No image, token, component, or screen-guide content was refreshed.
- The first read-only Penpot query requested the connected file ID/name and page inventory. It failed before returning any file data: **“The Penpot plugin tab appears to be suspended by the browser (no heartbeat for 55s). Please click/focus the Penpot tab to wake it, then retry.”**
- Consequently, this run did not freshly resolve any live frame ID, inspect the live library, or export any live frame. No current live-versus-saved difference or identity can be established by this run.
- The requester reports that the main agent already exported desktop new-user and visually matched it to the saved image. That is attributed context, not an independent live verification here.
- Zero exports were persisted. No replacement-image hashes or capture timestamps were invented. Export delivery/download capability was not tested because the connection failed before export; an image-only tool response would permit visual review but would not prove that an export was saved locally.
- No Penpot mutations or selection operations were issued. Source work was preserved by this read-only operation; an independent before/after live-state comparison was unavailable.

## Frame inventory checked locally

Expected source file: `d8ac01df-6646-81d2-8008-a541da18e21b`; expected page: `18fa6d94-c385-80af-8008-a5415672a126` (`Page 1`). These are manifest identifiers, not freshly confirmed live identifiers.

Every row below passed local hash, byte-size, dimension, and image inspection. Paths are `frames/<key>.webp`; names and hashes remain in `manifest.yaml`.

| Key | Manifest shape ID | Verified saved dimensions |
| --- | --- | --- |
| home-desktop-returning | `b2c9ceb5-f0e9-5d6b-b95f-5a1275a567cd` | 1728 × 1470 |
| home-desktop-new | `55888863-4675-8006-8008-a5e3f99c9577` | 1728 × 1470 |
| home-mobile-portrait-returning | `88049aca-346e-50bb-a7b9-6f3a52558e7d` | 390 × 2320 |
| home-mobile-portrait-new | `7bcecdaf-67b6-80d9-8008-a70e786c821b` | 390 × 2320 |
| home-mobile-landscape-returning | `7bcecdaf-67b6-80d9-8008-a70f4eaf02d2` | 844 × 1367 |
| home-mobile-landscape-new | `a8acd6cb-e23f-8012-8008-a7f5208582e1` | 844 × 1367 |
| search-mobile-portrait-browse | `e32dcc5b-b27c-807d-8008-a723c5d4dc38` | 390 × 844 |
| search-mobile-landscape-browse | `e32dcc5b-b27c-807d-8008-a72695758aa7` | 844 × 390 |
| search-mobile-portrait-keyboard-demo | `e32dcc5b-b27c-807d-8008-a7244553be1c` | 390 × 844 |
| search-mobile-landscape-keyboard-demo | `85acc997-f6ae-808a-8008-a73732baab94` | 844 × 390 |
| playback-desktop | `85acc997-f6ae-808a-8008-a7384efacd1b` | 1728 × 1331 |
| playback-mobile-portrait | `e2e985d2-8411-8025-8008-a8747a84ba01` | 390 × 844 |
| playback-mobile-landscape | `e2e985d2-8411-8025-8008-a8762ff945b6` | 844 × 390 |

## Confirmed image/prose discrepancies important for implementation

These findings concern the actual saved images, not newly observed live changes. The README's precedence puts the images above descriptive prose. Approximate positions below are visual readings of the saved references, not API measurements.

### Home color and state

- **New-user featured fields are burgundy in desktop, mobile portrait, and mobile landscape. Returning-user featured fields are indigo in all three.** This is already present in the committed exports. `screens.md` describes the desktop new-user structure without the color distinction and calls the mobile featured field indigo without restricting that statement to returning users.
- The corresponding recorded palette values are burgundy `#6C0000` and bright indigo `#273469`. Their live shape assignments remain unverified; these exact hex values come from `tokens.json`, not pixel sampling of lossy WebP images.
- `components.yaml` records the reusable Call To Action main instance as indigo. That does not establish the fill of the new-user instance. Preserve the state distinction visible in the screen exports.
- Portrait returning-user shows a thin burgundy progress segment beneath its featured thumbnail; portrait new-user does not. Both show a burgundy `All` chip. A static image cannot establish the claimed non-color selected-state semantics.

### Home spacing, columns, and font roles

- Desktop combines an editorial CTA and featured card inside one field, an additional card beside it, a four-column supporting video row, then a four-column category row. The new and returning states are not pixel-identical layouts with only copy/fill substitutions: the CTA begins at approximately y=170 in new-user and y=154 in returning-user; supporting thumbnails begin around y=637 versus y=631. Do not infer a universal gap from either one.
- Portrait uses a compact sans-serif featured heading above a single full-width card, then a one-column feed. Landscape uses a large **serif** editorial heading beside the featured card and a **two-column** feed. The landscape serif appearance conflicts with the `tokens.json` note “Use Domine only for the large desktop editorial call to action.” The image establishes a serif role on landscape; exact font family, size, weight, and line-height still require live text inspection.
- Landscape home is a full 844 × 1367 page, not an 844 × 390 screen to scale down. In the saved images, the header/filter area ends around y=116, the featured field ends around y=476, the feed begins around y=496, and the footer begins around y=1176. Feed columns have roughly 56px outer margins and a 16px gutter. These are visual reference estimates, not refreshed component measurements.
- Desktop has a wide search field; mobile home shows a search icon. Landscape home retains the compact mobile header rather than restoring desktop navigation.
- Home thumbnail placeholders visibly have a different aspect ratio from the 16:9 playback player. Preserve each reference's role; do not stretch player media to match card artwork.

### Search and keyboard states

- Portrait browse places the search field below Back/title, then history, categories, and trending. Landscape puts the input in the top row; history/trending occupy the left column and categories the right.
- The frame named `Search / Mobile - Landscape - Results` is saved under the keyboard-demo key. Its image shows browse content with keyboard artwork, not a result list, consistent with the manifest note.
- The landscape keyboard artwork starts around y=157 and **covers lower portions of history chips and category tiles**. Thus the saved illustration does not prove the prose's keyboard-safe layout; do not reproduce that overlap as production behavior. The portrait keyboard illustration begins around y=524, after a compressed trending section.
- The keyboard artwork uses a lavender background visibly different from ordinary periwinkle surfaces. Its exact source color is not established here; the eight recorded palette colors are not evidence of an exhaustive live fill inventory.

### Playback

- Desktop shows player and chapter panel side by side, then metadata/summary and footer. Portrait stacks the player, metadata, divider, and chapters. The saved portrait frame cuts off the next chapter card near the bottom; it documents a scrolling state rather than all chapters fitting in 844px.
- Landscape playback has a centered 16:9 player approximately 693px wide at 390px high, with black side regions and Back at the left. “Across the available width” in `screens.md` should not be read as stretching 16:9 media to fill 844 × 390.
- Playback renders darker surfaces than the ordinary home indigo, and sample player artwork includes shaded backgrounds. Exact fills/gradients cannot be reconstructed from the existing token list alone or claimed as live measurements.
- The first chapter is visually distinguished by a periwinkle surface and a contrasting timestamp pill. No explicit “current” text/icon is visible; the prose's non-color active-state requirement is behavioral guidance, not a verified attribute of the exported image.

## Existing recorded system values — not freshly measured

The current local references record:

- Palette: surface `#FAFAFF`, periwinkle `#E4D9FF`, burgundy `#6C0000`, bright indigo `#273469`, dark navy `#1E2749`, gold `#FFAA5A`, black `#000000`, on-surface `#1D1B20`.
- Typography: Atkinson Hyperlegible Next for interface roles; Domine for editorial. Recorded styles are title 36px/700, subtext 24px/500, editorial 83px/700, mobile title 24px/600, mobile body 14px/600. Neither exact font identity nor fractional instance sizes can be verified from a raster image alone.
- Geometry: default radius 12px, mobile search radius 24px, search-chip radius 14px, base spacing 12px. These do not mean every observed gap is 12px.
- NAV: 1728 × 151, row gap 61px, top/right/bottom/left padding 37/53/37/53px. Search Bar: 1033 × 66. Video: 387 × 350. Categories: 387 × 252.
- Call To Action main: 1125 × 412, row-reverse, padding 50/50/18/50px. Its recorded indigo fill must not override new-user screen imagery.
- Mobile Search Field: 358 × 35, burgundy, radius 24px. Search Chip: 110 × 38, periwinkle, radius 14px. Back: 44 × 44. Mobile Chapter Row: 358 × 88, radius 12px.
- Footer mains: desktop 1737 × 140, mobile 390 × 173. A main-component size does not establish every responsive instance's size, as the landscape export demonstrates.

The local/connected component inventory, typography assets, token sets, current fill assignments, layout gaps, constraints, and instance overrides could not be inspected live. These remain open verification items, not confirmed unchanged values.

## Resume live verification

1. Focus the Penpot browser tab and ensure the MCP plugin is connected. Re-read the file/page identity before any exports; do not select shapes.
2. Resolve all 13 manifest IDs and compare exact names/dimensions. Inspect bounded summaries of palette, typography, libraries, main components, and relevant instance geometry.
3. Export the 13 frames by stable ID and visually compare each with its saved counterpart, including the color/font/spacing distinctions above. Record visual equality separately from byte/pixel equality.
4. If exports return only inline images without downloadable bytes or a local path, record visual results and the persistence limitation. Do not advance `captured_at`, byte sizes, or hashes unless replacement files were actually persisted and checked.
5. If live changes are found, report the affected IDs and required refresh. This task's writable scope is only `manifest.yaml` and this report; replacing frame files or revising tokens/components/screens requires the owning agent to perform the broader refresh.

Until then, the existing complete references remain usable under the documented offline fallback. No missing or corrupt saved image was found. There is no design-reference validation script in the inspected `package.json`; the direct metadata/hash checks above are the completed verification.
