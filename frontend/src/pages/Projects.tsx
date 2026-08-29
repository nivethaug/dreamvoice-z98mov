import { useEffect, useState } from "react";
import {
  Loader2, Play, Mic2, Languages, Clock, FolderKanban,
  Copy, Trash2, MoreHorizontal, Search, CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

type Status = "Draft" | "Processing" | "Ready" | "Published";

interface Project {
  id: number;
  title: string;
  duration: string;
  voice: string;
  language: string;
  modified: string;
  status: Status;
  hue: number;
}

const initialProjects: Project[] = [
  { id: 1, title: "My YouTube Intro", duration: "01:12", voice: "Male Narrator", language: "English", modified: "2h ago", status: "Ready", hue: 248 },
  { id: 2, title: "AI Tutorial #12", duration: "08:45", voice: "Female Presenter", language: "English", modified: "5h ago", status: "Processing", hue: 190 },
  { id: 3, title: "Tamil → English Video", duration: "06:20", voice: "Tamil Presenter", language: "Tamil", modified: "Yesterday", status: "Ready", hue: 25 },
  { id: 4, title: "DreamAgent Demo", duration: "04:32", voice: "My Voice", language: "English", modified: "3d ago", status: "Draft", hue: 150 },
  { id: 5, title: "Product Launch Teaser", duration: "00:58", voice: "My Voice", language: "English", modified: "1w ago", status: "Published", hue: 300 },
  { id: 6, title: "Podcast Highlights", duration: "12:04", voice: "Male Narrator", language: "Hindi", modified: "1w ago", status: "Draft", hue: 90 },
];

const columns: Status[] = ["Draft", "Processing", "Ready", "Published"];

const colAccent: Record<Status, string> = {
  Draft: "text-zinc-400",
  Processing: "text-amber-400",
  Ready: "text-emerald-400",
  Published: "text-indigo-400",
};

const Projects = () => {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 550);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = projects.filter(p => p.title.toLowerCase().includes(query.toLowerCase()));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading projects…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      {toast && (
        <div role="status" aria-live="polite" className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/90 px-4 py-3 text-sm text-emerald-300 shadow-xl backdrop-blur">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {toast}
        </div>
      )}

      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">Projects</h1>
          <p className="mt-1 text-sm text-zinc-400">Track every voice project from draft to publish.</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="border-white/10 bg-white/[0.03] pl-9 text-zinc-100 placeholder:text-zinc-500"
          />
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map(col => {
          const items = filtered.filter(p => p.status === col);
          return (
            <section key={col} aria-label={`${col} column`} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className={`flex items-center gap-2 text-sm font-semibold ${colAccent[col]}`}>
                  {col}
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] tabular-nums text-zinc-400">{items.length}</span>
                </h2>
              </div>
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-xs text-zinc-600">
                  No projects
                </div>
              ) : (
                items.map(p => (
                  <Card key={p.id} className="group border-white/10 bg-white/[0.03] transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-xl hover:shadow-indigo-950/40">
                    <CardContent className="space-y-3 p-4">
                      <div className="relative h-24 overflow-hidden rounded-lg" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 55% 28%), hsl(${p.hue + 40} 50% 16%))` }}>
                        <span className="absolute inset-0 flex items-center justify-center">
                          {p.status === "Processing"
                            ? <Loader2 className="h-5 w-5 animate-spin text-white/80" aria-hidden="true" />
                            : <Play className="h-5 w-5 text-white/80 transition-transform group-hover:scale-110" aria-hidden="true" />}
                        </span>
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 text-[10px] tabular-nums text-white/90">{p.duration}</span>
                      </div>
                      <div>
                        <h3 className="truncate text-sm font-medium text-zinc-100">{p.title}</h3>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                          <span className="flex items-center gap-1"><Mic2 className="h-3 w-3" aria-hidden="true" />{p.voice}</span>
                          <span className="flex items-center gap-1"><Languages className="h-3 w-3" aria-hidden="true" />{p.language}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" />{p.modified}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-zinc-300">{p.status}</Badge>
                        <div className="flex items-center gap-1">
                          <Button variant="secondary" size="sm" className="h-7 bg-white/10 text-[11px] text-zinc-200 hover:bg-white/15">Open</Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" aria-label={`More actions for ${p.title}`} className="h-7 w-7 p-0 text-zinc-400 hover:bg-white/5 hover:text-zinc-200">
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="border-white/10 bg-[#12141a] text-zinc-200">
                              <DropdownMenuItem onSelect={() => {
                                setProjects(prev => [...prev, { ...p, id: Date.now(), title: `${p.title} (Copy)`, status: "Draft", modified: "Just now" }]);
                                setToast("Project duplicated");
                              }}>
                                <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => { setProjects(prev => prev.filter(x => x.id !== p.id)); setToast("Project deleted"); }} className="text-red-400 focus:text-red-300">
                                <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </section>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card className="border-dashed border-white/15 bg-white/[0.02]">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <FolderKanban className="h-10 w-10 text-zinc-600" aria-hidden="true" />
            <p className="font-medium text-zinc-300">No projects match your search</p>
            <p className="text-sm text-zinc-500">Try a different keyword or create a new project from the Studio.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Projects;
