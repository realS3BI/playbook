import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, Download, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { Actor } from "../../../shared/authorization";
import { isPlatformAdmin } from "../../../shared/authorization";
import type { Demo } from "../../../shared/demos";
import type {
  Prematch,
  MatchConnection,
  MatchEntry,
} from "../../../shared/matches";
import type { StratView, TeamView } from "../../../shared/strats";
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
import { Progress } from "./ui/progress";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Choice, Feedback, useResource, WorkspaceHeader } from "./workspace-ui";
import { AnalysisNav } from "./live-session-pages";
import { SceneExample } from "./demo-player";
import { DemoFolderImport } from "./demo-folder-import";
type Props = { user: Actor; maps: MapDefinition[] };
const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
function FaceitAccess({ configured, downloadsConfigured, onSave }: {
  configured: boolean;
  downloadsConfigured: boolean;
  onSave: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [downloadsToken, setDownloadsToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <Card id="faceit-access">
      <CardHeader>
        <CardTitle>FACEIT-Zugang einrichten</CardTitle>
        <CardDescription>
          Als Plattform-Admin richtest du den Zugang für alle Benutzer ein.
          Die Zugangsdaten werden verschlüsselt gespeichert.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="faceit-access-form" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setSaved(false);
          try {
            await api("/api/analysis/providers/faceit", {
              method: "PUT",
              body: JSON.stringify({
                ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                ...(downloadsToken.trim() ? { downloadsToken: downloadsToken.trim() } : {}),
              }),
            });
            setApiKey("");
            setDownloadsToken("");
            setSaved(true);
            onSave();
          } catch (cause) {
            setError(cause.message);
          } finally {
            setBusy(false);
          }
        }}>
          <FieldGroup>
            <Field>
              <FieldLabel id="faceit-api-key-label">Data-API-Schlüssel</FieldLabel>
              <Badge variant="secondary">{configured ? "Eingerichtet" : "Noch nicht eingerichtet"}</Badge>
              <Input id="faceit-api-key" aria-labelledby="faceit-api-key-label" type="password" autoComplete="new-password"
                required={!configured} disabled={busy} maxLength={8192}
                value={apiKey} onChange={(event) => setApiKey(event.target.value)}
                placeholder={configured ? "Leer lassen, um den Schlüssel zu behalten" : "Serverseitigen API-Schlüssel eingeben"} />
              <FieldDescription>
                Importiert deine Matchhistorie und einzelne Matchrooms. Erstelle einen serverseitigen Schlüssel im{" "}
                <a href="https://developers.faceit.com/" target="_blank" rel="noreferrer">FACEIT Developer Portal</a>.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel id="faceit-downloads-token-label">Downloads-Token, optional</FieldLabel>
              <Badge variant="secondary">{downloadsConfigured ? "Eingerichtet" : "Noch nicht eingerichtet"}</Badge>
              <Input id="faceit-downloads-token" aria-labelledby="faceit-downloads-token-label" type="password" autoComplete="new-password"
                disabled={busy} maxLength={8192} value={downloadsToken}
                onChange={(event) => setDownloadsToken(event.target.value)}
                placeholder={downloadsConfigured ? "Leer lassen, um den Token zu behalten" : "Freigegebenen Downloads-Token eingeben"} />
              <FieldDescription>
                Automatische Demodownloads benötigen eine separate{" "}
                <a href="https://docs.faceit.com/getting-started/Guides/download-api/" target="_blank" rel="noreferrer">Freigabe von FACEIT</a>.
                Ohne Token kannst du Matchdaten importieren und hochgeladene Demos zuordnen.
              </FieldDescription>
            </Field>
            <Feedback error={error} />
            {saved && <p role="status" className="text-sm">FACEIT-Zugang gespeichert. Du kannst deine Matchquelle jetzt verbinden.</p>}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button type="submit" form="faceit-access-form" disabled={busy || (!apiKey.trim() && !downloadsToken.trim())}>
          {busy ? "Zugang wird geprüft …" : "FACEIT-Zugang speichern"}
        </Button>
      </CardFooter>
    </Card>
  );
}
export function MatchImportsPage({ user }: Props) {
  const teams = useResource<{ entries: TeamView[] }>("/api/teams"),
    sources = useResource<{ entries: MatchConnection[]; capabilities: any }>(
      "/api/analysis/connections",
    ),
    matches = useResource<{ entries: MatchEntry[] }>("/api/analysis/matches"),
    demos = useResource<{ entries: Demo[] }>("/api/analysis/demos");
  const [teamId, setTeamId] = useState(""),
    [provider, setProvider] = useState("faceit"),
    [code, setCode] = useState(""),
    [authCode, setAuthCode] = useState(""),
    [autoDownload, setAutoDownload] = useState(true),
    [matchId, setMatchId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [linking, setLinking] = useState(""),
    [linkDemo, setLinkDemo] = useState("");
  const storage = useResource<any>(
      `/api/analysis/storage/${teamId || "personal"}`,
    ),
    team = teams.data?.entries.find((t) => t.id === teamId),
    canImport = !teamId || !!team?.permissions["analysis.import"];
  const editable =
    teams.data?.entries.filter((t) => t.permissions["analysis.import"]) || [];
  async function work(operation: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      sources.reload();
      matches.reload();
      storage.reload();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  const filtered =
    matches.data?.entries.filter((m) => m.teamId === (teamId || null)) || [];
  const used = storage.data
    ? storage.data.usage.originals +
      storage.data.usage.replays +
      storage.data.usage.audio +
      storage.data.usage.reserved
    : 0;
  return (
    <>
      <WorkspaceHeader
        title="Matchimporte"
        description="Eigene Matches automatisch finden. Demodateien gezielt abrufen und Speicherverbrauch im Blick behalten."
      />
      <AnalysisNav />
      <Feedback error={error || sources.error || matches.error} />
      <div className="mb-5 max-w-lg">
        <Choice
          label="Arbeitsbereich"
          value={teamId}
          onChange={setTeamId}
          options={[
            { value: "", label: "Nur für mich" },
            ...(teams.data?.entries || []).map((t) => ({
              value: t.id,
              label: t.name,
            })),
          ]}
        />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="flex min-w-0 flex-col gap-4">
          {canImport && <DemoFolderImport teamId={teamId || null} onImported={() => { matches.reload(); demos.reload(); storage.reload(); }} />}
          <Card>
            <CardHeader>
              <CardTitle>Verbundene Matchquellen</CardTitle>
              <CardDescription>
                Deine Freigaben bleiben an dein Steam-Konto gebunden.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {sources.data?.entries.map((connection) => (
                <div
                  key={connection.id}
                  className="flex flex-col gap-2 border-b pb-4 last:border-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{connection.label}</p>
                    <Badge variant="secondary">
                      {connection.enabled
                        ? "Automatischer Abgleich"
                        : "Pausiert"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {connection.teamId
                      ? teams.data?.entries.find(
                          (t) => t.id === connection.teamId,
                        )?.name || "Teamverbindung"
                      : "Privat"}{" "}
                    ·{" "}
                    {connection.lastSyncAt
                      ? `Zuletzt ${new Date(connection.lastSyncAt).toLocaleString("de-AT")}`
                      : "Erster Abgleich ausstehend"}
                  </p>
                  <Feedback error={connection.lastError} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void work(() =>
                          api(
                            `/api/analysis/connections/${connection.id}/sync`,
                            { method: "POST" },
                          ),
                        )
                      }
                    >
                      <RefreshCw data-icon="inline-start" />
                      Jetzt abgleichen
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void work(() =>
                          api(`/api/analysis/connections/${connection.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              enabled: !connection.enabled,
                              autoDownload: connection.autoDownload,
                            }),
                          }),
                        )
                      }
                    >
                      {connection.enabled ? "Pausieren" : "Fortsetzen"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void work(() =>
                          api(`/api/analysis/connections/${connection.id}`, {
                            method: "DELETE",
                          }),
                        )
                      }
                    >
                      Verbindung entfernen
                    </Button>
                  </div>
                </div>
              ))}
              {!sources.data?.entries.length && (
                <p className="text-sm text-muted-foreground">
                  Verbinde FACEIT oder Premier, damit neue Matches hier
                  erscheinen.
                </p>
              )}
            </CardContent>
          </Card>
          <div className="flex flex-col gap-3" aria-label="Importierte Matches">
            {filtered.map((match) => (
              <Card key={match.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{match.title}</CardTitle>
                    <Badge variant="secondary">
                      {match.source === "faceit"
                        ? "FACEIT"
                        : "Premier / Matchmaking"}
                    </Badge>
                  </div>
                  <CardDescription>
                    {match.playedAt
                      ? new Date(match.playedAt).toLocaleDateString("de-AT")
                      : "Zeitpunkt noch unbekannt"}{" "}
                    · {match.map || "Map noch unbekannt"} · {match.competition}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">
                    {match.demoStatus === "imported"
                      ? "Analyse verfügbar"
                      : match.demoStatus === "queued"
                        ? "Demo wird verarbeitet"
                        : match.demoStatus === "access_required"
                          ? "Demozugang muss eingerichtet werden"
                          : match.demoStatus === "available"
                            ? "Demo verfügbar"
                            : "Demo noch nicht verfügbar"}
                  </p>
                  <Feedback error={match.error} />
                  {linking === match.id && (
                    <div className="mt-3 flex flex-col gap-2">
                      <Choice
                        label="Passende hochgeladene Demo"
                        value={linkDemo}
                        onChange={setLinkDemo}
                        options={[
                          { value: "", label: "Demo auswählen" },
                          ...(demos.data?.entries || [])
                            .filter((d) => d.teamId === match.teamId)
                            .map((d) => ({ value: d.id, label: d.title })),
                        ]}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!linkDemo || busy}
                        onClick={() =>
                          void work(async () => {
                            await api(
                              `/api/analysis/matches/${match.id}/demo`,
                              {
                                method: "POST",
                                body: JSON.stringify({ demoId: linkDemo }),
                              },
                            );
                            setLinking("");
                          })
                        }
                      >
                        Demo zuordnen
                      </Button>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  {match.demoId ? (
                    <Button asChild variant="outline">
                      <Link to={`/analysis/demos/${match.demoId}`}>
                        Demo öffnen
                      </Link>
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !canImport}
                        onClick={() =>
                          void work(() =>
                            api(`/api/analysis/matches/${match.id}/download`, {
                              method: "POST",
                            }),
                          )
                        }
                      >
                        <Download data-icon="inline-start" />
                        Demo importieren
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canImport}
                        onClick={() => {
                          setLinking(linking === match.id ? "" : match.id);
                          setLinkDemo("");
                        }}
                      >
                        Hochgeladene Demo zuordnen
                      </Button>
                    </>
                  )}
                  {match.demoId && canImport && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void work(() =>
                          api(`/api/analysis/demos/${match.demoId}/pin`, {
                            method: "POST",
                            body: JSON.stringify({ pinned: true }),
                          }),
                        )
                      }
                    >
                      <ShieldCheck data-icon="inline-start" />
                      Original behalten
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
            {!filtered.length && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    Die nächste Matchhistorie entsteht hier
                  </EmptyTitle>
                  <EmptyDescription>
                    Verbinde dein Konto oder füge einen FACEIT-Matchroom hinzu.
                    Bereits hochgeladene Dateien findest du unter Demos.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </section>
        <aside className="flex flex-col gap-4">
          {isPlatformAdmin(user) && sources.data && (
            <FaceitAccess configured={sources.data.capabilities.faceit}
              downloadsConfigured={sources.data.capabilities.faceitDownloads}
              onSave={() => { sources.reload(); matches.reload(); setError(""); }} />
          )}
          {canImport && (
            <Card>
              <CardHeader>
                <CardTitle>Meine Matches verbinden</CardTitle>
                <CardDescription>
                  {teamId
                    ? "Neue Matches werden für dieses Team importiert."
                    : "Deine neuen Matches bleiben zunächst privat."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  id="connect-source"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void work(async () => {
                      await api("/api/analysis/connections", {
                        method: "POST",
                        body: JSON.stringify({
                          teamId: teamId || null,
                          source: provider,
                          shareCode: code,
                          authenticationCode: authCode,
                          autoDownload,
                        }),
                      });
                      setCode("");
                      setAuthCode("");
                    });
                  }}
                >
                  <FieldGroup>
                    <Choice
                      label="Matchquelle"
                      value={provider}
                      onChange={setProvider}
                      options={[
                        { value: "faceit", label: "FACEIT" },
                        { value: "premier", label: "Premier / Matchmaking" },
                      ]}
                    />
                    {provider === "premier" && (
                      <>
                        <Field>
                          <FieldLabel>Game Authentication Code</FieldLabel>
                          <Input
                            type="password"
                            autoComplete="off"
                            required
                            value={authCode}
                            onChange={(e) => setAuthCode(e.target.value)}
                          />
                          <FieldDescription>
                            Öffne die History-Freigabe bei Steam und melde dich
                            an. Erstelle oder kopiere dort deinen Game
                            Authentication Code und füge ihn hier ein.
                            Das ist kein Steam-Passwort.
                          </FieldDescription>
                        </Field>
                        <Button asChild variant="outline" size="sm">
                          <a
                            href="https://steamcommunity.com/my/gcpd/730/?tab=authcodes"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Authentication Code bei Steam holen
                          </a>
                        </Button>
                        <Field>
                          <FieldLabel>Aktueller Match-Sharecode</FieldLabel>
                          <Input
                            required
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="CSGO-…"
                          />
                          <FieldDescription>
                            Öffne in CS2 „Ansehen“ → „Deine Matches“, wähle ein
                            eigenes Match aus und kopiere über „Teilen“ den
                            Match-Sharecode. Füge den vollständigen Code mit
                            „CSGO-“ am Anfang hier ein. Das Match darf höchstens
                            einen Monat alt sein und dient als Ausgangspunkt
                            für weitere Matches.
                          </FieldDescription>
                          <FieldDescription>
                            Auf der Steam-Seite „Persönliche Spieldaten“ erhältst
                            du über „Aufnahme herunterladen“ nur die Demo-Datei.
                            Den Match-Sharecode kopierst du direkt in CS2.
                          </FieldDescription>
                        </Field>
                        <Button asChild variant="outline" size="sm">
                          <a href="steam://rungameid/730">
                            CS2 über Steam öffnen
                          </a>
                        </Button>
                      </>
                    )}
                    {provider === "faceit" && (
                      <FieldDescription>
                        Das FACEIT-Konto wird anhand deiner bestätigten Steam-ID
                        zugeordnet.
                        {sources.data && !sources.data.capabilities.faceit && (
                          isPlatformAdmin(user)
                            ? <> Richte zuerst oben den FACEIT-Zugang ein.</>
                            : <> Ein Plattform-Admin muss zuerst den FACEIT-Zugang einrichten.</>
                        )}
                      </FieldDescription>
                    )}
                    <Field className="flex items-center gap-3">
                      <Checkbox
                        checked={autoDownload}
                        onCheckedChange={(value) =>
                          setAutoDownload(value === true)
                        }
                      />
                      <FieldLabel>
                        Demos automatisch abrufen, sobald der Zugang bereitsteht
                      </FieldLabel>
                    </Field>
                  </FieldGroup>
                </form>
              </CardContent>
              <CardFooter>
                <Button form="connect-source" type="submit" disabled={busy || (provider === "faceit" && !sources.data?.capabilities.faceit)}>
                  <Link2 data-icon="inline-start" />
                  Matchquelle verbinden
                </Button>
              </CardFooter>
            </Card>
          )}
          {canImport && (
            <Card>
              <CardHeader>
                <CardTitle>FACEIT-Match hinzufügen</CardTitle>
                <CardDescription>
                  Auch für Gegner und Pro-Vorbilder.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Field>
                  <FieldLabel>Matchroom-Link oder Match-ID</FieldLabel>
                  <Input
                    value={matchId}
                    onChange={(e) => setMatchId(e.target.value)}
                  />
                </Field>
              </CardContent>
              <CardFooter>
                <Button
                  variant="outline"
                  disabled={!matchId || busy || !sources.data?.capabilities.faceit}
                  onClick={() =>
                    void work(async () => {
                      await api("/api/analysis/matches/faceit", {
                        method: "POST",
                        body: JSON.stringify({
                          teamId: teamId || null,
                          matchId,
                        }),
                      });
                      setMatchId("");
                    })
                  }
                >
                  Match hinzufügen
                </Button>
              </CardFooter>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Speicher im Arbeitsbereich</CardTitle>
              <CardDescription>
                {storage.data?.storage === "uploadthing"
                  ? "Private Tonspuren in UploadThing"
                  : "Tonspuren und Demos auf dem Server"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Feedback error={storage.error} />
              {storage.data && (
                <>
                  <Progress
                    value={Math.min(
                      100,
                      (used / storage.data.scopeLimit) * 100,
                    )}
                  />
                  <p className="font-mono text-sm">
                    {size(used)} / {size(storage.data.scopeLimit)}
                  </p>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt>Originaldemos</dt>
                    <dd>{size(storage.data.usage.originals)}</dd>
                    <dt>Replay-Daten</dt>
                    <dd>{size(storage.data.usage.replays)}</dd>
                    <dt>Tonaufnahmen</dt>
                    <dd>{size(storage.data.usage.audio)}</dd>
                    <dt>Reservierter Arbeitsraum</dt>
                    <dd>{size(storage.data.usage.reserved)}</dd>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    Neue Autoimports: Originale 14 Tage, ungenutzte Analysen und
                    Aufzeichnungen 90 Tage. Verknüpfte Erklärungen und Strats
                    schützen ihre Replay-Daten. Manuelle Demo-Uploads behalten
                    ihre bisherige Aufbewahrung.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          {sources.data && (
            <Card>
              <CardHeader>
                <CardTitle>Zugänge des Betreibers</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ["FACEIT-Matchdaten", sources.data.capabilities.faceit],
                    [
                      "FACEIT-Demodownloads",
                      sources.data.capabilities.faceitDownloads,
                    ],
                    [
                      "Steam-Matchhistorie",
                      sources.data.capabilities.steamHistory,
                    ],
                    [
                      "Steam-Demozugang",
                      sources.data.capabilities.steamDownloads,
                    ],
                  ].map(([label, ready]) => (
                    <div key={String(label)} className="contents">
                      <dt>{label}</dt>
                      <dd>{ready ? "Bereit" : "Noch nicht eingerichtet"}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

export function PrematchesPage(_: Props) {
  const teams = useResource<{ entries: TeamView[] }>("/api/teams"),
    preparations = useResource<{ entries: Prematch[] }>(
      "/api/analysis/prematches",
    );
  const editable =
      teams.data?.entries.filter((t) => t.permissions["analysis.scout"]) || [],
    [teamId, setTeamId] = useState(""),
    [title, setTitle] = useState(""),
    [opponent, setOpponent] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <WorkspaceHeader
        title="Prematch"
        description="Gegner verstehen und daraus einen gemeinsamen Matchplan vorbereiten."
      />
      <AnalysisNav />
      <Feedback error={error || preparations.error} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="flex flex-col gap-3">
          {preparations.data?.entries.map((prep) => (
            <Card key={prep.id}>
              <CardHeader>
                <CardTitle>
                  <Link to={`/analysis/prematch/${prep.id}`}>{prep.title}</Link>
                </CardTitle>
                <CardDescription>
                  {prep.competition || "Wettbewerb noch offen"} ·{" "}
                  {prep.published ? "Für das Team veröffentlicht" : "Entwurf"} ·{" "}
                  {prep.matchIds.length} zugeordnete Matches
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button asChild variant="outline">
                  <Link to={`/analysis/prematch/${prep.id}`}>
                    Vorbereitung öffnen
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
          {!preparations.data?.entries.length && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Den nächsten Gegner vorbereiten</EmptyTitle>
                <EmptyDescription>
                  Ein Captain hinterlegt Gegner und Besetzung. Der
                  veröffentlichte Matchplan ist anschließend für das Team
                  sichtbar.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
        {!!editable.length && (
          <Card>
            <CardHeader>
              <CardTitle>Neue Matchvorbereitung</CardTitle>
              <CardDescription>
                FACEIT-Team oder Matchroom als Ausgangspunkt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                id="create-prematch"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api("/api/analysis/prematches", {
                      method: "POST",
                      body: JSON.stringify({
                        teamId: teamId || editable[0].id,
                        title,
                        opponent,
                      }),
                    });
                    navigate(`/analysis/prematch/${result.preparation.id}`);
                  } catch (cause) {
                    setError(cause.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <FieldGroup>
                  <Choice
                    label="Eigenes Team"
                    value={teamId || editable[0].id}
                    onChange={setTeamId}
                    options={editable.map((t) => ({
                      value: t.id,
                      label: t.name,
                    }))}
                  />
                  <Field>
                    <FieldLabel>Name der Vorbereitung</FieldLabel>
                    <Input
                      required
                      maxLength={120}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Turnier am Freitag"
                    />
                  </Field>
                  <Field>
                    <FieldLabel>FACEIT-Team oder Matchroom</FieldLabel>
                    <Input
                      maxLength={300}
                      value={opponent}
                      onChange={(e) => setOpponent(e.target.value)}
                      placeholder="Team-Link oder Team-ID"
                    />
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
            <CardFooter>
              <Button form="create-prematch" disabled={busy}>
                Vorbereitung erstellen
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </>
  );
}

export function PrematchPage({ maps }: Props) {
  const { preparationId } = useParams(),
    preparation = useResource<{ preparation: Prematch }>(
      `/api/analysis/prematches/${preparationId}`,
    ),
    strats = useResource<{ entries: StratView[] }>("/api/strats"),
    matches = useResource<{ entries: MatchEntry[] }>("/api/analysis/matches");
  const [report, setReport] = useState<any>(null),
    [draft, setDraft] = useState<Prematch | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [rosterText, setRosterText] = useState("");
  useEffect(() => {
    if (!preparation.data) {
      if (preparation.error) {
        setDraft(null);
        setReport(null);
      }
      return;
    }
    const controller = new AbortController();
    api(`/api/analysis/prematches/${preparationId}/report`, {
      signal: controller.signal,
    })
      .then(setReport)
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause.message);
          setReport(null);
        }
      });
    if (!draft || draft.id !== preparationId) {
      setDraft(preparation.data.preparation);
      setRosterText(preparation.data.preparation.roster.join("\n"));
    }
    return () => controller.abort();
  }, [preparation.data?.preparation.revision, preparation.error]);
  async function work(operation: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      const result = await api(`/api/analysis/prematches/${preparationId}`);
      setDraft(result.preparation);
      setRosterText(result.preparation.roster.join("\n"));
      preparation.reload();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  if (!draft || !report)
    return (
      <>
        <WorkspaceHeader
          title="Matchvorbereitung"
          description="Gegnerbericht und gemeinsamer Matchplan"
        />
        <Feedback
          error={error || preparation.error}
          message="Vorbereitung wird geladen …"
        />
      </>
    );
  const available =
      strats.data?.entries.filter(
        (s) => s.teamId === draft.teamId && s.published,
      ) || [],
    candidateMatches =
      matches.data?.entries.filter((m) => m.teamId === draft.teamId) || [];
  return (
    <>
      <WorkspaceHeader
        title={draft.title}
        description={`${draft.competition || "Wettbewerb offen"} · ${draft.days} Tage · ${draft.published ? "Für das Team veröffentlicht" : "Entwurf"}`}
      >
        <Badge variant="secondary">
          {report.coverage.exact} Matches mit bestätigtem Fünfer
        </Badge>
      </WorkspaceHeader>
      <AnalysisNav />
      <Feedback error={error || preparation.error} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Datengrundlage</CardTitle>
              <CardDescription>
                Die tatsächliche Besetzung entscheidet, welche Matches in die
                Tendenzen eingehen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt>Matches im Zeitraum</dt>
                <dd>{report.coverage.found}</dd>
                <dt>Bestätigter Fünfer</dt>
                <dd>{report.coverage.exact}</dd>
                <dt>Teilweise gleiche Besetzung</dt>
                <dd>{report.coverage.partial}</dd>
                <dt>Analysierte Demos des Fünfers</dt>
                <dd>{report.coverage.analyzed}</dd>
              </dl>
              {draft.roster.length !== 5 && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Bestätige fünf Gegner-Spieler, damit einzelne Pug-Matches
                  nicht als Teamtendenz gelten.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Gespielte Maps</CardTitle>
              <CardDescription>
                Matches des bestätigten Fünfers. Gespielte Maps belegen keine
                Pick-/Ban-Reihenfolge.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {report.maps.map((map) => (
                <div
                  key={map.map}
                  className="flex items-center justify-between gap-3 border-b pb-3"
                >
                  <span className="font-medium">{map.map}</span>
                  <span className="text-sm">
                    {map.matches} Matches ·{" "}
                    {map.results
                      ? `${map.wins}/${map.results} bekannte Ergebnisse gewonnen`
                      : "Ergebnisse fehlen"}
                  </span>
                </div>
              ))}
              {!report.maps.length && (
                <p className="text-sm text-muted-foreground">
                  Noch keine passenden Mapdaten. Ergänze Matches und bestätige
                  das erwartete Lineup.
                </p>
              )}
            </CardContent>
          </Card>
          {report.observations.map((observation, index) => (
            <Card key={index}>
              <CardHeader>
                <CardTitle>{observation.text}</CardTitle>
                <CardDescription>
                  {observation.map} · {observation.rounds} betrachtete Runden ·{" "}
                  {observation.filter}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {observation.examples.map((scene) => (
                  <SceneExample
                    key={`${scene.demoId}:${scene.roundId}`}
                    scene={scene}
                    maps={maps}
                  />
                ))}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardTitle>Unser Matchplan</CardTitle>
              <CardDescription>
                Beobachtungen werden zu bewussten Entscheidungen für das Team.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap">
                {draft.notes ||
                  "Der Captain ergänzt hier Aufgaben, Prioritäten und den Gegenplan."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {draft.stratIds.map((id) => (
                  <Button key={id} asChild variant="outline">
                    <Link to={`/strats/${id}`}>
                      {available.find((s) => s.id === id)?.published.content
                        .title || "Strat öffnen"}
                    </Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Quellenmatches</CardTitle>
              <CardDescription>
                Fehlende Demos bleiben als Datenlücke sichtbar.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {report.entries.map((match) => (
                <div
                  key={match.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-sm">
                    {match.playedAt
                      ? new Date(match.playedAt).toLocaleDateString("de-AT")
                      : "Zeitpunkt noch unbekannt"}{" "}
                    · {match.title}
                  </span>
                  {match.demoId ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/analysis/demos/${match.demoId}`}>
                        Demo ansehen
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/analysis/imports">Demo beschaffen</Link>
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
        {report.canEdit && (
          <aside>
            <Card>
              <CardHeader>
                <CardTitle>Vorbereitung bearbeiten</CardTitle>
                <CardDescription>
                  Erwartete Besetzung und Wettbewerb zuerst bestätigen. Danach
                  den Matchplan veröffentlichen.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  id="edit-prematch"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void work(() =>
                      api(`/api/analysis/prematches/${draft.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({
                          ...draft,
                          roster: rosterText.split(/[\s,]+/).filter(Boolean),
                        }),
                      }),
                    );
                  }}
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Gegner-Team oder Matchroom</FieldLabel>
                      <Input
                        value={draft.opponent}
                        maxLength={300}
                        onChange={(e) =>
                          setDraft({ ...draft, opponent: e.target.value })
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void work(async () => {
                          await api(`/api/analysis/prematches/${draft.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              ...draft,
                              roster: rosterText
                                .split(/[\s,]+/)
                                .filter(Boolean),
                            }),
                          });
                          await api(
                            `/api/analysis/prematches/${draft.id}/sync`,
                            { method: "POST" },
                          );
                        })
                      }
                    >
                      <RefreshCw data-icon="inline-start" />
                      Gegnermatches abgleichen
                    </Button>
                    <Field>
                      <FieldLabel>Erwartete fünf FACEIT-Spieler-IDs</FieldLabel>
                      <Textarea
                        value={rosterText}
                        onChange={(e) => setRosterText(e.target.value)}
                        rows={5}
                      />
                      <FieldDescription>
                        Eine ID pro Zeile. Der Teamabgleich schlägt die aktuelle
                        Besetzung vor; bestätige sie für das anstehende Match.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel>FACEIT-Turnier-Link (optional)</FieldLabel>
                      <Input
                        value={draft.competitionSource || ""}
                        maxLength={300}
                        placeholder="https://www.faceit.com/en/championship/…"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            competitionSource: e.target.value,
                          })
                        }
                      />
                      <FieldDescription>
                        Der Abgleich übernimmt passende Gegnermatches aus diesem
                        Wettbewerb.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel>Wettbewerb</FieldLabel>
                      <Input
                        value={draft.competition}
                        maxLength={120}
                        onChange={(e) =>
                          setDraft({ ...draft, competition: e.target.value })
                        }
                      />
                    </Field>
                    <Choice
                      label="Zeitraum"
                      value={String(draft.days)}
                      onChange={(value) =>
                        setDraft({ ...draft, days: Number(value) })
                      }
                      options={[14, 30, 90, 180].map((days) => ({
                        value: String(days),
                        label: `Letzte ${days} Tage`,
                      }))}
                    />
                    <Field>
                      <FieldLabel>Ausgewählte Quellenmatches</FieldLabel>
                      <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
                        {candidateMatches.map((match) => (
                          <Field
                            key={match.id}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              checked={draft.matchIds.includes(match.id)}
                              onCheckedChange={(checked) =>
                                setDraft({
                                  ...draft,
                                  matchIds: checked
                                    ? [...draft.matchIds, match.id]
                                    : draft.matchIds.filter(
                                        (id) => id !== match.id,
                                      ),
                                })
                              }
                            />
                            <FieldLabel>
                              {match.title} ·{" "}
                              {match.playedAt
                                ? new Date(match.playedAt).toLocaleDateString(
                                    "de-AT",
                                  )
                                : "Zeitpunkt noch unbekannt"}
                            </FieldLabel>
                          </Field>
                        ))}
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel>Matchplan und Aufgaben</FieldLabel>
                      <Textarea
                        rows={8}
                        value={draft.notes}
                        maxLength={10000}
                        onChange={(e) =>
                          setDraft({ ...draft, notes: e.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Passende eigene Strats</FieldLabel>
                      <div className="flex flex-col gap-2">
                        {available.map((strat) => (
                          <Field
                            key={strat.id}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              checked={draft.stratIds.includes(strat.id)}
                              onCheckedChange={(checked) =>
                                setDraft({
                                  ...draft,
                                  stratIds: checked
                                    ? [...draft.stratIds, strat.id]
                                    : draft.stratIds.filter(
                                        (id) => id !== strat.id,
                                      ),
                                })
                              }
                            />
                            <FieldLabel>
                              {strat.published.content.title}
                            </FieldLabel>
                          </Field>
                        ))}
                      </div>
                    </Field>
                    <Field className="flex items-center gap-3">
                      <Checkbox
                        checked={draft.published}
                        onCheckedChange={(value) =>
                          setDraft({ ...draft, published: value === true })
                        }
                      />
                      <FieldLabel>Für das Team veröffentlichen</FieldLabel>
                    </Field>
                  </FieldGroup>
                </form>
              </CardContent>
              <CardFooter>
                <Button form="edit-prematch" disabled={busy}>
                  <Check data-icon="inline-start" />
                  Vorbereitung speichern
                </Button>
              </CardFooter>
            </Card>
          </aside>
        )}
      </div>
    </>
  );
}
