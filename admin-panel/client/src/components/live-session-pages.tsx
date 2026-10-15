import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  BookOpen,
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  Square,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api";
import { lineupPath } from "@/lib/lineups";
import { liveCommand, serverNow } from "@/lib/live";
import { browserAudio, uploadAudioFile } from "@/lib/session-audio";
import { LiveAudioDevices } from "./live-audio-devices";
import { desktop } from "@/lib/playbook-desktop";
import type { Actor } from "../../../shared/authorization";
import {
  roundEnd,
  roundStart,
  type Demo,
  type SceneReference,
  type Playback,
} from "../../../shared/demos";
import type { TeamView, StratView, StratContent } from "../../../shared/strats";
import {
  audioTimeAtTick,
  presentationAt,
  sessionTime,
  type AudioTrack,
  type LiveSession,
  type RecordingRoom,
  type SessionEvent,
} from "../../../shared/recordings";
import type { MapDefinition } from "@/lib/maps";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./ui/card";
import { Field, FieldLabel, FieldGroup, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Textarea } from "./ui/textarea";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Choice, Feedback, useResource, WorkspaceHeader } from "./workspace-ui";
import { DemoPlayer, demoTime, SceneExample } from "./demo-player";

type Props = { user: Actor; maps: MapDefinition[] };
export function AnalysisNav() {
  return (
    <nav aria-label="Analysebereiche" className="mb-6 flex flex-wrap gap-2">
      {[
        ["/analysis", "Demos"],
        ["/analysis/live", "Live"],
        ["/analysis/prematch", "Prematch"],
        ["/analysis/opponents", "Gegner"],
        ["/analysis/imports", "Matchimporte"],
      ].map(([url, label]) => (
        <Button key={url} asChild variant="outline" size="sm">
          <Link to={url}>{label}</Link>
        </Button>
      ))}
    </nav>
  );
}
export function LiveSessionsPage({ user }: Props) {
  const teams = useResource<{ entries: TeamView[] }>("/api/teams"),
    sessions = useResource<{ entries: LiveSession[] }>("/api/analysis/live");
  const editable =
    teams.data?.entries.filter((t) => t.permissions["analysis.prepare"]) || [];
  const [teamId, setTeamId] = useState(""),
    [title, setTitle] = useState(""),
    [mode, setMode] = useState("review"),
    [recorder, setRecorder] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = editable.find((t) => t.id === teamId) || editable[0];
  const navigate = useNavigate();
  return (
    <>
      <WorkspaceHeader
        title="Live"
        description="Matches und Team-Besprechungen aufnehmen. Erklärungen später gemeinsam wiedergeben."
      />
      <AnalysisNav />
      <Feedback error={error || sessions.error || teams.error} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="flex flex-col gap-3" aria-label="Live-Sitzungen">
          {sessions.data?.entries.length ? (
            sessions.data.entries.map((session) => (
              <Card key={session.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle>
                      <Link to={`/analysis/live/${session.id}`}>
                        {session.title}
                      </Link>
                    </CardTitle>
                    <Badge
                      variant={
                        session.status === "recording" ? "default" : "secondary"
                      }
                    >
                      {session.status === "recording"
                        ? "Aufnahme läuft"
                        : session.status === "prepared"
                          ? "Vorbereitet"
                          : "Aufzeichnung"}
                    </Badge>
                  </div>
                  <CardDescription>
                    {session.mode === "match" ? "Match" : "Demo und Stratbook"}{" "}
                    · {new Date(session.createdAt).toLocaleDateString("de-AT")}{" "}
                    ·{" "}
                    {session.pinned
                      ? "Wird behalten"
                      : session.expiresAt
                        ? `Verfügbar bis ${new Date(session.expiresAt).toLocaleDateString("de-AT")}`
                        : "Bereit zum Start"}
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button asChild variant="outline">
                    <Link to={`/analysis/live/${session.id}`}>
                      {session.status === "finished"
                        ? "Aufzeichnung ansehen"
                        : "Raum öffnen"}
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Der nächste Teamabend beginnt hier</EmptyTitle>
                <EmptyDescription>
                  Bereite eine Sitzung vor und teile ihren Link mit deinem Team.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
        {selected && (
          <Card>
            <CardHeader>
              <CardTitle>Live-Sitzung vorbereiten</CardTitle>
              <CardDescription>
                Ein Rechner übernimmt die Tonaufnahme. Das ganze Team kann der
                Präsentation folgen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                id="create-live"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api("/api/analysis/live", {
                      method: "POST",
                      body: JSON.stringify({
                        teamId: selected.id,
                        title,
                        mode,
                        recorderId: recorder || user.identitySteam64,
                      }),
                    });
                    navigate(`/analysis/live/${result.session.id}`);
                  } catch (cause) {
                    setError(cause.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <FieldGroup>
                  <Choice
                    label="Team"
                    value={selected.id}
                    onChange={(value) => {
                      setTeamId(value);
                      setRecorder("");
                    }}
                    options={editable.map((t) => ({
                      value: t.id,
                      label: t.name,
                    }))}
                  />
                  <Field>
                    <FieldLabel>Name der Sitzung</FieldLabel>
                    <Input
                      id="live-title"
                      value={title}
                      maxLength={120}
                      required
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Mirage: Calls und A-Execute"
                    />
                  </Field>
                  <Choice
                    label="Ablauf"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "review", label: "Demo / Stratbook besprechen" },
                      { value: "match", label: "Match begleiten" },
                    ]}
                  />
                  <Choice
                    label="Tonaufnahme übernimmt"
                    value={recorder || user.identitySteam64}
                    onChange={setRecorder}
                    options={selected.members.map((m) => ({
                      value: m.userId,
                      label: m.name || m.userId,
                    }))}
                  />
                </FieldGroup>
              </form>
            </CardContent>
            <CardFooter>
              <Button type="submit" form="create-live" disabled={busy}>
                <Radio data-icon="inline-start" />
                Raum vorbereiten
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </>
  );
}

export function RecordedStrat({
  content,
  maps,
}: {
  content: StratContent;
  maps: MapDefinition[];
}) {
  const library = useResource<{ entries: any[] }>("/api/nades");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="control-title text-2xl">{content.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {content.map} · {content.side.toUpperCase()}
        </p>
        <p className="mt-4 whitespace-pre-wrap">{content.description}</p>
      </div>
      {content.scene && <SceneExample scene={content.scene} maps={maps} />}
      <div className="grid gap-3 lg:grid-cols-2">
        {content.slots.map((slot) => (
          <Card key={slot.id}>
            <CardHeader>
              <CardTitle>{slot.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex list-decimal flex-col gap-3 pl-5">
                {slot.steps.map((step) => (
                  <li key={step.id}>
                    <p>{step.text}</p>
                    <p className="text-sm text-muted-foreground">
                      {[step.position, step.timing].filter(Boolean).join(" · ")}
                    </p>
                    {step.nadeIds.length > 0 && (
                      <div className="my-2 flex flex-wrap gap-2">
                        {step.nadeIds.map((id) => {
                          const nade = library.data?.entries.find(
                            (n) => n.id === id,
                          );
                          const map = maps.find((m) => m.mapName === nade?.map);
                          return nade && map ? (
                            <Button
                              asChild
                              key={id}
                              variant="outline"
                              size="sm"
                            >
                              <Link
                                to={lineupPath(map, nade)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {nade.displayName || nade.name} ↗
                              </Link>
                            </Button>
                          ) : (
                            <span
                              key={id}
                              className="text-xs text-muted-foreground"
                            >
                              Nade derzeit nicht verfügbar
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {step.scene && (
                      <SceneExample scene={step.scene} maps={maps} />
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SyncedAudio({
  track,
  time,
  playing,
  speed = 1,
}: {
  track: AudioTrack;
  time: number | null;
  playing: boolean;
  speed?: number;
}) {
  const [parts, setParts] = useState<any[]>([]),
    [enabled, setEnabled] = useState(false),
    [volume, setVolume] = useState(1),
    [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (track.status !== "ready") return;
    const controller = new AbortController();
    api(`/api/analysis/audio/${track.id}/manifest`, {
      signal: controller.signal,
    })
      .then((data) => setParts(data.parts))
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [track.id, track.status]);
  const part =
    time === null || time < 0 || time >= track.duration
      ? null
      : [...parts].reverse().find((p) => p.start <= time);
  const expected = part ? Math.max(0, time! - part.start) : 0;
  const clock = useRef({ expected, playing, enabled, speed });
  clock.current = { expected, playing, enabled, speed };
  const follow = () => {
    const el = audio.current;
    if (!el || !part) return;
    el.playbackRate = speed;
    el.volume = volume;
    if (
      Number.isFinite(el.duration) &&
      Math.abs(el.currentTime - expected) > 0.25
    )
      el.currentTime = Math.min(expected, el.duration);
    if (playing && enabled)
      void el
        .play()
        .catch(() =>
          setError(
            "Aktiviere den Ton erneut, damit der Browser die Wiedergabe freigibt.",
          ),
        );
    else el.pause();
  };
  useEffect(follow, [expected, playing, enabled, speed, volume, part?.index]);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{track.name}</span>
        <Button
          size="sm"
          variant={enabled ? "secondary" : "outline"}
          disabled={track.status !== "ready"}
          onClick={() => {
            setEnabled(!enabled);
            setError("");
          }}
        >
          {enabled ? "Ton aus" : "Ton einschalten"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {track.status === "ready"
          ? `${demoTime(track.duration)} · ${time === null ? "Zeitabgleich fehlt" : "Synchronisiert"}`
          : track.status === "failed"
            ? "Verarbeitung fehlgeschlagen"
            : "Upload ausstehend"}
      </p>
      <Field>
        <FieldLabel>Lautstärke · {Math.round(volume * 100)} %</FieldLabel>
        <Input
          type="range"
          aria-label={`Lautstärke für ${track.name}`}
          min={0}
          max={1}
          step={0.01}
          value={volume}
          disabled={track.status !== "ready"}
          onChange={(event) => setVolume(Number(event.target.value))}
        />
      </Field>
      {part && (
        <audio
          ref={audio}
          src={part.url}
          preload="metadata"
          onLoadedMetadata={follow}
          onError={() =>
            setError(
              "Die Tonspur konnte nicht geladen werden. Prüfe deinen Teamzugriff und lade die Ansicht neu.",
            )
          }
        />
      )}
      <Feedback error={error || track.error} />
    </div>
  );
}

function AudioAlignment({
  track,
  demo,
  onDone,
}: {
  track: AudioTrack;
  demo: Demo | null;
  onDone: () => void;
}) {
  const rounds = demo?.summary?.rounds || [];
  const [offset, setOffset] = useState(String(track.start)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [anchors, setAnchors] = useState(() =>
    track.anchors.length
      ? track.anchors.map((anchor) => {
          const round =
            [...rounds].reverse().find((r) => r.startTick <= anchor.demoTick) ||
            rounds[0];
          return {
            audio: anchor.audio,
            round: round?.id || "",
            time: round
              ? (anchor.demoTick - round.startTick) / demo.summary.tickRate
              : 0,
          };
        })
      : [
          { audio: 0, round: rounds[0]?.id || "", time: 0 },
          {
            audio: Math.max(1, track.duration - 5),
            round: rounds.at(-1)?.id || "",
            time: 0,
          },
        ],
  );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          const points = demo
            ? anchors.map((a) => ({
                audio: Number(a.audio),
                demoTick: Math.round(
                  (rounds.find((r) => r.id === a.round)?.startTick || 0) +
                    Number(a.time) * demo.summary.tickRate,
                ),
              }))
            : [];
          await api(`/api/analysis/audio/${track.id}`, {
            method: "PATCH",
            body: JSON.stringify({ start: Number(offset), anchors: points }),
          });
          onDone();
        } catch (cause) {
          setError(cause.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel>Beginn in der Sitzung, Sekunden</FieldLabel>
          <Input
            id={`offset-${track.id}`}
            type="number"
            step="0.1"
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
          />
        </Field>
        {demo &&
          anchors.map((anchor, index) => (
            <Field key={index}>
              <FieldLabel>Zeitanker {index + 1}</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  aria-label={`Audiozeit ${index + 1} in Sekunden`}
                  type="number"
                  min={0}
                  max={track.duration}
                  step="0.1"
                  value={anchor.audio}
                  onChange={(e) =>
                    setAnchors(
                      anchors.map((a, i) =>
                        i === index
                          ? { ...a, audio: Number(e.target.value) }
                          : a,
                      ),
                    )
                  }
                />
                <Choice
                  label={`Runde ${index + 1}`}
                  value={anchor.round}
                  onChange={(round) =>
                    setAnchors(
                      anchors.map((a, i) =>
                        i === index ? { ...a, round } : a,
                      ),
                    )
                  }
                  options={rounds.map((r) => ({
                    value: r.id,
                    label: `Runde ${r.number}`,
                  }))}
                />
                <Input
                  aria-label={`Zeit in Runde ${index + 1}`}
                  type="number"
                  min={0}
                  step="0.1"
                  value={anchor.time}
                  onChange={(e) =>
                    setAnchors(
                      anchors.map((a, i) =>
                        i === index
                          ? { ...a, time: Number(e.target.value) }
                          : a,
                      ),
                    )
                  }
                />
              </div>
              <FieldDescription>
                Audiozeit und die passende Stelle in der Demo. Setze eine frühe
                und eine spätere Stelle.
              </FieldDescription>
            </Field>
          ))}
      </FieldGroup>
      <Feedback error={error} />
      <Button disabled={busy} variant="outline" size="sm">
        Zeitabgleich speichern
      </Button>
    </form>
  );
}

export function LiveSessionPage({ user, maps }: Props) {
  const { sessionId } = useParams(),
    [search] = useSearchParams(),
    room = useResource<RecordingRoom>(`/api/analysis/live/${sessionId}/room`);
  const teams = useResource<{ entries: TeamView[] }>("/api/teams"),
    demos = useResource<{ entries: Demo[] }>("/api/analysis/demos"),
    strats = useResource<{ entries: StratView[] }>("/api/strats");
  const [timeline, setTimeline] = useState<SessionEvent[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [following, setFollowing] = useState(true);
  const [now, setNow] = useState(serverNow()),
    [archiveTime, setArchiveTime] = useState(Number(search.get("start")) || 0),
    [archivePlaying, setArchivePlaying] = useState(false);
  const [demoId, setDemoId] = useState(""),
    [roundId, setRoundId] = useState(search.get("round") || ""),
    [stratId, setStratId] = useState(""),
    [note, setNote] = useState(""),
    [audioFiles, setAudioFiles] = useState<{ game?: File; discord?: File }>({}),
    [align, setAlign] = useState("");
  const [matchPlayback, setMatchPlayback] = useState<Playback | null>(null),
    [matchTime, setMatchTime] = useState(0),
    [explanation, setExplanation] = useState({
      title: "",
      start: 0,
      end: 0,
      stratId: "",
      slotId: "",
    });
  const [audioState, setAudioState] = useState(0),
    [nativeStatus, setNativeStatus] = useState<any>(null);
  const session = room.data?.session,
    ended = session?.status === "finished",
    team = teams.data?.entries.find((t) => t.id === session?.teamId);
  const availableDemos =
      demos.data?.entries.filter(
        (d) => d.teamId === session?.teamId && d.status === "ready",
      ) || [],
    availableStrats =
      strats.data?.entries.filter(
        (s) => s.teamId === session?.teamId && s.published,
      ) || [];
  const selectedDemo = availableDemos.find(
    (d) =>
      d.id === (ended && session.mode === "match" ? session.demoId : demoId),
  );
  const round =
    selectedDemo?.summary?.rounds.find((r) => r.id === roundId) ||
    selectedDemo?.summary?.rounds[0];
  const manualScene: SceneReference | null =
    selectedDemo && round
      ? {
          demoId: selectedDemo.id,
          roundId: round.id,
          version: selectedDemo.summary.version,
          start:
            ended && search.get("round") === round.id && search.has("start")
              ? Math.max(roundStart(round), Number(search.get("start")) || 0)
              : roundStart(round),
          end:
            ended && search.get("round") === round.id
              ? Math.min(
                  roundEnd(round),
                  Number(search.get("end")) || roundEnd(round),
                )
              : roundEnd(round),
          focusId: "",
        }
      : null;
  const commandBusy = useRef(false),
    archiveClock = useRef(0);
  useEffect(
    () => browserAudio.subscribe(() => setAudioState((value) => value + 1)),
    [],
  );
  useEffect(() => {
    void browserAudio.retry(user.identitySteam64);
  }, [user.identitySteam64]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(serverNow());
      if (desktop?.liveStatus)
        void desktop
          .liveStatus()
          .then(setNativeStatus)
          .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      session?.status === "finished" &&
      browserAudio.sessionId === session.id &&
      browserAudio.recorder
    )
      void browserAudio.stop().catch((cause) => setError(cause.message));
  }, [session?.status, session?.id]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    api(`/api/analysis/live/${session.id}/timeline`, {
      signal: controller.signal,
    })
      .then((data) => setTimeline(data.session.events))
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [session?.id, session?.eventCount]);
  useEffect(() => {
    if (!archivePlaying || !session) return;
    archiveClock.current = performance.now();
    const timer = setInterval(() => {
      const next = performance.now(),
        delta = (next - archiveClock.current) / 1000;
      archiveClock.current = next;
      setArchiveTime((value) => {
        const end = Math.min(
          session.duration,
          Number(search.get("end")) || session.duration,
        );
        if (value + delta >= end) {
          setArchivePlaying(false);
          return end;
        }
        return value + delta;
      });
    }, 50);
    return () => clearInterval(timer);
  }, [archivePlaying, session?.duration]);
  useEffect(() => {
    setMatchPlayback(null);
    setMatchTime(0);
  }, [manualScene?.demoId, manualScene?.roundId]);
  async function command(action: string, body: any = {}) {
    if (!session || commandBusy.current) return false;
    commandBusy.current = true;
    setError("");
    try {
      await liveCommand(`/api/analysis/live/${session.id}/room`, {
        action,
        revision: session.revision,
        commandId: crypto.randomUUID(),
        ...body,
      });
      return true;
    } catch (cause) {
      setError(cause.message);
      return false;
    } finally {
      commandBusy.current = false;
    }
  }
  async function work(operation: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      room.reload();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  if (!session)
    return (
      <>
        <WorkspaceHeader
          title="Live-Sitzung"
          description="Gemeinsame Präsentation und Aufzeichnung"
        />
        <Feedback error={room.error} />
      </>
    );
  const canModerate =
    room.data.canControl && session.moderatorId === user.identitySteam64;
  const displayed =
    ended && session.mode === "review"
      ? presentationAt(timeline, archiveTime)
      : session.presentation;
  const snapshot =
    displayed.kind === "strat"
      ? session.snapshots.find((s) => s.id === displayed.snapshotId)
      : null;
  const clock = ended ? archiveTime : sessionTime(session, now);
  const notes = timeline.filter((e) => e.type === "note"),
    point = [...timeline]
      .reverse()
      .find(
        (e) => e.type === "point" && e.at <= clock && clock - e.at < 5,
      )?.point;
  return (
    <>
      <WorkspaceHeader
        title={session.title}
        description={`${team?.name || "Team"} · ${session.mode === "match" ? "Match" : "Demo und Stratbook"} · Moderation: ${team?.members.find((m) => m.userId === session.moderatorId)?.name || session.moderatorId}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={session.status === "recording" ? "default" : "secondary"}
          >
            {session.status === "recording"
              ? "Aufnahme läuft"
              : ended
                ? "Aufzeichnung beendet"
                : "Vorbereitet"}
          </Badge>
          <span className="font-mono text-sm">
            {demoTime(ended ? session.duration : clock)}
          </span>
          {!ended && room.data.canControl && !canModerate && (
            <Button variant="outline" onClick={() => void command("takeover")}>
              Moderation übernehmen
            </Button>
          )}
          {!ended && canModerate && session.status === "recording" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  if (browserAudio.sessionId === session.id)
                    await browserAudio.stop(false);
                  if (
                    nativeStatus?.sessionId === session.id &&
                    nativeStatus.recording
                  )
                    await desktop.liveStop();
                  await command("stop");
                  if (browserAudio.sessionId === session.id)
                    void browserAudio
                      .stop()
                      .catch((cause) => setError(cause.message));
                })
              }
            >
              <Square data-icon="inline-start" />
              Sitzung beenden
            </Button>
          )}
          {ended && room.data.canControl && (
            <Button
              variant="outline"
              onClick={() =>
                void work(() =>
                  api(`/api/analysis/live/${session.id}/pin`, {
                    method: "POST",
                    body: JSON.stringify({ pinned: !session.pinned }),
                  }),
                )
              }
            >
              {session.pinned ? "Aufbewahrung lösen" : "Aufnahme behalten"}
            </Button>
          )}
        </div>
      </WorkspaceHeader>
      <AnalysisNav />
      <Feedback error={error || room.error} />
      {session.status === "prepared" && canModerate && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Bereit für das Team</CardTitle>
            <CardDescription>
              Teile diesen Raumlink. Nach dem Start wählt der eingeteilte
              Aufnehmende seine Audioquellen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field className="flex items-center gap-3">
              <Checkbox
                id="live-consent"
                checked={consent}
                onCheckedChange={(value) => setConsent(value === true)}
              />
              <FieldLabel>
                Die Beteiligten wissen von der Aufnahme und stimmen zu.
              </FieldLabel>
            </Field>
          </CardContent>
          <CardFooter>
            <Button
              disabled={!consent}
              onClick={() => void command("start", { consent })}
            >
              <Radio data-icon="inline-start" />
              Sitzung starten
            </Button>
          </CardFooter>
        </Card>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          className="min-w-0 flex flex-col gap-4"
          aria-label="Gemeinsame Präsentation"
        >
          {ended && session.mode === "match" && manualScene ? (
            <>
              <Choice
                label="Matchrunde"
                value={round.id}
                onChange={setRoundId}
                options={selectedDemo.summary.rounds.map((r) => ({
                  value: r.id,
                  label: `Runde ${r.number}`,
                }))}
              />
              <DemoPlayer
                scene={manualScene}
                maps={maps}
                playback={matchPlayback || undefined}
                onPlayback={(value) =>
                  setMatchPlayback({
                    sceneIndex: 0,
                    anchoredAt: serverNow(),
                    ...value,
                  })
                }
                onPosition={setMatchTime}
              />
            </>
          ) : displayed.kind === "demo" ? (
            <DemoPlayer
              key={`${session.id}:${displayed.scene.demoId}:${displayed.scene.roundId}:${following}`}
              scene={displayed.scene}
              maps={maps}
              playback={following || ended ? displayed.playback : undefined}
              onPlayback={
                ended
                  ? undefined
                  : canModerate && following
                    ? (value) => void command("playback", { playback: value })
                    : undefined
              }
              disabled={ended || (following && !canModerate)}
              pointer={point ? { ...point, at: serverNow() } : null}
              onPoint={
                !ended && canModerate && session.status === "recording"
                  ? (value) => void command("point", { point: value })
                  : undefined
              }
            />
          ) : snapshot ? (
            <RecordedStrat content={snapshot.content} maps={maps} />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {session.mode === "match" && ended
                    ? "Demo nachträglich verbinden"
                    : "Das Team folgt deiner Präsentation"}
                </EmptyTitle>
                <EmptyDescription>
                  {session.mode === "match" && ended
                    ? "Wähle die passende analysierte Teamdemo. Setze anschließend zwei Zeitanker für jede Tonspur."
                    : "Öffne eine Demo oder eine veröffentlichte Strat. Die Wechsel gehören zur Aufzeichnung."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {ended && session.mode === "review" && (
            <div className="flex flex-col gap-3 rounded-md border p-4">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setArchivePlaying(!archivePlaying)}
                >
                  {archivePlaying ? (
                    <Pause data-icon="inline-start" />
                  ) : (
                    <Play data-icon="inline-start" />
                  )}
                  {archivePlaying ? "Pause" : "Aufzeichnung abspielen"}
                </Button>
                <span className="font-mono text-sm">
                  {demoTime(archiveTime)} / {demoTime(session.duration)}
                </span>
              </div>
              <input
                aria-label="Zeit in der Aufzeichnung"
                className="w-full accent-primary"
                type="range"
                min={0}
                max={session.duration}
                step={0.1}
                value={archiveTime}
                onChange={(e) => setArchiveTime(Number(e.target.value))}
              />
              <div className="flex flex-wrap gap-2">
                {timeline
                  .filter((e) => e.type === "present")
                  .map((e) => (
                    <Button
                      key={e.id}
                      variant="ghost"
                      size="sm"
                      onClick={() => setArchiveTime(e.at)}
                    >
                      {demoTime(e.at)} ·{" "}
                      {e.presentation?.kind === "strat"
                        ? "Stratbook"
                        : e.presentation?.kind === "demo"
                          ? "Demo"
                          : "Notizen"}
                    </Button>
                  ))}
              </div>
            </div>
          )}
          {!ended && (
            <Button
              className="self-start"
              variant="outline"
              onClick={() => setFollowing(!following)}
            >
              {following ? "Selbst ansehen" : "Captain folgen"}
            </Button>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Erkenntnisse und Zeitmarken</CardTitle>
              <CardDescription>
                Notizen bleiben mit der Stelle in dieser Sitzung verbunden.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {notes.map((event) => (
                <div key={event.id} className="flex gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!ended || session.mode !== "review"}
                    onClick={() => setArchiveTime(event.at)}
                  >
                    {demoTime(event.at)}
                  </Button>
                  <p className="whitespace-pre-wrap text-sm">{event.text}</p>
                </div>
              ))}
              {!ended && (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void command("note", { text: note }).then((ok) => {
                      if (ok) setNote("");
                    });
                  }}
                >
                  <Textarea
                    aria-label="Erkenntnis oder Aufgabe"
                    value={note}
                    maxLength={3000}
                    required
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Was ändern wir im nächsten Match?"
                  />
                  <Button variant="outline" className="self-start">
                    Zeitmarke speichern
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </section>
        <aside className="flex min-w-0 flex-col gap-4">
          {!ended && canModerate && (
            <Card>
              <CardHeader>
                <CardTitle>Präsentieren</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Choice
                  label="Demo"
                  value={demoId}
                  onChange={(value) => {
                    setDemoId(value);
                    setRoundId("");
                  }}
                  options={[
                    { value: "", label: "Demo auswählen" },
                    ...availableDemos.map((d) => ({
                      value: d.id,
                      label: d.title,
                    })),
                  ]}
                />
                {selectedDemo && (
                  <Choice
                    label="Runde"
                    value={round?.id || ""}
                    onChange={setRoundId}
                    options={selectedDemo.summary.rounds.map((r) => ({
                      value: r.id,
                      label: `Runde ${r.number}`,
                    }))}
                  />
                )}
                <Button
                  variant="outline"
                  disabled={!manualScene}
                  onClick={() =>
                    void command("present", {
                      kind: "demo",
                      scene: manualScene,
                    })
                  }
                >
                  Demo zeigen
                </Button>
                <Choice
                  label="Stratbook"
                  value={stratId}
                  onChange={setStratId}
                  options={[
                    { value: "", label: "Strat auswählen" },
                    ...availableStrats.map((s) => ({
                      value: s.id,
                      label: s.published.content.title,
                    })),
                  ]}
                />
                <Button
                  variant="outline"
                  disabled={!stratId}
                  onClick={() =>
                    void command("present", { kind: "strat", stratId })
                  }
                >
                  <BookOpen data-icon="inline-start" />
                  Strat zeigen
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void command("present", { kind: "notes" })}
                >
                  Notizen zeigen
                </Button>
              </CardContent>
            </Card>
          )}
          {session.mode === "match" && room.data.canControl && (
            <Card>
              <CardHeader>
                <CardTitle>Matchdemo verbinden</CardTitle>
                <CardDescription>
                  Ton und Demo bleiben getrennt ausrichtbar.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Choice
                  label="Analysiertes Match"
                  value={session.demoId || ""}
                  onChange={(id) =>
                    void work(() =>
                      api(`/api/analysis/live/${session.id}/demo`, {
                        method: "POST",
                        body: JSON.stringify({ demoId: id }),
                      }),
                    )
                  }
                  options={[
                    { value: "", label: "Demo auswählen" },
                    ...availableDemos.map((d) => ({
                      value: d.id,
                      label: d.title,
                    })),
                  ]}
                />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Tonaufnahme</CardTitle>
              <CardDescription>
                {team?.members.find((m) => m.userId === session.recorderId)
                  ?.name || session.recorderId}{" "}
                übernimmt die Aufnahme.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {room.data.canRecord && session.status === "recording" && (
                <>
                  {desktop?.liveStart ? (
                    <LiveAudioDevices
                      sessionId={session.id}
                      busy={busy}
                      status={nativeStatus}
                      work={work}
                    />
                  ) : (
                    <>
                      <Alert>
                        <AlertTitle>
                          Spiel und Kommunikation in der Desktop-App aufnehmen
                        </AlertTitle>
                        <AlertDescription>
                          Hier im Browser kannst du dein Mikrofon aufnehmen oder
                          eine vorhandene Tondatei hinzufügen.
                        </AlertDescription>
                      </Alert>
                      {browserAudio.recorder ? (
                        <>
                          <Badge>Mikrofonaufnahme läuft</Badge>
                          <Button
                            variant="outline"
                            onClick={() => browserAudio.mute()}
                          >
                            {browserAudio.muted ? (
                              <MicOff data-icon="inline-start" />
                            ) : (
                              <Mic data-icon="inline-start" />
                            )}
                            {browserAudio.muted
                              ? "Mikrofon wieder aufnehmen"
                              : "Aufnahmemikrofon stummschalten"}
                          </Button>
                          <Button
                            disabled={busy}
                            variant="outline"
                            onClick={() => void work(() => browserAudio.stop())}
                          >
                            Mikrofonaufnahme beenden
                          </Button>
                        </>
                      ) : (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void work(() =>
                              browserAudio.start(
                                session.id,
                                user.identitySteam64,
                                session,
                              ),
                            )
                          }
                        >
                          <Mic data-icon="inline-start" />
                          Mikrofon aufnehmen
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
              {browserAudio.pending > 0 && (
                <p className="text-sm">
                  {browserAudio.pending} Segmente lokal gesichert, Upload
                  ausstehend.
                </p>
              )}
              <Feedback error={browserAudio.error || nativeStatus?.error} />
              {room.data.canRecord && session.status !== "prepared" && (
                <FieldGroup>
                  {(["game", "discord"] as const).map((source) => (
                    <FieldGroup key={source}>
                      <Field>
                        <FieldLabel>
                          {source === "game"
                            ? "CS2-Audiodatei · Stereo"
                            : "Kommunikationsdatei · Discord und eigene Calls"}
                        </FieldLabel>
                        <Input
                          type="file"
                          accept=".wav,.mp3,.m4a,.mp4,.webm,.ogg,.opus"
                          disabled={busy}
                          onChange={(event) =>
                            setAudioFiles((old) => ({
                              ...old,
                              [source]: event.target.files?.[0] || undefined,
                            }))
                          }
                        />
                        <FieldDescription>
                          Bis 512 MiB je Spur. Beide Dateien starten zunächst
                          bei Sitzungssekunde 0. Den tatsächlichen Versatz zur
                          Demo stellst du anschließend über Zeitanker ein.
                        </FieldDescription>
                      </Field>
                      <Button
                        variant="outline"
                        disabled={!audioFiles[source] || busy}
                        onClick={() =>
                          void work(async () => {
                            await uploadAudioFile(
                              session.id,
                              audioFiles[source],
                              0,
                              source,
                            );
                            setAudioFiles((old) => ({
                              ...old,
                              [source]: undefined,
                            }));
                          })
                        }
                      >
                        <Upload data-icon="inline-start" />
                        {source === "game"
                          ? "Spielton hochladen"
                          : "Kommunikation hochladen"}
                      </Button>
                    </FieldGroup>
                  ))}
                </FieldGroup>
              )}
              {room.data.tracks.map((track) => (
                <div key={track.id} className="flex flex-col gap-2">
                  <SyncedAudio
                    track={track}
                    time={
                      ended && session.mode === "match" && selectedDemo && round
                        ? audioTimeAtTick(
                            track.anchors,
                            round.startTick +
                              matchTime * selectedDemo.summary.tickRate,
                          )
                        : ended
                          ? archiveTime - track.start
                          : null
                    }
                    playing={
                      ended && session.mode === "match"
                        ? !!matchPlayback?.playing
                        : archivePlaying
                    }
                    speed={matchPlayback?.speed || 1}
                  />
                  {room.data.canRecord && track.status !== "ready" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void work(async () => {
                          await browserAudio.retry(user.identitySteam64);
                          await api(`/api/analysis/audio/${track.id}/finish`, {
                            method: "POST",
                          });
                        })
                      }
                    >
                      Upload fortsetzen und fertigstellen
                    </Button>
                  )}
                  {room.data.canControl && track.status === "ready" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setAlign(align === track.id ? "" : track.id)
                      }
                    >
                      Zeitabgleich bearbeiten
                    </Button>
                  )}
                  {align === track.id && (
                    <AudioAlignment
                      track={track}
                      demo={
                        session.mode === "match"
                          ? availableDemos.find(
                              (d) => d.id === session.demoId,
                            ) || null
                          : null
                      }
                      onDone={() => {
                        setAlign("");
                        room.reload();
                      }}
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
          {ended && room.data.canControl && (
            <Card>
              <CardHeader>
                <CardTitle>Ins Stratbook übernehmen</CardTitle>
                <CardDescription>
                  Die Erklärung bleibt mit dieser Aufzeichnung verbunden und
                  wird behalten.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  id="save-explanation"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void work(() =>
                      api(`/api/analysis/live/${session.id}/explanations`, {
                        method: "POST",
                        body: JSON.stringify({
                          ...explanation,
                          ...(session.mode === "match" && {
                            scene: manualScene,
                          }),
                        }),
                      }),
                    );
                  }}
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Titel</FieldLabel>
                      <Input
                        id="explanation-title"
                        required
                        value={explanation.title}
                        onChange={(e) =>
                          setExplanation({
                            ...explanation,
                            title: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Choice
                      label="Strat"
                      value={explanation.stratId}
                      onChange={(stratId) =>
                        setExplanation({ ...explanation, stratId, slotId: "" })
                      }
                      options={[
                        { value: "", label: "Strat auswählen" },
                        ...availableStrats.map((s) => ({
                          value: s.id,
                          label: s.published.content.title,
                        })),
                      ]}
                    />
                    <Choice
                      label="Für wen?"
                      value={explanation.slotId}
                      onChange={(slotId) =>
                        setExplanation({ ...explanation, slotId })
                      }
                      options={[
                        { value: "", label: "Ganzes Team" },
                        ...(
                          availableStrats.find(
                            (s) => s.id === explanation.stratId,
                          )?.content.slots || []
                        ).map((s) => ({ value: s.id, label: s.label })),
                      ]}
                    />
                    {(["start", "end"] as const).map((key) => (
                      <Field key={key}>
                        <FieldLabel>
                          {key === "start" ? "Beginn" : "Ende"} in Sekunden
                        </FieldLabel>
                        <Input
                          id={`explanation-${key}`}
                          type="number"
                          min={0}
                          max={
                            session.mode === "match"
                              ? round?.duration || 0
                              : session.duration
                          }
                          step={0.1}
                          required
                          value={explanation[key]}
                          onChange={(e) =>
                            setExplanation({
                              ...explanation,
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                    ))}
                  </FieldGroup>
                </form>
              </CardContent>
              <CardFooter>
                <Button
                  form="save-explanation"
                  type="submit"
                  disabled={busy || !explanation.stratId}
                >
                  Erklärung speichern
                </Button>
              </CardFooter>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

export function StratExplanations({ stratId }: { stratId: string }) {
  const resource = useResource<{ entries: any[]; canEdit: boolean }>(
    `/api/analysis/explanations/${stratId}`,
  );
  const [error, setError] = useState("");
  if (!resource.data?.entries.length) return null;
  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Erklärungen aus dem Team</CardTitle>
        <CardDescription>
          Aufgezeichnete Demo- und Stratbook-Besprechungen.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Feedback error={error} />
        {resource.data.entries.map((e) => (
          <div key={e.id} className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link
                to={`/analysis/live/${e.sessionId}?start=${e.start}&end=${e.end}${e.scene ? `&round=${encodeURIComponent(e.scene.roundId)}` : ""}`}
              >
                {e.title} · {demoTime(e.end - e.start)}
              </Link>
            </Button>
            {resource.data.canEdit && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Verknüpfung zu ${e.title} entfernen`}
                onClick={async () => {
                  setError("");
                  try {
                    await api(`/api/analysis/explanations/${e.id}`, {
                      method: "DELETE",
                    });
                    resource.reload();
                  } catch (cause) {
                    setError(cause.message);
                  }
                }}
              >
                Verknüpfung entfernen
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
