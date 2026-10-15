import { isPlatformAdmin } from "../../../shared/authorization";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Copy, RefreshCw, Save, Trash2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "./ui/field";
import { Switch } from "./ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Dialog, DialogTrigger, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "./ui/empty";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { TeamIcon, GrenadeIcon } from "./nade-icons";
import { LINEUP_TEAMS, TEAM_LABELS, isLineupTeam } from "../../../shared/lineup-teams";
import { ActionButton } from "./action-button";
import { NadeFlightMap, NadePlacementEditor } from "./map-radar";
import { FavoriteButton } from "./nade-favorites";
import { OfficialLineupDetail } from "./lineup-presentation";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { mapMatchesNade, mapPath, mapSlug } from "../lib/maps";
import { findLineup, lineupKey, lineupPath, lineupReviewPath } from "../lib/lineups";
import { inferRadarCalibration, resolveRadarPoints } from "../lib/nade-radar";
import { LINEUP_CAPTURE_FIELDS, LINEUP_EDIT_FIELDS, lineupPermissions } from "../../../shared/lineup-policy";
import { THROW_FLAGS, BOOLEAN_THROW_FLAGS, THROW_FLAG_LABELS, CLICK_TYPES, CLICK_LABELS, MOVEMENT_TYPES, MOVEMENT_LABELS, movementType, movementPatch, type MovementType } from "../../../shared/throw-attributes";

// three.js and the scene loader only load when someone opens the Abwurfsicht.
const LineupPov = lazy(() => import("./lineup-pov"));
const LINEUP_VIEW_KEY = "playbook.lineupView";

function LineupViews({ map, nade, children }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem(LINEUP_VIEW_KEY) === "pov" ? "pov" : "map"; } catch { return "map"; } });
  const choose = (value: string) => { setView(value); try { localStorage.setItem(LINEUP_VIEW_KEY, value); } catch {} };
  return <Tabs value={view} onValueChange={choose} className="lineup-view-tabs">
    <TabsList variant="line" aria-label="Ansicht des Lineups"><TabsTrigger value="map">Karte</TabsTrigger><TabsTrigger value="pov">Abwurfsicht</TabsTrigger></TabsList>
    <TabsContent value="map">{children}</TabsContent>
    <TabsContent value="pov"><Suspense fallback={<div className="lineup-pov-stage" aria-busy="true" />}>
      <LineupPov nade={nade} mapName={map.mapName || nade.map} mapLabel={map.name} onShowMap={() => choose("map")} />
    </Suspense></TabsContent>
  </Tabs>;
}

export function LineupPage({ maps, nades, user, onEntriesChange, onRefresh }) {
  const { mapSlug: slug, lineupId } = useParams();
  const [search] = useSearchParams();
  const map = maps.find(map => mapSlug(map) === slug);
  const nade = findLineup<any>(nades, lineupId);
  if (!map || !nade || !mapMatchesNade(map, nade.map)) return <Empty><EmptyHeader><EmptyTitle>Lineup nicht gefunden</EmptyTitle><EmptyDescription>Diese Aufnahme wurde entfernt oder der Link ist ungültig.</EmptyDescription></EmptyHeader><EmptyContent><Button asChild variant="secondary"><Link to={map ? mapPath(map) : "/maps"}>Zurück zu den Maps</Link></Button></EmptyContent></Empty>;
  const back = `${mapPath(map)}${search.size ? `?${search}` : ""}`;
  return <LineupContent key={lineupKey(nade)} {...{ nade, map, nades, user, onEntriesChange, onRefresh, back }} />;
}

export function NewLineupPage({ maps, nades, user, onEntriesChange, onRefresh }) {
  const { mapSlug: slug } = useParams();
  const map = maps.find(map => mapSlug(map) === slug);
  if (!isPlatformAdmin(user) || !map?.mapName) return <Navigate to={map ? mapPath(map) : "/maps"} replace />;
  const nade = { owner: user.identitySteam64, map: map.mapName, name: "", type: "Smoke", team: "both", click_type: "left" };
  return <LineupContent key={`new-${map.key}`} {...{ nade, map, nades, user, onEntriesChange, onRefresh }} back={mapPath(map)} creating />;
}

