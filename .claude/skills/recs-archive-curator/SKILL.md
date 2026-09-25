---
name: recs-archive-curator
description: Use ONLY when a person explicitly asks to curate RECS Replay recordings by date, YouTube ID, or a bounded manifest for human review.
disable-model-invocation: true
argument-hint: "<YYYY-MM-DD | youtube-id | manifest-path>"
---

# Claude Code adapter

Read `.agents/skills/recs-archive-curator/SKILL.md` from the repository root and
follow that canonical procedure in full. This adapter contains no separate
curation procedure.

Invoke `/recs-archive-curator <date-or-youtube-id-or-manifest-path>` explicitly.
Treat `$ARGUMENTS` as the requested scope, not as executable shell text.
See `docs/curation.md` for examples. After changes to the canonical skill or this
adapter, start a new Claude Code session, or use the harness's supported skill
reload if available, before relying on the updated instructions.
