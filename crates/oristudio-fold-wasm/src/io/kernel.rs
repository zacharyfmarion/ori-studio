//! The CP kernel at the bridge's edge (plan D1, D10): its loaders read a file
//! into its model, D10's inverse maps the model to Import CP's input, and a
//! step's `cpJson` is the model as the kernel's FOLD writer writes it.
//!
//! D10's inverse, segment by segment:
//!
//! | Kernel | Import CP |
//! |---|---|
//! | `Black0` | border |
//! | `Red1`, `Blue2` | M, V |
//! | `None` with the direction hint X | a precrease remembering X |
//! | `None` without a hint | folded, its letter decided by the completion |
//! | `Cyan3` / F | flat crease mark, including partial lines |
//! | every other colour, and the model's aux lines | a guide, never a crease |
//!
//! A crease folded part-way (`fold_magnitude`) is read by its colour, as
//! Edit's flat fold reads it: Fold's states are flat. Circles, points and
//! texts are not part of a crease pattern Fold can fold.

use oristudio_cp::geometry::{FoldDirection, LineColor, LineSegment};
use oristudio_cp::io::IoError;
use oristudio_cp::io::cp::import_cp_str;
use oristudio_cp::io::fold::{
    export_fold_document, import_fold_document, import_fold_file_document_json,
};
use oristudio_cp::io::orh::import_orh_bytes;
use oristudio_cp::io::ori::import_ori_json;
use oristudio_cp::model::CreasePatternModel;
use oristudio_fold::{
    CreasePatternInput, ImportKind, ImportRefusal, ImportSegment, ImportSpace, Letter,
};
use treemaker_fold::FoldDocument;

use super::wire::{CpFormat, IoRefusal, StoredField};

/// The kernel's FOLD key for an unassigned crease's remembered direction
/// (`oristudio_cp::io::fold`'s `ORISTUDIO_EDGES_FOLD_DIRECTION_HINT`): the
/// one extension a `cpJson` keeps.
const DIRECTION_HINT_KEY: &str = "oristudio:edges_fold_direction_hint";

/// `file_creator` of a `cpJson`.
const CP_JSON_CREATOR: &str = "Ori Studio (Fold)";

/// A file's crease pattern through the kernel's loader for its format. Text
/// formats are read as UTF-8 (a leading byte-order mark is skipped); `.orh`
/// tries Oriedita's charsets in Oriedita's order. A `.fold` file opens to
/// the frame Edit opens it to.
pub fn load(format: CpFormat, bytes: &[u8]) -> Result<CreasePatternModel, IoRefusal> {
    let unreadable = || IoRefusal::Unreadable { format };
    let text = || {
        std::str::from_utf8(bytes)
            .map(|text| text.strip_prefix('\u{feff}').unwrap_or(text))
            .map_err(|_| unreadable())
    };
    let loaded = match format {
        CpFormat::Cp => import_cp_str(text()?),
        CpFormat::Fold => import_fold_file_document_json(text()?).map(|d| d.crease_pattern),
        CpFormat::Ori => import_ori_json(text()?).map(|d| d.crease_pattern),
        CpFormat::Orh => import_orh_bytes(bytes).map(|d| d.crease_pattern),
    };
    loaded.map_err(|error| match error {
        IoError::FoldedForm { .. } => IoRefusal::FoldedForm,
        _ => unreadable(),
    })
}

/// D10's inverse: the model's segments as Import CP's input, in the kernel's
/// y-down model space (see the module docs).
pub fn input_of_model(model: &CreasePatternModel) -> CreasePatternInput {
    let segment = |s: &LineSegment, kind: ImportKind| ImportSegment {
        from: [s.a.x, s.a.y],
        to: [s.b.x, s.b.y],
        kind,
    };
    let segments = model
        .line_segments
        .iter()
        .map(|s| segment(s, kind_of(s)))
        .chain(
            model
                .aux_line_segments
                .iter()
                .map(|s| segment(s, ImportKind::Aux)),
        )
        .collect();
    CreasePatternInput {
        space: ImportSpace::Model,
        segments,
    }
}

