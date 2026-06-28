"""Shared current V3 vertex-refiner metadata for product-side scripts."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


CONFIG_PATH = Path(__file__).with_name("current-vertex-refiner.json")


def load_current_vertex_refiner() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def default_detector_repo(config: dict[str, Any] | None = None) -> Path:
    config = config or load_current_vertex_refiner()
    detector = config["detector_repo"]
    env_name = detector.get("env", "CP_DETECTOR_REPO")
    return Path(os.environ.get(env_name, detector["canonical_path"])).expanduser()


def current_checkpoint(config: dict[str, Any] | None = None) -> Path:
    config = config or load_current_vertex_refiner()
    return Path(config["detector_repo"]["checkpoint"])


def current_checkpoint_metrics(config: dict[str, Any] | None = None) -> Path:
    config = config or load_current_vertex_refiner()
    return Path(config["detector_repo"]["checkpoint_metrics"])
