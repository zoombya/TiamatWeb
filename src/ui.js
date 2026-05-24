import * as THREE from 'three';
import { BASES, CONSTRAINTS, STRAND_COLORS, TIAMAT_GEOMETRY } from './constants.js';
import { cleanSequence, formatVector } from './geometry.js';
import { dnaJson, download, fullProjectJson, oxDnaText, parseJsonProject, parseOxViewProject, parsePdb, parseSequenceText, pdbText, sequenceText } from './io.js';

const RENDER_SETTINGS_KEY = 'tiamat-web.render-settings.v1';

export function mountApp(root) {
  root.innerHTML = `
    <main class="workbench">
      <header class="topbar">
        <div class="brand">
          <div><h1>Tiamat Web</h1><p>DNA/RNA nanostructure workbench</p></div>
          <span id="status" class="status">Ready</span>
        </div>
        <nav class="selectionTools modeStrip" aria-label="Selection modes">
          <button data-mode="doNothing">None</button>
          <button class="selected" data-mode="selectBase">Base</button>
          <button data-mode="selectPair">Pair</button>
          <button data-mode="selectStrand">Strand</button>
          <button data-mode="selectHelix">Helix</button>
          <button data-mode="selectHalf">Half</button>
          <button data-mode="selectConnected">Connected</button>
          <button data-mode="selectBox">Box Drag</button>
          <button data-mode="createStrand">Create</button>
          <button data-mode="createFreeform">Freeform</button>
          <button data-mode="position">Position</button>
          <button data-mode="rotation">Rotation</button>
        </nav>
        <nav class="topTools commandStrip" aria-label="Primary commands">
          <button class="icon" data-action="undo" title="Undo">↶</button>
          <button class="icon" data-action="redo" title="Redo">↷</button>
          <button class="icon" data-action="copy" title="Copy">⧉</button>
          <button class="icon" data-action="paste" title="Paste">▤</button>
          <button class="icon" data-action="deleteSelected" title="Delete selected">⌫</button>
          <button class="icon" data-action="frame" title="Frame view">◎</button>
          <input id="fileInput" class="fileInput" type="file" accept=".json,.dnajson,.oxview,.pdb,.dna,.txt" />
          <label class="buttonLike" for="fileInput">Import</label>
          <button data-action="saveProject">Save</button>
          <button data-action="exportJson">DNAJSON</button>
          <button data-action="exportPdb">PDB</button>
          <button data-action="exportOx">oxDNA</button>
          <button data-action="exportPng">PNG</button>
        </nav>
      </header>

      <aside class="toolPalette" aria-label="Tiamat tools">
        <section class="panel compact toolCard">
          <h2>Setup</h2>
          <div class="segmented" aria-label="Molecule">
            <button class="selected" data-molecule="DNA">DNA</button>
            <button data-molecule="RNA">RNA</button>
          </div>
          <div class="segmented" aria-label="Geometry">
            <button data-geometry="A">A-form</button>
            <button class="selected" data-geometry="B">B-form</button>
            <button data-geometry="Free">Free</button>
          </div>
        </section>

        <section class="panel toolCard">
          <h2>Selection Tools</h2>
          <div class="segmented" aria-label="Selection operation">
            <button class="selected" data-selection-op="replace">Replace</button>
            <button data-selection-op="add">Add</button>
            <button data-selection-op="subtract">Subtract</button>
          </div>
          <div class="buttonrow compactActions">
            <button data-action="selectAll">All</button>
            <button data-action="clearSelection">Clear</button>
          </div>
        </section>

        <section class="panel toolCard" data-context="selected">
          <h2>Base Identity</h2>
          <div class="basegrid" aria-label="Base type">
            <button data-base="A">A</button><button data-base="T">T</button><button data-base="U">U</button>
            <button data-base="G">G</button><button data-base="C">C</button><button data-base="X">X</button>
          </div>
        </section>

        <details class="panel toolCard" open>
          <summary><h2>Render</h2></summary>
          <label>Connections</label>
          <div class="segmented" aria-label="Connection mode">
            <button class="selected" data-connection-mode="lines">Lines</button>
            <button data-connection-mode="cylinders">Cylinders</button>
          </div>
          <label>Schematic simplification</label>
          <div class="segmented" aria-label="Schematic display">
            <button data-schematic-display="detailed">Detailed</button>
            <button class="selected" data-schematic-display="mixed">Mixed</button>
            <button data-schematic-display="schematic">Schematic</button>
          </div>
          <div class="segmented" aria-label="Simplify mode">
            <button data-simplify-mode="always">Always</button>
            <button class="selected" data-simplify-mode="sometimes">Sometimes</button>
            <button data-simplify-mode="never">Never</button>
          </div>
          <label>Strand lines</label>
          <div class="segmented" aria-label="Strand line width">
            <button class="selected" data-line-width="1">1</button>
            <button data-line-width="3">3</button>
            <button data-line-width="5">5</button>
          </div>
          <label>Pair lines</label>
          <div class="segmented" aria-label="Pair line width">
            <button class="selected" data-base-line-width="1">1</button>
            <button data-base-line-width="3">3</button>
            <button data-base-line-width="5">5</button>
          </div>
          <label class="checkline"><input type="checkbox" data-render-visible="grid" checked> Grid</label>
          <label class="checkline"><input type="checkbox" data-render-visible="pairs" checked> Base pairs</label>
          <label class="checkline"><input type="checkbox" data-render-visible="slides" checked> Slides</label>
          <label class="checkline"><input type="checkbox" data-render-visible="sticky" checked> Sticky ends</label>
          <label class="checkline"><input type="checkbox" data-render-visible="bbox"> Bounding box</label>
          <label class="checkline"><input type="checkbox" data-render-visible="primeMarkers" checked> 5'/3' markers</label>
          <label class="checkline"><input type="checkbox" data-render-visible="orientation"> Base directions</label>
          <label class="checkline"><input type="checkbox" data-render-visible="constraints"> Constraints</label>
          <label class="checkline"><input type="checkbox" data-render-visible="constraintGuard"> Constrain transforms</label>
        </details>

        <details class="panel toolCard" open>
          <summary><h2>Create</h2></summary>
          <label>Sequence</label>
          <textarea id="sequenceInput" spellcheck="false">ATGCGTACGCTA</textarea>
          <label>Molecule mode</label>
          <select id="createMoleculeInput">
            <option value="DNADNAB">DNA/DNA B</option>
            <option value="DNADNAA">DNA/DNA A</option>
            <option value="DNARNA">DNA/RNA A</option>
            <option value="RNADNA">RNA/DNA A</option>
            <option value="RNARNA">RNA/RNA A</option>
          </select>
          <div class="grid2">
            <label>Bases <input id="baseCountInput" type="number" min="0" step="1" value="0"></label>
            <label>Initial
              <select id="initialModeInput">
                <option value="sequence">Sequence</option>
                <option value="blank">Blank</option>
                <option value="random">Random</option>
              </select>
            </label>
            <label>Orientation
              <select id="orientationInput">
                <option value="forward">5' to 3'</option>
                <option value="reverse">3' to 5'</option>
              </select>
            </label>
            <label>Rise <input id="riseInput" type="number" min="0.1" step="0.001" value="0.332"></label>
            <label>Radius <input id="radiusInput" type="number" min="0" step="0.01" value="1.0"></label>
            <label>Twist <input id="twistInput" type="number" step="0.1" value="-34.28571"></label>
            <label>Initial rot <input id="initialRotInput" type="number" step="1" value="0"></label>
            <label>Snap <input id="snapInput" type="number" min="0.1" step="0.1" value="1"></label>
          </div>
          <label class="checkline"><input id="doubleInput" type="checkbox" checked> Double strand</label>
          <div class="buttonrow">
            <button data-action="createHelix">Helix</button>
            <button data-action="createLine">Line</button>
            <button data-action="pairAll">Pair All</button>
            <button data-action="finishFreeform">Finish Freeform</button>
            <button data-action="clearFreeform">Clear Freeform</button>
          </div>
          <div id="createState" class="selection">Create mode idle</div>
        </details>

        <details class="panel toolCard" data-context="selection-tools" open>
          <summary><h2>Manipulate</h2></summary>
          <div class="buttonrow">
            <button data-action="pairSelected">Pair</button>
            <button data-action="extendUp">Extend Up</button>
            <button data-action="extendDown">Extend Down</button>
            <button data-action="ligate">Ligate</button>
            <button data-action="nick">Nick</button>
            <button data-action="createAcross">Across</button>
            <button data-action="createDown">Down</button>
            <button data-action="createSlide">Slide</button>
            <button data-action="createSticky">Sticky</button>
            <button data-action="deleteAcross">Del Across</button>
            <button data-action="deleteDown">Del Down</button>
            <button data-action="deleteSlide">Del Slide</button>
            <button data-action="deleteSticky">Del Sticky</button>
          </div>
        </details>

        <details class="panel toolCard" data-context="selected" open>
          <summary><h2>Transform</h2></summary>
          <div class="segmented" aria-label="Transform gizmo">
            <button data-transform-tool="translate">Move Gizmo</button>
            <button data-transform-tool="rotate">Rotate Gizmo</button>
            <button class="selected" data-transform-tool="off">Off</button>
          </div>
          <div class="grid3">
            <label>X <input id="moveX" type="number" step="0.1" value="0"></label>
            <label>Y <input id="moveY" type="number" step="0.1" value="0"></label>
            <label>Z <input id="moveZ" type="number" step="0.1" value="0"></label>
          </div>
          <div class="buttonrow">
            <button data-action="translate">Translate</button>
            <button data-action="rotateX">Rot X</button>
            <button data-action="rotateY">Rot Y</button>
            <button data-action="rotateZ">Rot Z</button>
          </div>
          <label>Degrees <input id="rotateDeg" type="number" step="1" value="15"></label>
        </details>
      </aside>

      <section class="stage">
        <div class="viewport" id="viewport"></div>
        <nav class="viewTools commandStrip" aria-label="Views">
          <button class="selected" data-action="viewQuad">4 Views</button>
          <button data-action="viewPerspective">Perspective</button>
          <button data-action="viewTop">Top</button>
          <button data-action="viewFront">Front</button>
          <button data-action="viewSide">Side</button>
        </nav>
        <div id="interactionHint" class="interactionHint" hidden>Drag in any view to box-select bases and phosphates</div>
        <div class="hud">
          <div><strong id="baseCount">0</strong> bases</div>
          <div><strong id="strandCount">0</strong> strands</div>
          <div><strong id="pairCount">0</strong> pairs</div>
        </div>
      </section>

      <aside class="inspector" aria-label="Inspector">
        <section class="panel inspectorHero">
          <h2>Selection Properties</h2>
          <div id="selection" class="selection">No base selected</div>
          <div class="buttonrow">
            <button data-action="clearSelection">Clear</button>
          </div>
        </section>

        <section class="panel">
          <h2>Color</h2>
          <div class="swatches">
            ${STRAND_COLORS.map((color, index) => `<button class="swatch ${index === 0 ? 'selected' : ''}" data-color="${color}" title="Tiamat strand ${index + 1}" style="--swatch:${color}"></button>`).join('')}
          </div>
          <div class="buttonrow">
            <button data-action="colorStrand">Color Strand</button>
            <button data-action="colorSelected">Color Selected</button>
            <button data-action="resetColor">Reset Color</button>
          </div>
        </section>

        <section class="panel">
          <h2>Edit</h2>
          <div class="buttonrow">
            <button data-action="copy">Copy</button>
            <button data-action="paste">Paste</button>
            <button data-action="deleteSelected">Delete</button>
          </div>
        </section>

        <details class="panel">
          <summary><h2>Files</h2></summary>
          <div class="buttonrow">
            <label class="buttonLike" for="fileInput">Import</label>
            <button data-action="saveProject">Save</button>
            <button data-action="exportJson">DNAJSON</button>
            <button data-action="exportSeq">Seq TXT</button>
            <button data-action="exportPdb">PDB</button>
            <button data-action="exportOx">oxDNA</button>
            <button data-action="exportPng">PNG</button>
          </div>
        </details>

        <section class="panel" id="importDiagnosticsPanel" hidden>
          <h2>Import</h2>
          <div id="importDiagnostics" class="selection"></div>
        </section>

        <section class="panel sequencePanel">
          <div class="trayHead"><h2>Strands</h2><button data-action="clearDesign">Clear</button></div>
          <div id="strandList"></div>
        </section>
      </aside>
    </main>
  `;
}

