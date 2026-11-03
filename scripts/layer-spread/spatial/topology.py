"""Material-preserving triangulation and an independent crossing diagnostic."""
import mapbox_earcut
import numpy as np


def triangulate(points):
    """Mirror triangulateSpreadFace.ts: restore omitted crease vertices, repair ears."""
    points = np.asarray(points, dtype=np.float64)
    triangles = mapbox_earcut.triangulate_float64(points, np.array([len(points)], dtype=np.uint32)).reshape(-1, 3).tolist()
    if not triangles:
        raise ValueError('Could not triangulate a material face')
    used = {v for triangle in triangles for v in triangle}
    for i in range(len(points)):
        if i not in used:
            continue
        chain = [i]
        j = (i+1) % len(points)
        while j not in used:
            chain.append(j)
            j = (j+1) % len(points)
        if len(chain) == 1:
            continue
        chain.append(j)
        a, b = chain[0], chain[-1]
        index = next((k for k, t in enumerate(triangles) if a in t and b in t), None)
        if index is None:
            raise ValueError('Cannot restore a material boundary')
        tri = triangles[index]
        if tri[(tri.index(a)+1) % 3] != b:
            chain.reverse()
        opposite = next(v for v in tri if v not in [a, b])
        split = [[u, v, opposite] for u, v in zip(chain, chain[1:])]
        triangles[index] = split[0]
        triangles.extend(split[1:])
    def quality(tri):
        a, b, c = points[tri]
        ab, ac = b-a, c-a
        return (ab[0]*ac[1]-ab[1]*ac[0])/max(float(np.dot(ab, ab)), float(np.dot(ac, ac)), float(np.dot(c-b, c-b)), 1e-30)
    for _ in range(3*len(triangles)):
        repaired = False
        for i, tri in enumerate(triangles):
            if quality(tri) > 1e-8:
                continue
            k = max(range(3), key=lambda k: np.linalg.norm(points[tri[k]]-points[tri[(k+1) % 3]]))
            u, v, middle = tri[k], tri[(k+1) % 3], tri[(k+2) % 3]
            j = next((j for j, t in enumerate(triangles) if j != i and u in t and v in t), None)
            if j is None:
                continue
            opposite = next(x for x in triangles[j] if x not in [u, v])
            a, b = [v, middle, opposite], [middle, u, opposite]
            if min(quality(a), quality(b)) > max(1e-8, min(quality(tri), quality(triangles[j]))):
                triangles[i], triangles[j] = a, b
                repaired = True
        if not repaired:
            break
    # Stronger than shared vertex IDs alone: every subedge must exist on both
    # incident faces, even where its middle vertex was originally collinear.
    edges = {}
    for tri in triangles:
        for a, b in zip(tri, tri[1:]+tri[:1]):
            key = tuple(sorted((a, b)))
            edges[key] = edges.get(key, 0)+1
    boundary = {tuple(sorted((i, (i+1) % len(points)))) for i in range(len(points))}
    if any(edges.get(key) != 1 for key in boundary) or any(count != (1 if key in boundary else 2) for key, count in edges.items()):
        raise ValueError('Triangulation changed a material boundary')
    return np.array(triangles, dtype=int)


def transverse_crossings(positions, triangles, triangle_faces, epsilon=1e-7):
    """Count face pairs with detected proper transverse triangle intersections.

    Intentional coplanar contacts and boundary-only contacts are excluded. This
    finite-tolerance diagnostic does not certify absence of all intersections.
    """
    t = positions[triangles]
    lo, hi = t.min(axis=1), t.max(axis=1)
    normals = np.cross(t[:, 1]-t[:, 0], t[:, 2]-t[:, 0])
    lengths = np.linalg.norm(normals, axis=1)
    normals = normals / np.maximum(lengths[:, None], 1e-30)
    pairs = set()
    def interval(points, distances, direction):
        sliced = []
        for k in range(3):
            j = (k+1) % 3
            if abs(distances[k]) <= epsilon:
                sliced.append(points[k])
            if distances[k]*distances[j] < 0:
                s = distances[k]/(distances[k]-distances[j])
                sliced.append(points[k]+s*(points[j]-points[k]))
        if len(sliced) < 2:
            return None
        values = np.array(sliced) @ direction
        return values.min(), values.max()
    for i in range(len(t)):
        if lengths[i] < 1e-12:
            continue
        candidates = np.flatnonzero(np.all(lo < hi[i]+epsilon, axis=1) & np.all(hi > lo[i]-epsilon, axis=1))
        for j in candidates:
            if j <= i or triangle_faces[i] == triangle_faces[j] or lengths[j] < 1e-12:
                continue
            pair = tuple(sorted((triangle_faces[i], triangle_faces[j])))
            if pair in pairs or len(set(triangles[i]) & set(triangles[j])) >= 2:
                continue
            a = (t[i]-t[j, 0]) @ normals[j]
            b = (t[j]-t[i, 0]) @ normals[i]
            if not (a.min() < -epsilon and a.max() > epsilon and b.min() < -epsilon and b.max() > epsilon):
                continue
            line = np.cross(normals[i], normals[j])
            length = np.linalg.norm(line)
            if length < epsilon:
                continue
            line /= length
            ia, ib = interval(t[i], a, line), interval(t[j], b, line)
            if ia is not None and ib is not None and min(ia[1], ib[1])-max(ia[0], ib[0]) > epsilon:
                pairs.add(pair)
    return sorted(pairs)
