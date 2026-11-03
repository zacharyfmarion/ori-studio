"""Experimental coupled spatial displacement QP; never changes the source fold.

Coordinates and normals are frozen during the solve. Shared material vertices
are the unknowns; per-layer infinitesimal rigid motions regularize their shape.
Geometry diagnostics remain independent of the viewer's layer-order correction.
"""
from itertools import combinations
import time

import clarabel
import numpy as np
from scipy import sparse
from shapely.geometry import LineString, Point, Polygon
from topology import triangulate


def skew(p):
    x, y, z = p
    return np.array([[0., -z, y], [z, 0., -x], [-y, x, 0.]])


def row_sum(terms):
    row = {}
    for i, v in terms:
        row[i] = row.get(i, 0.) + v
    return {i: v for i, v in row.items() if abs(v) > 1e-12}


def matrix(rows, columns):
    r, c, v = [], [], []
    for i, row in enumerate(rows):
        for j, x in row.items():
            r.append(i)
            c.append(j)
            v.append(x)
    return sparse.csc_matrix((v, (r, c)), shape=(len(rows), columns))


def polygons(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry] if geometry.area > 1e-12 else []
    return [p for g in getattr(geometry, 'geoms', []) for p in polygons(g)]


class Prepared:
    def __init__(self, source):
        self.source = source
        folded, model = source['folded'], source['render']
        if model['undetermined_cells']:
            raise ValueError('Layer order is undetermined; no spread has been guessed.')
        if source['snapshot']['verdict']['verdict'] != 'folded':
            raise ValueError('The source has a crossing or ordering verdict; not admitted to this experiment.')
        self.original = np.array(folded['vertices_coords'], dtype=float)
        self.center = (self.original.min(axis=0) + self.original.max(axis=0)) / 2
        self.scale = np.ptp(self.original, axis=0).max() / 2
        self.p = (self.original - self.center) / self.scale
        self.faces = folded['faces_vertices']
        self.edges = folded['edges_vertices']
        self.edge_angles = folded['edges_foldAngle']
        sheet = np.array(source['sheet'], dtype=float)
        attrs = np.array(model['face_attr']).reshape(-1, 4)
        self.face_planes = attrs[:, 0]
        self.frames = np.array(model['plane_frames']).reshape(-1, 12)
        self.normals = np.array(model['face_normals']).reshape(-1, 3)
        self.face_triangles, self.triangles, self.triangle_faces = [], [], []
        self.areas = []
        for f, ring in enumerate(self.faces):
            local = triangulate(sheet[ring])
            tris = np.array(ring)[local]
            for t in tris:
                a, b, c = self.p[t]
                if np.dot(np.cross(b-a, c-a), self.normals[f]) < 0:
                    t[1], t[2] = t[2], t[1]
            self.face_triangles.append(tris)
            self.triangles.extend(tris.tolist())
            self.triangle_faces.extend([f] * len(tris))
            self.areas.append(sum(np.linalg.norm(np.cross(self.p[t[1]]-self.p[t[0]], self.p[t[2]]-self.p[t[0]]))/2 for t in tris))
        self.triangles = np.array(self.triangles, dtype=int)
        self.areas = np.array(self.areas)
        self.groups = self.display_groups()
        self.cells = np.array(model['cell_attr']).reshape(-1, 7)
        self.depth = int(self.cells[:, 4].max())
        self.gaps, self.crossings = [], []
        self.base_triangles, self.base_lines = [], []
        self.prepare_cells()

    def display_groups(self):
        parent = list(range(len(self.faces)))
        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a
        incidence = {}
        for f, ring in enumerate(self.faces):
            for a, b in zip(ring, ring[1:] + ring[:1]):
                incidence.setdefault(tuple(sorted((a, b))), []).append(f)
        for ends, angle in zip(self.edges, self.edge_angles):
            faces = incidence.get(tuple(sorted(ends)), [])
            if len(faces) == 2 and abs(angle) < 1e-7:
                parent[find(faces[1])] = find(faces[0])
        groups = {}
        for f in range(len(parent)):
            groups.setdefault(find(f), []).append(f)
        return list(groups.values())

    def render_order(self):
        """Plane-local source orders; retain cell witnesses, never infer depth."""
        group_of = {face: g for g, faces in enumerate(self.groups) for face in faces}
        result = []
        for plane, frame in enumerate(self.frames):
            faces = np.flatnonzero(self.face_planes == plane).tolist()
            orders, witnesses = set(), []
            for cell, (p, _, _, start, count, _, _) in enumerate(self.cells):
                if p != plane or count < 2:
                    continue
                stack = self.source['render']['cell_stack'][start:start+count]
                witnesses.append({'cell': cell, 'stack': stack})
                orders.update((stack[j], stack[i]) for i in range(count) for j in range(i+1, count))
            result.append({'id': plane, 'normal': frame[:3].tolist(),
                           'origin': ((frame[3:6]-self.center)/self.scale).tolist(),
                           'faces': faces, 'groups': [group_of[f] for f in faces],
                           'orders': sorted(orders), 'witnesses': witnesses})
        return result

    def prepare_cells(self):
        model = self.source['render']
        cell_points = (np.array(model['cell_points']).reshape(-1, 3) - self.center) / self.scale
        for plane, start, count, stack_start, stack_count, _, _ in self.cells:
            ring = cell_points[start:start+count]
            stack = model['cell_stack'][stack_start:stack_start+stack_count]
            frame = self.frames[plane]
            normal, u, v = frame[:3], frame[6:9], frame[9:12]
            basis = np.column_stack((u, v))
            xy = ring @ basis
            cell_polygon = Polygon(xy)
            if not cell_polygon.is_valid:
                raise ValueError('Invalid source cell ring')
            # Exact unspread visible skins, including only true material edges.
            for face, side in [(stack[0], 1), (stack[-1], -1)]:
                outward = normal * side
                front = 1 if np.dot(self.normals[face], outward) > 0 else -1
                for tri in triangulate(xy):
                    points = ring[tri].copy()
                    if np.dot(np.cross(points[1]-points[0], points[2]-points[0]), outward) < 0:
                        points[[1, 2]] = points[[2, 1]]
                    self.base_triangles.extend([list(p) + list(outward) + [front] for p in points])
                face_ring = self.faces[face]
                for a, b in zip(face_ring, face_ring[1:] + face_ring[:1]):
                    pa, pb = self.p[a], self.p[b]
                    line = LineString([pa @ basis, pb @ basis])
                    clipped = line.intersection(cell_polygon)
                    lines = [clipped] if clipped.geom_type == 'LineString' else getattr(clipped, 'geoms', [])
                    for segment in lines:
                        if segment.geom_type != 'LineString' or segment.length < 1e-9:
                            continue
                        for point in [segment.coords[0], segment.coords[-1]]:
                            t = line.project(Point(point), normalized=True)
                            self.base_lines.append(list(pa+t*(pb-pa)) + list(outward) + [1])
            if len(stack) < 2:
                continue
            caches = {}
            for face in stack:
                entries = []
                for ids in self.face_triangles[face]:
                    vertices = self.p[ids] @ basis
                    poly = Polygon(vertices)
                    if poly.area < 1e-13:
                        continue
                    inv = np.linalg.inv(np.vstack([vertices.T, np.ones(3)]))
                    entries.append((ids, poly, inv))
                caches[face] = entries
            for i, j in combinations(range(len(stack)), 2):
                upper, lower = stack[i], stack[j]
                for ids_u, poly_u, inv_u in caches[upper]:
                    for ids_l, poly_l, inv_l in caches[lower]:
                        for overlap in polygons(poly_u.intersection(poly_l).intersection(cell_polygon)):
                            def gap_row(point):
                                h = np.r_[point, 1.]
                                wu, wl = inv_u @ h, inv_l @ h
                                return row_sum((3*int(vertex)+axis, sign*w*normal[axis])
                                               for ids, weights, sign in [(ids_u, wu, 1), (ids_l, wl, -1)]
                                               for vertex, w in zip(ids, weights) for axis in range(3))
                            if j == i+1:
                                centroid = np.array(overlap.centroid.coords[0])
                                self.gaps.append((gap_row(centroid), overlap.area))
                            corners = list(overlap.exterior.coords)[:-1]
                            self.crossings.extend((gap_row(p), overlap.area/len(corners)) for p in corners)


