import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Play, RefreshCw, Upload } from "lucide-react";
import { api } from "@/lib/api";
import type { MapDefinition } from "@/lib/maps";
import { inferRadarCalibration } from "@/lib/nade-radar";
import type { Actor } from "../../../shared/authorization";
import { weaponLabel, type RoundBuy } from "../../../shared/demos";
import {
  BUYS,
  WINDOWS,
  buyBreakdown,
  heatPoints,
  mapPool,
  openingDuels,
  playerProfiles,
  plants,
  selectRounds,
  teamRounds,
  utilityGroups,
  type DetectedTeam,
  type Example,
  type Filters,
  type OpponentReport,
  type Window,
} from "../../../shared/opponent-report";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Field, FieldLabel } from "./ui/field";
import { Spinner } from "./ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Choice, Feedback, WorkspaceHeader } from "./workspace-ui";
import { AnalysisNav } from "./live-session-pages";
import { GrenadeIcon } from "./nade-icons";
import { ScoutingRadar, UTILITY_ICONS, UTILITY_LABELS, type ScoutingLayer } from "./scouting-radar";

type Props = { user: Actor; maps: MapDefinition[] };

const percent = (won: number, total: number) => (total ? `${Math.round((won / total) * 100)} %` : "–");
const day = (value: string) => new Date(value).toLocaleDateString("de-AT", { day: "2-digit", month: "long", year: "numeric" });
const elapsed = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
const sceneLink = (example: Example) =>
  `/analysis/demos/${example.demoId}?round=${encodeURIComponent(example.roundId)}&start=${Math.max(0, Math.round(example.time - 4))}&end=${Math.round(example.time + 6)}&focus=${encodeURIComponent(example.playerId)}`;
export const opponentLink = (players: string[]) => `/analysis/opponents/view?players=${players.join(",")}`;

function useReport<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: "", loading: !!path });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ data: null, error: "", loading: true });
    api(path, { signal: controller.signal })
      .then((data) => setState({ data, error: "", loading: false }))
      .catch((cause) => { if (!controller.signal.aborted) setState({ data: null, error: cause.message, loading: false }); });
    return () => controller.abort();
  }, [path, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

function Loading({ text }: { text: string }) {
  return (
    <div className="scout-loading" role="status">
      <Spinner aria-hidden="true" />
      <p>{text}</p>
      <p className="text-xs text-muted-foreground">Beim ersten Mal wertet Playbook jede Demo einmal aus, danach geht es schnell.</p>
    </div>
  );
}

function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>Die Auswertung konnte nicht geladen werden</EmptyTitle>
        <EmptyDescription>{error}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="secondary" size="sm" onClick={retry}><RefreshCw data-icon="inline-start" />Erneut versuchen</Button>
      </EmptyContent>
    </Empty>
  );
}

function TeamCard({ team, maps }: { team: DetectedTeam; maps: MapDefinition[] }) {
  const won = team.demos.reduce((sum, demo) => sum + demo.won, 0), lost = team.demos.reduce((sum, demo) => sum + demo.lost, 0);
  const records = [...new Set(team.demos.map((demo) => demo.map))].map((map) => {
    const played = team.demos.filter((demo) => demo.map === map);
    return { map, wins: played.filter((demo) => demo.won > demo.lost).length, losses: played.filter((demo) => demo.won < demo.lost).length };
  });
  const regulars = team.players.filter((player) => team.core.includes(player.id));
  return (
    <Link className="demo-review-card scout-team-card" to={opponentLink(team.core)}>
      <p className="demo-eyebrow">
        <strong>{team.demos.length} {team.demos.length === 1 ? "Demo" : "Demos"}</strong>
        <i>·</i>
        <span>zuletzt {day(team.demos[0].date)}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        <h2>{team.name}</h2>
        <p className="scout-team-players">
          {regulars.map((player) => player.name).join(" · ")}
          {team.players.length > regulars.length && ` · +${team.players.length - regulars.length} Ersatz`}
        </p>
      </div>
      <ul className="scout-team-maps" aria-label="Bilanz je Map">
        {records.map((record) => (
          <li key={record.map}>
            {maps.find((map) => map.mapName === record.map)?.name || record.map}
            <strong>{record.wins}:{record.losses}</strong>
          </li>
        ))}
      </ul>
      <footer>
        <span className="text-xs text-muted-foreground">{won} von {won + lost} Runden gewonnen</span>
        <span className="text-sm font-semibold text-primary">Analyse öffnen</span>
      </footer>
    </Link>
  );
}

