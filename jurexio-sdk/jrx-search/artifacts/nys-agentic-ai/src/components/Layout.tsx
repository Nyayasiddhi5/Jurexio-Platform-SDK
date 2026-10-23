import { Link, useLocation } from "wouter";
import {
  BookOpen, LayoutDashboard, PlayCircle, History, Gavel, ShieldCheck, Globe,
  MessageSquare, ArrowLeftRight, FileStack, TerminalSquare, Archive, Search,
  FileSearch, FolderSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { JURISDICTIONS, useJurisdiction, type Jurisdiction } from "@/lib/jurisdiction";
import { BRAND, BRAND_LOGO } from "@/lib/brand";

function JurisdictionPicker() {
  const { jurisdiction, setJurisdiction } = useJurisdiction();
  return (
    <div className="px-4 pb-4">
      <div className="flex items-center gap-2 mb-1.5 text-xs uppercase tracking-wider text-sidebar-foreground/60">
        <Globe className="w-3.5 h-3.5" /> Jurisdiction
      </div>
      <Select
        value={jurisdiction}
        onValueChange={(v) => setJurisdiction(v as Jurisdiction)}
      >
        <SelectTrigger className="h-9 bg-sidebar-accent/40 border-sidebar-border text-sidebar-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {JURISDICTIONS.map((j) => (
            <SelectItem key={j.code} value={j.code}>
              <span className="flex items-center gap-2">
                <span>{j.flag}</span>
                <span>{j.label}</span>
                {!j.live && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    Coming soon
                  </Badge>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/statutes", label: "Instant · Statutes", icon: Search },
    { href: "/caselaw", label: "Instant · Caselaw", icon: Gavel },
    { href: "/case-lookup", label: "Case Lookup", icon: FolderSearch },
    { href: "/chat", label: "Legal Chat", icon: MessageSquare },
    { href: "/patra-mitra", label: "Patra Mitra", icon: FileSearch },
    { href: "/library", label: "Task Library", icon: BookOpen },
    { href: "/run/new", label: "New Run", icon: PlayCircle },
    { href: "/runs", label: "Run History", icon: History },
    { href: "/archive", label: "Archive Search", icon: Archive },
    { href: "/citations", label: "Citation Check", icon: ShieldCheck },
    { href: "/statutes/compare", label: "Old → New Codes", icon: ArrowLeftRight },
    { href: "/templates", label: "Templates", icon: FileStack },
    { href: "/api-tester", label: "API Tester", icon: TerminalSquare },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-64 flex-shrink-0 flex flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="h-16 flex items-center px-5 border-b border-sidebar-border gap-3">
          <img
            src={BRAND_LOGO.icon}
            alt="Nyayasiddhi"
            className="w-8 h-8 rounded-md object-contain bg-white/5"
            width={32}
            height={32}
          />
          <div className="min-w-0 leading-tight">
            <div className="font-serif font-semibold text-sm tracking-wide text-sidebar-primary-foreground truncate">
              {BRAND_LOGO.productName}
            </div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: BRAND.accent }}>
              {BRAND_LOGO.tagline}
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            // Prefer longest-prefix match so /statutes/compare does not also light Instant · Statutes.
            const longerMatch = navItems.some(
              (other) =>
                other.href !== item.href &&
                other.href.startsWith(item.href + "/") &&
                (location === other.href || location.startsWith(other.href + "/")),
            );
            const active =
              !longerMatch &&
              (location === item.href || (item.href !== "/" && (location === item.href || location.startsWith(item.href + "/"))));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
                style={active ? { boxShadow: `inset 0 0 0 1px ${BRAND.accent}66` } : undefined}
              >
                <item.icon
                  className="w-4 h-4"
                  style={{ color: active ? BRAND.accent : undefined }}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <JurisdictionPicker />
        <div className="p-4 border-t border-sidebar-border text-xs text-sidebar-foreground/50 space-y-1">
          <div>Nyayasiddhi Knowledge Plane</div>
          <div className="text-[10px] text-sidebar-foreground/40">
            Partner Instant Search via NYV SDK 5.0.7 · Legal Feed + web search on NYV Console · counsel corpus 1950–2026
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-muted/20">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
