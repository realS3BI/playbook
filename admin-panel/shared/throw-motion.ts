// Reads the recorded input trace of a captured throw (Playbook ThrowSample JSON) and splits it
// into lineup, movement and release. server-plugin/Playbook/ThrowMotion.cs implements the same
// rules for in-game feedback; both are checked against Playbook.Tests/Fixtures/throw-motion.json.
import { CLICK_LABELS, THROW_ATTRIBUTE_FIELDS, movementType } from "./throw-attributes.js";

export type Vector3 = [number, number, number];
type Sample = { time: number; position: Vector3; velocity: Vector3; view: Vector3; buttons: Set<string> };
export type MovementKey = "W" | "A" | "S" | "D";
export type ThrowMotion = {
  // Where the player stands still and aims. found is false when the trace has no stillstand before the throw.
  setup: { found: boolean; index: number; position: Vector3; view: Vector3; crouch: boolean };
  movement: null | { kind: "step" | "hold"; keys: MovementKey[]; pace: "run" | "walk" | "crouch"; seconds: number; distance: number; partial: boolean; startIndex: number };
  // Seconds between jump and release: negative means the jump starts first.
  jump: null | { timing: "together" | "before" | "after"; seconds: number; index: number };
  release: { index: number; click: "left" | "right" | "both"; crouch: boolean; position: Vector3; view: Vector3 };
  viewChange: number;
};

const LINEUP_Z_OFFSET = 4; // Matches the capture: origin 4 units up, like MatchZy's saved positions.
const STILL_SPEED = 5;
const SETUP_HOLD = 0.2;
const SAMPLE_GAP = 0.25;
const MOVING_SPEED = 30;
const STEP_MIN = 4, STEP_MAX = 24;
const JUMP_SPEED = 120;
const TOGETHER = 0.12;
const STANCE_WINDOW = 1;
const MOVE_KEYS: [string, MovementKey][] = [["forward", "W"], ["moveleft", "A"], ["back", "S"], ["moveright", "D"]];

// Values are float32 in the plugin; rounding them the same way keeps both implementations in step.
function vector(value: unknown): Vector3 | null {
  const parts = String(value ?? "").trim().split(/\s+/).map(part => Math.fround(Number(part)));
  return parts.length === 3 && parts.every(Number.isFinite) ? parts as Vector3 : null;
}

export function parseThrowTrace(trace: unknown): Sample[] {
  let raw = trace;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(raw)) return [];
  const samples: Sample[] = [];
  for (const item of raw) {
    const time = Math.fround(Number(item?.Time ?? item?.time));
    const position = vector(item?.Position ?? item?.position), velocity = vector(item?.Velocity ?? item?.velocity), view = vector(item?.View ?? item?.view);
    if (!Number.isFinite(time) || !position || !velocity || !view) continue;
    const buttons = new Set(String(item?.Buttons ?? item?.buttons ?? "").split(",").map(button => button.trim().toLowerCase()).filter(button => button && button !== "0"));
    samples.push({ time, position, velocity, view, buttons });
  }
  return samples;
}

const speed = (s: Sample) => Math.sqrt(s.velocity[0] * s.velocity[0] + s.velocity[1] * s.velocity[1]);
const rounded = (value: number) => Math.floor(value + 0.5);
const has = (s: Sample, ...buttons: string[]) => buttons.some(button => s.buttons.has(button));
const attacking = (s: Sample) => has(s, "attack", "attack2");
const grounded = (s: Sample) => Math.abs(s.velocity[2]) < 1 && !has(s, "jump");
const still = (s: Sample) => speed(s) < STILL_SPEED && grounded(s);
const keysOf = (s: Sample) => MOVE_KEYS.filter(([button]) => s.buttons.has(button)).map(([, key]) => key);
const lifted = (point: Vector3): Vector3 => [point[0], point[1], point[2] + LINEUP_Z_OFFSET];
// Seconds rounded through whole milliseconds so float and double traces give the same text.
const centis = (seconds: number) => Math.floor((rounded(seconds * 1000) + 5) / 10) / 100;
function angle(a: Vector3, b: Vector3) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(((a[1] - b[1]) % 360 + 540) % 360 - 180));
}

