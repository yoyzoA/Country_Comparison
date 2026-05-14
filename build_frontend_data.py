"""
Generate static JSON dumps the React frontend consumes.

v2 changes:
  - Pre-computes MULTIPLE cluster configurations: both algorithms
    (agglomerative, kmedoids) across several k values (8,10,12,14,16,18).
  - Computes cluster evaluation metrics (silhouette, Davies-Bouldin,
    Calinski-Harabasz) for each configuration.
  - clusters.json is now keyed by "algorithm-k" config id.
  - countries.json no longer carries cluster assignment (that's per-config now);
    it carries iso3, name, and the tree only.

Reads:
  data/country_trees.json
  data/similarity_matrix.npz

Writes (to frontend/public/data/):
  countries.json   — per-country metadata + tree (no cluster field)
  clusters.json    — { configs: {...}, default: "agglomerative-14" }
  pairs.json       — precomputed pairwise similarity + breakdown
"""
from __future__ import annotations
from pathlib import Path
from itertools import combinations
import json
import time

import numpy as np

from tree_builder import load_trees_json, TreeNode
from similarity import compare, initialize
from cluster import run_agglomerative, run_kmedoids

DATA_DIR = Path("data")
TREES_JSON = DATA_DIR / "country_trees.json"
SIM_MATRIX_NPZ = DATA_DIR / "similarity_matrix.npz"

OUT_DIR = Path("frontend/public/data")
OUT_COUNTRIES = OUT_DIR / "countries.json"
OUT_CLUSTERS = OUT_DIR / "clusters.json"
OUT_PAIRS = OUT_DIR / "pairs.json"

# Configurations to pre-compute
K_VALUES = [8, 10, 12, 14, 16, 18]
ALGORITHMS = ["agglomerative", "kmedoids"]
DEFAULT_CONFIG = "agglomerative-14"
AGGLOMERATIVE_LINKAGE = "average"

HUD_PALETTE = [
    "#00ffd1", "#ff8c42", "#7d5cff", "#ff3860", "#3edd6e",
    "#ffd23f", "#5fb0ff", "#ff5fb0", "#a0e890", "#e890a0",
    "#90b0e8", "#e8d490", "#90e8d4", "#d490e8", "#e89090",
    "#909090", "#62d6c4", "#d6a062", "#a062d6",
]


# ─────────────────────────────────────────────────────────────────────
# Similarity matrix loader
# ─────────────────────────────────────────────────────────────────────
def load_similarity_matrix() -> tuple[list[str], np.ndarray]:
    if not SIM_MATRIX_NPZ.exists():
        raise FileNotFoundError(
            f"{SIM_MATRIX_NPZ} not found. Run cluster.py first to generate it.")
    data = np.load(SIM_MATRIX_NPZ, allow_pickle=True)
    return list(data["codes"]), data["matrix"]


# ─────────────────────────────────────────────────────────────────────
# Cluster evaluation metrics
# ─────────────────────────────────────────────────────────────────────
def evaluation_metrics(distance_matrix: np.ndarray, labels: np.ndarray) -> dict:
    """Compute clustering quality metrics.

    - silhouette: [-1, 1], higher is better. Uses precomputed distances.
    - davies_bouldin: >= 0, LOWER is better. Needs a feature space, so we
      project the distance matrix to coordinates via classical MDS.
    - calinski_harabasz: >= 0, higher is better. Also needs feature space.
    """
    from sklearn.metrics import (silhouette_score, davies_bouldin_score,
                                 calinski_harabasz_score)
    from sklearn.manifold import MDS

    n_labels = len(set(labels))
    # Metrics are undefined for 1 cluster or n_clusters == n_samples
    if n_labels < 2 or n_labels >= len(labels):
        return {"silhouette": None, "davies_bouldin": None, "calinski_harabasz": None}

    out = {}

    # Silhouette works directly on the precomputed distance matrix
    try:
        out["silhouette"] = round(float(
            silhouette_score(distance_matrix, labels, metric="precomputed")), 4)
    except Exception:
        out["silhouette"] = None

    # Davies-Bouldin and Calinski-Harabasz need a coordinate embedding.
    # Project the distance matrix into a low-dim Euclidean space via MDS.
    try:
        mds = MDS(
            n_components=8,
            metric=True,
            dissimilarity="precomputed",
            random_state=42,
            n_init=4,
            normalized_stress=False,
        )
        coords = mds.fit_transform(distance_matrix)
        out["davies_bouldin"] = round(float(davies_bouldin_score(coords, labels)), 4)
        out["calinski_harabasz"] = round(float(calinski_harabasz_score(coords, labels)), 4)
    except Exception:
        out["davies_bouldin"] = None
        out["calinski_harabasz"] = None

    return out


