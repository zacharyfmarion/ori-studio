import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from check_fonts import v1_problems


class FontRetentionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repo = self.directory.name
        Path(self.repo, 'latin.ttf').write_bytes(b'original metrics')
        self.font = {'file': 'NotoSansSC-Regular.full.123456789abc.ttf', 'sha256': 'abc', 'bytes': 42}
        self.manifest = {'version': 1, 'files': [self.font], 'coverage': {'sc': '1.2'}}
        self.lock = {
            'fonts': [copy.deepcopy(self.font)],
            'manifestSha256': hashlib.sha256(json.dumps(self.manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'inputs': {'latin.ttf': hashlib.sha256(b'original metrics').hexdigest()},
        }

    def problems(self):
        return v1_problems(self.manifest, self.lock, self.repo)

    def test_unchanged_fonts_pass_without_a_live_site(self):
        self.assertEqual(self.problems(), [])

    def test_valid_new_file_cannot_replace_an_installed_desktops_name(self):
        self.font['file'] = 'NotoSansSC-Regular.full.def012345678.ttf'
        self.assertTrue(any('removed, renamed or changed' in p for p in self.problems()))

    def test_same_name_cannot_hide_changed_font_bytes(self):
        self.font['sha256'] = 'changed'
        self.assertTrue(any('removed, renamed or changed' in p for p in self.problems()))

    def test_removed_font_fails(self):
        self.manifest['files'] = []
        self.assertTrue(any('removed, renamed or changed' in p for p in self.problems()))

    def test_coverage_changes_cannot_silently_change_font_selection(self):
        self.manifest['coverage']['sc'] = '1.3'
        self.assertTrue(any('coverage changed' in p for p in self.problems()))

    def test_bundled_latin_metrics_cannot_change(self):
        Path(self.repo, 'latin.ttf').write_bytes(b'different metrics')
        self.assertIn('latin.ttf: frozen v1 input changed or missing', self.problems())

    def test_missing_input_fails(self):
        Path(self.repo, 'latin.ttf').unlink()
        self.assertIn('latin.ttf: frozen v1 input changed or missing', self.problems())


if __name__ == '__main__':
    unittest.main()
