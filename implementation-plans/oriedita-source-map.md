# Oriedita Source Map and Parity Matrix

## Goal

This document is Stage 0 for the Oriedita port. It records the upstream source
surface that must be accounted for before implementation starts, maps each area
to a planned Rust home in `oristudio-cp`, and sets the initial parity status for
every item to `Unsupported`.

Nothing in this map means the feature is implemented. The point is the
opposite: every behavior is visible, named, and waiting for a unit-test and
oracle-tested port.

## Baseline

- Upstream repository: `https://github.com/oriedita/oriedita`
- Upstream commit inspected: `9d39135ae232cc03be4ffaf74baa7ae2df970507`
- Upstream license: MIT
- Planned Rust crate: `crates/oristudio-cp`
- Planned Rust package name: `oristudio-cp`

## Status Values

- `Unsupported`: command or behavior is known but not ported.
- `Porting`: implementation work has started but oracle parity is incomplete.
- `Unit-tested`: Rust unit coverage exists but Oriedita oracle coverage is not
  complete.
- `Oracle-tested`: Rust behavior matches the pinned Oriedita oracle for
  committed fixtures.
- `Documented-difference`: behavior intentionally differs and is documented.
- `Out-of-scope-ui`: Swing/UI-only behavior that does not belong in the initial
  non-UI kernel.

Default status for every item in this document is `Unsupported` unless a later
stage explicitly changes it.

## Rust Target Modules

| Target | Responsibility |
| --- | --- |
| `geometry` | Oriedita-compatible primitive geometry and epsilon behavior. |
| `model` | Editable crease-pattern document, lines, colors, selection, circles, text, and metadata. |
| `fold_graph` | Conversion between editable CP state and FOLD graph topology. |
| `io` | `.cp`, `.fold`, `.ori`, `.orh`, `.obj`, and `.dxf` import/export. |
| `operations::arrangement` | Add/delete/split/merge/cleanup line arrangement behavior. |
| `operations::selection` | Select/unselect, lasso, polygon, connected, type, and intersecting-line selection. |
| `operations::color` | Crease type, line color, assignment, replacement, and deletion commands. |
| `operations::construction` | Draw, bisect, inward, perpendicular, symmetric, parallel, foldable-line, and axiom commands. |
| `operations::point` | Point creation, deletion, vertex deletion, and line division commands. |
| `operations::transform` | Move, copy, lengthen, four-point transforms, and operation-frame semantics. |
| `operations::circle` | Circle creation, tangency, intersection, concentric, inversion, and color commands. |
| `operations::generators` | Regular polygon, base pattern, and Voronoi generators. |
| `operations::measure` | Non-mutating distance and angle measurement command results. |
| `checks` | Check1-Check4, CAMV, flat-foldability, and repair diagnostics. |
| `folding` | Oriedita-compatible folding-estimation surface and folded-model data. |
| `oracle` | Test-only canonicalization and oracle result comparison helpers. |

## Upstream Package Map

