# Repository, deployment and recovery

## Repository settings — human setup

1. Enable GitHub Actions. In **Settings → Pages**, select **GitHub Actions** as the
   source. Configure a custom domain there if desired; do not introduce a second
   application base-path variable.
2. Protect the default branch with required PR/code review and check **validate**.
   Remove the retired **editorial-guard** requirement if it is still configured.
   Require current checks, block force pushes/deletions and avoid broad bypass rights.
   Merging a pull request that marks a recording `published`
   publishes it; any merge method works.
3. Restrict the `github-pages` deployment environment to the default branch. Add
   human environment reviewers if the organization requires them.
4. Enable Actions failure notifications and confirm the discovery schedule/manual
   dispatch permissions. Discovery needs issue writes, not content or Pages writes.
5. Set `PUBLIC_CORRECTIONS_URL` (public contact/form URL or mailto address), or
   `PUBLIC_REPOSITORY_URL` for a public correction repository, as an Actions repository
   variable. Verify access signed out. The private Git remote is not a fallback.

No settings, branch protection, environment, merge or deployment is changed by the
implementation agent. These are administrator actions, documented for completion.
Approval is a person's reviewed pull request. Archive validation checks the recording
schema and cross-file rules; there is no separate editorial-state/history guard.

## Pipeline boundaries

`ci.yml` runs on PRs, default-branch pushes and manual dispatch. Separate
code-quality, unit/Python and browser/build jobs run independently.
The required `validate` aggregation rejects failed, cancelled or skipped groups;
it must succeed before Pages build/upload and deployment.
PR jobs have only `contents: read`; no `pull_request_target` is used.
Only main-branch push/manual runs can upload/deploy. **Manual CI dispatch on main
can deploy after checks pass**; use local checks or a PR when testing without deployment.

Validation builds production and preview under `/replay-check/`, checks direct routes
and assets, validates generated vectors and privacy, and exercises the browser.
CI uses `--exact-only` acceptance and `RECS_E2E_NO_MODEL=1`: semantic worker/model
execution is blocked and real-inference browser cases belong to the separately selected
`pnpm test:e2e:model` project. See [testing](testing.md) for local parallelism and reruns.
Builds generate search vectors from public metadata and cited BSB text, using the
pinned embedding model when rows are not cached. No captions, ASR or LLM drafting
runs in Actions. Full semantic query acceptance remains a local
person-invoked command. Fixture tests cannot substitute for real media review.

The Pages build independently runs `pnpm build` after validation; it never reuses
preview output. `actions/configure-pages` supplies the hosting prefix, normalized
into the existing **`SITE_BASE_PATH`** setting. `pnpm verify:pages` requires a matching
production marker, eligible metadata, valid private-data boundary, and working local
routes/assets before the sole upload of `dist/production`. Deploy alone receives
`pages: write` and `id-token: write`. Deployment concurrency is serialized.

Caches contain package dependencies and hash-verified model/runtime assets only.
No media, ASR, captions, private vector-processing cache or review build is uploaded
as a validation artifact. `verify:tracked` checks the repository for recording media,
caption files, caches and common credential formats; it is a useful check, not proof
against every possible disguised secret. Never stage secrets in the first place.

## Human verification after deployment

Record reviewer, date, device/browser, deployed commit and observed result. Check:

- Root, `/search/`, `/watch/`, `/browse/`, `/policies/`, a published service URL, and
  their assets under the actual Pages prefix, including reload/direct navigation.
- Only published recordings appear in the built search index. No draft recording
  data or preview banner appears in ordinary production pages.
- Exact/reference results precede the model, first-load and cached semantic behavior,
  multipart timing, player errors, replay/continue, and local data clearing.
- Actual YouTube playback with audio at representative starts/endpoints. Automated
  IFrame adapters establish controller behavior, not provider availability or timing.
- Keyboard and assistive-technology behavior on real devices, including the subsection
  tree and mobile keyboard. Automated axe scans do not establish formal conformance.

## Corrections and unavailable videos

Use **Suggest a change** to open the recording editor. A person checks the change
and sends it as a pull request; sending from the editor sets `status: published`.
The default-branch deployment publishes the merged correction. The next build
automatically regenerates rows whose published text changed.

For an upload that has gone from YouTube, set `uploadUnavailable: true`. Confirmed
audio problems belong in `uploadQuirks`; diagnostic sampling does not set flags.
Keep upload durations and order accurate: chapter times use the recording clock
across all uploads. See [the format](editing-services.md) and [quirks](quirks.md).

## Roll-forward recovery

Inspect the failed check/log or deployed commit first. A failed validation must
not deploy. Fix code/configuration on a branch, run the same checks, obtain review,
and merge a corrective commit. If a prior implementation must be restored, use a
reviewed revert/new commit rather than force-pushing or rewriting approval history.
If bad published interpretation is involved, set it back to `draft` until a person
has fixed it. Re-run main's workflow only
when a deployment is intended. Preview is never an emergency deployment substitute.

Discovery failure is independent: inspect the Actions failure, retry a dry run, and
resolve malformed source or duplicate issue markers without erasing curator notes.
The feed is recent-only; manually supply missed IDs rather than assuming completeness.

## Model, Bible and dictionary updates

- Embeddings: deliberately update the pinned recipe/integrity metadata and
  `scripts/search-vectors.ts`, then rebuild both modes. The recipe is part of each
  cached row's key. Rerun actual-model retrieval, browser parity, size and
  performance checks locally before accepting a model change.
- BSB: follow `docs/bible.md`, verify the source/license/hash and verse-count rebuild,
  rerun normalization/enrichment/output checks, then review. ESV stays outbound
  reference-only; never fetch/cache ESV verse text.
- Caption dictionary/gate: deliberately update `scripts/caption-config.json` and its
  provenance/license, inspect changed threshold behavior, verify external cached
  bytes and rerun gate tests. Introduce a new `gate_version` and retain validation
  of historical versions when changing the recipe; do not invalidate history by
  replacing its accepted policy in place. Do not silently relabel old caption receipts with a
  new dictionary or claim the gate proves transcription accuracy.

Keep model/dictionary caches separate from temporary recording work. Authorization
permits a scoped operation; cleanup controls retention. Neither substitutes for the
other. Existing user-owned evidence bundles are not blanket cleanup targets.
