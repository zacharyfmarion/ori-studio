"""Synthetic checks for the reference audit; no real CPs are fixtures."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from audit_exact_recovery import normalize


class ExactRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.truth = {
            'vertices_coords': [[0, 0], [1, 0], [1, 1], [0, 1], [.5, .5], [.25, .75]],
            'edges_vertices': [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 2], [4, 5]],
            'edges_assignment': ['B', 'B', 'B', 'B', 'M', 'V', 'F'],
        }

    def matches(self, predicted, epsilon=1e-9, include_aux=True):
        with tempfile.TemporaryDirectory() as temporary:
            d = Path(temporary)
            for name, fold in [('truth', self.truth), ('predicted', predicted)]:
                (d/f'{name}.fold').write_text(json.dumps(normalize(fold, include_aux)))
            (d/'pairs.tsv').write_text(f'{d}/predicted.fold\t{d}/truth.fold\n')
            value = subprocess.run(['target/release/examples/strict_diff', str(d/'pairs.tsv'),
                                    str(epsilon*1024)], check=True, text=True, capture_output=True)
            return json.loads(value.stdout)['metrics']['exact_topology_and_assignment']

    def test_same_geometry_in_different_units_matches(self):
        prediction = copy.deepcopy(self.truth)
        prediction['vertices_coords'] = [[x*400-200, y*400+120] for x, y in prediction['vertices_coords']]
        self.assertTrue(self.matches(prediction))

    def test_literal_equality_has_no_hidden_coordinate_allowance(self):
        self.assertTrue(self.matches(self.truth, epsilon=0))
        prediction = copy.deepcopy(self.truth)
        prediction['vertices_coords'][4][0] += 1e-15
        self.assertFalse(self.matches(prediction, epsilon=0))
        self.assertTrue(self.matches(prediction, epsilon=1e-12))

    def test_subpixel_error_is_not_exact(self):
        prediction = copy.deepcopy(self.truth)
        prediction['vertices_coords'][4][0] += 1e-4
        self.assertFalse(self.matches(prediction))
        self.assertTrue(self.matches(prediction, epsilon=2/1024))

    def test_aux_errors_are_visible_in_complete_graph_score(self):
        prediction = copy.deepcopy(self.truth)
        prediction['vertices_coords'][5][1] += .01
        self.assertFalse(self.matches(prediction))
        self.assertTrue(self.matches(prediction, include_aux=False))

    def test_assignment_errors_fail(self):
        prediction = copy.deepcopy(self.truth)
        prediction['edges_assignment'][5] = 'M'
        self.assertFalse(self.matches(prediction))

    def test_aspect_ratio_error_is_not_normalized_away(self):
        prediction = copy.deepcopy(self.truth)
        prediction['vertices_coords'] = [[x, y*1.01] for x, y in prediction['vertices_coords']]
        self.assertFalse(self.matches(prediction))


if __name__ == '__main__':
    unittest.main()
