"""Generate the deterministic Tier 3 J.O.B. menu asset kit.

SVG is the editable source of truth. Pillow produces deterministic RGBA
derivatives without introducing any colors outside the locked palette.
"""

from __future__ import annotations

import html
import math
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from _asset_lib import (
    ASSET_ROOT,
    CYAN,
    DIM,
    GOLD,
    GREEN,
    LEDGER,
    LINE,
    MAGENTA,
    RED,
    ROOT,
    SURFACE,
    SURFACE_DARK,
    TEXT,
    clipped_points,
    fit_font,
    font_provenance,
    poly,
    rgba,
    save_svg_png,
    svg_doc,
    sync_public_assets,
    update_ledger,
)


VERSION = "menu-pack-v1"
CURRENT = "currentColor"
Primitive = dict[str, Any]


def line(
    points: list[tuple[float, float]],
    color: str = TEXT,
    width: float = 2,
    alpha: int = 255,
    dash: tuple[float, float] | None = None,
) -> Primitive:
    return {"kind": "line", "points": points, "color": color, "width": width, "alpha": alpha, "dash": dash}


def rect(
    box: tuple[float, float, float, float],
    fill: str | None = None,
    outline: str | None = None,
    width: float = 1,
    alpha: int = 255,
) -> Primitive:
    return {"kind": "rect", "box": box, "fill": fill, "outline": outline, "width": width, "alpha": alpha}


def polygon(
    points: list[tuple[float, float]],
    fill: str | None = None,
    outline: str | None = None,
    width: float = 1,
    alpha: int = 255,
) -> Primitive:
    return {"kind": "poly", "points": points, "fill": fill, "outline": outline, "width": width, "alpha": alpha}


def ellipse(
    box: tuple[float, float, float, float],
    fill: str | None = None,
    outline: str | None = None,
    width: float = 1,
    alpha: int = 255,
) -> Primitive:
    return {"kind": "ellipse", "box": box, "fill": fill, "outline": outline, "width": width, "alpha": alpha}


def arc(
    box: tuple[float, float, float, float],
    start: float,
    end: float,
    color: str = TEXT,
    width: float = 2,
    alpha: int = 255,
) -> Primitive:
    return {"kind": "arc", "box": box, "start": start, "end": end, "color": color, "width": width, "alpha": alpha}


def _svg_color(color: str | None) -> str:
    return color or "none"


def _svg_opacity(alpha: int) -> str:
    return "" if alpha >= 255 else f' opacity="{alpha / 255:.3f}"'


def _svg_primitive(item: Primitive) -> str:
    kind = item["kind"]
    opacity = _svg_opacity(item.get("alpha", 255))
    if kind == "line":
        dash = item.get("dash")
        dash_attr = f' stroke-dasharray="{dash[0]:g} {dash[1]:g}"' if dash else ""
        return (
            f'<polyline points="{poly(item["points"])}" fill="none" '
            f'stroke="{_svg_color(item["color"])}" stroke-width="{item["width"]:g}"'
            f'{dash_attr}{opacity}/>'
        )
    if kind == "rect":
        x0, y0, x1, y1 = item["box"]
        stroke = f' stroke="{_svg_color(item["outline"])}" stroke-width="{item["width"]:g}"' if item["outline"] else ""
        return f'<rect x="{x0:g}" y="{y0:g}" width="{x1 - x0:g}" height="{y1 - y0:g}" fill="{_svg_color(item["fill"])}"{stroke}{opacity}/>'
    if kind == "poly":
        stroke = f' stroke="{_svg_color(item["outline"])}" stroke-width="{item["width"]:g}"' if item["outline"] else ""
        return f'<polygon points="{poly(item["points"])}" fill="{_svg_color(item["fill"])}"{stroke}{opacity}/>'
    if kind == "ellipse":
        x0, y0, x1, y1 = item["box"]
        stroke = f' stroke="{_svg_color(item["outline"])}" stroke-width="{item["width"]:g}"' if item["outline"] else ""
        return (
            f'<ellipse cx="{(x0 + x1) / 2:g}" cy="{(y0 + y1) / 2:g}" '
            f'rx="{(x1 - x0) / 2:g}" ry="{(y1 - y0) / 2:g}" '
            f'fill="{_svg_color(item["fill"])}"{stroke}{opacity}/>'
        )
    if kind == "arc":
        x0, y0, x1, y1 = item["box"]
        rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        a0, a1 = math.radians(item["start"]), math.radians(item["end"])
        sx, sy = cx + rx * math.cos(a0), cy + ry * math.sin(a0)
        ex, ey = cx + rx * math.cos(a1), cy + ry * math.sin(a1)
        span = (item["end"] - item["start"]) % 360
        large = 1 if span > 180 else 0
        return (
            f'<path d="M {sx:g} {sy:g} A {rx:g} {ry:g} 0 {large} 1 {ex:g} {ey:g}" '
            f'fill="none" stroke="{_svg_color(item["color"])}" '
            f'stroke-width="{item["width"]:g}"{opacity}/>'
        )
    raise ValueError(f"unknown primitive: {kind}")


def _actual_color(color: str | None) -> str | None:
    return TEXT if color == CURRENT else color


def _scale_point(point: tuple[float, float], sx: float, sy: float) -> tuple[int, int]:
    return round(point[0] * sx), round(point[1] * sy)


