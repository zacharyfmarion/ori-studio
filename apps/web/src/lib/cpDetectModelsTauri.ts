/**
 * The desktop's model store: files under the app data directory, kept by the
 * shell's `cp_detect_model_*` commands. The page still downloads and verifies
 * the bytes — the same code as the web — and hands them across the IPC as a
 * raw body, never JSON, so 45 MB is a copy and not a base64 string. The
 * native runtime then opens the file by path, so `get` serves no bytes.
 */
import { invoke } from '@tauri-apps/api/core';
import type { CpDetectInstalledModel, CpDetectModelStore } from './cpDetectModels';

interface StoredModel {
  id: string;
  size_bytes: number;
  sha256: string;
  installed_at: string;
}

export function tauriModelStore(invokeImpl: typeof invoke = invoke): CpDetectModelStore {
  const list = async (): Promise<CpDetectInstalledModel[]> => {
    const models = await invokeImpl<StoredModel[]>('cp_detect_model_list');
    return models.map((model) => ({
      id: model.id,
      size_bytes: model.size_bytes,
      sha256: model.sha256,
      installed_at: model.installed_at,
    }));
  };
  return {
    list,
    async get() {
      return null;
    },
    async put(id, bytes, meta) {
      await invokeImpl('cp_detect_model_store', bytes, {
        headers: { 'x-model-id': id, 'x-model-sha256': meta.sha256 },
      });
    },
    async remove(id) {
      return invokeImpl<boolean>('cp_detect_model_remove', { id });
    },
    async installed(id, sha256) {
      return (await list()).some((model) => model.id === id && model.sha256 === sha256);
    },
  };
}
