/**
 * Copy plain text to the system clipboard, reporting whether it worked.
 *
 * The async Clipboard API is the right path but it rejects with `NotAllowedError`
 * whenever the document isn't focused or the permission is denied — which would
 * leave a copy button silently doing nothing. Fall back to the `execCommand`
 * selection trick, which needs no permission, and report failure so the caller can
 * say so rather than claiming a copy that never happened.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}
