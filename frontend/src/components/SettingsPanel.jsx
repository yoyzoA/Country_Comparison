import { configId } from "../lib/clusterConfig";

/**
 * Clustering configuration controls.
 *  - Algorithm toggle (agglomerative / kmedoids)
 *  - k selector (8..18)
 *  - Live evaluation metrics for the active config
 *
 * `configControl` = { clustersPayload, activeConfigId, setActiveConfigId }
 * `clusterConfig` = the resolved active config (has .metrics, .algorithm, .k)
 */
export default function SettingsPanel({ configControl, clusterConfig }) {
  const { clustersPayload, activeConfigId, setActiveConfigId } = configControl;
  const { algorithms, k_values } = clustersPayload;

  const switchTo = (algorithm, k) => {
    const id = configId(algorithm, k);
    if (clustersPayload.configs[id]) setActiveConfigId(id);
  };

  const m = clusterConfig.metrics || {};

  // Helper to format a metric value
  const fmt = (v) => (v === null || v === undefined ? "—" : v.toFixed(3));

  return (
    <div className="border border-hud-panelEdge p-2 mb-3">
      <div className="text-hud-textDim text-xs mb-2">CLUSTERING CONFIG</div>

      {/* Algorithm toggle */}
      <div className="mb-2">
        <div className="text-hud-textDim text-[10px] mb-1">ALGORITHM</div>
        <div className="flex border border-hud-panelEdge text-xs">
          {algorithms.map((alg, idx) => (
            <button
              key={alg}
              onClick={() => switchTo(alg, clusterConfig.k)}
              className={`flex-1 px-2 py-1 ${idx > 0 ? "border-l border-hud-panelEdge" : ""} ${
                clusterConfig.algorithm === alg
                  ? "bg-hud-accent/20 text-hud-accent"
                  : "text-hud-textDim hover:text-hud-text"
              }`}
            >
              {alg === "agglomerative" ? "HIERARCHICAL" : "K-MEDOIDS"}
            </button>
          ))}
        </div>
      </div>

      {/* k selector */}
      <div className="mb-2">
        <div className="text-hud-textDim text-[10px] mb-1">
          CLUSTERS (k) = <span className="text-hud-accent">{clusterConfig.k}</span>
        </div>
        <div className="flex gap-1">
          {k_values.map(k => (
            <button
              key={k}
              onClick={() => switchTo(clusterConfig.algorithm, k)}
              className={`flex-1 py-1 text-xs border ${
                clusterConfig.k === k
                  ? "border-hud-accent text-hud-accent bg-hud-accent/10"
                  : "border-hud-panelEdge text-hud-textDim hover:text-hud-text"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Evaluation metrics */}
      <div>
        <div className="text-hud-textDim text-[10px] mb-1">EVALUATION METRICS</div>
        <div className="space-y-0.5 text-xs">
          <div className="flex justify-between">
            <span className="text-hud-textDim">Silhouette</span>
            <span className="text-hud-text" title="Range [-1,1], higher is better">
              {fmt(m.silhouette)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-hud-textDim">Davies-Bouldin</span>
            <span className="text-hud-text" title="≥0, lower is better">
              {fmt(m.davies_bouldin)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-hud-textDim">Calinski-Harabasz</span>
            <span className="text-hud-text" title="≥0, higher is better">
              {m.calinski_harabasz === null || m.calinski_harabasz === undefined
                ? "—"
                : m.calinski_harabasz.toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}