//! What leaves Fold for the kernel's world (plan D10): Send to Edit, and the
//! FOLD export of a path.
//!
//! - **Send to Edit** is one state's crease pattern, `fold_cp_to_model`
//!   through the kernel's FOLD writer: the text the web hands to Edit's
//!   import chokepoint as a `format: 'fold'` payload, which reads it with the
//!   kernel's FOLD reader. Precreases are unassigned creases remembering
//!   their letter; "precreases as auxiliary lines" is the payload's
//!   `unassignedAsAuxiliary` flag, applied by Edit after the import.
//! - **The FOLD export** is a path of states as one FOLD file
//!   (`oristudio_fold::fold_file`): the last state's crease pattern as the
//!   root, Edit's to open, and every state as a flat `foldedForm` frame.

use oristudio_cp::io::fold::export_fold_json;
use oristudio_fold::{FoldExportError, State, export_fold_sequence_json, fold_cp_to_model};

use super::wire::{Exported, IoCallError, IoRefusal};
use crate::bridge::Bridge;
use crate::wire::Outcome;

/// The FOLD text Send to Edit hands over for `state`.
pub fn send_to_edit_text(state: &State, title: Option<&str>) -> Result<String, IoCallError> {
    export_fold_json(&fold_cp_to_model(state), title.map(str::to_owned)).map_err(|error| {
        IoCallError::Defect {
            code: "fold_export_text",
            message: error.to_string(),
        }
    })
}

/// [`send_to_edit_text`] of a held state.
pub fn send_to_edit(
    bridge: &Bridge,
    state: u32,
    title: Option<&str>,
) -> Result<String, IoCallError> {
    send_to_edit_text(bridge.state(state)?, title)
}

/// The FOLD file of the path `states` names, first step shown to last.
/// Refused when the file would exceed the folded-form cap.
pub fn export_fold(
    bridge: &Bridge,
    states: &[u32],
    title: Option<&str>,
) -> Result<Outcome<Exported>, IoCallError> {
    if states.is_empty() {
        return Err(IoCallError::invalid(
            "a FOLD export needs at least one state",
        ));
    }
    let path = states
        .iter()
        .map(|&state| bridge.state(state).cloned())
        .collect::<Result<Vec<State>, _>>()?;
    exported(export_fold_sequence_json(&path, title))
}

/// An export's text, its refusal, or the defect that stopped it.
fn exported(written: Result<String, FoldExportError>) -> Result<Outcome<Exported>, IoCallError> {
    match written {
        Ok(text) => Ok(Outcome::Ok(Exported { text })),
        Err(FoldExportError::TooLarge(too_large)) => Ok(Outcome::Refused(
            IoRefusal::ExportTooLarge {
                elements: too_large.size.elements(),
                cap: too_large.cap,
            }
            .into(),
        )),
        Err(error) => Err(IoCallError::Defect {
            code: error.code(),
            message: error.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use oristudio_cp::folding3d::interchange::{FoldedFormSize, FoldedFormTooLarge};

    use super::*;

    #[test]
    fn an_export_over_the_cap_is_a_refusal_and_a_defect_is_thrown() {
        let too_large = FoldExportError::TooLarge(FoldedFormTooLarge {
            size: FoldedFormSize {
                vertices: 5,
                face_ring_entries: 4,
                face_orders: 3,
            },
            cap: 10,
        });
        let refused = exported(Err(too_large)).map(|o| o.refused().map(|r| r.code()));
        assert_eq!(refused, Ok(Some("fold_export_too_large")));
        let thrown = exported(Err(FoldExportError::EmptyPath)).err();
        assert_eq!(thrown.map(|e| e.code()), Some("fold_export_empty"));
    }
}
