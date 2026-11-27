//! What the update endpoint answered, when the plugin's check will not say.
//!
//! The plugin's check turns every answer outside 2xx into
//! `Error::ReleaseNotFound` and keeps the status code to its log. That one
//! variant covers two failures that need opposite handling:
//!
//! - **404**: the latest release has no `latest.json`. That is ours and
//!   fleet-wide: every install stops seeing updates until the release is fixed.
//! - **5xx, 408, 429**: the release host is failing or shedding load. That
//!   passes on its own, and nobody at the client can act on it. Anonymous
//!   release downloads from GitHub answered 504 for hours in November 2026, and
//!   every check that hit one was reported as a broken release.
//!
//! So when the plugin reports it, the endpoint is asked once more, the way the
//! plugin asked it, and the status it answers with names the failure.

use std::time::Duration;

use reqwest::header::ACCEPT;
use reqwest::{StatusCode, Url};
use tauri_plugin_updater::Error as PluginError;

use super::{UpdateCheckError, UpdateCheckErrorKind as Kind};

/// Name a check the plugin reported as `ReleaseNotFound` by asking its
/// endpoint again.
///
/// Falls back to [`Kind::HttpStatus`], the plugin's own reading, when there is
/// no endpoint it can ask as configured.
pub async fn release_not_found(
    client: &reqwest::Client,
    endpoints: &[String],
    timeout: Option<Duration>,
) -> UpdateCheckError {
    let reported = PluginError::ReleaseNotFound.to_string();
    let Some(url) = askable(endpoints) else {
        return UpdateCheckError {
            kind: Kind::HttpStatus,
            message: reported,
        };
    };
    match ask(client, url, timeout).await {
        Ok(status) => UpdateCheckError {
            kind: classify_status(status),
            message: format!("{reported}; asked again, the endpoint answered {status}"),
        },
        Err(error) => UpdateCheckError {
            kind: super::desktop::classify_reqwest(&error),
            message: format!(
                "{reported}; asked again, the request failed: {}",
                super::desktop::describe(&error)
            ),
        },
    }
}

/// The endpoint to ask again: the first one configured, if it is a URL as
/// written.
///
/// The plugin fills `{{target}}`-style placeholders in before its request, so an
/// endpoint with one is not asked at a URL the plugin never used. This app
/// configures a single endpoint, so the first is the one that answered.
fn askable(endpoints: &[String]) -> Option<Url> {
    let first = endpoints.first()?;
    if first.contains("{{") {
        return None;
    }
    Url::parse(first).ok()
}

/// One request for the status alone, with the header the plugin's check sends.
async fn ask(
    client: &reqwest::Client,
    url: Url,
    timeout: Option<Duration>,
) -> Result<StatusCode, reqwest::Error> {
    let mut request = client.get(url).header(ACCEPT, "application/json");
    if let Some(timeout) = timeout {
        request = request.timeout(timeout);
    }
    Ok(request.send().await?.status())
}

/// What an answer to the second request says the first failure was.
pub fn classify_status(status: StatusCode) -> Kind {
    match status {
        // A captive portal: this network wants a sign-in before it carries
        // anything, which is the machine's network rather than the host.
        StatusCode::NETWORK_AUTHENTICATION_REQUIRED => Kind::Network,
        StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_MANY_REQUESTS => Kind::ServerError,
        status if status.is_server_error() => Kind::ServerError,
        // It answers now, so the failure passed, which a missing manifest
        // does not do.
        status if status.is_success() => Kind::ServerError,
        _ => Kind::HttpStatus,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};

    /// Answer one request on a local port with `status`, and return its URL.
    fn serve(status: u16) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            read_request(&stream);
            answer(stream, status);
        });
        format!("http://{addr}/latest.json")
    }

    fn read_request(stream: &TcpStream) {
        let mut reader = BufReader::new(stream);
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                return;
            }
        }
    }

    fn answer(mut stream: TcpStream, status: u16) {
        let head =
            format!("HTTP/1.1 {status} Status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.flush();
        let _ = stream.shutdown(std::net::Shutdown::Write);
        let mut sink = [0u8; 64];
        let _ = stream.read(&mut sink);
    }

    fn explain(endpoints: Vec<String>) -> UpdateCheckError {
        let client = super::super::download::client().unwrap();
        tauri::async_runtime::block_on(release_not_found(
            &client,
            &endpoints,
            Some(Duration::from_secs(5)),
        ))
    }

    #[test]
    fn a_gateway_timeout_is_the_host_not_a_broken_release() {
        // What GitHub answered anonymous release downloads in both incidents.
        let error = explain(vec![serve(504)]);
        assert_eq!(error.kind, Kind::ServerError, "{}", error.message);
        assert!(
            error.message.contains("504 Gateway Timeout"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_host_shedding_load_is_the_host() {
        for status in [500, 502, 503, 408, 429] {
            let error = explain(vec![serve(status)]);
            assert_eq!(error.kind, Kind::ServerError, "{status}: {}", error.message);
        }
    }

    #[test]
    fn a_missing_manifest_stays_a_release_problem() {
        // The fleet-wide case: an armed release with no `latest.json`.
        let error = explain(vec![serve(404)]);
        assert_eq!(error.kind, Kind::HttpStatus, "{}", error.message);
        assert!(error.message.contains("404 Not Found"), "{}", error.message);
    }

    #[test]
    fn a_failure_that_does_not_repeat_was_transient() {
        let error = explain(vec![serve(200)]);
        assert_eq!(error.kind, Kind::ServerError, "{}", error.message);
    }

    #[test]
    fn a_second_request_that_cannot_connect_is_the_network() {
        // Bind and drop, so the port refuses.
        let addr = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        let error = explain(vec![format!("http://{addr}/latest.json")]);
        assert_eq!(error.kind, Kind::Connect, "{}", error.message);
    }

    #[test]
    fn keeps_the_plugins_reading_when_there_is_nothing_to_ask() {
        let error = explain(Vec::new());
        assert_eq!(error.kind, Kind::HttpStatus);
        // A templated endpoint is not asked at a URL the plugin never used.
        let error = explain(vec![
            "https://example.invalid/{{target}}/latest.json".to_owned(),
        ]);
        assert_eq!(error.kind, Kind::HttpStatus);
        assert_eq!(error.message, PluginError::ReleaseNotFound.to_string());
    }

    #[test]
    fn a_captive_portal_is_the_network() {
        assert_eq!(
            classify_status(StatusCode::NETWORK_AUTHENTICATION_REQUIRED),
            Kind::Network
        );
        assert_eq!(classify_status(StatusCode::FORBIDDEN), Kind::HttpStatus);
        assert_eq!(classify_status(StatusCode::GONE), Kind::HttpStatus);
    }
}
