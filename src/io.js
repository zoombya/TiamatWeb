import * as THREE from 'three';
import { BASES, DOWN_DISTANCE, TIAMAT_GEOMETRY, TYPE_FROM_NAME } from './constants.js';
import { arrayToPosition, normalizeImportedType } from './legacy-normalize.js';
import { cleanSequence, normalizeBase, vectorFrom } from './geometry.js';
export { parseDnaFile } from './dna-loader.js';

const OXVIEW_NM_PER_UNIT = 0.8518;
const OXDNA_BASE_BASE = 0.3897628551303122;
const OXDNA_CM_CENTER_DS = 0.6;
const OXDNA_COMPLEMENT_CM_SEPARATION = 1.2;
const OXDNA_HELICAL_TWIST_RAD = THREE.MathUtils.degToRad(35.9);

/**
 * Merge metadata from a corrupted .dna parse into oxDNA-sourced bases.
 * Matches bases by strand order: walks strands in both datasets and
 * copies across-links, types, and strand colors from .dna to oxDNA bases.
 */
export function mergeMetadataFromDna(oxBases, dnaBases) {
  // Build strand walks for both datasets
  const oxStrands = buildStrands(oxBases);
  const dnaStrands = buildStrands(dnaBases);

  // Match strands by length (greedy, largest first)
  const dnaByLen = new Map();
  dnaStrands.forEach((strand) => {
    const key = strand.length;
    if (!dnaByLen.has(key)) dnaByLen.set(key, []);
    dnaByLen.get(key).push(strand);
  });

  const oxById = new Map(oxBases.map((b) => [b.id, b]));
  const dnaById = new Map(dnaBases.map((b) => [b.id, b]));
  let merged = 0;

  oxStrands.forEach((oxStrand) => {
    const candidates = dnaByLen.get(oxStrand.length);
    if (!candidates || !candidates.length) return;
    const dnaStrand = candidates.shift();
    for (let i = 0; i < oxStrand.length; i++) {
      const ob = oxById.get(oxStrand[i]);
      const db = dnaById.get(dnaStrand[i]);
      if (!ob || !db) continue;
      // Copy type if .dna has a real type
      if (db.type && db.type !== 'X') ob.type = db.type;
      // Copy across link: find the matching oxDNA base for the .dna across target
      // (deferred — we'd need a full .dna→oxDNA ID map)
      // Copy strand color
      if (db.useStrandColor && db.strandColor) {
        ob.useStrandColor = true;
        ob.strandColor = db.strandColor;
      }
      ob.preset = ob.type !== 'X';
      merged++;
    }
  });
  return merged;
}

function buildStrands(bases) {
  const byId = new Map(bases.map((b) => [b.id, b]));
  const visited = new Set();
  const strands = [];
  // Find strand heads (up === null)
  const heads = bases.filter((b) => b.up === null).sort((a, b) => (a.strand || 0) - (b.strand || 0) || a.id - b.id);
  heads.forEach((head) => {
    const ids = [];
    let cur = head;
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      ids.push(cur.id);
      cur = cur.down !== null ? byId.get(cur.down) : null;
    }
    if (ids.length) strands.push(ids);
  });
  // Circular strands
  bases.forEach((b) => {
    if (visited.has(b.id)) return;
    const ids = [];
    let cur = b;
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      ids.push(cur.id);
      cur = cur.down !== null ? byId.get(cur.down) : null;
    }
    if (ids.length) strands.push(ids);
  });
  return strands;
}

export function parseOxDnaTopConf(topText, confText) {
  const topLines = topText.split('\n');
  const confLines = confText.split('\n');
  const [nBases, nStrands] = topLines[0].trim().split(/\s+/).map(Number);
  const bases = [];
  for (let i = 0; i < nBases; i++) {
    const tParts = topLines[i + 1]?.trim().split(/\s+/) ?? [];
    const cParts = confLines[i + 3]?.trim().split(/\s+/) ?? [];
    const n3 = Number(tParts[2] ?? -1);
    const n5 = Number(tParts[3] ?? -1);
    bases.push({
      id: i,
      type: normalizeImportedType(tParts[1] ?? 'X'),
      molecule: tParts[1] === 'U' ? 'RNA' : 'DNA',
      geometry: 'B',
      position: { x: Number(cParts[0]) || 0, y: Number(cParts[1]) || 0, z: Number(cParts[2]) || 0 },
      up: n5 >= 0 && n5 < nBases ? n5 : null,
      down: n3 >= 0 && n3 < nBases ? n3 : null,
      across: null,
      slide: [],
      sticky: null,
      stickyID: 0,
      strand: Number(tParts[0]) || 1,
      circular: false,
      top: false,
      preset: (tParts[1] ?? 'X') !== 'X',
      temp: false,
      useStrandColor: false,
      strandColor: null,
      constraints: {},
      oxView: {
        a1: normalizeArrayVector(cParts.slice(3, 6)),
        a3: normalizeArrayVector(cParts.slice(6, 9))
      }
    });
  }
  // Scale to Tiamat nm: compute median down-distance and scale to 0.677
  const dists = bases.map((b) => {
    if (b.down === null) return null;
    const nb = bases[b.down];
    return Math.sqrt((b.position.x-nb.position.x)**2 + (b.position.y-nb.position.y)**2 + (b.position.z-nb.position.z)**2);
  }).filter((d) => d !== null && d > 0.001).sort((a, b) => a - b);
  const medianDist = dists[Math.floor(dists.length / 2)] || 1;
  const scale = 0.677 / medianDist;
  const center = bases.reduce((s, b) => ({ x: s.x + b.position.x, y: s.y + b.position.y, z: s.z + b.position.z }), { x: 0, y: 0, z: 0 });
  center.x /= bases.length; center.y /= bases.length; center.z /= bases.length;
  bases.forEach((b) => {
    b.position.x = (b.position.x - center.x) * scale;
    b.position.y = (b.position.y - center.y) * scale;
    b.position.z = (b.position.z - center.z) * scale;
    b.oxView = {
      ...(b.oxView ?? {}),
      importScale: scale,
      importCenter: [center.x, center.y, center.z],
      medianDownDistance: medianDist
    };
  });
  return {
    view: null,
    bases,
    diagnostics: {
      format: 'oxDNA topology+configuration',
      importedBases: bases.length,
      strands: nStrands,
      pairs: 0,
      scale: scale.toFixed(4),
      medianDown: medianDist.toFixed(4)
    }
  };
}

