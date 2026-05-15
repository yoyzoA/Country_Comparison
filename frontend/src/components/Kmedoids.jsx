import { useMemo, useState } from "react";
import { configId } from "../lib/clusterConfig";

/**
 * K-MEDOIDS tab — visualizes the partitional k-medoids clustering.
 *
 * Unlike agglomerative clustering, k-medoids has no hierarchy/tree. What it
 * DOES produce is a medoid per cluster: a real country that sits at the
 * "center" of the cluster. So the natural visualization is hub-and-spoke —
 * one hub per cluster, the medoid at the center, every other member placed
 * around it at a radius set by how similar it is to the medoid.
 *
 * This tab always shows the k-medoids configuration at the active k
 * (`kmedoids-<k>`), so changing k in CLUSTER CONTROL refreshes it. The
 * algorithm toggle there doesn't change THIS tab — it's the dedicated
 * k-medoids view — but the k selector does.
 *
 * Click a hub to open a roster panel listing every member ranked by
 * similarity to the medoid.
 *
 * Props:
 *   data            — useAppData() bundle (needs data.lookup.pair)
 *   clustersPayload — raw clusters.json (has all pre-trained configs)
 *   clusterConfig   — the resolved active config (we read .k and .metrics)
 */

const DIM = "#5a6878";
const HUB_SIZE = 200;        // px, the square SVG per cluster
const CENTER_R = 7;          // medoid dot radius
const MEMBER_R = 3.5;        // member dot radius
const RING_MIN = 26;         // closest a member sits to the medoid
const RING_MAX = HUB_SIZE / 2 - 16;

/** similarity of a member to its medoid (1.0 for the medoid itself) */
function simToMedoid(pairLookup, medoid, iso3) {
  if (iso3 === medoid) return 1;
  const p = pairLookup(medoid, iso3);
  return p ? p.similarity : 0;
}

