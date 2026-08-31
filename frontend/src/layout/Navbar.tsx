import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  AudioWaveform, Mic2, Languages, FileText, Library, FolderKanban,
  HelpCircle, LogOut, ChevronDown, Menu, X, Settings as SettingsIcon,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
      ? "bg-white/[0.06] font-medium text-zinc-100"
      : "text-zinc-400 hover:text-zinc-100"
  }`;

const AppHeader = () => {
  const navigate = useNavigate();
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
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.08] bg-[#0b0c10]/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-2 px-4 md:px-6">
        {/* Logo */}
        <NavLink to="/" className="mr-2 flex shrink-0 items-center gap-2" aria-label="DreamVoice home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100">
            <AudioWaveform className="h-5 w-5 text-zinc-900" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-zinc-100">DreamVoice</span>
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
              className="cursor-not-allowed rounded-md px-3 py-1.5 text-sm text-zinc-600"
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
            className="hidden items-center gap-2.5 rounded-md border border-white/[0.08] px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200 sm:flex"
          >
            <span className="tabular-nums">3,400 / 10,000</span>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full w-[34%] rounded-full bg-zinc-300" />
            </span>
            <span className="text-zinc-500">credits</span>
          </button>

          {/* Help */}
          <button
            aria-label="Help"
            className="hidden h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 md:flex"
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* Account */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="navbar-avatar-menu-trigger"
                aria-label="Account menu"
                className="flex items-center gap-1.5 rounded-md p-1 pr-1.5 transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-zinc-700 text-[11px] font-semibold text-zinc-100">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-white/10 bg-[#14161d] text-zinc-200">
              <DropdownMenuLabel className="truncate text-xs font-normal text-zinc-500">
                {email || "Signed in"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/10" />
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
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem
                data-testid="navbar-avatar-logout"
                onClick={doLogout}
                className="flex cursor-pointer items-center gap-2 text-red-400 focus:bg-red-500/10 focus:text-red-300"
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
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 lg:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown nav */}
      {mobileOpen && (
        <nav
          aria-label="Mobile navigation"
          className="border-t border-white/[0.08] bg-[#0b0c10] px-4 pb-4 pt-2 lg:hidden"
        >
          {mainLinks.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm ${
                  isActive ? "bg-white/[0.06] font-medium text-zinc-100" : "text-zinc-400"
                }`
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </NavLink>
          ))}
          <div className="my-2 border-t border-white/[0.06]" />
          {soonLinks.map(({ label, icon: Icon }) => (
            <div
              key={label}
              title="Available in a future release"
              className="flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm text-zinc-600"
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </div>
          ))}
          <div className="my-2 border-t border-white/[0.06]" />
          <div className="flex items-center justify-between px-3 py-2 text-xs text-zinc-500">
            <span className="tabular-nums">3,400 / 10,000 credits</span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full w-[34%] rounded-full bg-zinc-300" />
            </span>
          </div>
          <button
            data-testid="navbar-logout-button-mobile"
            aria-label="Log out"
            onClick={doLogout}
            className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-sm text-red-400"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
          </button>
        </nav>
      )}
    </header>
  );
};

export default AppHeader;
