# Data-Path Aggregation View Design Record (2026-08-14)

Chinese version: [数据路径汇聚视图设计记录-2026-08-14.md](数据路径汇聚视图设计记录-2026-08-14.md)

## Shared Semantic Foundation

The spine and alluvial-fan views change only presentation. Real calls, parameters, returns, state dependencies, exception edges, and source-to-sink paths remain in one precise semantic graph.

## Version A: Spine View

- Production default for quickly reading a large project's backbone.
- Data edges at the same processing depth aggregate into regional corridors.
- Fine branches enter a throughput-sized trunk and split locally near targets.
- Precise edges are not all drawn by default; **All** and **Issues** expose exact relationships.
- Strength: fewer nodes, shorter lines, and a clear control-flow overview.
- Limitation: virtual terrain and elevation relationships are less explicit.

## Version B: Alluvial-Fan View

- Experimental view for levels, confluence, split, and capacity changes.
- Input starts at the upper-left high point and output ends at the lower-right low point.
- One virtual center near the upper-left defines expanding concentric fan arcs. Arcs constrain layout but are never rendered.
- Functions in a layer follow stable topological order. Level 0 is the main entry; forward-path depth assigns Levels 1..n, while loops and callbacks do not inflate depth.
- Ordinary business and compute functions sit on integer layers. Parser, conversion, adaptation, queue, cache, state, and persistence roles can use the routing space between adjacent arcs without changing their semantic depth.
- The band between arcs is valid virtual terrain: the router may adjust endpoints, switch radial/tangential channels, and complete local confluence or split before the next layer.
- A semantic edge from Level 1 to Level n crosses invisible waypoints in each intermediate routing strip. Waypoints constrain geometry and do not fabricate calls or functions.
- Each fan layer has invisible local channels: layer channels carry cross-layer traffic, regional trunks carry module traffic, function feeders connect only near nodes, and same-layer relationships use local arc corridors.
- Functions are ordered by bidirectional parent/child barycenter sweeps, followed by adjacent swaps that are retained only when crossings decrease.
- Every function exposes one visual input gateway and one output gateway while preserving all underlying semantic lanes.
- For `a -> b`, `c -> b`, and `d -> b`, fine feeders join before `b` and one trunk enters it. For `b -> e` and `b -> f`, one trunk leaves `b` and then splits.
- A thick line must be adjacent to a function gateway; it must not appear without semantic justification between unrelated groups.
- A split trunk begins at aggregate width and becomes thinner after each branch. A confluence trunk grows as feeders join and ends as one line entering the function.
- Semantic flow obeys `Q = sum(qi)`. Display width uses `W = baseWidth + coefficient * sqrt(Q)` so relative capacity remains visible without hiding nodes.
- Large projects are divided by processing depth and region. Wider local layer spacing, row spacing, and obstacle clearance keep relationships out of one central knot.
- Routing checks point-to-segment distance against function obstacles and assigns interfering routes to separate tracks.
- Unrelated crossings are a hard constraint. Repair order is: reorder functions within a layer, change the local channel, route along a basin boundary, expand local fan spacing, and only then draw an explicit bridge. Only real semantic convergence may connect.
- Every line receives an independent gap when crossing a virtual arc; unrelated paths cannot meet on the arc or appear connected.
- Precise paths use layer-by-layer Catmull-Rom to cubic Bézier conversion rather than one long curve across many layers.
- At overview zoom, show function-domain aggregates; at medium zoom, module trunks and key functions; at detail zoom, all functions and local branches. Semantic data remains complete at every zoom.
- Each overview domain retains at most one primary input and output. Module and detail zoom restore the collapsed relationships.
- The overview is not a miniature precise-edge graph. It is an acyclic, single-primary-upstream skeleton: each function selects one primary upstream for the global spine, while other true inputs and outputs remain local module tributaries.
- The global overview keeps Level 0 entries, primary-flow nodes, and domain gateways. Ordinary functions do not create independent long-distance overview edges.
- The spine is chosen before endpoint placement; descendants of one trunk occupy a continuous sector. Short local curves replace broad multi-arc detours.
- Collapsed edges remain traceable from their domain gateway or node details.

## View Switching

- **Spine**: Version A and the default.
- **Alluvial Fan**: function-call scale with key calls, local confluence, and multi-input/output feeders; zooming reveals precise calls.
- **All**: whole-project fan skeleton with entries, major processing nodes, and domain gateways instead of compressing every precise edge.
- **Primary Path**: only `primary` relationships and their endpoint functions.
- **Issues**: nodes and paths affected by diagnostics.

## Acceptance Rules

1. Switching views cannot change function, edge, diagnostic, or evidence counts.
2. Visual crossings must never be represented as semantic convergence.
3. A function shows at most one input trunk and one output trunk in fan presentation.
4. Controls occupy a separate region and cannot cover paths or nodes.
5. Clicking an aggregate corridor must recover every represented edge and exact evidence.
6. Unrelated crossings, node penetrations, and function-box overlaps should be zero. If the graph is non-planar, use an explicit bridge symbol.

