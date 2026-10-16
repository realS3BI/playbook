import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { MAX_FLOOR_DROP, SOURCE_UNIT_METRES, type Vector3 } from "../../../shared/map-scene";

export type MapSceneInfo = { map: string; scene: string; lightmap: string | null; bytes: number };
export type LoadedMapScene = { root: THREE.Group; sunDirection: THREE.Vector3; sunColor: THREE.Color; lit: boolean };
type Progress = (loaded: number, total: number) => void;

// Calibrated against in-game screenshots: the atlas stores irradiance, MeshBasicMaterial divides by π.
const LIGHTMAP_INTENSITY = 2.6;

async function download(url: string, signal: AbortSignal, onBytes: (bytes: number) => void) {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  for (let next = await reader.read(); !next.done; next = await reader.read()) { chunks.push(next.value); onBytes(next.value.byteLength); }
  return new Blob(chunks as BlobPart[]);
}

async function loadScene(info: MapSceneInfo, signal: AbortSignal, onProgress: Progress): Promise<LoadedMapScene> {
  let loaded = 0;
  const count = (bytes: number) => { loaded += bytes; onProgress(loaded, Math.max(info.bytes, loaded)); };
  // Without the atlas the scene still renders with approximate lighting.
  const [scene, atlas] = await Promise.all([
    download(info.scene, signal, count),
    info.lightmap ? download(info.lightmap, signal, count).then(blob => createImageBitmap(blob)).catch(error => { if (signal.aborted) throw error; return null; }) : null,
  ]);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(await scene.arrayBuffer(), "");
  let lightmap: THREE.Texture | null = null;
  if (atlas) {
    lightmap = new THREE.Texture(atlas);
    lightmap.flipY = false;
    lightmap.colorSpace = THREE.SRGBColorSpace;
    lightmap.channel = 1;
    lightmap.needsUpdate = true;
  }
  const sunDirection = new THREE.Vector3(-0.3, -1, -0.2).normalize(), sunColor = new THREE.Color(0xffe2b8);
  const lights: THREE.Object3D[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(object => {
    if ((object as THREE.DirectionalLight).isDirectionalLight) {
      const light = object as THREE.DirectionalLight;
      sunDirection.set(0, 0, -1).applyQuaternion(light.getWorldQuaternion(new THREE.Quaternion())).normalize();
      sunColor.copy(light.color);
    }
    if ((object as THREE.Light).isLight) lights.push(object);
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as THREE.MeshStandardMaterial;
    const common = { map: source.map, color: source.color, transparent: source.transparent, alphaTest: source.alphaTest, side: source.side };
    const material = lightmap && mesh.geometry.getAttribute("uv1")
      ? new THREE.MeshBasicMaterial({ ...common, lightMap: lightmap, lightMapIntensity: LIGHTMAP_INTENSITY })
      : new THREE.MeshLambertMaterial(common);
    if (source.userData?.decal) Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
    source.dispose();
    mesh.material = material;
    mesh.matrixAutoUpdate = false;
  });
  for (const light of lights) light.removeFromParent();
  return { root: gltf.scene, sunDirection, sunColor, lit: !!lightmap };
}

function disposeScene(scene: LoadedMapScene) {
  const textures = new Set<THREE.Texture>();
  scene.root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const material = mesh.material as THREE.MeshBasicMaterial;
    if (material.map) textures.add(material.map);
    if (material.lightMap) textures.add(material.lightMap);
    material.dispose();
  });
  for (const texture of textures) { (texture.image as ImageBitmap)?.close?.(); texture.dispose(); }
}

// One decoded map stays in memory, so switching between lineups of a map is instant.
let cached: { url: string; promise: Promise<LoadedMapScene>; controller: AbortController; users: number; listeners: Set<Progress>; progress: [number, number] } | null = null;

export function acquireMapScene(info: MapSceneInfo, onProgress: Progress) {
  if (cached?.url !== info.scene) {
    const previous = cached;
    if (previous) { previous.controller.abort(); previous.promise.then(disposeScene, () => {}); }
    const controller = new AbortController(), listeners = new Set<Progress>();
    const entry = { url: info.scene, controller, users: 0, listeners, progress: [0, info.bytes] as [number, number], promise: undefined as unknown as Promise<LoadedMapScene> };
    entry.promise = loadScene(info, controller.signal, (loaded, total) => { entry.progress = [loaded, total]; for (const listener of listeners) listener(loaded, total); });
    entry.promise.catch(() => { if (cached === entry) cached = null; });
    cached = entry;
  }
  const entry = cached!;
  entry.users++;
  entry.listeners.add(onProgress);
  onProgress(...entry.progress);
  let released = false;
  return {
    promise: entry.promise,
    release() {
      if (released) return;
      released = true;
      entry.users--;
      entry.listeners.delete(onProgress);
      // Leaving the view before the download finished cancels it instead of spending the data in the background.
      if (!entry.users && entry.progress[0] < entry.progress[1] && cached === entry) { entry.controller.abort(); cached = null; }
    },
  };
}

