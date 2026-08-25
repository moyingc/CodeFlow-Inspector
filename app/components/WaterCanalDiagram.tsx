import { useEffect, useRef, useState } from "react";
import type { FlowEdge, FlowNode } from "@/src/lib/analysis/types";
import { shorten } from "@/src/lib/analysis/utils";
import {
  buildDefaultWaterDetails,
  capacityClass,
  confidenceClass,
  inferNodeCapacity,
  nodeConfidence,
} from "@/src/lib/flow/flow-engine";

type EdgeMode = "confluence" | "fan" | "all" | "important" | "issues";
type ConfluencePoint = { id: string; targetId: string; x: number; y: number; incomingIds: string[] };
type BifurcationPoint = { id: string; sourceId: string; x: number; y: number; outgoingIds: string[] };
type ConfluenceStem = {
  id: string;
  nodeId: string;
  kind: "merge" | "split";
  path: string;
  edgeIds: string[];
  representativeEdge: FlowEdge;
};
type FlowPort = { x: number; y: number };
type TerrainRoute = {
  path: string;
  marker: { x: number; y: number };
  laneY: number;
  fallback?: boolean;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  samples?: FlowPort[];
  crossings?: number;
  nodeIntersections?: number;
  stripCount?: number;
  locallyRerouted?: boolean;
};
type AlluvialCorridor = {
  id: string;
  edgeIds: string[];
  representativeEdge: FlowEdge;
  trunkPath: string;
  branchPaths: string[];
  width: number;
  marker: { x: number; y: number };
  lanes?: Array<{
    edgeId: string;
    sourceId: string;
    targetId: string;
    laneIndex: number;
    path: string;
    marker: FlowPort;
  }>;
};
type NodeBadge = { kind: "source" | "outlet"; label: string };
type BasinSector = { center: number; min: number; max: number };
type RoutingCorridor = {
  id: string;
  angle: number;
  basin?: string;
  kind: "main" | "basin" | "shared";
  edgeIds: string[];
};
type LayerRoutingStrip = {
  id: string;
  fromDepth: number;
  toDepth: number;
  minRadius: number;
  maxRadius: number;
  corridors: RoutingCorridor[];
};
type VirtualRoutingTerrain = {
  origin: FlowPort;
  strips: LayerRoutingStrip[];
};
type GraphBounds = { minX: number; minY: number; maxX: number; maxY: number };
type DeepWebRuleAlignment = "aligned" | "mixed" | "conflict" | "insufficient";
export type WaterDeepWebBinding = {
  level: "none" | "warn" | "risk" | "critical";
  predictedClass: string;
  teacherLabel?: string;
  corrected: boolean;
  confidence: number;
  knowledgeScore: number;
  fitnessScore: number;
  confidenceImpact: number;
  knowledgeScoreImpact: number;
  fitnessImpact: number;
  evidence: string[];
  recommendations: string[];
};
export type WaterDeepWebBindingMap = {
  nodes: Record<string, WaterDeepWebBinding>;
  edges: Record<string, WaterDeepWebBinding>;
};