export function OpponentsPage({ maps }: Props) {
  const report = useReport<{ teams: DetectedTeam[] }>("/api/analysis/opponents");
  const teams = report.data?.teams || [];
  const recurring = teams.filter((team) => !team.own && team.demos.length > 1);
  const own = teams.filter((team) => team.own);
  const single = teams.filter((team) => !team.own && team.demos.length === 1);
  return (
    <>
      <WorkspaceHeader
        title="Gegner"
        description="Teams aus euren Demos, erkannt an den Spielern: Map-Pool, Heatmaps, Utility und erste Duelle über alle Matches."
      />
      <AnalysisNav />
      {report.loading ? (
        <Loading text="Demos werden nach Teams durchsucht …" />
      ) : report.error ? (
        <LoadError error={report.error} retry={report.retry} />
      ) : (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3" aria-labelledby="recurring-teams">
            <h2 id="recurring-teams" className="scout-section-title">In mehreren Demos</h2>
            {recurring.length ? (
              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {recurring.map((team) => <TeamCard key={team.key} team={team} maps={maps} />)}
              </div>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>Noch kein Team in mehreren Demos</EmptyTitle>
                  <EmptyDescription>
                    Lade mindestens zwei Demos desselben Teams hoch, zum Beispiel mehrere FACEIT-Matches eures nächsten Gegners.
                    Spielen drei oder mehr Spieler gemeinsam auf einer Seite, gilt das als dasselbe Team.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button asChild size="sm"><Link to="/analysis"><Upload data-icon="inline-start" />Demos hochladen</Link></Button>
                </EmptyContent>
              </Empty>
            )}
          </section>
          {own.length > 0 && (
            <section className="flex flex-col gap-3" aria-labelledby="own-teams">
              <h2 id="own-teams" className="scout-section-title">Euer Team</h2>
              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {own.map((team) => <TeamCard key={team.key} team={team} maps={maps} />)}
              </div>
            </section>
          )}
          {single.length > 0 && (
            <details className="scout-single">
              <summary>In einer Demo · {single.length} {single.length === 1 ? "Team" : "Teams"}</summary>
              <ul>
                {single.map((team) => (
                  <li key={team.key}>
                    <Link to={opponentLink(team.core)}>
                      <strong>{team.name}</strong>
                      <span>{maps.find((map) => map.mapName === team.demos[0].map)?.name || team.demos[0].map} · {team.demos[0].title}</span>
                      <span>{team.demos[0].won}:{team.demos[0].lost}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </>
  );
}

const LAYERS: { value: ScoutingLayer; label: string }[] = [
  { value: "heat", label: "Aufenthalt" },
  { value: "utility", label: "Utility" },
  { value: "duels", label: "Erste Duelle" },
  { value: "plants", label: "Plants" },
];

export function OpponentPage({ maps }: Props) {
  const [params, setParams] = useSearchParams();
  const players = params.get("players") || "";
  const report = useReport<OpponentReport>(players ? `/api/analysis/opponents/report?players=${encodeURIComponent(players)}` : null);
  const data = report.data;
  const rounds = useMemo(() => (data ? teamRounds(data) : []), [data]);
  const pool = useMemo(() => (data ? mapPool(data, rounds) : []), [data, rounds]);
  const profiles = useMemo(() => (data ? playerProfiles(data, rounds) : []), [data, rounds]);
  const shownMap = pool.find((entry) => entry.map === params.get("map")) || pool[0];
  const filters: Filters = {
    map: shownMap?.map || "",
    // Without a choice the side the team actually played comes first.
    side: params.get("side") === "ct" ? 3 : params.get("side") === "t" ? 2 : shownMap && !shownMap.t.rounds && shownMap.ct.rounds ? 3 : 2,
    window: (WINDOWS.some((entry) => entry.value === params.get("window")) ? params.get("window") : "all") as Window,
    playerId: data?.players.some((player) => player.id === params.get("player")) ? params.get("player")! : "",
    buy: (BUYS.some((entry) => entry.value === params.get("buy")) ? params.get("buy") : "") as RoundBuy | "",
  };
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };
  const [layers, setLayers] = useState<ScoutingLayer[]>(["heat", "utility"]);
  const [selected, setSelected] = useState<number | null>(null);
  const filterKey = JSON.stringify(filters);
  useEffect(() => setSelected(null), [filterKey]);
  const chosen = useMemo(() => selectRounds(rounds, filters), [rounds, filterKey]);
  const points = useMemo(() => heatPoints(chosen, filters), [chosen, filterKey]);
  const groups = useMemo(() => utilityGroups(chosen, filters), [chosen, filterKey]);
  // One-off throws would bury the map; it shows spots used in at least two rounds, at most 15.
  const recurring = groups.filter((group) => group.rounds > 1).length;
  const limit = Math.min(15, Math.max(recurring, chosen.length < 4 ? 8 : 0));
  const marked = groups.slice(0, Math.max(limit, selected === null ? 0 : selected + 1));
  const duels = useMemo(() => openingDuels(chosen, filters), [chosen, filterKey]);
  const planted = useMemo(() => plants(chosen, filters), [chosen, filterKey]);
  const buys = useMemo(
    () => buyBreakdown(rounds.filter((round) => round.map === filters.map && round.side === filters.side)),
    [rounds, filters.map, filters.side],
  );
  const map = maps.find((entry) => entry.mapName === filters.map);
  const calibration = useMemo(() => (map ? inferRadarCalibration(map, []) : null), [map]);
  const name = (id: string) => data?.players.find((player) => player.id === id)?.name || id;
  const mapName = (id: string) => maps.find((entry) => entry.mapName === id)?.name || id;

  if (!players)
    return (
      <>
        <WorkspaceHeader title="Gegner" description="Gegneranalyse über mehrere Demos" />
        <AnalysisNav />
        <Feedback error="Wähle ein Team aus der Gegnerliste." />
        <Button asChild variant="secondary"><Link to="/analysis/opponents">Zur Gegnerliste</Link></Button>
      </>
    );
  if (!data)
    return (
      <>
        <WorkspaceHeader title="Gegneranalyse" description="Map-Pool, Spieler und Heatmaps über mehrere Demos" />
        <AnalysisNav />
        {report.error ? <LoadError error={report.error} retry={report.retry} /> : <Loading text="Demos des Teams werden ausgewertet …" />}
      </>
    );
  const side = filters.side === 2 ? "T" : "CT";
  const sideRounds = rounds.filter((round) => round.map === filters.map && round.side === filters.side);
  const demoCount = new Set(chosen.map((round) => round.demoId)).size;
  const duelsWon = duels.filter((duel) => duel.won).length;
  return (
    <>
      <WorkspaceHeader
        title={data.name}
        description={`${data.demos.length} ${data.demos.length === 1 ? "Demo" : "Demos"} · ${pool.length} ${pool.length === 1 ? "Map" : "Maps"} · zuletzt ${day(data.demos[0].date)}`}
      >
        {data.own && <Badge variant="secondary">Euer Team</Badge>}
      </WorkspaceHeader>
      <AnalysisNav />
      <div className="flex flex-col gap-6">
        <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className="demo-panel" aria-labelledby="map-pool">
            <header>
              <h2 id="map-pool">Map-Pool</h2>
              <p>Bilanz und Rundenquote je Seite über alle Demos. Eine Map wählen, um sie unten zu analysieren.</p>
            </header>
            <div className="scout-table-wrap">
              <table className="scout-table">
                <thead>
                  <tr><th scope="col">Map</th><th scope="col">Matches</th><th scope="col">Runden</th><th scope="col">T</th><th scope="col">CT</th><th scope="col">Pistol</th></tr>
                </thead>
                <tbody>
                  {pool.map((record) => (
                    <tr key={record.map} aria-selected={record.map === filters.map}>
                      <th scope="row">
                        <button type="button" onClick={() => set({ map: record.map })}>{mapName(record.map)}</button>
                      </th>
                      <td>{record.matches} <small>{record.wins}:{record.losses}</small></td>
                      <td>{percent(record.all.won, record.all.rounds)} <small>{record.all.won}/{record.all.rounds}</small></td>
                      <td>{percent(record.t.won, record.t.rounds)}</td>
                      <td>{percent(record.ct.won, record.ct.rounds)}</td>
                      <td>{record.pistol.rounds ? `${record.pistol.won}/${record.pistol.rounds}` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="demo-panel" aria-labelledby="player-profiles">
            <header>
              <h2 id="player-profiles">Spieler</h2>
              <p>Über alle Maps. Erste Duelle zählen den ersten Kill jeder Runde, gewonnen zu verloren.</p>
            </header>
            <div className="scout-table-wrap">
              <table className="scout-table">
                <thead>
                  <tr><th scope="col">Spieler</th><th scope="col">Runden</th><th scope="col">K/D</th><th scope="col">Erste Duelle</th><th scope="col">Utility je Runde</th><th scope="col">Meiste Kills mit</th></tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id} aria-selected={profile.id === filters.playerId}>
                      <th scope="row">
                        <button type="button" title="Auf der Karte nur diesen Spieler zeigen"
                          onClick={() => set({ player: profile.id === filters.playerId ? "" : profile.id })}>
                          {profile.name}
                        </button>
                        {profile.demos < data.demos.length && <small>{profile.demos} von {data.demos.length} Demos</small>}
                      </th>
                      <td>{profile.rounds}</td>
                      <td>{(profile.kills / Math.max(1, profile.deaths)).toFixed(2)} <small>{profile.kills}/{profile.deaths}</small></td>
                      <td>{profile.openingKills}:{profile.openingDeaths}</td>
                      <td>{(profile.utility / Math.max(1, profile.rounds)).toFixed(1)}</td>
                      <td>{profile.weapon ? weaponLabel(profile.weapon) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="flex flex-col gap-4" aria-labelledby="map-analysis">
          <div className="scout-filters">
            <h2 id="map-analysis" className="scout-section-title">{mapName(filters.map)}</h2>
            {pool.length > 1 && (
              <Field>
                <FieldLabel>Map</FieldLabel>
                <ToggleGroup type="single" variant="outline" value={filters.map} onValueChange={(value) => value && set({ map: value })} aria-label="Map">
                  {pool.map((record) => <ToggleGroupItem key={record.map} value={record.map}>{mapName(record.map)}</ToggleGroupItem>)}
                </ToggleGroup>
              </Field>
            )}
            <Field>
              <FieldLabel>Seite</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={filters.side === 2 ? "t" : "ct"} onValueChange={(value) => value && set({ side: value })} aria-label="Seite">
                <ToggleGroupItem value="t" className="scout-side" data-side="t">T-Seite</ToggleGroupItem>
                <ToggleGroupItem value="ct" className="scout-side" data-side="ct">CT-Seite</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Choice label="Zeitraum" value={filters.window === "all" ? "" : filters.window} onChange={(value) => set({ window: value })}
              options={WINDOWS.map((entry) => ({ value: entry.value === "all" ? "" : entry.value, label: entry.label }))} />
            <Choice label="Spieler" value={filters.playerId} onChange={(value) => set({ player: value })}
              options={[{ value: "", label: "Ganzes Team" }, ...data.players.map((player) => ({ value: player.id, label: player.name }))]} />
            <Choice label="Buy" value={filters.buy} onChange={(value) => set({ buy: value })}
              options={[{ value: "", label: "Alle Buys" }, ...BUYS.map((entry) => ({ value: entry.value, label: entry.label }))]} />
          </div>
          <div className="scout-map-grid">
            <div className="flex min-w-0 flex-col gap-3">
              {map && calibration ? (
                <ScoutingRadar map={map} calibration={calibration} side={filters.side} points={points} utility={marked}
                  duels={duels} plants={planted} layers={new Set(layers)} selected={selected} onSelect={setSelected} names={name} />
              ) : (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyTitle>Kein kalibriertes Radar für {mapName(filters.map)}</EmptyTitle>
                    <EmptyDescription>Die Auswertungen rechts gelten trotzdem; nur die Karte fehlt.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              <div className="scout-legend">
                <ToggleGroup type="multiple" variant="outline" size="sm" value={layers}
                  onValueChange={(value) => setLayers(value as ScoutingLayer[])} aria-label="Ebenen">
                  {LAYERS.filter((layer) => layer.value !== "plants" || filters.side === 2).map((layer) => (
                    <ToggleGroupItem key={layer.value} value={layer.value}>{layer.label}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <span className="scout-legend-heat" data-side={filters.side === 2 ? "t" : "ct"}><i aria-hidden="true" />selten bis häufig</span>
                <span className="scout-legend-duel" data-side={filters.side === 2 ? "t" : "ct"}><i aria-hidden="true" />erster Kill <b aria-hidden="true">✕</b>erster Tod</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {chosen.length
                  ? `Grundlage: ${chosen.length} ${side}-Runden aus ${demoCount} ${demoCount === 1 ? "Demo" : "Demos"} · ${points.length.toLocaleString("de-AT")} Sekunden Aufenthalt, einmal pro Sekunde und Spieler.`
                  : `Keine ${side}-Runden mit dieser Auswahl.`}
                {" "}Zeiten zählen ab Ende der Kaufphase.
              </p>
            </div>
            <aside className="flex min-w-0 flex-col gap-4">
              <section className="demo-panel" aria-labelledby="utility-panel">
                <header>
                  <h2 id="utility-panel">Wiederkehrende Utility</h2>
                  <p>Landepunkte, die in mehreren Runden fallen. Wählen zeigt die Wurfpositionen auf der Karte.</p>
                </header>
                <ol className="scout-utility-list">
                  {groups.slice(0, 8).map((group, index) => (
                    <li key={index} data-active={selected === index}>
                      <button type="button" aria-pressed={selected === index} onClick={() => setSelected(selected === index ? null : index)}>
                        <GrenadeIcon type={UTILITY_ICONS[group.kind]} className="size-4" />
                        <span>
                          <strong>{UTILITY_LABELS[group.kind]}</strong>
                          {" "}in {group.rounds} von {chosen.length} Runden
                          <small>meist nach {elapsed(group.time)} · {group.players.slice(0, 2).map(name).join(", ")}</small>
                        </span>
                      </button>
                      <Button asChild variant="ghost" size="icon" aria-label="Beispiel im Match ansehen" title="Beispiel im Match ansehen">
                        <Link to={sceneLink(group.example)}><Play /></Link>
                      </Button>
                    </li>
                  ))}
                  {!groups.length && <li className="text-sm text-muted-foreground">Keine Utility in dieser Auswahl.</li>}
                </ol>
              </section>
              <section className="demo-panel" aria-labelledby="duel-panel">
                <header>
                  <h2 id="duel-panel">Erste Duelle</h2>
                  <p>{duels.length ? `${duelsWon} gewonnen, ${duels.length - duelsWon} verloren` : "Keine ersten Duelle in dieser Auswahl."}</p>
                </header>
                {duels.length > 0 && (
                  <ul className="scout-duel-list">
                    {data.players
                      .map((player) => ({ player, won: duels.filter((duel) => duel.playerId === player.id && duel.won), lost: duels.filter((duel) => duel.playerId === player.id && !duel.won) }))
                      .filter((entry) => entry.won.length + entry.lost.length)
                      .sort((a, b) => b.won.length + b.lost.length - (a.won.length + a.lost.length))
                      .map(({ player, won, lost }) => (
                        <li key={player.id}>
                          <span>{player.name}</span>
                          <span className="scout-duel-bar" aria-hidden="true">
                            <i style={{ flexGrow: won.length }} data-side={filters.side === 2 ? "t" : "ct"} />
                            <i style={{ flexGrow: lost.length }} />
                          </span>
                          <span>{won.length}:{lost.length}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
              {filters.side === 2 && (
                <section className="demo-panel" aria-labelledby="plant-panel">
                  <header>
                    <h2 id="plant-panel">Plants</h2>
                    <p>
                      {planted.length
                        ? `In ${planted.length} von ${chosen.length} Runden gelegt, meist nach ${elapsed([...planted].sort((a, b) => a.time - b.time)[Math.floor((planted.length - 1) / 2)].time)}. ${planted.filter((plant) => plant.won).length} davon gewonnen.`
                        : "Keine Plants in dieser Auswahl."}
                    </p>
                  </header>
                </section>
              )}
              <section className="demo-panel" aria-labelledby="buy-panel">
                <header>
                  <h2 id="buy-panel">Buys auf der {side}-Seite</h2>
                  <p>{sideRounds.length ? "Gewonnene Runden je Buy-Typ." : "Keine Runden auf dieser Seite."}</p>
                </header>
                {buys.length > 0 && (
                  <table className="scout-table scout-table-compact">
                    <thead><tr><th scope="col">Buy</th><th scope="col">Runden</th><th scope="col">Gewonnen</th></tr></thead>
                    <tbody>
                      {buys.map((entry) => (
                        <tr key={entry.value} aria-selected={entry.value === filters.buy}>
                          <th scope="row"><button type="button" onClick={() => set({ buy: entry.value === filters.buy ? "" : entry.value })}>{entry.label}</button></th>
                          <td>{entry.rounds}</td>
                          <td>{percent(entry.won, entry.rounds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </aside>
          </div>
        </section>

        <section className="demo-panel" aria-labelledby="source-demos">
          <header>
            <h2 id="source-demos">Demos</h2>
            <p>Grundlage dieser Analyse. Höchstens die 40 neuesten Demos des Teams.</p>
          </header>
          <ul className="scout-demo-list">
            {data.demos.map((demo) => (
              <li key={demo.id}>
                <Link to={`/analysis/demos/${demo.id}`}>
                  <span>{day(demo.date)}</span>
                  <strong>{demo.title}</strong>
                  <span>{mapName(demo.map)}</span>
                  <span data-result={demo.won > demo.lost ? "won" : demo.won < demo.lost ? "lost" : "draw"}>{demo.won}:{demo.lost}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
