# Prompt 3: Generalization And Editorial Workflow

Read `docs/implementation-prompts/README.md` first and follow its shared contracts. Continue from the passing Milestone 2 checkpoint on the same feature branch and draft PR, reading `docs/run-log.md` first. Extend existing formats rather than creating parallel ingestion paths.

Use the curator skill to add:

```text
13 September 2026 baseline:
GkmB_KeBlBw, approximately 1h 50m

5 July 2026 competing recordings:
D-FyolbxJgk, approximately 1h 51m
OrsN83j3qxE, approximately 1h 58m

12 July 2026 incomplete recording:
MZr169xBwrU, 3m 9s

19 July 2020, Tripping:
Z-vRVB-WucA, approximately 1h 6m
Known: Luke 17:1-9; Matthew 18:5-7; Rev. Yong Teck Meng
```

Run the media preflight and process these recordings through the authorized local pipeline. Do not assume the 5 July uploads are duplicates. Compare sampled audio windows, frames, and spoken language first to determine whether they are duplicates, restarts, language variants, or distinct services, and transcribe in full only the uploads that will carry passages. If their relationship stays unresolved, keep both at `media_disposition: unassessed` so neither enters search, leave the service `needs_review`, and record the evidence for the human reviewer. `MZr169xBwrU` was only smoke-tested before, so interpret it fully now. Do not reject the 12 July upload only because it is short. If real access fails, stop the run and report the blocker; fixture evidence cannot complete this milestone.

## Harden The Curator Skill

Update the skill based on actual use. It must reliably handle baseline services, competing same-date uploads, apparent duplicates, interrupted streams, short recordings, well-described historical sermons, corrections to reviewed services, metadata isolation between services, and explicit uncertainty.

Keep it concise and agent-oriented. Do not turn it into application logic or add an LLM provider integration.

## Correction Workflow

Every passage and service page must offer `Suggest a correction`. Generate a prefilled GitHub issue URL containing stable service, video, passage, timestamp, section, and page identifiers plus choices for transcript, timestamp, scripture, speaker, section, or other problems. Never include private local state.

Offer `Edit this transcript` when a stable GitHub source file exists. Prefer a durable file URL over an inaccurate line anchor.

Add a correction issue form and a pull-request template with separate Code review and Editorial review sections. The template must explain how a human reviews content in `pnpm build:preview` and approves it with `pnpm editorial:approve`.

Validate every pull request for timestamp bounds, known videos, unique IDs, parseable scripture, required metadata, multipart ordering, failed/rejected-stream exclusion, absent media and ESV text, reproducible indexes, `editorial-guard`, type safety, tests, and production build.

## Search Quality Evaluation

Create a human-readable evaluation set with acceptable passage/service IDs and rank thresholds. Include:

- All core exact and semantic searches.
- A query about causing others to stumble that reaches `Tripping`.
- The known `Tripping` scripture references.
- Same-date metadata cases.
- Rejected and unresolved candidates excluded from ordinary results.
- A no-results query with an honest empty state.

Report pass/fail, rank, and top result. Do not add brittle query-specific aliases; taxonomy aliases must be generally valid and reviewed.

## Complete Product States

Implement meaningful default, hover, pressed, focus-visible, selected, loading, empty, error, unavailable-video, uncertain-metadata, and `needs_review` states. Test long titles, long names, multiple references, and missing optional speakers.

Keep all states responsive and consistent with Penpot. Do not add generic dashboard styling, gradients, glass effects, or unrelated colors.

## Required Tests And Review

Test truthful non-published statuses for all five videos, non-destructive candidate classification, short-recording preservation, forbidden curator promotion to `reviewed`, production exclusion of all unresolved records, correction/edit URLs, repository templates, ranking thresholds, invalid fixture failures, keyboard-only journeys, automated accessibility checks, manual keyboard and assistive-technology-oriented inspection, difficult content lengths, and responsive layouts.

Compare the implementation with the live Penpot frames or the checked-in exports and manifest. When live access exists, refresh changed exports. Fix high-impact hierarchy, typography, palette, spacing, sizing, and responsive differences. Document the reference source used and intentional accessibility or real-content deviations.

## Completion Gate

Do not complete the checkpoint until the real baseline works without special-case code in the local preview build, ambiguous recordings remain honest, corrections are usable, CI validates the draft PR deterministically, and all required ranking thresholds pass against the local preview build while the local production build excludes unapproved content. Follow the shared completion protocol, create and push the Milestone 3 checkpoint, update the same draft PR, then load Prompt 4 and continue.
