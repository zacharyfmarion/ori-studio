//! Cluster + merge decoded vertices, ported from
//! `mergeDecodedVertexRefinerVertices(WithDebug)` and its helpers.
//!
//! Only the `merged_vertices` output is reproduced (the TS debug payload is not
//! consumed by the decode/benchmark). Greedy clustering, optional same-crop
//! conflict splitting, support-fraction filtering, and the final ordering all
//! match the TS.

use super::{
    DecodedVertex, Proposal, Side, VertexRefinerParams, clamp01, cmp_f64, crop_origin_for_center,
    vertex_kind_name,
};

/// A merged vertex (mirrors `VertexRefinerMergedVertex`). `kind`/
/// `boundary_side_id` are derived from `kind_id`/`boundary_side`.
#[derive(Debug, Clone, PartialEq)]
pub struct MergedVertex {
    pub x: f64,
    pub y: f64,
    pub score: f64,
    pub kind_id: usize,
    pub degree_class: usize,
    pub degree: usize,
    pub ray_bins: Vec<usize>,
    pub boundary_side: Option<Side>,
    pub side_coordinate: Option<f64>,
    pub support_count: usize,
    pub possible_support_count: usize,
    pub support_fraction: f64,
    pub mean_member_distance_px: f64,
    pub max_member_distance_px: f64,
}

/// `mergeDecodedVertexRefinerVertices(rawVertices, proposals, options)`.
pub fn merge_decoded_vertices(
    raw_vertices: &[DecodedVertex],
    proposals: &[Proposal],
    params: &VertexRefinerParams,
) -> Vec<MergedVertex> {
    let crop_size = params.crop_size;
    let radius_px = params.merge_radius_px;
    let boundary_radius_px = params.boundary_merge_radius_px;

    // Greedy clustering over entries sorted by score desc, y asc, x asc.
    let mut sorted: Vec<&DecodedVertex> = raw_vertices.iter().collect();
    sorted.sort_by(|a, b| {
        cmp_f64(b.score, a.score)
            .then(cmp_f64(a.y, b.y))
            .then(cmp_f64(a.x, b.x))
    });
    let mut clusters: Vec<Vec<DecodedVertex>> = Vec::new();
    for entry in sorted {
        let mut match_index: i64 = -1;
        let mut best_distance = if is_boundary_vertex(entry) {
            boundary_radius_px
        } else {
            radius_px
        };
        for (index, cluster) in clusters.iter().enumerate() {
            let distance = cluster_distance(entry, cluster, false);
            if distance <= best_distance {
                best_distance = distance;
                match_index = index as i64;
            }
        }
        if match_index < 0 {
            clusters.push(vec![entry.clone()]);
        } else {
            clusters[match_index as usize].push(entry.clone());
        }
    }

    // Split, merge, filter.
    let mut retained: Vec<MergedVertex> = Vec::new();
    for cluster in clusters {
        for (sub, from_split) in split_same_crop_conflict_entries(
            cluster,
            params.split_same_crop_conflicts,
            radius_px,
            boundary_radius_px,
        ) {
            if (sub.len() as f64) < params.min_support {
                continue;
            }
            let vertex = merge_vertex_cluster(&sub, proposals, crop_size);
            if vertex.support_fraction < params.min_support_fraction {
                continue;
            }
            if from_split && vertex.support_fraction < params.split_min_support_fraction {
                continue;
            }
            retained.push(vertex);
        }
    }

    retained.sort_by(|a, b| {
        b.support_count
            .cmp(&a.support_count)
            .then(cmp_f64(b.score, a.score))
            .then(cmp_f64(a.y, b.y))
            .then(cmp_f64(a.x, b.x))
    });
    retained
}

/// `isBoundaryVertex`.
fn is_boundary_vertex(vertex: &DecodedVertex) -> bool {
    vertex_kind_name(vertex.kind_id) == "boundary_contact" && vertex.boundary_side.is_some()
}

/// `hasSameCropConflict`.
fn has_same_crop_conflict(cluster: &[DecodedVertex]) -> bool {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    for vertex in cluster {
        if !seen.insert(vertex.crop_index) {
            return true;
        }
    }
    false
}

