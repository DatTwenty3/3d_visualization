/**
 * Three.js 3D Scene Controller for River Bathymetry
 */

class Scene3D {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Objects
    this.terrainMesh = null;
    this.terrainSkirtMesh = null;
    this.wireframeMesh = null;
    this.pointCloud = null;
    this.waterMesh = null;
    this.cutLineMesh = null;
    this.gridHelper = null;
    this.contoursGroup = null;
    this.hoverMarker = null;
    this.basemapGroup = null;

    // Raycaster for Hover Inspector
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Parameters
    this.renderMode = 'surface'; // 'surface', 'wireframe', 'points', 'both'
    this.zScale = 3.0; // Z exaggeration factor
    this.colorPalette = 'rainbow';
    this.showWater = false;
    this.showBasemap = true;
    this.waterLevel = 0; // Water surface elevation (m), default Z = 0
    this.showContours = true;
    this.contourInterval = 1; // Contour spacing (m), range 0.5–1
    this.cutPlanesGroup = null; // Multiple cut planes

    // VN-2000 ↔ WGS84 projectors (set from app via CrossSection)
    this._utmToLatLng = null;
    this._latLngToUtm = null;

    // Data references
    this.dataLoader = null;

    this.init();
  }

  init() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf5f5f7);
    this.scene.fog = new THREE.FogExp2(0xf5f5f7, 0.0003);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
    this.camera.position.set(0, 400, 600);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1; // Slightly below horizon
    this.controls.minDistance = 20;
    this.controls.maxDistance = 3000;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(500, 1000, 500);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0x00f2fe, 0.4);
    dirLight2.position.set(-500, 300, -500);
    this.scene.add(dirLight2);

    // Event listener resize
    window.addEventListener('resize', () => this.onWindowResize());

    // Start animation loop
    this.animate();
  }

  onWindowResize() {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Build 3D models from data loader
   */
  updateData(dataLoader) {
    this.dataLoader = dataLoader;
    const { grid, points, bounds } = dataLoader;

    // Clear previous objects
    if (this.terrainMesh) this.scene.remove(this.terrainMesh);
    if (this.terrainSkirtMesh) {
      this.scene.remove(this.terrainSkirtMesh);
      if (this.terrainSkirtMesh.geometry) this.terrainSkirtMesh.geometry.dispose();
      if (this.terrainSkirtMesh.material) this.terrainSkirtMesh.material.dispose();
      this.terrainSkirtMesh = null;
    }
    if (this.wireframeMesh) this.scene.remove(this.wireframeMesh);
    if (this.pointCloud) this.scene.remove(this.pointCloud);
    if (this.waterMesh) this.scene.remove(this.waterMesh);
    if (this.gridHelper) this.scene.remove(this.gridHelper);
    if (this.hoverMarker) {
      this.scene.remove(this.hoverMarker);
      this.hoverMarker.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
      this.hoverMarker = null;
    }
    if (this.cutPlanesGroup) {
      this.scene.remove(this.cutPlanesGroup);
      this.cutPlanesGroup = null;
    }
    if (this.cutLineMesh) {
      this.scene.remove(this.cutLineMesh);
      this.cutLineMesh = null;
    }
    this.clearBasemap();

    if (!grid || grid.length === 0) return;

    const rows = grid.length;
    const cols = grid[0].length;

    // 1. Build Terrain Surface Mesh Geometry using BufferGeometry
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const uvs = [];
    const indices = [];

    // Populate vertices (invalid cells keep Y=0; no faces attached below)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = grid[r][c];
        const valid = p.valid !== false && p.z != null;

        const x3d = p.localX;
        const y3d = valid ? p.localY * this.zScale : 0;
        const z3d = p.localZ;

        positions.push(x3d, y3d, z3d);

        const rgb = ColorRamps.getColor(valid ? p.normZ : 0, this.colorPalette);
        colors.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

        uvs.push(r / (rows - 1), c / (cols - 1));
      }
    }

    // Build grid face indices only where all 4 corners have survey data nearby
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const p00 = grid[r][c];
        const p01 = grid[r][c + 1];
        const p11 = grid[r + 1][c + 1];
        const p10 = grid[r + 1][c];
        if (
          p00.valid === false || p00.z == null ||
          p01.valid === false || p01.z == null ||
          p11.valid === false || p11.z == null ||
          p10.valid === false || p10.z == null
        ) {
          continue;
        }

        const a = r * cols + c;
        const b = r * cols + (c + 1);
        const cIdx = (r + 1) * cols + (c + 1);
        const d = (r + 1) * cols + c;

        indices.push(a, d, b);
        indices.push(b, d, cIdx);
      }
    }

    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();

    // Material for Solid Surface Mesh
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0.1,
      side: THREE.DoubleSide,
      flatShading: false
    });

    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.name = 'terrainMesh';
    this.scene.add(this.terrainMesh);

    // Skirt walls: close the pit between bed edge and water/basemap level
    this.rebuildTerrainSkirt();

    // 2. Wireframe Mesh
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x1e3a8a,
      wireframe: true,
      transparent: true,
      opacity: 0.4
    });
    this.wireframeMesh = new THREE.Mesh(geometry, wireMat);
    this.wireframeMesh.name = 'wireframeMesh';
    this.scene.add(this.wireframeMesh);

    // 3. Point Cloud (Raw measured points)
    const pcGeometry = new THREE.BufferGeometry();
    const pcPositions = [];
    const pcColors = [];

    points.forEach(p => {
      pcPositions.push(p.localX, p.z * this.zScale, p.localZ);
      const rgb = ColorRamps.getColor(p.normZ, this.colorPalette);
      pcColors.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    });

    pcGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pcPositions, 3));
    pcGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pcColors, 3));

    const pcMaterial = new THREE.PointsMaterial({
      size: 4,
      vertexColors: true,
      sizeAttenuation: true
    });
    this.pointCloud = new THREE.Points(pcGeometry, pcMaterial);
    this.pointCloud.name = 'pointCloud';
    this.scene.add(this.pointCloud);

    // 4. Water Surface Plane — size matches East (X) × North (Z) extents
    const waterWidth = bounds.spanY * 1.3;  // Easting → Three +X
    const waterHeight = bounds.spanX * 1.3; // Northing → Three ±Z
    const waterGeo = new THREE.PlaneGeometry(waterWidth, waterHeight, 32, 32);
    waterGeo.rotateX(-Math.PI / 2);

    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.35,
      roughness: 0.2,
      metalness: 0.5,
      transmission: 0,
      ior: 1.333,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.renderOrder = 2;
    this.waterMesh.position.set(0, this.waterLevel * this.zScale, 0);
    this.waterMesh.visible = this.showWater;
    this.scene.add(this.waterMesh);

    // 5. Grid Helper at bottom
    const maxSpan = Math.max(bounds.spanX, bounds.spanY) * 1.5;
    this.gridHelper = new THREE.GridHelper(maxSpan, 20, 0x1e3a8a, 0xcbd5e1);
    this.gridHelper.position.y = bounds.minZ * this.zScale - 20;
    this.scene.add(this.gridHelper);

    // 6. Hover pick marker (downward arrow tip on terrain)
    this.hoverMarker = this.createHoverMarker(maxSpan);
    this.scene.add(this.hoverMarker);

    // 7. Draw 3D Contour Lines
    this.drawContours3D();

    // 8. Setup Raycaster Pointer Move Listener
    this.setupRaycaster();

    // 9. Satellite basemap at water level with survey-corridor hole
    this.rebuildBasemap();

    // Apply visibility according to renderMode
    this.updateRenderMode(this.renderMode);

    // Adjust camera position & target
    this.controls.target.set(0, (bounds.meanZ) * this.zScale, 0);
    this.camera.position.set(0, maxSpan * 0.7, maxSpan * 0.9);
    this.controls.update();
  }

  /**
   * Draw 3D Contour Lines (Isobaths)
   */
  drawContours3D() {
    if (this.contoursGroup) {
      this.scene.remove(this.contoursGroup);
      this.contoursGroup = null;
    }

    if (!this.dataLoader || !this.showContours) return;

    const contours = this.dataLoader.generateContours(this.contourInterval);
    if (!contours || contours.length === 0) return;

    const group = new THREE.Group();

    contours.forEach(c => {
      const level = c.level;
      const positions = [];

      c.segments.forEach(seg => {
        const p1 = seg[0];
        const p2 = seg[1];

        // Lift slightly above terrain to avoid z-fighting
        const y1 = level * this.zScale + 0.5;
        const y2 = level * this.zScale + 0.5;

        positions.push(p1.localX, y1, p1.localZ);
        positions.push(p2.localX, y2, p2.localZ);
      });

      if (positions.length > 0) {
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x1e3a8a,
          linewidth: 1.5,
          transparent: true,
          opacity: 0.7
        });
        const lineSegs = new THREE.LineSegments(lineGeo, lineMat);
        group.add(lineSegs);
      }
    });

    this.contoursGroup = group;
    this.scene.add(this.contoursGroup);
  }

  setContoursVisible(visible) {
    this.showContours = visible;
    if (visible) {
      this.drawContours3D();
    } else if (this.contoursGroup) {
      this.scene.remove(this.contoursGroup);
      this.contoursGroup = null;
    }
  }

  /**
   * Set contour spacing (meters) and redraw isobaths if visible
   */
  setContourInterval(interval) {
    let step = Number(interval);
    if (!Number.isFinite(step)) step = 1;
    this.contourInterval = Math.min(1, Math.max(0.5, step));
    if (this.showContours) {
      this.drawContours3D();
    }
  }

  /**
   * Setup Raycaster Pointer Move Inspector
   */
  setupRaycaster() {
    if (this._raycasterBound) return;
    this._raycasterBound = true;

    const container = this.container;
    container.addEventListener('pointermove', (event) => {
      if (!this.terrainMesh || !this.dataLoader) return;

      const rect = container.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.terrainMesh);

      if (intersects.length > 0) {
        const hit = intersects[0];
        const p = hit.point;

        if (this.hoverMarker) {
          this.placeHoverMarkerOnSurface(hit);
          this.hoverMarker.visible = true;
        }

        // Convert 3D local coords back to UTM VN-2000 (X Northing, Y Easting)
        const utmY = p.x + this.dataLoader.bounds.meanY; // Three +X = Easting
        const utmX = -p.z + this.dataLoader.bounds.meanX; // Three +Z = South → Northing
        const depthZ = p.y / this.zScale;

        // Find nearest actual point ID if available
        let nearestID = 'Nội suy 3D';
        let minDSq = Infinity;
        this.dataLoader.points.forEach(pt => {
          const dSq = (pt.x - utmX) ** 2 + (pt.y - utmY) ** 2;
          if (dSq < minDSq) {
            minDSq = dSq;
            if (minDSq < 25) { // Within 5m
              nearestID = pt.id;
            }
          }
        });

        // Update HUD Depth Inspector
        document.getElementById('hudPointID').textContent = nearestID;
        document.getElementById('hudX').textContent = utmX.toFixed(2);
        document.getElementById('hudY').textContent = utmY.toFixed(2);
        document.getElementById('hudZ').textContent = `${depthZ.toFixed(2)} m`;

        const b = this.dataLoader.bounds;
        const spanZ = (b.maxZ - b.minZ) || 1;
        const t = Math.max(0, Math.min(1, (depthZ - b.minZ) / spanZ)); // 0 deep → 1 shallow
        const swatch = document.getElementById('hudSwatch');
        if (swatch) {
          swatch.style.background = ColorRamps.getColorCSS(t, this.colorPalette);
        }
        const thumb = document.getElementById('hudMeterThumb');
        if (thumb) {
          // Meter: left = nông (t=1), right = sâu (t=0)
          thumb.style.left = `${((1 - t) * 100).toFixed(1)}%`;
        }

        const hud = document.getElementById('hoverInfoHUD');
        if (hud) hud.classList.add('visible');
      } else {
        if (this.hoverMarker) this.hoverMarker.visible = false;
        const hud = document.getElementById('hoverInfoHUD');
        if (hud) hud.classList.remove('visible');
      }
    });

    container.addEventListener('pointerleave', () => {
      if (this.hoverMarker) this.hoverMarker.visible = false;
      const hud = document.getElementById('hoverInfoHUD');
      if (hud) hud.classList.remove('visible');
    });
  }

  /**
   * Update Z-exaggeration scale factor dynamically
   */
  /**
   * Update Z-exaggeration scale factor dynamically
   */
  setZScale(scale) {
    this.zScale = scale;
    if (!this.dataLoader) return;

    // 1. Update Terrain Surface Mesh positions
    if (this.terrainMesh && this.terrainMesh.geometry) {
      const posAttr = this.terrainMesh.geometry.attributes.position;
      if (posAttr && this.dataLoader.grid) {
        const grid = this.dataLoader.grid;
        const pos = posAttr.array;
        let idx = 0;
        for (let r = 0; r < grid.length; r++) {
          for (let c = 0; c < grid[r].length; c++) {
            const cell = grid[r][c];
            if (cell.valid !== false && cell.z != null) {
              pos[idx + 1] = cell.localY * scale;
            } else {
              pos[idx + 1] = 0;
            }
            idx += 3;
          }
        }
        posAttr.needsUpdate = true;
        this.terrainMesh.geometry.computeVertexNormals();
      }
    }

    // 2. Update Point Cloud positions
    if (this.pointCloud && this.pointCloud.geometry) {
      const pcPosAttr = this.pointCloud.geometry.attributes.position;
      if (pcPosAttr && this.dataLoader.points) {
        const points = this.dataLoader.points;
        const pos = pcPosAttr.array;
        let idx = 0;
        points.forEach(p => {
          pos[idx + 1] = p.z * scale;
          idx += 3;
        });
        pcPosAttr.needsUpdate = true;
      }
    }

    // Update 3D cut line elevation
    if (window.crossSection && window.crossSection.updateProfile) {
      window.crossSection.updateProfile();
    }

    // Redraw contour isobaths so they follow the new Z exaggeration
    if (this.showContours) {
      this.drawContours3D();
    }

    this.rebuildTerrainSkirt();
    this.updateBasemapElevation();
  }

  _isGridCellValid(cell) {
    return !!(cell && cell.valid !== false && cell.z != null);
  }

  /**
   * Vertical skirts along survey footprint rim: bed → water level,
   * so the basemap hole does not show the empty scene background.
   */
  rebuildTerrainSkirt() {
    if (this.terrainSkirtMesh) {
      this.scene.remove(this.terrainSkirtMesh);
      if (this.terrainSkirtMesh.geometry) this.terrainSkirtMesh.geometry.dispose();
      if (this.terrainSkirtMesh.material) this.terrainSkirtMesh.material.dispose();
      this.terrainSkirtMesh = null;
    }

    if (!this.dataLoader || !this.dataLoader.grid) return;
    const grid = this.dataLoader.grid;
    const rows = grid.length;
    const cols = grid[0].length;
    if (rows < 2 || cols < 2) return;

    const topY = this.waterLevel * this.zScale;
    const positions = [];
    const colors = [];
    const indices = [];

    const pushWall = (a, b) => {
      const y0 = a.localY * this.zScale;
      const y1 = b.localY * this.zScale;
      // Skip nearly flat walls (bed already at/above water)
      if (y0 >= topY - 0.05 && y1 >= topY - 0.05) return;

      const rgbA = ColorRamps.getColor(a.normZ, this.colorPalette);
      const rgbB = ColorRamps.getColor(b.normZ, this.colorPalette);
      // Slightly darken walls so they read as under-bank fill
      const dim = 0.72;
      const base = positions.length / 3;

      positions.push(a.localX, y0, a.localZ);
      colors.push((rgbA[0] / 255) * dim, (rgbA[1] / 255) * dim, (rgbA[2] / 255) * dim);
      positions.push(b.localX, y1, b.localZ);
      colors.push((rgbB[0] / 255) * dim, (rgbB[1] / 255) * dim, (rgbB[2] / 255) * dim);
      positions.push(b.localX, topY, b.localZ);
      colors.push((rgbB[0] / 255) * dim, (rgbB[1] / 255) * dim, (rgbB[2] / 255) * dim);
      positions.push(a.localX, topY, a.localZ);
      colors.push((rgbA[0] / 255) * dim, (rgbA[1] / 255) * dim, (rgbA[2] / 255) * dim);

      indices.push(base, base + 1, base + 2);
      indices.push(base, base + 2, base + 3);
    };

    const hasFace = (r, c) => {
      if (r < 0 || c < 0 || r >= rows - 1 || c >= cols - 1) return false;
      return (
        this._isGridCellValid(grid[r][c]) &&
        this._isGridCellValid(grid[r][c + 1]) &&
        this._isGridCellValid(grid[r + 1][c + 1]) &&
        this._isGridCellValid(grid[r + 1][c])
      );
    };

    // Horizontal edges (same row, adjacent cols)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (!this._isGridCellValid(grid[r][c]) || !this._isGridCellValid(grid[r][c + 1])) continue;
        const faceN = hasFace(r - 1, c);
        const faceS = hasFace(r, c);
        if (faceN === faceS) continue; // internal or both open thin bridge → one wall if both open
        if (!faceN || !faceS) pushWall(grid[r][c], grid[r][c + 1]);
      }
    }

    // Vertical edges (same col, adjacent rows)
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        if (!this._isGridCellValid(grid[r][c]) || !this._isGridCellValid(grid[r + 1][c])) continue;
        const faceW = hasFace(r, c - 1);
        const faceE = hasFace(r, c);
        if (faceW === faceE) continue;
        if (!faceW || !faceE) pushWall(grid[r][c], grid[r + 1][c]);
      }
    }

    if (indices.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
      flatShading: true
    });

    this.terrainSkirtMesh = new THREE.Mesh(geo, mat);
    this.terrainSkirtMesh.name = 'terrainSkirt';
    this.terrainSkirtMesh.renderOrder = -1;
    const showSurface = this.renderMode === 'surface' || this.renderMode === 'both';
    this.terrainSkirtMesh.visible = showSurface;
    this.scene.add(this.terrainSkirtMesh);
  }

  /**
   * Bind VN-2000 ↔ WGS84 converters from CrossSection
   */
  setBasemapProjectors(utmToLatLng, latLngToUtm) {
    this._utmToLatLng = utmToLatLng;
    this._latLngToUtm = latLngToUtm;
  }

  clearBasemap() {
    if (!this.basemapGroup) return;
    if (window.Basemap3D) Basemap3D.dispose(this.basemapGroup);
    this.scene.remove(this.basemapGroup);
    this.basemapGroup = null;
  }

  rebuildBasemap() {
    this.clearBasemap();
    if (!this.showBasemap || !this.dataLoader || !window.Basemap3D) return;
    if (!this._utmToLatLng || !this._latLngToUtm) return;

    const group = Basemap3D.build({
      bounds: this.dataLoader.bounds,
      grid: this.dataLoader.grid,
      utmToLatLng: this._utmToLatLng,
      latLngToUtm: this._latLngToUtm
    });
    if (!group) return;

    group.visible = this.showBasemap;
    this.basemapGroup = group;
    this.scene.add(group);
    this.updateBasemapElevation();
  }

  updateBasemapElevation() {
    if (!this.basemapGroup) return;
    const bias = (window.Basemap3D && Basemap3D.WATER_Y_BIAS) || 0.35;
    this.basemapGroup.position.y = this.waterLevel * this.zScale - bias;
  }

  setBasemapVisible(visible) {
    this.showBasemap = !!visible;
    if (this.basemapGroup) {
      this.basemapGroup.visible = this.showBasemap;
    } else if (this.showBasemap) {
      this.rebuildBasemap();
    }
  }

  /**
   * Update Color Ramp palette dynamically
   */
  setColorPalette(paletteName) {
    this.colorPalette = paletteName;
    if (!this.dataLoader) return;

    // 1. Update Terrain Surface Mesh vertex colors
    if (this.terrainMesh && this.terrainMesh.geometry) {
      const colorAttr = this.terrainMesh.geometry.attributes.color;
      if (colorAttr && this.dataLoader.grid) {
        const grid = this.dataLoader.grid;
        const colors = colorAttr.array;
        let idx = 0;
        for (let r = 0; r < grid.length; r++) {
          for (let c = 0; c < grid[r].length; c++) {
            const cell = grid[r][c];
            const rgb = ColorRamps.getColor(
              (cell.valid !== false && cell.z != null) ? cell.normZ : 0,
              paletteName
            );
            colors[idx] = rgb[0] / 255;
            colors[idx + 1] = rgb[1] / 255;
            colors[idx + 2] = rgb[2] / 255;
            idx += 3;
          }
        }
        colorAttr.needsUpdate = true;
      }
    }

    this.rebuildTerrainSkirt();

    // 2. Update Point Cloud vertex colors
    if (this.pointCloud && this.pointCloud.geometry) {
      const pcColorAttr = this.pointCloud.geometry.attributes.color;
      if (pcColorAttr && this.dataLoader.points) {
        const points = this.dataLoader.points;
        const colors = pcColorAttr.array;
        let idx = 0;
        points.forEach(p => {
          const rgb = ColorRamps.getColor(p.normZ, paletteName);
          colors[idx] = rgb[0] / 255;
          colors[idx + 1] = rgb[1] / 255;
          colors[idx + 2] = rgb[2] / 255;
          idx += 3;
        });
        pcColorAttr.needsUpdate = true;
      }
    }
  }

  /**
   * Toggle render mode: 'surface', 'wireframe', 'points', 'both'
   */
  updateRenderMode(mode) {
    this.renderMode = mode;
    if (this.terrainMesh) this.terrainMesh.visible = (mode === 'surface' || mode === 'both');
    if (this.terrainSkirtMesh) this.terrainSkirtMesh.visible = (mode === 'surface' || mode === 'both');
    if (this.wireframeMesh) this.wireframeMesh.visible = (mode === 'wireframe' || mode === 'both');
    if (this.pointCloud) this.pointCloud.visible = (mode === 'points');
  }

  /**
   * Toggle water surface visibility
   */
  setWaterVisible(visible) {
    this.showWater = visible;
    if (this.waterMesh) this.waterMesh.visible = visible;
  }

  /**
   * Set water surface elevation (meters) and update mesh position
   */
  setWaterLevel(level) {
    this.waterLevel = Number.isFinite(level) ? level : 0;
    if (this.waterMesh) {
      this.waterMesh.position.y = this.waterLevel * this.zScale;
    }
    this.rebuildTerrainSkirt();
    this.updateBasemapElevation();
  }

  /**
   * Hover pick marker: downward arrow with tip stuck to terrain surface
   * Local origin = arrow tip; shaft extends along local +Y (up)
   */
  createHoverMarker(sceneSpan = 200) {
    const group = new THREE.Group();
    group.visible = false;

    const scale = Math.max(0.7, Math.min(2.2, sceneSpan * 0.0055)) * 0.7;
    group.userData.markerScale = scale;

    const tipH = 3.2 * scale;
    const tipR = 1.35 * scale;
    const shaftH = 5.5 * scale;
    const shaftR = 0.38 * scale;
    const accent = 0xea580c;

    // Cone tip: default ConeGeometry points +Y; flip so tip faces -Y (downward)
    const tipMat = new THREE.MeshBasicMaterial({
      color: accent,
      depthTest: true,
      depthWrite: true
    });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(tipR, tipH, 20), tipMat);
    tip.rotation.x = Math.PI; // point down
    // Tip apex at local y=0 (surface contact)
    tip.position.y = tipH / 2;
    group.add(tip);

    // White outline cone (slightly larger, backfaces)
    const tipRim = new THREE.Mesh(
      new THREE.ConeGeometry(tipR * 1.12, tipH * 1.04, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        side: THREE.BackSide,
        depthWrite: false
      })
    );
    tipRim.rotation.x = Math.PI;
    tipRim.position.y = tipH / 2;
    group.add(tipRim);

    // Shaft above the cone base
    const shaftMat = new THREE.MeshBasicMaterial({ color: accent });
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(shaftR, shaftR, shaftH, 12),
      shaftMat
    );
    shaft.position.y = tipH + shaftH / 2;
    group.add(shaft);

    const shaftRim = new THREE.Mesh(
      new THREE.CylinderGeometry(shaftR * 1.35, shaftR * 1.35, shaftH, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.75,
        side: THREE.BackSide,
        depthWrite: false
      })
    );
    shaftRim.position.y = tipH + shaftH / 2;
    group.add(shaftRim);

    // Small contact disc at tip for surface “stick” read
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(tipR * 0.55, 24),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.04 * scale;
    group.add(pad);

    return group;
  }

  /**
   * Place arrow tip on hit point; keep arrow vertical (pointing down in world space)
   */
  placeHoverMarkerOnSurface(hit) {
    if (!this.hoverMarker || !hit) return;

    const normal = hit.face && hit.face.normal
      ? hit.face.normal.clone()
      : new THREE.Vector3(0, 1, 0);
    normal.transformDirection(hit.object.matrixWorld).normalize();

    // Tiny lift along surface normal so tip sits on mesh without z-fighting
    const lift = (this.hoverMarker.userData.markerScale || 1) * 0.06;
    this.hoverMarker.position.copy(hit.point).addScaledVector(normal, lift);

    // Always point straight down (world -Y): identity rotation, tip at origin
    this.hoverMarker.quaternion.identity();
  }

  /**
   * Labeled endpoint marker (A / B) for 3D cut line — matches 2D map styling
   */
  createEndpointMarker(label, colorHex, x, y, z) {
    const marker = new THREE.Group();
    marker.position.set(x, y, z);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.75, 20, 20),
      new THREE.MeshBasicMaterial({ color: colorHex })
    );
    marker.add(sphere);

    const outline = new THREE.Mesh(
      new THREE.SphereGeometry(2.03, 20, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        side: THREE.BackSide
      })
    );
    marker.add(outline);

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const hex = '#' + colorHex.toString(16).padStart(6, '0');

    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 64, 70);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false
      })
    );
    sprite.scale.set(7.7, 7.7, 1);
    sprite.position.y = 5.6;
    marker.add(sprite);

    return marker;
  }

  /**
   * Draw one or more vertical cut planes (multi-cut support)
   * @param {Array<{id, color, samples, active}>} cuts
   */
  drawCutLines3D(cuts) {
    if (this.cutPlanesGroup) {
      this.scene.remove(this.cutPlanesGroup);
      this.cutPlanesGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
      this.cutPlanesGroup = null;
    }
    // Legacy single-plane cleanup
    if (this.cutLineMesh) {
      this.scene.remove(this.cutLineMesh);
      this.cutLineMesh = null;
    }

    if (!cuts || cuts.length === 0 || !this.dataLoader) return;

    const group = new THREE.Group();
    const bounds = this.dataLoader.bounds;
    const meanX = bounds.meanX;
    const meanY = bounds.meanY;
    const topY = Math.max(bounds.maxZ, this.waterLevel) * this.zScale + 10;
    const bottomY = bounds.minZ * this.zScale - 10;

    cuts.forEach((cut) => {
      const samples = cut.samples;
      if (!samples || samples.length === 0) return;
      const colorHex = cut.colorHex != null ? cut.colorHex : 0xea580c;
      const opacity = cut.active ? 0.38 : 0.18;

      // Build ribbon path: prefer polyline vertices, else sample endpoints (straight)
      let pathLocal = [];
      if (cut.polyline && cut.polyline.length >= 2) {
        pathLocal = cut.polyline.map((p) => ({
          localX: p.y - meanY, // Easting → East
          localZ: -(p.x - meanX) // −Northing → South
        }));
      } else {
        const sA = samples[0];
        const sB = samples[samples.length - 1];
        pathLocal = [
          { localX: sA.localX, localZ: sA.localZ },
          { localX: sB.localX, localZ: sB.localZ }
        ];
      }

      // Vertical ribbon: consecutive quads along path
      const positions = [];
      const indices = [];
      for (let i = 0; i < pathLocal.length; i++) {
        const p = pathLocal[i];
        positions.push(p.localX, topY, p.localZ);
        positions.push(p.localX, bottomY, p.localZ);
      }
      for (let i = 0; i < pathLocal.length - 1; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
      const planeGeo = new THREE.BufferGeometry();
      planeGeo.setIndex(indices);
      planeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      group.add(new THREE.Mesh(
        planeGeo,
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      ));

      if (cut.active) {
        const label = cut.label || String(cut.id);
        const first = pathLocal[0];
        const last = pathLocal[pathLocal.length - 1];
        group.add(this.createEndpointMarker('A', 0x1e3a8a, first.localX, topY + 4, first.localZ));
        group.add(this.createEndpointMarker('B', colorHex, last.localX, topY + 4, last.localZ));
        // Mid label at half chainage (not index floor — with 2 pts that would be B)
        let midX = (first.localX + last.localX) / 2;
        let midZ = (first.localZ + last.localZ) / 2;
        if (pathLocal.length > 2) {
          let total = 0;
          const lens = [];
          for (let i = 1; i < pathLocal.length; i++) {
            const len = Math.hypot(
              pathLocal[i].localX - pathLocal[i - 1].localX,
              pathLocal[i].localZ - pathLocal[i - 1].localZ
            );
            lens.push(len);
            total += len;
          }
          let target = total / 2;
          for (let i = 0; i < lens.length; i++) {
            if (target <= lens[i] + 1e-9) {
              const t = lens[i] > 1e-9 ? target / lens[i] : 0;
              midX = pathLocal[i].localX + t * (pathLocal[i + 1].localX - pathLocal[i].localX);
              midZ = pathLocal[i].localZ + t * (pathLocal[i + 1].localZ - pathLocal[i].localZ);
              break;
            }
            target -= lens[i];
          }
        }
        group.add(this.createEndpointMarker(label, colorHex, midX, topY + 10, midZ));
      }
    });

    this.cutPlanesGroup = group;
    this.scene.add(this.cutPlanesGroup);
  }

  /** @deprecated Use drawCutLines3D — kept for compatibility */
  drawCutLine3D(profileSamples) {
    if (!profileSamples || profileSamples.length === 0) {
      this.drawCutLines3D([]);
      return;
    }
    this.drawCutLines3D([{
      id: 1,
      label: '1',
      colorHex: 0xea580c,
      samples: profileSamples,
      active: true
    }]);
  }

  /**
   * Reset Camera to default top-isometric view
   */
  resetCamera() {
    if (!this.dataLoader) return;
    const maxSpan = Math.max(this.dataLoader.bounds.spanX, this.dataLoader.bounds.spanY);
    this.controls.target.set(0, (this.dataLoader.bounds.meanZ) * this.zScale, 0);
    this.camera.position.set(0, maxSpan * 0.7, maxSpan * 0.9);
    this.controls.update();
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (this.controls) this.controls.update();

    // Gentle wave animation for water mesh (around waterLevel)
    if (this.waterMesh && this.waterMesh.visible) {
      const time = Date.now() * 0.001;
      this.waterMesh.position.y = this.waterLevel * this.zScale + Math.sin(time * 1.5) * 0.4;
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

window.Scene3D = Scene3D;
