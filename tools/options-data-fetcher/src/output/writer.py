from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def ensure_output_dirs(raw_dir: Path, normalized_dir: Path) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    normalized_dir.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2, ensure_ascii=False, sort_keys=False)
        file.write("\n")
    return path
