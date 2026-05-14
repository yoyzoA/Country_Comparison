"""
Cluster the country trees using one of two algorithms.

Supported algorithms:
  - agglomerative (default) — hierarchical, average linkage by default,
                              uses precomputed distance matrix.
  - kmedoids                 — partitional, picks K representative countries
                              as cluster centers (interpretable).

Both operate on the cached TED-derived similarity matrix.

Usage:
  python cluster.py
  python cluster.py --algorithm=kmedoids --k=12
  python cluster.py --algorithm=agglomerative --linkage=ward --k=10
  python cluster.py --refresh                  # force similarity recompute
"""
from __future__ import annotations
from pathlib import Path
from itertools import combinations
import json
import time
import sys

import numpy as np

from tree_builder import load_trees_json
from similarity import compare, initialize

DATA_DIR = Path("data")
SIM_MATRIX_NPZ = DATA_DIR / "similarity_matrix.npz"
CLUSTERS_JSON = DATA_DIR / "clusters.json"
LINKAGE_NPZ = DATA_DIR / "linkage.npz"

# Defaults — overridden via CLI
DEFAULT_ALGORITHM = "agglomerative"
DEFAULT_LINKAGE = "average"
DEFAULT_K = 14


# ─────────────────────────────────────────────────────────────────────
# Similarity matrix — compute once, cache to disk
# ─────────────────────────────────────────────────────────────────────
def compute_similarity_matrix(trees: dict) -> tuple[list[str], np.ndarray]:
    codes = sorted(trees.keys())
    n = len(codes)
    matrix = np.ones((n, n), dtype=np.float32)

    print(f"Computing similarity matrix ({n}x{n}, {n*(n-1)//2:,} pairs)...")
    start = time.time()
    code_to_idx = {c: i for i, c in enumerate(codes)}
    count = 0
    for a, b in combinations(codes, 2):
        sim = compare(trees[a], trees[b]).similarity
        i, j = code_to_idx[a], code_to_idx[b]
        matrix[i, j] = sim
        matrix[j, i] = sim
        count += 1
        if count % 4000 == 0:
            elapsed = time.time() - start
            rate = count / elapsed
            print(f"  {count:,}/{n*(n-1)//2:,} pairs done ({rate:,.0f}/s)")
    print(f"  Done in {time.time() - start:.1f}s")
    return codes, matrix


def load_or_compute_similarity(trees: dict, force: bool = False) -> tuple[list[str], np.ndarray]:
    if SIM_MATRIX_NPZ.exists() and not force:
        print(f"Loading cached similarity matrix from {SIM_MATRIX_NPZ}")
        data = np.load(SIM_MATRIX_NPZ, allow_pickle=True)
        return list(data["codes"]), data["matrix"]
    codes, matrix = compute_similarity_matrix(trees)
    np.savez_compressed(SIM_MATRIX_NPZ, codes=np.array(codes), matrix=matrix)
    print(f"  Cached to {SIM_MATRIX_NPZ}")
    return codes, matrix


# ─────────────────────────────────────────────────────────────────────
# Algorithm A: Agglomerative
# ─────────────────────────────────────────────────────────────────────
def run_agglomerative(distance_matrix: np.ndarray, n_clusters: int,
                      linkage_method: str = "average") -> dict:
    from scipy.cluster.hierarchy import linkage, fcluster
    from scipy.spatial.distance import squareform

    condensed = squareform(distance_matrix, checks=False)

    # Ward requires Euclidean distances and isn't valid on arbitrary metrics,
    # but scipy will compute it anyway as best it can. Other linkages work fine.
    Z = linkage(condensed, method=linkage_method)

    labels = fcluster(Z, t=n_clusters, criterion="maxclust") - 1  # 0-indexed

    n = len(labels)
    probs = np.zeros(n, dtype=np.float32)
    for cid in set(labels):
        members = np.where(labels == cid)[0]
        if len(members) == 1:
            probs[members[0]] = 1.0
            continue
        sub = distance_matrix[np.ix_(members, members)]
        mean_dists = sub.mean(axis=1)
        max_d = mean_dists.max() if mean_dists.max() > 0 else 1.0
        probs[members] = 1.0 - (mean_dists / max_d) * 0.5

    return {"labels": labels, "probabilities": probs, "linkage": Z}


