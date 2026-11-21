import * as THREE from "./three.module.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const fract = value => value - Math.floor(value);
const hash = (x, z) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);
function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), sx);
  const b = THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx);
  return THREE.MathUtils.lerp(a, b, sz);
}

export function createFlight3DWorld(canvas, state, runway, landingTarget, trees, buildings, hills) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.13;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xa9b6a0, 14000, 42000);
  const camera = new THREE.PerspectiveCamera(56, 1, 0.12, 65000);
  const hemi = new THREE.HemisphereLight(0xe2f2ff, 0x59644a, 2.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffedcc, 2.5);
  sun.position.set(-900, 1800, 1200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -1800;
  sun.shadow.camera.right = 1800;
  sun.shadow.camera.top = 1800;
  sun.shadow.camera.bottom = -1800;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 6000;
  sun.shadow.bias = -0.00015;
  scene.add(sun);

  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: "varying vec3 vSkyDir; void main(){ vSkyDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: "varying vec3 vSkyDir; void main(){ float h=normalize(vSkyDir).y; vec3 low=vec3(0.64,0.73,0.76); vec3 horizon=vec3(0.73,0.82,0.86); vec3 blue=vec3(0.30,0.56,0.79); vec3 zenith=vec3(0.20,0.40,0.66); vec3 c=mix(low,horizon,smoothstep(-0.22,0.015,h)); c=mix(c,blue,smoothstep(0.015,0.42,h)); c=mix(c,zenith,smoothstep(0.42,0.96,h)); gl_FragColor=vec4(c,1.0); }"
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(58000, 40, 24), skyMaterial);
  sky.frustumCulled = false;
  scene.add(sky);
  const sunDisk = new THREE.Mesh(new THREE.SphereGeometry(95, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffedc0 }));
  sunDisk.position.set(-5200, 3600, -18000);
  scene.add(sunDisk);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);
  const worldBounds = { minX: -12000, maxX: 12000, minZ: -18000, maxZ: 12000 };
  const airportRadius = (x, z) => {
    const xFade = smooth(260, 1050, Math.abs(x));
    const zOutside = Math.max(-3900 - z, z - 820, 0);
    return Math.max(xFade, smooth(0, 850, zOutside));
  };
  const terrainHeightAt = (x, z) => {
    let h = 2.6 + (noise2(x * 0.0011, z * 0.0011) - 0.5) * 18 + (noise2(x * 0.0038 + 31, z * 0.0038 - 19) - 0.5) * 5;
    for (const hill of hills) {
      const radius = Math.hypot((x - hill.x) / hill.rx, (z - hill.z) / hill.rz);
      if (radius >= 1) continue;
      const t = clamp((1 - radius) / 0.84, 0, 1);
      h = Math.max(h, hill.heightM * t * t * (3 - 2 * t));
    }
    return Math.max(0, h * airportRadius(x, z));
  };

  function makeTerrain() {
    const nx = 241, nz = 301;
    const positions = new Float32Array(nx * nz * 3);
    const colors = new Float32Array(nx * nz * 3);
    const indices = [];
    const palette = ["#768952", "#819153", "#907d51", "#6c824d", "#58734a", "#405b3c"].map(c => new THREE.Color(c));
    const airportGreen = new THREE.Color("#687d4b");
    let ptr = 0;
    for (let iz = 0; iz < nz; iz++) {
      const z = worldBounds.maxZ - (worldBounds.maxZ - worldBounds.minZ) * iz / (nz - 1);
      for (let ix = 0; ix < nx; ix++) {
        const x = worldBounds.minX + (worldBounds.maxX - worldBounds.minX) * ix / (nx - 1);
        const p = (iz * nx + ix) * 3;
        positions[p] = x;
        positions[p + 1] = terrainHeightAt(x, z);
        positions[p + 2] = z;
        const fields = noise2(x * 0.0022 + 8, z * 0.0022 - 7);
        const forest = noise2(x * 0.0010 - 38, z * 0.0010 + 23);
        const detail = noise2(x * 0.010 + 4, z * 0.010 + 18);
        const fieldBand = Math.floor(fields * 4);
        const color = palette[fieldBand].clone();
        const forestBlend = clamp((forest - 0.48) * 2.5, 0, 0.82);
        color.lerp(palette[4 + (detail > 0.53 ? 1 : 0)], forestBlend);
        color.lerp(airportGreen, 1 - airportRadius(x, z));
        const light = 0.91 + detail * 0.15;
        colors[p] = color.r * light;
        colors[p + 1] = color.g * light;
        colors[p + 2] = color.b * light;
        if (ix < nx - 1 && iz < nz - 1) {
          const a = iz * nx + ix, b = a + 1, c = a + nx, d = c + 1;
          indices.push(a, b, c, b, d, c);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    mesh.receiveShadow = true;
    worldGroup.add(mesh);
  }
  makeTerrain();

  const mat = (color, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const asphalt = mat(0x3b4143, 0.93), concrete = mat(0x777d79, 0.95), lineWhite = mat(0xf3f2e7, 0.75);
  const taxiYellow = mat(0xe4c74a, 0.82), hangarWall = mat(0xc3c6ba), hangarRoof = mat(0x757f80), darkGlass = mat(0x304e5c, 0.28, 0.1);
  function box(w, h, d, material, x, y, z, parent = worldGroup, shadows = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function runwayMark(number, z) {
    const c = document.createElement("canvas"); c.width = 320; c.height = 160;
    const g = c.getContext("2d"); g.fillStyle = "#f4f2e8"; g.font = "900 118px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(number), 160, 82);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(17, 8), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    sign.rotation.x = -Math.PI / 2; sign.position.set(0, 0.075, z); worldGroup.add(sign);
  }
  const runwayLength = runway.start - runway.end;
  box(runway.right - runway.left, 0.06, runwayLength, asphalt, 0, 0.03, (runway.start + runway.end) / 2);
  box(0.55, 0.012, runwayLength - 18, lineWhite, runway.left + 1.4, 0.066, (runway.start + runway.end) / 2, worldGroup, false);
  box(0.55, 0.012, runwayLength - 18, lineWhite, runway.right - 1.4, 0.066, (runway.start + runway.end) / 2, worldGroup, false);
  for (let z = runway.start - 70; z > runway.end + 50; z -= 112) box(1.25, 0.012, 24, lineWhite, 0, 0.066, z, worldGroup, false);
  for (const z of [runway.start - 9, runway.end + 9]) {
    for (let i = 0; i < 10; i++) box(2.1, 0.014, 17, lineWhite, -18 + i * 4, 0.067, z, worldGroup, false);
  }
  runwayMark(36, runway.start - 83);
  runwayMark(18, runway.end + 83);
  box(14, 0.08, runwayLength + 400, concrete, 69, 0.04, (runway.start + runway.end) / 2 - 80);
  box(0.45, 0.014, runwayLength + 160, taxiYellow, 69, 0.09, (runway.start + runway.end) / 2 - 80, worldGroup, false);
  for (const z of [-900, -2100]) box(48, 0.08, 9, concrete, 45, 0.04, z);
  box(192, 0.08, 315, concrete, -91, 0.04, -475);
  box(192, 0.08, 315, concrete, 91, 0.04, -475);
  const edgeLamp = new THREE.Mesh(new THREE.SphereGeometry(0.48, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd4e8ff, emissive: 0x536981, roughness: 0.3 }));
  const lampInstances = new THREE.InstancedMesh(edgeLamp.geometry, edgeLamp.material, 220);
  const lampDummy = new THREE.Object3D(); let lampIndex = 0;
  for (let z = runway.start - 25; z > runway.end + 20; z -= 58) for (const x of [runway.left - 4, runway.right + 4]) {
    lampDummy.position.set(x, 0.58, z); lampDummy.scale.setScalar(1); lampDummy.updateMatrix(); lampInstances.setMatrixAt(lampIndex++, lampDummy.matrix);
  }
  lampInstances.count = lampIndex; worldGroup.add(lampInstances);
  const papiLights = [];
  for (let i = 0; i < 4; i++) {
    const material = new THREE.MeshStandardMaterial({ color: 0xf5f3e8, emissive: 0xf5f3e8, emissiveIntensity: 1.35 });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.82, 10, 8), material);
    light.position.set(-31 + i * 2.2, 0.8, runway.start - 24); worldGroup.add(light); papiLights.push(light);
  }

  function addBuildings() {
    for (const b of buildings) {
      const shell = box(b.w, b.h, b.d, hangarWall, b.x, b.h / 2, b.z);
      const roof = box(b.w + 1.5, 0.7, b.d + 1.5, hangarRoof, b.x, b.h + 0.24, b.z);
      roof.rotation.z = (b.x < 0 ? -1 : 1) * 0.035;
      const facing = b.x < 0 ? 1 : -1;
      box(0.12, b.h * 0.58, b.d * 0.56, mat(0x47545a), b.x + facing * (b.w / 2 + 0.08), b.h * 0.34, b.z);
      if (b.h > 13) {
        for (let i = -1; i <= 1; i++) box(0.1, 2.2, 3.8, darkGlass, b.x + facing * (b.w / 2 + 0.09), b.h * 0.77, b.z + i * b.d * 0.19, worldGroup, false);
      }
      shell.castShadow = true;
    }
    const tower = box(15, 31, 15, mat(0xb8b9ae), -330, 15.5, -1170);
    box(22, 7, 22, mat(0x50616a), -330, 34.5, -1170);
    box(24, 1.4, 24, mat(0x87928d), -330, 38.8, -1170);
    tower.castShadow = true;
    box(104, 8, 55, mat(0xc4c1b2), 265, 4, -640);
    box(112, 1, 59, mat(0x8b9390), 265, 8.2, -640);
  }
  addBuildings();

  function addTrees() {
    const trunkGeo = new THREE.CylinderGeometry(0.23, 0.42, 4.2, 6);
    const crownGeo = new THREE.ConeGeometry(3.2, 8.2, 7);
    const crown2Geo = new THREE.ConeGeometry(2.35, 6.1, 7);
    const trunkMat = mat(0x554832), crownMats = [mat(0x35583c), mat(0x406541), mat(0x4a6c43)];
    const count = trees.length + 2350;
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crowns = crownMats.map(m => new THREE.InstancedMesh(crownGeo, m, count));
    const crowns2 = crownMats.map(m => new THREE.InstancedMesh(crown2Geo, m, count));
    const d = new THREE.Object3D(); let n = 0;
    const place = (x, z, scale) => {
      const y = terrainHeightAt(x, z);
      d.position.set(x, y + 2.1 * scale, z); d.scale.setScalar(scale); d.rotation.y = hash(Math.round(x), Math.round(z)) * Math.PI * 2; d.updateMatrix(); trunk.setMatrixAt(n, d.matrix);
      const variant = Math.floor(hash(Math.round(x * 1.3), Math.round(z * 0.8)) * 3);
      d.position.set(x, y + 6.2 * scale, z); d.scale.set(scale, scale, scale); d.updateMatrix(); crowns[variant].setMatrixAt(n, d.matrix);
      d.position.set(x, y + 9.2 * scale, z); d.scale.setScalar(scale * 0.74); d.updateMatrix(); crowns2[variant].setMatrixAt(n, d.matrix);
      n++;
    };
    for (const t of trees) if (Math.abs(t.x) > 90) place(t.x, t.z, clamp(t.size / 7.5, 0.65, 1.25));
    let seed = 4119;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 2350; i++) {
      let x, z;
      if (i < 1300) { const h = hills[i % hills.length]; const angle = random() * Math.PI * 2; const radius = 0.45 + random() * 0.9; x = h.x + Math.cos(angle) * h.rx * radius; z = h.z + Math.sin(angle) * h.rz * radius; }
      else { x = (random() - 0.5) * 22000; z = (random() - 0.5) * 27000; }
      if (Math.abs(x) < 115 && z < runway.start + 200 && z > runway.end - 200) continue;
      if (Math.abs(x) < 520 && z > -3950 && z < 850 && random() < 0.86) continue;
      place(x, z, 0.55 + random() * 0.8);
    }
    trunk.count = n; for (const c of crowns) c.count = n; for (const c of crowns2) c.count = n;
    trunk.castShadow = true; for (const c of crowns) c.castShadow = true;
    worldGroup.add(trunk, ...crowns, ...crowns2);
  }
  addTrees();

  function addClouds() {
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f4, roughness: 1, transparent: true, opacity: 0.93 });
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0xc5d2d8, roughness: 1, transparent: true, opacity: 0.76 });
    const cloudGeo = new THREE.SphereGeometry(1, 12, 8);
    const bright = new THREE.InstancedMesh(cloudGeo, cloudMat, 900);
    const shaded = new THREE.InstancedMesh(cloudGeo, shadeMat, 300);
    const dummy = new THREE.Object3D();
    let brightCount = 0, shadeCount = 0;
    let seed = 83; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 82; i++) {
      const baseX = (random() - 0.5) * 26000, baseZ = (random() - 0.5) * 33000;
      const baseY = 900 + random() * 1200;
      const scale = 30 + random() * 90;
      for (let j = 0; j < 6 + Math.floor(random() * 7); j++) {
        const target = j % 4 === 0 ? shaded : bright;
        dummy.position.set(baseX + (random() - 0.5) * scale * 2.3, baseY + random() * scale * 0.42, baseZ + (random() - 0.5) * scale * 1.2);
        dummy.scale.set(scale * (0.6 + random() * 0.85), scale * (0.33 + random() * 0.3), scale * (0.54 + random() * 0.8));
        dummy.rotation.set(0, random() * Math.PI * 2, 0); dummy.updateMatrix();
        if (target === shaded) target.setMatrixAt(shadeCount++, dummy.matrix); else target.setMatrixAt(brightCount++, dummy.matrix);
      }
    }
    bright.count = brightCount; shaded.count = shadeCount;
    bright.instanceMatrix.needsUpdate = true; shaded.instanceMatrix.needsUpdate = true;
    scene.add(bright, shaded);
    return [bright, shaded];
  }
  const clouds = addClouds();

  const aircraft = new THREE.Group();
  scene.add(aircraft);
  const planeWhite = mat(0xe4e8e3, 0.45, 0.12), planeTop = mat(0xf2f2eb, 0.38, 0.12), blue = mat(0x244a60, 0.35, 0.16), red = mat(0xd34e47, 0.35), green = mat(0x33a883, 0.36), rubber = mat(0x171b1d, 0.92), steel = mat(0x56646a, 0.55, 0.35);
  function cylinderBetween(parent, a, b, radius, material, radial = 8) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), direction = vb.clone().sub(va);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.78, radius, direction.length(), radial), material);
    mesh.position.copy(va.add(vb).multiplyScalar(0.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function horizontalShape(points, material, parent, y = 0) {
    const shape = new THREE.Shape(); shape.moveTo(points[0][0], -points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], -points[i][1]);
    shape.closePath();
    const doubleSided = material.clone(); doubleSided.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.055, bevelEnabled: false }), doubleSided);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function verticalShape(points, material, parent, z = 0) {
    const shape = new THREE.Shape(); shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const doubleSided = material.clone(); doubleSided.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), doubleSided); mesh.position.z = z; mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function fuselage() {
    const rings = [[-4.55, .055, .07], [-4.25, .20, .19], [-3.6, .31, .27], [-2.2, .39, .34], [0.9, .43, .36], [2.6, .32, .29], [3.65, .19, .17], [3.98, .08, .08]];
    const sides = 16, positions = [], indices = [];
    for (const [z, rx, ry] of rings) for (let i = 0; i <= sides; i++) {
      const angle = i / sides * Math.PI * 2;
      positions.push(Math.cos(angle) * rx, 0.1 + Math.sin(angle) * ry, z);
    }
    for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < sides; i++) {
      const a = r * (sides + 1) + i, b = a + 1, c = a + sides + 1, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, planeWhite); mesh.castShadow = true; aircraft.add(mesh);
  }
  fuselage();
  horizontalShape([[-.78, -1.08], [-6.45, -.48], [-6.18, .72], [-.78, .76], [.78, .76], [6.18, .72], [6.45, -.48], [.78, -1.08]], planeTop, aircraft, .23);
  horizontalShape([[-.75, 3.0], [-1.72, 3.38], [-1.45, 4.05], [1.45, 4.05], [1.72, 3.38], [.75, 3.0]], planeTop, aircraft, .26);
  verticalShape([[-.48, .08], [-.38, .15], [-.28, 1.42], [.0, 1.72], [.28, 1.42], [.38, .15], [.48, .08]], planeWhite, aircraft, 3.22);
  verticalShape([[-.11, .46], [-.08, 1.48], [0, 1.59], [.08, 1.48], [.11, .46]], red, aircraft, 3.275);
  const windows = mat(0x315369, 0.25, 0.15);
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.2, 0.48), windows);
    pane.position.set(side * 0.39, 0.34, -1.2 + i * 0.65); aircraft.add(pane);
  }
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.34, 0.08), windows); windshield.position.set(0, 0.41, -2.72); windshield.rotation.x = -0.28; aircraft.add(windshield);
  horizontalShape([[-5.8, -.52], [-6.42, -.48], [-6.12, .11], [-5.62, .15]], red, aircraft, .285);
  horizontalShape([[5.8, -.52], [6.42, -.48], [6.12, .11], [5.62, .15]], green, aircraft, .285);

  const flapPivots = [];
  for (const side of [-1, 1]) {
    const flap = new THREE.Group(); flap.position.set(0, .245, .14); aircraft.add(flap);
    const x0 = side < 0 ? -4.0 : 1.15, x1 = side < 0 ? -1.15 : 4.0;
    horizontalShape([[x0, 0], [x1, 0], [x1, .55], [x0, .55]], mat(0xb7c3c3), flap, 0);
    flapPivots.push(flap);
    const aileron = new THREE.Group(); aileron.position.set(0, .24, -.12); aircraft.add(aileron);
    const ax0 = side < 0 ? -5.55 : 4.15, ax1 = side < 0 ? -4.12 : 5.55;
    horizontalShape([[ax0, 0], [ax1, 0], [ax1, .55], [ax0, .55]], mat(0xc6d0cf), aileron, 0);
    flapPivots.push(aileron);
  }
  const elevator = new THREE.Group(); elevator.position.set(0, .275, 3.36); aircraft.add(elevator);
  horizontalShape([[-1.38, 0], [1.38, 0], [1.2, .46], [-1.2, .46]], planeWhite, elevator);
  const rudder = new THREE.Group(); rudder.position.set(0, .43, 3.3); aircraft.add(rudder);
  verticalShape([[-.08, 0], [.08, 0], [.25, .91], [-.12, .91]], red, rudder, 0);

  const struts = new THREE.Group(), wheels = [];
  aircraft.add(struts);
  for (const [x, z, isNose] of [[-.82, .55, false], [.82, .55, false], [0, -2.9, true]]) {
    const rootY = isNose ? -.12 : -.08, wheelY = isNose ? -.51 : -.43;
    cylinderBetween(struts, [x, rootY, z], [x, wheelY, z], isNose ? .055 : .07, steel, 7);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(isNose ? .26 : .34, isNose ? .26 : .34, .18, 12), rubber);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(x, wheelY - .06, z); wheel.castShadow = true; struts.add(wheel); wheels.push(wheel);
  }
  const prop = new THREE.Group(); prop.position.set(0, 0.12, -4.42); aircraft.add(prop);
  const propBlade = new THREE.Mesh(new THREE.BoxGeometry(.16, 2.55, .08), mat(0x29363a, .4)); prop.add(propBlade);
  const propTip1 = new THREE.Mesh(new THREE.BoxGeometry(.17, .32, .09), red); propTip1.position.y = 1.14; prop.add(propTip1);
  const propTip2 = propTip1.clone(); propTip2.position.y = -1.14; prop.add(propTip2);
  const spinner = new THREE.Mesh(new THREE.SphereGeometry(.22, 12, 8), red); spinner.scale.set(1, 1, .52); spinner.position.z = -.07; prop.add(spinner);
  const gearParts = new THREE.Group(); gearParts.add(struts); aircraft.add(gearParts);

  const guideGroup = new THREE.Group(); scene.add(guideGroup);
  const guideDotGeo = new THREE.SphereGeometry(.46, 8, 6);
  const guideMat = new THREE.MeshStandardMaterial({ color: 0x52ff7c, emissive: 0x21b84b, emissiveIntensity: 1.25, roughness: .3 });
  const guideDots = [];
  for (let i = 0; i < 48; i++) { const dot = new THREE.Mesh(guideDotGeo, guideMat); guideGroup.add(dot); guideDots.push(dot); }
  const targetRing = new THREE.Mesh(new THREE.TorusGeometry(10, .36, 8, 36), guideMat); targetRing.rotation.x = Math.PI / 2; guideGroup.add(targetRing);

  const cockpitGroup = new THREE.Group(); camera.add(cockpitGroup); scene.add(camera);
  const dashMat = mat(0x18262d, .72), trim = mat(0x586b70, .48), gaugeFace = mat(0x09151b, .55), gaugeNeedle = mat(0xf2cb68, .36);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(3.5, .62, .52), dashMat); dash.position.set(0, -1.08, -2.2); cockpitGroup.add(dash);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(3.35, .12, .6), trim); brow.position.set(0, -.72, -2.15); cockpitGroup.add(brow);
  for (let i = 0; i < 5; i++) {
    const x = -1.22 + i * .61;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .04, 24), gaugeFace); face.rotation.x = Math.PI / 2; face.position.set(x, -1.04, -1.91); cockpitGroup.add(face);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(.024, .22, .022), gaugeNeedle); hand.position.set(x, -1.04, -1.88); hand.rotation.z = (i * .71) - .8; cockpitGroup.add(hand);
  }
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(.25, .035, 8, 24), steel); yoke.position.set(0, -.86, -1.65); cockpitGroup.add(yoke);
  cockpitGroup.visible = false;

  function updateGuide() {
    const visible = state.mode === "landing" && state.guideVisible && !state.crashed && !(state.grounded && state.landings > 0);
    guideGroup.visible = visible;
    if (!visible) return;
    const dx = landingTarget.x - state.x, dz = landingTarget.z - state.z;
    const distance = Math.hypot(dx, dz);
    for (let i = 0; i < guideDots.length; i++) {
      const t = (i + 1) / (guideDots.length + 1);
      const x = state.x + dx * t, z = state.z + dz * t;
      const y = Math.max(state.y * (1 - t) + 1.4 * t, terrainHeightAt(x, z) + 6 * (1 - t));
      const dot = guideDots[i]; dot.position.set(x, y, z); dot.visible = distance > 15 && i % (distance > 1300 ? 2 : 1) === 0;
    }
    targetRing.position.set(landingTarget.x, terrainHeightAt(landingTarget.x, landingTarget.z) + 1.3, landingTarget.z);
  }

  let cameraReady = false;
  const cameraPosition = new THREE.Vector3(), cameraAim = new THREE.Vector3();
  function render(currentState, dt = 1 / 60) {
    const heading = currentState.heading, fx = Math.sin(heading), fz = -Math.cos(heading);
    aircraft.position.set(currentState.x, currentState.y + 0.89, currentState.z);
    aircraft.rotation.order = "YXZ";
    aircraft.rotation.set(currentState.pitch * 0.36, -heading, -currentState.roll * 0.72, "YXZ");
    aircraft.visible = currentState.viewMode === "exterior";
    flapPivots[0].rotation.x = currentState.flaps / 20 * .32;
    flapPivots[1].rotation.x = currentState.flaps / 20 * .32;
    flapPivots[2].rotation.x = clamp(currentState.roll * .11, -.16, .16);
    flapPivots[3].rotation.x = -clamp(currentState.roll * .11, -.16, .16);
    elevator.rotation.x = clamp(currentState.pitch * .13, -.18, .18);
    rudder.rotation.y = clamp(currentState.rudder * .18, -.2, .2);
    const gearBlend = clamp(currentState.gearBlend ?? (currentState.gearDown ? 1 : 0), 0, 1);
    gearParts.visible = gearBlend > .015;
    gearParts.position.y = (1 - gearBlend) * .42;
    prop.rotation.z += dt * (3 + currentState.throttle * 55);
    const rangeToThreshold = Math.max(1, Math.hypot(currentState.x - landingTarget.x, currentState.z - landingTarget.z));
    const glideAngle = Math.atan2(Math.max(0, currentState.y), rangeToThreshold);
    const whitePapi = clamp(Math.round(2 + (glideAngle - .0524) / .012), 0, 4);
    for (let i = 0; i < papiLights.length; i++) {
      const material = papiLights[i].material;
      material.color.setHex(i < whitePapi ? 0xf5f3e8 : 0xe52b37);
      material.emissive.setHex(i < whitePapi ? 0xf5f3e8 : 0xe52b37);
    }
    updateGuide();

    const exterior = currentState.viewMode === "exterior";
    cockpitGroup.visible = !exterior;
    if (exterior) {
      const targetPos = new THREE.Vector3(currentState.x - fx * 18, currentState.y + 6.2, currentState.z - fz * 18);
      const targetAim = new THREE.Vector3(currentState.x + fx * 11, currentState.y + 1.25, currentState.z + fz * 11);
      if (!cameraReady) { cameraPosition.copy(targetPos); cameraAim.copy(targetAim); cameraReady = true; }
      const blend = 1 - Math.exp(-Math.max(dt, 0) / .12);
      cameraPosition.lerp(targetPos, blend); cameraAim.lerp(targetAim, blend);
      camera.position.copy(cameraPosition); camera.lookAt(cameraAim);
    } else {
      cameraReady = false;
      camera.position.set(currentState.x + fx * 1.08, currentState.y + 2.06, currentState.z + fz * 1.08);
      const yaw = -heading, pitch = currentState.pitch * .22;
      camera.rotation.order = "YXZ";
      camera.rotation.set(pitch, yaw, -currentState.roll * .12, "YXZ");
    }
    clouds[0].position.x += dt * .34;
    clouds[1].position.x += dt * .34;
    if (clouds[0].position.x > 15500) clouds[0].position.x = -15500;
    if (clouds[1].position.x > 15500) clouds[1].position.x = -15500;
    renderer.render(scene, camera);
  }
  function resize(width, height, pixelRatio = 1) {
    renderer.setPixelRatio(Math.min(pixelRatio, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }
  return { render, resize, terrainHeightAt };
}
