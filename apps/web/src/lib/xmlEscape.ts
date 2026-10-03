/** Escape a string for use as SVG/XML text or an attribute value. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Everything XML 1.0 cannot hold, even escaped: the C0 controls other than tab,
 * line feed and carriage return, U+FFFE and U+FFFF, and a surrogate that is not
 * half of a pair.
 */
const XML_ILLEGAL =
  // eslint-disable-next-line no-control-regex -- the controls are what it matches
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * User text made safe to write into an XML document: every character XML 1.0
 * cannot hold is removed.
 *
 * {@link escapeXml} handles the five characters that need an entity; this
 * handles the ones no entity can carry. A single U+000B pasted into an
 * instruction would otherwise make a whole composed page ill-formed, and the
 * browser would draw nothing for it. Apply it where text enters a document
 * (an edit, a file read), so what is stored is always writable.
 */
export function xmlText(value: string): string {
  return value.replace(XML_ILLEGAL, '');
}
