//! Ori Studio's diagram pages as one print-ready PDF (implementation-plans/
//! diagram-workspace.md, D11, route C).
//!
//! Each page is the SVG the Diagram composes (in pt), parsed by usvg against
//! the fonts handed in — and only those: no system font is ever looked up, so
//! a page prints the same on every machine — and drawn by krilla-svg into a
//! krilla page.
//!
//! - **At home:** the media box is the trim.
//! - **Print shop:** the media box is the trim plus bleed plus slug on every
//!   side, with a bleed box and a trim box, and crop marks from the bleed edge
//!   to the media edge in the registration colour. A page drawn past its trim
//!   (bleed art) shows up to the bleed edge; nothing is drawn in the slug but
//!   the marks.
//!
//! Text is never dropped or substituted quietly: a family the fonts do not
//! include, a weight they lack (`strict_resolver`), or a character its face
//! does not have (`note_unprinted_text`) fails the whole document. The
//! composer has already measured every line in the fonts it names, so a
//! substitute would not fit what was set.
//!
//! Links, scripts and external images never reach the file: an `<image>` that
//! is not a `data:` URL is refused by the parser, and nothing here writes an
//! action, an annotation or an attachment.

use std::sync::{Arc, Mutex};

use krilla::color::separation::{SeparationColorant, SeparationSpace};
use krilla::color::{Color, cmyk};
use krilla::geom::{PathBuilder, Rect, Size, Transform};
use krilla::metadata::Metadata;
use krilla::num::NormalizedF32;
use krilla::page::PageSettings;
use krilla::paint::{FillRule, LineCap, LineJoin, Paint, Stroke};
use krilla::{Document, SerializeSettings};
use krilla_svg::{SurfaceExt, SvgSettings};
use usvg::fontdb;

/// Points per millimetre.
pub const PT_PER_MM: f32 = 72.0 / 25.4;
/// usvg resolves every length to CSS px at 96 dpi.
const PX_PER_MM: f32 = 96.0 / 25.4;
/// How far a page's size may differ from what its options say, in mm.
const SIZE_TOLERANCE_MM: f32 = 0.05;
/// The crop marks' pen, in pt.
const CROP_MARK_WIDTH_PT: f32 = 0.25;

