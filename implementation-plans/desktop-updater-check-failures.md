# Desktop updater: legible check failures

## Goal

Half of the Windows desktop users on 0.5.0 (12 of 24) had an `app update
failed { stage: check, reason: unknown }` in PostHog within days of the
release, and nothing anywhere said why. Make the reason for a failed update
check visible in analytics as a bounded enum, remove the two mechanisms that
made it invisible, and take away the one machine-level barrier the shell can
remove itself.

## What was found

- The manifests are fine. `latest.json` on v0.2.0 through v0.5.1 each carry all
  four platform keys, valid semver, an RFC 3339 `pub_date` and base64 minisign
  signatures; each was uploaded exactly once (`created == updated`), so there is
  no publish race and no partial window. A check against a manifest whose
  version equals the running one returns `None`, not an error.
- `reason: unknown` is the updater plugin's transport class. The plugin
  serializes a failure as its `Display` string, and reqwest 0.13's string for
  every transport failure is `error sending request for url (…)` — a DNS miss,
  a refused connection, a rejected certificate and a failed proxy tunnel all
  read identically (reproduced against the plugin's exact reqwest build). The
  frontend's keyword classifier finds none of `network`, `fetch`, `timeout`,
  `connect`, `dns` in it and files `unknown`. So on Windows the transport class
  has *only ever* been reported as `unknown`, never as `network`.
- Sentry never had the message: `reportFailure` sends a crash report for
  `signature` only, by design.
- The failures concentrate in machines, not checks: 38 failures across 12
  people where independent per-check failures at that rate would touch ~21 of
  the 24. That is a machine-level barrier — a system proxy, a firewall or an
  antivirus egress rule on an unsigned binary — not a flaky network.
- The plugin's HTTP client is built without reqwest's `system-proxy`, so it
  ignores the Windows registry / macOS system proxy settings that the webview
  honours. On a proxied machine every check connects straight out and fails
  while every analytics request succeeds — which is exactly the shape of the
  data.

## Approach

- Run the check through a shell command, `update_check`, that calls the
  plugin's Rust `check()` and walks the error's `source()` chain — the only
  place the cause survives — into a bounded kind (`dns`, `connect`, `tls`,
  `proxy`, `timeout`, `network`, `http_status`, `parse`, `no_platform_entry`,
  `signature`, `unsupported`, `unknown`). It returns the plugin's own metadata
  shape so the JS `Update` handle, `download()` and `install()` stay the
  plugin's.
- Turn on `system-proxy` for the updater's reqwest through Cargo feature
  unification, and give the check a 30 s timeout so a hung request reports as
  `timeout` instead of never reporting.
- `classifyUpdateError` reads the shell's kind when it has one and otherwise
  matches the plugin's actual message constants; `UpdateFailureReason` grows
  the new kinds. `install_kind` on a check failure comes from the environment
  the check already read, not from store state the check never set. The
  manifest-class reasons (`signature`, `parse`, `no_platform_entry`,
  `http_status`, `stale_manifest`) reach Sentry; the transport classes stay
  silent, as before.

## Affected Areas

| Area | Files |
| --- | --- |
| Tauri shell | `apps/tauri/src-tauri/Cargo.toml`, `src/updater.rs`, `src/lib.rs` |
| Frontend | `apps/web/src/platform/updateService.ts`, `lib/updateController.ts`, `analytics/events.ts` and their tests |
| Docs | `docs/analytics.md` (the `app update *` rows, which were missing) |

## Checklist

- [x] Reproduce the plugin's error strings against its exact reqwest build
- [x] `update_check` command with chain classification and unit tests
- [x] `system-proxy` on the updater's client; 30 s check timeout
- [x] `UpdateFailureReason` extended; classifier matches the plugin's constants
- [x] `install_kind` populated on check failures; manifest-class reasons to Sentry
- [x] `docs/analytics.md` documents the seven `app update *` events
- [ ] After the next release, split `app update failed` by `reason` on Windows and confirm the `unknown` mass has moved into named classes
- [ ] Follow-up: `app update relaunched` undercounts (13 downloaded, 1 relaunched) because the process exits before the batched event is sent — emit it from the first launch of the new version instead
