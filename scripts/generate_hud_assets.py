"""Generate the deterministic Tier 1 J.O.B. HUD asset kit.

The source of truth is the SVG master written by this script. Pillow is used
only for deterministic RGBA derivatives and the generated asset ledger.
"""

from __future__ import annotations

import html
from pathlib import Path

from PIL import Image, ImageDraw

from _asset_lib import (
    ASSET_ROOT,
    CYAN,
    DIM,
    GOLD,
    GREEN,
    LINE,
    MAGENTA,
    RED,
    SURFACE,
    SURFACE_DARK,
    TEXT,
    clipped_points,
    fit_font,
    font,
    poly,
    rgba,
    save_svg_png as save_asset_pair,
    svg_doc,
    sync_public_assets,
    update_ledger,
)


VERSION = "hud-assets-v1"


def save_svg_png(rel_stem: str, svg: str, image: Image.Image) -> None:
    """Regenerate masters while keeping the approved Tier 1 PNG bytes frozen."""
    save_asset_pair(rel_stem, svg, image, preserve_existing_png=True)


def svg_panel(w: int, h: int, fill: str, edge: str, accent: str, clip: int = 16) -> str:
    p = poly(clipped_points(w, h, clip))
    body = f"""
    <polygon points="{p}" fill="{fill}"/>
    <polyline points="{p} 0,0" stroke="{edge}" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <path d="M 12 {h - 14} H 40" stroke="{accent}" stroke-width="2" opacity=".8"/>
    <path d="M 12 14 H 30" stroke="{edge}" stroke-width="1" opacity=".7"/>
    <path d="M {w - clip + 2} 3 L {w - 3} {clip - 3}" stroke="{accent}" stroke-width="1" opacity=".75"/>
    """
    return svg_doc(w, h, body)


def png_panel(size: tuple[int, int], fill: str, edge: str, accent: str, clip: int = 16) -> Image.Image:
    w, h = size
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    points = clipped_points(w, h, max(4, int(clip * w / 96)))
    d.polygon(points, fill=rgba(fill))
    d.line(points + [points[0]], fill=rgba(edge), width=max(1, round(w / 48)), joint="curve")
    d.line([(round(w * 0.125), h - round(h * 0.145)), (round(w * 0.42), h - round(h * 0.145))], fill=rgba(accent, 210), width=max(1, round(w / 48)))
    d.line([(round(w * 0.125), round(h * 0.145)), (round(w * 0.31), round(h * 0.145))], fill=rgba(edge, 170), width=max(1, round(w / 96)))
    return im


def svg_button(w: int, h: int, fill: str, edge: str, accent: str, disabled: bool = False) -> str:
    clip = max(10, round(h * 0.24))
    p = poly(clipped_points(w, h, clip))
    opacity = ".55" if disabled else "1"
    body = f"""
    <polygon points="{p}" fill="{fill}" opacity="{opacity}"/>
    <polyline points="{p} 0,0" stroke="{edge}" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <path d="M 12 {h - 14} H {min(70, w // 3)}" stroke="{accent}" stroke-width="2" opacity="{opacity}"/>
    <path d="M {w - clip + 2} 3 L {w - 3} {clip - 3}" stroke="{accent}" stroke-width="1" opacity="{opacity}"/>
    <path d="M 18 13 H 28" stroke="{edge}" stroke-width="1" opacity=".65"/>
    """
    return svg_doc(w, h, body)


