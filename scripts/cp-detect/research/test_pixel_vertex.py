"""Synthetic-only checks for the E005 supervision and deployment contract."""
import unittest

import numpy as np
import torch

from pixel_vertex import PixelVertex, RADIUS, render_patch
from pixel_vertex_infer import primitives


def generated_grid():
    p = np.array([(x / 8, y / 8) for y in range(9) for x in range(9)], np.float32)
    e = np.array([(y * 9 + x, y * 9 + x + 1) for y in range(9) for x in range(8)] +
                 [(y * 9 + x, (y + 1) * 9 + x) for y in range(8) for x in range(9)])
    a = np.array(["B" if ((p[u, 0] == p[v, 0] and p[u, 0] in (0, 1)) or
                           (p[u, 1] == p[v, 1] and p[u, 1] in (0, 1)))
                  else "M" for u, v in e])
    return {"points": p, "edges": e, "assignments": a,
            "nodes": np.column_stack([p, np.any((p == 0) | (p == 1), axis=1)])}


class SupervisionTests(unittest.TestCase):
    def test_boundary_side_coordinate_uses_inset_paper_frame(self):
        for size in (1024, 2048):
            quarter = 32 + (size - 64) / 4
            points = [(quarter, 32.5, .9), (size - 32.5, quarter, .9),
                      (quarter, size - 31.5, .9), (31.5, quarter, .9)]
            result = primitives(points, size)
            self.assertEqual(len(result), 4)
            for vertex, side in zip(result, ("top", "right", "bottom", "left")):
                self.assertEqual(vertex["boundary_side"], side)
                self.assertAlmostEqual(vertex["side_coordinate"], .25)

    def test_aux_is_positive_without_changing_fold_truth(self):
        row = generated_grid()
        for seed in range(12):
            clean = render_patch(row, np.random.default_rng(seed), 128, False)
            aux = render_patch(row, np.random.default_rng(seed), 128, True)
            self.assertTrue(np.any(clean[0] != aux[0]))
            for index in (1, 2, 3, 5, 6):
                np.testing.assert_array_equal(clean[index], aux[index])
            np.testing.assert_array_equal(clean[4][0], aux[4][0])
            self.assertEqual(float(clean[4][1].sum()), 0)
            self.assertGreater(float(aux[4][1].sum()), 0)

    def test_offset_recovers_subpixel_centers_including_border(self):
        row = generated_grid()
        checked = border_checked = 0
        for seed in range(32):
            _, heat, offsets, mask, _, nodes, boundary = render_patch(row, np.random.default_rng(seed), 128)
            for (x, y), border in zip(nodes, boundary):
                ix, iy = round(float(x)), round(float(y))
                self.assertEqual(heat[0, iy, ix], 1)
                self.assertEqual(mask[0, iy, ix], 1)
                reconstructed = np.array([ix, iy]) + offsets[:, iy, ix] * RADIUS
                np.testing.assert_allclose(reconstructed, [x, y], atol=1e-5)
                checked += 1
                border_checked += int(border)
        self.assertGreater(checked, 20)
        self.assertGreater(border_checked, 5)

    def test_model_has_separate_crease_and_aux_logits(self):
        torch.set_num_threads(2)
        model = PixelVertex().eval()
        with torch.no_grad():
            output = model(torch.ones(1, 3, 64, 64))
        self.assertEqual(tuple(output.shape), (1, 5, 64, 64))
        self.assertTrue(bool(torch.isfinite(output).all()))
        self.assertLessEqual(float(output[:, 1:3].abs().max()), 1)


if __name__ == "__main__":
    unittest.main()
