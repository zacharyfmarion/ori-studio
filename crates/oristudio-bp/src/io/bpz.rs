use crate::error::{BpError, BpResult};
use crate::io::bps;
use crate::model::Project;
use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub type WorkspaceFiles = BTreeMap<String, String>;
pub type WorkspaceFileEntries = Vec<(String, String)>;

pub fn read_workspace_files(bytes: &[u8]) -> BpResult<WorkspaceFiles> {
    Ok(read_workspace_entries(bytes)?.into_iter().collect())
}

pub fn read_workspace_entries(bytes: &[u8]) -> BpResult<WorkspaceFileEntries> {
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader)?;
    let mut files = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        if !file.is_file() {
            continue;
        }
        let mut text = String::new();
        file.read_to_string(&mut text)?;
        files.push((file.name().to_string(), text));
    }
    Ok(files)
}

pub fn read_workspace_projects(bytes: &[u8]) -> BpResult<Vec<Project>> {
    read_workspace_files(bytes)?
        .into_iter()
        .map(|(name, text)| {
            bps::load_project_str(&text)
                .map_err(|error| BpError::InvalidInput(format!("{name}: {error}")))
        })
        .collect()
}

pub fn read_workspace_project_entries(bytes: &[u8]) -> BpResult<Vec<(String, Project)>> {
    read_workspace_entries(bytes)?
        .into_iter()
        .map(|(name, text)| {
            bps::load_project_str(&text)
                .map(|project| (name.clone(), project))
                .map_err(|error| BpError::InvalidInput(format!("{name}: {error}")))
        })
        .collect()
}

pub fn write_workspace_files(files: &WorkspaceFiles) -> BpResult<Vec<u8>> {
    let entries: WorkspaceFileEntries = files
        .iter()
        .map(|(name, text)| (name.clone(), text.clone()))
        .collect();
    write_workspace_entries(&entries)
}

pub fn write_workspace_entries(files: &[(String, String)]) -> BpResult<Vec<u8>> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, text) in files {
        writer.start_file(name, options)?;
        writer.write_all(text.as_bytes())?;
    }
    let cursor = writer.finish()?;
    Ok(cursor.into_inner())
}

pub fn write_workspace_projects(projects: &[(String, Project)]) -> BpResult<Vec<u8>> {
    let projects = canonical_project_entries(projects)?;
    let mut files = BTreeMap::new();
    for (name, text) in projects {
        files.insert(name, text);
    }
    write_workspace_files(&files)
}

pub fn write_workspace_project_entries(projects: &[(String, Project)]) -> BpResult<Vec<u8>> {
    let entries = canonical_project_entries(projects)?;
    write_workspace_entries(&entries)
}

fn canonical_project_entries(projects: &[(String, Project)]) -> BpResult<WorkspaceFileEntries> {
    projects
        .iter()
        .map(|(name, project)| {
            let path = if name.ends_with(".bps") {
                name.clone()
            } else {
                format!("{name}.bps")
            };
            Ok((path, bps::save_project_string(project)?))
        })
        .collect()
}
