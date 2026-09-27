# Operator-approved Colab evidence import

This is a manual, offline batch-import path. Local `whisper.cpp` remains the primary
transcription engine. The operator's 2026-09-25 decision to use the supplied Colab
batch supersedes local CPU/VM retries for those recordings. These commands do not
acquire media, run inference, execute Colab, or translate text.

Raw transcripts, source audio, evidence, and full import receipts remain in local
external directories. **Do not commit them. Do not copy verbatim ESV readings into
repository source.** Editorial interpretation remains `needs_review`; importing
machine evidence does not approve or publish content. Silence/music gaps and repeated
lyrics must be assessed against source samples; import never creates gap segments,
removes repetitions, or claims speech completeness.

## CLI

Run commands sequentially through `scripts/devenv-run`. The timeout is controlled
by `RECS_DEVENV_TIMEOUT_SECONDS`, not a `--timeout` wrapper argument. The examples
use operator-supplied environment variables, not embedded private paths.

```sh
scripts/devenv-run python3 scripts/import_transcript.py verify-bundle \
  --bundle-dir "$BUNDLE_DIR"

scripts/devenv-run python3 scripts/import_transcript.py import \
  --transcript "$BUNDLE_DIR/$VIDEO_ID.json" \
  --checksums "$BUNDLE_DIR/SHA256SUMS" \
  --work-dir "$ACQUIRED_CASE_WORKDIR" \
  --authorization-file "$AUTHORIZATION_FILE" \
  --audio-root "$AUDIO_DIR_A" \
  --audio-root "$AUDIO_DIR_B"

# Only after a verified import and operator readiness for deletion:
scripts/devenv-run python3 scripts/import_transcript.py cleanup-audio \
  --work-dir "$ACQUIRED_CASE_WORKDIR" \
  --audio-root "$AUDIO_DIR_A" \
  --audio-root "$AUDIO_DIR_B"
```

`--audio-root` is repeatable on import and cleanup. Pass every expected source-audio
directory explicitly. Each directory must already exist, be owned by the current
operator, and be a dedicated external directory: repository paths/ancestors,
filesystem root, home, shared temporary root, and symlinked root components are
refused. Exact duplicate roots are counted once. Only `<11-character-video-id>.webm`
is considered within a root; there is no recursive search or deletion.

`verify-bundle` is read-only. It checks strict `SHA256SUMS` syntax, duplicate entries,
the exact JSON inventory, every byte checksum, engine/settings, metadata and timing.
Its JSON output contains safe IDs, hashes, counts, durations, and validation failures,
never transcript text or private paths. It returns 2 if any transcript is invalid,
0 otherwise. Checksum validity and full transcript validity are separate counts.
It does **not** establish channel identity, source duration, or audio integrity;
those checks require import into an acquired case workspace.

Import requires an existing `media.py` ownership sentinel, acquisition manifest and
`source.mkv`, plus an explicit `--authorization-file` accepted by `media.authorize`.
It does not create a workspace or fall back to environment-only authorization. The
manifest's channel must be `UCLjwcZaIkiFEed1VgQYSsrw`, and its video ID must match the
JSON filename, JSON `video_id`, and exact JSON `audio_file`. Workspace symlinks are
refused by `media.manifest_for`. The acquisition manifest is read, not overwritten.

Every present audio copy in the supplied roots must match the declared SHA-256.
One absent copy is allowed if another verifies. By default **at least one copy must
verify**. The exceptional `--allow-missing-audio` flag allows all copies to be absent,
but records `audio_hash_verified: false` in both receipt and archive projection and
prohibits cleanup. During this run the operator's bundle README was updated to
record that batch audio had already been removed. For those absent originals,
use this explicit option and retain the supplied audio hash as provenance rather
than claiming byte verification. JSON integrity and independently acquired source
identity/duration still must pass. A present but incorrect copy can never be
bypassed with this flag. Future batch audio should remain until import succeeds.

## Validation and timestamp policy

The only approved raw engine object is exactly:

```json
{
  "name": "faster-whisper",
  "version": "1.2.1",
  "ctranslate2": "4.8.2",
  "model": "large-v3-turbo",
  "compute_type": "float16",
  "device": "Tesla T4",
  "options": {
    "beam_size": 5,
    "word_timestamps": true,
    "vad_filter": false,
    "condition_on_previous_text": false
  }
}
```

