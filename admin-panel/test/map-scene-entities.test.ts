import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { hiddenMapEntities, hiddenMapPlacement } from "../src/map-scene-entities.js";
import { optimizeMapScene } from "../src/map-scene-export.js";

// Relevant fields from Source 2 Viewer's Nuke entity dump.
const dump = `====131====
startdisabled                  true
targetname                     "[PR#]brush.blocker"
origin                         [ 608.0, -1436.0, -567.0 ]
model                          resource_name:"maps/de_nuke/entities/brush_blocker_2_61863.vmdl"
====132====
startdisabled                  true
targetname                     "[PR#]props.2v2"
origin                         [ 1246.0, -2367.5, -416.0 ]
model                          resource_name:"models/props/de_nuke/hr_nuke/rollup_door_001/rollup_door_001_base_192.vmdl"
`;

test("entity visibility defaults to visible and malformed placements are ignored", () => {
  assert.deepEqual(hiddenMapEntities(dump.replaceAll("startdisabled                  true", "startdisabled                  false")), []);
  assert.equal(hiddenMapEntities(dump.replaceAll("startdisabled                  true", "enabled                        false")).length, 2);
  assert.equal(hiddenMapEntities(dump.replaceAll("startdisabled                  true", 'startdisabled                  "1"')).length, 2);
  assert.equal(hiddenMapEntities(dump.replace("608.0", "invalid")).length, 1);
  const [entity] = hiddenMapEntities(dump);
  assert.equal(hiddenMapPlacement(`${entity.model}.hammer_mesh_0`, entity.position.map(n => n + 0.00001), [entity]), true);
  assert.equal(hiddenMapPlacement(`${entity.model}_other.hammer_mesh_0`, entity.position, [entity]), false);
  assert.equal(hiddenMapPlacement(`${entity.model}.hammer_mesh_0`, entity.position.map(n => n + 1), [entity]), false);
});

test("disabled map placements are removed before shared meshes are merged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wingman-scene-"));
  try {
    const doc = new Document(), scene = doc.createScene(), buffer = doc.createBuffer();
    const positions = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
    const material = doc.createMaterial();
    const hiddenEntities = hiddenMapEntities(dump);
    assert.equal(hiddenEntities.length, 2);
    for (const entity of hiddenEntities) {
      const mesh = doc.createMesh(`${entity.model}.body`).addPrimitive(doc.createPrimitive().setAttribute("POSITION", positions).setMaterial(material));
      scene.addChild(doc.createNode(mesh.getName()).setMesh(mesh).setTranslation(entity.position));
      scene.addChild(doc.createNode(mesh.getName()).setMesh(mesh).setTranslation([10, 20, 30]));
    }
    const path = join(directory, "world.glb");
    await new NodeIO().write(path, doc);
    const options = { textureSize: 32, hiddenEntities };
    const result = await optimizeMapScene(path, null, options);
    const bytes = Buffer.from(result.scene);
    const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    const triangles = json.meshes.flatMap(mesh => mesh.primitives).reduce((count, primitive) => count + json.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0);
    assert.equal(triangles, 2, "regular placements survive; Wingman brushes and doors are absent");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
