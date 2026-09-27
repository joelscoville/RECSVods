# Bible references and search enrichment

## ESV terms check — 2026-09-25

Re-read <https://www.esv.org/api/> on **2026-09-25**. The material restrictions recorded in the shared implementation contract are unchanged: non-commercial use, no more than 500 verses or half of any book stored locally (whichever is less), and limits of 5,000 queries/day, 1,000/hour, and 60/minute. ESV text use requires identification, the ESV link, and the supplied copyright notice. The current page explicitly recommends linking when text need not appear on the site.

RECS Replay therefore uses **reference-only ESV links**. This implementation never requests ESV verse text, and stores none in Bible data, generated indexes, or display projections. The BSB text below is not ESV. Re-read the terms before future changes; stop and report any material change rather than assuming continued permission.

## Official BSB source and version

- Translation: **Berean Standard Bible (BSB)**.
- Official download listing: <https://berean.bible/downloads.htm>, checked 2026-09-25. It links the text below under **“Current, updated to 3rd Printing.”**
- Direct official download: <https://bereanbible.com/bsb.txt>.
- Snapshot acquired: **2026-09-25**. HTTP Last-Modified: **Fri, 31 Jul 2026 14:02:14 GMT**. The mutable download URL does not provide an immutable release identifier; the content hash pins this exact version.
- Raw size: **4,331,393 bytes**.
- Raw SHA-256: `2ac3af1de52d4e68261cba91d85c320b7eadc6560e830d99e591767b8ff5ca96`.
- This is a locally calculated hash of the official HTTPS response, not a publisher-signed checksum.
- Official terms: <https://berean.bible/terms.htm>, checked 2026-09-25. The page expressly dedicates the Berean Bible texts to the public domain as of **April 30, 2023**, links **CC0 1.0**, and permits all uses. The site's generic 2021 copyright footer does not supersede that explicit text dedication.

Attribution: The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text has been dedicated to the public domain. The downloaded file additionally credits unfoldingWord and Bible Aquifer; its header is preserved verbatim.

`bible/bsb.txt` is the complete original download, including its BOM, CRLF line endings, attribution header, and blank verse rows. It is committed project input, not synthesized text or a runtime download. `bible/provenance.json` pins its metadata. `bible/verse-counts.json` is reproducibly generated factual metadata: 66 books, 1,189 chapters, 31,102 verse positions. Empty positions in the publisher's text (for example Matthew 17:21) stay empty; enrichment never supplies alternative text.

## Reference API and editable data

Browser-safe exports from `site/lib/scripture.ts`:

```ts
parseScriptureReference(input: string): ScriptureReference | undefined;
normalizeScriptureReference(input: string): string; // throws on invalid input
scriptureUrl(input: string): string; // canonical, encoded https://www.esv.org/.../
canonicalBook(input: string): string | undefined;
scriptureOverlaps(a: ScriptureReference, b: ScriptureReference): boolean;
```

`ScriptureReference` contains `display` (entered string), `canonical`, `book`, and inclusive `start`/`end` chapter/verse coordinates. `BIBLE_BOOKS` and the aliases in `bible/books.ts` cover all 66 books. Names are case-insensitive; common abbreviations, periods, joined forms (`Rom13`, `1Jn1:1`), Roman numbered books (`II Tim 3:16`), and en/em dashes are accepted. Supported ranges include `Genesis 1-2`, `Romans 12:1-2`, and `John 3:36-4:2`. All endpoints are checked against sourced BSB counts. These are BSB numbering bounds, not a claim of text equivalence with ESV.

Keep editable YAML as `scripture: string[]`, one reference per entry. Comma/semicolon lists and implicit single-chapter-book verse notation are intentionally not accepted; use explicit chapter/verse and separate array entries. `ScriptureInputSchema` accepts aliases; the retained `ScriptureReferenceSchema` validates canonical output for existing callers.

The archive loader normalizes `Passage.scripture`; when normalization changes an entered reference, it preserves the original array in `Passage.scriptureDisplay`. `flattenArchive` carries the same optional aligned array to `SearchPassage`. For unchanged canonical references the array can be absent. UI code should use:

```ts
const label = passage.scriptureDisplay?.[index] ?? passage.scripture[index];
const href = scriptureUrl(passage.scripture[index]);
// Render the reference with an ESV label, not verseText.
```

## Build order and search boundary

1. Verify the committed Bible source/counts with `scripts/devenv-run pnpm exec tsx scripts/bible.ts verify` (offline).
2. `scripts/archive.ts build-index [--mode production|preview]` loads and normalizes the editable archive, applies existing publication filtering, then calls `enrichPassages` from `bible/enrich.ts`. Only the generated `site/public/generated/passages.json` receives optional `SearchPassage.verseText`.
3. Run `scripts/embeddings.ts index` **after** that enriched index is written. The existing build orchestrator already uses this order. It replaces all vectors, not just changed IDs.
4. Build the site using the matching mode. Display loaders/projections do not call enrichment. The complete Bible is not a browser dependency; only referenced verse text is present in the fetched search JSON.

Hidden means **not rendered**, not private: the generated JSON and vectors are public browser inputs. Never spread `verseText` into transcript, summary, preview snippets, structured metadata, or ESV quotations. Source schemas reject author-supplied `verseText`. Enrichment selects exact source rows, skips blank rows, deduplicates overlapping references in stable first-seen order, and does not mutate display records.

`buildEmbeddingDocument` is shared by index generation and browser vector validation. Its stable order is title, summary, questions, topics, canonical scripture references, BSB verse text, transcript, followed by the existing shared NFKC/whitespace preprocessing. The model's existing 256-token truncation still applies. Rebuild all vectors after adding/changing Bible input. Exact document equality rejects previously generated vectors without the new BSB input; the existing `passagesSha256` additionally fingerprints the enriched JSON. The source hash is pinned separately in provenance, and the model/tokenizer config is unchanged.

Search normalizes complete reference queries and matches inclusive reference overlap, so `Romans 13`, `Rom 13`, and `Rom13` agree. `SEARCH_WEIGHTS` centralizes scoring: referenced scripture receives weight 14 plus a 32-point reference bonus, BSB text weight 8, and semantic similarity remains bounded at 3. BSB uses conservative terminal-plural folding for recall: the actual Romans 12:1 source says **“living sacrifices”**, so the singular query `living sacrifice` matches without changing the stored text. That reason is exactly **`Verse-text match (BSB)`**, never an ESV quotation or a claim of exact wording. No acceptance query has special-cased ranking code.

## Reproduction and updates

```sh
# Restore the exact pinned download; refuse upstream drift before overwriting it.
scripts/devenv-run pnpm exec tsx scripts/bible.ts download
# Regenerate counts from verified committed bytes, without network access.
scripts/devenv-run pnpm exec tsx scripts/bible.ts generate
# Verify bytes and byte-for-byte derived-count reproducibility.
scripts/devenv-run pnpm exec tsx scripts/bible.ts verify
scripts/devenv-run pnpm exec vitest run tests/scripture.test.ts tests/search.test.ts
```

For an intentional source update: re-read official ESV and BSB terms and the official download listing; record the new check date/version and any material changes. Inspect the new official source separately, calculate its byte size/hash, and review its differences before changing `provenance.json`. Then run the pinned downloader, regenerate counts, run reference/enrichment/search tests, regenerate the complete passage index and **all** vectors, and rebuild both publication modes. Review any newly invalid references; never silently clamp them or substitute text. Update this document's version/hash alongside provenance. A routine build neither downloads a Bible nor updates the pin automatically.

Tests use synthetic archive metadata and actual pinned BSB rows. They cover aliases across all books, Roman numbers, chapter/verse bounds, cross-chapter ranges, original display preservation, canonical ESV links, source integrity, source blank rows, generated-only enrichment, publication filtering, repeatable indexes, overlap ranking, and singular `living sacrifice` retrieval. Optional `RECS_TEST_EMBEDDINGS=1` additionally exercises a government-question ranking with the real prepared model and synthetic records; real archive acceptance remains a separate main-agent milestone check.