| Upstream path | Role | Rust target | Classification | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| `origami/Epsilon.java` | Global tolerance constants. | `geometry::epsilon` | kernel | 2 | Unit-tested |
| `origami/crease_pattern/OritaCalc.java` | Core static geometry helpers. | `geometry::orita_calc` | kernel | 2 | Porting |
| `origami/crease_pattern/element/Point.java` | 2D point primitive. | `geometry::point` | kernel | 2 | Unit-tested |
| `origami/crease_pattern/element/Line.java` | PointSet line primitive. | `geometry::line` | kernel | 2 | Unit-tested |
| `origami/crease_pattern/element/StraightLine.java` | Infinite line primitive. | `geometry::straight_line` | kernel | 2 | Unit-tested |
| `origami/crease_pattern/element/LineSegment.java` | Segment primitive, colors, active state, intersection enum. | `geometry::segment`, `model::line` | kernel | 2-3 | Oracle-tested |
| `origami/crease_pattern/element/LineColor.java` | Oriedita line colors and fold-color meanings. | `model::line_color` | kernel | 3 | Unit-tested |
| `origami/crease_pattern/element/Circle.java` | Circle primitive and color metadata. | `geometry::circle`, `model::circle` | kernel | 2-3 | Unit-tested |
| `origami/crease_pattern/element/Polygon.java` | Polygon containment and selection geometry. | `geometry::polygon` | kernel | 2 | Unit-tested |
| `origami/crease_pattern/element/Rectangle.java` | Rectangular selection and bounds. | `geometry::rectangle` | kernel | 2 | Unit-tested |
| `origami/crease_pattern/CustomLineTypes.java` | Custom line metadata. | `model::line_color` | kernel | 3 | Oracle-tested |
| `origami/crease_pattern/FoldLineSet.java` | Main editable line/circle set. | `model`, `operations::*` | kernel | 3-9 | Porting |
| `origami/crease_pattern/LineSegmentSet.java` | Line arrangement set used for folding and export. | `fold_graph`, `operations::arrangement`, `folding::prepare_subface_segments` | kernel | 3-5, 10 | Porting; subface arrangement oracle |
| `origami/crease_pattern/PointSet.java` | Vertex/edge/face topology for folding/export. | `io::fold::export_topology`, `fold_graph` | kernel | 3-4, 10 | Porting; FOLD topology and wireframe oracle |
| `origami/crease_pattern/PointLineMap.java` | Point-to-line neighborhood lookup. | `model::topology` | kernel | 3 | Unsupported |
| `origami/crease_pattern/FlatFoldabilityViolation.java` | Diagnostic payload. | `checks::diagnostic` | kernel | 9 | Oracle-tested |
| `origami/crease_pattern/LittleBigLittleViolation.java` | Diagnostic payload. | `checks::diagnostic` | kernel | 9 | Oracle-tested |
| `origami/crease_pattern/LassoInteractionMode.java` | Lasso selection mode. | `operations::selection::LassoInteractionMode` | kernel | 6 | Oracle-tested |
| `origami/crease_pattern/FoldingException.java` | Folding error surface. | `folding::error` | kernel | 10 | Unsupported |
| `origami/crease_pattern/util/CreasePattern_Worker_Toolbox.java` | Shared CP worker helpers. | `operations::*` | kernel | 5-9 | Unsupported |
| `origami/crease_pattern/worker/WireFrame_Worker.java` | Face/topology/folding preparation. | `io::fold::export_topology`, `fold_graph`, `folding` | kernel | 4, 10 | Porting; FOLD topology and wireframe oracle |
| `origami/crease_pattern/worker/LineSegmentSetWorker.java` | Arrangement cleanup for folded subfaces. | `folding::prepare_subface_segments`, `operations::arrangement` | kernel | 5, 10 | Oracle-tested for split-arrangement preprocessing |
| `origami/crease_pattern/worker/FoldedFigure_Worker.java` | Folded-model hierarchy and overlap solving. | `folding::possible_overlap_search_for_subfaces`, `folding::possible_overlap_search_for_subfaces_with_swap`, `folding::overlap_search_from_segments` | kernel | 10 | Porting; worker no-swap, swap, and final-recovery overlap-search oracle |
| `origami/crease_pattern/worker/FoldedFigure_Configurator.java` | Subface and hierarchy setup. | `folding::configure_subfaces_from_segments` | kernel | 10 | Porting; configureSubFaces oracle |
| `oriedita-ui/src/main/java/oriedita/editor/drawing/FoldedFigure_Drawer.java` | Folded-figure grid-area camera setup and draw orchestration. | `folding::FoldedFigureRenderSnapshot`, web grid renderer | kernel/ui | 10 | Unsupported; must preserve Oriedita camera offsets, scale, rotation, mirror, and display-style routing |
| `oriedita-ui/src/main/java/oriedita/editor/drawing/FoldedFigure_Worker_Drawer.java` | Wire, paper, transparent, front/back, and constraint drawing primitives. | `folding::FoldedFigureRenderSnapshot`, web grid renderer | kernel/ui | 10 | Unsupported; no approximate renderer accepted before primitive parity oracle |
| `oriedita-ui/src/main/java/oriedita/editor/drawing/WireFrame_Worker_Drawer.java` | Development-view folded wireframe drawing. | `folding::FoldedWireframeRenderSnapshot`, web grid renderer | kernel/ui | 10 | Unsupported |
| `oriedita-ui/src/main/java/oriedita/editor/CanvasUI.java` | CP canvas layer order including folded figures in the grid area. | web `CreasePatternPanel` render stack | ui | 12 | Generated/imported folded snapshots render in the editable grid overlay; exact Oriedita drawer primitive parity still unsupported |
| `oriedita-data/src/main/java/oriedita/editor/databinding/FoldedFigureModel.java` | Folded-figure colors, scale, rotation, anti-aliasing, shadows, state, transparency, and case selection. | `folding::FoldedFigureModel`, workspace folded-figure state | kernel/ui | 10 | Unit-tested defaults; workspace mutation wiring unsupported |
| `oriedita-data/src/main/java/oriedita/editor/folded_figure/FoldedFigure_01.java` | Oriedita editor wrapper that bridges `FoldedFigure` and `FoldedFigureModel`. | `folding::FoldedFigureSnapshot`, `oristudio-cp-wasm` folded-figure handles | kernel | 10 | Unit-tested snapshot carrier and WASM session handle; editor wrapper/list wiring unsupported |
| `origami/crease_pattern/worker/SelectMode.java` | Select/unselect mode enum. | `operations::selection` | kernel | 6 | Unsupported |
| `origami/crease_pattern/worker/foldlineset/BranchTrim.java` | Branch trimming cleanup. | `operations::arrangement` | kernel | 5 | Oracle-tested |
| `origami/crease_pattern/worker/foldlineset/Check1.java` | Diagnostic check. | `checks` | kernel | 9 | Oracle-tested |
| `origami/crease_pattern/worker/foldlineset/Check2.java` | Diagnostic check. | `checks` | kernel | 9 | Oracle-tested |
| `origami/crease_pattern/worker/foldlineset/Check3.java` | Diagnostic check. | `checks` | kernel | 9 | Oracle-tested |
| `origami/crease_pattern/worker/foldlineset/Check4.java` | Diagnostic check. | `checks` | kernel | 9 | Oracle-tested |
| `origami/crease_pattern/worker/foldlineset/Fix1.java` | Repair operation. | `checks`, `operations::arrangement` | kernel | 9 | Oracle-tested |
| `origami/crease_pattern/worker/foldlineset/Fix2.java` | Repair operation. | `checks`, `operations::arrangement` | kernel | 9 | Oracle-tested |
| `origami/crease_pattern/worker/foldlineset/OrganizeCircles.java` | Circle cleanup/organization. | `operations::circle` | kernel | 8 | Oracle-tested |
| `origami/crease_pattern/worker/linesegmentset/GetBoundingBox.java` | Bounds helper. | `model::bounds` | kernel | 3 | Unsupported |
| `origami/crease_pattern/worker/linesegmentset/IntersectDivide.java` | Segment arrangement split helper. | `operations::arrangement` | kernel | 5 | Oracle-tested |
| `origami/crease_pattern/worker/linesegmentset/OverlappingLineRemoval.java` | Overlap cleanup helper. | `operations::arrangement` | kernel | 5 | Unit-tested |
| `origami/data/quadTree/*` | Spatial acceleration and collectors. | `model::spatial` | kernel | 3, 5 | Unsupported |
| `origami/data/listMatrix/*` | Matrix-like adjacency storage. | `folding`, `fold_graph` | kernel | 10 | Unsupported |
| `origami/data/symmetricMatrix/*` | Symmetric relation storage. | `folding` | kernel | 10 | Unsupported |
| `origami/data/tree/*` | AVL/BST utilities. | `folding` | kernel | 10 | Unsupported |
| `origami/data/save/LineSegmentSave.java` | Save DTO for lines/circles. | `io::save` | io | 4 | Unit-tested |
| `origami/data/save/PointSave.java` | Save DTO for points. | `io::save` | io | 4 | Unit-tested |
| `oriedita-data/src/main/java/oriedita/editor/databinding/GridModel.java` | Grid metadata saved in Oriedita extras. | `model::grid` | kernel | 3 | Unit-tested |
| `oriedita-common/src/main/java/oriedita/editor/text/Text.java` | Text annotation carrier. | `model::text` | kernel | 3 | Unit-tested |
| `origami/folding/FoldedFigure.java` | Folding-stage coordinator. | `folding` | kernel | 10 | Unsupported |
| `origami/folding/HierarchyList.java` | Face-order relation table. | `folding::initial_hierarchy_from_segments` | kernel | 10 | Porting; initial MV relations oracle |
| `origami/folding/element/Face.java` | Folded face data. | `folding::face` | kernel | 10 | Unsupported |
| `origami/folding/element/SubFace.java` | Subface data and overlap relations. | `folding::SubFace`, `folding::SubFacePermutationSearch` | kernel | 10 | Porting; membership/reduction, guide-map, local overlap-search, and swapper oracle |
| `origami/folding/constraint/CustomConstraint.java` | User folding constraints. | `folding::constraints` | kernel | 10 | Unsupported |
| `origami/folding/algorithm/*` | Inference, priority, Italiano, swapping algorithms. | `folding::additional_estimation_from_segments`, `folding::prioritize_subfaces`, `folding::SubFaceSwapper` | kernel | 10 | Porting; fixed-point/realtime AEA, SubFacePriority, and integrated SubFaceSwappingAlgorithm oracle |
| `origami/folding/permutation/*` | Permutation and constraint combinatorics. | `folding::solver` | kernel | 10 | Porting; ChainPermutationGenerator oracle |
| `origami/folding/util/*` | Folding utility data structures. | `folding::EquivalenceCondition` | kernel | 10 | Porting; equivalence condition candidates oracle |
| `oriedita-data/export/*` | Import/export implementations. | `io` | io | 4 | Unsupported |
| `oriedita-data/save/*` | Oriedita save models and version conversion. | `io::ori` plus preserved metadata | io | 4 | Porting; core `.ori` fields unit-tested, full editor model promotion and web exposure pending |
| `oriedita/src/main/java/oriedita/editor/task/*` | Non-UI task semantics. | `checks`, `folding` | kernel | 9-10 | Unsupported |
| `oriedita/src/main/java/oriedita/editor/service/impl/FoldingServiceImpl.java` | Folding command routing. | `folding::commands` | kernel | 10 | Unsupported |
| `oriedita/src/main/java/oriedita/editor/handler/*` | Mouse/tool command intent. | `operations::*`, `folding` | kernel-intent | 5-10 | Unsupported |

