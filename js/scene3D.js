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
    this.wireframeMesh = null;
    this.pointCloud = null;
    this.waterMesh = null;
    this.cutLineMesh = null;
    this.gridHelper = null;
    this.contoursGroup = null;
    this.hoverMarker = null;

    // Raycaster for Hover Inspector
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Parameters
    this.renderMode = 'surface'; // 'surface', 'wireframe', 'points', 'both'
    this.zScale = 3.0; // Z exaggeration factor
    this.colorPalette = 'bathymetry';
    this.showWater = true;
    this.showContours = true;

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
    if (this.wireframeMesh) this.scene.remove(this.wireframeMesh);
    if (this.pointCloud) this.scene.remove(this.pointCloud);
    if (this.waterMesh) this.scene.remove(this.waterMesh);
    if (this.gridHelper) this.scene.remove(this.gridHelper);

    if (!grid || grid.length === 0) return;

    const rows = grid.length;
    const cols = grid[0].length;

    // 1. Build Terrain Surface Mesh Geometry using BufferGeometry
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const uvs = [];
    const indices = [];

    // Populate vertices
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = grid[r][c];

        // Apply Z scale exaggeration
        const x3d = p.localX;
        const y3d = p.localY * this.zScale;
        const z3d = p.localZ;

        positions.push(x3d, y3d, z3d);

        // Color based on normalized depth
        const rgb = ColorRamps.getColor(p.normZ, this.colorPalette);
        colors.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

        uvs.push(r / (rows - 1), c / (cols - 1));
      }
    }

    // Build grid face indices (2 triangles per quad)
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = r * cols + (c + 1);
        const cIdx = (r + 1) * cols + (c + 1);
        const d = (r + 1) * cols + c;

        indices.push(a, b, d);
        indices.push(b, cIdx, d);
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

    // 4. Water Surface Plane (Z=0)
    const waterWidth = bounds.spanX * 1.3;
    const waterHeight = bounds.spanY * 1.3;
    const waterGeo = new THREE.PlaneGeometry(waterWidth, waterHeight, 32, 32);
    waterGeo.rotateX(-Math.PI / 2);

    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.35,
      roughness: 0.2,
      metalness: 0.5,
      transmission: 0.7,
      ior: 1.333,
      side: THREE.DoubleSide
    });
    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.set(0, 0, 0); // Water level Z=0
    this.scene.add(this.waterMesh);

    // 5. Grid Helper at bottom
    const maxSpan = Math.max(bounds.spanX, bounds.spanY) * 1.5;
    this.gridHelper = new THREE.GridHelper(maxSpan, 20, 0x1e3a8a, 0xcbd5e1);
    this.gridHelper.position.y = bounds.minZ * this.zScale - 20;
    this.scene.add(this.gridHelper);

    // 6. Create Hover Marker Sphere
    const markerGeo = new THREE.SphereGeometry(3, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xea580c, wireframe: true });
    this.hoverMarker = new THREE.Mesh(markerGeo, markerMat);
    this.hoverMarker.visible = false;
    this.scene.add(this.hoverMarker);

    // 7. Draw 3D Contour Lines
    this.drawContours3D();

    // 8. Setup Raycaster Pointer Move Listener
    this.setupRaycaster();

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

    const contours = this.dataLoader.generateContours();
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

        // Position hover sphere
        if (this.hoverMarker) {
          this.hoverMarker.position.copy(p);
          this.hoverMarker.visible = true;
        }

        // Convert 3D local coords back to UTM VN-2000
        const utmX = p.x + this.dataLoader.bounds.meanX;
        const utmY = -p.z + this.dataLoader.bounds.meanY;
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

        // Update HUD Inspector elements
        document.getElementById('hudPointID').textContent = nearestID;
        document.getElementById('hudX').textContent = utmX.toFixed(2) + ' m';
        document.getElementById('hudY').textContent = utmY.toFixed(2) + ' m';
        document.getElementById('hudZ').textContent = depthZ.toFixed(2) + ' m (' + (-depthZ).toFixed(2) + 'm sâu)';
      } else {
        if (this.hoverMarker) this.hoverMarker.visible = false;
      }
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
            pos[idx + 1] = grid[r][c].localY * scale; // Update Y elevation
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
    if (window.crossSection && window.crossSection.pointA && window.crossSection.pointB) {
      window.crossSection.updateProfile();
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
            const rgb = ColorRamps.getColor(grid[r][c].normZ, paletteName);
            colors[idx] = rgb[0] / 255;
            colors[idx + 1] = rgb[1] / 255;
            colors[idx + 2] = rgb[2] / 255;
            idx += 3;
          }
        }
        colorAttr.needsUpdate = true;
      }
    }

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
   * Draw 3D Cross Section Cut Line, Vertical Cut Plane, and A/B endpoints
   */
  drawCutLine3D(profileSamples) {
    if (this.cutLineMesh) {
      this.scene.remove(this.cutLineMesh);
      this.cutLineMesh.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
      this.cutLineMesh = null;
    }

    if (!profileSamples || profileSamples.length === 0) return;

    const group = new THREE.Group();

    // 1. Top 3D Line
    const linePositions = [];
    const planePositions = [];
    const planeIndices = [];

    for (let i = 0; i < profileSamples.length; i++) {
      const s = profileSamples[i];
      const x = s.localX;
      const y = s.localY * this.zScale + 2; // Slightly above terrain
      const z = s.localZ;

      linePositions.push(x, y, z);

      // Vertical plane vertices down to bottom
      const bottomY = this.dataLoader.bounds.minZ * this.zScale - 10;
      planePositions.push(x, y, z);         // Top vertex
      planePositions.push(x, bottomY, z);   // Bottom vertex
    }

    // Line Geometry
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0xea580c, linewidth: 3 });
    const line = new THREE.Line(lineGeo, lineMat);
    group.add(line);

    // Vertical Cut Curtain Mesh
    const n = profileSamples.length;
    for (let i = 0; i < n - 1; i++) {
      const topA = i * 2;
      const botA = i * 2 + 1;
      const topB = (i + 1) * 2;
      const botB = (i + 1) * 2 + 1;

      planeIndices.push(topA, botA, topB);
      planeIndices.push(botA, botB, topB);
    }

    const planeGeo = new THREE.BufferGeometry();
    planeGeo.setIndex(planeIndices);
    planeGeo.setAttribute('position', new THREE.Float32BufferAttribute(planePositions, 3));

    const planeMat = new THREE.MeshBasicMaterial({
      color: 0xea580c,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    const curtain = new THREE.Mesh(planeGeo, planeMat);
    group.add(curtain);

    // Endpoint markers A (start) and B (end) — same colors as 2D Leaflet markers
    const sA = profileSamples[0];
    const sB = profileSamples[profileSamples.length - 1];
    const yA = sA.localY * this.zScale + 4;
    const yB = sB.localY * this.zScale + 4;

    group.add(this.createEndpointMarker('A', 0x1e3a8a, sA.localX, yA, sA.localZ));
    group.add(this.createEndpointMarker('B', 0xea580c, sB.localX, yB, sB.localZ));

    this.cutLineMesh = group;
    this.scene.add(this.cutLineMesh);
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

    // Gentle wave animation for water mesh
    if (this.waterMesh && this.waterMesh.visible) {
      const time = Date.now() * 0.001;
      this.waterMesh.position.y = Math.sin(time * 1.5) * 0.4;
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

window.Scene3D = Scene3D;
