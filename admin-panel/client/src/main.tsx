import { WorkspaceNavigation } from "./components/workspace-navigation";
import { LiveStratsPage } from "./components/live-strats-page";
import { useLiveResource, useLiveState } from "./hooks/use-live-resource";
import { authorize, isServerAdmin } from "../../shared/authorization";
import { TeamsPage, TeamPage, JoinTeamPage } from "./components/teams-page";
import { AnalysisPage, DemoPage, ReviewPage } from "./components/analysis-pages";
import { LiveRecordingStatus } from "./components/live-recording-status";
import { LiveSessionsPage, LiveSessionPage } from "./components/live-session-pages";
import { MatchImportsPage, PrematchesPage, PrematchPage } from "./components/match-preparation-pages";
import { StratsPage, StratPage, StratEditor, LiveStratSettingsPage } from "./components/strats-page";
import { RolesPage } from "./components/roles-page";
import { MapScenesPage } from "./components/map-scenes-page";
import { NadesMenuStatus } from "./components/nades-menu-status";
import { AppSidebar } from "./components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { TooltipProvider } from "./components/ui/tooltip";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./components/ui/breadcrumb";
import { UserManagement } from "./components/user-management";
import { RconChat } from "./components/rcon-chat";
import { MapAtlas } from "./components/map-atlas";
import { LineupPage, NewLineupPage } from "./components/lineup-page";
import { LineupReviewPage } from "./components/lineup-review-page";
import { ReviewQueuePage } from "./components/review-queue-page";
import { REVIEW_QUEUE_PATH } from "./lib/review-queue";
import { NadeFavoritesProvider } from "./components/nade-favorites";
import { findLineup, lineupPath } from "./lib/lineups";
import { mapPath, mapSlug, mapsForLibrary } from "./lib/maps";
import { NadeLibrary, LegacyLibraryRedirect } from "./components/nade-library";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate, NavLink, Route, Routes, matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BookOpen,
  Box,
  ClipboardCheck,
  Check,
  ChevronRight,
  CircleDot,
  Crosshair,
  ExternalLink,
  LayoutDashboard,
  MapPinned,
  PackagePlus,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Gamepad2,
  Server,
  Shield,
  Terminal,
  Trash2,
  UploadCloud,
  UsersRound,
  Wrench
} from "lucide-react";
import { api } from "./lib/api";
import type { ServerOperation } from "./lib/server-status";
import { cn } from "./lib/utils";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { ActionButton } from "./components/action-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "./components/ui/switch";
import {
  mapsForInventory,
  addWorkshopMap,
  removeWorkshopMap,
  workshopMapsFromSettings
} from "./lib/maps";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./index.css";
import { Diagnostics, DiagnosticsSummary } from "./diagnostics";
import { MapControls, ModeControls, useLiveGame } from "./components/server-controls";
import { PageHeader } from "./components/page-header";
import { PageSection } from "./components/page-sections";

const routePaths = {
  login: "/login",
  overview: "/overview",
  game: "/game",
  server: "/server",
  operations: "/operations",
  reviews: REVIEW_QUEUE_PATH,
  access: "/admin/users",
  maps: "/maps",
  nades: "/nades",
  console: "/console",
  links: "/links"
};

/** Former Server tabs, merged into Spiel and Betrieb; old bookmarks keep working. */
const legacyServerPaths = {
  "/plugins": routePaths.game,
  "/maintenance": `${routePaths.operations}#wartung`,
  "/diagnostics": `${routePaths.operations}#diagnose`,
  "/logs": `${routePaths.operations}#logs`
};
const isLegacyServerPath = (path: string) => Object.hasOwn(legacyServerPaths, path);

const tabs = [
  { id: "teams", path: "/teams", label: "Teams", icon: UsersRound, group: "Teams" },
  { id: "analysis", path: "/analysis", label: "Analyse", icon: Activity, group: "Analyse" },
  { id: "strats", path: "/strats", label: "Strats", icon: BookOpen, group: "Strats" },
  { id: "roles", path: "/admin/roles", label: "Rollen und Rechte", icon: Shield, group: "Verwaltung" },
  { id: "nades", path: routePaths.nades, label: "Nades", icon: Crosshair, group: "Training" },
  { id: "maps", path: routePaths.maps, label: "Maps", icon: MapPinned, group: "Training" },
  { id: "overview", path: routePaths.overview, label: "Übersicht", icon: LayoutDashboard, group: "Server" },
  { id: "game", path: routePaths.game, label: "Spiel", icon: Gamepad2, group: "Server" },
  { id: "server", path: routePaths.server, label: "Server", icon: Server, group: "Server" },
  { id: "operations", path: routePaths.operations, label: "Betrieb", icon: Wrench, group: "Server" },
  { id: "console", path: routePaths.console, label: "Konsole", icon: Terminal, group: "Server" },
  { id: "reviews", path: routePaths.reviews, label: "Reviews", icon: ClipboardCheck, group: "Verwaltung" },
  { id: "access", path: routePaths.access, label: "Benutzer", icon: Shield, group: "Verwaltung" },
  { id: "map-scenes", path: "/admin/map-scenes", label: "Abwurfsichten", icon: Box, group: "Verwaltung" },
  { id: "links", path: routePaths.links, label: "Dokumentation", icon: BookOpen, group: "Hilfe" }
];

const defaultRoute = routePaths.maps;
function isMapRoute(pathname) {
  return Boolean(matchPath("/maps/:mapSlug", pathname) || matchPath("/maps/:mapSlug/lineups/:lineupId", pathname) || matchPath("/maps/:mapSlug/lineups/:lineupId/review", pathname));
}
function allowedTabs(user) { return tabs.filter(tab => {
  if (["Training", "Teams", "Strats", "Analyse", "Hilfe"].includes(tab.group)) return true;
  const action = ["reviews", "map-scenes"].includes(tab.id) ? "lineups.moderate" : ["access", "roles"].includes(tab.id) ? "users.manage" : tab.id === "console" ? "server.rcon" : ["overview", "game"].includes(tab.id) ? "server.match" : "server.manage";
  return authorize(user, action);
}); }
const isWorkspaceRoute = (path: string) => /^\/(teams|strats|analysis)(\/|$)/.test(path);

function routeFromLoginSearch(search) {
  const requestedRoute = new URLSearchParams(search).get("redirect");
  if (!requestedRoute) return defaultRoute;
  const pathname = requestedRoute.split("?")[0];
  return (tabs.some(item => item.path === pathname) || isLegacyServerPath(pathname) || isMapRoute(pathname) || isWorkspaceRoute(pathname)) ? requestedRoute : defaultRoute;
}

function Message({ error = "" }: { error?: string }) {
  return error ? <p role="alert" className="text-sm whitespace-pre-wrap text-destructive">{error}</p> : null;
}

