import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUp, Box, ChevronsDown, ChevronsRight, CirclePause, Copy, Crosshair, Film, Footprints, Link2, MapPin, MoveRight, PersonStanding, Play, ScanFace, Target, Timer, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Badge } from "./ui/badge";
import { Kbd, KbdGroup } from "./ui/kbd";
import { ActionButton } from "./action-button";
import { FavoriteButton } from "./nade-favorites";
import { GrenadeIcon, TeamIcon, ThrowClickIcon } from "./nade-icons";
import { TEAM_LABELS, isLineupTeam } from "../../../shared/lineup-teams";
import { copyText } from "../lib/clipboard";
import { CLICK_LABELS, MOVEMENT_LABELS, movementType } from "../../../shared/throw-attributes";

export function CrosshairView({ nade, open, onOpenChange, className = "" }) {
  const [zoom, setZoom] = useState(3);
  const image = nade?.reviewMedia?.aim;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={`crosshair-dialog ${className}`} onEscapeKeyDown={event => event.stopPropagation()}>
      <DialogHeader><DialogTitle>{nade?.displayName || nade?.name} · Ausrichtung</DialogTitle><DialogDescription>Der Zoom ist auf das Fadenkreuz in der Bildmitte ausgerichtet.</DialogDescription></DialogHeader>
      {image ? <>
        <div className="crosshair-viewport"><img src={image.url} alt={`Ausrichtung für ${nade.displayName || nade.name}`} style={{ transform: `scale(${zoom})` }} /></div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setZoom(value => Math.max(1, value - 1))} disabled={zoom <= 1}><ZoomOut />Verkleinern</Button>
          <span className="text-sm tabular-nums" aria-live="polite">{zoom}×</span>
          <Button variant="secondary" size="sm" onClick={() => setZoom(value => Math.min(6, value + 1))} disabled={zoom >= 6}><ZoomIn />Vergrößern</Button>
          <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>Ganzes Bild</Button>
        </div>
      </> : <p className="text-sm text-muted-foreground">Für dieses Lineup ist noch kein Ausrichtungsbild vorhanden.</p>}
    </DialogContent>
  </Dialog>;
}

export function useHeldReviewSlot() {
  const [held, setHeld] = useState({ shift: false, alt: false });
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!["Shift", "Alt"].includes(event.key) || event.target instanceof Element && event.target.closest("input, textarea, [contenteditable=true]")) return;
      if (event.key === "Alt") event.preventDefault();
      const key = event.key === "Shift" ? "shift" : "alt";
      setHeld(current => ({ ...current, [key]: true }));
    };
    const up = (event: KeyboardEvent) => {
      if (!["Shift", "Alt"].includes(event.key)) return;
      const key = event.key === "Shift" ? "shift" : "alt";
      setHeld(current => ({ ...current, [key]: false }));
    };
    const reset = () => setHeld({ shift: false, alt: false });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", reset); document.removeEventListener("visibilitychange", reset); };
  }, []);
  return held.alt ? held.shift ? "effect" : "position" : held.shift ? "aim" : null;
}

const MOVEMENT_ICONS = { stand: CirclePause, walk: Footprints, run: ChevronsRight, step: MoveRight };

export function ThrowFacts({ nade }) {
  const movement = movementType(nade);
  const attributesKnown = ["is_jumpthrow", "is_crouch", "is_walking", "is_running", "is_stepping"].some(key => typeof nade[key] === "boolean");
  const facts = [
    { Icon: null, label: "Team", value: isLineupTeam(nade.team) ? <><TeamIcon team={nade.team} />{TEAM_LABELS[nade.team]}</> : "Nicht hinterlegt" },
    { Icon: null, label: "Technik", value: <>{nade.is_jumpthrow && <ArrowUp aria-label="Jumpthrow" />}<ThrowClickIcon clickType={nade.click_type} />{nade.is_jumpthrow ? "Jumpthrow + " : ""}{CLICK_LABELS[nade.click_type] || "Maustaste nicht erfasst"}</> },
    { Icon: nade.is_crouch ? ChevronsDown : PersonStanding, label: "Haltung", value: attributesKnown ? nade.is_crouch ? "Geduckt" : "Aufrecht" : "Nicht erfasst" },
    { Icon: MOVEMENT_ICONS[movement], label: "Bewegung", value: attributesKnown ? MOVEMENT_LABELS[movement] : "Nicht erfasst" },
    { Icon: Timer, label: "Flugzeit", value: typeof nade.flightDuration === "number" ? `${nade.flightDuration.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s` : "Noch nicht erfasst" },
  ];
  return <dl className="official-throw-facts" aria-label="Wurfattribute">{facts.map(({ Icon, label, value }) => <div key={label}><dt>{label}</dt><dd>{Icon && <Icon aria-hidden="true" />}{value}</dd></div>)}</dl>;
}

