import * as THREE from 'three';
import { BASES, CONSTRAINTS, STRAND_COLORS, TIAMAT_GEOMETRY, DOWN_DISTANCE, DOWN_ERROR } from './constants.js';
import {
  cleanSequence,
  complementFor,
  helicalPosition,
  inferAcrossPosition,
  linePosition,
  normalizeBase,
  normalizeCreateOptions,
  positionFrom,
  rotatePointAround,
  vectorFrom
} from './geometry.js';

export class TiamatModel extends EventTarget {
  constructor() {
    super();
    this.bases = [];
    this.baseById = new Map();
    this.selectedIds = new Set();
    this.activeId = null;
    this.clipboard = [];
    this.history = [];
    this.future = [];
    this.fileName = 'untitled.tiamat.json';
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }

  snapshot() {
    return JSON.stringify({ bases: this.bases, selectedIds: [...this.selectedIds], activeId: this.activeId });
  }

  restore(snapshot) {
    const data = JSON.parse(snapshot);
    this.bases = data.bases;
    this.rebuildIndex();
    this.selectedIds = new Set(data.selectedIds ?? []);
    this.activeId = data.activeId ?? null;
    this.assignStrands();
    this.emit();
  }

  commit(label = 'edit') {
    this.history.push({ label, snapshot: this.snapshot() });
    if (this.history.length > 100) this.history.shift();
    this.future = [];
  }

  undo() {
    const current = this.history.pop();
    if (!current) return;
    this.future.push({ label: 'redo', snapshot: this.snapshot() });
    this.restore(current.snapshot);
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.history.push({ label: 'undo', snapshot: this.snapshot() });
    this.restore(next.snapshot);
  }

  getBase(id) {
    if (id === null || id === undefined) return null;
    if (this.baseById.size !== this.bases.length) this.rebuildIndex();
    return this.baseById.get(id) ?? null;
  }

  activeBase() {
    return this.activeId === null ? null : this.getBase(this.activeId);
  }

  selectedBases() {
    return [...this.selectedIds].map((id) => this.getBase(id)).filter(Boolean);
  }

  nextId() {
    return this.bases.reduce((max, base) => Math.max(max, base.id), -1) + 1;
  }

  nextStrand() {
    return this.bases.reduce((max, base) => Math.max(max, base.strand), 0) + 1;
  }

  strandColor(strand) {
    return STRAND_COLORS[(strand - 1) % STRAND_COLORS.length];
  }

  displayColor(base) {
    return base.useStrandColor && base.strandColor ? base.strandColor : this.strandColor(base.strand);
  }

  createBase({ type = 'X', position, molecule = 'DNA', geometry = 'B', strand = 1, color = null }) {
    const id = this.nextId();
    const base = {
      id,
      type,
      molecule,
      geometry,
      position: positionFrom(vectorFrom(position)),
      up: null,
      down: null,
      across: null,
      slide: [],
      sticky: null,
      stickyID: 0,
      strand,
      circular: false,
      top: false,
      preset: type !== 'X',
      temp: false,
      useStrandColor: Boolean(color),
      strandColor: color,
      constraints: normalizeConstraints()
    };
    this.bases.push(base);
    this.baseById.set(id, base);
    return base;
  }