function Login() {
  const failed = new URLSearchParams(window.location.search).has("error");
  return <main className="login-shell login-grid grid min-h-screen place-items-center p-6">
    <Card className="w-full max-w-lg"><CardHeader><div className="mb-4 flex items-center gap-3"><span className="control-brand-mark"><Crosshair /></span><span className="font-mono text-sm">PLAYBOOK</span></div><CardTitle className="control-title text-3xl">Deine Maps. Deine Nades.</CardTitle><CardDescription>Entdecke Lineups, lerne Wurfwege und bereite deine nächste Runde vor. Melde dich mit Steam an.</CardDescription></CardHeader><CardContent className="flex flex-col gap-5"><Message error={failed ? "Steam-Anmeldung abgebrochen oder abgelaufen. Bitte erneut anmelden." : ""} /><Button asChild><a href={`/api/auth/steam?returnTo=${encodeURIComponent(routeFromLoginSearch(window.location.search))}`}>Mit Steam anmelden</a></Button><p className="text-sm text-muted-foreground">Neue Spieler können Teams gründen und Einladungen annehmen. Dein Steam-Passwort gibst du ausschließlich bei Steam ein.</p></CardContent></Card>
  </main>;
}

function TestLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api("/api/auth/test", { method: "POST", body: JSON.stringify({ username, password }) });
      window.location.replace("/maps");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Anmeldung fehlgeschlagen.");
      setPending(false);
    }
  }

  return <main className="login-shell login-grid grid min-h-screen place-items-center p-6">
    <Card className="w-full max-w-lg">
      <CardHeader>
        <div className="mb-4 flex items-center gap-3"><span className="control-brand-mark"><Crosshair /></span><span className="font-mono text-sm">PLAYBOOK</span></div>
        <CardTitle>Als Spieler testen</CardTitle>
        <CardDescription>Melde dich mit dem Testkonto an, um Maps und Lineups mit der Rolle Spieler zu nutzen.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field htmlFor="test-username">
              <FieldLabel>Benutzername</FieldLabel>
              <Input id="test-username" name="username" autoComplete="username" required maxLength={100} value={username} onChange={event => setUsername(event.target.value)} disabled={pending} />
            </Field>
            <Field htmlFor="test-password">
              <FieldLabel>Passwort</FieldLabel>
              <Input id="test-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
            </Field>
            <Message error={error} />
            <Button type="submit" disabled={pending}>{pending && <Spinner data-icon="inline-start" />}{pending ? "Anmeldung läuft …" : "Als Spieler anmelden"}</Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter><Button asChild variant="ghost"><NavLink to="/login">Zur Steam-Anmeldung</NavLink></Button></CardFooter>
    </Card>
  </main>;
}