const CADNANO_HELIX_SPACING = 2.5;

export function fullProjectJson(model, view = null) {
  return JSON.stringify({
    app: 'Tiamat Web',
    version: 3,
    sourceCompatibility: 'Full web project graph, preserving original Nucleobase graph fields as ids.',
    view,
    bases: model.bases.map(fullBaseRecord)
  }, null, 2);
}

export function dnaJson(model) {
  return JSON.stringify({
    bases: model.bases.map((base) => ({
      id: base.id,
      position: [base.position.x, base.position.y, base.position.z],
      molecule: base.molecule,
      type: BASES[base.type].name,
      across: base.across,
      up: base.up,
      down: base.down
    }))
  }, null, 2);
}

export function sequenceText(model) {
  return model.strands().map((strand, index) => {
    const circular = strand[0]?.circular ? 'c' : '';
    return `${index + 1}${circular}: ${strand.map((base) => base.type).join('')}`;
  }).join('\n');
}

export function pdbText(model) {
  let atom = 1;
  const lines = [];
  model.strands().forEach((strand, strandIndex) => {
    strand.forEach((base, residueIndex) => {
      const p = vectorFrom(base.position).multiplyScalar(10);
      const residue = base.molecule === 'RNA' ? ` R${base.type}` : ` D${base.type}`;
      lines.push(`ATOM  ${String(atom++).padStart(5)}  O5'${residue.padEnd(4)} ${String.fromCharCode(65 + (strandIndex % 26))}${String(residueIndex + 1).padStart(4)}    ${p.x.toFixed(3).padStart(8)}${p.y.toFixed(3).padStart(8)}${p.z.toFixed(3).padStart(8)}  1.00  0.00           O`);
      const side = vectorFrom(base.position).multiplyScalar(10);
      lines.push(`ATOM  ${String(atom++).padStart(5)}  N1 ${residue.padEnd(4)} ${String.fromCharCode(65 + (strandIndex % 26))}${String(residueIndex + 1).padStart(4)}    ${side.x.toFixed(3).padStart(8)}${side.y.toFixed(3).padStart(8)}${side.z.toFixed(3).padStart(8)}  1.00  0.00           N`);
    });
    lines.push('TER');
  });
  lines.push('END');
  return lines.join('\n');
}

export function oxViewJson(model) {
  const strands = model.strands();
  const bases = strands.flat();
  const idToOxId = new Map(bases.map((base, index) => [base.id, index]));
  const byId = new Map(model.bases.map((base) => [base.id, base]));
  const frames = buildOxViewFrames(strands, byId);
  const box = oxViewBox([...frames.values()].map((frame) => frame.p));
  const oxStrands = strands.map((strand, strandIndex) => {
    const monomers = strand.map((base) => oxViewMonomer(base, byId, idToOxId, model, frames.get(base.id)));
    return {
      id: strandIndex,
      end3: idToOxId.get(strand.at(-1)?.id) ?? monomers.at(-1)?.id ?? -1,
      end5: idToOxId.get(strand[0]?.id) ?? monomers[0]?.id ?? -1,
      class: 'NucleicAcidStrand',
      monomers
    };
  });

  return JSON.stringify({
    date: new Date().toISOString(),
    box,
    systems: [{
      id: 0,
      strands: oxStrands
    }]
  }, null, 2);
}

function oxViewMonomer(base, byId, idToOxId, model, frame = oxViewFrame(base, byId)) {
  const monomer = {
    id: idToOxId.get(base.id),
    type: base.type === 'X' ? 'A' : base.type,
    class: base.molecule === 'RNA' ? 'RNA' : 'DNA',
    p: roundVector(frame.p),
    a1: roundVector(frame.a1),
    a3: roundVector(frame.a3)
  };
  const n5 = idToOxId.get(base.up);
  const n3 = idToOxId.get(base.down);
  const bp = idToOxId.get(base.across);
  if (n5 !== undefined) monomer.n5 = n5;
  if (n3 !== undefined) monomer.n3 = n3;
  if (bp !== undefined) monomer.bp = bp;
  const color = colorToDecimal(model.displayColor(base));
  if (color !== null) monomer.color = color;
  return monomer;
}

function oxViewFrame(base, byId) {
  const a3 = oxViewA3Vector(base, byId);
  const a1 = oxViewA1Vector(base, byId, a3);
  const p = oxViewScenePosition(base);
  return { p, a1, a3 };
}

function buildOxViewFrames(strands, byId) {
  const frames = new Map();
  const strandGap = 3.2;
  let layoutIndex = 0;

  strands.forEach((strand) => {
    strand.forEach((base) => {
      if (hasImportedOxFrame(base)) frames.set(base.id, oxViewFrame(base, byId));
    });
  });

  strands.forEach((strand) => {
    if (!strand.length || strand.every((base) => frames.has(base.id))) return;
    const origin = new THREE.Vector3(layoutIndex * strandGap, 0, 0);
    layoutIndex += 1;
    generateCanonicalOxStrandFrames(strand, origin, frames, byId);
  });

  strands.forEach((strand) => {
    if (!strand.length || strand.every((base) => frames.has(base.id))) return;
    const origin = new THREE.Vector3(layoutIndex * strandGap, 0, 0);
    layoutIndex += 1;
    generateCanonicalOxStrandFrames(strand, origin, frames, byId);
  });

  return frames;
}