  select(id, additive = false) {
    if (!additive) this.selectedIds.clear();
    if (id === null || id === undefined) {
      this.activeId = null;
      this.emit();
      return;
    }
    if (additive && this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.activeId = id;
    this.emit();
  }

  selectIds(ids, additive = false) {
    if (!additive) this.selectedIds.clear();
    ids.forEach((id) => this.selectedIds.add(id));
    this.activeId = ids[0] ?? this.activeId;
    this.emit();
  }

  applySelectionIds(ids, operation = 'replace') {
    const normalized = ids.filter((id) => this.getBase(id));
    if (operation === 'replace') this.selectedIds.clear();
    if (operation === 'subtract') normalized.forEach((id) => this.selectedIds.delete(id));
    else normalized.forEach((id) => this.selectedIds.add(id));
    this.activeId = normalized.find((id) => this.selectedIds.has(id)) ?? this.selectedIds.values().next().value ?? null;
    this.emit();
  }

  selectAll() {
    this.selectedIds = new Set(this.bases.map((base) => base.id));
    this.activeId = this.bases[0]?.id ?? null;
    this.emit();
  }

  selectConnected(id = this.activeId) {
    const seen = this.idsForConnected(id);
    if (!seen.size) return;
    this.selectedIds = seen;
    this.activeId = id;
    this.emit();
  }

  idsForConnected(id = this.activeId) {
    const start = this.getBase(id);
    if (!start) return new Set();
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const base = stack.pop();
      if (!base || seen.has(base.id)) continue;
      seen.add(base.id);
      [base.up, base.down, base.across, ...(base.slide ?? [])].forEach((nextId) => stack.push(this.getBase(nextId)));
    }
    return seen;
  }

  selectHelix(id = this.activeId) {
    const seen = this.idsForHelix(id);
    if (!seen.size) return;
    this.selectedIds = seen;
    this.activeId = id;
    this.emit();
  }

