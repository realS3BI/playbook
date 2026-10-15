import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowUp, BookOpen, MapPin } from "lucide-react";
import { Button } from "./ui/button";
import { CrosshairView, useHeldReviewSlot } from "./lineup-presentation";
import { REVIEW_STEPS } from "../../../shared/review-media";
import { type MapDefinition } from "../lib/maps";
import { radarCanvasSize, radarPointVisible, type RadarLevel } from "../lib/radar-layout";
import { RadarBackground } from "./radar-background";
import { RadarLevelSwitch } from "./radar-level-switch";
import { lineupKey } from "../lib/lineups";
import { type RadarGroup, type RadarLineup, type RadarSide } from "../lib/radar-groups";
import { radarMarkerAsset } from "../lib/nade-assets";
import { TEAM_LABELS, isLineupTeam } from "../../../shared/lineup-teams";
import { cn } from "../lib/utils";
import { ThrowClickIcon } from "./nade-icons";
import { throwAttributeSummary } from "../../../shared/throw-attributes";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./ui/empty";

type Props = {
  map: MapDefinition; side: RadarSide; groups: RadarGroup[];
  selected?: RadarGroup; counterparts: RadarGroup[]; expanded?: RadarGroup;
  onSelect: (group: RadarGroup) => void; onExpand: (group: RadarGroup) => void;
  onDismiss: () => void; onCloseOptions: () => void;
  href: (nade: RadarLineup) => string;
};