// Renderer, sky and lights around a loaded map. Throws when the browser cannot create a WebGL context.
export function mountMapScene(canvas: HTMLCanvasElement, loaded: LoadedMapScene) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const sky = createSky();
  const scene = new THREE.Scene();
  scene.background = sky;
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x8a7560, 1.1));
  const sun = new THREE.DirectionalLight(loaded.sunColor, 1.4);
  sun.position.copy(loaded.sunDirection).multiplyScalar(-1);
  scene.add(sun, loaded.root);
  return {
    renderer,
    scene,
    // The map itself stays cached for the next view.
    dispose() { scene.remove(loaded.root); sky.dispose(); renderer.dispose(); },
  };
}

// A plain raycast tests every triangle of the large map meshes, about 50 ms on Mirage. Shots need
// one per bullet, so each opaque mesh gets a bounds tree, built a few meshes per frame while the
// view already runs. The trees stay with the cached map for the next view.
const BVH_BUDGET_MS = 8;
const solidMeshes = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
export function prepareRaycasts(root: THREE.Object3D) {
  let cancelled = false, ready = solidMeshes.get(root) || null;
  if (!ready) {
    const pending: THREE.Mesh[] = [];
    root.traverse(object => {
      const mesh = object as THREE.Mesh, material = mesh.material as THREE.Material;
      if (mesh.isMesh && !material.transparent && !material.alphaTest) pending.push(mesh);
    });
    const built: THREE.Mesh[] = [];
    const step = () => {
      if (cancelled) return;
      const until = performance.now() + BVH_BUDGET_MS;
      while (pending.length && performance.now() < until) {
        const mesh = pending.pop()!;
        mesh.geometry.boundsTree ||= new MeshBVH(mesh.geometry);
        mesh.raycast = acceleratedRaycast;
        built.push(mesh);
      }
      if (pending.length) setTimeout(step, 0);
      else solidMeshes.set(root, ready = built);
    };
    step();
  }
  return {
    /** Opaque map meshes once every bounds tree is built, otherwise null. */
    meshes: () => ready,
    cancel() { cancelled = true; },
  };
}

// First opaque surface below the stored origin, in source units. Leaves, decals and water are skipped.
export function floorBelow(root: THREE.Object3D, position: Vector3) {
  const start = new THREE.Vector3(position[0], position[1] + 8 * SOURCE_UNIT_METRES, position[2]);
  const ray = new THREE.Raycaster(start, new THREE.Vector3(0, -1, 0), 0, (MAX_FLOOR_DROP + 8) * SOURCE_UNIT_METRES);
  const hit = ray.intersectObject(root, true).find(({ object }) => {
    const material = (object as THREE.Mesh).material as THREE.Material;
    return !material.transparent && !material.alphaTest;
  });
  return hit ? hit.point.y / SOURCE_UNIT_METRES : null;
}

// Like the game's auto exposure: brighten or darken the view by the log-average luminance of the
// map geometry. The sky is left out so that looking upwards does not darken the buildings.
// Mirage at exposure 1 matches in-game screenshots; Ancient's shaded jungle needs about five times as much.
const EXPOSURE_KEY = 0.08;
export function viewExposure(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const width = 64, height = 36;
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
  const background = scene.background, clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  try {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint16Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    let sum = 0, count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (THREE.DataUtils.fromHalfFloat(pixels[i + 3]) < 0.5) continue;
      const [r, g, b] = [0, 1, 2].map(offset => THREE.DataUtils.fromHalfFloat(pixels[i + offset]));
      sum += Math.log(1e-4 + 0.2126 * r + 0.7152 * g + 0.0722 * b);
      count++;
    }
    return count < width * height * 0.05 ? 1 : THREE.MathUtils.clamp(EXPOSURE_KEY / Math.exp(sum / count), 0.7, 6);
  } catch {
    return 1;
  } finally {
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, alpha);
    scene.background = background;
    target.dispose();
  }
}

export function createSky() {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#3d79c4");
  gradient.addColorStop(0.55, "#8fb5de");
  gradient.addColorStop(1, "#d9e4ee");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
