"""
Pipeline orchestrator — runs the 4-stage data pipeline in order, skipping
stages whose outputs already exist unless --refresh is passed.

Usage:
    python run_pipeline.py            # skip stages with up-to-date outputs
    python run_pipeline.py --refresh  # force-rerun all stages

Stages:
    1. fetch_all_countries.py  ->  data/countries_clean.csv
    2. tree_builder.py         ->  data/country_trees.json
    3. cluster.py              ->  data/clusters.json + data/similarity_matrix.npz
    4. build_frontend_data.py  ->  frontend/public/data/{countries,clusters,pairs}.json
    5. export_dendrogram.py    ->  frontend/public/data/dendrogram.json
"""
from __future__ import annotations
import sys
import subprocess
from pathlib import Path

STAGES = [
    {
        "label": "Fetching country data from Wikidata",
        "script": "fetch_all_countries.py",
        "outputs": [Path("data/countries_clean.csv")],
    },
    {
        "label": "Building country trees",
        "script": "tree_builder.py",
        "outputs": [Path("data/country_trees.json")],
    },
    {
        "label": "Computing similarity matrix and clustering",
        "script": "cluster.py",
        "outputs": [
            Path("data/clusters.json"),
            Path("data/similarity_matrix.npz"),
        ],
    },
    {
        "label": "Building frontend data bundle",
        "script": "build_frontend_data.py",
        "outputs": [
            Path("frontend/public/data/countries.json"),
            Path("frontend/public/data/clusters.json"),
            Path("frontend/public/data/pairs.json"),
        ],
    },
    {
        "label": "Exporting agglomerative dendrogram",
        "script": "export_dendrogram.py",
        "outputs": [
            Path("frontend/public/data/dendrogram.json"),
        ],
    },
]


def all_outputs_exist(outputs: list[Path]) -> bool:
    return all(p.exists() for p in outputs)


def run_stage(n: int, total: int, stage: dict, refresh: bool) -> None:
    label = stage["label"]
    script = stage["script"]
    outputs = stage["outputs"]

    if not refresh and all_outputs_exist(outputs):
        print(f"[{n}/{total}] {label} — SKIPPED (outputs present)")
        return

    print(f"[{n}/{total}] {label}...")
    args = [sys.executable, script]
    if refresh:
        args.append("--refresh")

    result = subprocess.run(args, check=False)
    if result.returncode != 0:
        print(
            f"\n  FAILED: {script} exited with code {result.returncode}",
            file=sys.stderr,
        )
        sys.exit(result.returncode)

    print(f"[{n}/{total}] Done.\n")


def main() -> None:
    refresh = "--refresh" in sys.argv
    if refresh:
        print("-- --refresh: all stages will rerun --\n")

    total = len(STAGES)
    for i, stage in enumerate(STAGES, 1):
        run_stage(i, total, stage, refresh)

    print("Pipeline complete. Frontend data ready in frontend/public/data/")


if __name__ == "__main__":
    main()