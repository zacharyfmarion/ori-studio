use oristudio_pdf::{PT_PER_MM, PdfError, PdfOptions, PrintShop, pages_to_pdf};

const REGULAR: &[u8] = include_bytes!("../../../apps/web/src/diagram/fonts/NotoSans-Regular.ttf");
const BOLD: &[u8] = include_bytes!("../../../apps/web/src/diagram/fonts/NotoSans-Bold.ttf");

const SC_BOLD: &[u8] =
    include_bytes!("../../../apps/web/src/diagram/fonts/fixtures/NotoSansSC-Bold.fixture.ttf");

/// An A4 page in pt, as the composer writes one, with `extra_mm` of art past the trim.
fn page(text: &str, family: &str, extra_mm: f32) -> String {
    a4_page(
        &format!(
            r#"<text xml:space="preserve" font-size="10" font-weight="700"><tspan x="40" y="80" font-family="'{family}', sans-serif">{text}</tspan></text>"#
        ),
        extra_mm,
    )
}

/// An A4 page in pt drawing `body`, with `extra_mm` of art past the trim.
fn a4_page(body: &str, extra_mm: f32) -> String {
    let width = (210.0 + 2.0 * extra_mm) * PT_PER_MM;
    let height = (297.0 + 2.0 * extra_mm) * PT_PER_MM;
    format!(
        r##"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{width}pt" height="{height}pt" viewBox="0 0 {width} {height}">
<rect x="0" y="0" width="{width}" height="40" fill="#16191c"/>
{body}
</svg>"##
    )
}

/// One run of text in two fonts, its spans placed by the text, as an upload's are.
fn two_font_text(latin: &str, han: &str) -> String {
    format!(
        r#"<text x="40" y="80" font-size="10" font-weight="700"><tspan font-family="'Noto Sans', sans-serif">{latin}</tspan><tspan font-family="'Noto Sans SC', sans-serif">{han}</tspan></text>"#
    )
}

fn a4(print_shop: Option<PrintShop>, art_bleed_mm: f32) -> PdfOptions {
    PdfOptions {
        trim_mm: (210.0, 297.0),
        art_bleed_mm,
        print_shop,
        title: Some("Crane".into()),
    }
}

const SHOP: PrintShop = PrintShop {
    bleed_mm: 3.0,
    slug_mm: 5.0,
};

/// The numbers after `key` in the file, e.g. a box's corners.
fn boxes(pdf: &[u8], key: &str) -> Vec<Vec<f32>> {
    let text = String::from_utf8_lossy(pdf);
    text.match_indices(key)
        .filter_map(|(at, _)| {
            let rest = &text[at + key.len()..];
            let open = rest.find('[')?;
            let close = rest.find(']')?;
            Some(
                rest[open + 1..close]
                    .split_whitespace()
                    .filter_map(|n| n.parse().ok())
                    .collect(),
            )
        })
        .collect()
}

fn close(a: &[f32], b: &[f32]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() < 0.05)
}