export class TiamatUI {
  constructor(model, scene) {
    this.model = model;
    this.scene = scene;
    this.mode = 'selectBase';
    this.lastSelectionMode = 'selectBase';
    this.molecule = 'DNA';
    this.geometry = 'B';
    this.activeColor = STRAND_COLORS[0];
    this.selectionOperation = 'replace';
    this.freeformControls = [];
    this.freeformStartId = null;
    this.freeformEndId = null;
    this.importDiagnostics = null;
    this.bind();
    this.restoreRenderSettings();
    this.update();
  }

  bind() {
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        this.setMode(button.dataset.mode);
        this.status(button.title || modeLabel(this.mode));
      });
    });
    document.querySelectorAll('[data-molecule]').forEach((button) => {
      button.addEventListener('click', () => {
        this.molecule = button.dataset.molecule;
        document.querySelectorAll('[data-molecule]').forEach((b) => b.classList.toggle('selected', b === button));
      });
    });
    document.querySelectorAll('[data-geometry]').forEach((button) => {
      button.addEventListener('click', () => {
        this.geometry = button.dataset.geometry;
        document.querySelectorAll('[data-geometry]').forEach((b) => b.classList.toggle('selected', b === button));
        this.applyGeometryPreset(this.geometry);
      });
    });
    document.querySelector('#createMoleculeInput')?.addEventListener('change', (event) => {
      const defaults = createModeDefaults(event.target.value);
      this.molecule = defaults.molecule;
      this.geometry = defaults.geometry;
      document.querySelectorAll('[data-molecule]').forEach((b) => b.classList.toggle('selected', b.dataset.molecule === this.molecule));
      document.querySelectorAll('[data-geometry]').forEach((b) => b.classList.toggle('selected', b.dataset.geometry === this.geometry));
      this.applyGeometryPreset(this.geometry, false);
    });
    document.querySelectorAll('[data-base]').forEach((button) => {
      button.addEventListener('click', () => this.model.changeSelectedType(button.dataset.base));
    });
    document.querySelectorAll('[data-selection-op]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectionOperation = button.dataset.selectionOp;
        document.querySelectorAll('[data-selection-op]').forEach((b) => b.classList.toggle('selected', b === button));
        this.status(`Selection ${this.selectionOperation}`);
      });
    });
    document.querySelectorAll('[data-line-width]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-line-width]').forEach((b) => b.classList.toggle('selected', b === button));
        this.scene.setTiamatLineWidths(Number(button.dataset.lineWidth), this.scene.baseLineWidth);
        this.persistRenderSettings();
        this.status(`Strand line ${button.dataset.lineWidth}px`);
      });
    });
    document.querySelectorAll('[data-base-line-width]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-base-line-width]').forEach((b) => b.classList.toggle('selected', b === button));
        this.scene.setTiamatLineWidths(this.scene.lineWidth, Number(button.dataset.baseLineWidth));
        this.persistRenderSettings();
        this.status(`Pair line ${button.dataset.baseLineWidth}px`);
      });
    });
    document.querySelectorAll('[data-connection-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-connection-mode]').forEach((b) => b.classList.toggle('selected', b === button));
        this.scene.setConnectionMode(button.dataset.connectionMode);
        this.persistRenderSettings();
        this.status(button.dataset.connectionMode === 'lines' ? 'Connection lines' : 'Connection cylinders');
      });
    });
    document.querySelectorAll('[data-simplify-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-simplify-mode]').forEach((b) => b.classList.toggle('selected', b === button));
        this.scene.setSimplifyMode(button.dataset.simplifyMode);
        this.persistRenderSettings();
        this.status(`Simplify ${button.dataset.simplifyMode}`);
      });
    });
    document.querySelectorAll('[data-schematic-display]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-schematic-display]').forEach((b) => b.classList.toggle('selected', b === button));
        this.scene.setSchematicDisplay(button.dataset.schematicDisplay);
        this.persistRenderSettings();
        this.status(`Schematic ${button.dataset.schematicDisplay}`);
      });
    });
    document.querySelectorAll('[data-transform-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        this.setTransformTool(button.dataset.transformTool);
      });
    });
    document.querySelectorAll('[data-render-visible]').forEach((input) => {
      input.addEventListener('change', () => {
        this.scene.setRenderVisibility(input.dataset.renderVisible, input.checked);
        this.persistRenderSettings();
        this.status(`${visibilityLabel(input.dataset.renderVisible)} ${input.checked ? 'shown' : 'hidden'}`);
      });
    });
    document.querySelectorAll('[data-color]').forEach((button) => {
      button.addEventListener('click', () => {
        this.activeColor = button.dataset.color;
        document.querySelectorAll('[data-color]').forEach((item) => item.classList.toggle('selected', item.dataset.color === this.activeColor));
        this.applyActiveColor();
      });
    });
    document.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => this.action(button.dataset.action));
    });
    document.querySelector('#fileInput').addEventListener('change', (event) => this.importFile(event));
    window.addEventListener('keydown', (event) => this.handleKeyDown(event));
    this.scene.addEventListener('select-base', (event) => this.handleSceneSelection(event.detail));
    this.scene.addEventListener('select-box', (event) => this.applySelection(event.detail.ids, event.detail.additive));
    this.scene.addEventListener('render-settings', (event) => this.syncRenderButtons(event.detail));
    this.scene.addEventListener('constraint-blocked', () => this.status('Transform blocked by Tiamat constraints'));
    this.scene.addEventListener('add-base', (event) => {
      this.model.commit('add base');
      const base = this.model.createBase({
        type: 'X',
        position: event.detail.position,
        molecule: this.molecule,
        geometry: this.geometry,
        strand: this.model.nextStrand(),
        color: this.model.strandColor(this.model.nextStrand())
      });
      this.model.select(base.id);
      this.model.assignStrands();
      this.model.updateGeometryMeasurements();
      this.model.emit();
    });
    this.scene.addEventListener('create-strand', (event) => this.createStrandFromGesture(event.detail));
    this.scene.addEventListener('freeform-point', (event) => this.addFreeformPoint(event.detail));
    this.model.addEventListener('change', () => this.update());
  }

  handleSceneSelection({ id, additive }) {
    if (id === null || id === undefined) {
      if (this.selectionOperation === 'replace') this.model.select(null);
      return;
    }
    this.applySelection(this.idsForMode(id), additive);
  }

  idsForMode(id) {
    if (this.mode === 'selectPair') return [...this.model.idsForPair(id)];
    if (this.mode === 'selectStrand') return [...this.model.idsForStrand(id)];
    if (this.mode === 'selectHelix') return [...this.model.idsForHelix(id)];
    if (this.mode === 'selectHalf') return [...this.model.idsForHalfStrand(id)];
    if (this.mode === 'selectConnected') return [...this.model.idsForConnected(id)];
    return [id];
  }

  applySelection(ids, additive = false) {
    const operation = additive ? 'add' : this.selectionOperation;
    this.model.applySelectionIds(ids, operation);
  }

  readCreateOptions() {
    const moleculeMode = document.querySelector('#createMoleculeInput')?.value ?? 'DNADNAB';
    const modeDefaults = createModeDefaults(moleculeMode);
    const geometry = modeDefaults.geometry;
    const preset = TIAMAT_GEOMETRY[geometry] ?? TIAMAT_GEOMETRY.B;
    return {
      baseCount: Number(document.querySelector('#baseCountInput').value) || 0,
      initialMode: document.querySelector('#initialModeInput').value,
      orientation: document.querySelector('#orientationInput').value,
      radius: Number(document.querySelector('#radiusInput').value) || preset.radius,
      rise: Number(document.querySelector('#riseInput').value) || preset.rise,
      twist: Number(document.querySelector('#twistInput').value) || preset.twistDeg,
      initialRotation: THREE.MathUtils.degToRad(Number(document.querySelector('#initialRotInput').value) || 0),
      double: document.querySelector('#doubleInput').checked,
      molecule: modeDefaults.molecule,
      pairedMolecule: modeDefaults.pairedMolecule,
      geometry
    };
  }

  snap() {
    return Number(document.querySelector('#snapInput').value) || 1;
  }

  action(action) {
    const options = this.readCreateOptions();
    const sequence = cleanSequence(document.querySelector('#sequenceInput').value, this.molecule);
    if (action === 'createHelix') this.status(`Created ${this.model.createHelix(sequence, options)} bp helix`);
    if (action === 'createLine') this.status(`Created ${this.model.createLine(sequence, options)} base strand`);
    if (action === 'pairAll') this.status(`Created ${this.model.pairAll()} complementary bases`);
    if (action === 'finishFreeform') this.finishFreeform();
    if (action === 'clearFreeform') this.clearFreeform();
    if (action === 'pairSelected') this.model.pairSelected();
    if (action === 'extendUp') this.model.extendSelected('up');
    if (action === 'extendDown') this.model.extendSelected('down');
    if (action === 'ligate') this.status(this.model.ligateSelected() ? 'Ligated selected 5/3 ends' : "Ligate requires compatible selected 3' and 5' ends");
    if (action === 'nick') this.status(this.model.nickSelected() ? 'Nicked active strand after selected base' : "Nick requires one selected base with a 3' neighbor");
    if (action === 'deleteSelected') this.model.deleteSelected();
    if (action === 'selectAll') this.model.selectAll();
    if (action === 'clearSelection') this.model.select(null);
    if (action === 'colorStrand') this.colorActiveStrand();
    if (action === 'colorSelected') this.model.colorSelected(this.activeColor);
    if (action === 'resetColor') this.model.resetSelectedColor();
    if (action === 'createAcross') this.status(this.model.createConnection('across') ? 'Created valid across connection' : 'Across requires two unpaired compatible bases at pairing distance');
    if (action === 'createDown') this.status(this.model.createConnection('down') ? 'Created valid down connection' : 'Down requires two free ends at Tiamat down distance');
    if (action === 'createSlide') this.status(this.model.createConnection('slide') ? 'Created slide connection' : 'Select exactly two bases');
    if (action === 'createSticky') this.status(this.model.createConnection('sticky') ? 'Created sticky connection' : 'Select exactly two bases');
    if (action === 'deleteAcross') this.model.deleteConnection('across');
    if (action === 'deleteDown') this.model.deleteConnection('down');
    if (action === 'deleteSlide') this.model.deleteConnection('slide');
    if (action === 'deleteSticky') this.model.deleteConnection('sticky');
    if (action === 'translate') this.translate();
    if (action === 'rotateX') this.model.rotateSelected('x', document.querySelector('#rotateDeg').value);
    if (action === 'rotateY') this.model.rotateSelected('y', document.querySelector('#rotateDeg').value);
    if (action === 'rotateZ') this.model.rotateSelected('z', document.querySelector('#rotateDeg').value);
    if (action === 'undo') this.model.undo();
    if (action === 'redo') this.model.redo();
    if (action === 'copy') this.copySelection();
    if (action === 'paste') this.pasteSelection();
    if (action === 'frame') this.scene.frameDesign();
    if (action === 'viewQuad') this.setView('quad');
    if (action === 'viewPerspective') this.setView('perspective');
    if (action === 'viewTop') this.setView('top');
    if (action === 'viewFront') this.setView('front');
    if (action === 'viewSide') this.setView('side');
    if (action === 'clearDesign') this.clearDesign();
    if (action === 'saveProject') download(this.model.fileName, fullProjectJson(this.model, this.scene.viewState()), 'application/json');
    if (action === 'exportJson') download('tiamat-export.dnajson', dnaJson(this.model), 'application/json');
    if (action === 'exportSeq') download('tiamat-sequences.txt', sequenceText(this.model), 'text/plain');
    if (action === 'exportPdb') download('tiamat.pdb', pdbText(this.model), 'chemical/x-pdb');
    if (action === 'exportOx') download('tiamat-oxdna.txt', oxDnaText(this.model), 'text/plain');
    if (action === 'exportPng') download('tiamat-render.png', dataUrlToBlob(this.scene.exportPng()), 'image/png');
    this.scene.setInteractionMode(this.mode, this.snap());
    this.updateInteractionHint();
  }

  setView(view) {
    this.scene.setViewMode(view);
    document.querySelectorAll('.viewTools [data-action]').forEach((button) => {
      const target = button.dataset.action.replace('view', '').toLowerCase();
      button.classList.toggle('selected', target === view || (view === 'quad' && target === 'quad'));
    });
    this.status(view === 'quad' ? '4 Views' : `${view[0].toUpperCase()}${view.slice(1)} view`);
  }

  setMode(mode) {
    this.mode = mode;
    if (selectionModes().has(mode)) this.lastSelectionMode = mode;
    this.syncModeButtons();
    this.scene.setInteractionMode(mode, this.snap());
    if (mode === 'position') this.setTransformTool('translate');
    else if (mode === 'rotation') this.setTransformTool('rotate');
    else if (mode !== 'position' && mode !== 'rotation') this.setTransformTool('off');
    this.updateInteractionHint();
  }

  setTransformTool(tool) {
    document.querySelectorAll('[data-transform-tool]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.transformTool === tool);
    });
    this.scene.setTransformTool(tool);
    this.status(tool === 'off' ? 'Transform gizmo off' : `${tool[0].toUpperCase()}${tool.slice(1)} gizmo`);
  }

  syncModeButtons() {
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.mode === this.mode);
      button.classList.toggle('last-selection-mode', button.dataset.mode === this.lastSelectionMode && this.mode !== this.lastSelectionMode);
    });
  }

  syncSelectionOperationButtons() {
    document.querySelectorAll('[data-selection-op]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.selectionOp === this.selectionOperation);
    });
  }

  syncColorButtons() {
    document.querySelectorAll('[data-color]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.color === this.activeColor);
    });
  }

  handleKeyDown(event) {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const shortcut = event.metaKey || event.ctrlKey;
    if (shortcut && key === 'z' && event.shiftKey) return this.consume(event, () => this.model.redo());
    if (shortcut && key === 'z') return this.consume(event, () => this.model.undo());
    if (shortcut && key === 'y') return this.consume(event, () => this.model.redo());
    if (shortcut && key === 'c') return this.consume(event, () => this.copySelection());
    if (shortcut && key === 'x') return this.consume(event, () => {
      this.copySelection();
      this.model.deleteSelected();
    });
    if (shortcut && key === 'v') return this.consume(event, () => this.pasteSelection());
    if (shortcut && key === 'a') return this.consume(event, () => this.model.selectAll());
    if (event.key === 'Delete' || event.key === 'Backspace') return this.consume(event, () => this.model.deleteSelected());
    if (event.key === 'Escape') return this.consume(event, () => {
      this.setTransformTool('off');
      this.scene.setInteractionMode(this.mode, this.snap());
    });
    if (key === 't') return this.consume(event, () => {
      this.setMode('position');
      this.setTransformTool('translate');
    });
    if (key === 'r') return this.consume(event, () => {
      this.setMode('rotation');
      this.setTransformTool('rotate');
    });
    if (key === 'v') return this.consume(event, () => this.setMode('selectBase'));
    if (key === 'b') return this.consume(event, () => this.setMode('selectBox'));
    if (key === 's') return this.consume(event, () => this.setMode('selectStrand'));
    if (key === 'p') return this.consume(event, () => this.setMode('selectPair'));
    if (key === 'h') return this.consume(event, () => this.setMode('selectHalf'));
    if (key === 'c') return this.consume(event, () => this.setMode('createStrand'));
    if (key === 'f') return this.consume(event, () => this.setMode('createFreeform'));
    if (key === 'l') return this.consume(event, () => this.status(this.model.ligateSelected() ? 'Ligated selected 5/3 ends' : "Ligate requires compatible selected 3' and 5' ends"));
    if (key === 'n') return this.consume(event, () => this.status(this.model.nickSelected() ? 'Nicked active strand after selected base' : "Nick requires one selected base with a 3' neighbor"));
    return null;
  }

  consume(event, fn) {
    event.preventDefault();
    fn();
    this.scene.setInteractionMode(this.mode, this.snap());
    this.updateInteractionHint();
    return null;
  }

  copySelection() {
    this.model.copySelected();
    this.status(`${this.model.clipboard.length} copied`);
  }

  pasteSelection() {
    const count = this.model.pasteClipboard();
    if (count) {
      this.setMode('position');
      this.setTransformTool('translate');
      this.status(`Pasted ${count} bases; move gizmo enabled`);
    } else {
      this.status('Clipboard empty');
    }
  }

  translate() {
    this.model.translateSelected(new THREE.Vector3(
      Number(document.querySelector('#moveX').value) || 0,
      Number(document.querySelector('#moveY').value) || 0,
      Number(document.querySelector('#moveZ').value) || 0
    ));
  }

  createStrandFromGesture({ start, end }) {
    const count = this.model.createStrandBetween(start, end, document.querySelector('#sequenceInput').value, this.readCreateOptions());
    this.status(count ? `Created ${count} base strand` : 'Create strand needs a nonzero drag span');
    this.updateCreateState();
  }

  addFreeformPoint({ id, position }) {
    if (id !== null && id !== undefined) {
      if (this.freeformControls.length === 0) {
        this.freeformStartId = id;
        const base = this.model.getBase(id);
        if (base) this.freeformControls.push(base.position);
        this.status(`Freeform start attached to #${id}`);
      } else {
        this.freeformEndId = id;
        const base = this.model.getBase(id);
        if (base) this.freeformControls.push(base.position);
        this.finishFreeform();
      }
    } else if (position) {
      this.freeformControls.push(position);
      this.status(`Freeform point ${this.freeformControls.length}`);
    }
    this.updateCreateState();
  }

  finishFreeform() {
    const count = this.model.createFreeform(this.freeformControls, {
      ...this.readCreateOptions(),
      sequence: document.querySelector('#sequenceInput').value,
      startBaseId: this.freeformStartId,
      endBaseId: this.freeformEndId
    });
    this.clearFreeform(false);
    this.status(count ? `Created ${count} freeform bases` : 'Freeform needs at least two control points');
  }

  clearFreeform(showStatus = true) {
    this.freeformControls = [];
    this.freeformStartId = null;
    this.freeformEndId = null;
    this.updateCreateState();
    if (showStatus) this.status('Freeform cleared');
  }

  updateCreateState() {
    const target = document.querySelector('#createState');
    if (!target) return;
    const attachments = [
      this.freeformStartId !== null ? `start #${this.freeformStartId}` : null,
      this.freeformEndId !== null ? `end #${this.freeformEndId}` : null
    ].filter(Boolean).join(' · ');
    target.textContent = this.freeformControls.length
      ? `${this.freeformControls.length} freeform control points${attachments ? ` · ${attachments}` : ''}`
      : 'Create mode idle';
  }

  colorActiveStrand() {
    this.model.colorActiveStrand(this.activeColor);
    this.status(`Colored strand ${this.activeColor}`);
  }

  applyActiveColor() {
    const active = this.model.activeBase();
    if (!active) {
      this.status(`Color ${this.activeColor}`);
      return;
    }
    if (this.mode === 'selectStrand') {
      this.colorActiveStrand();
      return;
    }
    this.model.colorSelected(this.activeColor);
    this.status(`Colored selection ${this.activeColor}`);
  }

  clearDesign() {
    this.model.commit('clear');
    this.model.bases = [];
    this.model.selectedIds.clear();
    this.model.activeId = null;
    this.importDiagnostics = null;
    this.model.emit();
    this.status('Cleared');
  }

  async importFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'dna') {
      this.status('Native .dna is MFC CArchive binary; use Full JSON or convert through a desktop decoder.');
      return;
    }
    const text = await file.text();
    this.importDiagnostics = null;
    if (ext === 'pdb') parsePdb(text, this.model);
    else if (ext === 'txt') parseSequenceText(text, this.readCreateOptions(), this.model);
    else {
      const parser = ext === 'oxview' ? parseOxViewProject : parseJsonProject;
      const data = parser(text);
      this.importDiagnostics = data.diagnostics ?? null;
      this.model.loadBases(data.bases);
      this.scene.restoreView(data.view);
      if (ext === 'oxview' && data.bases.length > 5000) this.scene.setLargeStructureMode();
    }
    this.scene.frameDesign();
    this.status(`Loaded ${file.name} (${this.model.bases.length} bases)`);
    this.persistRenderSettings();
  }

  applyGeometryPreset(geometry, syncCreateMode = true) {
    const preset = TIAMAT_GEOMETRY[geometry];
    if (!preset) return;
    document.querySelector('#riseInput').value = String(preset.rise);
    document.querySelector('#radiusInput').value = String(preset.radius);
    document.querySelector('#twistInput').value = String(preset.twistDeg);
    if (syncCreateMode) {
      const mode = geometry === 'A'
        ? (this.molecule === 'RNA' ? 'RNARNA' : 'DNADNAA')
        : 'DNADNAB';
      const createMode = document.querySelector('#createMoleculeInput');
      if (createMode) createMode.value = mode;
    }
  }

  update() {
    this.scene.renderModel();
    const selected = this.model.activeBase();
    const selectedCount = this.model.selectedIds.size;
    const strands = this.model.strands();
    document.querySelector('#selection').innerHTML = selected
      ? `<strong>${selectedCount} selected</strong><span>#${selected.id} ${BASES[selected.type].name} · ${selected.molecule} ${selected.geometry}-form · strand ${selected.strand}</span><span>${formatVector(selected.position)}</span><span>${measurementText(selected)}</span>`
      : `${this.model.selectedIds.size} selected`;
    document.querySelector('#baseCount').textContent = this.model.bases.length;
    document.querySelector('#strandCount').textContent = strands.length;
    document.querySelector('#pairCount').textContent = Math.floor(this.model.bases.filter((base) => base.across !== null).length / 2);
    this.updateImportDiagnostics();
    this.syncModeButtons();
    this.syncSelectionOperationButtons();
    this.syncColorButtons();
    document.querySelector('#strandList').innerHTML = strands.map((strand, index) => {
      const head = strand[0];
      return `<button class="strandItem" data-select-strand="${head.id}"><span>${index + 1}${head.circular ? 'c' : ''}: ${strandPreview(strand)}</span><small>${strand.length} bases</small></button>`;
    }).join('');
    document.querySelectorAll('[data-select-strand]').forEach((button) => {
      button.addEventListener('click', () => this.model.selectStrand(Number(button.dataset.selectStrand)));
    });
    this.updateContextPanels();
  }

  updateInteractionHint() {
    const hint = document.querySelector('#interactionHint');
    if (!hint) return;
    hint.hidden = this.mode !== 'selectBox';
  }

  updateContextPanels() {
    const selectedCount = this.model.selectedIds.size;
    document.querySelectorAll('[data-context="selected"]').forEach((panel) => {
      panel.hidden = selectedCount === 0;
    });
    document.querySelectorAll('[data-context="selection-tools"]').forEach((panel) => {
      panel.hidden = selectedCount === 0;
    });
  }

  updateImportDiagnostics() {
    const panel = document.querySelector('#importDiagnosticsPanel');
    const target = document.querySelector('#importDiagnostics');
    if (!panel || !target) return;
    panel.hidden = !this.importDiagnostics;
    if (!this.importDiagnostics) {
      target.textContent = '';
      return;
    }
    const d = this.importDiagnostics;
    target.innerHTML = [
      `<strong>${d.format} import</strong>`,
      `<span>${d.importedBases} bases · ${d.strands} strands · ${d.pairs} pairs</span>`,
      `<span>${d.pairFields} pair fields · ${d.unresolvedPairs} unresolved</span>`,
      `<span>scale ${formatNumber(d.importScale)} · original down ${formatNumber(d.medianOriginalDownDistance)}</span>`
    ].join('');
  }

  persistRenderSettings() {
    try {
      localStorage.setItem(RENDER_SETTINGS_KEY, JSON.stringify(this.scene.renderSettings()));
    } catch {
      // Ignore storage failures; render settings are a convenience.
    }
  }

  restoreRenderSettings() {
    try {
      const raw = localStorage.getItem(RENDER_SETTINGS_KEY);
      if (!raw) return;
      this.scene.applyRenderSettings(JSON.parse(raw));
      this.syncRenderButtons(this.scene.renderSettings());
    } catch {
      localStorage.removeItem(RENDER_SETTINGS_KEY);
    }
  }

  syncRenderButtons({ connectionMode, simplifyMode, schematicDisplay, lineWidth, baseLineWidth, visible = {} }) {
    document.querySelectorAll('[data-connection-mode]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.connectionMode === connectionMode);
    });
    document.querySelectorAll('[data-simplify-mode]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.simplifyMode === simplifyMode);
    });
    document.querySelectorAll('[data-schematic-display]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.schematicDisplay === schematicDisplay);
    });
    document.querySelectorAll('[data-line-width]').forEach((button) => {
      button.classList.toggle('selected', Number(button.dataset.lineWidth) === Number(lineWidth));
    });
    document.querySelectorAll('[data-base-line-width]').forEach((button) => {
      button.classList.toggle('selected', Number(button.dataset.baseLineWidth) === Number(baseLineWidth));
    });
    document.querySelectorAll('[data-render-visible]').forEach((input) => {
      if (Object.hasOwn(visible, input.dataset.renderVisible)) {
        input.checked = Boolean(visible[input.dataset.renderVisible]);
      }
    });
  }

  status(message) {
    document.querySelector('#status').textContent = message;
  }
}