function Shell({ user, children, tab, onLogout, dirty, busy, onSave, onApply, operation, status, statusUnavailable, selectedMap, selectedNade, reviewing }) {
  const connection = useLiveState();
  const activeTab = tabs.find((item) => item.id === tab) || tabs[0];
  const path = useLocation().pathname;
  const livePage = path === "/strats/live" || path.startsWith("/strats/live/");
  const immersive = livePage || /^\/strats\/control\/[^/]+$/.test(path);
  const workspacePage = tab === "teams" ? (path === "/teams" ? "Meine Teams" : path.includes("/join/") ? "Einladung" : "Mitglieder")
    : tab === "strats" ? (livePage ? "Live" : path.startsWith("/strats/control") ? "Live verwalten" : path.endsWith("/edit") ? "Editor" : path.endsWith("/new") ? "Neue Strat" : path === "/strats" ? "Bibliothek" : "Aufgaben") : tab === "analysis" ? (path.includes("/reviews/") ? "Team-Review" : path.includes("/demos/") ? "Matchanalyse" : "Matches und Reviews") : "";
  const currentPage = workspacePage || (reviewing ? "Review" : selectedNade?.displayName || selectedNade?.name || selectedMap?.name || (tab === "maps" ? "Alle Maps" : activeTab.label));
  const serverActions = authorize(user, "server.match") && activeTab.group === "Server" ? <>
    {dirty && <span className="workspace-navigation-note">Ungespeicherte Änderungen</span>}
    <ActionButton size="sm" variant="secondary" onClick={onSave} disabled={!dirty || busy} icon={Save} pendingLabel="Wird gespeichert …" successLabel="Gespeichert" title="Hinterlegt den Entwurf, ohne den Server neu zu starten.">Entwurf speichern</ActionButton>
    <ActionButton size="sm" onClick={onApply} disabled={busy} icon={RotateCcw} pendingLabel="Wird übernommen …" successLabel="Übernommen" title="Aktiviert alle Einstellungen und startet den Server neu.">Übernehmen & neu starten</ActionButton>
  </> : undefined;

  return (
    <TooltipProvider>
      <SidebarProvider>
        <a className="skip-link" href="#main-content">Zum Inhalt</a>
        {!immersive && <AppSidebar user={user} serverItems={allowedTabs(user).filter(item => item.group === "Server")} adminItems={allowedTabs(user).filter(item => item.group === "Verwaltung")} onNavigate={() => {}} onLogout={onLogout} dirty={dirty} status={status} operation={operation} unavailable={statusUnavailable} />}
        <SidebarInset className={immersive ? "workspace-inset live-workspace min-w-0" : "workspace-inset min-w-0"}>
          {!immersive && <header className="control-topbar sticky top-0 z-30">
            <div className="topbar-inner">
              <SidebarTrigger />
              <Separator orientation="vertical" className="h-4 data-vertical:self-center" />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild><NavLink to={activeTab.group === "Training" ? routePaths.maps : activeTab.group === "Server" ? routePaths.overview : activeTab.path}>{activeTab.group === "Training" ? "Maps" : activeTab.group === "Teams" ? "Teams" : activeTab.group}</NavLink></BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  {selectedNade && selectedMap && <><BreadcrumbItem><BreadcrumbLink asChild><NavLink to={mapPath(selectedMap)}>{selectedMap.name}</NavLink></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /></>}
                  {reviewing && selectedNade && selectedMap && <><BreadcrumbItem><BreadcrumbLink asChild><NavLink to={lineupPath(selectedMap, selectedNade)}>{selectedNade.displayName || selectedNade.name}</NavLink></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /></>}
                  <BreadcrumbItem className="min-w-0"><BreadcrumbPage className="truncate max-w-48 sm:max-w-80">{currentPage}</BreadcrumbPage></BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div className="topbar-status"><Badge variant={connection === "connected" ? "secondary" : "outline"} role="status">{connection === "connected" ? "Live verbunden" : connection === "connecting" ? "Verbindung wird aufgebaut …" : "Live-Verbindung unterbrochen"}</Badge></div>
            </div>
          </header>}
        <div id="main-content" className={immersive ? "live-content min-w-0" : "control-content control-main min-w-0"} tabIndex={-1}>
          {!immersive && <LiveRecordingStatus userId={user.identitySteam64} />}
          {["Server", "Verwaltung"].includes(activeTab.group) && <WorkspaceNavigation label={`${activeTab.group}-Navigation`} items={allowedTabs(user).filter(item => item.group === activeTab.group).sort((a, b) => activeTab.group === "Verwaltung" ? ["access", "roles", "reviews", "map-scenes"].indexOf(a.id) - ["access", "roles", "reviews", "map-scenes"].indexOf(b.id) : 0).map(item => ({ label: item.label, path: item.path }))} actions={serverActions} />}
          <NadeFavoritesProvider key={user.identitySteam64}>{children}</NadeFavoritesProvider>
        </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function formatDate(value) {
  if (!value) return "Noch nicht";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unbekannt" : date.toLocaleString();
}


function OverviewPanel({ title, description = "", to = "", className = "", children }) {
  return <Card className={className}>
    <CardHeader className="flex flex-row items-start justify-between gap-4">
      <div className="grid gap-1.5"><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>
      {to && <Button variant="ghost" size="sm" asChild><NavLink to={to} aria-label={`${title} öffnen`}>Öffnen<ChevronRight data-icon="inline-end" /></NavLink></Button>}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>;
}

/** Policy field when available; match admins receive no settings groups. */
function settingFieldFor(policy, key, label) {
  return (policy?.settingsGroups || []).flatMap(group => group.fields).find(field => field.key === key) || { key, label, type: "boolean" };
}

function Overview({ settings, setSettings, status, policy, busy, serverAdmin, onAddWorkshop }) {
  const service = status?.service;
  const running = serverAdmin ? service?.state === "running" : true;
  const live = useLiveGame({ busy, running });
  const setupRequired = serverAdmin && (!String(settings.steamToken || "").trim() || !String(settings.rconPassword || "").trim());
  const setValue = key => value => setSettings(current => ({ ...current, [key]: value }));
  const trainingFields = [
    settingFieldFor(policy, "trainingHudEnabled", "Trainings-HUD aktivieren"),
    ...(settings.serverMode === "matchzy" ? [settingFieldFor(policy, "matchZySmokeColor", "Farbige Smokes im Practice-Modus")] : [])
  ];

  return (
    <>
      <PageHeader
        eyebrow={serverAdmin ? "Serververwaltung" : "Match Admin"}
        title={serverAdmin ? settings.serverName || "CS2-Server" : "Serversteuerung"}
        description="Zustand des Servers und die wichtigsten Schalter für die nächste Session."
      />
      {setupRequired ? (
        <Alert className="mb-4" variant="warning">
          <AlertTitle>Server noch nicht eingerichtet</AlertTitle>
          <AlertDescription>Trage unter <NavLink className="underline underline-offset-4" to={`${routePaths.server}#zugang`}>Server → Zugang & Sicherheit</NavLink> einen Steam-Token und ein RCON-Passwort ein. Mit „Übernehmen & neu starten“ startest du anschließend den Server.</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {serverAdmin && <section className="md:col-span-2 xl:col-span-3" aria-label="Diagnose">
          <DiagnosticsSummary actions={<>
            <Badge variant={setupRequired ? "warning" : service?.state === "running" ? "success" : "destructive"}>
              <span className="server-status-dot" />
              Server: {setupRequired ? "Wartet auf Einrichtung" : ({ running: "Läuft", exited: "Beendet", restarting: "Startet neu", created: "Erstellt" }[service?.state] || "Unbekannt")}
            </Badge>
            <Button variant="ghost" size="sm" asChild><NavLink to={`${routePaths.operations}#diagnose`} aria-label="Diagnose öffnen">Öffnen<ChevronRight data-icon="inline-end" /></NavLink></Button>
          </>} />
        </section>}
        <OverviewPanel title="Maps" to={serverAdmin ? `${routePaths.game}#maps` : ""} className="md:col-span-2 xl:col-span-3">
          <MapControls settings={settings} setSettings={setSettings} busy={busy} live={live} />
          {!serverAdmin && <Button className="mt-4" variant="secondary" onClick={onAddWorkshop}><PackagePlus data-icon="inline-start" />Workshop-Map hinzufügen</Button>}
        </OverviewPanel>
        <OverviewPanel title="Spielmodus" description="Modus für den nächsten Serverstart." to={`${routePaths.game}#spielmodus`} className="md:col-span-2 xl:col-span-3">
          <ModeControls settings={settings} setSettings={setSettings} policy={policy} busy={busy} live={live} />
        </OverviewPanel>
        <div className="grid content-start gap-4 md:col-span-2 md:grid-cols-2 xl:col-span-3">
          {serverAdmin && <OverviewPanel title="VAC" to={`${routePaths.server}#zugang`}>
            <SettingField field={settingFieldFor(policy, "vacEnabled", "VAC aktivieren")} value={settings.vacEnabled} onChange={setValue("vacEnabled")} />
          </OverviewPanel>}
          <OverviewPanel title="Training" to={serverAdmin ? `${routePaths.game}#training` : ""}>
            <div className="grid gap-3">{trainingFields.map(field => <SettingField key={field.key} field={field} value={settings[field.key]} onChange={setValue(field.key)} />)}</div>
          </OverviewPanel>
        </div>
      </div>
    </>
  );
}

/** Cards for the policy's settings groups; credentials and the start map have their own controls. */
function SettingsGroups({ ids, settings, setSettings, policy }) {
  return (policy?.settingsGroups || []).filter(group => ids.includes(group.id) && (group.id !== "matchzy" || settings.serverMode === "matchzy")).map(group => {
    const credentials = ["joinPassword", "rconPassword"];
    const fields = group.fields.filter(field => !["matchZySaveNadesGlobally", "startMap"].includes(field.key) && (field.key !== "matchZyVersion" || settings.serverMode === "matchzy") && !credentials.includes(field.key));
    return <Card key={group.id}>
      <CardHeader><CardTitle>{group.title}</CardTitle><CardDescription>{group.description}</CardDescription></CardHeader>
      <CardContent><FieldGroup className="grid gap-5 md:grid-cols-2">
        {fields.map(field => <SettingField key={field.key} field={field} value={settings[field.key] ?? ""} onChange={value => setSettings(current => ({ ...current, [field.key]: value }))} />)}
      </FieldGroup></CardContent>
    </Card>;
  });
}

function PasswordSettings({ settings, setSettings, policy }) {
  const identity = policy?.settingsGroups?.find(group => group.id === "identity");
  return <Card><CardHeader><CardTitle>Passwörter</CardTitle><CardDescription>Das Serverpasswort regelt den Beitritt. Mit dem RCON-Passwort lässt sich der Server fernsteuern.</CardDescription></CardHeader><CardContent><FieldGroup className="grid gap-5 md:grid-cols-2">{(identity?.fields || []).filter(field => ["joinPassword", "rconPassword"].includes(field.key)).map(field => <SettingField key={field.key} field={field} value={settings[field.key] ?? ""} onChange={value => setSettings(current => ({ ...current, [field.key]: value }))} />)}</FieldGroup></CardContent></Card>;
}

function ServerSettings({ settings, setSettings, policy }) {
  const props = { settings, setSettings, policy };
  return <>
    <PageSection id="allgemein" title="Allgemein"><SettingsGroups ids={["identity"]} {...props} /></PageSection>
    <PageSection id="zugang" title="Zugang & Sicherheit"><SettingsGroups ids={["registration", "security"]} {...props} /><PasswordSettings {...props} /></PageSection>
    <PageSection id="erweitert" title="Erweitert"><SettingsGroups ids={["advanced"]} {...props} /></PageSection>
  </>;
}

function SettingField({ field, value, onChange }) {
  if (field.type === "boolean") {
    const isVac = field.key === "vacEnabled";
    return (
      <Field htmlFor={`setting-${field.key}`} className={cn("flex min-h-16 grid-cols-[1fr_auto] items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3", isVac && "justify-between md:col-span-2")}>
        <span className="min-w-0"><FieldLabel>{field.label}</FieldLabel>
          {isVac ? <FieldDescription id={`setting-${field.key}-description`} className="mt-1 block" aria-live="polite">
            {value === true ? "VAC aktiviert · Zugang mit -insecure nicht möglich." : "VAC deaktiviert · Zugang mit und ohne -insecure möglich. Automatische Playbook-Reviews sind möglich."}
            {value !== true && <span className="mt-1 block">Auf diesem Server besteht kein VAC-Schutz. Das ändert nicht die VAC-Einstellung deines lokal gestarteten Spiels.</span>}
          </FieldDescription> : field.description ? <FieldDescription id={`setting-${field.key}-description`} className="mt-1 block">{field.description}</FieldDescription> : null}
        </span>
        <Switch id={`setting-${field.key}`} aria-label={field.label} aria-describedby={isVac || field.description ? `setting-${field.key}-description` : undefined} checked={value === true} onCheckedChange={onChange} />
      </Field>
    );
  }
  const Control = field.type === "textarea" ? Textarea : Input;
  return (
    <Field htmlFor={`setting-${field.key}`} className={field.type === "textarea" ? "md:col-span-2" : ""}>
      <FieldLabel>{field.label}</FieldLabel>
      <Control id={`setting-${field.key}`} placeholder={field.placeholder} type={field.type === "password" ? "password" : field.type} value={value} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)} />
      {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
    </Field>
  );
}

const usefulLinks = [
  {
    title: "Playbook",
    description: "Projekt, Installation, Entwicklung und Betrieb der CS2-Plattform.",
    href: "https://github.com/realS3BI/playbook",
    category: "Projekt"
  },
  {
    title: "Playbook-Dokumentation",
    description: "Training, Lineups, Reviews und die Einbindung des MatchZy-Modus.",
    href: "https://github.com/realS3BI/playbook/blob/main/docs/README.md",
    category: "Dokumentation"
  },
  {
    title: "MatchZy-Dokumentation",
    description: "Konfiguration, Match-Befehle und API des MatchZy-Modus.",
    href: "https://shobhit-pathak.github.io/MatchZy/",
    category: "Spielmodus"
  },
  {
    title: "MatchZy auf GitHub",
    description: "Quellcode, Releases und Fehlerberichte des externen Match-Plugins.",
    href: "https://github.com/shobhit-pathak/MatchZy",
    category: "Spielmodus"
  },
  {
    title: "Fortnite Emotes & Dances",
    description: "Quellcode, Befehle und Releases des optionalen Emote-Plugins.",
    href: "https://github.com/Cruze03/FortniteEmotesNDances",
    category: "Plugin"
  },
  {
    title: "CounterStrikeSharp-Dokumentation",
    description: "Installation, Konfiguration und API des Server-Frameworks.",
    href: "https://docs.cssharp.dev/",
    category: "Framework"
  }
];

function Links() {
  return (
    <>
      <PageHeader
        eyebrow="Playbook"
        title="Dokumentation"
        description="Anleitungen für Playbook und Referenzen der eingebundenen Server-Komponenten."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {usefulLinks.map((link) => {
          const hostname = new URL(link.href).hostname;
          return (
            <a
              key={link.href}
              className="resource-link group"
              href={link.href}
              target="_blank"
              rel="noreferrer"
            >
              <span className="resource-link-icon"><ExternalLink aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="mb-2 flex flex-wrap items-center gap-2">
                  <strong className="text-sm font-semibold text-foreground">{link.title}</strong>
                  <Badge variant="outline">{link.category}</Badge>
                </span>
                <span className="block text-sm leading-relaxed text-muted-foreground">{link.description}</span>
                <span className="mt-3 block truncate font-mono text-[11px] text-muted-foreground">{hostname}</span>
              </span>
              <ChevronRight className="resource-link-arrow" aria-hidden="true" />
            </a>
          );
        })}
      </div>
    </>
  );
}

/** Match admins only see mode and plugins; maps and training stay with server admins. */
function GamePage({ settings, setSettings, policy, status, busy, serverAdmin }) {
  const mode = settings.serverMode || "matchzy";
  return (
    <>
      {serverAdmin && <PageSection id="maps" title="Maps"><ServerMapSettings settings={settings} setSettings={setSettings} status={status} busy={busy} /></PageSection>}
      <PageSection id="spielmodus" title="Spielmodus">
      <Card>
        <CardHeader><CardTitle>Modus für den nächsten Start</CardTitle><CardDescription>Ein Modus ist aktiv. Die Auswahl wird mit „Übernehmen & neu starten“ wirksam.</CardDescription></CardHeader>
        <CardContent>
          <RadioGroup
            className="lg:grid-cols-3"
            value={mode}
            onValueChange={(nextMode) => setSettings((current) => ({ ...current, serverMode: nextMode }))}
          >
            {(policy?.modes || []).map((item) => (
              <label key={item.id} className={cn("mode-choice", mode === item.id && "mode-choice-active")}>
                <span className="flex items-center justify-between"><strong>{item.name}</strong><RadioGroupItem value={item.id} aria-label={item.name} /></span>
                <span className="text-sm leading-relaxed text-muted-foreground">{item.description}</span>
              </label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
      {serverAdmin && <NadesMenuStatus selectedMode={mode} />}
      </PageSection>
      {serverAdmin && <PageSection id="training" title="Training"><SettingsGroups ids={["matchzy", "training-hud"]} settings={settings} setSettings={setSettings} policy={policy} /></PageSection>}
      <PageSection id="plugins" title="Plugins">
      <Card>
        <CardHeader><CardTitle>Zusätzliche Plugins</CardTitle><CardDescription>Grundkomponenten sind immer aktiv. Zusätzliche Plugins kannst du einzeln einschalten.</CardDescription></CardHeader>
        <CardContent className="divide-y divide-border">
          {(policy?.plugins || []).filter((plugin) => !["matchzy", "nades"].includes(plugin.id)).map((plugin) => {
            const enabled = plugin.locked || settings[plugin.settingKey] === true;
            return (
              <div key={plugin.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto] md:items-center">
                <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{plugin.name}</h3>{plugin.locked ? <Badge variant="outline">Grundkomponente</Badge> : null}{enabled ? <Badge variant="success">Aktiv</Badge> : <Badge variant="outline">Aus</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{plugin.detail}</p><p className="mt-2 text-xs text-muted-foreground">Benötigt: {plugin.dependencies.length ? plugin.dependencies.join(" · ") : "Keine"}</p>{plugin.url ? <a className="plugin-reference-link" href={plugin.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Projekt &amp; Dokumentation</a> : null}{plugin.warning && enabled ? <Alert className="mt-3" variant="warning"><AlertDescription>{plugin.warning}</AlertDescription></Alert> : null}</div>
                {plugin.locked ? <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Erforderlich</span> : <Switch aria-label={`${plugin.name} aktivieren`} checked={enabled} onCheckedChange={(next) => setSettings((current) => ({ ...current, [plugin.settingKey]: next }))} />}
              </div>
            );
          })}
        </CardContent>
      </Card>
      </PageSection>
    </>
  );
}

function Maintenance({ settings, setSettings, status, onRestart, busy }) {
  const enabled = settings.automaticRestartEnabled === true;
  const [restartOpen, setRestartOpen] = useState(false);
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader><CardTitle>Automatischer Serverneustart</CardTitle><CardDescription>Nach einem automatischen Neustart wartet das Panel zwei Stunden. Sind noch Spieler verbunden, versucht es den Neustart eine Stunde später erneut.</CardDescription></CardHeader>
          <CardContent className="grid gap-5">
            <Field className="flex grid-cols-[1fr_auto] items-center rounded-lg border border-border bg-muted/30 p-4"><span><FieldLabel>Automatischer Neustart</FieldLabel><FieldDescription className="mt-1 block">Nur bei leerem Server. Bots zählen nicht als Spieler.</FieldDescription></span><Switch aria-label="Automatischer Neustart" checked={enabled} onCheckedChange={(next) => setSettings((current) => ({ ...current, automaticRestartEnabled: next }))} /></Field>
            <Alert><AlertTitle>Spielerprüfung vor jedem Neustart</AlertTitle><AlertDescription>Kann die Spielerzahl nicht geprüft werden, wartet das Panel ebenfalls eine Stunde. Der nächste Versuch bleibt auch nach einem Panel-Neustart gespeichert.</AlertDescription></Alert>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Zeitplan</CardTitle><CardDescription>Aktueller Stand des automatischen Neustarts.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div className="rounded-lg border border-border bg-muted/30 p-4"><span className="text-muted-foreground">Nächster Versuch</span><p className="mt-1 font-semibold">{formatDate(status?.maintenance?.nextRunAt)}</p></div>
            <div className="rounded-lg border border-border bg-muted/30 p-4"><span className="text-muted-foreground">Letzter Versuch</span><p className="mt-1 font-semibold">{formatDate(status?.maintenance?.lastRun?.lastRunAt)}</p></div>
            {status?.maintenance?.lastRun?.lastMessage && <p className="text-muted-foreground">{status.maintenance.lastRun.lastMessage}</p>}
            <Button variant="destructive" onClick={() => setRestartOpen(true)} disabled={busy}><RotateCcw data-icon="inline-start" /> Jetzt neu starten</Button>
          </CardContent>
        </Card>
      </div>
      <Dialog open={restartOpen} onOpenChange={setRestartOpen}><DialogContent><DialogHeader><DialogTitle>CS2-Server jetzt neu starten?</DialogTitle><DialogDescription>Verbundene Spieler werden getrennt. Ungespeicherte Änderungen werden dabei nicht übernommen.</DialogDescription></DialogHeader><DialogFooter><Button variant="secondary" onClick={() => setRestartOpen(false)}>Abbrechen</Button><ActionButton variant="destructive" onClick={async () => { await onRestart(); setRestartOpen(false); }} disabled={busy} icon={RotateCcw} pendingLabel="Server startet neu …" successLabel="Neu gestartet">Server neu starten</ActionButton></DialogFooter></DialogContent></Dialog>
    </>
  );
}

function Operations({ settings, setSettings, policy, status, busy, onRestart }) {
  return <>
    <PageSection id="diagnose" title="Diagnose"><div><Diagnostics active onOpenLogs={() => document.getElementById("logs")?.scrollIntoView({ block: "start" })} /></div></PageSection>
    <PageSection id="wartung" title="Wartung"><Maintenance settings={settings} setSettings={setSettings} status={status} busy={busy} onRestart={onRestart} /></PageSection>
    <PageSection id="logs" title="Logs"><div><DockerLogs active /></div></PageSection>
    <PageSection id="komponenten" title="Komponenten"><SettingsGroups ids={["versions"]} settings={settings} setSettings={setSettings} policy={policy} /></PageSection>
  </>;
}

function LineupImageUpload({ onUploaded, onError, label = "Upload lineup images", multiple = true }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function upload(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    onError("");
    try {
      for (const file of files) {
        const image = await api("/api/uploads/lineup-image", {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            "X-File-Name": encodeURIComponent(file.name)
          },
          body: file
        });
        onUploaded(image);
      }
    } catch (error) {
      onError(error.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple={multiple}
        onChange={upload}
      />
      <Button type="button" variant="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
        <UploadCloud data-icon="inline-start" />
        {uploading ? "Uploading..." : label}
      </Button>
      <span className="text-xs text-muted-foreground">JPEG, PNG, WebP or GIF · 4 MB each</span>
    </div>
  );
}

function WorkshopMapDialog({ open, onOpenChange, onAdd }) {
  const [draft, setDraft] = useState({ title: "", mapName: "", workshopId: "", radarUrl: "" });
  const [dialogError, setDialogError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft({ title: "", mapName: "", workshopId: "", radarUrl: "" });
    setDialogError("");
    setSubmitting(false);
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    setDialogError("");
    setSubmitting(true);
    try {
      let radarSize = {};
      if (draft.radarUrl) {
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error("Radar image could not be loaded."));
          image.src = draft.radarUrl;
        });
        radarSize = { radarWidth: dimensions.width, radarHeight: dimensions.height };
      }
      onAdd({ ...draft, ...radarSize });
      onOpenChange(false);
    } catch (error) {
      setDialogError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  function useRadarUpload(image) {
    const serverData = image.serverData || {};
    const url = String(serverData.url || image.url || "");
    if (url) setDraft((current) => ({ ...current, radarUrl: url }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Workshop map</DialogTitle>
          <DialogDescription>Store the Workshop addon, its internal map name and an optional radar for route placement.</DialogDescription>
        </DialogHeader>
        {dialogError ? <Message error={dialogError} /> : null}
        <form className="grid gap-5" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel>Display name</FieldLabel>
              <Input value={draft.title} placeholder="Recoil Master" onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Game map name</FieldLabel>
              <Input value={draft.mapName} placeholder="recoil_master" onChange={(event) => setDraft((current) => ({ ...current, mapName: event.target.value }))} />
              <FieldDescription>The BSP name used with changelevel and inside savednades.json.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Workshop ID or item URL</FieldLabel>
              <Input value={draft.workshopId} placeholder="3070244462" onChange={(event) => setDraft((current) => ({ ...current, workshopId: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Radar image URL</FieldLabel>
              <Input value={draft.radarUrl} placeholder="Optional https://…/radar.webp" onChange={(event) => setDraft((current) => ({ ...current, radarUrl: event.target.value }))} />
              <FieldDescription>The complete radar frame becomes this map's placement boundary.</FieldDescription>
            </Field>
            <LineupImageUpload label="Upload radar image" multiple={false} onUploaded={useRadarUpload} onError={setDialogError} />
            {draft.radarUrl ? <img className="max-h-56 w-full rounded-lg border border-border bg-sidebar object-contain" src={draft.radarUrl} alt="Workshop radar preview" /> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={submitting}><PackagePlus data-icon="inline-start" />{submitting ? "Adding…" : "Add map"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ServerMapSettings({ settings, setSettings, status, busy }) {
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const maps = mapsForInventory(settings, status?.mapInventory);
  const workshops = workshopMapsFromSettings(settings);
  return <Card>
    <CardHeader><CardTitle>Maps auf dem Server</CardTitle><CardDescription>Lege die Startmap fest und verwalte installierte Workshop-Maps. Übernimm die Änderungen anschließend mit einem Serverneustart.</CardDescription></CardHeader>
    <CardContent>
      <FieldGroup>
        <Field htmlFor="server-start-map"><FieldLabel>Startmap</FieldLabel><Select value={settings.startMap || "__none__"} onValueChange={startMap => setSettings(current => ({ ...current, startMap }))}>
          <SelectTrigger id="server-start-map"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
            {!settings.startMap && <SelectItem value="__none__" disabled>Map auswählen</SelectItem>}
            {settings.startMap && !maps.some(map => map.mapName === settings.startMap) && <SelectItem value={settings.startMap}>{settings.startMap}</SelectItem>}
            {maps.filter(map => map.mapName).map(map => <SelectItem key={map.key} value={map.mapName} disabled={map.available !== true}>{map.name}{map.available !== true ? " · Verfügbarkeit nicht bestätigt" : ""}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select></Field>
        <Field className="flex items-center justify-between"><span><FieldLabel>Workshop-Maps laden</FieldLabel><FieldDescription>Aktivierte Workshop-Maps werden beim Serverstart heruntergeladen und eingebunden.</FieldDescription></span><Switch aria-label="Workshop-Maps laden" checked={settings.workshopMapsEnabled === true} onCheckedChange={workshopMapsEnabled => setSettings(current => ({ ...current, workshopMapsEnabled }))} /></Field>
      </FieldGroup>
      <details className="disclosure-panel mt-5">
        <summary>Erweiterte Map-Einstellungen</summary>
        <FieldGroup className="p-4">
          <Field htmlFor="manual-start-map"><FieldLabel>Interner Name der Startmap</FieldLabel><Input id="manual-start-map" value={settings.startMap || ""} onChange={event => setSettings(current => ({ ...current, startMap: event.target.value }))} /><FieldDescription>Für Maps, die noch nicht im Serverbestand erscheinen.</FieldDescription></Field>
          <Field htmlFor="workshop-ids"><FieldLabel>Workshop-IDs oder Links</FieldLabel><Textarea id="workshop-ids" value={settings.workshopMaps || ""} onChange={event => setSettings(current => ({ ...current, workshopMaps: event.target.value }))} /></Field>
          <Field><FieldLabel>Downloads bei jedem Map-Wechsel prüfen</FieldLabel><Switch aria-label="Downloads bei jedem Map-Wechsel prüfen" checked={settings.workshopForceDownload === true} onCheckedChange={workshopForceDownload => setSettings(current => ({ ...current, workshopForceDownload }))} /></Field>
        </FieldGroup>
      </details>
      <div className="mt-5 flex flex-col gap-2">{workshops.map(map => <div key={map.key} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="text-sm font-medium">{map.name}</p><p className="font-mono text-xs text-muted-foreground">{map.mapName || map.workshopId}</p></div><Button variant="secondary" size="icon" aria-label={`${map.name} entfernen`} disabled={busy} onClick={() => setSettings(current => ({ ...current, ...removeWorkshopMap(current, map.workshopId) }))}><Trash2 /></Button></div>)}</div>
    </CardContent>
    <CardFooter><Button variant="secondary" disabled={busy} onClick={() => setWorkshopOpen(true)}><PackagePlus data-icon="inline-start" />Workshop-Map hinzufügen</Button></CardFooter>
    <WorkshopMapDialog open={workshopOpen} onOpenChange={setWorkshopOpen} onAdd={input => setSettings(current => ({ ...current, ...addWorkshopMap(current, input), workshopMapsEnabled: true }))} />
  </Card>;
}

function DockerLogs({ active }) {
  const [logs, setLogs] = useState("");
  const [tail, setTail] = useState(300);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [logError, setLogError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const logRef = useRef(null);
  const logVersion = useRef(0);

  const loadLogs = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setLogError("");
    try {
      const version = logVersion.current;
      const result = await api(`/api/server/logs?tail=${tail}`);
      if (version !== logVersion.current) return;
      setLogs(result.logs || "");
      setUpdatedAt(new Date().toLocaleTimeString());
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
    } catch (error) {
      setLogError(error.message);
    } finally {
      setLoading(false);
    }
  }, [active, tail]);

  useEffect(() => {
    if (!active) return undefined;
    loadLogs();

  }, [active, loadLogs]);
  useLiveResource(active && autoRefresh ? `/api/server/logs?tail=${tail}` : null, result => {
    logVersion.current++;
    setLogs(result.logs || ""); setLogError(""); setUpdatedAt(new Date().toLocaleTimeString());
    requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; });
  }, error => { setLogError(error.message); if ([401, 403].includes(error.status)) setLogs(""); });

  return (
    <>
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 sm:p-3">
          <Button variant="secondary" onClick={loadLogs} disabled={loading}>
            <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
            Refresh
          </Button>
          <Button variant={autoRefresh ? "default" : "secondary"} onClick={() => setAutoRefresh((current) => !current)}>
            {autoRefresh ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {autoRefresh ? "Live-Updates an" : "Live-Updates pausiert"}
          </Button>
          <Field className="ml-auto flex grid-cols-[auto_100px] items-center gap-2">
            <FieldLabel className="text-muted-foreground">Zeilen</FieldLabel>
            <Select value={String(tail)} onValueChange={(value) => setTail(Number(value))}>
              <SelectTrigger className="w-28" aria-label="Anzahl der Log-Zeilen"><SelectValue /></SelectTrigger>
              <SelectContent>{[100, 300, 800, 1500].map((count) => <SelectItem key={count} value={String(count)}>{count}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <span className="text-xs text-muted-foreground">{updatedAt ? `Aktualisiert um ${updatedAt}` : ""}</span>
        </CardContent>
      </Card>
      {logError ? <Message error={logError} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>CS2-Container</CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            ref={logRef}
            className="log-console h-[62vh] overflow-auto whitespace-pre-wrap rounded-lg border border-sidebar-border p-4 font-mono text-xs leading-relaxed"
          >
            {logs || (loading ? "Logs werden geladen …" : "Noch keine Logs vorhanden.")}
          </pre>
        </CardContent>
      </Card>
    </>
  );
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(null);
  const [user, setUser] = useState(null);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [settings, setSettings] = useState<any>({});
  const [nades, setNades] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [status, setStatus] = useState(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [operation, setOperation] = useState<ServerOperation>(null);
  const [savedSignature, setSavedSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const controlVersion = useRef(0);
  const latestControl = useRef<any>(null);
  const controlAccess = useRef("");
  const dirty = savedSignature !== "" && savedSignature !== JSON.stringify({ settings });

  async function loadAll({ preserveSettings = false } = {}) {
    const version = controlVersion.current;
    const response = await api("/api/control");
    const control = version !== controlVersion.current ? latestControl.current : response;
    controlAccess.current = JSON.stringify(control.user.access);
    setUser(control.user);
    if (!preserveSettings) setSettings(control.settings || {});
    setNades(control.nades || []);
    setPolicy(control.policy || null);
    setStatus(control.status || null);
    setStatusUnavailable(false);
    if (!preserveSettings) setSavedSignature(JSON.stringify({ settings: control.settings || {} }));
  }

  async function runAction(action, scope = "server", kind?: "apply" | "restart") {
    setBusy(true);
    if (kind) setOperation({ kind, phase: "requesting" });
    try {
      await action();
      if (kind) setOperation({ kind, phase: "refreshing" });
      await loadAll({ preserveSettings: scope === "library" && dirty });
    } finally {
      if (kind) setOperation(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    api("/api/auth/me").then(({ user }) => {
      setUser(user); setAuthenticated(true);
      void loadAll().catch(() => setStatusUnavailable(true));
    }).catch(() => setAuthenticated(false));
  }, []);

  useLiveResource(authenticated ? "/api/auth/me" : null, result => setUser(result.user), error => {
    if (error.status === 401) setAuthenticated(false);
  });
  useLiveResource(authenticated ? "/api/control" : null, control => {
    controlVersion.current++;
    latestControl.current = control;
    setNades(control.nades || []);
    const accessChanged = controlAccess.current !== JSON.stringify(control.user.access);
    controlAccess.current = JSON.stringify(control.user.access);
    setUser(control.user);
    if (!dirty || accessChanged) {
      setSettings(control.settings || {});
      setSavedSignature(JSON.stringify({ settings: control.settings || {} }));
    }
    setPolicy(control.policy || null);
    setStatus(current => accessChanged ? control.status || null : { ...current, ...control.status });
    setStatusUnavailable(false);
  }, error => { if (error.status === 401) setAuthenticated(false); });
  useLiveResource(authenticated && isServerAdmin(user) ? "/api/server/status" : null, next => {
    setStatus(current => ({ ...current, ...next })); setStatusUnavailable(false);
  }, () => setStatusUnavailable(true));

  const activeTab = tabs.find((item) => item.path === location.pathname.replace(/\/+$/, "")) || tabs.find(item => isWorkspaceRoute(location.pathname) && location.pathname.startsWith(item.path + "/")) || tabs.find(item => item.id === "maps");
  const libraryMaps = useMemo(() => mapsForLibrary(settings, status?.mapInventory, nades), [settings, status?.mapInventory, nades]);
  const mapRoute = matchPath("/maps/:mapSlug/*", location.pathname);
  const lineupRoute = matchPath("/maps/:mapSlug/lineups/:lineupId/*", location.pathname);
  const selectedMap = libraryMaps.find(map => mapSlug(map) === mapRoute?.params.mapSlug);
  const selectedNade = findLineup(nades, lineupRoute?.params.lineupId);
  const reviewing = location.pathname.endsWith("/review");

  useEffect(() => {
    document.title = authenticated === false
      ? "Anmelden | Playbook"
      : `${reviewing ? "Review · " : ""}${location.pathname.startsWith("/strats/live") ? "Live" : selectedNade?.displayName || selectedNade?.name || selectedMap?.name || activeTab.label} | Playbook`;
  }, [activeTab.label, authenticated, selectedMap?.name, selectedNade, reviewing, location.pathname]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  function refreshLibrary() {
    return runAction(async () => {}, "library");
  }

  function applyControl() {
    return runAction(() => api("/api/control/apply", { method: "POST", body: JSON.stringify({ settings }) }), "server", "apply");
  }

  useEffect(() => {
    function warnBeforeLeave(event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);

  if (authenticated === null) {
    return (
      <main className="grid min-h-screen place-items-center" aria-label="Playbook wird geladen">
        <Spinner className="size-6" />
      </main>
    );
  }

  if (location.pathname === "/login/test") return <TestLogin />;

  if (!authenticated) {
    if (location.pathname !== routePaths.login) {
      const requestedRoute = (isWorkspaceRoute(location.pathname) || isMapRoute(location.pathname) || isLegacyServerPath(location.pathname) || tabs.some((item) => item.path === location.pathname)) ? `${location.pathname}${location.search}` : defaultRoute;
      return <Navigate to={`${routePaths.login}?redirect=${encodeURIComponent(requestedRoute)}`} replace />;
    }

    return <Login />;
  }

  const roleHome = defaultRoute;
  if (location.pathname !== "/" && location.pathname !== routePaths.login && !isMapRoute(location.pathname) && !isWorkspaceRoute(location.pathname) && location.pathname !== "/access" && !isLegacyServerPath(location.pathname) && !allowedTabs(user).some(tab => tab.path === location.pathname))
    return <Navigate to={roleHome} replace />;


  return (
    <Shell
      user={user}
      tab={activeTab.id}
      selectedMap={selectedMap}
      selectedNade={selectedNade}
      reviewing={reviewing}
      dirty={dirty}
      busy={busy}
      operation={operation}
      status={status}
      statusUnavailable={statusUnavailable}
      onSave={() => runAction(async () => {
        await api("/api/control", { method: "PUT", body: JSON.stringify({ settings }) });
      })}
      onApply={applyControl}
      onLogout={async () => {
        await api("/api/auth/logout", { method: "POST" });
        setAuthenticated(false);
        navigate(routePaths.login, { replace: true });
      }}
    >
      <Routes>
        <Route path="/analysis" element={<AnalysisPage user={user} maps={libraryMaps} />} />
        <Route path="/analysis/live" element={<LiveSessionsPage user={user} maps={libraryMaps} />} />
        <Route path="/analysis/live/:sessionId" element={<LiveSessionPage user={user} maps={libraryMaps} />} />
        <Route path="/analysis/imports" element={<MatchImportsPage user={user} maps={libraryMaps} />} />
        <Route path="/analysis/prematch" element={<PrematchesPage user={user} maps={libraryMaps} />} />
        <Route path="/analysis/prematch/:preparationId" element={<PrematchPage user={user} maps={libraryMaps} />} />
        <Route path="/analysis/demos/:demoId" element={<DemoPage user={user} maps={libraryMaps} />} />
        <Route path="/analysis/reviews/:reviewId" element={<ReviewPage user={user} maps={libraryMaps} />} />
        <Route path="/teams" element={<TeamsPage user={user} />} />
        <Route path="/teams/join/:token" element={<JoinTeamPage />} />
        <Route path="/teams/:teamId" element={<TeamPage user={user} />} />
        <Route path="/strats" element={<StratsPage user={user} nades={nades} maps={libraryMaps} />} />
        <Route path="/strats/new" element={<StratEditor user={user} nades={nades} maps={libraryMaps} />} />
        <Route path="/strats/:stratId/edit" element={<StratEditor user={user} nades={nades} maps={libraryMaps} />} />
        <Route path="/strats/control" element={<LiveStratSettingsPage user={user} nades={nades} maps={libraryMaps} />} />
        <Route path="/strats/control/:teamId" element={<LiveStratSettingsPage user={user} nades={nades} maps={libraryMaps} />} />
        <Route path="/strats/live" element={<LiveStratsPage user={user} nades={nades} maps={libraryMaps} />} />
        <Route path="/strats/live/:teamId" element={<LiveStratsPage user={user} nades={nades} maps={libraryMaps} />} />
        <Route path="/strats/:stratId" element={<StratPage user={user} nades={nades} maps={libraryMaps} />} />
        <Route path="/admin/roles" element={<RolesPage />} />
        <Route path="/admin/map-scenes" element={<MapScenesPage />} />
        <Route path="/access" element={<Navigate to="/admin/users" replace />} />
        <Route path="/" element={<Navigate to={roleHome} replace />} />
        <Route
          path={routePaths.overview}
          element={(
            <Overview
              settings={settings}
              setSettings={setSettings}
              status={status}
              policy={policy}
              busy={busy}
              serverAdmin={isServerAdmin(user)}
              onAddWorkshop={() => setWorkshopOpen(true)}
            />
          )}
        />
        <Route path={routePaths.server} element={<ServerSettings settings={settings} setSettings={setSettings} policy={policy} />} />
        <Route path={routePaths.game} element={<GamePage settings={settings} setSettings={setSettings} policy={policy} status={status} busy={busy} serverAdmin={isServerAdmin(user)} />} />
        <Route path={routePaths.operations} element={<Operations settings={settings} setSettings={setSettings} policy={policy} status={status} busy={busy} onRestart={() => runAction(() => api("/api/server/restart", { method: "POST", body: "{}" }), "server", "restart")} />} />
        {Object.entries(legacyServerPaths).map(([from, to]) => <Route key={from} path={from} element={<Navigate to={to} replace />} />)}
        <Route path={routePaths.reviews} element={<ReviewQueuePage maps={libraryMaps} nades={nades} user={user} onRefresh={refreshLibrary} onEntriesChange={setNades} />} />
        <Route
          path={routePaths.access}
          element={<UserManagement currentSteamId={user.identitySteam64} />}
        />
        <Route path={routePaths.maps} element={new URLSearchParams(location.search).has("map") || new URLSearchParams(location.search).get("view") === "library"
          ? <LegacyLibraryRedirect maps={libraryMaps} />
          : <MapAtlas maps={libraryMaps} />} />
        <Route path="/maps/:mapSlug" element={<NadeLibrary nades={nades} maps={libraryMaps} user={user} />} />
        <Route path="/maps/:mapSlug/lineups/new" element={<NewLineupPage maps={libraryMaps} nades={nades} user={user} onEntriesChange={setNades} onRefresh={refreshLibrary} />} />
        <Route path="/maps/:mapSlug/lineups/:lineupId" element={<LineupPage maps={libraryMaps} nades={nades} user={user} onEntriesChange={setNades} onRefresh={refreshLibrary} />} />
        <Route path="/maps/:mapSlug/lineups/:lineupId/review" element={<LineupReviewPage maps={libraryMaps} nades={nades} user={user} onEntriesChange={setNades} />} />
        <Route path={routePaths.nades} element={<LegacyLibraryRedirect maps={libraryMaps} />} />
        <Route path={routePaths.console} element={<RconChat />} />
        <Route path={routePaths.links} element={<Links />} />
        <Route path={routePaths.login} element={<Navigate to={routeFromLoginSearch(location.search)} replace />} />
        <Route path="*" element={<Navigate to={roleHome} replace />} />
      </Routes>
      <WorkshopMapDialog open={workshopOpen} onOpenChange={setWorkshopOpen} onAdd={input => { const patch = addWorkshopMap(settings, input); setSettings(current => ({ ...current, ...patch, workshopMapsEnabled: true })); }} />
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(
  <RouterProvider router={createBrowserRouter([{ path: "*", element: <App /> }])} />
);
