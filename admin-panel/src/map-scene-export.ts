import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { mapSceneSourcePath, type SceneBuild } from "./map-scenes.js";

const EXPORT_TIMEOUT_MS = 15 * 60 * 1000;

function runViewer(executable: string, args: string[], signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], signal, timeout: EXPORT_TIMEOUT_MS });
    let tail = "";
    const keep = (chunk: Buffer) => { tail = (tail + chunk.toString("utf8")).slice(-4000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`Source 2 Viewer endete mit Code ${code}: ${tail.trim().split("\n").slice(-6).join(" | ")}`)));
  });
}

// Tool brushes, sky cards, light shafts and water caustics are invisible or additive in game.
export function hiddenSceneMaterial(vmat: { Name?: string; ShaderName?: string } | undefined) {
  const name = String(vmat?.Name || "").toLowerCase(), shader = String(vmat?.ShaderName || "").toLowerCase();
  return name.startsWith("materials/tools/") || shader.startsWith("tools_") || shader.includes("sky") || shader === "csgo_effects.vfx" || name.includes("caustic");
}

// The irradiance atlas holds the baked lighting of all lightmapped world geometry.
export async function exportMapSources({ viewer, gameDir, map, workDir, signal }: { viewer: string; gameDir: string; map: string; workDir: string; signal?: AbortSignal }) {
  const archive = mapSceneSourcePath(gameDir, map), game = join(gameDir, "csgo", "gameinfo.gi");
  await mkdir(workDir, { recursive: true });
  // Without --gltf_textures_adapt the colour textures keep their alpha, which shapes decals such as the bombsite letters.
  await runViewer(viewer, ["-i", archive, "--vpk_filepath", `maps/${map}/world.vwrld_c`, "-d", "--gltf_export_format", "glb",
    "--gltf_export_materials", "-o", join(workDir, "world"), "--game", game], signal);
  const world = join(workDir, "world.glb");
  await stat(world);
  let lightmap: string | null = join(workDir, "irradiance.png");
  try {
    await runViewer(viewer, ["-i", archive, "--vpk_filepath", `maps/${map}/lightmaps/irradiance.vtex_c`, "--texture_decode_flags", "ForceLDR",
      "-d", "-o", lightmap, "--game", game], signal);
    await stat(lightmap);
  } catch (error) {
    if (signal?.aborted) throw error;
    lightmap = null;
  }
  return { world, lightmap };
}

// Source 2 Viewer keeps every UV set in shader order. The lightmap set lies inside the atlas,
// while texture sets tile beyond it: TEXCOORD_1 for most shaders, TEXCOORD_2 for csgo_environment.
export function lightmapCoordinates(primitive: { getAttribute(name: string): any }) {
  for (const name of ["TEXCOORD_2", "TEXCOORD_1"]) {
    const accessor = primitive.getAttribute(name);
    if (!accessor || accessor.getElementSize() !== 2) continue;
    const min = accessor.getMin([]), max = accessor.getMax([]);
    if (min.every(value => value >= -0.001) && max.every(value => value <= 1.001)) return accessor;
  }
  return null;
}

// Keeps colour textures, normals and the texture and lightmap UV sets. Lighting comes from the baked atlas,
// so normal, roughness and occlusion maps only add download size.
export async function optimizeMapScene(world: string, lightmap: string | null, { textureSize = 512, lightmapSize = 4096, level = "high" as "medium" | "high" } = {}): Promise<SceneBuild> {
  const [{ Logger, NodeIO }, { ALL_EXTENSIONS }, functions, { MeshoptEncoder }, { default: sharp }] = await Promise.all([
    import("@gltf-transform/core"), import("@gltf-transform/extensions"), import("@gltf-transform/functions"), import("meshoptimizer"), import("sharp"),
  ]);
  const { dedup, flatten, join: joinMeshes, meshopt, prune, textureCompress, weld } = functions;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const document = await io.read(world);
  document.setLogger(new Logger(Logger.Verbosity.ERROR));
  const root = document.getRoot();
  const attributes = ["POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1", "COLOR_0"];
  for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const material = primitive.getMaterial();
    if (!material || hiddenSceneMaterial(material.getExtras()?.vmat as any)) { primitive.dispose(); continue; }
    const lightmapUv = lightmapCoordinates(primitive);
    primitive.setAttribute("TEXCOORD_1", lightmap ? lightmapUv : null);
    for (const semantic of primitive.listSemantics()) if (!attributes.includes(semantic)) primitive.setAttribute(semantic, null);
    // The client shades lightmapped geometry from the atlas alone; only the other props need normals.
    if (lightmap && lightmapUv) primitive.setAttribute("NORMAL", null);
  }
  for (const node of root.listNodes()) node.setSkin(null);
  for (const skin of root.listSkins()) skin.dispose();
  for (const material of root.listMaterials()) {
    const vmat = material.getExtras()?.vmat as any;
    material.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setMetallicFactor(0).setRoughnessFactor(1);
    material.setExtras({ shader: vmat?.ShaderName || "", decal: !!(vmat?.IntParams?.F_OVERLAY || vmat?.IntParams?.F_TRANSLUCENT) });
    // Water is a reflective shader without a colour texture; a tinted translucent surface reads as water.
    if (String(vmat?.ShaderName || "").includes("water"))
      material.setBaseColorTexture(null).setBaseColorFactor([0.13, 0.27, 0.3, 0.72]).setAlphaMode("BLEND").setDoubleSided(true);
  }
  // Unreferenced lightmap UVs must survive pruning; the client binds the atlas to them.
  await document.transform(prune({ keepAttributes: true }), flatten(), joinMeshes({ keepNamed: false }), weld(), dedup(), prune({ keepAttributes: true }),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [textureSize, textureSize], quality: 78 }),
    meshopt({ encoder: MeshoptEncoder, level }));
  const scene = await io.writeBinary(document);
  const atlas = lightmap ? await sharp(lightmap, { limitInputPixels: false })
    .resize({ width: lightmapSize, height: lightmapSize, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer() : null;
  return { scene, lightmap: atlas };
}

export async function buildMapScene({ viewer, gameDir, map, workRoot, signal }: { viewer: string; gameDir: string; map: string; workRoot: string; signal?: AbortSignal }) {
  const workDir = join(workRoot, `${map}-${process.pid}`);
  try {
    const sources = await exportMapSources({ viewer, gameDir, map, workDir, signal });
    return await optimizeMapScene(sources.world, sources.lightmap);
  } finally { await rm(workDir, { recursive: true, force: true }); }
}
