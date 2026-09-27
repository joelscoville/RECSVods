# Chapter vector processing

Ordinary builds copy committed `chapter-vectors.bin` rows after publication
filtering. They do not transcribe, embed, or read private evidence. Passage-era
`buildVectors`, `verifyVectors`, `RECS_FULL_INDEX`, and `embeddings.ts index`
commands have been retired.

Generate only for an explicitly selected service after curation:

```sh
scripts/devenv-run pnpm chapters:vectors generate --service <id> --transcripts-dir <private-evidence-directory>
scripts/devenv-run pnpm index:verify
```

The processor preflights evidence before writing. Missing evidence fails rather
than replacing existing rows with zeros. Replacing a text-bearing row with an
empty row requires a deliberate `--allow-empty <chapter-id,...>` override; review
the evidence and resulting diff before using it. Metadata-only changes can reuse
rows when evidence, recipe, identity, and bounds still match.

Public `chapters.json` schema 3 names `vectors.<sha256>.bin` and records its
SHA-256. Browsers fetch that exact asset and verify its bytes and row count before
semantic matching. Stale or corrupt vectors leave exact search available. Raw
and `.gz` files share the same decoded-byte identity. Builds remove stale output
first; run production and preview builds sequentially.

For the current processing/review procedure, see [weekly operation](weekly-operation.md).
