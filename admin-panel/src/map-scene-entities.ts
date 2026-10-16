import { sourceToScene, type Vector3 } from "../shared/map-scene.js";

export type HiddenMapEntity = { model: string; position: Vector3 };

// Source 2 Viewer 20 dumps one entity per ====number==== block. Read placements
// separately: glTF mesh extras describe only the first instance of a shared model.
export function hiddenMapEntities(dump: string): HiddenMapEntity[] {
  const hidden: HiddenMapEntity[] = [];
  for (const block of dump.split(/^====\d+====\s*$/m)) {
    const value = (key: string) => block.match(new RegExp(`^${key}\\s+(.+)$`, "m"))?.[1]?.trim();
    if (!/^(true|1|"1")$/.test(value("startdisabled") || "") && !/^(false|0|"0")$/.test(value("enabled") || "")) continue;
    const model = value("model")?.match(/^resource_name:"([^"\n]+)\.vmdl"$/)?.[1]?.split("/").pop();
    const coordinates = value("origin")?.match(/^\[\s*([^\]]+)\s*\]$/)?.[1]?.split(",").map(Number);
    if (!model || coordinates?.length !== 3 || !coordinates.every(Number.isFinite)) continue;
    hidden.push({ model, position: sourceToScene(coordinates as Vector3) });
  }
  return hidden;
}

export function hiddenMapPlacement(name: string, position: number[], entities: readonly HiddenMapEntity[]) {
  return entities.some(entity => (name === entity.model || name.startsWith(`${entity.model}.`)) &&
    entity.position.every((coordinate, index) => Math.abs(coordinate - position[index]) < 0.001));
}
