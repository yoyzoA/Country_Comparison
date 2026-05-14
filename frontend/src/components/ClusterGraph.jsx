import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";

/**
 * Force-directed graph showing cluster relationships for the ACTIVE config.
 * Nodes = clusters, sized by member count, colored by cluster color.
 * Edges = average inter-cluster similarity (only edges above a threshold shown).
 *
 * Re-renders whenever clusterConfig changes (algorithm or k switch).
 */

const EDGE_THRESHOLD = 0.72;
const NODE_MIN_R = 6;
const NODE_MAX_R = 18;


function buildClusterEdges(clusters, pairs, byIso3) {
  // local pair lookup (pairs keyed "A:B" lexicographic)
  const pair = (a, b) => {
    if (a === b) return null;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    return pairs[key] || null;
  };

  const edges = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const ca = clusters[i];
      const cb = clusters[j];
      let sum = 0, n = 0;
      for (const a of ca.members) {
        for (const b of cb.members) {
          const p = pair(a, b);
          if (p) { sum += p.similarity; n++; }
        }
      }
      if (n === 0) continue;
      const mean = sum / n;
      if (mean >= EDGE_THRESHOLD) {
        edges.push({ source: ca.id, target: cb.id, weight: mean });
      }
    }
  }
  return edges;
}


export default function ClusterGraph({ data, clusterConfig, filters }) {
  const svgRef = useRef();
  const { spotlightCluster, setSpotlightCluster, setHoveredCluster, activeSpotlight } = filters;

  // Recompute nodes/edges whenever the active config changes
  const { nodes, links } = useMemo(() => {
    const clusters = clusterConfig.clusters;
    const sizeScale = d3.scaleSqrt()
      .domain([1, d3.max(clusters, c => c.size) || 1])
      .range([NODE_MIN_R, NODE_MAX_R]);

    const nodes = clusters.map(c => ({
      id: c.id,
      label: c.label,
      color: c.color,
      size: c.size,
      r: sizeScale(c.size),
    }));
    const links = buildClusterEdges(clusters, data.pairs, data.lookup.byIso3);
    return { nodes, links };
  }, [clusterConfig, data]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    svg.selectAll("*").remove();

    const linkScale = d3.scaleLinear()
      .domain([EDGE_THRESHOLD, d3.max(links, l => l.weight) || 1])
      .range([0.15, 0.6]);

    const linkSel = svg.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#5a6878")
      .attr("stroke-opacity", d => linkScale(d.weight))
      .attr("stroke-width", 1);

    const nodeSel = svg.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        setSpotlightCluster(prev => (prev === d.id ? null : d.id));
      })
      .on("mouseenter", (event, d) => setHoveredCluster(d.id))
      .on("mouseleave", () => setHoveredCluster(null));

    nodeSel.append("circle")
      .attr("class", "node-circle")
      .attr("r", d => d.r)
      .attr("fill", d => d.color)
      .attr("opacity", 0.85)
      .attr("stroke", d => d.color)
      .attr("stroke-width", 1);

    nodeSel.append("text")
      .text(d => d.size)
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", "#05080c")
      .attr("font-size", 9)
      .attr("font-family", "'JetBrains Mono', monospace")
      .attr("font-weight", "bold")
      .style("pointer-events", "none");

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(50).strength(d => d.weight - 0.5))
      .force("charge", d3.forceManyBody().strength(-80))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(d => d.r + 2));

    sim.on("tick", () => {
      linkSel
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);
      nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    return () => sim.stop();
  }, [nodes, links, setSpotlightCluster, setHoveredCluster]);

  // Reactive highlight on spotlight change
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll(".node-circle")
      .transition().duration(150)
      .attr("opacity", d => {
        if (activeSpotlight === null) return 0.85;
        return d.id === activeSpotlight ? 1.0 : 0.2;
      })
      .attr("stroke-width", d => (d.id === activeSpotlight ? 2 : 1));
    svg.selectAll(".links line")
      .transition().duration(150)
      .attr("stroke-opacity", function(d) {
        const baseOpacity = +d3.select(this).attr("stroke-opacity") || 0.3;
        if (activeSpotlight === null) return Math.max(0.15, baseOpacity);
        const involved = d.source.id === activeSpotlight || d.target.id === activeSpotlight;
        return involved ? 0.7 : 0.05;
      });
  }, [activeSpotlight]);

  return (
    <div className="border border-hud-panelEdge p-1">
      <div className="text-hud-textDim text-xs mb-1 px-1">CLUSTER NETWORK</div>
      <svg
        ref={svgRef}
        className="w-full"
        style={{ height: "180px", background: "transparent" }}
      />
    </div>
  );
}