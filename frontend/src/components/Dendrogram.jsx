import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

/**
 * Dendrogram tab — radial visualization of the agglomerative hierarchy that
 * produced the flat k=14 clusters.
 *
 * Features:
 *   - Zoom in/out (the SVG grows and the panel scrolls).
 *   - A draggable CUT RING: drag it in/out to slice the hierarchy at any
 *     height; the live readout shows how many clusters fall out. Starts at
 *     `cut_height` (the k=14 cut).
 *   - Click any CONNECTION to open a MERGE DETAIL side panel: merge distance,
 *     implied similarity (1 - distance), and the two branches being joined.
 *
 * Architecture note — the drawing is split into TWO effects on purpose:
 *   1. structural draw  (deps: root, size, zoom) — builds the whole SVG once
 *      per layout change.
 *   2. cut/selection overlay (deps: cutHeight, selected, ...) — only repaints
 *      link colors + repositions the cut ring.
 * This is what makes dragging the cut ring smooth: moving it calls
 * setCutHeight, which re-runs ONLY effect 2 — the SVG is never wiped
 * mid-gesture, so the drag behaviour stays attached. (The old single-effect
 * version wiped + rebuilt the SVG on every drag tick, which detached the
 * gesture — that was the "snaps back and won't move" bug.)
 *
 * Data comes from data.dendrogram (loaded by useAppData from
 * /data/dendrogram.json, produced by export_dendrogram.py).
 */

const ACCENT = "#00ff88";
const DIM = "#5a6878";
const DANGER = "#ff3860";

// Count how many clusters a cut at `height` produces: every link the cut
// crosses (parent above, child below) is one cluster.
function clustersAtHeight(root, height) {
  let count = 0;
  root.each(d => {
    const parentH = d.parent ? d.parent.data.height : Infinity;
    if (d.data.height <= height && parentH > height) count++;
  });
  return count;
}

