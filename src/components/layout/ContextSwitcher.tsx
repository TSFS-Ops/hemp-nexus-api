/**
 * ContextSwitcher, role-aware "Command Bridge" for jumping between workspaces.
 *
 * Renders a minimalist workspace picker at the top of every persona shell
 * (Desk, Governance, Developer, HQ). Authorisation is derived from the
 * authenticated user's roles, unauthorised modes are never rendered, so a
 * standard operator literally cannot see the HQ option in the menu.
 *
 * Visual language follows the Izenzo "Sovereign" aesthetic:
 *   • Slate / white surfaces, hairline borders, JetBrains Mono for the
 *     workspace label, Inter for the rest.
 *   • `tone="dark"` flips the palette for the Developer terminal shell.
 */
import { useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Briefcase, ShieldCheck, Terminal, Building2, ChevronsUpDown, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
type WorkspaceId = "desk" | "governance" | "hq" | "developer";
interface Workspace {
  id: WorkspaceId;
  label: string;
  caption: string;
  path: string;
  icon: typeof Briefcase;
  /** URL path prefixes that count as "active" for this workspace */
  matches: string[];
}
const ALL_WORKSPACES: Workspace[] = [{
  id: "desk",
  label: "Trade Desk",
  caption: "Operate live deals",
  path: "/desk",
  icon: Briefcase,
  matches: ["/desk"]
}, {
  id: "governance",
  label: "Governance Console",
  caption: "Triage & adjudicate",
  path: "/governance/triage",
  icon: ShieldCheck,
  matches: ["/governance"]
}, {
  id: "hq",
  label: "Platform HQ",
  caption: "Administer the platform",
  path: "/hq",
  icon: Building2,
  matches: ["/hq", "/admin"]
}, {
  id: "developer",
  label: "Developer Centre",
  caption: "Keys, webhooks, schema",
  path: "/developer/keys",
  icon: Terminal,
  matches: ["/developer"]
}];
interface ContextSwitcherProps {
  /** "light" for Desk/Governance white shells, "dark" for the Developer terminal. */
  tone?: "light" | "dark";
  className?: string;
}
export function ContextSwitcher({
  tone = "light",
  className = ""
}: ContextSwitcherProps) {
  const {
    isPlatformAdmin,
    isOrgAdmin,
    roles
  } = useAuth();
  const navigate = useNavigate();
  const {
    pathname
  } = useLocation();

  // Authorisation matrix, unauthorised entries are never rendered.
  const available = useMemo<Workspace[]>(() => {
    const isAuditor = roles.includes("auditor" as never);
    return ALL_WORKSPACES.filter(w => {
      switch (w.id) {
        case "desk":
          return true;
        // any authenticated user
        case "governance":
          return isPlatformAdmin || isAuditor || isOrgAdmin;
        case "hq":
          return isPlatformAdmin;
        case "developer":
          return isPlatformAdmin || isOrgAdmin;
        default:
          return false;
      }
    });
  }, [isPlatformAdmin, isOrgAdmin, roles]);
  const active = available.find(w => w.matches.some(m => pathname === m || pathname.startsWith(m + "/"))) ?? available[0];

  // Single workspace → no switcher (avoid noisy chrome for non-admin operators).
  if (!active || available.length < 2) {
    return null;
  }
  const ActiveIcon = active.icon;
  const isDark = tone === "dark";
  const triggerClasses = isDark ? "w-full flex items-center gap-2.5 px-3 py-2 rounded-sm border border-slate-800 bg-slate-950 hover:bg-slate-900 transition-colors text-left" : "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-border bg-card hover:bg-accent shadow-sm hover:shadow transition-all text-left group";
  const labelClasses = isDark ? "font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500" : "font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70";
  const valueClasses = isDark ? "text-[13px] text-slate-100 font-medium tracking-tight" : "text-[13px] text-foreground font-semibold tracking-tight";
  const chevronClasses = isDark ? "h-3.5 w-3.5 text-slate-500" : "h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors";
  const iconWrapClasses = isDark ? "h-7 w-7 rounded-sm bg-slate-900 border border-slate-800 flex items-center justify-center" : "h-7 w-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center";
  const iconClasses = isDark ? "h-3.5 w-3.5 text-emerald-400" : "h-3.5 w-3.5 text-primary";
  return <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={triggerClasses} aria-label="Switch workspace">
            <span className={iconWrapClasses}>
              <ActiveIcon className={iconClasses} strokeWidth={1.75} />
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block ${labelClasses}`}>Workspace</span>
              <span className={`block truncate ${valueClasses}`}>{active.label}</span>
            </span>
            <ChevronsUpDown className={chevronClasses} strokeWidth={1.5} />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" sideOffset={6} className="w-[260px] p-1.5 bg-white border border-slate-200 shadow-lg">
          <DropdownMenuLabel className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-400">
            Switch workspace
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-slate-100" />
          {available.map(w => {
          const Icon = w.icon;
          const isActive = w.id === active.id;
          return <DropdownMenuItem key={w.id} onSelect={() => {
            if (!isActive) navigate(w.path);
          }} className={["flex items-start gap-2.5 px-2 py-2 rounded-sm cursor-pointer", "focus:bg-slate-50 focus:text-slate-900", isActive ? "bg-slate-50" : ""].join(" ")}>
                <span className="h-7 w-7 rounded-md bg-white border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="h-3.5 w-3.5 text-slate-700" strokeWidth={1.75} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-slate-900 font-medium leading-tight">
                    {w.label}
                  </span>
                  <span className="block text-[11px] text-slate-500 mt-0.5 leading-tight">
                    {w.caption}
                  </span>
                </span>
                {isActive && <Check className="h-3.5 w-3.5 text-emerald-600 mt-1.5" strokeWidth={2} />}
              </DropdownMenuItem>;
        })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>;
}