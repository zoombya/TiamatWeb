# Tiamat Web Port Plan

This is the living implementation plan for porting the original Tiamat MFC/OpenGL application to the Three.js web app in this repository. Update this file whenever a feature is implemented, corrected, or intentionally deferred.

## Current Port Status

Last updated: 2026-05-23

### Implemented

- [x] Project structure split across dedicated modules:
  - `src/main.js` application bootstrap.
  - `src/model.js` graph/model operations and selection state.
  - `src/scene.js` Three.js rendering, camera views, hit testing, and interaction events.
  - `src/ui.js` UI controls, inspector, import/export commands, and tool mode binding.
  - `src/io.js` JSON, oxView, PDB, sequence, oxDNA, and PNG import/export helpers.
  - `src/geometry.js` geometric helper functions and base normalization.
  - `src/selection-index.js` cached screen-space selection acceleration.
  - `src/constants.js` base colors, Tiamat constants, strand colors, and geometry presets.
  - `tests/run-tests.js` dependency-free regression tests for core model and import behavior.
  - `tests/bench-import.js` dependency-free oxView import performance benchmark.
- [x] Four Tiamat-style views in one WebGL canvas:
  - Perspective.
  - Top.
  - Front.
  - Side.
  - Quad view with scissor rendering and per-view labels.
- [x] Camera navigation:
  - Perspective orbit and pan.
  - Orthographic top/front/side pan and zoom.
  - View framing for imported or created designs.
  - Adaptive fog so large structures are not washed out after import.
- [x] Core graph model:
  - Bases with `up`, `down`, `across`, `slide`, and `sticky` links.
  - Strand traversal and strand assignment.
  - Base id lookup map for large designs.
  - Undo/redo snapshots for current web operations.
  - Copy/paste with graph remapping for copied selections.
- [x] Base creation tools:
  - Create B-form/A-form/free line strands from sequence.
  - Create double-stranded helix from sequence.
  - Add single bases interactively.
  - Extend selected base up or down using local strand direction when available.
  - Pair selected base and pair all unpaired bases.
- [x] Selection tools:
  - Base selection.
  - Pair selection.
  - Strand selection.
  - Helix selection.
  - Half-strand selection.
  - Connected-component selection.
  - Box drag selection.
  - Select all and clear selection.
  - Box selection disables scene rotation while active.
  - Selection modes persist instead of acting as one-shot modifiers.
- [x] Manipulation tools:
  - Translate selected bases.
  - Rotate selected bases around X/Y/Z.
  - Custom translate/rotate gizmos at the selection center of mass, with direct viewport drag fallback.
  - Delete selected bases.
  - Create and delete across, down, slide, and sticky connections.
  - Basic connection validation for down distance and across pairing distance.
- [x] Coloring and base identity:
  - Original-style Tiamat strand color palette restored.
  - Base identity colors for A/T/U/G/C/X.
  - Strand/custom color application to phosphates/strand display.
  - Selected base identity mutation.
  - Strand color reset.
  - Base identity labels for selected bases under label-count limit.
- [x] Rendering surface:
  - Tiamat-scale base and phosphate markers using `MOLECULE_RADIUS = 0.1`.
  - Base and phosphate hit testing.
  - Strand/down, pair/across, slide, and sticky connection rendering.
  - Line and cylinder connection modes.
  - Strand and pair line width controls.
  - Cylinder radius mapping for Tiamat-style widths.
  - Basic Tiamat-like gray background and low-shininess Phong materials.
  - Large structure import path starts in line mode, not cylinders.
  - On-demand render scheduling instead of a continuous animation loop.
  - Basic show/hide controls for grid, base-pair lines, slide links, and sticky links.
  - Optional constraint warning overlay for out-of-tolerance down/across connections.
- [x] Schematic/simplified rendering:
  - Always/Sometimes/Never simplify mode controls.
  - Schematic mode forced onto line rendering, matching original Tiamat behavior.
  - Initial port of `simpleNext`, `centerPosition`, and `displace`-based simplification.