function hasImportedOxFrame(base) {
  return base?.oxView && Array.isArray(base.oxView.a1) && Array.isArray(base.oxView.a3);
}

function generateCanonicalOxStrandFrames(strand, origin, frames, byId) {
  const axis = new THREE.Vector3(0, 0, 1);
  const firstA1 = new THREE.Vector3(1, 0, 0);
  const rotation = new THREE.Quaternion();

  strand.forEach((base, index) => {
    if (frames.has(base.id)) return;
    rotation.setFromAxisAngle(axis, index * OXDNA_HELICAL_TWIST_RAD);
    const a1 = firstA1.clone().applyQuaternion(rotation).normalize();
    const a3 = axis.clone();
    const rb = origin.clone().addScaledVector(axis, index * OXDNA_BASE_BASE);
    const p = rb.sub(a1.clone().multiplyScalar(OXDNA_CM_CENTER_DS));
    frames.set(base.id, { p, a1, a3 });

    const pair = byId.get(base.across);
    if (pair && !frames.has(pair.id) && !hasImportedOxFrame(pair)) {
      frames.set(pair.id, complementOxFrame(frames.get(base.id)));
    }
  });
}

function complementOxFrame(frame) {
  const a1 = frame.a1.clone().multiplyScalar(-1);
  const a3 = frame.a3.clone().multiplyScalar(-1);
  const p = frame.p.clone().sub(a1.clone().multiplyScalar(OXDNA_COMPLEMENT_CM_SEPARATION));
  return { p, a1, a3 };
}

function oxViewScenePosition(base) {
  const position = vectorFrom(base.position);
  const importedScale = Number(base.oxView?.importScale);
  if (Number.isFinite(importedScale) && importedScale > 0) {
    const source = position.divideScalar(importedScale);
    const center = vectorFrom(base.oxView?.importCenter);
    return source.add(center);
  }
  return position.divideScalar(OXVIEW_NM_PER_UNIT);
}

function oxViewA3Vector(base, byId) {
  const imported = vectorFrom(base.oxView?.a3);
  if (imported.lengthSq() > 0.000001) return imported.normalize();
  const up = byId.get(base.up);
  const down = byId.get(base.down);
  const here = vectorFrom(base.position);
  let direction = null;
  if (up && down) direction = vectorFrom(down.position).sub(vectorFrom(up.position));
  else if (down) direction = vectorFrom(down.position).sub(here);
  else if (up) direction = here.clone().sub(vectorFrom(up.position));
  const vector = direction && direction.lengthSq() > 0.000001
    ? direction.normalize()
    : new THREE.Vector3(0, 0, 1);
  return vector;
}

function oxViewA1Vector(base, byId, a3) {
  const here = vectorFrom(base.position);
  const across = byId.get(base.across);
  let vector = vectorFrom(base.oxView?.a1);
  if (vector.lengthSq() <= 0.000001 && across) vector = vectorFrom(across.position).sub(here);
  const axis = a3.clone().normalize();
  if (vector.lengthSq() > 0.000001) vector.sub(axis.clone().multiplyScalar(vector.dot(axis)));
  if (!vector || vector.lengthSq() <= 0.000001) {
    vector = Math.abs(axis.dot(new THREE.Vector3(1, 0, 0))) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    vector.sub(axis.clone().multiplyScalar(vector.dot(axis)));
  }
  vector.normalize();
  return vector;
}

function oxViewBox(points) {
  if (!points.length) return [10, 10, 10];
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  return [
    round6(Math.max(10, size.x + 10)),
    round6(Math.max(10, size.y + 10)),
    round6(Math.max(10, size.z + 10))
  ];
}

function colorToDecimal(color) {
  const match = String(color ?? '').match(/^#?([0-9a-f]{6})$/i);
  return match ? Number.parseInt(match[1], 16) : null;
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

function roundVector(vector) {
  return [round6(vector.x), round6(vector.y), round6(vector.z)];
}

function normalizeArrayVector(values) {
  const vector = new THREE.Vector3(
    Number(values?.[0]) || 0,
    Number(values?.[1]) || 0,
    Number(values?.[2]) || 0
  );
  return vector.lengthSq() > 0.000001 ? vector.normalize().toArray() : null;
}

export function oxDnaText(model) {
  const bases = [...model.bases].sort((a, b) => a.id - b.id);
  const idToIndex = new Map(bases.map((base, index) => [base.id, index]));
  const byId = new Map(model.bases.map((base) => [base.id, base]));
  const frames = buildOxViewFrames(model.strands(), byId);
  const topology = [`${bases.length} ${model.strands().length}`];
  const config = ['t = 0', 'b = 40 40 40', 'E = 0 0 0'];
  bases.forEach((base) => {
    topology.push(`${base.strand} ${base.type} ${base.down === null ? -1 : idToIndex.get(base.down)} ${base.up === null ? -1 : idToIndex.get(base.up)}`);
    const frame = frames.get(base.id) ?? oxViewFrame(base, byId);
    config.push(`${roundVector(frame.p).join(' ')} ${roundVector(frame.a1).join(' ')} ${roundVector(frame.a3).join(' ')} 0 0 0 0 0 0`);
  });
  return `# topology\n${topology.join('\n')}\n\n# configuration\n${config.join('\n')}\n`;
}

export function parseJsonProject(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data.systems)) return parseOxViewProjectData(data);
  if (Array.isArray(data.vstrands)) return parseCadnanoV2ProjectData(data);
  const source = Array.isArray(data.bases) ? data.bases : [];
  return {
    view: data.view ?? null,
    bases: source.map((item, index) => ({
      id: Number(item.id ?? index),
      type: normalizeImportedType(item.type ?? typeCodeToBase(item.typeCode)),
      molecule: item.molecule ?? 'DNA',
      geometry: item.geometry ?? geometryCodeToName(item.geometryCode),
      position: arrayToPosition(item.position ?? [0, 0, 0]),
      up: item.up,
      down: item.down,
      across: item.across,
      slide: Array.isArray(item.slide) ? item.slide : [],
      sticky: item.sticky ?? null,
      stickyID: item.stickyID ?? 0,
      strand: item.strand ?? 0,
      circular: Boolean(item.circular),
      top: Boolean(item.top),
      preset: item.preset ?? true,
      temp: Boolean(item.temp),
      useStrandColor: Boolean(item.useStrandColor ?? item.strandColor),
      strandColor: item.strandColor ?? null,
      constraints: item.constraints ?? {}
    }))
  };
}

