import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { TiamatModel } from '../src/model.js';
import { DOWN_DISTANCE, TIAMAT_GEOMETRY } from '../src/constants.js';
import { vectorFrom } from '../src/geometry.js';
import { appendImportedDesigns, dnaJson, fullProjectJson, mergeImportedDesigns, oxDnaText, oxViewJson, parseOxDnaTopConf, parseDnaFile, parseJsonProject, parseOxViewProject } from '../src/io.js';
import { ScreenSelectionIndex } from '../src/selection-index.js';
import { isSchematicRunNeighbor } from '../src/scene.js';

const OXVIEW_FIXTURE = '/Users/m.matthies/Data/Dietz_Designs/oxview/42hb_v40_polyT.oxview';
const DEFAULT_TETRAHEDRON = './public/defaults/tetrahedron.dna';
const TIAMAT_DNA_FIXTURES = [
  {
    path: '/Users/m.matthies/Downloads/7z2600-mac/Tiamat design/Figure 4/[PT]_Cairo_p7249_core+edge.dna',
    bases: 14267,
    strands: 209,
    pairs: 6788
  },
  {
    path: '/Users/m.matthies/Downloads/7z2600-mac/Tiamat design/Figure 4/[PT]_Floret_p8064_tile.dna',
    bases: 15831,
    strands: 260,
    pairs: 7556
  },
  {
    path: '/Users/m.matthies/Downloads/7z2600-mac/Tiamat design/Figure 4/[PT]_Prism_p7249_tile.dna',
    bases: 14188,
    strands: 236,
    pairs: 6730
  },
  {
    path: '/Users/m.matthies/Downloads/7z2600-mac/Tiamat design/Figure 4/[RH]_p7249_tile.dna',
    bases: 14101,
    strands: 213,
    pairs: 6656
  }
];
const TIAMAT_SCHEMA5_FIXTURES = [
  {
    path: '/Users/m.matthies/Downloads/4hb_8crossovers_less_withhandle_dev_1stickyend_0stickyend_updated_used.dna',
    bases: 1552,
    strands: 2,
    pairs: 716
  },
  {
    path: '/Users/m.matthies/Downloads/4hb_8crossovers_endconnection_lesspx_for_triangle_shorter_1d5k_used.dna',
    bases: 1332,
    strands: 1,
    pairs: 612
  },
  {
    path: '/Users/m.matthies/Downloads/layeredxovers_DPOWDPOW_symmetricsinglebinding.dna',
    bases: 520,
    strands: 1,
    pairs: 224
  },
  {
    path: '/Users/m.matthies/Downloads/short_1_strand_ChengdeMao_nanoscale_M2_customizeddesign.dna',
    bases: 1104,
    strands: 20,
    pairs: 486
  }
];
const TIAMAT_REPLACEMENT_FIXTURES = [
  {
    path: '/Users/m.matthies/Downloads/45 degree with sequences.dna',
    bases: 256
  },
  {
    path: '/Users/m.matthies/Downloads/45 degree with sequences (1).dna',
    bases: 256
  }
];
const TIAMAT_LEGACY_TEXT_FIXTURES = [
  {
    path: '/Users/m.matthies/Downloads/ssRNA_6.3k_Science_broken.dna',
    bases: 6144
  },
  {
    path: '/Users/m.matthies/Data/TPlay/uploads/34/structure/ssRNA_6.3k_Science.dna',
    bases: 6144
  }
];
const TIAMAT_CLEAN_SSRNA_FIXTURE = {
  path: '/Users/m.matthies/Downloads/ssRNA_6.3k_Science.dna',
  bases: 6320,
  strands: 1,
  pairs: 3056
};
const TIAMAT_BROKEN_SSRNA_FIXTURE = '/Users/m.matthies/Downloads/ssRNA_6.3k_Science_broken.dna';
const tests = [];

test('createHelix creates paired duplex with Tiamat graph links', () => {
  const model = new TiamatModel();
  const made = model.createHelix('ATGC', {
    molecule: 'DNA',
    geometry: 'B',
    radius: 1,
    rise: 0.332,
    twist: -34.28571,
    double: true
  });
  assert.equal(made, 4);
  assert.equal(model.bases.length, 8);
  assert.equal(model.strands().length, 2);
  assert.equal(model.bases.filter((base) => base.across !== null).length / 2, 4);
  assert.equal(model.getBase(model.bases[0].down).up, model.bases[0].id);
});

