#!/usr/bin/env python3
"""Tests for scripts/check_template_consistency.py's plugin checks.

    python3 scripts/test_check_template_consistency.py

Each case copies the files the audit reads into a scratch tree, mutates it, and runs
the audit there. Standard library only.
"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIT = ROOT / "scripts" / "check_template_consistency.py"


def scratch_tree():
    target = Path(tempfile.mkdtemp(prefix="template-consistency-"))
    for name in ("skills", "plugins", "scripts"):
        shutil.copytree(ROOT / name, target / name)
    (target / "content").mkdir()
    for path in (ROOT / "content").glob("*.md"):
        shutil.copy2(path, target / "content" / path.name)
    for name in ("README.md", "myst.yml"):
        shutil.copy2(ROOT / name, target / name)
    return target


def audit(tree):
    result = subprocess.run([sys.executable, str(tree / "scripts" / AUDIT.name)],
                            capture_output=True, text=True)
    return result.returncode, result.stdout


def line(output, check):
    return next(row for row in output.splitlines() if row.strip().startswith(check))


class PluginChecks(unittest.TestCase):
    def setUp(self):
        self.tree = scratch_tree()

    def tearDown(self):
        shutil.rmtree(self.tree, ignore_errors=True)

    def test_repository_passes_with_human_review_undeclared(self):
        code, out = audit(self.tree)
        self.assertEqual(code, 0, out)
        self.assertNotIn("human-review-plugin.mjs", (self.tree / "myst.yml").read_text(encoding="utf-8"))
        self.assertTrue(line(out, "PLUGINS_DECLARED").endswith("ok"))

    def test_an_undeclared_plugin_not_named_optional_still_fails(self):
        (self.tree / "plugins" / "extra-plugin.mjs").write_text("export default {};\n", encoding="utf-8")
        code, out = audit(self.tree)
        self.assertNotEqual(code, 0)
        self.assertIn("extra-plugin.mjs", line(out, "PLUGINS_DECLARED"))

    def test_a_stale_optional_entry_fails(self):
        (self.tree / "plugins" / "human-review-plugin.mjs").unlink()
        code, out = audit(self.tree)
        self.assertNotEqual(code, 0)
        self.assertIn("human-review-plugin.mjs", line(out, "OPTIONAL_PLUGINS_EXIST"))

    def test_opting_in_is_allowed_but_example_acceptances_are_not(self):
        myst = self.tree / "myst.yml"
        myst.write_text(myst.read_text(encoding="utf-8").replace(
            "    - plugins/trust-claim-plugin.mjs\n",
            "    - plugins/trust-claim-plugin.mjs\n    - plugins/human-review-plugin.mjs\n"), encoding="utf-8")
        code, out = audit(self.tree)
        self.assertEqual(code, 0, out)
        (self.tree / "content" / "02_section.md").write_text(
            ":::{human-reviews}\n:submissions-path: ../community/examples/human_reviews.accepted.example.json\n:::\n",
            encoding="utf-8")
        code, out = audit(self.tree)
        self.assertNotEqual(code, 0)
        self.assertIn("content/02_section.md", line(out, "NO_EXAMPLE_REVIEW_DATA_BOUND"))

    def test_disguised_or_nested_example_paths_are_caught(self):
        for index, path in enumerate(["../community/./examples/a.json",
                                      "../community/schemas/../examples/a.json",
                                      "../community//examples/a.json"]):
            page = self.tree / "content" / "nested" / "page_{}.md".format(index)
            page.parent.mkdir(exist_ok=True)
            page.write_text(":::{human-reviews}\n:submissions-path: " + path + "\n:::\n", encoding="utf-8")
            code, out = audit(self.tree)
            self.assertNotEqual(code, 0, path)
            self.assertIn("page_{}.md".format(index), line(out, "NO_EXAMPLE_REVIEW_DATA_BOUND"))
            page.unlink()

    def test_community_paths_outside_examples_are_not_flagged(self):
        (self.tree / "content" / "02_section.md").write_text(
            "See ../community/schemas/human_submission.schema.json and ../community/human_submissions.json\n",
            encoding="utf-8")
        code, out = audit(self.tree)
        self.assertEqual(code, 0, out)


if __name__ == "__main__":
    unittest.main()
