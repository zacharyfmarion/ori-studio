//! Fetching and verifying an update payload, in place of the plugin's download.
//!
//! The plugin's `download` is one GET, read to the end into memory. On a slow or
//! flaky connection a 40–120 MB payload is a long time to hold one connection
//! open, and when it drops, everything read so far is thrown away and the
//! failure surfaces as reqwest's "error decoding response body" — the wording
//! reqwest uses for *any* failure to read a body, a reset socket included.
//! Field data before this module: failed downloads died 6 to 80 minutes in,
//! where a healthy one takes seconds, and the app then started from zero again
//! on its next check, four hours later.
//!
//! So this fetch resumes. A dropped connection is retried with a `Range` request
//! for the rest, a stalled one is cut by a read timeout rather than hanging, and
//! it gives up only after several attempts in a row that made no progress. The
//! payload is verified against the public key exactly as the plugin verifies it,
//! because the plugin's `install` trusts whatever bytes it is handed.

use std::error::Error as StdError;
use std::time::Duration;

use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};
use reqwest::StatusCode;
use reqwest::header::{ACCEPT, CONTENT_RANGE, RANGE};

use super::UpdateCheckErrorKind as Kind;

/// What the GitHub release host is sent; it refuses requests without one.
const USER_AGENT: &str = concat!("OriStudio-Updater/", env!("CARGO_PKG_VERSION"));

/// How patient the fetch is.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Consecutive attempts that may fail without adding a byte before the
    /// fetch gives up. An attempt that made progress resets the count, so a
    /// slow link that keeps dropping still finishes.
    pub max_stalled_attempts: u32,
    /// Attempts in all, so a link that trickles a few bytes per connection
    /// cannot keep the fetch alive forever.
    pub max_attempts: u32,
    /// Wait before the first retry; doubles per stalled attempt.
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_stalled_attempts: 5,
            max_attempts: 30,
            initial_backoff: Duration::from_secs(2),
            max_backoff: Duration::from_secs(60),
        }
    }
}

impl RetryPolicy {
    fn backoff(&self, stalled_attempts: u32) -> Duration {
        let factor = 1u32
            .checked_shl(stalled_attempts.saturating_sub(1))
            .unwrap_or(u32::MAX);
        self.initial_backoff
            .saturating_mul(factor)
            .min(self.max_backoff)
    }
}

/// A failed download, classified into the same enum a failed check uses.
#[derive(Debug)]
pub struct DownloadError {
    pub kind: Kind,
    pub message: String,
}

