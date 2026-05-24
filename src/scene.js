import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BASES, MAX_LABELS } from './constants.js';
import { positionFrom, vectorFrom } from './geometry.js';
import { ScreenSelectionIndex } from './selection-index.js';

const MOLECULE_RADIUS = 0.1;
const BASE_RADIUS = MOLECULE_RADIUS;
const PHOSPHATE_RADIUS = MOLECULE_RADIUS;
const SELECTED_SCALE = 1.35;
const VIEW_GAP = 8;
const PICK_RADIUS_PX = 11;
const WIDTH_TO_RADIUS = { 1: 0.01, 3: 0.025, 5: 0.05, 7: 0.075 };

export class TiamatScene extends EventTarget {
  constructor(viewport, model) {
    super();
    this.viewport = viewport;
    this.model = model;
    this.mode = 'select';
    this.snap = 1;
    this.viewMode = 'quad';
    this.activeView = 'perspective';
    this.viewRects = [];
    this.orthoControls = {
      top: { target: null, zoom: 1 },
      front: { target: null, zoom: 1 },
      side: { target: null, zoom: 1 }
    };
    this.panGesture = null;
    this.boxGesture = null;
    this.createStrandGesture = null;
    this.renderRequested = false;
    this.transformTool = 'off';
    this.manipulationGesture = null;
    this.hoveredTransformHandle = null;
    this.hoveredTransformViewId = null;
    this.activeTransformHandle = null;
    this.selectionIndexes = new Map();
    this.modelRevision = 0;
    this.cameraRevision = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    viewport.appendChild(this.renderer.domElement);

    this.overlay = document.createElement('div');
    this.overlay.className = 'viewOverlay';
    viewport.appendChild(this.overlay);
    this.selectionBox = document.createElement('div');
    this.selectionBox.className = 'selectionBox';
    this.selectionBox.hidden = true;
    this.overlay.appendChild(this.selectionBox);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x404040);
    this.scene.fog = new THREE.FogExp2(0x404040, 0.035);