export function analyzeThrowMotion(trace: unknown): ThrowMotion | null {
  const s = parseThrowTrace(trace);
  if (s.length === 0) return null;
  const end = s.length - 1;
  const linked = (i: number) => i > 0 && s[i].time - s[i - 1].time <= SAMPLE_GAP;
  let lastAttack = -1;
  for (let i = end; i >= 0; i--) if (attacking(s[i])) { lastAttack = i; break; }
  const release = lastAttack < 0 ? end : Math.min(end, lastAttack + 1);

  // The held combination of the final press decides the throw, not a short overlap while letting go.
  const combos = { both: 0, left: 0, right: 0 };
  for (let i = lastAttack; i >= 0 && attacking(s[i]); i--) {
    combos[has(s[i], "attack") && has(s[i], "attack2") ? "both" : has(s[i], "attack2") ? "right" : "left"]++;
    if (!linked(i)) break;
  }
  const click = (["both", "left", "right"] as const).reduce((best, key) => combos[key] > combos[best] ? key : best, "left" as "left" | "right" | "both");

  // Lineup: the end of the last stillstand (at least SETUP_HOLD long) before letting go.
  let setup = -1;
  for (let i = release; i >= 0 && setup < 0; i--) {
    if (!still(s[i])) continue;
    let first = i;
    while (linked(first) && still(s[first - 1])) first--;
    if (s[i].time - s[first].time >= SETUP_HOLD - 0.001) setup = i;
    i = first;
  }
  let windowStart = setup + 1, partial = false;
  if (setup < 0) {
    windowStart = release + 1;
    if (!still(s[release])) {
      windowStart = release;
      while (linked(windowStart) && !still(s[windowStart - 1])) windowStart--;
      // Cut off by the start of the trace or a gap: the run-up may have started earlier.
      partial = !linked(windowStart);
    }
  }
  let distance = 0, fastest = 0;
  for (let i = windowStart; i <= release; i++) {
    fastest = Math.max(fastest, speed(s[i]));
    if (i > windowStart || linked(i)) {
      const dx = s[i].position[0] - s[i - 1].position[0], dy = s[i].position[1] - s[i - 1].position[1];
      distance += Math.sqrt(dx * dx + dy * dy);
    }
  }
  const moving = windowStart <= release && (fastest >= MOVING_SPEED || distance >= STEP_MIN);

  // Jump: the airborne block that contains the release or starts before the grenade leaves.
  const airborne = (x: Sample) => has(x, "jump") || Math.abs(x.velocity[2]) >= 1;
  let jumpIndex = -1;
  for (let i = release; i <= end; i++) if (airborne(s[i])) { jumpIndex = i; break; }
  if (jumpIndex === release) while (linked(jumpIndex) && airborne(s[jumpIndex - 1])) jumpIndex--;
  let jump: ThrowMotion["jump"] = null;
  if (jumpIndex >= 0) {
    let impulse = false;
    for (let i = jumpIndex; i <= end && airborne(s[i]); i++) if (has(s[i], "jump") || s[i].velocity[2] > JUMP_SPEED) { impulse = true; break; }
    if (impulse) {
      const seconds = centis(s[jumpIndex].time - s[release].time);
      jump = { timing: Math.abs(seconds) <= TOGETHER ? "together" : seconds < 0 ? "before" : "after", seconds, index: jumpIndex };
    }
  }

  let movement: ThrowMotion["movement"] = null;
  let lineup: number;
  if (moving) {
    const counts = new Map<string, number>();
    let walk = 0, duck = 0, startIndex = -1;
    for (let i = windowStart; i <= release; i++) {
      const keys = keysOf(s[i]).join("+");
      if (keys) counts.set(keys, (counts.get(keys) ?? 0) + 1);
      if (startIndex < 0 && (keys || speed(s[i]) >= STILL_SPEED)) startIndex = i;
      if (has(s[i], "speed", "walk")) walk++;
      if (has(s[i], "duck")) duck++;
    }
    const total = release - windowStart + 1;
    const keys = [...counts.entries()].reduce((best, entry) => entry[1] > best[1] ? entry : best, ["", 0] as [string, number])[0];
    startIndex = Math.max(startIndex, windowStart);
    movement = { kind: distance >= STEP_MIN && distance < STEP_MAX ? "step" : "hold", keys: keys ? keys.split("+") as MovementKey[] : [],
      pace: duck * 2 > total ? "crouch" : walk * 2 > total ? "walk" : "run", seconds: centis(s[release].time - s[startIndex].time),
      distance: rounded(distance), partial, startIndex };
    lineup = setup >= 0 ? setup : end;
  } else {
    // Standing throws keep the release spot; a jump starts from the floor just before it.
    lineup = jump && jump.index > 0 ? jump.index - 1 : end;
  }
  const view = movement ? s[lineup].view : s[end].view;
  let viewChange = 0;
  if (movement) for (let i = lineup; i <= end; i++) viewChange = Math.max(viewChange, angle(view, s[i].view));

  let crouch = has(s[lineup], "duck");
  if (!movement) {
    // Without movement the stance while aiming is what the player held before the final moment.
    let ducked = 0, count = 0;
    for (let i = release; i >= 0 && s[release].time - s[i].time <= STANCE_WINDOW; i--) {
      if (s[release].time - s[i].time < 0.15) continue;
      count++; if (has(s[i], "duck")) ducked++;
    }
    crouch = count > 0 ? ducked * 2 > count : has(s[end], "duck");
  }
  return {
    setup: { found: setup >= 0 || !movement, index: lineup, position: lifted(s[lineup].position), view, crouch },
    movement, jump,
    release: { index: release, click, crouch: has(s[end], "duck"), position: lifted(s[end].position), view: s[end].view },
    viewChange: rounded(viewChange * 10) / 10,
  };
}