Extra settings or substituted JSON types are rejected. Original language codes are
preserved: `en` is expected for this batch, but a valid non-English code is recorded
as-is with `non_english: true`, never silently translated or relabeled.

- Duration, elapsed seconds and RTF must be numeric, finite and positive. RTF must
  match elapsed/duration within `0.0000051`, allowing the bundle's five-decimal
  rounding. `transcribed_at` must be a real ISO datetime with timezone.
- Segment IDs must be unique nonnegative integers. Authentic ASR may backtrack:
  decreasing segment starts are preserved in incoming array order with explicit
  source-alignment warnings, not rejected or silently sorted. Original IDs and
  timestamps are retained. Word starts within each segment retain their existing
  nondecreasing validation. Timestamps must be finite, numeric,
  nonnegative and nonreversed, with nonempty segment/word text.
  Faster-whisper word alignments may extend outside their containing segment;
  internal containment is **not** part of the source contract. These alignments and
  segment/word overlaps are preserved and reported as warnings, without
  widening segments or clamping words to internal boundaries. These are local ASR
  evidence intervals, not editorial sentence cuts.
  Word probabilities, when present, must be in `[0, 1]`. Zero-duration timestamps
  are retained and counted, not invented into longer intervals. Optional raw segment
  metrics are validated and preserved.
- Full-recording acquisition is required: acquired start must be zero, and acquired
  end must match both the recording metadata and actual acquired duration within
  **2 seconds maximum**. Import compares the transcript duration against
  `manifest.duration_seconds`, the actual ffprobe value recorded during acquisition,
  rather than the often integer-floor `recording_duration_seconds`.
- The receipt explicitly records the actual source duration, signed
  `transcript_duration - source_duration`, metadata duration, signed
  `source_duration - metadata_duration`, comparison basis, and 2-second tolerance.
  This duration tolerance does **not** authorize shifting or broadly clamping segments.
- Every timestamp is bounded by both transcript duration and actual source duration.
  A tail endpoint overshoot of at most **0.1 seconds** may be clamped to the smaller
  bound. Each changed start/end field is counted in `tail_clamped_timestamp_count`.
  Larger recording-bound overshoots, reversed intervals and misordered word starts are
  rejected. The floating-point comparison epsilon is
  `1e-9` seconds. No other timestamps are rounded or shifted in JSON.

### Alignment warning receipt

`verify-bundle`, import results (including repeat imports), and local
`import_verification` record the following safe fields:

- `alignment_warnings`: one entry per warning kind and segment ID, with `kind`,
  `segment_id`, `count`, and `max_offset_seconds`. Kinds are `word_outside_segment`,
  `segment_overlap`, `word_overlap`, and `nonmonotonic_segment_start`.
  A nonmonotonic-start warning also records `previous_segment_id`,
  `current_segment_id`, `backward_seconds`, and
  `requires_curator_review_before_publishing: true`.
- `alignment_warning_count`: total occurrences across kinds; a word outside both
  segment boundaries counts once for that kind, using its larger boundary offset.
- `alignment_warning_segment_count`: distinct affected segment IDs.
- `alignment_max_offset_seconds`: largest boundary offset/overlap/backward jump across all kinds.
- `nonmonotonic_segment_start_count` and `max_backward_jump_seconds`: the number of
  backward starts and largest backward jump (both zero when there are none), in
  verifier/import output and evidence/receipt `import_verification`.

Warnings are computed from source timestamps before tail normalization. Only
diagnostic offset differences are rounded to nine decimal places. Segment overlaps
are measured against the preceding maximum segment end; word overlaps are measured
against the preceding maximum word end within the same segment. Both retain source
order and timestamps. No word text is included in warnings. These ASR alignment
uncertainties remain **`needs_review`** and should inform human source checks, not
automatic editorial cuts. A backtracked region must be reviewed against source by
the curator before publishing its interpretation. This is an evidence importer,
not a curated-passage validator: accepting backend backtracking does not approve
publication or relax numeric bounds, duplicate-ID, checksum, model, or metadata checks.

The verifier scans every segment and word after validating transcript metadata,
records `timing_scan_complete`, `segment_count`, and `word_count`, and collects
segment/word validation blockers throughout a file instead of stopping at its first
timing failure. Invalid metadata/checksums still reject the file. Warning fields
are local receipt diagnostics; the safe archive-provenance projection is unchanged.

## Outputs, receipts and repeat imports

Import writes three private (`0600`) files exclusively within the owned workspace:

