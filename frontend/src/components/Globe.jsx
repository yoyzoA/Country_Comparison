import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Globe — Step 4: hover + click-to-select + connection line.
 *
 * Selection visuals:
 *   - Selected A → cyan persistent ring + larger dot
 *   - Selected B → amber persistent ring + larger dot
 *   - Both → an arc/line is drawn between them in compare mode
 *
 * Click rules (handled at App level):
 *   - Click dot → cycles A/B fill
 *   - Click selected dot → deselects
 *   - Click globe surface (not dot) → clears both
 */

const SPHERE_RADIUS = 1.5;
const SPHERE_SEGMENTS = 48;
const ROTATION_SPEED = 0.05;
const DOT_RADIUS = 0.028;
const DOT_OFFSET = 1.015;
const HOVER_SCALE = 1.8;
const SELECTED_SCALE = 2.0;
const HIT_RADIUS = 0.04;
const EARTH_TEXTURE_URL = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const COLOR_SELECT_A = "#00ffd1";   // cyan
const COLOR_SELECT_B = "#ff8c42";   // amber
const ARC_COLOR = "#ffffff";
const ARC_SEGMENTS = 64;            // smoothness of the connection arc


function latLngToVec3(lat, lng, radius = SPHERE_RADIUS) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

/** Build a curved arc between two surface points by lerping + lifting upward.
 *  Returns an array of THREE.Vector3 points. */
function buildArcPoints(a, b, segments = ARC_SEGMENTS, lift = 0.4) {
  const pts = [];
  const aN = a.clone().normalize();
  const bN = b.clone().normalize();
  const angle = Math.acos(THREE.MathUtils.clamp(aN.dot(bN), -1, 1));
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // SLERP-style interpolation along the great circle
    const sinAngle = Math.sin(angle);
    let p;
    if (sinAngle > 1e-6) {
      const w0 = Math.sin((1 - t) * angle) / sinAngle;
      const w1 = Math.sin(t * angle) / sinAngle;
      p = aN.clone().multiplyScalar(w0).add(bN.clone().multiplyScalar(w1));
    } else {
      p = aN.clone().lerp(bN, t);
    }
    // Lift the midpoint outward off the sphere for a nicer arc
    const radius = SPHERE_RADIUS * (1 + lift * Math.sin(Math.PI * t));
    p.multiplyScalar(radius);
    pts.push(p);
  }
  return pts;
}


