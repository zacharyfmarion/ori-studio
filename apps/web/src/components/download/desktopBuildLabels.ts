import type { TFunction } from 'i18next';
import type { DesktopBuildId, DownloadOs } from '../../platform/desktopDownload';

/**
 * The name of an operating system, as a heading over its builds.
 *
 * Literal keys throughout: the i18next parser only sees `t()` calls whose key
 * and default are literals, so a table keyed by id — the obvious shape — would
 * extract nothing and the English catalog would silently lose these strings.
 */
export function downloadOsLabel(t: TFunction, os: DownloadOs): string {
  switch (os) {
    case 'macos':
      return t('common:download.os.macos', 'macOS');
    case 'windows':
      return t('common:download.os.windows', 'Windows');
    case 'linux':
      return t('common:download.os.linux', 'Linux');
  }
}

/** A build's name inside its OS group — the architecture and the package kind. */
export function desktopBuildLabel(t: TFunction, id: DesktopBuildId): string {
  switch (id) {
    case 'macos-arm64':
      return t('common:download.build.macosArm', 'Apple Silicon (.dmg)');
    case 'macos-intel':
      return t('common:download.build.macosIntel', 'Intel (.dmg)');
    case 'windows-x64':
      return t('common:download.build.windows', 'Installer (.exe)');
    case 'linux-appimage':
      return t('common:download.build.linuxAppImage', 'x86-64 (.AppImage)');
    case 'linux-deb':
      return t('common:download.build.linuxDeb', 'x86-64 (.deb)');
    case 'linux-appimage-arm64':
      return t('common:download.build.linuxAppImageArm', 'ARM64 (.AppImage)');
    case 'linux-deb-arm64':
      return t('common:download.build.linuxDebArm', 'ARM64 (.deb)');
  }
}

/**
 * The primary button's label.
 *
 * Names the OS when one was detected, because "Download for macOS" is a promise
 * the visitor can check and "Download" is not. Falls back to the generic wording
 * on a phone, on an unrecognized host, and in the prerendered markup — all three
 * of which reach here with `os` null.
 */
export function desktopDownloadCtaLabel(t: TFunction, os: DownloadOs | null): string {
  switch (os) {
    case 'macos':
      return t('common:download.ctaMacos', 'Download for macOS');
    case 'windows':
      return t('common:download.ctaWindows', 'Download for Windows');
    case 'linux':
      return t('common:download.ctaLinux', 'Download for Linux');
    default:
      return t('common:download.cta', 'Download the desktop app');
  }
}