## Mouse Mode Command Matrix

| Mouse mode | Upstream handler | Rust target | Classification | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| `DRAW_CREASE_FREE_1` | `MouseHandlerDrawCreaseFree` | `operations::construction::draw_crease_segment` | kernel | 7 | Oracle-tested |
| `MOVE_CREASE_PATTERN_2` | `MouseHandlerMoveCreasePattern` | runtime camera pan, no persisted CP mutation | ui-preview-only | later UI | Out-of-scope-ui |
| `LINE_SEGMENT_DELETE_3` | `MouseHandlerLineSegmentDelete` | `operations::arrangement::delete_line_segment_vertex_for_index`, `operations::arrangement::delete_line_segments_for_indices` | kernel | 5 | Oracle-tested |
| `CHANGE_CREASE_TYPE_4` | `MouseHandlerChangeCreaseType` | `operations::color::change_crease_type` | kernel | 6 | Oracle-tested |
| `LENGTHEN_CREASE_5` | `MouseHandlerLengthenCrease` | `operations::transform::lengthen_crease` | kernel | 6 | Oracle-tested |
| `SQUARE_BISECTOR_7` | `MouseHandlerSquareBisector` | `operations::construction::square_bisector_from_points_to_destination`, `operations::construction::square_bisector_from_lines_to_destination`, `operations::construction::square_bisector_parallel_indicator`, `operations::construction::commit_square_bisector_parallel_indicator`, `operations::construction::square_bisector_parallel_between_destinations` | kernel | 7 | Oracle-tested |
| `INWARD_8` | `MouseHandlerInward` | `operations::construction::inward` | kernel | 7 | Oracle-tested |
| `PERPENDICULAR_DRAW_9` | `MouseHandlerPerpendicularDraw` | `operations::construction::perpendicular_projection`, `operations::construction::perpendicular_indicator` | kernel | 7 | Oracle-tested |
| `SYMMETRIC_DRAW_10` | `MouseHandlerSymmetricDraw` | `operations::construction::symmetric_draw` | kernel | 7 | Oracle-tested |
| `DRAW_CREASE_RESTRICTED_11` | `MouseHandlerDrawCreaseRestricted` | `operations::construction::draw_crease_segment` | kernel | 7 | Oracle-tested |
| `DRAW_CREASE_SYMMETRIC_12` | `MouseHandlerDrawCreaseSymmetric` | `operations::construction::mirror_selected_lines` | kernel | 7 | Oracle-tested |
| `DRAW_CREASE_ANGLE_RESTRICTED_13` | `MouseHandlerDrawCreaseAngleRestricted` | `operations::construction::angle_restricted_converging_candidates`, `operations::construction::draw_crease_angle_restricted_converging` | kernel | 7 | Oracle-tested |
| `DRAW_POINT_14` | `MouseHandlerDrawPoint` | `operations::point::draw_point_on_segment` | kernel | 7 | Oracle-tested |
| `DELETE_POINT_15` | `MouseHandlerDeletePoint` | `operations::point::delete_point` | kernel | 5 | Oracle-tested |
| `ANGLE_SYSTEM_16` | `MouseHandlerAngleSystem` | `operations::construction::angle_system_candidates`, `operations::construction::angle_system_draw_to_destination` | kernel | 7 | Oracle-tested |
| `DRAW_CREASE_ANGLE_RESTRICTED_3_18` | `MouseHandlerDrawCreaseAngleRestricted3_2` | `operations::construction::draw_crease_angle_restricted_3_candidates`, `operations::construction::draw_crease_angle_restricted_3_to_point` | kernel | 7 | Oracle-tested |
| `CREASE_SELECT_19` | `MouseHandlerCreaseSelect` | `operations::selection::select_indices`, `operations::selection::select_box` | kernel | 6 | Oracle-tested |
| `CREASE_UNSELECT_20` | `MouseHandlerCreaseUnselect` | `operations::selection::unselect_indices`, `operations::selection::unselect_box` | kernel | 6 | Oracle-tested |
| `CREASE_MOVE_21` | `MouseHandlerCreaseMove` | `operations::transform::move_selected_lines` | kernel | 6 | Oracle-tested |
| `CREASE_COPY_22` | `MouseHandlerCreaseCopy` | `operations::transform::copy_selected_lines` | kernel | 6 | Oracle-tested |
| `CREASE_MAKE_MOUNTAIN_23` | `MouseHandlerCreaseMakeMountain` | `operations::color::make_mountain` | kernel | 6 | Oracle-tested |
| `CREASE_MAKE_VALLEY_24` | `MouseHandlerCreaseMakeValley` | `operations::color::make_valley` | kernel | 6 | Oracle-tested |
| `CREASE_MAKE_EDGE_25` | `MouseHandlerCreaseMakeEdge` | `operations::color::make_edge` | kernel | 6 | Oracle-tested |
| `BACKGROUND_CHANGE_POSITION_26` | `MouseHandlerBackgroundChangePosition` | none | ui-preview-only | later UI | Out-of-scope-ui |
| `LINE_SEGMENT_DIVISION_27` | `MouseHandlerLineSegmentDivision` | `operations::point::divide_segment_by_count` | kernel | 7 | Oracle-tested |
| `LINE_SEGMENT_RATIO_SET_28` | `MouseHandlerLineSegmentRatioSet` | `operations::point::divide_segment_by_ratio` | kernel | 7 | Oracle-tested |
| `POLYGON_SET_NO_CORNERS_29` | `MouseHandlerPolygonSetNoCorners` | `operations::generators::regular_polygon` | kernel | 8 | Oracle-tested |
| `CREASE_ADVANCE_TYPE_30` | `MouseHandlerCreaseAdvanceType` | `operations::color::advance_line_type` | kernel | 6 | Oracle-tested |
| `CREASE_MOVE_4P_31` | `MouseHandlerCreaseMove4p` | `operations::transform::move_selected_lines_by_points` | kernel | 6 | Oracle-tested |
| `CREASE_COPY_4P_32` | `MouseHandlerCreaseCopy4p` | `operations::transform::copy_selected_lines_by_points` | kernel | 6 | Oracle-tested |
| `FISH_BONE_DRAW_33` | `MouseHandlerFishBoneDraw` | `operations::construction::fishbone_draw` | kernel | 7 | Oracle-tested |
| `CREASE_MAKE_MV_34` | `MouseHandlerCreaseMakeMV` | `operations::color::alternate_mountain_valley_along` | kernel | 6 | Oracle-tested |
| `DOUBLE_SYMMETRIC_DRAW_35` | `MouseHandlerDoubleSymmetricDraw` | `operations::construction::double_symmetric_draw` | kernel | 7 | Oracle-tested |
| `CREASES_ALTERNATE_MV_36` | `MouseHandlerCreasesAlternateMV` | `operations::color::alternate_mountain_valley_crossing` | kernel | 6 | Oracle-tested |
| `DRAW_CREASE_ANGLE_RESTRICTED_5_37` | `MouseHandlerDrawCreaseAngleRestricted5` | `operations::construction::draw_crease_angle_restricted_5`, `operations::construction::snap_to_active_angle_system`, `operations::construction::snap_to_close_point_in_active_angle_system` | kernel | 7 | Oracle-tested |
| `VERTEX_MAKE_ANGULARLY_FLAT_FOLDABLE_38` | `MouseHandlerVertexMakeAngularlyFlatFoldable` | `operations::construction::make_vertex_flat_foldable_candidates`, `operations::construction::make_vertex_flat_foldable_to_destination` | kernel | 7, 9 | Oracle-tested |
| `FOLDABLE_LINE_INPUT_39` | `MouseHandlerFoldableLineInput` | `operations::construction::foldable_line_input_candidates`, `operations::construction::foldable_line_input_direct`, `operations::construction::foldable_line_input_to_destination` | kernel | 7 | Oracle-tested |
| `PARALLEL_DRAW_40` | `MouseHandlerParallelDraw` | `operations::construction::parallel_draw` | kernel | 7 | Oracle-tested |
| `VERTEX_DELETE_ON_CREASE_41` | `MouseHandlerVertexDeleteOnCrease` | `operations::point::delete_vertex_on_crease` | kernel | 5 | Oracle-tested |
| `CIRCLE_DRAW_42` | `MouseHandlerCircleDraw` | `operations::circle::draw` | kernel | 8 | Oracle-tested |
| `CIRCLE_DRAW_THREE_POINT_43` | `MouseHandlerCircleDrawThreePoint` | `operations::circle::through_three_points` | kernel | 8 | Oracle-tested |
| `CIRCLE_DRAW_SEPARATE_44` | `MouseHandlerCircleDrawSeparate` | `operations::circle::separate` | kernel | 8 | Oracle-tested |
| `CIRCLE_DRAW_TANGENT_LINE_45` | `MouseHandlerCircleDrawTangentLine` | `operations::circle::tangent_line` | kernel | 8 | Oracle-tested |
| `CIRCLE_DRAW_INVERTED_46` | `MouseHandlerCircleDrawInverted` | `operations::circle::inverted` | kernel | 8 | Oracle-tested |
| `CIRCLE_DRAW_FREE_47` | `MouseHandlerCircleDrawFree` | `operations::circle::free` | kernel | 8 | Oracle-tested |
| `CIRCLE_DRAW_CONCENTRIC_48` | `MouseHandlerCircleDrawConcentric` | `operations::circle::concentric` | kernel | 8 | Oracle-tested |
| `CIRCLE_DRAW_CONCENTRIC_SELECT_49` | `MouseHandlerCircleDrawConcentricSelect` | `operations::circle::concentric_select` | kernel | 8 | Oracle-tested |
| `CIRCLE_DRAW_CONCENTRIC_TWO_CIRCLE_SELECT_50` | `MouseHandlerCircleDrawConcentricTwoCircleSelect` | `operations::circle::concentric_two_circle_select` | kernel | 8 | Oracle-tested |
| `PARALLEL_DRAW_WIDTH_51` | `MouseHandlerParallelDrawWidth` | `operations::construction::parallel_width_indicators` | kernel | 7 | Oracle-tested |
| `CONTINUOUS_SYMMETRIC_DRAW_52` | `MouseHandlerContinuousSymmetricDraw` | `operations::construction::continuous_symmetric_draw` | kernel | 7 | Oracle-tested |
| `DISPLAY_LENGTH_BETWEEN_POINTS_1_53` | `MouseHandlerDisplayLengthBetweenPoints` variant | `operations::measure::length_between_points` | kernel | 7 | Oracle-tested |
| `DISPLAY_LENGTH_BETWEEN_POINTS_2_54` | `MouseHandlerDisplayLengthBetweenPoints` variant | `operations::measure::length_between_points` | kernel | 7 | Oracle-tested |
| `DISPLAY_ANGLE_BETWEEN_THREE_POINTS_1_55` | `MouseHandlerDisplayAngleBetweenThreePoints` variant | `operations::measure::angle_between_three_points` | kernel | 7 | Oracle-tested |
| `DISPLAY_ANGLE_BETWEEN_THREE_POINTS_2_56` | `MouseHandlerDisplayAngleBetweenThreePoints` variant | `operations::measure::angle_between_three_points` | kernel | 7 | Oracle-tested |
| `DISPLAY_ANGLE_BETWEEN_THREE_POINTS_3_57` | `MouseHandlerDisplayAngleBetweenThreePoints` variant | `operations::measure::angle_between_three_points` | kernel | 7 | Oracle-tested |
| `CREASE_TOGGLE_MV_58` | `MouseHandlerCreaseToggleMV` | `operations::color::toggle_mountain_valley` | kernel | 6 | Oracle-tested |
| `CIRCLE_CHANGE_COLOR_59` | `MouseHandlerCircleChangeColor` | `operations::circle::change_color` | kernel | 8 | Oracle-tested |
| `CREASE_MAKE_AUX_60` | `MouseHandlerCreaseMakeAux` | `operations::color::make_aux` | kernel | 6 | Oracle-tested |
| `OPERATION_FRAME_CREATE_61` | `MouseHandlerOperationFrameCreate` | `operations::transform::operation_frame_press/drag/release` | kernel | 6 | Oracle-tested |
| `VORONOI_CREATE_62` | `MouseHandlerVoronoiCreate` | `operations::generators::voronoi_press/apply` | kernel | 8 | Oracle-tested |
| `FLAT_FOLDABLE_CHECK_63` | `MouseHandlerFlatFoldableCheck` | `checks::flat_foldable_boundary_check` | kernel | 9 | Oracle-tested |
| `CREASE_DELETE_OVERLAPPING_64` | `MouseHandlerCreaseDeleteOverlapping` | `operations::arrangement::delete_overlapping` | kernel | 5 | Oracle-tested |
| `CREASE_DELETE_INTERSECTING_65` | `MouseHandlerCreaseDeleteIntersecting` | `operations::arrangement::delete_intersecting` | kernel | 5 | Oracle-tested |
| `SELECT_POLYGON_66` | `MouseHandlerSelectPolygon` | `operations::selection::select_polygon` | kernel | 6 | Oracle-tested |
| `UNSELECT_POLYGON_67` | `MouseHandlerUnselectPolygon` | `operations::selection::unselect_polygon` | kernel | 6 | Oracle-tested |
| `SELECT_LINE_INTERSECTING_68` | `MouseHandlerSelectLineIntersecting` | `operations::selection::select_intersecting_line` | kernel | 6 | Oracle-tested |
| `UNSELECT_LINE_INTERSECTING_69` | `MouseHandlerUnselectLineIntersecting` | `operations::selection::unselect_intersecting_line` | kernel | 6 | Oracle-tested |
| `LENGTHEN_CREASE_SAME_COLOR_70` | `MouseHandlerLengthenCreaseSameColor` | `operations::transform::lengthen_crease` | kernel | 6 | Oracle-tested |
| `FOLDABLE_LINE_DRAW_71` | `MouseHandlerFoldableLineDraw` | `operations::construction::foldable_line_draw_operation_mode`, `operations::construction::foldable_line_draw_switches_to_free` | kernel | 7 | Oracle-tested |
| `REPLACE_LINE_TYPE_SELECT_72` | `MouseHandlerReplaceTypeSelect` | `operations::color::replace_line_type_for_indices` | kernel | 6 | Oracle-tested |
| `DELETE_LINE_TYPE_SELECT_73` | `MouseHandlerDeleteTypeSelect` | `operations::color::delete_line_type_for_indices` | kernel | 6 | Oracle-tested |
| `SELECT_LASSO_74` | `MouseHandlerSelectLasso` | `operations::selection::select_lasso` | kernel | 6 | Oracle-tested |
| `UNSELECT_LASSO_75` | `MouseHandlerUnselectLasso` | `operations::selection::unselect_lasso` | kernel | 6 | Oracle-tested |
| `TEXT` | `MouseHandlerText` | `model::text`, `operations::text` | kernel | 3, 6 | Oracle-tested |
| `DRAW_BLINTZ` | `MouseHandlerDrawBlintz` | `operations::generators::default_molecule` | kernel | 8 | Oracle-tested |
| `DRAW_FISH_BASE` | `MouseHandlerDrawFishBase` | `operations::generators::default_molecule` | kernel | 8 | Oracle-tested |
| `DRAW_DOVE_BASE` | `MouseHandlerDrawDoveBase` | `operations::generators::default_molecule` | kernel | 8 | Oracle-tested |
| `DRAW_BIRD_BASE` | `MouseHandlerDrawBirdBase` | `operations::generators::default_molecule` | kernel | 8 | Oracle-tested |
| `DRAW_FROG_BASE` | `MouseHandlerDrawFrogBase` | `operations::generators::default_molecule` | kernel | 8 | Oracle-tested |
| `MODIFY_CALCULATED_SHAPE_101` | `MouseHandlerModifyCalculatedShape` | `folding::modify_calculated_shape` | kernel | 10 | Unsupported |
| `MOVE_CALCULATED_SHAPE_102` | `MouseHandlerMoveCalculatedShape` | `folding::move_calculated_shape` | kernel | 10 | Unsupported |
| `CHANGE_STANDARD_FACE_103` | `MouseHandlerChangeStandardFace` | `folding::change_standard_face` | kernel | 10 | Unsupported |
| `ADD_FOLDING_CONSTRAINT` | `MouseHandlerAddFoldingConstraints` | `folding::constraints` | kernel | 10 | Unsupported |
| `AXIOM_5` | `MouseHandlerAxiom5` | `operations::construction::axiom5_indicators`, `operations::construction::commit_axiom5_indicator`, `operations::construction::axiom5_draw_to_destination` | kernel | 7 | Oracle-tested |
| `AXIOM_7` | `MouseHandlerAxiom7` | `operations::construction::axiom7_indicator`, `operations::construction::commit_axiom7_indicator`, `operations::construction::axiom7_draw_to_destination` | kernel | 7 | Oracle-tested |
| `FIX_INACCURATE_107` | `MouseHandlerCreaseFixInaccurate` | `checks::fix_inaccurate_for_indices`, `operations::arrangement` | kernel | 5, 9 | Oracle-tested |

