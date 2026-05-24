import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TiamatModel } from '../src/model.js';
import { parseOxViewProject } from '../src/io.js';

const OXVIEW_FIXTURE = '/Users/m.matthies/Data/Dietz_Designs/oxview/42hb_v40_polyT.oxview';

if (!existsSync(OXVIEW_FIXTURE)) {
  console.log(`skipped - fixture not found: ${OXVIEW_FIXTURE}`);
  process.exit(0);
}

const text = readFileSync(OXVIEW_FIXTURE, 'utf8');
const parseStart = performance.now();
const data = parseOxViewProject(text);
const parseMs = performance.now() - parseStart;

const model = new TiamatModel();
const loadStart = performance.now();
model.loadBases(data.bases);
const loadMs = performance.now() - loadStart;

const strandStart = performance.now();
const strands = model.strands();
const strandMs = performance.now() - strandStart;

const pairs = model.bases.filter((base) => base.across !== null).length / 2;

console.log(JSON.stringify({
  fixture: OXVIEW_FIXTURE,
  bases: model.bases.length,
  strands: strands.length,
  pairs,
  unresolvedPairs: data.diagnostics.unresolvedPairs,
  importScale: data.diagnostics.importScale,
  parseMs: Number(parseMs.toFixed(2)),
  loadMs: Number(loadMs.toFixed(2)),
  strandMs: Number(strandMs.toFixed(2))
}, null, 2));
