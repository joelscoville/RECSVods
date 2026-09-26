# Incremental and full vector indexes

The archive projection still runs before embedding generation. It owns the shared
publication rule: production includes only reviewed services' playable videos;
preview additionally includes needs-review services' playable videos. The vector
generator consumes that already-filtered `site/public/generated/passages.json`.
It never selects publication eligibility from a cache.

## Build behavior and compatibility

`scripts/build.ts` still deletes **all** `site/public/generated` artifacts before
each production, preview, or development build. It then regenerates passages and
vectors before starting Astro. The default vector step is now incremental. Set
`RECS_FULL_INDEX=1` for a fresh full vector pass in the normal build orchestrator.
This flag changes vector generation, not publication eligibility.

Existing calls remain valid:

```ts
await prepare(root);             // Pinned model/runtime asset preparation.
await embedTexts(texts, root);   // Local-only real model inference.
await buildVectors(root);        // Now incremental by default.
await buildVectors(root, { full: true });
const report = await verifyVectors(root);
```

The original `prepare` and `index` CLI commands are preserved. New commands:

```sh
# Consume the CURRENT, already-filtered generated passages; no Astro build.
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec tsx scripts/embeddings.ts index
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec tsx scripts/embeddings.ts index --full
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec tsx scripts/embeddings.ts verify
```

`index` also honors `RECS_FULL_INDEX=1`. `verify` always compares incremental and
full generation, regardless of that environment flag. The programmatic
`buildVectors(root, options)` uses its explicit `full` option; its default does not
depend on the environment. Package aliases and CI wiring can invoke these exports
or commands without modifying the generator.

Run modes sequentially: production and preview deliberately replace the same
canonical generated paths. These commands do not regenerate the passage
projection themselves. A full end-to-end check must first run
`scripts/archive.ts build-index` (production) or
`scripts/archive.ts build-index --mode preview`, then the vector command. An
unchanged artifact diff alone is not proof that a full generator ran.

## Content-addressed, nonpublic storage

The fixed cache location is:

```text
.local/index-cache/<modelHash>/<key>.json
```

`.local/` is already Git-ignored and outside the Astro public tree and deployment
output. There is no cache-path override. Private directory components must be real
directories; symlinks, including redirects into `site/public`, are rejected before
writing. Never force-add `.local`, include it in deployment artifacts, or expose
the repository root with a static server. A cache is disposable local derived
data, not an authoritative record or a service/database.

The exact identities are SHA-256 of UTF-8 strings:

- `modelHash = sha256(JSON.stringify(EMBEDDING_CONFIG))`
- `document = buildEmbeddingDocument(passage)` (shared NFKC/whitespace-normalized input)
- `documentHash = sha256(document)`
- `key = sha256(JSON.stringify([EMBEDDING_CONFIG, document]))`

Every shared config field participates, including model/revision, runtime and
Transformers versions, dtype, dimensions, pooling, normalization, preprocessing,
document version, and token limit. No ID or publication-mode shortcut can override
an input/config change. Even a change beyond the tokenizer's truncation boundary
invalidates the cache conservatively.

An entry contains **only** schema version, model hash, document hash, vector
checksum, and vector. It contains no raw document, transcript, title, passage ID,
media, credentials, or editorial/private provenance. The checksum binds the model
and document hashes to the vector using
`sha256(JSON.stringify([modelHash, documentHash, vector]))`.

Each hit requires matching model/document metadata, the exact entry shape,
correct dimension, finite components, approximately unit norm, and matching
checksum. Truncated/malformed JSON, invalid metadata, and corrupted vectors are
misses and are recomputed using the real encoder. A symlink entry is not read.
Unexpected filesystem failures fail the build closed rather than publish old
output. Checksums detect accidental corruption; they do not authenticate a cache
against someone who can deliberately rewrite both values and checksums. Full
verification independently checks the actual model result.

Distinct passage IDs with the same normalized model input may share one cached
vector. Date, speaker, service title, timestamps, ID, or other exact-only metadata
changes reuse it when model input is unchanged. Changes to title, summary,
questions, topics, canonical scripture, BSB enrichment, or transcript invalidate
it when they change normalized input. Output always uses current IDs, documents,
order, and the digest of the exact current passage-file bytes. Removed or newly
ineligible IDs are absent even if their cache entries remain locally.

