import { useEffect, useState } from "react";

/**
 * Load the static JSON files the app needs, in parallel.
 *
 * Returns:
 *   { status, error, countries, clustersPayload, pairs, centroids, dendrogram, lookup }
 *
 *   status          = 'loading' | 'ready' | 'error'
 *   countries       = array of country objects (iso3, name, tree, lat, lng)
 *   clustersPayload = the raw multi-config clusters.json
 *                     { default, k_values, algorithms, configs }
 *   pairs           = raw pairs lookup, keyed "ISO3_A:ISO3_B" with A < B
 *   centroids       = { ISO3: [lat, lng] }
 *   dendrogram      = the agglomerative hierarchy tree from dendrogram.json,
 *                     or null if the file hasn't been generated yet
 *                     (run export_dendrogram.py). Optional so the app still
 *                     boots without it.
 *   lookup          = { byIso3, pair }
 *
 * Note: cluster assignment is NOT baked into countries — it depends on the
 * active configuration, which App.jsx tracks. Components resolve cluster info
 * via lib/clusterConfig.js using the active config.
 */
export function useAppData() {
  const [state, setState] = useState({
    status: "loading",
    error: null,
    countries: null,
    clustersPayload: null,
    pairs: null,
    centroids: null,
    dendrogram: null,
    lookup: null,
  });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/data/countries.json").then(r => r.json()),
      fetch("/data/clusters.json").then(r => r.json()),
      fetch("/data/pairs.json").then(r => r.json()),
      fetch("/data/country_centroids.json").then(r => r.json()),
      // dendrogram.json is optional — tolerate its absence so the app still
      // boots if export_dendrogram.py hasn't been run yet.
      fetch("/data/dendrogram.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([countries, clustersPayload, pairs, centroids, dendrogram]) => {
        if (cancelled) return;

        const byIso3 = Object.fromEntries(countries.map(c => [c.iso3, c]));

        const pair = (a, b) => {
          if (a === b) return null;
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          return pairs[key] || null;
        };

        // Attach centroids onto country objects
        countries.forEach(c => {
          const ll = centroids[c.iso3];
          c.lat = ll ? ll[0] : null;
          c.lng = ll ? ll[1] : null;
        });

        setState({
          status: "ready",
          error: null,
          countries,
          clustersPayload,
          pairs,
          centroids,
          dendrogram,
          lookup: { byIso3, pair },
        });
      })
      .catch(err => {
        if (cancelled) return;
        setState(s => ({ ...s, status: "error", error: err.message }));
      });

    return () => { cancelled = true; };
  }, []);

  return state;
}