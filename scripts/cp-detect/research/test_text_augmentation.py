"""Annotation distractors must never become crease or AUX training targets."""
import unittest

import numpy as np

from fine_tune_text import TextPatches
from pixel_vertex import Patches
from test_pixel_vertex import generated_grid


class TextAugmentationTests(unittest.TestCase):
    def setUp(self):
        row = generated_grid()
        row['family'] = 'generated-test-grid'
        self.clean = Patches([row], 128, 8, 811)
        self.text = TextPatches([row], 128, 8, 811, 1.)

    def test_annotations_change_pixels_but_preserve_all_geometric_targets(self):
        changed = 0
        for index in range(8):
            clean = self.clean.sample(index)
            text = self.text.sample(index)
            changed += int(np.any(clean[0] != text[0]))
            for plain, annotated in zip(clean[1:], text[1:], strict=True):
                np.testing.assert_array_equal(plain, annotated)
            self.assertTrue(np.isfinite(text[0]).all())
            self.assertGreaterEqual(float(text[0].min()), 0)
            self.assertLessEqual(float(text[0].max()), 1)
        self.assertGreater(changed, 4)

    def test_annotation_rendering_is_deterministic(self):
        for first, second in zip(self.text.sample(3), self.text.sample(3), strict=True):
            np.testing.assert_array_equal(first, second)


if __name__ == '__main__':
    unittest.main()
