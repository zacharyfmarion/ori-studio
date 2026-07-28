import packageJson from '../../package.json';

export const APP_VERSION = packageJson.version;
export const REPOSITORY_URL = 'https://github.com/zacharyfmarion/ori-studio';
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;
export const RELEASE_BASE = `${RELEASES_URL}/latest/download`;

// Only Apple Silicon (aarch64) builds are currently published.
export const MAC_DMG_FILENAME = 'OriStudio_latest_aarch64.dmg';

export function getMacDownloadUrl(): string {
  return `${RELEASE_BASE}/${MAC_DMG_FILENAME}`;
}