  idsForHelix(id = this.activeId) {
    const start = this.getBase(id);
    if (!start) return new Set();
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const base = stack.pop();
      if (!base || seen.has(base.id)) continue;
      seen.add(base.id);
      [base.up, base.down, base.across].forEach((nextId) => stack.push(this.getBase(nextId)));
    }
    return seen;
  }

  selectStrand(id = this.activeId) {
    const ids = this.idsForStrand(id);
    if (!ids.size) return;
    this.selectedIds = ids;
    this.activeId = id;
    this.emit();
  }

  idsForStrand(id = this.activeId) {
    const base = this.getBase(id);
    if (!base) return new Set();
    return new Set(this.walkStrand(this.strandHead(base)).map((item) => item.id));
  }

  selectHalfStrand(id = this.activeId, direction = 'down') {
    const ids = this.idsForHalfStrand(id, direction);
    if (!ids.size) return;
    this.selectedIds = ids;
    this.activeId = id;
    this.emit();
  }

  idsForHalfStrand(id = this.activeId, direction = 'down') {
    const base = this.getBase(id);
    if (!base) return new Set();
    const ids = [];
    let current = base;
    while (current && !ids.includes(current.id)) {
      ids.push(current.id);
      current = this.getBase(current[direction]);
    }
    return new Set(ids);
  }

  selectPair(id = this.activeId) {
    const ids = this.idsForPair(id);
    if (!ids.size) return;
    this.selectedIds = ids;
    this.activeId = id;
    this.emit();
  }

  idsForPair(id = this.activeId) {
    const base = this.getBase(id);
    if (!base) return new Set();
    return new Set([base.id, base.across].filter((value) => value !== null));
  }

  colorSelected(color) {
    const selected = this.selectedBases();
    if (!selected.length) return;
    this.commit('strand color');
    selected.forEach((base) => {
      base.useStrandColor = true;
      base.strandColor = color;
    });
    this.emit();
  }

  colorActiveStrand(color) {
    const active = this.activeBase();
    if (!active) return;
    this.selectStrand(active.id);
    this.colorSelected(color);
  }

  resetSelectedColor() {
    const selected = this.selectedBases();
    if (!selected.length) return;
    this.commit('reset strand color');
    selected.forEach((base) => {
      base.useStrandColor = false;
      base.strandColor = null;
    });
    this.emit();
  }

  changeSelectedType(type) {
    if (!this.selectedIds.size) return;
    this.commit('change type');
    this.selectedBases().forEach((base) => {
      base.type = normalizeBase(type, base.molecule);
      base.preset = base.type !== 'X';
      const across = this.getBase(base.across);
      if (across && !this.selectedIds.has(across.id)) across.type = complementFor(base);
    });
    this.emit();
  }

  createHelix(sequence, options) {
    const clean = cleanSequence(sequence, options.molecule);
    if (!clean) return 0;
    const normalized = normalizeCreateOptions(options);
    this.commit('create helix');
    const strand = this.nextStrand();
    const acrossStrand = strand + 1;
    let previous = null;
    let previousAcross = null;
    const created = [];
    clean.split('').forEach((letter, index) => {
      const base = this.createBase({
        type: normalizeBase(letter, normalized.molecule),
        position: helicalPosition(index, normalized, 0),
        molecule: normalized.molecule,
        geometry: normalized.geometry,
        strand,
        color: this.strandColor(strand)
      });
      this.linkDown(previous, base);
      if (normalized.double) {
        const paired = this.createBase({
          type: complementFor(base),
          position: helicalPosition(index, normalized, normalized.opposite),
          molecule: normalized.molecule,
          geometry: normalized.geometry,
          strand: acrossStrand,
          color: this.strandColor(acrossStrand)
        });
        this.linkAcross(base, paired);
        if (previousAcross) {
          paired.down = previousAcross.id;
          previousAcross.up = paired.id;
        }
        previousAcross = paired;
      }
      previous = base;
      created.push(base);
    });
    this.select(created[0]?.id ?? null);
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
    return created.length;
  }

  createLine(sequence, options) {
    const clean = cleanSequence(sequence, options.molecule);
    if (!clean) return 0;
    this.commit('create line');
    const strand = this.nextStrand();
    let previous = null;
    const created = [];
    clean.split('').forEach((letter, index) => {
      const base = this.createBase({
        type: normalizeBase(letter, options.molecule),
        position: linePosition(index, strand, DOWN_DISTANCE),
        molecule: options.molecule,
        geometry: options.geometry,
        strand,
        color: this.strandColor(strand)
      });
      this.linkDown(previous, base);
      previous = base;
      created.push(base);
    });
    this.select(created[0]?.id ?? null);
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
    return created.length;
  }

  createStrandBetween(startPosition, endPosition, sequence, options = {}) {
    const normalized = normalizeCreateOptions(options);
    const start = vectorFrom(startPosition);
    const end = vectorFrom(endPosition);
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 0.0001) return 0;
    const baseCount = Math.max(1, normalized.baseCount || Math.ceil(length / normalized.rise));
    const clean = createInitialSequence(sequence, normalized.molecule, baseCount, normalized.initialMode);
    this.commit('create strand');
    const strand = this.nextStrand();
    const acrossStrand = strand + 1;
    let axis = direction.clone().normalize();
    let origin = start.clone();
    if (normalized.orientation === 'reverse') {
      axis = axis.multiplyScalar(-1);
      origin = start.clone().add(direction.clone().normalize().multiplyScalar((baseCount - 1) * normalized.rise));
    }
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    const created = [];
    let previous = null;
    let previousAcross = null;
    clean.split('').forEach((letter, index) => {
      const theta = normalized.initialRotation + THREE.MathUtils.degToRad(index * normalized.twist);
      const axial = axis.clone().multiplyScalar(index * normalized.rise);
      const radial = new THREE.Vector3(normalized.radius * Math.cos(theta), 0, normalized.radius * Math.sin(theta)).applyQuaternion(rotation);
      const base = this.createBase({
        type: normalizeBase(letter, normalized.molecule),
        position: origin.clone().add(axial).add(radial),
        molecule: normalized.molecule,
        geometry: normalized.geometry,
        strand,
        color: this.strandColor(strand)
      });
      this.linkDown(previous, base);
      if (normalized.double) {
        const phase = THREE.MathUtils.degToRad(normalized.opposite);
        const oppositeRadial = new THREE.Vector3(normalized.radius * Math.cos(theta + phase), 0, normalized.radius * Math.sin(theta + phase)).applyQuaternion(rotation);
        const inclination = axis.clone().multiplyScalar(-normalized.radius * 2 * Math.sin(phase / 2) * Math.tan(THREE.MathUtils.degToRad(normalized.inclination)));
        const paired = this.createBase({
          type: complementFor({ ...base, molecule: normalized.pairedMolecule }),
          position: origin.clone().add(axial).add(oppositeRadial).add(inclination),
          molecule: normalized.pairedMolecule,
          geometry: normalized.geometry,
          strand: acrossStrand,
          color: this.strandColor(acrossStrand)
        });
        this.linkAcross(base, paired);
        if (previousAcross) {
          paired.down = previousAcross.id;
          previousAcross.up = paired.id;
        }
        previousAcross = paired;
      }
      previous = base;
      created.push(base);
    });
    this.select(created[0]?.id ?? null);
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
    return created.length;
  }

  createFreeform(controlPoints, options = {}) {
    if (!controlPoints || controlPoints.length < 2) return 0;
    const normalized = normalizeCreateOptions(options);
    const startBase = this.getBase(options.startBaseId);
    const endBase = this.getBase(options.endBaseId);
    const points = controlPoints.map(vectorFrom);
    const samples = sampleBezierByDistance(points, DOWN_DISTANCE, DOWN_ERROR);
    const interior = samples.filter((point, index) => {
      if (startBase && index === 0) return false;
      if (endBase && index === samples.length - 1) return false;
      return true;
    });
    if (!interior.length && !(startBase && endBase)) return 0;
    this.commit('create freeform');
    const clean = createInitialSequence(options.sequence ?? '', normalized.molecule, interior.length, normalized.initialMode);
    const strand = startBase?.strand ?? this.nextStrand();
    const created = interior.map((point, index) => this.createBase({
      type: normalizeBase(clean[index] ?? 'X', normalized.molecule),
      position: point,
      molecule: normalized.molecule,
      geometry: normalized.geometry,
      strand,
      color: startBase?.strandColor ?? this.strandColor(strand)
    }));
    let previous = startBase ?? null;
    created.forEach((base) => {
      this.linkDown(previous, base);
      previous = base;
    });
    if (endBase && previous) this.linkDown(previous, endBase);
    this.select(created[0]?.id ?? startBase?.id ?? endBase?.id ?? null);
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
    return created.length;
  }

  makeAcross(base) {
    if (!base || base.across !== null) return null;
    const geometry = TIAMAT_GEOMETRY[base.geometry] ?? TIAMAT_GEOMETRY.B;
    const strand = this.nextStrand();
    const paired = this.createBase({
      type: complementFor(base),
      molecule: base.molecule,
      geometry: base.geometry,
      position: inferAcrossPosition(base, geometry),
      strand,
      color: this.strandColor(strand)
    });
    this.linkAcross(base, paired);
    return paired;
  }

  pairSelected() {
    const base = this.activeBase();
    if (!base) return;
    this.commit('pair selected');
    this.makeAcross(base);
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
  }

  pairAll() {
    this.commit('pair all');
    let made = 0;
    this.strands().forEach((strand) => {
      const pairedStrand = [];
      strand.forEach((base) => {
        if (base.across === null && this.makeAcross(base)) made += 1;
        const across = this.getBase(base.across);
        if (across) pairedStrand.push(across);
      });
      pairedStrand.forEach((base, index) => {
        const previous = pairedStrand[index - 1];
        if (!previous) return;
        base.down = previous.id;
        previous.up = base.id;
        base.strand = pairedStrand[0].strand;
        previous.strand = pairedStrand[0].strand;
      });
    });
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
    return made;
  }

  extendSelected(direction = 'down') {
    const base = this.activeBase();
    if (!base) return;
    this.commit('extend');
    const next = this.createBase({
      type: 'X',
      molecule: base.molecule,
      geometry: base.geometry,
      strand: base.strand,
      color: base.strandColor,
      position: this.extensionPosition(base, direction)
    });
    if (direction === 'down') this.linkDown(base, next);
    else this.linkDown(next, base);
    this.select(next.id);
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
  }

  extensionPosition(base, direction = 'down') {
    const neighbor = direction === 'down' ? this.getBase(base.up) : this.getBase(base.down);
    if (neighbor) {
      const tangent = vectorFrom(base.position).sub(vectorFrom(neighbor.position));
      if (tangent.lengthSq() > 0.0001) {
        return vectorFrom(base.position).add(tangent.normalize().multiplyScalar(DOWN_DISTANCE));
      }
    }
    const step = direction === 'down' ? 1 : -1;
    return vectorFrom(base.position).add(new THREE.Vector3(0, step * DOWN_DISTANCE, 0));
  }

  linkDown(up, down) {
    if (!up || !down) return;
    if (up.down !== null) this.unlinkDown(up);
    if (down.up !== null) this.unlinkUp(down);
    up.down = down.id;
    down.up = up.id;
    down.strand = up.strand;
    down.strandColor = up.strandColor;
  }

  linkAcross(a, b) {
    if (!a || !b || a.id === b.id) return;
    if (a.across !== null) this.unlinkAcross(a);
    if (b.across !== null) this.unlinkAcross(b);
    a.across = b.id;
    b.across = a.id;
  }

  linkSlide(a, b) {
    if (!a || !b || a.id === b.id) return;
    a.slide = [...new Set([...(a.slide ?? []), b.id])];
    b.slide = [...new Set([...(b.slide ?? []), a.id])];
  }

  linkSticky(a, b, stickyID = Date.now()) {
    if (!a || !b) return;
    a.sticky = b.id;
    b.sticky = a.id;
    a.stickyID = stickyID;
    b.stickyID = stickyID;
  }

  createConnection(type) {
    const [a, b] = this.selectedBases();
    if (!a || !b) return false;
    if (type === 'across' && !this.canLinkAcross(a, b)) return false;
    if (type === 'down' && !this.orientedDownPair(a, b)) return false;
    this.commit(`create ${type}`);
    if (type === 'across') {
      this.linkAcross(a, b);
      if (b.type === 'X') b.type = complementFor(a);
      else if (a.type === 'X') a.type = complementFor(b);
    }
    if (type === 'down') {
      const [up, down] = this.orientedDownPair(a, b);
      this.linkDown(up, down);
    }
    if (type === 'slide') this.linkSlide(a, b);
    if (type === 'sticky') this.linkSticky(a, b);
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
    return true;
  }

  ligateSelected() {
    const [a, b] = this.selectedBases();
    const pair = this.orientedEndPair(a, b);
    if (!pair) return false;
    this.commit('ligate');
    this.linkDown(pair[0], pair[1]);
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
    return true;
  }

  nickSelected() {
    const base = this.activeBase();
    if (!base || base.down === null) return false;
    this.deleteConnection('down');
    return true;
  }

  canLinkAcross(a, b) {
    if (!a || !b || a.id === b.id) return false;
    if (a.across !== null || b.across !== null) return false;
    if (a.molecule !== b.molecule) return false;
    const geometry = TIAMAT_GEOMETRY[a.geometry] ?? TIAMAT_GEOMETRY.B;
    const expected = geometry.radius * 2 * Math.abs(Math.sin(THREE.MathUtils.degToRad(geometry.oppositeDeg) / 2));
    const distance = vectorFrom(a.position).distanceTo(vectorFrom(b.position));
    return Math.abs(distance - expected) <= Math.max(0.2, expected * 0.15);
  }

  orientedDownPair(a, b) {
    if (!a || !b || a.id === b.id) return null;
    if (a.molecule !== b.molecule || a.geometry !== b.geometry) return null;
    const distance = vectorFrom(a.position).distanceTo(vectorFrom(b.position));
    if (Math.abs(distance - DOWN_DISTANCE) > DOWN_ERROR) return null;
    return this.orientedEndPair(a, b);
  }

  orientedEndPair(a, b) {
    if (!a || !b || a.id === b.id) return null;
    if (a.molecule !== b.molecule || a.geometry !== b.geometry) return null;
    if (a.down === null && b.up === null) return [a, b];
    if (b.down === null && a.up === null) return [b, a];
    return null;
  }

  unlinkAcross(base) {
    const other = this.getBase(base.across);
    if (other) other.across = null;
    base.across = null;
  }

  unlinkDown(base) {
    const down = this.getBase(base.down);
    if (down) down.up = null;
    base.down = null;
  }

  unlinkUp(base) {
    const up = this.getBase(base.up);
    if (up) up.down = null;
    base.up = null;
  }

  deleteConnection(type) {
    const base = this.activeBase();
    if (!base) return;
    this.commit(`delete ${type}`);
    if (type === 'across') this.unlinkAcross(base);
    if (type === 'down') this.unlinkDown(base);
    if (type === 'up') this.unlinkUp(base);
    if (type === 'slide') {
      base.slide.forEach((id) => {
        const other = this.getBase(id);
        if (other) other.slide = (other.slide ?? []).filter((slideId) => slideId !== base.id);
      });
      base.slide = [];
    }
    if (type === 'sticky') {
      const other = this.getBase(base.sticky);
      if (other) {
        other.sticky = null;
        other.stickyID = 0;
      }
      base.sticky = null;
      base.stickyID = 0;
    }
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
  }

  detachBase(base) {
    if (base.up !== null) this.unlinkUp(base);
    if (base.down !== null) this.unlinkDown(base);
    if (base.across !== null) this.unlinkAcross(base);
    (base.slide ?? []).forEach((id) => {
      const other = this.getBase(id);
      if (other) other.slide = (other.slide ?? []).filter((slideId) => slideId !== base.id);
    });
    if (base.sticky !== null) {
      const other = this.getBase(base.sticky);
      if (other) {
        other.sticky = null;
        other.stickyID = 0;
      }
      base.sticky = null;
      base.stickyID = 0;
    }
  }

  deleteSelected() {
    const targets = this.selectedBases();
    if (!targets.length) return;
    this.commit('delete bases');
    targets.forEach((base) => this.detachBase(base));
    const ids = new Set(targets.map((base) => base.id));
    this.bases = this.bases.filter((base) => !ids.has(base.id));
    this.rebuildIndex();
    this.selectedIds.clear();
    this.activeId = null;
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
  }

  translateSelected(delta) {
    const selected = this.selectedBases();
    if (!selected.length) return;
    this.commit('translate');
    const d = vectorFrom(delta);
    selected.forEach((base) => {
      base.position = positionFrom(vectorFrom(base.position).add(d));
    });
    this.updateGeometryMeasurements();
    this.emit();
  }

  rotateSelected(axisName, degrees) {
    const selected = this.selectedBases();
    if (!selected.length) return;
    this.commit('rotate');
    const center = this.selectedCenter();
    const axis = axisName === 'x' ? new THREE.Vector3(1, 0, 0) : axisName === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const radians = THREE.MathUtils.degToRad(Number(degrees) || 0);
    selected.forEach((base) => {
      base.position = positionFrom(rotatePointAround(base.position, center, axis, radians));
    });
    this.updateGeometryMeasurements();
    this.emit();
  }

  selectedCenter() {
    const selected = this.selectedBases();
    if (!selected.length) return new THREE.Vector3();
    return selected.reduce((sum, base) => sum.add(vectorFrom(base.position)), new THREE.Vector3()).multiplyScalar(1 / selected.length);
  }

  copySelected() {
    this.clipboard = this.selectedBases().map((base) => structuredClone(base));
  }

  pasteClipboard() {
    if (!this.clipboard.length) return 0;
    this.commit('paste');
    const idMap = new Map();
    const clones = this.clipboard.map((base, index) => {
      const clone = structuredClone(base);
      const id = this.nextId() + index;
      idMap.set(base.id, id);
      clone.id = id;
      clone.position = positionFrom(vectorFrom(base.position));
      this.bases.push(clone);
      this.baseById.set(id, clone);
      return clone;
    });
    clones.forEach((base) => {
      base.up = idMap.get(base.up) ?? null;
      base.down = idMap.get(base.down) ?? null;
      base.across = idMap.get(base.across) ?? null;
      base.slide = (base.slide ?? []).map((id) => idMap.get(id)).filter(Number.isFinite);
      base.sticky = idMap.get(base.sticky) ?? null;
    });
    this.selectedIds = new Set(clones.map((base) => base.id));
    this.activeId = clones[0]?.id ?? null;
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
    return clones.length;
  }

  strands() {
    const heads = this.bases.filter((base) => base.up === null).sort((a, b) => a.strand - b.strand || a.id - b.id);
    const visited = new Set();
    const result = [];
    heads.forEach((head) => {
      const strand = this.walkStrand(head, visited);
      if (strand.length) result.push(strand);
    });
    this.bases.forEach((base) => {
      if (!visited.has(base.id)) {
        const strand = this.walkStrand(base, visited);
        if (strand.length) result.push(strand);
      }
    });
    return result;
  }

  walkStrand(head, visited = new Set()) {
    const strand = [];
    let current = head;
    while (current && !visited.has(current.id)) {
      strand.push(current);
      visited.add(current.id);
      current = current.down === null ? null : this.getBase(current.down);
    }
    return strand;
  }

  strandHead(base) {
    let current = base;
    const seen = new Set();
    while (current?.up !== null && !seen.has(current.id)) {
      seen.add(current.id);
      current = this.getBase(current.up);
    }
    return current ?? base;
  }

  assignStrands() {
    let strandNum = 1;
    this.strands().forEach((strand) => {
      const color = this.strandColor(strandNum);
      strand.forEach((base, index) => {
        base.strand = strandNum;
        base.top = index === 0;
        base.strandColor = base.strandColor ?? color;
      });
      strandNum += 1;
    });
  }

  updateGeometryMeasurements() {
    this.bases.forEach((base) => {
      const constraints = normalizeConstraints(base.constraints);
      if (base.down !== null) {
        const down = this.getBase(base.down);
        constraints.hasRise = Boolean(down);
        constraints.rise = down ? vectorFrom(base.position).distanceTo(vectorFrom(down.position)) : 0;
      } else {
        constraints.hasRise = false;
        constraints.rise = 0;
      }
      if (base.across !== null) {
        const across = this.getBase(base.across);
        constraints.hasChord = Boolean(across);
        constraints.chord = across ? vectorFrom(base.position).distanceTo(vectorFrom(across.position)) : 0;
      } else {
        constraints.hasChord = false;
        constraints.chord = 0;
      }
      if (base.up !== null && base.down !== null) {
        const up = this.getBase(base.up);
        const down = this.getBase(base.down);
        if (up && down) {
          constraints.hasRotation = true;
          constraints.rotation = vectorFrom(up.position).sub(vectorFrom(base.position)).normalize()
            .angleTo(vectorFrom(base.position).sub(vectorFrom(down.position)).normalize());
        }
      } else {
        constraints.hasRotation = false;
        constraints.rotation = 0;
      }
      if (base.up !== null && base.down !== null && base.across !== null) {
        const up = this.getBase(base.up);
        const down = this.getBase(base.down);
        const across = this.getBase(base.across);
        const acrossUp = this.getBase(across?.up);
        const acrossDown = this.getBase(across?.down);
        if (up && down && across && acrossUp && acrossDown) {
          const this0 = vectorFrom(down.position).add(vectorFrom(up.position)).multiplyScalar(0.5);
          const across0 = vectorFrom(acrossDown.position).add(vectorFrom(acrossUp.position)).multiplyScalar(0.5);
          const thisPerp = this0.sub(vectorFrom(base.position)).normalize();
          const acrossPerp = vectorFrom(across.position).sub(across0).normalize();
          const normal = thisPerp.clone().cross(acrossPerp).normalize();
          const incline = vectorFrom(across.position).sub(vectorFrom(base.position)).normalize();
          constraints.hasInclination = true;
          constraints.inclination = Math.asin(THREE.MathUtils.clamp(incline.dot(normal), -1, 1));
        } else {
          constraints.hasInclination = false;
          constraints.inclination = 0;
        }
      } else {
        constraints.hasInclination = false;
        constraints.inclination = 0;
      }
      constraints.violations = constraintViolations(base, constraints);
      base.constraints = constraints;
    });
  }

  loadBases(bases) {
    this.commit('load');
    this.bases = bases.map((base) => ({ ...base, constraints: normalizeConstraints(base.constraints) }));
    this.rebuildIndex();
    this.selectedIds.clear();
    this.activeId = this.bases[0]?.id ?? null;
    if (this.activeId !== null) this.selectedIds.add(this.activeId);
    this.assignStrands();
    this.updateGeometryMeasurements();
    this.emit();
  }

  rebuildIndex() {
    this.baseById = new Map(this.bases.map((base) => [base.id, base]));
  }
}

