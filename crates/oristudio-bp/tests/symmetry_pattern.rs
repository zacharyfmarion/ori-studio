//! Does a mirror-symmetric *layout* produce a mirror-symmetric *crease pattern*?
//!
//! This matters because the optimizer's symmetry option is only worth having if
//! symmetry survives into the pattern. The pattern search normalizes a stretch's
//! orientation through `Repository.$f`, which in BP Studio is an `ISignPoint` —
//! sign flips only, no x/y transpose — so it was not obvious that a *diagonal*
//! mirror would survive.
//!
//! It does, but the two axes get there differently:
//!
//! - **Book mirror.** The sign-flip canonicalization absorbs the mirror
//!   entirely, so two mirror-image stretches produce byte-identical pattern
//!   geometry. Only the flap ids and quadrant labels differ.
//! - **Diagonal mirror.** The canonicalization does *not* absorb a transpose, so
//!   the two stretches produce genuinely transposed pattern geometry — with
//!   detour paths traversed in the opposite order, as a reflection should. That
//!   is still a mirror-image crease pattern, reached by a different route.
//!
//! In both cases the two stretches select the same configuration and pattern
//! index, which is the part that could have gone wrong: selection is "index 0 of
//! whatever the generator produced", so a generator whose ordering depended on
//! orientation would have picked structurally different patterns for the two
//! halves of a symmetric model.
//!
//! Coverage limit worth knowing: both fixtures produce a single configuration
//! with two candidate patterns, so these exercise the *pattern* choice but not a
//! choice between several configurations. A fixture with competing
//! configurations would test the selection ordering harder.

use oristudio_bp::engine::BpProjectSession;
use oristudio_bp::layout::active_layout_repositories;
use oristudio_bp::model::{
    AddOn, Anchor, Configuration, DesignMode, Device, Edge, Flap, Gadget, GridType, Overlap,
    Pattern, Piece, Point, Project, Repository, Vertex,
};
use oristudio_bp::tree::BpTree;

// ---------------------------------------------------------------- transforms

/// Erase the labels a mirror is *expected* to change — the flap a corner belongs
/// to, and which quadrant of it — so the comparison is about pattern shape.
fn strip_labels(repo: &mut Repository) {
    for configuration in &mut repo.configurations {
        for partition in &mut configuration.partitions {
            for overlap in &mut partition.overlaps {
                for corner in &mut overlap.c {
                    corner.e = None;
                    corner.q = None;
                }
            }
        }
    }
}

fn transpose_point(point: &Point) -> Point {
    Point {
        x: point.y,
        y: point.x,
    }
}

fn transpose_piece(piece: &Piece) -> Piece {
    Piece {
        ox: piece.oy,
        oy: piece.ox,
        u: piece.v,
        v: piece.u,
        // A reflection reverses traversal order, so a mirrored detour runs the
        // other way round.
        detours: piece.detours.as_ref().map(|detours| {
            detours
                .iter()
                .map(|path| path.iter().rev().map(transpose_point).collect())
                .collect()
        }),
        shift: piece.shift.as_ref().map(transpose_point),
    }
}

fn transpose_gadget(gadget: &Gadget) -> Gadget {
    Gadget {
        pieces: gadget.pieces.iter().map(transpose_piece).collect(),
        offset: gadget.offset.as_ref().map(transpose_point),
        anchors: gadget.anchors.as_ref().map(|anchors| {
            anchors
                .iter()
                .map(|anchor| {
                    anchor.as_ref().map(|anchor| Anchor {
                        slack: anchor.slack,
                        location: anchor.location.as_ref().map(transpose_point),
                    })
                })
                .collect()
        }),
    }
}

fn transpose_device(device: &Device) -> Device {
    Device {
        gadgets: device.gadgets.iter().map(transpose_gadget).collect(),
        offset: device.offset,
        add_ons: device.add_ons.as_ref().map(|add_ons| {
            add_ons
                .iter()
                .map(|add_on| AddOn {
                    contour: add_on.contour.iter().rev().map(transpose_point).collect(),
                    dir: transpose_point(&add_on.dir),
                })
                .collect()
        }),
    }
}