| File | Purpose |
| --- | --- |
| `evidence.json` | Canonical media evidence: `schema_version`, `youtube_id`, original `language`, absolute recording-second `timestamp_basis`, full `transcribed_span`, elapsed/RTF, `segments` in incoming source order, optional words/probabilities, machine-evidence status and `editorial_status: needs_review`. |
| `evidence.txt` | One timestamped line per original segment in source order, using existing media timestamp formatting. An explicit ASR review note precedes each backtracked segment, identifying previous/current IDs and backward seconds without private paths. |
| `import-receipt.json` | Workspace-token binding, exact audio filename, input hashes, exact raw engine JSON, elapsed/RTF/date, import verification, evidence-file hashes, private audio-root identities and verification states, and safe `archive_provenance`. |

The evidence JSON also contains `provenance` and `import_verification`. It preserves
the original transcript duration in provenance; its full span ends at the smaller
of transcript and actual source duration. This bounds the span without extending
speech segments or manufacturing silence. The exact raw engine JSON is preserved
under `provenance.engine`; the raw input files are never mutated or copied into
the repository.

The receipt is written last, after exclusive evidence creation. Partial failed
writes are removed only if created by this invocation. Existing local whisper
evidence, unreceipted evidence and changed imported evidence are refused. There is
no overwrite/force switch. A repeat import with the same transcript hash, unchanged
evidence, same roots/verification state and same source metadata rechecks checksums,
authorization, manifest, timing and every present audio hash, then returns
`idempotent: true` without rewriting output. A different transcript hash is refused.
Repeating import after audio deletion does not pretend that audio was reverified;
the changed verification state is refused. Repeating cleanup is supported.

## Receipt-based audio cleanup

Cleanup requires the original owned workspace, a verified receipt bound to its
sentinel token, matching evidence hashes, unchanged source duration metadata and
`audio_hash_verified: true`. Roots must match the path/device/inode/UID identities
recorded at import. This local receipt is an integrity record, not a signature
against an operator deliberately rewriting both evidence and receipt.

Cleanup preflights **all** supplied roots and hashes all present matching files
before unlinking any. A failed hash in either root leaves both copies intact.
It rechecks hashes and identities before deletion using directory-relative file
descriptors and no-follow opens. Symlinks, hardlinks, nonregular files and files
owned by another user are refused. It only unlinks the exact recorded WebM filename;
other files, nested directories, raw transcripts, acquired source media and evidence
are untouched. It does not recursively remove directories. Keep these commands
sequential; deletion across multiple directories is not a filesystem transaction
against concurrent external writers.

Success reports only `deleted_audio_files`, `already_absent_audio_files`, and
`checked_audio_roots`. It never prints private paths. Supplying both roots removes
both verified copies; supplying a root not recorded by the import is refused.

## Safe archive provenance contract

Copy **only** `receipt.archive_provenance` into the optional
`videos[].transcription_provenance` field when preparing archive interpretation.
Do not copy the whole local receipt. `TranscriptionProvenanceSchema` in
`site/lib/archive.ts` accepts this projection directly and rejects extra keys:

| Fields | Schema |
| --- | --- |
| `engine`, `engine_version`, `model`, `backend_version`, `compute_type`, `device` | Literal `faster-whisper`, `1.2.1`, `large-v3-turbo`, `4.8.2`, `float16`, `Tesla T4`. |
| `settings` | Strict object with literal `beam_size: 5`, `word_timestamps: true`, `vad_filter: false`, `condition_on_previous_text: false`. |
| `audio_sha256`, `transcript_sha256` | Lowercase 64-character SHA-256 strings. |
| `duration_seconds`, `elapsed_seconds`, `real_time_factor`, `source_duration_seconds` | Positive finite numbers; RTF consistency checked with the same five-decimal tolerance. |
| `transcribed_at` | ISO datetime with timezone. |
| `duration_delta_seconds` | Finite `[-2, 2]`, equal to transcript minus actual source duration within `1e-9`. |
| `audio_hash_verified` | Boolean; absence of audio is never represented as true. |

A provenance-bearing video must also carry its original `transcription_language`
and valid `transcribed_span`; never-interpreted videos cannot have provenance.
Existing local-whisper records need no new field, and their content is unchanged.
Only the initially approved faster-whisper branch is supported here. Source video
duration may remain an integer recording-metadata value: provenance records the
actual ffprobe duration separately rather than silently rewriting archive duration.
Normal video span bounds still apply.