Cache entries can represent unreviewed derived content, despite containing no raw
text. Treat them as private. They are retained across publication-mode switches;
remove `.local/index-cache` when discarding local derived data. Old model
namespaces are not automatically pruned. A subsequent incremental run regenerates
missing entries. No media or secret storage is introduced.

## Atomic publication and interruption

The public `VectorIndex` schema is unchanged: `schemaVersion`, shared `model`,
`passagesSha256`, and `vectors[id] = { document, vector }`. Public documents are
included only for IDs in the current filtered input, retaining existing browser
stale-input checks.

The old `vectors.json` is removed before parsing or inference. A complete new
index is staged at `.local/index-staging/vectors.<uuid>.partial`, then atomically
renamed to the canonical public filename after validation and an unchanged-input
check. No text-bearing partial is written into public. Empty input publishes a
valid empty index without model preparation, inference, or vector-cache reads.

Normal errors remove the owned private staging file. An uncatchable process kill
may leave an ignored private staging file containing derived text; it never
becomes a public artifact. The next sequential build removes interrupted staging
files and legacy `vectors.json.*.partial` files from the old public staging
implementation. A failed parse, encoder, cache write, comparison, or changed-input
check leaves no current public vector file. Cache writes use exclusive temporary
files and atomic rename; unfinished hash/vector-only cache partials are never
read as entries and can be discarded with the cache.

Builds sharing a root must not run concurrently. Input rechecking catches a
mid-generation projection change, but is not a multi-writer locking protocol.

## Full verification and real-model parity

Full mode **never reads or writes the derived-vector cache**. It encodes every
passage again, including duplicate inputs. Pinned model asset reuse is still
permitted: downloading identical weights again would not strengthen the check.
`prepare` continues to verify weights against pinned upstream metadata and stage
browser assets even on an all-hit incremental build. Native inference remains
local-only, uses CPU with one intra/inter-op thread, and points Transformers'
native cache location at writable, ignored `.local/embedding-cache` rather than a
potentially read-only dependency/store directory. Filesystem model caching remains
disabled; the pinned prepared local assets are the inference source.

`verifyVectors` holds incremental and fresh full indexes in memory, checks exact
schema/model/source-digest/ordered-ID/document equality and vector validity, and
compares every vector component with absolute tolerance **1e-6**. Its report
includes `passages`, `byteIdentical`, `maxAbsoluteDifference`, and `tolerance`.
On success it atomically publishes the full result. On mismatch it exits/fails
without publishing either result. Identical pinned CPU runs are expected to be
byte-identical; the report makes that stronger result visible without promising
bit identity across hardware or Node/browser runtimes. Programmatic callers can
request `{ tolerance: 0 }` for strict same-CPU verification.

`compareVectorIndexes(incremental, full, tolerance?)` is exported for checks of
in-memory indexes. Neither comparison helper bypasses the real full generator in
the CLI. Existing optional Node/browser parity checks and the two-argument
`embedTexts(texts, root)` interface remain available.

## Pending verification commands

Implementation was deliberately not executed while other agents were testing
shared artifacts. The following are commands for the main agent, not claimed
passing results:

```sh
RECS_DEVENV_TIMEOUT_SECONDS=300 scripts/devenv-run pnpm exec vitest run tests/incremental.test.ts tests/search.test.ts
RECS_DEVENV_TIMEOUT_SECONDS=300 scripts/devenv-run pnpm exec tsc --noEmit
RECS_DEVENV_TIMEOUT_SECONDS=300 scripts/devenv-run pnpm exec eslint scripts/embeddings.ts scripts/build.ts tests/incremental.test.ts

# After model preparation; retained opt-in real Node/browser parity checks.
RECS_DEVENV_TIMEOUT_SECONDS=300 RECS_TEST_EMBEDDINGS=1 RECS_TEST_BROWSER_EMBEDDINGS=1 scripts/devenv-run pnpm exec vitest run tests/search.test.ts

# After the main agent regenerates the desired production/preview projection,
# run sequentially; this replaces vectors.json and performs real CPU inference.
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec tsx scripts/embeddings.ts verify
```

Fixture tests inject deterministic unit vectors solely to count inference work
and exercise cache integrity, metadata changes, deletion, publication filtering,
duplicate inputs, config invalidation, interruption, and full comparison. Those
fixtures are not real-model parity evidence and never modify actual archive
content or the repository's generated vectors.
