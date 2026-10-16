import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WeaponClass } from "../../../shared/demos";

// Player figures for the 3D replay. Everything here is modelled in Source units around the
// player's origin, facing +Z with +X on the player's left; the caller scales the root to metres.
// The shapes are schematic, sized after the CS2 player hull: 32 units wide, 72 tall, eyes at 64.

const THIGH = 17, SHIN = 18.5, ANKLE = 1.5, UPPER_ARM = 11, FOREARM = 11;
const STANDING_HIP = THIGH + SHIN + ANKLE;
// Crouched, the hips sink about 15 units; thigh and shin angles keep the feet under the body.
const CROUCH_HIP_DROP = 15, CROUCH_THIGH = 75, CROUCH_SHIN = 30;
// One stride (two steps) at running speed; legs swing further the faster the player moves.
const STRIDE = 166, RUN_SPEED = 250;
const deg = THREE.MathUtils.degToRad;

type Hold = { weapon: [number, number, number]; right: [number, number, number]; left: [number, number, number] };
// Weapon and hand positions relative to the point between the shoulders, which turns with the view.
// Long guns sit against the right shoulder with the left hand on the handguard.
const longGun = (fore: number): Hold => ({ weapon: [-3.5, -3.5, 11], right: [-3.5, -5, 11], left: [-3.2, -3.2, 11 + fore] });
const HOLDS: Record<WeaponClass, Hold> = {
  rifle: longGun(12),
  sniper: longGun(14),
  smg: longGun(8),
  shotgun: longGun(15),
  mg: longGun(12),
  pistol: { weapon: [-1, -1.5, 19], right: [-1.4, -3, 19], left: [0.8, -3.4, 18.4] },
  knife: { weapon: [-6.5, -8, 13], right: [-6.5, -8, 13], left: [8.6, -17, 2] },
  grenade: { weapon: [-6.5, -7, 13], right: [-6.5, -8.5, 13], left: [8.6, -17, 2] },
  zeus: { weapon: [-6, -6, 15], right: [-6, -7.5, 15], left: [8.6, -17, 2] },
  c4: { weapon: [0, -10, 11], right: [-3.6, -10, 11], left: [3.6, -10, 11] },
  other: { weapon: [-6.5, -8, 13], right: [-6.5, -8, 13], left: [8.6, -17, 2] },
};

const box = (w: number, h: number, l: number, x: number, y: number, z: number, tilt = 0) =>
  new THREE.BoxGeometry(w, h, l).rotateX(tilt).translate(x, y, z);
// Barrels and scopes run along +Z.
const tube = (r: number, l: number, x: number, y: number, z: number) =>
  new THREE.CylinderGeometry(r, r, l, 8).rotateX(Math.PI / 2).translate(x, y, z);

