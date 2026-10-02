# Contributing to RECS Replay

Thank you for helping. The most useful contributions are corrections: a wrong time, a better title,
a missing Bible reference or key point. Code improvements are welcome too.

## Reporting a problem

[Open an issue](../../issues/new/choose). Please include the service date and, if you can, the time in
the video where the problem is.

## Changing a recording yourself

Press **Suggest a change** on the recording. The editor plays the recording (all of its YouTube uploads,
as one) with a timeline underneath:

- **Chapters**: named sections with editable titles, types and start/end times. Select a chapter to
  edit its full title and timestamped descriptions in the editing pane. Repeated types are fine.
- **Subchapters**: named sections inside a chapter, with their own titles, types and times. Press **P**
  to add one at the playhead.
- **Points**: press **K** to add a timestamped note about what happens there. Points appear as diamonds
  and help search and reviewers. They do not become rows in the viewer's chapter list.
- **Markers**: press **M** to mark a moment to come back to. Your marks stay private unless you tick
  **Send with my changes**.
- **Windows** adds a transcript (load captions or a Whisper file from your computer), your markers, and
  the recording's details: title, description, scripture and topics.

If YouTube will not play the video, choose **Use a video file on this computer instead**; it plays in your
browser and is never uploaded.

Sending needs a free GitHub account; the editor explains this and can walk you through making one. Press
**Review & send** and follow the steps, one at a time, each with a picture: the editor fetches the current file
from GitHub, applies your edits and checks them, then you copy it, paste it over the file in GitHub's editor
(Cmd/Ctrl+A, Cmd/Ctrl+V) and choose **Commit changes → Propose changes → Create pull request**.

If you prefer editing the file directly: each service is `services/<date>.yaml`. The
[format guide](docs/editing-services.md) explains every field, and your editor can autocomplete the file
from its schema. Check your edit and preview the site:

```sh
scripts/devenv-run pnpm validate:archive
scripts/devenv-run pnpm build:preview && scripts/devenv-run pnpm preview
```

Keep one recording (or one kind of fix) per pull request so it is easy to review.

## How review works

- **Draft:** not on the website. Everything an AI or a script drafts is `status: draft`.
- **Published:** a person has checked it. Sending from the editor sets `status: published`, because you
  have looked at it; if you edit a file by hand to publish a draft you have checked, set it yourself.
- **Publishing:** a maintainer reviews the pull request and merges it. That is the approval, and the site
  rebuilds with it.

## Code changes

See [`docs/`](docs/README.md) for development setup, tests and architecture. Before opening a pull request,
run:

```sh
scripts/devenv-run pnpm check
```

## Licensing of contributions

By contributing, you agree that your contributions are licensed under the project's licences:
[MIT](LICENSE) for code and [CC BY-SA 4.0](LICENSE-CONTENT.md) for archive content. Only contribute material
you have the right to share. Do not paste transcripts, song lyrics or other people's copyrighted text into
descriptions or key point summaries.