#[test]
fn prints_at_home_on_the_trim_alone() {
    let pdf = pages_to_pdf(
        &[&page("Crane", "Noto Sans", 0.0)],
        &[REGULAR, BOLD],
        &a4(None, 0.0),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
    let media = boxes(&pdf, "/MediaBox");
    assert!(
        close(&media[0], &[0.0, 0.0, 210.0 * PT_PER_MM, 297.0 * PT_PER_MM]),
        "{media:?}"
    );
    assert!(boxes(&pdf, "/TrimBox").is_empty());
    assert!(boxes(&pdf, "/BleedBox").is_empty());
}

#[test]
fn gives_a_print_shop_its_bleed_slug_and_boxes() {
    let pdf = pages_to_pdf(
        &[&page("Crane", "Noto Sans", 3.0)],
        &[REGULAR, BOLD],
        &a4(Some(SHOP), 3.0),
    )
    .unwrap();
    let mm = PT_PER_MM;
    assert!(close(
        &boxes(&pdf, "/MediaBox")[0],
        &[0.0, 0.0, 226.0 * mm, 313.0 * mm]
    ));
    assert!(close(
        &boxes(&pdf, "/BleedBox")[0],
        &[5.0 * mm, 5.0 * mm, 221.0 * mm, 308.0 * mm]
    ));
    assert!(close(
        &boxes(&pdf, "/TrimBox")[0],
        &[8.0 * mm, 8.0 * mm, 218.0 * mm, 305.0 * mm]
    ));
    // The marks' colour prints on every plate.
    assert!(String::from_utf8_lossy(&pdf).contains("/Separation/All"));
}

#[test]
fn embeds_the_fonts_it_was_given_and_names_its_title() {
    let pdf = pages_to_pdf(
        &[&page("Crane", "Noto Sans", 0.0)],
        &[REGULAR, BOLD],
        &a4(None, 0.0),
    )
    .unwrap();
    let text = String::from_utf8_lossy(&pdf);
    assert!(
        text.contains("NotoSans-Bold"),
        "the bold face is the one the page asked for"
    );
    assert!(text.contains("/ToUnicode"), "the text can be copied out");
    assert!(text.contains("Crane"));
}

#[test]
fn refuses_text_it_would_set_in_another_font() {
    let error = pages_to_pdf(
        &[&page("Crane", "Some Other Sans", 0.0)],
        &[REGULAR],
        &a4(None, 0.0),
    )
    .unwrap_err();
    assert!(matches!(error, PdfError::Text { page: 1, .. }), "{error:?}");
}

#[test]
fn refuses_a_weight_the_fonts_lack_rather_than_print_regular_as_bold() {
    let error = pages_to_pdf(
        &[&page("Crane", "Noto Sans", 0.0)],
        &[REGULAR],
        &a4(None, 0.0),
    )
    .unwrap_err();
    assert!(
        matches!(&error, PdfError::Text { page: 1, message } if message.contains("weight 700")),
        "{error:?}"
    );
}

#[test]
fn refuses_a_character_no_font_has() {
    let error = pages_to_pdf(
        &[&page("Crane 鶴", "Noto Sans", 0.0)],
        &[REGULAR, BOLD],
        &a4(None, 0.0),
    )
    .unwrap_err();
    assert!(
        matches!(&error, PdfError::Text { message, .. } if message.contains("U+9DB4")),
        "{error:?}"
    );
}

#[test]
fn prints_a_run_of_text_whose_spans_are_set_in_different_fonts() {
    // Each span's face is asked to shape the whole run, the other's characters too.
    let pdf = pages_to_pdf(
        &[&a4_page(&two_font_text("Fold ", "折"), 0.0)],
        &[BOLD, SC_BOLD],
        &a4(None, 0.0),
    )
    .expect("both spans are set in faces that have them");
    let text = String::from_utf8_lossy(&pdf);
    assert!(text.contains("NotoSans-Bold") && text.contains("NotoSansSC"));
}

#[test]
fn refuses_a_span_whose_own_face_lacks_a_character() {
    let error = pages_to_pdf(
        &[&a4_page(&two_font_text("Fold 折", "折"), 0.0)],
        &[BOLD, SC_BOLD],
        &a4(None, 0.0),
    )
    .unwrap_err();
    assert!(
        matches!(&error, PdfError::Text { message, .. } if message.contains("U+6298")),
        "{error:?}"
    );
}

#[test]
fn refuses_a_page_of_another_size() {
    let error = pages_to_pdf(
        &[&page("Crane", "Noto Sans", 0.0)],
        &[REGULAR, BOLD],
        &a4(Some(SHOP), 3.0),
    )
    .unwrap_err();
    assert!(matches!(error, PdfError::Page { page: 1, .. }), "{error:?}");
}

#[test]
fn never_reads_an_image_from_outside_the_page() {
    let svg = page("Crane", "Noto Sans", 0.0).replace(
        "</svg>",
        r#"<image href="file:///etc/hosts" width="100" height="100"/><image href="https://example.com/a.png" width="10" height="10"/></svg>"#,
    );
    let pdf = pages_to_pdf(&[&svg], &[REGULAR, BOLD], &a4(None, 0.0)).unwrap();
    let text = String::from_utf8_lossy(&pdf);
    assert!(!text.contains("localhost"));
    assert!(!text.contains("/XObject") || !text.contains("/Image"));
    assert!(!text.contains("/URI"));
}

#[test]
fn writes_the_same_bytes_every_time() {
    let pages = [
        page("Crane", "Noto Sans", 0.0),
        page("Page two", "Noto Sans", 0.0),
    ];
    let refs: Vec<&str> = pages.iter().map(String::as_str).collect();
    let first = pages_to_pdf(&refs, &[REGULAR, BOLD], &a4(None, 0.0)).unwrap();
    let second = pages_to_pdf(&refs, &[REGULAR, BOLD], &a4(None, 0.0)).unwrap();
    assert_eq!(first, second);
    assert_eq!(boxes(&first, "/MediaBox").len(), 2);
}

#[test]
fn refuses_options_with_no_page_to_print() {
    assert!(matches!(
        pages_to_pdf(&[], &[REGULAR], &a4(None, 0.0)),
        Err(PdfError::Options(_))
    ));
    let mut options = a4(None, 0.0);
    options.trim_mm = (f32::NAN, 297.0);
    assert!(matches!(
        pages_to_pdf(&[&page("x", "Noto Sans", 0.0)], &[REGULAR], &options),
        Err(PdfError::Options(_))
    ));
    assert_eq!(
        pages_to_pdf(
            &[&page("x", "Noto Sans", 0.0)],
            &[b"not a font"],
            &a4(None, 0.0)
        ),
        Err(PdfError::Font)
    );
}
