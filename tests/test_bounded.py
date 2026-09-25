"""Exercise the portable wrapper's external contract with real subprocesses."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / 'scripts/run_bounded.py'


class BoundedTests(unittest.TestCase):
    def invoke(self, code, timeout='3'):
        return subprocess.run(
            [sys.executable, str(RUNNER), sys.executable, '-c', code],
            env={**os.environ, 'RECS_DEVENV_TIMEOUT_SECONDS': timeout},
            capture_output=True, text=True, timeout=10,
        )

    def test_preserves_exit_status(self):
        self.assertEqual(self.invoke('raise SystemExit(7)').returncode, 7)

    def test_timeout_returns_124(self):
        result = self.invoke('import time; time.sleep(30)', '0.2')
        self.assertEqual(result.returncode, 124)
        self.assertIn('terminated child process group', result.stderr)

    def test_rejects_unbounded_values(self):
        for value in ('0', '-1', 'nan', 'inf', 'invalid'):
            with self.subTest(value=value):
                self.assertEqual(self.invoke('raise SystemExit(0)', value).returncode, 2)

    def test_kills_term_resistant_descendant_after_leader_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'descendant-survived'
            child = (
                'import signal,time,pathlib; '
                'signal.signal(signal.SIGTERM,signal.SIG_IGN); '
                f'time.sleep(2); pathlib.Path({str(marker)!r}).touch()'
            )
            leader = (
                'import subprocess,sys,time; '
                f'subprocess.Popen([sys.executable,"-c",{child!r}]); '
                'time.sleep(30)'
            )
            self.assertEqual(self.invoke(leader, '0.4').returncode, 124)
            time.sleep(2)
            self.assertFalse(marker.exists())

    def test_sigterm_cleans_group(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'survived'
            code = f'import pathlib,time; time.sleep(2); pathlib.Path({str(marker)!r}).touch()'
            process = subprocess.Popen(
                [sys.executable, str(RUNNER), sys.executable, '-c', code],
                env={**os.environ, 'RECS_DEVENV_TIMEOUT_SECONDS': '30'},
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            time.sleep(0.3)
            process.send_signal(signal.SIGTERM)
            process.communicate(timeout=10)
            self.assertEqual(process.returncode, 143)
            time.sleep(2)
            self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