test('full project JSON roundtrips graph fields', () => {
  const model = new TiamatModel();
  model.createLine('ATGC', { molecule: 'DNA', geometry: 'B' });
  const data = parseJsonProject(fullProjectJson(model));
  const loaded = new TiamatModel();
  loaded.loadBases(data.bases);
  assert.equal(loaded.bases.length, 4);
  assert.equal(loaded.strands().length, 1);
  assert.equal(loaded.getBase(0).down, 1);
  assert.equal(loaded.getBase(1).up, 0);
});

test('DNA JSON export imports through native graph fields', () => {
  const model = new TiamatModel();
  model.createHelix('ATGC', {
    molecule: 'DNA',
    geometry: 'B',
    radius: 1,
    rise: 0.332,
    twist: -34.28571,
    double: true
  });
  const data = parseJsonProject(dnaJson(model));
  const loaded = new TiamatModel();
  loaded.loadBases(data.bases);
  assert.equal(data.diagnostics.format, 'DNA JSON');
  assert.equal(loaded.bases.length, model.bases.length);
  assert.equal(loaded.strands().length, 2);
  assert.equal(loaded.bases.filter((base) => base.across !== null).length / 2, 4);
  assert.equal(loaded.getBase(0).type, 'A');
});

test('multiple imported designs remap links and arrange side by side', () => {
  const first = [
    { id: 10, type: 'A', molecule: 'DNA', geometry: 'B', position: { x: 0, y: 0, z: 0 }, up: null, down: 20, across: null, slide: [], sticky: null, stickyID: 0, strand: 1, circular: false, top: true, preset: true, temp: false, useStrandColor: false, strandColor: null, constraints: {} },
    { id: 20, type: 'T', molecule: 'DNA', geometry: 'B', position: { x: 1, y: 0, z: 0 }, up: 10, down: null, across: null, slide: [], sticky: null, stickyID: 0, strand: 1, circular: false, top: false, preset: true, temp: false, useStrandColor: false, strandColor: null, constraints: {} }
  ];
  const second = [
    { id: 0, type: 'G', molecule: 'DNA', geometry: 'B', position: { x: 0, y: 0, z: 0 }, up: null, down: 1, across: 2, slide: [], sticky: null, stickyID: 0, strand: 1, circular: false, top: true, preset: true, temp: false, useStrandColor: false, strandColor: null, constraints: {} },
    { id: 1, type: 'C', molecule: 'DNA', geometry: 'B', position: { x: 1, y: 0, z: 0 }, up: 0, down: null, across: null, slide: [], sticky: null, stickyID: 0, strand: 1, circular: false, top: false, preset: true, temp: false, useStrandColor: false, strandColor: null, constraints: {} },
    { id: 2, type: 'C', molecule: 'DNA', geometry: 'B', position: { x: 0, y: 1, z: 0 }, up: null, down: null, across: 0, slide: [], sticky: null, stickyID: 0, strand: 2, circular: false, top: true, preset: true, temp: false, useStrandColor: false, strandColor: null, constraints: {} }
  ];
  const data = mergeImportedDesigns([
    { name: 'first.dna', bases: first, diagnostics: { format: 'Tiamat .dna (MFC object graph)' } },
    { name: 'second.dna', bases: second, diagnostics: { format: 'Tiamat .dna (MFC object graph)' } }
  ], { gap: 5 });

  assert.equal(data.diagnostics.format, 'Multiple designs');
  assert.equal(data.diagnostics.designCount, 2);
  assert.equal(data.bases.length, 5);
  assert.deepEqual(data.bases.map((base) => base.id), [0, 1, 2, 3, 4]);
  assert.equal(data.bases[0].down, 1);
  assert.equal(data.bases[1].up, 0);
  assert.equal(data.bases[2].down, 3);
  assert.equal(data.bases[2].across, 4);
  assert.equal(data.bases[4].across, 2);
  assert.ok(Math.min(...data.bases.slice(2).map((base) => base.position.x)) > Math.max(...data.bases.slice(0, 2).map((base) => base.position.x)));
});

