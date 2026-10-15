import { useEffect, useRef, useState } from "react";
import { BUILT_IN_MAPS } from "../lib/maps";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Spinner } from "./ui/spinner";
import { Feedback, useResource, WorkspaceHeader } from "./workspace-ui";

type SceneState = "ready" | "failed" | "exporting" | "waiting";
type MapSceneStatus = {
  worker: {
    alive: boolean; startedAt: string; updatedAt: string; intervalSeconds: number;
    current: { map: string; startedAt: string } | null; nextCheckAt: string | null;
  } | null;
  maps: {
    map: string; state: SceneState; available: boolean; bytes: number | null; exportedAt: string | null;
    error: string | null; failedAt: string | null; retryAt: string | null;
  }[];
  log: { at: string; message: string }[];
};

const STATE: Record<SceneState, { label: string; variant: "success" | "destructive" | "default" | "outline" }> = {
  ready: { label: "Bereit", variant: "success" },
  failed: { label: "Fehlgeschlagen", variant: "destructive" },
  exporting: { label: "Wird exportiert", variant: "default" },
  waiting: { label: "Wartet", variant: "outline" },
};

const mapName = (map: string) => BUILT_IN_MAPS.find(entry => entry.mapName === map)?.name || map;
const time = (value: string) => new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const dateTime = (value: string) => new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
const minutesSince = (value: string, now: number) => Math.max(0, Math.round((now - Date.parse(value)) / 60000));
const megabytes = (bytes: number) => `${(bytes / 1048576).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function WorkerSummary({ worker, now }: { worker: MapSceneStatus["worker"]; now: number }) {
  if (!worker) return <p className="text-sm text-muted-foreground">Der Export-Dienst hat noch keinen Status gemeldet. Läuft der Container <code>map-scenes</code>?</p>;
  if (!worker.alive) return <p className="text-sm text-destructive">Keine Rückmeldung vom Export-Dienst seit {dateTime(worker.updatedAt)}. Container <code>map-scenes</code> prüfen.</p>;
  if (worker.current) return <p className="flex items-center gap-2 text-sm"><Spinner className="size-4" />{mapName(worker.current.map)} wird seit {minutesSince(worker.current.startedAt, now)} min exportiert. Nach 30 Minuten bricht der Dienst ab.</p>;
  return <p className="text-sm text-muted-foreground">{worker.nextCheckAt ? `Nichts zu tun. Nächste Prüfung um ${time(worker.nextCheckAt)}.` : "Prüft die Map-Archive …"}</p>;
}

function SceneDetail({ entry, now }: { entry: MapSceneStatus["maps"][number]; now: number }) {
  const scene = entry.available && entry.bytes !== null && entry.exportedAt ? `${megabytes(entry.bytes)}, exportiert ${dateTime(entry.exportedAt)}` : "";
  if (entry.state === "failed") return <div className="min-w-0 text-sm">
    <p>{entry.retryAt && Date.parse(entry.retryAt) > now ? `Nächster Versuch ab ${time(entry.retryAt)}` : "Nächster Versuch beim nächsten Durchlauf"}{entry.available ? ". Bis dahin bleibt die vorherige Szene sichtbar." : "."}</p>
    <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Fehlermeldung von {entry.failedAt ? dateTime(entry.failedAt) : "unbekannt"}</summary><p className="mt-1 break-words font-mono text-xs text-muted-foreground">{entry.error}</p></details>
  </div>;
  if (entry.state === "ready") return <p className="text-sm text-muted-foreground">{scene}</p>;
  if (entry.state === "exporting") return <p className="text-sm text-muted-foreground">{scene ? `Ersetzt die Szene von ${dateTime(entry.exportedAt!)}.` : "Noch keine Szene vorhanden."}</p>;
  return <p className="text-sm text-muted-foreground">{scene ? `Neuer Export ausstehend. Aktuell: ${scene}` : "Noch nicht exportiert."}</p>;
}

export function MapScenesPage() {
  const { data, error } = useResource<MapSceneStatus>("/api/admin/map-scenes");
  const now = useNow();
  const logRef = useRef<HTMLPreElement>(null);
  const lastLine = data?.log.at(-1)?.at;
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lastLine]);

  return (
    <>
      <WorkspaceHeader title="Abwurfsichten" description="Der Dienst map-scenes erstellt die 3D-Szenen der Abwurfsicht aus den Map-Archiven des Servers. Die Ansicht aktualisiert sich live." />
      <Feedback error={error} />
      {!data ? !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" />Status wird geladen …</p> : <div className="flex flex-col gap-6">
        <Card>
          <CardHeader><CardTitle>Maps</CardTitle><WorkerSummary worker={data.worker} now={now} /></CardHeader>
          <CardContent>
            {data.maps.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Map exportiert.</p> : <ul className="divide-y divide-border">
              {data.maps.map(entry => <li key={entry.map} className="grid gap-2 py-3 sm:grid-cols-[12rem_9rem_1fr] sm:items-start">
                <div><p className="text-sm font-medium">{mapName(entry.map)}</p><p className="font-mono text-xs text-muted-foreground">{entry.map}</p></div>
                <div><Badge variant={STATE[entry.state].variant}>{STATE[entry.state].label}</Badge></div>
                <SceneDetail entry={entry} now={now} />
              </li>)}
            </ul>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Protokoll</CardTitle><CardDescription>Die letzten Meldungen des Export-Dienstes. Das vollständige Protokoll zeigt <code>docker compose logs map-scenes</code>.</CardDescription></CardHeader>
          <CardContent>
            <pre ref={logRef} className="log-console max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-sidebar-border p-4 font-mono text-xs leading-relaxed">
              {data.log.length ? data.log.map(line => `${dateTime(line.at)}  ${line.message}`).join("\n") : "Noch keine Meldungen."}
            </pre>
          </CardContent>
        </Card>
      </div>}
    </>
  );
}