const LineupPov = lazy(() => import("./lineup-pov"));

export function OfficialLineupDetail({ nade, map, back, onBack, management, children }) {
  const [selectedSlot, setSelectedSlot] = useState(() => ["video", "aim", "position", "effect", "front"].find(slot => nade.reviewMedia?.[slot]) || "video");
  const [zoomOpen, setZoomOpen] = useState(false);
  const heldSlot = useHeldReviewSlot();
  // In the Abwurfsicht, Shift zooms the reconstruction instead of switching to the aim photo.
  const shortcutSlot = !zoomOpen && heldSlot && !(selectedSlot === "pov" && heldSlot === "aim") && nade.reviewMedia?.[heldSlot] ? heldSlot : null;
  const activeSlot = shortcutSlot || selectedSlot;
  const media = [
    { slot: "video", title: "Video", Icon: Film, shortcut: [] },
    { slot: "aim", title: "Ausrichtung", Icon: Crosshair, shortcut: ["Shift"] },
    { slot: "position", title: "Standposition", Icon: MapPin, shortcut: ["Alt"] },
    { slot: "effect", title: "Wirkung am Ziel", Icon: Target, shortcut: ["Shift", "Alt"] },
    { slot: "front", title: "Vorderansicht", Icon: ScanFace, shortcut: [] },
    { slot: "pov", title: "Abwurfsicht", Icon: Box, shortcut: [] },
  ];
  const selectedPhoto = media.find(item => item.slot === activeSlot);
  return <article className="playbook-page lineup-page official-lineup-detail">
    <header className="official-lineup-heading"><Link to={back} onClick={onBack} aria-label={`Zurück zu ${map.name}`}><ArrowLeft /></Link><h1>{map.name} · {nade.type === "Molly" ? "Molotov" : nade.type}: {nade.displayName || nade.name}</h1></header>
    <div className="official-lineup-layout">
      <nav className="official-photo-picker" aria-label="Lineup-Medien auswählen">{media.map(({ slot, title, Icon, shortcut }) => {
        const thumbnail = slot === "video" ? nade.reviewMedia?.aim?.url : nade.reviewMedia?.[slot]?.url;
        return <button key={slot} title={shortcut.length && nade.reviewMedia?.[slot] ? `${title} · ${shortcut.join(" + ")} gedrückt halten` : title} aria-keyshortcuts={shortcut.length && nade.reviewMedia?.[slot] ? shortcut.join("+") : undefined} aria-pressed={activeSlot === slot} onClick={() => setSelectedSlot(slot)}>
          <div className="official-media-thumbnail">{thumbnail ? <img src={thumbnail} alt="" loading="lazy" style={slot === "aim" ? { transform: "scale(3)", transformOrigin: "center" } : undefined} /> : <Icon aria-hidden="true" />}
            {shortcut.length > 0 && nade.reviewMedia?.[slot] && <KbdGroup className="official-media-shortcut" aria-hidden="true">{shortcut.map(key => <Kbd key={key}>{key}</Kbd>)}</KbdGroup>}
          </div>
          <span><Icon aria-hidden="true" />{title}</span>
        </button>;
      })}</nav>
      <div className="official-lineup-main">
        <div className="official-media-stage">
          {nade.reviewMedia?.video && <LineupVideo key={nade.reviewMedia.video.url} src={nade.reviewMedia.video.url} poster={nade.reviewMedia?.aim?.url} active={activeSlot === "video"} keyboardEnabled={!zoomOpen} title={nade.displayName || nade.name} />}
          {activeSlot === "video" && !nade.reviewMedia?.video && <p className="official-media-empty">Für dieses Lineup ist noch kein Video vorhanden.</p>}
          {activeSlot === "pov" && <Suspense fallback={<div className="lineup-pov-stage" aria-busy="true" />}><LineupPov nade={nade} mapName={map.mapName || nade.map} mapLabel={map.name} /></Suspense>}
          {activeSlot !== "video" && activeSlot !== "pov" && (nade.reviewMedia?.[activeSlot] && selectedPhoto ? <figure className="official-lineup-photo">
            <div className="official-photo-viewport"><img src={nade.reviewMedia[selectedPhoto.slot].url} alt={`${selectedPhoto.title}: ${nade.displayName || nade.name}`} style={{ transform: shortcutSlot === "aim" ? "scale(3)" : undefined }} /></div>
            <figcaption>{selectedPhoto.title}{shortcutSlot === "aim" && " · Fadenkreuz-Zoom"}</figcaption>
            {selectedPhoto.slot === "aim" && <Button className="official-photo-zoom" variant="secondary" size="sm" onClick={() => setZoomOpen(true)}><ZoomIn />Fadenkreuz-Zoom</Button>}
          </figure> : <p className="official-media-empty">Für diese Ansicht ist noch kein Bild vorhanden.</p>)}
        </div>
        {nade.lineupImages?.length > 0 && <section className="lineup-images" aria-label="Weitere Bilder zur Anleitung">{nade.lineupImages.map(image => <figure key={image.key || image.url}><img src={image.url} alt={image.name || `Ausrichtung für ${nade.displayName || nade.name}`} loading="lazy" /><figcaption>{image.name}</figcaption></figure>)}</section>}
      </div>
      <aside className="official-lineup-sidebar" aria-label="Ansicht und Wurfanleitung">
        <div className="official-lineup-actions"><FavoriteButton nade={nade} /><ActionButton size="sm" variant="secondary" icon={Link2} onClick={() => copyText(window.location.href)} successLabel="Link kopiert">Link kopieren</ActionButton><ActionButton size="sm" variant="secondary" icon={Copy} onClick={() => copyText(`.loadnade ${nade.name}`)} successLabel="Kopiert">Ingame-Befehl kopieren</ActionButton></div>
        <ThrowFacts nade={nade} />
        <div className="official-lineup-labels"><Badge variant="success">Offiziell</Badge>{nade.mustKnow && <Badge variant="highlight">Must Know</Badge>}</div>
        <section className="official-lineup-instructions" aria-label="Anleitung"><h2><GrenadeIcon type={nade.type} />So wirfst du dieses Lineup</h2><p className="official-lineup-route">{nade.throwFromTitle || "Startposition"} → {nade.throwToTitle || "Zielposition"}</p>{nade.desc && <p className="throw-description">{nade.desc}</p>}</section>
        <details className="official-lineup-management"><summary>Verwalten und Wurfdaten</summary><div>{management}</div></details>
      </aside>
    </div>
    <CrosshairView nade={nade} open={zoomOpen} onOpenChange={setZoomOpen} />
    {children}
  </article>;
}

function LineupVideo({ src, poster, active, keyboardEnabled, title }) {
  const video = useRef<HTMLVideoElement>(null);
  const resume = useRef(true);
  const [paused, setPaused] = useState(false);
  function play() { void video.current?.play().catch(() => setPaused(true)); }
  function toggle() {
    if (!video.current || !active) return;
    if (video.current.paused) play(); else video.current.pause();
  }
  useEffect(() => {
    if (!video.current) return;
    if (active) { if (resume.current) play(); }
    else { resume.current = !video.current.paused; video.current.pause(); }
  }, [active]);
  useEffect(() => {
    if (!active || !keyboardEnabled) return;
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
          event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      event.preventDefault(); toggle();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, keyboardEnabled]);
  return <>
    <video ref={video} hidden={!active} className="lineup-hero-video" src={src} poster={poster} muted autoPlay loop playsInline preload="metadata" aria-label={`Wurfvideo: ${title}`} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} />
    {active && <button className="lineup-video-toggle" onClick={toggle} aria-label={paused ? "Video abspielen" : "Video pausieren"} aria-keyshortcuts="K">
      {paused && <span className="lineup-video-paused"><Play aria-hidden="true" /><span>Pausiert</span></span>}
    </button>}
  </>;
}
