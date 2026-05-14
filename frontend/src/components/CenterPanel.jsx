import Globe from "./Globe";

export default function CenterPanel({ data, mode, selection, filters, clusterConfig }) {
  return (
    <div className="hud-panel hud-panel-corner h-full flex flex-col p-3 relative">
      <div className="hud-header mb-2 flex items-center justify-between">
        <span>GLOBAL VIEW</span>
        <span className="text-hud-textDim">
          [{data.countries.length} STATES]
        </span>
      </div>

      <div className="flex-1 relative">
        <Globe
          data={data}
          mode={mode}
          selection={selection}
          filters={filters}
          clusterConfig={clusterConfig}
        />
      </div>
    </div>
  );
}