# ─────────────────────────────────────────────────────────────────────
# Algorithm B: K-medoids (partitional) — self-contained PAM implementation
# ─────────────────────────────────────────────────────────────────────
def _pam_kmedoids(distance_matrix: np.ndarray, k: int,
                  max_iter: int = 100, seed: int = 42):
    """Partitioning Around Medoids (PAM) — the classic k-medoids algorithm.

    Implemented directly (no external library) so it can be cited as our own
    implementation, and to avoid fragile binary dependencies.

    Steps:
      1. BUILD: greedily pick k initial medoids that minimize total cost.
      2. SWAP:  repeatedly try swapping each medoid with each non-medoid;
                keep any swap that reduces total cost. Stop when no swap helps.

    Returns: (labels, medoid_indices)
    """
    rng = np.random.default_rng(seed)
    n = distance_matrix.shape[0]

    # ---- BUILD phase: greedy initialization ----
    # First medoid: the point with minimum total distance to all others.
    medoids = [int(np.argmin(distance_matrix.sum(axis=1)))]
    # Remaining medoids: greedily add the point that most reduces total cost.
    while len(medoids) < k:
        best_gain = -np.inf
        best_candidate = None
        # Current distance from each point to its nearest medoid
        nearest = distance_matrix[:, medoids].min(axis=1)
        for cand in range(n):
            if cand in medoids:
                continue
            # How much would adding `cand` reduce total cost?
            new_nearest = np.minimum(nearest, distance_matrix[:, cand])
            gain = (nearest - new_nearest).sum()
            if gain > best_gain:
                best_gain = gain
                best_candidate = cand
        medoids.append(best_candidate)

    medoids = np.array(sorted(medoids))

    def assign(medoids):
        """Assign every point to its nearest medoid. Returns (labels, total_cost)."""
        d = distance_matrix[:, medoids]      # n x k
        labels = d.argmin(axis=1)
        total_cost = d[np.arange(n), labels].sum()
        return labels, total_cost

    labels, current_cost = assign(medoids)

    # ---- SWAP phase ----
    for _ in range(max_iter):
        improved = False
        for mi in range(len(medoids)):
            for cand in range(n):
                if cand in medoids:
                    continue
                trial = medoids.copy()
                trial[mi] = cand
                _, trial_cost = assign(trial)
                if trial_cost < current_cost - 1e-9:
                    medoids = trial
                    current_cost = trial_cost
                    improved = True
        if not improved:
            break

    labels, _ = assign(medoids)
    return labels, np.array(sorted(medoids))


def run_kmedoids(distance_matrix: np.ndarray, n_clusters: int,
                 codes: list[str]) -> dict:
    """K-medoids clustering via our own PAM implementation.
    Each cluster is centered on a real country (the medoid).
    """
    labels, medoid_indices = _pam_kmedoids(distance_matrix, n_clusters)

    # Membership probability: closeness to the cluster's medoid
    n = len(labels)
    probs = np.zeros(n, dtype=np.float32)
    for cid, medoid_idx in enumerate(medoid_indices):
        members = np.where(labels == cid)[0]
        if len(members) == 1:
            probs[members[0]] = 1.0
            continue
        dists_to_medoid = distance_matrix[members, medoid_idx]
        max_d = dists_to_medoid.max() if dists_to_medoid.max() > 0 else 1.0
        probs[members] = 1.0 - (dists_to_medoid / max_d) * 0.5

    medoid_codes = [codes[i] for i in medoid_indices]
    return {"labels": labels, "probabilities": probs, "medoids": medoid_codes}


