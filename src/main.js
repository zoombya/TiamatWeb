import './styles.css';
import { TiamatModel } from './model.js';
import { TiamatScene } from './scene.js';
import { parseDnaFile } from './io.js';
import { mountApp, TiamatUI } from './ui.js';

mountApp(document.querySelector('#app'));

const model = new TiamatModel();
const scene = new TiamatScene(document.querySelector('#viewport'), model);
const ui = new TiamatUI(model, scene);

window.tiamat = { model, scene, ui };

loadStartupDesign();

async function loadStartupDesign() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}defaults/tetrahedron.dna`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = parseDnaFile(await response.arrayBuffer());
    model.loadBases(data.bases);
    model.fileName = 'tetrahedron.tiamat.json';
    ui.importDiagnostics = data.diagnostics ?? null;
    ui.updateImportDiagnostics();
    scene.frameDesign();
    ui.status(`Loaded tetrahedron startup scene (${model.bases.length} bases)`);
  } catch (error) {
    ui.status(`Startup scene unavailable: ${error.message}`);
  }
}
