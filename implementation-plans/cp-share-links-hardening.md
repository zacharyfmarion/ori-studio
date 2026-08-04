# Crease-Pattern Share Links — Hardening

## Goal

Close the failure modes in the shipped share-link feature
(`implementation-plans/cp-share-links.md`), in the order that a real user would hit them.

The feature works locally. Nothing below is a redesign — it is the difference between "works
on my machine under `wrangler pages dev`" and "works in production, degrades honestly when it
does not, and tells us before a user does".

Three properties to hold when this is done:

1. **A broken deploy is loud.** Today a deploy that uploads no Functions reports success, and
   the first symptom is a share link that unfurls as nothing.
2. **Every failure a user can reach says something true.** Today the most likely one — a link
   opened before KV has propagated — says the pattern "no longer exists", which is false.
3. **Silent degradation is impossible.** Two failure modes currently produce no error at all:
   a drifted script-id constant, and a client-side navigation to `/s/<id>`.

Non-goals: adding Playwright (the round-trip is testable at the handler level, and a browser
harness is a bigger commitment than this warrants), moving off Pages, and reworking the
storage model.

---

## Approach

### 1. Post-deploy smoke test — the deploy must prove itself

The deploy workflows now run wrangler from `apps/web` so `functions/` is discovered. That
change has never executed. Rather than trust it, assert it.

`wrangler pages deploy` prints the deployment URL; capture it and run four **read-only**
checks. Each is chosen to distinguish a specific failure from success:

| Request | Expect | Proves |
|---|---|---|
| `GET /api/cp/not-an-id` | `400` + `code: bad_id` | The Function ran. Without Functions this is the SPA fallback: `200 text/html`. |
| `GET /api/cp/aaaaaaaaaa` | `404` + `code: not_found` | `SHARE_KV` is bound. An unbound binding throws → `500`. |
| `GET /api/cp/aaaaaaaaaa/thumbnail` | `200 image/png` | `SHARE_R2` is bound **and** `og-default.png` shipped — the fallback path exercises both. |
| `GET /s/aaaaaaaaaa` | `200 text/html` + COOP/COEP | The `/s` Function ran, cross-origin isolation survives, and the SPA fallback resolves (a `404.html` would break this). |

No writes, so this costs nothing against the 1,000/day budget and leaves no junk records.
Fail the job on any mismatch — a red deploy is the point.

### 2. Retry the eventual-consistency miss, and stop lying about it

KV takes up to 60 seconds to propagate. A link pasted to someone elsewhere within that window
currently reports *"That crease pattern no longer exists… probably mistyped"*, which is false
and unactionable.

Both reads miss: the `/s/<id>` Function's own `readShare` (so no OG tags, no inlined payload),
then the client's `/api/cp/<id>` fallback.

- **Client retries.** `fetchCpShareWithRetry` retries **only on 404**, with backoff summing to
  ~60s (0, 1s, 2s, 4s, 8s, 15s, 30s). Any other status fails immediately — a 400 or 503 will
  not fix itself.
- **The Edit surface says what is happening.** A `pendingSharedCp` fetch is the one
  asynchronous path in provisioning, and today it shows a blank canvas. Add a status the CP
  surface can render while it runs.
- **The final message stops asserting.** After the retries: *"Couldn't open this link. If it
  was just created, try again in a moment."* We genuinely cannot distinguish "not yet
  propagated" from "never existed", so the copy should not pretend to.

The Worker side is deliberately left alone — a Worker cannot wait 60s, and the client retry
covers the same window without holding a request open.

### 3. Quota exhaustion: make it legible, and reclaim the write if we can

Free-plan limits **fail** rather than bill, so exceeding one is an outage. Two writes per
share puts the ceiling at 500/day.

- **Keep validation before the rate-limit write** (it already is): a malformed payload costs
  zero writes, so garbage cannot drain the budget.
- **Keep the copy vague — decided.** Naming the 00:00 UTC reset time would be more useful,
  but only if we can tell quota exhaustion apart from every other storage failure, and we
  cannot: `storage_quota` is inferred by matching `/limit|quota|exceeded/i` against a thrown
  message. Behind "temporarily unavailable" that heuristic is harmless; behind "try again
  after 4:00 PM" a misclassification would send someone away for hours over a transient
  error. A vague true message beats a precise false one, so the existing copy stands and no
  `{{time}}` interpolation is built. Revisit only if Cloudflare exposes a distinguishable
  error shape.
- **Reclaim the second write.** `ratelimits` is not a Pages binding, but **Durable Objects
  are**, and a DO counter costs no KV write — that would restore 1 write/share and a
  1,000/day ceiling. Spike it; if the free-plan story does not hold up, stay on the KV counter
  and document the ceiling.
