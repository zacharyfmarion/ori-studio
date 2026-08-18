//! Support for the in-app updater that the frontend drives.
//!
//! The updater plugin itself is called from JavaScript; what lives here are the
//! two questions it cannot answer.

/// The bundle format this build was installed from, as far as it can tell.
///
/// Only meaningful on Linux, where the same release ships two formats with very
/// different update stories. Reported to analytics so the cost of the `.deb`
/// restriction below is measurable rather than assumed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
// Each variant is constructed on exactly one platform, so every build sees the
// other three as dead. The type is deliberately whole on every target: it is
// serialized into an analytics enum whose values must not vary by build host.
#[allow(dead_code)]
pub enum InstallKind {
    /// macOS `.app` bundle.
    App,
    /// Windows NSIS install.
    Nsis,
    /// Linux AppImage.
    AppImage,
    /// A Linux package install (`.deb`), or anything else unrecognized.
    Other,
}

/// Whether this install can replace itself in place.
///
/// True everywhere except a Linux package install. The updater *can* install a
/// `.deb`, but only by way of `pkexec` — a system root-password dialog, every
/// time. Weekly releases behind a root prompt is how you teach someone to turn
/// updates off, and `latest.json` carries exactly one URL under `linux-x86_64`
/// anyway, so there is no way to offer the right artifact to both formats.
///
/// **Unknown answers false.** Being wrong in the permissive direction produces
/// the root prompt this exists to avoid; being wrong the other way costs a
/// manual download.
pub fn install_kind() -> InstallKind {
    #[cfg(target_os = "macos")]
    {
        InstallKind::App
    }
    #[cfg(target_os = "windows")]
    {
        InstallKind::Nsis
    }
    #[cfg(target_os = "linux")]
    {
        // Set by the AppImage runtime for the process it launches, and by
        // nothing else — a `.deb` install has no such variable.
        if std::env::var_os("APPIMAGE").is_some() {
            InstallKind::AppImage
        } else {
            InstallKind::Other
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        InstallKind::Other
    }
}

/// Whether an update can be installed in place on this build.
pub fn self_update_supported() -> bool {
    !matches!(install_kind(), InstallKind::Other)
}

/// What the frontend needs to decide which update affordance to show.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEnvironment {
    pub install_kind: InstallKind,
    pub self_update_supported: bool,
}

#[tauri::command]
pub fn update_environment() -> UpdateEnvironment {
    UpdateEnvironment {
        install_kind: install_kind(),
        self_update_supported: self_update_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::{InstallKind, install_kind, self_update_supported};

    #[test]
    fn self_update_is_supported_wherever_the_bundle_can_replace_itself() {
        // The property that matters is the pairing, not the platform: `Other`
        // is precisely the set that must not be offered an in-place update.
        assert_eq!(
            self_update_supported(),
            install_kind() != InstallKind::Other
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_reports_an_app_bundle() {
        assert_eq!(install_kind(), InstallKind::App);
        assert!(self_update_supported());
    }

    #[test]
    fn install_kind_serializes_lowercase_for_the_analytics_enum() {
        // The taxonomy admits enums only, and these strings are the enum.
        assert_eq!(
            serde_json::to_string(&InstallKind::AppImage).unwrap(),
            "\"appimage\""
        );
        assert_eq!(
            serde_json::to_string(&InstallKind::Other).unwrap(),
            "\"other\""
        );
    }
}
