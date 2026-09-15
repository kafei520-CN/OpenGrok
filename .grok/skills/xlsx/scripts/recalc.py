#!/usr/bin/env python3
"""Recalculate Excel formulas with LibreOffice when it is installed."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def find_soffice() -> str | None:
    for key in ("LIBREOFFICE_PATH", "SOFFICE"):
        value = os.environ.get(key)
        if value and Path(value).exists():
            return value
    for name in ("soffice", "soffice.exe"):
        hit = shutil.which(name)
        if hit:
            return hit
    for candidate in (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/usr/bin/soffice",
        "/usr/lib/libreoffice/program/soffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ):
        if Path(candidate).exists():
            return candidate
    return None


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: recalc.py file.xlsx [timeout_seconds]"}))
        return 1
    src = Path(sys.argv[1]).expanduser().resolve()
    if not src.exists():
        print(json.dumps({"error": f"missing file: {src}"}))
        return 1
    timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 45
    binary = find_soffice()
    if not binary:
        print(
            json.dumps(
                {
                    "status": "skipped",
                    "error": "LibreOffice (soffice) not found. Formulas were written; Excel will calculate them on open.",
                }
            )
        )
        return 0
    cmd = [
        binary,
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--norestore",
        "--convert-to",
        "xlsx",
        "--outdir",
        str(src.parent),
        str(src),
    ]
    try:
        subprocess.run(cmd, check=True, timeout=timeout, capture_output=True)
    except subprocess.TimeoutExpired:
        print(json.dumps({"error": f"LibreOffice timed out after {timeout}s"}))
        return 1
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or b"").decode("utf-8", "replace")[:400]
        print(json.dumps({"error": detail or str(error)}))
        return 1
    print(json.dumps({"status": "success", "path": str(src)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
