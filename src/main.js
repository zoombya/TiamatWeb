import './styles.css';
import { TiamatModel } from './model.js';
import { TiamatScene } from './scene.js';
import { mountApp, TiamatUI } from './ui.js';

mountApp(document.querySelector('#app'));

const model = new TiamatModel();
const scene = new TiamatScene(document.querySelector('#viewport'), model);
const ui = new TiamatUI(model, scene);

window.tiamat = { model, scene, ui };

model.createHelix('ATGCGTACGCTA', ui.readCreateOptions());
scene.frameDesign();
