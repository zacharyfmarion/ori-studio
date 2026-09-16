"""Shared current CP detector model metadata for product-side scripts."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


CONFIG_PATH = Path(os.environ.get("CP_DETECT_MODEL_POINTER", Path(__file__).with_name("current-model.json")))


def load_current_model() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def default_detector_repo(config: dict[str, Any] | None = None) -> Path:
    config = config or load_current_model()
    detector = config["detector_repo"]
    env_name = detector.get("env", "CP_DETECTOR_REPO")
    return Path(os.environ.get(env_name, detector["canonical_path"])).expanduser()


def current_checkpoint(config: dict[str, Any] | None = None) -> Path:
    config = config or load_current_model()
    if "checkpoint" not in config["detector_repo"]:
        raise ValueError("Current model is pixel-vertex; use research/export_pixel_model.py. For legacy CPLineNet tools set CP_DETECT_MODEL_POINTER=scripts/cp-detect/legacy-cpline-model.json")
    return Path(config["detector_repo"]["checkpoint"])


def current_checkpoint_manifest(config: dict[str, Any] | None = None) -> Path:
    config = config or load_current_model()
    current_checkpoint(config)  # Reject an incompatible model before looking up legacy metadata.
    return Path(config["detector_repo"]["checkpoint_manifest"])
