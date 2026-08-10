"""Shared deterministic helpers for the J.O.B. UI asset generators."""

from __future__ import annotations

import hashlib
import platform
import re
import shutil
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "assets" / "ui"
PUBLIC_ASSET_ROOT = ROOT / "public" / "assets" / "ui"
LEDGER = ROOT / "docs" / "art" / "ASSET_LEDGER.md"

GOLD = "#FFD23F"
CYAN = "#38E1FF"
RED = "#FF4D5A"
GREEN = "#58E07C"
MAGENTA = "#FF4FA3"
SURFACE_DARK = "#101420"
SURFACE = "#2A3242"
TEXT = "#EEF2F6"
DIM = "#9AA7B5"
LINE = "#6B7483"


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def rgba(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    return (*rgb(value), alpha)


def ensure(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_text(path: Path, content: str) -> None:
    ensure(path)
    path.write_text(content, encoding="utf-8", newline="\n")


def svg_doc(width: int, height: int, body: str, extra: str = "") -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" fill="none" shape-rendering="geometricPrecision">'
        f"{extra}{body}</svg>\n"
    )


def poly(points: list[tuple[float, float]]) -> str:
    return " ".join(f"{x:g},{y:g}" for x, y in points)


def clipped_points(w: int, h: int, clip: int = 16) -> list[tuple[int, int]]:
    return [(0, 0), (w - clip, 0), (w, clip), (w, h), (0, h)]


_LOCAL_FONT_MATCHES = {
    "display": ("archivoblack", "bahnschrift", "arialblack", "dejavusansbold"),
    "ledger": ("ibmplexmono", "cascadiamono", "consolas", "dejavusansmono"),
}

_SYSTEM_FONTS = {
    "Windows": {
        "display": (
            "C:/Windows/Fonts/ArchivoBlack-Regular.ttf",
            "C:/Windows/Fonts/bahnschrift.ttf",
            "C:/Windows/Fonts/ariblk.ttf",
            "C:/Windows/Fonts/DejaVuSans-Bold.ttf",
        ),
        "ledger": (
            "C:/Windows/Fonts/IBMPlexMono-Regular.ttf",
            "C:/Windows/Fonts/CascadiaMono.ttf",
            "C:/Windows/Fonts/consola.ttf",
            "C:/Windows/Fonts/DejaVuSansMono.ttf",
        ),
        # Tier 1 was originally exported with these exact Windows faces. Keeping
        # compatibility roles preserves its checked-in hashes while the public
        # display/ledger roles follow the cross-platform preference order above.
        "legacy_display": ("C:/Windows/Fonts/arialbd.ttf",),
        "legacy_ledger": ("C:/Windows/Fonts/consolab.ttf",),
    },
    "Darwin": {
        "display": (
            "/Library/Fonts/ArchivoBlack-Regular.ttf",
            "/System/Library/Fonts/Supplemental/Arial Black.ttf",
            "/Library/Fonts/DejaVuSans-Bold.ttf",
        ),
        "ledger": (
            "/Library/Fonts/IBMPlexMono-Regular.ttf",
            "/Library/Fonts/CascadiaMono.ttf",
            "/System/Library/Fonts/Supplemental/Courier New.ttf",
            "/Library/Fonts/DejaVuSansMono.ttf",
        ),
    },
    "Linux": {
        "display": (
            "/usr/share/fonts/truetype/archivo/ArchivoBlack-Regular.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Arial_Black.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ),
        "ledger": (
            "/usr/share/fonts/truetype/ibm-plex/IBMPlexMono-Regular.ttf",
            "/usr/share/fonts/truetype/cascadia/CascadiaMono.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Consolas.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        ),
    },
}


def _normalized_font_name(path: Path) -> str:
    return re.sub(r"[^a-z0-9]", "", path.stem.lower())


@lru_cache(maxsize=None)
def resolve_font(role: str) -> Path | None:
    """Resolve a project-local or platform font for a semantic typography role."""
    base_role = role.removeprefix("legacy_")
    if base_role not in _LOCAL_FONT_MATCHES:
        raise ValueError(f"unknown font role: {role}")

    local_root = ROOT / "assets" / "fonts"
    if local_root.exists():
        local_files = sorted(
            path for path in local_root.rglob("*")
            if path.is_file() and path.suffix.lower() in {".ttf", ".otf", ".ttc"}
        )
        for wanted in _LOCAL_FONT_MATCHES[base_role]:
            for candidate in local_files:
                if wanted in _normalized_font_name(candidate):
                    return candidate

    system = platform.system()
    role_candidates = _SYSTEM_FONTS.get(system, {}).get(role, ())
    if not role_candidates and role.startswith("legacy_"):
        role_candidates = _SYSTEM_FONTS.get(system, {}).get(base_role, ())
    for value in role_candidates:
        candidate = Path(value)
        if candidate.exists():
            return candidate

    # Contributors sometimes mount fonts in a non-native path (for example a
    # Windows checkout in WSL), so try the other documented platform chains.
    for system_name in ("Windows", "Darwin", "Linux"):
        for value in _SYSTEM_FONTS.get(system_name, {}).get(base_role, ()):
            candidate = Path(value)
            if candidate.exists():
                return candidate

    print(f"warning: no {base_role} font found; using Pillow's default font")
    return None


def font(role: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = resolve_font(role)
    if path is not None:
        return ImageFont.truetype(str(path), size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def fit_font(
    text: str,
    max_width: int,
    initial: int,
    role: str = "display",
) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    size = initial
    while size > 10:
        face = font(role, size)
        bbox = face.getbbox(text)
        if bbox[2] - bbox[0] <= max_width:
            return face
        size -= 2
    return font(role, 10)


def font_provenance(role: str) -> str:
    path = resolve_font(role)
    if path is None:
        return "Pillow default"
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def save_svg_png(rel_stem: str, svg: str, image: Image.Image) -> None:
    svg_path = ASSET_ROOT / f"{rel_stem}.svg"
    png_path = ASSET_ROOT / f"{rel_stem}@1x.png"
    write_text(svg_path, svg)
    ensure(png_path)
    rgba = image if image.mode == "RGBA" else image.convert("RGBA")
    if png_path.exists():
        try:
            with Image.open(png_path) as existing:
                if (
                    existing.mode == "RGBA"
                    and existing.size == rgba.size
                    and existing.tobytes() == rgba.tobytes()
                ):
                    return
        except (OSError, ValueError):
            pass
    rgba.save(png_path, "PNG", optimize=False)


def sync_public_assets() -> None:
    """Mirror generated assets into Vite's production public directory."""
    for source in ASSET_ROOT.rglob("*"):
        if not source.is_file():
            continue
        target = PUBLIC_ASSET_ROOT / source.relative_to(ASSET_ROOT)
        ensure(target)
        shutil.copy2(source, target)


def dimensions(path: Path) -> str:
    if path.suffix.lower() == ".png":
        with Image.open(path) as image:
            return f"{image.width}x{image.height}"
    text = path.read_text(encoding="utf-8")
    match = re.search(r'<svg[^>]*width="([^"]+)"[^>]*height="([^"]+)"', text)
    return f"{match.group(1)}x{match.group(2)}" if match else "unknown"


def update_ledger() -> None:
    entries = []
    for path in sorted(ASSET_ROOT.rglob("*")):
        if path.suffix.lower() not in {".svg", ".png"}:
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        rel = path.relative_to(ROOT).as_posix()
        entries.append(f"| `{rel}` | `{dimensions(path)}` | `{digest}` | development_candidate |")
    table = "\n".join([
        "| Path | Dimensions | SHA-256 (first 12) | Review |",
        "| --- | --- | --- | --- |",
        *entries,
    ])
    existing = LEDGER.read_text(encoding="utf-8") if LEDGER.exists() else ""
    start = "<!-- GENERATED_LEDGER_START -->"
    end = "<!-- GENERATED_LEDGER_END -->"
    if start in existing and end in existing:
        prefix, rest = existing.split(start, 1)
        _, suffix = rest.split(end, 1)
        updated = f"{prefix}{start}\n{table}\n{end}{suffix}"
    else:
        updated = existing + f"\n{start}\n{table}\n{end}\n"
    LEDGER.write_text(updated, encoding="utf-8", newline="\n")
