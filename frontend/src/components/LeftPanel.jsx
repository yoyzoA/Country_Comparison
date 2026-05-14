import SearchFilter from "./SearchFilter";
import SettingsPanel from "./SettingsPanel";
import ClusterLegend from "./ClusterLegend";
import ClusterGraph from "./ClusterGraph";

export default function LeftPanel({ data, filters, clusterConfig, configControl }) {
  return (
    <div className="hud-panel hud-panel-corner h-full flex flex-col p-3 min-h-0">
      <div className="hud-header mb-2">CLUSTER CONTROL</div>

      <SearchFilter filters={filters} totalCount={data.countries.length} />

      <SettingsPanel configControl={configControl} clusterConfig={clusterConfig} />

      <ClusterLegend clusterConfig={clusterConfig} filters={filters} />

      <div className="mt-3 flex-shrink-0">
        <ClusterGraph data={data} clusterConfig={clusterConfig} filters={filters} />
      </div>
    </div>
  );
}