function editableValues(nade, creating = false) {
  return Object.fromEntries((creating ? LINEUP_CAPTURE_FIELDS : LINEUP_EDIT_FIELDS).map(key => [key, nade[key] ?? (THROW_FLAGS.includes(key as any) ? false : key === "click_type" ? "left" : key.startsWith("radar") || key === "flightDuration" ? null : "")]));
}

function formatThrowTrace(value) {
  try {
    const samples = JSON.parse(String(value || ""));
    if (!Array.isArray(samples)) return "";
    return samples.map(sample => `${Number(sample.time ?? sample.Time).toFixed(2)}s · ${sample.buttons ?? sample.Buttons ?? "keine Taste"} · Position ${sample.position ?? sample.Position ?? "?"} · Geschwindigkeit ${sample.velocity ?? sample.Velocity ?? "?"} · Blickwinkel ${sample.view ?? sample.View ?? "?"}`).join("\n");
  } catch { return ""; }
}

function LineupContent({ nade, map, nades, user, onEntriesChange, onRefresh, back, creating = false }) {
  const navigate = useNavigate();
  const permissions = lineupPermissions(nade, user);
  const [draft, setDraft] = useState(() => editableValues(nade, creating));
  const [baseline, setBaseline] = useState(() => JSON.stringify(editableValues(nade, creating)));
  const [placement, setPlacement] = useState(() => ({ radarFrom: nade.radarFrom ?? null, radarTo: nade.radarTo ?? null }));
  const [placementBaseline, setPlacementBaseline] = useState(() => JSON.stringify(placement));
  const [positioning, setPositioning] = useState(creating);
  const [revision, setRevision] = useState(nade.updatedAt || "");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const detailsDirty = permissions.edit && JSON.stringify(draft) !== baseline;
  const placementDirty = permissions.position && JSON.stringify(placement) !== placementBaseline;
  const dirty = detailsDirty || placementDirty;
  const canCreate = creating && Boolean(draft.displayName?.trim() && draft.lineupPos?.trim() && draft.lineupAng?.trim());
  const validDuration = !creating || draft.flightDuration === null || Number.isFinite(draft.flightDuration) && draft.flightDuration >= 0;
  const stale = dirty && revision !== (nade.updatedAt || "");
  const positionedNade = { ...nade, ...(permissions.edit ? draft : {}), ...placement };
  const calibration = inferRadarCalibration(map, nades.map(item => lineupKey(item) === lineupKey(nade) ? positionedNade : item));
  const points = resolveRadarPoints(positionedNade, calibration);
  const missingPosition = !points.radarFrom || !points.radarTo;

  function reset(entry = nade) {
    const values = editableValues(entry, creating);
    setDraft(values);
    setBaseline(JSON.stringify(values));
    const positions = { radarFrom: entry.radarFrom ?? null, radarTo: entry.radarTo ?? null };
    setPlacement(positions);
    setPlacementBaseline(JSON.stringify(positions));
    setRevision(entry.updatedAt || "");
  }
  useEffect(() => {
    // A background refresh must not replace an unfinished edit.
    if (!dirty && !creating) reset(nade);
  }, [nade, dirty, creating]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function patch(value) {
    setDraft(current => ({ ...current, ...value,
      ...(["lineupPos", "lineupAng", "type"].some(key => key in value && value[key] !== current[key]) ? { flightDuration: null } : {}),
    }));
  }
  async function mutate(action, extra = {}) {
    if (running.current) throw new Error("Eine Aktion läuft bereits.");
    running.current = true;
    setBusy(true);
    try {
      const result = await api("/api/nades/entry", { method: "POST", body: JSON.stringify({
        ...(creating ? { map: nade.map } : { owner: nade.owner, map: nade.map, name: nade.name,
          revision: ["edit", "position"].includes(action) ? revision : nade.updatedAt || "" }), action, ...extra,
      }) });
      if (creating) {
        onEntriesChange(result.entries);
        navigate(lineupPath(map, result.entry));
        return;
      }
      const updated = result.entries.find(item => lineupKey(item) === lineupKey(nade));
      if (updated) reset(updated);
      if (action === "position") setPositioning(false);
      if (action === "delete") navigate(back);
      onEntriesChange(result.entries);
    } finally { running.current = false; setBusy(false); }
  }

  function textField(key, title, placeholder = "", maxLength = 120) {
    const id = `lineup-field-${key}`;
    return <Field htmlFor={id}><FieldLabel>{title}</FieldLabel><Input id={id} required={creating && ["displayName", "lineupPos", "lineupAng"].includes(key)} value={draft[key]} onChange={event => patch({ [key]: event.target.value })} placeholder={placeholder} maxLength={maxLength} /></Field>;
  }

  const mapContent = (
        <>
        {permissions.position && !nade.official && <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy} aria-expanded={positioning} onClick={() => setPositioning(value => !value)}>{positioning ? "Kartenansicht" : missingPosition ? "Start und Ziel setzen" : "Positionierung bearbeiten"}</Button>
        </div>}
        {permissions.position && positioning ? <fieldset disabled={busy} className="min-w-0" inert={busy || undefined}>
          <NadePlacementEditor map={map} value={positionedNade} onChange={value => setPlacement(current => ({ ...current, ...value }))} calibration={calibration} />
          {!creating && <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton icon={Save} disabled={busy || !placementDirty || stale || detailsDirty} onClick={() => mutate("position", { patch: placement })} pendingLabel="Speichert …" successLabel="Gespeichert">Positionierung speichern</ActionButton>
            {placementDirty && <Button variant="ghost" disabled={busy} onClick={() => { setPlacement(JSON.parse(placementBaseline)); }}>Positionierung verwerfen</Button>}
          </div>}
          {detailsDirty && <p className="mt-2 text-xs text-muted-foreground">Speichere die Positionierung zusammen mit deinen weiteren Änderungen über „Speichern“.</p>}
          {stale && <p className="mt-2 text-xs text-muted-foreground" role="status">Diese Aufnahme wurde inzwischen geändert. Verwirf deine Änderungen, um den aktuellen Stand zu laden.</p>}
        </fieldset> : creating ? <><NadeFlightMap map={map} nades={[positionedNade]} calibration={calibration} /><p className="mt-3 text-xs text-muted-foreground">Kreis: Startposition · Raute: Landeposition</p></>
          : <LineupViews map={map} nade={nade}><NadeFlightMap map={map} nades={[positionedNade]} calibration={calibration} /><p className="mt-3 text-xs text-muted-foreground">Kreis: Startposition · Raute: Landeposition</p></LineupViews>}
        {map.radarLowerUrl && <p className="mt-3 text-xs text-muted-foreground">1: obere Ebene · 2: untere Ebene. Start und Ziel werden anhand ihrer jeweiligen Höhe zugeordnet. Über den Umschalter rechts oben kannst du die Ebene wechseln und Positionen korrigieren.</p>}
        {!calibration && permissions.position && <p className="mt-3 text-xs text-muted-foreground">{map.mapName === "de_nuke" ? "Für dieses Nuke-Kartenbild fehlt die Kalibrierung der Ebenen. Setze Start und Ziel manuell." : "Für diese Map fehlen verlässliche Referenzen. Setze Start und Ziel auf der Karte. Gespeicherte Markierungen mit Spielkoordinaten dienen als Referenzen für weitere Nades und können über „Positionierung bearbeiten“ korrigiert werden."}</p>}
        </>
  );
  const deleteDialog = (
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent><DialogHeader><DialogTitle>Lineup löschen?</DialogTitle><DialogDescription>„{nade.displayName || nade.name}“ wird aus der Bibliothek entfernt. Das lässt sich nicht rückgängig machen.</DialogDescription></DialogHeader><DialogFooter><Button variant="secondary" disabled={busy} onClick={() => setDeleteOpen(false)}>Abbrechen</Button><ActionButton variant="destructive" icon={Trash2} disabled={busy} onClick={() => mutate("delete")} pendingLabel="Löscht …">Endgültig löschen</ActionButton></DialogFooter></DialogContent></Dialog>
  );
  function closePositioning() {
    if (busy) return;
    setPlacement(JSON.parse(placementBaseline));
    setPositioning(false);
  }
  if (nade.official && !creating) return <Dialog open={positioning} onOpenChange={open => { if (open) setPositioning(true); else closePositioning(); }}><OfficialLineupDetail nade={nade} map={map} back={back}
    onBack={event => { if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) event.preventDefault(); }}
    management={<>
      {permissions.position && <DialogTrigger asChild><Button variant="secondary" disabled={busy}>{missingPosition ? "Start und Ziel setzen" : "Positionierung bearbeiten"}</Button></DialogTrigger>}
      <Button variant="secondary" disabled={busy || dirty} onClick={() => navigate(lineupReviewPath(map, nade))}>Review öffnen</Button>
      {permissions.revoke && <ActionButton variant="ghost" disabled={busy || dirty} onClick={() => mutate("revoke")} successLabel="Zurückgenommen">Freigabe zurücknehmen</ActionButton>}
      <details className="lineup-coordinates"><summary>Koordinaten</summary><dl className="lineup-detail-facts mt-4"><div><dt>Start</dt><dd className="font-mono">{nade.lineupPos || "Nicht hinterlegt"}</dd></div><div><dt>Blickwinkel</dt><dd className="font-mono">{nade.lineupAng || "Nicht hinterlegt"}</dd></div><div><dt>Landeposition</dt><dd className="font-mono">{nade.landingPos || "Nicht hinterlegt"}</dd></div></dl></details>
      {nade.throwTrace && <details className="lineup-coordinates"><summary>Aufgezeichnete Tasten und Bewegung</summary><pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{formatThrowTrace(nade.throwTrace) || "Keine lesbaren Wurfdaten vorhanden."}</pre></details>}
      <code className="break-all text-xs text-muted-foreground">.loadnade {nade.name}</code>
      <div className="flex flex-wrap gap-2"><ActionButton variant="ghost" size="sm" icon={RefreshCw} onClick={onRefresh} disabled={busy} successLabel="Aktualisiert">Aktualisieren</ActionButton>{permissions.delete && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 />Löschen</Button>}</div>
    </>}>
      {permissions.position && <DialogContent className="lineup-placement-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Positionierung bearbeiten</DialogTitle><DialogDescription>Setze Start und Ziel für „{nade.displayName || nade.name}“ auf der Karte. Wurfdaten und Freigaben bleiben erhalten.</DialogDescription></DialogHeader>
        {mapContent}
        <DialogFooter><Button variant="secondary" disabled={busy} onClick={closePositioning}>Abbrechen</Button></DialogFooter>
      </DialogContent>}
      {deleteDialog}
    </OfficialLineupDetail></Dialog>;

  return <article className="playbook-page lineup-page">
    <div><Button asChild variant="ghost" size="sm"><Link to={back} onClick={event => {
      if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) event.preventDefault();
    }}><ArrowLeft data-icon="inline-start" />{map.name}</Link></Button></div>
    <div className="lineup-workspace">
      <div className="lineup-radar">
        {mapContent}
      </div>
      <aside className="lineup-sidebar" aria-label="Lineup und Anleitung">
        <header className="grid gap-3">
          <div className="flex items-center justify-between gap-3"><span className="control-kicker flex items-center gap-2"><GrenadeIcon type={creating ? draft.type : nade.type} />{map.name} · {creating ? draft.type : nade.type === "Molly" ? "Molotov" : nade.type}</span>{!creating && <FavoriteButton nade={nade} />}</div>
          <h1>{creating ? "Nade hinzufügen" : nade.displayName || nade.name}</h1>
          {creating && <p className="text-sm text-muted-foreground">Trage die Wurfdaten und eine Anleitung ein. Startkoordinaten und Blickwinkel sind erforderlich, damit die Nade im Spiel geladen werden kann. Radarpositionen kannst du per Klick setzen. Die Nade wird als dein Entwurf gespeichert.</p>}
          <div className="flex flex-wrap gap-2">
            {isLineupTeam(nade.team) && <Badge tone={nade.team === "t" || nade.team === "ct" ? nade.team : undefined} variant="outline"><TeamIcon team={nade.team} className="size-4" />{TEAM_LABELS[nade.team]}</Badge>}
            {nade.official && <Badge variant="success">Offiziell</Badge>}{nade.mustKnow && <Badge variant="highlight">Must Know</Badge>}
            {!nade.official && nade.reviewStatus === "pending" && <Badge variant="outline">Im Review</Badge>}
            {!nade.official && nade.reviewStatus === "rejected" && <Badge variant="outline">Überarbeitung angefragt</Badge>}
          </div>
        </header>
        {creating ? <form onSubmit={event => event.preventDefault()}>
          <fieldset disabled={busy} className="min-w-0">
            <FieldGroup>
              {textField("displayName", "Name", nade.name)}
              <Field><FieldLabel>Granate</FieldLabel><Select value={draft.type} onValueChange={type => patch({ type })}><SelectTrigger aria-label="Granate"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["Smoke", "Flash", "Molly", "HE", "Decoy"].map(type => <SelectItem key={type} value={type}>{type === "Molly" ? "Molotov" : type}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Seite</legend>
                <ToggleGroup type="single" variant="outline" value={draft.team} disabled={busy} onValueChange={team => { if (team) patch({ team }); }} aria-label="Seite des Lineups" className="grid w-full grid-cols-3">
                  {LINEUP_TEAMS.map(team => <ToggleGroupItem key={team} value={team}><TeamIcon team={team} />{TEAM_LABELS[team]}</ToggleGroupItem>)}
                </ToggleGroup>
              </fieldset>
              {textField("throwFromTitle", "Startposition", "z. B. T-Spawn")}
              {textField("throwToTitle", "Endposition", "z. B. Fenster")}
              <FieldSet><FieldLegend>Wurfattribute</FieldLegend><FieldGroup>
                {BOOLEAN_THROW_FLAGS.map(key => <Field key={key} htmlFor={`throw-${key}`} className="flex items-center justify-between gap-3"><FieldLabel>{THROW_FLAG_LABELS[key]}</FieldLabel><Switch id={`throw-${key}`} aria-label={THROW_FLAG_LABELS[key]} checked={draft[key] === true} disabled={busy} onCheckedChange={value => patch({ [key]: value })} /></Field>)}
                <FieldSet><FieldLegend>Bewegung</FieldLegend><ToggleGroup type="single" variant="outline" value={movementType(draft)} disabled={busy} onValueChange={mode => { if (mode) patch(movementPatch(mode as MovementType)); }} aria-label="Bewegung beim Wurf" className="grid w-full grid-cols-2">
                  {MOVEMENT_TYPES.map(mode => <ToggleGroupItem key={mode} value={mode}>{MOVEMENT_LABELS[mode]}</ToggleGroupItem>)}
                </ToggleGroup></FieldSet>
                <FieldSet><FieldLegend>Maustaste</FieldLegend><ToggleGroup type="single" variant="outline" value={draft.click_type} disabled={busy} onValueChange={click_type => { if (click_type) patch({ click_type }); }} aria-label="Maustaste" className="grid w-full grid-cols-3">
                  {CLICK_TYPES.map(type => <ToggleGroupItem key={type} value={type} aria-label={CLICK_LABELS[type]}>{type === "both" ? "Beide" : CLICK_LABELS[type]}</ToggleGroupItem>)}
                </ToggleGroup></FieldSet>
              </FieldGroup></FieldSet>
              <Field htmlFor="lineup-flight-duration" data-invalid={!validDuration || undefined}><FieldLabel>Flugzeit in Sekunden</FieldLabel><Input id="lineup-flight-duration" type="number" min="0" step="any" aria-invalid={!validDuration || undefined} value={draft.flightDuration ?? ""} onChange={event => patch({ flightDuration: event.target.value === "" ? null : event.target.valueAsNumber })} placeholder="z. B. 3,25" /><p className="text-xs text-muted-foreground">Vom Abwurf bis zur Explosion oder zum Beginn des Effekts. Wird bei einer Aufnahme automatisch gemessen. Leer lassen, wenn die Zeit unbekannt ist.</p></Field>
              <Field><FieldLabel>Anleitung</FieldLabel><Textarea rows={5} value={draft.desc} onChange={event => patch({ desc: event.target.value })} maxLength={4000} placeholder="Positionierung, Ausrichtung und Wurf beschreiben …" /></Field>
              <details className="lineup-coordinates" open={creating || undefined}><summary>{creating ? "Koordinaten eingeben" : "Koordinaten bearbeiten"}</summary><FieldGroup className="mt-4">
                {textField("lineupPos", "Startkoordinaten", "x y z")}
                {textField("lineupAng", "Blickwinkel", "x y z")}
                {textField("landingPos", "Landekoordinaten", "x y z")}
              </FieldGroup></details>
              <div className="flex flex-wrap items-start gap-2">
                <ActionButton icon={Save} onClick={() => mutate(creating ? "create" : detailsDirty ? "edit" : "position", { patch: creating || detailsDirty ? { ...draft, ...placement } : placement })} disabled={busy || !validDuration || (creating ? !canCreate : !dirty || stale)} pendingLabel="Speichert …" successLabel="Gespeichert">{creating ? "Nade hinzufügen" : "Speichern"}</ActionButton>
                {dirty && <Button variant="ghost" onClick={() => reset()} disabled={busy}>Änderungen verwerfen</Button>}
              </div>
              {dirty && <p className="text-xs text-muted-foreground" role="status">{creating ? "Ungespeicherter Entwurf. Name, Startkoordinaten und Blickwinkel sind erforderlich." : stale ? "Diese Aufnahme wurde inzwischen geändert. Verwirf deine Änderungen, um den aktuellen Stand zu laden." : detailsDirty ? "Ungespeicherte Änderungen. Nach dem Speichern kannst du das Lineup erneut zum Review einreichen." : "Ungespeicherte Kartenpositionen. Der Review-Status bleibt erhalten."}</p>}
            </FieldGroup>
          </fieldset>
        </form> : <div className="grid gap-5">
          {permissions.edit && <form onSubmit={event => event.preventDefault()}><fieldset disabled={busy} className="min-w-0"><FieldGroup>
            <FieldSet><FieldLegend>Seite</FieldLegend><ToggleGroup type="single" variant="outline" value={draft.team} disabled={busy} onValueChange={team => { if (team) patch({ team }); }} aria-label="Seite des Lineups" className="grid w-full grid-cols-3">
              {LINEUP_TEAMS.map(team => <ToggleGroupItem key={team} value={team}><TeamIcon team={team} />{TEAM_LABELS[team]}</ToggleGroupItem>)}
            </ToggleGroup></FieldSet>
            {textField("throwFromTitle", "Startposition", "z. B. T-Spawn")}
            {textField("throwToTitle", "Endposition", "z. B. Fenster")}
            <div className="flex flex-wrap gap-2"><ActionButton icon={Save} disabled={busy || !dirty || stale} onClick={() => mutate(detailsDirty ? "edit" : "position", { patch: detailsDirty ? { ...draft, ...placement } : placement })} pendingLabel="Speichert …" successLabel="Gespeichert">Speichern</ActionButton>
              {dirty && <Button variant="ghost" disabled={busy} onClick={() => reset()}>Änderungen verwerfen</Button>}
            </div>
            {stale && <p role="status" className="text-xs text-muted-foreground">Diese Aufnahme wurde inzwischen geändert. Verwirf deine Änderungen, um den aktuellen Stand zu laden.</p>}
          </FieldGroup></fieldset></form>}
          {!nade.official && <><p className="text-xs text-muted-foreground">Wurfdaten werden automatisch vom Server erfasst und bleiben beim Training erhalten. Der Ersteller kann den Wurf im Server-Panel über „Lineup bearbeiten“ neu aufnehmen.</p>
          <dl className="lineup-detail-facts">
            <div><dt>Startposition</dt><dd>{nade.throwFromTitle || "Kreis auf der Karte"}</dd></div>
            <div><dt>Endposition</dt><dd>{nade.throwToTitle || "Raute auf der Karte"}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2" aria-label="Wurfattribute">
            {BOOLEAN_THROW_FLAGS.filter(key => nade[key] === true).map(key => <Badge variant="secondary" key={key}>{THROW_FLAG_LABELS[key]}</Badge>)}
            <Badge variant="secondary">{MOVEMENT_LABELS[movementType(nade)]}</Badge>
            {CLICK_TYPES.includes(nade.click_type) && <Badge variant="outline">{CLICK_LABELS[nade.click_type]}</Badge>}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{nade.desc || "Zu diesem Lineup gibt es noch keine Anleitung."}</p></>}
          <details className="lineup-coordinates"><summary>Koordinaten</summary><dl className="lineup-detail-facts mt-4">
            <div><dt>Start</dt><dd className="font-mono">{nade.lineupPos || "Nicht hinterlegt"}</dd></div>
            <div><dt>Blickwinkel</dt><dd className="font-mono">{nade.lineupAng || "Nicht hinterlegt"}</dd></div>
            <div><dt>Landeposition</dt><dd className="font-mono">{nade.landingPos || "Nicht hinterlegt"}</dd></div>
          </dl></details>
        </div>}
        {!creating && !nade.official && <dl className="lineup-detail-facts"><div><dt>Flugzeit</dt><dd>{typeof nade.flightDuration === "number" ? `${nade.flightDuration.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s` : "Noch nicht erfasst"}</dd></div></dl>}
        {!creating && <Button variant="secondary" disabled={busy || dirty} onClick={() => navigate(lineupReviewPath(map, nade))}>Review öffnen</Button>}
        {!creating && permissions.revoke && (nade.official || nade.reviewStatus === "pending") && <ActionButton variant="ghost" disabled={busy || dirty} onClick={() => mutate("revoke")} successLabel="Zurückgenommen">{nade.official ? "Freigabe zurücknehmen" : "Review zurücknehmen"}</ActionButton>}
        {!creating && <div className="grid justify-items-start gap-2 border-t pt-4">
          <ActionButton variant="secondary" icon={Copy} onClick={() => copyText(`.loadnade ${nade.name}`)} successLabel="Kopiert">Ingame-Befehl kopieren</ActionButton>
          <code className="break-all text-xs text-muted-foreground">.loadnade {nade.name}</code>
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton variant="ghost" size="sm" icon={RefreshCw} onClick={onRefresh} disabled={busy} successLabel="Aktualisiert">Aktualisieren</ActionButton>
            {permissions.delete && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 data-icon="inline-start" />Löschen</Button>}
          </div>
        </div>}
      </aside>
    </div>
    {nade.throwTrace && <details className="lineup-coordinates"><summary>Aufgezeichnete Tasten und Bewegung</summary><pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{formatThrowTrace(nade.throwTrace) || "Keine lesbaren Wurfdaten vorhanden."}</pre></details>}
    {nade.lineupImages?.length > 0 && <section className="lineup-images" aria-label="Bilder zur Anleitung">{nade.lineupImages.map(image => <figure key={image.key || image.url}><img src={image.url} alt={image.name || `Ausrichtung für ${nade.displayName || nade.name}`} loading="lazy" /><figcaption>{image.name}</figcaption></figure>)}</section>}
    {deleteDialog}
  </article>;
}