def _draw_dashed_line(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    fill: tuple[int, int, int, int],
    width: int,
    pattern: tuple[float, float],
    scale: float,
) -> None:
    on, off = max(1, pattern[0] * scale), max(1, pattern[1] * scale)
    for start, finish in zip(points, points[1:]):
        dx, dy = finish[0] - start[0], finish[1] - start[1]
        length = math.hypot(dx, dy)
        if length == 0:
            continue
        cursor = 0.0
        while cursor < length:
            stop = min(length, cursor + on)
            p0 = (round(start[0] + dx * cursor / length), round(start[1] + dy * cursor / length))
            p1 = (round(start[0] + dx * stop / length), round(start[1] + dy * stop / length))
            draw.line((p0, p1), fill=fill, width=width)
            cursor += on + off


def _draw_primitive(
    draw: ImageDraw.ImageDraw,
    item: Primitive,
    sx: float,
    sy: float,
) -> None:
    kind = item["kind"]
    alpha = item.get("alpha", 255)
    scale = min(sx, sy)
    width = max(1, round(item.get("width", 1) * scale))
    if kind == "line":
        points = [_scale_point(point, sx, sy) for point in item["points"]]
        color = rgba(_actual_color(item["color"]), alpha)
        if item.get("dash"):
            _draw_dashed_line(draw, points, color, width, item["dash"], scale)
        else:
            draw.line(points, fill=color, width=width, joint="curve")
        return
    if kind in {"rect", "ellipse"}:
        x0, y0, x1, y1 = item["box"]
        box = (round(x0 * sx), round(y0 * sy), round(x1 * sx), round(y1 * sy))
        fill = rgba(_actual_color(item["fill"]), alpha) if item["fill"] else None
        outline = rgba(_actual_color(item["outline"]), alpha) if item["outline"] else None
        method = draw.rectangle if kind == "rect" else draw.ellipse
        method(box, fill=fill, outline=outline, width=width)
        return
    if kind == "poly":
        points = [_scale_point(point, sx, sy) for point in item["points"]]
        fill = rgba(_actual_color(item["fill"]), alpha) if item["fill"] else None
        outline = rgba(_actual_color(item["outline"]), alpha) if item["outline"] else None
        draw.polygon(points, fill=fill)
        if outline:
            draw.line(points + [points[0]], fill=outline, width=width, joint="curve")
        return
    if kind == "arc":
        x0, y0, x1, y1 = item["box"]
        box = (round(x0 * sx), round(y0 * sy), round(x1 * sx), round(y1 * sy))
        draw.arc(
            box,
            start=item["start"],
            end=item["end"],
            fill=rgba(_actual_color(item["color"]), alpha),
            width=width,
        )
        return
    raise ValueError(f"unknown primitive: {kind}")


