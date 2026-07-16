use crate::error::{BpError, BpResult};
use crate::math::{lcm, to_fraction};
use crate::model::{Flap, GridType, NodeId, Project, Sheet, Vertex};

const FRACTION_ERROR: f64 = 0.1;
const MIN_SHEET_SIZE: f64 = 8.0;

pub fn tree_maker(title: &str, data: &str) -> BpResult<Project> {
    let visitor = TreeMakerVisitor::new(data);
    let mut project = TreeMakerParser::parse(visitor)?.into_project();
    project.design.title = title.to_string();
    Ok(project)
}

#[derive(Debug, Clone)]
pub struct TreeMakerVisitor<'a> {
    lines: std::str::Split<'a, char>,
}

impl<'a> TreeMakerVisitor<'a> {
    pub fn new(data: &'a str) -> Self {
        Self {
            lines: data.split('\n'),
        }
    }

    pub fn next_token(&mut self) -> BpResult<&'a str> {
        self.lines
            .next()
            .map(str::trim)
            .ok_or_else(|| invalid_tree_maker("unexpected end of TreeMaker stream"))
    }

    pub fn int(&mut self) -> BpResult<i64> {
        parse_js_int(self.next_token()?)
    }

    pub fn node_id(&mut self) -> BpResult<NodeId> {
        let id = self.int()?;
        if id < 0 || id > NodeId::MAX as i64 {
            return Err(invalid_tree_maker("TreeMaker node id is out of range"));
        }
        Ok(id as NodeId)
    }

    pub fn float(&mut self) -> BpResult<f64> {
        parse_js_float(self.next_token()?)
    }

    pub fn bool(&mut self) -> BpResult<bool> {
        Ok(self.next_token()? == "true")
    }

    pub fn skip(&mut self, n: usize) {
        for _ in 0..n {
            let _ = self.lines.next();
        }
    }

    pub fn skip_array(&mut self) -> BpResult<()> {
        let count = self.int()?;
        if count > 0 {
            self.skip(count as usize);
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct TreeMakerParser {
    result: Project,
}

impl TreeMakerParser {
    pub fn parse(mut visitor: TreeMakerVisitor<'_>) -> BpResult<Self> {
        if visitor.next_token()? != "tree" || visitor.next_token()? != "5.0" {
            return Err(invalid_tree_maker("not a TreeMaker 5.0 stream"));
        }

        let width = visitor.float()?;
        let height = visitor.float()?;
        let scale = 1.0 / visitor.float()?;

        visitor.skip(11);
        let node_count = visitor.int()?;
        let edge_count = visitor.int()?;
        if node_count < 0 || edge_count < 0 {
            return Err(invalid_tree_maker("negative TreeMaker record count"));
        }

        let mut parser = Self {
            result: Project::sample(),
        };
        let mut denominators = Vec::new();

        visitor.skip(6);
        for _ in 0..node_count {
            parser.parse_node(&mut visitor)?;
        }
        for _ in 0..edge_count {
            parser.parse_edge(&mut visitor, &mut denominators)?;
        }

        let fix = if denominators.is_empty() {
            1
        } else {
            lcm(&denominators)
        };
        let fix_f = fix as f64;
        let sheet_width = (width * scale * fix_f - 0.25).ceil();
        let sheet_height = (height * scale * fix_f - 0.25).ceil();
        if !sheet_width.is_finite()
            || !sheet_height.is_finite()
            || sheet_width < MIN_SHEET_SIZE
            || sheet_height < MIN_SHEET_SIZE
        {
            return Err(invalid_tree_maker(
                "TreeMaker import sheet must be at least 8 by 8",
            ));
        }

        let fx = sheet_width / width;
        let fy = sheet_height / height;
        for flap in &mut parser.result.design.layout.flaps {
            flap.x = (flap.x * fx).round();
            flap.y = (flap.y * fy).round();
        }
        for node in &mut parser.result.design.tree.nodes {
            node.x = (node.x * fx).round();
            node.y = (node.y * fy).round();
        }
        for edge in &mut parser.result.design.tree.edges {
            edge.length = (edge.length * fix_f).round().max(1.0);
        }

        let sheet = Sheet {
            grid_type: GridType::Rectangular,
            width: sheet_width,
            height: sheet_height,
        };
        parser.result.design.layout.sheet = sheet.clone();
        parser.result.design.tree.sheet = sheet;

        Ok(parser)
    }

    pub fn result(&self) -> &Project {
        &self.result
    }

    pub fn into_project(self) -> Project {
        self.result
    }

    fn parse_node(&mut self, visitor: &mut TreeMakerVisitor<'_>) -> BpResult<()> {
        if visitor.next_token()? != "node" {
            return Err(invalid_tree_maker("expected TreeMaker node record"));
        }
        let vertex = Vertex {
            id: visitor.node_id()?,
            name: visitor.next_token()?.to_string(),
            x: visitor.float()?,
            y: visitor.float()?,
            is_new: None,
        };

        visitor.skip(2);
        if visitor.bool()? {
            self.result.design.layout.flaps.push(Flap {
                id: vertex.id,
                x: vertex.x,
                y: vertex.y,
                width: 0.0,
                height: 0.0,
            });
        }
        self.result.design.tree.nodes.push(vertex);

        visitor.skip(6);
        visitor.skip_array()?;
        visitor.skip_array()?;
        visitor.skip_array()?;
        if visitor.next_token()? == "1" {
            let _ = visitor.next_token()?;
        }
        Ok(())
    }

    fn parse_edge(
        &mut self,
        visitor: &mut TreeMakerVisitor<'_>,
        denominators: &mut Vec<u64>,
    ) -> BpResult<()> {
        if visitor.next_token()? != "edge" {
            return Err(invalid_tree_maker("expected TreeMaker edge record"));
        }
        visitor.skip(2);
        let length = visitor.float()?;
        denominators.push(to_fraction(length, FRACTION_ERROR)?.denominator());
        let strain = visitor.float()?;
        visitor.skip(4);
        self.result.design.tree.edges.push(crate::model::Edge {
            length: length * (1.0 + strain),
            n1: visitor.node_id()?,
            n2: visitor.node_id()?,
        });
        Ok(())
    }
}

fn invalid_tree_maker(reason: impl Into<String>) -> BpError {
    BpError::InvalidInput(format!("invalid TreeMaker 5 import: {}", reason.into()))
}

fn parse_js_int(value: &str) -> BpResult<i64> {
    let trimmed = value.trim_start();
    let mut end = 0;
    let mut seen_digit = false;
    for (index, ch) in trimmed.char_indices() {
        if index == 0 && matches!(ch, '+' | '-') {
            end = ch.len_utf8();
            continue;
        }
        if ch.is_ascii_digit() {
            end = index + ch.len_utf8();
            seen_digit = true;
        } else {
            break;
        }
    }
    if !seen_digit {
        return Err(invalid_tree_maker(format!(
            "invalid integer token {value:?}"
        )));
    }
    trimmed[..end]
        .parse::<i64>()
        .map_err(|_| invalid_tree_maker(format!("invalid integer token {value:?}")))
}

fn parse_js_float(value: &str) -> BpResult<f64> {
    let trimmed = value.trim_start();
    let Some(end) = js_float_prefix_len(trimmed) else {
        return Err(invalid_tree_maker(format!("invalid float token {value:?}")));
    };
    trimmed[..end]
        .parse::<f64>()
        .map_err(|_| invalid_tree_maker(format!("invalid float token {value:?}")))
}

fn js_float_prefix_len(value: &str) -> Option<usize> {
    let bytes = value.as_bytes();
    let mut index = 0;
    if matches!(bytes.get(index), Some(b'+') | Some(b'-')) {
        index += 1;
    }
    if value[index..].starts_with("Infinity") {
        return Some(index + "Infinity".len());
    }

    let mut seen_digit = false;
    while matches!(bytes.get(index), Some(b'0'..=b'9')) {
        index += 1;
        seen_digit = true;
    }
    if matches!(bytes.get(index), Some(b'.')) {
        index += 1;
        while matches!(bytes.get(index), Some(b'0'..=b'9')) {
            index += 1;
            seen_digit = true;
        }
    }
    if !seen_digit {
        return None;
    }

    let before_exponent = index;
    if matches!(bytes.get(index), Some(b'e') | Some(b'E')) {
        index += 1;
        if matches!(bytes.get(index), Some(b'+') | Some(b'-')) {
            index += 1;
        }
        let exponent_start = index;
        while matches!(bytes.get(index), Some(b'0'..=b'9')) {
            index += 1;
        }
        if exponent_start == index {
            index = before_exponent;
        }
    }
    Some(index)
}
