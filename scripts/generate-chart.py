#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "matplotlib>=3.8",
# ]
# ///
"""
Generate a grouped bar chart comparing WebSocket message processing throughput
across different client modes (browser-headless, browser-default, tauri-js, tauri-rust)
with JSON vs Binary format comparison.

Usage:
    uv run scripts/generate-chart.py results/comparison-2026-02-01.json
    # or directly (requires execute permission):
    ./scripts/generate-chart.py results/comparison-2026-02-01.json
"""

import argparse
import json
import os
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np


def format_rate(value: float, _pos) -> str:
    """Format message rate as human-readable string (e.g., 200k, 1.2M)."""
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    elif value >= 1_000:
        return f"{int(value / 1_000)}k"
    else:
        return str(int(value))


def load_comparison_data(filepath: str) -> dict:
    """Load and validate comparison JSON data."""
    with open(filepath, "r") as f:
        data = json.load(f)

    # Validate required fields
    required_fields = ["timestamp", "server", "targetRate", "duration", "results"]
    for field in required_fields:
        if field not in data:
            raise ValueError(f"Missing required field: {field}")

    if not data["results"]:
        raise ValueError("No results in data")

    return data


def extract_chart_data(data: dict) -> tuple[list[str], list[float], list[float]]:
    """
    Extract chart data from comparison results.
    
    Returns:
        modes: List of mode labels (browser-headless, browser-default, tauri-js, tauri-rust)
        json_rates: List of client rates for JSON format
        binary_rates: List of client rates for Binary format
    """
    # Expected modes in order
    expected_modes = ["browser-headless", "browser-default", "tauri-js", "tauri-rust"]

    # Build lookup by (mode, format)
    lookup = {}
    for result in data["results"]:
        key = (result["mode"], result["format"])
        lookup[key] = result["clientRate"]

    # Extract rates in order
    json_rates = []
    binary_rates = []
    modes = []

    for mode in expected_modes:
        json_rate = lookup.get((mode, "json"))
        binary_rate = lookup.get((mode, "binary"))

        if json_rate is not None or binary_rate is not None:
            modes.append(mode)
            json_rates.append(json_rate or 0)
            binary_rates.append(binary_rate or 0)

    return modes, json_rates, binary_rates


def format_mode_label(mode: str) -> str:
    """Format mode name for display."""
    label_map = {
        "browser-headless": "Browser\n(Headless)",
        "browser-default": "Browser\n(Default)",
        "tauri-js": "Tauri\n(JS)",
        "tauri-rust": "Tauri\n(Rust)",
    }
    return label_map.get(mode, mode)


def create_chart(
    modes: list[str],
    json_rates: list[float],
    binary_rates: list[float],
    output_path: str,
    target_rate: int = None,
) -> None:
    """Create grouped bar chart and save to file."""
    # Set up figure
    fig, ax = plt.subplots(figsize=(12, 7))

    # Bar positions
    x = np.arange(len(modes))
    bar_width = 0.35

    # Create bars
    bars_json = ax.bar(
        x - bar_width / 2,
        json_rates,
        bar_width,
        label="JSON",
        color="#2196F3",  # Blue
        edgecolor="white",
        linewidth=0.5,
    )
    bars_binary = ax.bar(
        x + bar_width / 2,
        binary_rates,
        bar_width,
        label="Binary",
        color="#FF9800",  # Orange
        edgecolor="white",
        linewidth=0.5,
    )

    # Add value labels on top of bars
    def add_bar_labels(bars, rates):
        for bar, rate in zip(bars, rates):
            height = bar.get_height()
            if height > 0:
                label = format_rate(rate, None)
                ax.annotate(
                    label,
                    xy=(bar.get_x() + bar.get_width() / 2, height),
                    xytext=(0, 5),  # 5 points vertical offset
                    textcoords="offset points",
                    ha="center",
                    va="bottom",
                    fontsize=10,
                    fontweight="bold",
                )

    add_bar_labels(bars_json, json_rates)
    add_bar_labels(bars_binary, binary_rates)

    # Configure axes
    ax.set_xlabel("Client Mode", fontsize=12, fontweight="bold")
    ax.set_ylabel("Messages per Second", fontsize=12, fontweight="bold")
    ax.set_title(
        "WebSocket Message Processing by Client Mode",
        fontsize=14,
        fontweight="bold",
        pad=20,
    )

    # X-axis labels
    ax.set_xticks(x)
    ax.set_xticklabels([format_mode_label(m) for m in modes], fontsize=11)

    # Y-axis formatting
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(format_rate))

    # Set y-axis limits with some headroom for labels
    max_rate = max(max(json_rates), max(binary_rates))
    ax.set_ylim(0, max_rate * 1.15)

    # Add horizontal gridlines
    ax.yaxis.grid(True, linestyle="--", alpha=0.7)
    ax.set_axisbelow(True)

    # Add target rate line if provided
    if target_rate:
        ax.axhline(
            y=target_rate,
            color="#E91E63",
            linestyle="--",
            linewidth=1.5,
            alpha=0.7,
            label=f"Target: {format_rate(target_rate, None)}/s",
        )

    # Legend
    ax.legend(loc="upper left", fontsize=11)

    # Tight layout
    plt.tight_layout()

    # Ensure output directory exists
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # Save figure
    plt.savefig(output_path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close()

    print(f"Chart saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate comparison chart from benchmark results"
    )
    parser.add_argument(
        "input_file",
        type=str,
        help="Path to comparison JSON file (e.g., results/comparison-2026-02-01.json)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=str,
        default="results/comparison-chart.png",
        help="Output path for chart (default: results/comparison-chart.png)",
    )
    parser.add_argument(
        "--no-target-line",
        action="store_true",
        help="Don't show target rate line on chart",
    )

    args = parser.parse_args()

    # Validate input file
    if not os.path.exists(args.input_file):
        print(f"Error: Input file not found: {args.input_file}", file=sys.stderr)
        sys.exit(1)

    # Load data
    try:
        data = load_comparison_data(args.input_file)
    except (json.JSONDecodeError, ValueError) as e:
        print(f"Error loading data: {e}", file=sys.stderr)
        sys.exit(1)

    # Extract chart data
    modes, json_rates, binary_rates = extract_chart_data(data)

    if not modes:
        print("Error: No valid data found in results", file=sys.stderr)
        sys.exit(1)

    print(f"Generating chart for {len(modes)} modes...")
    print(f"  JSON rates:   {[format_rate(r, None) for r in json_rates]}")
    print(f"  Binary rates: {[format_rate(r, None) for r in binary_rates]}")

    # Get target rate for reference line
    target_rate = None if args.no_target_line else data.get("targetRate")

    # Create chart
    create_chart(modes, json_rates, binary_rates, args.output, target_rate)


if __name__ == "__main__":
    main()