export function parseCadnanoV2Project(text) {
  return parseCadnanoV2ProjectData(JSON.parse(text));
}

export function parseOxViewProject(text) {
  return parseOxViewProjectData(JSON.parse(text));
}

export function mergeImportedDesigns(designs, { gap = 12 } = {}) {
  const activeDesigns = designs.filter((design) => Array.isArray(design.bases) && design.bases.length > 0);
  if (activeDesigns.length === 0) {
    return {
      view: null,
      bases: [],
      diagnostics: {
        format: 'Multiple designs',
        importedBases: 0,
        designCount: 0,
        strands: 0,
        pairs: 0
      }
    };
  }

  const shouldArrange = activeDesigns.length > 1;
  const mergedBases = [];
  const designSummaries = [];
  let nextId = 0;
  let cursorX = 0;

  activeDesigns.forEach((design, designIndex) => {
    const bounds = baseBounds(design.bases);
    const width = Math.max(bounds.max.x - bounds.min.x, 1);
    const center = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2
    };
    const targetCenterX = shouldArrange ? cursorX + width / 2 : center.x;
    const translation = {
      x: targetCenterX - center.x,
      y: shouldArrange ? -center.y : 0,
      z: shouldArrange ? -center.z : 0
    };

    const idMap = new Map();
    design.bases.forEach((base) => {
      idMap.set(base.id, nextId++);
    });

    design.bases.forEach((base) => {
      const position = vectorFrom(base.position);
      mergedBases.push({
        ...structuredClone(base),
        id: idMap.get(base.id),
        position: {
          x: position.x + translation.x,
          y: position.y + translation.y,
          z: position.z + translation.z
        },
        up: idMap.get(base.up) ?? null,
        down: idMap.get(base.down) ?? null,
        across: idMap.get(base.across) ?? null,
        slide: (base.slide ?? []).map((id) => idMap.get(id)).filter(Number.isFinite),
        sticky: idMap.get(base.sticky) ?? null,
        sourceDesign: design.name ?? `design ${designIndex + 1}`
      });
    });

    designSummaries.push({
      name: design.name ?? `design ${designIndex + 1}`,
      bases: design.bases.length,
      format: design.diagnostics?.format ?? 'unknown'
    });
    cursorX += width + gap;
  });

  return {
    view: activeDesigns.length === 1 ? activeDesigns[0].view ?? null : null,
    bases: mergedBases,
    diagnostics: {
      format: activeDesigns.length === 1
        ? activeDesigns[0].diagnostics?.format ?? 'Imported design'
        : 'Multiple designs',
      importedBases: mergedBases.length,
      designCount: activeDesigns.length,
      designs: designSummaries,
      strands: countStrands(mergedBases),
      pairs: countPairs(mergedBases),
      sourceDiagnostics: activeDesigns.map((design) => design.diagnostics).filter(Boolean)
    }
  };
}

export function appendImportedDesigns(currentBases, designs, { gap = 12 } = {}) {
  const incoming = designs.filter((design) => Array.isArray(design.bases) && design.bases.length > 0);
  if (!Array.isArray(currentBases) || currentBases.length === 0) return mergeImportedDesigns(incoming, { gap });
  if (incoming.length === 0) {
    return {
      view: null,
      bases: currentBases.map((base) => structuredClone(base)),
      diagnostics: {
        format: 'Multiple designs',
        importedBases: currentBases.length,
        designCount: 1,
        appendedDesignCount: 0,
        strands: countStrands(currentBases),
        pairs: countPairs(currentBases)
      }
    };
  }

  const mergedBases = currentBases.map((base) => structuredClone(base));
  const currentBounds = baseBounds(mergedBases);
  const currentCenter = {
    y: (currentBounds.min.y + currentBounds.max.y) / 2,
    z: (currentBounds.min.z + currentBounds.max.z) / 2
  };
  let cursorX = currentBounds.max.x + gap;
  let nextId = mergedBases.reduce((max, base) => Math.max(max, Number(base.id) || 0), -1) + 1;
  const designSummaries = [];

  incoming.forEach((design, designIndex) => {
    const bounds = baseBounds(design.bases);
    const width = Math.max(bounds.max.x - bounds.min.x, 1);
    const center = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2
    };
    const translation = {
      x: cursorX + width / 2 - center.x,
      y: currentCenter.y - center.y,
      z: currentCenter.z - center.z
    };

    const idMap = new Map();
    design.bases.forEach((base) => {
      idMap.set(base.id, nextId++);
    });
    design.bases.forEach((base) => {
      const position = vectorFrom(base.position);
      mergedBases.push({
        ...structuredClone(base),
        id: idMap.get(base.id),
        position: {
          x: position.x + translation.x,
          y: position.y + translation.y,
          z: position.z + translation.z
        },
        up: idMap.get(base.up) ?? null,
        down: idMap.get(base.down) ?? null,
        across: idMap.get(base.across) ?? null,
        slide: (base.slide ?? []).map((id) => idMap.get(id)).filter(Number.isFinite),
        sticky: idMap.get(base.sticky) ?? null,
        sourceDesign: design.name ?? `added design ${designIndex + 1}`
      });
    });

    designSummaries.push({
      name: design.name ?? `added design ${designIndex + 1}`,
      bases: design.bases.length,
      format: design.diagnostics?.format ?? 'unknown'
    });
    cursorX += width + gap;
  });

  return {
    view: null,
    bases: mergedBases,
    diagnostics: {
      format: 'Multiple designs',
      importedBases: mergedBases.length,
      designCount: incoming.length + 1,
      appendedDesignCount: incoming.length,
      appendedBases: incoming.reduce((sum, design) => sum + design.bases.length, 0),
      designs: designSummaries,
      strands: countStrands(mergedBases),
      pairs: countPairs(mergedBases),
      sourceDiagnostics: incoming.map((design) => design.diagnostics).filter(Boolean)
    }
  };
}