- **Know before users do.** A scheduled check on KV usage, or simply a documented runbook for
  switching to Workers Paid, so the response to an outage is not discovery.

### 4. Thumbnails: retry, sanity-check, and match the card

A failed card is meant to degrade to the generic one — but there is no recovery at all today.

- **Retry the PUT** 3× with backoff. The token lives only in memory, so a transient network
  error currently means that share has the default card forever.
- **Reject an implausible render.** Under canvas fingerprinting defences `toBlob` can produce
  a blank or near-empty PNG. A card under ~2 KB is not a crease pattern; treat it as a
  failure rather than uploading a blank card that can never be replaced.
- **Validate PNG magic bytes** (`89 50 4E 47 0D 0A 1A 0A`) server-side. `Content-Type` is a
  claim, not a fact.
- **Regenerate `og-default.png` at 1000×525.** It is still 1200×630 from before the card
  geometry changed. Both are 1.91:1 so nothing looks wrong, but the fallback should be the
  same surface as the thing it stands in for. Add a test asserting its dimensions equal
  `SHARE_CARD_WIDTH`/`HEIGHT`, so the two cannot drift again.

### 5. One script-id constant, bound by a round-trip test

`SHARED_CP_SCRIPT_ID` is declared independently in `functions/_lib/cpShareHtml.ts` and
`src/cp-workspace/share/sharedCpBootstrap.ts`. If either drifts, every share quietly falls
back to the `id` fetch path — losing the halved read cost and the no-flash first paint, with
no error anywhere.

- Move it into a shared module both import (`src/lib/shareCardText.ts` already crosses that
  boundary; either extend it or add a sibling).
- Add the test that actually matters: feed `renderSharedCpHtml`'s output to the client's
  `inlinedSharedCp()` parser and assert the payload survives. That binds the two **by
  behaviour**, so it keeps holding even if the contract grows past a single constant.

### 6. Client-side navigation to `/s/<id>` must do something

`ensureEditCreasePattern` early-returns when a document is open, stranding the pending share.
Its comment calls this unreachable because "a share link is always a full page load" — which
was true until `/s/:shareId` became a real route.

Give it explicit behaviour: when a share is pending and a document is already open, confirm
through the existing `confirmDiscardDirty` before replacing it. Silently doing nothing is the
one outcome to rule out.

### 7. Wider ids, so a collision stays theoretical

The collision check reads KV, which is eventually consistent, so it cannot prevent a race —
and a lost race means one person's link serves another's crease pattern, silently.

Go from 8 to 10 characters. 62¹⁰ ≈ 8.4×10¹⁷ drops the birthday probability at a million
shares from ~2×10⁻³ to ~6×10⁻⁷ — roughly 3,800× — for two characters of URL.

The validator must accept **8–12** so links already created keep resolving. Log when the
existence check does catch a collision; it should never fire, and if it does we want to know.

### 8. Measure the CPU ceiling, and pin the SPA fallback

- The free plan allows **10 ms CPU per invocation**. `/s/<id>` inlines up to 24 KB and runs
  ten regex passes. Measure with a worst-case payload rather than assuming.
- A custom `404.html` would make Pages serve it instead of `index.html`, and `/s/<id>` would
  render an error page. The smoke test's fourth assertion covers this; note the constraint
  where someone would look before adding one.

### 9. Close the two small security gaps

- `X-Content-Type-Options: nosniff` on Function responses. Cheap, and the thumbnail endpoint
  serves user-supplied bytes.
- Validate the uploaded PNG's magic bytes (also item 4) so `image/png` is verified, not
  trusted.

### 10. Cover the round trip and the flatness gate

- **Round-trip integration test** at the handler level: `POST /api/cp` → `GET /s/<id>` →
  parse the inlined payload with the client's own reader → assert it matches. No browser, and
  it covers the seam that three separate units currently cover only in halves.
- **Flatness gate**, on a real non-flat pattern rather than only the pure predicate: assert
  the share modal and the export dialog both disable the folded-figure toggle and say why.

---

## Affected Areas

**Deploy and CI**
- `.github/workflows/deploy-web.yml`, `deploy-pr-preview.yml` — capture the deployment URL, run the smoke script
- `scripts/share-smoke.mjs` (new) — the four read-only assertions

**Worker**
- `apps/web/functions/_lib/cpShare.ts` — id length + validator range, PNG magic-byte check, `nosniff`, collision logging
- `apps/web/functions/api/cp.ts` — id minting
- `apps/web/functions/api/cp/[id]/thumbnail.ts` — magic-byte validation, `nosniff`
- `apps/web/functions/s/[[shareId]].ts` — CPU instrumentation

