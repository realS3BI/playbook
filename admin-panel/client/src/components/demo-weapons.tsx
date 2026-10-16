import { Bomb } from "lucide-react";
import { itemLabel, loadoutSummary, weaponClass, type WeaponClass } from "../../../shared/demos";
import { GrenadeIcon } from "./nade-icons";

// Silhouettes facing right, drawn on a 64 × 20 grid like the weapon list in the CS2 HUD.
const GLYPHS: Partial<Record<WeaponClass, string>> = {
  rifle: "M2 8l12-1 2-1h32l2 1h12v2H50l-2 1H38l-2 7h-4l1-7h-6l-2 5h-4l1-5h-6l-2 2H3z",
  sniper: "M1 9l11-1 3-1h29l2 1h17v1.5H46l-2 1.5H30l-2 4h-4l1-4H15l-3 2H2zM20 3h18v3H20z",
  smg: "M12 8l6-1h24V6h8v3h-8l-1 1h-7l-1 7h-4v-7h-4l-2 5h-4l1-5h-4l-4 2z",
  shotgun: "M2 9l12-2h48v2.5H46l-2 2H32V10h-6l-2 5h-4l1-5h-6l-2 2-10 1z",
  mg: "M2 8l12-1 2-2h30l2 1h14v3H48l-2 1h-4v6h-9v-6h-4l-2 5h-4l1-5h-7l-2 2H3z",
  pistol: "M20 6h24v4H32l-1 1h-2l-1 6h-6l1-7h-3z",
  zeus: "M20 6h22l2 1v3H32l-1 1h-2l-1 6h-6l1-7h-3z",
  knife: "M12 10l14-1.5 2-1.5h6l20 1-10 3H28l-2 1H12z",
};

function Glyph({ kind }: { kind: WeaponClass }) {
  const path = GLYPHS[kind];
  if (kind === "c4") return <Bomb aria-hidden="true" />;
  return path ? <svg viewBox="0 0 64 20" aria-hidden="true"><path d={path} /></svg> : null;
}

type Slot = { key: string; item: string; kind: WeaponClass };
const ORDER: WeaponClass[] = ["rifle", "sniper", "smg", "shotgun", "mg", "pistol", "knife", "zeus", "c4"];

/** What the player carries, active item first in colour; utility as icons in one slot. */
export function DemoWeapons({ name, side, active, items }: { name: string; side: "t" | "ct"; active: string; items?: string[] }) {
  // Older analyses without inventories still show the weapon in hand.
  const carried = items?.length ? items : active ? [active] : [];
  const slots: Slot[] = [];
  const grenades: { item: string; type: string }[] = [];
  for (const item of carried) {
    const kind = weaponClass(item);
    if (kind === "grenade") grenades.push({ item, type: loadoutSummary([item]).grenades[0] || "Smoke" });
    else if (kind !== "other" && !slots.some(slot => slot.item === item)) slots.push({ key: item, item, kind });
  }
  slots.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  if (!slots.length && !grenades.length) return null;
  const activeGrenade = grenades.findIndex(grenade => grenade.item === active);
  return <ol className="demo-weapons" data-side={side} aria-label={`Ausrüstung von ${name}`}>
    {slots.map(slot => <li key={slot.key} data-active={slot.item === active || undefined} aria-current={slot.item === active || undefined}>
      <Glyph kind={slot.kind} />
      <span>{itemLabel(slot.item)}</span>
    </li>)}
    {grenades.length > 0 && <li className="demo-weapons-nades" data-active={activeGrenade >= 0 || undefined} aria-current={activeGrenade >= 0 || undefined}>
      {grenades.map((grenade, index) => <span key={index} data-active={index === activeGrenade || undefined} title={itemLabel(grenade.item)}>
        <GrenadeIcon type={grenade.type} className="size-4" />
      </span>)}
      <span className="sr-only">{grenades.map(grenade => itemLabel(grenade.item)).join(", ")}</span>
    </li>}
  </ol>;
}
