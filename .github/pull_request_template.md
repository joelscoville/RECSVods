## Code review

### Changes

<!-- Describe implementation, tests and documentation separately from archive interpretation. Link correction issues where applicable. -->

### Verification

<!-- Record commands and results, including failures or pending checks. Run through scripts/devenv-run; do not tick unperformed checks. -->

- [ ] Archive validation: timestamp bounds, known videos, unique IDs, parseable scripture, required metadata and multipart ordering.
- [ ] Failed, rejected and unresolved media excluded from ordinary playback/search; production excludes unreviewed content.
- [ ] No media, credentials, private paths/evidence, provenance hashes or ESV verse text in public build artifacts; no media or ESV verse text added to Git.
- [ ] Generated schemas, reproducible indexes and search evaluation pass.
- [ ] `pnpm check` passes against the final source (quality, unit/Python, archive, fresh-build browser and exact-search acceptance).
- [ ] Behavior changes have focused regression coverage; search changes pass `pnpm test:search`, including relevant inclusion/exclusion and visible-reference assertions.
- [ ] `pnpm build` and `pnpm build:preview` pass with a non-root `SITE_BASE_PATH`.
- [ ] Affected keyboard, accessibility, empty/error and responsive states checked against the established Penpot reference.
- [ ] Correction links use stable public IDs, correct source files and the configured repository/ref without local state.

## Editorial review

### Services and uncertainty

<!-- List service/video IDs, evidence limitations, uncertain wording/boundaries and competing-upload decisions. Keep private evidence and local paths out of this public PR. Use separate code and content commits for milestone checkpoints. -->

### Review

AI-drafted recordings stay `status: draft` (not on the website). A person who has checked a recording marks it `status: published`; the chapter editor does this when you send from it. Merging this pull request publishes recordings marked `published`.

- [ ] A person checked each recording this marks `published`.