test('appending imported designs preserves current coordinates and remaps added links', () => {
  const current = [
    { id: 5, type: 'A', molecule: 'DNA', geometry: 'B', position: { x: -2, y: 3, z: 1 }, up: null, down: null, across: null, slide: [], sticky: null, stickyID: 0, strand: 1, circular: false, top: true, preset: true, temp: false, useStrandColor: false, strandColor: null, constraints: {} }
  ];
  const incoming = [
    { id: 0, type: 'G', molecule: 'DNA', geometry: 'B', position: { x: 0, y: 0, z: 0 }, up: null, down: 1, across: null, slide: [], sticky: null, stickyID: 0, strand: 1, circular: false, top: true, preset: true, temp: false, useStrandColor: false, strandColor: null, constraints: {} },
    { id: 1, type: 'C', molecule: 'DNA', geometry: 'B', position: { x: 1, y: 0, z: 0 }, up: 0, down: null, across: null, slide: [], sticky: null, stickyID: 0, strand: 1, circular: false, top: false, preset: true, temp: false, useStrandColor: false, strandColor: null, constraints: {} }
  ];
  const data = appendImportedDesigns(current, [{ name: 'added.dna', bases: incoming }], { gap: 6 });

  assert.equal(data.bases.length, 3);
  assert.deepEqual(data.bases[0].position, current[0].position);
  assert.equal(data.bases[1].id, 6);
  assert.equal(data.bases[2].id, 7);
  assert.equal(data.bases[1].down, 7);
  assert.equal(data.bases[2].up, 6);
  assert.ok(data.bases[1].position.x > current[0].position.x + 5);
  assert.equal(data.diagnostics.appendedDesignCount, 1);
  assert.equal(data.diagnostics.appendedBases, 2);
});

test('selection modes select expected graph neighborhoods', () => {
  const model = new TiamatModel();
  model.createHelix('ATGC', {
    molecule: 'DNA',
    geometry: 'B',
    radius: 1,
    rise: 0.332,
    twist: -34.28571,
    double: true
  });
  model.selectPair(0);
  assert.equal(model.selectedIds.size, 2);
  model.selectStrand(0);
  assert.equal(model.selectedIds.size, 4);
  model.selectHelix(0);
  assert.equal(model.selectedIds.size, 8);
  model.applySelectionIds([0, 1], 'replace');
  assert.deepEqual([...model.selectedIds].sort((a, b) => a - b), [0, 1]);
  model.applySelectionIds([2], 'add');
  assert.deepEqual([...model.selectedIds].sort((a, b) => a - b), [0, 1, 2]);
  model.applySelectionIds([1], 'subtract');
  assert.deepEqual([...model.selectedIds].sort((a, b) => a - b), [0, 2]);
});

test('constraint measurements include inclination and violation flags', () => {
  const model = new TiamatModel();
  model.createHelix('ATGC', {
    molecule: 'DNA',
    geometry: 'B',
    radius: 1,
    rise: 0.332,
    twist: -34.28571,
    double: true
  });
  const base = model.getBase(2);
  assert.equal(base.constraints.hasInclination, true);
  assert.equal(typeof base.constraints.violations.rise, 'boolean');
  model.getBase(base.down).position.x += 10;
  model.updateGeometryMeasurements();
  assert.equal(model.getBase(2).constraints.violations.rise, true);
});