function EarthSurface() {
  // Loads the texture once (suspends until ready)
  const texture = useLoader(THREE.TextureLoader, EARTH_TEXTURE_URL);
  return (
    <mesh>
      <sphereGeometry args={[SPHERE_RADIUS * 0.998, SPHERE_SEGMENTS, SPHERE_SEGMENTS]} />
      <meshStandardMaterial
        map={texture}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}


function WireframeEarth({ children, paused }) {
  const groupRef = useRef();
  useFrame((_, delta) => {
    if (groupRef.current && !paused) {
      groupRef.current.rotation.y += delta * ROTATION_SPEED;
    }
  });
  return (
    <group ref={groupRef}>
      {/* Real Earth texture */}
      <EarthSurface />

      {/* Cyan wireframe on top — HUD overlay */}
      <mesh>
        <sphereGeometry args={[SPHERE_RADIUS, SPHERE_SEGMENTS, SPHERE_SEGMENTS]} />
        <meshBasicMaterial
          color="#00ffd1"
          wireframe
          transparent
          opacity={0.12}
          depthWrite={false}
        />
      </mesh>

      {children}
    </group>
  );
}


function HoverTooltip({ country, cluster }) {
  if (!country) return null;
  return (
    <Html
      position={[0, 0.05, 0]}
      center
      distanceFactor={3}
      zIndexRange={[100, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div className="hud-panel px-2 py-1 text-xs whitespace-nowrap" style={{ minWidth: "120px" }}>
        <div className="flex items-center gap-2 mb-1">
          {cluster && (
            <div className="w-2 h-2 flex-shrink-0"
                 style={{ background: cluster.color, boxShadow: `0 0 4px ${cluster.color}` }} />
          )}
          <div className="text-hud-accent font-bold tracking-wide">{country.name}</div>
          <div className="text-hud-textDim">[{country.iso3}]</div>
        </div>
        {cluster && (
          <div className="text-hud-textDim" style={{ fontSize: "10px" }}>
            CLUSTER {cluster.id} · {cluster.size} states
          </div>
        )}
      </div>
    </Html>
  );
}


function CountryDot({
  iso3, position, color, hovered, selectedAs, dimmed,
  country, cluster, onHover, onUnhover, onClick,
}) {
  const dotRef = useRef();
  const ringRef = useRef();
  const selectionRingRef = useRef();
  const matRef = useRef();

  const isSelected = selectedAs !== null;
  const selectionColor = selectedAs === "A" ? COLOR_SELECT_A
                       : selectedAs === "B" ? COLOR_SELECT_B
                       : null;

  useFrame(({ clock }) => {
    if (!dotRef.current) return;
    const t = clock.getElapsedTime();

    let scale = 1;
    if (isSelected) {
      scale = SELECTED_SCALE * (1 + 0.08 * Math.sin(t * 4));
    } else if (hovered) {
      scale = HOVER_SCALE * (1 + 0.15 * Math.sin(t * 6));
    } else if (dimmed) {
      scale = 0.7;
    }
    // Spotlit and unhighlighted dots both stay at scale 1.0 — no special boost.
    dotRef.current.scale.setScalar(scale);

    if (matRef.current) {
      const targetOpacity = isSelected || hovered ? 1.0 : (dimmed ? 0.4 : 1.0);
      matRef.current.opacity = targetOpacity;
      matRef.current.transparent = targetOpacity < 1.0;
    }

    if (hovered && ringRef.current) {
      ringRef.current.scale.setScalar(1.5 + 0.3 * Math.sin(t * 6));
      ringRef.current.material.opacity = 0.4 + 0.2 * Math.sin(t * 6);
    }
    if (isSelected && selectionRingRef.current) {
      selectionRingRef.current.scale.setScalar(2.0 + 0.2 * Math.sin(t * 3));
      selectionRingRef.current.material.opacity = 0.7 + 0.2 * Math.sin(t * 3);
    }
  });

  return (
    <group position={position}>
      <mesh ref={dotRef}>
        <sphereGeometry args={[DOT_RADIUS, 12, 12]} />
        <meshBasicMaterial ref={matRef} color={color} />
      </mesh>

      {hovered && !isSelected && (
        <mesh ref={ringRef}>
          <ringGeometry args={[DOT_RADIUS * 2, DOT_RADIUS * 2.5, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

      {isSelected && (
        <mesh ref={selectionRingRef}>
          <ringGeometry args={[DOT_RADIUS * 2.2, DOT_RADIUS * 3.0, 32]} />
          <meshBasicMaterial color={selectionColor} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
      )}

      {hovered && <HoverTooltip country={country} cluster={cluster} />}

      <mesh
        onPointerOver={(e) => { e.stopPropagation(); onHover(iso3); }}
        onPointerOut={(e) => { e.stopPropagation(); onUnhover(iso3); }}
        onClick={(e) => { e.stopPropagation(); onClick(iso3); }}
      >
        <sphereGeometry args={[HIT_RADIUS, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}


function CountryDots({
  countries, clusterConfig, hovered, selectedA, selectedB,
  matchedIso3s, activeSpotlight,
  onHover, onUnhover, onClick,
}) {
  const dots = useMemo(() => {
    return countries
      .filter(c => c.lat != null && c.lng != null)
      .map(c => {
        // Resolve cluster + color from the ACTIVE configuration
        const assignment = clusterConfig.assignmentByIso3[c.iso3];
        const clusterId = assignment ? assignment.cluster : null;
        const cluster = clusterId != null ? clusterConfig.clusterById[clusterId] : null;
        return {
          country: c,
          iso3: c.iso3,
          position: latLngToVec3(c.lat, c.lng, SPHERE_RADIUS * DOT_OFFSET),
          cluster,
          color: cluster ? cluster.color : "#ffffff",
          clusterId,
        };
      });
  }, [countries, clusterConfig]);

  return (
    <>
      {dots.map(d => {
        const selectedAs = d.iso3 === selectedA ? "A"
                         : d.iso3 === selectedB ? "B"
                         : null;
        let dimmed = false;
        if (matchedIso3s && !matchedIso3s.has(d.iso3)) dimmed = true;
        if (activeSpotlight !== null && d.clusterId !== activeSpotlight) dimmed = true;
        return (
          <CountryDot
            key={d.iso3}
            iso3={d.iso3}
            position={d.position}
            color={d.color}
            country={d.country}
            cluster={d.cluster}
            hovered={hovered === d.iso3}
            selectedAs={selectedAs}
            dimmed={dimmed}
            onHover={onHover}
            onUnhover={onUnhover}
            onClick={onClick}
          />
        );
      })}
    </>
  );
}


/** Connection arc drawn between selectedA and selectedB in compare mode. */
function ConnectionArc({ posA, posB }) {
  const points = useMemo(() => buildArcPoints(posA, posB), [posA, posB]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    return g;
  }, [points]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color={ARC_COLOR} transparent opacity={0.7} />
    </line>
  );
}


export default function Globe({ data, mode, selection, filters, clusterConfig }) {
  const [hovered, setHovered] = useState(null);
  const { selectedA, selectedB, onCountryClick } = selection;
  const { matchedIso3s, activeSpotlight } = filters || {};

  const arcEndpoints = useMemo(() => {
    if (!selectedA || !selectedB) return null;
    const a = data.lookup.byIso3[selectedA];
    const b = data.lookup.byIso3[selectedB];
    if (!a || !b || a.lat == null || b.lat == null) return null;
    return {
      posA: latLngToVec3(a.lat, a.lng, SPHERE_RADIUS * DOT_OFFSET),
      posB: latLngToVec3(b.lat, b.lng, SPHERE_RADIUS * DOT_OFFSET),
    };
  }, [selectedA, selectedB, data.lookup]);

  return (
    <div className="w-full h-full relative overflow-hidden">
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 3, 5]} intensity={1.2} />
        <directionalLight position={[-5, -3, -5]} intensity={0.3} color="#4080ff" />

        <WireframeEarth paused={hovered !== null}>
          <CountryDots
            countries={data.countries}
            clusterConfig={clusterConfig}
            hovered={hovered}
            selectedA={selectedA}
            selectedB={selectedB}
            matchedIso3s={matchedIso3s}
            activeSpotlight={activeSpotlight}
            onHover={setHovered}
            onUnhover={(iso3) => setHovered(prev => (prev === iso3 ? null : prev))}
            onClick={onCountryClick}
          />

          {mode === "compare" && arcEndpoints && (
            <ConnectionArc posA={arcEndpoints.posA} posB={arcEndpoints.posB} />
          )}
        </WireframeEarth>

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          enableRotate={true}
          makeDefault
        />
      </Canvas>
    </div>
  );
}