import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2, Mic2, Languages, Clock, FolderKanban,
  Search, CheckCircle2, AlertTriangle, RefreshCw, Play, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listJobs, type JobSummary } from "@/lib/backend";

const COLUMNS = ["Processing", "Ready", "Failed"] as const;
type Column = (typeof COLUMNS)[number];

const columnOf = (state: string | null | undefined): Column => {
  switch (state) {
    case "completed": return "Ready";
    case "failed": case "cancelled": return "Failed";
    default: return "Processing";
  }
};

const fmtDur = (s: number | null | undefined) => {
  if (!s) return null;
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(+d) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const Projects = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof listJobs>>>([]);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setJobs(await listJobs());
    } catch (e: any) {
      setError(e?.message || "Could not load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return jobs;
    return jobs.filter(j =>
      (j.voice_name || "").toLowerCase().includes(q) ||
      (j.language || "").toLowerCase().includes(q) ||
      j.job_id.toLowerCase().includes(q));
  }, [jobs, query]);

  const byCol = useMemo(() => {
    const map: Record<Column, typeof jobs> = { Processing: [], Ready: [], Failed: [] };
    filtered.forEach(j => map[columnOf(j.state ?? j.status)].push(j));
    return map;
  }, [filtered]);

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
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8" data-testid="projects-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">Projects</h1>
          <p className="mt-1 text-sm text-zinc-400">Your voice conversion jobs ({jobs.length}).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load} data-testid="projects-refresh-button"
            className="gap-2 bg-white/10 text-zinc-200 hover:bg-white/15">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
          </Button>
          <Button onClick={() => navigate("/new-project")} data-testid="projects-new-button"
            className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
            New Project
          </Button>
        </div>
      </header>

      <div className="relative w-full max-w-sm" data-testid="projects-controls">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects..."
          aria-label="Search projects" data-testid="projects-search-input"
          className="border-white/10 bg-white/[0.03] pl-9 text-zinc-100 placeholder:text-zinc-500" />
      </div>

      {error ? (
        <Card className="border-red-500/25 bg-red-500/[0.05]" data-testid="projects-error">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-8 w-8 text-red-400" aria-hidden="true" />
            <p className="text-sm text-red-300">{error}</p>
            <Button onClick={load} variant="secondary" className="gap-2 bg-white/10 text-zinc-200 hover:bg-white/15">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
            </Button>
          </CardContent>
        </Card>
      ) : jobs.length === 0 ? (
        <Card className="border-dashed border-white/15 bg-white/[0.02]" data-testid="projects-empty">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <FolderKanban className="h-10 w-10 text-zinc-600" aria-hidden="true" />
            <p className="font-medium text-zinc-300">No projects yet</p>
            <p className="max-w-sm text-sm text-zinc-500">Start a voice conversion and it will appear here.</p>
            <Button onClick={() => navigate("/new-project")} className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
              New Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3" data-testid="projects-board">
          {COLUMNS.map(col => (
            <section key={col} aria-label={`${col} projects`} data-testid={`projects-column-${col.toLowerCase()}`}>
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{col}</h2>
                <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-zinc-400">{byCol[col].length}</Badge>
              </div>
              <div className="space-y-3">
                {byCol[col].length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-zinc-600">Nothing here</div>
                ) : byCol[col].map(j => (
                  <Card key={j.job_id} className="border-white/10 bg-white/[0.03] transition-all hover:border-indigo-500/40"
                    data-testid="projects-card">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
                          {j.is_video ? <Play className="h-4 w-4" aria-hidden="true" /> : <Mic2 className="h-4 w-4" aria-hidden="true" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-medium text-zinc-100">{j.voice_name || "Conversion"}</h3>
                          <p className="truncate font-mono text-[10px] text-zinc-500">{j.job_id.slice(0, 18)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                        {j.language && (
                          <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
                            <Languages className="h-3 w-3" aria-hidden="true" /> {j.language}
                          </span>
                        )}
                        {j.duration_seconds != null && (
                          <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
                            <Clock className="h-3 w-3" aria-hidden="true" /> {fmtDur(j.duration_seconds)}
                          </span>
                        )}
                        {fmtDate(j.created_at) && <span className="text-zinc-500">{fmtDate(j.created_at)}</span>}
                      </div>
                      {col === "Processing" && j.progress != null && (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${Math.max(4, j.progress)}%` }} />
                        </div>
                      )}
                      {col === "Failed" && j.error && (
                        <p className="line-clamp-2 text-[11px] text-red-300/80" data-testid="projects-card-error">{j.error}</p>
                      )}
                      {col === "Ready" && j.result?.audio_url && (
                        <Button asChild variant="secondary" size="sm" data-testid="projects-download"
                          className="h-7 gap-1.5 bg-white/10 text-[11px] text-zinc-200 hover:bg-white/15">
                          <a href={j.result.audio_url} target="_blank" rel="noreferrer" download>
                            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download result
                          </a>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default Projects;
