"""Portable finite subprocess execution with whole-process-group cleanup."""

import os
import signal
import subprocess
import sys
import time


def run(command, timeout):
    if timeout <= 0:
        raise ValueError("Timeout must be positive")
    started = time.monotonic()
    child = subprocess.Popen(command, start_new_session=True)

    def cleanup():
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        # Descendants may still exist after the leader exits.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()

    def interrupt(signum, _frame):
        cleanup()
        raise SystemExit(128 + signum)

    previous = {s: signal.signal(s, interrupt) for s in (signal.SIGTERM, signal.SIGINT)}
    try:
        try:
            return child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            cleanup()
            print(
                f"Timed out after {time.monotonic() - started:.1f}s; "
                "terminated child process group.",
                file=sys.stderr,
            )
            return 124
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def main():
    try:
        timeout = float(os.environ.get("RECS_DEVENV_TIMEOUT_SECONDS", "900"))
        if not 0 < timeout < float("inf"):
            raise ValueError("Timeout must be positive and finite")
        if len(sys.argv) < 2:
            raise ValueError("Usage: run_bounded.py <command> [args...]")
        return run(sys.argv[1:], timeout)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
