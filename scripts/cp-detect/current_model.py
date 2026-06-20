"""Shared current CP detector model metadata for product-side scripts."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


CONFIG_PATH = Path(__file__).with_name("current-model.json")


def load_current_model() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def default_detector_repo(config: dict[str, Any] | None = None) -> Path:
    config = config or load_current_model()
    detector = config["detector_repo"]
    env_name = detector.get("env", "CP_DETECTOR_REPO")
    return Path(os.environ.get(env_name, detector["canonical_path"])).expanduser()


def current_checkpoint(config: dict[str, Any] | None = None) -> Path:
    config = config or load_current_model()
    return Path(config["detector_repo"]["checkpoint"])


def current_checkpoint_manifest(config: dict[str, Any] | None = None) -> Path:
    config = config or load_current_model()
    return Path(config["detector_repo"]["checkpoint_manifest"])