impl DownloadError {
    fn new(kind: Kind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

/// One attempt's failure: worth another attempt, or not.
enum AttemptError {
    Retry(DownloadError),
    Fatal(DownloadError),
}

/// The client the fetch runs on.
///
/// No overall timeout: a large payload on a slow link legitimately takes a long
/// time. A connection that stops delivering is what must not be waited on, and
/// that is the read timeout's job — it bounds the gap between reads, not the
/// whole body. The system proxy comes with reqwest's `system-proxy` feature,
/// which `Cargo.toml` turns on for the plugin's check already.
pub fn client() -> Result<reqwest::Client, DownloadError> {
    // The plugin's reqwest is built without a rustls crypto provider and
    // installs ring's before each check. A download normally follows a check,
    // but must not depend on one having run.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| DownloadError::new(Kind::Unsupported, describe(&error)))
}

/// Fetch the payload at `url`, resuming across dropped connections.
pub async fn fetch(
    client: &reqwest::Client,
    url: &reqwest::Url,
    policy: &RetryPolicy,
) -> Result<Vec<u8>, DownloadError> {
    let mut buffer = Vec::new();
    let mut attempts = 0;
    let mut stalled = 0;
    loop {
        attempts += 1;
        let before = buffer.len();
        let error = match fetch_once(client, url, &mut buffer).await {
            Ok(()) => return Ok(buffer),
            Err(AttemptError::Fatal(error)) => return Err(error),
            Err(AttemptError::Retry(error)) => error,
        };
        // A restart from zero (a server that ignored the range) shrinks the
        // buffer; only growth counts as progress.
        if buffer.len() > before {
            stalled = 0;
        } else {
            stalled += 1;
        }
        if stalled >= policy.max_stalled_attempts || attempts >= policy.max_attempts {
            return Err(error);
        }
        tokio::time::sleep(policy.backoff(stalled.max(1))).await;
    }
}

/// One request: the whole payload, or the rest of it after `buffer`.
async fn fetch_once(
    client: &reqwest::Client,
    url: &reqwest::Url,
    buffer: &mut Vec<u8>,
) -> Result<(), AttemptError> {
    let resume_from = buffer.len() as u64;
    let mut request = client
        .get(url.clone())
        .header(ACCEPT, "application/octet-stream");
    if resume_from > 0 {
        request = request.header(RANGE, format!("bytes={resume_from}-"));
    }
    let mut response = request
        .send()
        .await
        .map_err(|error| AttemptError::Retry(transport_error(&error)))?;

    let status = response.status();
    let expected_len = match status {
        StatusCode::PARTIAL_CONTENT if resume_from > 0 => {
            let range = response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .and_then(parse_content_range);
            match range {
                Some((start, total)) if start == resume_from => total,
                // A range we did not ask for: the bytes cannot be placed, so
                // start over rather than splice them in at the wrong offset.
                _ => {
                    buffer.clear();
                    return Err(AttemptError::Retry(DownloadError::new(
                        Kind::HttpStatus,
                        "the server answered a resume with a range that does not continue the download",
                    )));
                }
            }
        }
        StatusCode::OK => {
            // A server that ignores `Range` sends the whole payload again.
            buffer.clear();
            response.content_length()
        }
        StatusCode::RANGE_NOT_SATISFIABLE => {
            // Nothing past what we hold: the payload changed under us, or a
            // previous attempt already read it all but the connection dropped
            // before that was clear. Either way, starting over settles it.
            buffer.clear();
            return Err(AttemptError::Retry(DownloadError::new(
                Kind::HttpStatus,
                format!("download request failed with status {status}"),
            )));
        }
        status
            if status.is_server_error()
                || status == StatusCode::REQUEST_TIMEOUT
                || status == StatusCode::TOO_MANY_REQUESTS =>
        {
            return Err(AttemptError::Retry(DownloadError::new(
                Kind::HttpStatus,
                format!("download request failed with status {status}"),
            )));
        }
        status => {
            return Err(AttemptError::Fatal(DownloadError::new(
                Kind::HttpStatus,
                format!("download request failed with status {status}"),
            )));
        }
    };

    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => buffer.extend_from_slice(&chunk),
            Ok(None) => break,
            Err(error) => return Err(AttemptError::Retry(transport_error(&error))),
        }
    }

    match expected_len {
        Some(total) if (buffer.len() as u64) < total => {
            Err(AttemptError::Retry(DownloadError::new(
                Kind::Network,
                format!(
                    "the connection closed after {} of {total} bytes",
                    buffer.len()
                ),
            )))
        }
        Some(total) if (buffer.len() as u64) > total => {
            buffer.clear();
            Err(AttemptError::Retry(DownloadError::new(
                Kind::Network,
                format!("received more than the {total} bytes the server announced"),
            )))
        }
        _ => Ok(()),
    }
}

/// `bytes <start>-<end>/<total>` into its start and, when known, its total.
fn parse_content_range(value: &str) -> Option<(u64, Option<u64>)> {
    let rest = value.trim().strip_prefix("bytes ")?;
    let (range, total) = rest.split_once('/')?;
    let (start, _end) = range.split_once('-')?;
    let start = start.trim().parse().ok()?;
    let total = match total.trim() {
        "*" => None,
        total => Some(total.parse().ok()?),
    };
    Some((start, total))
}

/// A failure to send a request or to read its body.
///
/// Never `Parse`: reqwest files a body that stopped arriving under "decode",
/// and that is what made a dropped connection look like a broken release.
fn transport_error(error: &reqwest::Error) -> DownloadError {
    let kind = if error.is_timeout() {
        Kind::Timeout
    } else {
        super::desktop::classify_transport_chain(causes(error).iter().map(String::as_str))
    };
    DownloadError::new(kind, describe(error))
}

/// Check `data` against the release signature, as the plugin's own download does.
pub fn verify(data: &[u8], release_signature: &str, pubkey: &str) -> Result<(), DownloadError> {
    let signature_error = |message: String| DownloadError::new(Kind::Signature, message);
    let public_key = decode_base64_text(pubkey)
        .and_then(|text| PublicKey::decode(&text).map_err(|error| error.to_string()))
        .map_err(|message| signature_error(format!("the public key is unusable: {message}")))?;
    let signature = decode_base64_text(release_signature)
        .and_then(|text| Signature::decode(&text).map_err(|error| error.to_string()))
        .map_err(|message| signature_error(format!("the signature is unusable: {message}")))?;
    public_key
        .verify(data, &signature, true)
        .map_err(|error| signature_error(format!("the payload signature does not verify: {error}")))
}