export function normalizeConstraints(value = {}) {
  return {
    hasRotation: Boolean(value.hasRotation),
    rotation: Number(value.rotation) || 0,
    hasRise: Boolean(value.hasRise),
    rise: Number(value.rise) || 0,
    hasChord: Boolean(value.hasChord),
    chord: Number(value.chord) || 0,
    hasInclination: Boolean(value.hasInclination),
    inclination: Number(value.inclination) || 0,
    violations: value.violations ?? {}
  };
}

export function constraintViolations(base, constraints = base.constraints ?? {}) {
  const preset = CONSTRAINTS[base.geometry] ?? CONSTRAINTS.B;
  return {
    rotation: Boolean(constraints.hasRotation && Math.abs(constraints.rotation - preset.rotation.median) > preset.rotation.error),
    rise: Boolean(constraints.hasRise && Math.abs(constraints.rise - preset.rise.median) > preset.rise.error),
    chord: Boolean(constraints.hasChord && Math.abs(constraints.chord - preset.chord.median) > preset.chord.error),
    inclination: Boolean(constraints.hasInclination && Math.abs(constraints.inclination - preset.inclination.median) > preset.inclination.error)
  };
}

export function hasConstraintViolations(base) {
  const violations = base.constraints?.violations ?? constraintViolations(base);
  return Object.values(violations).some(Boolean);
}

