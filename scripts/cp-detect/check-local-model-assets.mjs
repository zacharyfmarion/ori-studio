#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const currentModelPath = resolve(import.meta.dirname, 'current-model.json');
const currentModel = JSON.parse(readFileSync(currentModelPath, 'utf8'));
const modelDir = resolve(root, currentModel.stable_model_asset_dir);
const manifestPath = resolve(modelDir, 'manifest.json');
const expectedModelId = currentModel.model_id;
const expectedModelSha256 = currentModel.model_sha256;

function fail(message) {
  console.error(`cp-detect assets: ${message}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail(`missing ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schema !== 'oristudio/cp-detect-model-manifest/v1') {
  fail(`unsupported manifest schema ${JSON.stringify(manifest.schema)}`);
}
if (manifest.id !== expectedModelId) {
  fail(`wrong model id: expected ${expectedModelId}, got ${JSON.stringify(manifest.id)}`);
}

const modelUrl = manifest.model?.url;
if (typeof modelUrl !== 'string' || modelUrl.trim() === '') {
  fail('manifest.model.url must name the ONNX model file');
}

const modelPath = resolve(modelDir, modelUrl);
if (!existsSync(modelPath)) {
  fail(`missing ${modelPath}`);
}

const size = statSync(modelPath).size;
if (manifest.model.size_bytes != null && Number(manifest.model.size_bytes) !== size) {
  fail(`model size mismatch: manifest=${manifest.model.size_bytes} actual=${size}`);
}

if (manifest.model.sha256 && !String(manifest.model.sha256).startsWith('replace-')) {
  const digest = createHash('sha256').update(readFileSync(modelPath)).digest('hex');
  if (digest !== manifest.model.sha256) {
    fail(`model sha256 mismatch: manifest=${manifest.model.sha256} actual=${digest}`);
  }
  if (digest !== expectedModelSha256) {
    fail(`wrong model sha256: expected current ${expectedModelSha256}, got ${digest}`);
  }
}

console.log(`cp-detect assets ok: ${modelPath} (${size} bytes)`);
