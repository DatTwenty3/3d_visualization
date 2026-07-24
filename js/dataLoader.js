/**
 * Bathymetry Data Parser & Normalizer
 * Reads point data in format: PointID  X  Y  Z
 */

class DataLoader {
  constructor() {
    this.points = [];
    this.bounds = {
      minX: Infinity, maxX: -Infinity,
      minY: Infinity, maxY: -Infinity,
      minZ: Infinity, maxZ: -Infinity,
      meanX: 0, meanY: 0, meanZ: 0,
      spanX: 0, spanY: 0, spanZ: 0
    };
    this.grid = null;
    this.gridResolution = 80; // Grid resolution for mesh interpolation
  }

  /**
   * Parse text data string
   */
  parseText(textData) {
    const lines = textData.split(/\r?\n/);
    const parsedPoints = [];

    let sumX = 0, sumY = 0, sumZ = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;

      // Split by tab, space or comma
      const tokens = line.split(/[\s,]+/);
      if (tokens.length >= 4) {
        const id = tokens[0];
        const x = parseFloat(tokens[1]);
        const y = parseFloat(tokens[2]);
        const z = parseFloat(tokens[3]);

        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          parsedPoints.push({ id, x, y, z });

          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;

          sumX += x;
          sumY += y;
          sumZ += z;
        }
      }
    }

    if (parsedPoints.length === 0) {
      throw new Error("Không tìm thấy dữ liệu điểm đo hợp lệ trong file!");
    }

    const count = parsedPoints.length;
    const meanX = sumX / count;
    const meanY = sumY / count;
    const meanZ = sumZ / count;

    this.points = parsedPoints;
    this.bounds = {
      minX, maxX,
      minY, maxY,
      minZ, maxZ,
      meanX, meanY, meanZ,
      spanX: maxX - minX,
      spanY: maxY - minY,
      spanZ: maxZ - minZ
    };

    // Calculate normalized 3D local coordinates
    // Three.js Coordinate System: X = East-West, Y = Height/Up (Z in geo), Z = North-South
    this.points.forEach(p => {
      p.localX = p.x - meanX;
      p.localY = p.z; // Elevation as 3D Y
      p.localZ = -(p.y - meanY); // North/South reversed for 3D Z
      p.normZ = (p.z - minZ) / (maxZ - minZ || 1); // 0.0 (deepest) to 1.0 (shallowest)
    });

    // Build regular grid interpolation for 3D terrain surface mesh
    this.buildGrid();

    return {
      points: this.points,
      bounds: this.bounds,
      grid: this.grid
    };
  }

  /**
   * Interpolate unstructured points onto a regular 2D grid (Inverse Distance Weighting IDW)
   */
  buildGrid() {
    const res = this.gridResolution;
    const { minX, maxX, minY, maxY, minZ } = this.bounds;
    const stepX = (maxX - minX) / (res - 1);
    const stepY = (maxY - minY) / (res - 1);

    const grid = [];
    const points = this.points;

    for (let i = 0; i < res; i++) {
      const row = [];
      const gx = minX + i * stepX;
      for (let j = 0; j < res; j++) {
        const gy = minY + j * stepY;

        // IDW Interpolation with nearest neighbors
        let totalWeight = 0;
        let weightedZ = 0;
        let minDistanceSq = Infinity;
        let closestZ = minZ;

        // Simple spatial lookup
        for (let k = 0; k < points.length; k++) {
          const p = points[k];
          const dx = p.x - gx;
          const dy = p.y - gy;
          const distSq = dx * dx + dy * dy;

          if (distSq < minDistanceSq) {
            minDistanceSq = distSq;
            closestZ = p.z;
          }

          if (distSq < (stepX * stepY * 16)) { // Neighbor search radius
            const dist = Math.sqrt(distSq) || 0.0001;
            const weight = 1 / (dist * dist);
            totalWeight += weight;
            weightedZ += p.z * weight;
          }
        }

        const interpolatedZ = totalWeight > 0 ? (weightedZ / totalWeight) : closestZ;

        row.push({
          x: gx,
          y: gy,
          z: interpolatedZ,
          localX: gx - this.bounds.meanX,
          localY: interpolatedZ,
          localZ: -(gy - this.bounds.meanY),
          normZ: (interpolatedZ - this.bounds.minZ) / (this.bounds.maxZ - this.bounds.minZ || 1)
        });
      }
      grid.push(row);
    }

    this.grid = grid;
  }

  /**
   * Sample depth Z along line segment (x1, y1) to (x2, y2)
   */
  sampleProfile(x1, y1, x2, y2, numSamples = 100) {
    if (!this.points || this.points.length === 0) return [];

    const dx = x2 - x1;
    const dy = y2 - y1;
    const totalDistance = Math.sqrt(dx * dx + dy * dy);

    const samples = [];
    for (let i = 0; i <= numSamples; i++) {
      const frac = i / numSamples;
      const curX = x1 + frac * dx;
      const curY = y1 + frac * dy;
      samples.push(this._makeSample(curX, curY, frac * totalDistance));
    }
    return samples;
  }

  /**
   * IDW Z at (x, y) and build a profile sample record
   */
  interpolateZ(curX, curY) {
    if (!this.points || this.points.length === 0) return 0;
    const { minZ } = this.bounds;
    let totalWeight = 0;
    let weightedZ = 0;
    let nearestDistSq = Infinity;
    let nearestZ = minZ;

    for (let k = 0; k < this.points.length; k++) {
      const p = this.points[k];
      const pdx = p.x - curX;
      const pdy = p.y - curY;
      const dSq = pdx * pdx + pdy * pdy;

      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearestZ = p.z;
      }

      if (dSq < 2500) { // 50m search radius
        const dist = Math.sqrt(dSq) || 0.0001;
        const weight = 1 / (dist * dist);
        totalWeight += weight;
        weightedZ += p.z * weight;
      }
    }

    return totalWeight > 0 ? (weightedZ / totalWeight) : nearestZ;
  }

  _makeSample(curX, curY, distFromStart) {
    const { minZ, maxZ, meanX, meanY } = this.bounds;
    const z = this.interpolateZ(curX, curY);
    return {
      distance: distFromStart,
      x: curX,
      y: curY,
      z: z,
      depth: -z,
      localX: curX - meanX,
      localY: z,
      localZ: -(curY - meanY),
      normZ: (z - minZ) / (maxZ - minZ || 1)
    };
  }

  /**
   * Sample profile along a polyline (array of {x,y}), evenly by chainage.
   */
  sampleProfilePolyline(points, numSamples = 100) {
    if (!this.points || this.points.length === 0) return [];
    if (!points || points.length < 2) return [];

    const segs = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      segs.push({ a: points[i - 1], b: points[i], len, s0: total });
      total += len;
    }
    if (total < 1e-9) {
      return [this._makeSample(points[0].x, points[0].y, 0)];
    }

    const samples = [];
    for (let i = 0; i <= numSamples; i++) {
      const target = (i / numSamples) * total;
      let seg = segs[segs.length - 1];
      for (let s = 0; s < segs.length; s++) {
        if (target <= segs[s].s0 + segs[s].len + 1e-9) {
          seg = segs[s];
          break;
        }
      }
      const t = seg.len > 1e-9 ? (target - seg.s0) / seg.len : 0;
      const curX = seg.a.x + t * (seg.b.x - seg.a.x);
      const curY = seg.a.y + t * (seg.b.y - seg.a.y);
      samples.push(this._makeSample(curX, curY, target));
    }
    return samples;
  }

  /**
   * Marching Squares Contour Line Generator for Bathymetric Isobaths
   * @param {number} interval Contour spacing in meters (clamped to 0.5–1.0)
   */
  generateContours(interval = 1) {
    if (!this.grid || this.grid.length < 2) return [];

    let step = Number(interval);
    if (!Number.isFinite(step)) step = 1;
    step = Math.min(1, Math.max(0.5, step));

    const levels = [];
    const minZ = this.bounds.minZ;
    const maxZ = this.bounds.maxZ;
    let z = Math.ceil(minZ / step) * step;
    // Guard against floating-point drift
    while (z <= maxZ + 1e-9) {
      levels.push(Number(z.toFixed(3)));
      z += step;
    }

    const contours = [];
    const rows = this.grid.length;
    const cols = this.grid[0].length;

    levels.forEach(level => {
      const lineSegments = [];

      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const p0 = this.grid[r][c];       // Top-Left
          const p1 = this.grid[r][c + 1];   // Top-Right
          const p2 = this.grid[r + 1][c + 1]; // Bottom-Right
          const p3 = this.grid[r + 1][c];   // Bottom-Left

          let config = 0;
          if (p0.z >= level) config |= 8;
          if (p1.z >= level) config |= 4;
          if (p2.z >= level) config |= 2;
          if (p3.z >= level) config |= 1;

          if (config === 0 || config === 15) continue;

          const interp = (nA, nB) => {
            if (Math.abs(nB.z - nA.z) < 1e-6) {
              return { x: nA.x, y: nA.y, localX: nA.localX, localZ: nA.localZ };
            }
            const t = (level - nA.z) / (nB.z - nA.z);
            return {
              x: nA.x + t * (nB.x - nA.x),
              y: nA.y + t * (nB.y - nA.y),
              localX: nA.localX + t * (nB.localX - nA.localX),
              localZ: nA.localZ + t * (nB.localZ - nA.localZ)
            };
          };

          const edgeTop = interp(p0, p1);
          const edgeRight = interp(p1, p2);
          const edgeBottom = interp(p3, p2);
          const edgeLeft = interp(p0, p3);

          switch (config) {
            case 1: case 14: lineSegments.push([edgeLeft, edgeBottom]); break;
            case 2: case 13: lineSegments.push([edgeBottom, edgeRight]); break;
            case 3: case 12: lineSegments.push([edgeLeft, edgeRight]); break;
            case 4: case 11: lineSegments.push([edgeTop, edgeRight]); break;
            case 5: lineSegments.push([edgeLeft, edgeTop], [edgeBottom, edgeRight]); break;
            case 6: case 9:  lineSegments.push([edgeTop, edgeBottom]); break;
            case 7: case 8:  lineSegments.push([edgeLeft, edgeTop]); break;
            case 10: lineSegments.push([edgeTop, edgeRight], [edgeBottom, edgeLeft]); break;
          }
        }
      }

      contours.push({
        level: level,
        segments: lineSegments
      });
    });

    return contours;
  }
}

window.DataLoader = DataLoader;
