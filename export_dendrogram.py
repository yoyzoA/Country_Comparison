"""
Export the agglomerative hierarchy as a nested JSON tree the React frontend
can render as a dendrogram.

Reads:
  data/linkage.npz      — { codes, linkage }  (written by cluster.py)
  data/clusters.json    — flat k=14 cluster assignment + country names

Writes:
  frontend/public/data/dendrogram.json

The output schema:
  {
    "linkage": "average",
    "n_clusters": 14,
    "cut_height": 0.21,            # the height at which k=14 clusters fall out
    "max_height": 0.288,
    "leaf_count": 194,
    "tree": {
      "id": 385,                  # scipy node id (>= n for internal nodes)
      "height": 0.288,            # merge distance (0 for leaves)
      "count": 194,               # leaves under this node
      "cluster": null,            # k=14 cluster id IF whole subtree is one cluster
      "children": [ {...}, {...} ],
      # leaves only:
      "iso3": "LBN", "name": "Lebanon", "cluster": 10, "color": "#e8d490"
    }
  }

Run after cluster.py, then re-run build_frontend_data.py (or just this).
"""
from __future__ import annotations
from pathlib import Path
import json

import numpy as np
from scipy.cluster.hierarchy import to_tree, fcluster

DATA_DIR = Path("data")
LINKAGE_NPZ = DATA_DIR / "linkage.npz"
CLUSTERS_JSON = DATA_DIR / "clusters.json"

OUT_DIR = Path("frontend/public/data")
OUT_DENDROGRAM = OUT_DIR / "dendrogram.json"

# Must match HUD_PALETTE in build_frontend_data.py so cluster colors line up
HUD_PALETTE = [
    "#00ff88", "#ff8c42", "#7d5cff", "#ff3860", "#3edd6e", "#ffd23f",
    "#5fb0ff", "#ff5fb0", "#a0e890", "#e890a0", "#90b0e8", "#e8d490",
    "#90e8d4", "#d490e8", "#e89090", "#909090",
]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Load linkage + codes ────────────────────────────────────────
    npz = np.load(LINKAGE_NPZ, allow_pickle=True)
    Z = npz["linkage"]
    codes = [str(c) for c in npz["codes"]]
    n = len(codes)
    print(f"Loaded linkage: {Z.shape[0]} merges, {n} leaves")

    # ── Load names + the k=14 flat assignment ───────────────────────
    with open(CLUSTERS_JSON, "r", encoding="utf-8") as f:
        cluster_data = json.load(f)
    n_clusters = cluster_data["n_clusters"]
    meta = {c["iso3"]: c for c in cluster_data["countries"]}

    # Recompute the flat labels straight from Z so leaf-index alignment
    # is guaranteed (codes[] is the index order scipy used).
    flat = fcluster(Z, t=n_clusters, criterion="maxclust") - 1  # 0-indexed
    leaf_cluster = {i: int(flat[i]) for i in range(n)}

    # ── Cut height: where does k=n_clusters fall out? ───────────────
    # maxclust cuts between merge (n-1-k) and (n-k); take the midpoint.
    heights_sorted = np.sort(Z[:, 2])
    hi = heights_sorted[-(n_clusters - 1)]      # first merge ABOVE the cut
    lo = heights_sorted[-n_clusters]            # last merge BELOW the cut
    cut_height = float((hi + lo) / 2.0)
    max_height = float(Z[:, 2].max())
    print(f"Cut height for k={n_clusters}: {cut_height:.4f}  (max {max_height:.4f})")

    # ── Walk the scipy tree, serialize to nested dicts ──────────────
    root = to_tree(Z)

    def serialize(node):
        if node.is_leaf():
            iso3 = codes[node.id]
            m = meta.get(iso3, {})
            cid = leaf_cluster.get(node.id)
            return {
                "id": int(node.id),
                "height": 0.0,
                "count": 1,
                "iso3": iso3,
                "name": m.get("name", iso3),
                "cluster": cid,
                "color": HUD_PALETTE[cid % len(HUD_PALETTE)] if cid is not None else "#909090",
            }
        left = serialize(node.get_left())
        right = serialize(node.get_right())
        # If every leaf under this node shares one k=14 cluster, tag the
        # whole subtree — lets the frontend color branches below the cut.
        kids_clusters = {left.get("cluster"), right.get("cluster")}
        shared = left.get("cluster") if kids_clusters == {left.get("cluster")} else None
        out = {
            "id": int(node.id),
            "height": float(node.dist),
            "count": int(node.count),
            "cluster": shared,
            "children": [left, right],
        }
        if shared is not None:
            out["color"] = HUD_PALETTE[shared % len(HUD_PALETTE)]
        return out

    tree = serialize(root)

    payload = {
        "linkage": cluster_data.get("linkage", "average"),
        "n_clusters": n_clusters,
        "cut_height": cut_height,
        "max_height": max_height,
        "leaf_count": n,
        "tree": tree,
    }

    with open(OUT_DENDROGRAM, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"Wrote {OUT_DENDROGRAM} ({OUT_DENDROGRAM.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