export function RadarBrowser({ map, side, groups, selected, counterparts, expanded, onSelect, onExpand, onDismiss, onCloseOptions, href }: Props) {
  const [level, setLevel] = useState<RadarLevel>("upper");
  useEffect(() => setLevel("upper"), [map.key]);
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const heldSlot = useHeldReviewSlot();
  const [preview, setPreview] = useState<{ group: RadarGroup; index: number; left: number; top: number } | null>(null);
  const [zoomNade, setZoomNade] = useState<RadarLineup | null>(null);
  const [stackFocus, setStackFocus] = useState<RadarLineup | null>(null);
  const focusStack = useRef(false);
  const closeOptions = useRef(onCloseOptions);
  closeOptions.current = onCloseOptions;
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTrigger = useRef<HTMLElement | null>(null);
  function cancelTimer() { if (hoverTimer.current) clearTimeout(hoverTimer.current); }
  function hidePreview() { cancelTimer(); hoverTimer.current = setTimeout(() => setPreview(null), 180); }
  function showPreview(group: RadarGroup, element: HTMLElement) {
    cancelTimer();
    previewTrigger.current = element;
    const rect = element.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => setPreview({ group, index: 0,
      left: Math.max(8, Math.min(rect.left + rect.width / 2 - 198, window.innerWidth - 404)),
      top: Math.max(8, Math.min(rect.bottom + 10, window.innerHeight - 310)),
    }), 160);
  }
  useEffect(() => {
    cancelTimer(); setPreview(null);
  }, [selected?.id, side, expanded?.id, map.key, level]);
  useEffect(() => {
    // Live updates rebuild radar groups. Keep the player mounted while its
    // marker and officially reviewed recording are still available.
    setPreview(current => {
      if (!current) return null;
      const group = counterparts.find(group => group.id === current.group.id);
      const candidates = group?.nades.filter(nade => nade.official && nade.reviewMedia?.video);
      if (!group || !candidates?.length) return null;
      const previous = current.group.nades.filter(nade => nade.official && nade.reviewMedia?.video)[current.index];
      const index = previous ? candidates.findIndex(nade => lineupKey(nade) === lineupKey(previous)) : 0;
      return { ...current, group, index: Math.max(0, index) };
    });
  }, [counterparts]);
  useEffect(() => {
    const close = (event?: Event) => {
      if (event?.type === "scroll" && event.target instanceof Element && event.target.closest(".radar-preview")) return;
      cancelTimer(); setPreview(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", escape);
    return () => { cancelTimer(); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", escape); };
  }, []);
  useEffect(() => {
    if (!selected || expanded || zoomNade) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(".radar-spot, .radar-preview, .radar-level-switch")) return;
      onDismiss();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [selected, expanded, zoomNade, onDismiss]);
  useEffect(() => {
    setStackFocus(null);
    if (!expanded) return;
    if (focusStack.current) document.querySelector<HTMLElement>(".radar-stack-open a")?.focus();
    focusStack.current = false;
    function collapse(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(".radar-stack-open, .radar-preview, [data-stack-trigger]")) return;
      closeOptions.current();
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeOptions.current();
      optionsTrigger.current?.focus();
    }
    document.addEventListener("pointerdown", collapse);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", collapse); document.removeEventListener("keydown", escape); };
  }, [expanded?.id]);
  if (!map.radarUrl) return <Empty className="border"><EmptyHeader><MapPin /><EmptyTitle>Keine Radarkarte hinterlegt</EmptyTitle><EmptyDescription>Alle Lineups findest du in der Liste darunter.</EmptyDescription></EmptyHeader></Empty>;
  const { width, height } = radarCanvasSize(map);
  function marker(group: RadarGroup, markerSide: RadarSide, secondary = false) {
    const active = group === selected || group === expanded;
    const asset = markerSide === "to" ? radarMarkerAsset(group.nades) : null;
    const team = group.nades.every(nade => nade.team === group.nades[0].team) ? group.nades[0].team : undefined;
    const teamLabel = isLineupTeam(team) ? ` · ${TEAM_LABELS[team]}` : "";
    const countLabel = group.nades.length > 1 ? ` · ${group.nades.length} Lineups` : "";
    const levelLabel = map.radarLowerUrl ? ` · ${group.point.level === "lower" ? "Untere Ebene" : "Obere Ebene"}` : "";
    const label = `${markerSide === "from" ? "Start" : "Ziel"}: ${group.title}${countLabel}${teamLabel}${levelLabel}`;
    const className = cn("radar-spot", markerSide === "from" && "radar-spot-from", active && "radar-spot-active", asset && "radar-spot-asset", group.nades.length > 1 && "radar-spot-stack");
    const point = group.point;
    const style = { left: `${point.x * 100}%`, top: `${point.y * 100}%` };
    const content = <>
      {asset && <img className="radar-marker-art" src={asset} alt="" aria-hidden="true" />}
      {group.nades.length > 1 && <span className="radar-marker-label">{group.nades.length}</span>}
    </>;
    const previewable = secondary && group.nades.some(nade => nade.official && nade.reviewMedia?.video);
    const aimNade = group.nades.find(nade => nade.official && nade.reviewMedia?.aim);
    const hoverProps = previewable ? {
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => showPreview(group, event.currentTarget),
      onMouseLeave: hidePreview,
      onFocus: (event: React.FocusEvent<HTMLElement>) => showPreview(group, event.currentTarget),
      onBlur: (event: React.FocusEvent<HTMLElement>) => { if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest(".radar-preview")) hidePreview(); },
      "aria-haspopup": "dialog" as const,
    } : {};
    const openAim = (event: React.MouseEvent<HTMLElement>) => {
      if (!event.shiftKey || event.altKey || !aimNade || !secondary) return false;
      event.preventDefault(); cancelTimer(); setPreview(null); previewTrigger.current = event.currentTarget; setZoomNade(aimNade); return true;
    };
    // An open stack keeps its marker and shows one marker per lineup in a bubble above it.
    // Official lineups carry the guide icon.
    const open = secondary && group === expanded && group.nades.length > 1;
    const stack = open && <div className="radar-stack-open" style={style}
      data-anchor={point.x < 0.15 ? "start" : point.x > 0.85 ? "end" : "center"} data-placement={point.y < 0.18 ? "below" : "above"} role="group" aria-label={`${group.nades.length} Lineups · ${group.title}`}>
      <span className="radar-stack-caption" aria-hidden="true">{stackFocus ? <><strong>{stackFocus.displayName || stackFocus.name}</strong> · {throwAttributeSummary(stackFocus)}</> : `${group.nades.length} Lineups · Lineup wählen`}</span>
      {group.nades.map(nade => {
        const single = { ...group, nades: [nade] };
        const video = nade.official && nade.reviewMedia?.video;
        return <Link key={lineupKey(nade)} to={href(nade)} className="radar-stack-item" data-team={nade.team || "unassigned"} data-official={nade.official || undefined}
          aria-label={`${nade.displayName || nade.name}${nade.official ? " · Offiziell" : ""} · ${throwAttributeSummary(nade)}`}
          onMouseEnter={event => { setStackFocus(nade); if (video) showPreview(single, event.currentTarget); }}
          onMouseLeave={() => { setStackFocus(current => current === nade ? null : current); if (video) hidePreview(); }}
          onFocus={event => { setStackFocus(nade); if (video) showPreview(single, event.currentTarget); }}
          onBlur={event => { setStackFocus(current => current === nade ? null : current); if (video && !(event.relatedTarget instanceof Element && event.relatedTarget.closest(".radar-preview"))) hidePreview(); }}
          onClick={event => {
            if (!event.shiftKey || event.altKey || !nade.official || !nade.reviewMedia?.aim) return;
            event.preventDefault(); cancelTimer(); setPreview(null); previewTrigger.current = event.currentTarget; onCloseOptions(); setZoomNade(nade);
          }}>{nade.official && <BookOpen aria-hidden="true" />}</Link>;
      })}
    </div>;
    if (secondary && group.nades.length === 1) return <Link key={`true-${group.id}`} to={href(group.nades[0])}
      className={className} data-team={team || "unassigned"} style={style} aria-label={label} {...hoverProps} onClick={openAim}>{content}</Link>;
    return <Fragment key={`${secondary}-${group.id}`}><button type="button" className={className}
      data-team={team || "unassigned"} data-stack-trigger={open || undefined} style={style} aria-label={label}
      aria-pressed={active} aria-expanded={secondary ? group === expanded : undefined}
      aria-haspopup={secondary ? "true" : undefined}
      {...(open ? {} : hoverProps)} onClick={event => {
        if (openAim(event)) return;
        if (open) { onCloseOptions(); return; }
        if (secondary) { cancelTimer(); setPreview(null); optionsTrigger.current = event.currentTarget; focusStack.current = event.detail === 0; onExpand(group); }
        else onSelect(group);
      }}>{content}</button>{stack}</Fragment>;
  }
  return <div className="radar-browser" role="group" aria-label={`Interaktive Radarkarte von ${map.name}`}>
    <div className="radar-browser-image" style={{ aspectRatio: `${width} / ${height}`, "--radar-aspect": width / height } as CSSProperties}>
      <svg className="radar-browser-background" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${map.name}${map.radarLowerUrl ? level === "lower" ? ": Untere Ebene" : ": Obere Ebene" : ""}`}><RadarBackground map={map} level={level} /></svg>
      {map.radarLowerUrl && <RadarLevelSwitch level={level} onChange={setLevel} />}
      {selected && <svg className="radar-browser-lines" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {counterparts.filter(group => radarPointVisible(map, selected.point, level) && radarPointVisible(map, group.point, level)).map(group => <line key={group.id} x1={selected.point.x * width} y1={selected.point.y * height} x2={group.point.x * width} y2={group.point.y * height} className={cn(expanded && group !== expanded && "radar-line-muted")} />)}
      </svg>}
      {(selected ? [selected] : groups).filter(group => radarPointVisible(map, group.point, level)).map(group => marker(group, side))}
      {selected && counterparts.filter(group => radarPointVisible(map, group.point, level)).map(group => marker(group, side === "from" ? "to" : "from", true))}
    </div>
    {preview && createPortal(<div className="radar-preview" role="dialog" aria-label="Lineup-Vorschau" style={{ left: preview.left, top: preview.top }} onMouseEnter={cancelTimer} onMouseLeave={hidePreview} onFocus={cancelTimer} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) hidePreview(); }}>
      {(() => {
        const candidates = preview.group.nades.filter(nade => nade.official && nade.reviewMedia?.video);
        const nade = candidates[preview.index] || candidates[0];
        if (!nade) return null;
        const previewImage = heldSlot && nade.reviewMedia?.[heldSlot];
        const previewTitle = REVIEW_STEPS.find(step => step.id === heldSlot)?.title;
        return <>
          <Link className="radar-preview-media" to={href(nade)} aria-label={previewImage ? `${previewTitle}: Lineup öffnen` : "Vollständiges Wurfvideo öffnen"} onClick={event => { if (event.shiftKey && !event.altKey && nade.reviewMedia?.aim) { event.preventDefault(); cancelTimer(); setPreview(null); setZoomNade(nade); } }}>
            <HoverVideo key={nade.reviewMedia!.video!.key} nade={nade} active={!previewImage} />
            {previewImage && <div className={cn("radar-preview-photo", heldSlot === "aim" && "radar-preview-photo-zoom")}><img src={previewImage.url} alt={`${previewTitle}: ${nade.displayName || nade.name}`} /></div>}
          </Link>
          <div className="radar-preview-technique">{nade.is_jumpthrow && <ArrowUp aria-label="Jumpthrow" />}<ThrowClickIcon clickType={nade.click_type || "left"} /><span>{throwAttributeSummary(nade)}</span></div>
          {candidates.length > 1 && <div className="flex flex-wrap gap-1" aria-label="Lineup für die Vorschau auswählen">{candidates.map((candidate, index) => <Button key={lineupKey(candidate)} size="sm" variant={index === preview.index ? "default" : "secondary"} aria-pressed={index === preview.index} aria-label={candidate.displayName || candidate.name} onClick={() => setPreview(current => current && { ...current, index })}>{index + 1}</Button>)}</div>}
        </>;
      })()}
    </div>, document.body)}
    <CrosshairView key={zoomNade ? lineupKey(zoomNade) : "closed"} nade={zoomNade} open={!!zoomNade} onOpenChange={open => { if (!open) { setZoomNade(null); previewTrigger.current?.focus(); } }} />
  </div>;
}

function HoverVideo({ nade, active }: { nade: RadarLineup; active: boolean }) {
  const [original, setOriginal] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  function play() {
    if (!activeRef.current || !video.current) return;
    void video.current.play().then(() => setBlocked(false)).catch(error => {
      if (activeRef.current && error.name !== "AbortError") setBlocked(true);
    });
  }
  useEffect(() => {
    if (!video.current) return;
    if (active) {
      video.current.currentTime = 0;
      play();
    }
    else video.current.pause();
  }, [active]);
  return <div className="radar-preview-video">
    {!failed && <video ref={video} src={original ? nade.reviewMedia!.video!.url : `/api/nades/video-preview/${encodeURIComponent(nade.reviewMedia!.video!.key)}`} muted autoPlay loop playsInline preload="auto" aria-label="Videovorschau des Wurfs"
      onCanPlay={() => { setReady(true); if (activeRef.current) play(); else video.current?.pause(); }}
      onEnded={() => { if (activeRef.current && video.current) { video.current.currentTime = 0; play(); } }}
      onPause={() => { if (activeRef.current) play(); }}
      onError={() => { if (!original) { setReady(false); setBlocked(false); setOriginal(true); } else setFailed(true); }} />}
    {failed ? <p role="status">Die Videovorschau ist gerade nicht verfügbar. Klicke für das vollständige Video.</p> : !ready ? <p role="status">Videovorschau wird geladen …</p> : blocked ? <p role="status">Klicke für das vollständige Video.</p> : null}
  </div>;
}