fn decode_base64_text(value: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

fn causes(error: &(dyn StdError + 'static)) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = error.source();
    while let Some(cause) = current {
        out.push(cause.to_string());
        current = cause.source();
    }
    out
}

fn describe(error: &(dyn StdError + 'static)) -> String {
    let mut parts = vec![error.to_string()];
    parts.extend(causes(error));
    parts.join(": ")
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex};

    const PAYLOAD_LEN: usize = 10_000;

    fn payload() -> Vec<u8> {
        (0..PAYLOAD_LEN).map(|i| (i % 251) as u8).collect()
    }

    fn fast_policy() -> RetryPolicy {
        RetryPolicy {
            max_stalled_attempts: 3,
            max_attempts: 10,
            initial_backoff: Duration::from_millis(1),
            max_backoff: Duration::from_millis(5),
        }
    }

    /// How the fake server answers each request, in order.
    #[derive(Clone, Copy)]
    enum Reply {
        /// Announce the whole payload, send this many bytes of it, hang up.
        Truncated(usize),
        /// Honour the request's range, or send everything without one.
        Honest,
        /// Ignore any range and send the whole payload with 200.
        IgnoreRange,
        Status(u16),
    }

    /// A one-request-per-connection HTTP server, enough to drive reqwest.
    /// Returns the URL and the `Range` header of every request it saw.
    fn serve(replies: Vec<Reply>) -> (reqwest::Url, Arc<Mutex<Vec<Option<String>>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&seen);
        std::thread::spawn(move || {
            let body = payload();
            for reply in replies {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                let range = read_request(&stream);
                log.lock().unwrap().push(range.clone());
                answer(stream, reply, range.as_deref(), &body);
            }
        });
        (
            reqwest::Url::parse(&format!("http://{addr}/payload")).unwrap(),
            seen,
        )
    }

    fn read_request(stream: &TcpStream) -> Option<String> {
        let mut reader = BufReader::new(stream);
        let mut range = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                return range;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("range:") {
                range = Some(value.trim().to_owned());
            }
        }
    }

    fn answer(mut stream: TcpStream, reply: Reply, range: Option<&str>, body: &[u8]) {
        let total = body.len();
        let head = |status: &str, extra: String, len: usize| {
            format!(
                "HTTP/1.1 {status}\r\nContent-Length: {len}\r\nConnection: close\r\n{extra}\r\n"
            )
        };
        match reply {
            Reply::Truncated(sent) => {
                let _ = stream.write_all(head("200 OK", String::new(), total).as_bytes());
                let _ = stream.write_all(&body[..sent]);
            }
            Reply::IgnoreRange => {
                let _ = stream.write_all(head("200 OK", String::new(), total).as_bytes());
                let _ = stream.write_all(body);
            }
            Reply::Honest => {
                let start = range
                    .and_then(|r| r.strip_prefix("bytes="))
                    .and_then(|r| r.strip_suffix('-'))
                    .and_then(|r| r.parse::<usize>().ok());
                match start {
                    Some(start) => {
                        let extra =
                            format!("Content-Range: bytes {start}-{}/{total}\r\n", total - 1);
                        let _ = stream.write_all(
                            head("206 Partial Content", extra, total - start).as_bytes(),
                        );
                        let _ = stream.write_all(&body[start..]);
                    }
                    None => {
                        let _ = stream.write_all(head("200 OK", String::new(), total).as_bytes());
                        let _ = stream.write_all(body);
                    }
                }
            }
            Reply::Status(code) => {
                let _ =
                    stream.write_all(head(&format!("{code} Status"), String::new(), 0).as_bytes());
            }
        }
        let _ = stream.flush();
        // Drain so the client sees a clean close rather than a reset.
        let _ = stream.shutdown(std::net::Shutdown::Write);
        let mut sink = [0u8; 64];
        let _ = stream.read(&mut sink);
    }

    fn run(replies: Vec<Reply>) -> (Result<Vec<u8>, DownloadError>, Vec<Option<String>>) {
        let (url, seen) = serve(replies);
        let client = client().unwrap();
        let result = tauri::async_runtime::block_on(fetch(&client, &url, &fast_policy()));
        let seen = seen.lock().unwrap().clone();
        (result, seen)
    }

    #[test]
    fn a_dropped_connection_resumes_from_where_it_stopped() {
        let (result, seen) = run(vec![Reply::Truncated(4_000), Reply::Honest]);
        assert_eq!(result.unwrap(), payload());
        assert_eq!(seen, vec![None, Some("bytes=4000-".to_owned())]);
    }

    #[test]
    fn keeps_resuming_while_each_attempt_makes_progress() {
        // More drops than `max_stalled_attempts`, but every one moved forward.
        let (result, seen) = run(vec![
            Reply::Truncated(1_000),
            Reply::Truncated(2_000),
            Reply::Truncated(3_000),
            Reply::Truncated(4_000),
            Reply::Honest,
        ]);
        assert_eq!(result.unwrap(), payload());
        assert_eq!(seen.len(), 5);
    }

    #[test]
    fn a_server_that_ignores_the_range_is_read_from_the_start() {
        let (result, _) = run(vec![Reply::Truncated(4_000), Reply::IgnoreRange]);
        assert_eq!(result.unwrap(), payload());
    }

    #[test]
    fn a_transient_server_error_is_retried() {
        let (result, _) = run(vec![Reply::Status(503), Reply::Honest]);
        assert_eq!(result.unwrap(), payload());
    }

    #[test]
    fn a_missing_payload_is_not_retried() {
        let (result, seen) = run(vec![Reply::Status(404), Reply::Honest]);
        let error = result.unwrap_err();
        assert_eq!(error.kind, Kind::HttpStatus);
        assert_eq!(seen.len(), 1);
    }

    #[test]
    fn gives_up_after_attempts_that_make_no_progress() {
        let (result, seen) = run(vec![Reply::Status(503); 3]);
        assert_eq!(result.unwrap_err().kind, Kind::HttpStatus);
        assert_eq!(seen.len(), 3);
    }

    #[test]
    fn a_truncated_body_is_a_network_failure_not_a_parse_failure() {
        // The first drop makes progress; the next three, from a server that
        // ignores the range, do not.
        let (result, seen) = run(vec![Reply::Truncated(10); 4]);
        let error = result.unwrap_err();
        assert_eq!(error.kind, Kind::Network, "{}", error.message);
        assert_eq!(seen.len(), 4);
    }

    #[test]
    fn reads_content_range() {
        assert_eq!(
            parse_content_range("bytes 100-199/1000"),
            Some((100, Some(1000)))
        );
        assert_eq!(parse_content_range("bytes 0-9/*"), Some((0, None)));
        assert_eq!(parse_content_range("items 0-9/10"), None);
        assert_eq!(parse_content_range("bytes x-9/10"), None);
    }

    #[test]
    fn backoff_doubles_to_its_cap() {
        let policy = RetryPolicy::default();
        assert_eq!(policy.backoff(1), Duration::from_secs(2));
        assert_eq!(policy.backoff(2), Duration::from_secs(4));
        assert_eq!(policy.backoff(5), Duration::from_secs(32));
        assert_eq!(policy.backoff(6), Duration::from_secs(60));
        assert_eq!(policy.backoff(40), Duration::from_secs(60));
    }

    // A throwaway key pair, and its signature over `SIGNED`, in the encoding
    // Tauri uses: base64 of minisign's own text formats.
    const TEST_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDcxRjI0Q0UyNDFBRkM2QTAKUldTZ3hxOUI0a3p5Y1p2dVZPMzUvNVdaZzhTcHFVZnA0TXE0SDhPVWhBdSthNm1PWU9VQ3BNTncK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHRlc3QKUlVTZ3hxOUI0a3p5Y2Z5QUZuUm9UejIvTys2THBUalNoQXc0dUxQVVZ3anBSaVR1R0dQcGZLWnlhSjRTd0FiU0lIay9uN2N2YlRXeEprdzJweGxyWTV4MVpuall5WE1FWWdZPQp0cnVzdGVkIGNvbW1lbnQ6IHRlc3QKV09oSnEyamJOcVczbzZiam5BdVM0QXovK3lPQVFJTTBCOW1NRUtyNE15amMxTEpHLytsUldndnFpYWZGYTdxY04xQU12b052T2IyekVHWTJmNEFjQXc9PQo=";
    const SIGNED: &[u8] = b"ori studio update";

    #[test]
    fn accepts_a_payload_its_signature_covers() {
        verify(SIGNED, TEST_SIGNATURE, TEST_PUBKEY).unwrap();
    }

    #[test]
    fn rejects_a_payload_that_differs_by_a_byte() {
        let error = verify(b"ori studio updatE", TEST_SIGNATURE, TEST_PUBKEY).unwrap_err();
        assert_eq!(error.kind, Kind::Signature);
    }

    #[test]
    fn an_unusable_key_or_signature_is_a_signature_failure() {
        let error = verify(SIGNED, "not base64!", TEST_PUBKEY).unwrap_err();
        assert_eq!(error.kind, Kind::Signature);
        let error = verify(SIGNED, TEST_SIGNATURE, "also not base64!").unwrap_err();
        assert_eq!(error.kind, Kind::Signature);
    }
}
