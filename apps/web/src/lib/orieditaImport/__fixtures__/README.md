# `.oriconfig` fixtures

Archives for `oriconfigArchive.test.ts`. None of these was assembled byte by
byte: each is either a real archive or a documented mutation of one, because a
hand-built zip would only ever encode what the reader already believes.

| File | Provenance |
| --- | --- |
| `sample.oriconfig` | **Real**, written by JDK 17 `ZipOutputStream` the way `FileSaveServiceImpl.exportPref` writes it. Carries the trap this module is built around: general-purpose bit 3 (flags `0x0808`), so every local header reports zero for both sizes. |
| `no-hotkey.oriconfig` | Info-ZIP, deflated, `config.json` + `tooltip.properties`. The export of a user who never edited a hotkey. Its local extra field is 28 bytes against the central record's 24, so it also covers reading each variable length from the header it belongs to. |
| `stored.oriconfig` | Info-ZIP `-0`, so both entries are STORED. Java never emits method 0; other producers do. |
| `truncated-tail.oriconfig` | `sample` minus its last 40 bytes — the end-of-central-directory record is gone. |
| `truncated-body.oriconfig` | `sample` with bytes 120–183 removed. The tail survives, so an EOCD is still found, but everything it points at has shifted. |
| `corrupt-deflate.oriconfig` | `sample` with 24 bytes of `hotkey.properties`' compressed data XORed with `0xa5` in place. Every offset and length stays valid; only the deflate stream is unreadable. |
| `unsupported-method.oriconfig` | `sample` with `hotkey.properties`' compression method relabelled 12 (bzip2) in both its central record and its local header. The local Info-ZIP build has no bzip2, and the reader never looks at the data of a method it does not implement, which is the behaviour under test. |

The Info-ZIP archives hold the same `config.json` and `hotkey.properties` text as
`sample.oriconfig`, extracted from it rather than retyped.