## Step Handler Infrastructure

| Upstream source | Role | Rust target | Classification | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| `StepMouseHandler.java` | Multi-step command lifecycle. | `operations::command_state` | kernel | 1 | Unsupported |
| `StepGraph.java` | Step transition wiring. | `operations::command_state` | kernel | 1 | Unsupported |
| `StepFactory.java` | Reusable point/box/line-selection steps. | `operations::command_state` | kernel | 1, 6-8 | Unsupported |
| `ObjCoordStepNode.java` | Model-space point input step. | `operations::command_state` | kernel | 1 | Unsupported |
| `SelectPointStepNode.java` | Point selection step. | `operations::command_state` | kernel | 1, 6-8 | Unsupported |
| `BoxSelectStepNode.java` | Box selection step. | `operations::selection` | kernel | 6 | Porting |
| `BoxSelectLinesStepNode.java` | Box line selection step. | `operations::selection::select_box`, `operations::selection::unselect_box` | kernel | 6 | Oracle-tested |
| `IPreviewStepNode.java` | Preview marker. | command result candidates | kernel-preview | 7-8 | Unsupported |
| `ICameraStepNode.java` | Camera/model coordinate marker. | none | out-of-scope-ui | later UI | Out-of-scope-ui |

The Rust kernel should not copy Swing event lifecycles, but it must preserve
the command-state semantics that affect generated candidates and final model
mutation.