// Color for the link from d up to its parent: colored if the whole link sits
// below the cut (inside a single k-cut cluster), dimmed otherwise.
function strokeFor(d, cutHeight) {
  const parentH = d.parent ? d.parent.data.height : Infinity;
  if (parentH <= cutHeight) return d.data.color || DIM;
  return DIM;
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

export default function Dendrogram({ data }) {
  const dendro = data.dendrogram;
  const svgRef = useRef();
  const wrapRef = useRef();
  // geomRef carries the scale + radius from the structural effect to the
  // overlay effect so the latter can position the cut ring without a redraw.
  const geomRef = useRef(null);

  const [cutHeight, setCutHeight] = useState(dendro ? dendro.cut_height : 0);
  const [hovered, setHovered] = useState(null);   // { name, iso3 } | null
  const [selected, setSelected] = useState(null); // d3 node (a merge) | null
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ w: 800, h: 600 });

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
    return d3.hierarchy(dendro.tree);
  }, [dendro]);

  const liveClusterCount = useMemo(
    () => (root ? clustersAtHeight(root, cutHeight) : 0),
    [root, cutHeight]
  );

  // ── EFFECT 1 — structural draw. Deps: root, size, zoom (NOT cutHeight,
  //    NOT selected). Builds the entire SVG. ───────────────────────────────
  useEffect(() => {
    if (!root || !svgRef.current) return;
    const { w, h } = size;
    const maxH = dendro.max_height;

    // SVG grows with zoom; the wrapper scrolls.
    const svgW = w * zoom;
    const svgH = h * zoom;
    const cx = svgW / 2;
    const cy = svgH / 2;

    // Geometry in pre-scale (local) coords. The g group is scaled by `zoom`,
    // so we draw at base size and let the transform enlarge it.
    const radius = Math.min(w, h) / 2;
    const inner = radius - 95; // room for labels
    const x = d3.scaleLinear().domain([0, maxH]).range([inner, 0]);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", svgW).attr("height", svgH);

    const g = svg.append("g")
      .attr("transform", `translate(${cx},${cy}) scale(${zoom})`);

    // Lay the tree out radially
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

    // Visible links (colored later by effect 2)
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
      .attr("r", 2.2)
      .attr("fill", d => d.data.color || DIM);

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

    // Cut ring group — created ONCE here, positioned by effect 2.
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

    // Drag — container is g.node(), so event.x/event.y are in g's LOCAL
    // (pre-scale) coords with the origin at the center. r = hypot(x,y) is then
    // the cut radius directly. Setting .container() explicitly is the actual
    // fix for the snap-to-zero bug: without it, event coords were measured
    // from the SVG's top-left corner, so r was huge and the cut jumped to 0
    // (= maximum clusters) on the first pointer tick.
    cutG.call(
      d3.drag()
        .container(g.node())
        .on("drag", (event) => {
          const r = Math.sqrt(event.x * event.x + event.y * event.y);
          const clamped = Math.max(0, Math.min(inner, r));
          setCutHeight(Math.max(0, Math.min(maxH, x.invert(clamped))));
        })
    );

    // Hand geometry to effect 2
    geomRef.current = { x, inner };
  }, [root, size, zoom, dendro]);

  // ── EFFECT 2 — cut + selection overlay. Deps include cutHeight & selected,
  //    plus the structural deps so it re-applies after a rebuild. Repaints
  //    link colors and repositions the cut ring WITHOUT touching structure. ─
  useEffect(() => {
    if (!svgRef.current || !geomRef.current) return;
    const { x } = geomRef.current;
    const svg = d3.select(svgRef.current);

    // Link colors (+ selected highlight)
    svg.selectAll(".dendro-link").each(function (d) {
      const isSel = selected && d.source === selected;
      const base = strokeFor(d.target, cutHeight);
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
  }, [cutHeight, selected, root, size, zoom]);

  // ── Empty state — dendrogram.json not generated yet ─────────────────────
  if (!dendro) {
    return (
      <div className="hud-panel hud-panel-corner h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="hud-header mb-2">HIERARCHY UNAVAILABLE</div>
        <div className="text-hud-textDim text-xs max-w-md leading-relaxed">
          <span className="text-hud-danger">dendrogram.json</span> not found.
          Run the export step on the backend:
          <pre className="mt-3 text-left text-[11px] bg-black/40 border border-hud-panelEdge p-2 overflow-x-auto">
python cluster.py          # writes data/linkage.npz{"\n"}
python export_dendrogram.py  # writes frontend/public/data/dendrogram.json</pre>
        </div>
      </div>
    );
  }

  // Derived values for the merge info panel
  const mergeInfo = selected
    ? {
        distance: selected.data.height,
        similarity: 1 - selected.data.height,
        count: selected.data.count,
        branches: (selected.children || []).map(c => ({
          count: c.data.count,
          color: c.data.color || DIM,
          sample: sampleNames(c, 5),
        })),
      }
    : null;

  return (
    <div className="hud-panel hud-panel-corner h-full flex flex-col p-3 min-h-0">
      {/* Header row */}
      <div className="hud-header mb-2 flex items-center justify-between">
        <span>AGGLOMERATIVE HIERARCHY · {dendro.linkage.toUpperCase()} LINKAGE · RADIAL</span>
        <span className="text-hud-textDim">[{dendro.leaf_count} LEAVES]</span>
      </div>

      {/* Control strip */}
      <div className="flex items-center gap-3 mb-2 text-xs flex-wrap">
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

        {/* Reset cut */}
        <button
          onClick={() => setCutHeight(dendro.cut_height)}
          className="px-2 py-1 border border-hud-panelEdge text-hud-textDim hover:text-hud-accent"
        >
          RESET → k={dendro.n_clusters}
        </button>

        {/* Hover / hint readout */}
        <div className="ml-auto text-hud-textDim">
          {hovered
            ? <span className="text-hud-text">{hovered.iso3} · {hovered.name}</span>
            : <span className="opacity-50">drag the dashed ring to re-cut · click a connection for detail</span>}
        </div>
      </div>

      {/* Canvas + merge-detail side panel.
          The panel is a flex SIBLING of the scroll area (not absolutely
          positioned inside it), so it stays put and never scrolls off with
          the tree. */}
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
              Distance = average linkage over the 1 − TED-similarity matrix.
              Lower distance = the two branches are more similar.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}