fn kind_of(segment: &LineSegment) -> ImportKind {
    match segment.color {
        LineColor::Black0 => ImportKind::Border,
        LineColor::Red1 => ImportKind::Mountain,
        LineColor::Blue2 => ImportKind::Valley,
        // Cyan/F carries no remembered M/V direction. Use Valley as the
        // memory convention; a later M/V action supplies its own direction.
        LineColor::Cyan3 => ImportKind::CreaseMark {
            letter: Letter::Valley,
        },
        LineColor::None => ImportKind::Unassigned {
            hint: segment
                .fold_direction_hint
                .map(|direction| match direction {
                    FoldDirection::Mountain => Letter::Mountain,
                    FoldDirection::Valley => Letter::Valley,
                }),
        },
        _ => ImportKind::Aux,
    }
}

/// Whether a segment is part of the folded state a `cpJson` stores: the
/// border and the creases. Guides are reported once, when the pattern is
/// imported, and are not stored with the step.
fn is_crease(segment: &LineSegment) -> bool {
    matches!(
        segment.color,
        LineColor::Black0 | LineColor::Red1 | LineColor::Blue2 | LineColor::Cyan3 | LineColor::None
    )
}

/// The step's `cpJson`: the model's border and creases through the kernel's
/// FOLD writer, compact. What the kernel's FOLD reader would not use for
/// them is left out — faces, fold angles (Fold's states are flat), the
/// colour, grid and version extensions — and the direction hints are kept,
/// so a precrease comes back remembering its letter.
pub fn cp_json(model: &CreasePatternModel) -> Result<String, IoRefusal> {
    let creases = CreasePatternModel {
        line_segments: model
            .line_segments
            .iter()
            .filter(|s| is_crease(s))
            .cloned()
            .collect(),
        ..CreasePatternModel::default()
    };
    let mut fold = export_fold_document(&creases, None);
    fold.edges_fold_angle.clear();
    fold.edges_faces.clear();
    fold.faces_vertices.clear();
    fold.faces_edges.clear();
    fold.extra.retain(|key, _| key == DIRECTION_HINT_KEY);
    fold.file_creator = Some(CP_JSON_CREATOR.to_string());
    serde_json::to_string(&fold).map_err(|error| {
        IoRefusal::Import(ImportRefusal::Internal {
            message: error.to_string(),
        })
    })
}

/// A stored `cpJson` back as the kernel's model, through its FOLD reader.
pub fn model_of_cp_json(cp_json: &str) -> Result<CreasePatternModel, IoRefusal> {
    let unreadable = || IoRefusal::StoredUnreadable {
        field: StoredField::CpJson,
    };
    let fold: FoldDocument = serde_json::from_str(cp_json).map_err(|_| unreadable())?;
    import_fold_document(&fold).map_err(|_| unreadable())
}

/// What an import of a stored `cpJson` reads: the model its FOLD reader
/// gives, through D10's inverse.
pub fn input_of_cp_json(cp_json: &str) -> Result<CreasePatternInput, IoRefusal> {
    model_of_cp_json(cp_json).map(|model| input_of_model(&model))
}

#[cfg(test)]
mod tests {
    use super::*;
    use oristudio_cp::geometry::Point;

    fn segment(a: [f64; 2], b: [f64; 2], color: LineColor) -> LineSegment {
        LineSegment::with_color(Point::new(a[0], a[1]), Point::new(b[0], b[1]), color)
    }