**Frontend**
- `apps/web/src/cp-workspace/share/cpShareService.ts` — `fetchCpShareWithRetry`, thumbnail upload retry
- `apps/web/src/cp-workspace/share/sharedCpBootstrap.ts` — import the shared constant
- `apps/web/src/lib/shareCardText.ts` (or a sibling) — owns `SHARED_CP_SCRIPT_ID`
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — retry + status, document-open behaviour
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — thumbnail retry, blank-card guard
- `apps/web/src/lib/toastMessages.ts` — softer not-found copy, read-quota case
- The CP surface — render the loading status

**Assets and tests**
- `scripts/generate-og-default.mjs` + `apps/web/public/og-default.png` — 1000×525
- `apps/web/functions/__tests__/cpShare.test.ts` — round trip, magic bytes, id range
- `apps/web/src/cp-workspace/share/*.test.ts` — retry behaviour, blank-card guard
- New: default-card dimension test, flatness-gate component test

---

## Checklist

### Phase 1 — Prove the deploy (highest value, blocks trusting anything else)

- [x] `scripts/share-smoke.mjs` with the four read-only assertions; non-zero exit on mismatch.
- [x] Wire it into `deploy-web.yml` after the deploy step, against the deployment URL.
- [x] Same for `deploy-pr-preview.yml`, so preview deploys prove their own bindings.
- [ ] Run it once against a real deploy and record the result. **Until this passes, treat the
      feature as unshipped.**
- [ ] Confirm whether `[[env.preview]]` bindings actually apply to `--branch=pr-N`; if not,
      configure preview bindings in the dashboard and note it in `wrangler.toml`.

### Phase 2 — Stop the lie (the failure users will actually hit)

- [x] `fetchCpShareWithRetry` — 404-only backoff to ~60s, abortable.
- [x] Quota copy stays vague — decided, see Approach §3. No reset-time interpolation.
- [x] Status on the store for an in-flight shared-CP fetch; CP surface renders it.
- [x] Soften the exhausted-retry message; add the read-quota case to `toastMessages.ts`.
- [x] Tests: retries on 404, does **not** retry on 400/503, gives up and reports.

### Phase 3 — Make silent degradation impossible

- [x] Single `SHARED_CP_SCRIPT_ID`, imported by Worker and client.
- [x] Round-trip test: `renderSharedCpHtml` output → `inlinedSharedCp()` → payload matches.
- [x] Client-side navigation to `/s/<id>` with a document open: confirm-then-replace via
      `confirmDiscardDirty`; delete the stale "unreachable" comment.
- [x] Test that navigating to a share with a document open does not silently no-op.

### Phase 4 — Thumbnails

- [ ] Upload retry, 3× with backoff.
- [ ] Reject a card under ~2 KB rather than uploading a blank one.
- [ ] Server-side PNG magic-byte validation.
- [ ] Regenerate `og-default.png` at 1000×525; test pinning it to `SHARE_CARD_*`.

### Phase 5 — Limits and abuse

- [x] Ids to 10 chars; validator accepts 8–12; log a caught collision.
- [ ] `X-Content-Type-Options: nosniff` on Function responses.
- [ ] Measure `/s/<id>` CPU with a 24 KB payload against the 10 ms ceiling; record it.
- [ ] Note the "no `404.html`" constraint where someone would look before adding one.
- [ ] Spike a Durable Object rate-limit counter; adopt it if the free-plan story holds,
      otherwise document the 500/day ceiling and the Workers Paid trigger.
- [ ] Runbook: what to do when KV writes or reads are exhausted.

### Phase 6 — Coverage

- [x] Handler-level round-trip: create → serve → parse → open.
- [ ] Flatness gate on a real non-flat pattern, in both dialogs.
- [ ] Re-run the full suite and the smoke test; record both in the PR.

---

## Open questions

1. **Durable Objects on the free plan** — do SQLite-backed DOs cover a per-IP counter at zero
   marginal cost? If yes, Phase 5 restores 1 write/share and doubles the creation ceiling. If
   no, the KV counter stays and 500/day is the documented limit.
2. **Preview-environment bindings.** If `[[env.preview]]` does not apply to branch deploys,
   PR previews either share production KV (bad) or have no bindings (smoke test catches it).
   Decide which before turning previews loose.
3. **Retry window vs. perceived hang.** ~60s of retrying is correct for propagation and long
   for a person staring at a loading state. Consider surfacing a "still trying…" state after
   the first few seconds rather than a single spinner for a minute.
