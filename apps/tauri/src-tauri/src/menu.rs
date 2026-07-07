use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{App, Emitter};

pub fn setup_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let app_about = MenuItemBuilder::with_id("app.about", "About Ori Studio").build(app)?;
    let app_quit = MenuItemBuilder::with_id("app.quit", "Quit Ori Studio")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Ori Studio")
        .item(&app_about)
        .separator()
        .item(&app_quit)
        .build()?;

    let file_new = MenuItemBuilder::with_id("file.new", "New")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let file_open = MenuItemBuilder::with_id("file.open", "Open...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let file_save = MenuItemBuilder::with_id("file.save", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let file_save_as = MenuItemBuilder::with_id("file.saveAs", "Save As...")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let file_export_v5 =
        MenuItemBuilder::with_id("file.exportV5", "Export TreeMaker 5...").build(app)?;
    let file_export_v4 =
        MenuItemBuilder::with_id("file.exportV4", "Export TreeMaker 4...").build(app)?;
    let file_export_cp = MenuItemBuilder::with_id("file.exportCp", "Export CP...").build(app)?;
    let file_export_fold =
        MenuItemBuilder::with_id("file.exportFold", "Export FOLD...").build(app)?;
    let file_export_svg = MenuItemBuilder::with_id("file.exportSvg", "Export SVG...").build(app)?;
    let file_export_png = MenuItemBuilder::with_id("file.exportPng", "Export PNG...").build(app)?;
    let file_settings = MenuItemBuilder::with_id("file.settings", "Settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&file_new)
        .item(&file_open)
        .separator()
        .item(&file_save)
        .item(&file_save_as)
        .separator()
        .item(&file_export_v5)
        .item(&file_export_v4)
        .item(&file_export_cp)
        .item(&file_export_fold)
        .item(&file_export_svg)
        .item(&file_export_png)
        .separator()
        .item(&file_settings)
        .build()?;

    let edit_undo = MenuItemBuilder::with_id("edit.undo", "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let edit_redo = MenuItemBuilder::with_id("edit.redo", "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
    let edit_cut = MenuItemBuilder::with_id("edit.cut", "Cut")
        .accelerator("CmdOrCtrl+X")
        .build(app)?;
    let edit_copy = MenuItemBuilder::with_id("edit.copy", "Copy")
        .accelerator("CmdOrCtrl+C")
        .build(app)?;
    let edit_paste = MenuItemBuilder::with_id("edit.paste", "Paste")
        .accelerator("CmdOrCtrl+V")
        .build(app)?;
    let edit_select_all = MenuItemBuilder::with_id("edit.selectAll", "Select All")
        .accelerator("CmdOrCtrl+A")
        .build(app)?;
    let edit_deselect = MenuItemBuilder::with_id("edit.deselectAll", "Deselect All").build(app)?;
    let edit_select_by_index =
        MenuItemBuilder::with_id("edit.selectByIndex", "Select By Index...").build(app)?;
    let edit_select_movable =
        MenuItemBuilder::with_id("edit.selectMovableParts", "Select Movable Parts").build(app)?;
    let edit_select_corridor =
        MenuItemBuilder::with_id("edit.selectCorridorFacets", "Select Corridor Facets")
            .build(app)?;
    let edit_delete = MenuItemBuilder::with_id("edit.delete", "Delete Selected")
        .accelerator("Backspace")
        .build(app)?;
    let edit_make_root = MenuItemBuilder::with_id("edit.makeRoot", "Make Root").build(app)?;
    let edit_split_edge = MenuItemBuilder::with_id("edit.splitEdge", "Split Edge...").build(app)?;
    let edit_set_edge_length =
        MenuItemBuilder::with_id("edit.setEdgeLength", "Set Edge Length...").build(app)?;
    let edit_scale_edge_lengths =
        MenuItemBuilder::with_id("edit.scaleEdgeLengths", "Scale Edge Lengths...").build(app)?;
    let edit_renormalize_edge =
        MenuItemBuilder::with_id("edit.renormalizeToEdge", "Renormalize To Edge").build(app)?;
    let edit_renormalize_scale =
        MenuItemBuilder::with_id("edit.renormalizeToUnitScale", "Renormalize To Unit Scale")
            .build(app)?;
    let edit_absorb_nodes =
        MenuItemBuilder::with_id("edit.absorbNodes", "Absorb Nodes").build(app)?;
    let edit_absorb_redundant =
        MenuItemBuilder::with_id("edit.absorbRedundantNodes", "Absorb Redundant Nodes")
            .build(app)?;
    let edit_absorb_edges =
        MenuItemBuilder::with_id("edit.absorbEdges", "Absorb Edges").build(app)?;
    let edit_perturb_nodes =
        MenuItemBuilder::with_id("edit.perturbNodes", "Perturb Nodes").build(app)?;
    let edit_perturb_all =
        MenuItemBuilder::with_id("edit.perturbAllNodes", "Perturb All Nodes").build(app)?;
    let edit_remove_strain =
        MenuItemBuilder::with_id("edit.removeStrain", "Remove Strain").build(app)?;
    let edit_remove_all_strain =
        MenuItemBuilder::with_id("edit.removeAllStrain", "Remove All Strain").build(app)?;
    let edit_relieve_strain =
        MenuItemBuilder::with_id("edit.relieveStrain", "Relieve Strain").build(app)?;
    let edit_relieve_all_strain =
        MenuItemBuilder::with_id("edit.relieveAllStrain", "Relieve All Strain").build(app)?;
    let edit_stub_nodes =
        MenuItemBuilder::with_id("edit.addLargestStubForNodes", "Add Largest Stub From Nodes")
            .build(app)?;
    let edit_stub_poly =
        MenuItemBuilder::with_id("edit.addLargestStubForPoly", "Add Largest Stub From Poly")
            .build(app)?;
    let edit_triangulate =
        MenuItemBuilder::with_id("edit.triangulateTree", "Triangulate Tree").build(app)?;

    let edit_select_menu = SubmenuBuilder::new(app, "Select")
        .item(&edit_select_all)
        .item(&edit_deselect)
        .item(&edit_select_by_index)
        .item(&edit_select_movable)
        .item(&edit_select_corridor)
        .build()?;
    let edit_node_menu = SubmenuBuilder::new(app, "Node")
        .item(&edit_make_root)
        .item(&edit_absorb_nodes)
        .item(&edit_absorb_redundant)
        .separator()
        .item(&edit_perturb_nodes)
        .item(&edit_perturb_all)
        .build()?;
    let edit_edge_menu = SubmenuBuilder::new(app, "Edge")
        .item(&edit_split_edge)
        .item(&edit_set_edge_length)
        .item(&edit_scale_edge_lengths)
        .separator()
        .item(&edit_renormalize_edge)
        .item(&edit_renormalize_scale)
        .item(&edit_absorb_edges)
        .build()?;
    let edit_strain_menu = SubmenuBuilder::new(app, "Strain")
        .item(&edit_remove_strain)
        .item(&edit_remove_all_strain)
        .separator()
        .item(&edit_relieve_strain)
        .item(&edit_relieve_all_strain)
        .build()?;
    let edit_stub_menu = SubmenuBuilder::new(app, "Stubs")
        .item(&edit_stub_nodes)
        .item(&edit_stub_poly)
        .separator()
        .item(&edit_triangulate)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&edit_undo)
        .item(&edit_redo)
        .separator()
        .item(&edit_cut)
        .item(&edit_copy)
        .item(&edit_paste)
        .separator()
        .item(&edit_delete)
        .separator()
        .item(&edit_select_menu)
        .item(&edit_node_menu)
        .item(&edit_edge_menu)
        .item(&edit_strain_menu)
        .item(&edit_stub_menu)
        .build()?;

    let view_design = MenuItemBuilder::with_id("view.design", "Design").build(app)?;
    let view_edit = MenuItemBuilder::with_id("view.edit", "Edit").build(app)?;
    let view_simulate = MenuItemBuilder::with_id("view.simulate", "Simulate").build(app)?;
    let view_conditions = MenuItemBuilder::with_id("view.conditions", "Conditions").build(app)?;
    let view_reset = MenuItemBuilder::with_id("view.resetLayout", "Reset Layout").build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&view_design)
        .item(&view_edit)
        .item(&view_simulate)
        .item(&view_conditions)
        .separator()
        .item(&view_reset)
        .build()?;

    let optimize_scale = MenuItemBuilder::with_id("optimize.scale", "Optimize Scale")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let optimize_edges = MenuItemBuilder::with_id("optimize.edges", "Optimize Edges").build(app)?;
    let optimize_strain =
        MenuItemBuilder::with_id("optimize.strain", "Optimize Strain").build(app)?;
    let build_cp = MenuItemBuilder::with_id("cp.build", "Build Crease Pattern")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;

    let design_menu = SubmenuBuilder::new(app, "Design")
        .item(&optimize_scale)
        .item(&optimize_edges)
        .item(&optimize_strain)
        .item(&build_cp)
        .build()?;

    let cp_folded_preview = MenuItemBuilder::with_id("cp.foldedPreview", "Show Folded Preview")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;
    let cp_delete_selected =
        MenuItemBuilder::with_id("cp.deleteSelectedLines", "Delete Selected CP Lines")
            .build(app)?;
    let cp_change_crease_type =
        MenuItemBuilder::with_id("cp.changeCreaseType", "Change Crease Type").build(app)?;
    let cp_advance_crease_type =
        MenuItemBuilder::with_id("cp.advanceCreaseType", "Advance Crease Type").build(app)?;
    let cp_make_mountain =
        MenuItemBuilder::with_id("cp.makeMountain", "Make Mountain").build(app)?;
    let cp_make_valley = MenuItemBuilder::with_id("cp.makeValley", "Make Valley").build(app)?;
    let cp_make_edge = MenuItemBuilder::with_id("cp.makeEdge", "Make Edge").build(app)?;
    let cp_make_auxiliary =
        MenuItemBuilder::with_id("cp.makeAuxiliary", "Make Auxiliary").build(app)?;
    let cp_toggle_mv =
        MenuItemBuilder::with_id("cp.toggleMountainValley", "Toggle Mountain/Valley").build(app)?;
    let cp_transform_flip_horizontal =
        MenuItemBuilder::with_id("cp.transformFlipHorizontal", "Flip Horizontal").build(app)?;
    let cp_transform_flip_vertical =
        MenuItemBuilder::with_id("cp.transformFlipVertical", "Flip Vertical").build(app)?;
    let cp_transform_rotate_left =
        MenuItemBuilder::with_id("cp.transformRotateLeft", "Rotate Left 90").build(app)?;
    let cp_transform_rotate_right =
        MenuItemBuilder::with_id("cp.transformRotateRight", "Rotate Right 90").build(app)?;
    let cp_replace_line_type =
        MenuItemBuilder::with_id("cp.replaceLineType", "Replace Selected Line Type...")
            .build(app)?;
    let cp_delete_line_type =
        MenuItemBuilder::with_id("cp.deleteLineType", "Delete Selected Line Type...").build(app)?;
    let cp_check_camv = MenuItemBuilder::with_id("cp.checkCamv", "Check CAMV")
        .accelerator("CmdOrCtrl+Shift+M")
        .build(app)?;
    let cp_check1 = MenuItemBuilder::with_id("cp.check1", "Check Overlaps").build(app)?;
    let cp_check2 = MenuItemBuilder::with_id("cp.check2", "Check T-junctions").build(app)?;
    let cp_check3 = MenuItemBuilder::with_id("cp.check3", "Check Vertex Foldability").build(app)?;
    let cp_check4 = MenuItemBuilder::with_id("cp.check4", "Check Maekawa/LBL").build(app)?;
    let cp_fix1 = MenuItemBuilder::with_id("cp.fix1", "Repair Overlaps").build(app)?;
    let cp_fix2 = MenuItemBuilder::with_id("cp.fix2", "Split T-junctions").build(app)?;
    let cp_fix_inaccurate =
        MenuItemBuilder::with_id("cp.fixInaccurate", "Fix Inaccurate Creases...").build(app)?;
    let cp_change_circle_color =
        MenuItemBuilder::with_id("cp.changeCircleColor", "Change Circle Color...").build(app)?;
    let cp_organize_circles =
        MenuItemBuilder::with_id("cp.organizeCircles", "Organize Circles").build(app)?;
    let cp_selected_lines_menu = SubmenuBuilder::new(app, "Selected Lines")
        .item(&cp_delete_selected)
        .separator()
        .item(&cp_change_crease_type)
        .item(&cp_advance_crease_type)
        .item(&cp_toggle_mv)
        .separator()
        .item(&cp_make_mountain)
        .item(&cp_make_valley)
        .item(&cp_make_edge)
        .item(&cp_make_auxiliary)
        .separator()
        .item(&cp_replace_line_type)
        .item(&cp_delete_line_type)
        .build()?;
    let cp_transform_selection_menu = SubmenuBuilder::new(app, "Transform Selection")
        .item(&cp_transform_flip_horizontal)
        .item(&cp_transform_flip_vertical)
        .separator()
        .item(&cp_transform_rotate_left)
        .item(&cp_transform_rotate_right)
        .build()?;
    let cp_diagnostics_menu = SubmenuBuilder::new(app, "Diagnostics")
        .item(&cp_check_camv)
        .item(&cp_check1)
        .item(&cp_check2)
        .item(&cp_check3)
        .item(&cp_check4)
        .build()?;
    let cp_repair_menu = SubmenuBuilder::new(app, "Repair")
        .item(&cp_fix1)
        .item(&cp_fix2)
        .item(&cp_fix_inaccurate)
        .build()?;
    let cp_annotations_menu = SubmenuBuilder::new(app, "Annotations")
        .item(&cp_change_circle_color)
        .item(&cp_organize_circles)
        .build()?;
    let cp_menu = SubmenuBuilder::new(app, "Crease Pattern")
        .item(&cp_folded_preview)
        .separator()
        .item(&cp_selected_lines_menu)
        .item(&cp_transform_selection_menu)
        .item(&cp_diagnostics_menu)
        .item(&cp_repair_menu)
        .item(&cp_annotations_menu)
        .build()?;

    let help_docs = MenuItemBuilder::with_id("help.documentation", "Ori Studio Help")
        .accelerator("F1")
        .build(app)?;
    let help_about = MenuItemBuilder::with_id("help.about", "About Ori Studio").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&help_docs)
        .separator()
        .item(&help_about)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&design_menu)
        .item(&cp_menu)
        .item(&help_menu)
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(move |app_handle, event| {
        let id = event.id().0.as_str();
        if let Err(error) = app_handle.emit("menu-action", id) {
            eprintln!("Failed to emit menu-action: {error}");
        }
    });

    Ok(())
}