/// The marks a print shop needs around each page.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PrintShop {
    /// The bleed box's margin outside the trim, mm.
    pub bleed_mm: f32,
    /// The media's margin outside the bleed, where the crop marks are, mm.
    pub slug_mm: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PdfOptions {
    /// The trimmed page, mm.
    pub trim_mm: (f32, f32),
    /// How far each page SVG is drawn past its trim on every side, mm: 0 for a
    /// page drawn to its trim.
    pub art_bleed_mm: f32,
    /// Print-shop boxes and crop marks; `None` prints at home.
    pub print_shop: Option<PrintShop>,
    /// The document's title, in its metadata.
    pub title: Option<String>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum PdfError {
    #[error("{0}")]
    Options(String),
    #[error("a font could not be read")]
    Font,
    #[error("page {page}: {message}")]
    Page { page: usize, message: String },
    /// Text that would print other than as set: a family nothing matched, or a
    /// character no font has.
    #[error("page {page}: {message}")]
    Text { page: usize, message: String },
    #[error("the PDF could not be written: {0}")]
    Write(String),
}

/// Write `pages` as one PDF, its text set in `fonts` (TrueType or OpenType
/// files, matched to the pages' `font-family` by the names in the files).
pub fn pages_to_pdf(
    pages: &[&str],
    fonts: &[&[u8]],
    options: &PdfOptions,
) -> Result<Vec<u8>, PdfError> {
    let (trim_w, trim_h) = options.trim_mm;
    let marks = options.print_shop;
    let bleed = marks.map_or(0.0, |m| m.bleed_mm);
    let slug = marks.map_or(0.0, |m| m.slug_mm);
    let valid = |value: f32| value.is_finite() && value >= 0.0;
    let sizes = [trim_w, trim_h, options.art_bleed_mm, bleed, slug];
    if !sizes.into_iter().all(valid) || trim_w <= 0.0 || trim_h <= 0.0 {
        return Err(PdfError::Options(
            "sizes must be finite, and the trim positive".into(),
        ));
    }
    if pages.is_empty() {
        return Err(PdfError::Options("there are no pages".into()));
    }

    let mut database = fontdb::Database::new();
    for font in fonts {
        if database
            .load_font_source(fontdb::Source::Binary(Arc::new(font.to_vec())))
            .is_empty()
        {
            return Err(PdfError::Font);
        }
    }
    let default_family = database
        .faces()
        .next()
        .and_then(|face| face.families.first().map(|(family, _)| family.clone()))
        .unwrap_or_else(|| "sans-serif".to_string());
    // A generic family names the first font handed in, never a system one.
    database.set_sans_serif_family(default_family.clone());
    database.set_serif_family(default_family.clone());
    let loss = TextLoss::default();
    let parse_options = usvg::Options {
        font_family: default_family.clone(),
        font_resolver: strict_resolver(loss.clone(), default_family),
        fontdb: Arc::new(database),
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data: usvg::ImageHrefResolver::default_data_resolver(),
            // Never the file system or the network: a page's images are data URLs.
            resolve_string: Box::new(|_, _| None),
        },
        ..usvg::Options::default()
    };

    let mut document = Document::new_with(SerializeSettings {
        // No XMP: it would carry nothing a reader needs, and the file stays the
        // same bytes natively and in wasm.
        xmp_metadata: false,
        ..SerializeSettings::default()
    });
    let mut metadata = Metadata::new().producer("Ori Studio".to_string());
    if let Some(title) = &options.title {
        metadata = metadata.title(title.clone());
    }
    document.set_metadata(metadata);

    let margin = bleed + slug;
    for (index, svg) in pages.iter().enumerate() {
        let page_number = index + 1;
        loss.take();
        let tree = usvg::Tree::from_str(svg, &parse_options).map_err(|error| PdfError::Page {
            page: page_number,
            message: error.to_string(),
        })?;
        note_unprinted_text(tree.root(), &loss);
        if let Some(message) = loss.take().into_iter().next() {
            return Err(PdfError::Text {
                page: page_number,
                message,
            });
        }
        let art_w = tree.size().width() / PX_PER_MM;
        let art_h = tree.size().height() / PX_PER_MM;
        let art_bleed = options.art_bleed_mm;
        if (art_w - (trim_w + 2.0 * art_bleed)).abs() > SIZE_TOLERANCE_MM
            || (art_h - (trim_h + 2.0 * art_bleed)).abs() > SIZE_TOLERANCE_MM
        {
            return Err(PdfError::Page {
                page: page_number,
                message: format!(
                    "the page is {art_w:.2} × {art_h:.2} mm, not the trim {trim_w} × {trim_h} mm and {art_bleed} mm of bleed art"
                ),
            });
        }

        let media = mm_rect(0.0, 0.0, trim_w + 2.0 * margin, trim_h + 2.0 * margin)?;
        let trim = mm_rect(margin, margin, trim_w, trim_h)?;
        let mut settings = PageSettings::new(size_of(media)?).with_media_box(Some(media));
        if marks.is_some() {
            settings = settings
                .with_trim_box(Some(trim))
                .with_bleed_box(Some(mm_rect(
                    slug,
                    slug,
                    trim_w + 2.0 * bleed,
                    trim_h + 2.0 * bleed,
                )?));
        }
        let mut page = document.start_page_with(settings);
        let mut surface = page.surface();

        // The art sits round the trim; what it draws past the bleed edge is cut
        // off there, so the slug carries the marks alone.
        let shown = bleed.min(art_bleed);
        let mut clip = PathBuilder::new();
        clip.push_rect(mm_rect(
            margin - shown,
            margin - shown,
            trim_w + 2.0 * shown,
            trim_h + 2.0 * shown,
        )?);
        let clip = clip
            .finish()
            .ok_or_else(|| PdfError::Write("the page clip".into()))?;
        let art = mm_rect(margin - art_bleed, margin - art_bleed, art_w, art_h)?;
        surface.push_clip_path(&clip, &FillRule::NonZero);
        surface.push_transform(&Transform::from_translate(art.left(), art.top()));
        surface
            .draw_svg(
                &tree,
                size_of(art)?,
                SvgSettings {
                    embed_text: true,
                    ..SvgSettings::default()
                },
            )
            .ok_or_else(|| PdfError::Page {
                page: page_number,
                message: "the page could not be drawn".into(),
            })?;
        surface.pop();
        surface.pop();

        if let Some(PrintShop { bleed_mm, slug_mm }) = marks {
            draw_crop_marks(
                &mut surface,
                trim,
                bleed_mm * PT_PER_MM,
                (bleed_mm + slug_mm) * PT_PER_MM,
            )?;
        }
        surface.finish();
        page.finish();
    }
    document
        .finish()
        .map_err(|error| PdfError::Write(format!("{error:?}")))
}

/// Crop marks at the four trim corners, along the trim lines, from `start` to
/// `end` pt outside them, in the registration colour every plate prints.
fn draw_crop_marks(
    surface: &mut krilla::surface::Surface<'_>,
    trim: Rect,
    start: f32,
    end: f32,
) -> Result<(), PdfError> {
    if end <= start {
        return Ok(());
    }
    let registration = SeparationSpace::new(
        SeparationColorant::AllColorants,
        cmyk::Color::new(255, 255, 255, 255).into(),
    );
    let paint: Paint = Color::from(krilla::color::separation::Color::new(255, registration)).into();
    surface.set_fill(None);
    surface.set_stroke(Some(Stroke {
        paint,
        width: CROP_MARK_WIDTH_PT,
        miter_limit: 4.0,
        line_cap: LineCap::Butt,
        line_join: LineJoin::Miter,
        opacity: NormalizedF32::ONE,
        dash: None,
    }));
    let mut marks = PathBuilder::new();
    for (x, outward_x) in [(trim.left(), -1.0f32), (trim.right(), 1.0)] {
        for (y, outward_y) in [(trim.top(), -1.0f32), (trim.bottom(), 1.0)] {
            marks.move_to(x + outward_x * start, y);
            marks.line_to(x + outward_x * end, y);
            marks.move_to(x, y + outward_y * start);
            marks.line_to(x, y + outward_y * end);
        }
    }
    let marks = marks
        .finish()
        .ok_or_else(|| PdfError::Write("the crop marks".into()))?;
    surface.draw_path(&marks);
    surface.set_stroke(None);
    Ok(())
}

