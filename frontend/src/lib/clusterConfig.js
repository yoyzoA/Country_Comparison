/**
 * Helpers for working with the multi-configuration clusters.json.
 *
 * clusters.json shape:
 *   {
 *     default: "agglomerative-14",
 *     k_values: [8, 10, 12, 14, 16, 18],
 *     algorithms: ["agglomerative", "kmedoids"],
 *     configs: {
 *       "agglomerative-14": {
 *         algorithm, k, linkage, n_clusters,
 *         clusters: [ {id, color, size, label, members, medoid}, ... ],
 *         assignment: { ISO3: {cluster, probability}, ... },
 *         metrics: { silhouette, davies_bouldin, calinski_harabasz }
 *       },
 *       ...
 *     }
 *   }
 */

/** Build a config id string from algorithm + k. */
export function configId(algorithm, k) {
  return `${algorithm}-${k}`;
}

/**
 * Given the raw clusters.json payload and an active config id, return a
 * convenient bundle the rest of the app uses:
 *   {
 *     id,                       active config id
 *     algorithm, k, linkage,
 *     clusters,                 array of cluster objects
 *     clusterById,              { clusterId: clusterObject }
 *     assignmentByIso3,         { ISO3: {cluster, probability} }
 *     metrics,
 *   }
 */
export function resolveConfig(clustersPayload, activeId) {
  const cfg = clustersPayload.configs[activeId];
  if (!cfg) {
    throw new Error(`Cluster config "${activeId}" not found`);
  }
  const clusterById = Object.fromEntries(cfg.clusters.map(c => [c.id, c]));
  return {
    id: activeId,
    algorithm: cfg.algorithm,
    k: cfg.k,
    linkage: cfg.linkage,
    n_clusters: cfg.n_clusters,
    clusters: cfg.clusters,
    clusterById,
    assignmentByIso3: cfg.assignment,
    metrics: cfg.metrics,
  };
}

/** Get a country's cluster id under the active config (or null). */
export function clusterOf(resolvedConfig, iso3) {
  const a = resolvedConfig.assignmentByIso3[iso3];
  return a ? a.cluster : null;
}

/** Get a country's membership probability under the active config (or null). */
export function probabilityOf(resolvedConfig, iso3) {
  const a = resolvedConfig.assignmentByIso3[iso3];
  return a ? a.probability : null;
}