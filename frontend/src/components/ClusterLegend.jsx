/**
 * Clickable cluster list. Click toggles spotlight (sticky); hover previews it.
 * Filtered by search to only show clusters with at least one matching member.
 *
 * Reads clusters from `clusterConfig.clusters` (the active configuration).
 */
export default function ClusterLegend({ clusterConfig, filters }) {
  const { matchedIso3s, spotlightCluster, setSpotlightCluster, setHoveredCluster } = filters;

  const allClusters = clusterConfig.clusters;

  // Filter clusters: only show ones with at least one country matching the search
  const visibleClusters = matchedIso3s
    ? allClusters.filter(c => c.members.some(iso3 => matchedIso3s.has(iso3)))
    : allClusters;

  const toggle = (id) => {
    setSpotlightCluster(prev => (prev === id ? null : id));
  };

  return (
    <div className="flex-1 overflow-auto min-h-0">
      <div className="flex items-center justify-between mb-1">
        <div className="text-hud-textDim text-xs">CLUSTERS [{visibleClusters.length}]</div>
        {spotlightCluster !== null && (
          <button
            onClick={() => setSpotlightCluster(null)}
            className="text-hud-textDim hover:text-hud-accent text-xs"
          >clear</button>
        )}
      </div>

      {visibleClusters.map(c => {
        const isActive = spotlightCluster === c.id;
        return (
          <div
            key={c.id}
            onClick={() => toggle(c.id)}
            onMouseEnter={() => setHoveredCluster(c.id)}
            onMouseLeave={() => setHoveredCluster(null)}
            className={`flex items-center gap-2 py-1 px-1 cursor-pointer
                        transition-colors
                        ${isActive ? "bg-hud-accent/15" : "hover:bg-hud-grid"}`}
          >
            <div
              className="w-3 h-3 flex-shrink-0"
              style={{
                background: c.color,
                boxShadow: isActive ? `0 0 8px ${c.color}` : `0 0 3px ${c.color}`,
              }}
            />
            <div className={`text-xs truncate flex-1 ${
              isActive ? "text-hud-accent" : "text-hud-text"
            }`}>
              {c.label}
            </div>
            {/* Medoid badge (only present for k-medoids configs) */}
            {c.medoid && (
              <div className="text-hud-textDim text-[10px]" title="cluster medoid">
                ◆{c.medoid}
              </div>
            )}
            <div className="text-hud-textDim text-xs">{c.size}</div>
          </div>
        );
      })}
    </div>
  );
}