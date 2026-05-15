import { useState, useCallback, useMemo } from "react";
import { useAppData } from "./hooks/useAppData";
import { resolveConfig } from "./lib/clusterConfig";
import LeftPanel from "./components/LeftPanel";
import CenterPanel from "./components/CenterPanel";
import RightPanel from "./components/RightPanel";
import Dendrogram from "./components/Dendrogram";
import KMedoids from "./components/KMedoids";
import BootScreen from "./components/BootScreen";

export default function App() {
  const data = useAppData();
  const [mode, setMode] = useState("cluster");
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);
  const [nextSlot, setNextSlot] = useState("A");

  // Search & spotlight state
  const [search, setSearch] = useState("");
  const [spotlightCluster, setSpotlightCluster] = useState(null);
  const [hoveredCluster, setHoveredCluster] = useState(null);

  // Active cluster configuration ("algorithm-k"). Starts as the file's default.
  const [activeConfigId, setActiveConfigId] = useState(null);

  // ── selection handlers ──
  const onCountryClick = useCallback((iso3) => {
    if (iso3 === selectedA) { setSelectedA(null); setNextSlot("A"); return; }
    if (iso3 === selectedB) { setSelectedB(null); setNextSlot("B"); return; }
    if (nextSlot === "A") { setSelectedA(iso3); setNextSlot("B"); }
    else { setSelectedB(iso3); setNextSlot("A"); }
  }, [selectedA, selectedB, nextSlot]);

  const onPickA = useCallback((iso3) => { setSelectedA(iso3); setNextSlot("B"); }, []);
  const onPickB = useCallback((iso3) => { setSelectedB(iso3); setNextSlot("A"); }, []);
  const onClearA = useCallback(() => { setSelectedA(null); setNextSlot("A"); }, []);
  const onClearB = useCallback(() => { setSelectedB(null); setNextSlot("B"); }, []);

  const activeSpotlight = spotlightCluster !== null ? spotlightCluster : hoveredCluster;

  // Resolve the active cluster configuration into a convenient bundle.
  // Falls back to the file's declared default until the user picks one.
  const clusterConfig = useMemo(() => {
    if (data.status !== "ready") return null;
    const id = activeConfigId || data.clustersPayload.default;
    return resolveConfig(data.clustersPayload, id);
  }, [data, activeConfigId]);

  // Search matching
  const matchedIso3s = useMemo(() => {
    if (data.status !== "ready") return null;
    const term = search.trim().toLowerCase();
    if (!term) return null;
    const matches = new Set();
    for (const c of data.countries) {
      if (c.name.toLowerCase().includes(term) || c.iso3.toLowerCase().includes(term)) {
        matches.add(c.iso3);
      }
    }
    return matches;
  }, [search, data]);

  if (data.status === "loading") {
    return <BootScreen />;
  }
  if (data.status === "error") {
    return (
      <div className="h-screen w-screen hud-grid flex items-center justify-center">
        <div className="hud-panel hud-panel-corner p-6 max-w-md">
          <div className="hud-header mb-2 text-hud-danger">SYSTEM FAULT</div>
          <div className="flex items-start gap-3">
            <div className="text-hud-danger text-3xl leading-none">!</div>
            <div>
              <div className="text-hud-text text-sm mb-2">Failed to load data.</div>
              <div className="border border-hud-panelEdge p-2 text-hud-textDim text-xs font-mono mb-2">
                {data.error}
              </div>
              <div className="text-hud-textDim text-xs">
                Try rebuilding: <span className="text-hud-accent">python run_pipeline.py</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const selection = {
    selectedA, selectedB, onCountryClick,
    onPickA, onPickB, onClearA, onClearB,
  };
  const filters = {
    search, setSearch, matchedIso3s,
    spotlightCluster, setSpotlightCluster,
    hoveredCluster, setHoveredCluster,
    activeSpotlight,
  };
  const configControl = {
    clustersPayload: data.clustersPayload,
    activeConfigId: clusterConfig.id,
    setActiveConfigId,
  };

  return (
    <div className="h-screen w-screen hud-grid flex flex-col">
      <header className="border-b border-hud-panelEdge px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-hud-accent font-bold tracking-widest">
            ◆ COUNTRY-COMPARE
          </div>
          <div className="text-hud-textDim text-xs">
            v0.2 · {data.countries.length} sovereign states ·
            {" "}{clusterConfig.algorithm} k={clusterConfig.k}
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
          <Dendrogram
            data={data}
            clustersPayload={data.clustersPayload}
            clusterConfig={clusterConfig}
            configControl={configControl}
          />
        </main>
      ) : mode === "kmedoids" ? (
        <main className="flex-1 p-2 overflow-hidden">
          <KMedoids
            data={data}
            clustersPayload={data.clustersPayload}
            clusterConfig={clusterConfig}
            configControl={configControl}
          />
        </main>
      ) : (
        <main className="flex-1 grid grid-cols-[280px_1fr_340px] gap-2 p-2 overflow-hidden">
          <LeftPanel
            data={data}
            filters={filters}
            selection={selection}
            clusterConfig={clusterConfig}
            configControl={configControl}
          />
          <CenterPanel
            data={data}
            mode={mode}
            selection={selection}
            filters={filters}
            clusterConfig={clusterConfig}
          />
          <RightPanel
            data={data}
            mode={mode}
            selection={selection}
            clusterConfig={clusterConfig}
          />
        </main>
      )}
    </div>
  );
}