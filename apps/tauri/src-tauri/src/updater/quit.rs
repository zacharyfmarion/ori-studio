//! Install a downloaded update when the app quits.
//!
//! Most people on an old build had the update downloaded and verified and never
//! clicked "Relaunch to update" — the 4-hourly check just kept fetching it
//! again. So a verified payload is also armed here, and installed on the way
//! out if nothing else used or dropped it first. The next launch is then the
//! new version, without anyone having to act on the card.
//!
//! The slot is disarmed by the payload's own resource closing, which is how
//! every path that retires a payload already ends: a relaunch installs it and
//! closes it, a newer offer closes the old one, a revoked release closes it.
//! A window or webview going away does *not* close it — only drops the table —
//! so closing the last window still installs on the way out.

use std::sync::{Arc, Mutex};

/// The one update waiting to be installed at quit, if any.
pub struct QuitSlot<U> {
    armed: Arc<Mutex<Option<Armed<U>>>>,
}

pub struct Armed<U> {
    pub update: U,
    pub payload: Arc<Vec<u8>>,
}

// Derived `Clone`/`Default` would demand `U: Clone`/`U: Default`; the slot is
// only ever shared, never copied.
impl<U> Clone for QuitSlot<U> {
    fn clone(&self) -> Self {
        Self {
            armed: Arc::clone(&self.armed),
        }
    }
}

impl<U> Default for QuitSlot<U> {
    fn default() -> Self {
        Self {
            armed: Arc::new(Mutex::new(None)),
        }
    }
}

impl<U> QuitSlot<U> {
    /// Arm `payload`, replacing whatever was armed before.
    pub fn arm(&self, update: U, payload: Arc<Vec<u8>>) {
        *self.lock() = Some(Armed { update, payload });
    }

    /// Disarm, but only if `payload` is still the armed one: an older payload
    /// closing late must not disarm the newer one that replaced it.
    pub fn disarm(&self, payload: &Arc<Vec<u8>>) {
        let mut armed = self.lock();
        if armed
            .as_ref()
            .is_some_and(|armed| Arc::ptr_eq(&armed.payload, payload))
        {
            *armed = None;
        }
    }

    pub fn take(&self) -> Option<Armed<U>> {
        self.lock().take()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Armed<U>>> {
        // A panic while holding this lock leaves nothing half-written: the
        // slot is a single `Option` swap.
        self.armed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The NSIS arguments for an install nobody is waiting on.
///
/// The plugin's own install always adds `/R`, which relaunches the app once the
/// installer finishes — right for "Relaunch to update", wrong for someone who
/// just quit. Everything else matches what the plugin passes: the configured
/// install mode's own flag, and `/UPDATE` so the installer keeps shortcuts and
/// settings as an update rather than a fresh install.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn nsis_quit_args(install_mode: Option<&str>) -> Vec<&'static str> {
    let mode = match install_mode {
        Some("quiet") => Some("/S"),
        Some("basicUi") => None,
        // The plugin's default, and what tauri.conf.json sets.
        _ => Some("/P"),
    };
    mode.into_iter().chain(["/UPDATE"]).collect()
}

/// The `.app` bundle an executable sits in, which is what the plugin replaces.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn app_bundle(executable: &std::path::Path) -> Option<std::path::PathBuf> {
    let macos_dir = executable.parent()?;
    let contents = macos_dir.parent()?;
    let bundle = contents.parent()?;
    let is_bundle = macos_dir.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app";
    is_bundle.then(|| bundle.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn take_returns_the_armed_update_once() {
        let slot = QuitSlot::default();
        slot.arm("0.7.1", Arc::new(vec![1, 2, 3]));
        let armed = slot.take().expect("armed");
        assert_eq!(armed.update, "0.7.1");
        assert_eq!(*armed.payload, vec![1, 2, 3]);
        assert!(slot.take().is_none());
    }

    #[test]
    fn closing_the_armed_payload_disarms() {
        let slot = QuitSlot::default();
        let payload = Arc::new(vec![1]);
        slot.arm("0.7.1", Arc::clone(&payload));
        slot.disarm(&payload);
        assert!(slot.take().is_none());
    }

    #[test]
    fn an_older_payload_closing_late_leaves_the_newer_one_armed() {
        let slot = QuitSlot::default();
        let old = Arc::new(vec![1]);
        let new = Arc::new(vec![1]);
        slot.arm("0.7.0", Arc::clone(&old));
        slot.arm("0.7.1", Arc::clone(&new));
        // Same bytes, different payload: identity is what counts.
        slot.disarm(&old);
        assert_eq!(slot.take().expect("still armed").update, "0.7.1");
    }

    #[test]
    fn a_clone_shares_the_slot() {
        let slot = QuitSlot::default();
        let shared = slot.clone();
        shared.arm("0.7.1", Arc::new(vec![]));
        assert!(slot.take().is_some());
        assert!(shared.take().is_none());
    }

    #[test]
    fn nsis_args_never_ask_the_installer_to_relaunch() {
        assert_eq!(nsis_quit_args(Some("passive")), vec!["/P", "/UPDATE"]);
        assert_eq!(nsis_quit_args(None), vec!["/P", "/UPDATE"]);
        assert_eq!(nsis_quit_args(Some("quiet")), vec!["/S", "/UPDATE"]);
        assert_eq!(nsis_quit_args(Some("basicUi")), vec!["/UPDATE"]);
        for mode in [None, Some("passive"), Some("quiet"), Some("basicUi")] {
            assert!(!nsis_quit_args(mode).contains(&"/R"));
        }
    }

    #[test]
    fn finds_the_app_bundle_above_the_executable() {
        assert_eq!(
            app_bundle(Path::new(
                "/Applications/Ori Studio.app/Contents/MacOS/ori-studio"
            )),
            Some(Path::new("/Applications/Ori Studio.app").to_path_buf())
        );
        // A dev build runs from target/, which is no bundle to replace.
        assert_eq!(
            app_bundle(Path::new("/src/ori-studio/target/debug/ori-studio")),
            None
        );
    }
}
