import { Trans } from 'react-i18next';

/**
 * Quiet attribution bar crediting the upstream project a design surface is
 * ported from, and pointing at its donation page where it has one.
 *
 * The credit is the point; the SPDX tag is not. ExplOri gives the space to a
 * donation link instead, because it is one person's unpaid work and a live link
 * does more for them than the word "MIT" does. The license obligations are met
 * by `NOTICE` and the About dialog, which carry the full copyright and
 * permission text — this bar never was where that lived.
 *
 * Placement differs by design method so the bar underlines only the design
 * canvas, never tool panes: box-pleat renders it at the workspace level spanning
 * both BP panes (see WorkspaceShell), while TreeMaker renders it inside the
 * design pane so the inspector/diagnostics/conditions side panes stay clear (see
 * DesignPanel). The full copyright and permission notices live in the repository
 * `NOTICE` file and the in-app About dialog; this bar is the visible, in-context
 * attribution.
 */
export function DesignAttributionFooter({ method }: { method: 'tree' | 'bp' | 'explori' }) {
  if (method === 'explori') {
    return (
      <footer className="design-attribution" role="contentinfo">
        <span className="design-attribution__text">
          <Trans i18nKey="panels:design.attributionExplori">
            Searches{' '}
            <a
              className="design-attribution__link"
              href="https://225.designorigami.net/"
              target="_blank"
              rel="noreferrer noopener"
            >
              ExplOri 22.5
            </a>{' '}
            by theplantpsychologist ·{' '}
            <a
              className="design-attribution__link"
              href="https://www.paypal.com/paypalme/theplantpsychologist"
              target="_blank"
              rel="noreferrer noopener"
            >
              Donate
            </a>
          </Trans>
        </span>
      </footer>
    );
  }

  if (method === 'bp') {
    return (
      <footer className="design-attribution" role="contentinfo">
        <span className="design-attribution__text">
          <Trans i18nKey="panels:design.attributionBoxPleating">
            Adapted from{' '}
            <a
              className="design-attribution__link"
              href="https://github.com/bp-studio/box-pleating-studio"
              target="_blank"
              rel="noreferrer noopener"
            >
              Mu-Tsun Tsai&apos;s Box Pleating Studio
            </a>
          </Trans>
        </span>
      </footer>
    );
  }

  return (
    <footer className="design-attribution" role="contentinfo">
      <span className="design-attribution__text">
        <Trans i18nKey="panels:design.attributionTreemaker">
          Adapted from{' '}
          <a
            className="design-attribution__link"
            href="https://langorigami.com/article/treemaker/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Robert J. Lang&apos;s TreeMaker
          </a>{' '}
          · GPL-2.0
        </Trans>
      </span>
    </footer>
  );
}
