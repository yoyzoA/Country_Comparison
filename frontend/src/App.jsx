import { useState, useCallback, useMemo } from "react";
import { useAppData } from "./hooks/useAppData";
import LeftPanel from "./components/LeftPanel";
import CenterPanel from "./components/CenterPanel";
import RightPanel from "./components/RightPanel";
import Dendrogram from "./components/Dendrogram";

export default function App() {
  const data = useAppData();
  const [mode, setMode] = useState("cluster");
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);
  const [nextSlot, setNextSlot] = useState("A");

  // Search & spotlight state
  const [search, setSearch] = useState("");
  const [spotlightCluster, setSpotlightCluster] = useState(null);  // cluster id | null
  const [hoveredCluster, setHoveredCluster] = useState(null);      // transient preview

  const onCountryClick = useCallback((iso3) => {
    if (iso3 === selectedA) {
      setSelectedA(null); setNextSlot("A"); return;
    }
    if (iso3 === selectedB) {
      setSelectedB(null); setNextSlot("B"); return;
    }
    if (nextSlot === "A") {
      setSelectedA(iso3); setNextSlot("B");
    } else {
      setSelectedB(iso3); setNextSlot("A");
    }
  }, [selectedA, selectedB, nextSlot]);

  // Direct slot setters (for the search picker; bypasses cycle behavior)
  const onPickA = useCallback((iso3) => {
    setSelectedA(iso3);
    setNextSlot("B");
  }, []);
  const onPickB = useCallback((iso3) => {
    setSelectedB(iso3);
    setNextSlot("A");
  }, []);
  const onClearA = useCallback(() => { setSelectedA(null); setNextSlot("A"); }, []);
  const onClearB = useCallback(() => { setSelectedB(null); setNextSlot("B"); }, []);

  // Compute the "active spotlight" — sticky takes precedence, hover otherwise
  const activeSpotlight = spotlightCluster !== null ? spotlightCluster : hoveredCluster;

  // Filter results: which iso3s match the search? Empty search = all.
  const matchedIso3s = useMemo(() => {
    if (data.status !== "ready") return null;
    const term = search.trim().toLowerCase();
    if (!term) return null;  // null = no filter active
    const matches = new Set();
    for (const c of data.countries) {
      if (
        c.name.toLowerCase().includes(term) ||
        c.iso3.toLowerCase().includes(term)
      ) {
        matches.add(c.iso3);
      }
    }
    return matches;
  }, [search, data]);

  if (data.status === "loading") {
    return (
      <div className="h-screen w-screen hud-grid flex items-center justify-center">
        <div className="text-hud-accent">LOADING DATA...</div>
      </div>
    );
  }
  if (data.status === "error") {
    return (
      <div className="h-screen w-screen hud-grid flex items-center justify-center">
        <div className="text-hud-danger">ERROR: {data.error}</div>
      </div>
    );
  }

  const selection = {
    selectedA, selectedB, onCountryClick,
    onPickA, onPickB, onClearA, onClearB,
  };
  const filters = {
    search,
    setSearch,
    matchedIso3s,
    spotlightCluster,
    setSpotlightCluster,
    hoveredCluster,
    setHoveredCluster,
    activeSpotlight,
  };

  return (
    <div className="h-screen w-screen hud-grid flex flex-col">
      <header className="border-b border-hud-panelEdge px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-hud-accent font-bold tracking-widest">
            ◆ COUNTRY-COMPARE
          </div>
          <div className="text-hud-textDim text-xs">
            v0.1 · {data.countries.length} sovereign states · {data.clusters.length} clusters
          </div>
        </div>

        <div className="flex border border-hud-panelEdge text-xs">
          {[
            { id: "cluster", label: "CLUSTER VIEW" },
            { id: "compare", label: "COMPARE MODE" },
            { id: "dendrogram", label: "DENDROGRAM" },
            { id: "kmedoids", label: "K-MEDOIDS" },
          ].map((tab, i) => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              className={`px-3 py-1 ${i > 0 ? "border-l border-hud-panelEdge" : ""} ${
                mode === tab.id
                  ? "bg-hud-accent/20 text-hud-accent"
                  : "text-hud-textDim hover:text-hud-text"
              }`}
            >{tab.label}</button>
          ))}
        </div>

        <div className="text-hud-textDim text-xs">
          MODE: <span className="text-hud-accent">{mode.toUpperCase()}</span>
        </div>
      </header>

      {mode === "dendrogram" ? (
        <main className="flex-1 p-2 overflow-hidden">
          <Dendrogram data={data} />
        </main>
      ) : mode === "kmedoids" ? (
        <main className="flex-1 p-2 overflow-hidden">
          <div className="hud-panel hud-panel-corner h-full flex flex-col items-center justify-center p-6 text-center">
            <div className="hud-header mb-2">K-MEDOIDS · CLUSTERING</div>
            <div className="text-hud-textDim text-xs max-w-md leading-relaxed">
              Second clustering algorithm — <span className="text-hud-text">in progress</span>.
              <br />This panel is reserved for the k-medoids results and visualization.
            </div>
          </div>
        </main>
      ) : (
        <main className="flex-1 grid grid-cols-[280px_1fr_340px] gap-2 p-2 overflow-hidden">
          <LeftPanel data={data} filters={filters} selection={selection} />
          <CenterPanel data={data} mode={mode} selection={selection} filters={filters} />
          <RightPanel data={data} mode={mode} selection={selection} />
        </main>
      )}
    </div>
  );
}