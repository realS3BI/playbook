import { sanitizeNades } from "./validators.js";
import { THROW_ATTRIBUTE_FIELDS } from "../shared/throw-attributes.js";
import { analyzeThrowMotion, savedThrowAttributes, throwAttributesFromMotion, withThrowSetup } from "../shared/throw-motion.js";

export function replaceMeasuredLineup(entry, capture) {
  if (entry.official || entry.owner === "default" || !capture || capture.newLineup !== false ||
      capture.owner !== entry.owner || capture.map !== entry.map || capture.name !== entry.name ||
      !capture.captureId || capture.captureId === entry.captureId || !capture.editRevision || capture.editRevision !== entry.updatedAt)
    throw new Error("Das Lineup wurde inzwischen geändert oder freigegeben. Bitte erneut bearbeiten.");
  if (typeof capture.flightDuration !== "number" || !Number.isFinite(capture.flightDuration) || capture.flightDuration < 0 ||
      !capture.landingPos || !capture.lineupPos || !capture.lineupAng ||
      THROW_ATTRIBUTE_FIELDS.some(key => capture[key] === undefined || capture[key] === null))
    throw new Error("Die Aufnahme ist unvollständig. Bitte den Wurf erneut aufnehmen.");
  return sanitizeNades([withThrowSetup({ ...entry,
    type: capture.type, lineupPos: capture.lineupPos, lineupAng: capture.lineupAng, landingPos: capture.landingPos,
    desc: capture.description || capture.throwTechnique || "Im Spiel aufgenommen",
    radarFrom: null, radarTo: null, flightDuration: capture.flightDuration,
    throwTechnique: capture.throwTechnique, throwTrace: capture.throwTrace,
    ...Object.fromEntries(THROW_ATTRIBUTE_FIELDS.map(key => [key, capture[key]])),
    captureId: capture.captureId, reviewStatus: "", reviewMedia: undefined, lineupImages: [],
    updatedAt: new Date(Math.max(Date.now(), Date.parse(entry.updatedAt) + 1 || 0)).toISOString(),
  })])[0];
}

// One-time correction of lineups saved before the trace was split into lineup and release:
// run-ups and jumpthrows move to the recorded stillstand, missing attributes come from the trace.
export function withRecordedThrowSetup(entries, now = new Date().toISOString()) {
  return entries.map(entry => {
    let next = withThrowSetup(entry);
    const motion = !savedThrowAttributes(next) && next.throwTrace ? analyzeThrowMotion(next.throwTrace) : null;
    if (motion) next = { ...next, ...throwAttributesFromMotion(motion) };
    return next === entry ? entry : { ...next, updatedAt: now };
  });
}
