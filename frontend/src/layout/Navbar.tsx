import { NavLink, useNavigate } from "react-router-dom";
import {
  Mic2, Library, FolderKanban, Settings as SettingsIcon, AudioWaveform,
  HelpCircle, User, ChevronRight, Youtube, Languages, Captions, FileText,
  Sparkles
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { logout } from "@/lib/backend";

const mainLinks = [
  { to: "/", label: "Studio", icon: AudioWaveform },
  { to: "/my-voices", label: "My Voices", icon: Library },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const soonLinks = [
  { label: "Voice Changer", icon: Mic2 },
  { label: "Dubbing", icon: Languages },
  { label: "Transcripts", icon: FileText },
  { label: "Subtitles", icon: Captions },
  { label: "YouTube", icon: Youtube },
];

const Sidebar = () => {
  const navigate = useNavigate();
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-white/10 bg-[#0d0f14] p-4">
        <div className="flex items-center gap-2.5 px-2 pb-6 pt-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
            <AudioWaveform className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-white">DreamVoice</p>
            <p className="text-[11px] text-zinc-500">by DreamAgent</p>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex flex-col gap-1">
          {mainLinks.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm transition-all duration-200 ${
                  isActive
                    ? "bg-indigo-500/15 text-indigo-300 font-medium"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`
              }
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </span>
            </NavLink>
          ))}
        </nav>

        <p className="mt-6 px-3 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
          Coming soon
        </p>
        <div className="mt-2 flex flex-col gap-1">
          {soonLinks.map(({ label, icon: Icon }) => (
            <div
              key={label}
              className="flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm text-zinc-600"
              title="Available in a future release"
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-zinc-400">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Usage
              </span>
              <span className="text-zinc-500">34%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[34%] rounded-full bg-gradient-to-r from-indigo-500 to-purple-500" />
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-600">3,400 / 10,000 credits</p>
          </div>
          <button className="flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200">
            <span className="flex items-center gap-3">
              <HelpCircle className="h-4 w-4" aria-hidden="true" /> Help
            </span>
          </button>
          <button
            data-testid="navbar-logout-button"
            aria-label="Log out"
            onClick={() => { logout(); navigate("/login"); }}
            className="flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
          >
            <span className="flex items-center gap-3">
              <User className="h-4 w-4" aria-hidden="true" /> Log out
            </span>
            <ChevronRight className="ml-auto h-4 w-4 text-zinc-600" aria-hidden="true" />
          </button>
        </div>
      </aside>

      {/* Mobile bottom tabs */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-white/10 bg-[#0d0f14]/95 backdrop-blur-xl md:hidden"
      >
        {mainLinks.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors ${
                isActive ? "text-indigo-400" : "text-zinc-500"
              }`
            }
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  );
};

export default Sidebar;
