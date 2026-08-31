import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  AudioWaveform, Mic2, Languages, FileText, Library, FolderKanban,
  HelpCircle, LogOut, ChevronDown, Menu, X, Settings as SettingsIcon,
  Sun, Moon, Monitor,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type Theme } from "@/hooks/use-theme";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getToken, logout } from "@/lib/backend";

const getUserEmail = (): string => {
  try {
    const token = getToken();
    if (!token) return "";
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload?.sub?.email || payload?.email || payload?.sub || "";
  } catch {
    return "";
  }
};

const mainLinks = [
  { to: "/", label: "Studio", icon: AudioWaveform },
  { to: "/my-voices", label: "My Voices", icon: Library },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/voice-changer", label: "Voice Changer", icon: Mic2 },
];

const soonLinks = [
  { label: "Dubbing", icon: Languages },
  { label: "Transcripts", icon: FileText },
];

const navLinkCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm transition-colors ${
    isActive
      ? "bg-muted/30 font-medium text-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`;

const AppHeader = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const email = getUserEmail();
  const initials =
    (email ? String(email) : "DV")
      .replace(/[^a-zA-Z@. ]/g, "")
      .split(/[@\s.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "DV";

  const doLogout = () => { setMobileOpen(false); logout(); navigate("/login"); };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-2 px-4 md:px-6">
        {/* Logo */}
        <NavLink to="/" className="mr-2 flex shrink-0 items-center gap-2" aria-label="DreamVoice home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <AudioWaveform className="h-5 w-5 text-background" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">DreamVoice</span>
        </NavLink>

        {/* Desktop nav */}
        <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
          {mainLinks.map((l) => (
            <NavLink key={l.to} to={l.to} className={navLinkCls} end={l.to === "/"}>
              {l.label}
            </NavLink>
          ))}
          {soonLinks.map((l) => (
            <span
              key={l.label}
              title="Available in a future release"
              aria-disabled="true"
              className="cursor-not-allowed rounded-md px-3 py-1.5 text-sm text-muted-foreground/80"
            >
              {l.label}
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 md:gap-3">
          {/* Usage / credits */}
          <button
            data-testid="navbar-usage-button"
            aria-label="Usage: 3,400 of 10,000 credits used"
            className="hidden items-center gap-2.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground sm:flex"
          >
            <span className="tabular-nums">3,400 / 10,000</span>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <span className="block h-full w-[34%] rounded-full bg-foreground/60" />
            </span>
            <span className="text-muted-foreground">credits</span>
          </button>

          {/* Help */}
          <button
            aria-label="Help"
            className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground md:flex"
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* Theme */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="navbar-theme-toggle"
                aria-label="Change theme"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Sun className="h-4 w-4 dark:hidden" aria-hidden="true" />
                <Moon className="hidden h-4 w-4 dark:block" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {([
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
                ["system", "System", Monitor],
              ] as [Theme, string, typeof Sun][]).map(([value, label, Icon]) => (
                <DropdownMenuItem
                  key={value}
                  data-testid={`navbar-theme-${value}`}
                  onClick={() => setTheme(value)}
                  className={theme === value ? "bg-accent text-accent-foreground" : ""}
                >
                  <Icon className="mr-2 h-4 w-4" aria-hidden="true" /> {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Account */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="navbar-avatar-menu-trigger"
                aria-label="Account menu"
                className="flex items-center gap-1.5 rounded-md p-1 pr-1.5 transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-muted text-[11px] font-semibold text-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-border bg-popover text-foreground">
              <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                {email || "Signed in"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-muted" />
              <DropdownMenuItem
                data-testid="navbar-account-item"
                onClick={() => navigate("/settings")}
                className="cursor-pointer"
              >
                <SettingsIcon className="mr-2 h-4 w-4" aria-hidden="true" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="navbar-help-item" className="cursor-pointer">
                <HelpCircle className="mr-2 h-4 w-4" aria-hidden="true" /> Help
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-muted" />
              <DropdownMenuItem
                data-testid="navbar-avatar-logout"
                onClick={doLogout}
                className="flex cursor-pointer items-center gap-2 text-red-600 dark:text-red-400 focus:bg-red-500/10 focus:text-red-700 dark:text-red-300"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile menu toggle */}
          <button
            data-testid="sidebar-toggle-button"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown nav */}
      {mobileOpen && (
        <nav
          aria-label="Mobile navigation"
          className="border-t border-border bg-background px-4 pb-4 pt-2 lg:hidden"
        >
          {mainLinks.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm ${
                  isActive ? "bg-muted/30 font-medium text-foreground" : "text-muted-foreground"
                }`
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </NavLink>
          ))}
          <div className="my-2 border-t border-border" />
          {soonLinks.map(({ label, icon: Icon }) => (
            <div
              key={label}
              title="Available in a future release"
              className="flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm text-muted-foreground/80"
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </div>
          ))}
          <div className="my-2 border-t border-border" />
          <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
            <span className="tabular-nums">3,400 / 10,000 credits</span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <span className="block h-full w-[34%] rounded-full bg-foreground/60" />
            </span>
          </div>
          <button
            data-testid="navbar-logout-button-mobile"
            aria-label="Log out"
            onClick={doLogout}
            className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-sm text-red-600 dark:text-red-400"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
          </button>
        </nav>
      )}
    </header>
  );
};

export default AppHeader;
