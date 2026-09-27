# Prompt 5: Weekly Operation And Production Readiness

Read `docs/implementation-prompts/README.md` first and follow its shared contracts. Continue from the Milestone 4 checkpoint on the same feature branch and draft PR, reading `docs/run-log.md` first and carrying forward any explicitly documented pending live-backfill item.

**Operator decisions (2026-09-26) that amend this milestone. Read all three before starting:**

- [`decisions/2026-09-26-chapter-search.md`](./decisions/2026-09-26-chapter-search.md): the site, search and review use chapters only; new services get chapters, not passages or committed transcripts. Where this prompt says "passage", read "chapter".
- [`decisions/2026-09-26-caption-transcripts.md`](./decisions/2026-09-26-caption-transcripts.md): the weekly curator run tries the new service's YouTube `en-orig` captions first (with the quality gate) and falls back to local whisper.cpp; recommend running it the day after the service. CI stays deterministic.
- [`decisions/2026-09-26-sermon-outline.md`](./decisions/2026-09-26-sermon-outline.md): build a concise outline of the whole service with neutral peer groups such as Opening, Worship and Scripture, and Closing Remarks and Offertory; outline the sermon's major movements without excessive splits. Use Title Case for chapter and subsection titles. Show one holistic sermon description beneath the video; keep chapter/subsection descriptions internal for search and review, never visible.

Create a sustainable weekly operation and verify the complete MVP. Interpretation remains human-triggered: deterministic automation may discover an upload, but it must not invoke an AI coding agent or analyze media unattended.

## Deterministic Discovery

Add a scheduled GitHub workflow that reads the channel's public feed from the shared Source Channel section. The feed needs no credentials or quota. Document its limits, including that it lists only recent uploads, and a manual `workflow_dispatch` trigger. Do not add a YouTube Data API key unless a documented limitation requires it.

Discovery may identify public metadata, deduplicate IDs, propose a `workflow_status: discovered` manifest entry or identifier-only `workflow_status: registered` record, open/update a curator issue, and report failures without affecting the site.

Discovery must not download media, call an LLM or agent API, create transcripts or summaries, mark content reviewed, or publish archive interpretation.

Make it idempotent. Prefer a deduplicated issue over workflow commits when that avoids unnecessary write complexity.

## Weekly Curator Procedure

Add an operator runbook and optional project command. A person supplies a discovery issue or YouTube ID, and the coding agent must:

1. Load the curator skill and confirm authorization.
2. Inspect the discovery record and related uploads from the date.
3. Branch from the latest default branch.
4. Register physical videos before interpreting the logical service.
5. Produce `needs_review` YAML/Markdown using existing schemas and taxonomy; never self-promote it to `reviewed`.
   Outline the whole service, using neutral peer groups for routine worship and announcements. Within the sermon, identify its central direction and mark only major supporting movements as primary chapters; use optional subordinate search cues for finer retrieval. Use Title Case for every chapter and subsection title. Review the one visible sermon description as natural prose without "Thesis"/"Points" labels or a fixed template, and ensure no internal chapter/subsection descriptions appear on the site before creating the draft PR.
6. Record uncertainty rather than forcing completion.
7. Regenerate indexes and reports.
8. Run validation, search, browser, and build checks.
9. Verify that no media or secrets are present.
10. Commit with the `Curated-by: agent` trailer, push, and open a draft PR linked to the discovery issue.
11. Stop that weekly curation run for human review.

The human then reviews the service in `pnpm build:preview` and either adds an approval commit with `pnpm editorial:approve` before merging, or merges it as `needs_review` and approves later. Merging to the default branch must rebuild and deploy the site. Close the discovery issue only after publication or explicit rejection.

## Deployment And Operations

Finalize GitHub Pages deployment with least-privilege permissions, caching, concurrency control, and no deployment after failed checks. Deploy only `pnpm build` output, never `pnpm build:preview`. Verify direct routes and assets under a non-root base path in the local production build.