export function throwAttributesFromMotion(motion: ThrowMotion) {
  const mode = !motion.movement ? "stand" : motion.movement.kind === "step" ? "step" : motion.movement.pace === "run" ? "run" : "walk";
  return { is_jumpthrow: motion.jump !== null, is_crouch: motion.release.crouch, is_walking: mode === "walk", is_running: mode === "run",
    is_stepping: mode === "step", click_type: motion.release.click };
}

const decimal = (value: number) => value.toFixed(2).replace(".", ",");
const KEY_HINTS = { walk: " mit Shift", crouch: " hockend", run: "" };

// Three short instructions: lineup, movement, release. Stored attributes win over the trace,
// because creators can correct them; the trace only adds keys, timing and stance.
export function describeThrow(motion: ThrowMotion, attributes = throwAttributesFromMotion(motion)) {
  const mode = movementType(attributes);
  const move = mode === "stand" ? null : motion.movement;
  const setupCrouch = motion.setup.crouch, releaseCrouch = attributes.is_crouch === true;
  const lineup = motion.movement && !motion.setup.found ? "Ausrichten (Startpunkt nicht erkannt)" : setupCrouch ? "Hockend ausrichten" : "Stehend ausrichten";
  const stance = setupCrouch && !releaseCrouch ? "aufstehen" : !setupCrouch && releaseCrouch ? "ducken" : "";
  let movement: string;
  if (mode === "stand") movement = stance ? stance[0].toUpperCase() + stance.slice(1) : "Stillstehen";
  else if (!move) movement = mode === "step" ? "Schrittwurf" : mode === "walk" ? "Gehen" : "Laufen";
  else {
    const pace = mode === "run" ? "run" : mode === "walk" && move.pace === "run" ? "walk" : move.pace;
    const keys = move.keys.length ? move.keys.join(" + ") : "Bewegungstaste";
    movement = `${keys} ${mode === "step" ? "antippen" : "halten"}${KEY_HINTS[pace]}${stance && !(pace === "crouch" && stance === "ducken") ? `, dabei ${stance}` : ""}`;
  }
  const button = CLICK_LABELS[attributes.click_type] || CLICK_LABELS.left;
  const timing = move ? `${move.partial ? "Nach mindestens" : "Nach"} ${decimal(move.seconds)} s (${move.distance} Units) ` : "";
  let release = `${timing}${button} loslassen`;
  if (attributes.is_jumpthrow) {
    const jump = motion.jump;
    release = !jump ? `${release} mit Jumpthrow`
      : jump.timing === "together" ? `${release} und gleichzeitig springen`
      : jump.timing === "before" ? timing ? `${release}, ${decimal(-jump.seconds)} s vorher springen` : `Springen, nach ${decimal(-jump.seconds)} s in der Luft ${button} loslassen`
      : `${release}, ${decimal(jump.seconds)} s danach springen`;
    if (releaseCrouch) release += " (Duck halten)";
  }
  const notes: string[] = [];
  if (motion.movement && !motion.setup.found) notes.push("Vor dem Anlauf stand der Werfer nicht still. Gespeichert ist der Abwurfpunkt.");
  if (move && motion.viewChange >= 0.5) notes.push(`Der Blick ändert sich während der Bewegung um ${motion.viewChange.toFixed(1).replace(".", ",")}°.`);
  return { lineup, movement, release, notes };
}

// Saved attributes of a lineup, or undefined when none were recorded (older captures).
export function savedThrowAttributes(entry: Record<string, any>) {
  if (!THROW_ATTRIBUTE_FIELDS.some(key => entry[key] !== undefined && entry[key] !== null)) return undefined;
  return { is_jumpthrow: entry.is_jumpthrow === true, is_crouch: entry.is_crouch === true, is_walking: entry.is_walking === true,
    is_running: entry.is_running === true, is_stepping: entry.is_stepping === true,
    click_type: (["left", "right", "both"].includes(entry.click_type) ? entry.click_type : "left") as "left" | "right" | "both" };
}