# ─────────────────────────────────────────────────────────────────────
# Reporting
# ─────────────────────────────────────────────────────────────────────
def report_clusters(codes: list[str], trees: dict,
                    labels: np.ndarray, probs: np.ndarray,
                    algorithm: str, n_clusters: int, linkage_method: str) -> None:
    print("\n" + "=" * 60)
    title = f"{algorithm}, k={n_clusters}"
    if algorithm == "agglomerative":
        title += f", {linkage_method} linkage"
    print(f"Cluster summary ({title})")
    print("=" * 60)
    print(f"  Clusters: {len(set(labels))}")
    print(f"  Countries: {len(labels)}")

    groups: dict[int, list[tuple[str, str, float]]] = {}
    for code, label, prob in zip(codes, labels, probs):
        groups.setdefault(int(label), []).append((code, trees[code].name, float(prob)))

    for label in sorted(groups.keys(), key=lambda k: -len(groups[k])):
        members = sorted(groups[label], key=lambda x: -x[2])
        print(f"\n--- Cluster {label} ({len(members)} countries) ---")
        for code, name, prob in members:
            print(f"  {prob:.2f}  {code}  {name}")


def save_clusters(codes: list[str], trees: dict,
                  labels: np.ndarray, probs: np.ndarray,
                  algorithm: str, n_clusters: int,
                  linkage_method: str = None,
                  medoids: list[str] = None,
                  linkage_Z: np.ndarray = None) -> None:
    out = {
        "algorithm": algorithm,
        "n_clusters": int(len(set(labels))),
        "k_requested": n_clusters,
        "linkage": linkage_method,
        "medoids": medoids,
        "countries": [
            {
                "iso3": code,
                "name": trees[code].name,
                "cluster": int(label),
                "probability": float(prob),
            }
            for code, label, prob in zip(codes, labels, probs)
        ],
    }
    with open(CLUSTERS_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\nSaved clusters to {CLUSTERS_JSON}")

    if linkage_Z is not None:
        np.savez_compressed(LINKAGE_NPZ, codes=np.array(codes), linkage=linkage_Z)
        print(f"Saved linkage matrix to {LINKAGE_NPZ}")


# ─────────────────────────────────────────────────────────────────────
# CLI parsing
# ─────────────────────────────────────────────────────────────────────
def parse_args():
    args = {
        "algorithm": DEFAULT_ALGORITHM,
        "k": DEFAULT_K,
        "linkage": DEFAULT_LINKAGE,
        "refresh": False,
    }
    for arg in sys.argv[1:]:
        if arg == "--refresh":
            args["refresh"] = True
        elif arg.startswith("--algorithm="):
            v = arg.split("=", 1)[1]
            if v not in ("agglomerative", "kmedoids"):
                raise SystemExit(f"Unknown algorithm: {v}. Use 'agglomerative' or 'kmedoids'.")
            args["algorithm"] = v
        elif arg.startswith("--k="):
            args["k"] = int(arg.split("=", 1)[1])
        elif arg.startswith("--linkage="):
            args["linkage"] = arg.split("=", 1)[1]
    return args


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()

    trees = load_trees_json()
    initialize(trees)
    print(f"Loaded {len(trees)} trees")
    print(f"Algorithm: {args['algorithm']}, k={args['k']}", end="")
    if args["algorithm"] == "agglomerative":
        print(f", linkage={args['linkage']}")
    else:
        print()

    codes, sim_matrix = load_or_compute_similarity(trees, force=args["refresh"])

    dist_matrix = 1.0 - sim_matrix
    np.fill_diagonal(dist_matrix, 0.0)
    dist_matrix = np.clip(dist_matrix, 0.0, 1.0).astype(np.float64)

    if args["algorithm"] == "agglomerative":
        result = run_agglomerative(dist_matrix, args["k"], linkage_method=args["linkage"])
        save_clusters(codes, trees, result["labels"], result["probabilities"],
                      algorithm="agglomerative", n_clusters=args["k"],
                      linkage_method=args["linkage"], linkage_Z=result["linkage"])
    else:  # kmedoids
        result = run_kmedoids(dist_matrix, args["k"], codes)
        save_clusters(codes, trees, result["labels"], result["probabilities"],
                      algorithm="kmedoids", n_clusters=args["k"],
                      medoids=result["medoids"])

    report_clusters(codes, trees, result["labels"], result["probabilities"],
                    algorithm=args["algorithm"], n_clusters=args["k"],
                    linkage_method=args["linkage"])


if __name__ == "__main__":
    main()