import * as THREE from 'three';

const DEFAULT_CELL_SIZE = 36;

export class ScreenSelectionIndex {
  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
    this.signature = '';
    this.cells = new Map();
    this.bounds = { left: 0, top: 0, right: 0, bottom: 0 };
  }

  ensure(signature, bases, view, hiddenIds, pointForBase) {
    if (signature === this.signature) return;
    this.signature = signature;
    this.cells.clear();
    this.bounds = {
      left: view.rect.x,
      top: view.rect.y,
      right: view.rect.x + view.rect.width,
      bottom: view.rect.y + view.rect.height
    };

    const projected = new THREE.Vector3();
    bases.forEach((base) => {
      if (hiddenIds?.has(base.id)) return;
      projected.copy(pointForBase(base)).project(view.camera);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) return;
      if (projected.z < -1 || projected.z > 1) return;
      const x = view.rect.x + ((projected.x + 1) / 2) * view.rect.width;
      const y = view.rect.y + ((1 - projected.y) / 2) * view.rect.height;
      if (x < this.bounds.left || x > this.bounds.right || y < this.bounds.top || y > this.bounds.bottom) return;
      const key = this.cellKey(x, y);
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      bucket.push({ id: base.id, x, y, z: projected.z });
    });
  }

  query(left, top, right, bottom) {
    const result = new Set();
    const minCellX = Math.floor(left / this.cellSize);
    const maxCellX = Math.floor(right / this.cellSize);
    const minCellY = Math.floor(top / this.cellSize);
    const maxCellY = Math.floor(bottom / this.cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const bucket = this.cells.get(`${cellX}:${cellY}`);
        if (!bucket) continue;
        bucket.forEach((item) => {
          if (item.x >= left && item.x <= right && item.y >= top && item.y <= bottom) result.add(item.id);
        });
      }
    }
    return [...result];
  }

  nearest(x, y, radius = 10) {
    const left = x - radius;
    const right = x + radius;
    const top = y - radius;
    const bottom = y + radius;
    const radiusSq = radius * radius;
    let best = null;
    const minCellX = Math.floor(left / this.cellSize);
    const maxCellX = Math.floor(right / this.cellSize);
    const minCellY = Math.floor(top / this.cellSize);
    const maxCellY = Math.floor(bottom / this.cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const bucket = this.cells.get(`${cellX}:${cellY}`);
        if (!bucket) continue;
        bucket.forEach((item) => {
          if (item.x < left || item.x > right || item.y < top || item.y > bottom) return;
          const distanceSq = (item.x - x) ** 2 + (item.y - y) ** 2;
          if (distanceSq > radiusSq) return;
          if (!best || distanceSq < best.distanceSq || (distanceSq === best.distanceSq && item.z < best.z)) {
            best = { ...item, distanceSq };
          }
        });
      }
    }
    return best;
  }

  invalidate() {
    this.signature = '';
    this.cells.clear();
  }

  cellKey(x, y) {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`;
  }
}
