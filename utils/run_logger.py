"""Structured run logging. Every train/eval writes to runs/{ts}_{name}/.

Usage:
    from utils.run_logger import RunLogger

    with RunLogger("seller_quality") as log:
        log.config({"model": "gemma2:9b", "n": 50})
        for ep in episodes:
            log.metric({"episode": ep.id, "rounds": ep.rounds, ...})
        log.summary({"mean_rounds": 5.2, "capitulation_rate": 0.04})
"""

import datetime as _dt
import json
import pathlib
import subprocess
import sys


class RunLogger:
    def __init__(self, name: str, root: str = "runs"):
        ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.dir = pathlib.Path(root) / f"{ts}_{name}"
        self.name = name
        self._metrics_fh = None

    def __enter__(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        self._metrics_fh = open(self.dir / "metrics.jsonl", "w")
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._metrics_fh:
            self._metrics_fh.close()
        return False

    def _git_sha(self) -> str:
        try:
            out = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL
            )
            return out.decode().strip()
        except Exception:
            return "unknown"

    def config(self, cfg: dict):
        cfg = {**cfg, "git_sha": self._git_sha(), "argv": sys.argv}
        (self.dir / "config.json").write_text(json.dumps(cfg, indent=2, default=str))

    def metric(self, row: dict):
        self._metrics_fh.write(json.dumps(row, default=str) + "\n")
        self._metrics_fh.flush()

    def summary(self, summary: dict):
        (self.dir / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

    def path(self, name: str) -> pathlib.Path:
        return self.dir / name
