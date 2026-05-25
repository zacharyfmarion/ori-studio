# CP Detector V2 Local Model Assets

This directory is the local development location for browser CP detector model
artifacts. Large generated assets are ignored by git.

Expected local files:

```text
model.onnx
manifest.json
```

Keep `manifest.example.json` committed as the schema reference. The real
`manifest.json` should point to `model.onnx`, include a SHA-256 checksum when
available, and use tensor names that match the exported CPLineNet-V2 ONNX file.

The first implementation phase uses local ignored assets. A later release phase
will publish these files as versioned release or CDN assets and configure the
app to fetch them by URL.
