"""Shared style configuration for all review figures.

Canonical visual language for the Computational Review pipeline.

Usage:
    from shared_style import COLORS, MARKERS, apply_style, save_figure

All figures must use these colors and call apply_style(ax) before saving.
The palette is colorblind-accessible and includes redundant shape/pattern
cues via MARKERS so information is never conveyed by color alone.

Customize the COLORS and MARKERS dictionaries for your review topic.
"""

import os
import matplotlib.pyplot as plt
import matplotlib as mpl
from typing import Optional

# ── Canonical color palette ─────────────────────────────────────────────────
# Customize these for your review topic
COLORS = {
    "primary":     "#377EB8",  # blue
    "secondary":   "#E41A1C",  # red
    "tertiary":    "#4DAF4A",  # green
    "quaternary":  "#FF7F00",  # orange
    "quinary":     "#984EA3",  # purple
    "senary":      "#A65628",  # brown
    "septenary":   "#F781BF",  # pink
    "other":       "#999999",  # grey
    # Highlight / neutral
    "highlight":   "#E41A1C",
    "neutral":     "#BDBDBD",
    "bg_light":    "#F7F7F7",
    "bg_dark":     "#252525",
}

# ── Redundant shape cues ───────────────────────────────────────────────────
MARKERS = {
    "primary":     "o",   # circle
    "secondary":   "s",   # square
    "tertiary":    "^",   # triangle up
    "quaternary":  "D",   # diamond
    "quinary":     "v",   # triangle down
    "senary":      "P",   # plus (filled)
    "septenary":   "*",   # star
    "other":       "X",   # X (filled)
}

# ── Apply canonical style to an axes ───────────────────────────────────────
def apply_style(ax, despine=True, grid=False):
    """Apply the review's canonical style to a matplotlib Axes."""
    ax.tick_params(labelsize=9, direction="out", length=3, width=0.8)
    ax.set_axisbelow(True)
    if despine:
        for spine in ("top", "right"):
            ax.spines[spine].set_visible(False)
        for spine in ("bottom", "left"):
            ax.spines[spine].set_linewidth(0.8)
    if grid:
        ax.grid(True, linestyle="--", linewidth=0.4, alpha=0.5, color="#CCCCCC")
    return ax


def save_figure(fig, name: str, directory: str = ".", dpi: int = 300,
                formats: Optional[list] = None):
    """Save a figure with canonical settings.

    Parameters
    ----------
    fig : matplotlib.figure.Figure
    name : str          – filename stem (no extension)
    directory : str     – output folder (default: current dir)
    dpi : int           – resolution for raster formats
    formats : list[str] – e.g. ["png", "svg"]; default ["png"]
    """
    if formats is None:
        formats = ["png"]
    os.makedirs(directory, exist_ok=True)
    for fmt in formats:
        path = os.path.join(directory, f"{name}.{fmt}")
        fig.savefig(path, dpi=dpi, bbox_inches="tight", facecolor="white",
                    transparent=False)


# ── Global rcParams (applied on import) ────────────────────────────────────
_RC = {
    "font.family":       "sans-serif",
    "font.sans-serif":   ["Arial", "Helvetica", "DejaVu Sans"],
    "font.size":         10,
    "axes.labelsize":    11,
    "axes.titlesize":    12,
    "xtick.labelsize":   9,
    "ytick.labelsize":   9,
    "legend.fontsize":   9,
    "figure.titlesize":  13,
    "axes.spines.top":   False,
    "axes.spines.right": False,
    "figure.dpi":        150,
    "savefig.dpi":       300,
    "savefig.bbox":      "tight",
    "savefig.facecolor": "white",
}
mpl.rcParams.update(_RC)
