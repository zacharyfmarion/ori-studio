//! Support for the in-app updater that the frontend drives.
//!
//! The plugin finds the update and installs it. The download in between runs
//! through [`update_download`] here, because the plugin's own is a single GET
//! that a dropped connection throws away in full — see [`download`]. The
//! *check* runs through [`update_check`] here too, for a diagnostic reason
//! rather than a functional one: the plugin serializes a failure as its
//! `Display` string, and for every transport failure that string is reqwest's
//! `error sending request for url (…)` — a DNS miss, a refused connection, a
//! rejected certificate and a failed proxy tunnel all read the same. The cause
//! is in the error's `source()` chain, which only Rust can walk. So the check
//! runs here, its failure is classified into a bounded kind, and the frontend
//! gets a reason it can count instead of a string it cannot read.
//!
//! A verified download is also armed to install when the app quits — see
//! [`quit`] — so an update nobody relaunched into still lands.

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod download;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod quit;

/// The update armed to install when the app quits. Managed app state.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub type QuitInstall = quit::QuitSlot<tauri_plugin_updater::Update>;

/// Install the armed update, if there is one, on the way out.
///
/// Call from `RunEvent::Exit`. A relaunch into the update has already installed
/// it and disarmed the slot, so this does nothing then.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub fn install_on_quit(app: &tauri::AppHandle) {
    desktop::install_on_quit(app);
}

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

/// Why a check failed, as far as the shell could tell.
///
/// Serialized in `snake_case`: these strings are the analytics enum and must
/// stay in step with `UpdateCheckErrorKind` in `platform/updateService.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateCheckErrorKind {
    /// The endpoint's host name did not resolve.
    Dns,
    /// A TCP connection could not be made: refused, dropped, or unreachable.
    Connect,
    /// The TLS handshake failed — a certificate the verifier rejected, or a
    /// peer that could not negotiate. On a consumer Windows machine that is
    /// usually an antivirus or a proxy inspecting HTTPS.
    Tls,
    /// A configured proxy would not carry the request.
    Proxy,
    /// The request ran out its time budget.
    Timeout,
    /// A transport failure the error chain did not name.
    Network,
    /// The endpoint answered, but not with 2xx.
    HttpStatus,
    /// The body was not a manifest.
    Parse,
    /// The manifest has no entry for this build's platform.
    NoPlatformEntry,
    /// A payload or a signature did not verify.
    Signature,
    /// This build cannot check at all: no endpoints, an unsupported target, or
    /// a client that could not be built from its configuration.
    Unsupported,
    Unknown,
}

/// A failed check or download, with the cause already classified.
#[derive(Debug, Clone, serde::Serialize)]
pub struct UpdateCheckError {
    pub kind: UpdateCheckErrorKind,
    /// The whole cause chain, for the console and for a crash report. It
    /// carries the endpoint URL and the operating system's own words, so it is
    /// never an analytics property.
    pub message: String,
}

/// What the plugin's own `check` command returns. The field names are kept to
/// that shape, which the frontend has always read.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckMetadata {
    pub rid: tauri::ResourceId,
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub raw_json: serde_json::Value,
}

/// Ask the endpoint whether a newer version exists.
///
/// `None` means nothing newer. An offered update is held in the webview's
/// resource table under the returned `rid`, exactly as the plugin's command
/// holds it; [`update_download`] and [`update_install`] take it from there.
#[tauri::command]
pub async fn update_check(
    webview: tauri::Webview,
    timeout_ms: Option<u64>,
) -> Result<Option<UpdateCheckMetadata>, UpdateCheckError> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        desktop::run_check(&webview, timeout_ms).await
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (webview, timeout_ms);
        Err(UpdateCheckError {
            kind: UpdateCheckErrorKind::Unsupported,
            message: "the updater is desktop-only".to_owned(),
        })
    }
}

/// Download and verify the offered update, without installing it.
///
/// Returns the handle of the verified payload, for [`update_install`]. Holding
/// the bytes in the resource table rather than returning them keeps a 100 MB
/// payload off the IPC bridge. The payload is armed to install at quit until
/// that handle closes.
#[tauri::command]
pub async fn update_download(
    webview: tauri::Webview,
    rid: tauri::ResourceId,
) -> Result<tauri::ResourceId, UpdateCheckError> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        desktop::run_download(&webview, rid).await
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (webview, rid);
        Err(UpdateCheckError {
            kind: UpdateCheckErrorKind::Unsupported,
            message: "the updater is desktop-only".to_owned(),
        })
    }
}