def vector_asset(
    width: int,
    height: int,
    primitives: list[Primitive],
    png_size: tuple[int, int] | None = None,
) -> tuple[str, Image.Image]:
    body = "".join(_svg_primitive(item) for item in primitives)
    svg = svg_doc(width, height, body)
    target = png_size or (width, height)
    image = Image.new("RGBA", target, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    sx, sy = target[0] / width, target[1] / height
    for item in primitives:
        _draw_primitive(draw, item, sx, sy)
    return svg, image


def save_vector(
    rel_stem: str,
    width: int,
    height: int,
    primitives: list[Primitive],
    png_size: tuple[int, int] | None = None,
) -> list[Path]:
    svg, image = vector_asset(width, height, primitives, png_size)
    save_svg_png(rel_stem, svg, image)
    return [ASSET_ROOT / f"{rel_stem}.svg", ASSET_ROOT / f"{rel_stem}@1x.png"]


def plate(
    width: int,
    height: int,
    fill: str = SURFACE_DARK,
    edge: str = LINE,
    accent: str = CYAN,
    clip: int = 16,
    alpha: int = 255,
    dashed: bool = False,
) -> list[Primitive]:
    points = clipped_points(width, height, clip)
    result = [polygon(points, fill, None, alpha=alpha)]
    border_points = points + [points[0]]
    result.append(line(border_points, edge, 2, alpha, (7, 6) if dashed else None))
    if height >= 36:
        result.extend([
            line([(12, 12), (min(width - clip - 8, 44), 12)], edge, 1, min(alpha, 180)),
            line([(12, height - 12), (min(width - clip - 8, 76), height - 12)], accent, 2, min(alpha, 220)),
        ])
    else:
        result.append(line([(6, height - 4), (min(width - clip - 6, 24), height - 4)], accent, 1, min(alpha, 200)))
    result.append(line([(width - clip + 2, 3), (width - 3, clip - 2)], accent, 1, min(alpha, 210)))
    return result


def glyph_primitives(name: str, color: str = CURRENT) -> list[Primitive]:
    p: list[Primitive] = []
    if name == "clock-in":
        p += [polygon([(4, 3), (17, 3), (21, 7), (21, 21), (4, 21)], None, color, 2), polygon([(9, 16), (15, 16), (12, 9)], color)]
        p += [line([(7, 6), (10, 6)], color, 2)]
    elif name == "network":
        p += [rect((9, 3, 15, 8), None, color, 2), rect((3, 16, 9, 21), None, color, 2), rect((15, 16, 21, 21), None, color, 2)]
        p += [line([(12, 8), (12, 12), (6, 12), (6, 16), (6, 12), (18, 12), (18, 16)], color, 2)]
    elif name == "severance":
        p += [polygon([(3, 6), (18, 6), (21, 9), (21, 18), (3, 18)], None, color, 2)]
        p += [rect((9, 6, 14, 18), color), line([(5, 10), (8, 10), (16, 14), (19, 14)], color, 1)]
    elif name == "handbook":
        p += [rect((5, 5, 19, 22), None, color, 2), rect((9, 2, 15, 7), color)]
        p += [line([(8, 11), (16, 11)], color, 2), line([(8, 16), (16, 16)], color, 2)]
    elif name == "settings":
        p += [polygon([(9, 2), (15, 2), (16, 6), (20, 4), (22, 8), (19, 11), (22, 14), (20, 20), (16, 18), (15, 22), (9, 22), (8, 18), (4, 20), (2, 14), (5, 11), (2, 8), (4, 4), (8, 6)], color)]
        p += [ellipse((9, 9, 15, 15), SURFACE_DARK)]
    elif name == "back":
        p += [line([(21, 12), (5, 12), (11, 6), (5, 12), (11, 18)], color, 2)]
    elif name == "pause":
        p += [polygon([(3, 3), (17, 3), (21, 7), (21, 21), (3, 21)], None, color, 2), rect((7, 7, 10, 17), color), rect((14, 7, 17, 17), color)]
    elif name == "quit":
        p += [rect((4, 3, 14, 21), None, color, 2), line([(10, 12), (22, 12), (18, 8), (22, 12), (18, 16)], color, 2)]
    elif name == "retry":
        p += [arc((3, 3, 21, 21), 40, 320, color, 2), polygon([(17, 2), (22, 3), (20, 8)], color)]
    elif name == "home":
        p += [polygon([(4, 21), (4, 8), (9, 8), (9, 3), (20, 3), (20, 21)], color)]
        p += [rect((7, 11, 10, 14), SURFACE_DARK), rect((13, 7, 16, 10), SURFACE_DARK), rect((13, 14, 16, 21), SURFACE_DARK)]
    elif name == "loop":
        p += [rect((2, 7, 12, 17), None, color, 2), rect((12, 7, 22, 17), None, color, 2)]
        p += [line([(9, 7), (15, 17)], color, 2), line([(15, 7), (9, 17)], color, 2)]
    elif name == "role":
        p += [line([(7, 3), (12, 8), (17, 3)], color, 2), rect((6, 8, 18, 21), None, color, 2)]
        p += [rect((10, 11, 14, 14), color), line([(9, 17), (15, 17)], color, 1)]
    elif name == "connect":
        p += [polygon([(5, 5), (19, 5), (21, 8), (21, 18), (17, 21), (7, 21), (3, 17), (3, 8)], None, color, 2)]
        p += [line([(7, 5), (7, 10), (10, 5), (10, 10), (13, 5), (13, 10), (16, 5), (16, 10)], color, 1)]
    elif name == "close":
        p += [line([(5, 5), (19, 19)], color, 3), line([(19, 5), (5, 19)], color, 3)]
    elif name == "add":
        p += [line([(3, 3), (17, 3), (21, 7), (21, 21), (3, 21), (3, 3)], color, 1, dash=(3, 2))]
        p += [line([(7, 12), (17, 12)], color, 2), line([(12, 7), (12, 17)], color, 2)]
    elif name == "check":
        p += [polygon([(3, 3), (17, 3), (21, 7), (21, 21), (3, 21)], None, color, 1)]
        p += [line([(6, 12), (10, 16), (18, 7)], color, 3)]
    elif name == "lock":
        p += [rect((5, 10, 19, 21), None, color, 2), line([(8, 10), (8, 6), (10, 3), (14, 3), (17, 6), (17, 10)], color, 2)]
        p += [rect((11, 14, 13, 18), color)]
    elif name == "live":
        p += [ellipse((8, 8, 16, 16), color), ellipse((4, 4, 20, 20), None, color, 2)]
    elif name == "caret":
        p += [line([(5, 8), (12, 15), (19, 8)], color, 3)]
    elif name in {"host", "guest"}:
        p += [line([(8, 3), (12, 7), (16, 3)], color, 2), polygon([(5, 8), (17, 8), (20, 11), (20, 21), (5, 21)], None, color, 2)]
        if name == "host":
            p += [polygon([(12, 11), (14, 14), (18, 14), (15, 17), (16, 20), (12, 18), (8, 20), (9, 17), (6, 14), (10, 14)], color)]
        else:
            p += [rect((9, 12, 16, 18), color)]
    else:
        raise ValueError(f"unknown glyph: {name}")
    return p


def generate_glyphs() -> list[Path]:
    outputs: list[Path] = []
    names = (
        "clock-in", "network", "severance", "handbook", "settings", "back",
        "pause", "quit", "retry", "home", "loop", "role", "connect", "close",
        "add", "check", "lock", "live", "caret", "host", "guest",
    )
    for name in names:
        outputs += save_vector(f"glyphs/{name}", 24, 24, glyph_primitives(name), (48, 48))
    for name in ("clock-in", "severance", "check", "live", "host"):
        for state, color in (("gold", GOLD), ("dim", DIM)):
            outputs += save_vector(f"glyphs/{name}-{state}", 24, 24, glyph_primitives(name, color), (48, 48))
    return outputs


def generate_menuplates() -> list[Path]:
    outputs: list[Path] = []
    states = {
        "default": (SURFACE_DARK, LINE, CYAN, 255),
        "hover": (SURFACE, CYAN, CYAN, 255),
        "pressed": (SURFACE, GOLD, GOLD, 255),
        "disabled": (SURFACE_DARK, DIM, DIM, 150),
        "primary": (SURFACE_DARK, GOLD, GOLD, 255),
        "danger": (SURFACE_DARK, RED, RED, 255),
    }
    for state, (fill, edge, accent, alpha) in states.items():
        outputs += save_vector(
            f"menuplates/menu-button-wide-{state}",
            420,
            72,
            plate(420, 72, fill, edge, accent, 16, alpha),
        )

    backdrop: list[Primitive] = []
    for x, width, top in ((90, 240, 270), (390, 180, 150), (640, 260, 330), (1010, 210, 180), (1290, 240, 290), (1590, 190, 110)):
        backdrop += [rect((x, top, x + width, 1080), SURFACE, None, alpha=18)]
        for y in range(top + 54, 1030, 74):
            backdrop += [line([(x + 24, y), (x + width - 24, y)], LINE, 1, 20)]
    backdrop += [
        line([(36, 0), (36, 1080)], LINE, 2, 64, (8, 10)),
        line([(1884, 0), (1884, 1080)], LINE, 2, 64, (8, 10)),
        line([(960, 80), (960, 1000)], CYAN, 1, 20),
        line([(820, 540), (1100, 540)], GOLD, 2, 22),
    ]
    outputs += save_vector("menuplates/screen-backdrop", 1920, 1080, backdrop)

    header = [
        line([(0, 12), (420, 12), (444, 4), (468, 20), (492, 12), (960, 12)], LINE, 2, 210),
        line([(16, 5), (16, 19)], GOLD, 2),
        line([(944, 5), (944, 19)], CYAN, 2),
    ]
    outputs += save_vector("menuplates/screen-header-rule", 960, 24, header)
    outputs += save_vector("menuplates/stat-strip", 720, 48, plate(720, 48, SURFACE_DARK, LINE, GOLD, 12, 220))

    scrim: list[Primitive] = []
    for y in range(0, 512, 8):
        scrim += [line([(0, y), (512, y)], TEXT, 1, 10)]
    outputs += save_vector("menuplates/overlay-scrim", 512, 512, scrim)

    divider: list[Primitive] = []
    for x in range(0, 640, 18):
        divider += [line([(x, 4), (x + 10, 4)], DIM, 2, 190)]
    divider += [line([(0, 1), (18, 1)], GOLD, 1), line([(622, 7), (640, 7)], CYAN, 1)]
    outputs += save_vector("menuplates/divider", 640, 8, divider)
    return outputs


CLASS_ACCENTS = {
    "intern": GOLD,
    "janitor": GREEN,
    "accountant": GOLD,
    "hr": GREEN,
    "it": CYAN,
    "sales": GOLD,
    "marketing": RED,
    "brawler": RED,
    "barista": MAGENTA,
    "analyst": CYAN,
}


def emblem_primitives(key: str, accent: str) -> list[Primitive]:
    p = plate(128, 128, SURFACE_DARK, accent, accent, 18)
    if key == "intern":
        p += [
            polygon([(27, 61), (88, 44), (104, 55), (101, 69), (38, 83)], SURFACE, TEXT, 3),
            polygon([(34, 83), (99, 68), (105, 76), (42, 94)], TEXT),
            line([(48, 100), (77, 100), (77, 108)], accent, 3),
        ]
    elif key == "janitor":
        p += [
            line([(34, 28), (92, 101)], TEXT, 7),
            polygon([(24, 78), (55, 63), (70, 91), (39, 106)], TEXT, SURFACE_DARK, 2),
            ellipse((56, 28, 105, 70), SURFACE, TEXT, 3),
            line([(61, 50), (100, 50)], accent, 3),
        ]
    elif key == "accountant":
        p += [rect((29, 22, 99, 108), SURFACE, TEXT, 3), rect((39, 31, 89, 50), SURFACE_DARK, accent, 2)]
        for row in range(3):
            for col in range(3):
                color = GOLD if (row, col) == (2, 2) else TEXT
                p += [rect((39 + col * 18, 60 + row * 15, 51 + col * 18, 70 + row * 15), color)]
    elif key == "hr":
        p += [
            polygon([(24, 36), (58, 36), (68, 46), (104, 46), (104, 101), (24, 101)], SURFACE, TEXT, 3),
            polygon([(72, 53), (101, 53), (101, 91), (82, 91), (72, 81)], RED, None, alpha=220),
            line([(34, 61), (66, 61), (34, 73), (63, 73)], accent, 3),
        ]
    elif key == "it":
        p += [
            polygon([(31, 48), (88, 48), (101, 61), (101, 88), (88, 101), (39, 101), (27, 89), (27, 61)], SURFACE, TEXT, 3),
            line([(42, 48), (42, 66), (53, 48), (53, 66), (64, 48), (64, 66), (75, 48), (75, 66)], accent, 3),
            arc((23, 20, 105, 94), 205, 335, TEXT, 4),
            polygon([(96, 31), (108, 33), (101, 43)], TEXT),
        ]
    elif key == "sales":
        p += [
            polygon([(25, 55), (77, 35), (92, 73), (40, 94)], SURFACE, TEXT, 3),
            polygon([(37, 47), (91, 39), (97, 80), (43, 88)], SURFACE, TEXT, 3),
            polygon([(48, 42), (103, 49), (98, 91), (43, 83)], SURFACE, TEXT, 3),
            line([(29, 103), (65, 103), (20, 111), (51, 111)], accent, 3),
        ]
    elif key == "marketing":
        p += [
            ellipse((31, 72, 56, 97), SURFACE, TEXT, 4),
            line([(44, 72), (62, 53), (72, 57), (59, 79)], TEXT, 5),
            polygon([(70, 49), (101, 35), (108, 49), (78, 63)], SURFACE, TEXT, 3),
            polygon([(80, 64), (110, 70), (110, 88)], RED, TEXT, 2),
            line([(50, 99), (88, 107)], accent, 4),
        ]
    elif key == "brawler":
        p += [
            polygon([(30, 76), (30, 48), (42, 39), (51, 51), (59, 35), (68, 50), (79, 34), (87, 54), (101, 49), (105, 78), (92, 103), (49, 103)], TEXT, SURFACE_DARK, 3),
            rect((42, 62, 98, 84), SURFACE, TEXT, 3),
        ]
        for x in (48, 64, 80, 96):
            p += [ellipse((x - 3, 54, x + 3, 60), accent)]
    elif key == "barista":
        p += [
            line([(34, 101), (76, 42), (91, 48), (50, 107)], TEXT, 7),
            line([(74, 43), (84, 31)], accent, 4),
            arc((56, 14, 82, 44), 200, 350, TEXT, 3),
            arc((73, 10, 101, 42), 200, 350, TEXT, 3),
            arc((88, 18, 113, 50), 200, 350, TEXT, 3),
            arc((22, 49, 74, 101), 250, 80, accent, 4),
        ]
    elif key == "analyst":
        p += [
            polygon([(22, 81), (91, 29), (105, 48), (36, 101)], SURFACE, TEXT, 3),
            ellipse((56, 41, 102, 87), None, accent, 3),
            line([(79, 34), (79, 94), (49, 64), (109, 64)], TEXT, 2),
            ellipse((73, 58, 85, 70), SURFACE_DARK, TEXT, 2),
        ]
        for i in range(5):
            p += [line([(32 + i * 12, 79 - i * 9), (38 + i * 12, 87 - i * 9)], TEXT, 2)]
    else:
        raise ValueError(f"unknown class emblem: {key}")
    return p


def stat_glyph(kind: str) -> list[Primitive]:
    if kind == "hp":
        return [rect((2, 5, 14, 12), None, TEXT, 2), line([(8, 2), (8, 15), (4, 8), (12, 8)], GREEN, 2)]
    if kind == "spd":
        return [line([(2, 12), (8, 4), (8, 9), (14, 3)], CYAN, 2), line([(4, 14), (12, 14)], TEXT, 2)]
    if kind == "dmg":
        return [polygon([(8, 1), (11, 6), (15, 8), (11, 10), (8, 15), (5, 10), (1, 8), (5, 6)], RED), ellipse((6, 6, 10, 10), SURFACE_DARK)]
    raise ValueError(kind)


def mouse_keycap(active: str) -> list[Primitive]:
    result = plate(32, 24, SURFACE_DARK, LINE, GOLD, 5)
    result += [line([(16, 3), (16, 12)], LINE, 1), line([(4, 12), (28, 12)], LINE, 1)]
    if active == "lmb":
        result += [rect((5, 4, 15, 11), GOLD)]
    else:
        result += [rect((17, 4, 27, 11), GOLD)]
    return result


def generate_classes() -> list[Path]:
    outputs: list[Path] = []
    for key, accent in CLASS_ACCENTS.items():
        outputs += save_vector(f"classes/emblem-{key}", 128, 128, emblem_primitives(key, accent), (64, 64))

    card_states = {
        "default": (LINE, CYAN, 255),
        "hover": (CYAN, CYAN, 255),
        "selected": (GOLD, GOLD, 255),
    }
    for state, (edge, accent, alpha) in card_states.items():
        primitives = plate(232, 320, SURFACE_DARK, edge, accent, 18, alpha)
        primitives += [line([(16, 126), (216, 126)], LINE, 1, 110), line([(16, 262), (216, 262)], LINE, 1, 110)]
        if state == "selected":
            primitives += [
                line([(194, 284), (216, 284), (216, 306)], GOLD, 3),
                line([(199, 295), (205, 301), (216, 289)], GOLD, 2),
            ]
        outputs += save_vector(f"classes/class-card-{state}", 232, 320, primitives)

    for kind in ("hp", "spd", "dmg"):
        outputs += save_vector(f"classes/stat-glyph-{kind}", 16, 16, stat_glyph(kind))
    outputs += save_vector("classes/stat-track", 64, 6, [rect((0, 1, 64, 5), SURFACE, LINE, 1)])
    outputs += save_vector("classes/stat-fill", 64, 6, [polygon([(0, 1), (60, 1), (64, 3), (60, 5), (0, 5)], GOLD)])
    outputs += save_vector("classes/keycap-lmb", 32, 24, mouse_keycap("lmb"))
    outputs += save_vector("classes/keycap-rmb", 32, 24, mouse_keycap("rmb"))
    outputs += save_vector("classes/role-tag", 96, 22, plate(96, 22, SURFACE, CYAN, CYAN, 7, 230))
    return outputs


def generate_party() -> list[Path]:
    outputs: list[Path] = []
    states = {
        "you": (GOLD, GOLD, False),
        "filled": (GREEN, GREEN, False),
        "empty": (DIM, DIM, True),
        "hover": (CYAN, CYAN, False),
    }
    for state, (edge, accent, dashed) in states.items():
        primitives = plate(200, 260, SURFACE_DARK, edge, accent, 18, 255, dashed)
        primitives += [line([(18, 44), (182, 44)], LINE, 1, 130), line([(18, 196), (182, 196)], LINE, 1, 130)]
        outputs += save_vector(f"party/slot-plate-{state}", 200, 260, primitives)
    outputs += save_vector("party/slot-badge-you", 88, 28, plate(88, 28, SURFACE, GOLD, GOLD, 8))
    for state, edge in (("default", LINE), ("open", CYAN)):
        outputs += save_vector("party/select-chrome-" + state, 168, 32, plate(168, 32, SURFACE_DARK, edge, CYAN, 8))

    autofill = [
        rect((5, 7, 17, 19), SURFACE_DARK, TEXT, 2),
        rect((31, 7, 43, 19), SURFACE_DARK, TEXT, 2),
        rect((18, 30, 30, 42), SURFACE_DARK, GOLD, 2),
        line([(11, 19), (11, 25), (37, 25), (37, 19), (24, 25), (24, 30)], CYAN, 3),
        polygon([(18, 22), (24, 27), (30, 22)], GOLD),
    ]
    outputs += save_vector("party/autofill", 48, 48, autofill)
    return outputs


def generate_lobby() -> list[Path]:
    outputs: list[Path] = []
    room_states = {
        "waiting": (GREEN, GREEN, 255),
        "in-run": (CYAN, CYAN, 255),
        "full": (DIM, DIM, 150),
    }
    for state, (edge, accent, alpha) in room_states.items():
        primitives = plate(640, 56, SURFACE_DARK, edge, accent, 12, alpha)
        primitives += [line([(310, 10), (310, 46)], LINE, 1, min(alpha, 100)), line([(500, 10), (500, 46)], LINE, 1, min(alpha, 100))]
        outputs += save_vector(f"lobby/room-row-{state}", 640, 56, primitives)
    outputs += save_vector("lobby/roster-row", 640, 40, plate(640, 40, SURFACE_DARK, LINE, CYAN, 10, 225))

    tag_states = {
        "waiting": GREEN,
        "run": CYAN,
        "full": DIM,
        "host": GOLD,
        "guest": DIM,
    }
    for state, color in tag_states.items():
        outputs += save_vector(f"lobby/tag-{state}", 96, 22, plate(96, 22, SURFACE, color, color, 7, 235))
    for state, edge in (("default", LINE), ("focus", CYAN)):
        outputs += save_vector(f"lobby/input-field-{state}", 320, 44, plate(320, 44, SURFACE_DARK, edge, CYAN, 10))
    status_states = {
        "idle": DIM,
        "connecting": CYAN,
        "error": RED,
    }
    for state, color in status_states.items():
        primitives = plate(720, 36, SURFACE_DARK, color, color, 9, 230)
        primitives += [ellipse((12, 13, 22, 23), color)]
        outputs += save_vector(f"lobby/status-strip-{state}", 720, 36, primitives)
    return outputs


PERK_ACCENTS = {
    "vitality": GREEN,
    "hustle": GOLD,
    "cardio": CYAN,
    "income": GOLD,
    "wellness": MAGENTA,
}


def perk_icon(key: str, accent: str) -> list[Primitive]:
    p = plate(128, 128, SURFACE_DARK, accent, accent, 18)
    if key == "vitality":
        p += [rect((25, 25, 103, 103), None, LINE, 1)]
        for x in range(38, 100, 16):
            p += [line([(x, 25), (x, 103)], LINE, 1, 100)]
        for y in range(40, 100, 16):
            p += [line([(25, y), (103, y)], LINE, 1, 100)]
        p += [polygon([(43, 34), (64, 28), (85, 34), (91, 51), (83, 90), (72, 103), (64, 81), (56, 103), (45, 90), (37, 51)], TEXT, SURFACE_DARK, 3)]
    elif key == "hustle":
        p += [
            polygon([(24, 97), (24, 46), (50, 46), (50, 32), (103, 32), (103, 97)], SURFACE, TEXT, 3),
            line([(34, 83), (52, 64), (68, 71), (94, 43)], GOLD, 5),
            polygon([(87, 40), (101, 35), (98, 50)], GOLD),
            line([(35, 89), (95, 89)], LINE, 2),
        ]
    elif key == "cardio":
        p += [
            rect((25, 38, 103, 52), TEXT),
            rect((56, 52, 72, 90), SURFACE, TEXT, 3),
            rect((42, 90, 86, 101), TEXT),
            line([(28, 25), (100, 25)], accent, 3),
            line([(31, 18), (31, 32), (97, 18), (97, 32)], accent, 2),
        ]
    elif key == "income":
        p += [
            polygon([(26, 29), (91, 29), (102, 40), (102, 73), (26, 73)], None, TEXT, 3),
            rect((51, 29, 69, 73), GOLD),
            rect((21, 84, 107, 101), SURFACE, TEXT, 3),
            line([(64, 45), (64, 91)], accent, 5),
            polygon([(54, 79), (64, 94), (74, 79)], accent),
        ]
    elif key == "wellness":
        p += [
            ellipse((55, 22, 73, 40), TEXT),
            rect((52, 43, 76, 68), TEXT),
            rect((40, 69, 88, 82), TEXT),
            rect((27, 83, 101, 98), TEXT),
            line([(37, 60), (27, 77), (49, 77), (91, 60), (101, 77), (79, 77)], accent, 4),
        ]
    else:
        raise ValueError(key)
    return p


def generate_severance() -> list[Path]:
    outputs: list[Path] = []
    for key, accent in PERK_ACCENTS.items():
        outputs += save_vector(f"severance/{key}", 128, 128, perk_icon(key, accent), (64, 64))

    states = {
        "affordable": (GREEN, GREEN, 255),
        "unaffordable": (DIM, DIM, 145),
        "maxed": (GREEN, GREEN, 255),
    }
    for state, (edge, accent, alpha) in states.items():
        primitives = plate(560, 84, SURFACE_DARK, edge, accent, 14, alpha)
        if state == "maxed":
            primitives += [line([(2, 8), (2, 76)], GREEN, 4)]
        outputs += save_vector(f"severance/perk-row-{state}", 560, 84, primitives)
    outputs += save_vector("severance/perk-pip-empty", 22, 6, [rect((0, 1, 22, 5), SURFACE, LINE, 1)])
    outputs += save_vector("severance/perk-pip-filled", 22, 6, [polygon([(0, 1), (18, 1), (22, 3), (18, 5), (0, 5)], GREEN)])
    outputs += save_vector("severance/balance-plate", 400, 56, plate(400, 56, SURFACE_DARK, GOLD, GOLD, 14))
    return outputs


def checkbox(on: bool) -> list[Primitive]:
    p = plate(24, 24, SURFACE_DARK, GOLD if on else LINE, GOLD, 5)
    if on:
        p += [line([(5, 12), (10, 17), (19, 6)], GOLD, 3)]
    return p


def generate_controls() -> list[Path]:
    outputs: list[Path] = []
    track: list[Primitive] = [rect((0, 3, 240, 5), SURFACE, LINE, 1)]
    for x in range(0, 241, 24):
        track += [line([(x, 1), (x, 7)], LINE, 1)]
    outputs += save_vector("controls/slider-track", 240, 8, track)
    outputs += save_vector("controls/slider-fill", 240, 8, [polygon([(0, 2), (236, 2), (240, 4), (236, 6), (0, 6)], GOLD)])
    for state, color in (("default", TEXT), ("active", GOLD)):
        primitives = plate(20, 28, SURFACE, color, color, 6)
        primitives += [line([(6, 10), (14, 10), (6, 15), (14, 15)], SURFACE_DARK, 2)]
        outputs += save_vector(f"controls/slider-thumb-{state}", 20, 28, primitives)
    outputs += save_vector("controls/checkbox-off", 24, 24, checkbox(False))
    outputs += save_vector("controls/checkbox-on", 24, 24, checkbox(True))
    outputs += save_vector("controls/setting-row", 560, 48, plate(560, 48, SURFACE_DARK, LINE, CYAN, 10, 225))

    pause_header = plate(480, 96, SURFACE_DARK, GOLD, GOLD, 18)
    for x in range(16, 460, 16):
        pause_header += [line([(x, 4), (x + 7, 4)], DIM, 1, 170), line([(x, 92), (x + 7, 92)], DIM, 1, 170)]
    pause_header += [rect((26, 26, 40, 70), GOLD), rect((48, 26, 62, 70), GOLD)]
    outputs += save_vector("controls/pause-header", 480, 96, pause_header)
    return outputs


def _distress_boxes() -> list[tuple[int, int, int, int]]:
    boxes = []
    for index in range(32):
        x = 72 + ((index * 83 + 19) % 856)
        y = 82 + ((index * 47 + 11) % 246)
        width = 5 + (index * 7) % 17
        height = 3 + (index * 5) % 11
        boxes.append((x, y, x + width, y + height))
    return boxes


def stamp_svg(text: str, color: str, angle: int) -> str:
    mask_rects = "".join(
        f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="black"/>'
        for x0, y0, x1, y1 in _distress_boxes()
    )
    extra = f'<defs><mask id="ink"><rect width="1024" height="420" fill="white"/>{mask_rects}</mask></defs>'
    body = (
        f'<g transform="rotate({angle} 512 210)">'
        f'<polygon points="58,58 925,58 966,99 966,343 925,362 58,362" fill="none" stroke="{color}" stroke-width="18"/>'
        f'<polygon points="82,82 909,82 942,115 942,323 909,338 82,338" fill="none" stroke="{color}" stroke-width="4"/>'
        f'<text x="512" y="266" text-anchor="middle" fill="{color}" mask="url(#ink)" '
        f'font-family="Archivo Black, Bahnschrift, Arial Black, sans-serif" font-size="148" letter-spacing="7">'
        f'{html.escape(text)}</text></g>'
    )
    return svg_doc(1024, 420, body, extra)


def stamp_png(text: str, color: str, angle: int) -> Image.Image:
    image = Image.new("RGBA", (1024, 420), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    outer = [(58, 58), (925, 58), (966, 99), (966, 343), (925, 362), (58, 362), (58, 58)]
    inner = [(82, 82), (909, 82), (942, 115), (942, 323), (909, 338), (82, 338), (82, 82)]
    draw.line(outer, fill=rgba(color), width=18, joint="curve")
    draw.line(inner, fill=rgba(color), width=4, joint="curve")

    face = fit_font(text, 820, 148, "display")
    mask = Image.new("L", image.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    bbox = mask_draw.textbbox((0, 0), text, font=face)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    position = ((1024 - text_width) // 2 - bbox[0], 210 - text_height // 2 - bbox[1])
    mask_draw.text(position, text, font=face, fill=255)
    ink = Image.new("RGBA", image.size, rgba(color))
    ink.putalpha(mask)
    image.alpha_composite(ink)

    erase = ImageDraw.Draw(image)
    for box in _distress_boxes():
        erase.rectangle(box, fill=(0, 0, 0, 0))
    return image.rotate(angle, resample=Image.Resampling.NEAREST, expand=False)


def generate_verdict() -> list[Path]:
    outputs: list[Path] = []
    for stem, text, color, angle in (
        ("stamp-fired", "YOU'RE FIRED.", RED, -4),
        ("stamp-promoted", "PROMOTED.", GOLD, 3),
    ):
        save_svg_png(f"verdict/{stem}", stamp_svg(text, color, angle), stamp_png(text, color, angle))
        outputs += [ASSET_ROOT / f"verdict/{stem}.svg", ASSET_ROOT / f"verdict/{stem}@1x.png"]

    stats = plate(720, 140, SURFACE_DARK, LINE, CYAN, 16, 245)
    for x in (180, 360, 540):
        stats += [line([(x, 14), (x, 126)], LINE, 1, 150)]
    stats += [line([(14, 98), (706, 98)], LINE, 1, 120)]
    outputs += save_vector("verdict/run-stats-plate", 720, 140, stats)

    receipt = plate(480, 64, SURFACE_DARK, GREEN, GREEN, 12, 245)
    for x in range(18, 462, 18):
        receipt += [line([(x, 3), (x + 8, 3)], DIM, 1, 170), line([(x, 61), (x + 8, 61)], DIM, 1, 170)]
    outputs += save_vector("verdict/severance-receipt", 480, 64, receipt)
    return outputs


def handbook_keycap(width: int, height: int) -> list[Primitive]:
    p = plate(width, height, SURFACE, LINE, CYAN, 8)
    p += [line([(7, height - 8), (width - 10, height - 8)], SURFACE_DARK, 3)]
    return p


def threat_icon(key: str) -> list[Primitive]:
    p = plate(96, 96, SURFACE_DARK, RED, RED, 14)
    if key == "gossip":
        p += [
            polygon([(17, 31), (26, 20), (53, 19), (62, 27), (78, 27), (86, 39), (82, 55), (67, 62), (55, 75), (43, 64), (24, 64), (13, 52)], SURFACE, TEXT, 3),
            line([(27, 39), (69, 39), (27, 49), (58, 49)], GREEN, 3),
        ]
    elif key == "complainer":
        p += [
            polygon([(21, 30), (65, 30), (65, 69), (55, 80), (30, 80), (21, 69)], SURFACE, TEXT, 3),
            arc((58, 35, 88, 65), 270, 90, TEXT, 4),
            arc((20, 65, 76, 92), 190, 340, RED, 4),
        ]
    elif key == "micromanager":
        p += [
            rect((24, 39, 45, 57), None, TEXT, 3),
            rect((51, 39, 72, 57), None, TEXT, 3),
            line([(45, 47), (51, 47), (17, 34), (24, 42), (72, 42), (80, 34)], TEXT, 3),
            rect((28, 61, 70, 83), SURFACE, RED, 3),
            line([(36, 68), (63, 68), (36, 76), (58, 76)], TEXT, 2),
        ]
    elif key == "karen":
        p += [
            polygon([(18, 67), (22, 31), (36, 17), (67, 20), (82, 37), (76, 65), (64, 49), (61, 77), (43, 63), (34, 79)], TEXT),
            polygon([(37, 43), (64, 39), (65, 68), (49, 76), (34, 65)], SURFACE),
            line([(25, 30), (73, 30)], RED, 3),
        ]
    elif key == "auditor":
        p += [
            polygon([(26, 15), (69, 15), (77, 23), (77, 82), (69, 77), (62, 82), (54, 77), (47, 82), (40, 77), (33, 82), (26, 77)], SURFACE, TEXT, 3),
            line([(36, 31), (67, 31), (36, 42), (67, 42), (36, 53), (58, 53)], TEXT, 3),
            ellipse((51, 57, 75, 81), RED, TEXT, 2),
        ]
    else:
        raise ValueError(key)
    return p


def generate_handbook() -> list[Path]:
    outputs: list[Path] = []
    outputs += save_vector("handbook/keycap-1u", 40, 40, handbook_keycap(40, 40))
    outputs += save_vector("handbook/keycap-wide", 80, 40, handbook_keycap(80, 40))
    mouse = handbook_keycap(40, 52)
    mouse += [line([(20, 4), (20, 24), (5, 24), (35, 24)], LINE, 2), rect((6, 5, 19, 23), GOLD)]
    outputs += save_vector("handbook/keycap-mouse", 40, 52, mouse)
    rule = [line([(0, 10), (280, 10), (300, 3), (320, 17), (340, 10), (640, 10)], LINE, 2, 200), line([(12, 4), (12, 16)], GOLD, 2)]
    outputs += save_vector("handbook/section-rule", 640, 20, rule)
    for key in ("gossip", "complainer", "micromanager", "karen", "auditor"):
        outputs += save_vector(f"handbook/threat-{key}", 96, 96, threat_icon(key))
    return outputs


def record_ledger_header() -> None:
    lines = LEDGER.read_text(encoding="utf-8").splitlines()
    replacements = {
        "Generator:": "Generators: scripts/generate_hud_assets.py and scripts/generate_menu_assets.py  ",
        "Generator version:": f"Generator versions: hud-assets-v1 + {VERSION}  ",
        "Generator versions:": f"Generator versions: hud-assets-v1 + {VERSION}  ",
        "Style lock:": "Style lock: docs/art/asset_style_lock.json version 1.1.0 (draft)  ",
        "Review status:": "Review status: development candidates; owner approval pending",
    }
    resolved = (
        "Resolved fonts: display "
        f"{font_provenance('display')}; ledger {font_provenance('ledger')}; "
        f"Tier 1 compatibility {font_provenance('legacy_display')} / {font_provenance('legacy_ledger')}  "
    )
    had_fonts = any(value.startswith("Resolved fonts:") for value in lines)
    found_fonts = False
    updated: list[str] = []
    for value in lines:
        if value.startswith("Resolved fonts:"):
            if not found_fonts:
                updated.append(resolved)
                found_fonts = True
            continue
        replaced = False
        for prefix, replacement in replacements.items():
            if value.startswith(prefix):
                updated.append(replacement)
                replaced = True
                break
        if not replaced:
            updated.append(value)
        if not had_fonts and not found_fonts and value.startswith(("Generator version:", "Generator versions:")):
            updated.append(resolved)
            found_fonts = True
    LEDGER.write_text("\n".join(updated) + "\n", encoding="utf-8", newline="\n")


def generate() -> list[Path]:
    outputs: list[Path] = []
    outputs += generate_glyphs()
    outputs += generate_menuplates()
    outputs += generate_classes()
    outputs += generate_party()
    outputs += generate_lobby()
    outputs += generate_severance()
    outputs += generate_controls()
    outputs += generate_verdict()
    outputs += generate_handbook()
    sync_public_assets()
    update_ledger()
    record_ledger_header()
    return outputs


if __name__ == "__main__":
    files = generate()
    print(f"generated {len(files)} files with {VERSION}")