- [x] Import/export:
  - Full project JSON preserving graph links.
  - DNAJSON-style JSON export.
  - Sequence TXT import/export.
  - PDB import/export, approximate.
  - oxDNA text export, approximate.
  - PNG render export.
  - oxView `.oxview` import:
    - Reads `systems -> strands -> monomers`.
    - Imports positions, `n3/n5`, `bp` and `pair`, base type, molecule class, colors, `a1/a3`, and cluster metadata.
    - Rescales imported coordinates to Tiamat's `DOWN_DISTANCE`.
    - Centers imported structures at the origin.
    - Verified on `42hb_v40_polyT.oxview`: 15895 bases, 206 strands, 7494 base pairs.

### Partially Implemented Or Needs Correction

- [ ] Exact original Tiamat base/phosphate geometry:
  - Current web render uses same site for base and phosphate markers because original Tiamat renders nucleobase position as the main molecule marker.
  - Need a careful source-level audit of all original rendering primitives and any implicit phosphate/base-site offsets.
  - RNA and DNA now share the same sphere marker behavior; RNA-specific cube rendering was removed because it did not match expected interaction/visual parity.
- [ ] Tiamat schematic views:
  - Current simplification is based on the original algorithm but has not been visually validated against original Tiamat for long helices, crossovers, and multi-helix bundles.
  - Need exact handling of all original `simpleNext`, `displace`, drawn-state, distance gating, and transition connector cases.
  - [x] Added schematic display controls separated from detailed molecular rendering: Detailed, Mixed, and Schematic.
- [ ] Interaction feel:
  - Selection modes exist, but the original's click/drag phases, modifier semantics, and status feedback are only approximated.
  - [x] Added explicit original-style left-click mode controls: `DoNothing`, `SelectStrand`, `SelectHalfStrand`, `SelectBasePair`, `SelectBase`, `SelectBox`, `CreateStrand`, `CreateFreeform`, `Position`, `Rotation`.
  - [x] Added persistent replace/add/subtract selection operation based on Tiamat's `selectionOffset` behavior.
  - [x] Added keyboard bindings for common Tiamat/editor actions, including `t` for move gizmo and `r` for rotate gizmo.
  - [x] Preserve the last selected selection tool while temporary transform modes are active, and resync toolbar selected states after model redraws.
  - [x] Make selected base/phosphate/strand highlight part of the render signature so selection styling persists through redraws, schematic toggles, and line/cylinder rebuilds.
- [ ] Constraint-respecting manipulation:
  - Existing translate/rotate are geometric transforms only.
  - Need original Tiamat DNA/RNA constraint behavior for move/rotate/create operations.
  - [x] Added optional transform guard that rejects selected transform steps which increase Tiamat constraint violations.
  - [x] Added visual constraint violation feedback for rise, chord, rotation, and inclination.
- [ ] Import/export fidelity:
  - Native `.dna` MFC `CArchive` binary loading is not implemented.
  - Full original Tiamat save/load compatibility remains the biggest file-format gap.
  - PDB and oxDNA exports are approximate and need source-compatible topology/orientation output.
  - oxView import preserves orientation metadata but does not yet use it to render base normals or nucleobase direction.
- [ ] Performance:
  - Rendering uses instanced meshes for bases/phosphates and cylinders, but line geometry is rebuilt on each model update.
  - Need profiling for designs above 50k bases.
  - Need optional level-of-detail rendering that does not obscure exact geometry.
  - Need worker-based parsing for very large imports to avoid main-thread pauses.
  - Box selection and single-click base picking now use a cached screen-space spatial index per view.
- [ ] UI parity:
  - Current UI is modernized but not a faithful command/menu/toolbar port.
  - [x] Added more Tiamat-like command grouping for selection, render, create, manipulation, and transform controls.
  - [x] Removed redundant second selection command panel; inspector now focuses on selection properties.
  - [x] Simplified modern workbench chrome with one top mode strip, compact command/view/file strips, collapsible tool groups, and selection-specific inspector actions.
  - [x] Persist render controls across page reloads, including schematic mode, line widths, connection style, visibility toggles, and constraint display.
  - Need original toolbar icons and exact command/menu naming.
  - [x] Clarified distinction between global render settings, selection properties, and active tool/create settings.

## Original Tiamat Functionality Still To Port

### File And Data Management

- [ ] Native `.dna` file reader and writer.
- [ ] Original undo stack behavior using operation objects, not whole-model snapshots.
- [ ] Original genome database features:
  - Genome list management.
  - FASTA import.
  - Genome fetch/search flow.
  - Sequence editing and assignment to strands.
