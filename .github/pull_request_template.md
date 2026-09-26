## Code review

### Changes

<!-- Describe implementation, tests and documentation separately from archive interpretation. Link correction issues where applicable. -->

### Verification

<!-- Record commands and results, including failures or pending checks. Run through scripts/devenv-run; do not tick unperformed checks. -->

- [ ] Archive validation: timestamp bounds, known videos, unique IDs, parseable scripture, required metadata and multipart ordering.
- [ ] Failed, rejected and unresolved media excluded from ordinary playback/search; production excludes unreviewed content.
- [ ] No media, credentials, private paths/evidence, provenance hashes or ESV verse text in public build artifacts; no media or ESV verse text added to Git.
- [ ] Reproducible indexes, search evaluation and `editorial-guard` pass.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm validate:archive`, `pnpm test:search` and `pnpm test:e2e` pass.
- [ ] `pnpm build` and `pnpm build:preview` pass with a non-root `SITE_BASE_PATH`.
- [ ] Affected keyboard, accessibility, empty/error and responsive states checked against the established Penpot reference.
- [ ] Correction links use stable public IDs, correct source files and the configured repository/ref without local state.

## Editorial review

### Services and uncertainty

<!-- List service/video IDs, evidence limitations, uncertain wording/boundaries and competing-upload decisions. Keep private evidence and local paths out of this public PR. Use separate code and content commits for milestone checkpoints. -->

### Human review and approval

All agent-authored or changed interpretation stays `needs_review`. For any interpretation change to a previously reviewed service, reset it to `needs_review` and clear `reviewed_by` / `reviewed_at` in the same change. Code review and merging this PR do not grant editorial approval.

A **human** reviews the complete logical service (all videos, sections, passages and transcripts):

1. Run `SITE_BASE_PATH=/review/ scripts/devenv-run pnpm build:preview`, then `SITE_BASE_PATH=/review/ scripts/devenv-run pnpm preview` for local inspection. Preview output must never be deployed.
2. Check the recording, wording, boundaries, references, speaker attribution, summaries and media dispositions. Resolve, edit or remove material that should be withheld before approval.
3. Only after that review, the human runs `scripts/devenv-run pnpm editorial:approve -- <service-id> --reviewer <name>` from a suitable clean working tree. This makes an approval-only commit with the `Editorial-Approval` trailer. Agents must never run this command, write `reviewed` or add that trailer.
4. Review the separate approval change and `editorial-guard` result. Only reviewed services with playable videos enter the next production build. Approval may be a small follow-up PR.

<!-- Record human decisions only when actually made. An unchecked editorial review is expected for the agent implementation PR. -->
- [ ] Human reviewed and approved each service listed as approved above.