fn mm_rect(x: f32, y: f32, width: f32, height: f32) -> Result<Rect, PdfError> {
    Rect::from_xywh(
        x * PT_PER_MM,
        y * PT_PER_MM,
        width * PT_PER_MM,
        height * PT_PER_MM,
    )
    .ok_or_else(|| PdfError::Options("a page box has no size".into()))
}

fn size_of(rect: Rect) -> Result<Size, PdfError> {
    Size::from_wh(rect.width(), rect.height())
        .ok_or_else(|| PdfError::Options("a page box has no size".into()))
}

/// What went wrong with one page's text: a family nothing matched, a weight
/// the family lacks, a character its face does not have.
#[derive(Clone, Default)]
struct TextLoss(Arc<Mutex<Vec<String>>>);

impl TextLoss {
    fn note(&self, message: String) {
        if let Ok(mut notes) = self.0.lock() {
            notes.push(message);
        }
    }

    fn take(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut notes| std::mem::take(&mut *notes))
            .unwrap_or_default()
    }
}

/// A resolver that sets text only as the page names it.
///
/// The first family a text names must be one of the fonts handed in, at the
/// weight and style it asks for: the composer measured every line in exactly
/// that face, and a lighter or wider substitute would not fit what it set. A
/// generic family (`sans-serif`) is the first font handed in.
///
/// A character the face lacks is never looked for in another. Nothing is
/// noted for it here: usvg shapes a run of text in each of its spans' faces
/// and keeps each span's own glyphs, so a span's face is asked for characters
/// of the others. Whether one is drawn as nothing is known from the glyphs
/// laid out (`note_unprinted_text`).
fn strict_resolver(loss: TextLoss, default_family: String) -> usvg::FontResolver<'static> {
    usvg::FontResolver {
        select_font: Box::new(move |font, database| {
            let first = font.families().first();
            let family = match first {
                Some(usvg::FontFamily::Named(name)) => name.clone(),
                _ => default_family.clone(),
            };
            let style = match font.style() {
                usvg::FontStyle::Normal => fontdb::Style::Normal,
                usvg::FontStyle::Italic => fontdb::Style::Italic,
                usvg::FontStyle::Oblique => fontdb::Style::Oblique,
            };
            let query = fontdb::Query {
                families: &[fontdb::Family::Name(&family)],
                weight: fontdb::Weight(font.weight()),
                stretch: fontdb::Stretch::Normal,
                style,
            };
            let id = database.query(&query);
            match id.and_then(|id| database.face(id)) {
                None => loss.note(format!("no font named '{family}'")),
                Some(face) if face.weight.0 != font.weight() => loss.note(format!(
                    "'{family}' has no face of weight {}",
                    font.weight()
                )),
                Some(_) => {}
            }
            id
        }),
        select_fallback: Box::new(|_, _, _| None),
    }
}

/// Every glyph a face lacks that a page would draw, as its missing-glyph box,
/// and any text that could not be laid out at all — usvg drops a run whose
/// spans' faces shape it to different numbers of glyphs — in the page's
/// groups and in everything they draw from: clip paths, masks, patterns.
fn note_unprinted_text(group: &usvg::Group, loss: &TextLoss) {
    for node in group.children() {
        match node {
            usvg::Node::Group(child) => note_unprinted_text(child, loss),
            usvg::Node::Text(text) => {
                let glyphs = text
                    .layouted()
                    .iter()
                    .flat_map(|span| &span.positioned_glyphs);
                for glyph in glyphs.filter(|glyph| glyph.id.0 == 0) {
                    let code_points: Vec<String> = glyph
                        .text
                        .chars()
                        .map(|character| format!("U+{:04X}", u32::from(character)))
                        .collect();
                    loss.note(format!("no glyph for {}", code_points.join(" ")));
                }
                let drawn = text
                    .chunks()
                    .iter()
                    .any(|chunk| chunk.text().chars().any(|c| !c.is_whitespace()));
                if drawn && text.layouted().is_empty() {
                    loss.note("a text could not be laid out in its fonts".into());
                }
            }
            _ => {}
        }
        node.subroots(|root| note_unprinted_text(root, loss));
    }
}