test('create strand between points uses A/B defaults and graph links', () => {
  const model = new TiamatModel();
  const count = model.createStrandBetween({ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, 'AUGCAU', {
    molecule: 'RNA',
    geometry: 'A',
    double: true
  });
  assert.equal(count, Math.ceil(2 / 0.29));
  assert.equal(model.bases[0].molecule, 'RNA');
  assert.equal(model.bases[0].geometry, 'A');
  assert.ok(model.bases.some((base) => base.across !== null));
  assert.equal(model.getBase(model.bases[0].down).up, model.bases[0].id);
});

test('create strand honors dialog-style count, initial mode, orientation, and molecule pairing', () => {
  const model = new TiamatModel();
  const count = model.createStrandBetween({ x: 0, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }, 'AAAAAA', {
    molecule: 'DNA',
    pairedMolecule: 'RNA',
    geometry: 'A',
    double: true,
    baseCount: 3,
    initialMode: 'blank',
    orientation: 'reverse'
  });
  assert.equal(count, 3);
  assert.equal(model.bases.filter((base) => base.strand === 1).length, 3);
  assert.equal(model.bases.filter((base) => base.strand === 2).length, 3);
  assert.ok(model.bases.every((base) => base.type === 'X'));
  assert.equal(model.getBase(1).molecule, 'RNA');
  assert.ok(model.getBase(0).position.y > model.getBase(2).position.y);
});

test('selected strand sequence can be read and applied without touching complements', () => {
  const model = new TiamatModel();
  model.createHelix('AAAA', {
    molecule: 'DNA',
    geometry: 'B',
    radius: 1,
    rise: 0.332,
    twist: -34.28571,
    double: true
  });
  const selectedSequence = model.selectedStrandSequence();
  assert.equal(selectedSequence, 'AAAA');
  const paired = model.getBase(model.bases[0].across);
  assert.equal(paired.type, 'T');
  const result = model.setSelectedStrandSequence('CG', { complementPairs: false });
  assert.equal(result.length, 4);
  assert.equal(model.selectedStrandSequence(), 'CGCG');
  assert.equal(paired.type, 'T');
  model.setSelectedStrandSequence('AT', { complementPairs: true });
  assert.equal(model.selectedStrandSequence(), 'ATAT');
  assert.equal(paired.type, 'T');
  assert.equal(model.getBase(model.bases[2].across).type, 'A');
});

test('base identity changes complement only when requested', () => {
  const model = new TiamatModel();
  model.createHelix('A', {
    molecule: 'DNA',
    geometry: 'B',
    radius: 1,
    rise: 0.332,
    twist: -34.28571,
    double: true
  });
  const paired = model.getBase(model.bases[0].across);
  assert.equal(paired.type, 'T');
  model.changeSelectedType('G');
  assert.equal(model.bases[0].type, 'G');
  assert.equal(paired.type, 'T');
  model.changeSelectedType('C', { complementPairs: true });
  assert.equal(model.bases[0].type, 'C');
  assert.equal(paired.type, 'G');
});

test('Tiamat-style sequence design fills generic bases and preserves complements', () => {
  const model = new TiamatModel();
  model.createHelix('XXXXXXXX', {
    molecule: 'DNA',
    geometry: 'B',
    radius: 1,
    rise: 0.332,
    twist: -34.28571,
    double: true
  });
  const result = model.designSequence({
    sequenceLimit: 4,
    repeatLimit: 3,
    gRepeatLimit: 3,
    gcTarget: 0.5,
    timeout: 2,
    preserveExisting: true
  });
  assert.equal(result.editable, 16);
  assert.equal(model.bases.some((base) => base.type === 'X'), false);
  model.bases.forEach((base) => {
    const across = model.getBase(base.across);
    if (across) assert.equal(across.type, base.type === 'A' ? 'T' : base.type === 'T' ? 'A' : base.type === 'C' ? 'G' : 'C');
  });
});

test('sequence design can preserve preset bases while filling only generic bases', () => {
  const model = new TiamatModel();
  model.createLine('AXXG', { molecule: 'DNA', geometry: 'B' });
  const result = model.designSequence({
    preserveExisting: true,
    useSequenceLimit: false,
    useRepeatLimit: false,
    useGRepeatLimit: false
  });
  assert.equal(result.editable, 2);
  assert.equal(model.bases[0].type, 'A');
  assert.equal(model.bases[3].type, 'G');
  assert.equal(model.bases.slice(1, 3).some((base) => base.type === 'X'), false);
});

test('freeform creation samples control points and attaches endpoints', () => {
  const model = new TiamatModel();
  const start = model.createBase({ type: 'A', position: { x: 0, y: 0, z: 0 }, strand: 1 });
  const end = model.createBase({ type: 'T', position: { x: 0, y: 2.7, z: 0 }, strand: 2 });
  const made = model.createFreeform([
    start.position,
    { x: 0.6, y: 1.2, z: 0 },
    end.position
  ], { molecule: 'DNA', geometry: 'B', startBaseId: start.id, endBaseId: end.id });
  assert.ok(made > 0);
  assert.notEqual(start.down, null);
  assert.equal(model.getBase(end.up).down, end.id);
});

test('paste preserves copied coordinates and strips links outside copied set', () => {
  const model = new TiamatModel();
  model.createLine('ATGC', { molecule: 'DNA', geometry: 'B' });
  model.selectIds([1, 2]);
  const originalPosition = { ...model.getBase(1).position };
  model.copySelected();
  assert.equal(model.pasteClipboard(), 2);
  const pasted = model.selectedBases().sort((a, b) => a.id - b.id);
  assert.equal(pasted.length, 2);
  assert.deepEqual(pasted[0].position, originalPosition);
  assert.equal(pasted[0].up, null);
  assert.equal(pasted[0].down, pasted[1].id);
  assert.equal(pasted[1].up, pasted[0].id);
  assert.equal(pasted[1].down, null);
});

test('ligation joins compatible 3 and 5 prime ends regardless of distance', () => {
  const model = new TiamatModel();
  const a = model.createBase({ type: 'A', position: { x: 0, y: 0, z: 0 }, strand: 1 });
  const b = model.createBase({ type: 'T', position: { x: 14, y: -2, z: 6 }, strand: 2 });
  model.selectIds([a.id, b.id]);
  assert.equal(model.ligateSelected(), true);
  assert.equal(a.down, b.id);
  assert.equal(b.up, a.id);
  model.select(a.id);
  assert.equal(model.nickSelected(), true);
  assert.equal(a.down, null);
  assert.equal(b.up, null);
});

test('oxView fixture imports with Tiamat scale and base pairs', () => {
  if (!existsSync(OXVIEW_FIXTURE)) return 'skipped: fixture not found';
  const data = parseOxViewProject(readFileSync(OXVIEW_FIXTURE, 'utf8'));
  const model = new TiamatModel();
  model.loadBases(data.bases);
  assert.equal(model.bases.length, 15895);
  assert.equal(model.strands().length, 206);
  assert.equal(model.bases.filter((base) => base.across !== null).length / 2, 7494);
  assert.equal(data.diagnostics.unresolvedPairs, 0);

  const downDistances = model.bases
    .map((base) => {
      const down = model.getBase(base.down);
      return down ? vectorFrom(base.position).distanceTo(vectorFrom(down.position)) : null;
    })
    .filter((value) => value !== null && value < 3)
    .sort((a, b) => a - b);
  const medianDown = downDistances[Math.floor(downDistances.length / 2)];
  assert.ok(Math.abs(medianDown - DOWN_DISTANCE) < 0.000001, `median down ${medianDown}`);
});

test('oxView parser accepts both pair and bp fields', () => {
  const oxview = JSON.stringify({
    systems: [{
      id: 0,
      strands: [
        { id: 0, monomers: [{ id: 0, type: 'A', class: 'DNA', p: [0, 0, 0], n5: 1, pair: 2 }, { id: 1, type: 'T', class: 'DNA', p: [0, 0.5, 0], n3: 0, bp: 3 }] },
        { id: 1, monomers: [{ id: 2, type: 'T', class: 'DNA', p: [1, 0, 0], n5: 3, pair: 0 }, { id: 3, type: 'A', class: 'DNA', p: [1, 0.5, 0], n3: 2, bp: 1 }] }
      ]
    }]
  });
  const data = parseOxViewProject(oxview);
  const model = new TiamatModel();
  model.loadBases(data.bases);
  assert.equal(model.bases.filter((base) => base.across !== null).length / 2, 2);
});

test('oxView export is generated from DNA JSON fields and oxView nucleoside transform', () => {
  const model = new TiamatModel();
  model.createHelix('ATGC', {
    molecule: 'DNA',
    geometry: 'B',
    radius: 1,
    rise: 0.332,
    twist: -34.28571,
    double: true
  });
  model.bases.forEach((base) => {
    base.oxView = {
      a1: [1, 0, 0],
      a3: [0, 0, 1],
      importScale: 1,
      importCenter: [999, 999, 999]
    };
  });
  const oxview = JSON.parse(oxViewJson(model));
  assert.equal(oxview.systems[0].strands.length, 2);
  const first = oxview.systems[0].strands[0].monomers[0];
  const second = oxview.systems[0].strands[0].monomers[1];
  const a1 = new THREE.Vector3(...first.a1);
  const a3 = new THREE.Vector3(...first.a3);
  const exportedBackbone = oxViewBackboneSite(first);
  const expectedBackboneDistance = positionVector(model.bases[0].position)
    .distanceTo(positionVector(model.bases[2].position)) / 0.8518;
  const pairCenter = positionVector(model.bases[0].position)
    .add(positionVector(model.bases[1].position))
    .multiplyScalar(0.5 / 0.8518);
  const nextPairCenter = positionVector(model.bases[2].position)
    .add(positionVector(model.bases[3].position))
    .multiplyScalar(0.5 / 0.8518);
  assert.ok(new THREE.Vector3(...first.p).length() < 5);
  assert.ok(Math.abs(a1.dot(a3)) < 0.00001);
  assert.ok(Math.abs(exportedBackbone.distanceTo(oxViewBackboneSite(second)) - expectedBackboneDistance) < 0.00001);
  assert.ok(a3.dot(nextPairCenter.sub(pairCenter).normalize()) > 0.98);
  const paired = oxview.systems[0].strands.flatMap((strand) => strand.monomers).find((monomer) => monomer.id === first.bp);
  const pairedBackbone = oxViewBackboneSite(paired);
  const interfaceDirection = pairedBackbone.clone().sub(exportedBackbone);
  interfaceDirection.sub(a3.clone().multiplyScalar(interfaceDirection.dot(a3))).normalize();
  assert.ok(a1.dot(interfaceDirection) > 0.98);
  assert.ok(oxViewBackboneSite(first).distanceTo(exportedBackbone) < 0.000001);
  assert.ok(oxViewNucleosideSite(first).distanceTo(oxViewNucleosideSite(paired)) < exportedBackbone.distanceTo(pairedBackbone));
  assert.equal(paired.bp, first.id);
  assert.equal(first.cluster, 0);
  assert.equal(typeof first.color, 'number');
});

function oxViewNucleosideSite(monomer) {
  return new THREE.Vector3(...monomer.p).add(new THREE.Vector3(...monomer.a1).multiplyScalar(0.34));
}

function oxViewBackboneSite(monomer) {
  const p = new THREE.Vector3(...monomer.p);
  const a1 = new THREE.Vector3(...monomer.a1);
  const a3 = new THREE.Vector3(...monomer.a3);
  const a2 = a1.clone().cross(a3).multiplyScalar(-1).normalize();
  return p
    .add(a1.multiplyScalar(-0.34))
    .add(a2.multiplyScalar(0.3408));
}

function positionVector(position) {
  return new THREE.Vector3(position.x, position.y, position.z);
}

test('oxDNA topology import/export preserves 3 and 5 neighbor directions', () => {
  const top = [
    '2 1',
    '1 A -1 1',
    '1 T 0 -1'
  ].join('\n');
  const conf = [
    't = 0',
    'b = 10 10 10',
    'E = 0 0 0',
    '0 0 0 1 0 0 0 1 0 0 0 0 0 0 0',
    '0 0 1 1 0 0 0 1 0 0 0 0 0 0 0'
  ].join('\n');
  const parsed = parseOxDnaTopConf(top, conf);
  assert.equal(parsed.bases[0].up, 1);
  assert.equal(parsed.bases[0].down, null);
  assert.equal(parsed.bases[1].up, null);
  assert.equal(parsed.bases[1].down, 0);

  const model = new TiamatModel();
  model.loadBases(parsed.bases);
  const exported = oxDnaText(model);
  assert.ok(exported.includes('1 A -1 1'));
  assert.ok(exported.includes('1 T 0 -1'));
});

test('raw Tiamat .dna fixtures import through MFC object graph with strand colors', () => {
  const available = TIAMAT_DNA_FIXTURES.filter((fixture) => existsSync(fixture.path));
  if (!available.length) return 'skipped: fixtures not found';
  available.forEach((fixture) => {
    const buffer = readFileSync(fixture.path);
    const data = parseDnaFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    assert.equal(data.diagnostics.recovery, 'raw binary');
    assert.equal(data.diagnostics.format, 'Tiamat .dna (MFC object graph)');
    assert.equal(data.diagnostics.schema, 3);
    assert.equal(data.bases.length, fixture.bases);
    assert.equal(data.diagnostics.expectedBases, fixture.bases);
    assert.equal(data.diagnostics.strands, fixture.strands);
    assert.equal(data.diagnostics.pairs, fixture.pairs);
    assert.deepEqual([...new Set(data.bases.filter((base) => base.useStrandColor).map((base) => base.strandColor))].sort(), [
      '#27aae1',
      '#bcbec0',
      '#f7941d'
    ]);
    assert.equal(data.bases.filter((base) => base.useStrandColor).length, fixture.bases);
  });
});

test('bundled tetrahedron startup scene parses as a valid Tiamat design', () => {
  if (!existsSync(DEFAULT_TETRAHEDRON)) return 'skipped: startup fixture not found';
  const buffer = readFileSync(DEFAULT_TETRAHEDRON);
  const data = parseDnaFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  assert.ok(data.bases.length > 0);
  assert.ok(data.diagnostics.importedBases > 0);
  assert.equal(data.diagnostics.format.startsWith('Tiamat .dna'), true);
});

test('schema 5 Tiamat .dna fixtures import RNA-aware object graph without strand-color regressions', () => {
  const available = TIAMAT_SCHEMA5_FIXTURES.filter((fixture) => existsSync(fixture.path));
  if (!available.length) return 'skipped: schema 5 fixtures not found';
  available.forEach((fixture) => {
    const buffer = readFileSync(fixture.path);
    const data = parseDnaFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    assert.equal(data.diagnostics.recovery, 'raw binary');
    assert.equal(data.diagnostics.schema, 5);
    assert.equal(data.bases.length, fixture.bases);
    assert.equal(data.diagnostics.strands, fixture.strands);
    assert.equal(data.diagnostics.pairs, fixture.pairs);
    assert.equal(data.bases.filter((base) => base.molecule === 'RNA').length, 0);
  });
});

test('legacy text-transformed Tiamat .dna files import with repaired coordinates', () => {
  const available = [
    ...TIAMAT_REPLACEMENT_FIXTURES,
    ...TIAMAT_LEGACY_TEXT_FIXTURES
  ].filter((fixture) => existsSync(fixture.path));
  if (!available.length) return 'skipped: legacy text fixtures not found';
  available.forEach((fixture) => {
    const buffer = readFileSync(fixture.path);
    const data = parseDnaFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    assert.equal(data.diagnostics.corrupted, true);
    assert.equal(data.diagnostics.coordinateLayoutRebuilt, true);
    assert.equal(data.bases.length, fixture.bases);
    assert.equal(data.diagnostics.expectedBases, fixture.bases);
    assert.ok(data.diagnostics.replacementSequences > 0);
    assert.ok(data.bases.some((base) => Math.hypot(base.position.x, base.position.y, base.position.z) > 0.1));
  });
});

test('clean ssRNA Tiamat .dna imports as raw binary with original coordinates', () => {
  if (!existsSync(TIAMAT_CLEAN_SSRNA_FIXTURE.path)) return 'skipped: clean ssRNA fixture not found';
  const buffer = readFileSync(TIAMAT_CLEAN_SSRNA_FIXTURE.path);
  const data = parseDnaFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  assert.equal(data.diagnostics.recovery, 'raw binary');
  assert.equal(data.diagnostics.corrupted, false);
  assert.equal(data.diagnostics.schema, 3);
  assert.equal(data.bases.length, TIAMAT_CLEAN_SSRNA_FIXTURE.bases);
  assert.equal(data.diagnostics.strands, TIAMAT_CLEAN_SSRNA_FIXTURE.strands);
  assert.equal(data.diagnostics.pairs, TIAMAT_CLEAN_SSRNA_FIXTURE.pairs);
  assert.equal(data.diagnostics.coordinateQuality, 1);
});

test('UTF-8 transformed .dna exact inverse is ambiguous without a reference', () => {
  if (!existsSync(TIAMAT_CLEAN_SSRNA_FIXTURE.path) || !existsSync(TIAMAT_BROKEN_SSRNA_FIXTURE)) {
    return 'skipped: ssRNA transform pair not found';
  }
  const clean = readFileSync(TIAMAT_CLEAN_SSRNA_FIXTURE.path);
  const broken = readFileSync(TIAMAT_BROKEN_SSRNA_FIXTURE);
  const transform = (bytes) => new TextEncoder().encode(new TextDecoder('utf-8').decode(bytes));
  const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

  assert.equal(sameBytes(transform(clean), broken), true);

  const mutated = Buffer.from(clean);
  assert.equal(mutated[812], 0x80);
  mutated[812] = 0x81;
  assert.equal(Buffer.compare(clean, mutated) === 0, false);
  assert.equal(sameBytes(transform(mutated), broken), true);

  const data = parseDnaFile(mutated.buffer.slice(mutated.byteOffset, mutated.byteOffset + mutated.byteLength));
  assert.equal(data.diagnostics.recovery, 'raw binary');
  assert.equal(data.bases.length, TIAMAT_CLEAN_SSRNA_FIXTURE.bases);
  assert.equal(data.diagnostics.coordinateQuality, 1);
});

test('cadnano v2 JSON imports scaffold/staple graph and colors', () => {
  const cadnano = JSON.stringify({
    name: 'mini cadnano',
    vstrands: [{
      num: 0,
      row: 0,
      col: 0,
      scaf: [[-1, -1, 0, 1], [0, 0, -1, -1]],
      stap: [[0, 1, -1, -1], [-1, -1, 0, 0]],
      loop: [0, 2],
      skip: [0, 0],
      stap_colors: [[1, 0x00ff00]],
      scafLoop: [],
      stapLoop: []
    }]
  });
  const data = parseJsonProject(cadnano);
  assert.equal(data.diagnostics.format, 'cadnano v2');
  assert.equal(data.bases.length, 4);
  assert.equal(data.diagnostics.insertionCount, 2);
  const scaf0 = data.bases.find((base) => base.sourceCadnano.kind === 'scaf' && base.sourceCadnano.offset === 0);
  const scaf1 = data.bases.find((base) => base.sourceCadnano.kind === 'scaf' && base.sourceCadnano.offset === 1);
  const stap0 = data.bases.find((base) => base.sourceCadnano.kind === 'stap' && base.sourceCadnano.offset === 0);
  const stap1 = data.bases.find((base) => base.sourceCadnano.kind === 'stap' && base.sourceCadnano.offset === 1);
  assert.equal(scaf0.down, scaf1.id);
  assert.equal(scaf1.up, scaf0.id);
  assert.equal(stap1.down, stap0.id);
  assert.equal(stap0.up, stap1.id);
  assert.equal(scaf0.across, stap0.id);
  assert.equal(stap1.across, scaf1.id);
  assert.equal(stap0.strandColor, '#00ff00');
  assert.ok(Math.abs((scaf1.position.y - scaf0.position.y) - TIAMAT_GEOMETRY.B.rise) < 0.000001);
  const chord = vectorFrom(scaf0.position).distanceTo(vectorFrom(stap0.position));
  const expectedChord = 2 * TIAMAT_GEOMETRY.B.radius * Math.sin(Math.abs(THREE.MathUtils.degToRad(TIAMAT_GEOMETRY.B.oppositeDeg)) / 2);
  assert.ok(Math.abs(chord - expectedChord) < 0.000001);
});

test('cadnano schematic run detection treats virtual-helix crossovers as run breaks', () => {
  const sameHelix = {
    sourceCadnano: { kind: 'scaf', helix: 0, offset: 10 }
  };
  assert.equal(isSchematicRunNeighbor(sameHelix, {
    sourceCadnano: { kind: 'scaf', helix: 0, offset: 11 }
  }), true);
  assert.equal(isSchematicRunNeighbor(sameHelix, {
    sourceCadnano: { kind: 'scaf', helix: 1, offset: 10 }
  }), false);
  assert.equal(isSchematicRunNeighbor(sameHelix, {
    sourceCadnano: { kind: 'stap', helix: 0, offset: 11 }
  }), false);
});

test('cadnano v2 import bridges strand links across skipped deletions', () => {
  const cadnano = JSON.stringify({
    name: 'skip bridge cadnano',
    vstrands: [{
      num: 0,
      row: 0,
      col: 0,
      scaf: [[-1, -1, 0, 1], [0, 0, 0, 2], [0, 1, -1, -1]],
      stap: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
      loop: [0, 0, 0],
      skip: [0, -1, 0],
      stap_colors: [],
      scafLoop: [],
      stapLoop: []
    }]
  });
  const data = parseJsonProject(cadnano);
  const scaf0 = data.bases.find((base) => base.sourceCadnano.kind === 'scaf' && base.sourceCadnano.offset === 0);
  const scaf2 = data.bases.find((base) => base.sourceCadnano.kind === 'scaf' && base.sourceCadnano.offset === 2);
  assert.equal(data.bases.length, 2);
  assert.equal(scaf0.down, scaf2.id);
  assert.equal(scaf2.up, scaf0.id);
  const model = new TiamatModel();
  model.loadBases(data.bases);
  assert.equal(model.strands().length, 1);
  assert.equal(model.strands()[0].length, 2);
});

test('model preserves cadnano circular strands as single strands', () => {
  const cadnano = JSON.stringify({
    name: 'circular cadnano',
    vstrands: [{
      num: 0,
      row: 0,
      col: 0,
      scaf: [[0, 2, 0, 1], [0, 0, 0, 2], [0, 1, 0, 0]],
      stap: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
      loop: [0, 0, 0],
      skip: [0, 0, 0],
      stap_colors: [],
      scafLoop: [],
      stapLoop: []
    }]
  });
  const data = parseJsonProject(cadnano);
  const model = new TiamatModel();
  model.loadBases(data.bases);
  const strands = model.strands();
  assert.equal(strands.length, 1);
  assert.equal(strands[0].length, 3);
  assert.equal(strands[0].every((base) => base.circular), true);
});

test('screen selection index returns bases inside a view rectangle', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const view = { id: 'test', camera, rect: { x: 0, y: 0, width: 100, height: 100 } };
  const bases = [
    { id: 1, position: { x: -0.5, y: 0.5, z: 0 } },
    { id: 2, position: { x: 0.5, y: -0.5, z: 0 } },
    { id: 3, position: { x: 1.5, y: 0, z: 0 } }
  ];
  const index = new ScreenSelectionIndex(25);
  index.ensure('test', bases, view, new Set(), (base) => vectorFrom(base.position));
  assert.deepEqual(index.query(0, 0, 50, 50), [1]);
  assert.deepEqual(index.query(50, 50, 100, 100), [2]);
  assert.equal(index.nearest(25, 25, 8).id, 1);
  assert.equal(index.nearest(75, 75, 8).id, 2);
  assert.equal(index.nearest(50, 50, 4), null);
});

function test(name, fn) {
  tests.push({ name, fn });
}

let failures = 0;
for (const { name, fn } of tests) {
  try {
    const result = fn();
    console.log(`ok - ${name}${result ? ` (${result})` : ''}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error.stack ?? error.message);
  }
}

if (failures > 0) {
  console.error(`${failures} test${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}

console.log(`${tests.length} tests passed`);