    /// The square with a valley diagonal, a mountain half-diagonal, a
    /// remembered mountain, an unknown crease and two guides.
    fn model() -> CreasePatternModel {
        let mut model = CreasePatternModel::default();
        let c = [
            [-200.0, -200.0],
            [200.0, -200.0],
            [200.0, 200.0],
            [-200.0, 200.0],
        ];
        for i in 0..4 {
            model.add_line_segment(segment(c[i], c[(i + 1) % 4], LineColor::Black0));
        }
        model.add_line_segment(segment(c[0], c[2], LineColor::Blue2));
        model.add_line_segment(segment([0.0, 0.0], c[1], LineColor::Red1));
        model.add_line_segment(segment([0.0, 0.0], c[3], LineColor::Red1).with_direction_kept());
        model.add_line_segment(segment([-200.0, 0.0], [200.0, 0.0], LineColor::None));
        model.add_line_segment(segment([0.0, -200.0], [0.0, 200.0], LineColor::Cyan3));
        model
            .aux_line_segments
            .push(segment(c[0], c[1], LineColor::Cyan3));
        model
    }

    #[test]
    fn colours_map_by_d10s_inverse() {
        let input = input_of_model(&model());
        assert_eq!(input.space, ImportSpace::Model);
        let kinds: Vec<ImportKind> = input.segments.iter().map(|s| s.kind).collect();
        let border = ImportKind::Border;
        assert_eq!(
            kinds,
            [
                border,
                border,
                border,
                border,
                ImportKind::Valley,
                ImportKind::Mountain,
                ImportKind::Unassigned {
                    hint: Some(Letter::Mountain)
                },
                ImportKind::Unassigned { hint: None },
                ImportKind::CreaseMark {
                    letter: Letter::Valley
                },
                ImportKind::Aux,
            ]
        );
    }

    #[test]
    fn a_cp_json_keeps_the_creases_and_their_hints_and_nothing_else() {
        let text = cp_json(&model()).unwrap_or_default();
        let fold: FoldDocument = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}"));
        assert!(fold.faces_vertices.is_empty() && fold.edges_fold_angle.is_empty());
        assert_eq!(
            fold.extra.keys().collect::<Vec<_>>(),
            [DIRECTION_HINT_KEY],
            "{text}"
        );
        assert_eq!(fold.file_creator.as_deref(), Some(CP_JSON_CREATOR));
        assert!(!text.contains('\n'), "compact");

        // Read back: the guides are gone, every crease keeps its kind.
        let back = input_of_cp_json(&text).unwrap_or_else(|e| panic!("{e}"));
        let mut kinds: Vec<String> = back
            .segments
            .iter()
            .map(|s| format!("{:?}", s.kind))
            .collect();
        kinds.sort();
        kinds.dedup();
        assert_eq!(
            kinds,
            [
                "Border",
                "CreaseMark { letter: Valley }",
                "Mountain",
                "Unassigned { hint: None }",
                "Unassigned { hint: Some(Mountain) }",
                "Valley",
            ]
        );
    }

    #[test]
    fn unreadable_files_and_stored_text_are_refusals() {
        assert_eq!(
            load(CpFormat::Cp, b"1 0 0").err(),
            Some(IoRefusal::Unreadable {
                format: CpFormat::Cp
            })
        );
        assert_eq!(
            load(CpFormat::Fold, &[0xff, 0xfe]).err(),
            Some(IoRefusal::Unreadable {
                format: CpFormat::Fold
            })
        );
        let folded = r#"{"vertices_coords":[[0,0],[1,0]],"edges_vertices":[[0,1]],"frame_classes":["foldedForm"]}"#;
        assert_eq!(
            load(CpFormat::Fold, folded.as_bytes()).err(),
            Some(IoRefusal::FoldedForm)
        );
        assert_eq!(
            model_of_cp_json("not json").err(),
            Some(IoRefusal::StoredUnreadable {
                field: StoredField::CpJson
            })
        );
        // A byte-order mark is not part of the file.
        let cp = "\u{feff}1 0 0 1 1\n";
        assert_eq!(
            load(CpFormat::Cp, cp.as_bytes()).map(|m| m.line_segments.len()),
            Ok(1)
        );
    }
}
