import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { configId } from "../lib/clusterConfig";

/**
 * DENDROGRAM tab — radial visualization of the agglomerative hierarchy.
 *
 * The hierarchy itself (the full merge tree) is fixed and independent of k —
 * it comes from data.dendrogram (dendrogram.json, produced by
 * export_dendrogram.py). k only decides WHERE the tree is cut.
 *
 * This tab always shows the AGGLOMERATIVE hierarchy. It follows the global
 * cluster config: leaf colors come from the `agglomerative-<k>` configuration
 * and the cut ring sits at that k's cut height. So changing k (or algorithm)
 * in CLUSTER CONTROL refreshes this tab automatically. (If the active
 * algorithm is k-medoids, the hierarchy is still agglomerative — k-medoids is
 * partitional and has no tree — but the cut still follows the active k, which
 * is handy for comparing the two algorithms side by side.)
 *
 * Features:
 *   - Zoom in/out (SVG grows, panel scrolls).
 *   - Draggable CUT RING — slice the hierarchy at any height; the live readout
 *     shows how many clusters fall out. Resets to the active k's cut height
 *     whenever k changes.
 *   - Click any CONNECTION → MERGE DETAIL side panel: merge distance, implied
 *     similarity, and the two branches joined (plus the exact pairwise score
 *     when the merge joins two single countries).
 *
 * Architecture note — drawing is split into TWO effects on purpose:
 *   1. structural draw  (deps: tree, size, zoom) — builds the SVG once.
 *   2. cut/selection overlay (deps: cutHeight, selected, colors) — only
 *      repaints link colors + repositions the cut ring.
 * This is what keeps the cut-ring drag smooth: dragging only re-runs effect 2,
 * so the SVG (and the drag gesture bound to it) is never destroyed mid-drag.
 */

const ACCENT = "#00ff88";
const DIM = "#5a6878";
const DANGER = "#ff3860";

// Count clusters produced by a cut at `height`: every link the cut crosses
// (parent above, child at/below) starts one cluster.
function clustersAtHeight(root, height) {
  let count = 0;
  root.each(d => {
    const parentH = d.parent ? d.parent.data.height : Infinity;
    if (d.data.height <= height && parentH > height) count++;
  });
  return count;
}

// First k leaf names under a node — used to describe a branch in the panel.
function sampleNames(node, k = 5) {
  const names = [];
  (function walk(n) {
    if (names.length >= k) return;
    if (n.data.iso3) { names.push(n.data.name); return; }
    (n.children || []).forEach(walk);
  })(node);
  return names;
}