def solve(prepared, rigidity=3.):
    t0 = time.monotonic()
    p = prepared.p
    nv = len(p)
    if not prepared.gaps:
        return np.zeros_like(p), {'status': 'no-stacks', 'seconds': 0., 'target_gap': 0.}
    base = 3*nv + 6*len(prepared.groups)
    n = base + len(prepared.crossings)
    objectives, targets, equalities, upper, bounds = [], [], [], [], []
    def objective(row, target, weight):
        if weight > 0:
            root = np.sqrt(weight)
            objectives.append({i: v*root for i, v in row.items()})
            targets.append(target*root)
    def bound(row, limit):
        upper.extend([row, {i: -v for i, v in row.items()}])
        bounds.extend([limit, limit])
    # Fix the global translation and infinitesimal rigid rotation, not a face.
    for axis in range(3):
        equalities.append({3*v+axis: 1/nv for v in range(nv)})
        equalities.append(row_sum((3*v+k, skew(point)[axis, k]/nv)
                                  for v, point in enumerate(p) for k in range(3)))
    target = 0.18 / max(1, prepared.depth-1)
    for row, area in prepared.gaps:
        objective(row, target, area)
    spacing_mass = sum(area for _, area in prepared.gaps)
    crossing_mass = sum(area for _, area in prepared.crossings)
    for j, (row, area) in enumerate(prepared.crossings):
        slack = base+j
        upper.append({**{i: -v for i, v in row.items()}, slack: -1.})
        bounds.append(0.)
        upper.append({slack: -1.})
        bounds.append(0.)
        objective({slack: 1.}, 0., 50*spacing_mass/crossing_mass*area)
    for group, faces in enumerate(prepared.groups):
        vertices = sorted({v for f in faces for v in prepared.faces[f]})
        center = p[vertices].mean(axis=0)
        area = sum(prepared.areas[f] for f in faces)
        edge_counts = {}
        for f in faces:
            ring = prepared.faces[f]
            for a, b in zip(ring, ring[1:]+ring[:1]):
                key = tuple(sorted((a, b)))
                edge_counts[key] = edge_counts.get(key, 0)+1
        perimeter = sum(np.linalg.norm(p[a]-p[b]) for (a, b), count in edge_counts.items() if count == 1)
        width = 2*area/max(perimeter, 1e-9)
        at = 3*nv + 6*group
        for vertex in vertices:
            cross = skew(p[vertex]-center)
            for axis in range(3):
                # d - t - omega cross r = d - t + [r]cross omega.
                row = row_sum([(3*vertex+axis, 1.), (at+axis, -1.)] +
                              [(at+3+k, cross[axis, k]) for k in range(3)])
                objective(row, 0., rigidity*area/len(vertices))
                bound(row, max(0.025*width, 1e-7))
        for axis in range(3):
            objective({at+3+axis: 1.}, 0., 0.002*area)
            bound({at+3+axis: 1.}, 0.35)
    for vertex in range(nv):
        for axis in range(3):
            objective({3*vertex+axis: 1.}, 0., 1e-5)
            bound({3*vertex+axis: 1.}, 0.22)
    for i in range(3*nv, base):
        objective({i: 1.}, 0., 1e-10)
    ls = matrix(objectives, n)
    q = -2*np.asarray(ls.T @ np.array(targets)).ravel()
    P = sparse.triu(2*ls.T @ ls).tocsc()
    A = matrix(equalities+upper, n)
    b = np.r_[np.zeros(len(equalities)), bounds]
    settings = clarabel.DefaultSettings()
    settings.verbose = False
    settings.max_iter = 150
    settings.time_limit = 20.
    settings.tol_gap_abs = settings.tol_gap_rel = settings.tol_feas = 1e-8
    result = clarabel.DefaultSolver(P, q, A, b,
        [clarabel.ZeroConeT(len(equalities)), clarabel.NonnegativeConeT(len(upper))], settings).solve()
    if str(result.status) not in ['Solved', 'AlmostSolved']:
        raise ValueError(f'QP did not converge: {result.status}')
    x = np.array(result.x)
    violation = max(float(np.abs(A[:len(equalities)] @ x).max(initial=0)),
                    float((A[len(equalities):] @ x-b[len(equalities):]).max(initial=0)))
    if not np.all(np.isfinite(x)) or violation > 2e-6:
        raise ValueError(f'QP candidate failed residual check: {violation}')
    return x[:3*nv].reshape(-1, 3), {
        'status': str(result.status), 'seconds': time.monotonic()-t0,
        'target_gap': target, 'variables': n, 'constraints': len(b),
        'constraint_residual': violation, 'rigidity': rigidity,
    }