## Import and Export Matrix

| Upstream source | Behavior | Rust target | Stage | Status |
| --- | --- | --- | --- | --- |
| `CpImporter.java` | `.cp` import. | `io::cp::import` | 4 | Unit-tested |
| `CpExporter.java` | `.cp` export and lossy-format warning. | `io::cp::export` | 4 | Unit-tested |
| `FoldImporter.java` | `.fold` import and coordinate normalization. | `io::fold::import` | 4 | Unit-tested |
| `FoldExporter.java` | `.fold` export, face reconstruction, Oriedita extras. | `io::fold::export` | 4 | Unit-tested; topology oracle |
| `FoldImporter.java` `file_frames` | Preserve and select embedded FOLD frames, including `foldedForm` frames. | `io::fold::import_fold_file_json`, `io::fold::import_folded_frames`, web FOLD frame inventory | 4, 11 | Porting; Rust lossless parse/export and `.osf` preservation exist, full web render/export of every frame remains planned |
| `FoldExporter.java` `file_frames` | Export embedded folded-form frame graphs when present. | `io::fold::export_fold_file_json`, `io::fold::export_folded_frames`, web FOLD frame inventory | 4, 11 | Porting; Rust lossless parse/export and `.osf` preservation exist, active-frame update semantics remain planned |
| `OriImporter.java` | `.ori` import. | `io::ori::import`, `oristudio-cp-wasm`, web file routing | 4 | Porting; Rust unit-tested, WASM/web exposure and editor-state restoration pending |
| `OriExporter.java` | `.ori` export. | `io::ori::export`, `oristudio-cp-wasm`, web export routing | 4 | Porting; Rust unit-tested, WASM/web exposure and editor-state synthesis pending |
| `OrhImporter.java` | `.orh` import. | `io::orh::import`, `oristudio-cp-wasm`, web file routing | 4 | Oracle-tested in Rust; WASM/web exposure pending |
| `OrhExporter.java` | `.orh` export. | `io::orh::export`, `oristudio-cp-wasm`, web export routing | 4 | Oracle-tested in Rust; WASM/web exposure and lossy-warning UI pending |
| `ObjImporter.java` | `.obj` import. | `io::obj::import` | 4 | Oracle-tested |
| `DxfExporter.java` | `.dxf` export. | `io::dxf::export` | 4 | Oracle-tested |
| `OrieditaFoldFile.java` | FOLD extension fields. | `io::fold::oriedita_extensions` | 4 | Unit-tested |
| `Save.java` | Main save model. | `io::ori` | 4 | Unit-tested for core fields; typed editor-model helpers pending |
| `BaseSave.java` | Shared save payload. | `io::ori` | 4 | Unit-tested for core fields; typed editor-model helpers pending |
| `SaveV1_0.java` | Legacy save payload. | `io::ori::version` | 4 | Unit-tested |
| `SaveV1_1.java` | Current save payload. | `io::ori::version` | 4 | Unit-tested |
| `SaveConverter.java` | Save-version conversion. | `io::ori::version` and oracle canonicalization | 4 | Unit-tested strict/permissive policy; Oriedita oracle conversion command pending |
| `SaveProvider.java` | Save instance factory. | `io::save` | 4 | Unsupported |
| `FileVersionTester.java` | Save-version detection. | `io::save::version` | 4 | Unit-tested |
| `TextSave.java` | Text persistence. | `model::text`, `io::save` | 3-4 | Unit-tested |

