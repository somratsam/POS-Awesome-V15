import subprocess
import unittest
from unittest.mock import patch

from posawesome.posawesome.api import utilities


class TestRemoteUpdateInfoNoFetch(unittest.TestCase):
    """get_remote_update_info runs every time the POS opens (update popup
    check). It must never run `git fetch` (network + repo write on every
    open); it only reads the local repo. It stays callable and returns the
    same fields."""

    def test_no_git_fetch_and_same_fields(self):
        real_check_output = subprocess.check_output
        commands = []

        def spy(cmd, *args, **kwargs):
            commands.append(list(cmd))
            return real_check_output(cmd, *args, **kwargs)

        with patch.object(utilities.subprocess, "check_output", side_effect=spy):
            data = utilities.get_remote_update_info()

        git_subcommands = [c[1] for c in commands if c and c[0] == "git" and len(c) > 1]
        self.assertTrue(git_subcommands, "expected local git reads (rev-parse/log)")
        self.assertNotIn("fetch", git_subcommands)
        self.assertNotIn("pull", git_subcommands)
        self.assertIn("build_version", data)
        self.assertIn("commit_hash", data)
        self.assertIn("remote_heads", data)

    def test_returns_build_version_when_git_fails(self):
        with patch.object(
            utilities.subprocess, "check_output", side_effect=OSError("git not available")
        ):
            data = utilities.get_remote_update_info()
        self.assertIn("build_version", data)
        self.assertNotIn("remote_ahead", data)