function baseBounds(bases) {
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity }
  };
  bases.forEach((base) => {
    const p = vectorFrom(base.position);
    bounds.min.x = Math.min(bounds.min.x, p.x);
    bounds.min.y = Math.min(bounds.min.y, p.y);
    bounds.min.z = Math.min(bounds.min.z, p.z);
    bounds.max.x = Math.max(bounds.max.x, p.x);
    bounds.max.y = Math.max(bounds.max.y, p.y);
    bounds.max.z = Math.max(bounds.max.z, p.z);
  });
  ['x', 'y', 'z'].forEach((axis) => {
    if (!Number.isFinite(bounds.min[axis])) bounds.min[axis] = 0;
    if (!Number.isFinite(bounds.max[axis])) bounds.max[axis] = 0;
  });
  return bounds;
}

function countPairs(bases) {
  const byId = new Map(bases.map((base) => [base.id, base]));
  const seen = new Set();
  let pairs = 0;
  bases.forEach((base) => {
    if (base.across === null || !byId.has(base.across)) return;
    const a = Math.min(base.id, base.across);
    const b = Math.max(base.id, base.across);
    const key = `${a}:${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs += 1;
  });
  return pairs;
}

function countStrands(bases) {
  const byId = new Map(bases.map((base) => [base.id, base]));
  const visited = new Set();
  let strands = 0;
  const walk = (base) => {
    let current = base;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      current = current.down === null ? null : byId.get(current.down);
    }
  };
  bases.filter((base) => base.up === null).forEach((base) => {
    strands += 1;
    walk(base);
  });
  bases.forEach((base) => {
    if (visited.has(base.id)) return;
    strands += 1;
    walk(base);
  });
  return strands;
}

function parseOxViewProjectData(data) {
  const bases = [];
  const localIdToBaseId = new Map();
  const fallbackIdToBaseIds = new Map();
  let nextId = 0;
  let monomerCount = 0;
  let pairFieldCount = 0;
  let unresolvedPairCount = 0;

  (data.systems ?? []).forEach((system, systemIndex) => {
    (system.strands ?? []).forEach((strand, strandIndex) => {
      (strand.monomers ?? []).forEach((monomer) => {
        monomerCount += 1;
        if (!isNucleicAcidMonomer(monomer)) return;
        const id = nextId++;
        const systemId = system.id ?? systemIndex;
        const strandId = strand.id ?? strandIndex;
        const sourceId = Number(monomer.id);
        const key = oxViewKey(systemId, sourceId);
        localIdToBaseId.set(key, id);
        if (!fallbackIdToBaseIds.has(sourceId)) fallbackIdToBaseIds.set(sourceId, []);
        fallbackIdToBaseIds.get(sourceId).push(id);
        const color = oxViewColor(monomer.color);
        bases.push({
          id,
          sourceOxViewId: Number.isFinite(sourceId) ? sourceId : null,
          type: normalizeImportedType(monomer.type ?? 'X'),
          molecule: monomer.class === 'RNA' || monomer.type === 'U' ? 'RNA' : 'DNA',
          geometry: 'Free',
          position: arrayToPosition(monomer.p ?? [0, 0, 0]),
          up: null,
          down: null,
          across: null,
          slide: [],
          sticky: null,
          stickyID: 0,
          strand: Number(strandId) + 1,
          circular: false,
          top: false,
          preset: Boolean(monomer.type),
          temp: false,
          useStrandColor: Boolean(color),
          strandColor: color,
          constraints: {},
          oxView: {
            system: systemId,
            strand: strandId,
            a1: Array.isArray(monomer.a1) ? monomer.a1 : null,
            a3: Array.isArray(monomer.a3) ? monomer.a3 : null,
            cluster: monomer.cluster ?? null
          }
        });
      });
    });
  });

  const byId = new Map(bases.map((base) => [base.id, base]));
  (data.systems ?? []).forEach((system, systemIndex) => {
    const systemId = system.id ?? systemIndex;
    (system.strands ?? []).forEach((strand) => {
      (strand.monomers ?? []).forEach((monomer) => {
        const base = byId.get(resolveOxViewId(systemId, monomer.id, localIdToBaseId, fallbackIdToBaseIds));
        if (!base) return;
        base.up = resolveOxViewId(systemId, monomer.n5, localIdToBaseId, fallbackIdToBaseIds);
        base.down = resolveOxViewId(systemId, monomer.n3, localIdToBaseId, fallbackIdToBaseIds);
        const pairId = monomer.bp ?? monomer.pair;
        if (pairId !== undefined && pairId !== null) pairFieldCount += 1;
        base.across = resolveOxViewId(systemId, pairId, localIdToBaseId, fallbackIdToBaseIds);
        if (pairId !== undefined && pairId !== null && base.across === null) unresolvedPairCount += 1;
      });
    });
  });

  bases.forEach((base) => {
    if (base.up !== null && byId.get(base.up)?.down !== base.id) base.up = null;
    if (base.down !== null && byId.get(base.down)?.up !== base.id) base.down = null;
    if (base.across !== null && byId.get(base.across)?.across !== base.id) {
      const across = byId.get(base.across);
      if (across && across.across === null) across.across = base.id;
      else base.across = null;
    }
  });
  const scaleInfo = normalizeOxViewScale(bases, byId);
  const pairedBases = bases.filter((base) => base.across !== null).length;

  return {
    view: null,
    bases,
    diagnostics: {
      format: 'oxView',
      systems: data.systems?.length ?? 0,
      sourceMonomers: monomerCount,
      importedBases: bases.length,
      strands: (data.systems ?? []).reduce((sum, system) => sum + (system.strands?.length ?? 0), 0),
      pairFields: pairFieldCount,
      unresolvedPairs: unresolvedPairCount,
      pairedBases,
      pairs: pairedBases / 2,
      importScale: scaleInfo.scale,
      medianOriginalDownDistance: scaleInfo.medianDown,
      centeredAt: scaleInfo.center
    }
  };
}

export function parseSequenceText(text, options, model) {
  const before = model.bases.length;
  text.split(/\r?\n/).forEach((line) => {
    const sequence = cleanSequence(line.replace(/^\s*\d+c?:\s*/i, ''), options.molecule);
    if (sequence) model.createLine(sequence, options);
  });
  return model.bases.length - before;
}

export function parsePdb(text, model) {
  const residues = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((line) => {
    if (!line.startsWith('ATOM')) return;
    const residueKey = `${line.slice(21, 22)}:${line.slice(22, 26).trim()}`;
    if (seen.has(residueKey)) return;
    seen.add(residueKey);
    const residue = line.slice(17, 20).toUpperCase();
    const type = normalizeImportedType(residue.replace(/[^ATUGC]/g, '').slice(-1) || 'X');
    residues.push({
      type,
      molecule: residue.includes('R') || type === 'U' ? 'RNA' : 'DNA',
      chain: line.slice(21, 22),
      position: {
        x: Number(line.slice(30, 38)) / 10,
        y: Number(line.slice(38, 46)) / 10,
        z: Number(line.slice(46, 54)) / 10
      }
    });
  });
  model.commit('import pdb');
  model.bases = [];
  let previous = null;
  let chain = null;
  residues.forEach((residue) => {
    if (chain !== residue.chain) previous = null;
    chain = residue.chain;
    const base = model.createBase({
      type: normalizeBase(residue.type, residue.molecule),
      molecule: residue.molecule,
      position: residue.position,
      strand: previous?.strand ?? model.nextStrand()
    });
    model.linkDown(previous, base);
    previous = base;
  });
  model.assignStrands();
  model.updateGeometryMeasurements();
  model.select(model.bases[0]?.id ?? null);
  return model.bases.length;
}

export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function fullBaseRecord(base) {
  return {
    ...base,
    position: [base.position.x, base.position.y, base.position.z],
    type: BASES[base.type].name,
    typeCode: ['A', 'T', 'U', 'C', 'G', 'X'].indexOf(base.type),
    geometryCode: base.geometry === 'A' ? 0 : base.geometry === 'B' ? 1 : 2
  };
}

function typeCodeToBase(code) {
  return ['A', 'T', 'U', 'C', 'G', 'X'][Number(code)] ?? 'X';
}

function geometryCodeToName(code) {
  return ['A', 'B', 'Free'][Number(code)] ?? 'B';
}

function parseCadnanoV2ProjectData(data) {
  const helices = new Map((data.vstrands ?? []).map((helix) => [Number(helix.num), helix]));
  const numBases = data.vstrands?.[0]?.scaf?.length ?? 0;
  const grid = numBases % 21 === 0 ? 'honeycomb' : 'square';
  const helixRolls = cadnanoHelixRollMap(data.vstrands ?? [], grid);
  const bases = [];
  const keyToId = new Map();
  const rawCellByKey = new Map();
  const sourceCells = [];
  let nextId = 0;
  let skippedOffsets = 0;
  let insertionCount = 0;

  (data.vstrands ?? []).forEach((helix) => {
    const helixNum = Number(helix.num);
    for (let offset = 0; offset < numBases; offset += 1) {
      if (helix.skip?.[offset] === -1) skippedOffsets += 1;
      if (Number(helix.loop?.[offset] ?? 0) > 0) insertionCount += Number(helix.loop[offset]);
      ['scaf', 'stap'].forEach((kind) => {
        const entry = helix[kind]?.[offset];
        if (!cadnanoCellOccupied(entry)) return;
        rawCellByKey.set(cadnanoKey(kind, helixNum, offset), {
          kind,
          helixNum,
          offset,
          entry,
          skipped: helix.skip?.[offset] === -1
        });
        if (helix.skip?.[offset] === -1) return;
        const id = nextId++;
        keyToId.set(cadnanoKey(kind, helixNum, offset), id);
        sourceCells.push({ id, kind, helixNum, offset, entry });
        bases.push(cadnanoBaseRecord(id, kind, helix, offset, grid, helixRolls));
      });
    }
  });

  const byId = new Map(bases.map((base) => [base.id, base]));
  sourceCells.forEach(({ id, kind, entry }) => {
    const base = byId.get(id);
    if (!base) return;
    const [fiveHelix, fiveOffset, threeHelix, threeOffset] = entry.map(Number);
    base.up = resolveCadnanoNeighborId(kind, fiveHelix, fiveOffset, 'up', keyToId, rawCellByKey);
    base.down = resolveCadnanoNeighborId(kind, threeHelix, threeOffset, 'down', keyToId, rawCellByKey);
  });

  const stapleColorByFivePrime = cadnanoStapleColorMap(data.vstrands ?? []);
  const seen = new Set();
  bases.forEach((base) => {
    if (seen.has(base.id)) return;
    const strand = collectCadnanoStrand(base, byId);
    strand.forEach((item) => {
      seen.add(item.id);
      item.strand = base.strand;
    });
    if (base.sourceCadnano.kind === 'stap') {
      const fivePrime = strand.find((item) => item.up === null) ?? strand[0];
      const color = stapleColorByFivePrime.get(cadnanoKey('stap', fivePrime.sourceCadnano.helix, fivePrime.sourceCadnano.offset));
      if (color) strand.forEach((item) => {
        item.useStrandColor = true;
        item.strandColor = color;
      });
    }
  });

  bases.forEach((base) => {
    if (base.sourceCadnano.kind !== 'scaf') return;
    const stapId = keyToId.get(cadnanoKey('stap', base.sourceCadnano.helix, base.sourceCadnano.offset));
    if (stapId === undefined) return;
    base.across = stapId;
    const stap = byId.get(stapId);
    if (stap) stap.across = base.id;
  });

  centerImportedBases(bases);
  return {
    view: null,
    bases,
    diagnostics: {
      format: 'cadnano v2',
      name: data.name ?? '',
      helices: data.vstrands?.length ?? 0,
      importedBases: bases.length,
      strands: new Set(bases.map((base) => base.strand)).size,
      pairs: bases.filter((base) => base.across !== null).length / 2,
      grid,
      numBases,
      skippedOffsets,
      insertionCount
    }
  };
}

function cadnanoBaseRecord(id, kind, helix, offset, grid, helixRolls = new Map()) {
  return {
    id,
    type: 'X',
    molecule: 'DNA',
    geometry: 'B',
    position: cadnanoPosition(helix, offset, kind, grid, helixRolls.get(Number(helix.num)) ?? 0),
    up: null,
    down: null,
    across: null,
    slide: [],
    sticky: null,
    stickyID: 0,
    strand: id + 1,
    circular: false,
    top: false,
    preset: false,
    temp: false,
    useStrandColor: kind === 'scaf',
    strandColor: kind === 'scaf' ? '#0066cc' : null,
    constraints: {},
    sourceCadnano: {
      kind,
      helix: Number(helix.num),
      offset,
      row: Number(helix.row),
      col: Number(helix.col)
    }
  };
}

function cadnanoPosition(helix, offset, kind, grid, rollDeg = 0) {
  const col = Number(helix.col) || 0;
  const row = Number(helix.row) || 0;
  const center = cadnanoGridPosition(col, row, grid);
  const geometry = TIAMAT_GEOMETRY.B;
  const phase = THREE.MathUtils.degToRad(offset * geometry.twistDeg + rollDeg + (kind === 'stap' ? geometry.oppositeDeg : 0));
  const axialOffset = kind === 'stap'
    ? -(
      geometry.radius *
      2 *
      Math.sin(THREE.MathUtils.degToRad(geometry.oppositeDeg) / 2) *
      Math.tan(THREE.MathUtils.degToRad(geometry.inclinationDeg))
    )
    : 0;
  return {
    x: center.x + geometry.radius * Math.cos(phase),
    y: offset * geometry.rise + axialOffset,
    z: center.y + geometry.radius * Math.sin(phase)
  };
}

function cadnanoHelixRollMap(vstrands, grid) {
  const centers = new Map();
  vstrands.forEach((helix) => {
    centers.set(Number(helix.num), cadnanoGridPosition(Number(helix.col) || 0, Number(helix.row) || 0, grid));
  });

  const geometry = TIAMAT_GEOMETRY.B;
  const constraints = new Map();
  const addConstraint = (helixNum, offset, kind, desiredAngleDeg) => {
    if (!centers.has(Number(helixNum))) return;
    const kindPhase = kind === 'stap' ? geometry.oppositeDeg : 0;
    const roll = normalizeDegrees(desiredAngleDeg - offset * geometry.twistDeg - kindPhase);
    if (!constraints.has(Number(helixNum))) constraints.set(Number(helixNum), []);
    constraints.get(Number(helixNum)).push(roll);
  };

  vstrands.forEach((helix) => {
    const helixNum = Number(helix.num);
    const center = centers.get(helixNum);
    if (!center) return;
    ['scaf', 'stap'].forEach((kind) => {
      (helix[kind] ?? []).forEach((entry, offset) => {
        if (!cadnanoCellOccupied(entry)) return;
        const [, , threeHelixRaw, threeOffsetRaw] = entry.map(Number);
        const threeHelix = Number(threeHelixRaw);
        const threeOffset = Number(threeOffsetRaw);
        if (!centers.has(threeHelix)) return;
        if (threeHelix === helixNum && Math.abs(threeOffset - offset) === 1) return;
        const target = centers.get(threeHelix);
        const toTarget = cadnanoAngleDeg(target.x - center.x, target.y - center.y);
        const toSource = cadnanoAngleDeg(center.x - target.x, center.y - target.y);
        addConstraint(helixNum, offset, kind, toTarget);
        addConstraint(threeHelix, threeOffset, kind, toSource);
      });
    });
  });

  return new Map(vstrands.map((helix) => {
    const helixNum = Number(helix.num);
    return [helixNum, circularMeanDegrees(constraints.get(helixNum) ?? [0])];
  }));
}

function cadnanoGridPosition(col, row, grid) {
  if (grid === 'honeycomb') {
    return {
      x: col * Math.sqrt(3) * 0.5 * CADNANO_HELIX_SPACING,
      y: (col % 2 === 0
        ? (row * 3 + (row % 2)) * 0.5
        : (row * 3 - (row % 2) + 1) * 0.5) * CADNANO_HELIX_SPACING
    };
  }
  return {
    x: col * CADNANO_HELIX_SPACING,
    y: row * CADNANO_HELIX_SPACING
  };
}

function cadnanoCellOccupied(entry) {
  return Array.isArray(entry) && entry.length >= 4 && entry.some((value) => Number(value) !== -1);
}

function cadnanoKey(kind, helix, offset) {
  return `${kind}:${Number(helix)}:${Number(offset)}`;
}

function resolveCadnanoNeighborId(kind, helix, offset, direction, keyToId, rawCellByKey) {
  let currentHelix = Number(helix);
  let currentOffset = Number(offset);
  const seen = new Set();
  while (Number.isFinite(currentHelix) && Number.isFinite(currentOffset) && currentHelix !== -1 && currentOffset !== -1) {
    const key = cadnanoKey(kind, currentHelix, currentOffset);
    const id = keyToId.get(key);
    if (id !== undefined) return id;
    const raw = rawCellByKey.get(key);
    if (!raw || seen.has(key)) return null;
    seen.add(key);
    const next = direction === 'up'
      ? [Number(raw.entry[0]), Number(raw.entry[1])]
      : [Number(raw.entry[2]), Number(raw.entry[3])];
    currentHelix = next[0];
    currentOffset = next[1];
  }
  return null;
}

function cadnanoStapleColorMap(vstrands) {
  const colors = new Map();
  vstrands.forEach((helix) => {
    const helixNum = Number(helix.num);
    (helix.stap_colors ?? []).forEach(([offset, color]) => {
      colors.set(cadnanoKey('stap', helixNum, offset), cadnanoColor(color));
    });
  });
  return colors;
}

function cadnanoColor(value) {
  const color = Number(value);
  if (!Number.isFinite(color)) return null;
  return `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, '0')}`;
}

function cadnanoAngleDeg(x, y) {
  return normalizeDegrees(THREE.MathUtils.radToDeg(Math.atan2(y, x)));
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function circularMeanDegrees(values) {
  if (!values.length) return 0;
  let x = 0;
  let y = 0;
  values.forEach((value) => {
    const radians = THREE.MathUtils.degToRad(value);
    x += Math.cos(radians);
    y += Math.sin(radians);
  });
  if (Math.abs(x) < 0.000001 && Math.abs(y) < 0.000001) return normalizeDegrees(values[0]);
  return normalizeDegrees(THREE.MathUtils.radToDeg(Math.atan2(y, x)));
}

function collectCadnanoStrand(base, byId) {
  let start = base;
  const visitedUp = new Set();
  while (start.up !== null && !visitedUp.has(start.up)) {
    visitedUp.add(start.id);
    const up = byId.get(start.up);
    if (!up) break;
    start = up;
  }
  const strand = [];
  const visitedDown = new Set();
  let current = start;
  while (current && !visitedDown.has(current.id)) {
    strand.push(current);
    visitedDown.add(current.id);
    current = byId.get(current.down);
  }
  if (current && current.id === start.id) strand.forEach((item) => {
    item.circular = true;
  });
  return strand;
}

function centerImportedBases(bases) {
  if (!bases.length) return;
  const center = bases
    .reduce((sum, base) => sum.add(vectorFrom(base.position)), new THREE.Vector3())
    .multiplyScalar(1 / bases.length);
  bases.forEach((base) => {
    const p = vectorFrom(base.position).sub(center);
    base.position = { x: p.x, y: p.y, z: p.z };
  });
}

function isNucleicAcidMonomer(monomer) {
  return monomer?.class === 'DNA'
    || monomer?.class === 'RNA'
    || ['A', 'T', 'U', 'G', 'C'].includes(String(monomer?.type ?? '').toUpperCase());
}

function oxViewKey(systemId, monomerId) {
  return `${systemId}:${Number(monomerId)}`;
}

function resolveOxViewId(systemId, monomerId, localIdToBaseId, fallbackIdToBaseIds) {
  if (monomerId === null || monomerId === undefined) return null;
  const numericId = Number(monomerId);
  const local = localIdToBaseId.get(oxViewKey(systemId, numericId));
  if (local !== undefined) return local;
  const fallback = fallbackIdToBaseIds.get(numericId);
  return fallback?.length === 1 ? fallback[0] : null;
}

function oxViewColor(value) {
  if (value === null || value === undefined) return null;
  const color = Number(value);
  if (!Number.isFinite(color)) return null;
  return `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, '0')}`;
}

function normalizeOxViewScale(bases, byId) {
  if (!bases.length) return { scale: 1, medianDown: 0, center: [0, 0, 0] };
  const downDistances = bases
    .map((base) => {
      const down = byId.get(base.down);
      if (!down) return null;
      return vectorFrom(base.position).distanceTo(vectorFrom(down.position));
    })
    .filter((value) => Number.isFinite(value) && value > 0.0001 && value < 3)
    .sort((a, b) => a - b);
  const medianDown = downDistances[Math.floor(downDistances.length / 2)] ?? 0;
  const scale = medianDown > 0 ? DOWN_DISTANCE / medianDown : 1;
  const center = bases
    .reduce((sum, base) => sum.add(vectorFrom(base.position)), new THREE.Vector3())
    .multiplyScalar(1 / bases.length);
  bases.forEach((base) => {
    const p = vectorFrom(base.position).sub(center).multiplyScalar(scale);
    base.position = { x: p.x, y: p.y, z: p.z };
    const a1 = vectorFrom(base.oxView?.a1);
    const a3 = vectorFrom(base.oxView?.a3);
    base.oxView = {
      ...(base.oxView ?? {}),
      a1: a1.lengthSq() > 0 ? a1.normalize().toArray() : null,
      a3: a3.lengthSq() > 0 ? a3.normalize().toArray() : null,
      importScale: scale,
      importCenter: [center.x, center.y, center.z],
      medianDownDistance: medianDown
    };
  });
  return {
    scale,
    medianDown,
    center: [center.x, center.y, center.z]
  };
}