Document repository settings, branch protection, the `editorial-guard` check and its limits, manual discovery, curator invocation, the editorial approval procedure, editorial versus code review, corrections, roll-forward recovery, embedding-model/Bible updates, and unavailable-video handling.

State clearly that temporary deletion and media authorization are separate requirements.

## Product Hardening

Ensure exact search works while the semantic model loads; match reasons stay truthful; passage URLs survive reload; player errors do not trap users; local history/progress can be cleared; the site does not imply it hosts videos; metadata excludes drafts; only reviewed content enters public search; non-published statuses remain maintainer-only unless deliberately catalogued; accessibility remains intact; and production output contains no media, secrets, private notes, or unpublished transcripts.

## Definition Of Done

Record evidence for the following final conditions. During the continuous agent run, real-content checks use the local preview build and remain pending editorial approval, and production checks use the local production build. Conditions that need a human review, merge, or live deployment (4, 5, 12, 15, and the production half of 16) are recorded as `pending human action` with the exact steps to verify them. The agent must not approve records or deploy merely to satisfy this list.

1. All eight core physical videos are represented correctly.
2. The 16 August uploads form one logical service.
3. The failed seven-second 28 June stream is absent from ordinary results.
4. The 6 September programme start is within 30 seconds of the true start, as confirmed by the human reviewer.
5. Major sections are reasonably identified and reviewed.
6. Results point to passages.
7. `Romans 13` works.
8. The government question returns `Authority` in the top three.
9. `Abraham and Isaac` and `living sacrifice` reach the relevant sermon.
10. Results start the correct video at the correct time.
11. Users can continue beyond the soft endpoint.
12. Reviewed YAML/Markdown corrections rebuild and deploy after merge.
13. No media remains in Git, Actions artifacts, Pages output, or permanent storage.
14. Edge-case ambiguity remains honest and absent from ordinary search where unresolved.
15. A weekly upload can move from discovery issue to agent-authored PR to published content without any application or workflow calling AI.
16. The 13 September baseline `GkmB_KeBlBw` remains represented and searchable in preview before approval and production after approval.
17. Both 5 July recordings, `D-FyolbxJgk` and `OrsN83j3qxE`, remain represented with their evidence-based relationship or explicit unresolved status.
18. The 12 July short recording `MZr169xBwrU` remains catalogued and is not rejected solely because of duration.
19. `Tripping` (`Z-vRVB-WucA`) retains Luke 17:1-9, Matthew 18:5-7, and Rev. Yong Teck Meng metadata.
20. A query about causing others to stumble reaches the relevant `Tripping` passage within its evaluation threshold.
21. Metadata from same-date or adjacent services never leaks between logical services unless supported by source evidence.
22. Duplicate/restart/language-variant candidates remain non-destructively represented until a human approves their classification.

For editorial or live-embed checks, record reviewer, date, environment, and observed result rather than claiming complete automation.

## Final Checks

Run the complete unit, integration, search-quality, browser, accessibility, validation, build, and deployment-path suites. Manually verify desktop and both mobile orientations, first-time model load, returning-user state, multipart playback, all soft-stop actions, corrections, unavailable/offline behavior, and deployed direct URLs.

Compare the final site with live Penpot or the checked-in exports and manifest. Preserve its typography, palette, hierarchy, and recognizable layouts while retaining justified accessibility and real-content differences. Record which visual source was used.

## Completion Gate

Do not finish the continuous run until definition-of-done evidence exists for implementation and the local preview build, interpretation remains person-invoked, deterministic automation passes, the local production build contains no unreviewed content, the deployment workflow is validated without deploying, and another maintainer can curate and approve the next service from the documentation. Follow the shared completion protocol, create and push the Milestone 5 checkpoint, update the draft PR with final evidence and unresolved editorial items, and mark it ready for human code review. Do not merge the PR, deploy, or promote any record to `reviewed`.
