import * as THREE from 'three';
import { BASES, DOWN_DISTANCE, TIAMAT_GEOMETRY } from './constants.js';

export function normalizeBase(letter, molecule = 'DNA') {
  const upper = String(letter ?? 'X').toUpperCase();
  if (upper === 'U' && molecule === 'DNA') return 'T';
  if (upper === 'T' && molecule === 'RNA') return 'U';
  return BASES[upper] ? upper : 'X';
}

export function complementFor(base) {
  if (base.molecule === 'RNA' && base.type === 'A') return 'U';
  if (base.molecule === 'RNA' && base.type === 'U') return 'A';
  return BASES[base.type]?.complement ?? 'X';
}

export function cleanSequence(value, molecule = 'DNA') {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^ATUGCX]/g, '')
    .replace(/U/g, molecule === 'DNA' ? 'T' : 'U');
}

export function normalizeCreateOptions(options = {}) {
  const geometryName = options.geometry === 'A' ? 'A' : options.geometry === 'Free' ? 'Free' : 'B';
  const preset = TIAMAT_GEOMETRY[geometryName] ?? TIAMAT_GEOMETRY.B;
  return {
    molecule: options.molecule ?? 'DNA',
    pairedMolecule: options.pairedMolecule ?? options.molecule ?? 'DNA',
    geometry: geometryName,
    radius: Number(options.radius) || preset.radius,
    rise: Number(options.rise) || preset.rise,
    twist: Number(options.twist) || preset.twistDeg,
    initialRotation: Number(options.initialRotation) || 0,
    baseCount: Math.max(0, Math.floor(Number(options.baseCount) || 0)),
    orientation: options.orientation === 'reverse' ? 'reverse' : 'forward',
    initialMode: ['blank', 'random', 'sequence'].includes(options.initialMode) ? options.initialMode : 'sequence',
    opposite: Number.isFinite(Number(options.opposite)) ? Number(options.opposite) : preset.oppositeDeg,
    inclination: Number.isFinite(Number(options.inclination)) ? Number(options.inclination) : preset.inclinationDeg,
    double: Boolean(options.double)
  };
}

export function helicalPosition(index, options, phaseOffsetDeg = 0) {
  const theta = THREE.MathUtils.degToRad(index * options.twist + phaseOffsetDeg);
  const axialOffset = -(
    options.radius *
    2 *
    Math.sin(THREE.MathUtils.degToRad(phaseOffsetDeg) / 2) *
    Math.tan(THREE.MathUtils.degToRad(options.inclination))
  );
  return new THREE.Vector3(
    options.radius * Math.cos(theta),
    index * options.rise + axialOffset,
    options.radius * Math.sin(theta)
  );
}

export function inferAcrossPosition(base, geometry = TIAMAT_GEOMETRY.B) {
  const position = vectorFrom(base.position);
  const theta = Math.atan2(position.z, position.x);
  const phase = THREE.MathUtils.degToRad(geometry.oppositeDeg);
  const axialOffset = -(
    geometry.radius *
    2 *
    Math.sin(phase / 2) *
    Math.tan(THREE.MathUtils.degToRad(geometry.inclinationDeg))
  );
  return new THREE.Vector3(
    geometry.radius * Math.cos(theta + phase),
    position.y + axialOffset,
    geometry.radius * Math.sin(theta + phase)
  );
}

export function vectorFrom(position) {
  if (!position) return new THREE.Vector3();
  return new THREE.Vector3(position.x ?? position[0] ?? 0, position.y ?? position[1] ?? 0, position.z ?? position[2] ?? 0);
}

export function positionFrom(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

export function formatVector(position) {
  const v = vectorFrom(position);
  return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
}

export function linePosition(index, strand, rise = DOWN_DISTANCE) {
  return new THREE.Vector3(strand * 0.35, 0, index * rise);
}

export function rotatePointAround(point, center, axis, radians) {
  return vectorFrom(point).sub(center).applyAxisAngle(axis, radians).add(center);
}