The frontend's existing explicit allowlists (`flattenArchive` and `displayServices`)
exclude provenance. Tests verify that neither hashes nor engine metadata serialize
to those client-facing objects.

## Read-only checks of the supplied 2026-09-25 bundle

The complete scan covers **8,473 segments and 89,109 words across all eight files**.
All eight byte checksums and metadata checks pass (approved exact engine/settings,
original `en`, positive finite durations/elapsed/RTF with consistent rounding, and
valid dates). All eight files pass full transcript validation. Per-file source alignment
warning totals are:

| Video | Segments | Words | Outside-segment words / affected segments | Maximum word-boundary offset | Segment overlaps / maximum overlap |
| --- | ---: | ---: | ---: | ---: | ---: |
| `94fynFHtreg` | 758 | 6,152 | 14 / 14 | 0.36 s | 0 / 0 s |
| `D-FyolbxJgk` | 1,605 | 14,481 | 11 / 11 | 0.42 s | 0 / 0 s |
| `GkmB_KeBlBw` | 1,518 | 15,277 | 18 / 18 | 0.30 s | 2 / 1.74 s |
| `MZr169xBwrU` | 7 | 57 | 0 / 0 | 0 s | 0 / 0 s |
| `OrsN83j3qxE` | 1,702 | 16,729 | 9 / 9 | 0.40 s | 0 / 0 s |
| `W2IZ6MUX-Yk` | 696 | 11,344 | 10 / 10 | 0.19 s | 0 / 0 s |
| `Z-vRVB-WucA` | 753 | 11,457 | 18 / 18 | 0.28 s | 0 / 0 s |
| `k27dmsPvmG8` | 1,434 | 13,612 | 15 / 15 | 0.26 s | 0 / 0 s |

There are **95 word-boundary warnings, two segment-overlap warnings and one
nonmonotonic-start warning** (98 total).
`GkmB_KeBlBw` has 21 total warnings on 20 segment IDs, maximum overall offset 2.82 s;
all other total warning counts/maxima equal their word-boundary values in the table.
The two segment-overlap warnings concern IDs 975 and 976, with overlaps of 1.36 s
and 1.74 s against preceding maximum segment end. No within-segment word overlaps
were found. All 143 zero-duration words are retained. No tail clamps were needed
against the declared transcript durations.

**Explicit source-ASR backtracking diagnostic in `GkmB_KeBlBw`:** ID 974 starts at
4543.58 s, then ID 975 starts at 4540.76 s (2.82 s backward); ID 976 starts at
4542.12 s. The warning records previous ID 974, current ID 975, and 2.82 backward
seconds. `nonmonotonic_segment_start_count` is 1 and `max_backward_jump_seconds` is
2.82 for this recording, zero for the other seven. Empty word arrays on IDs 975/976
are valid. The complete scan found no invalid bounds, reversed timestamps,
within-segment word-order, ID, text, or probability/metric blockers.
`verify-bundle` returns 0 with all eight valid transcripts. The importer retains
the original 974, 975, 976 array sequence and original times, explicitly warning
that this region requires curator review before publication. Backend-origin
backtracking, overlap and word-boundary uncertainties are not evidence corruption
or automatic editorial cuts.

Regression tests reproduce the 0.30 s word-start discrepancy from segment 32 and
the separate backward-start sequence using source timing values and invented text.
Both are preserved in imported evidence with explicit warnings, without sorting or
modifying raw inputs. The backward-start regression verifies IDs/times/source order,
maximum jump in output and receipt, and path-free review notes in `evidence.txt`.
This corrects the earlier unsupported internal-containment and sorted-segment-start
assumptions. Numeric and integrity rejection rules remain in place; warnings are
visible review obligations, not silently downgraded failures.

No real case import or audio cleanup was performed during implementation. Source
duration and audio-hash verification await the prepared acquired case workspaces.

## Tests

```sh
scripts/devenv-run python3 -m unittest discover -s tests -p test_import_transcript.py
scripts/devenv-run pnpm exec vitest run tests/archive.test.ts
```

Python tests use only the standard library, synthetic fixture bytes and invented
text; native media commands are forbidden by a test stub. Tests cover integrity,
filename/ID binding, authorization, paths/symlinks/hardlinks, exact engine settings,
timing/duration validation, honest missing audio, repeat imports, no-clobber writes,
and two-root failed-hash cleanup. Archive tests execute the Python safe-projection
function with synthetic metadata and pass the result directly to Zod, and verify
frontend serialization excludes provenance.
