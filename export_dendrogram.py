"""
Export the agglomerative hierarchy as a nested JSON tree the React frontend
renders as a radial dendrogram.

This is a 5th pipeline stage — run it AFTER build_frontend_data.py.

Why this is separate from build_frontend_data.py:
  build_frontend_data.py computes flat cluster *assignments* for every
  (algorithm, k) configuration. The dendrogram instead needs the full
  agglomerative *hierarchy* — the whole merge tree — which is independent
  of k. k only decides where the tree is CUT. So we export the tree once,
  plus the cut height for each k value, and the frontend slices it live.

Reads:
  data/similarity_matrix.npz   — { codes, matrix }  (written by cluster.py)

Writes:
  frontend/public/data/dendrogram.json

Output schema:
  {
    "linkage": "average",
    "leaf_count": 194,
    "max_height": 0.288,
    "k_values": [8, 10, 12, 14, 16, 18],
    "cut_heights": { "8": 0.24, "10": 0.23, ... },   # height to cut for each k
    "default_k": 14,
    "tree": {
      "id": 385,
      "height": 0.288,          # merge distance (0 for leaves)
      "count": 194,             # leaves under this node
      "children": [ {...}, {...} ],
      # leaves only:
      "iso3": "LBN", "name": "Lebanon"
      # NOTE: no color / cluster here — those are per-config and applied
      # on the frontend from the active clusters.json configuration.
    }
  }

Run:
  python cluster.py            # ensures data/similarity_matrix.npz exists
  python build_frontend_data.py
  python export_dendrogram.py
"""
from __future__ import annotations
from pathlib import Path
import json

import numpy as np
from scipy.cluster.hierarchy import linkage, fcluster, to_tree
from scipy.spatial.distance import squareform

DATA_DIR = Path("data")
SIM_MATRIX_NPZ = DATA_DIR / "similarity_matrix.npz"

OUT_DIR = Path("frontend/public/data")
OUT_DENDROGRAM = OUT_DIR / "dendrogram.json"

# Must match build_frontend_data.py
K_VALUES = [8, 10, 12, 14, 16, 18]
DEFAULT_K = 14
LINKAGE_METHOD = "average"


def load_similarity_matrix() -> tuple[list[str], np.ndarray]:
    if not SIM_MATRIX_NPZ.exists():
        raise FileNotFoundError(
            f"{SIM_MATRIX_NPZ} not found. Run cluster.py first to generate it."
        )
    data = np.load(SIM_MATRIX_NPZ, allow_pickle=True)
    return [str(c) for c in data["codes"]], data["matrix"]


def cut_height_for_k(Z: np.ndarray, k: int) -> float:
    """The height at which a horizontal cut yields exactly k clusters.

    With n leaves there are n-1 merges. Cutting between the (n-k)th and
    (n-k+1)th merge (by height) leaves k clusters. We take the midpoint of
    those two merge heights so the cut line sits cleanly between them.
    """
    heights = np.sort(Z[:, 2])
    n_merges = len(heights)
    if k <= 1:
        return float(heights[-1]) * 1.05
    if k >= n_merges + 1:
        return 0.0
    hi = heights[n_merges - (k - 1)]  # first merge ABOVE the cut
    lo = heights[n_merges - k]        # last merge BELOW the cut
    return float((hi + lo) / 2.0)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    codes, sim_matrix = load_similarity_matrix()
    n = len(codes)
    print(f"Loaded similarity matrix: {n} countries")

    # Distance = 1 - similarity, same transform cluster.py uses
    dist = 1.0 - sim_matrix
    np.fill_diagonal(dist, 0.0)
    dist = np.clip(dist, 0.0, 1.0).astype(np.float64)

    # Agglomerative linkage (average) — identical to run_agglomerative()
    Z = linkage(squareform(dist, checks=False), method=LINKAGE_METHOD)
    max_height = float(Z[:, 2].max())
    print(f"Built linkage: {Z.shape[0]} merges, max height {max_height:.4f}")

    # Cut height for each pre-trained k
    cut_heights = {str(k): cut_height_for_k(Z, k) for k in K_VALUES}
    for k in K_VALUES:
        # sanity check: does this height actually yield k clusters?
        got = len(set(fcluster(Z, t=cut_heights[str(k)], criterion="distance")))
        print(f"  k={k:2d}  cut={cut_heights[str(k)]:.4f}  -> {got} clusters")

    # Serialize the scipy tree to nested dicts. Leaves carry iso3 + name only;
    # coloring is per-config and done on the frontend.
    root = to_tree(Z)

    def serialize(node):
        if node.is_leaf():
            iso3 = codes[node.id]
            return {
                "id": int(node.id),
                "height": 0.0,
                "count": 1,
                "iso3": iso3,
                "name": iso3,  # display name patched below if available
            }
        return {
            "id": int(node.id),
            "height": float(node.dist),
            "count": int(node.count),
            "children": [serialize(node.get_left()), serialize(node.get_right())],
        }

    tree = serialize(root)

    # Patch in human-readable country names from countries.json if present
    countries_json = OUT_DIR / "countries.json"
    if countries_json.exists():
        with open(countries_json, "r", encoding="utf-8") as f:
            name_by_iso3 = {c["iso3"]: c["name"] for c in json.load(f)}

        def patch(node):
            if "iso3" in node:
                node["name"] = name_by_iso3.get(node["iso3"], node["iso3"])
            for c in node.get("children", []):
                patch(c)

        patch(tree)
        print(f"Patched country names from {countries_json}")
    else:
        print(f"WARNING: {countries_json} not found — leaves will show ISO3 codes")

    payload = {
        "linkage": LINKAGE_METHOD,
        "leaf_count": n,
        "max_height": max_height,
        "k_values": K_VALUES,
        "cut_heights": cut_heights,
        "default_k": DEFAULT_K,
        "tree": tree,
    }

    with open(OUT_DENDROGRAM, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"Wrote {OUT_DENDROGRAM} ({OUT_DENDROGRAM.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()