// Weapon shapes with the right hand's grip at the origin and the muzzle towards +Z.
function weaponGeometry(kind: WeaponClass) {
  const grip = box(1.6, 4.2, 2, 0, -1.8, 0, -0.3);
  const parts = {
    rifle: [box(2.2, 3.2, 20, 0, 1.6, 5), box(2.6, 2.6, 7, 0, 1.4, 16), tube(0.6, 9, 0, 2.2, 23), box(1.8, 6, 2.6, 0, -2.4, 7, 0.25), box(1.8, 3.6, 9, 0, 1, -9), grip],
    sniper: [box(2.2, 3.2, 22, 0, 1.6, 4), tube(0.65, 18, 0, 2.2, 24), tube(1.3, 11, 0, 5.3, 4), box(0.8, 1.6, 2, 0, 3.6, 4), box(2, 4, 10, 0, 1, -11), box(1.6, 3, 2.4, 0, -1.4, 6), grip],
    smg: [box(2.2, 3.4, 14, 0, 1.6, 3), tube(0.6, 4, 0, 2.2, 12), box(1.6, 7, 2.2, 0, -3.2, 5, 0.1), box(1.2, 2, 7, 0, 1.6, -7), grip],
    shotgun: [box(2.4, 3.2, 16, 0, 1.6, 3), tube(0.9, 15, 0, 2.4, 18), tube(1.3, 7, 0, 0.5, 15), box(2, 4, 10, 0, 0.6, -10), grip],
    mg: [box(3, 4.2, 22, 0, 2, 5), tube(0.8, 12, 0, 2.4, 21), box(4, 5, 5, 0, -2.5, 4), box(2, 4, 9, 0, 1.2, -10), grip],
    pistol: [box(1.4, 2, 8, 0, 1.6, 3), tube(0.4, 1, 0, 1.6, 7.4), box(1.4, 4.6, 2.2, 0, -1, 0, -0.25)],
    zeus: [box(1.6, 2.4, 7, 0, 1.4, 3), box(1.2, 1.2, 1, 0, 1.4, 7), box(1.4, 4, 2, 0, -1, 0, -0.25)],
    knife: [box(1.2, 1.6, 4.5, 0, 0, 0), box(1.6, 2.4, 0.5, 0, 0, 2.5), box(0.35, 1.6, 7.5, 0, 0.2, 6.5)],
    grenade: [new THREE.CylinderGeometry(1.7, 1.7, 4.6, 10).translate(0, 1, 0.5), box(1, 1.4, 1, 0, 4, 0.5)],
    c4: [box(6, 3, 8, 0, 0, 0), box(4, 0.6, 3, 0, 1.7, 0.5)],
    other: [box(1.4, 2, 8, 0, 1.6, 3), box(1.4, 4.6, 2.2, 0, -1, 0, -0.25)],
  }[kind];
  const merged = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return merged;
}

const WEAPON_COLORS: Partial<Record<WeaponClass, number>> = { grenade: 0x4f5b47, c4: 0x8a7550, zeus: 0x9c8f3c };

/** Geometries and materials every figure shares; dispose once when the view closes. */
export function createFigureKit() {
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(value: T) => { disposables.push(value); return value; };
  // Limbs are unit cylinders stretched between two joints.
  const limb = own(new THREE.CylinderGeometry(1, 1, 1, 10));
  const joint = own(new THREE.SphereGeometry(1, 10, 8));
  const torso = own(new THREE.CylinderGeometry(1, 0.8, 1, 8));
  const pelvis = own(new THREE.BoxGeometry(11.5, 6, 7.5));
  const head = own(new THREE.SphereGeometry(5.4, 16, 12));
  const helmet = own(new THREE.SphereGeometry(6.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52));
  const face = own(new THREE.BoxGeometry(7.4, 2.4, 2.4));
  const foot = own(new THREE.BoxGeometry(4.6, 3, 9.5));
  const gear = own(new THREE.MeshLambertMaterial({ color: 0x1d242c }));
  const skin = own(new THREE.MeshLambertMaterial({ color: 0xb98c6c }));
  const weapons = new Map<WeaponClass, { geometry: THREE.BufferGeometry; material: THREE.Material }>();
  const gunmetal = own(new THREE.MeshLambertMaterial({ color: 0x30363d }));
  const weapon = (kind: WeaponClass) => {
    let entry = weapons.get(kind);
    if (!entry) {
      const color = WEAPON_COLORS[kind];
      entry = { geometry: own(weaponGeometry(kind)), material: color ? own(new THREE.MeshLambertMaterial({ color })) : gunmetal };
      weapons.set(kind, entry);
    }
    return entry;
  };
  return { limb, joint, torso, pelvis, head, helmet, face, foot, gear, skin, weapon, dispose() { disposables.forEach(item => item.dispose()); } };
}
export type FigureKit = ReturnType<typeof createFigureKit>;

/** Side colours: `cloth` for the jacket, `dark` for trousers and sleeves. */
export type FigurePalette = { cloth: THREE.Material; dark: THREE.Material };

export type FigurePose = {
  /** Eye height above the origin. */
  eye: number;
  duck: number;
  /** Degrees, positive looks down. */
  pitch: number;
  /** Units per second over the ground. */
  speed: number;
  /** Walk cycle in radians. */
  phase: number;
  weapon: WeaponClass | null;
  helmet: boolean;
  armor: boolean;
};