export default function Dendrogram({ data, clustersPayload, clusterConfig, configControl }) {
  const dendro = data.dendrogram;
  const svgRef = useRef();
  const wrapRef = useRef();
  // Carries scale + radius from the structural effect to the overlay effect
  // so the latter can move the cut ring without a full redraw.
  const geomRef = useRef(null);

  const activeK = clusterConfig.k;

  // The dendrogram is always colored by the agglomerative config at the
  // active k (the hierarchy IS agglomerative). Fall back gracefully if that
  // exact config wasn't pre-computed.
  const agglConfig = useMemo(() => {
    const id = configId("agglomerative", activeK);
    return clustersPayload.configs[id] || null;
  }, [clustersPayload, activeK]);

  // iso3 -> cluster color, from the agglomerative-k assignment
  const colorByIso3 = useMemo(() => {
    if (!agglConfig) return {};
    const colorOfCluster = Object.fromEntries(
      agglConfig.clusters.map(c => [c.id, c.color])
    );
    const out = {};
    for (const [iso3, a] of Object.entries(agglConfig.assignment)) {
      out[iso3] = colorOfCluster[a.cluster] || DIM;
    }
    return out;
  }, [agglConfig]);

  const [cutHeight, setCutHeight] = useState(
    dendro ? (dendro.cut_heights[String(activeK)] ?? dendro.max_height / 2) : 0
  );
  const [hovered, setHovered] = useState(null);   // { name, iso3 } | null
  const [selected, setSelected] = useState(null); // d3 node (a merge) | null
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // When the global k changes, snap the cut ring to that k's cut height.
  useEffect(() => {
    if (!dendro) return;
    const h = dendro.cut_heights[String(activeK)];
    if (h !== undefined) setCutHeight(h);
  }, [activeK, dendro]);

  // Track container (viewport) size so the SVG is responsive
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.max(320, width), h: Math.max(320, height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Build the d3 hierarchy once. Node objects are stable across re-layouts,
  // so `selected` stays valid when zooming / re-cutting.
  const root = useMemo(() => {
    if (!dendro) return null;
    const h = d3.hierarchy(dendro.tree);
    // tag each node with a representative iso3 (first leaf) for branch coloring
    h.eachAfter(n => {
      n.repIso3 = n.data.iso3 ? n.data.iso3 : n.children[0].repIso3;
    });
    return h;
  }, [dendro]);

  const liveClusterCount = useMemo(
    () => (root ? clustersAtHeight(root, cutHeight) : 0),
    [root, cutHeight]
  );

  // ── EFFECT 1 — structural draw. Deps: root, size, zoom. Builds the SVG. ──
  useEffect(() => {
    if (!root || !svgRef.current) return;
    const { w, h } = size;
    const maxH = dendro.max_height;

    const svgW = w * zoom;
    const svgH = h * zoom;
    const cx = svgW / 2;
    const cy = svgH / 2;

    // Geometry in pre-scale (local) coords; the <g> is scaled by `zoom`.
    const radius = Math.min(w, h) / 2;
    const inner = radius - 95; // room for labels
    const x = d3.scaleLinear().domain([0, maxH]).range([inner, 0]);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", svgW).attr("height", svgH);

    const g = svg.append("g")
      .attr("transform", `translate(${cx},${cy}) scale(${zoom})`);

    const cluster = d3.cluster().size([2 * Math.PI, inner]).separation(() => 1);
    cluster(root);
    root.each(d => { d.radius = x(d.data.height); });

    const toXY = (a, r) => [
      Math.cos(a - Math.PI / 2) * r,
      Math.sin(a - Math.PI / 2) * r,
    ];
    const elbow = d => {
      const a1 = d.source.x, r1 = d.source.radius;
      const a2 = d.target.x, r2 = d.target.radius;
      const [sx, sy] = toXY(a1, r1);
      const [mx, my] = toXY(a2, r1);
      const [tx, ty] = toXY(a2, r2);
      const sweep = a2 > a1 ? 1 : 0;
      return `M${sx},${sy} A${r1},${r1} 0 0 ${sweep} ${mx},${my} L${tx},${ty}`;
    };
    const links = root.links();

    // Fat invisible hit paths — make thin connections easy to click
    g.append("g")
      .selectAll("path")
      .data(links)
      .join("path")
      .attr("fill", "none")
      .attr("stroke", "transparent")
      .attr("stroke-width", 8)
      .style("cursor", "pointer")
      .attr("d", elbow)
      .on("click", (e, d) => setSelected(d.source));

    // Visible links (colored by effect 2)
    g.append("g")
      .attr("fill", "none")
      .selectAll("path")
      .data(links)
      .join("path")
      .attr("class", "dendro-link")
      .style("pointer-events", "none")
      .attr("d", elbow);

    // Leaves — dots + rotating labels
    const leaves = g.append("g")
      .selectAll("g")
      .data(root.leaves())
      .join("g")
      .attr("transform", d => {
        const [lx, ly] = toXY(d.x, d.radius);
        return `translate(${lx},${ly})`;
      })
      .style("cursor", "default")
      .on("mouseenter", (e, d) => setHovered({ name: d.data.name, iso3: d.data.iso3 }))
      .on("mouseleave", () => setHovered(null));

    leaves.append("circle")
      .attr("class", "dendro-leaf-dot")
      .attr("r", 2.2);

    leaves.append("text")
      .attr("transform", d => {
        const deg = (d.x * 180) / Math.PI - 90;
        const flip = d.x >= Math.PI;
        return `rotate(${deg}) ${flip ? "rotate(180)" : ""}`;
      })
      .attr("x", d => (d.x >= Math.PI ? -6 : 6))
      .attr("text-anchor", d => (d.x >= Math.PI ? "end" : "start"))
      .attr("dy", "0.32em")
      .attr("font-size", 8)
      .attr("font-family", "'JetBrains Mono', monospace")
      .attr("fill", "#c8d4e0")
      .text(d => d.data.name)
      .clone(true).lower()
      .attr("stroke", "#05080c")
      .attr("stroke-width", 2.5);

    // Cut ring — created ONCE here, positioned by effect 2.
    const cutG = g.append("g").attr("id", "cut-ring").style("cursor", "ns-resize");
    cutG.append("circle").attr("id", "cut-visible")
      .attr("fill", "none").attr("stroke", DANGER)
      .attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3");
    cutG.append("circle").attr("id", "cut-hit")
      .attr("fill", "none").attr("stroke", "transparent")
      .attr("stroke-width", 18);
    cutG.append("text").attr("id", "cut-label")
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("font-family", "'JetBrains Mono', monospace")
      .attr("fill", DANGER);

    // Drag — .container(g.node()) makes event.x/event.y local to the scaled
    // group with the origin at the center, so r = hypot(x,y) is the cut radius
    // directly. Without it, coords are measured from the SVG corner and the
    // cut jumps to its extreme on the first pointer tick.
    cutG.call(
      d3.drag()
        .container(g.node())
        .on("drag", (event) => {
          const r = Math.sqrt(event.x * event.x + event.y * event.y);
          const clamped = Math.max(0, Math.min(inner, r));
          setCutHeight(Math.max(0, Math.min(maxH, x.invert(clamped))));
        })
    );

    geomRef.current = { x, inner };
  }, [root, size, zoom, dendro]);

  // ── EFFECT 2 — cut + selection + color overlay. Repaints link/leaf colors
  //    and repositions the cut ring WITHOUT touching structure. ────────────
  useEffect(() => {
    if (!svgRef.current || !geomRef.current || !root) return;
    const { x } = geomRef.current;
    const svg = d3.select(svgRef.current);

    // Leaf dot colors
    svg.selectAll(".dendro-leaf-dot")
      .attr("fill", d => colorByIso3[d.data.iso3] || DIM);

    // Link colors. A link (parent -> child) is "inside a cluster" when the
    // PARENT merged at/below the cut — then everything under the parent is one
    // cluster, so color it by a representative leaf's cluster color.
    svg.selectAll(".dendro-link").each(function (d) {
      const isSel = selected && d.source === selected;
      const parentBelowCut = d.source.data.height <= cutHeight;
      const base = parentBelowCut ? (colorByIso3[d.source.repIso3] || DIM) : DIM;
      d3.select(this)
        .attr("stroke", isSel ? ACCENT : base)
        .attr("stroke-width", isSel ? 3 : base === DIM ? 1 : 1.6)
        .attr("stroke-opacity", isSel ? 1 : base === DIM ? 0.5 : 0.95);
    });

    // Cut ring position
    const cutR = x(cutHeight);
    svg.select("#cut-visible").attr("r", cutR);
    svg.select("#cut-hit").attr("r", cutR);
    svg.select("#cut-label")
      .attr("x", 0).attr("y", -cutR - 6)
      .text(`CUT ${cutHeight.toFixed(3)}`);
  }, [cutHeight, selected, colorByIso3, root, size, zoom]);

  // ── Empty state — dendrogram.json not generated yet ─────────────────────
  if (!dendro) {
    return (
      <div className="hud-panel hud-panel-corner h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="hud-header mb-2">HIERARCHY UNAVAILABLE</div>
        <div className="text-hud-textDim text-xs max-w-md leading-relaxed">
          <span className="text-hud-danger">dendrogram.json</span> not found.
          Generate it on the backend:
          <pre className="mt-3 text-left text-[11px] bg-black/40 border border-hud-panelEdge p-2 overflow-x-auto">
python cluster.py            # ensures data/similarity_matrix.npz{"\n"}
python build_frontend_data.py{"\n"}
python export_dendrogram.py  # writes frontend/public/data/dendrogram.json</pre>
        </div>
      </div>
    );
  }

  // Merge info for the side panel
  let mergeInfo = null;
  if (selected) {
    const kids = selected.children || [];
    // exact pairwise score when this merge joins two single countries
    let exactPair = null;
    if (kids.length === 2 && kids[0].data.iso3 && kids[1].data.iso3) {
      exactPair = data.lookup.pair(kids[0].data.iso3, kids[1].data.iso3);
    }
    mergeInfo = {
      distance: selected.data.height,
      similarity: 1 - selected.data.height,
      count: selected.data.count,
      exactPair,
      branches: kids.map(c => ({
        count: c.data.count,
        color: colorByIso3[c.repIso3] || DIM,
        sample: sampleNames(c, 5),
      })),
    };
  }

  const cutMatchesK =
    Math.abs(cutHeight - (dendro.cut_heights[String(activeK)] ?? -1)) < 1e-6;

  return (
    <div className="hud-panel hud-panel-corner h-full flex flex-col p-3 min-h-0">
      {/* Header row */}
      <div className="hud-header mb-2 flex items-center justify-between">
        <span>AGGLOMERATIVE HIERARCHY · {dendro.linkage.toUpperCase()} LINKAGE · RADIAL</span>
        <span className="text-hud-textDim">[{dendro.leaf_count} LEAVES]</span>
      </div>

      {/* Control strip */}
      <div className="flex items-center gap-3 mb-2 text-xs flex-wrap">
        {/* k selector — drives the global active config */}
        <div className="flex items-center border border-hud-panelEdge">
          <span className="px-2 py-1 text-hud-textDim">k</span>
          {clustersPayload.k_values.map(k => (
            <button
              key={k}
              onClick={() =>
                configControl.setActiveConfigId(configId(clusterConfig.algorithm, k))
              }
              className={`px-2 py-1 border-l border-hud-panelEdge ${
                activeK === k
                  ? "bg-hud-accent/20 text-hud-accent"
                  : "text-hud-textDim hover:text-hud-text"
              }`}
            >{k}</button>
          ))}
        </div>

        {/* Zoom */}
        <div className="flex items-center border border-hud-panelEdge">
          <button
            onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
            className="px-2 py-1 text-hud-textDim hover:text-hud-accent"
            title="Zoom out"
          >−</button>
          <span className="px-2 py-1 text-hud-textDim border-x border-hud-panelEdge tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
            className="px-2 py-1 text-hud-textDim hover:text-hud-accent"
            title="Zoom in"
          >+</button>
          <button
            onClick={() => setZoom(1)}
            className="px-2 py-1 text-hud-textDim hover:text-hud-accent border-l border-hud-panelEdge"
            title="Reset zoom"
          >RESET</button>
        </div>

        {/* Live cluster readout */}
        <div className="text-hud-textDim">
          CUT @ <span className="text-hud-danger">{cutHeight.toFixed(3)}</span>
          {"  →  "}
          <span className="text-hud-accent">{liveClusterCount}</span> clusters
        </div>

        {/* Reset cut to the active k */}
        <button
          onClick={() => setCutHeight(dendro.cut_heights[String(activeK)])}
          className={`px-2 py-1 border ${
            cutMatchesK
              ? "border-hud-panelEdge text-hud-textDim"
              : "border-hud-accent/60 text-hud-accent"
          } hover:text-hud-accent`}
          title="Snap the cut ring back to the active k"
        >
          {cutMatchesK ? `AT k=${activeK}` : `SNAP → k=${activeK}`}
        </button>

        {/* Hover / hint readout */}
        <div className="ml-auto text-hud-textDim">
          {hovered
            ? <span className="text-hud-text">{hovered.iso3} · {hovered.name}</span>
            : <span className="opacity-50">drag the dashed ring to re-cut · click a connection for detail</span>}
        </div>
      </div>

      {/* Canvas + merge-detail side panel. The panel is a flex SIBLING of the
          scroll area (not absolutely positioned inside it), so it stays put
          and never scrolls off with the tree. */}
      <div className="flex-1 flex gap-2 min-h-0">
        <div
          ref={wrapRef}
          className="flex-1 relative border border-hud-panelEdge overflow-auto"
        >
          <svg ref={svgRef} style={{ display: "block", background: "transparent" }} />
        </div>

        {mergeInfo && (
          <div className="w-64 flex-shrink-0 hud-panel border border-hud-accent/50 p-3 text-xs overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="hud-header text-hud-accent">MERGE DETAIL</span>
              <button
                onClick={() => setSelected(null)}
                className="text-hud-textDim hover:text-hud-danger px-1"
                title="Close"
              >✕</button>
            </div>

            <div className="space-y-1 mb-3">
              <div className="flex justify-between">
                <span className="text-hud-textDim">Merge distance</span>
                <span className="text-hud-text tabular-nums">{mergeInfo.distance.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-hud-textDim">≈ Similarity</span>
                <span className="text-hud-accent tabular-nums">{mergeInfo.similarity.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-hud-textDim">Subtree size</span>
                <span className="text-hud-text tabular-nums">{mergeInfo.count} countries</span>
              </div>
              {mergeInfo.exactPair && (
                <div className="flex justify-between pt-1 border-t border-hud-panelEdge mt-1">
                  <span className="text-hud-textDim">Exact pair sim.</span>
                  <span className="text-hud-warn tabular-nums">
                    {(mergeInfo.exactPair.similarity * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>

            <div className="text-hud-textDim mb-1 uppercase tracking-wide" style={{ fontSize: "10px" }}>
              Joins two branches
            </div>
            {mergeInfo.branches.map((b, i) => (
              <div key={i} className="mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: b.color }}
                  />
                  <span className="text-hud-text">
                    {b.count} {b.count === 1 ? "country" : "countries"}
                  </span>
                </div>
                <div className="text-hud-textDim pl-3.5 leading-snug">
                  {b.sample.join(", ")}{b.count > b.sample.length ? " …" : ""}
                </div>
              </div>
            ))}

            <div className="text-hud-textDim mt-2 pt-2 border-t border-hud-panelEdge leading-snug"
                 style={{ fontSize: "10px" }}>
              Merge distance = average-linkage distance over the 1 − TED-similarity
              matrix. Lower = the two branches are more similar. Leaf colors are the
              clusters from the <span className="text-hud-text">agglomerative-{activeK}</span> configuration.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}