/// `splitSameCropConflictClusterEntries`.
fn split_same_crop_conflict_entries(
    cluster: Vec<DecodedVertex>,
    split: bool,
    radius_px: f64,
    boundary_radius_px: f64,
) -> Vec<(Vec<DecodedVertex>, bool)> {
    if !split || !has_same_crop_conflict(&cluster) {
        return vec![(cluster, false)];
    }
    let mut sorted = cluster;
    sorted.sort_by(|a, b| {
        cmp_f64(b.score, a.score)
            .then(cmp_f64(a.y, b.y))
            .then(cmp_f64(a.x, b.x))
    });
    let mut subclusters: Vec<Vec<DecodedVertex>> = Vec::new();
    for entry in sorted {
        let mut match_index: i64 = -1;
        let mut best_distance = if is_boundary_vertex(&entry) {
            boundary_radius_px
        } else {
            radius_px
        };
        for (index, sub) in subclusters.iter().enumerate() {
            let distance = cluster_distance(&entry, sub, true);
            if distance <= best_distance {
                best_distance = distance;
                match_index = index as i64;
            }
        }
        if match_index < 0 {
            subclusters.push(vec![entry]);
        } else {
            subclusters[match_index as usize].push(entry);
        }
    }
    subclusters.into_iter().map(|sub| (sub, true)).collect()
}

/// `clusterDistance` (boundary-aware: same-side 1-D, cross-side infinite/Euclidean).
fn cluster_distance(
    vertex: &DecodedVertex,
    cluster: &[DecodedVertex],
    prevent_same_crop: bool,
) -> f64 {
    if prevent_same_crop
        && cluster
            .iter()
            .any(|member| member.crop_index == vertex.crop_index)
    {
        return f64::INFINITY;
    }
    let (center_x, center_y) = weighted_center(cluster);
    let cluster_side = cluster
        .iter()
        .find(|member| is_boundary_vertex(member))
        .and_then(|member| member.boundary_side);
    let vertex_is_boundary = is_boundary_vertex(vertex);
    if vertex_is_boundary || cluster_side.is_some() {
        if !vertex_is_boundary || cluster_side.is_none() || vertex.boundary_side != cluster_side {
            if vertex_is_boundary && cluster_side.is_some() && vertex.boundary_side != cluster_side
            {
                return (vertex.x - center_x).hypot(vertex.y - center_y);
            }
            return f64::INFINITY;
        }
        return match vertex.boundary_side {
            Some(Side::Top) | Some(Side::Bottom) => (vertex.x - center_x).abs(),
            _ => (vertex.y - center_y).abs(),
        };
    }
    (vertex.x - center_x).hypot(vertex.y - center_y)
}

/// `mergeVertexCluster`.
fn merge_vertex_cluster(
    cluster: &[DecodedVertex],
    proposals: &[Proposal],
    crop_size: f64,
) -> MergedVertex {
    let (x, y) = weighted_center(cluster);
    let distances: Vec<f64> = cluster
        .iter()
        .map(|vertex| (vertex.x - x).hypot(vertex.y - y))
        .collect();
    let boundary_side = weighted_side_mode(cluster);
    let side_coordinate = boundary_side.map(|side| weighted_side_coordinate(cluster, side));
    let kind_id = if boundary_side.is_none() {
        weighted_mode(
            cluster
                .iter()
                .map(|vertex| (vertex.kind_id as i64, vertex.score)),
        )
    } else {
        2
    };
    let possible_support = proposals
        .iter()
        .filter(|proposal| proposal_contains_point(proposal, x, y, crop_size))
        .count();
    let score = cluster
        .iter()
        .map(|vertex| vertex.score)
        .fold(f64::NEG_INFINITY, f64::max);
    let degree_class = weighted_mode(
        cluster
            .iter()
            .map(|vertex| (vertex.degree_class as i64, vertex.score)),
    );
    let degree = weighted_mode(
        cluster
            .iter()
            .map(|vertex| (vertex.degree as i64, vertex.score)),
    );
    let ray_bins = ray_vote(cluster, 0.35);
    let mean = distances.iter().sum::<f64>() / (distances.len().max(1) as f64);
    let max_distance = distances.iter().fold(0.0f64, |acc, &d| acc.max(d));
    MergedVertex {
        x,
        y,
        score,
        kind_id: kind_id as usize,
        degree_class: degree_class as usize,
        degree: degree as usize,
        ray_bins,
        boundary_side,
        side_coordinate,
        support_count: cluster.len(),
        possible_support_count: possible_support,
        support_fraction: (cluster.len() as f64 / (possible_support.max(1) as f64)).min(1.0),
        mean_member_distance_px: mean,
        max_member_distance_px: max_distance,
    }
}

/// `weightedCenter`.
fn weighted_center(cluster: &[DecodedVertex]) -> (f64, f64) {
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let mut sum_w = 0.0;
    for vertex in cluster {
        let weight = vertex.score.max(1e-4);
        sum_x += vertex.x * weight;
        sum_y += vertex.y * weight;
        sum_w += weight;
    }
    (sum_x / sum_w.max(1e-4), sum_y / sum_w.max(1e-4))
}