## Native Document Interchange Responsibility Matrix

| Format/state | Native responsibility | Ori Studio responsibility | Status |
| --- | --- | --- | --- |
| `.ori` | Oriedita editor-save JSON for CP primitives and editor models. | Preserve and export Oriedita fields, restore supported grid/camera/canvas/folded settings, expose through WASM/web. | Rust core unit-tested; WASM/web and typed editor-state restoration pending. |
| `.fold` | FOLD geometry plus Oriedita extension fields and embedded `file_frames`. | Preserve the full frame graph, edit only the active CP frame, render preserved folded forms. | Rust preservation exists; all-frame web rendering and active-frame export update pending. |
| `.orh` | Legacy Oriedita/Orihime text format, charset quirks, folded colors. | Import/export with explicit lossy warnings and folded color preservation. | Rust oracle-tested; WASM/web exposure pending. |
| `.cp` | Plain line-only crease-pattern exchange. | Treat as lossy exchange format. | Web/Rust path exists; lossy-warning polish remains tied to export UI. |
| `.osf` | Ori Studio workspace, not an Oriedita format. | Persist Ori Studio-only state such as multiple folded overlays while preserving imported Oriedita source metadata. | Exists for current workspace state; source typing must include `.ori`/`.orh`. |

## Task and Service Matrix

