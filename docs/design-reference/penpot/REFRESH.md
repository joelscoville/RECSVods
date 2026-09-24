# Refreshing The Penpot Snapshot

Refresh this package whenever the source design changes or before a major implementation pass.

## Requirements

- The `RECVods` Penpot file is connected to the Penpot MCP plugin.
- The browser tab containing Penpot is awake and focused.
- The agent has read the Penpot design skill and Penpot high-level overview.

## Procedure

1. Confirm the live file ID is `d8ac01df-6646-81d2-8008-a541da18e21b`.
2. Resolve every shape from `manifest.yaml` by stable ID.
3. Confirm each frame name and dimensions. Investigate changed IDs rather than silently substituting a similarly named frame.
4. Export each frame at 1x as WebP or PNG. Preserve the filename listed in the manifest.
5. Store exports in `frames/` without cropping, adding annotations, or changing aspect ratio.
6. Inspect each exported image for clipping, missing descendants, rendering errors, and accidental selection overlays.
7. Refresh tokens and component measurements from the local Penpot library.
8. Update `captured_at`, `status`, format, byte size, and SHA-256 in `manifest.yaml`.
9. Update `screens.md` only when the live design behavior or hierarchy changed.
10. Run the repository's design-reference validation when one exists, then inspect the complete diff.

## Export Quality

- Prefer WebP for compact checked-in visual references when text remains readable.
- Use PNG when WebP rendering differs from Penpot or text becomes unclear.
- Keep the original frame dimensions recorded in the manifest even if an additional half-scale preview is generated.
- Do not use JPEG for interface references because it can blur text and hard edges.
- Do not replace missing exports with hand-drawn approximations.

## Failure Handling

If Penpot times out, do not retry blindly. Focus the Penpot browser tab, re-read the frame structure, and confirm whether an export was created before retrying. Keep the last verified snapshot intact until a complete replacement export is available.