/// `weightedMode`: vote by score (floored at 1e-4); tie-break smaller key.
fn weighted_mode(items: impl Iterator<Item = (i64, f64)>) -> i64 {
    use std::collections::HashMap;
    let mut votes: HashMap<i64, f64> = HashMap::new();
    for (key, score) in items {
        *votes.entry(key).or_insert(0.0) += score.max(1e-4);
    }
    let mut entries: Vec<(i64, f64)> = votes.into_iter().collect();
    entries.sort_by(|a, b| cmp_f64(b.1, a.1).then(a.0.cmp(&b.0)));
    entries.first().map(|entry| entry.0).unwrap_or(0)
}

/// `weightedSideMode`: tie-break by side name (localeCompare ~ ascii order).
fn weighted_side_mode(cluster: &[DecodedVertex]) -> Option<Side> {
    use std::collections::HashMap;
    let mut votes: HashMap<usize, f64> = HashMap::new();
    for vertex in cluster {
        if let Some(side) = vertex.boundary_side {
            *votes.entry(side.index()).or_insert(0.0) += vertex.score.max(1e-4);
        }
    }
    if votes.is_empty() {
        return None;
    }
    let mut entries: Vec<(usize, f64)> = votes.into_iter().collect();
    entries
        .sort_by(|a, b| cmp_f64(b.1, a.1).then(Side::ALL[a.0].name().cmp(Side::ALL[b.0].name())));
    entries.first().map(|entry| Side::ALL[entry.0])
}

/// `weightedSideCoordinate`.
fn weighted_side_coordinate(cluster: &[DecodedVertex], side: Side) -> f64 {
    let mut sum = 0.0;
    let mut weight_sum = 0.0;
    for vertex in cluster {
        if vertex.boundary_side != Some(side) {
            continue;
        }
        let Some(side_coordinate) = vertex.side_coordinate else {
            continue;
        };
        let weight = vertex.score.max(1e-4);
        sum += side_coordinate * weight;
        weight_sum += weight;
    }
    clamp01(sum / weight_sum.max(1e-4))
}

/// `rayVote`: bins present in `>= ceil(voteFraction * len)` members.
fn ray_vote(cluster: &[DecodedVertex], vote_fraction: f64) -> Vec<usize> {
    use std::collections::HashMap;
    let mut votes: HashMap<usize, usize> = HashMap::new();
    for vertex in cluster {
        for &bin in &vertex.ray_bins {
            *votes.entry(bin).or_insert(0) += 1;
        }
    }
    let required = ((vote_fraction * cluster.len() as f64).ceil() as i64).max(1) as usize;
    let mut bins: Vec<usize> = votes
        .into_iter()
        .filter(|&(_, count)| count >= required)
        .map(|(bin, _)| bin)
        .collect();
    bins.sort_unstable();
    bins
}

/// `proposalContainsPoint`.
fn proposal_contains_point(proposal: &Proposal, x: f64, y: f64, crop_size: f64) -> bool {
    let (origin_x, origin_y) = crop_origin_for_center(proposal.x, proposal.y, crop_size);
    x >= origin_x && x < origin_x + crop_size && y >= origin_y && y < origin_y + crop_size
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vertex(x: f64, y: f64, score: f64, crop_index: usize) -> DecodedVertex {
        DecodedVertex {
            x,
            y,
            score,
            kind_id: 1,
            degree_class: 3,
            degree: 3,
            ray_bins: vec![],
            boundary_side: None,
            side_coordinate: None,
            crop_index,
        }
    }

    #[test]
    fn weighted_mode_breaks_ties_toward_smaller_key() {
        // Equal weights for keys 3 and 5 -> smaller key (3) wins.
        let mode = weighted_mode([(5i64, 1.0), (3i64, 1.0)].into_iter());
        assert_eq!(mode, 3);
        // Higher total weight wins regardless of key.
        let mode = weighted_mode([(5i64, 2.0), (3i64, 1.0)].into_iter());
        assert_eq!(mode, 5);
    }

    #[test]
    fn nearby_vertices_merge_distant_ones_stay_split() {
        let proposals = vec![
            Proposal {
                x: 10.0,
                y: 10.0,
                score: 1.0,
                provenance: vec![],
            },
            Proposal {
                x: 80.0,
                y: 80.0,
                score: 1.0,
                provenance: vec![],
            },
        ];
        let raw = vec![
            vertex(10.0, 10.0, 0.9, 0),
            vertex(11.0, 10.5, 0.8, 1),
            vertex(80.0, 80.0, 0.95, 1),
        ];
        let params = VertexRefinerParams {
            crop_size: 96.0,
            min_support_fraction: 0.0,
            ..Default::default()
        };
        let merged = merge_decoded_vertices(&raw, &proposals, &params);
        // Two close vertices collapse; the far one stays separate -> 2 merged.
        assert_eq!(merged.len(), 2);
        let first = &merged[0];
        assert_eq!(first.support_count, 2);
        // Weighted center lies between the two close members.
        assert!(first.x > 10.0 && first.x < 11.0);
    }
}