export function WaterCanalDiagram({
  nodes,
  edges,
  selectedNode,
  onSelect,
  deepWebBindings,
  presentation = "diagnostics",
  interactiveDetails = true,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNode: FlowNode | null;
  onSelect: (id: string | null) => void;
  deepWebBindings?: WaterDeepWebBindingMap;
  presentation?: "diagnostics" | "breakpoints";
  interactiveDetails?: boolean;
}) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [spacingPercent, setSpacingPercent] = useState(145);
  const [zoomPercent, setZoomPercent] = useState(72);
  const [edgeMode, setEdgeMode] = useState<EdgeMode>("confluence");
  const [showLayoutDebug, setShowLayoutDebug] = useState(false);
  const [viewport, setViewport] = useState({ scale: 0.72, translateX: 0, translateY: 0 });
  const stableViewportRef = useRef({ scale: 0.72, translateX: 0, translateY: 0 });
  const controlsFocusedRef = useRef(false);
  const mapShellRef = useRef<HTMLDivElement>(null);
  const panState = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSpacingPercent(readMapPreference("codeflow.map.spacing", 145, 90, 240));
      const storedZoom = readMapPreference("codeflow.map.zoom", 72, 5, 180);
      setZoomPercent(storedZoom);
      setViewport((current) => ({ ...current, scale: storedZoom / 100 }));
      stableViewportRef.current = { ...stableViewportRef.current, scale: storedZoom / 100 };
    });
    return () => { cancelled = true; };
  }, []);
  const selected = selectedNode;
  const breakpointImpact = buildBreakpointImpact(nodes, edges);
  const filteredEdges = filterEdges(edges, edgeMode, presentation, breakpointImpact);
  const fanLod = buildFanLevelOfDetail(nodes, filteredEdges, edgeMode, zoomPercent);
  const visibleEdges = fanLod.edges;
  const diagramMode: EdgeMode = edgeMode === "confluence" ? "confluence" : "fan";
  const laidOutNodes = diagramMode === "fan"
    ? layoutAlluvialFanNodes(fanLod.nodes, visibleEdges, spacingPercent / 100)
    : scaleNodePositions(nodes, edges, spacingPercent / 100);
  // Real function positions are immutable after node layout. Routers may only
  // place virtual junctions, waypoints and shared channel segments.
  const displayNodes = laidOutNodes
    .filter((node) => fanLod.nodeIds.has(node.id))
    .map((node) => Object.freeze({ ...node }) as FlowNode);
  const nodeMap = new Map(displayNodes.map((node) => [node.id, node]));
  const confluenceLayout = buildConfluenceLayout(displayNodes, visibleEdges, diagramMode);
  const alluvialCorridors = buildAlluvialCorridors(displayNodes, visibleEdges, diagramMode);
  const sharedChannels = buildSharedFlowChannels(
    displayNodes,
    visibleEdges,
    diagramMode,
    confluenceLayout.mergePorts,
    confluenceLayout.splitPorts,
  );
  const bundledEdgeIds = new Set(sharedChannels.flatMap((channel) => channel.edgeIds));
  const routingTerrain = buildLayerRoutingTerrain(displayNodes, visibleEdges, sharedChannels);
  const terrainRoutes = buildTerrainRoutes(
    displayNodes,
    visibleEdges,
    diagramMode,
    confluenceLayout.points,
    confluenceLayout.outputPoints,
    confluenceLayout.mergePorts,
    confluenceLayout.splitPorts,
    fanLod.level,
    routingTerrain,
    bundledEdgeIds,
  );
  const nodeBadges = buildNodeBadges(displayNodes, visibleEdges);
  const selectedEdge = selected ? null : visibleEdges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const activeEdgeId = selectedEdge?.id ?? hoveredEdgeId;
  const focusedEdgeIds = new Set<string>();
  if (activeEdgeId) {
    focusedEdgeIds.add(activeEdgeId);
    alluvialCorridors
      .filter((corridor) => corridor.edgeIds.includes(activeEdgeId))
      .forEach((corridor) => corridor.edgeIds.forEach((edgeId) => focusedEdgeIds.add(edgeId)));
  }
  const focusedNodeIds = new Set(
    visibleEdges
      .filter((edge) => focusedEdgeIds.has(edge.id))
      .flatMap((edge) => [edge.from, edge.to]),
  );
  const nodeBindings = deepWebBindings?.nodes ?? {};
  const edgeBindings = deepWebBindings?.edges ?? {};
  const loopCount = edges.filter((edge) => edge.kind === "闭环线路").length;
  const diagnosticCount = presentation === "breakpoints"
    ? breakpointImpact.breakpointNodes.size + breakpointImpact.affectedNodes.size
    : nodes.filter((node) => isDiagnosticStatus(node.status) || bindingDiagnosticLevel(bindingForNode(node, nodeBindings)) !== "none").length +
      edges.filter((edge) => isDiagnosticStatus(edge.status) || edge.confidence < 60 || bindingDiagnosticLevel(edgeBindings[edge.id]) !== "none").length;
  const primaryCount = edges.filter((edge) => edge.primary).length;
  const taintPathCount = new Set(edges.flatMap((edge) => edge.taintPathIds ?? [])).size;
  const basinCount = new Set(nodes.map((node) => node.basin).filter(Boolean)).size;
  const renderedEdges = [...visibleEdges]
    .filter((edge) => diagramMode !== "confluence" || edge.kind === "闭环线路")
    .filter((edge) => edge.kind === "闭环线路" || !bundledEdgeIds.has(edge.id))
    .sort((a, b) => edgeRenderRank(a) - edgeRenderRank(b));
  const graphBounds = buildGraphBounds(displayNodes, terrainRoutes, confluenceLayout, sharedChannels);
  const mapViewport = buildMapViewport(graphBounds);
  const mapWidth = mapViewport.width;
  const mapViewHeight = mapViewport.height;
  const mapHeight = mapViewHeight;
  const renderedWidth = Math.max(420, mapWidth * (zoomPercent / 100));
  const renderedHeight = Math.max(360, mapHeight * (zoomPercent / 100));
  const selectedDisplayNode = selected ? nodeMap.get(selected.id) ?? selected : null;
  const selectedNodeDetails = selected ? selected.details ?? buildDefaultWaterDetails(selected) : [];
  const selectedEdgeDetails = selectedEdge ? edgeEvidenceLines(selectedEdge) : [];
  const selectedNodeCodeDetails = codeDiagnosticDetailLines(selectedNodeDetails);

  function setViewportScroll(left: number, top: number) {
    const next = { ...stableViewportRef.current, translateX: -Math.max(0, left), translateY: -Math.max(0, top) };
    stableViewportRef.current = next;
    setViewport(next);
  }

  function updateSpacing(next: number) {
    const shell = mapShellRef.current;
    const saved = shell ? {
      left: Math.max(0, -stableViewportRef.current.translateX),
      top: Math.max(0, -stableViewportRef.current.translateY),
    } : null;
    setSpacingPercent(next);
    if (typeof window !== "undefined") window.localStorage.setItem("codeflow.map.spacing", String(next));
    if (shell && saved) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        shell.scrollTo(saved);
        setViewportScroll(saved.left, saved.top);
      }));
    }
  }

  function zoomAt(nextPercent: number, clientX?: number, clientY?: number) {
    const shell = mapShellRef.current;
    const next = clamp(nextPercent, 5, 180);
    if (!shell) {
      setZoomPercent(next);
      setViewport((current) => ({ ...current, scale: next / 100 }));
      return;
    }
    const rect = shell.getBoundingClientRect();
    const cursorX = clientX === undefined ? shell.clientWidth / 2 : clientX - rect.left;
    const cursorY = clientY === undefined ? shell.clientHeight / 2 : clientY - rect.top;
    const oldScale = Math.max(0.1, zoomPercent / 100);
    const newScale = next / 100;
    const worldX = (shell.scrollLeft + cursorX) / oldScale;
    const worldY = (shell.scrollTop + cursorY) / oldScale;
    const nextLeft = Math.max(0, worldX * newScale - cursorX);
    const nextTop = Math.max(0, worldY * newScale - cursorY);
    setZoomPercent(next);
    if (typeof window !== "undefined") window.localStorage.setItem("codeflow.map.zoom", String(next));
    const nextViewport = { scale: newScale, translateX: -nextLeft, translateY: -nextTop };
    stableViewportRef.current = nextViewport;
    setViewport(nextViewport);
    requestAnimationFrame(() => shell.scrollTo({ left: nextLeft, top: nextTop }));
  }

  function fitView() {
    const shell = mapShellRef.current;
    if (!shell) return;
    const padding = Math.max(28, Math.min(shell.clientWidth, shell.clientHeight) * 0.08);
    const nextScale = clamp(Math.min(
      (shell.clientWidth - padding * 2) / mapWidth,
      (shell.clientHeight - padding * 2) / mapHeight,
    ), 0.05, 1.8);
    const nextPercent = Math.round(nextScale * 100);
    const left = 0;
    const top = 0;
    setZoomPercent(nextPercent);
    const nextViewport = { scale: nextScale, translateX: -left, translateY: -top };
    stableViewportRef.current = nextViewport;
    setViewport(nextViewport);
    requestAnimationFrame(() => shell.scrollTo({ left, top }));
  }

  return (
    <div className={`canal-panel watershed-panel ${presentation === "breakpoints" ? "breakpoint-view" : "diagnostic-view"}`}>
      <div className="watershed-toolbar">
        <div className="watershed-stats" aria-label="函数水流图统计">
          <span>函数 {nodes.length}</span>
          <span>数据路径 {visibleEdges.length}/{edges.length}</span>
          {edgeMode === "fan" && <span>调用尺度</span>}
          {edgeMode === "all" && <span>冲积扇总览</span>}
          {edgeMode === "important" && <span>主要模型</span>}
          {diagramMode === "confluence" && <span>聚合走廊 {alluvialCorridors.length}</span>}
          {diagramMode === "fan" && <span>分汇主干 {confluenceLayout.stems.length}</span>}
          {diagramMode === "fan" && <span>共享通道 {sharedChannels.length}</span>}
          <span>主路径 {primaryCount}</span>
          <span>闭环 {loopCount}</span>
          <span>模块域 {basinCount}</span>
          <span>污点路径 {taintPathCount}</span>
          <span>{presentation === "breakpoints" ? "断点影响" : "诊断提示"} {diagnosticCount}</span>
        </div>

        <div
          className="watershed-controls"
          aria-label="数据流图尺寸控制"
          onFocusCapture={() => { controlsFocusedRef.current = true; }}
          onBlurCapture={() => { requestAnimationFrame(() => { controlsFocusedRef.current = false; }); }}
        >
          <label>
            <span>间距</span>
            <input
              type="range"
              min="90"
              max="240"
              step="5"
              value={spacingPercent}
              onChange={(event) => updateSpacing(Number(event.target.value))}
            />
            <b>{spacingPercent}%</b>
          </label>
          <label>
            <span>缩放</span>
            <input
              type="range"
              min="5"
              max="180"
              step="5"
              value={zoomPercent}
              onChange={(event) => zoomAt(Number(event.target.value))}
            />
            <b>{zoomPercent}%</b>
          </label>
          <div className="water-zoom-actions" aria-label="CAD 画布缩放">
            <button type="button" title="缩小" onClick={() => zoomAt(zoomPercent - 10)}>−</button>
            <button type="button" title="适合窗口" onClick={fitView}>适合</button>
            <button type="button" title="重置视图" onClick={() => {
              setZoomPercent(100);
              stableViewportRef.current = { scale: 1, translateX: 0, translateY: 0 };
              setViewport(stableViewportRef.current);
              requestAnimationFrame(() => mapShellRef.current?.scrollTo({ left: 0, top: 0 }));
            }}>重置</button>
            <button type="button" title="放大" onClick={() => zoomAt(zoomPercent + 10)}>＋</button>
          </div>
          <div className="water-edge-mode" role="tablist" aria-label="数据路径显示">
            {[
              ["confluence", "主线图"],
              ["fan", "冲积扇"],
              ["all", "全部"],
              ["important", "主路径"],
              ["issues", "问题"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                className={edgeMode === mode ? "active" : ""}
                onClick={() => setEdgeMode(mode as EdgeMode)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="water-map-preset"
            onClick={() => {
              updateSpacing(145);
              setEdgeMode("confluence");
            }}
          >
            清晰
          </button>
          {diagramMode === "fan" && (
            <button
              type="button"
              className={`water-layout-debug ${showLayoutDebug ? "active" : ""}`}
              title="显示或隐藏布局调试信息"
              onClick={() => setShowLayoutDebug((value) => !value)}
            >
              调试
            </button>
          )}
        </div>
      </div>

      <div
        ref={mapShellRef}
        className="watershed-map-shell"
        aria-label="函数水流图"
        onClick={() => {
          setSelectedEdgeId(null);
          onSelect(null);
        }}
        onWheel={(event) => {
          const isZoomGesture = event.ctrlKey || event.metaKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX);
          if (!isZoomGesture) return;
          event.preventDefault();
          zoomAt(zoomPercent + (event.deltaY < 0 ? 8 : -8), event.clientX, event.clientY);
        }}
        onScroll={(event) => {
          if (controlsFocusedRef.current) return;
          setViewportScroll(event.currentTarget.scrollLeft, event.currentTarget.scrollTop);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const target = event.target as Element;
          if (target.closest("button, input, .water-network-node, .water-edge-group, .watershed-popup")) return;
          const shell = mapShellRef.current;
          if (!shell) return;
          panState.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: shell.scrollLeft,
            top: shell.scrollTop,
          };
          shell.setPointerCapture(event.pointerId);
          setIsPanning(true);
        }}
        onPointerMove={(event) => {
          const shell = mapShellRef.current;
          const pan = panState.current;
          if (!shell || !pan || pan.pointerId !== event.pointerId) return;
          shell.scrollLeft = pan.left - (event.clientX - pan.x);
          shell.scrollTop = pan.top - (event.clientY - pan.y);
          setViewportScroll(shell.scrollLeft, shell.scrollTop);
        }}
        onPointerUp={(event) => {
          if (panState.current?.pointerId !== event.pointerId) return;
          panState.current = null;
          setIsPanning(false);
        }}
        onPointerCancel={() => {
          panState.current = null;
          setIsPanning(false);
        }}
        data-panning={isPanning ? "true" : "false"}
      >
        <svg
          className="watershed-map"
          viewBox={`${mapViewport.minX} ${mapViewport.minY} ${mapWidth} ${mapHeight}`}
          preserveAspectRatio="xMinYMin meet"
          style={{
            height: `${renderedHeight}px`,
            width: `${renderedWidth}px`,
            minWidth: `${renderedWidth}px`,
          }}
          role="img"
          aria-label="函数到函数的数据流图"
          data-viewport-scale={viewport.scale.toFixed(2)}
          data-viewport-x={Math.round(viewport.translateX)}
          data-viewport-y={Math.round(viewport.translateY)}
        >
          <defs>
            <marker id="water-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="water-arrow" />
            </marker>
            <marker id="water-arrow-warn" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="water-arrow warn" />
            </marker>
            <marker id="water-arrow-risk" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="water-arrow risk" />
            </marker>
            <marker id="water-arrow-critical" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="water-arrow critical" />
            </marker>
          </defs>

          <g className={`water-edge-layer ${activeEdgeId ? "has-edge-focus" : ""}`}>
            {diagramMode === "confluence" && alluvialCorridors.map((corridor) => {
              const binding = strongestBinding(corridor.edgeIds.map((edgeId) => edgeBindings[edgeId]));
              const diagnosticLevel = visualEdgeDiagnosticLevel(corridor.representativeEdge, binding, presentation, breakpointImpact);
              const isSelected = selectedEdge ? corridor.edgeIds.includes(selectedEdge.id) : false;
              return (
                <g
                  key={corridor.id}
                  className={`water-edge-group water-alluvial-corridor edge-confluence ${diagnosticLevelClass(diagnosticLevel)} ${corridor.edgeIds.some((edgeId) => focusedEdgeIds.has(edgeId)) ? "edge-focused" : ""} ${isSelected ? "selected" : ""}`}
                  onPointerEnter={() => setHoveredEdgeId(corridor.representativeEdge.id)}
                  onPointerLeave={() => setHoveredEdgeId(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!interactiveDetails) return;
                    setSelectedEdgeId(corridor.representativeEdge.id);
                    onSelect(null);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`聚合数据走廊，包含 ${corridor.edgeIds.length} 条精确路径`}
                >
                  {corridor.branchPaths.map((path, index) => (
                    <path key={`${corridor.id}-branch-${index}`} className={`water-edge alluvial-branch ${edgeClass(corridor.representativeEdge)}`} d={path} />
                  ))}
                  <path className="water-edge-hit" d={corridor.trunkPath} style={{ strokeWidth: Math.max(14, corridor.width + 8) }} />
                  <path className="water-edge-bridge-clearance" d={corridor.trunkPath} style={{ strokeWidth: corridor.width + 7 }} />
                  <path className={`water-edge alluvial-trunk ${edgeClass(corridor.representativeEdge)}`} d={corridor.trunkPath} style={{ strokeWidth: corridor.width }} />
                  {diagnosticLevel !== "none" && (
                    <g className={`edge-diagnostic-marker marker-${diagnosticLevel}`} transform={`translate(${corridor.marker.x}, ${corridor.marker.y})`}>
                      <circle r="9" /><text x="0" y="4" textAnchor="middle">!</text>
                    </g>
                  )}
                </g>
              );
            })}
            {diagramMode === "fan" && sharedChannels.map((channel) => {
              return (
                <g
                  key={channel.id}
                  className="water-shared-channel multi-lane-shared-corridor"
                  data-corridor-id={channel.id}
                  data-semantic-edge-count={channel.edgeIds.length}
                >
                  <path
                    className="shared-channel-envelope"
                    d={channel.trunkPath}
                    style={{ strokeWidth: channel.width }}
                    aria-hidden="true"
                  />
                  {(channel.lanes ?? []).map((lane) => {
                    const edge = visibleEdges.find((candidate) => candidate.id === lane.edgeId);
                    const from = edge ? nodeMap.get(edge.from) : undefined;
                    const to = edge ? nodeMap.get(edge.to) : undefined;
                    if (!edge || !from || !to) return null;
                    const binding = edgeBindings[edge.id];
                    const diagnosticLevel = visualEdgeDiagnosticLevel(edge, binding, presentation, breakpointImpact);
                    const isSelected = selectedEdge?.id === edge.id;
                    const isFocused = focusedEdgeIds.has(edge.id);
                    const laneWidth = Math.min(4.8, Math.max(2.2, edgeWidth(edge) * 0.58));
                    return (
                      <g
                        key={lane.edgeId}
                        className={`water-edge-group shared-channel-lane ${diagnosticLevelClass(diagnosticLevel)} ${isFocused ? "edge-focused" : ""} ${isSelected ? "selected" : ""}`}
                        data-channel-id={lane.edgeId}
                        data-lane-order={lane.laneIndex}
                        data-source-id={lane.sourceId}
                        data-target-id={lane.targetId}
                        onPointerEnter={() => setHoveredEdgeId(edge.id)}
                        onPointerLeave={() => setHoveredEdgeId(null)}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!interactiveDetails) return;
                          setSelectedEdgeId(edge.id);
                          onSelect(null);
                        }}
                        onKeyDown={(event) => {
                          if (interactiveDetails && event.key === "Enter") {
                            setSelectedEdgeId(edge.id);
                            onSelect(null);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`独立数据路径 ${from.name} 到 ${to.name}，共享走廊车道 ${lane.laneIndex + 1}`}
                      >
                        <path className="water-edge-hit shared-channel-hit" d={lane.path} style={{ strokeWidth: Math.max(12, laneWidth + 7) }} />
                        <path className="water-edge-bridge-clearance" d={lane.path} style={{ strokeWidth: laneWidth + 5 }} />
                        <path
                          className={`water-edge shared-channel-lane-path ${presentation === "breakpoints" ? "edge-breakpoint-flow" : edgeClass(edge)}`}
                          d={lane.path}
                          markerEnd={isFocused ? edgeMarkerUrl(diagnosticLevel) : undefined}
                          style={{ strokeWidth: laneWidth }}
                        />
                        {diagnosticLevel !== "none" && (
                          <g className={`edge-diagnostic-marker marker-${diagnosticLevel}`} transform={`translate(${lane.marker.x}, ${lane.marker.y})`}>
                            <circle r="8" /><text x="0" y="4" textAnchor="middle">!</text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {diagramMode === "fan" && confluenceLayout.stems.map((stem) => {
              const representativeEdge = stem.representativeEdge;
              const stemWidth = aggregateStemWidth(stem, visibleEdges);
              const binding = strongestBinding(stem.edgeIds.map((edgeId) => edgeBindings[edgeId]));
              const diagnosticLevel = visualEdgeDiagnosticLevel(representativeEdge, binding, presentation, breakpointImpact);
              const isSelected = selectedEdge ? stem.edgeIds.includes(selectedEdge.id) : false;
              return (
                <g
                  key={stem.id}
                  className={`water-edge-group water-confluence-stem edge-confluence ${diagnosticLevelClass(diagnosticLevel)} ${stem.edgeIds.some((edgeId) => focusedEdgeIds.has(edgeId)) ? "edge-focused" : ""} ${isSelected ? "selected" : ""}`}
                  onPointerEnter={() => setHoveredEdgeId(representativeEdge.id)}
                  onPointerLeave={() => setHoveredEdgeId(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!interactiveDetails) return;
                    setSelectedEdgeId(representativeEdge.id);
                    onSelect(null);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${stem.kind === "merge" ? "数据路径汇聚" : "函数输出分支"} ${nodeMap.get(stem.nodeId)?.name ?? stem.nodeId}`}
                >
                  <path className="water-edge-hit" d={stem.path} style={{ strokeWidth: Math.max(12, stemWidth + 7) }} />
                  <path className="water-edge-bridge-clearance" d={stem.path} style={{ strokeWidth: stemWidth + 6 }} />
                  <path
                    className={`water-edge ${presentation === "breakpoints" ? "edge-breakpoint-flow" : edgeClass(representativeEdge)}`}
                    d={stem.path}
                    markerEnd={stem.edgeIds.some((edgeId) => focusedEdgeIds.has(edgeId)) ? edgeMarkerUrl(diagnosticLevel) : undefined}
                    style={{ strokeWidth: stemWidth }}
                  />
                </g>
              );
            })}
            {renderedEdges.map((edge) => {
              const from = nodeMap.get(edge.from);
              const to = nodeMap.get(edge.to);
              if (!from || !to) return null;
              const isSelected = selectedEdge?.id === edge.id;
              const terrainRoute = terrainRoutes.get(edge.id);
              const path = terrainRoute?.path ?? edgePath(from, to, edge, diagramMode, confluenceLayout.points, confluenceLayout.outputPoints);
              const marker = terrainRoute?.marker ?? edgeMarkerPoint(from, to, edge, diagramMode, confluenceLayout.points, confluenceLayout.outputPoints);
              const binding = edgeBindings[edge.id];
              const diagnosticLevel = visualEdgeDiagnosticLevel(edge, binding, presentation, breakpointImpact);
              const renderedEdgeWidth = diagramMode === "confluence" || diagramMode === "fan" ? confluenceBranchWidth(edge, confluenceLayout) : edgeWidth(edge);
              return (
                <g
                  key={edge.id}
                  className={`water-edge-group ${diagramMode === "confluence" || diagramMode === "fan" ? "edge-confluence" : ""} ${diagnosticLevelClass(diagnosticLevel)} ${focusedEdgeIds.has(edge.id) ? "edge-focused" : ""} ${isSelected ? "selected" : ""}`}
                  onPointerEnter={() => setHoveredEdgeId(edge.id)}
                  onPointerLeave={() => setHoveredEdgeId(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!interactiveDetails) return;
                    setSelectedEdgeId(edge.id);
                    onSelect(null);
                  }}
                  onKeyDown={(event) => {
                    if (interactiveDetails && event.key === "Enter") {
                      setSelectedEdgeId(edge.id);
                      onSelect(null);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`数据路径 ${from.name} 到 ${to.name}`}
                  data-route-fallback={terrainRoute?.fallback ? "true" : "false"}
                  data-route-crossings={terrainRoute?.crossings ?? 0}
                  data-route-node-intersections={terrainRoute?.nodeIntersections ?? 0}
                  data-route-strips={terrainRoute?.stripCount ?? 0}
                  data-route-local-reroute={terrainRoute?.locallyRerouted ? "true" : "false"}
                >
                  <path className="water-edge-hit" d={path} style={{ strokeWidth: Math.max(12, renderedEdgeWidth + 7) }} />
                  <path className="water-edge-bridge-clearance" d={path} style={{ strokeWidth: renderedEdgeWidth + 6 }} />
                  <path
                    className={`water-edge ${presentation === "breakpoints" ? "edge-breakpoint-flow" : edgeClass(edge)}`}
                    d={path}
                    markerEnd={diagramMode === "confluence" || diagramMode === "fan"
                      ? focusedEdgeIds.has(edge.id) ? edgeMarkerUrl(diagnosticLevel) : undefined
                      : edgeMarkerUrl(diagnosticLevel)}
                    style={{ strokeWidth: renderedEdgeWidth }}
                  />
                  {diagnosticLevel !== "none" && (
                    <g className={`edge-diagnostic-marker marker-${diagnosticLevel}`} transform={`translate(${marker.x}, ${marker.y})`}>
                      <circle r="9" />
                      <text x="0" y="4" textAnchor="middle">!</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {diagramMode === "fan" && showLayoutDebug && (
            <FanLayoutDebugOverlay nodes={displayNodes} viewport={mapViewport} />
          )}

          <g className="water-node-layer">
            {displayNodes.map((node) => {
              const confidence = nodeConfidence(node);
              const capacity = node.capacity ?? inferNodeCapacity(node);
              const isSelected = selected?.id === node.id;
              const lines = labelLines(node.name, capacity);
              const binding = bindingForNode(node, nodeBindings);
              const diagnosticLevel = visualNodeDiagnosticLevel(node, confidence, binding, presentation, breakpointImpact);
              const marker = nodeMarkerPoint(capacity);
              const badge = nodeBadges.get(node.id);
              return (
                <g
                  key={node.id}
                  className={`water-network-node ${capacityClass(capacity)} ${presentation === "breakpoints" ? "code-flow-healthy" : `${confidenceClass(confidence)} ${statusClass(node.status)}`} ${diagnosticLevelClass(diagnosticLevel)} ${activeEdgeId ? focusedNodeIds.has(node.id) ? "edge-focus-endpoint" : "edge-focus-muted" : ""} ${isSelected && interactiveDetails ? "selected" : ""}`}
                  transform={`translate(${node.x ?? 540}, ${node.y ?? 280})`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedEdgeId(null);
                    onSelect(node.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      setSelectedEdgeId(null);
                      onSelect(node.id);
                    }
                  }}
                  aria-label={`函数 ${node.name}`}
                >
                  <circle className="network-hit-zone" cx="0" cy="0" r={hitRadius(capacity)} />
                  {nodeShape(capacity)}
                  {badge && (
                    <g className={`node-flow-badge badge-${badge.kind}`} transform={`translate(${nodeBadgePoint(capacity).x}, ${nodeBadgePoint(capacity).y})`}>
                      <rect x="-16" y="-10" width="32" height="18" rx="7" />
                      <text x="0" y="3" textAnchor="middle">{badge.label}</text>
                    </g>
                  )}
                  <text className="network-title" x="0" y={lines.length === 1 ? 4 : -5} textAnchor="middle">
                    {lines.map((line, index) => (
                      <tspan
                        key={`${line}-${index}`}
                        x="0"
                        dy={index === 0 ? 0 : 14}
                        textLength={line.length > 9 ? textLengthFor(capacity) : undefined}
                        lengthAdjust="spacingAndGlyphs"
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                  {diagnosticLevel !== "none" && (
                    <g className={`node-diagnostic-marker marker-${diagnosticLevel}`} transform={`translate(${marker.x}, ${marker.y})`}>
                      <circle r="10" />
                      <text x="0" y="4" textAnchor="middle">!</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        <div className="watershed-legend" aria-label="图内符号定义">
          {[
            ["函数框", "代码处理单元"],
            ["箭头", "调用或数据方向"],
            ["菱形", "数据汇聚或分支"],
            ["通道间隔", "无关数据流保持分离"],
            ["线宽", "估算数据负载"],
            ["径向层级", "主路径由左上沿同心弧层级流向右下，支流在两侧扇形展开"],
            ["颜色", "诊断严重程度"],
            ["!", "代码问题"],
          ].map(([label, text]) => (
            <span key={label}>
              <b>{label}</b>
              {text}
            </span>
          ))}
        </div>

        {interactiveDetails && selected && selectedDisplayNode && (
          <div
            className="watershed-popup"
            style={popupStyle(selectedDisplayNode.x ?? 520, selectedDisplayNode.y ?? 280)}
            role="dialog"
            aria-label="代码错误解析浮窗"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="popup-close" onClick={() => onSelect(null)} aria-label="关闭函数节点详情">
              ×
            </button>
            <div className="detail-kicker">
              <span>代码错误解析</span>
              <b>{statusLabel(selected.status)}</b>
            </div>
            <h3>{selected.name}</h3>
            <dl className="canal-metrics">
              <div>
                <dt>上游调用</dt>
                <dd>{selected.upstreamIds?.length ?? 0}</dd>
              </div>
              <div>
                <dt>下游调用</dt>
                <dd>{selected.downstreamIds?.length ?? 0}</dd>
              </div>
              <div>
                <dt>置信度</dt>
                <dd className={confidenceClass(nodeConfidence(selected))}>{nodeConfidence(selected)}%</dd>
              </div>
            </dl>
            <p>{nodeDiagnosticText(selected, nodeConfidence(selected))}</p>
            <small>{productTerminology(selected.evidence ?? "证据来源：当前本地 ParserAdapter、调用图与规则模型。")}</small>
            <details className="popup-analysis-card">
              <summary>代码错误解析与修复建议</summary>
              <div className="popup-analysis-card-body">
                <div className="popup-rule-binding">
                  <strong>规则联动</strong>
                  <span>{nodeRuleBindingSummary(selected)}</span>
                </div>
                <DeepWebBindingPanel binding={bindingForNode(selected, nodeBindings)} ruleDetails={selectedNodeCodeDetails} />
                <ul>
                  {selectedNodeCodeDetails.map((detail) => (
                    <li key={detail}>{formatTechnicalLine(detail)}</li>
                  ))}
                </ul>
                <SuggestedCodePanel
                  targetName={selected.name}
                  details={selectedNodeCodeDetails}
                  binding={bindingForNode(selected, nodeBindings)}
                  evidence={selected.evidence ?? ""}
                />
              </div>
            </details>
          </div>
        )}

        {interactiveDetails && selectedEdge && (
          <div
            className="watershed-popup watershed-edge-popup"
            style={edgePopupStyle(selectedEdge, nodeMap)}
            role="dialog"
            aria-label="代码关系错误解析浮窗"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="popup-close" onClick={() => setSelectedEdgeId(null)} aria-label="关闭函数数据路径详情">
              ×
            </button>
            <div className="detail-kicker">
              <span>代码关系错误解析</span>
              <b>{statusLabel(selectedEdge.status)}</b>
            </div>
            <h3>
              {shorten(nodeMap.get(selectedEdge.from)?.name ?? selectedEdge.from, 22)} →{" "}
              {shorten(nodeMap.get(selectedEdge.to)?.name ?? selectedEdge.to, 22)}
            </h3>
            <dl className="canal-metrics">
              <div>
                <dt>数据负载</dt>
                <dd>{selectedEdge.volume}%</dd>
              </div>
              <div>
                <dt>置信度</dt>
                <dd className={confidenceClass(selectedEdge.confidence)}>{selectedEdge.confidence}%</dd>
              </div>
              <div>
                <dt>主流程</dt>
                <dd>{selectedEdge.primary ? "是" : "否"}</dd>
              </div>
            </dl>
            <p>{edgeDiagnosticText(selectedEdge)}</p>
            <small>{productTerminology(selectedEdge.evidence)}</small>
            <details className="popup-analysis-card">
              <summary>代码关系证据与修复建议</summary>
              <div className="popup-analysis-card-body">
                <DeepWebBindingPanel binding={edgeBindings[selectedEdge.id]} ruleDetails={selectedEdgeDetails} />
                <ul>
                  {selectedEdgeDetails.map((line) => (
                    <li key={line}>{formatTechnicalLine(line)}</li>
                  ))}
                </ul>
                <SuggestedCodePanel
                  targetName={`${nodeMap.get(selectedEdge.from)?.name ?? selectedEdge.from} -> ${nodeMap.get(selectedEdge.to)?.name ?? selectedEdge.to}`}
                  details={selectedEdgeDetails}
                  binding={edgeBindings[selectedEdge.id]}
                  evidence={selectedEdge.evidence}
                />
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function FanLayoutDebugOverlay({
  nodes,
  viewport,
}: {
  nodes: FlowNode[];
  viewport: { minX: number; minY: number; width: number; height: number };
}) {
  if (!nodes.length) return null;
  const origin = { x: nodes[0]?.fanOriginX ?? 190, y: nodes[0]?.fanOriginY ?? 190 };
  const layerDebug = Array.from(new Set(nodes.map((node) => Math.round(node.fanLayerRadius ?? node.fanRadius ?? 0))))
    .filter(Boolean)
    .sort((a, b) => a - b)
    .map((radius) => {
      const layerAngles = nodes
        .filter((node) => Math.round(node.fanLayerRadius ?? node.fanRadius ?? 0) === radius)
        .map((node) => node.fanAngle ?? Math.PI / 4);
      return {
        radius,
        minAngle: Math.min(...layerAngles, Math.PI / 4) - 0.06,
        maxAngle: Math.max(...layerAngles, Math.PI / 4) + 0.06,
      };
    });
  const radii = layerDebug.map((layer) => layer.radius);
  const angles = nodes.map((node) => node.fanAngle ?? Math.PI / 4);
  const minAngle = Math.min(...angles, Math.PI / 4) - 0.08;
  const maxAngle = Math.max(...angles, Math.PI / 4) + 0.08;
  const maxRadius = Math.max(...radii, 200) + 120;
  const axisAngle = Math.PI / 4;
  const basinAngles = Array.from(new Set(nodes.map((node) => node.basin ?? "default"))).map((basin) => {
    const basinNodes = nodes.filter((node) => (node.basin ?? "default") === basin);
    const sortedAngles = basinNodes.map((node) => node.fanAngle ?? axisAngle).sort((a, b) => a - b);
    return { basin, angle: sortedAngles[Math.floor(sortedAngles.length / 2)] ?? axisAngle };
  });
  const axisEnd = polarPoint(origin, maxRadius, axisAngle);
  const minEnd = polarPoint(origin, maxRadius, minAngle);
  const maxEnd = polarPoint(origin, maxRadius, maxAngle);
  return (
    <g className="fan-layout-debug" pointerEvents="none" aria-hidden="true">
      <circle cx={origin.x} cy={origin.y} r="7" />
      <line x1={origin.x} y1={origin.y} x2={axisEnd.x} y2={axisEnd.y} className="debug-main-axis" />
      <line x1={origin.x} y1={origin.y} x2={minEnd.x} y2={minEnd.y} className="debug-envelope" />
      <line x1={origin.x} y1={origin.y} x2={maxEnd.x} y2={maxEnd.y} className="debug-envelope" />
      {basinAngles.map(({ basin, angle }) => {
        const end = polarPoint(origin, maxRadius, angle);
        return <line key={basin} x1={origin.x} y1={origin.y} x2={end.x} y2={end.y} className="debug-basin-sector" />;
      })}
      {layerDebug.map((layer) => (
        <path key={layer.radius} d={polarArcPath(origin, layer.radius, layer.minAngle, layer.maxAngle)} className="debug-radial-layer" />
      ))}
      {nodes.map((node) => (
        <text key={node.id} x={(node.x ?? 0) + 10} y={(node.y ?? 0) - hitRadius(node.capacity ?? inferNodeCapacity(node)) - 10}>
          L{node.depth ?? 0} · θ{((node.fanAngle ?? 0) * 180 / Math.PI).toFixed(0)}° · r{Math.round(node.fanRadius ?? 0)}
        </text>
      ))}
      <rect x={viewport.minX + 1} y={viewport.minY + 1} width={Math.max(0, viewport.width - 2)} height={Math.max(0, viewport.height - 2)} className="debug-world-bounds" />
    </g>
  );
}

function polarArcPath(origin: FlowPort, radius: number, startAngle: number, endAngle: number) {
  const start = polarPoint(origin, radius, startAngle);
  const end = polarPoint(origin, radius, endAngle);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0} 1 ${end.x} ${end.y}`;
}

function DeepWebBindingPanel({ binding, ruleDetails = [] }: { binding?: WaterDeepWebBinding; ruleDetails?: string[] }) {
  if (!binding) return null;

  const labelText = binding.teacherLabel && binding.teacherLabel !== binding.predictedClass ? `${binding.predictedClass} -> ${binding.teacherLabel}` : binding.predictedClass;
  const ruleProfile = buildDeepWebRuleProfile(ruleDetails, binding);
  const evidenceLines = deepWebReadableEvidenceLines(binding);
  const actionSummary = buildDeepWebActionSummary(binding, ruleProfile);
  return (
    <div className={`popup-deepweb-binding deepweb-binding-${binding.level}`}>
      <div>
        <strong>DeepWeb 主结论</strong>
        <span>
          {labelText} · {binding.confidence}%
        </span>
      </div>
      <div className="deepweb-action-card">
        <span>{actionSummary.problem}</span>
        <span>{actionSummary.reason}</span>
        <b>{actionSummary.action}</b>
      </div>
      <details className="deepweb-evidence-details">
        <summary>证据</summary>
        <div className={`deepweb-rule-consensus consensus-${ruleProfile.alignment}`}>
          <b>规则共识</b>
          <span>{ruleProfile.summary}</span>
        </div>
        <dl className="deepweb-impact-strip">
          <div>
            <dt>知识</dt>
            <dd>{binding.knowledgeScore}%</dd>
          </div>
          <div>
            <dt>适应度</dt>
            <dd>{binding.fitnessScore}%</dd>
          </div>
          <div>
            <dt>扣分</dt>
            <dd>{deepWebImpactText(binding)}</dd>
          </div>
        </dl>
        <ul>
          {evidenceLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function buildDeepWebActionSummary(binding: WaterDeepWebBinding, ruleProfile: { alignment: DeepWebRuleAlignment; summary: string }) {
  const activeLabel = normalizeDeepWebLabel(binding.teacherLabel ?? binding.predictedClass);
  const recommendation = binding.recommendations[0] ?? actionForDeepWebLabel(activeLabel);
  return {
    problem: `主问题：${deepWebLabelText(activeLabel)}`,
    reason: `依据：${ruleProfile.summary}`,
    action: `先修：${stripRecommendationPrefix(recommendation)}`,
  };
}

function deepWebReadableEvidenceLines(binding: WaterDeepWebBinding) {
  const sourceLine = binding.evidence
    .flatMap((line) => extractSourceEvidence(line))
    .find(Boolean);
  const dominantLine = binding.evidence.find((line) => line.includes("dominant"));
  const dominantDimensions = dominantLine ? translateDominantDimensions(dominantLine) : "";
  const readableEvidence = binding.evidence
    .filter((line) => !line.includes("dominant"))
    .filter((line) => !extractSourceEvidence(line).length)
    .map((line) => formatTechnicalLine(shorten(line, 130)));

  return uniqueList([
    sourceLine ? `代码位置：${sourceLine}。` : "",
    dominantDimensions ? `分析维度：${dominantDimensions}。DeepWeb 会综合这些维度判断主问题。` : "",
    ...readableEvidence,
  ]).slice(0, 4);
}

function formatTechnicalLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes("代码错误解析：")) return trimmed;
  const explanation = plainExplanationForLine(trimmed);
  const separator = /[。.!?]$/.test(trimmed) ? " " : "。";
  return productTerminology(`${trimmed}${separator}代码错误解析：${explanation}`);
}

function plainExplanationForLine(line: string) {
  const normalized = line.toLocaleLowerCase();
  if (/sql|query|orm|数据库/.test(normalized)) return "外部输入可能未经参数绑定就进入查询语句，攻击者可以改变查询结构；应检查实际调用是否使用占位符、ORM 安全构造器或输入白名单。";
  if (/命令|shell|exec|spawn/.test(normalized)) return "输入可能参与系统命令或子进程参数构造，若缺少白名单和参数隔离，外部数据就可能被解释为可执行指令。";
  if (/csrf|origin|referer|samesite/.test(normalized)) return "写操作缺少请求来源或令牌校验时，第三方页面可能借用用户会话发起未授权操作。";
  if (/重复 i\/o|重复.*读|重复.*写|n\+1/.test(normalized)) return "同一处理路径可能反复访问磁盘、网络或数据库，数据量增加后等待时间会按调用次数放大。";
  if (/缓存|cache/.test(normalized)) return "相同输入可能被重复计算或读取；若结果可复用且失效条件明确，缓存可以减少重复工作，但需要验证一致性和内存上限。";
  if (/线性扫描|索引/.test(normalized)) return "查找操作可能每次遍历整个集合，集合增长后耗时随元素数量上升；建立索引或映射可降低重复查找成本。";
  if (/集合增长|容量|内存|buffer|array|list/.test(normalized)) return "容器缺少明确上限或释放路径，持续输入可能增加内存占用并拖慢后续处理。";
  if (/重试|retry|退避/.test(normalized)) return "失败后若立即或无限重试，会放大下游故障和资源占用；需要限制次数、设置超时并采用退避策略。";
  if (/循环|闭环|recursive|递归/.test(normalized)) return "调用可能回到上游或重复进入自身，若终止条件不能随每轮执行收敛，流程可能无法结束或重复产生副作用。";
  if (/输入|验证|权限|边界/.test(normalized)) return "数据在进入关键处理前没有发现明确的类型、范围、权限或格式约束，因此异常输入可能改变后续分支或到达敏感操作。";
  if (line.startsWith("节点状态：")) return "当前函数的返回、异常或输入边界存在未闭合迹象，所以被列为需要检查的处理节点。";
  if (line.startsWith("容量依据：") || line.startsWith("负载估计：")) return "函数复杂度、集合规模或调用次数偏高，因此输入增长时更容易出现延迟或资源压力；该结论仍需运行测量确认。";
  if (line.startsWith("置信度来源：")) return "现有 AST、类型或运行证据不足以排除其他解释，所以该结论不能直接当作确定错误。";
  if (line.startsWith("置信度低：")) return "解析器缺少足够的类型或运行轨迹，当前模式可能是误报，需要补充编译或执行证据。";
  if (line.startsWith("水路开放：") || line.startsWith("返回或调用链不完整：")) return "函数可能缺少明确返回、错误处理或后续调用，数据处理链不完整。";
  if (line.startsWith("容量风险：") || line.startsWith("负载风险：")) return "输入变大时函数可能变慢，或超过缓存、数组、队列及内存限制。";
  if (line.startsWith("堵塞风险：")) return "不同输入可能让流程卡住、循环不出或等待太久。";
  if (line.startsWith("水系关系：") || line.startsWith("调用关系：")) return "这是函数的上游调用数和下游调用数，用来判断入口、聚合、分支和出口职责。";
  if (line.startsWith("诊断：")) return "函数中的代码模式符合该风险的触发条件，若输入确实能到达相关操作，就可能产生这里描述的错误。";
  if (line.startsWith("规则证据：")) return "函数命中了该规则描述的代码模式；百分比表示证据强弱，不等于问题已经发生。";
  if (line.startsWith("修正建议：")) return "这是优先尝试的修复方向，后续应该用运行样本或 benchmark 验证。";
  if (line.includes("返流/闭环")) return "这表示下游函数可能再次调用上游函数，需要检查循环终止条件和重复副作用。";
  if (line.includes("上游函数流向下游函数")) return "这表示前一个函数的结果或状态会进入后一个函数。";
  if (/call|channel|edge|function/i.test(line)) return "这是本地解析到的函数调用或数据连接证据。";
  return "当前函数同时出现了这项代码模式与相关数据流关系，因此系统把它列为候选原因；是否构成真实错误仍需结合上下文、类型信息和运行结果确认。";
}

function codeDiagnosticDetailLines(details: string[]) {
  return uniqueList(details.map((line) => productTerminology(line
    .replace(/^容量依据：/, "负载估计：")
    .replace(/^容量风险：/, "负载风险：")
    .replace(/^水路开放：/, "返回或调用链不完整：")
    .replace(/^水系关系：/, "调用关系：")
    .replace(/水路/g, "数据传递关系")
    .replace(/水系图/g, "调用图"))));
}

function SuggestedCodePanel({
  targetName,
  details,
  binding,
  evidence,
}: {
  targetName: string;
  details: string[];
  binding?: WaterDeepWebBinding;
  evidence: string;
}) {
  const suggestion = buildSuggestedCode(targetName, details, binding, evidence);
  return (
    <details className="suggested-code-panel">
      <summary>建议代码</summary>
      <p>{suggestion.reason}</p>
      <pre><code>{suggestion.code}</code></pre>
      <small>{suggestion.validation}</small>
    </details>
  );
}

function buildSuggestedCode(targetName: string, details: string[], binding: WaterDeepWebBinding | undefined, evidence: string) {
  const text = `${details.join(" ")} ${binding?.predictedClass ?? ""} ${binding?.recommendations.join(" ") ?? ""}`;
  const language = inferSuggestionLanguage(evidence);
  const security = /sql|注入|security|权限|不可信输入|命令|xss|csrf/i.test(text) || text.includes("外部" + "输入");
  const stability = /超时|异常|资源释放|stability|阻塞|重试|事务/i.test(text);
  const performance = /性能|复杂度|重复 i\/o|n\+1|缓存|分页|performance/i.test(text);
  const code = security
    ? securitySuggestion(language, targetName)
    : stability
      ? stabilitySuggestion(language, targetName)
      : performance
        ? performanceSuggestion(language, targetName)
        : boundarySuggestion(language, targetName);
  return {
    reason: security
      ? "候选修复把不可信输入校验和参数化调用放在危险操作之前。"
      : stability
        ? "候选修复增加超时、异常出口和资源释放边界。"
        : performance
          ? "候选修复减少重复计算或逐条 I/O，并保留基准测试入口。"
          : "候选修复补齐输入检查、明确返回和异常出口。",
    code,
    validation: "这是根据当前语言和规则命中生成的候选代码，不会自动写入源文件。应用前必须在项目副本中编译、测试，并比较安全、性能和行为差异。",
  };
}

function inferSuggestionLanguage(evidence: string) {
  if (/\.py:\d+|python|pyright/i.test(evidence)) return "python";
  if (/\.rs:\d+|rust/i.test(evidence)) return "rust";
  if (/\.go:\d+|gopls|golang/i.test(evidence)) return "go";
  if (/\.java:\d+|jdt/i.test(evidence)) return "java";
  if (/\.(?:c|cc|cpp|h|hpp):\d+|clang/i.test(evidence)) return "cpp";
  return "typescript";
}

function securitySuggestion(language: string, target: string) {
  if (language === "python") return `def ${safeIdentifier(target)}(db, user_input: str):\n    value = user_input.strip()\n    if not value or len(value) > 256:\n        raise ValueError("invalid input")\n    return db.execute(\n        text("SELECT * FROM items WHERE name = :name"),\n        {"name": value},\n    ).all()`;
  if (language === "java") return `String sql = "SELECT * FROM items WHERE name = ?";\ntry (PreparedStatement stmt = connection.prepareStatement(sql)) {\n    stmt.setString(1, validatedInput);\n    try (ResultSet rows = stmt.executeQuery()) {\n        return mapRows(rows);\n    }\n}`;
  if (language === "go") return `func ${exportedIdentifier(target)}(ctx context.Context, db *sql.DB, input string) ([]Item, error) {\n    if strings.TrimSpace(input) == "" || len(input) > 256 {\n        return nil, ErrInvalidInput\n    }\n    rows, err := db.QueryContext(ctx, "SELECT * FROM items WHERE name = ?", input)\n    if err != nil { return nil, err }\n    defer rows.Close()\n    return scanItems(rows)\n}`;
  if (language === "rust") return `pub async fn ${safeIdentifier(target)}(pool: &PgPool, input: &str) -> Result<Vec<Item>> {\n    let value = input.trim();\n    ensure!(!value.is_empty() && value.len() <= 256, "invalid input");\n    sqlx::query_as!(Item, "SELECT * FROM items WHERE name = $1", value)\n        .fetch_all(pool)\n        .await\n}`;
  if (language === "cpp") return `Result ${safeIdentifier(target)}(Database& db, std::string_view input) {\n    if (input.empty() || input.size() > 256) return Error::InvalidInput;\n    auto statement = db.prepare("SELECT * FROM items WHERE name = ?");\n    statement.bind(1, input);\n    return statement.query();\n}`;
  return `async function ${safeIdentifier(target)}(db: Database, rawInput: string) {\n  const input = rawInput.trim();\n  if (!input || input.length > 256) throw new Error("Invalid input");\n  return db.query("SELECT * FROM items WHERE name = ?", [input]);\n}`;
}

function stabilitySuggestion(language: string, target: string) {
  if (language === "python") return `async def ${safeIdentifier(target)}(resource):\n    try:\n        async with asyncio.timeout(5):\n            return await run_operation(resource)\n    except TimeoutError as error:\n        raise OperationTimeout() from error\n    finally:\n        await resource.aclose()`;
  if (language === "go") return `func ${exportedIdentifier(target)}(parent context.Context, resource io.Closer) (Result, error) {\n    ctx, cancel := context.WithTimeout(parent, 5*time.Second)\n    defer cancel()\n    defer resource.Close()\n    return runOperation(ctx)\n}`;
  if (language === "rust") return `pub async fn ${safeIdentifier(target)}(resource: Resource) -> Result<Output> {\n    let result = tokio::time::timeout(Duration::from_secs(5), run_operation(&resource)).await;\n    resource.close().await?;\n    result.map_err(|_| Error::Timeout)?\n}`;
  return `async function ${safeIdentifier(target)}(resource: Resource) {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), 5_000);\n  try {\n    return await runOperation(resource, { signal: controller.signal });\n  } finally {\n    clearTimeout(timeout);\n    await resource.close();\n  }\n}`;
}

function performanceSuggestion(language: string, target: string) {
  if (language === "python") return `def ${safeIdentifier(target)}(db, ids: list[int]):\n    unique_ids = list(dict.fromkeys(ids))\n    # One batched query replaces repeated per-item I/O.\n    return db.query(Item).filter(Item.id.in_(unique_ids)).all()`;
  if (language === "go") return `func ${exportedIdentifier(target)}(ctx context.Context, ids []int64) ([]Item, error) {\n    uniqueIDs := deduplicate(ids)\n    return repository.FindMany(ctx, uniqueIDs) // one batched I/O\n}`;
  return `async function ${safeIdentifier(target)}(ids: string[]) {\n  const uniqueIds = [...new Set(ids)];\n  // One batched request replaces repeated per-item I/O.\n  return repository.findMany({ where: { id: { in: uniqueIds } } });\n}`;
}

function boundarySuggestion(language: string, target: string) {
  if (language === "python") return `def ${safeIdentifier(target)}(payload):\n    validated = validate_payload(payload)\n    if validated is None:\n        raise ValueError("invalid payload")\n    result = process(validated)\n    return result`;
  if (language === "go") return `func ${exportedIdentifier(target)}(input Input) (Output, error) {\n    if err := input.Validate(); err != nil { return Output{}, err }\n    result, err := process(input)\n    if err != nil { return Output{}, fmt.Errorf("process input: %w", err) }\n    return result, nil\n}`;
  return `function ${safeIdentifier(target)}(input: Input): Output {\n  const validated = validateInput(input);\n  if (!validated.ok) throw new ValidationError(validated.issues);\n  const result = processInput(validated.value);\n  return result;\n}`;
}

function safeIdentifier(value: string) {
  return value.split("->")[0].trim().replace(/[^a-zA-Z0-9_]/g, "_") || "applyFix";
}

function exportedIdentifier(value: string) {
  const identifier = safeIdentifier(value);
  return identifier.charAt(0).toUpperCase() + identifier.slice(1);
}

function actionForDeepWebLabel(label: string) {
  const actions: Record<string, string> = {
    safe: "保持当前证据，继续积累运行样本。",
    flow_warning: "补清输入输出、返回出口和异常出口。",
    security_risk: "先检查权限、输入校验和危险 sink。",
    stability_risk: "先补超时、异常出口和资源释放。",
    performance_hotspot: "先做 benchmark，再替换热点算法或 I/O 策略。",
    repair_candidate: "先在沙箱验证修复配方。",
  };
  return actions[label] ?? "先补类型、运行轨迹和规则证据。";
}

function stripRecommendationPrefix(line: string) {
  return line.replace(/^建议：/, "");
}

function extractSourceEvidence(line: string) {
  return Array.from(line.matchAll(/([\w./-]+:\d+ · [^；;]+ · complexity \d+)/g)).map((match) => match[1]);
}

function translateDominantDimensions(line: string) {
  const match = line.match(/dominant\s+([^；;]+)/i);
  if (!match) return "";
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(deepWebDimensionText)
    .join("、");
}

function deepWebDimensionText(dimension: string) {
  const names: Record<string, string> = {
    security: "安全",
    repair: "修复",
    data_flow: "数据流",
    language: "语言语义",
    stability: "稳定性",
    performance: "性能",
    runtime: "运行轨迹",
    dependency: "依赖版本",
    benchmark: "性能基准",
    hardware: "硬件边界",
    environment: "运行环境",
    type: "类型",
    ast: "AST结构",
    lexical: "词法信号",
    control_flow: "控制流",
  };
  return names[dimension] ?? dimension;
}

function uniqueList(lines: string[]) {
  return Array.from(new Set(lines.filter(Boolean)));
}

function buildDeepWebRuleProfile(ruleDetails: string[], binding: WaterDeepWebBinding): { alignment: DeepWebRuleAlignment; summary: string } {
  const ruleCount = ruleDetails.filter((detail) => /规则证据|诊断|修正建议/.test(detail)).length;
  const ruleLabels = inferRuleLabels(ruleDetails.join(" "));
  const activeLabel = normalizeDeepWebLabel(binding.teacherLabel ?? binding.predictedClass);
  const labelText = deepWebLabelText(activeLabel);

  if (!ruleLabels.length) {
    return {
      alignment: "insufficient",
      summary: "规则分类不足，DeepWeb 使用候选融合结论。",
    };
  }

  if (ruleLabels.includes(activeLabel)) {
    const secondary = ruleLabels.filter((label) => label !== activeLabel);
    return {
      alignment: secondary.length ? "mixed" : "aligned",
      summary: secondary.length
        ? `命中 ${ruleCount} 条；主=${labelText}；次级=${secondary.map(deepWebLabelText).join("、")}。`
        : `命中 ${ruleCount} 条；主=${labelText}。`,
    };
  }

  return {
    alignment: "conflict",
    summary: `规则偏向 ${ruleLabels.map(deepWebLabelText).join("、")}；DeepWeb 主=${labelText}，需补证据。`,
  };
}

function inferRuleLabels(text: string) {
  const labels: string[] = [];
  const hasInboundInputSecuritySignal = text.includes("外部" + "输入");
  if (/sql|csrf|xss|权限|认证|鉴权|token|注入|命令|dom|sink|路径|白名单|origin|referer/i.test(text) || hasInboundInputSecuritySignal) {
    labels.push("security_risk");
  }
  if (/超时|重试|事务|锁|deadlock|资源释放|异常|失败出口|稳定|阻塞/i.test(text)) {
    labels.push("stability_risk");
  }
  if (/复杂度|n\+1|重复 i\/o|性能|缓存|benchmark|吞吐|效率|分页|批量/i.test(text)) {
    labels.push("performance_hotspot");
  }
  if (/溢流|容量|闭环|断点|返回|出口|水路|流向|开放|未闭合/i.test(text)) {
    labels.push("flow_warning");
  }
  if (/修正建议|替换|增加|使用|设置|校验|避免/i.test(text)) {
    labels.push("repair_candidate");
  }
  return Array.from(new Set(labels));
}

function normalizeDeepWebLabel(label: string) {
  return label.includes("security")
    ? "security_risk"
    : label.includes("stability")
      ? "stability_risk"
      : label.includes("performance")
        ? "performance_hotspot"
        : label.includes("repair")
          ? "repair_candidate"
          : label.includes("flow")
            ? "flow_warning"
            : "safe";
}

function deepWebLabelText(label: string) {
  const names: Record<string, string> = {
    safe: "安全/正常",
    flow_warning: "流向问题",
    security_risk: "安全风险",
    stability_risk: "稳定性风险",
    performance_hotspot: "性能热点",
    repair_candidate: "修复候选",
  };
  return names[label] ?? label;
}

function deepWebImpactText(binding: WaterDeepWebBinding) {
  if (!binding.confidenceImpact && !binding.knowledgeScoreImpact && !binding.fitnessImpact) return "无扣分";
  return `置信 -${binding.confidenceImpact} / 知识 -${binding.knowledgeScoreImpact} / 适应 -${binding.fitnessImpact}`;
}

function nodeShape(capacity: NonNullable<FlowNode["capacity"]>) {
  if (capacity === "湖") return <ellipse className="network-shape" cx="0" cy="0" rx="58" ry="34" />;
  if (capacity === "水库") return <rect className="network-shape" x="-58" y="-30" width="116" height="60" rx="8" />;
  if (capacity === "水池") return <rect className="network-shape" x="-50" y="-27" width="100" height="54" rx="16" />;
  if (capacity === "河道") return <ellipse className="network-shape" cx="0" cy="0" rx="50" ry="28" />;
  return <rect className="network-shape" x="-38" y="-22" width="76" height="44" rx="22" />;
}

function edgePath(
  from: FlowNode,
  to: FlowNode,
  edge: FlowEdge,
  edgeMode: EdgeMode,
  confluencePoints: Map<string, ConfluencePoint>,
  bifurcationPoints: Map<string, BifurcationPoint>,
) {
  const fromX = from.x ?? 0;
  const fromY = from.y ?? 0;
  const toX = to.x ?? 0;
  const toY = to.y ?? 0;
  const dx = toX - fromX;
  const horizontal = Math.abs(dx);

  if (edge.kind === "闭环线路" || toX <= fromX - 24) {
    const lift = Math.max(54, Math.abs(toY - fromY) + 42);
    return `M ${fromX} ${fromY} C ${fromX + 64} ${fromY - lift}, ${toX - 64} ${toY - lift}, ${toX} ${toY}`;
  }

  const confluencePoint = confluencePoints.get(to.id);
  const bifurcationPoint = bifurcationPoints.get(from.id);
  if (edgeMode === "confluence" && (confluencePoint || bifurcationPoint)) {
    const startX = bifurcationPoint?.x ?? fromX;
    const startY = bifurcationPoint?.y ?? fromY;
    const endX = confluencePoint?.x ?? toX;
    const endY = confluencePoint?.y ?? toY;
    const bend = Math.max(46, Math.min(120, Math.abs(endX - startX) * 0.28));
    const direction = endX >= startX ? 1 : -1;
    return `M ${startX} ${startY} C ${startX + bend * direction} ${startY}, ${endX - bend * direction} ${endY}, ${endX} ${endY}`;
  }

  if (!edge.primary && horizontal > 130) {
    const bendX = Math.min(92, Math.max(42, horizontal * 0.22));
    const route = routeY(from, to, edge);
    const direction = dx >= 0 ? 1 : -1;
    const midX = (fromX + toX) / 2;
    return `M ${fromX} ${fromY} C ${fromX + bendX * direction} ${fromY}, ${fromX + bendX * direction} ${route}, ${midX} ${route} C ${toX - bendX * direction} ${route}, ${toX - bendX * direction} ${toY}, ${toX} ${toY}`;
  }

  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2 + (edge.primary ? Math.sin((fromX + toX) / 150) * 18 : 0);
  const curve = edge.primary ? 68 : 46;
  return `M ${fromX} ${fromY} C ${midX - curve} ${fromY}, ${midX - curve / 2} ${midY}, ${midX} ${midY} C ${midX + curve / 2} ${midY}, ${midX + curve} ${toY}, ${toX} ${toY}`;
}

function buildLayerRoutingTerrain(
  nodes: FlowNode[],
  edges: FlowEdge[],
  sharedChannels: AlluvialCorridor[],
): VirtualRoutingTerrain | null {
  if (!nodes.length || nodes.some((node) => node.fanLayerRadius === undefined)) return null;
  const origin = { x: nodes[0]?.fanOriginX ?? 190, y: nodes[0]?.fanOriginY ?? 190 };
  const nodesByDepth = new Map<number, FlowNode[]>();
  nodes.forEach((node) => {
    const depth = node.depth ?? 0;
    nodesByDepth.set(depth, [...(nodesByDepth.get(depth) ?? []), node]);
  });
  const depths = Array.from(nodesByDepth.keys()).sort((a, b) => a - b);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const strips: LayerRoutingStrip[] = [];
  for (let index = 0; index < depths.length - 1; index += 1) {
    const fromDepth = depths[index]!;
    const toDepth = depths[index + 1]!;
    const fromNodes = nodesByDepth.get(fromDepth) ?? [];
    const toNodes = nodesByDepth.get(toDepth) ?? [];
    const fromRadius = fromNodes[0]?.fanLayerRadius ?? fromNodes[0]?.fanRadius ?? 0;
    const toRadius = toNodes[0]?.fanLayerRadius ?? toNodes[0]?.fanRadius ?? fromRadius + 200;
    const fromClearance = Math.max(...fromNodes.map((node) => hitRadius(node.capacity ?? inferNodeCapacity(node))), 48) + 30;
    const toClearance = Math.max(...toNodes.map((node) => hitRadius(node.capacity ?? inferNodeCapacity(node))), 48) + 30;
    const corridors: RoutingCorridor[] = [{ id: `main-${fromDepth}-${toDepth}`, angle: Math.PI / 4, kind: "main", edgeIds: [] }];
    const basinNodes = new Map<string, FlowNode[]>();
    [...fromNodes, ...toNodes].forEach((node) => {
      const basin = node.basin ?? "default";
      basinNodes.set(basin, [...(basinNodes.get(basin) ?? []), node]);
    });
    basinNodes.forEach((basinLayerNodes, basin) => {
      const angles = basinLayerNodes.map((node) => node.fanAngle ?? Math.PI / 4).sort((a, b) => a - b);
      corridors.push({
        id: `basin-${basin}-${fromDepth}-${toDepth}`,
        angle: angles[Math.floor(angles.length / 2)] ?? Math.PI / 4,
        basin,
        kind: "basin",
        edgeIds: [],
      });
    });
    sharedChannels.forEach((channel) => {
      const channelEdges = channel.edgeIds.map((id) => edges.find((edge) => edge.id === id)).filter((edge): edge is FlowEdge => Boolean(edge));
      if (!channelEdges.some((edge) => {
        const sourceDepth = nodeMap.get(edge.from)?.depth ?? 0;
        const targetDepth = nodeMap.get(edge.to)?.depth ?? sourceDepth;
        return sourceDepth <= fromDepth && targetDepth >= toDepth;
      })) return;
      corridors.push({
        id: `shared-${channel.id}-${fromDepth}-${toDepth}`,
        angle: Math.atan2(channel.marker.y - origin.y, channel.marker.x - origin.x),
        kind: "shared",
        edgeIds: channel.edgeIds,
      });
    });
    strips.push({
      id: `strip-${fromDepth}-${toDepth}`,
      fromDepth,
      toDepth,
      minRadius: fromRadius + fromClearance,
      maxRadius: Math.max(fromRadius + fromClearance + 24, toRadius - toClearance),
      corridors,
    });
  }
  return { origin, strips };
}

function buildTerrainRoutes(
  nodes: FlowNode[],
  edges: FlowEdge[],
  edgeMode: EdgeMode,
  confluencePoints: Map<string, ConfluencePoint>,
  bifurcationPoints: Map<string, BifurcationPoint>,
  mergePorts: Map<string, FlowPort>,
  splitPorts: Map<string, FlowPort>,
  fanLevel: "overview" | "module" | "detail",
  routingTerrain: VirtualRoutingTerrain | null,
  bundledEdgeIds: Set<string>,
) {
  const routes = new Map<string, TerrainRoute>();
  if (edgeMode !== "confluence" && edgeMode !== "fan") return routes;
  if (edgeMode === "fan") {
    return buildPolarTerrainRoutes(
      nodes,
      edges.filter((edge) => !bundledEdgeIds.has(edge.id)),
      confluencePoints,
      bifurcationPoints,
      mergePorts,
      splitPorts,
      fanLevel,
      routingTerrain,
    );
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const occupied: Array<{ left: number; right: number; y: number }> = [];
  const maxLaneY = Math.max(620, ...nodes.map((node) => (node.y ?? 0) + hitRadius(node.capacity ?? inferNodeCapacity(node)) + 110));
  const candidates = edges
    .map((edge) => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) return null;
      const start = splitPorts.get(edge.id) ?? bifurcationPoints.get(edge.from) ?? { x: from.x ?? 0, y: from.y ?? 0 };
      const end = mergePorts.get(edge.id) ?? confluencePoints.get(edge.to) ?? { x: to.x ?? 0, y: to.y ?? 0 };
      return { edge, from, to, start, end };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => {
      const aBackward = a.end.x <= a.start.x ? 1 : 0;
      const bBackward = b.end.x <= b.start.x ? 1 : 0;
      return aBackward - bBackward || a.start.x - b.start.x || a.start.y - b.start.y || a.end.y - b.end.y;
    });

  candidates.forEach(({ edge, start, end }) => {
    if (edge.kind === "闭环线路" || end.x <= start.x + 28) {
      const top = Math.min(start.y, end.y);
      const lift = 76 + (stableHash(edge.id) % 4) * 30;
      const laneY = Math.max(42, top - lift);
      const path = `M ${start.x} ${start.y} C ${start.x + 56} ${laneY}, ${end.x - 56} ${laneY}, ${end.x} ${end.y}`;
      routes.set(edge.id, { path, marker: cubicMidpoint(start.x, start.y, start.x + 56, laneY, end.x - 56, laneY, end.x, end.y), laneY });
      return;
    }

    const left = start.x;
    const right = end.x;
    const ideal = (start.y + end.y) / 2;
    const laneStep = 28;
    const shoulder = Math.max(34, Math.min(68, (right - left) * 0.18));
    let laneY = ideal;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const ring = Math.ceil(attempt / 2);
      const direction = attempt % 2 === 0 ? 1 : -1;
      const candidateY = Math.max(42, Math.min(maxLaneY, ideal + ring * laneStep * direction));
      const crossesNode = nodes.some((node) => {
        if (node.id === edge.from || node.id === edge.to) return false;
        const point = { x: node.x ?? 0, y: node.y ?? 0 };
        const clearance = hitRadius(node.capacity ?? inferNodeCapacity(node)) + 22;
        const startLane = { x: left + shoulder, y: candidateY };
        const endLane = { x: right - shoulder, y: candidateY };
        return Math.min(
          pointToSegmentDistance(point, start, startLane),
          pointToSegmentDistance(point, startLane, endLane),
          pointToSegmentDistance(point, endLane, end),
        ) < clearance;
      });
      const laneClearance = 30;
      const collides = crossesNode || occupied.some((lane) => left < lane.right + 54 && right > lane.left - 54 && Math.abs(candidateY - lane.y) < laneClearance);
      if (!collides) {
        laneY = candidateY;
        break;
      }
    }
    occupied.push({ left, right, y: laneY });

    const startShoulder = left + shoulder;
    const endShoulder = right - shoulder;
    const path = [
      `M ${left} ${start.y}`,
      `C ${left + shoulder * 0.45} ${start.y}, ${startShoulder - shoulder * 0.35} ${laneY}, ${startShoulder} ${laneY}`,
      `L ${endShoulder} ${laneY}`,
      `C ${endShoulder + shoulder * 0.35} ${laneY}, ${right - shoulder * 0.45} ${end.y}, ${right} ${end.y}`,
    ].join(" ");
    routes.set(edge.id, { path, marker: { x: (startShoulder + endShoulder) / 2, y: laneY }, laneY });
  });

  return routes;
}



function buildPolarTerrainRoutes(
  nodes: FlowNode[],
  edges: FlowEdge[],
  confluencePoints: Map<string, ConfluencePoint>,
  bifurcationPoints: Map<string, BifurcationPoint>,
  mergePorts: Map<string, FlowPort>,
  splitPorts: Map<string, FlowPort>,
  fanLevel: "overview" | "module" | "detail",
  routingTerrain: VirtualRoutingTerrain | null,
) {
  const routes = new Map<string, TerrainRoute>();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const channelGap = fanLevel === "detail" ? 92 : 128;
  const candidates = edges
    .map((edge) => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) return null;
      const start = splitPorts.get(edge.id) ?? bifurcationPoints.get(edge.from) ?? radialNodePort(from, "out");
      const end = mergePorts.get(edge.id) ?? confluencePoints.get(edge.to) ?? radialNodePort(to, "in");
      return { edge, from, to, start, end };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) =>
      Number(Boolean(b.edge.primary)) - Number(Boolean(a.edge.primary)) ||
      (a.from.depth ?? 0) - (b.from.depth ?? 0) ||
      (a.from.fanAngle ?? 0) - (b.from.fanAngle ?? 0) ||
      (a.to.fanAngle ?? 0) - (b.to.fanAngle ?? 0),
    );

  const buildScoredCandidates = (
    item: (typeof candidates)[number],
    fixedRoutes: Array<{ edge: FlowEdge; samples: FlowPort[] }>,
    localRepair: boolean,
  ) => {
    const { edge, from, to, start, end } = item;
    const origin = {
      x: from.fanOriginX ?? to.fanOriginX ?? 150,
      y: from.fanOriginY ?? to.fanOriginY ?? 150,
    };
    const isFeedback = edge.kind === "闭环线路";
    const forward = !isFeedback;
    const offsetCount = localRepair ? 49 : 19;
    const phase = localRepair ? ((stableHash(edge.id) % 5) - 2) * channelGap * 0.28 : 0;
    const offsets = forward
      ? Array.from({ length: offsetCount }, (_, index) => {
        if (index === 0) return 0;
        const ring = Math.ceil(index / 2);
        return phase + (index % 2 === 1 ? ring : -ring) * channelGap;
      })
      : [38, 56, 74, 92, 110, 128];
    return offsets.map((offset) => {
      const candidate = buildPotentialFieldRoute(
        start,
        end,
        origin,
        offset,
        forward,
        edge.from === edge.to,
        edge,
        from,
        to,
        routingTerrain,
      );
      const nodeIntersections = nodes.filter((node) => {
        if (node.id === edge.from || node.id === edge.to) return false;
        const clearance = hitRadius(node.capacity ?? inferNodeCapacity(node)) + 24;
        return candidate.samples.slice(2, -2).some((point) =>
          Math.hypot(point.x - (node.x ?? 0), point.y - (node.y ?? 0)) < clearance,
        );
      }).length;
      const crossings = fixedRoutes.filter((route) => {
        if (route.edge.from === edge.from || route.edge.to === edge.to) return false;
        return polylinesIntersect(candidate.samples.slice(2, -2), route.samples);
      }).length;
      const relevantStripCount = routingTerrain?.strips.filter((strip) =>
        strip.fromDepth >= (from.depth ?? 0) && strip.toDepth <= (to.depth ?? (from.depth ?? 0) + 1),
      ).length ?? 0;
      const routeLength = polylineLength(candidate.samples);
      const localLayerSpacing = Math.max(140, Math.abs((to.fanRadius ?? 0) - (from.fanRadius ?? 0)));
      const depthSpan = Math.max(1, (to.depth ?? 0) - (from.depth ?? 0));
      const longDetour = routeLength > localLayerSpacing * depthSpan * 2.8
        ? routeLength - localLayerSpacing * depthSpan * 2.8
        : 0;
      const score = polarRouteCost(candidate.samples, origin, from, to, nodeIntersections, crossings, forward, offset)
        + virtualTerrainRouteCost(candidate.samples, edge, from, to, routingTerrain)
        + longDetour * 2_800;
      return { candidate, score, nodeIntersections, crossings, stripCount: relevantStripCount, longDetour };
    }).sort((a, b) => a.score - b.score);
  };

  candidates.forEach((item) => {
    const { edge, start, end } = item;
    const fixedRoutes = Array.from(routes.entries()).map(([edgeId, route]) => ({
      edge: edges.find((candidate) => candidate.id === edgeId)!,
      samples: route.samples ?? [],
    })).filter((route) => Boolean(route.edge));
    const scored = buildScoredCandidates(item, fixedRoutes, false);
    const chosen = scored[0];
    const result = chosen!.candidate;
    const marker = result.samples[Math.floor(result.samples.length / 2)] ?? {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
    routes.set(edge.id, {
      path: result.path,
      marker,
      laneY: marker.y,
      fallback: chosen!.nodeIntersections > 0 || chosen!.crossings > 0,
      bounds: routeBounds(result.samples),
      samples: result.samples,
      crossings: chosen!.crossings,
      nodeIntersections: chosen!.nodeIntersections,
      stripCount: chosen!.stripCount,
    });
  });

  // Local repair is deliberately edge-only. It keeps every accepted route as
  // a fixed obstacle and reroutes only segments involved in a crossing,
  // Function intersection or excessive detour.
  for (let pass = 0; pass < 4; pass += 1) {
    const severity = new Map<string, number>();
    const routeEntries = Array.from(routes.entries());
    for (let left = 0; left < routeEntries.length; left += 1) {
      const [leftId, leftRoute] = routeEntries[left]!;
      const leftEdge = edges.find((edge) => edge.id === leftId);
      if (!leftEdge || !leftRoute.samples) continue;
      if ((leftRoute.nodeIntersections ?? 0) > 0) severity.set(leftId, (severity.get(leftId) ?? 0) + 100 + (leftRoute.nodeIntersections ?? 0));
      for (let right = left + 1; right < routeEntries.length; right += 1) {
        const [rightId, rightRoute] = routeEntries[right]!;
        const rightEdge = edges.find((edge) => edge.id === rightId);
        if (!rightEdge || !rightRoute.samples) continue;
        if (leftEdge.from === rightEdge.from || leftEdge.to === rightEdge.to) continue;
        if (!polylinesIntersect(leftRoute.samples.slice(2, -2), rightRoute.samples.slice(2, -2))) continue;
        severity.set(leftId, (severity.get(leftId) ?? 0) + 1);
        severity.set(rightId, (severity.get(rightId) ?? 0) + 1);
      }
    }
    if (!severity.size) break;
    [...severity.entries()].sort((a, b) => b[1] - a[1]).forEach(([edgeId]) => {
      const item = candidates.find((candidate) => candidate.edge.id === edgeId);
      const current = routes.get(edgeId);
      if (!item || !current) return;
      const fixedRoutes = candidates
        .filter((candidate) => candidate.edge.id !== edgeId)
        .map((candidate) => ({ edge: candidate.edge, samples: routes.get(candidate.edge.id)?.samples ?? [] }));
      const alternatives = buildScoredCandidates(item, fixedRoutes, true);
      const chosen = alternatives[0];
      if (!chosen) return;
      const currentSamples = current.samples ?? [];
      const currentCrossings = fixedRoutes.filter((route) => {
        if (route.edge.from === item.edge.from || route.edge.to === item.edge.to) return false;
        return polylinesIntersect(currentSamples.slice(2, -2), route.samples);
      }).length;
      const currentNodeIntersections = current.nodeIntersections ?? 0;
      const improvesHardConstraint = chosen.nodeIntersections < currentNodeIntersections
        || (chosen.nodeIntersections === currentNodeIntersections && chosen.crossings < currentCrossings);
      const improvesEqualRoute = chosen.nodeIntersections === currentNodeIntersections
        && chosen.crossings === currentCrossings
        && polylineLength(chosen.candidate.samples) < polylineLength(currentSamples) * 0.9;
      if (!improvesHardConstraint && !improvesEqualRoute) return;
      const marker = chosen.candidate.samples[Math.floor(chosen.candidate.samples.length / 2)] ?? current.marker;
      routes.set(edgeId, {
        path: chosen.candidate.path,
        marker,
        laneY: marker.y,
        fallback: chosen.nodeIntersections > 0 || chosen.crossings > 0,
        bounds: routeBounds(chosen.candidate.samples),
        samples: chosen.candidate.samples,
        crossings: chosen.crossings,
        nodeIntersections: chosen.nodeIntersections,
        stripCount: chosen.stripCount,
        locallyRerouted: true,
      });
    });
  }

  const finalEntries = Array.from(routes.entries());
  finalEntries.forEach(([edgeId, route]) => {
    const edge = edges.find((candidate) => candidate.id === edgeId);
    if (!edge || !route.samples) return;
    const crossings = finalEntries.filter(([otherId, otherRoute]) => {
      if (otherId === edgeId || !otherRoute.samples) return false;
      const other = edges.find((candidate) => candidate.id === otherId);
      if (!other || other.from === edge.from || other.to === edge.to) return false;
      return polylinesIntersect(route.samples!.slice(2, -2), otherRoute.samples.slice(2, -2));
    }).length;
    routes.set(edgeId, { ...route, crossings, fallback: (route.nodeIntersections ?? 0) > 0 || crossings > 0 });
  });

  return routes;
}

function buildPotentialFieldRoute(
  start: FlowPort,
  end: FlowPort,
  origin: FlowPort,
  laneOffset: number,
  forward: boolean,
  selfLoop: boolean,
  edge: FlowEdge,
  from: FlowNode,
  to: FlowNode,
  terrain: VirtualRoutingTerrain | null,
) {
  if (!terrain || !forward || selfLoop) return buildPolarRoute(start, end, origin, laneOffset, forward, selfLoop);
  const fromDepth = from.depth ?? 0;
  const toDepth = to.depth ?? fromDepth + 1;
  if (toDepth <= fromDepth) return buildPolarRoute(start, end, origin, laneOffset, forward, selfLoop);
  const startAngle = Math.atan2(start.y - origin.y, start.x - origin.x);
  const endAngle = Math.atan2(end.y - origin.y, end.x - origin.x);
  const relevantStrips = terrain.strips.filter((strip) => strip.fromDepth >= fromDepth && strip.toDepth <= toDepth);
  if (!relevantStrips.length) return buildPolarRoute(start, end, origin, laneOffset, forward, selfLoop);

  const points: FlowPort[] = [start];
  relevantStrips.forEach((strip, index) => {
    const progress = (index + 1) / (relevantStrips.length + 1);
    const desiredAngle = startAngle + normalizeAngleDelta(endAngle - startAngle) * progress;
    const matching = strip.corridors
      .map((corridor) => {
        const angularDistance = Math.abs(normalizeAngleDelta(corridor.angle - desiredAngle));
        const sharedBonus = corridor.kind === "shared" && corridor.edgeIds.includes(edge.id) ? -5 : 0;
        const sameBasinBonus = corridor.kind === "basin" && corridor.basin && corridor.basin === from.basin && corridor.basin === to.basin ? -2.4 : 0;
        const mainBonus = corridor.kind === "main" && edge.primary ? -2.8 : 0;
        const incompatiblePenalty = corridor.kind === "shared" && !corridor.edgeIds.includes(edge.id) ? 4.5 : 0;
        const unrelatedBasinPenalty = corridor.kind === "basin" && corridor.basin !== from.basin && corridor.basin !== to.basin ? 3.2 : 0;
        return { corridor, cost: angularDistance * 12 + incompatiblePenalty + unrelatedBasinPenalty + sharedBonus + sameBasinBonus + mainBonus };
      })
      .sort((a, b) => a.cost - b.cost)[0]?.corridor;
    const radius = (strip.minRadius + strip.maxRadius) / 2;
    const laneAngle = laneOffset / Math.max(260, radius) * 0.62;
    points.push(polarPoint(origin, radius, (matching?.angle ?? desiredAngle) + laneAngle));
  });
  points.push(end);
  return smoothRouteThrough(points);
}

function virtualTerrainRouteCost(
  samples: FlowPort[],
  edge: FlowEdge,
  from: FlowNode,
  to: FlowNode,
  terrain: VirtualRoutingTerrain | null,
) {
  if (!terrain) return 0;
  let cost = 0;
  terrain.strips.forEach((strip) => {
    if (strip.fromDepth < (from.depth ?? 0) || strip.toDepth > (to.depth ?? (from.depth ?? 0) + 1)) return;
    const stripSamples = samples.filter((point) => {
      const radius = Math.hypot(point.x - terrain.origin.x, point.y - terrain.origin.y);
      return radius >= strip.minRadius && radius <= strip.maxRadius;
    });
    if (!stripSamples.length) return;
    const routeAngle = stripSamples.reduce(
      (sum, point) => sum + Math.atan2(point.y - terrain.origin.y, point.x - terrain.origin.x),
      0,
    ) / stripSamples.length;
    const nearest = [...strip.corridors].sort((a, b) =>
      Math.abs(normalizeAngleDelta(a.angle - routeAngle)) - Math.abs(normalizeAngleDelta(b.angle - routeAngle)),
    )[0];
    if (!nearest) return;
    const distance = Math.abs(normalizeAngleDelta(nearest.angle - routeAngle));
    cost += distance * 1_400;
    if (nearest.kind === "shared") {
      cost += nearest.edgeIds.includes(edge.id) ? -18_000 : 42_000;
    } else if (nearest.kind === "basin") {
      cost += nearest.basin === from.basin || nearest.basin === to.basin ? -4_500 : 24_000;
    } else if (nearest.kind === "main" && edge.primary) {
      cost -= 8_000;
    }
  });
  return cost;
}

function polarRouteCost(
  samples: FlowPort[],
  origin: FlowPort,
  from: FlowNode,
  to: FlowNode,
  nodeIntersections: number,
  crossings: number,
  forward: boolean,
  laneOffset: number,
) {
  let length = 0;
  let angularTravel = 0;
  let backwardRadial = 0;
  let sharpTurns = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    length += Math.hypot(current.x - previous.x, current.y - previous.y);
    const previousRadius = Math.hypot(previous.x - origin.x, previous.y - origin.y);
    const currentRadius = Math.hypot(current.x - origin.x, current.y - origin.y);
    if (forward && currentRadius + 1 < previousRadius) backwardRadial += previousRadius - currentRadius;
    angularTravel += Math.abs(normalizeAngleDelta(
      Math.atan2(current.y - origin.y, current.x - origin.x) - Math.atan2(previous.y - origin.y, previous.x - origin.x),
    )) * Math.max(120, (previousRadius + currentRadius) / 2);
    if (index > 1) {
      const before = samples[index - 2]!;
      const angleA = Math.atan2(previous.y - before.y, previous.x - before.x);
      const angleB = Math.atan2(current.y - previous.y, current.x - previous.x);
      const turn = Math.abs(normalizeAngleDelta(angleB - angleA));
      if (turn > 0.7) sharpTurns += turn;
    }
  }
  const basinExit = from.basin && to.basin && from.basin !== to.basin ? 1 : 0;
  const radialAlignmentBonus = Math.max(0, length - angularTravel) * 0.22;
  return length
    + crossings * 1_000_000
    + nodeIntersections * 1_000_000
    + backwardRadial * 12_000
    + angularTravel * 9
    + basinExit * Math.abs(laneOffset) * 140
    + sharpTurns * 8_000
    - radialAlignmentBonus;
}

function radialNodePort(node: FlowNode, direction: "in" | "out") {
  const origin = { x: node.fanOriginX ?? 0, y: node.fanOriginY ?? 0 };
  const angle = node.fanAngle ?? Math.atan2((node.y ?? 0) - origin.y, (node.x ?? 0) - origin.x);
  const radius = hitRadius(node.capacity ?? inferNodeCapacity(node));
  const sign = direction === "in" ? -1 : 1;
  return {
    x: (node.x ?? 0) + Math.cos(angle) * radius * sign,
    y: (node.y ?? 0) + Math.sin(angle) * radius * sign,
  };
}

function buildPolarRoute(
  start: FlowPort,
  end: FlowPort,
  origin: FlowPort,
  laneOffset: number,
  forward: boolean,
  selfLoop: boolean,
) {
  const startRadius = Math.hypot(start.x - origin.x, start.y - origin.y);
  const endRadius = Math.hypot(end.x - origin.x, end.y - origin.y);
  const startAngle = Math.atan2(start.y - origin.y, start.x - origin.x);
  const endAngle = Math.atan2(end.y - origin.y, end.x - origin.x);
  if (selfLoop) {
    const loopRadius = startRadius + Math.max(54, laneOffset);
    const angleSpan = 0.11;
    return smoothRouteThrough([
      start,
      polarPoint(origin, loopRadius, startAngle - angleSpan),
      polarPoint(origin, loopRadius + 34, startAngle),
      polarPoint(origin, loopRadius, startAngle + angleSpan),
      end,
    ]);
  }

  const delta = normalizeAngleDelta(endAngle - startAngle);
  if (forward) {
    if (endRadius <= startRadius + 24) {
      const localRadius = Math.max(startRadius, endRadius) + 34 + Math.abs(laneOffset) * 0.45;
      return smoothRouteThrough([
        start,
        polarPoint(origin, localRadius, startAngle + delta * 0.28),
        polarPoint(origin, localRadius + 12, startAngle + delta * 0.72),
        end,
      ]);
    }
    const radialSpan = Math.max(1, endRadius - startRadius);
    const steps = Math.abs(delta) > 0.5 ? 7 : Math.abs(delta) > 0.24 ? 5 : 4;
    const points: FlowPort[] = [start];
    for (let step = 1; step < steps; step += 1) {
      const progress = step / steps;
      const easedAngleProgress = Math.abs(delta) > 0.45
        ? Math.pow(progress, 1.65)
        : progress * progress * (3 - 2 * progress);
      const radius = startRadius + radialSpan * progress;
      const laneAngle = (laneOffset / Math.max(220, radius)) * Math.sin(Math.PI * progress);
      points.push(polarPoint(origin, radius, startAngle + delta * easedAngleProgress + laneAngle));
    }
    points.push(end);
    return smoothRouteThrough(points);
  }

  const outerRadius = Math.max(startRadius, endRadius) + Math.max(58, laneOffset);
  const feedbackDelta = Math.max(-0.7, Math.min(0.7, delta));
  return smoothRouteThrough([
    start,
    polarPoint(origin, outerRadius, startAngle),
    polarPoint(origin, outerRadius, startAngle + feedbackDelta * 0.5),
    polarPoint(origin, outerRadius, endAngle),
    end,
  ]);
}

function polarPoint(origin: FlowPort, radius: number, angle: number) {
  return { x: origin.x + radius * Math.cos(angle), y: origin.y + radius * Math.sin(angle) };
}

function normalizeAngleDelta(delta: number) {
  let normalized = delta;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}






function smoothRouteThrough(points: FlowPort[]) {
  if (points.length < 2) return { path: "", samples: [] as FlowPort[] };
  const segments = points.slice(1).map((point, index) => {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = point;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    const controlA = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const controlB = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    return { start: p1, controlA, controlB, end: p2 };
  });
  const path = [`M ${points[0]!.x} ${points[0]!.y}`, ...segments.map(({ controlA, controlB, end }) => `C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`)].join(" ");
  const samples = segments.flatMap((segment, segmentIndex) => Array.from({ length: 9 }, (_, index) => {
    if (segmentIndex > 0 && index === 0) return null;
    return cubicPoint(segment.start, segment.controlA, segment.controlB, segment.end, index / 8);
  }).filter((point): point is FlowPort => Boolean(point)));
  return { path, samples };
}

function routeBounds(points: FlowPort[]) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function polylineLength(points: FlowPort[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  }
  return length;
}

function cubicPoint(start: FlowPort, controlA: FlowPort, controlB: FlowPort, end: FlowPort, t: number) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * start.x + 3 * mt ** 2 * t * controlA.x + 3 * mt * t ** 2 * controlB.x + t ** 3 * end.x,
    y: mt ** 3 * start.y + 3 * mt ** 2 * t * controlA.y + 3 * mt * t ** 2 * controlB.y + t ** 3 * end.y,
  };
}

function cubicMidpoint(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  const t = 0.5;
  const mt = 1 - t;
  return {
    x: mt ** 3 * x0 + 3 * mt ** 2 * t * x1 + 3 * mt * t ** 2 * x2 + t ** 3 * x3,
    y: mt ** 3 * y0 + 3 * mt ** 2 * t * y1 + 3 * mt * t ** 2 * y2 + t ** 3 * y3,
  };
}

function pointToSegmentDistance(point: FlowPort, start: FlowPort, end: FlowPort) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function polylinesIntersect(first: FlowPort[], second: FlowPort[]) {
  for (let firstIndex = 1; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 1; secondIndex < second.length; secondIndex += 1) {
      if (segmentsIntersect(first[firstIndex - 1]!, first[firstIndex]!, second[secondIndex - 1]!, second[secondIndex]!)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: FlowPort, b: FlowPort, c: FlowPort, d: FlowPort) {
  const cross = (start: FlowPort, end: FlowPort, point: FlowPort) =>
    (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < -0.01 && cdA * cdB < -0.01;
}

function buildConfluenceLayout(nodes: FlowNode[], edges: FlowEdge[], edgeMode: EdgeMode) {
  const points = new Map<string, ConfluencePoint>();
  const outputPoints = new Map<string, BifurcationPoint>();
  const mergePorts = new Map<string, FlowPort>();
  const splitPorts = new Map<string, FlowPort>();
  const stems: ConfluenceStem[] = [];
  if (edgeMode !== "confluence" && edgeMode !== "fan") return { points, outputPoints, mergePorts, splitPorts, stems };
  if (edgeMode === "fan") return buildRadialConfluenceLayout(nodes, edges);

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, FlowEdge[]>();
  const outgoing = new Map<string, FlowEdge[]>();
  edges.forEach((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to || edge.kind === "闭环线路") return;
    if ((to.x ?? 0) <= (from.x ?? 0) + 24) return;
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  });

  incoming.forEach((targetEdges, targetId) => {
    if (targetEdges.length < 2) return;
    const target = nodeMap.get(targetId);
    if (!target) return;
    const capacity = target.capacity ?? inferNodeCapacity(target);
    const sortedEdges = [...targetEdges].sort((a, b) => {
      const sourceA = nodeMap.get(a.from);
      const sourceB = nodeMap.get(b.from);
      return (sourceA?.y ?? 0) - (sourceB?.y ?? 0) || a.id.localeCompare(b.id);
    });
    const targetX = target.x ?? 0;
    const targetY = target.y ?? 0;
    const span = Math.min(190, Math.max(82, sortedEdges.length * 30));
    const finalPoint = { x: targetX - hitRadius(capacity) - 22, y: targetY };
    const firstPoint = { x: finalPoint.x - span, y: targetY };
    const point = {
      id: `confluence-${targetId}`,
      targetId,
      x: finalPoint.x,
      y: finalPoint.y,
      incomingIds: targetEdges.map((edge) => edge.id),
    };
    points.set(targetId, point);
    const ports = sortedEdges.map((edge, index) => {
      const progress = sortedEdges.length === 1 ? 0 : index / Math.max(1, sortedEdges.length - 1);
      const port = {
        x: firstPoint.x + (finalPoint.x - firstPoint.x) * progress,
        y: firstPoint.y + (finalPoint.y - firstPoint.y) * progress,
      };
      mergePorts.set(edge.id, port);
      return port;
    });
    sortedEdges.forEach((edge, index) => {
      const start = ports[index];
      const end = index + 1 < ports.length ? ports[index + 1] : { x: targetX, y: targetY };
      const participating = sortedEdges.slice(0, index + 1);
      const representativeEdge = [...participating].sort((a, b) => edgeDiagnosticRank(b) - edgeDiagnosticRank(a) || b.volume - a.volume)[0];
      stems.push({
        id: `stem-${targetId}-${index}`,
        nodeId: targetId,
        kind: "merge",
        edgeIds: participating.map((item) => item.id),
        representativeEdge,
        path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      });
    });
  });

  outgoing.forEach((sourceEdges, sourceId) => {
    if (sourceEdges.length < 2) return;
    const source = nodeMap.get(sourceId);
    if (!source) return;
    const capacity = source.capacity ?? inferNodeCapacity(source);
    const sortedEdges = [...sourceEdges].sort((a, b) => {
      const targetA = nodeMap.get(a.to);
      const targetB = nodeMap.get(b.to);
      return (targetA?.y ?? 0) - (targetB?.y ?? 0) || a.id.localeCompare(b.id);
    });
    const sourceX = source.x ?? 0;
    const sourceY = source.y ?? 0;
    const span = Math.min(190, Math.max(82, sortedEdges.length * 30));
    const firstPoint = { x: sourceX + hitRadius(capacity) + 22, y: sourceY };
    const finalPoint = { x: firstPoint.x + span, y: sourceY };
    const point = {
      id: `bifurcation-${sourceId}`,
      sourceId,
      x: firstPoint.x,
      y: firstPoint.y,
      outgoingIds: sourceEdges.map((edge) => edge.id),
    };
    outputPoints.set(sourceId, point);
    const ports = sortedEdges.map((edge, index) => {
      const progress = sortedEdges.length === 1 ? 1 : index / Math.max(1, sortedEdges.length - 1);
      const port = {
        x: firstPoint.x + (finalPoint.x - firstPoint.x) * progress,
        y: firstPoint.y + (finalPoint.y - firstPoint.y) * progress,
      };
      splitPorts.set(edge.id, port);
      return port;
    });
    sortedEdges.forEach((edge, index) => {
      const start = index === 0 ? { x: sourceX, y: sourceY } : ports[index - 1];
      const end = ports[index];
      const participating = sortedEdges.slice(index);
      const representativeEdge = [...participating].sort((a, b) => edgeDiagnosticRank(b) - edgeDiagnosticRank(a) || b.volume - a.volume)[0];
      stems.push({
        id: `split-stem-${sourceId}-${index}`,
        nodeId: sourceId,
        kind: "split",
        edgeIds: participating.map((item) => item.id),
        representativeEdge,
        path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      });
    });
  });

  return { points, outputPoints, mergePorts, splitPorts, stems };
}

function buildRadialConfluenceLayout(nodes: FlowNode[], edges: FlowEdge[]) {
  const points = new Map<string, ConfluencePoint>();
  const outputPoints = new Map<string, BifurcationPoint>();
  const mergePorts = new Map<string, FlowPort>();
  const splitPorts = new Map<string, FlowPort>();
  const stems: ConfluenceStem[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const layerRadiusByDepth = new Map<number, number>();
  nodes.forEach((node) => {
    const radius = node.fanLayerRadius ?? node.fanRadius;
    if (radius !== undefined) layerRadiusByDepth.set(node.depth ?? 0, radius);
  });
  const orderedDepths = Array.from(layerRadiusByDepth.keys()).sort((a, b) => a - b);
  const previousLayerRadius = (depth: number, fallback: number) => {
    const previousDepth = [...orderedDepths].reverse().find((candidate) => candidate < depth);
    return previousDepth === undefined ? fallback : layerRadiusByDepth.get(previousDepth) ?? fallback;
  };
  const nextLayerRadius = (depth: number, fallback: number) => {
    const followingDepth = orderedDepths.find((candidate) => candidate > depth);
    return followingDepth === undefined ? fallback : layerRadiusByDepth.get(followingDepth) ?? fallback;
  };
  const incoming = new Map<string, FlowEdge[]>();
  const outgoing = new Map<string, FlowEdge[]>();
  edges.forEach((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to || edge.kind === "闭环线路" || (to.depth ?? 0) <= (from.depth ?? 0)) return;
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  });

  incoming.forEach((group, targetId) => {
    if (group.length < 2) return;
    const target = nodeMap.get(targetId);
    if (!target) return;
    const origin = { x: target.fanOriginX ?? 150, y: target.fanOriginY ?? 150 };
    const targetRadius = target.fanRadius ?? Math.hypot((target.x ?? 0) - origin.x, (target.y ?? 0) - origin.y);
    const targetAngle = target.fanAngle ?? Math.atan2((target.y ?? 0) - origin.y, (target.x ?? 0) - origin.x);
    const sourceAngles = group.map((edge) => ({
      angle: nodeMap.get(edge.from)?.fanAngle ?? targetAngle,
      weight: Math.max(1, edgeFlowAmount(edge)),
    }));
    const averageAngle = weightedLocalAngle(sourceAngles, targetAngle);
    const junctionAngle = targetAngle + normalizeAngleDelta(averageAngle - targetAngle) * 0.34;
    const targetDepth = target.depth ?? 0;
    const previousRadius = previousLayerRadius(targetDepth, Math.max(90, targetRadius - 180));
    const stripSpan = Math.max(96, targetRadius - previousRadius);
    // Merge early inside the preceding Routing Strip. The final shared trunk
    // then approaches the Function as one route instead of merging at its box.
    const junctionRadius = clamp(
      previousRadius + stripSpan * 0.62,
      previousRadius + 48,
      targetRadius - hitRadius(target.capacity ?? inferNodeCapacity(target)) - 42,
    );
    const junction = polarPoint(origin, junctionRadius, junctionAngle);
    const representativeEdge = strongestEdge(group);
    points.set(targetId, { id: `confluence-${targetId}`, targetId, x: junction.x, y: junction.y, incomingIds: group.map((edge) => edge.id) });

    [...group]
      .sort((a, b) => (nodeMap.get(a.from)?.fanAngle ?? 0) - (nodeMap.get(b.from)?.fanAngle ?? 0))
      .forEach((edge) => {
        const sourceAngle = nodeMap.get(edge.from)?.fanAngle ?? junctionAngle;
        const portAngle = junctionAngle + normalizeAngleDelta(sourceAngle - junctionAngle) * 0.24;
        const port = polarPoint(origin, Math.max(70, junctionRadius - 54), portAngle);
        mergePorts.set(edge.id, port);
        stems.push({
          id: `radial-merge-${targetId}-${edge.id}`,
          nodeId: targetId,
          kind: "merge",
          edgeIds: [edge.id],
          representativeEdge: edge,
          path: smoothRouteThrough([port, polarPoint(origin, junctionRadius - 20, (portAngle + junctionAngle) / 2), junction]).path,
        });
      });
    stems.push({
      id: `radial-merge-trunk-${targetId}`,
      nodeId: targetId,
      kind: "merge",
      edgeIds: group.map((edge) => edge.id),
      representativeEdge,
      path: smoothRouteThrough([junction, radialNodePort(target, "in")]).path,
    });
  });

  outgoing.forEach((group, sourceId) => {
    if (group.length < 2) return;
    const source = nodeMap.get(sourceId);
    if (!source) return;
    const origin = { x: source.fanOriginX ?? 150, y: source.fanOriginY ?? 150 };
    const sourceRadius = source.fanRadius ?? Math.hypot((source.x ?? 0) - origin.x, (source.y ?? 0) - origin.y);
    const sourceAngle = source.fanAngle ?? Math.atan2((source.y ?? 0) - origin.y, (source.x ?? 0) - origin.x);
    const sourceDepth = source.depth ?? 0;
    const followingRadius = nextLayerRadius(sourceDepth, sourceRadius + 180);
    const stripSpan = Math.max(96, followingRadius - sourceRadius);
    // Split early inside the following Routing Strip so downstream branches
    // receive separate local feeders before they reach the next Function layer.
    const junctionRadius = clamp(
      sourceRadius + stripSpan * 0.38,
      sourceRadius + hitRadius(source.capacity ?? inferNodeCapacity(source)) + 42,
      followingRadius - 48,
    );
    const junction = polarPoint(origin, junctionRadius, sourceAngle);
    const representativeEdge = strongestEdge(group);
    outputPoints.set(sourceId, { id: `bifurcation-${sourceId}`, sourceId, x: junction.x, y: junction.y, outgoingIds: group.map((edge) => edge.id) });
    stems.push({
      id: `radial-split-trunk-${sourceId}`,
      nodeId: sourceId,
      kind: "split",
      edgeIds: group.map((edge) => edge.id),
      representativeEdge,
      path: smoothRouteThrough([radialNodePort(source, "out"), junction]).path,
    });

    [...group]
      .sort((a, b) => (nodeMap.get(a.to)?.fanAngle ?? 0) - (nodeMap.get(b.to)?.fanAngle ?? 0))
      .forEach((edge) => {
        const targetAngle = nodeMap.get(edge.to)?.fanAngle ?? sourceAngle;
        const portAngle = sourceAngle + normalizeAngleDelta(targetAngle - sourceAngle) * 0.28;
        const port = polarPoint(origin, junctionRadius + 58, portAngle);
        splitPorts.set(edge.id, port);
        stems.push({
          id: `radial-split-${sourceId}-${edge.id}`,
          nodeId: sourceId,
          kind: "split",
          edgeIds: [edge.id],
          representativeEdge: edge,
          path: smoothRouteThrough([junction, polarPoint(origin, junctionRadius + 24, (sourceAngle + portAngle) / 2), port]).path,
        });
      });
  });

  return { points, outputPoints, mergePorts, splitPorts, stems };
}

function weightedLocalAngle(values: Array<{ angle: number; weight: number }>, reference: number) {
  const totalWeight = values.reduce((sum, value) => sum + value.weight, 0) || 1;
  return reference + values.reduce((sum, value) => sum + normalizeAngleDelta(value.angle - reference) * value.weight, 0) / totalWeight;
}


function strongestEdge(edges: FlowEdge[]) {
  return [...edges].sort((a, b) => edgeDiagnosticRank(b) - edgeDiagnosticRank(a) || b.volume - a.volume)[0]!;
}


function buildAlluvialCorridors(nodes: FlowNode[], edges: FlowEdge[], edgeMode: EdgeMode) {
  // Version A keeps shared middle corridors for the compact mainline view.
  // The fan view uses node-adjacent progressive merge/split stems instead.
  if (edgeMode !== "confluence") return [] as AlluvialCorridor[];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, FlowEdge[]>();
  edges.forEach((edge) => {
    if (edge.kind === "闭环线路") return;
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return;
    const fromDepth = from.depth ?? 0;
    const toDepth = to.depth ?? fromDepth + 1;
    const targetBandSize = 620;
    const targetBand = Math.max(0, Math.floor((to.y ?? 0) / targetBandSize));
    const key = `${fromDepth}:${toDepth}:${targetBand}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  });

  return Array.from(groups.entries()).map(([id, group], groupIndex): AlluvialCorridor => {
    const sourceNodes = uniqueNodes(group.map((edge) => nodeMap.get(edge.from)).filter((node): node is FlowNode => Boolean(node)));
    const targetNodes = uniqueNodes(group.map((edge) => nodeMap.get(edge.to)).filter((node): node is FlowNode => Boolean(node)));
    const gatewayOffset = 0;
    const sourceRight = Math.max(...sourceNodes.map((node) => (node.x ?? 0) + hitRadius(node.capacity ?? inferNodeCapacity(node)) + gatewayOffset));
    const targetLeft = Math.min(...targetNodes.map((node) => (node.x ?? 0) - hitRadius(node.capacity ?? inferNodeCapacity(node)) - gatewayOffset));
    const midpoint = (sourceRight + targetLeft) / 2;
    const startX = Math.min(sourceRight + 96, midpoint - 38);
    const endX = Math.max(targetLeft - 96, midpoint + 38);
    const endpointYs = [...sourceNodes, ...targetNodes].map((node) => node.y ?? 0).sort((a, b) => a - b);
    const medianY = endpointYs[Math.floor(endpointYs.length / 2)] ?? 120;
    const laneCount = 3;
    const laneStep = 24;
    const corridorY = medianY + ((groupIndex % laneCount) - Math.floor(laneCount / 2)) * laneStep;
    const shoulder = Math.max(34, Math.min(90, Math.abs(endX - startX) * 0.25));
    const trunkPath = `M ${startX} ${corridorY} C ${startX + shoulder} ${corridorY}, ${endX - shoulder} ${corridorY}, ${endX} ${corridorY}`;
    const sourcePaths = sourceNodes.map((node) => {
      const x = (node.x ?? 0) + hitRadius(node.capacity ?? inferNodeCapacity(node));
      const y = node.y ?? 0;
      const branchShoulder = 42;
      return `M ${x} ${y} C ${x + branchShoulder} ${y}, ${startX - branchShoulder} ${corridorY}, ${startX} ${corridorY}`;
    });
    const targetPaths = targetNodes.map((node) => {
      const x = (node.x ?? 0) - hitRadius(node.capacity ?? inferNodeCapacity(node));
      const y = node.y ?? 0;
      const branchShoulder = 42;
      return `M ${endX} ${corridorY} C ${endX + branchShoulder} ${corridorY}, ${x - branchShoulder} ${y}, ${x} ${y}`;
    });
    const representativeEdge = [...group].sort((a, b) => edgeDiagnosticRank(b) - edgeDiagnosticRank(a) || b.volume - a.volume)[0]!;
    const branchWidths = group.map((edge) => Math.max(1.6, edgeWidth(edge) * 0.68));
    const width = Math.min(18, Math.max(5.4, 3.8 + Math.sqrt(branchWidths.reduce((sum, value) => sum + value * value, 0)) * 0.72));
    return {
      id: `alluvial-${id}`,
      edgeIds: group.map((edge) => edge.id),
      representativeEdge,
      trunkPath,
      branchPaths: [...sourcePaths, ...targetPaths],
      width,
      marker: { x: (startX + endX) / 2, y: corridorY },
    };
  });
}

function buildSharedFlowChannels(
  nodes: FlowNode[],
  edges: FlowEdge[],
  edgeMode: EdgeMode,
  mergePorts: Map<string, FlowPort>,
  splitPorts: Map<string, FlowPort>,
) {
  if (edgeMode !== "fan") return [] as AlluvialCorridor[];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  type ChannelCandidate = {
    edge: FlowEdge;
    sourceAngle: number;
    targetAngle: number;
    corridorAngle: number;
    startRadius: number;
    endRadius: number;
    sourceBasin: string;
    targetBasin: string;
  };
  type ChannelCluster = {
    members: ChannelCandidate[];
    angle: number;
    overlapStart: number;
    overlapEnd: number;
    sourceBasins: Set<string>;
    targetBasins: Set<string>;
  };
  const candidates: ChannelCandidate[] = edges.flatMap((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to || edge.kind === "闭环线路" || (to.depth ?? 0) <= (from.depth ?? 0)) return [];
    const sourceAngle = from.fanAngle ?? Math.PI / 4;
    const targetAngle = to.fanAngle ?? Math.PI / 4;
    const start = splitPorts.get(edge.id) ?? radialNodePort(from, "out");
    const end = mergePorts.get(edge.id) ?? radialNodePort(to, "in");
    const origin = { x: from.fanOriginX ?? 150, y: from.fanOriginY ?? 150 };
    return [{
      edge,
      sourceAngle,
      targetAngle,
      corridorAngle: sourceAngle + normalizeAngleDelta(targetAngle - sourceAngle) * 0.5,
      startRadius: Math.hypot(start.x - origin.x, start.y - origin.y),
      endRadius: Math.hypot(end.x - origin.x, end.y - origin.y),
      sourceBasin: from.basin ?? "default",
      targetBasin: to.basin ?? "default",
    }];
  }).sort((left, right) =>
    left.startRadius - right.startRadius || left.corridorAngle - right.corridorAngle || left.edge.id.localeCompare(right.edge.id),
  );

  const clusters: ChannelCluster[] = [];
  candidates.forEach((candidate) => {
    const compatible = clusters
      .filter((cluster) => {
        const radialOverlap = Math.min(cluster.overlapEnd, candidate.endRadius) - Math.max(cluster.overlapStart, candidate.startRadius);
        const basinAffinity = cluster.sourceBasins.has(candidate.sourceBasin) || cluster.targetBasins.has(candidate.targetBasin);
        return radialOverlap >= 72
          && basinAffinity
          && Math.abs(normalizeAngleDelta(cluster.angle - candidate.corridorAngle)) <= 0.18;
      })
      .sort((left, right) =>
        Math.abs(normalizeAngleDelta(left.angle - candidate.corridorAngle)) - Math.abs(normalizeAngleDelta(right.angle - candidate.corridorAngle)),
      )[0];
    if (!compatible) {
      clusters.push({
        members: [candidate],
        angle: candidate.corridorAngle,
        overlapStart: candidate.startRadius,
        overlapEnd: candidate.endRadius,
        sourceBasins: new Set([candidate.sourceBasin]),
        targetBasins: new Set([candidate.targetBasin]),
      });
      return;
    }
    compatible.members.push(candidate);
    compatible.angle = weightedLocalAngle(
      compatible.members.map((member) => ({ angle: member.corridorAngle, weight: Math.max(1, edgeFlowAmount(member.edge)) })),
      compatible.angle,
    );
    compatible.overlapStart = Math.max(compatible.overlapStart, candidate.startRadius);
    compatible.overlapEnd = Math.min(compatible.overlapEnd, candidate.endRadius);
    compatible.sourceBasins.add(candidate.sourceBasin);
    compatible.targetBasins.add(candidate.targetBasin);
  });

  const occupiedLanes: Array<{ angle: number; startRadius: number; endRadius: number }> = [];
  return clusters.flatMap((cluster, groupIndex): AlluvialCorridor[] => {
    const group = cluster.members.map((member) => member.edge);
    if (group.length < 2) return [];
    const firstNode = nodeMap.get(group[0]!.from)!;
    const origin = { x: firstNode.fanOriginX ?? 150, y: firstNode.fanOriginY ?? 150 };
    const starts = group.map((edge) => splitPorts.get(edge.id) ?? radialNodePort(nodeMap.get(edge.from)!, "out"));
    const ends = group.map((edge) => mergePorts.get(edge.id) ?? radialNodePort(nodeMap.get(edge.to)!, "in"));
    const startRadius = cluster.overlapStart + 30;
    const endRadius = cluster.overlapEnd - 30;
    if (endRadius <= startRadius + 38) return [];

    const medianAngle = cluster.angle;
    const candidates = Array.from({ length: 13 }, (_, index) => {
      if (index === 0) return medianAngle;
      const ring = Math.ceil(index / 2);
      return medianAngle + (index % 2 === 1 ? ring : -ring) * 0.045;
    });
    const trunkAngle = candidates.find((candidate) => {
      const nodeBlocked = nodes.some((node) => {
        const nodeRadius = Math.hypot((node.x ?? 0) - origin.x, (node.y ?? 0) - origin.y);
        const nodeAngle = Math.atan2((node.y ?? 0) - origin.y, (node.x ?? 0) - origin.x);
        const angleClearance = (hitRadius(node.capacity ?? inferNodeCapacity(node)) + 28) / Math.max(160, nodeRadius);
        return nodeRadius > startRadius && nodeRadius < endRadius && Math.abs(normalizeAngleDelta(nodeAngle - candidate)) < angleClearance;
      });
      const laneBlocked = occupiedLanes.some((lane) =>
        Math.abs(normalizeAngleDelta(lane.angle - candidate)) < 0.04 && startRadius < lane.endRadius + 36 && endRadius > lane.startRadius - 36,
      );
      return !nodeBlocked && !laneBlocked;
    }) ?? medianAngle + ((groupIndex % 7) - 3) * 0.055;
    occupiedLanes.push({ angle: trunkAngle, startRadius, endRadius });

    const orderedMembers = cluster.members
      .map((member, index) => ({ ...member, start: starts[index]!, end: ends[index]! }))
      .sort((left, right) =>
        left.sourceAngle - right.sourceAngle || left.targetAngle - right.targetAngle || left.edge.id.localeCompare(right.edge.id),
      );
    const laneGap = 15;
    const middleRadius = (startRadius + endRadius) / 2;
    const lanes = orderedMembers.map((member, laneIndex) => {
      const laneOffset = (laneIndex - (orderedMembers.length - 1) / 2) * laneGap;
      const laneAngle = trunkAngle + laneOffset / Math.max(180, middleRadius);
      const laneStart = polarPoint(origin, startRadius, laneAngle);
      const laneEnd = polarPoint(origin, endRadius, laneAngle);
      const route = smoothRouteThrough([member.start, laneStart, laneEnd, member.end]);
      const marker = route.samples[Math.floor(route.samples.length / 2)] ?? laneStart;
      return {
        edgeId: member.edge.id,
        sourceId: member.edge.from,
        targetId: member.edge.to,
        laneIndex,
        path: route.path,
        marker,
      };
    });
    const representativeEdge = strongestEdge(group);
    const trunkStart = polarPoint(origin, startRadius, trunkAngle);
    const trunkEnd = polarPoint(origin, endRadius, trunkAngle);
    return [{
      id: `shared-channel-${groupIndex}`,
      edgeIds: group.map((edge) => edge.id),
      representativeEdge,
      trunkPath: `M ${trunkStart.x} ${trunkStart.y} L ${trunkEnd.x} ${trunkEnd.y}`,
      branchPaths: [],
      width: Math.min(54, 10 + Math.max(0, lanes.length - 1) * laneGap),
      marker: polarPoint(origin, (startRadius + endRadius) / 2, trunkAngle),
      lanes,
    }];
  });
}

function uniqueNodes(nodes: FlowNode[]) {
  return Array.from(new Map(nodes.map((node) => [node.id, node])).values()).sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
}


function buildLayerArcRequirements(
  orderedLayers: Array<[number, FlowNode[]]>,
  spacingScale: number,
) {
  const requirements = new Map<number, number>();
  orderedLayers.forEach(([depth, layerNodes]) => {
    const totalNodeWidth = layerNodes.reduce(
      (sum, node) => sum + hitRadius(node.capacity ?? inferNodeCapacity(node)) * 2,
      0,
    );
    // Reserve enough arc for the rendered node, its diagnostic marker and a
    // usable pointer target. Basin boundaries must not consume this clearance.
    const localGap = Math.max(82, 66 * spacingScale);
    requirements.set(depth, totalNodeWidth + Math.max(0, layerNodes.length - 1) * localGap);
  });
  return requirements;
}

function buildDensityAwareLayerSpans(
  orderedLayers: Array<[number, FlowNode[]]>,
  radiusByDepth: Map<number, number>,
  requiredArcLengthByDepth: Map<number, number>,
  defaultSpan: number,
) {
  const spans = new Map<number, number>();
  orderedLayers.forEach(([depth]) => {
    const radius = radiusByDepth.get(depth) ?? 240;
    const requiredArcLength = requiredArcLengthByDepth.get(depth) ?? radius * defaultSpan;
    const angularSpan = requiredArcLength / Math.max(1, radius);
    spans.set(depth, clamp(angularSpan, Math.min(0.42, defaultSpan), 2.78));
  });
  return spans;
}

function buildLayerSpacingByDepth(
  orderedLayers: Array<[number, FlowNode[]]>,
  edges: FlowEdge[],
  depthById: Map<string, number>,
  preferredBaseSpacing: number,
) {
  const spacing = new Map<number, number>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  edges.forEach((edge) => {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  });
  for (let index = 0; index < orderedLayers.length - 1; index += 1) {
    const [depth, layerNodes] = orderedLayers[index]!;
    const [nextDepth, nextLayerNodes] = orderedLayers[index + 1]!;
    const crossingEdges = edges.filter((edge) => {
      const fromDepth = depthById.get(edge.from) ?? 0;
      const toDepth = depthById.get(edge.to) ?? fromDepth;
      return edge.kind !== "闭环线路" && fromDepth <= depth && toDepth >= nextDepth;
    });
    const weightedJunctionCount = [...layerNodes, ...nextLayerNodes].reduce((sum, node) =>
      sum + Math.max(0, (incoming.get(node.id) ?? 0) - 1) + Math.max(0, (outgoing.get(node.id) ?? 0) - 1), 0);
    const corridorGroups = new Set(crossingEdges.map((edge) => {
      const from = layerNodes.find((node) => node.id === edge.from);
      const to = nextLayerNodes.find((node) => node.id === edge.to);
      return `${from?.basin ?? "transit"}->${to?.basin ?? "transit"}`;
    })).size;
    const sourceOrder = new Map(layerNodes.map((node, nodeIndex) => [node.id, nodeIndex]));
    const targetOrder = new Map(nextLayerNodes.map((node, nodeIndex) => [node.id, nodeIndex]));
    const directEdges = crossingEdges.filter((edge) => sourceOrder.has(edge.from) && targetOrder.has(edge.to));
    let estimatedCrossingDemand = 0;
    for (let left = 0; left < directEdges.length; left += 1) {
      for (let right = left + 1; right < directEdges.length; right += 1) {
        const first = directEdges[left]!;
        const second = directEdges[right]!;
        const sourceDelta = (sourceOrder.get(first.from) ?? 0) - (sourceOrder.get(second.from) ?? 0);
        const targetDelta = (targetOrder.get(first.to) ?? 0) - (targetOrder.get(second.to) ?? 0);
        if (sourceDelta * targetDelta < 0) estimatedCrossingDemand += 1;
      }
    }
    const maxNodeDiameter = Math.max(
      ...[...layerNodes, ...nextLayerNodes].map((node) => hitRadius(node.capacity ?? inferNodeCapacity(node)) * 2),
      80,
    );
    const preferredSpacing = Math.max(preferredBaseSpacing, maxNodeDiameter + 92);
    const minSpacing = Math.max(132, preferredSpacing * 0.78);
    const maxSpacing = preferredSpacing + 220;
    const nodeDensityPressure = Math.max(0, Math.max(layerNodes.length, nextLayerNodes.length) - 7) * 7;
    const routingPressure = Math.sqrt(crossingEdges.length) * 18
      + Math.sqrt(weightedJunctionCount) * 25
      + corridorGroups * 8
      + Math.sqrt(estimatedCrossingDemand) * 22;
    const sparse = crossingEdges.length <= 2
      && weightedJunctionCount === 0
      && estimatedCrossingDemand === 0
      && Math.max(layerNodes.length, nextLayerNodes.length) <= 4;
    const adaptiveSpacing = sparse
      ? preferredSpacing
      : preferredSpacing + nodeDensityPressure + routingPressure;
    spacing.set(depth, clamp(adaptiveSpacing, minSpacing, maxSpacing));
  }
  return spacing;
}

function layoutAlluvialFanNodes(nodes: FlowNode[], edges: FlowEdge[], spacingScale: number) {
  if (!nodes.length) return nodes;
  const depthById = buildVisualDepths(nodes, edges);
  const clusterById = buildRadialClusterKeys(nodes, edges, depthById);
  const axisNodeIds = buildRadialAxis(nodes, edges, depthById);
  const buckets = new Map<number, FlowNode[]>();
  nodes.forEach((node) => {
    const depth = depthById.get(node.id) ?? 0;
    buckets.set(depth, [...(buckets.get(depth) ?? []), node]);
  });
  const clusterOrder = new Map(
    Array.from(new Set(nodes.map((node) => clusterById.get(node.id) ?? node.basin ?? node.id)))
      .sort((a, b) => {
        const aAxis = nodes.some((node) => axisNodeIds.has(node.id) && clusterById.get(node.id) === a) ? 0 : 1;
        const bAxis = nodes.some((node) => axisNodeIds.has(node.id) && clusterById.get(node.id) === b) ? 0 : 1;
        return aAxis - bAxis || a.localeCompare(b);
      })
      .map((key, index) => [key, index]),
  );
  const clusteredOrder = new Map(
    [...nodes]
      .sort((a, b) =>
        (clusterOrder.get(clusterById.get(a.id) ?? a.id) ?? 9999) - (clusterOrder.get(clusterById.get(b.id) ?? b.id) ?? 9999) ||
        a.name.localeCompare(b.name),
      )
      .map((node, index) => [node.id, index]),
  );
  const ordered = orderTerrainLayers(
    buckets,
    edges,
    clusteredOrder,
    fanSkeletonNodeOrder(nodes, edges),
  );
  const safeScale = Math.max(0.9, Math.min(2.1, spacingScale));
  const orderedLayers = Array.from(ordered.entries()).sort(([a], [b]) => a - b);
  const axisAngle = Math.PI / 4;
  const halfFanAngle = Math.min(0.78, 0.52 + Math.log2(Math.max(2, nodes.length)) * 0.032);
  const origin = { x: Math.max(190, 164 * safeScale), y: Math.max(190, 164 * safeScale) };
  const nodeDiameters = nodes.map((node) => hitRadius(node.capacity ?? inferNodeCapacity(node)) * 2).sort((a, b) => a - b);
  const maxNodeDiameter = Math.max(...nodeDiameters);
  const typicalNodeDiameter = nodeDiameters[Math.floor(nodeDiameters.length / 2)] ?? maxNodeDiameter;
  const routingClearance = Math.max(72, 58 * safeScale);
  const preferredBaseSpacing = Math.max(150, typicalNodeDiameter + routingClearance * 0.58);
  const baseRadius = Math.max(220, maxNodeDiameter / 2 + routingClearance + 96);
  const radiusByDepth = new Map<number, number>();
  const requiredArcLengthByDepth = buildLayerArcRequirements(orderedLayers, safeScale);
  const spacingByDepth = buildLayerSpacingByDepth(orderedLayers, edges, depthById, preferredBaseSpacing);
  const maximumAngularSpan = 2.78;
  let accumulatedRadius = baseRadius;
  orderedLayers.forEach(([depth], index) => {
    if (index > 0) {
      const previousDepth = orderedLayers[index - 1]![0];
      accumulatedRadius += spacingByDepth.get(previousDepth) ?? preferredBaseSpacing;
    }
    // A dense layer first consumes angular space. If the maximum readable fan
    // span is still insufficient, move the entire layer outward and preserve
    // the ordering by carrying that displacement into all following layers.
    accumulatedRadius = Math.max(
      accumulatedRadius,
      (requiredArcLengthByDepth.get(depth) ?? 0) / maximumAngularSpan,
    );
    radiusByDepth.set(depth, accumulatedRadius);
  });
  const angularSpanByDepth = buildDensityAwareLayerSpans(
    orderedLayers,
    radiusByDepth,
    requiredArcLengthByDepth,
    halfFanAngle * 2,
  );
  const sectorsByDepth = new Map<number, Map<string, BasinSector>>();
  orderedLayers.forEach(([depth, bucket]) => {
    // Adaptive flow-first invariant: every function at this flowDepth shares the
    // same accumulated layer radius. Pressure can move the whole layer only.
    const angularSpan = angularSpanByDepth.get(depth) ?? halfFanAngle * 2;
    sectorsByDepth.set(depth, buildBasinSectors(
      bucket,
      clusterById,
      clusterOrder,
      axisNodeIds,
      axisAngle,
      angularSpan / 2,
    ));
  });
  const initialAngles = new Map<string, number>();
  orderedLayers.forEach(([depth, bucket]) => {
    const radius = radiusByDepth.get(depth) ?? baseRadius;
    const angularSpan = angularSpanByDepth.get(depth) ?? halfFanAngle * 2;
    const sectors = sectorsByDepth.get(depth) ?? new Map<string, BasinSector>();
    const arrangedBucket = [...bucket].sort((a, b) => {
      const aAxis = axisNodeIds.has(a.id) ? 0 : 1;
      const bAxis = axisNodeIds.has(b.id) ? 0 : 1;
      return aAxis - bAxis ||
        (clusterOrder.get(clusterById.get(a.id) ?? a.id) ?? 9999) - (clusterOrder.get(clusterById.get(b.id) ?? b.id) ?? 9999) ||
        bucket.indexOf(a) - bucket.indexOf(b);
    });
    arrangeRadialLayerAngles(
      arrangedBucket,
      radius,
      axisAngle,
      angularSpan / 2,
      clusterById,
      sectors,
      axisNodeIds,
      safeScale,
    ).forEach((angle, id) => initialAngles.set(id, angle));
  });
  const optimizedAngles = optimizePolarOrdering(
    nodes,
    edges,
    depthById,
    radiusByDepth,
    initialAngles,
    clusterById,
    sectorsByDepth,
    angularSpanByDepth,
    axisNodeIds,
    axisAngle,
    safeScale,
  );
  const collisionFreeAngles = new Map(optimizedAngles);
  orderedLayers.forEach(([depth, bucket]) => {
    const radius = radiusByDepth.get(depth) ?? baseRadius;
    const angularSpan = angularSpanByDepth.get(depth) ?? halfFanAngle * 2;
    enforceWholeLayerClearance(
      bucket,
      collisionFreeAngles,
      radius,
      axisNodeIds,
      axisAngle,
      angularSpan / 2,
      safeScale,
    ).forEach((angle, id) => collisionFreeAngles.set(id, angle));
  });
  const positions = new Map<string, Pick<FlowNode, "x" | "y" | "depth" | "elevation" | "fanRadius" | "fanAngle" | "fanOriginX" | "fanOriginY" | "fanLayerRadius" | "fanBandOffset">>();
  orderedLayers.forEach(([depth, bucket]) => {
    const radius = radiusByDepth.get(depth) ?? baseRadius;
    const angularSpan = angularSpanByDepth.get(depth) ?? halfFanAngle * 2;
    const layerHalfAngle = angularSpan / 2;
    const sectors = sectorsByDepth.get(depth) ?? new Map<string, BasinSector>();
    bucket.forEach((node) => {
      const basin = (clusterById.get(node.id) ?? "default::root").split("::")[0] ?? "default";
      const sector = sectors.get(basin) ?? { center: axisAngle, min: axisAngle - layerHalfAngle, max: axisAngle + layerHalfAngle };
      const envelopeMargin = Math.max(0.02, hitRadius(node.capacity ?? inferNodeCapacity(node)) / Math.max(220, radius));
      const angle = axisNodeIds.has(node.id)
        ? axisAngle
        : clamp(collisionFreeAngles.get(node.id) ?? sector.center, axisAngle - layerHalfAngle + envelopeMargin, axisAngle + layerHalfAngle - envelopeMargin);
      const point = polarPoint(origin, radius, angle);
      positions.set(node.id, {
        x: point.x,
        y: point.y,
        depth,
        elevation: Math.max(0, 100 - depth * 10),
        fanRadius: radius,
        fanAngle: angle,
        fanOriginX: origin.x,
        fanOriginY: origin.y,
        fanLayerRadius: radius,
        fanBandOffset: 0,
      });
    });
  });
  return nodes.map((node) => ({ ...node, ...(positions.get(node.id) ?? {}) }));
}

function buildBasinSectors(
  nodes: FlowNode[],
  clusterById: Map<string, string>,
  clusterOrder: Map<string, number>,
  axisNodeIds: Set<string>,
  axisAngle: number,
  halfFanAngle: number,
) {
  const basins = Array.from(new Set(nodes.map((node) => (clusterById.get(node.id) ?? "default::root").split("::")[0] ?? "default")));
  const axisNode = nodes.find((node) => axisNodeIds.has(node.id));
  const axisBasin = axisNode ? (clusterById.get(axisNode.id) ?? "default::root").split("::")[0] ?? "default" : basins[0] ?? "default";
  const ordered = [...basins].sort((a, b) => {
    if (a === axisBasin) return -1;
    if (b === axisBasin) return 1;
    const aOrder = Math.min(...nodes.filter((node) => (clusterById.get(node.id) ?? "").startsWith(`${a}::`)).map((node) => clusterOrder.get(clusterById.get(node.id) ?? "") ?? 9999));
    const bOrder = Math.min(...nodes.filter((node) => (clusterById.get(node.id) ?? "").startsWith(`${b}::`)).map((node) => clusterOrder.get(clusterById.get(node.id) ?? "") ?? 9999));
    return aOrder - bOrder || a.localeCompare(b);
  });
  const remaining = ordered.filter((basin) => basin !== axisBasin);
  const left = remaining.filter((_, index) => index % 2 === 0).reverse();
  const right = remaining.filter((_, index) => index % 2 === 1);
  const envelopeMin = axisAngle - halfFanAngle;
  const envelopeMax = axisAngle + halfFanAngle;
  const basinWeights = new Map(basins.map((basin) => {
    const basinNodes = nodes.filter((node) => ((clusterById.get(node.id) ?? "default::root").split("::")[0] ?? "default") === basin);
    const requiredWidth = basinNodes.reduce(
      (sum, node) => sum + hitRadius(node.capacity ?? inferNodeCapacity(node)) * 2 + 48,
      0,
    );
    return [basin, Math.max(1, requiredWidth)] as const;
  }));
  const totalWeight = Array.from(basinWeights.values()).reduce((sum, value) => sum + value, 0) || 1;
  const totalAngle = halfFanAngle * 2;
  const minimumWidth = Math.min(0.08, totalAngle / Math.max(2, basins.length * 2));
  const axisShare = totalAngle * ((basinWeights.get(axisBasin) ?? 1) / totalWeight);
  const axisWidth = clamp(axisShare, minimumWidth, Math.max(minimumWidth, totalAngle - minimumWidth * remaining.length));
  const sectors = new Map<string, BasinSector>();
  sectors.set(axisBasin, { center: axisAngle, min: axisAngle - axisWidth / 2, max: axisAngle + axisWidth / 2 });

  const allocateSide = (sideBasins: string[], start: number, end: number) => {
    const sideWeight = sideBasins.reduce((sum, basin) => sum + (basinWeights.get(basin) ?? 1), 0) || 1;
    const span = Math.max(0, end - start);
    let cursor = start;
    sideBasins.forEach((basin, index) => {
      const remainingCount = sideBasins.length - index;
      const proportional = span * ((basinWeights.get(basin) ?? 1) / sideWeight);
      const width = index === sideBasins.length - 1
        ? end - cursor
        : Math.max(Math.min(proportional, end - cursor - minimumWidth * (remainingCount - 1)), minimumWidth);
      sectors.set(basin, { center: cursor + width / 2, min: cursor, max: cursor + width });
      cursor += width;
    });
  };
  allocateSide(left, envelopeMin, axisAngle - axisWidth / 2);
  allocateSide(right, axisAngle + axisWidth / 2, envelopeMax);
  return sectors;
}

function buildRadialClusterKeys(nodes: FlowNode[], edges: FlowEdge[], depthById: Map<string, number>) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, FlowEdge[]>();
  edges.forEach((edge) => {
    if (edge.kind === "闭环线路" || !nodeMap.has(edge.from) || !nodeMap.has(edge.to)) return;
    if ((depthById.get(edge.to) ?? 0) <= (depthById.get(edge.from) ?? 0)) return;
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  });
  const keys = new Map<string, string>();
  [...nodes]
    .sort((a, b) => (depthById.get(a.id) ?? 0) - (depthById.get(b.id) ?? 0) || a.name.localeCompare(b.name))
    .forEach((node) => {
      const parents = [...(incoming.get(node.id) ?? [])].sort((a, b) =>
        Number(Boolean(b.primary)) - Number(Boolean(a.primary)) || b.volume - a.volume || a.id.localeCompare(b.id),
      );
      const ancestry = parents.length ? keys.get(parents[0]!.from) ?? parents[0]!.from : node.id;
      // Stable functional basins own the sector; upstream ancestry controls the
      // ordering inside that sector so branches remain locally continuous.
      keys.set(node.id, `${node.basin ?? "default"}::${ancestry}`);
    });
  return keys;
}

function buildRadialAxis(nodes: FlowNode[], edges: FlowEdge[], depthById: Map<string, number>) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, FlowEdge[]>();
  edges.forEach((edge) => {
    if (edge.kind === "闭环线路" || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return;
    if ((depthById.get(edge.to) ?? 0) <= (depthById.get(edge.from) ?? 0)) return;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
  });
  const score = new Map<string, number>();
  const next = new Map<string, string>();
  [...nodes]
    .sort((a, b) => (depthById.get(b.id) ?? 0) - (depthById.get(a.id) ?? 0))
    .forEach((node) => {
      const best = [...(outgoing.get(node.id) ?? [])].sort((a, b) => {
        const aScore = (score.get(a.to) ?? 0) + (a.primary ? 12 : 0) + Math.log2(Math.max(1, a.volume) + 1);
        const bScore = (score.get(b.to) ?? 0) + (b.primary ? 12 : 0) + Math.log2(Math.max(1, b.volume) + 1);
        return bScore - aScore || a.id.localeCompare(b.id);
      })[0];
      if (!best) {
        score.set(node.id, 1);
        return;
      }
      score.set(node.id, 1 + (score.get(best.to) ?? 0) + (best.primary ? 12 : 0));
      next.set(node.id, best.to);
    });
  const root = [...nodes]
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || a.name.localeCompare(b.name))[0] ?? nodes[0];
  const axis = new Set<string>();
  let current: string | undefined = root?.id;
  while (current && !axis.has(current)) {
    axis.add(current);
    current = next.get(current);
  }
  return axis;
}

function arrangeRadialLayerAngles(
  nodes: FlowNode[],
  radius: number,
  axisAngle: number,
  halfFanAngle: number,
  clusterById: Map<string, string>,
  sectors: Map<string, BasinSector>,
  axisNodeIds: Set<string>,
  spacingScale: number,
) {
  const angles = new Map<string, number>();
  const nonAxis = nodes.filter((node) => !axisNodeIds.has(node.id));
  const byBasin = new Map<string, FlowNode[]>();
  nonAxis.forEach((node) => {
    const basin = (clusterById.get(node.id) ?? "default::root").split("::")[0] ?? "default";
    byBasin.set(basin, [...(byBasin.get(basin) ?? []), node]);
  });
  byBasin.forEach((basinNodes, basin) => {
    const sector = sectors.get(basin) ?? { center: axisAngle, min: axisAngle - halfFanAngle, max: axisAngle + halfFanAngle };
    const margin = Math.min(0.1, Math.max(0.025, Math.max(...basinNodes.map((node) => hitRadius(node.capacity ?? inferNodeCapacity(node)))) / Math.max(240, radius)));
    const min = sector.min + margin;
    const max = sector.max - margin;
    const sorted = [...basinNodes].sort((a, b) => (clusterById.get(a.id) ?? a.id).localeCompare(clusterById.get(b.id) ?? b.id) || a.name.localeCompare(b.name));
    sorted.forEach((node, index) => {
      const progress = (index + 1) / (sorted.length + 1);
      angles.set(node.id, min + (max - min) * progress);
    });
  });
  nodes.filter((node) => axisNodeIds.has(node.id)).forEach((node) => angles.set(node.id, axisAngle));
  return constrainLayerAngles(nodes, angles, radius, clusterById, sectors, axisNodeIds, axisAngle, halfFanAngle, spacingScale);
}

function optimizePolarOrdering(
  nodes: FlowNode[],
  edges: FlowEdge[],
  depthById: Map<string, number>,
  radiusByDepth: Map<number, number>,
  initialAngles: Map<string, number>,
  clusterById: Map<string, string>,
  sectorsByDepth: Map<number, Map<string, BasinSector>>,
  angularSpanByDepth: Map<number, number>,
  axisNodeIds: Set<string>,
  axisAngle: number,
  spacingScale: number,
) {
  const angles = new Map(initialAngles);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (edge.kind === "闭环线路" || !angles.has(edge.from) || !angles.has(edge.to)) return;
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  });
  const depths = Array.from(new Set(nodes.map((node) => depthById.get(node.id) ?? 0))).sort((a, b) => a - b);
  const sweeps: Array<{ depths: number[]; neighbours: Map<string, string[]> }> = [
    { depths, neighbours: incoming },
    { depths: [...depths].reverse(), neighbours: outgoing },
    { depths, neighbours: incoming },
    { depths: [...depths].reverse(), neighbours: outgoing },
    { depths, neighbours: incoming },
  ];
  sweeps.forEach((sweep) => {
    sweep.depths.forEach((depth) => {
      const layerNodes = nodes.filter((node) => (depthById.get(node.id) ?? 0) === depth);
      const halfFanAngle = (angularSpanByDepth.get(depth) ?? 1.2) / 2;
      const sectors = sectorsByDepth.get(depth) ?? new Map<string, BasinSector>();
      layerNodes.forEach((node) => {
        if (axisNodeIds.has(node.id)) return;
        const values = (sweep.neighbours.get(node.id) ?? []).map((id) => angles.get(id)).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
        if (!values.length) return;
        const median = values[Math.floor(values.length / 2)]!;
        const basin = (clusterById.get(node.id) ?? "default::root").split("::")[0] ?? "default";
        const sector = sectors.get(basin) ?? { center: axisAngle, min: axisAngle - halfFanAngle, max: axisAngle + halfFanAngle };
        const current = angles.get(node.id) ?? sector.center;
        angles.set(node.id, clamp(current * 0.38 + median * 0.62, sector.min + 0.025, sector.max - 0.025));
      });
      const constrained = constrainLayerAngles(layerNodes, angles, radiusByDepth.get(depth) ?? 240, clusterById, sectors, axisNodeIds, axisAngle, halfFanAngle, spacingScale);
      constrained.forEach((angle, id) => angles.set(id, angle));
    });
  });
  return angles;
}

function constrainLayerAngles(
  nodes: FlowNode[],
  sourceAngles: Map<string, number>,
  radius: number,
  clusterById: Map<string, string>,
  sectors: Map<string, BasinSector>,
  axisNodeIds: Set<string>,
  axisAngle: number,
  halfFanAngle: number,
  spacingScale: number,
) {
  const result = new Map(sourceAngles);
  const grouped = new Map<string, FlowNode[]>();
  nodes.filter((node) => !axisNodeIds.has(node.id)).forEach((node) => {
    const basin = (clusterById.get(node.id) ?? "default::root").split("::")[0] ?? "default";
    grouped.set(basin, [...(grouped.get(basin) ?? []), node]);
  });
  grouped.forEach((basinNodes, basin) => {
    const sector = sectors.get(basin) ?? { center: axisAngle, min: axisAngle - halfFanAngle, max: axisAngle + halfFanAngle };
    const sorted = [...basinNodes].sort((a, b) => (result.get(a.id) ?? sector.center) - (result.get(b.id) ?? sector.center));
    const maxDiameter = Math.max(...sorted.map((node) => hitRadius(node.capacity ?? inferNodeCapacity(node)) * 2));
    const minimumGap = Math.max(0.028, Math.min(0.2, (maxDiameter + Math.max(34, 28 * spacingScale)) / Math.max(180, radius)));
    const edgeMargin = Math.max(0.025, maxDiameter / 2 / Math.max(180, radius));
    const min = sector.min + edgeMargin;
    const max = sector.max - edgeMargin;
    sorted.forEach((node, index) => {
      const lower = min + index * minimumGap;
      result.set(node.id, Math.max(lower, result.get(node.id) ?? sector.center));
    });
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const node = sorted[index]!;
      const upper = max - (sorted.length - 1 - index) * minimumGap;
      result.set(node.id, Math.min(upper, result.get(node.id) ?? sector.center));
    }
    const axisNode = nodes.find((node) => {
      if (!axisNodeIds.has(node.id)) return false;
      return ((clusterById.get(node.id) ?? "default::root").split("::")[0] ?? "default") === basin;
    });
    if (axisNode && sorted.length) {
      const leftSpace = Math.max(0, axisAngle - min);
      const rightSpace = Math.max(0, max - axisAngle);
      const leftCapacity = Math.max(0, Math.floor(leftSpace / minimumGap));
      const rightCapacity = Math.max(0, Math.floor(rightSpace / minimumGap));
      let leftCount = clamp(
        Math.round(sorted.length * leftSpace / Math.max(0.001, leftSpace + rightSpace)),
        Math.max(0, sorted.length - rightCapacity),
        Math.min(sorted.length, leftCapacity),
      );
      if (leftCapacity + rightCapacity < sorted.length) leftCount = Math.min(sorted.length, leftCapacity);
      const leftNodes = sorted.slice(0, leftCount);
      const rightNodes = sorted.slice(leftCount);
      leftNodes.forEach((node, index) => {
        result.set(node.id, axisAngle - (leftNodes.length - index) * minimumGap);
      });
      rightNodes.forEach((node, index) => {
        result.set(node.id, axisAngle + (index + 1) * minimumGap);
      });
    }
  });
  nodes.filter((node) => axisNodeIds.has(node.id)).forEach((node) => result.set(node.id, axisAngle));
  return result;
}

function enforceWholeLayerClearance(
  nodes: FlowNode[],
  sourceAngles: Map<string, number>,
  radius: number,
  axisNodeIds: Set<string>,
  axisAngle: number,
  halfFanAngle: number,
  spacingScale: number,
) {
  const result = new Map(sourceAngles);
  if (nodes.length < 2) return result;
  const clearance = Math.max(26, 22 * spacingScale);
  const nodeRadius = (node: FlowNode) => hitRadius(node.capacity ?? inferNodeCapacity(node));
  const angularGap = (left: FlowNode, right: FlowNode) => {
    const requiredChord = nodeRadius(left) + nodeRadius(right) + clearance;
    return 2 * Math.asin(Math.min(0.94, requiredChord / Math.max(1, radius * 2)));
  };
  const ordered = [...nodes].sort((left, right) =>
    (result.get(left.id) ?? axisAngle) - (result.get(right.id) ?? axisAngle) || left.name.localeCompare(right.name),
  );
  const axisIndex = ordered.findIndex((node) => axisNodeIds.has(node.id));
  if (axisIndex >= 0) {
    const axisNode = ordered[axisIndex]!;
    result.set(axisNode.id, axisAngle);
    for (let index = axisIndex - 1; index >= 0; index -= 1) {
      const node = ordered[index]!;
      const next = ordered[index + 1]!;
      result.set(node.id, Math.min(result.get(node.id) ?? axisAngle, (result.get(next.id) ?? axisAngle) - angularGap(node, next)));
    }
    for (let index = axisIndex + 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const node = ordered[index]!;
      result.set(node.id, Math.max(result.get(node.id) ?? axisAngle, (result.get(previous.id) ?? axisAngle) + angularGap(previous, node)));
    }
  } else {
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const node = ordered[index]!;
      result.set(node.id, Math.max(result.get(node.id) ?? axisAngle, (result.get(previous.id) ?? axisAngle) + angularGap(previous, node)));
    }
  }

  const minimumAngle = axisAngle - halfFanAngle;
  const maximumAngle = axisAngle + halfFanAngle;
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const leftOverflow = minimumAngle + nodeRadius(first) / Math.max(1, radius) - (result.get(first.id) ?? minimumAngle);
  const rightOverflow = (result.get(last.id) ?? maximumAngle) - (maximumAngle - nodeRadius(last) / Math.max(1, radius));
  if (axisIndex < 0) {
    const shift = leftOverflow > 0 ? leftOverflow : rightOverflow > 0 ? -rightOverflow : 0;
    if (shift) ordered.forEach((node) => result.set(node.id, (result.get(node.id) ?? axisAngle) + shift));
  }
  return result;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildNodeBadges(nodes: FlowNode[], edges: FlowEdge[]) {
  const incoming = countVisibleEdges(edges, "to");
  const outgoing = countVisibleEdges(edges, "from");
  const sourceIds = nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0 && (outgoing.get(node.id) ?? 0) > 0)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
    .map((node) => node.id);
  const sourceIndex = new Map(sourceIds.map((id, index) => [id, index + 1]));

  return new Map(
    nodes
      .map((node): [string, NodeBadge] | null => {
        const inCount = incoming.get(node.id) ?? 0;
        const outCount = outgoing.get(node.id) ?? 0;
        const sourceNumber = sourceIndex.get(node.id);
        if (sourceNumber) return [node.id, { kind: "source", label: `源${sourceNumber}` }];
        if (outCount === 0 && inCount > 0) return [node.id, { kind: "outlet", label: "输出" }];
        return null;
      })
      .filter((item): item is [string, NodeBadge] => Boolean(item)),
  );
}

function countVisibleEdges(edges: FlowEdge[], key: "from" | "to") {
  const counts = new Map<string, number>();
  edges.forEach((edge) => {
    if (edge.kind === "闭环线路") return;
    counts.set(edge[key], (counts.get(edge[key]) ?? 0) + 1);
  });
  return counts;
}

function routeY(from: FlowNode, to: FlowNode, edge: FlowEdge) {
  const fromY = from.y ?? 0;
  const toY = to.y ?? 0;
  if (edge.primary) return (fromY + toY) / 2;

  const top = Math.min(fromY, toY);
  const bottom = Math.max(fromY, toY);
  const gap = bottom - top;
  if (gap > 120) {
    const section = 0.28 + (stableHash(edge.id) % 3) * 0.16;
    return top + gap * section;
  }

  const side = stableHash(edge.id) % 2 === 0 ? -1 : 1;
  return (fromY + toY) / 2 + side * (46 + (stableHash(edge.id) % 3) * 16);
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997;
  }
  return hash;
}

function readMapPreference(key: string, fallback: number, minimum: number, maximum: number) {
  if (typeof window === "undefined") return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function edgeClass(edge: FlowEdge) {
  const primaryClass = edge.primary ? "edge-main" : "";
  const kindClass =
    edge.kind === "河流"
      ? "edge-river"
      : edge.kind === "小溪"
        ? "edge-creek"
        : edge.kind === "闭环线路"
          ? "edge-loop"
          : edge.kind === "溢流支路"
            ? "edge-overflow"
            : edge.kind === "异常支路"
              ? "edge-risk"
              : "edge-canal";
  const confidenceClassName = edge.confidence < 60 ? "edge-low-confidence" : "";
  return `${primaryClass} ${kindClass} ${edgeStatusClass(edge.status)} ${confidenceClassName}`;
}

function edgeWidth(edge: FlowEdge) {
  const hasDiagnostic = edgeDiagnosticLevel(edge) !== "none";
  if (edge.primary) return Math.max(5.4, Math.min(7.4, edge.volume / 13));
  if (hasDiagnostic) return Math.max(3.4, Math.min(5.2, edge.volume / 18));
  if (edge.kind === "小溪") return Math.max(1.9, Math.min(3.2, edge.volume / 28));
  if (edge.kind === "河流") return Math.max(2.8, Math.min(4.4, edge.volume / 20));
  return Math.max(2.4, Math.min(3.8, edge.volume / 22));
}

function aggregateStemWidth(stem: ConfluenceStem, edges: FlowEdge[]) {
  const participating = edges.filter((edge) => stem.edgeIds.includes(edge.id));
  return flowDisplayWidth(participating.reduce((sum, edge) => sum + edgeFlowAmount(edge), 0));
}

function confluenceBranchWidth(
  edge: FlowEdge,
  layout: { points: Map<string, ConfluencePoint>; outputPoints: Map<string, BifurcationPoint> },
) {
  const isMergedBranch = [...layout.points.values()].some((point) => point.incomingIds.includes(edge.id));
  const isSplitBranch = [...layout.outputPoints.values()].some((point) => point.outgoingIds.includes(edge.id));
  if (!isMergedBranch && !isSplitBranch) return edgeWidth(edge);
  return flowDisplayWidth(edgeFlowAmount(edge));
}

function edgeFlowAmount(edge: FlowEdge) {
  return Math.max(1, edge.visualRelationCount ?? edge.volume / 25);
}

function flowDisplayWidth(flow: number) {
  return Math.min(11.5, 1.4 + 1.55 * Math.sqrt(Math.max(1, flow)));
}

function labelLines(name: string, capacity: NonNullable<FlowNode["capacity"]>) {
  const max = capacity === "小溪" ? 9 : capacity === "河道" ? 11 : 12;
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.:/-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const source = tokens.length ? tokens : [name];
  const lines: string[] = [];

  source.forEach((token) => {
    const compact = token.length > max ? shorten(token, max) : token;
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push(compact);
      return;
    }
    if (`${last} ${compact}`.length <= max) {
      lines[lines.length - 1] = `${last} ${compact}`;
      return;
    }
    lines.push(compact);
  });

  if (lines.length <= 2) return lines;
  return [lines[0], shorten(lines.slice(1).join(" "), max + 2)];
}

function textLengthFor(capacity: NonNullable<FlowNode["capacity"]>) {
  if (capacity === "湖") return 82;
  if (capacity === "水库") return 86;
  if (capacity === "水池") return 74;
  if (capacity === "河道") return 70;
  return 52;
}

function hitRadius(capacity: NonNullable<FlowNode["capacity"]>) {
  if (capacity === "湖") return 62;
  if (capacity === "水库") return 62;
  if (capacity === "水池") return 56;
  if (capacity === "河道") return 54;
  return 44;
}

function scaleNodePositions(nodes: FlowNode[], edges: FlowEdge[], spacingScale: number) {
  if (!nodes.length) return nodes;
  const safeScale = Math.max(0.8, Math.min(1.9, spacingScale));
  return balanceNodeGrid(nodes, edges, safeScale);
}

function balanceNodeGrid(nodes: FlowNode[], edges: FlowEdge[], spacingScale: number) {
  const depth = buildVisualDepths(nodes, edges);
  const primaryOrder = primaryNodeOrder(edges);
  const originalOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const buckets = new Map<number, FlowNode[]>();
  nodes.forEach((node) => {
    const column = depth.get(node.id) ?? 0;
    buckets.set(column, [...(buckets.get(column) ?? []), node]);
  });

  const columnGap = Math.max(310, Math.min(520, 292 * spacingScale));
  const rowGap = Math.max(168, Math.min(260, 154 * spacingScale));
  const positions = new Map<string, { x: number; y: number; depth: number }>();

  const orderedBuckets = orderTerrainLayers(buckets, edges, originalOrder, primaryOrder);
  const largestLayer = Math.max(1, ...Array.from(orderedBuckets.values()).map((bucket) => bucket.length));
  const terrainHeight = Math.max(680, (largestLayer + 1) * rowGap);

  Array.from(orderedBuckets.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([column, bucket]) => {
      bucket.forEach((node, index) => {
        const x = 150 + column * columnGap;
        // Each processing-depth band uses the same virtual terrain height.
        // Sparse bands are distributed through that height instead of being
        // packed into the upper-left corner of a large project canvas.
        const y = bucket.length === 1
          ? terrainHeight / 2
          : 110 + index * ((terrainHeight - 220) / Math.max(1, bucket.length - 1));
        positions.set(node.id, { x, y, depth: column });
      });
    });

  return nodes.map((node) => ({
    ...node,
    ...(positions.get(node.id) ?? { x: node.x ?? 126, y: node.y ?? 132, depth: node.depth ?? 0 }),
  }));
}

function orderTerrainLayers(
  buckets: Map<number, FlowNode[]>,
  edges: FlowEdge[],
  originalOrder: Map<string, number>,
  primaryOrder: Map<string, number>,
) {
  const ordered = new Map(Array.from(buckets, ([depth, bucket]) => [depth, [...bucket].sort((a, b) =>
    (primaryOrder.get(a.id) ?? 9999) - (primaryOrder.get(b.id) ?? 9999) ||
    (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0),
  )]));
  const depthById = new Map(Array.from(ordered, ([depth, bucket]) => bucket.map((node) => [node.id, depth] as const)).flat());
  const neighbors = (id: string, direction: "up" | "down") => edges
    .filter((edge) => edge.kind !== "闭环线路" && (direction === "up" ? edge.to === id : edge.from === id))
    .map((edge) => direction === "up" ? edge.from : edge.to);

  for (let sweep = 0; sweep < 10; sweep += 1) {
    const depths = Array.from(ordered.keys()).sort((a, b) => sweep % 2 === 0 ? a - b : b - a);
    depths.forEach((layerDepth) => {
      const direction = sweep % 2 === 0 ? "up" : "down";
      const adjacentDepth = layerDepth + (direction === "up" ? -1 : 1);
      const adjacent = ordered.get(adjacentDepth);
      const layer = ordered.get(layerDepth);
      if (!layer) return;
      const adjacentIndex = new Map((adjacent ?? []).map((node, index) => [node.id, index]));
      const currentIndex = new Map(layer.map((node, index) => [node.id, index]));
      const score = (node: FlowNode) => {
        const values = neighbors(node.id, direction)
          .filter((id) => depthById.get(id) === adjacentDepth)
          .map((id) => adjacentIndex.get(id))
          .filter((value): value is number => value !== undefined);
        const sameLayerValues = edges
          .filter((edge) => edge.kind !== "闭环线路" && (edge.from === node.id || edge.to === node.id))
          .map((edge) => edge.from === node.id ? edge.to : edge.from)
          .filter((id) => depthById.get(id) === layerDepth)
          .map((id) => currentIndex.get(id))
          .filter((value): value is number => value !== undefined);
        const weighted = [...values, ...values, ...sameLayerValues];
        return weighted.length ? weighted.reduce((sum, value) => sum + value, 0) / weighted.length : Number.POSITIVE_INFINITY;
      };
      ordered.set(layerDepth, [...layer].sort((a, b) => score(a) - score(b) || (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0)));
    });
  }
  optimizeFanLayerCrossings(ordered, edges);
  return ordered;
}

function optimizeFanLayerCrossings(ordered: Map<number, FlowNode[]>, edges: FlowEdge[]) {
  const depthById = new Map(Array.from(ordered, ([depth, layer]) => layer.map((node) => [node.id, depth] as const)).flat());
  const forwardEdges = edges.filter((edge) => {
    const fromDepth = depthById.get(edge.from);
    const toDepth = depthById.get(edge.to);
    return edge.kind !== "闭环线路" && fromDepth !== undefined && toDepth !== undefined && toDepth > fromDepth;
  });

  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    const depths = Array.from(ordered.keys()).sort((a, b) => pass % 2 === 0 ? a - b : b - a);
    depths.forEach((depth) => {
      const layer = ordered.get(depth);
      if (!layer || layer.length < 2) return;
      for (let index = 0; index < layer.length - 1; index += 1) {
        const before = fanBoundaryCrossingScore(ordered, forwardEdges, depth);
        [layer[index], layer[index + 1]] = [layer[index + 1]!, layer[index]!];
        const after = fanBoundaryCrossingScore(ordered, forwardEdges, depth);
        if (after < before) {
          improved = true;
        } else {
          [layer[index], layer[index + 1]] = [layer[index + 1]!, layer[index]!];
        }
      }
    });
    if (!improved) break;
  }
}

function fanBoundaryCrossingScore(ordered: Map<number, FlowNode[]>, edges: FlowEdge[], changedDepth: number) {
  const indexById = new Map<string, { depth: number; rank: number }>();
  ordered.forEach((layer, depth) => {
    const denominator = Math.max(1, layer.length - 1);
    layer.forEach((node, index) => indexById.set(node.id, { depth, rank: index / denominator }));
  });
  const boundaries = [changedDepth - 1, changedDepth].filter((boundary) => ordered.has(boundary) && ordered.has(boundary + 1));
  let score = 0;

  boundaries.forEach((boundary) => {
    const segments = edges.flatMap((edge) => {
      const from = indexById.get(edge.from);
      const to = indexById.get(edge.to);
      if (!from || !to || from.depth > boundary || to.depth <= boundary) return [];
      const span = Math.max(1, to.depth - from.depth);
      const leftProgress = (boundary - from.depth) / span;
      const rightProgress = (boundary + 1 - from.depth) / span;
      return [{
        edge,
        left: from.rank + (to.rank - from.rank) * leftProgress,
        right: from.rank + (to.rank - from.rank) * rightProgress,
      }];
    });
    for (let first = 0; first < segments.length; first += 1) {
      for (let second = first + 1; second < segments.length; second += 1) {
        const a = segments[first]!;
        const b = segments[second]!;
        if (a.edge.from === b.edge.from || a.edge.to === b.edge.to) continue;
        if ((a.left - b.left) * (a.right - b.right) < -0.0001) score += 1;
      }
    }
  });
  return score;
}

function buildVisualDepths(nodes: FlowNode[], edges: FlowEdge[]) {
  const visibleIds = new Set(nodes.map((node) => node.id));
  const originalOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const usableEdges = edges.filter((edge) =>
    edge.kind !== "闭环线路" && visibleIds.has(edge.from) && visibleIds.has(edge.to) && edge.from !== edge.to,
  );
  const outgoing = new Map<string, FlowEdge[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  usableEdges.forEach((edge) => {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  });

  const depth = new Map<string, number>();
  const processed = new Set<string>();
  const queue = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((a, b) => Number(Boolean(b.depth === 0)) - Number(Boolean(a.depth === 0)) || (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0))
    .map((node) => node.id);

  while (processed.size < nodes.length) {
    if (!queue.length) {
      const cycleRoot = nodes
        .filter((node) => !processed.has(node.id))
        .sort((a, b) =>
          (indegree.get(a.id) ?? 0) - (indegree.get(b.id) ?? 0) ||
          Number(Boolean(b.depth === 0)) - Number(Boolean(a.depth === 0)) ||
          (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0),
        )[0];
      if (!cycleRoot) break;
      queue.push(cycleRoot.id);
      if (!depth.has(cycleRoot.id)) depth.set(cycleRoot.id, 0);
    }

    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    const currentDepth = depth.get(id) ?? 0;
    (outgoing.get(id) ?? []).forEach((edge) => {
      if (!processed.has(edge.to)) {
        depth.set(edge.to, Math.max(depth.get(edge.to) ?? 0, currentDepth + 1));
        indegree.set(edge.to, Math.max(0, (indegree.get(edge.to) ?? 0) - 1));
        if ((indegree.get(edge.to) ?? 0) === 0) queue.push(edge.to);
      }
    });
    queue.sort((left, right) =>
      (depth.get(left) ?? 0) - (depth.get(right) ?? 0) ||
      (originalOrder.get(left) ?? 0) - (originalOrder.get(right) ?? 0),
    );
  }

  const maxDepth = Math.max(1, ...Array.from(depth.values()));
  const visualMax = Math.min(18, maxDepth);
  return new Map(nodes.map((node) => [
    node.id,
    Math.round(((depth.get(node.id) ?? 0) / maxDepth) * visualMax),
  ]));
}

function primaryNodeOrder(edges: FlowEdge[]) {
  const order = new Map<string, number>();
  edges
    .filter((edge) => edge.primary)
    .forEach((edge) => {
      if (!order.has(edge.from)) order.set(edge.from, order.size);
      if (!order.has(edge.to)) order.set(edge.to, order.size);
    });
  return order;
}

function fanSkeletonNodeOrder(nodes: FlowNode[], edges: FlowEdge[]) {
  const order = new Map<string, number>();
  const originalOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map<string, FlowEdge[]>();
  const incoming = countVisibleEdges(edges, "to");

  edges.filter((edge) => edge.kind !== "闭环线路").forEach((edge) => {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  });
  outgoing.forEach((group, id) => {
    outgoing.set(id, [...group].sort((a, b) =>
      Number(Boolean(b.primary)) - Number(Boolean(a.primary)) ||
      (originalOrder.get(a.to) ?? 9999) - (originalOrder.get(b.to) ?? 9999),
    ));
  });

  const visit = (id: string) => {
    if (order.has(id)) return;
    order.set(id, order.size);
    (outgoing.get(id) ?? []).forEach((edge) => visit(edge.to));
  };
  nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort((a, b) => (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0))
    .forEach((node) => visit(node.id));
  nodes.forEach((node) => visit(node.id));
  return order;
}


function buildFanLevelOfDetail(nodes: FlowNode[], edges: FlowEdge[], mode: EdgeMode, zoomPercent: number) {
  if (mode === "important") {
    const nodeIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    return {
      nodes: nodes.filter((node) => nodeIds.has(node.id)),
      edges,
      nodeIds,
      level: "overview" as const,
    };
  }
  if (mode === "issues") {
    const nodeIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    nodes.forEach((node) => {
      if (isDiagnosticStatus(node.status)) nodeIds.add(node.id);
    });
    return {
      nodes: nodes.filter((node) => nodeIds.has(node.id)),
      edges,
      nodeIds,
      level: "detail" as const,
    };
  }
  if (mode !== "fan" && mode !== "all") {
    return { nodes, edges, nodeIds: new Set(nodes.map((node) => node.id)), level: "detail" as const };
  }
  if (mode === "all") {
    return { nodes, edges, nodeIds: new Set(nodes.map((node) => node.id)), level: "detail" as const };
  }
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  if (mode === "fan" && zoomPercent >= 78) {
    return { nodes, edges, nodeIds: new Set(nodes.map((node) => node.id)), level: "detail" as const };
  }
  const visibleEdges = edges.filter((edge) =>
    edge.primary || nodeMap.get(edge.from)?.visualKind === "basin" || nodeMap.get(edge.to)?.visualKind === "basin" ||
      (edge.visualRelationCount ?? 0) >= 2 || edge.kind === "闭环线路",
  );
  const nodeIds = new Set(visibleEdges.flatMap((edge) => [edge.from, edge.to]));
  nodes.forEach((node) => {
    if (node.depth === 0) nodeIds.add(node.id);
  });
  return {
    nodes: nodes.filter((node) => nodeIds.has(node.id)),
    edges: visibleEdges,
    nodeIds,
    level: "module" as const,
  };
}

function filterEdges(
  edges: FlowEdge[],
  mode: EdgeMode,
  presentation: "diagnostics" | "breakpoints",
  breakpointImpact: BreakpointImpact,
) {
  if (mode === "all" || mode === "confluence" || mode === "fan") return edges;
  if (mode === "issues") {
    if (presentation === "breakpoints") return edges.filter((edge) => breakpointImpact.affectedEdges.has(edge.id));
    return edges.filter((edge) => edgeDiagnosticLevel(edge) !== "none");
  }
  if (mode === "important") return edges.filter((edge) => edge.primary);
  return edges.filter((edge) =>
    edge.primary || edge.kind === "闭环线路" ||
    (presentation === "breakpoints" ? breakpointImpact.affectedEdges.has(edge.id) : edgeDiagnosticLevel(edge) !== "none"),
  );
}

function buildGraphBounds(
  nodes: FlowNode[],
  routes: Map<string, TerrainRoute>,
  confluenceLayout: {
    points: Map<string, ConfluencePoint>;
    outputPoints: Map<string, BifurcationPoint>;
    mergePorts: Map<string, FlowPort>;
    splitPorts: Map<string, FlowPort>;
  },
  sharedChannels: AlluvialCorridor[],
): GraphBounds {
  const points: FlowPort[] = [];
  nodes.forEach((node) => {
    const radius = hitRadius(node.capacity ?? inferNodeCapacity(node)) + 24;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    points.push({ x: x - radius, y: y - radius }, { x: x + radius, y: y + radius });
  });
  routes.forEach((route) => {
    if (!route.bounds) return;
    points.push({ x: route.bounds.minX, y: route.bounds.minY }, { x: route.bounds.maxX, y: route.bounds.maxY });
  });
  confluenceLayout.points.forEach((point) => points.push(point));
  confluenceLayout.outputPoints.forEach((point) => points.push(point));
  confluenceLayout.mergePorts.forEach((point) => points.push(point));
  confluenceLayout.splitPorts.forEach((point) => points.push(point));
  sharedChannels.forEach((channel) => points.push(channel.marker));
  if (!points.length) return { minX: 0, minY: 0, maxX: 1180, maxY: 560 };
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function buildMapViewport(bounds: GraphBounds) {
  const padding = 120;
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    width: Math.max(1180, Math.ceil((contentWidth + padding * 2) / 20) * 20),
    height: Math.max(560, Math.ceil((contentHeight + padding * 2) / 20) * 20),
  };
}

function edgeRenderRank(edge: FlowEdge) {
  const diagnostic = edgeDiagnosticLevel(edge) === "none" ? 0 : 3;
  const primary = edge.primary ? 1 : 0;
  const loop = edge.kind === "闭环线路" ? 1 : 0;
  return primary + loop + diagnostic * 10;
}

type DiagnosticLevel = "none" | "warn" | "risk" | "critical";
type BreakpointImpact = {
  breakpointNodes: Set<string>;
  affectedNodes: Set<string>;
  affectedEdges: Set<string>;
};

function buildBreakpointImpact(nodes: FlowNode[], edges: FlowEdge[]): BreakpointImpact {
  const breakpointNodes = new Set(
    nodes
      .filter((node) => node.details?.some((detail) => detail.includes("设置了断点")))
      .map((node) => node.id),
  );
  const affectedNodes = new Set<string>();
  const affectedEdges = new Set<string>();
  const queue = [...breakpointNodes];
  const visited = new Set(queue);

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    edges.filter((edge) => edge.from === current).forEach((edge) => {
      affectedEdges.add(edge.id);
      if (visited.has(edge.to)) return;
      visited.add(edge.to);
      affectedNodes.add(edge.to);
      queue.push(edge.to);
    });
  }

  return { breakpointNodes, affectedNodes, affectedEdges };
}

function visualNodeDiagnosticLevel(
  node: FlowNode,
  confidence: number,
  binding: WaterDeepWebBinding | undefined,
  presentation: "diagnostics" | "breakpoints",
  impact: BreakpointImpact,
): DiagnosticLevel {
  if (presentation === "breakpoints") {
    if (impact.breakpointNodes.has(node.id)) return "critical";
    if (impact.affectedNodes.has(node.id)) return "warn";
    return "none";
  }
  return mergeDiagnosticLevels(nodeDiagnosticLevel(node, confidence), bindingDiagnosticLevel(binding));
}

function visualEdgeDiagnosticLevel(
  edge: FlowEdge,
  binding: WaterDeepWebBinding | undefined,
  presentation: "diagnostics" | "breakpoints",
  impact: BreakpointImpact,
): DiagnosticLevel {
  if (presentation === "breakpoints") {
    if (!impact.affectedEdges.has(edge.id)) return "none";
    return impact.breakpointNodes.has(edge.from) ? "critical" : "warn";
  }
  return mergeDiagnosticLevels(edgeDiagnosticLevel(edge), bindingDiagnosticLevel(binding));
}

function nodeDiagnosticLevel(node: FlowNode, confidence: number): DiagnosticLevel {
  if (node.status === "Blocked") return "critical";
  if (node.status === "Overflow Risk" || node.status === "Open") return "risk";
  if (node.status === "Partially Closed" || node.status === "Unknown" || confidence < 70) return "warn";
  return "none";
}

function edgeDiagnosticLevel(edge: FlowEdge): DiagnosticLevel {
  if (edge.taintStatus === "exposed") return edge.evidenceGrade === "runtime" ? "critical" : "risk";
  if (edge.taintStatus === "candidate") return "warn";
  if (edge.status === "Blocked") return "critical";
  if (edge.status === "Overflow Risk" || edge.status === "Open") return "risk";
  if (edge.status === "Partially Closed" || edge.status === "Unknown" || edge.confidence < 60) return "warn";
  return "none";
}

function edgeDiagnosticRank(edge: FlowEdge) {
  const level = edgeDiagnosticLevel(edge);
  if (level === "critical") return 4;
  if (level === "risk") return 3;
  if (level === "warn") return 2;
  return 1;
}

function bindingForNode(node: FlowNode, bindings: Record<string, WaterDeepWebBinding>) {
  return bindings[node.id] ?? (node.functionId ? bindings[node.functionId] : undefined);
}

function strongestBinding(bindings: Array<WaterDeepWebBinding | undefined>) {
  return bindings.filter(Boolean).sort((a, b) => diagnosticRank(bindingDiagnosticLevel(b)) - diagnosticRank(bindingDiagnosticLevel(a)))[0];
}

function bindingDiagnosticLevel(binding?: WaterDeepWebBinding): DiagnosticLevel {
  if (!binding) return "none";
  if (binding.level === "critical" || binding.fitnessScore < 42) return "critical";
  if (binding.level === "risk" || binding.knowledgeScore < 58 || binding.fitnessImpact >= 18) return "risk";
  if (binding.level === "warn" || binding.confidence < 72 || binding.confidenceImpact >= 10) return "warn";
  return "none";
}

function mergeDiagnosticLevels(a: DiagnosticLevel, b: DiagnosticLevel): DiagnosticLevel {
  return diagnosticRank(a) >= diagnosticRank(b) ? a : b;
}

function diagnosticRank(level: DiagnosticLevel) {
  if (level === "critical") return 3;
  if (level === "risk") return 2;
  if (level === "warn") return 1;
  return 0;
}

function diagnosticLevelClass(level: DiagnosticLevel) {
  return level === "none" ? "" : `diagnostic-${level}`;
}

function edgeMarkerUrl(level: DiagnosticLevel) {
  if (level === "critical") return "url(#water-arrow-critical)";
  if (level === "risk") return "url(#water-arrow-risk)";
  if (level === "warn") return "url(#water-arrow-warn)";
  return "url(#water-arrow)";
}

function nodeMarkerPoint(capacity: NonNullable<FlowNode["capacity"]>) {
  if (capacity === "湖") return { x: 45, y: -27 };
  if (capacity === "水库") return { x: 50, y: -29 };
  if (capacity === "水池") return { x: 43, y: -26 };
  if (capacity === "河道") return { x: 40, y: -24 };
  return { x: 31, y: -22 };
}

function nodeBadgePoint(capacity: NonNullable<FlowNode["capacity"]>) {
  if (capacity === "湖") return { x: -36, y: -20 };
  if (capacity === "水库") return { x: -38, y: -18 };
  if (capacity === "水池") return { x: -32, y: -17 };
  if (capacity === "河道") return { x: -32, y: -17 };
  return { x: -22, y: -14 };
}

function edgeMarkerPoint(
  from: FlowNode,
  to: FlowNode,
  edge: FlowEdge,
  edgeMode: EdgeMode,
  confluencePoints: Map<string, ConfluencePoint>,
  bifurcationPoints: Map<string, BifurcationPoint>,
) {
  const point = confluencePoints.get(to.id);
  if (edgeMode === "confluence" && point && point.incomingIds.includes(edge.id) && edge.kind !== "闭环线路") {
    return {
      x: point.x,
      y: point.y,
    };
  }
  const splitPoint = bifurcationPoints.get(from.id);
  if (edgeMode === "confluence" && splitPoint && splitPoint.outgoingIds.includes(edge.id)) return { x: splitPoint.x, y: splitPoint.y };
  return {
    x: ((from.x ?? 0) + (to.x ?? 0)) / 2,
    y: routeY(from, to, edge),
  };
}

function statusClass(status: FlowNode["status"]) {
  return `status-${status.toLowerCase().replace(/\s+/g, "-")}`;
}

function edgeStatusClass(status: FlowEdge["status"]) {
  return `edge-status-${status.toLowerCase().replace(/\s+/g, "-")}`;
}

function isDiagnosticStatus(status: FlowNode["status"] | FlowEdge["status"]) {
  return status !== "Closed";
}

function statusLabel(status: FlowNode["status"] | FlowEdge["status"]) {
  if (status === "Closed") return "正常";
  if (status === "Partially Closed") return "待确认";
  if (status === "Open") return "链路不完整";
  if (status === "Overflow Risk") return "负载警戒";
  if (status === "Blocked") return "阻塞";
  return "未知";
}

function popupStyle(x: number, y: number) {
  return {
    left: `${Math.min(820, Math.max(18, x + 26))}px`,
    top: `${Math.min(318, Math.max(18, y - 42))}px`,
  };
}

function edgePopupStyle(edge: FlowEdge, nodeMap: Map<string, FlowNode>) {
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  const x = ((from?.x ?? 520) + (to?.x ?? 620)) / 2;
  const y = ((from?.y ?? 260) + (to?.y ?? 300)) / 2;
  return popupStyle(x, y);
}

function edgeDiagnosticText(edge: FlowEdge) {
  if (edge.taintStatus === "exposed") return `这条关系位于 ${edge.taintPathIds?.length ?? 1} 条从外部输入到敏感操作的可达路径上，且路径中没有识别到验证、净化或权限边界。`;
  if (edge.taintStatus === "sanitized") return "这条关系承载外部数据，但上游或当前路径已经识别到验证、净化或权限边界。";
  if (edge.taintStatus === "candidate") return "这条关系可能传递外部数据到敏感操作，但实参绑定、类型或运行轨迹尚不足，当前只作为候选提示。";
  if (edge.confidence < 60) return "这条函数关系的证据较弱，建议用 Tree-sitter、LSP 或运行轨迹补强调用与数据传递事实。";
  if (edge.status === "Overflow Risk") return "这条函数关系存在高负载风险，需要检查输入上限、缓存清理和背压策略。";
  if (edge.status === "Blocked") return "这条函数关系可能被断点、阻塞调用或无限循环截断。";
  if (edge.status === "Open") return "这条函数关系可能缺少明确返回、错误出口或异常处理。";
  if (edge.status === "Partially Closed") return "这条函数关系仍需确认输入验证以及不同输入样本的执行方向。";
  return "这条函数调用或数据传递关系当前没有发现结构异常，负载值来自静态估算。";
}

function nodeDiagnosticText(node: FlowNode, confidence: number) {
  const note = productTerminology(node.note);
  if (node.status === "Blocked") return `${note}。当前函数命中阻塞规则或断点，执行可能在这里停止。`;
  if (node.status === "Overflow Risk") return `${note}。当前函数存在高负载风险，需要检查缓存、数组、队列、内存上限或重复 I/O。`;
  if (node.status === "Partially Closed") return `${note}。当前函数的解析证据不足，需要补充类型、权限、输入校验或运行轨迹。`;
  if (node.status === "Open") return `${note}。当前函数没有识别到明确返回、状态写入、外部调用结果或错误出口。`;
  if (confidence < 70) return `${note}。当前结论置信度偏低，建议补充 AST、LSP 或真实运行样本。`;
  return `${note}。当前函数没有发现结构性错误；诊断等级由负载估计、解析置信度和规则命中共同决定。`;
}

function nodeRuleBindingSummary(node: FlowNode) {
  const details = node.details ?? [];
  const ruleCount = details.filter((detail) => detail.startsWith("规则证据：")).length;
  const hasRepair = details.some((detail) => detail.startsWith("修正建议："));
  if (ruleCount && hasRepair) return `命中 ${ruleCount} 条本地规则，已生成证据和修正建议。`;
  if (ruleCount) return `命中 ${ruleCount} 条本地规则，当前用于解释函数的诊断等级和置信度。`;
  if (node.status !== "Closed") return "未命中特定规则，但状态由返回路径、断点、解析置信度或负载模型触发。";
  return "未命中特定风险规则，函数保持正常状态。";
}

function edgeEvidenceLines(edge: FlowEdge) {
  const evidenceParts = edge.evidence
    .split(" · ")
    .filter((part) => /规则证据|修正建议|诊断|call|channel|edge|function/i.test(part))
    .slice(0, 5);
  const direction = edge.kind === "闭环线路" ? "循环调用关系，方向以箭头为准。" : "上游函数把参数、返回值或状态传递给下游函数。";
  const dataLine = edge.dataItems?.length
    ? `传导数据：${edge.dataItems.map((item) => `${item.name} (${item.type})`).join("；")}。`
    : "传导数据：尚未解析到实参与形参的精确绑定。";
  const boundaryLine = `边界：${edge.sourceKind ?? "unknown"} -> ${edge.sinkKind ?? "unknown"}；证据等级 ${edge.evidenceGrade ?? "lexical"}。`;
  const runtimeLine = edge.runtimeObservation?.evidence ?? "尚无运行轨迹证据。";
  const taintLine = edge.taintStatus && edge.taintStatus !== "none"
    ? `Source-to-sink：${edge.taintStatus}，关联 ${edge.taintPathIds?.length ?? 0} 条污点路径。`
    : "Source-to-sink：当前数据路径未关联可达污点路径。";
  return [direction, dataLine, boundaryLine, taintLine, runtimeLine, ...evidenceParts].map(productTerminology);
}

function productTerminology(value: string) {
  return value
    .replaceAll("水流法", "数据流分析")
    .replaceAll("水文图", "数据流图")
    .replaceAll("水系图", "数据流图")
    .replaceAll("主河道", "主路径")
    .replaceAll("水路", "数据路径")
    .replaceAll("流域", "模块域")
    .replaceAll("堤坝", "安全边界")
    .replaceAll("阀门", "验证节点")
    .replaceAll("水源", "输入节点")
    .replaceAll("排水口", "输出节点")
    .replaceAll("湖泊/水库", "集合/缓存节点")
    .replaceAll("湖水", "数据容量")
    .replaceAll("回流", "循环路径")
    .replaceAll("堵塞", "阻塞")
    .replaceAll("溢流", "容量超限");
}
