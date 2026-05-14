import { useEffect, useState } from "react";

/**
 * Load all three static JSON files in parallel.
 *
 * Returns:
 *   { status, error, countries, clusters, pairs, dendrogram, lookup }
 *
 *   status   = 'loading' | 'ready' | 'error'
 *   countries = array of country objects (iso3, name, cluster, probability, tree)
 *   clusters  = array of cluster objects (id, color, size, label, members)
 *   pairs     = the raw pairs lookup object, keyed "ISO3_A:ISO3_B" with A < B
 *   dendrogram = nested hierarchy tree from export_dendrogram.py (or null)
 *   lookup    = helper { byIso3, clusterById, pair(a, b) }
 */
export function useAppData() {
  const [state, setState] = useState({
    status: "loading",
    error: null,
    countries: null,
    clusters: null,
    pairs: null,
    lookup: null,
  });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/data/countries.json").then(r => r.json()),
      fetch("/data/clusters.json").then(r => r.json()),
      fetch("/data/pairs.json").then(r => r.json()),
      fetch("/data/country_centroids.json").then(r => r.json()),
      // dendrogram.json is optional — tolerate its absence so the app
      // still boots if export_dendrogram.py hasn't been run yet.
      fetch("/data/dendrogram.json").then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([countries, clusters, pairs, centroids, dendrogram]) => {
        if (cancelled) return;

        // Build lookups for fast access
        const byIso3 = Object.fromEntries(countries.map(c => [c.iso3, c]));
        const clusterById = Object.fromEntries(clusters.map(c => [c.id, c]));

        const pair = (a, b) => {
          if (a === b) return null;
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          return pairs[key] || null;
        };

        // Attach centroids onto the country objects for convenience
        countries.forEach(c => {
          const ll = centroids[c.iso3];
          c.lat = ll ? ll[0] : null;
          c.lng = ll ? ll[1] : null;
        });

        setState({
          status: "ready",
          error: null,
          countries,
          clusters,
          pairs,
          centroids,
          dendrogram,
          lookup: { byIso3, clusterById, pair },
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