| Upstream source | Behavior | Rust target | Stage | Status |
| --- | --- | --- | --- | --- |
| `CheckCAMVTask.java` | Combined angle and MV diagnostics. | `checks::check_camv_task` | 9 | Oracle-tested |
| `FoldingEstimateTask.java` | Folding estimate execution. | `folding::FoldingEstimateSession`, `folding::folding_estimate_from_segments`, `folding::WorkerOverlapEnumerator` | 10 | Porting; first-solution, fresh order-6, and order-5/order-6 sequence oracles |
| `FoldingEstimateSpecificTask.java` | Refold with selected starting face/state. | `folding::folding_estimate_to_case`, `oristudio-cp-wasm::folded_figure_fold_to_case` | 10 | Porting; pure enumeration loop oracle and WASM session export, UI timing/dirty-state out of scope |
| `FoldingEstimateSave100Task.java` | Batch/export folding estimates. | `folding::folding_estimate_save_batch`, `folding::folding_estimate_case_filename` | 10 | Porting; batch case-number and filename oracle, image writing out of scope |
| `TwoColoredTask.java` | Two-colored CP generation. | `folding::two_colored_subface_segments_from_segments`, `folding::two_colored_folding_estimate_from_segments` | 10 | Porting; stage 02col/03 arrangement and full estimate summary oracles |
| `FoldingServiceImpl.fold` | Determine fold scope and start folding. | `oristudio-cp-wasm::folded_figure_fold`, workspace folded-figure state, CP toolbar Fold control | 10 | WASM session entrypoint, stale-aware workspace list, and toolbar trigger; selection scope, Oriedita folded-list replacement semantics, and async task dispatch are incomplete |
| `FoldingServiceImpl.folding_estimated` | Reuse existing fold input for selected figure. | `folding::FoldingEstimateSession::folding_estimated` | 10 | Porting; pure session estimate ported, selected figure/camera wrapper unsupported |
| `FoldingServiceImpl.createTwoColoredCp` | Generate two-colored CP from selected lines. | `folding::two_colored_folding_estimate_from_segments` | 10 | Porting; pure folded estimate ported, UI selection/list wiring unsupported |
| `FoldingServiceImpl.foldAnother` | Request another overlap solution. | `folding::fold_another`, `folding::WorkerOverlapEnumerator`, `oristudio-cp-wasm::folded_figure_fold_another`, workspace folded-figure state, CP toolbar next-solution control | 10 | Porting; pure session action, WASM session export, workspace state update path, and toolbar trigger; full Oriedita control wiring unsupported |
| `FoldingServiceImpl.duplicate` | Duplicate folded model and replay estimate order. | `folding::duplicate_estimation_order_for_display` | 10 | Porting; replay-order mapping oracle, folded-list/task wiring unsupported |
| `FoldedFigureModel` | Apply folded-figure display, color, scale, rotation, anti-alias, shadow, transparency, state, and case properties. | `folding::FoldedFigureModel` | 10 | Unit-tested defaults; command and workspace mutation wiring unsupported |
| `FoldedFigureCanvasSelectService` | Select folded-figure vertices/faces in the grid canvas. | `folding::FoldedFigureCanvasSelection` | 10 | Unsupported |
| `FoldedFigure_Drawer.foldUp_draw` | Build exact render primitives for Oriedita folded views. | `folding::FoldedFigureRenderSnapshot` | 10 | Unsupported |