function sampleBezierByDistance(points, spacing, tolerance) {
  const samples = [points[0].clone()];
  let current = points[0].clone();
  const step = Math.max(0.0001, spacing * 0.0001 / Math.max(1, points.length));
  for (let t = step; t <= 1 + step / 2; t += step) {
    const point = bezierPoint(points, Math.min(1, t));
    const distance = point.distanceTo(current);
    if (Math.abs(distance - spacing) <= tolerance || distance > spacing) {
      samples.push(point);
      current = point;
    }
  }
  const end = points[points.length - 1];
  if (samples[samples.length - 1].distanceTo(end) > spacing * 0.5) samples.push(end.clone());
  return samples;
}

function bezierPoint(points, t) {
  const working = points.map((point) => point.clone());
  for (let level = points.length - 1; level > 0; level -= 1) {
    for (let index = 0; index < level; index += 1) {
      working[index].lerp(working[index + 1], t);
    }
  }
  return working[0];
}

function createInitialSequence(sequence, molecule, count, mode = 'sequence') {
  if (mode === 'blank') return 'X'.repeat(count);
  if (mode === 'random') {
    const alphabet = molecule === 'RNA' ? ['A', 'U', 'C', 'G'] : ['A', 'T', 'C', 'G'];
    return Array.from({ length: count }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }
  return cleanSequence(sequence, molecule).padEnd(count, 'X').slice(0, count);
}