type Leg = { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group };
type Arm = { upper: THREE.Mesh; fore: THREE.Mesh; elbow: THREE.Mesh; hand: THREE.Mesh };

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const stretch = (mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number) => {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  mesh.position.addVectors(from, to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.divideScalar(length || 1));
  mesh.scale.set(radius, length, radius);
};

export class Figure {
  readonly root = new THREE.Group();
  /** Moves with the view direction; the gaze line belongs here. */
  readonly head = new THREE.Group();
  private readonly pelvis: THREE.Mesh;
  private readonly torso: THREE.Mesh;
  private readonly vest: THREE.Mesh;
  private readonly helmet: THREE.Mesh;
  private readonly legs: Leg[];
  private readonly aim = new THREE.Group();
  private readonly weapon: THREE.Mesh;
  private readonly arms: Arm[];
  private readonly cloth: THREE.Mesh[] = [];
  private readonly dark: THREE.Mesh[] = [];
  private readonly fixed: THREE.Mesh[] = [];
  private held: WeaponClass | null | undefined;
  /** One material for every part including the weapon, for the X-ray copy. */
  private tinted: THREE.Material | null = null;

  constructor(private readonly kit: FigureKit) {
    const mesh = (geometry: THREE.BufferGeometry, role: "cloth" | "dark" | "gear" | "skin") => {
      const result = new THREE.Mesh(geometry, role === "skin" ? kit.skin : kit.gear);
      (role === "cloth" ? this.cloth : role === "dark" ? this.dark : this.fixed).push(result);
      return result;
    };
    this.pelvis = mesh(kit.pelvis, "dark");
    this.torso = mesh(kit.torso, "cloth");
    this.vest = mesh(kit.torso, "gear");
    this.legs = [1, -1].map(side => {
      const hip = new THREE.Group(), knee = new THREE.Group(), ankle = new THREE.Group();
      const thigh = mesh(kit.limb, "dark"), shin = mesh(kit.limb, "dark"), kneeCap = mesh(kit.joint, "dark"), boot = mesh(kit.foot, "gear");
      hip.position.x = 4.2 * side;
      thigh.scale.set(3.7, THIGH, 3.7);
      thigh.position.y = -THIGH / 2;
      knee.position.y = -THIGH;
      kneeCap.scale.setScalar(3.4);
      shin.scale.set(3.2, SHIN, 3.2);
      shin.position.y = -SHIN / 2;
      ankle.position.y = -SHIN;
      boot.position.set(0, -ANKLE + 0.2, 2.4);
      ankle.add(boot);
      knee.add(kneeCap, shin, ankle);
      hip.add(thigh, knee);
      return { hip, knee, ankle };
    });
    const headMesh = mesh(kit.head, "skin"), face = mesh(kit.face, "gear");
    this.helmet = mesh(kit.helmet, "dark");
    headMesh.position.set(0, 0.6, -1.2);
    this.helmet.position.set(0, 1.4, -1.2);
    face.position.set(0, 0.8, 3.6);
    this.head.add(headMesh, this.helmet, face);
    this.weapon = new THREE.Mesh(kit.joint, kit.gear);
    this.arms = [-1, 1].map(() => ({ upper: mesh(kit.limb, "cloth"), fore: mesh(kit.limb, "cloth"), elbow: mesh(kit.joint, "cloth"), hand: mesh(kit.joint, "gear") }));
    for (const arm of this.arms) this.aim.add(arm.upper, arm.fore, arm.elbow, arm.hand);
    this.aim.add(this.weapon);
    this.root.add(this.pelvis, this.torso, this.vest, this.head, this.aim, ...this.legs.map(leg => leg.hip));
  }