## Diagnostic Matrix

| Upstream source | Behavior | Rust target | Stage | Status |
| --- | --- | --- | --- | --- |
| `Check1.java` | Check1 fold-line diagnostic. | `checks::check1` | 9 | Oracle-tested |
| `Check2.java` | Check2 fold-line diagnostic. | `checks::check2` | 9 | Oracle-tested |
| `Check3.java` | Check3 angle/Fushimi diagnostic. | `checks::check3` | 9 | Oracle-tested |
| `Check4.java` | Check4 CAMV/little-big-little diagnostic. | `checks::check4` | 9 | Oracle-tested |
| `FlatFoldabilityViolation.java` | Flat-foldability violation payload. | `checks::diagnostic` | 9 | Oracle-tested |
| `LittleBigLittleViolation.java` | Little-big-little violation payload. | `checks::diagnostic` | 9 | Oracle-tested |
| `MouseHandlerFlatFoldableCheck.java` | User-triggered flat-foldable check. | `checks::flat_foldable_boundary_check` | 9 | Oracle-tested |
| `MouseHandlerCreaseFixInaccurate.java` | Inaccurate line repair command. | `checks::fix_inaccurate_for_indices` | 9 | Oracle-tested |
| `Fix1.java` | Repair helper. | `operations::arrangement::fix1` | 9 | Oracle-tested |
| `Fix2.java` | Repair helper. | `operations::arrangement::fix2` | 9 | Oracle-tested |

## Oracle Fixture Families

The oracle harness should grow in the same order as the stages:

| Fixture family | Purpose | First stage |
| --- | --- | --- |
| `geometry-primitives` | Distance, angle, projection, intersection, circle helpers. | 2 |
| `model-roundtrip` | Fold lines, aux lines, selection, circles, text, colors. | 3 |
| `io-roundtrip` | `.cp`, `.fold`, `.ori`, `.orh`, `.obj`, `.dxf`. | 4 |
| `arrangement` | Add, split, overlap, delete, branch trim, fix inaccurate. | 5 |
| `selection` | Box, polygon, lasso, connected, line-intersection selection. | 6 |
| `color-transform` | Type changes, MV toggles, move/copy/lengthen transforms. | 6 |
| `construction` | Draw/restricted/symmetric/parallel/axiom/foldable commands. | 7 |
| `circle-generator` | Circle modes, polygon/base generators, Voronoi. | 8 |
| `checks` | Check1-Check4, CAMV, flat-foldability, repair diagnostics. | 9 |
| `folding` | Folding stages, subfaces, hierarchy, constraints, overlap search. | 10 |

## Stage 0 Completion Notes

This map intentionally over-includes non-UI behavior. Later stages may split a
row into several smaller operations, but they should not delete rows simply
because a behavior is difficult to port.

Before Stage 1 begins:

- Keep `Unsupported` as the default command result for every listed operation.
- Add any missed Oriedita class or command to this file before implementing it.
- If an upstream behavior turns out to be Swing-only, mark it
  `Out-of-scope-ui` with a reason rather than silently dropping it.
- If `treemaker-flatfold` can satisfy an Oriedita folding behavior, keep the row
  and change the future implementation note to a compatibility mapping.