- [ ] Original dialogs:
  - Create DNA dialog.
  - Freeform creation controls.
  - Rotate dialog.
  - Grid extents dialog.
  - Optimization dialog.
  - Strand bases dialog.
  - Render movie dialog.

### Creation Tools

- [ ] Exact `CreateStrand` workflow from `doCreate`.
- [x] Initial drag-span `CreateStrand` workflow using Tiamat A/B defaults, rise, radius, rotation, orientation, and double-strand pairing.
- [x] Added `CreateDNADialog`-style controls for base count, initial blank/random/sequence mode, molecule mode, backbone rotation, orientation, and single/double type.
- [ ] Exact modal `CreateDNADialog` visual/dialog parity and all edge-case validation.
- [x] Initial `CreateFreeform` workflow from control points with DOWN_DISTANCE sampling.
- [x] Control-point based freeform strand generation.
- [x] Start/end attachment to existing bases during freeform creation.
- [ ] Crossover-aware creation behavior.
- [x] Original A-form/B-form parameter defaulting for web creation controls.
- [x] Original molecule-mode defaulting for DNA/DNA B, DNA/DNA A, DNA/RNA, RNA/DNA, and RNA/RNA creation.
- [ ] Original A-form/B-form parameter validation messages and edge cases.

### Selection And Editing

- [ ] Exact recursive selection behavior from `selectBase`.
- [ ] Select add/subtract command states.
- [ ] Selection phase handling.
- [ ] Select box behavior in all original views.
- [ ] Base-pair, half-strand, strand, and connected selection parity with original edge cases.
- [ ] Original position mode:
  - Drag selected bases in perspective and orthographic views.
  - Update undo operation while dragging.
- [ ] Original rotation mode:
  - View-dependent rotation interaction.
  - Rotation around selected center.
- [ ] Original copy/paste connection preservation and placement semantics.
- [x] Tiamat-style paste now preserves copied coordinates and removes copied links that point outside the copied set.
- [x] Paste now enables Position mode and the move gizmo by default.
- [ ] Original delete behavior for all edge cases.

### Connections And Constraints

- [ ] Full original down/across/slide/sticky semantics.
- [x] Added ligate/nick commands using down-link constraints.
- [ ] Sticky ID handling parity.
- [ ] Slide rendering and edit behavior parity.
- [ ] Constraint status display:
  - [x] Rise.
  - [x] Chord length.
  - [x] Rotation/bend.
  - [x] Inclination.
- [x] Initial constraint validation thresholds for down and across links.
- [ ] Original render modes for full constraint visualization.
  - [x] Initial rise/chord/rotation/inclination constraint line overlay.

### Rendering

- [ ] Exact OpenGL/Tiamat lighting model.
- [ ] Exact sphere/cube/cylinder detail levels:
  - Low/medium/high sphere detail.
  - Low/medium/high cylinder detail.
- [ ] Exact line widths and cylinder widths:
  - Strand line width 1/3/5.
  - Pair line width 1/3/5.
  - Strand cylinder width .01/.025/.05/.075.
  - Pair cylinder width .01/.025/.05/.075.
- [ ] Render modes:
  - Edit detail.
  - Render detail.
  - Presentation detail.
  - Constraint/warning mode.
- [ ] Grid display and grid extents.
- [ ] Show/hide options:
  - [x] Grid.
  - [x] Slides.
  - [x] Sticky ends.
  - [x] Base-pair lines.
  - [ ] Base numbers.
  - [x] 5'/3' strand-end markers.
  - [ ] Constraints.
  - [x] Initial down/across constraint warning overlay.
  - [x] Bounding box.
  - [ ] Strand/base labels.
- [ ] Exact schematic simplification and transition connectors.
  - [x] Schematic-only fallback now keeps single strands visible as simplified lines.
- [ ] Offscreen/high-resolution image rendering.
- [ ] Render movie export.

### Views And Interaction Windows

- [ ] Match original split-window layout and view-specific controls more closely.
- [ ] Perspective selection picking parity.
- [ ] Top/front/side picking and box selection parity.
- [ ] Double-click and mode switching parity.
- [ ] View reset/frame commands.
- [ ] View-specific cursor/status feedback.

### Sequence And Strand Tools

- [ ] Strand sequence inspector parity.
- [ ] Base sequence editing by strand.
- [ ] Complement generation and sequence assignment rules.
- [ ] Genome-guided scaffold/staple assignment if present in original workflows.
- [ ] Export sequence formats used by the original app.