    this.camera = new THREE.PerspectiveCamera(50, viewport.clientWidth / viewport.clientHeight, 0.01, 500);
    this.camera.position.set(8, 8, 12);
    this.orthoCameras = {
      top: new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 500),
      front: new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 500),
      side: new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 500)
    };

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => {
      this.cameraRevision += 1;
      this.invalidateSelectionIndexes();
      this.requestRender();
    });

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.baseIdByInstance = [];
    this.lineWidth = 1;
    this.baseLineWidth = 1;
    this.cylinderWidth = WIDTH_TO_RADIUS[3];
    this.baseCylinderWidth = WIDTH_TO_RADIUS[3];
    this.connectionMode = 'lines';
    this.simplifyMode = 'sometimes';
    this.schematicDisplay = 'mixed';
    this.showPairs = true;
    this.showSlides = true;
    this.showSticky = true;
    this.showBoundingBox = false;
    this.showBaseOrientation = false;
    this.showConstraints = false;
    this.constraintGuard = false;
    this.showPrimeMarkers = true;
    this.lineSignature = '';
    this.schematic = { hiddenIds: new Set(), segments: [] };
    this.labelGroup = new THREE.Group();
    this.scene.add(this.labelGroup);

    this.initLights();
    this.initHelpers();
    this.initPools();
    this.bind();
    this.updateOrthographicCameras();
    this.requestRender();
  }

  initLights() {
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(1, 1, 1);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  }

  initHelpers() {
    this.grid = new THREE.GridHelper(40, 40, 0x5a5a5a, 0x303030);
    this.grid.position.y = -0.02;
    this.scene.add(this.grid);
    this.boundingBoxHelper = new THREE.Box3Helper(new THREE.Box3(), 0xffffff);
    this.boundingBoxHelper.visible = false;
    this.scene.add(this.boundingBoxHelper);
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(MOLECULE_RADIUS, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xf6d365, transparent: true, opacity: 0.45 })
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.transformGizmo = makeTransformGizmo();
    this.transformGizmo.visible = false;
    this.scene.add(this.transformGizmo);
    this.createGuide = this.makeLines(0xf6d365);
    this.createGuide.visible = false;
    this.scene.add(this.createGuide);
  }

  initPools() {
    this.baseGeometry = new THREE.SphereGeometry(BASE_RADIUS, 18, 12);
    setWhiteVertexColors(this.baseGeometry);
    this.baseMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 1 });
    this.baseMesh = new THREE.InstancedMesh(this.baseGeometry, this.baseMaterial, 1);
    this.baseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.phosphateGeometry = new THREE.SphereGeometry(PHOSPHATE_RADIUS, 14, 10);
    setWhiteVertexColors(this.phosphateGeometry);
    this.phosphateMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 1, transparent: true, opacity: 0.75, wireframe: true });
    this.phosphateMesh = new THREE.InstancedMesh(this.phosphateGeometry, this.phosphateMaterial, 1);
    this.phosphateMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.phosphateMesh, this.baseMesh);

    this.strandLines = this.makeLines(0x94a8b8);
    this.pairLines = this.makeLines(0xf4d35e);
    this.slideLines = this.makeLines(0xff8f3d);
    this.stickyLines = this.makeLines(0x66d9e8);
    this.orientationLines = this.makeLines(0xffffff);
    this.constraintLines = this.makeLines(0xff4040);
    this.connectionCylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
    this.connectionCylinderGeometry.translate(0, 0.5, 0);
    setWhiteVertexColors(this.connectionCylinderGeometry);
    this.strandCylinders = this.makeConnectionCylinders();
    this.pairCylinders = this.makeConnectionCylinders(0xf4d35e);
    this.slideCylinders = this.makeConnectionCylinders(0x808080);
    this.stickyCylinders = this.makeConnectionCylinders(0x66d9e8);
    this.scene.add(
      this.strandLines,
      this.pairLines,
      this.slideLines,
      this.stickyLines,
      this.orientationLines,
      this.constraintLines,
      this.strandCylinders,
      this.pairCylinders,
      this.slideCylinders,
      this.stickyCylinders
    );
  }

  makeLines(color) {
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: 1,
      transparent: true,
      opacity: 0.95,
      vertexColors: false
    });
    return new THREE.LineSegments(new THREE.BufferGeometry(), material);
  }

  makeConnectionCylinders(color = 0xffffff) {
    const material = new THREE.MeshPhongMaterial({ color, vertexColors: true, shininess: 1 });
    const mesh = new THREE.InstancedMesh(this.connectionCylinderGeometry, material, 1);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.raycast = () => {};
    mesh.count = 0;
    return mesh;
  }

  setTiamatLineWidths(lineWidth = this.lineWidth, baseLineWidth = this.baseLineWidth) {
    this.lineWidth = Number(lineWidth) || 1;
    this.baseLineWidth = Number(baseLineWidth) || 1;
    this.cylinderWidth = WIDTH_TO_RADIUS[this.lineWidth] ?? WIDTH_TO_RADIUS[3];
    this.baseCylinderWidth = WIDTH_TO_RADIUS[this.baseLineWidth] ?? WIDTH_TO_RADIUS[3];
    this.strandLines.material.linewidth = this.lineWidth;
    this.slideLines.material.linewidth = this.lineWidth;
    this.stickyLines.material.linewidth = this.lineWidth;
    this.pairLines.material.linewidth = this.baseLineWidth;
    this.rebuildLines();
    this.requestRender();
    this.dispatchRenderSettings();
  }

  setConnectionMode(mode) {
    this.connectionMode = mode === 'cylinders' ? 'cylinders' : 'lines';
    if (this.connectionMode === 'cylinders' && this.simplifyMode !== 'never') this.simplifyMode = 'never';
    this.renderModel();
    this.dispatchRenderSettings();
  }

  setLargeStructureMode() {
    this.connectionMode = 'lines';
    this.simplifyMode = 'never';
    this.renderModel();
    this.dispatchRenderSettings();
  }

  setSimplifyMode(mode) {
    this.simplifyMode = ['always', 'sometimes', 'never'].includes(mode) ? mode : 'sometimes';
    if (this.simplifyMode !== 'never') this.connectionMode = 'lines';
    this.renderModel();
    this.dispatchRenderSettings();
  }

  setSchematicDisplay(mode) {
    this.schematicDisplay = ['detailed', 'mixed', 'schematic'].includes(mode) ? mode : 'mixed';
    if (this.schematicDisplay === 'schematic' && this.simplifyMode === 'never') this.simplifyMode = 'always';
    this.renderModel();
    this.dispatchRenderSettings();
  }

  setTransformTool(mode) {
    this.transformTool = ['translate', 'rotate'].includes(mode) ? mode : 'off';
    this.updateTransformControl();
    this.requestRender();
  }

  setRenderVisibility(option, value) {
    if (option === 'grid') {
      this.grid.visible = Boolean(value);
      this.requestRender();
      this.dispatchRenderSettings();
      return;
    }
    if (option === 'bbox') {
      this.showBoundingBox = Boolean(value);
      this.updateBoundingBoxHelper();
      this.requestRender();
      this.dispatchRenderSettings();
      return;
    }
    if (option === 'orientation') this.showBaseOrientation = Boolean(value);
    if (option === 'constraints') this.showConstraints = Boolean(value);
    if (option === 'constraintGuard') this.constraintGuard = Boolean(value);
    if (option === 'primeMarkers') {
      this.showPrimeMarkers = Boolean(value);
      this.rebuildLabels();
      this.requestRender();
      this.dispatchRenderSettings();
      return;
    }
    if (option === 'pairs') this.showPairs = Boolean(value);
    if (option === 'slides') this.showSlides = Boolean(value);
    if (option === 'sticky') this.showSticky = Boolean(value);
    this.rebuildLines();
    this.requestRender();
    this.dispatchRenderSettings();
  }

  renderSettings() {
    return {
      connectionMode: this.connectionMode,
      simplifyMode: this.simplifyMode,
      schematicDisplay: this.schematicDisplay,
      lineWidth: this.lineWidth,
      baseLineWidth: this.baseLineWidth,
      visible: {
        grid: this.grid.visible,
        pairs: this.showPairs,
        slides: this.showSlides,
        sticky: this.showSticky,
        bbox: this.showBoundingBox,
        primeMarkers: this.showPrimeMarkers,
        orientation: this.showBaseOrientation,
        constraints: this.showConstraints,
        constraintGuard: this.constraintGuard
      }
    };
  }

  applyRenderSettings(settings = {}) {
    if (!settings || typeof settings !== 'object') return;
    this.connectionMode = settings.connectionMode === 'cylinders' ? 'cylinders' : 'lines';
    this.simplifyMode = ['always', 'sometimes', 'never'].includes(settings.simplifyMode) ? settings.simplifyMode : this.simplifyMode;
    this.schematicDisplay = ['detailed', 'mixed', 'schematic'].includes(settings.schematicDisplay) ? settings.schematicDisplay : this.schematicDisplay;
    if (this.connectionMode === 'cylinders' && this.simplifyMode !== 'never') this.simplifyMode = 'never';
    if (this.simplifyMode !== 'never') this.connectionMode = 'lines';
    if (this.schematicDisplay === 'schematic' && this.simplifyMode === 'never') this.simplifyMode = 'always';
    this.setTiamatLineWidths(settings.lineWidth ?? this.lineWidth, settings.baseLineWidth ?? this.baseLineWidth);
    const visible = settings.visible ?? {};
    this.grid.visible = visible.grid ?? this.grid.visible;
    this.showPairs = visible.pairs ?? this.showPairs;
    this.showSlides = visible.slides ?? this.showSlides;
    this.showSticky = visible.sticky ?? this.showSticky;
    this.showBoundingBox = visible.bbox ?? this.showBoundingBox;
    this.showPrimeMarkers = visible.primeMarkers ?? this.showPrimeMarkers;
    this.showBaseOrientation = visible.orientation ?? this.showBaseOrientation;
    this.showConstraints = visible.constraints ?? this.showConstraints;
    this.constraintGuard = visible.constraintGuard ?? this.constraintGuard;
    this.renderModel();
    this.dispatchRenderSettings();
  }

  dispatchRenderSettings() {
    this.dispatchEvent(new CustomEvent('render-settings', {
      detail: this.renderSettings()
    }));
  }

  bind() {
    this.renderer.domElement.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.renderer.domElement.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.renderer.domElement.addEventListener('pointerup', () => this.endPointerGesture());
    this.renderer.domElement.addEventListener('pointercancel', () => this.endPointerGesture());
    this.renderer.domElement.addEventListener('pointerleave', () => {
      this.clearHoveredTransformHandle();
      this.endPointerGesture();
    });
    this.renderer.domElement.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.renderer.domElement.addEventListener('dblclick', () => this.toggleActiveView());
    window.addEventListener('resize', () => this.resize());
  }

  setInteractionMode(mode, snap = 1) {
    this.mode = mode;
    this.snap = snap;
    this.controls.enabled = mode !== 'selectBox';
    if (mode !== 'add') this.ghost.visible = false;
    this.requestRender();
  }

  setViewMode(mode) {
    this.viewMode = mode;
    if (mode !== 'quad') this.activeView = mode;
    this.resize();
    this.cameraRevision += 1;
    this.invalidateSelectionIndexes();
    this.requestRender();
  }

  toggleActiveView() {
    this.setViewMode(this.viewMode === 'quad' ? this.activeView : 'quad');
  }

  renderModel() {
    this.modelRevision += 1;
    this.invalidateSelectionIndexes();
    this.updateFogForDesign();
    this.schematic = this.computeSchematic();
    this.rebuildBases();
    const lineSignature = this.connectionSignature();
    if (lineSignature !== this.lineSignature) this.rebuildLines(lineSignature);
    else this.rebuildVolatileLineOverlays();
    this.rebuildLabels();
    this.updateBoundingBoxHelper();
    this.updateOrthographicCameras();
    this.updateTransformControl();
    this.requestRender();
  }

  updateTransformControl() {
    const visible = this.transformTool !== 'off' && this.model.selectedIds.size > 0;
    this.renderer.domElement.classList.toggle('manipulating', visible);
    this.transformGizmo.visible = visible;
    if (!visible) return;
    const center = this.model.selectedCenter();
    const scale = THREE.MathUtils.clamp(this.designBounds().size * 0.04, 0.55, 4);
    this.transformGizmo.position.copy(center);
    this.transformGizmo.scale.setScalar(scale);
    this.transformGizmo.children.forEach((child) => {
      child.visible = child.userData.tool === this.transformTool;
    });
    this.updateGizmoHighlight();
  }

  updateBoundingBoxHelper() {
    this.boundingBoxHelper.visible = this.showBoundingBox && this.model.bases.length > 0;
    if (!this.boundingBoxHelper.visible) return;
    this.boundingBoxHelper.box.setFromPoints(this.model.bases.map((base) => vectorFrom(base.position)));
  }

  rebuildBases() {
    const count = Math.max(1, this.model.bases.length);
    if (this.baseMesh.instanceMatrix.array.length / 16 < count) {
      this.scene.remove(this.baseMesh);
      this.baseMesh.dispose?.();
      this.baseMesh = new THREE.InstancedMesh(this.baseGeometry, this.baseMaterial, count);
      this.baseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(this.baseMesh);
    }
    if (this.phosphateMesh.instanceMatrix.array.length / 16 < count) {
      this.scene.remove(this.phosphateMesh);
      this.phosphateMesh.dispose?.();
      this.phosphateMesh = new THREE.InstancedMesh(this.phosphateGeometry, this.phosphateMaterial, count);
      this.phosphateMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(this.phosphateMesh);
    }

    const matrix = new THREE.Matrix4();
    const phosphateMatrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const phosphateColor = new THREE.Color();
    this.baseIdByInstance = [];
    this.model.bases.forEach((base, index) => {
      const selected = this.model.selectedIds.has(base.id);
      const hidden = this.schematic.hiddenIds.has(base.id);
      const schematicOnly = this.schematicDisplay === 'schematic' && this.schematic.segments.length > 0;
      const hideDetailedMarker = (hidden || schematicOnly) && !selected;
      const scale = hideDetailedMarker ? 0.0001 : selected ? SELECTED_SCALE : 1;
      matrix.compose(baseSitePosition(base), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      this.baseMesh.setMatrixAt(index, matrix);
      color.set(BASES[base.type]?.color ?? BASES.X.color);
      if (selected) color.lerp(new THREE.Color(0xffffff), 0.28);
      this.baseMesh.setColorAt(index, color);
      phosphateMatrix.compose(phosphatePosition(base), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      this.phosphateMesh.setMatrixAt(index, phosphateMatrix);
      phosphateColor.set(this.model.displayColor(base));
      if (selected) phosphateColor.lerp(new THREE.Color(0xffffff), 0.18);
      this.phosphateMesh.setColorAt(index, phosphateColor);
      this.baseIdByInstance[index] = base.id;
    });
    this.baseMesh.count = this.model.bases.length;
    this.phosphateMesh.count = this.model.bases.length;
    this.baseMesh.instanceMatrix.needsUpdate = true;
    this.phosphateMesh.instanceMatrix.needsUpdate = true;
    if (this.baseMesh.instanceColor) this.baseMesh.instanceColor.needsUpdate = true;
    if (this.phosphateMesh.instanceColor) this.phosphateMesh.instanceColor.needsUpdate = true;
  }

  rebuildLines(signature = this.connectionSignature()) {
    this.lineSignature = signature;
    const strand = [];
    const strandColors = [];
    const strandSegments = [];
    const pair = [];
    const pairSegments = [];
    const slide = [];
    const slideSegments = [];
    const sticky = [];
    const stickySegments = [];
    const seen = new Set();
    this.schematic.segments.forEach((segment) => {
      pushPoints(strand, segment.start, segment.end);
      const color = new THREE.Color(this.model.displayColor(segment.base));
      strandColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    });
    this.model.bases.forEach((base) => {
      if (this.schematic.hiddenIds.has(base.id) && !this.model.selectedIds.has(base.id)) return;
      if (base.down !== null) pushColoredSegment(strand, strandColors, strandSegments, base, this.model.getBase(base.down), this.model);
      if (this.showPairs && base.across !== null) pushUniquePair(pair, pairSegments, seen, 'a', base, this.model.getBase(base.across), this.model);
      if (this.showSlides) (base.slide ?? []).forEach((id) => pushUnique(slide, slideSegments, seen, 's', base, this.model.getBase(id), new THREE.Color(0x808080), this.model));
      if (this.showSticky && base.sticky !== null) pushUnique(sticky, stickySegments, seen, 'k', base, this.model.getBase(base.sticky), new THREE.Color(0x66d9e8), this.model);
    });
    this.setLinePositions(this.strandLines, strand, strandColors);
    this.setLinePositions(this.pairLines, pair);
    this.setLinePositions(this.slideLines, slide);
    this.setLinePositions(this.stickyLines, sticky);
    this.rebuildVolatileLineOverlays();
    const showCylinders = this.connectionMode === 'cylinders';
    this.setCylinderSegments(this.strandCylinders, showCylinders ? strandSegments : [], this.cylinderWidth);
    this.setCylinderSegments(this.pairCylinders, showCylinders ? pairSegments : [], this.baseCylinderWidth);
    this.setCylinderSegments(this.slideCylinders, showCylinders ? slideSegments : [], this.cylinderWidth);
    this.setCylinderSegments(this.stickyCylinders, showCylinders ? stickySegments : [], this.cylinderWidth);
  }

  connectionSignature() {
    const schematicHidden = this.schematic.hiddenIds.size ? [...this.schematic.hiddenIds].sort((a, b) => a - b).join(',') : '';
    const schematicSegments = this.schematic.segments.length;
    const parts = [
      this.connectionMode,
      this.simplifyMode,
      this.schematicDisplay,
      this.lineWidth,
      this.baseLineWidth,
      this.cylinderWidth,
      this.baseCylinderWidth,
      this.showPairs ? 1 : 0,
      this.showSlides ? 1 : 0,
      this.showSticky ? 1 : 0,
      this.showBaseOrientation ? 1 : 0,
      this.showConstraints ? 1 : 0,
      [...this.model.selectedIds].sort((a, b) => a - b).join(','),
      schematicSegments,
      schematicHidden
    ];
    this.model.bases.forEach((base) => {
      parts.push(
        base.id,
        base.down ?? '',
        base.across ?? '',
        base.sticky ?? '',
        (base.slide ?? []).join('.'),
        this.model.displayColor(base),
        base.oxView?.a1?.join('.') ?? '',
        base.oxView?.a3?.join('.') ?? '',
        base.position.x.toFixed(4),
        base.position.y.toFixed(4),
        base.position.z.toFixed(4)
      );
    });
    return parts.join('|');
  }

  rebuildOrientationLines() {
    if (!this.showBaseOrientation) {
      this.setLinePositions(this.orientationLines, []);
      return;
    }
    const positions = [];
    const colors = [];
    const directionColor = new THREE.Color(0xffffff);
    const normalColor = new THREE.Color(0x8bd7ff);
    this.model.bases.forEach((base) => {
      if (this.schematic.hiddenIds.has(base.id) && !this.model.selectedIds.has(base.id)) return;
      const origin = baseSitePosition(base);
      const a1 = vectorFrom(base.oxView?.a1);
      if (a1.lengthSq() > 0) {
        const end = origin.clone().add(a1.normalize().multiplyScalar(0.32));
        pushPoints(positions, origin, end);
        colors.push(directionColor.r, directionColor.g, directionColor.b, directionColor.r, directionColor.g, directionColor.b);
      }
      const a3 = vectorFrom(base.oxView?.a3);
      if (a3.lengthSq() > 0 && this.model.selectedIds.has(base.id)) {
        const end = origin.clone().add(a3.normalize().multiplyScalar(0.24));
        pushPoints(positions, origin, end);
        colors.push(normalColor.r, normalColor.g, normalColor.b, normalColor.r, normalColor.g, normalColor.b);
      }
    });
    this.setLinePositions(this.orientationLines, positions, colors);
  }

  rebuildVolatileLineOverlays() {
    this.rebuildOrientationLines();
    this.rebuildConstraintLines();
  }

  rebuildConstraintLines() {
    if (!this.showConstraints) {
      this.setLinePositions(this.constraintLines, []);
      return;
    }
    const positions = [];
    const colors = [];
    const colorsByType = {
      rise: new THREE.Color(0xff4040),
      chord: new THREE.Color(0xffa13d),
      rotation: new THREE.Color(0xff40d0),
      inclination: new THREE.Color(0xffdf00)
    };
    const seen = new Set();
    this.model.bases.forEach((base) => {
      if (this.schematic.hiddenIds.has(base.id)) return;
      const violations = base.constraints?.violations ?? {};
      const down = this.model.getBase(base.down);
      if (violations.rise && down && !this.schematic.hiddenIds.has(down.id)) {
        pushConstraintSegment(positions, colors, base, down, colorsByType.rise);
      }
      const across = this.model.getBase(base.across);
      if (violations.chord && across && !this.schematic.hiddenIds.has(across.id)) {
        const key = `a:${Math.min(base.id, across.id)}:${Math.max(base.id, across.id)}`;
        if (!seen.has(key)) {
          seen.add(key);
          pushConstraintSegment(positions, colors, base, across, colorsByType.chord);
        }
      }
      const up = this.model.getBase(base.up);
      if (violations.rotation && up && down) {
        pushConstraintSegment(positions, colors, up, down, colorsByType.rotation);
      }
      if (violations.inclination && across) {
        pushConstraintSegment(positions, colors, base, across, colorsByType.inclination);
      }
    });
    this.setLinePositions(this.constraintLines, positions, colors);
  }

  computeSchematic() {
    if (this.connectionMode !== 'lines' || this.simplifyMode === 'never' || this.schematicDisplay === 'detailed') return { hiddenIds: new Set(), segments: [] };
    const state = new Map(this.model.bases.map((base) => [base.id, {
      base,
      temp: true,
      simpleNext: null,
      centerPosition: vectorFrom(base.position),
      displace: new THREE.Vector3(),
      direction: new THREE.Vector3()
    }]));

    this.model.bases.forEach((base) => {
      const item = state.get(base.id);
      if (!item?.temp) return;
      let current = base;
      let use = false;
      let more = true;
      while (state.get(current.id)?.simpleNext === null && more && current.across !== null && (
        current.up !== null
          ? this.model.getBase(current.up)?.across !== null && this.model.getBase(this.model.getBase(current.up)?.across)?.up === current.across
          : true
      )) {
        if (current.up !== null) current = this.model.getBase(current.up);
        else more = false;
        use = true;
      }
      if (!use) {
        item.temp = false;
        return;
      }

      const top = current;
      more = true;
      let count = 0;
      while (state.get(current.id)?.simpleNext === null && more && current.across !== null && (
        current.down !== null
          ? this.model.getBase(current.down)?.across !== null && this.model.getBase(this.model.getBase(current.down)?.across)?.down === current.across
          : true
      )) {
        if (current.down !== null) current = this.model.getBase(current.down);
        else more = false;
        count += 1;
      }
      const bottom = current;
      let direction = null;
      if (count >= 21) {
        current = top;
        for (let j = 0; j < 20; j += 1) current = this.model.getBase(current.down);
        direction = vectorFrom(current.position).sub(vectorFrom(top.position));
      } else if (count >= 11) {
        current = top;
        for (let j = 0; j < 9; j += 1) current = this.model.getBase(current.down);
        direction = vectorFrom(current.position).add(vectorFrom(this.model.getBase(current.down).position)).multiplyScalar(0.5).sub(vectorFrom(top.position));
      } else if (count >= 7) {
        current = top;
        for (let j = 0; j < 5; j += 1) current = this.model.getBase(current.down);
        current = this.model.getBase(current.across);
        direction = vectorFrom(current.position).multiplyScalar(0.25).add(vectorFrom(this.model.getBase(current.up).position).multiplyScalar(0.75)).sub(vectorFrom(top.position));
      }
      if (!direction || direction.lengthSq() < 0.0001) {
        current = top;
        while (current && current.id !== bottom.id) {
          state.get(current.id).temp = false;
          current = this.model.getBase(current.down);
        }
        state.get(bottom.id).temp = false;
        return;
      }

      direction.normalize();
      current = top;
      let displace = direction.clone().cross(new THREE.Vector3(1, 1, 0)).normalize();
      if (displace.lengthSq() < 0.1) displace = direction.clone().cross(new THREE.Vector3(0, 1, 1)).normalize();
      let first = true;
      while (current && current.id !== bottom.id) {
        const centerPosition = schematicCenter(current, this.model.getBase(current.across), this.model.getBase(current.down), direction);
        const item = state.get(current.id);
        if (first) {
          const v = vectorFrom(top.position).multiplyScalar(0.5).sub(centerPosition.clone().multiplyScalar(0.5));
          displace.multiplyScalar(v.length());
          first = false;
        }
        item.centerPosition = centerPosition;
        item.displace = displace.clone();
        item.direction = direction.clone();
        item.simpleNext = bottom.id;
        item.temp = false;
        current = this.model.getBase(current.down);
      }
      if (current) {
        const item = state.get(current.id);
        item.centerPosition = schematicCenter(current, this.model.getBase(current.across), this.model.getBase(current.up), direction);
        item.simpleNext = bottom.id;
        item.temp = false;
      }
    });

    const hiddenIds = new Set();
    const segments = [];
    const drawn = new Set();
    this.model.bases.forEach((base) => {
      const item = state.get(base.id);
      if (!item || drawn.has(base.id) || item.simpleNext === null) return;
      const shouldSimplify = this.simplifyMode === 'always' || vectorFrom(base.position).distanceTo(this.camera.position) >= Math.sqrt(1000);
      if (!shouldSimplify) return;
      const end = this.model.getBase(item.simpleNext);
      if (!end) return;
      const endState = state.get(end.id);
      segments.push({
        base,
        start: item.centerPosition.clone().add(item.displace),
        end: endState.centerPosition.clone().add(item.displace)
      });
      let current = base;
      while (current && current.id !== end.id) {
        hiddenIds.add(current.id);
        drawn.add(current.id);
        current = this.model.getBase(current.down);
      }
      hiddenIds.add(end.id);
      drawn.add(end.id);
    });
    if (segments.length === 0 && this.schematicDisplay === 'schematic') {
      this.model.strands().forEach((strand) => {
        if (strand.length < 2) return;
        const start = strand[0];
        const end = strand[strand.length - 1];
        segments.push({ base: start, start: baseSitePosition(start), end: baseSitePosition(end) });
        strand.forEach((base) => hiddenIds.add(base.id));
      });
    }
    return { hiddenIds, segments };
  }

  setLinePositions(line, positions, colors = null) {
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (colors) {
      line.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      line.material.vertexColors = true;
    } else {
      line.material.vertexColors = false;
    }
    line.material.needsUpdate = true;
    line.frustumCulled = false;
  }

  setCylinderSegments(mesh, segments, radius) {
    const count = Math.max(1, segments.length);
    if (mesh.instanceMatrix.array.length / 16 < count) {
      this.scene.remove(mesh);
      mesh.dispose?.();
      const next = new THREE.InstancedMesh(this.connectionCylinderGeometry, mesh.material, count);
      next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      next.raycast = () => {};
      if (mesh === this.strandCylinders) this.strandCylinders = next;
      if (mesh === this.pairCylinders) this.pairCylinders = next;
      if (mesh === this.slideCylinders) this.slideCylinders = next;
      if (mesh === this.stickyCylinders) this.stickyCylinders = next;
      this.scene.add(next);
      mesh = next;
    }

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    segments.forEach((segment, index) => {
      const direction = segment.end.clone().sub(segment.start);
      const length = direction.length();
      if (length <= 0.0001) return;
      quaternion.setFromUnitVectors(yAxis, direction.clone().normalize());
      scale.set(radius, length, radius);
      matrix.compose(segment.start, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, segment.color);
    });
    mesh.count = segments.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  rebuildLabels() {
    this.labelGroup.clear();
    if (this.showPrimeMarkers) this.rebuildPrimeLabels();
    if (this.model.bases.length > MAX_LABELS || this.model.selectedIds.size === 0) return;
    this.model.bases.forEach((base) => {
      if (!this.model.selectedIds.has(base.id)) return;
      const label = makeLabel(base.type);
      label.position.copy(baseSitePosition(base)).add(new THREE.Vector3(0, 0.24, 0));
      this.labelGroup.add(label);
    });
  }

  rebuildPrimeLabels() {
    this.model.bases.forEach((base) => {
      if (this.schematic.hiddenIds.has(base.id)) return;
      if (base.up === null) {
        const label = makeLabel("5'");
        label.position.copy(baseSitePosition(base)).add(new THREE.Vector3(0, 0.34, 0));
        this.labelGroup.add(label);
      }
      if (base.down === null) {
        const label = makeLabel("3'");
        label.position.copy(baseSitePosition(base)).add(new THREE.Vector3(0, -0.34, 0));
        this.labelGroup.add(label);
      }
    });
  }

  frameDesign() {
    if (!this.model.bases.length) return;
    const { center, size, maxDimension } = this.designBounds();
    const frameSize = Math.max(3.2, maxDimension);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(frameSize * 0.55, frameSize * 0.48, frameSize * 0.78));
    this.camera.near = 0.01;
    this.camera.far = Math.max(size * 10, frameSize * 12);
    this.camera.updateProjectionMatrix();
    Object.values(this.orthoControls).forEach((control) => {
      control.target = center.clone();
      control.zoom = 1;
    });
    this.updateOrthographicCameras();
    this.cameraRevision += 1;
    this.invalidateSelectionIndexes();
    this.requestRender();
  }

  exportPng() {
    this.renderViews();
    return this.renderer.domElement.toDataURL('image/png');
  }

  viewState() {
    return {
      mode: this.viewMode,
      activeView: this.activeView,
      camera: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      orthographic: Object.fromEntries(Object.entries(this.orthoControls).map(([key, value]) => [
        key,
        { target: value.target?.toArray() ?? null, zoom: value.zoom }
      ]))
    };
  }

  restoreView(view) {
    if (!view) return;
    if (view.camera && view.target) {
      this.camera.position.fromArray(view.camera);
      this.controls.target.fromArray(view.target);
      this.camera.updateProjectionMatrix();
    }
    if (view.mode) this.viewMode = view.mode;
    if (view.activeView) this.activeView = view.activeView;
    if (view.orthographic) {
      Object.entries(view.orthographic).forEach(([key, value]) => {
        if (!this.orthoControls[key]) return;
        this.orthoControls[key].target = value.target ? new THREE.Vector3().fromArray(value.target) : null;
        this.orthoControls[key].zoom = Number(value.zoom) || 1;
      });
    }
    this.updateOrthographicCameras();
    this.requestRender();
  }

  updateFogForDesign() {
    const { size } = this.designBounds();
    const density = Math.min(0.035, 0.18 / Math.max(3.2, size));
    this.scene.fog = new THREE.FogExp2(0x404040, density);
  }

  onPointerMove(event) {
    const view = this.viewAtEvent(event);
    if (this.manipulationGesture) {
      this.updateManipulation(event);
      return;
    }
    if (this.panGesture) {
      this.updatePan(event);
      return;
    }
    if (this.boxGesture) {
      this.updateSelectionBox(event);
      return;
    }
    if (this.createStrandGesture) {
      this.updateCreateStrand(event);
      return;
    }
    this.controls.enabled = this.mode !== 'selectBox' && view?.id === 'perspective';
    this.updateHoveredTransformHandle(event, view);
    if (this.mode !== 'add') return;
    const point = this.pointOnWorkPlane(event, view);
    if (!point) return;
    this.ghost.position.copy(this.snapVector(point));
    this.ghost.visible = true;
    this.requestRender();
  }

  onPointerDown(event) {
    const view = this.viewAtEvent(event);
    if (!view) return;
    this.activeView = view.id;
    if (this.transformTool !== 'off' && this.model.selectedIds.size > 0 && event.button === 0) {
      const handle = this.hitTransformGizmo(event, view) ?? this.hoveredTransformHandleFor(view);
      if (this.transformTool === 'rotate' && !handle) {
        this.clearHoveredTransformHandle();
      } else {
        this.startManipulation(event, view, handle);
        return;
      }
    }
    if (this.mode === 'selectBox') {
      this.startSelectionBox(event, view);
      return;
    }
    if (this.shouldStartPan(event, view)) {
      this.startPan(event, view);
      return;
    }
    if (this.mode === 'doNothing') return;
    const hit = this.hitBase(event, view);
    if (this.mode === 'createStrand') {
      const point = this.pointOnWorkPlane(event, view);
      if (!point) return;
      this.startCreateStrand(event, view, this.snapVector(point));
      return;
    }
    if (this.mode === 'createFreeform') {
      const point = this.pointOnWorkPlane(event, view);
      this.dispatchEvent(new CustomEvent('freeform-point', { detail: { id: hit, position: point ? positionFrom(this.snapVector(point)) : null } }));
      return;
    }
    if (this.mode === 'add') {
      const point = this.pointOnWorkPlane(event, view);
      if (!point) return;
      this.dispatchEvent(new CustomEvent('add-base', { detail: { position: positionFrom(this.snapVector(point)) } }));
      return;
    }
    if (hit !== null) {
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      this.dispatchEvent(new CustomEvent('select-base', { detail: { id: hit, additive } }));
    } else {
      this.dispatchEvent(new CustomEvent('select-base', { detail: { id: null, additive: false } }));
    }
  }

  onWheel(event) {
    const view = this.viewAtEvent(event);
    if (!view || view.id === 'perspective') return;
    event.preventDefault();
    const control = this.orthoControls[view.id];
    control.zoom = THREE.MathUtils.clamp(control.zoom * Math.exp(-event.deltaY * 0.0015), 0.05, 80);
    this.updateOrthographicCameras();
    this.cameraRevision += 1;
    this.invalidateSelectionIndexes();
    this.requestRender();
  }

  shouldStartPan(event, view) {
    return event.button === 1 || event.shiftKey;
  }

  startPan(event, view) {
    event.preventDefault();
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    this.controls.enabled = false;
    this.panGesture = {
      pointerId: event.pointerId,
      viewId: view.id,
      rect: view.rect,
      lastX: event.clientX,
      lastY: event.clientY
    };
  }

  updatePan(event) {
    const gesture = this.panGesture;
    const camera = this.cameraFor(gesture.viewId);
    const dx = event.clientX - gesture.lastX;
    const dy = event.clientY - gesture.lastY;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;

    if (gesture.viewId === 'perspective') {
      this.panPerspective(dx, dy, gesture.rect);
      this.cameraRevision += 1;
      this.invalidateSelectionIndexes();
      this.requestRender();
      return;
    }

    const control = this.orthoControls[gesture.viewId];
    const worldPerPixel = (camera.top - camera.bottom) / Math.max(1, gesture.rect.height);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const up = camera.up.clone().normalize();
    const delta = right.multiplyScalar(-dx * worldPerPixel).add(up.multiplyScalar(dy * worldPerPixel));
    control.target = (control.target ?? this.designBounds().center).clone().add(delta);
    this.updateOrthographicCameras();
    this.cameraRevision += 1;
    this.invalidateSelectionIndexes();
    this.requestRender();
  }

  endPan() {
    this.panGesture = null;
    this.controls.enabled = this.mode !== 'selectBox';
  }

  endPointerGesture() {
    if (this.manipulationGesture) this.endManipulation();
    if (this.boxGesture) this.endSelectionBox();
    if (this.createStrandGesture) this.endCreateStrand();
    this.endPan();
  }

  startManipulation(event, view, handle = null) {
    event.preventDefault();
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    this.controls.enabled = false;
    this.model.commit(this.transformTool === 'rotate' ? 'drag rotate' : 'drag move');
    const center = this.model.selectedCenter();
    this.activeTransformHandle = handle;
    this.hoveredTransformHandle = handle;
    this.hoveredTransformViewId = handle ? view.id : null;
    this.updateGizmoHighlight();
    this.manipulationGesture = {
      pointerId: event.pointerId,
      view,
      tool: this.transformTool,
      center,
      handle,
      startPoint: this.pointOnManipulationPlane(event, view, center),
      lastPoint: this.pointOnManipulationPlane(event, view, center),
      startX: event.clientX,
      startY: event.clientY,
      lastAxisDistance: 0,
      lastAcceptedPositions: this.selectedPositionSnapshot(),
      baselineViolations: this.selectedConstraintViolationCount(),
      rotationAxis: this.transformTool === 'rotate'
        ? (handle?.axis ? axisVector(handle.axis) : this.viewNormal(view.id).normalize())
        : null
    };
    if (this.transformTool === 'rotate') {
      gestureInitRotation(this.manipulationGesture);
    }
  }

  updateManipulation(event) {
    const gesture = this.manipulationGesture;
    if (!gesture) return;
    if (gesture.tool === 'translate') {
      if (gesture.handle?.axis) {
        const distance = this.axisDragDistance(event, gesture);
        const deltaDistance = distance - gesture.lastAxisDistance;
        if (Math.abs(deltaDistance) <= 0.000001) return;
        const delta = axisVector(gesture.handle.axis).multiplyScalar(deltaDistance);
        this.model.selectedBases().forEach((base) => {
          base.position = positionFrom(vectorFrom(base.position).add(delta));
        });
        this.model.updateGeometryMeasurements();
        if (!this.acceptManipulationStep(gesture)) return;
        gesture.lastAxisDistance = distance;
        this.renderModel();
        return;
      }
      const point = this.pointOnManipulationPlane(event, gesture.view, gesture.center);
      if (!point || !gesture.lastPoint) return;
      const delta = point.clone().sub(gesture.lastPoint);
      if (delta.lengthSq() > 0) {
        this.model.selectedBases().forEach((base) => {
          base.position = positionFrom(vectorFrom(base.position).add(delta));
        });
        this.model.updateGeometryMeasurements();
        if (!this.acceptManipulationStep(gesture)) return;
        gesture.lastPoint.copy(point);
        this.renderModel();
      }
      return;
    }

    const angle = this.rotationDragAngle(event, gesture);
    if (angle === null) return;
    const delta = angle - (gesture.lastAngle ?? 0);
    if (Math.abs(delta) <= 0.000001) return;
    const axis = gesture.rotationAxis;
    this.model.selectedBases().forEach((base) => {
      base.position = positionFrom(vectorFrom(base.position).sub(gesture.center).applyAxisAngle(axis, delta).add(gesture.center));
    });
    this.model.updateGeometryMeasurements();
    if (!this.acceptManipulationStep(gesture)) return;
    gesture.lastAngle = angle;
    this.renderModel();
  }

  acceptManipulationStep(gesture) {
    if (!this.constraintGuard) {
      gesture.lastAcceptedPositions = this.selectedPositionSnapshot();
      gesture.baselineViolations = this.selectedConstraintViolationCount();
      return true;
    }
    const violations = this.selectedConstraintViolationCount();
    if (violations <= gesture.baselineViolations) {
      gesture.lastAcceptedPositions = this.selectedPositionSnapshot();
      gesture.baselineViolations = violations;
      return true;
    }
    this.restoreSelectedPositions(gesture.lastAcceptedPositions);
    this.model.updateGeometryMeasurements();
    this.dispatchEvent(new CustomEvent('constraint-blocked', { detail: { violations } }));
    return false;
  }

  selectedPositionSnapshot() {
    return new Map(this.model.selectedBases().map((base) => [base.id, positionFrom(vectorFrom(base.position))]));
  }

  restoreSelectedPositions(snapshot) {
    this.model.selectedBases().forEach((base) => {
      const position = snapshot.get(base.id);
      if (position) base.position = { ...position };
    });
  }

  selectedConstraintViolationCount() {
    return this.model.selectedBases().reduce((count, base) => {
      const violations = base.constraints?.violations ?? {};
      return count + Object.values(violations).filter(Boolean).length;
    }, 0);
  }

  endManipulation() {
    this.manipulationGesture = null;
    this.activeTransformHandle = null;
    this.updateGizmoHighlight();
    this.controls.enabled = this.mode !== 'selectBox';
    this.model.updateGeometryMeasurements();
    this.model.emit();
  }

  pointOnManipulationPlane(event, view, center) {
    this.setPointer(event, view.rect);
    this.raycaster.setFromCamera(this.pointer, view.camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.viewNormal(view.id), center);
    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, target);
  }

  hitTransformGizmo(event, view) {
    if (!this.transformGizmo.visible) return null;
    this.setPointer(event, view.rect);
    this.raycaster.setFromCamera(this.pointer, view.camera);
    const hit = this.raycaster.intersectObjects(this.transformGizmo.children, true)
      .map((item) => item.object)
      .find((object) => (object.userData?.tool ?? object.parent?.userData?.tool) === this.transformTool);
    return hit ? (hit.userData?.tool ? hit.userData : hit.parent.userData) : null;
  }

  updateHoveredTransformHandle(event, view) {
    if (this.transformTool === 'off' || this.model.selectedIds.size === 0 || !view) {
      if (this.hoveredTransformHandle) {
        this.hoveredTransformHandle = null;
        this.hoveredTransformViewId = null;
        this.updateGizmoHighlight();
      }
      return;
    }
    const handle = this.hitTransformGizmo(event, view);
    if (sameHandle(handle, this.hoveredTransformHandle) && this.hoveredTransformViewId === view.id) return;
    this.hoveredTransformHandle = handle;
    this.hoveredTransformViewId = handle ? view.id : null;
    this.updateGizmoHighlight();
  }

  hoveredTransformHandleFor(view) {
    if (!view || this.hoveredTransformViewId !== view.id) return null;
    if (!this.hoveredTransformHandle) return null;
    if (this.hoveredTransformHandle.tool !== this.transformTool) return null;
    return this.hoveredTransformHandle;
  }

  clearHoveredTransformHandle() {
    if (!this.hoveredTransformHandle) return;
    this.hoveredTransformHandle = null;
    this.hoveredTransformViewId = null;
    this.updateGizmoHighlight();
  }

  updateGizmoHighlight() {
    const active = this.activeTransformHandle;
    const hovered = this.hoveredTransformHandle;
    this.transformGizmo.children.forEach((part) => {
      const isActive = sameHandle(part.userData, active);
      const isHovered = sameHandle(part.userData, hovered);
      setGizmoPartState(part, isActive ? 'active' : isHovered ? 'hover' : 'idle');
    });
    this.requestRender();
  }

  axisDragDistance(event, gesture) {
    const axis = axisVector(gesture.handle.axis);
    const start = gesture.center.clone().project(gesture.view.camera);
    const end = gesture.center.clone().add(axis).project(gesture.view.camera);
    const axisPixels = new THREE.Vector2(
      ((end.x - start.x) / 2) * gesture.view.rect.width,
      (-(end.y - start.y) / 2) * gesture.view.rect.height
    );
    const pixelsPerUnit = axisPixels.length();
    if (pixelsPerUnit <= 0.0001) return gesture.lastAxisDistance;
    axisPixels.normalize();
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    return new THREE.Vector2(dx, dy).dot(axisPixels) / pixelsPerUnit;
  }

  rotationDragAngle(event, gesture) {
    const point = this.pointOnAxisPlane(event, gesture.view, gesture.center, gesture.rotationAxis);
    if (!point) return fallbackRotationAngle(event, gesture);
    const vector = point.sub(gesture.center);
    if (vector.lengthSq() <= 0.000001) return fallbackRotationAngle(event, gesture);
    const x = vector.dot(gesture.rotationU);
    const y = vector.dot(gesture.rotationV);
    return Math.atan2(y, x) - gesture.rotationStartAngle;
  }

  pointOnAxisPlane(event, view, center, axis) {
    this.setPointer(event, view.rect);
    this.raycaster.setFromCamera(this.pointer, view.camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, center);
    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, target);
  }

  viewNormal(id) {
    if (id === 'front') return new THREE.Vector3(0, 0, 1);
    if (id === 'side') return new THREE.Vector3(1, 0, 0);
    if (id === 'top') return new THREE.Vector3(0, 1, 0);
    return this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(-1);
  }

  startSelectionBox(event, view) {
    event.preventDefault();
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    const canvas = this.renderer.domElement.getBoundingClientRect();
    this.boxGesture = {
      view,
      startX: event.clientX - canvas.left,
      startY: event.clientY - canvas.top,
      endX: event.clientX - canvas.left,
      endY: event.clientY - canvas.top,
      additive: event.shiftKey || event.metaKey || event.ctrlKey
    };
    this.updateSelectionBoxElement();
  }

  updateSelectionBox(event) {
    const canvas = this.renderer.domElement.getBoundingClientRect();
    this.boxGesture.endX = event.clientX - canvas.left;
    this.boxGesture.endY = event.clientY - canvas.top;
    this.updateSelectionBoxElement();
  }

  endSelectionBox() {
    const gesture = this.boxGesture;
    const ids = this.idsInSelectionBox(gesture);
    this.boxGesture = null;
    this.selectionBox.hidden = true;
    this.dispatchEvent(new CustomEvent('select-box', { detail: { ids, additive: gesture.additive } }));
  }

  startCreateStrand(event, view, point) {
    event.preventDefault();
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    this.controls.enabled = false;
    this.createStrandGesture = { view, start: point.clone(), end: point.clone() };
    this.updateCreateGuide([point, point]);
  }

  updateCreateStrand(event) {
    const point = this.pointOnWorkPlane(event, this.createStrandGesture.view);
    if (!point) return;
    this.createStrandGesture.end.copy(this.snapVector(point));
    this.updateCreateGuide([this.createStrandGesture.start, this.createStrandGesture.end]);
  }

  endCreateStrand() {
    const gesture = this.createStrandGesture;
    this.createStrandGesture = null;
    this.createGuide.visible = false;
    this.controls.enabled = this.mode !== 'selectBox';
    if (gesture.start.distanceTo(gesture.end) <= 0.001) {
      this.requestRender();
      return;
    }
    this.dispatchEvent(new CustomEvent('create-strand', {
      detail: { start: positionFrom(gesture.start), end: positionFrom(gesture.end) }
    }));
    this.requestRender();
  }

  updateCreateGuide(points) {
    const positions = [];
    points.slice(0, -1).forEach((point, index) => pushPoints(positions, point, points[index + 1]));
    this.setLinePositions(this.createGuide, positions);
    this.createGuide.visible = positions.length > 0;
    this.requestRender();
  }

  updateSelectionBoxElement() {
    const box = this.boxGesture;
    const left = Math.min(box.startX, box.endX);
    const top = Math.min(box.startY, box.endY);
    const width = Math.abs(box.endX - box.startX);
    const height = Math.abs(box.endY - box.startY);
    Object.assign(this.selectionBox.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`
    });
    this.selectionBox.hidden = false;
  }

  idsInSelectionBox(box) {
    const left = Math.min(box.startX, box.endX);
    const right = Math.max(box.startX, box.endX);
    const top = Math.min(box.startY, box.endY);
    const bottom = Math.max(box.startY, box.endY);
    const index = this.selectionIndexFor(box.view);
    return index.query(left, top, right, bottom);
  }

  selectionIndexFor(view) {
    let index = this.selectionIndexes.get(view.id);
    if (!index) {
      index = new ScreenSelectionIndex();
      this.selectionIndexes.set(view.id, index);
    }
    index.ensure(
      this.selectionIndexSignature(view),
      this.model.bases,
      view,
      this.schematic.hiddenIds,
      baseSitePosition
    );
    return index;
  }

  selectionIndexSignature(view) {
    const e = view.camera.matrixWorld.elements;
    const p = view.camera.projectionMatrix.elements;
    return [
      view.id,
      this.modelRevision,
      this.cameraRevision,
      view.rect.x,
      view.rect.y,
      view.rect.width,
      view.rect.height,
      [...this.schematic.hiddenIds].join(','),
      e.map((value) => value.toFixed(5)).join(','),
      p.map((value) => value.toFixed(5)).join(',')
    ].join('|');
  }

  panPerspective(dx, dy, rect) {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const worldPerPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / Math.max(1, rect.height);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    const delta = right.multiplyScalar(-dx * worldPerPixel).add(up.multiplyScalar(dy * worldPerPixel));
    this.camera.position.add(delta);
    this.controls.target.add(delta);
  }

  hitBase(event, view) {
    const canvas = this.renderer.domElement.getBoundingClientRect();
    const x = event.clientX - canvas.left;
    const y = event.clientY - canvas.top;
    const indexedHit = this.selectionIndexFor(view).nearest(x, y, PICK_RADIUS_PX);
    if (indexedHit) return indexedHit.id;
    this.setPointer(event, view.rect);
    this.raycaster.setFromCamera(this.pointer, view.camera);
    const hit = this.raycaster.intersectObjects([this.baseMesh, this.phosphateMesh], false)[0];
    return hit?.instanceId === undefined ? null : this.baseIdByInstance[hit.instanceId];
  }

  pointOnWorkPlane(event, view) {
    this.setPointer(event, view.rect);
    this.raycaster.setFromCamera(this.pointer, view.camera);
    const normal = view.id === 'front'
      ? new THREE.Vector3(0, 0, 1)
      : view.id === 'side'
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane(normal, 0);
    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, target);
  }

  setPointer(event, viewRect = null) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const target = viewRect ?? { x: 0, y: 0, width: rect.width, height: rect.height };
    this.pointer.x = ((localX - target.x) / target.width) * 2 - 1;
    this.pointer.y = -((localY - target.y) / target.height) * 2 + 1;
  }

  snapVector(vector) {
    const snap = this.snap || 1;
    return new THREE.Vector3(
      Math.round(vector.x / snap) * snap,
      Math.round(vector.y / snap) * snap,
      Math.round(vector.z / snap) * snap
    );
  }

  resize() {
    const width = Math.max(1, this.viewport.clientWidth);
    const height = Math.max(1, this.viewport.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.updateOrthographicCameras();
    this.cameraRevision += 1;
    this.invalidateSelectionIndexes();
    this.requestRender();
  }

  invalidateSelectionIndexes() {
    this.selectionIndexes.forEach((index) => index.invalidate());
  }

  requestRender() {
    if (this.renderRequested) return;
    this.renderRequested = true;
    requestAnimationFrame(() => {
      this.renderRequested = false;
      this.renderViews();
    });
  }

  orientLabels() {
    this.labelGroup.children.forEach((label) => label.quaternion.copy(this.camera.quaternion));
  }

  updateOrthographicCameras() {
    const { center, size } = this.designBounds();
    const distance = size * 2.5;
    this.configureOrtho('top', this.orthoCameras.top, center, new THREE.Vector3(0, distance, 0), new THREE.Vector3(0, 0, -1), size);
    this.configureOrtho('front', this.orthoCameras.front, center, new THREE.Vector3(0, 0, distance), new THREE.Vector3(0, 1, 0), size);
    this.configureOrtho('side', this.orthoCameras.side, center, new THREE.Vector3(-distance, 0, 0), new THREE.Vector3(0, 1, 0), size);
  }

  configureOrtho(id, camera, center, offset, up, size) {
    const control = this.orthoControls[id];
    if (!control.target) control.target = center.clone();
    const aspect = Math.max(0.1, this.viewport.clientWidth / Math.max(1, this.viewport.clientHeight));
    const span = Math.max(0.02, Math.max(4, size * 0.62) / control.zoom);
    camera.left = -span * aspect;
    camera.right = span * aspect;
    camera.top = span;
    camera.bottom = -span;
    camera.near = -size * 5;
    camera.far = size * 5;
    camera.position.copy(control.target).add(offset);
    camera.up.copy(up);
    camera.lookAt(control.target);
    camera.updateProjectionMatrix();
  }

  designBounds() {
    if (!this.model.bases.length) return { center: new THREE.Vector3(), size: 8, maxDimension: 8 };
    const box = new THREE.Box3().setFromPoints(this.model.bases.map((base) => vectorFrom(base.position)));
    const dimensions = box.getSize(new THREE.Vector3());
    return {
      center: box.getCenter(new THREE.Vector3()),
      size: Math.max(3.2, dimensions.length()),
      maxDimension: Math.max(3.2, dimensions.x, dimensions.y, dimensions.z)
    };
  }

  renderViews() {
    this.orientLabels();
    const width = Math.max(1, this.viewport.clientWidth);
    const height = Math.max(1, this.viewport.clientHeight);
    this.viewRects = this.computeViewRects(width, height);
    this.renderer.setScissorTest(true);
    this.renderer.clear(true, true, true);
    this.overlay.replaceChildren(this.selectionBox);
    this.viewRects.forEach((view) => {
      const y = height - view.rect.y - view.rect.height;
      this.renderer.setViewport(view.rect.x, y, view.rect.width, view.rect.height);
      this.renderer.setScissor(view.rect.x, y, view.rect.width, view.rect.height);
      this.renderer.render(this.scene, view.camera);
      this.overlay.appendChild(makeViewBadge(view));
    });
    this.renderer.setScissorTest(false);
  }

  computeViewRects(width, height) {
    if (this.viewMode !== 'quad') {
      return [{ id: this.viewMode, label: viewLabel(this.viewMode), camera: this.cameraFor(this.viewMode), rect: { x: 0, y: 0, width, height } }];
    }
    const cellWidth = Math.floor((width - VIEW_GAP) / 2);
    const cellHeight = Math.floor((height - VIEW_GAP) / 2);
    return [
      makeRect('perspective', 'Perspective', this.camera, 0, 0, cellWidth, cellHeight, width, height),
      makeRect('top', 'Top', this.orthoCameras.top, 1, 0, cellWidth, cellHeight, width, height),
      makeRect('front', 'Front', this.orthoCameras.front, 0, 1, cellWidth, cellHeight, width, height),
      makeRect('side', 'Side', this.orthoCameras.side, 1, 1, cellWidth, cellHeight, width, height)
    ];
  }

  cameraFor(id) {
    if (id === 'top') return this.orthoCameras.top;
    if (id === 'front') return this.orthoCameras.front;
    if (id === 'side') return this.orthoCameras.side;
    return this.camera;
  }

  viewAtEvent(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return this.viewRects.find((view) => x >= view.rect.x && x <= view.rect.x + view.rect.width && y >= view.rect.y && y <= view.rect.y + view.rect.height)
      ?? this.computeViewRects(rect.width, rect.height)[0];
  }
}

function makeRect(id, label, camera, col, row, cellWidth, cellHeight, width, height) {
  return {
    id,
    label,
    camera,
    rect: {
      x: col * (cellWidth + VIEW_GAP),
      y: row * (cellHeight + VIEW_GAP),
      width: col === 1 ? width - cellWidth - VIEW_GAP : cellWidth,
      height: row === 1 ? height - cellHeight - VIEW_GAP : cellHeight
    }
  };
}

function makeTransformGizmo() {
  const group = new THREE.Group();
  group.name = 'Selection transform gizmo';
  const colors = { x: 0xff4b4b, y: 0x5dd65d, z: 0x4b86ff };
  Object.entries(colors).forEach(([axis, color]) => {
    const material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.92 });
    const arrow = new THREE.Group();
    arrow.userData = { tool: 'translate', axis, baseColor: color, baseOpacity: 0.92 };
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.82, 12), material);
    shaft.position.y = 0.41;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 16), material);
    head.position.y = 0.92;
    arrow.add(shaft, head);
    arrow.traverse((object) => {
      object.renderOrder = 1000;
    });
    orientAxisObject(arrow, axis);
    group.add(arrow);

    const ringMaterial = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.82 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.018, 8, 72), ringMaterial);
    ring.userData = { tool: 'rotate', axis, baseColor: color, baseOpacity: 0.82 };
    ring.renderOrder = 1000;
    orientRingObject(ring, axis);
    group.add(ring);
  });
  return group;
}

function sameHandle(a, b) {
  return Boolean(a && b && a.tool === b.tool && a.axis === b.axis);
}

function setGizmoPartState(part, state) {
  const baseColor = new THREE.Color(part.userData.baseColor ?? 0xffffff);
  const color = baseColor.clone();
  const opacity = part.userData.baseOpacity ?? 0.9;
  if (state === 'hover') color.lerp(new THREE.Color(0xffffff), 0.45);
  if (state === 'active') color.set(0xfff2a8);
  part.scale.setScalar(state === 'active' ? 1.18 : state === 'hover' ? 1.08 : 1);
  part.traverse((object) => {
    if (!object.material) return;
    object.material.color.copy(color);
    object.material.opacity = state === 'active' ? 1 : state === 'hover' ? 0.98 : opacity;
    object.material.needsUpdate = true;
  });
}

function orientAxisObject(object, axis) {
  if (axis === 'x') object.rotation.z = -Math.PI / 2;
  if (axis === 'z') object.rotation.x = Math.PI / 2;
}

function orientRingObject(object, axis) {
  if (axis === 'x') object.rotation.y = Math.PI / 2;
  if (axis === 'y') object.rotation.x = Math.PI / 2;
}

function axisVector(axis) {
  if (axis === 'x') return new THREE.Vector3(1, 0, 0);
  if (axis === 'y') return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

function gestureInitRotation(gesture) {
  const helper = Math.abs(gesture.rotationAxis.dot(new THREE.Vector3(0, 1, 0))) > 0.92
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  gesture.rotationU = helper.clone().cross(gesture.rotationAxis).normalize();
  gesture.rotationV = gesture.rotationAxis.clone().cross(gesture.rotationU).normalize();
  const vector = gesture.startPoint
    ? gesture.startPoint.clone().sub(gesture.center)
    : gesture.rotationU.clone();
  gesture.rotationStartAngle = vector.lengthSq() > 0.000001
    ? Math.atan2(vector.dot(gesture.rotationV), vector.dot(gesture.rotationU))
    : 0;
  gesture.lastAngle = 0;
}

function fallbackRotationAngle(event, gesture) {
  const dx = event.clientX - gesture.startX;
  const dy = event.clientY - gesture.startY;
  return (dx - dy) * 0.01;
}

function setWhiteVertexColors(geometry) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  colors.fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function pushSegment(list, a, b) {
  if (!a || !b) return;
  const start = vectorFrom(a.position);
  const end = vectorFrom(b.position);
  list.push(start.x, start.y, start.z, end.x, end.y, end.z);
}

function pushPoints(list, start, end) {
  list.push(start.x, start.y, start.z, end.x, end.y, end.z);
}

function schematicCenter(oneBase, twoBase, threeBase, direction) {
  const one = vectorFrom(oneBase.position);
  const two = vectorFrom(twoBase.position);
  const rawThree = vectorFrom(threeBase.position);
  const d = -direction.dot(one);
  const distance = (direction.x * one.x + direction.y * one.y + direction.z * one.z + d) / direction.length();
  const three = rawThree.sub(direction.clone().multiplyScalar(distance));
  const temp = two.clone().sub(three);
  const temp2 = one.clone().sub(two).cross(two.clone().sub(three));
  const denom = 2 * temp2.lengthSq();
  if (denom <= 0.000001) return one.clone().add(two).multiplyScalar(0.5);
  const alpha = temp.lengthSq() * one.clone().sub(two).dot(one.clone().sub(three)) / denom;
  const beta = one.clone().sub(three).lengthSq() * two.clone().sub(one).dot(two.clone().sub(three)) / denom;
  const gamma = one.clone().sub(two).lengthSq() * three.clone().sub(one).dot(three.clone().sub(two)) / denom;
  return one.multiplyScalar(alpha).add(two.multiplyScalar(beta)).add(three.multiplyScalar(gamma));
}

function pushColoredSegment(list, colors, segments, a, b, model) {
  if (!a || !b) return;
  const start = phosphatePosition(a);
  const end = phosphatePosition(b);
  list.push(start.x, start.y, start.z, end.x, end.y, end.z);
  const startColor = new THREE.Color(model.displayColor(a));
  const endColor = new THREE.Color(model.displayColor(b));
  const selected = model.selectedIds.has(a.id) || model.selectedIds.has(b.id);
  if (selected) {
    startColor.lerp(new THREE.Color(0xffffff), 0.42);
    endColor.lerp(new THREE.Color(0xffffff), 0.42);
  }
  colors.push(startColor.r, startColor.g, startColor.b, endColor.r, endColor.g, endColor.b);
  segments.push({ start, end, color: startColor.clone().lerp(endColor, 0.5) });
}

function phosphatePosition(base) {
  return vectorFrom(base.position);
}

function baseSitePosition(base) {
  return vectorFrom(base.position);
}

function pushUnique(list, segments, seen, prefix, a, b, color, model = null) {
  if (!a || !b) return;
  const key = `${prefix}:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
  if (seen.has(key)) return;
  seen.add(key);
  const start = vectorFrom(a.position);
  const end = vectorFrom(b.position);
  list.push(start.x, start.y, start.z, end.x, end.y, end.z);
  const segmentColor = color.clone?.() ?? new THREE.Color(color);
  if (model && (model.selectedIds.has(a.id) || model.selectedIds.has(b.id))) {
    segmentColor.lerp(new THREE.Color(0xffffff), 0.42);
  }
  segments.push({ start, end, color: segmentColor });
}

function pushUniquePair(list, segments, seen, prefix, a, b, model = null) {
  if (!a || !b) return;
  const key = `${prefix}:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
  if (seen.has(key)) return;
  seen.add(key);
  const start = baseSitePosition(a);
  const end = baseSitePosition(b);
  list.push(start.x, start.y, start.z, end.x, end.y, end.z);
  const color = new THREE.Color(0xf4d35e);
  if (model && (model.selectedIds.has(a.id) || model.selectedIds.has(b.id))) color.lerp(new THREE.Color(0xffffff), 0.42);
  segments.push({ start, end, color });
}

function pushConstraintSegment(list, colors, a, b, color) {
  const start = baseSitePosition(a);
  const end = baseSitePosition(b);
  list.push(start.x, start.y, start.z, end.x, end.y, end.z);
  colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 48, 49);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.material.depthTest = true;
  sprite.scale.set(0.18, 0.18, 0.18);
  return sprite;
}

function viewLabel(id) {
  return id === 'top' ? 'Top' : id === 'front' ? 'Front' : id === 'side' ? 'Side' : 'Perspective';
}

function makeViewBadge(view) {
  const badge = document.createElement('div');
  badge.className = 'viewBadge';
  badge.textContent = view.label;
  badge.style.left = `${view.rect.x + 10}px`;
  badge.style.top = `${view.rect.y + 10}px`;
  return badge;
}
