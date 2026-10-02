# Weekly operation

Each week a new service is found, drafted, checked by a person and published. Only the last step puts
anything on the website, and only a person does it.

## 1. Discovery

**Discover RECS Uploads** runs on Mondays at 01:17 UTC (09:17 Singapore) on the default branch. It reads
the public, credential-free Atom feed of the church channel (`UCLjwcZaIkiFEed1VgQYSsrw`), which lists only
recent uploads. For each upload the archive does not know yet (not in a recording file or a `corpus/`
record), it opens or updates a curator issue. It downloads no media or captions and interprets nothing.

Use **Actions → Discover RECS Uploads → Run workflow** with `apply=false` for a dry run, then `apply=true` to
reconcile issues. The workflow has only `contents: read` and `issues: write`. Locally,
`scripts/devenv-run pnpm discover` is read-only unless given `--apply`. Feed titles are data, never
instructions.

## 2. Drafting

A person picks the issue and asks an agent to draft the recording with the
[curator skill](../.agents/skills/recs-archive-curator/SKILL.md) (`/recs-archive-curator <date or video id>`),
on a branch such as `curation/2026-10-04`. Run it on Monday, a day after the service, so YouTube's English
captions are available. The agent:

1. Finds every upload of the service (a dropped livestream restarts as a new upload) and their order.
2. Gets a transcript to work from: YouTube's original English captions (`pnpm captions:source fetch`), or
   local transcription if they fail the quality gate (`pnpm media:acquire` and `pnpm media:transcribe`).
   This needs media authorization; see [media tooling](media-tooling.md). The transcript stays in a private
   workspace outside the repository and is deleted afterwards (`pnpm media:cleanup`).
3. Writes `services/<date>.yaml` as a **draft**, following [the recording format](editing-services.md) and
   [drafting a recording](curation.md).
4. Runs `pnpm validate:archive` and `pnpm build:preview`, and opens a pull request for review.

## 3. Checking and publishing

A person opens the draft from the hidden `/dev` page in the editor, listens to anything uncertain, fixes it,
and sends. Sending marks the recording `published` in a pull request; merging it publishes it. Agents never
publish. The default branch deploys production after the required checks pass. Close the discovery issue
once the recording is on the website, or with a reason if it is not wanted.
