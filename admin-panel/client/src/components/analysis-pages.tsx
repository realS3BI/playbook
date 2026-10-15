import { Fragment, useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  Ellipsis,
  Film,
  ListFilter,
  MapPinned,
  Plus,
  Radio,
  Share2,
  Trash2,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { liveCommand, serverNow } from "@/lib/live";
import { useLiveState } from "@/hooks/use-live-resource";
import type { MapDefinition } from "@/lib/maps";
import { MAP_CARD_ART } from "@/lib/map-card-art";
import type { Actor } from "../../../shared/authorization";
import type { TeamView } from "../../../shared/strats";
import {
  DEMO_UPLOAD_LIMIT,
  roundEnd,
  roundStart,
  type Demo,
  type DemoReview,
  type DemoScene,
  type Playback,
  type ReviewRoom,
  type SceneReference,
} from "../../../shared/demos";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "./ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Field, FieldGroup, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Progress } from "./ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { DemoPlayer, buyLabel, demoTime } from "./demo-player";
import { economyOptions } from "../../../shared/strats";
import {
  Choice,
  ConfirmAction,
  Feedback,
  useResource,
  WorkspaceHeader,
} from "./workspace-ui";

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
    </label>
  );
}

type Props = { user: Actor; maps: MapDefinition[] };
const sourceLabels = {
  faceit: "FACEIT",
  premier: "Premier / Matchmaking",
  other: "Andere Quelle",
};
const statusLabels = {
  uploading: "Upload ausstehend",
  receiving: "Wird hochgeladen",
  queued: "Wartet auf Analyse",
  processing: "Wird analysiert",
  ready: "Bereit",
  failed: "Verarbeitung fehlgeschlagen",
};
const statusTone = (status: Demo["status"]) =>
  status === "ready" ? "ready" : status === "failed" ? "failed" : "busy";
const sideKey = (winner: number) =>
  winner === 2 ? "t" : winner === 3 ? "ct" : undefined;

/** Side changes in MR12: after round 12 and 24, then every three overtime rounds. */
function roundBreak(number: number, total: number) {
  if (number >= total) return null;
  if (number === 12) return "Seitenwechsel";
  if (number === 24) return "Verlängerung";
  if (number > 24 && (number - 24) % 3 === 0) return "Seitenwechsel";
  return null;
}

function MapPoster({ map }: { map?: MapDefinition }) {
  const art = map ? MAP_CARD_ART[map.mapName] : undefined;
  return (
    <div className="demo-match-poster" aria-hidden="true">
      {art?.imageUrl && <img src={art.imageUrl} alt="" loading="lazy" />}
      <div className="demo-match-emblem">
        {art?.logoUrl ? (
          <img src={art.logoUrl} alt="" loading="lazy" />
        ) : (
          <MapPinned />
        )}
      </div>
    </div>
  );
}