fn transpose_overlap(overlap: &Overlap) -> Overlap {
    Overlap {
        c: overlap.c.clone(),
        ox: overlap.oy,
        oy: overlap.ox,
        id: overlap.id,
        parent: overlap.parent,
        shift: overlap.shift.as_ref().map(transpose_point),
    }
}

/// Reflect a repository about the line `y = x`.
///
/// The structure signature is not geometry this can reflect; callers compare
/// signature-free repositories (see `mirrored_stretch_pair`).
fn transpose_repository(repo: &Repository) -> Repository {
    Repository {
        index: repo.index,
        signature: None,
        configurations: repo
            .configurations
            .iter()
            .map(|configuration| Configuration {
                partitions: configuration
                    .partitions
                    .iter()
                    .map(|partition| oristudio_bp::model::Partition {
                        overlaps: partition.overlaps.iter().map(transpose_overlap).collect(),
                        strategy: partition.strategy,
                    })
                    .collect(),
                raw: configuration.raw,
                patterns: configuration.patterns.as_ref().map(|patterns| {
                    patterns
                        .iter()
                        .map(|pattern| Pattern {
                            devices: pattern.devices.iter().map(transpose_device).collect(),
                        })
                        .collect()
                }),
                index: configuration.index,
            })
            .collect(),
    }
}