def metrics(prepared, displacement, amount):
    p, d = prepared.p, displacement*amount
    deformed = p+d
    lengths = np.array([np.linalg.norm(p[b]-p[a]) for a, b in prepared.edges])
    new_lengths = np.array([np.linalg.norm(deformed[b]-deformed[a]) for a, b in prepared.edges])
    strain = np.abs(new_lengths/lengths-1)
    warp = 0.
    for faces in prepared.groups:
        vertices = sorted({v for f in faces for v in prepared.faces[f]})
        points = deformed[vertices]
        centered = points-points.mean(axis=0)
        _, _, vh = np.linalg.svd(centered, full_matrices=False)
        warp = max(warp, float(np.abs(centered @ vh[-1]).max()))
    flat = d.ravel()
    gaps = [(sum(flat[i]*v for i, v in row.items()), weight) for row, weight in prepared.gaps]
    crossings = [(max(0., -sum(flat[i]*v for i, v in row.items())), weight) for row, weight in prepared.crossings]
    baseline_triangles = p[prepared.triangles]
    triangles = deformed[prepared.triangles]
    normals = np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0])
    rest_normals = np.cross(baseline_triangles[:, 1]-baseline_triangles[:, 0], baseline_triangles[:, 2]-baseline_triangles[:, 0])
    return {
        'amount': amount,
        'max_displacement_percent': float(np.linalg.norm(d, axis=1).max()*50),
        'mean_gap_percent': float(sum(g*w for g, w in gaps)/max(sum(w for _, w in gaps), 1e-30)*50),
        'max_order_violation_percent': float(max((g for g, _ in crossings), default=0)*50),
        'rms_order_violation_percent': float(np.sqrt(sum(g*g*w for g, w in crossings)/max(sum(w for _, w in crossings), 1e-30))*50),
        'max_edge_strain_percent': float(strain.max()*100),
        'p95_edge_strain_percent': float(np.percentile(strain, 95)*100),
        'max_face_warp_percent': float(warp*50),
        'reversed_triangles': int(np.sum(np.sum(normals*rest_normals, axis=1) <= 0)),
    }