### Optimization

- [ ] Port optimization dialog behavior.
- [ ] Port any geometry cleanup or constraint optimization algorithms.
- [x] Add initial deterministic tests for graph creation, selection, JSON roundtrip, and oxView import.
- [ ] Add deterministic tests against original Tiamat source examples.

## Near-Term Implementation Roadmap

1. **Fix visibility and scale for oxView imports**
   - [x] Read `pair` as base-pair field.
   - [x] Rescale imported oxView positions to Tiamat backbone distance.
   - [x] Center imported designs.
   - [x] Remove intrusive dot overlay.
   - [x] Use oxView `a1/a3` metadata for optional base orientation rendering.
   - [ ] Use oxView orientation metadata for exact phosphate/base-site relation.
   - [x] Add an import diagnostics panel showing original scale, applied scale, pair count, and missing-pair count.

2. **Port exact detailed geometry**
   - [ ] Audit `RenderFunctions.cpp` base, RNA, phosphate, and connection drawing.
   - [x] Use the same instanced sphere marker path for DNA and RNA bases.
   - [ ] Add exact base-to-phosphate or site connector if confirmed in source.
   - [ ] Match original material/lighting by visual comparison.

3. **Port Tiamat schematic mode exactly**
   - [ ] Translate `DNADoc.cpp` simplification preprocessing into a dedicated module.
   - [ ] Translate `RenderFunctions.cpp` schematic draw pass into a dedicated renderer.
   - [x] Add separate schematic display controls for detailed/mixed/schematic rendering.
   - [ ] Validate on straight duplexes, bundles, crossovers, and imported oxView structures.

4. **Port original interaction modes**
   - [ ] Add explicit state machine for Tiamat left-click modes.
   - [x] Add explicit original-style left-click mode controls.
   - [x] Port selection add/subtract modes.
   - [x] Add keyboard bindings for Tiamat/editor actions.
   - [x] Add custom position/rotation gizmos at selection center of mass with undo transaction.
   - [ ] Port original position dragging with exact Tiamat interaction semantics.
   - [ ] Port original rotation dragging with exact Tiamat interaction semantics.
   - [x] Port initial freeform strand creation.
   - [x] Add drag-span CreateStrand interaction.
   - [x] Add control-point CreateFreeform interaction with endpoint attachment.

5. **Improve large-structure performance**
   - [x] Make render mode on-demand rather than continuously redrawing.
   - [x] Add dependency-free test command for model/import regressions.
   - [x] Add import benchmark for the 15k-base oxView fixture.
   - [x] Avoid full line-buffer rebuild for selection-only changes.
   - [x] Keep volatile overlays refreshed without forcing full connection-buffer rebuilds.
   - [x] Add spatial index for box selection on large imports.
   - [x] Add spatial acceleration for single-click ray picking on large imports.
   - [ ] Move large JSON parsing and normalization to a worker.
   - [ ] Add performance benchmarks for 15k, 50k, and 100k bases.

6. **Improve original file compatibility**
   - [ ] Reverse/implement native `.dna` serialization.
   - [ ] Add import/export regression fixtures.
   - [ ] Compare exported designs against original Tiamat where possible.

## Verification Checklist

Run these checks after every meaningful porting change:

- [ ] `npm run build`
- [ ] `npm test`
- [ ] Browser reload has no console errors.
- [ ] Default starter design displays 24 bases, 2 strands, 12 pairs.
- [ ] `npm run bench:import`
- [ ] `42hb_v40_polyT.oxview` imports with 15895 bases, 206 strands, 7494 pairs.
- [ ] Large oxView import is visible after framing.
- [ ] Selection still works on base and phosphate geometry.
- [ ] Lines/cylinders/simplify toggles remain coherent.
- [ ] Top/front/side pan and zoom still work.

## Notes For Future Updates

- Keep checkboxes honest: only mark `[x]` after implementation and verification.
- Add source references when porting exact original code paths, especially from `DNADoc.cpp`, `DNADoc.h`, `Perspective.cpp`, `Side.cpp`, and `RenderFunctions.cpp`.
- Prefer adding small focused modules over growing `scene.js` or `ui.js` further.
- When behavior differs intentionally from original Tiamat, document the reason here.