/// Build a layout project from explicit edges and flaps on a square sheet.
fn project(size: f64, edges: Vec<Edge>, flaps: Vec<Flap>) -> Project {
    let mut project = Project::sample();
    project.design.mode = DesignMode::Layout;
    project.design.tree.sheet.grid_type = GridType::Rectangular;
    project.design.tree.sheet.width = size;
    project.design.tree.sheet.height = size;
    project.design.layout.sheet.grid_type = GridType::Rectangular;
    project.design.layout.sheet.width = size;
    project.design.layout.sheet.height = size;
    project.design.layout.stretches = Vec::new();

    // Tree vertices only need to exist; their design-view positions do not
    // affect the layout-side pattern search.
    let mut ids = vec![0];
    for edge in &edges {
        for id in [edge.n1, edge.n2] {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    project.design.tree.nodes = ids
        .iter()
        .map(|&id| Vertex {
            id,
            x: 1.0 + f64::from(id),
            y: 1.0 + f64::from(id),
            name: format!("n{id}"),
            is_new: None,
        })
        .collect();
    project.design.tree.edges = edges;
    project.design.layout.flaps = flaps;
    project
}

fn flap(id: u32, x: f64, y: f64) -> Flap {
    Flap {
        id,
        x,
        y,
        width: 0.0,
        height: 0.0,
    }
}

fn edge(n2: u32, length: f64) -> Edge {
    Edge { n1: 0, n2, length }
}

/// Complete every active stretch and return the resulting repositories, keyed by
/// stretch id.
fn completed_repositories(project: Project) -> Vec<(String, Repository)> {
    let tree = BpTree::new(&project.design.tree.edges, &project.design.layout.flaps).unwrap();
    let stretch_ids = active_layout_repositories(&tree, &project.design.layout.stretches)
        .unwrap()
        .into_iter()
        .map(|repository| repository.stretch_id)
        .collect::<Vec<_>>();

    let mut session = BpProjectSession::new(project).unwrap();
    for id in &stretch_ids {
        session.complete_stretch(id).unwrap();
    }
    stretch_ids
        .into_iter()
        .map(|id| {
            let repo = session
                .project()
                .design
                .layout
                .stretches
                .iter()
                .find(|stretch| stretch.id == id)
                .and_then(|stretch| stretch.repo.clone())
                .unwrap_or_else(|| panic!("stretch {id} has no repository"));
            (id, repo)
        })
        .collect()
}

/// Two stretches that are mirror images of each other must resolve to patterns
/// that are mirror images, otherwise the two halves of a symmetric model get
/// structurally different creases.
fn mirrored_stretch_pair(
    label: &str,
    project: Project,
) -> (String, Repository, String, Repository) {
    let repositories = completed_repositories(project);
    assert_eq!(
        repositories.len(),
        2,
        "{label}: expected exactly two mirror-image stretches, got {:?}",
        repositories.iter().map(|(id, _)| id).collect::<Vec<_>>()
    );
    let mut iter = repositories.into_iter();
    let (first_id, mut first) = iter.next().unwrap();
    let (second_id, mut second) = iter.next().unwrap();

    // The selected configuration and pattern must match: selection is "index 0
    // of whatever the generator produced", so a generator whose ordering
    // depended on orientation would diverge here.
    assert_eq!(
        first.index, second.index,
        "{label}: stretches {first_id} and {second_id} selected different configurations"
    );
    let indices = |repo: &Repository| {
        repo.configurations
            .iter()
            .map(|configuration| configuration.index)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        indices(&first),
        indices(&second),
        "{label}: stretches {first_id} and {second_id} selected different patterns"
    );

    strip_labels(&mut first);
    strip_labels(&mut second);
    // These tests compare pattern *geometry*. The structure signature identifies
    // the junctions a repository was generated for, so mirror images necessarily
    // carry different ones — it is not geometry, and comparing it would only
    // assert that the two stretches are distinct, which they are by construction.
    first.signature = None;
    second.signature = None;
    (first_id, first, second_id, second)
}

/// Book (vertical) mirror about x = 20 on a 40x40 sheet.
///
/// Flaps 1,2 form a junction on the left; their mirrors 3,4 form the mirrored
/// junction on the right. Flap separations were chosen so exactly those two
/// junctions form: each has both components below the tree distance with the
/// squared distance above it, and every other pair is too far apart.
fn book_symmetric_project() -> Project {
    project(
        40.0,
        vec![edge(1, 8.0), edge(2, 6.0), edge(3, 8.0), edge(4, 6.0)],
        vec![
            flap(1, 0.0, 0.0),
            flap(2, 13.0, 9.0),
            flap(3, 40.0, 0.0),
            flap(4, 27.0, 9.0),
        ],
    )
}

/// Diagonal mirror about y = x on a 32x32 sheet.
///
/// Flap 1 sits on the axis; flaps 2 and 3 are mirror images across it, each
/// forming a junction with flap 1.
fn diagonal_symmetric_project() -> Project {
    project(
        32.0,
        vec![edge(1, 10.0), edge(2, 5.0), edge(3, 5.0)],
        vec![flap(1, 10.0, 10.0), flap(2, 24.0, 2.0), flap(3, 2.0, 24.0)],
    )
}

#[test]
fn book_mirrored_stretches_resolve_to_the_same_pattern() {
    let (first_id, first, second_id, second) =
        mirrored_stretch_pair("book", book_symmetric_project());
    // The sign-flip canonicalization absorbs a book mirror completely, so the
    // pattern geometry comes out identical, not merely congruent.
    assert_eq!(
        first, second,
        "book: stretches {first_id} and {second_id} produced different pattern geometry"
    );
}

#[test]
fn diagonal_mirrored_stretches_resolve_to_the_same_pattern() {
    let (first_id, first, second_id, second) =
        mirrored_stretch_pair("diagonal", diagonal_symmetric_project());
    // A transpose is not absorbed by the sign-flip canonicalization, so the two
    // stretches carry genuinely transposed geometry — which is still a mirror
    // image, and is what makes diagonal symmetry usable.
    assert_ne!(
        first, second,
        "diagonal: expected the two stretches to carry transposed geometry; if they \
         are now identical the canonicalization changed and this test is stale"
    );
    assert_eq!(
        first,
        transpose_repository(&second),
        "diagonal: stretches {first_id} and {second_id} are not mirror images of each other"
    );
}
