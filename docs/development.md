# Development environment

The intended toolchain is pinned by `devenv.yaml` and the generated `devenv.lock`.
The modules are pinned to devenv 1.11.1 and the package source to Darwin 26.05
to support this Intel Mac. Using rolling 26.11 packages or current unversioned
devenv modules fails on x86_64-darwin. Revisit platform support before upgrading.
Use `scripts/devenv-run <command> [args...]` for project commands. It runs
`devenv shell -- <command>` in a new process group, with a default 900-second
limit. On timeout it terminates the group, escalates to SIGKILL, and exits 124.
SIGINT and SIGTERM also clean up the child group.

`RECS_DEVENV_TIMEOUT_SECONDS` accepts a positive finite duration. A cold Nix
evaluation may use a larger documented bound. Media acquisition and
transcription limits must be calibrated before processing a full recording.
`python3 scripts/run_bounded.py <command>` supplies the same bound for toolchain
maintenance commands that must run outside devenv.

Media tools require explicit operator authorization. An operator-set environment
flag is supported; alternatively, current-conversation permission can be recorded
in `.local/media-authorization.json` and supplied explicitly with
`--authorization-file`. This local record is ignored by Git and must never be
copied into the site. A new run must reconfirm permission. It does not confer
editorial approval.

Downloaded media and model weights belong in an external temporary/cache root.
The repository stores only reviewable archive interpretation, never recordings.
