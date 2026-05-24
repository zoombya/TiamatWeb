import { TYPE_FROM_NAME } from './constants.js';
import { normalizeBase } from './geometry.js';

export function normalizeImportedType(type) {
  if (typeof type !== 'string') return 'X';
  return TYPE_FROM_NAME[type] ?? normalizeBase(type[0] ?? 'X', type === 'Uracil' ? 'RNA' : 'DNA');
}

export function arrayToPosition(value) {
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  return { x: Number(value.x) || 0, y: Number(value.y) || 0, z: Number(value.z) || 0 };
}
