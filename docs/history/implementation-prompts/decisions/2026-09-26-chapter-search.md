# Operator Decision: Chapter-Level Search, No Published Transcripts

Decided by the operator on 2026-09-26. This decision amends the shared contract in
[`../README.md`](../README.md) and the milestone prompts wherever they conflict. Everything
not mentioned here is unchanged: human review, `needs_review` only for agent output, the
record model, publication rule, static browser-only search, ESV/BSB rules, authorization,
cleanup, and separate code/content commits.

## Why

Passage-level curation does not scale and costs more than it returns:

- Each service carries about 75 passages with agent-rewritten transcripts (~100 KB of YAML).
- The preview search index is already 3 MB of passages plus 15 MB of JSON vectors for 22
  services. At the full archive (~700 services) that becomes hundreds of megabytes that every
  visitor's browser would download.
- Rewriting transcripts is the largest share of agent effort per service and of human review
  effort, yet visitors mostly want to find and jump to the right part of a service.
- Republishing verbatim transcripts adds copyright exposure (quoted books, song lyrics) and
  offers little over YouTube's own captions.

## New model

1. **The chapter is the unit of search, display and review.** A chapter is a meaningful,
   timestamped span of one physical video: a worship set, a reading, each main movement of the
   sermon, Communion, a prayer, announcements. Target roughly 8–15 chapters per full service.
   The existing `sections` are chapters; rename them in schemas and UI where helpful, but keep
   their IDs stable.
2. **Chapter fields:** `id`, `video_id`, `start`, `end`, `type`, `title`, `speaker_id`
   (when known), `scripture` (normalized references), `topics`, `summary` (one or two
   sentences describing what is said, keeping uncertainty), `keywords` (up to about ten
   distinctive words or short phrases actually spoken), optional `review_notes`. Drop
   per-unit `questions` and `confidence` from the published model; uncertainty goes in
   `review_notes`.
3. **Chapters only on the site.** Search, results, the watch page and the service page use
   chapters exclusively. No new passages are created. Passages that already exist are kept
   as internal material (see "What to do with existing work") but are not displayed, not
   linked, and not part of the search index or build output.
4. **New transcripts are private working material.** For services processed from now on, raw
   ASR output stays outside the repository as local evidence (for example
   `~/RECS-colab/transcripts/`). Do not commit, publish, index verbatim, or display their
   transcripts. Existing passage transcripts stay as they are (see below).
5. **Chapter vectors are computed once, when the service is processed.** Using the same
   pinned, self-hosted embedding model the site already uses, embed the chapter's transcript
   in overlapping windows that fit the model's input limit, average and L2-normalize the
   window vectors, quantize to int8, and commit the result with the service (a small binary or
   base64 field alongside `service.yaml`; record the model ID, dimension and windowing). The
   build reads committed vectors; it must not need transcripts. This step is deterministic and
   does not call an LLM.
6. **Search** (unchanged principle, smaller data): exact/keyword matching over chapter title,
   summary, keywords, topics, speaker, series, date and scripture; scripture parsing and hidden
   BSB verse-text matching; and semantic matching of the query vector against chapter vectors.
   Keyword and scripture results must appear immediately; semantic results may merge in once
   the model has loaded. Match reasons stay truthful ("Scripture: John 16:33", "Keyword",
   "Similar in meaning"). Ship vectors as a compact binary file, not JSON numbers. Target: the
   complete archive's search download (excluding the one-time model) stays within a few MB.
7. **Playback:** selecting a chapter opens YouTube at its start and soft-pauses at its end, with
   replay and continue, exactly as passages did. The service page lists its chapters.
8. **Corrections:** one "Suggest a correction" link per service and per chapter, with choices
   for chapter time, title, scripture, speaker, topic, or other. No passage or transcript
   correction links.
9. **Review:** a reviewer approves a service by checking its chapters in `pnpm build:preview`.

## Reduced agent work per service

For historical and weekly services the curator should:

- Verify source, duration and the programme/sermon boundaries (coarse samples and frames at
  suspected boundaries only; no exhaustive frame review).
- Read the transcript and mark chapter boundaries.
- Write chapter title, type, speaker, scripture, topics, a short summary and keywords.
- Compute and commit chapter vectors.
- Not rewrite, clean, or reproduce transcript text anywhere in the repository.

Keep the parallel historical-batch exception; each worker now writes chapters only.

## What to do with existing work

Apply this after committing the current Milestone 4 content checkpoint, before continuing
Milestone 4 tooling acceptance or starting Milestone 5.

1. **Keep everything** in all existing services: metadata, `sections` (as chapters),
   boundaries, review notes, provenance, media dispositions, workflow statuses, **and their
   passages with transcripts**. The passages become internal material: used to derive and
   check chapters and for later analysis, never shipped to the site. Do not delete, trim or
   rewrite them. Move them out of the published service record (for example into a sibling
   `passages.internal.yaml` per service, or a clearly internal key) so the build cannot
   publish them by accident, and have the output check fail if passage or transcript text
   appears in build output.
2. **Add chapter fields on top, derived from existing passages** with a script, not by
   re-reading audio:
   - `scripture`, `topics`: union of the chapter's passages, normalized and de-duplicated.
   - `keywords`: from passage titles/topics, then a short agent pass to keep only distinctive
     spoken words (at most about ten).
   - `summary`: one short agent-written sentence or two per chapter, based on the chapter's
     existing passage summaries (not on new listening).
3. **Compute chapter vectors** from the existing passage transcripts inside each chapter
   (they are the best text available for recordings whose raw ASR was already cleaned up).
   Where the raw Colab transcript exists for the video, prefer it.
4. Remove passage search, passage URLs, the transcript panel, "Edit this transcript" links
   and passage correction links from the site. Old passage URLs, if any were shared, should
   resolve to the containing chapter.
5. Every migrated service stays `editorial_status: needs_review` (none are reviewed yet). Note
   the migration in each service's review notes and in `docs/run-log.md`.
6. Update schemas, the curator skill and its adapters, build/index scripts, search, UI, tests,
   the search evaluation set (acceptable chapter IDs instead of passage IDs; keep it small),
   documentation, and the milestone acceptance criteria to the chapter model.
7. Commit as two checkpoints: the code/schema change, then the migrated content
   (`Curated-by: agent`), following the usual signing and review flow.

## Acceptance

- Every service has chapters; the site, build output and search index contain chapters only,
  with no passage or transcript text (verified by the output check).
- Existing passages and transcripts are preserved unchanged as internal material outside the
  published record. Services processed after this decision have no committed transcripts.
- Production and preview builds pass; production still excludes all unreviewed services.
- Search download for the current corpus is reported, with an extrapolation to ~700 services
  that stays within a few MB (excluding the model).
- Keyword and scripture results appear before the model loads; semantic results merge after.
- The updated evaluation set passes at chapter level, including the earlier named queries
  where they remain meaningful.
- Record the before/after sizes and per-service agent output size in `docs/run-log.md`.