function measurementText(base) {
  const c = base.constraints ?? {};
  const v = c.violations ?? {};
  const parts = [];
  if (c.hasRise) parts.push(`rise ${c.rise.toFixed(3)} nm${v.rise ? '*' : ''}`);
  if (c.hasChord) parts.push(`chord ${c.chord.toFixed(3)} nm${v.chord ? '*' : ''}`);
  if (c.hasRotation) parts.push(`bend ${THREE.MathUtils.radToDeg(c.rotation).toFixed(1)}°${v.rotation ? '*' : ''}`);
  if (c.hasInclination) parts.push(`incl ${THREE.MathUtils.radToDeg(c.inclination).toFixed(1)}°${v.inclination ? '*' : ''}`);
  if (Object.values(v).some(Boolean)) parts.push(`target ${constraintTargetText(base)}`);
  return parts.join(' · ') || 'No local geometry';
}

function selectionModes() {
  return new Set([
    'doNothing',
    'selectStrand',
    'selectHalf',
    'selectPair',
    'selectBase',
    'selectBox',
    'selectHelix',
    'selectConnected'
  ]);
}

function constraintTargetText(base) {
  const preset = CONSTRAINTS[base.geometry] ?? CONSTRAINTS.B;
  return `rise ${preset.rise.median.toFixed(3)}, chord ${preset.chord.median.toFixed(3)}`;
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4) : 'n/a';
}