def png_button(size: tuple[int, int], fill: str, edge: str, accent: str, disabled: bool = False) -> Image.Image:
    w, h = size
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    clip = max(8, round(h * 0.24))
    points = clipped_points(w, h, clip)
    alpha = 145 if disabled else 255
    d.polygon(points, fill=rgba(fill, alpha))
    d.line(points + [points[0]], fill=rgba(edge, alpha), width=max(1, round(h / 40)), joint="curve")
    d.line([(12, h - 14), (min(70, w // 3), h - 14)], fill=rgba(accent, alpha), width=max(1, round(h / 40)))
    d.line([(w - clip + 2, 3), (w - 3, clip - 3)], fill=rgba(accent, alpha), width=max(1, round(h / 80)))
    d.line([(18, 13), (28, 13)], fill=rgba(edge, 165 if not disabled else 100), width=max(1, round(h / 80)))
    return im


def svg_slot(kind: str, accent: str) -> str:
    w = h = 128
    edge = DIM if kind == "empty" else accent
    dash = ' stroke-dasharray="7 7"' if kind == "empty" else ""
    body = f"""
    <path d="M 8 30 V 8 H 30 M 98 8 H 120 V 30 M 120 98 V 120 H 98 M 30 120 H 8 V 98" stroke="{edge}" stroke-width="3"{dash} opacity=".95"/>
    <path d="M 8 46 H 18 M 110 46 H 120 M 8 82 H 18 M 110 82 H 120" stroke="{edge}" stroke-width="2" opacity=".65"/>
    <path d="M 20 20 H 48" stroke="{edge}" stroke-width="2" opacity=".65"/>
    <path d="M 80 108 H 108" stroke="{edge}" stroke-width="2" opacity=".65"/>
    """
    if kind == "special-module":
        body += f'<path d="M 44 8 V 0 H 84 V 8 M 52 0 V 5 M 76 0 V 5" stroke="{accent}" stroke-width="3"/>'
    elif kind == "passive-module":
        body += f'<path d="M 44 120 V 128 H 84 V 120 M 52 123 V 128 M 76 123 V 128" stroke="{accent}" stroke-width="3"/>'
    elif kind == "dash":
        body += f'<path d="M 48 64 H 80 M 72 56 L 80 64 L 72 72" stroke="{accent}" stroke-width="3" opacity=".85"/>'
    else:
        body += f'<path d="M 48 64 H 80 M 64 48 V 80" stroke="{accent}" stroke-width="2" opacity=".55"/>'
    return svg_doc(w, h, body)


def png_slot(kind: str, accent: str) -> Image.Image:
    im = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    edge = DIM if kind == "empty" else accent
    width = 3
    points = [(8, 30), (8, 8), (30, 8), (98, 8), (120, 8), (120, 30), (120, 98), (120, 120), (98, 120), (30, 120), (8, 120), (8, 98)]
    # Four independent brackets leave the center visually quiet.
    d.line([(8, 30), (8, 8), (30, 8)], fill=rgba(edge), width=width)
    d.line([(98, 8), (120, 8), (120, 30)], fill=rgba(edge), width=width)
    d.line([(120, 98), (120, 120), (98, 120)], fill=rgba(edge), width=width)
    d.line([(30, 120), (8, 120), (8, 98)], fill=rgba(edge), width=width)
    if kind == "empty":
        for x in range(20, 112, 14):
            d.line([(x, 20), (x + 7, 20)], fill=rgba(edge, 150), width=2)
    else:
        d.line([(8, 46), (18, 46)], fill=rgba(edge, 170), width=2)
        d.line([(110, 46), (120, 46)], fill=rgba(edge, 170), width=2)
        d.line([(8, 82), (18, 82)], fill=rgba(edge, 170), width=2)
        d.line([(110, 82), (120, 82)], fill=rgba(edge, 170), width=2)
    if kind == "special-module":
        d.line([(44, 8), (44, 1), (84, 1), (84, 8)], fill=rgba(accent), width=3)
        d.line([(52, 1), (52, 5)], fill=rgba(accent), width=2)
        d.line([(76, 1), (76, 5)], fill=rgba(accent), width=2)
    elif kind == "passive-module":
        d.line([(44, 120), (44, 127), (84, 127), (84, 120)], fill=rgba(accent), width=3)
        d.line([(52, 123), (52, 127)], fill=rgba(accent), width=2)
        d.line([(76, 123), (76, 127)], fill=rgba(accent), width=2)
    elif kind == "dash":
        d.line([(48, 64), (80, 64)], fill=rgba(accent, 220), width=3)
        d.line([(72, 56), (80, 64), (72, 72)], fill=rgba(accent, 220), width=3)
    else:
        d.line([(48, 64), (80, 64)], fill=rgba(accent, 150), width=2)
        d.line([(64, 48), (64, 80)], fill=rgba(accent, 150), width=2)
    return im


def svg_equipment(kind: str) -> str:
    stroke = TEXT
    accent = GOLD if kind in {"head", "trinket"} else CYAN
    body = ""
    if kind == "head":
        body = f'<path d="M 15 44 V 31 C 15 16 49 10 49 10 C 67 10 76 21 76 35 V 44 H 15 Z M 12 45 H 82 V 53 H 12 Z" fill="{accent}" stroke="{stroke}" stroke-width="3"/><path d="M 30 26 H 65" stroke="{SURFACE_DARK}" stroke-width="4"/>'
    elif kind == "body":
        body = f'<path d="M 22 16 L 38 10 H 58 L 74 16 L 82 57 H 14 Z" fill="{CYAN}" stroke="{stroke}" stroke-width="3"/><path d="M 47 12 V 57 M 35 20 L 47 34 L 59 20" stroke="{SURFACE_DARK}" stroke-width="3"/><path d="M 16 43 H 78" stroke="{GOLD}" stroke-width="3"/>'
    elif kind == "hands":
        body = f'<path d="M 14 47 C 10 39 12 23 18 22 L 25 36 V 13 C 25 8 32 8 33 13 V 31 L 36 14 C 37 9 44 10 44 15 V 33 L 47 18 C 48 13 55 14 55 19 V 42 C 55 55 43 61 31 57 Z" fill="{accent}" stroke="{stroke}" stroke-width="3"/><path d="M 52 42 C 52 29 58 25 64 25 L 68 16 C 70 11 77 13 75 18 L 71 31 L 77 24 C 80 20 86 24 83 28 L 74 42 C 68 52 59 54 52 42 Z" fill="{CYAN}" stroke="{stroke}" stroke-width="3"/>'
    elif kind == "feet":
        body = f'<path d="M 18 10 H 43 V 39 L 58 48 C 64 52 61 60 54 60 H 12 C 7 60 7 52 12 48 L 18 42 Z" fill="{CYAN}" stroke="{stroke}" stroke-width="3"/><path d="M 69 10 H 91 V 38 L 98 47 C 103 53 99 60 92 60 H 60 C 55 60 53 53 57 48 L 69 39 Z" fill="{accent}" stroke="{stroke}" stroke-width="3"/>'
    elif kind == "trinket":
        body = f'<path d="M 42 10 C 19 10 17 29 31 35 C 46 42 42 54 28 54 C 14 54 11 39 23 34" stroke="{accent}" stroke-width="7"/><path d="M 48 54 C 73 54 76 35 61 28 C 46 21 51 10 64 10 C 79 10 82 24 71 30" stroke="{CYAN}" stroke-width="7"/><circle cx="42" cy="10" r="5" fill="{TEXT}"/><circle cx="48" cy="54" r="5" fill="{TEXT}"/>'
    elif kind == "passive-chip":
        body = f'<rect x="15" y="17" width="66" height="48" fill="{GREEN}" stroke="{stroke}" stroke-width="3"/><rect x="30" y="30" width="36" height="22" fill="{SURFACE_DARK}" stroke="{stroke}" stroke-width="2"/><path d="M 9 26 H 15 M 9 40 H 15 M 9 54 H 15 M 81 26 H 87 M 81 40 H 87 M 81 54 H 87" stroke="{GREEN}" stroke-width="4"/>'
    elif kind == "special-chip":
        body = f'<path d="M 13 15 H 78 L 87 24 V 66 H 13 Z" fill="{MAGENTA}" stroke="{stroke}" stroke-width="3"/><path d="M 28 27 H 67 M 28 39 H 67 M 28 51 H 55" stroke="{SURFACE_DARK}" stroke-width="4"/><circle cx="21" cy="24" r="3" fill="{GOLD}"/><circle cx="21" cy="37" r="3" fill="{GOLD}"/><circle cx="21" cy="50" r="3" fill="{GOLD}"/>'
    return svg_doc(96, 76, body)


def png_equipment(kind: str) -> Image.Image:
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = rgba(TEXT)
    gold = rgba(GOLD)
    cyan = rgba(CYAN)
    green = rgba(GREEN)
    magenta = rgba(MAGENTA)
    dark = rgba(SURFACE_DARK)
    if kind == "head":
        d.polygon([(8, 42), (8, 27), (17, 16), (35, 10), (50, 17), (52, 37), (52, 42)], fill=gold, outline=s)
        d.rectangle((5, 42, 55, 50), fill=gold, outline=s, width=2)
        d.line((20, 26, 43, 26), fill=dark, width=3)
    elif kind == "body":
        d.polygon([(18, 14), (30, 10), (46, 14), (52, 56), (10, 56)], fill=cyan, outline=s)
        d.line((31, 12, 31, 56), fill=dark, width=2)
        d.line((21, 22, 31, 34, 41, 22), fill=dark, width=2)
        d.line((12, 43, 50, 43), fill=gold, width=3)
    elif kind == "hands":
        d.polygon([(7, 42), (10, 24), (16, 21), (21, 34), (20, 13), (25, 12), (28, 32), (30, 15), (36, 16), (35, 39), (30, 52), (15, 53)], fill=gold, outline=s)
        d.polygon([(36, 42), (40, 26), (47, 25), (48, 16), (53, 17), (50, 31), (57, 24), (60, 28), (52, 43), (44, 52)], fill=cyan, outline=s)
    elif kind == "feet":
        d.polygon([(9, 10), (27, 10), (27, 38), (41, 48), (39, 57), (7, 57), (7, 49), (17, 40)], fill=cyan, outline=s)
        d.polygon([(39, 10), (54, 10), (54, 38), (60, 48), (57, 57), (39, 57), (35, 49), (45, 39)], fill=gold, outline=s)
    elif kind == "trinket":
        d.arc((9, 8, 43, 49), 105, 400, fill=gold, width=5)
        d.arc((22, 15, 57, 56), 285, 120, fill=cyan, width=5)
        d.ellipse((25, 7, 34, 16), fill=s)
        d.ellipse((30, 48, 39, 57), fill=s)
    elif kind == "passive-chip":
        d.rectangle((11, 11, 53, 53), fill=green, outline=s, width=2)
        d.rectangle((20, 22, 44, 42), fill=dark, outline=s, width=2)
        for y in (20, 32, 44):
            d.line((5, y, 11, y), fill=green, width=3)
            d.line((53, y, 59, y), fill=green, width=3)
    elif kind == "special-chip":
        d.polygon([(8, 9), (50, 9), (57, 16), (57, 55), (8, 55)], fill=magenta, outline=s)
        for y in (23, 33, 43):
            d.line((21, y, 47, y), fill=dark, width=3)
        for y in (17, 30, 43):
            d.ellipse((12, y - 3, 18, y + 3), fill=gold)
    return im


def svg_bar_frame(width: int, height: int, kind: str) -> str:
    clip = max(5, round(height * 0.42))
    edge = RED if kind == "boss" else (CYAN if kind in {"xp", "event"} else GREEN)
    p = clipped_points(width, height, clip)
    body = f'<polygon points="{poly(p)}" fill="{SURFACE_DARK}"/><polyline points="{poly(p)} 0,0" stroke="{LINE}" stroke-width="2" vector-effect="non-scaling-stroke"/>'
    if kind == "boss":
        teeth = " ".join(f"{x},{height - 2} {x + 6},{height - 7} {x + 12},{height - 2}" for x in range(20, width - 20, 20))
        body += f'<path d="M 16 {height - 2} L {teeth}" stroke="{RED}" stroke-width="2" opacity=".75"/>'
        body += f'<path d="M 16 3 H {width - 18}" stroke="{RED}" stroke-width="2" opacity=".65"/>'
    else:
        body += f'<path d="M 12 {height - 4} H {min(width - 30, 86)}" stroke="{edge}" stroke-width="2" opacity=".7"/>'
    return svg_doc(width, height, body)


def svg_bar_fill(width: int, height: int, color: str) -> str:
    body = f'<rect x="1" y="1" width="{width - 2}" height="{height - 2}" fill="{color}"/><path d="M 2 3 H {width - 3}" stroke="{TEXT}" stroke-width="1" opacity=".35"/>'
    return svg_doc(width, height, body)


def png_bar_frame(size: tuple[int, int], kind: str) -> Image.Image:
    w, h = size
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    clip = max(4, round(h * 0.42))
    points = clipped_points(w, h, clip)
    edge = RED if kind == "boss" else (CYAN if kind in {"xp", "event"} else GREEN)
    d.polygon(points, fill=rgba(SURFACE_DARK))
    d.line(points + [points[0]], fill=rgba(LINE), width=max(1, round(h / 10)), joint="curve")
    if kind == "boss":
        for x in range(20, w - 20, 20):
            d.line([(x, h - 2), (x + 6, h - 7), (x + 12, h - 2)], fill=rgba(RED, 205), width=max(1, round(h / 10)))
        d.line((16, 3, w - 18, 3), fill=rgba(RED, 170), width=max(1, round(h / 10)))
    else:
        d.line((12, h - 4, min(w - 30, 86), h - 4), fill=rgba(edge, 180), width=max(1, round(h / 10)))
    return im


def png_bar_fill(size: tuple[int, int], color: str) -> Image.Image:
    w, h = size
    im = Image.new("RGBA", size, rgba(color))
    d = ImageDraw.Draw(im)
    d.line((2, 2, w - 3, 2), fill=rgba(TEXT, 90), width=1)
    return im


def svg_combo_sheet() -> str:
    cell_w, cell_h = 64, 80
    rows = [(TEXT, "idle"), (GOLD, "warm"), (RED, "hot")]
    glyphs = list("0123456789×")
    body = ""
    for row, (color, _) in enumerate(rows):
        for col, glyph in enumerate(glyphs):
            x = col * cell_w + cell_w / 2
            y = row * cell_h + 58
            body += f'<text x="{x:g}" y="{y:g}" text-anchor="middle" fill="{color}" font-family="Archivo Black, Bahnschrift, Arial Black, sans-serif" font-size="54">{html.escape(glyph)}</text>'
    return svg_doc(cell_w * len(glyphs), cell_h * len(rows), body)


def png_combo_sheet() -> Image.Image:
    cell_w, cell_h = 64, 80
    im = Image.new("RGBA", (cell_w * 11, cell_h * 3), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    glyphs = list("0123456789×")
    for row, color in enumerate((TEXT, GOLD, RED)):
        f = font("display", 54)
        for col, glyph in enumerate(glyphs):
            bbox = d.textbbox((0, 0), glyph, font=f)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            x = col * cell_w + (cell_w - tw) // 2 - bbox[0]
            y = row * cell_h + (cell_h - th) // 2 - bbox[1] - 2
            d.text((x, y), glyph, font=f, fill=rgba(color))
    return im


def crosshair_svg(style: str, state: str) -> str:
    colors = {"idle": TEXT, "fire": GOLD, "hit-confirm": CYAN}
    color = colors[state]
    width = 2 if state == "idle" else 3
    body = ""
    if style == "plus":
        body = f'<path d="M 32 6 V 22 M 32 42 V 58 M 6 32 H 22 M 42 32 H 58" stroke="{color}" stroke-width="{width}"/><circle cx="32" cy="32" r="2" fill="{color}"/>'
    elif style == "brackets":
        body = f'<path d="M 10 24 V 10 H 24 M 40 10 H 54 V 24 M 54 40 V 54 H 40 M 24 54 H 10 V 40" stroke="{color}" stroke-width="{width}"/><circle cx="32" cy="32" r="2" fill="{color}"/>'
    elif style == "diamond":
        body = f'<path d="M 32 7 L 41 16 M 57 32 L 48 41 M 32 57 L 23 48 M 7 32 L 16 23" stroke="{color}" stroke-width="{width}"/><path d="M 32 18 L 46 32 L 32 46 L 18 32 Z" stroke="{color}" stroke-width="{max(1, width - 1)}" opacity=".8"/>'
    else:
        body = f'<circle cx="32" cy="32" r="20" stroke="{color}" stroke-width="{max(1, width - 1)}"/><path d="M 32 4 V 18 M 32 46 V 60 M 4 32 H 18 M 46 32 H 60" stroke="{color}" stroke-width="{width}"/><circle cx="32" cy="32" r="2" fill="{color}"/>'
    if state == "hit-confirm":
        body += f'<path d="M 14 14 L 22 22 M 50 14 L 42 22 M 14 50 L 22 42 M 50 50 L 42 42" stroke="{RED}" stroke-width="2"/>'
    return svg_doc(64, 64, body)


def png_crosshair(style: str, state: str) -> Image.Image:
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    colors = {"idle": TEXT, "fire": GOLD, "hit-confirm": CYAN}
    color = rgba(colors[state])
    width = 2 if state == "idle" else 3
    if style == "plus":
        d.line((32, 6, 32, 22), fill=color, width=width); d.line((32, 42, 32, 58), fill=color, width=width)
        d.line((6, 32, 22, 32), fill=color, width=width); d.line((42, 32, 58, 32), fill=color, width=width)
        d.ellipse((30, 30, 34, 34), fill=color)
    elif style == "brackets":
        d.line((10, 24, 10, 10, 24, 10), fill=color, width=width); d.line((40, 10, 54, 10, 54, 24), fill=color, width=width)
        d.line((54, 40, 54, 54, 40, 54), fill=color, width=width); d.line((24, 54, 10, 54, 10, 40), fill=color, width=width)
        d.ellipse((30, 30, 34, 34), fill=color)
    elif style == "diamond":
        d.line((32, 7, 41, 16), fill=color, width=width); d.line((57, 32, 48, 41), fill=color, width=width)
        d.line((32, 57, 23, 48), fill=color, width=width); d.line((7, 32, 16, 23), fill=color, width=width)
        d.line((32, 18, 46, 32, 32, 46, 18, 32, 32, 18), fill=rgba(colors[state], 210), width=max(1, width - 1))
    else:
        d.ellipse((12, 12, 52, 52), outline=color, width=max(1, width - 1))
        d.line((32, 4, 32, 18), fill=color, width=width); d.line((32, 46, 32, 60), fill=color, width=width)
        d.line((4, 32, 18, 32), fill=color, width=width); d.line((46, 32, 60, 32), fill=color, width=width)
        d.ellipse((30, 30, 34, 34), fill=color)
    if state == "hit-confirm":
        red = rgba(RED)
        d.line((14, 14, 22, 22), fill=red, width=2); d.line((50, 14, 42, 22), fill=red, width=2)
        d.line((14, 50, 22, 42), fill=red, width=2); d.line((50, 50, 42, 42), fill=red, width=2)
    return im


def svg_damage_indicator() -> str:
    body = f'<path d="M 42 178 A 86 86 0 0 1 214 178" stroke="{RED}" stroke-width="12" stroke-linecap="square" opacity=".95"/><path d="M 108 44 L 128 24 L 148 44" stroke="{RED}" stroke-width="8" stroke-linejoin="miter"/><path d="M 92 60 L 128 24 L 164 60" stroke="{RED}" stroke-width="2" opacity=".8"/>'
    return svg_doc(256, 256, body)


def png_damage_indicator() -> Image.Image:
    im = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    red = rgba(RED)
    d.arc((42, 42, 214, 214), 225, 315, fill=red, width=12)
    d.line((108, 44, 128, 24, 148, 44), fill=red, width=8, joint="curve")
    d.line((92, 60, 128, 24, 164, 60), fill=rgba(RED, 205), width=2, joint="curve")
    return im


def svg_rarity_frame(color: str) -> str:
    p = poly(clipped_points(128, 128, 18))
    body = f'<polygon points="{p}" fill="{SURFACE_DARK}" fill-opacity=".32"/><polyline points="{p} 0,0" stroke="{color}" stroke-width="3"/><path d="M 14 14 H 42 M 14 114 H 54" stroke="{color}" stroke-width="2" opacity=".8"/><path d="M 92 12 L 116 36" stroke="{color}" stroke-width="2" opacity=".8"/>'
    return svg_doc(128, 128, body)


def png_rarity_frame(color: str) -> Image.Image:
    im = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    p = clipped_points(128, 128, 18)
    d.polygon(p, fill=rgba(SURFACE_DARK, 80))
    d.line(p + [p[0]], fill=rgba(color), width=3, joint="curve")
    d.line((14, 14, 42, 14), fill=rgba(color, 205), width=2); d.line((14, 114, 54, 114), fill=rgba(color, 205), width=2)
    d.line((92, 12, 116, 36), fill=rgba(color, 205), width=2)
    return im


def svg_rarity_gem(color: str) -> str:
    body = f'<path d="M 12 2 L 22 12 L 12 22 L 2 12 Z" fill="{color}" stroke="{TEXT}" stroke-width="1.5"/><path d="M 7 12 H 17" stroke="{SURFACE_DARK}" stroke-width="2" opacity=".75"/>'
    return svg_doc(24, 24, body)


def png_rarity_gem(color: str) -> Image.Image:
    im = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.polygon([(12, 2), (22, 12), (12, 22), (2, 12)], fill=rgba(color), outline=rgba(TEXT), width=2)
    d.line((7, 12, 17, 12), fill=rgba(SURFACE_DARK, 215), width=2)
    return im


def svg_logo(variant: str, badge: bool = False) -> str:
    if badge:
        word = TEXT if variant == "mono-light" else (SURFACE_DARK if variant == "mono-dark" else GOLD)
        edge = CYAN if variant != "mono-dark" else SURFACE
        body = f'<polygon points="100,0 924,0 1024,100 1024,924 924,1024 100,1024 0,924 0,100" fill="{SURFACE_DARK if variant != "mono-dark" else TEXT}" fill-opacity=".9" stroke="{edge}" stroke-width="10"/><path d="M 116 180 H 908 M 116 844 H 908" stroke="{edge}" stroke-width="5" opacity=".8"/><text x="512" y="620" text-anchor="middle" fill="{word}" font-family="Archivo Black, Bahnschrift, Arial Black, sans-serif" font-size="300" letter-spacing="12">J.O.B.</text><text x="512" y="710" text-anchor="middle" fill="{edge}" font-family="IBM Plex Mono, Consolas, monospace" font-size="54" letter-spacing="10">STAMP</text>'
        return svg_doc(1024, 1024, body)
    colors = {"full": GOLD, "mono-light": TEXT, "mono-dark": SURFACE_DARK}
    word = colors[variant]
    accent = CYAN if variant != "mono-dark" else SURFACE
    tagline = DIM if variant != "mono-dark" else LINE
    body = f'<text x="48" y="420" fill="{word}" font-family="Archivo Black, Bahnschrift, Arial Black, sans-serif" font-size="330" letter-spacing="18">J.O.B.</text><path d="M 64 470 H 1240" stroke="{accent}" stroke-width="12"/><path d="M 1280 470 H 1960" stroke="{GOLD if variant == "full" else accent}" stroke-width="4"/><path d="M 1500 410 L 1540 470 L 1500 530" stroke="{accent}" stroke-width="6"/><text x="76" y="590" fill="{tagline}" font-family="IBM Plex Mono, Consolas, monospace" font-size="72" letter-spacing="22">JUST OBEY BUSINESS</text><path d="M 80 650 H 460 M 480 650 H 620" stroke="{accent}" stroke-width="4" opacity=".75"/>'
    return svg_doc(2048, 768, body)


def png_logo(variant: str, badge: bool = False) -> Image.Image:
    if badge:
        im = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        word = TEXT if variant == "mono-light" else (SURFACE_DARK if variant == "mono-dark" else GOLD)
        edge = CYAN if variant != "mono-dark" else SURFACE
        bg = SURFACE_DARK if variant != "mono-dark" else TEXT
        p = [(100, 0), (924, 0), (1024, 100), (1024, 924), (924, 1024), (100, 1024), (0, 924), (0, 100)]
        d.polygon(p, fill=rgba(bg, 230), outline=rgba(edge), width=10)
        d.line((116, 180, 908, 180), fill=rgba(edge, 210), width=5); d.line((116, 844, 908, 844), fill=rgba(edge, 210), width=5)
        f = fit_font("J.O.B.", 800, 300, "legacy_display")
        bbox = d.textbbox((0, 0), "J.O.B.", font=f)
        d.text(((1024 - (bbox[2] - bbox[0])) // 2 - bbox[0], 365 - bbox[1]), "J.O.B.", font=f, fill=rgba(word), stroke_width=3, stroke_fill=rgba(SURFACE_DARK if word != SURFACE_DARK else TEXT))
        f2 = font("legacy_ledger", 54)
        text = "STAMP"
        bbox = d.textbbox((0, 0), text, font=f2)
        d.text(((1024 - (bbox[2] - bbox[0])) // 2 - bbox[0], 675 - bbox[1]), text, font=f2, fill=rgba(edge))
        return im
    im = Image.new("RGBA", (2048, 768), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    word = {"full": GOLD, "mono-light": TEXT, "mono-dark": SURFACE_DARK}[variant]
    accent = CYAN if variant != "mono-dark" else SURFACE
    tagline = DIM if variant != "mono-dark" else LINE
    f = fit_font("J.O.B.", 1220, 330, "legacy_display")
    d.text((48, 52), "J.O.B.", font=f, fill=rgba(word), stroke_width=3, stroke_fill=rgba(SURFACE_DARK if variant != "mono-dark" else TEXT))
    d.line((64, 470, 1240, 470), fill=rgba(accent), width=12); d.line((1280, 470, 1960, 470), fill=rgba(GOLD if variant == "full" else accent), width=4)
    d.line((1500, 410, 1540, 470, 1500, 530), fill=rgba(accent), width=6, joint="curve")
    f2 = fit_font("JUST OBEY BUSINESS", 1860, 72, "legacy_ledger")
    d.text((76, 530), "JUST OBEY BUSINESS", font=f2, fill=rgba(tagline))
    d.line((80, 650, 460, 650), fill=rgba(accent, 190), width=4); d.line((480, 650, 620, 650), fill=rgba(accent, 190), width=4)
    return im


def generate() -> list[Path]:
    outputs: list[Path] = []

    # Logo variants.
    for variant in ("full", "mono-light", "mono-dark"):
        stem = f"logo/job-logo-{variant}"
        save_svg_png(stem, svg_logo(variant), png_logo(variant))
        outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])
    for variant in ("full", "mono-light", "mono-dark"):
        stem = f"logo/job-badge-stamp-{variant}"
        save_svg_png(stem, svg_logo(variant, badge=True), png_logo(variant, badge=True))
        outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])

    # Panels.
    panel_skins = {
        "default": (SURFACE_DARK, LINE, CYAN),
        "gold": (SURFACE_DARK, GOLD, GOLD),
        "danger": (SURFACE_DARK, RED, RED),
    }
    for name, (fill, edge, accent) in panel_skins.items():
        stem = f"panels/panel-{name}"
        save_svg_png(stem, svg_panel(96, 96, fill, edge, accent), png_panel((96, 96), fill, edge, accent))
        outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])

    # Buttons: regular state set plus gold-primary set for menu actions.
    state_values = {
        "default": (SURFACE_DARK, LINE, CYAN, False),
        "hover": (SURFACE, CYAN, CYAN, False),
        "pressed": (SURFACE, GOLD, GOLD, False),
        "disabled": (SURFACE_DARK, DIM, DIM, True),
    }
    for prefix, accent_override in (("button", None), ("button-primary", GOLD)):
        for state, (fill, edge, accent, disabled) in state_values.items():
            if accent_override:
                fill, edge, accent = ("#332B0A", GOLD, GOLD) if state != "disabled" else (SURFACE_DARK, DIM, DIM)
            for size_name, size in (("wide", (288, 80)), ("compact", (192, 64))):
                stem = f"buttons/{prefix}-{state}-{size_name}"
                save_svg_png(stem, svg_button(*size, fill, edge, accent, disabled), png_button(size, fill, edge, accent, disabled))
                outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])
        for state, (fill, edge, accent, disabled) in state_values.items():
            if accent_override:
                fill, edge, accent = ("#332B0A", GOLD, GOLD) if state != "disabled" else (SURFACE_DARK, DIM, DIM)
            size = (64, 64)
            stem = f"buttons/icon-button-{prefix.removeprefix('button-') + '-' if prefix != 'button' else ''}{state}"
            save_svg_png(stem, svg_button(*size, fill, edge, accent, disabled), png_button(size, fill, edge, accent, disabled))
            outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])

    # Ability frames and equipment silhouettes.
    slot_colors = {
        "primary": CYAN,
        "secondary": GOLD,
        "dash": MAGENTA,
        "special-module": MAGENTA,
        "passive-module": GREEN,
        "empty": DIM,
    }
    for kind, accent in slot_colors.items():
        stem = f"slots/ability-{kind}"
        save_svg_png(stem, svg_slot(kind, accent), png_slot(kind, accent))
        outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])
    ring_svg = svg_doc(128, 128, f'<circle cx="64" cy="64" r="55" stroke="{TEXT}" stroke-width="4" stroke-dasharray="18 8" opacity=".82"/><circle cx="64" cy="64" r="48" stroke="{SURFACE_DARK}" stroke-width="5" opacity=".85"/>')
    ring = Image.new("RGBA", (128, 128), (0, 0, 0, 0)); dr = ImageDraw.Draw(ring); dr.arc((9, 9, 119, 119), 0, 300, fill=rgba(TEXT, 215), width=4); dr.ellipse((13, 13, 115, 115), outline=rgba(SURFACE_DARK, 215), width=5)
    save_svg_png("slots/cooldown-overlay-ring", ring_svg, ring)
    outputs.extend([ASSET_ROOT / "slots/cooldown-overlay-ring.svg", ASSET_ROOT / "slots/cooldown-overlay-ring@1x.png"])

    for kind in ("head", "body", "hands", "feet", "trinket", "passive-chip", "special-chip"):
        stem = f"equipment/{kind}"
        save_svg_png(stem, svg_equipment(kind), png_equipment(kind))
        outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])

    # Bar frames and fills.
    bars = {"hp": (320, 24, GREEN), "xp": (320, 14, CYAN), "boss": (520, 24, RED), "event": (520, 14, CYAN)}
    fills = {"hp": GREEN, "hp-danger": RED, "xp": CYAN, "boss": RED, "event": CYAN}
    for kind, (w, h, _) in bars.items():
        stem = f"bars/{kind}-frame"
        save_svg_png(stem, svg_bar_frame(w, h, kind), png_bar_frame((w, h), kind))
        outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])
    for kind, color in fills.items():
        w, h = (320, 24) if kind.startswith("hp") else ((320, 14) if kind == "xp" else ((520, 24) if kind == "boss" else (520, 14)))
        stem = f"bars/{kind}-fill"
        save_svg_png(stem, svg_bar_fill(w, h, color), png_bar_fill((w, h), color))
        outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])

    # Combo numerals.
    save_svg_png("combo/combo-numerals", svg_combo_sheet(), png_combo_sheet())
    outputs.extend([ASSET_ROOT / "combo/combo-numerals.svg", ASSET_ROOT / "combo/combo-numerals@1x.png"])

    # Crosshairs.
    for style in ("plus", "brackets", "diamond", "reticle"):
        for state in ("idle", "fire", "hit-confirm"):
            stem = f"crosshairs/crosshair-{style}-{state}"
            save_svg_png(stem, crosshair_svg(style, state), png_crosshair(style, state))
            outputs.extend([ASSET_ROOT / f"{stem}.svg", ASSET_ROOT / f"{stem}@1x.png"])

    # Damage direction indicator.
    save_svg_png("indicators/damage-direction", svg_damage_indicator(), png_damage_indicator())
    outputs.extend([ASSET_ROOT / "indicators/damage-direction.svg", ASSET_ROOT / "indicators/damage-direction@1x.png"])

    # Rarity frames and gems.
    rarity = {"common": DIM, "uncommon": GREEN, "rare": MAGENTA, "exec": GOLD, "contraband": RED}
    for name, color in rarity.items():
        frame_stem = f"rarity/rarity-{name}-frame"
        gem_stem = f"rarity/rarity-{name}-gem"
        save_svg_png(frame_stem, svg_rarity_frame(color), png_rarity_frame(color))
        save_svg_png(gem_stem, svg_rarity_gem(color), png_rarity_gem(color))
        outputs.extend([ASSET_ROOT / f"{frame_stem}.svg", ASSET_ROOT / f"{frame_stem}@1x.png", ASSET_ROOT / f"{gem_stem}.svg", ASSET_ROOT / f"{gem_stem}@1x.png"])

    sync_public_assets()
    update_ledger()
    return outputs


if __name__ == "__main__":
    files = generate()
    print(f"generated {len(files)} files with {VERSION}")