# ─────────────────────────────────────────────────────────────────────
# Build one cluster configuration
# ─────────────────────────────────────────────────────────────────────
def build_one_config(algorithm: str, k: int,
                     codes: list[str], trees: dict,
                     distance_matrix: np.ndarray) -> dict:
    """Run one (algorithm, k) configuration and package it for the frontend."""
    if algorithm == "agglomerative":
        res = run_agglomerative(distance_matrix, k, linkage_method=AGGLOMERATIVE_LINKAGE)
        medoids = None
    else:
        res = run_kmedoids(distance_matrix, k, codes)
        medoids = res.get("medoids")

    labels = res["labels"]
    probs = res["probabilities"]

    # Group countries by cluster
    by_cluster: dict[int, list[dict]] = {}
    for code, label, prob in zip(codes, labels, probs):
        by_cluster.setdefault(int(label), []).append({
            "iso3": code,
            "name": trees[code].name,
            "probability": round(float(prob), 4),
        })

    clusters = []
    for cid in sorted(by_cluster.keys()):
        members = sorted(by_cluster[cid], key=lambda x: -x["probability"])
        member_iso3s = [m["iso3"] for m in members]
        member_names = [m["name"] for m in members]
        label_text = ", ".join(member_names[:3])
        if len(member_names) > 3:
            label_text += f" + {len(member_names) - 3} more"
        clusters.append({
            "id": cid,
            "color": HUD_PALETTE[cid % len(HUD_PALETTE)],
            "size": len(members),
            "label": label_text,
            "members": member_iso3s,
            "medoid": medoids[cid] if medoids else None,
        })

    # Per-country cluster assignment lookup
    assignment = {
        code: {"cluster": int(label), "probability": round(float(prob), 4)}
        for code, label, prob in zip(codes, labels, probs)
    }

    metrics = evaluation_metrics(distance_matrix, labels)

    return {
        "algorithm": algorithm,
        "k": k,
        "linkage": AGGLOMERATIVE_LINKAGE if algorithm == "agglomerative" else None,
        "n_clusters": len(clusters),
        "clusters": clusters,
        "assignment": assignment,
        "metrics": metrics,
    }


# ─────────────────────────────────────────────────────────────────────
# Build countries.json
# ─────────────────────────────────────────────────────────────────────
def build_countries(trees: dict[str, TreeNode]) -> list[dict]:
    """Per-country payload — tree only, no cluster (that's per-config now)."""
    out = []
    for iso3, tree in sorted(trees.items()):
        out.append({
            "iso3": iso3,
            "name": tree.name,
            "tree": tree.to_dict(),
        })
    return out


# ─────────────────────────────────────────────────────────────────────
# Build pairs.json
# ─────────────────────────────────────────────────────────────────────
def build_pairs(trees: dict[str, TreeNode]) -> dict:
    codes = sorted(trees.keys())
    n = len(codes)
    print(f"Building pairs ({n*(n-1)//2:,} unordered pairs)...")
    start = time.time()
    pairs: dict[str, dict] = {}
    count = 0
    for a, b in combinations(codes, 2):
        result = compare(trees[a], trees[b])
        pairs[f"{a}:{b}"] = {
            "similarity": round(result.similarity, 4),
            "distance": round(result.distance, 4),
            "max_distance": round(result.max_distance, 4),
            "breakdown": [
                {"path": path, "cost": round(cost, 4)}
                for path, cost in result.leaf_breakdown
            ],
        }
        count += 1
        if count % 4000 == 0:
            elapsed = time.time() - start
            print(f"  {count:,}/{n*(n-1)//2:,} ({count/elapsed:,.0f}/s)")
    print(f"  Done in {time.time() - start:.1f}s")
    return pairs


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────
def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading trees...")
    trees = load_trees_json()
    initialize(trees)
    print(f"  {len(trees)} trees")

    print("Loading similarity matrix...")
    codes, sim_matrix = load_similarity_matrix()
    dist_matrix = 1.0 - sim_matrix
    np.fill_diagonal(dist_matrix, 0.0)
    dist_matrix = np.clip(dist_matrix, 0.0, 1.0).astype(np.float64)
    print(f"  {len(codes)} countries")

    # ---- countries.json ----
    print("\nBuilding countries.json...")
    countries = build_countries(trees)
    with open(OUT_COUNTRIES, "w", encoding="utf-8") as f:
        json.dump(countries, f, ensure_ascii=False)
    print(f"  Wrote {OUT_COUNTRIES} ({OUT_COUNTRIES.stat().st_size:,} bytes)")

    # ---- clusters.json (all configurations) ----
    print("\nBuilding cluster configurations...")
    configs = {}
    for algorithm in ALGORITHMS:
        for k in K_VALUES:
            config_id = f"{algorithm}-{k}"
            print(f"  Computing {config_id}...", end=" ", flush=True)
            t0 = time.time()
            configs[config_id] = build_one_config(algorithm, k, codes, trees, dist_matrix)
            m = configs[config_id]["metrics"]
            print(f"done in {time.time()-t0:.1f}s "
                  f"(silhouette={m['silhouette']}, DB={m['davies_bouldin']})")

    clusters_payload = {
        "default": DEFAULT_CONFIG,
        "k_values": K_VALUES,
        "algorithms": ALGORITHMS,
        "configs": configs,
    }
    with open(OUT_CLUSTERS, "w", encoding="utf-8") as f:
        json.dump(clusters_payload, f, ensure_ascii=False)
    print(f"  Wrote {OUT_CLUSTERS} ({OUT_CLUSTERS.stat().st_size:,} bytes)")

    # ---- pairs.json ----
    print("\nBuilding pairs.json...")
    pairs = build_pairs(trees)
    with open(OUT_PAIRS, "w", encoding="utf-8") as f:
        json.dump(pairs, f, ensure_ascii=False)
    print(f"  Wrote {OUT_PAIRS} ({OUT_PAIRS.stat().st_size:,} bytes)")

    print("\nDone. Frontend data ready in", OUT_DIR)
    print(f"  {len(configs)} cluster configurations")
    print(f"  default: {DEFAULT_CONFIG}")


if __name__ == "__main__":
    main()