  /** Side colours while alive; one material for every part once the player has died. */
  paint(palette: FigurePalette | THREE.Material) {
    const dead = palette instanceof THREE.Material ? palette : null;
    for (const part of this.cloth) part.material = dead || (palette as FigurePalette).cloth;
    for (const part of this.dark) part.material = dead || (palette as FigurePalette).dark;
    for (const part of this.fixed) part.material = dead || (part.geometry === this.kit.head ? this.kit.skin : this.kit.gear);
  }

  tint(material: THREE.Material) {
    this.tinted = material;
    this.paint(material);
    this.weapon.material = material;
  }

  pose({ eye, duck, pitch, speed, phase, weapon, helmet, armor }: FigurePose) {
    const walk = Math.min(1, speed / RUN_SPEED) * (1 - 0.4 * duck);
    const hipY = STANDING_HIP - CROUCH_HIP_DROP * duck - 1.2 * walk * Math.abs(Math.cos(phase));
    const hipZ = -4 * duck;
    this.pelvis.position.set(0, hipY + 1, hipZ);
    this.legs.forEach((leg, index) => {
      const cycle = phase + index * Math.PI;
      const thigh = deg(CROUCH_THIGH * duck + 25 * walk * Math.sin(cycle));
      const bend = deg((CROUCH_THIGH + CROUCH_SHIN) * duck + 50 * walk * Math.max(0, Math.cos(cycle)));
      leg.hip.position.set(leg.hip.position.x, hipY, hipZ);
      leg.hip.rotation.x = -thigh;
      leg.knee.rotation.x = bend;
      // Feet stay flat on the ground.
      leg.ankle.rotation.x = thigh - bend;
    });
    const shoulder = eye - 10;
    const neck = new THREE.Vector3(0, eye - 6.5, -1.5);
    stretch(this.torso, new THREE.Vector3(0, hipY + 2.5, hipZ), neck, 1);
    this.torso.scale.x = 8.4;
    this.torso.scale.z = 5;
    this.vest.visible = armor;
    if (armor) {
      stretch(this.vest, new THREE.Vector3(0, hipY + 6, hipZ + 0.3), new THREE.Vector3(0, eye - 9, -1.2), 1);
      this.vest.scale.x = 8.9;
      this.vest.scale.z = 5.6;
    }
    this.head.position.set(0, eye, 0);
    this.head.rotation.x = deg(pitch);
    this.helmet.visible = helmet;
    this.aim.position.set(0, shoulder, -1);
    this.aim.rotation.x = deg(pitch);
    if (weapon !== this.held) this.hold(weapon);
  }

  // Arms reach from the shoulders to the hands with the elbows bent down and out.
  private hold(kind: WeaponClass | null) {
    this.held = kind;
    const hold = HOLDS[kind || "other"];
    this.weapon.visible = !!kind;
    if (kind) {
      const { geometry, material } = this.kit.weapon(kind);
      this.weapon.geometry = geometry;
      this.weapon.material = this.tinted || material;
      this.weapon.position.set(...hold.weapon);
    }
    const hands = kind ? [hold.right, hold.left] : [[-8.6, -17, 2], [8.6, -17, 2]] as [number, number, number][];
    this.arms.forEach((arm, index) => {
      const side = index === 0 ? -1 : 1;
      const from = new THREE.Vector3(7.6 * side, 0, 0), to = new THREE.Vector3(...hands[index]);
      const reach = Math.min(to.distanceTo(from), UPPER_ARM + FOREARM - 0.01);
      const direction = to.clone().sub(from).normalize();
      to.copy(from).addScaledVector(direction, reach);
      const pole = new THREE.Vector3(side * 0.6, -1, -0.3);
      pole.addScaledVector(direction, -pole.dot(direction)).normalize();
      const along = (reach * reach + UPPER_ARM * UPPER_ARM - FOREARM * FOREARM) / (2 * reach);
      const elbow = from.clone().addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along)));
      stretch(arm.upper, from, elbow, 2.5);
      stretch(arm.fore, elbow, to, 2.1);
      arm.elbow.position.copy(elbow);
      arm.elbow.scale.setScalar(2.4);
      arm.hand.position.copy(to);
      arm.hand.scale.setScalar(2);
    });
  }
}
