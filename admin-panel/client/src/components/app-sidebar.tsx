import { useResource } from "./workspace-ui";
import type { TeamView } from "../../../shared/strats";
import { SidebarLiveStatus } from "./sidebar-live-status";
import { isServerAdmin } from "../../../shared/authorization";
import { Link, useLocation } from "react-router-dom";
import {
  Crosshair,
  MapPinned,
  Server,
  UsersRound,
  BookOpen,
  Film,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { ACTIVE_DUTY_MAPS, mapPath } from "@/lib/maps";
import { NavMain, type SidebarSection } from "@/components/nav-main";
import { NavUser, type SidebarUser } from "@/components/nav-user";
import {
  SidebarServerStatus,
  type SidebarServerStatusProps,
} from "@/components/sidebar-server-status";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

// Adapted from shadcn sidebar-08: nested navigation and account menu.
export function AppSidebar({
  user,
  serverItems,
  adminItems,
  onNavigate,
  onLogout,
  dirty,
  status,
  operation,
  unavailable,
}: {
  user: SidebarUser;
  serverItems: { label: string; path: string; icon: LucideIcon }[];
  adminItems: { label: string; path: string; icon: LucideIcon }[];
  onNavigate: () => void;
  onLogout: () => void;
} & Pick<
  SidebarServerStatusProps,
  "dirty" | "status" | "operation" | "unavailable"
>) {
  const teams = useResource<{ entries: TeamView[] }>("/api/teams");
  const activeTeams = teams.data?.entries.filter((team) => team.live) || [];
  const location = useLocation();
  const { setOpenMobile } = useSidebar();
  const isLibrary = location.pathname === "/nades";
  const sections: SidebarSection[] = [
    {
      title: "Maps",
      url: "/maps",
      icon: MapPinned,
      isActive: isLibrary || location.pathname.startsWith("/maps"),
      defaultOpen: true,
      items: [
        ...ACTIVE_DUTY_MAPS.map((map) => ({
          title: map.name,
          url: mapPath(map),
          isActive:
            location.pathname === mapPath(map) ||
            location.pathname.startsWith(`${mapPath(map)}/`),
        })),
      ],
    },
  ];
  sections.push({
    title: "Strats",
    url: "/strats",
    icon: BookOpen,
    isActive: location.pathname.startsWith("/strats"),
    items: [
      {
        title: "Bibliothek",
        url: "/strats",
        isActive:
          location.pathname.startsWith("/strats") &&
          !location.pathname.startsWith("/strats/live") &&
          !location.pathname.startsWith("/strats/control"),
      },
      {
        title: "Live verwalten",
        url: "/strats/control",
        isActive: location.pathname.startsWith("/strats/control"),
      },
    ],
  });
  sections.push({
    title: "Teams",
    url: "/teams",
    icon: UsersRound,
    isActive: location.pathname.startsWith("/teams"),
    items: [
      {
        title: "Meine Teams",
        url: "/teams",
        isActive: location.pathname.startsWith("/teams"),
      },
    ],
  });
  sections.push({
    title: "Analyse",
    url: "/analysis",
    icon: Film,
    isActive: location.pathname.startsWith("/analysis"),
    items: [
      {
        title: "Demos",
        url: "/analysis",
        isActive:
          location.pathname.startsWith("/analysis/demos") ||
          (location.pathname === "/analysis" &&
            !location.search.includes("view=reviews")),
      },
      {
        title: "Team-Reviews",
        url: "/analysis?view=reviews",
        isActive:
          location.pathname.includes("/analysis/reviews") ||
          (location.pathname === "/analysis" &&
            location.search.includes("view=reviews")),
      },
      {
        title: "Live",
        url: "/analysis/live",
        isActive: location.pathname.startsWith("/analysis/live"),
      },
      {
        title: "Prematch",
        url: "/analysis/prematch",
        isActive: location.pathname.startsWith("/analysis/prematch"),
      },
      {
        title: "Matchimporte",
        url: "/analysis/imports",
        isActive: location.pathname.startsWith("/analysis/imports"),
      },
    ],
  });
  if (serverItems.length)
    sections.push({
      title: "Server",
      url: "/overview",
      icon: Server,
      isActive: serverItems.some((item) => location.pathname === item.path),
      // "Server" itself opens the overview, like "Maps" opens the atlas.
      items: serverItems.filter((item) => item.path !== "/overview").map((item) => ({
        title: item.label,
        url: item.path,
        icon: item.icon,
        isActive: location.pathname === item.path,
      })),
    });

  if (adminItems.length)
    sections.push({
      title: "Verwaltung",
      url:
        adminItems.find((item) => item.path === "/admin/users")?.path ||
        adminItems[0].path,
      icon: Shield,
      isActive: adminItems.some((item) => item.path === location.pathname),
      items: [...adminItems]
        .sort(
          (a, b) =>
            ["/admin/users", "/admin/roles", "/server/reviews", "/admin/map-scenes"].indexOf(a.path) -
            ["/admin/users", "/admin/roles", "/server/reviews", "/admin/map-scenes"].indexOf(b.path),
        )
        .map((item) => ({
          title: item.label,
          url: item.path,
          icon: item.icon,
          isActive: item.path === location.pathname,
        })),
    });

  function navigate() {
    setOpenMobile(false);
    onNavigate();
  }

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/maps" onClick={navigate} aria-label="Playbook">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Crosshair aria-hidden="true" />
                </div>
                <div className="grid flex-1 gap-0.5 text-left leading-tight">
                  <span className="truncate font-semibold">Playbook</span>
                  <span className="truncate text-xs">Training & Matches</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={sections} onNavigate={navigate} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location.pathname === "/links"}>
              <Link to="/links" onClick={navigate}>
                <BookOpen aria-hidden="true" />
                <span>Dokumentation</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {serverItems.length > 0 && (
          <SidebarServerStatus
            status={status}
            operation={operation}
            unavailable={unavailable}
            dirty={dirty}
            canMonitor={isServerAdmin(user)}
            onNavigate={navigate}
          />
        )}
        <SidebarLiveStatus
          teams={activeTeams}
          confirmed={!teams.error && teams.connection === "connected"}
          onNavigate={navigate}
        />
        <NavUser user={user} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