/// Install a payload [`update_download`] verified. On Windows this exits the
/// process rather than returning.
#[tauri::command]
pub async fn update_install(
    webview: tauri::Webview,
    update_rid: tauri::ResourceId,
    payload_rid: tauri::ResourceId,
) -> Result<(), UpdateCheckError> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        desktop::run_install(&webview, update_rid, payload_rid)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (webview, update_rid, payload_rid);
        Err(UpdateCheckError {
            kind: UpdateCheckErrorKind::Unsupported,
            message: "the updater is desktop-only".to_owned(),
        })
    }
}

/// The check itself, on the targets the updater plugin builds for.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod desktop {
    use std::error::Error as StdError;
    use std::sync::Arc;
    use std::time::Duration;

    use tauri::Manager;
    use tauri_plugin_updater::{Error as PluginError, Update, UpdaterExt};

    use super::{QuitInstall, download, quit};
    use super::{UpdateCheckError, UpdateCheckErrorKind as Kind, UpdateCheckMetadata};

    /// A verified payload, waiting for [`run_install`] or for the app to quit.
    struct VerifiedPayload {
        bytes: Arc<Vec<u8>>,
        quit: QuitInstall,
    }

    impl tauri::Resource for VerifiedPayload {
        // Called when the handle is closed — a relaunch that installed it, a
        // newer offer, a revoked release — and not when a webview is torn
        // down, which only drops the table.
        fn close(self: Arc<Self>) {
            self.quit.disarm(&self.bytes);
        }
    }

    pub(super) async fn run_download(
        webview: &tauri::Webview,
        rid: tauri::ResourceId,
    ) -> Result<tauri::ResourceId, UpdateCheckError> {
        let update = webview
            .resources_table()
            .get::<Update>(rid)
            .map_err(|error| UpdateCheckError {
                kind: Kind::Unknown,
                message: error.to_string(),
            })?;
        let pubkey = updater_pubkey(webview).ok_or_else(|| UpdateCheckError {
            kind: Kind::Signature,
            message: "no updater public key is configured".to_owned(),
        })?;
        let client = download::client().map_err(UpdateCheckError::from)?;
        let bytes = download::fetch(
            &client,
            &update.download_url,
            &download::RetryPolicy::default(),
        )
        .await?;
        download::verify(&bytes, &update.signature, &pubkey)?;
        let bytes = Arc::new(bytes);
        let quit = webview.state::<QuitInstall>().inner().clone();
        quit.arm((*update).clone(), Arc::clone(&bytes));
        Ok(webview
            .resources_table()
            .add(VerifiedPayload { bytes, quit }))
    }

    pub(super) fn run_install(
        webview: &tauri::Webview,
        update_rid: tauri::ResourceId,
        payload_rid: tauri::ResourceId,
    ) -> Result<(), UpdateCheckError> {
        let lookup = |error: tauri::Error| UpdateCheckError {
            kind: Kind::Unknown,
            message: error.to_string(),
        };
        let update = webview
            .resources_table()
            .get::<Update>(update_rid)
            .map_err(lookup)?;
        let payload = webview
            .resources_table()
            .get::<VerifiedPayload>(payload_rid)
            .map_err(lookup)?;
        update
            .install(&payload.bytes[..])
            .map_err(|error| UpdateCheckError::from_plugin(&error))?;
        // Closing disarms the quit install, which would otherwise run the
        // installer a second time on the way out of the relaunch.
        let _ = webview.resources_table().close(payload_rid);
        Ok(())
    }

    pub(super) fn install_on_quit(app: &tauri::AppHandle) {
        let Some(slot) = app.try_state::<QuitInstall>() else {
            return;
        };
        let Some(armed) = slot.take() else {
            return;
        };
        // Nothing downloads on a package install, but should anything ever be
        // armed there, its install is a root password prompt: not at quit.
        if !super::self_update_supported() {
            return;
        }
        if let Err(message) = install_armed(app, &armed) {
            eprintln!(
                "[updater] did not install {} on quit: {message}",
                armed.update.version
            );
        }
    }

    type ArmedUpdate = quit::Armed<Update>;

    #[cfg(target_os = "macos")]
    fn install_armed(_app: &tauri::AppHandle, armed: &ArmedUpdate) -> Result<(), String> {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let bundle = quit::app_bundle(&executable).ok_or("not running from an app bundle")?;
        // When it cannot move the bundle, the plugin asks for an administrator
        // password through AppleScript on the main thread — which at quit is
        // this thread, so the exit would hang on it. A password prompt nobody
        // expects after quitting is wrong anyway: leave that case to the card.
        let writable = |path: &std::path::Path| {
            use std::os::unix::ffi::OsStrExt;
            std::ffi::CString::new(path.as_os_str().as_bytes())
                .is_ok_and(|path| unsafe { libc::access(path.as_ptr(), libc::W_OK) } == 0)
        };
        if !writable(&bundle) || !bundle.parent().is_some_and(writable) {
            return Err("replacing the app needs an administrator password".to_owned());
        }
        armed
            .update
            .install(&armed.payload[..])
            .map_err(|error| describe(&error))
    }

    #[cfg(target_os = "linux")]
    fn install_armed(_app: &tauri::AppHandle, armed: &ArmedUpdate) -> Result<(), String> {
        armed
            .update
            .install(&armed.payload[..])
            .map_err(|error| describe(&error))
    }

    /// Run the installer ourselves rather than through the plugin, whose
    /// Windows install always passes `/R` and so reopens the app the user just
    /// quit. The payload is the same verified NSIS installer the plugin would
    /// run, with the same arguments otherwise.
    #[cfg(target_os = "windows")]
    fn install_armed(app: &tauri::AppHandle, armed: &ArmedUpdate) -> Result<(), String> {
        let bytes = &armed.payload[..];
        if !bytes.starts_with(b"MZ") {
            return Err("the payload is not an NSIS installer".to_owned());
        }
        let name = &app.package_info().name;
        let version = &armed.update.version;
        let dir = std::env::temp_dir().join(format!("{name}-{version}-updater-on-quit"));
        let installer = dir.join(format!("{name}-{version}-installer.exe"));
        std::fs::create_dir_all(&dir)
            .and_then(|()| std::fs::write(&installer, bytes))
            .map_err(|error| error.to_string())?;
        let config = app.config();
        let install_mode = config
            .plugins
            .0
            .get("updater")
            .and_then(|updater| updater.get("windows"))
            .and_then(|windows| windows.get("installMode"))
            .and_then(|mode| mode.as_str());
        std::process::Command::new(&installer)
            .args(quit::nsis_quit_args(install_mode))
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    /// The key `tauri.conf.json` gives the plugin, which is the key the plugin
    /// itself verifies with: nothing here overrides it at runtime.
    fn updater_pubkey(webview: &tauri::Webview) -> Option<String> {
        webview
            .config()
            .plugins
            .0
            .get("updater")?
            .get("pubkey")?
            .as_str()
            .map(str::to_owned)
    }

    impl From<download::DownloadError> for UpdateCheckError {
        fn from(error: download::DownloadError) -> Self {
            Self {
                kind: error.kind,
                message: error.message,
            }
        }
    }

    pub(super) async fn run_check(
        webview: &tauri::Webview,
        timeout_ms: Option<u64>,
    ) -> Result<Option<UpdateCheckMetadata>, UpdateCheckError> {
        let update = match check(webview, timeout_ms).await {
            Ok(update) => update,
            Err(error) => return Err(UpdateCheckError::from_plugin(&error)),
        };
        let Some(update) = update else {
            return Ok(None);
        };
        let date = match update.date {
            Some(date) => Some(
                date.format(&time::format_description::well_known::Rfc3339)
                    .map_err(|_| UpdateCheckError {
                        kind: Kind::Parse,
                        message: "the manifest's pub_date could not be formatted".to_owned(),
                    })?,
            ),
            None => None,
        };
        Ok(Some(UpdateCheckMetadata {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date,
            body: update.body.clone(),
            raw_json: update.raw_json.clone(),
            rid: webview.resources_table().add(update),
        }))
    }

    async fn check(
        webview: &tauri::Webview,
        timeout_ms: Option<u64>,
    ) -> Result<Option<Update>, PluginError> {
        let mut builder = webview.updater_builder();
        if let Some(ms) = timeout_ms {
            builder = builder.timeout(Duration::from_millis(ms));
        }
        builder.build()?.check().await
    }

    impl UpdateCheckError {
        pub(super) fn from_plugin(error: &PluginError) -> Self {
            Self {
                kind: classify(error),
                message: describe(error),
            }
        }
    }

    /// The plugin's variants, onto the analytics enum.
    pub(super) fn classify(error: &PluginError) -> Kind {
        match error {
            PluginError::Reqwest(inner) => classify_reqwest(inner),
            // The plugin drops the status code on the way here; it only logs it.
            PluginError::ReleaseNotFound => Kind::HttpStatus,
            PluginError::TargetNotFound(_) | PluginError::TargetsNotFound(_) => {
                Kind::NoPlatformEntry
            }
            PluginError::Serialization(_) | PluginError::Semver(_) | PluginError::FormatDate => {
                Kind::Parse
            }
            PluginError::Minisign(_) | PluginError::Base64(_) | PluginError::SignatureUtf8(_) => {
                Kind::Signature
            }
            PluginError::Network(_) => Kind::Network,
            PluginError::EmptyEndpoints
            | PluginError::UnsupportedArch
            | PluginError::UnsupportedOs
            | PluginError::FailedToDetermineExtractPath
            | PluginError::InsecureTransportProtocol
            | PluginError::UrlParse(_) => Kind::Unsupported,
            // `Error` is `#[non_exhaustive]`; a variant a future plugin adds
            // lands here rather than in a class it does not belong to.
            _ => Kind::Unknown,
        }
    }

    fn classify_reqwest(error: &reqwest::Error) -> Kind {
        if error.is_timeout() {
            return Kind::Timeout;
        }
        if error.is_decode() {
            return Kind::Parse;
        }
        // A client that could not be built is configuration — a malformed
        // proxy URL — not the network.
        if error.is_builder() {
            return Kind::Unsupported;
        }
        classify_transport_chain(causes(error).iter().map(String::as_str))
    }

    /// Name a transport failure from the messages beneath reqwest's own.
    ///
    /// Only phrases that are constants in the libraries doing the work —
    /// hyper-util's connector and rustls — are matched, never the operating
    /// system's text underneath them, which Windows localizes. A chain that
    /// names none of them is still a transport failure, so it is `Network`
    /// rather than `Unknown`.
    pub(super) fn classify_transport_chain<'a>(causes: impl IntoIterator<Item = &'a str>) -> Kind {
        let text = causes
            .into_iter()
            .map(str::to_lowercase)
            .collect::<Vec<_>>()
            .join("\n");
        // A tunnel that failed wraps a TCP error to the proxy; the proxy is
        // the thing that failed, so it is tested first.
        if text.contains("tunnel error") || text.contains("establishing tunnel") {
            Kind::Proxy
        } else if text.contains("invalid peer certificate")
            || text.contains("received fatal alert")
            || text.contains("peer is incompatible")
            || text.contains("received corrupt message")
            || text.contains("peer sent no certificates")
            || text.contains("handshake")
        {
            Kind::Tls
        } else if text.contains("dns error") {
            Kind::Dns
        } else if text.contains("tcp connect error") || text.contains("tcp open error") {
            Kind::Connect
        } else {
            Kind::Network
        }
    }

    /// Every message beneath `error`, outermost first.
    fn causes(error: &(dyn StdError + 'static)) -> Vec<String> {
        let mut out = Vec::new();
        let mut current = error.source();
        while let Some(cause) = current {
            out.push(cause.to_string());
            current = cause.source();
        }
        out
    }

    /// The error and everything beneath it, as one line.
    pub(super) fn describe(error: &(dyn StdError + 'static)) -> String {
        let mut parts = vec![error.to_string()];
        parts.extend(causes(error));
        parts.join(": ")
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use tauri_plugin_updater::Error as PluginError;

        // These chains are what reqwest 0.13.3 produced through the plugin's
        // exact client build, minus its own top-level message — which was the
        // same "error sending request for url (…)" for every one of them.
        #[test]
        fn names_the_transport_cause_the_chain_carries() {
            assert_eq!(
                classify_transport_chain([
                    "client error (Connect)",
                    "dns error",
                    "failed to lookup address information: nodename nor servname provided, or not known",
                ]),
                Kind::Dns
            );
            assert_eq!(
                classify_transport_chain([
                    "client error (Connect)",
                    "tcp connect error",
                    "Connection refused (os error 61)",
                ]),
                Kind::Connect
            );
            assert_eq!(
                classify_transport_chain([
                    "client error (Connect)",
                    "invalid peer certificate: Other(OtherError(\"“*.badssl.com” certificate is not trusted: -67843\"))",
                ]),
                Kind::Tls
            );
            assert_eq!(
                classify_transport_chain([
                    "client error (Connect)",
                    "invalid peer certificate: NotValidForName",
                ]),
                Kind::Tls
            );
        }

        #[test]
        fn a_failed_tunnel_is_the_proxy_even_with_tcp_underneath() {
            assert_eq!(
                classify_transport_chain([
                    "client error (Connect)",
                    "tunnel error: failed to create underlying connection",
                    "tcp connect error",
                    "Connection refused (os error 61)",
                ]),
                Kind::Proxy
            );
        }

        #[test]
        fn identifies_by_the_library_phrase_not_the_operating_systems_words() {
            // What Windows says for a refused connection; hyper-util's wrapper
            // above it is what identifies the class.
            assert_eq!(
                classify_transport_chain([
                    "client error (Connect)",
                    "tcp connect error",
                    "No connection could be made because the target machine actively refused it. (os error 10061)",
                ]),
                Kind::Connect
            );
        }

        #[test]
        fn an_unnamed_transport_failure_is_network_not_unknown() {
            assert_eq!(
                classify_transport_chain([
                    "client error (SendRequest)",
                    "connection closed before message completed",
                ]),
                Kind::Network
            );
            assert_eq!(classify_transport_chain(std::iter::empty()), Kind::Network);
        }

        #[test]
        fn maps_the_plugins_own_variants() {
            assert_eq!(classify(&PluginError::ReleaseNotFound), Kind::HttpStatus);
            assert_eq!(
                classify(&PluginError::TargetsNotFound(vec![
                    "windows-x86_64-nsis".to_owned(),
                    "windows-x86_64".to_owned(),
                ])),
                Kind::NoPlatformEntry
            );
            let not_json =
                serde_json::from_str::<serde_json::Value>("<!DOCTYPE html>").unwrap_err();
            assert_eq!(classify(&PluginError::Serialization(not_json)), Kind::Parse);
            assert_eq!(classify(&PluginError::EmptyEndpoints), Kind::Unsupported);
            assert_eq!(
                classify(&PluginError::Io(std::io::Error::other("disk"))),
                Kind::Unknown
            );
        }

        #[test]
        fn the_message_carries_the_cause() {
            let error = PluginError::Serialization(
                serde_json::from_str::<serde_json::Value>("nope").unwrap_err(),
            );
            let described = describe(&error);
            assert!(described.contains("expected"), "{described}");
        }

        #[test]
        fn serializes_the_frontend_contract() {
            // The kind strings are the analytics enum.
            assert_eq!(
                serde_json::to_string(&Kind::NoPlatformEntry).unwrap(),
                "\"no_platform_entry\""
            );
            assert_eq!(
                serde_json::to_string(&Kind::HttpStatus).unwrap(),
                "\"http_status\""
            );
            // The metadata keys are what the plugin's JS `Update` constructor reads.
            let metadata = serde_json::to_value(UpdateCheckMetadata {
                rid: 7,
                current_version: "0.5.1".to_owned(),
                version: "0.6.0".to_owned(),
                date: None,
                body: None,
                raw_json: serde_json::json!({}),
            })
            .unwrap();
            let object = metadata.as_object().unwrap();
            for key in [
                "rid",
                "currentVersion",
                "version",
                "date",
                "body",
                "rawJson",
            ] {
                assert!(object.contains_key(key), "missing {key}");
            }
        }
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