export function describeLineupThrow(entry: Record<string, any>) {
  const motion = entry.throwTrace ? analyzeThrowMotion(entry.throwTrace) : null;
  return motion ? { motion, ...describeThrow(motion, savedThrowAttributes(entry)) } : null;
}

export const TIMELINE_LANES = [
  { key: "W", buttons: ["forward"] }, { key: "A", buttons: ["moveleft"] }, { key: "S", buttons: ["back"] }, { key: "D", buttons: ["moveright"] },
  { key: "Shift", buttons: ["speed", "walk"] }, { key: "Ctrl", buttons: ["duck"] }, { key: "Space", buttons: ["jump"] },
  { key: "Maus 1", buttons: ["attack"] }, { key: "Maus 2", buttons: ["attack2"] },
] as const;

// Held keys around the throw for the website, in seconds relative to letting go (0).
export function throwTimeline(trace: unknown, motion: ThrowMotion, lead = 0.5) {
  const s = parseThrowTrace(trace);
  if (!s.length) return null;
  const zero = s[motion.release.index].time;
  const from = Math.max(s[0].time, motion.movement ? s[motion.movement.startIndex].time - lead : zero - 1);
  const to = s[s.length - 1].time;
  const lanes = TIMELINE_LANES.map(lane => {
    const spans: [number, number][] = [];
    let open: number | null = null;
    for (let i = 0; i < s.length; i++) {
      if (s[i].time < from) continue;
      if (open !== null && s[i].time - s[i - 1].time > SAMPLE_GAP) { spans.push([open - zero, s[i - 1].time - zero]); open = null; }
      const held = lane.buttons.some(button => s[i].buttons.has(button));
      if (held && open === null) open = s[i].time;
      if (!held && open !== null) { spans.push([open - zero, s[i].time - zero]); open = null; }
    }
    if (open !== null) spans.push([open - zero, to - zero]);
    return { key: lane.key, spans };
  }).filter(lane => lane.spans.length > 0);
  return { from: from - zero, to: to - zero, setup: s[motion.setup.index].time - zero,
    start: motion.movement ? s[motion.movement.startIndex].time - zero : null, jump: motion.jump ? s[motion.jump.index].time - zero : null, lanes };
}

// Shortest text that reads back as the same float32, like the plugin's vector strings.
function floatText(value: number) {
  const single = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = Number(single.toPrecision(digits));
    if (Math.fround(text) === single) return String(Math.round(text * 1e6) / 1e6);
  }
  return String(Math.round(single * 1e6) / 1e6);
}
const formatted = (point: Vector3) => point.map(floatText).join(" ");
const close = (text: unknown, point: Vector3, tolerance: number) => {
  const current = vector(text);
  return Boolean(current && current.every((value, index) => Math.abs(value - point[index]) < tolerance));
};

// Lineup position and angle come from the stillstand before the throw; the release spot is kept
// separately. Derived only from the trace, so applying it again gives the same entry.
export function withThrowSetup<T extends { lineupPos?: string; lineupAng?: string; releasePos?: string; releaseAng?: string; throwTrace?: string }>(entry: T): T {
  const motion = entry.throwTrace ? analyzeThrowMotion(entry.throwTrace) : null;
  if (!motion || !motion.setup.found) return entry;
  const lineupPos = close(entry.lineupPos, motion.setup.position, 0.01) ? entry.lineupPos : formatted(motion.setup.position);
  const lineupAng = close(entry.lineupAng, motion.setup.view, 0.01) ? entry.lineupAng : formatted(motion.setup.view);
  const separate = Math.hypot(...motion.release.position.map((value, index) => value - motion.setup.position[index])) >= 1;
  // Keep the exact values the plugin measured live when they still describe the same point.
  const pick = (...values: [unknown, Vector3][]) => values.find(([text, point]) => close(text, point, 0.01))?.[0] as string | undefined;
  const releasePos = separate ? pick([entry.releasePos, motion.release.position], [entry.lineupPos, motion.release.position]) ?? formatted(motion.release.position) : undefined;
  const releaseAng = separate ? pick([entry.releaseAng, motion.release.view], [entry.lineupAng, motion.release.view]) ?? formatted(motion.release.view) : undefined;
  if (lineupPos === entry.lineupPos && lineupAng === entry.lineupAng && releasePos === entry.releasePos && releaseAng === entry.releaseAng) return entry;
  const next = { ...entry, lineupPos, lineupAng };
  if (releasePos) Object.assign(next, { releasePos, releaseAng }); else { delete next.releasePos; delete next.releaseAng; }
  return next;
}
