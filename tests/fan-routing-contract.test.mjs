import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const diagramUrl = new URL("../app/components/WaterCanalDiagram.tsx", import.meta.url);

test("fan edge routing freezes real Function positions before virtual routing", async () => {
  const source = await readFile(diagramUrl, "utf8");

  assert.match(source, /Object\.freeze\(\{ \.\.\.node \}\)/);
  assert.match(source, /const confluenceLayout = buildConfluenceLayout\(displayNodes/);
  assert.match(source, /const sharedChannels = buildSharedFlowChannels\(/);
  assert.match(source, /const routingTerrain = buildLayerRoutingTerrain\(/);
  assert.match(source, /enforceWholeLayerClearance[\s\S]*const positions = new Map/);
  assert.doesNotMatch(source, /buildPolarTerrainRoutes[\s\S]{0,1200}node\.(?:x|y|fanRadius|fanAngle)\s*=/);
});

test("fan router uses strip waypoints, shared channels and local crossing repair", async () => {
  const source = await readFile(diagramUrl, "utf8");

  assert.match(source, /relevantStrips\.forEach/);
  assert.match(source, /radialOverlap >= 72/);
  assert.match(source, /sourceBasins\.has\(candidate\.sourceBasin\) \|\| cluster\.targetBasins\.has\(candidate\.targetBasin\)/);
  assert.match(source, /for \(let pass = 0; pass < 4; pass \+= 1\)/);
  assert.match(source, /polylinesIntersect\(leftRoute\.samples\.slice\(2, -2\), rightRoute\.samples\.slice\(2, -2\)\)/);
  assert.match(source, /nodeIntersections \* 1_000_000/);
  assert.match(source, /crossings \* 1_000_000/);
  assert.match(source, /backwardRadial \* 12_000/);
  assert.match(source, /longDetour \* 2_800/);
});

test("visual bundling preserves independent semantic lanes", async () => {
  const source = await readFile(diagramUrl, "utf8");

  assert.match(source, /className="water-shared-channel multi-lane-shared-corridor"/);
  assert.match(source, /data-semantic-edge-count=\{channel\.edgeIds\.length\}/);
  assert.match(source, /\(channel\.lanes \?\? \[\]\)\.map\(\(lane\)/);
  assert.match(source, /data-channel-id=\{lane\.edgeId\}/);
  assert.match(source, /data-lane-order=\{lane\.laneIndex\}/);
  assert.match(source, /data-source-id=\{lane\.sourceId\}/);
  assert.match(source, /data-target-id=\{lane\.targetId\}/);
  assert.match(source, /smoothRouteThrough\(\[member\.start, laneStart, laneEnd, member\.end\]\)/);
  assert.doesNotMatch(source, /aria-label=\{`共享数据通道，包含/);
});
