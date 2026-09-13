import { useTranslation } from 'react-i18next';
import { trackDesktopDownload, type DesktopDownloadSurface } from '../../analytics';
import { desktopBuildLabel, downloadOsLabel } from '../../components/download/desktopBuildLabels';
import {
  DESKTOP_BUILDS,
  formatDownloadSize,
  type DesktopBuildSpec,
  type DownloadOs,
} from '../../platform/desktopDownload';
import { useDesktopDownloads } from '../../platform/useDesktopDownloads';

const OS_ORDER: readonly DownloadOs[] = ['macos', 'windows', 'linux'];

/**
 * Every desktop build, grouped by operating system, as a list on the page.
 *
 * The same information as the "other platforms" menu on the download button, laid out
 * where a crawler can read it and a visitor can compare — a menu is closed by default and
 * lists nothing to either. It is not the menu component reused, because that one is built
 * from Radix menu items and only means something inside a dropdown.
 *
 * **Drawn from the build table, sharpened by the release.** `DESKTOP_BUILDS` is what the
 * release workflow *can* produce, and it is static, so the prerendered page names every
 * platform before any request is made — that is the copy a crawler indexes. Each entry
 * links to the releases page until the release resolves; then it gets the direct asset
 * and its size, and a build the release did not ship (the Linux arm64 legs, at the time of
 * writing) is dropped rather than left pointing at a file that is not there.
 */
export function DesktopBuildList({ surface }: { surface: DesktopDownloadSurface }) {
  const { t } = useTranslation();
  const { version, builds, fallbackUrl } = useDesktopDownloads();
  const shipped = new Map(builds.map((build) => [build.id, build]));
  // Until the release is known, every spec is a candidate; once it is, only what shipped.
  const listed = (spec: DesktopBuildSpec) => version === null || shipped.has(spec.id);

  return (
    <div className="site-builds">
      {OS_ORDER.map((os) => {
        const group = DESKTOP_BUILDS.filter((spec) => spec.os === os && listed(spec));
        if (group.length === 0) return null;
        return (
          <section key={os} className="site-builds__group" aria-labelledby={`site-builds-${os}`}>
            <h3 className="site-builds__os" id={`site-builds-${os}`}>
              {downloadOsLabel(t, os)}
            </h3>
            <ul className="site-builds__list">
              {group.map((spec) => {
                const build = shipped.get(spec.id);
                const size = build ? formatDownloadSize(build.size) : null;
                return (
                  <li key={spec.id}>
                    <a
                      className="site-builds__link"
                      href={build?.url ?? fallbackUrl}
                      // A resolved build is a file; the fallback is a page, which should not
                      // replace what the visitor was reading.
                      target={build ? undefined : '_blank'}
                      rel="noreferrer noopener"
                      onClick={() => trackDesktopDownload({ build: spec.id, surface })}
                    >
                      <span className="site-builds__name">{desktopBuildLabel(t, spec.id)}</span>
                      {size && <span className="site-builds__size">{size}</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