/** One cluster hub — medoid at center, members spoked around it. */
function MedoidHub({ cluster, data, onSelect, isSelected }) {
  const [hover, setHover] = useState(null); // { name, iso3, sim, x, y } | null
  const medoid = cluster.medoid;

  // Build placed member points
  const points = useMemo(() => {
    const pairLookup = data.lookup.pair;
    const byIso3 = data.lookup.byIso3;

    const others = cluster.members.filter(iso3 => iso3 !== medoid);
    const sims = others.map(iso3 => ({
      iso3,
      name: byIso3[iso3]?.name || iso3,
      sim: simToMedoid(pairLookup, medoid, iso3),
    }));
    // closest to the medoid first
    sims.sort((a, b) => b.sim - a.sim);

    if (sims.length === 0) return [];

    const minSim = Math.min(...sims.map(s => s.sim));
    const maxSim = Math.max(...sims.map(s => s.sim));
    const span = maxSim - minSim || 1;

    return sims.map((s, i) => {
      // angle: evenly spread around the circle
      const angle = (i / sims.length) * 2 * Math.PI - Math.PI / 2;
      // radius: more similar -> closer to the medoid
      const t = (maxSim - s.sim) / span; // 0 = most similar, 1 = least
      const r = RING_MIN + t * (RING_MAX - RING_MIN);
      return {
        ...s,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
      };
    });
  }, [cluster, data, medoid]);

  const medoidName = data.lookup.byIso3[medoid]?.name || medoid;
  const c = HUB_SIZE / 2;

  return (
    <div
      className={`relative border p-2 cursor-pointer transition-colors ${
        isSelected
          ? "border-hud-accent bg-hud-accent/5"
          : "border-hud-panelEdge hover:border-hud-textDim"
      }`}
      onClick={() => onSelect(cluster.id)}
    >
      {/* Card header */}
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="inline-block w-2.5 h-2.5 flex-shrink-0"
          style={{ background: cluster.color, boxShadow: `0 0 4px ${cluster.color}` }}
        />
        <span className="text-hud-text text-xs truncate flex-1" title={medoidName}>
          {medoidName}
        </span>
        <span className="text-hud-textDim text-[10px]">CL{cluster.id}</span>
      </div>
      <div className="text-hud-textDim text-[10px] mb-1">
        medoid · {cluster.size} {cluster.size === 1 ? "country" : "countries"}
      </div>

      {/* Hub SVG */}
      <svg width="100%" viewBox={`0 0 ${HUB_SIZE} ${HUB_SIZE}`} style={{ display: "block" }}>
        {/* faint guide rings */}
        <circle cx={c} cy={c} r={RING_MAX} fill="none" stroke="#1a2430" strokeWidth="1" />
        <circle cx={c} cy={c} r={(RING_MIN + RING_MAX) / 2} fill="none" stroke="#1a2430" strokeWidth="0.5" />

        {/* spokes */}
        {points.map(p => (
          <line
            key={`l-${p.iso3}`}
            x1={c} y1={c}
            x2={c + p.x} y2={c + p.y}
            stroke={cluster.color}
            strokeOpacity="0.25"
            strokeWidth="1"
          />
        ))}

        {/* member dots */}
        {points.map(p => (
          <circle
            key={`d-${p.iso3}`}
            cx={c + p.x} cy={c + p.y}
            r={hover?.iso3 === p.iso3 ? MEMBER_R + 1.5 : MEMBER_R}
            fill={cluster.color}
            fillOpacity={hover?.iso3 === p.iso3 ? 1 : 0.7}
            stroke="#05080c"
            strokeWidth="0.5"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {/* medoid at the center */}
        <circle cx={c} cy={c} r={CENTER_R + 2} fill="none" stroke={cluster.color} strokeWidth="1.5" />
        <circle
          cx={c} cy={c} r={CENTER_R}
          fill={cluster.color}
          stroke="#05080c" strokeWidth="1"
          style={{ cursor: "pointer" }}
          onMouseEnter={() => setHover({ name: medoidName, iso3: medoid, sim: 1 })}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {/* Tooltip */}
      {hover && (
        <div className="absolute left-2 right-2 bottom-2 bg-black/85 border border-hud-panelEdge px-2 py-1 text-[10px] pointer-events-none">
          <span className="text-hud-text">{hover.iso3} · {hover.name}</span>
          <span className="text-hud-textDim">
            {hover.iso3 === medoid
              ? " — medoid (center)"
              : ` — ${(hover.sim * 100).toFixed(1)}% similar to medoid`}
          </span>
        </div>
      )}
    </div>
  );
}

export default function KMedoids({ data, clustersPayload, clusterConfig, configControl }) {
  const activeK = clusterConfig.k;
  const [selectedCluster, setSelectedCluster] = useState(null);

  // Always the k-medoids config at the active k.
  const kmConfig = useMemo(() => {
    const id = configId("kmedoids", activeK);
    return clustersPayload.configs[id] || null;
  }, [clustersPayload, activeK]);

  // Roster for the selected cluster — members ranked by similarity to medoid
  const roster = useMemo(() => {
    if (selectedCluster === null || !kmConfig) return null;
    const cl = kmConfig.clusters.find(c => c.id === selectedCluster);
    if (!cl) return null;
    const rows = cl.members.map(iso3 => ({
      iso3,
      name: data.lookup.byIso3[iso3]?.name || iso3,
      sim: simToMedoid(data.lookup.pair, cl.medoid, iso3),
      isMedoid: iso3 === cl.medoid,
    }));
    rows.sort((a, b) => b.sim - a.sim);
    return { cluster: cl, rows };
  }, [selectedCluster, kmConfig, data]);

  if (!kmConfig) {
    return (
      <div className="hud-panel hud-panel-corner h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="hud-header mb-2">K-MEDOIDS CONFIG MISSING</div>
        <div className="text-hud-textDim text-xs max-w-md leading-relaxed">
          No <span className="text-hud-danger">kmedoids-{activeK}</span> configuration
          in clusters.json. Re-run the backend bundle:
          <pre className="mt-3 text-left text-[11px] bg-black/40 border border-hud-panelEdge p-2 overflow-x-auto">
python build_frontend_data.py</pre>
        </div>
      </div>
    );
  }

  const m = kmConfig.metrics || {};
  const fmt = (v) => (v === null || v === undefined ? "—" : v.toFixed(3));

  return (
    <div className="hud-panel hud-panel-corner h-full flex flex-col p-3 min-h-0">
      {/* Header row */}
      <div className="hud-header mb-2 flex items-center justify-between">
        <span>K-MEDOIDS · PARTITIONAL · k={activeK}</span>
        <span className="text-hud-textDim">[{kmConfig.n_clusters} MEDOIDS]</span>
      </div>

      {/* Metrics strip */}
      <div className="flex items-center gap-4 mb-2 text-xs flex-wrap border border-hud-panelEdge px-3 py-1.5">
        {/* k selector — drives the global active config */}
        <div className="flex items-center border border-hud-panelEdge">
          <span className="px-2 py-0.5 text-hud-textDim">k</span>
          {clustersPayload.k_values.map(k => (
            <button
              key={k}
              onClick={() =>
                configControl.setActiveConfigId(configId(clusterConfig.algorithm, k))
              }
              className={`px-2 py-0.5 border-l border-hud-panelEdge ${
                activeK === k
                  ? "bg-hud-accent/20 text-hud-accent"
                  : "text-hud-textDim hover:text-hud-text"
              }`}
            >{k}</button>
          ))}
        </div>
        <span className="text-hud-textDim">
          Silhouette <span className="text-hud-text" title="Range [-1,1], higher is better">{fmt(m.silhouette)}</span>
        </span>
        <span className="text-hud-textDim">
          Davies-Bouldin <span className="text-hud-text" title="≥0, lower is better">{fmt(m.davies_bouldin)}</span>
        </span>
        <span className="text-hud-textDim">
          Calinski-Harabasz{" "}
          <span className="text-hud-text" title="≥0, higher is better">
            {m.calinski_harabasz === null || m.calinski_harabasz === undefined
              ? "—"
              : m.calinski_harabasz.toFixed(1)}
          </span>
        </span>
        <span className="ml-auto text-hud-textDim opacity-70">
          each hub: medoid at center · members spoked by similarity · click a hub for the roster
        </span>
      </div>

      {/* Hub grid + roster side panel */}
      <div className="flex-1 flex gap-2 min-h-0">
        <div className="flex-1 overflow-auto border border-hud-panelEdge p-2">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}
          >
            {kmConfig.clusters.map(cl => (
              <MedoidHub
                key={cl.id}
                cluster={cl}
                data={data}
                onSelect={(id) => setSelectedCluster(prev => (prev === id ? null : id))}
                isSelected={selectedCluster === cl.id}
              />
            ))}
          </div>
        </div>

        {roster && (
          <div className="w-64 flex-shrink-0 hud-panel border border-hud-accent/50 p-3 text-xs overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="hud-header text-hud-accent">CLUSTER ROSTER</span>
              <button
                onClick={() => setSelectedCluster(null)}
                className="text-hud-textDim hover:text-hud-danger px-1"
                title="Close"
              >✕</button>
            </div>

            <div className="flex items-center gap-1.5 mb-1">
              <span
                className="inline-block w-2.5 h-2.5"
                style={{ background: roster.cluster.color }}
              />
              <span className="text-hud-text">
                CL{roster.cluster.id} · {roster.cluster.size} countries
              </span>
            </div>
            <div className="text-hud-textDim text-[10px] mb-2">
              ranked by similarity to medoid
            </div>

            <div className="space-y-0.5">
              {roster.rows.map(r => (
                <div
                  key={r.iso3}
                  className={`flex items-center justify-between px-1 py-0.5 ${
                    r.isMedoid ? "bg-hud-accent/10" : ""
                  }`}
                >
                  <span className={r.isMedoid ? "text-hud-accent" : "text-hud-text"}>
                    {r.isMedoid ? "◆ " : ""}{r.name}
                  </span>
                  <span className="text-hud-textDim tabular-nums">
                    {r.isMedoid ? "medoid" : `${(r.sim * 100).toFixed(1)}%`}
                  </span>
                </div>
              ))}
            </div>

            <div className="text-hud-textDim mt-2 pt-2 border-t border-hud-panelEdge leading-snug"
                 style={{ fontSize: "10px" }}>
              The medoid is the real country minimizing total distance to all other
              cluster members — k-medoids' interpretable "center".
            </div>
          </div>
        )}
      </div>
    </div>
  );
}