## Final Revision: Adaptive Flow-First Fan Layout (2026-08-22)

This section supersedes the earlier uniform spacing, count-driven radius, and per-function radial-offset descriptions.

- `flowDepth` defines logical order only. All real functions at one depth share `layerRadius[d]`.
- Radii accumulate: `radius[0] = baseRadius`; `radius[d + 1] = radius[d] + spacing[d]`.
- Every adjacent layer pair computes its own `spacing[d]`; no global expansion multiplier is allowed.
- `nodePressure[d]` uses actual node widths and clickable clearance and controls only `angularSpan[d]`, angular order, and local angular gaps.
- `routingPressure[d]` uses cross-layer edges, weighted Confluence/Split demand, channel demand, and estimated structural crossings and controls only `spacing[d]` and Routing Strip width.
- Every spacing is bounded by `minSpacing`, `preferredSpacing`, and `maxSpacing`. Sparse layers stay near preferred spacing and cannot create a long tail.
- Dense nodes widen only their fan sector; routing pressure widens only its local Routing Strip. No individual function receives radial displacement to repair a collision.
- After radius, sector, order, and collision correction, real function positions freeze. Only Virtual Confluence, Virtual Split, Shared Channel, Waypoint, and Channel Corridor may then move.
- Virtual Terrain is a layer-local Routing Potential Field. It never affects `flowDepth`, `layerRadius`, or function coordinates.
- Low-cost regions are radial-forward, same-branch/basin, existing Shared Channels, and spine corridors. High-cost regions are function obstacles, unrelated branch cores, incompatible channels, crossing hotspots, and radial backtracking.
- Structural repair order is angular ordering, sibling grouping, branch continuity, Virtual Confluence/Split, Shared Channel, Routing Corridor, Potential Field, crossing detection, and local rerouting.
- Long edges advance strip by strip. Shared trunks and local waypoints take priority; a direct long curve is the final fallback.

Responsibility boundary: Flow determines order; Density determines fan width; Routing Pressure determines local layer spacing; Router determines path geometry.

### Function-Box Overlap Acceptance (2026-08-22)

- Required arc length uses real shape diameter, diagnostic badge, and clickable clearance rather than function count alone.
- If a dense layer reaches maximum readable angle, the entire `layerRadius[d]` expands and the delta propagates to later layers; no function changes depth.
- Base spacing uses maximum node diameter plus route clearance. Edge, confluence, split, and estimated crossing pressure affect only the corresponding spacing.
- A full-layer collision pass after basin ordering enforces the sum of node radii and clickable clearances, including across basin boundaries.
- In the 28-visible-node replay, three insufficient gaps before the fix became zero after automatic measurement.

### Edge-Only Frozen Routing (2026-08-22)

- The router receives a frozen copy of real coordinates and cannot modify `x`, `y`, `depth`, `fanRadius`, or `fanAngle`.
- Each cross-layer edge travels through consecutive Routing Strips; multi-layer edges use visual waypoints instead of one long Bézier.
- Shared Channel clustering checks angular similarity, source/target basin compatibility, and overlapping radial intervals. Bundling changes presentation only; every Semantic Edge ID remains traceable.
- Virtual Confluence is placed in the strip before its target; Virtual Split in the strip after its source.
- Up to four local-repair rounds reroute only edges involved in a crossing, node penetration, or abnormal detour.
- Hard costs cover node penetration, unrelated crossing, radial backtracking, long detours, and sharp turns; shared channels and radial progress receive bonuses.
- Replay result: zero coordinate changes across 28 functions; three Shared Channels cover seven true relationships; five edges rerouted locally; zero unrelated node penetrations; two remaining structural crossing candidates.

### Multi-Lane Shared Corridor Semantic Isolation (2026-08-22)

- Visual bundling never performs semantic merge. `VirtualConfluence` exists only when semantic evidence proves real convergence; `VirtualSplit` exists only for one real output feeding multiple downstream targets.
- Unrelated edges sharing geometry use a `Multi-Lane Shared Corridor`. The light corridor envelope is noninteractive and is not a data edge.
- Every lane retains independent `channelId`, stable `laneOrder`, `sourceId`, `targetId`, and full source-to-target trace. No representative edge replaces members.
- Every lane has an independent hit area, severity, color, direction marker, and detail panel. Selection highlights only that edge and its endpoints.
- Input and Output Gateways simplify the visual interface but retain all semantic lanes behind them.
- Function positions remain frozen; only virtual routing objects may move.
- Fixed order: `FlowDepth -> Layer Radius -> Layer-local Function Ordering -> Freeze Function -> Gateway / Confluence / Split -> Multi-Lane Corridor Routing -> Local Crossing Repair`.
- WebView verification: three corridors contain seven independent lanes; all seven `channelId` values are unique; zero legacy single shared thick trunks remain.
