"""Small independent geometry/behavior gates; no private corpus dependency."""
import json
from pathlib import Path
import subprocess
import unittest

import numpy as np

from solver import Prepared, solve, metrics
from topology import triangulate, transverse_crossings

ROOT = Path(__file__).resolve().parents[3]


class TopologyTests(unittest.TestCase):
    def test_collinear_material_boundary_is_preserved(self):
        for points in [
            [[0, 0], [1, 0], [2, 0], [3, 0], [3, 2], [0, 2]],
            [[0, 0], [1, 0], [2, 1e-12], [0, 2]],
            [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [2, 3], [2, 1], [0, 1]],
        ]:
            for ring in [points, list(reversed(points))]:
                triangles = triangulate(ring)
                self.assertEqual(set(triangles.ravel()), set(range(len(ring))))
                self.assertEqual(len(triangles), len(ring)-2)
                for tri in triangles:
                    a, b, c = np.array(ring)[tri]
                    ab, ac = b-a, c-a
                    self.assertGreater(ab[0]*ac[1]-ab[1]*ac[0], 1e-7)

    def test_crossing_detector_distinguishes_a_crossing_from_contact(self):
        p = np.array([[-1., -1, 0], [1, -1, 0], [0, 1, 0],
                      [0, -.5, -1], [0, -.5, 1], [0, .5, 0]])
        triangles = np.array([[0, 1, 2], [3, 4, 5]])
        self.assertEqual(transverse_crossings(p, triangles, [0, 1]), [(0, 1)])
        p[3:, 0] += 3
        self.assertEqual(transverse_crossings(p, triangles, [0, 1]), [])
        p[3:] = p[:3]
        self.assertEqual(transverse_crossings(p, triangles, [0, 1]), [])
        # A legal hinge sharing its material edge must not be an intersection.
        p = np.array([[-1., 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]])
        self.assertEqual(transverse_crossings(p, np.array([[0, 1, 2], [0, 1, 3]]), [0, 1]), [])


class SolveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        binary = ROOT/'target/release/examples/fold3d_spread_source'
        cls.source = json.loads(subprocess.check_output([str(binary), '--strip'], text=True))

    def test_coupled_strip_opens_without_tearing_or_crossing(self):
        prepared = Prepared(self.source)
        self.assertEqual(len(prepared.frames), 2)
        self.assertGreater(prepared.depth, 1)
        d, report = solve(prepared)
        self.assertEqual(report['status'], 'Solved')
        self.assertGreater(metrics(prepared, d, 1)['mean_gap_percent'], 1)
        self.assertEqual(transverse_crossings(prepared.p+d, prepared.triangles, prepared.triangle_faces), [])
        self.assertLess(np.max(np.abs(d.mean(axis=0))), 1e-8)
        # Each ring's consecutive material edge occurs in its triangulation:
        # displacing its endpoints therefore gives the identical edge on both faces.
        for ring, triangles in zip(prepared.faces, prepared.face_triangles):
            edges = {tuple(sorted((int(t[i]), int(t[(i+1) % 3])))) for t in triangles for i in range(3)}
            for a, b in zip(ring, ring[1:]+ring[:1]):
                self.assertIn(tuple(sorted((a, b))), edges)

    def test_no_stacks_is_exactly_zero(self):
        prepared = Prepared(self.source)
        prepared.gaps = []
        d, report = solve(prepared)
        np.testing.assert_array_equal(d, np.zeros_like(prepared.p))
        self.assertEqual(report['status'], 'no-stacks')

    def test_render_orders_are_witnessed_and_scoped_to_their_source_plane(self):
        prepared = Prepared(self.source)
        plans = prepared.render_order()
        self.assertEqual(sum(len(plane['orders']) for plane in plans), 2)
        for plane in plans:
            self.assertAlmostEqual(np.linalg.norm(plane['normal']), 1.)
            for lower, upper in plane['orders']:
                self.assertIn(lower, plane['faces'])
                self.assertIn(upper, plane['faces'])
                self.assertTrue(any(upper in witness['stack'] and lower in witness['stack']
                                    and witness['stack'].index(upper) < witness['stack'].index(lower)
                                    for witness in plane['witnesses']))
            for face in plane['faces']:
                distances = (prepared.p[prepared.faces[face]] - plane['origin']) @ plane['normal']
                self.assertLess(np.max(np.abs(distances)), 1e-8)

    def test_unknown_order_is_refused(self):
        source = json.loads(json.dumps(self.source))
        source['render']['undetermined_cells'] = 1
        with self.assertRaisesRegex(ValueError, 'undetermined'):
            Prepared(source)

    def test_a_rigid_change_of_world_frame_rotates_the_same_solution(self):
        prepared = Prepared(self.source)
        d, _ = solve(prepared)
        source = json.loads(json.dumps(self.source))
        rotation = np.array([[0., -1, 0], [1, 0, 0], [0, 0, 1]])
        move = np.array([500., -120., 33.])
        def rotate(values, translate=True):
            return (np.array(values).reshape(-1, 3) @ rotation.T + (move if translate else 0)).ravel().tolist()
        source['folded']['vertices_coords'] = np.array(rotate(source['folded']['vertices_coords'])).reshape(-1, 3).tolist()
        render = source['render']
        for key in ['ring_points', 'cell_points', 'edge_points']:
            render[key] = rotate(render[key])
        render['face_normals'] = rotate(render['face_normals'], False)
        frames = np.array(render['plane_frames']).reshape(-1, 4, 3)
        frames = frames @ rotation.T
        frames[:, 1] += move
        render['plane_frames'] = frames.ravel().tolist()
        rotated = Prepared(source)
        actual, _ = solve(rotated)
        np.testing.assert_allclose(actual, d @ rotation.T, atol=1e-6)


if __name__ == '__main__':
    unittest.main()
