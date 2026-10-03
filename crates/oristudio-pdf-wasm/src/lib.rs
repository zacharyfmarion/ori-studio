//! `wasm-bindgen` wrapper around `oristudio-pdf`: the Diagram's pages as one
//! PDF, in the browser and the desktop webview alike.
//!
//! ```ts
//! export interface PdfOptions {
//!   trimWidthMm: number; trimHeightMm: number;
//!   /** How far each page SVG is drawn past its trim on every side; 0 for a page drawn to its trim. */
//!   artBleedMm: number;
//!   /** Print-shop boxes and crop marks; absent prints at home. */
//!   printShop?: { bleedMm: number; slugMm: number };
//!   title?: string;
//! }
//! /** The PDF's bytes. Throws `{ code, message }` for options, fonts, a page or text it would not print as set. */
//! export function pages_to_pdf(pages: string[], fonts: Uint8Array[], options: PdfOptions): Uint8Array;
//! ```

use js_sys::{Object, Reflect, Uint8Array};
use oristudio_pdf::{PdfError, PdfOptions, PrintShop};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn pages_to_pdf(
    pages: Vec<String>,
    fonts: Vec<Uint8Array>,
    options: JsValue,
) -> Result<Vec<u8>, JsValue> {
    let options = read_options(&options).map_err(|message| error("options", &message))?;
    let fonts: Vec<Vec<u8>> = fonts.iter().map(Uint8Array::to_vec).collect();
    let font_refs: Vec<&[u8]> = fonts.iter().map(Vec::as_slice).collect();
    let page_refs: Vec<&str> = pages.iter().map(String::as_str).collect();
    oristudio_pdf::pages_to_pdf(&page_refs, &font_refs, &options).map_err(|failure| {
        let code = match failure {
            PdfError::Options(_) => "options",
            PdfError::Font => "font",
            PdfError::Page { .. } => "page",
            PdfError::Text { .. } => "text",
            PdfError::Write(_) => "write",
        };
        error(code, &failure.to_string())
    })
}

fn read_options(value: &JsValue) -> Result<PdfOptions, String> {
    let number = |object: &JsValue, key: &str| -> Result<f32, String> {
        Reflect::get(object, &JsValue::from_str(key))
            .ok()
            .and_then(|value| value.as_f64())
            .map(|value| value as f32)
            .ok_or_else(|| format!("{key} must be a number"))
    };
    let print_shop =
        Reflect::get(value, &JsValue::from_str("printShop")).unwrap_or(JsValue::UNDEFINED);
    let print_shop = if print_shop.is_undefined() || print_shop.is_null() {
        None
    } else {
        Some(PrintShop {
            bleed_mm: number(&print_shop, "bleedMm")?,
            slug_mm: number(&print_shop, "slugMm")?,
        })
    };
    let title = Reflect::get(value, &JsValue::from_str("title"))
        .ok()
        .and_then(|title| title.as_string());
    Ok(PdfOptions {
        trim_mm: (
            number(value, "trimWidthMm")?,
            number(value, "trimHeightMm")?,
        ),
        art_bleed_mm: number(value, "artBleedMm")?,
        print_shop,
        title,
    })
}

/// The `{ code, message }` envelope the other bridges throw.
fn error(code: &str, message: &str) -> JsValue {
    let envelope = Object::new();
    let _ = Reflect::set(
        &envelope,
        &JsValue::from_str("code"),
        &JsValue::from_str(code),
    );
    let _ = Reflect::set(
        &envelope,
        &JsValue::from_str("message"),
        &JsValue::from_str(message),
    );
    envelope.into()
}