function strandPreview(strand, limit = 72) {
  if (strand.length <= limit) return strand.map((base) => base.type).join('');
  const edge = Math.floor((limit - 1) / 2);
  const head = strand.slice(0, edge).map((base) => base.type).join('');
  const tail = strand.slice(-edge).map((base) => base.type).join('');
  return `${head}…${tail}`;
}

function modeLabel(mode) {
  return {
    doNothing: 'Do nothing',
    selectBase: 'Select base',
    selectPair: 'Select pair',
    selectStrand: 'Select strand',
    selectHelix: 'Select helix',
    selectHalf: 'Select half strand',
    selectConnected: 'Select connected',
    selectBox: 'Box selection',
    add: 'Add bases',
    createStrand: 'Create strand',
    createFreeform: 'Create freeform',
    position: 'Position',
    rotation: 'Rotation'
  }[mode] ?? mode;
}

function createModeDefaults(mode) {
  return {
    DNADNAB: { molecule: 'DNA', pairedMolecule: 'DNA', geometry: 'B' },
    DNADNAA: { molecule: 'DNA', pairedMolecule: 'DNA', geometry: 'A' },
    DNARNA: { molecule: 'DNA', pairedMolecule: 'RNA', geometry: 'A' },
    RNADNA: { molecule: 'RNA', pairedMolecule: 'DNA', geometry: 'A' },
    RNARNA: { molecule: 'RNA', pairedMolecule: 'RNA', geometry: 'A' }
  }[mode] ?? { molecule: 'DNA', pairedMolecule: 'DNA', geometry: 'B' };
}

function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase();
  return target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}

function visibilityLabel(option) {
  return {
    grid: 'Grid',
    pairs: 'Base pairs',
    slides: 'Slides',
    sticky: 'Sticky ends',
    bbox: 'Bounding box',
    primeMarkers: "5'/3' markers",
    orientation: 'Base directions',
    constraints: 'Constraints',
    constraintGuard: 'Constrain transforms'
  }[option] ?? option;
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
