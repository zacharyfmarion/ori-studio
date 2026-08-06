/**
 * BP Studio numbers `.cp` crease types Mountain=2, Valley=3 (ORIPA style); our
 * Oriedita-based CP editor reads 2=valley, 3=mountain. The two are faithful ports
 * of tools that genuinely use opposite `.cp` conventions, so bridge them at the
 * hand-off: swap the per-line type token (2↔3) so a BP design's mountains and
 * valleys render correctly on the Edit canvas. Border(1)/Auxiliary(4) are shared.
 */
export function bpCpToEditorConvention(cpText: string): string {
  return cpText
    .split('\n')
    .map((line) => {
      const parts = line.split(' ');
      if (parts[0] === '2') parts[0] = '3';
      else if (parts[0] === '3') parts[0] = '2';
      return parts.join(' ');
    })
    .join('\n');
}