function UploadDemo({
  teams,
  onClose,
  onDone,
}: {
  teams: TeamView[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("faceit");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const transfer = useRef<XMLHttpRequest | null>(null);
  useEffect(() => () => transfer.current?.abort(), []);
  async function upload() {
    if (!file) return;
    if (file.size > DEMO_UPLOAD_LIMIT) {
      setError("Die Demo darf höchstens 1 GiB groß sein.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api("/api/analysis/demos", {
        method: "POST",
        body: JSON.stringify({
          title,
          source,
          teamId: teamId || null,
          filename: file.name,
        }),
      });
      const result = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        transfer.current = xhr;
        xhr.open("PUT", `/api/analysis/demos/${created.demo.id}/file`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.timeout = 15 * 60_000;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable)
            setProgress((100 * event.loaded) / event.total);
        };
        xhr.onerror = xhr.ontimeout = () =>
          reject(
            new Error(
              "Der Upload wurde unterbrochen. Bitte versuche es erneut.",
            ),
          );
        xhr.onabort = () => reject(new Error("Upload abgebrochen."));
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 400)
              reject(new Error(data.error || "Upload fehlgeschlagen."));
            else resolve(data);
          } catch {
            reject(new Error("Der Upload konnte nicht bestätigt werden."));
          }
        };
        xhr.send(file);
      });
      transfer.current = null;
      onDone(result.demo.id);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Demo hinzufügen</DialogTitle>
          <DialogDescription>
            Lade ein eigenes FACEIT- oder Premier-Match hoch und bereite den
            nächsten Team-Review vor.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void upload();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="demo-file">Demodatei</FieldLabel>
              <Input
                id="demo-file"
                type="file"
                accept=".dem,.gz,.bz2"
                disabled={busy}
                required
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  setFile(next || null);
                  if (next && !title)
                    setTitle(
                      next.name
                        .replace(/\.dem(?:\.gz|\.bz2)?$/i, "")
                        .slice(0, 120),
                    );
                }}
              />
              <FieldDescription>
                .dem, .dem.gz oder .dem.bz2 · bis 1 GiB
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="demo-title">Matchname</FieldLabel>
              <Input
                id="demo-title"
                value={title}
                maxLength={120}
                required
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Mirage · unser Match vom Sonntag"
              />
            </Field>
            <Choice
              label="Herkunft"
              value={source}
              onChange={setSource}
              disabled={busy}
              options={Object.entries(sourceLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Choice
              label="Sichtbarkeit"
              value={teamId}
              onChange={setTeamId}
              disabled={busy}
              options={[
                { value: "", label: "Nur für mich" },
                ...teams
                  .filter((team) => team.permissions["analysis.upload"])
                  .map((team) => ({ value: team.id, label: team.name })),
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {teamId
                ? "Alle Mitglieder dieses Teams können die Demo ansehen und im Review verwenden."
                : "Die Demo bleibt privat. Du kannst sie später ausdrücklich für ein Team freigeben."}
            </p>
            {busy && (
              <div role="status">
                <Progress value={progress} aria-label="Demo-Upload" />
                <p className="mt-2 text-xs">
                  {Math.round(progress)} % hochgeladen
                </p>
              </div>
            )}
            <Feedback error={error} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => (busy ? transfer.current?.abort() : onClose())}
              >
                {busy ? "Upload abbrechen" : "Abbrechen"}
              </Button>
              <Button type="submit" disabled={busy || !file}>
                <Upload data-icon="inline-start" />
                {busy ? "Lädt hoch …" : "Demo hochladen"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewReview({
  teams,
  onClose,
}: {
  teams: TeamView[];
  onClose: () => void;
}) {
  const editable = teams.filter((team) => team.permissions["analysis.prepare"]);
  const [teamId, setTeamId] = useState(editable[0]?.id || "");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review vorbereiten</DialogTitle>
          <DialogDescription>
            Sammle Szenen und Fragen für euren nächsten gemeinsamen Review.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const result = await api("/api/analysis/reviews", {
                method: "POST",
                body: JSON.stringify({ teamId, title }),
              });
              navigate(`/analysis/reviews/${result.review.id}`);
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
              value={teamId}
              onChange={setTeamId}
              disabled={busy}
              options={editable.map((team) => ({
                value: team.id,
                label: team.name,
              }))}
            />
            <Field>
              <FieldLabel htmlFor="review-title">Thema</FieldLabel>
              <Input
                id="review-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                required
                placeholder="Mirage · Trades und A-Execute"
                disabled={busy}
              />
            </Field>
            <Feedback error={error} />
            <DialogFooter>
              <Button disabled={busy || !teamId} type="submit">
                Review anlegen
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AnalysisPage({ user, maps }: Props) {
  const demos = useResource<{ entries: Demo[] }>("/api/analysis/demos");
  const reviews = useResource<{ entries: DemoReview[] }>(
    "/api/analysis/reviews",
  );
  const teams = useResource<{ entries: TeamView[] }>("/api/teams");
  const [params, setParams] = useSearchParams();
  const [upload, setUpload] = useState(false);
  const [newReview, setNewReview] = useState(false);
  const navigate = useNavigate();
  const entries = teams.data?.entries || [];
  const tab = params.get("view") === "reviews" ? "reviews" : "matches";
  const teamId = params.get("team") || "";
  const filtered =
    demos.data?.entries.filter((demo) => !teamId || demo.teamId === teamId) ||
    [];
  return (
    <>
      <WorkspaceHeader
        title="Analyse"
        description="Eigene Matches verstehen und den nächsten Review gemeinsam vorbereiten."
      >
        <div className="flex flex-wrap gap-2">
          {entries.some((team) => team.permissions["analysis.prepare"]) && (
            <Button variant="outline" onClick={() => setNewReview(true)}>
              <UsersRound data-icon="inline-start" />
              Review vorbereiten
            </Button>
          )}
          {user.authKind !== "test" && (
            <Button onClick={() => setUpload(true)}>
              <Upload data-icon="inline-start" />
              Demo hinzufügen
            </Button>
          )}
        </div>
      </WorkspaceHeader>
      <Feedback error={demos.error || teams.error || reviews.error} />
      <div className="mb-5 max-w-xs">
        <Choice
          label="Teamfilter"
          value={teamId}
          onChange={(team) => {
            const next = new URLSearchParams(params);
            if (team) next.set("team", team);
            else next.delete("team");
            setParams(next);
          }}
          options={[
            { value: "", label: "Meine Demos und Teams" },
            ...entries.map((team) => ({ value: team.id, label: team.name })),
          ]}
        />
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("view", value);
          setParams(next);
        }}
      >
        <TabsList className="mb-5">
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="reviews">Team-Reviews</TabsTrigger>
        </TabsList>
        <TabsContent value="matches">
          {!filtered.length ? (
            <Empty className="min-h-72 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Film />
                </EmptyMedia>
                <EmptyTitle>
                  {demos.loading
                    ? "Matches werden geladen …"
                    : "Euer nächster Review beginnt mit einer Demo"}
                </EmptyTitle>
                <EmptyDescription>
                  Lade ein FACEIT- oder Premier-Match hoch. Markiere
                  interessante Runden und nimm sie in einen Team-Review auf.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="demo-match-list demo-scope">
              {filtered.map((demo) => {
                const map = demo.summary
                  ? maps.find((entry) => entry.mapName === demo.summary!.map)
                  : undefined;
                return (
                  <Link
                    className="demo-match-row"
                    key={demo.id}
                    to={`/analysis/demos/${demo.id}`}
                  >
                    <MapPoster map={map} />
                    <div className="demo-match-body">
                      <p className="demo-eyebrow">
                        <strong>
                          {map?.name || demo.summary?.map || "Karte folgt"}
                        </strong>
                        <i>·</i>
                        <span>{sourceLabels[demo.source]}</span>
                        <i>·</i>
                        <span>
                          {demo.teamId
                            ? entries.find((team) => team.id === demo.teamId)
                                ?.name || "Team"
                            : "Privat"}
                        </span>
                      </p>
                      <h2>{demo.title}</h2>
                      <p className="text-xs text-muted-foreground">
                        {new Date(demo.createdAt).toLocaleDateString("de-AT", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                        })}
                        {demo.summary &&
                          ` · ${demo.summary.rounds.length} Runden · ${demo.summary.players.length} Spieler`}
                      </p>
                    </div>
                    <div className="demo-match-side">
                      <span
                        className="demo-status"
                        data-tone={statusTone(demo.status)}
                      >
                        {statusLabels[demo.status]}
                      </span>
                      {demo.summary?.rounds.some((r) => r.winner) && (
                        <span
                          className="demo-match-rounds"
                          aria-label="Rundenverlauf"
                        >
                          {demo.summary.rounds.map((round) => (
                            <span
                              key={round.id}
                              data-side={sideKey(round.winner)}
                            />
                          ))}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>
        <TabsContent value="reviews">
          <div className="demo-scope grid gap-3 lg:grid-cols-2">
            {reviews.data?.entries
              .filter((review) => !teamId || review.teamId === teamId)
              .map((review) => (
                <Link
                  key={review.id}
                  className="demo-review-card"
                  to={`/analysis/reviews/${review.id}`}
                >
                  <p className="demo-eyebrow">
                    <strong>
                      {entries.find((team) => team.id === review.teamId)
                        ?.name || "Team"}
                    </strong>
                    <i>·</i>
                    <span>
                      {review.scenes.length}{" "}
                      {review.scenes.length === 1 ? "Szene" : "Szenen"}
                    </span>
                    {review.notes.length > 0 && (
                      <>
                        <i>·</i>
                        <span>
                          {review.notes.length}{" "}
                          {review.notes.length === 1 ? "Notiz" : "Notizen"}
                        </span>
                      </>
                    )}
                  </p>
                  <h2>{review.title}</h2>
                  <footer>
                    {review.session ? (
                      <span className="demo-review-live">Sitzung läuft</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Zuletzt bearbeitet{" "}
                        {new Date(review.updatedAt).toLocaleDateString(
                          "de-AT",
                        )}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-primary">
                      {review.session ? "Beitreten" : "Öffnen"}
                    </span>
                  </footer>
                </Link>
              ))}
          </div>
          {!reviews.loading && !reviews.data?.entries.length && (
            <Empty className="min-h-60 border">
              <EmptyHeader>
                <EmptyTitle>Noch kein Team-Review vorbereitet</EmptyTitle>
                <EmptyDescription>
                  Owner und Captains können eine Szenensammlung für das Team
                  anlegen.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>
      </Tabs>
      {upload && (
        <UploadDemo
          teams={entries}
          onClose={() => setUpload(false)}
          onDone={(id) => navigate(`/analysis/demos/${id}`)}
        />
      )}
      {newReview && (
        <NewReview teams={entries} onClose={() => setNewReview(false)} />
      )}
    </>
  );
}

function SaveScene({
  scene,
  demo,
  onClose,
}: {
  scene: SceneReference;
  demo: Demo;
  onClose: () => void;
}) {
  const reviews = useResource<{ entries: DemoReview[] }>(
    "/api/analysis/reviews",
  );
  const [reviewId, setReviewId] = useState("");
  const [title, setTitle] = useState(
    `Runde ${demo.summary.rounds.find((round) => round.id === scene.roundId)?.number} · ${demo.title}`.slice(
      0,
      120,
    ),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const entries =
    reviews.data?.entries.filter((review) => review.teamId === demo.teamId) ||
    [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Szene für den Review speichern</DialogTitle>
          <DialogDescription>
            {demoTime(scene.start)} bis {demoTime(scene.end)} · Die Demo bleibt
            diesem Team zugeordnet.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              let review = entries.find((review) => review.id === reviewId);
              if (!review)
                review = (
                  await api("/api/analysis/reviews", {
                    method: "POST",
                    body: JSON.stringify({
                      teamId: demo.teamId,
                      title: demo.title,
                    }),
                  })
                ).review;
              await api(`/api/analysis/reviews/${review.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  revision: review.revision,
                  action: "scene",
                  scene: { ...scene, title, note },
                }),
              });
              navigate(`/analysis/reviews/${review.id}`);
            } catch (cause) {
              setError(cause.message);
              reviews.reload();
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldGroup>
            <Choice
              label="Review"
              value={reviewId}
              onChange={setReviewId}
              disabled={busy}
              options={[
                { value: "", label: "Neuen Review für dieses Match anlegen" },
                ...entries.map((review) => ({
                  value: review.id,
                  label: review.title,
                })),
              ]}
            />
            <Field>
              <FieldLabel htmlFor="scene-title">Szenentitel</FieldLabel>
              <Input
                id="scene-title"
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="scene-note">
                Frage oder Beobachtung
              </FieldLabel>
              <Textarea
                id="scene-note"
                value={note}
                maxLength={3000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Was wollen wir hier gemeinsam besprechen?"
              />
            </Field>
            <Feedback error={error || reviews.error} />
            <DialogFooter>
              <Button disabled={busy} type="submit">
                Szene speichern
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DemoPage({ maps }: Props) {
  const { demoId } = useParams();
  const [params, setParams] = useSearchParams();
  const resource = useResource<{ demo: Demo }>(`/api/analysis/demos/${demoId}`);
  const teams = useResource<{ entries: TeamView[] }>("/api/teams");
  const [error, setError] = useState("");
  const [save, setSave] = useState<SceneReference | null>(null);
  const [share, setShare] = useState(false);
  const [remove, setRemove] = useState(false);
  const [shareTeam, setShareTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [buyFilter, setBuyFilter] = useState({ t: "", ct: "" });
  const selectedFocus = useRef("");
  const navigate = useNavigate();
  const demo = resource.data?.demo;
  const round =
    demo?.summary?.rounds.find((round) => round.id === params.get("round")) ||
    demo?.summary?.rounds[0];
  if (!demo)
    return (
      <>
        <WorkspaceHeader
          title="Matchanalyse"
          description="Demo und Runden werden geladen."
        />
        <Feedback error={resource.error} />
      </>
    );
  const canPrepare = teams.data?.entries.find((team) => team.id === demo.teamId)
    ?.permissions["analysis.prepare"];
  const canShare = demo.canEdit && demo.status === "ready" && !demo.teamId;
  const owner = demo.teamId
    ? teams.data?.entries.find((team) => team.id === demo.teamId)?.name || "Teamdemo"
    : "Privat";
  const removeDemo = async () => {
    await api(`/api/analysis/demos/${demo.id}`, {
      method: "DELETE",
      body: "{}",
    });
    navigate("/analysis");
  };
  // Without explicit bounds the whole round is shown, from the buy phase to the after-round pause.
  const startParam = params.has("start") ? Number(params.get("start")) : NaN;
  const endParam = params.has("end") ? Number(params.get("end")) : NaN;
  const from = !round
    ? 0
    : Number.isFinite(startParam)
      ? Math.max(roundStart(round), Math.min(roundEnd(round) - 0.001, startParam))
      : roundStart(round);
  const to =
    round && endParam > from && endParam <= roundEnd(round)
      ? endParam
      : round
        ? roundEnd(round)
        : 1;
  // Links from a review open only the section discussed there.
  const section = !!round && (from > roundStart(round) || to < roundEnd(round));
  const buyMatches = (entry: NonNullable<typeof round>) =>
    (["t", "ct"] as const).every(
      (side) => !buyFilter[side] || entry.economy?.[side]?.buy === buyFilter[side],
    );
  const hasEconomy = !!demo.summary?.rounds.some((entry) => entry.economy);
  const focus = demo.summary?.players.some(
    (player) => player.id === params.get("focus"),
  )
    ? params.get("focus")!
    : "";
  const scene: SceneReference | null = round
    ? {
        demoId: demo.id,
        roundId: round.id,
        version: demo.summary.version,
        start: from,
        end: to,
        focusId: focus,
      }
    : null;
  // The followed player stays in focus when switching rounds.
  const openRound = (roundId: string) =>
    setParams(
      selectedFocus.current
        ? { round: roundId, focus: selectedFocus.current }
        : { round: roundId },
    );
  const dialogs = (
    <>
      {save && (
        <SaveScene scene={save} demo={demo} onClose={() => setSave(null)} />
      )}
      <ConfirmAction
        title="Demo löschen"
        description="Die Datei und ihre Analyse werden gelöscht. Verknüpfte Reviews und Strats müssen vorher entfernt werden."
        open={remove}
        onOpenChange={setRemove}
        onConfirm={removeDemo}
      />
      <Dialog
        open={share}
        onOpenChange={(open) => {
          if (!busy) setShare(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Demo für ein Team freigeben</DialogTitle>
            <DialogDescription>
              Alle aktuellen und zukünftigen Mitglieder dieses Teams erhalten
              Zugriff. Die Demo kann anschließend in Team-Reviews und Strats
              verwendet werden.
            </DialogDescription>
          </DialogHeader>
          <Choice
            label="Team"
            value={shareTeam}
            onChange={setShareTeam}
            options={[
              { value: "", label: "Team auswählen" },
              ...(teams.data?.entries || [])
                .filter((team) => team.permissions["analysis.upload"])
                .map((team) => ({ value: team.id, label: team.name })),
            ]}
          />
          <Feedback error={error} />
          <DialogFooter>
            <Button
              disabled={!shareTeam || busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api(`/api/analysis/demos/${demo.id}/share`, {
                    method: "POST",
                    body: JSON.stringify({ teamId: shareTeam }),
                  });
                  setShare(false);
                } catch (cause) {
                  setError(cause.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Für Team freigeben
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  if (!scene)
    return (
      <>
        <WorkspaceHeader
          title={demo.title}
          description={`${sourceLabels[demo.source]} · ${owner}`}
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/analysis">Alle Matches</Link>
            </Button>
            {demo.canEdit && (
              <ConfirmAction
                title="Demo löschen"
                description="Die Datei und ihre Analyse werden gelöscht. Verknüpfte Reviews und Strats müssen vorher entfernt werden."
                onConfirm={removeDemo}
              >
                <Trash2 />
                Löschen
              </ConfirmAction>
            )}
          </div>
        </WorkspaceHeader>
        <Feedback error={resource.error || demo.error} />
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Film />
            </EmptyMedia>
            <EmptyTitle>{statusLabels[demo.status]}</EmptyTitle>
            <EmptyDescription>
              {demo.status === "failed"
                ? "Die Datei konnte nicht verarbeitet werden. Lade bei Bedarf eine neue vollständige Demo hoch."
                : "Du kannst diese Seite geöffnet lassen. Der Fortschritt wird automatisch aktualisiert."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  const warnings = demo.summary.warnings;
  const actions = !!canPrepare || canShare;
  const mapName =
    maps.find((map) => map.mapName === demo.summary.map)?.name ||
    demo.summary.map;
  const header = (
    <div className="demo-theater-heading">
      <div className="demo-theater-head">
        <Link
          to="/analysis"
          className="demo-theater-icon"
          aria-label="Alle Matches"
          title="Alle Matches"
        >
          <ArrowLeft aria-hidden="true" />
        </Link>
        <div className="demo-theater-title">
          <h1 title={demo.title}>{demo.title}</h1>
          <p className="demo-eyebrow">
            <strong>{mapName}</strong>
            <i>·</i>
            <span>{sourceLabels[demo.source]}</span>
            <i>·</i>
            <span>{owner}</span>
          </p>
        </div>
        {(actions || demo.canEdit || warnings.length > 0) && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="demo-theater-icon"
                aria-label={warnings.length ? "Aktionen und Hinweise" : "Aktionen"}
                title={warnings.length ? "Aktionen und Hinweise" : "Aktionen"}
                data-alert={warnings.length > 0 || undefined}
              >
                <Ellipsis aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {canPrepare && (
                <DropdownMenuItem
                  onSelect={() =>
                    setSave({ ...scene, focusId: selectedFocus.current })
                  }
                >
                  <Plus />
                  {section ? "Ausschnitt" : `Runde ${round.number}`} zum
                  Team-Review
                </DropdownMenuItem>
              )}
              {canShare && (
                <DropdownMenuItem onSelect={() => setShare(true)}>
                  <Share2 />
                  Für Team freigeben
                </DropdownMenuItem>
              )}
              {demo.canEdit && (
                <>
                  {actions && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setRemove(true)}
                  >
                    <Trash2 />
                    Demo löschen
                  </DropdownMenuItem>
                </>
              )}
              {warnings.length > 0 && (
                <>
                  {(actions || demo.canEdit) && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>Hinweise zur Analyse</DropdownMenuLabel>
                  {warnings.map((warning) => (
                    <p key={warning} className="demo-theater-note">
                      {warning}
                    </p>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {section && (
        <button
          type="button"
          className="demo-chip demo-theater-section"
          aria-label={`Ausschnitt ${demoTime(from)} bis ${demoTime(to)} verlassen und ganze Runde zeigen`}
          title="Ganze Runde zeigen"
          onClick={() => openRound(round.id)}
        >
          Ausschnitt {demoTime(from)} bis {demoTime(to)}
          <X aria-hidden="true" />
        </button>
      )}
      <Feedback error={resource.error} />
    </div>
  );
  const filtered = !!(buyFilter.t || buyFilter.ct);
  const rounds = (
    <div className="demo-theater-rounds">
      <div className="demo-ribbon" role="group" aria-label="Runden auswählen">
        {demo.summary.rounds.map((entry, at) => {
          const scored = demo.summary.rounds.some((r) => r.winner);
          const until = demo.summary.rounds.slice(0, at + 1);
          const label = roundBreak(entry.number, demo.summary.rounds.length);
          const economy = (["t", "ct"] as const)
            .filter((side) => entry.economy?.[side])
            .map((side) => `${side.toUpperCase()}: ${buyLabel(entry.economy![side]!.buy)}`)
            .join(", ");
          return (
            <Fragment key={entry.id}>
              <button
                type="button"
                className="demo-ribbon-round"
                data-side={sideKey(entry.winner)}
                aria-pressed={round.id === entry.id}
                data-economy={hasEconomy || undefined}
                data-dimmed={!buyMatches(entry) || undefined}
                aria-label={`Runde ${entry.number}${entry.winner === 2 ? ", T gewinnt" : entry.winner === 3 ? ", CT gewinnt" : ""}${economy ? `, ${economy}` : ""}`}
                title={`Runde ${entry.number}${entry.winner === 2 ? " · T gewinnt" : entry.winner === 3 ? " · CT gewinnt" : ""}${economy ? ` · ${economy}` : ""}`}
                onClick={() => openRound(entry.id)}
              >
                {hasEconomy && (
                  <span className="demo-ribbon-eco" aria-hidden="true">
                    {(["t", "ct"] as const).map((side) => (
                      <i
                        key={side}
                        data-side={side}
                        data-buy={entry.economy?.[side]?.buy}
                        style={{
                          height: `${Math.max(8, Math.min(100, ((entry.economy?.[side]?.equipment || 0) / 25000) * 100))}%`,
                        }}
                      />
                    ))}
                  </span>
                )}
                <span>{entry.number}</span>
              </button>
              {label && (
                <span className="demo-ribbon-break" aria-hidden="true">
                  {scored && (
                    <strong>
                      <span data-side="t">
                        {until.filter((r) => r.winner === 2).length}
                      </span>
                      {" : "}
                      <span data-side="ct">
                        {until.filter((r) => r.winner === 3).length}
                      </span>
                    </strong>
                  )}
                  {label}
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
      {hasEconomy && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="demo-theater-icon"
              aria-label={filtered ? "Buy-Filter aktiv, ändern" : "Runden nach Buy filtern"}
              title="Runden nach Buy filtern"
              data-active={filtered || undefined}
            >
              <ListFilter aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {(["t", "ct"] as const).map((side) => (
              <DropdownMenuGroup key={side}>
                <DropdownMenuLabel>{side.toUpperCase()}-Buy</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={buyFilter[side] || "all"}
                  onValueChange={(value) =>
                    setBuyFilter((current) => ({
                      ...current,
                      [side]: value === "all" ? "" : value,
                    }))
                  }
                >
                  {[{ value: "all", label: "Alle Buys" }, ...economyOptions].map(
                    (option) => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                        onSelect={(event) => event.preventDefault()}
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ),
                  )}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </DropdownMenuGroup>
            ))}
            <p className="demo-theater-note">
              {demo.summary.rounds.filter(buyMatches).length} von{" "}
              {demo.summary.rounds.length} Runden · Buy-Typ automatisch aus dem
              Ausrüstungswert nach dem Kauf erkannt
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  return (
    <>
      <DemoPlayer
        scene={scene}
        maps={maps}
        theater={{ header, rounds }}
        onPosition={(_, focusId) => {
          selectedFocus.current = focusId;
        }}
      />
      {dialogs}
    </>
  );
}

export function ReviewPage({ user, maps }: Props) {
  const { reviewId } = useParams();
  const path = `/api/analysis/reviews/${reviewId}/room`;
  const resource = useResource<ReviewRoom>(path);
  const connection = useLiveState();
  const [following, setFollowing] = useState(true);
  const [localIndex, setLocalIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<DemoScene | null>(null);
  const navigate = useNavigate();
  const room = resource.data;
  const review = room?.review;
  const session = review?.session;
  const scenes = session?.scenes || review?.scenes || [];
  const index =
    following && session
      ? session.playback.sceneIndex
      : Math.min(localIndex, Math.max(0, scenes.length - 1));
  const scene = scenes[index];
  const moderator = session?.moderatorId === user.identitySteam64;
  const readyKey =
    session && ready && index === session.playback.sceneIndex
      ? `${session.id}:${index}`
      : "";
  useEffect(() => {
    setReady(false);
  }, [scene?.demoId, scene?.roundId, scene?.id]);
  useEffect(() => {
    setFollowing(true);
    setLocalIndex(0);
    setError("");
  }, [reviewId]);
  useEffect(() => {
    if (!review || connection !== "connected") return;
    const presence = () => {
      void liveCommand(path, { action: "presence", readyKey, following }).catch(
        () => {},
      );
    };
    presence();
    const timer = setInterval(presence, 15_000);
    return () => clearInterval(timer);
  }, [path, !!review, connection, readyKey, following]);
  useEffect(
    () => () => {
      void liveCommand(path, { action: "leave" }).catch(() => {});
    },
    [path],
  );
  async function command(body: any) {
    setBusy(true);
    setError("");
    try {
      await liveCommand(path, { ...body, revision: review!.revision });
    } catch (cause) {
      setError(cause.message);
      if (cause.status === 409) resource.reload();
    } finally {
      setBusy(false);
    }
  }
  async function prepare(body: any) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/analysis/reviews/${reviewId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...body, revision: review!.revision }),
      });
      setEditing(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  if (!review)
    return (
      <>
        <WorkspaceHeader
          title="Team-Review"
          description="Vorbereitete Szenen gemeinsam besprechen."
        />
        <Feedback error={resource.error} />
      </>
    );
  const changeScene = (next: number) => {
    if (session && following && moderator)
      void command({ action: "scene", index: next });
    else {
      setLocalIndex(next);
      if (session) setFollowing(false);
    }
  };
  return (
    <>
      <WorkspaceHeader
        title={review.title}
        description={
          session
            ? "Gemeinsam ansehen, besprechen und Aufgaben festhalten."
            : "Szenen sortieren und den gemeinsamen Review vorbereiten."
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/analysis?view=reviews">Alle Reviews</Link>
          </Button>
          {room.canEdit &&
            (!session ? (
              <Button
                disabled={busy || !scenes.length || connection !== "connected"}
                onClick={() => void command({ action: "start" })}
              >
                <Radio data-icon="inline-start" />
                Sitzung starten
              </Button>
            ) : moderator ? (
              <Button
                variant="outline"
                disabled={busy || connection !== "connected"}
                onClick={() => void command({ action: "stop" })}
              >
                Sitzung beenden
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy || connection !== "connected"}
                onClick={() => void command({ action: "takeover" })}
              >
                Steuerung übernehmen
              </Button>
            ))}
        </div>
      </WorkspaceHeader>
      <Feedback error={error || resource.error} />
      <div className="demo-room-bar demo-scope">
        <div className="demo-room-people">
          <span className="demo-room-count">
            <UsersRound className="size-3.5" />
            {room.participants.length} anwesend
          </span>
          {room.participants.map((participant) => {
            const isModerator = participant.id === session?.moderatorId;
            return (
              <span
                className="demo-person"
                key={participant.id}
                data-moderator={isModerator}
                title={
                  [
                    isModerator ? "Captain" : "",
                    session ? (participant.ready ? "bereit" : "lädt") : "",
                    !participant.following ? "sieht selbst nach" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
              >
                <span className="demo-person-initial" aria-hidden="true">
                  {participant.name.trim().slice(0, 1) || "?"}
                </span>
                {participant.name}
                {session && (
                  <span
                    className="demo-person-state"
                    data-ready={participant.ready}
                    data-following={participant.following}
                    aria-label={
                      !participant.following
                        ? "sieht selbst nach"
                        : participant.ready
                          ? "bereit"
                          : "lädt"
                    }
                  />
                )}
              </span>
            );
          })}
        </div>
        {session && (
          <Button
            variant={following ? "secondary" : "default"}
            size="sm"
            onClick={() => {
              setLocalIndex(index);
              setFollowing(!following);
            }}
          >
            {following ? "Selbst ansehen" : "Captain folgen"}
          </Button>
        )}
      </div>
      {session && (
        <p className="demo-room-hint">
          {following
            ? moderator
              ? "Du steuerst die gemeinsame Wiedergabe. Ein Klick auf die Karte setzt den gemeinsamen Zeiger."
              : `Du folgst ${room.participants.find((participant) => participant.id === session.moderatorId)?.name || "dem Captain"}.`
            : "Deine Wiedergabe ist unabhängig. Das Team bleibt beim Captain."}
          {connection !== "connected" &&
            " Die Live-Verbindung ist unterbrochen; der gemeinsame Stand wird nach der Verbindung neu geladen."}
        </p>
      )}
      {!scene ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Film />
            </EmptyMedia>
            <EmptyTitle>Die erste Szene fehlt noch</EmptyTitle>
            <EmptyDescription>
              Öffne ein Team-Match und füge die gewünschte Runde über das
              Aktionsmenü neben dem Titel diesem Review hinzu.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild>
            <Link to={`/analysis?team=${review.teamId}`}>
              Team-Matches öffnen
            </Link>
          </Button>
        </Empty>
      ) : (
        <div className="demo-analysis-grid demo-scope">
          <div className="flex min-w-0 flex-col gap-5">
            <DemoPlayer
              key={`${scene.id}:${following ? "follow" : "local"}`}
              scene={scene}
              maps={maps}
              onReady={setReady}
              playback={following && session ? session.playback : undefined}
              onPlayback={
                following && session
                  ? (value) => void command({ action: "playback", ...value })
                  : undefined
              }
              disabled={
                !!session &&
                following &&
                (!moderator || busy || connection !== "connected")
              }
              pointer={following ? room.pointer : null}
              onPoint={
                session &&
                following &&
                moderator &&
                !busy &&
                connection === "connected"
                  ? (point) => void command({ action: "pointer", ...point })
                  : undefined
              }
            />
            <section className="demo-scene-card" aria-labelledby="scene-title">
              <header>
                <p className="demo-eyebrow">
                  <strong>
                    Szene {index + 1} von {scenes.length}
                  </strong>
                  <i>·</i>
                  <span>
                    {demoTime(scene.start)} bis {demoTime(scene.end)}
                  </span>
                </p>
                <h2 id="scene-title" className="mt-2">
                  {scene.title}
                </h2>
                <p data-placeholder={!scene.note}>
                  {scene.note || "Welche Entscheidung hat diese Szene geprägt?"}
                </p>
              </header>
              <div className="demo-scene-body">
                <div className="flex flex-wrap gap-2">
                  {room.canEdit && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          const result = await api("/api/analysis/strats", {
                            method: "POST",
                            body: JSON.stringify({
                              teamId: review.teamId,
                              scene,
                              title: scene.title,
                              note: scene.note,
                            }),
                          });
                          navigate(`/strats/${result.strat.id}/edit`);
                        } catch (cause) {
                          setError(cause.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <BookOpen data-icon="inline-start" />
                      Strat daraus erstellen
                    </Button>
                  )}
                  <Button asChild variant="ghost">
                    <Link
                      to={`/analysis/demos/${scene.demoId}?round=${scene.roundId}&start=${scene.start}&end=${scene.end}&focus=${scene.focusId}`}
                    >
                      Szene im Match öffnen
                    </Link>
                  </Button>
                </div>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      await api(`/api/analysis/reviews/${reviewId}/notes`, {
                        method: "POST",
                        body: JSON.stringify({ sceneId: scene.id, text: note }),
                      });
                      setNote("");
                    } catch (cause) {
                      setError(cause.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="review-note">
                        Erkenntnis oder nächste Aufgabe
                      </FieldLabel>
                      <Textarea
                        id="review-note"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={3000}
                        required
                        placeholder="Was ändern wir im nächsten Training?"
                      />
                    </Field>
                    <div>
                      <Button type="submit" disabled={busy || !note.trim()}>
                        <Check data-icon="inline-start" />
                        Festhalten
                      </Button>
                    </div>
                  </FieldGroup>
                </form>
                {review.notes.some((entry) => entry.sceneId === scene.id) && (
                  <ol className="demo-notes">
                    {review.notes
                      .filter((entry) => entry.sceneId === scene.id)
                      .map((entry) => (
                        <li key={entry.id}>
                          <p>{entry.text}</p>
                          <p>
                            {entry.authorName} ·{" "}
                            {new Date(entry.createdAt).toLocaleString("de-AT", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </p>
                        </li>
                      ))}
                  </ol>
                )}
              </div>
            </section>
          </div>
          <aside className="flex min-w-0 flex-col gap-4">
            <section className="demo-panel" aria-labelledby="agenda-title">
              <header>
                <h2 id="agenda-title">
                  {session ? "Gemeinsame Szenenfolge" : "Vorbereitete Szenen"}
                </h2>
                <p>
                  {scenes.length} {scenes.length === 1 ? "Szene" : "Szenen"} ·{" "}
                  {session
                    ? "Stand beim Start der Sitzung"
                    : "In dieser Reihenfolge besprecht ihr das Match"}
                </p>
              </header>
              <div className="demo-panel-body">
                <ol className="demo-agenda">
                  {scenes.map((entry, at) => (
                    <li
                      key={entry.id}
                      className="demo-agenda-item"
                      data-active={index === at}
                    >
                      <button
                        type="button"
                        className="demo-agenda-select"
                        disabled={busy}
                        aria-current={index === at ? "true" : undefined}
                        onClick={() => changeScene(at)}
                      >
                        <span className="demo-agenda-number">{at + 1}</span>
                        <span className="min-w-0">
                          <span className="demo-agenda-title">
                            {entry.title}
                          </span>
                          <span className="demo-agenda-time">
                            {demoTime(entry.start)} bis {demoTime(entry.end)}
                          </span>
                        </span>
                      </button>
                      {room.canEdit && !session && (
                        <div className="demo-agenda-tools">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(structuredClone(entry))}
                          >
                            Bearbeiten
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Szene nach oben"
                            disabled={busy || at === 0}
                            onClick={() => {
                              const ids = review.scenes.map(
                                (scene) => scene.id,
                              );
                              [ids[at - 1], ids[at]] = [ids[at], ids[at - 1]];
                              void prepare({ action: "reorder", ids });
                            }}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Szene nach unten"
                            disabled={busy || at === scenes.length - 1}
                            onClick={() => {
                              const ids = review.scenes.map(
                                (scene) => scene.id,
                              );
                              [ids[at], ids[at + 1]] = [ids[at + 1], ids[at]];
                              void prepare({ action: "reorder", ids });
                            }}
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Szene entfernen"
                            disabled={busy}
                            onClick={() =>
                              void prepare({
                                action: "remove",
                                sceneId: entry.id,
                              })
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                <Button asChild variant="outline" className="w-full">
                  <Link to={`/analysis?team=${review.teamId}`}>
                    Weitere Matches ansehen
                  </Link>
                </Button>
                {session && (
                  <p className="text-xs text-muted-foreground">
                    Neue Szenen werden für die nächste Sitzung vorbereitet.
                    Diese Szenenfolge bleibt während des Reviews erhalten.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Szene vorbereiten</DialogTitle>
            <DialogDescription>
              Frage und Ausschnitt für euren Team-Review anpassen.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void prepare({ action: "scene", scene: editing });
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="edit-scene-title">Titel</FieldLabel>
                  <Input
                    id="edit-scene-title"
                    required
                    maxLength={120}
                    value={editing.title}
                    onChange={(event) =>
                      setEditing({ ...editing, title: event.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-scene-note">
                    Frage oder Beobachtung
                  </FieldLabel>
                  <Textarea
                    id="edit-scene-note"
                    maxLength={3000}
                    value={editing.note}
                    onChange={(event) =>
                      setEditing({ ...editing, note: event.target.value })
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="edit-scene-start">
                      Anfang in Sekunden
                    </FieldLabel>
                    <Input
                      id="edit-scene-start"
                      type="number"
                      min={0}
                      step="0.1"
                      required
                      value={editing.start}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          start: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="edit-scene-end">
                      Ende in Sekunden
                    </FieldLabel>
                    <Input
                      id="edit-scene-end"
                      type="number"
                      min={0}
                      step="0.1"
                      required
                      value={editing.end}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          end: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                </div>
                <Feedback error={error} />
                <DialogFooter>
                  <Button type="submit" disabled={busy}>
                    Szene speichern
                  </Button>
                </DialogFooter>
              </FieldGroup>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
