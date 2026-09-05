import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2, Mic2, Clock, Search, AlertTriangle, RefreshCw, Play, Download,
  Film, ArrowUpRight, MoreHorizontal, ListChecks, CircleCheck, CloudUpload,
  ShieldCheck, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { deleteJob, listJobs, type JobSummary } from "@/lib/backend";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const COLUMNS = ["Processing", "Ready", "Failed"] as const;
type Column = (typeof COLUMNS)[number];

const columnOf = (state: string | null | undefined): Column => {
  switch (state) {
    case "completed": return "Ready";
    case "failed": case "cancelled": return "Failed";
    default: return "Processing";
  }
};

const columnTheme: Record<Column, { dot: string; emptyIcon: React.ElementType; emptyIconClass: string; emptyChip: string }> = {
  Processing: { dot: "bg-amber-400", emptyIcon: Clock, emptyIconClass: "text-amber-400", emptyChip: "bg-amber-500/10" },
  Ready: { dot: "bg-emerald-400", emptyIcon: Mic2, emptyIconClass: "text-emerald-400", emptyChip: "bg-emerald-500/10" },
  Failed: { dot: "bg-red-400", emptyIcon: AlertTriangle, emptyIconClass: "text-red-400", emptyChip: "bg-red-500/10" },
};

const columnEmpty: Record<Column, { title: string; body: string }> = {
  Processing: { title: "No active conversions", body: "Your in-progress conversions will appear here." },
  Ready: { title: "No completed projects yet", body: "Completed conversions will appear here." },
  Failed: { title: "No failures — all clear.", body: "Failed conversions will appear here." },
};

const statusBadge: Record<Column, string> = {
  Processing: "border-amber-500/25 bg-amber-500/[0.08] text-amber-300",
  Ready: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300",
  Failed: "border-red-500/25 bg-red-500/[0.08] text-red-700 dark:text-red-300",
};

const fmtDur = (s: number | null | undefined) => {
  if (!s) return null;
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(+d) ? null : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const FEATURES = [
  { icon: CircleCheck, title: "Real-time status", body: "See conversion status at a glance" },
  { icon: CloudUpload, title: "Quick access", body: "Download and open results instantly" },
  { icon: ShieldCheck, title: "Secure & private", body: "Your files are encrypted and protected" },
];

const Projects = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof listJobs>>>([]);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<JobSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteJob(pendingDelete.job_id);
      setPendingDelete(null);
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not delete project");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const byCol = useMemo(() => {
    const map: Record<Column, typeof jobs> = { Processing: [], Ready: [], Failed: [] };
    filtered.forEach(j => map[columnOf(j.state ?? j.status)].push(j));
    return map;
  }, [filtered]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading projects…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-8 p-5 md:p-10" data-testid="projects-page">
      {/* Page header */}
      <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight text-foreground">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobs.length === 0
              ? "Your voice conversions will appear here."
              : `${jobs.length} conversion${jobs.length === 1 ? "" : "s"} · track progress, download results.`}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-64" data-testid="projects-controls">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects..."
              aria-label="Search projects" data-testid="projects-search-input"
              className="h-10 rounded-lg border-border bg-muted/30 pl-9 text-sm text-foreground placeholder:text-muted-foreground/80 focus-visible:ring-ring/40" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={load} data-testid="projects-refresh-button"
              className="h-10 gap-2 rounded-lg border-border bg-muted/30 text-sm text-foreground hover:bg-muted/60 hover:text-foreground">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={() => navigate("/new-project")} data-testid="projects-new-button"
              className="h-10 gap-2 rounded-lg bg-primary text-sm text-white hover:bg-primary">
              <Plus className="h-4 w-4" aria-hidden="true" /> New Project
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <Card className="rounded-xl border-red-500/25 bg-red-500/[0.05]" data-testid="projects-error">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" aria-hidden="true" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <Button onClick={load} variant="secondary" className="h-9 gap-2 rounded-lg border-border bg-muted/30 text-sm text-foreground hover:bg-muted/60">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-3" data-testid="projects-board">
          {COLUMNS.map(col => {
            const theme = columnTheme[col];
            const EmptyIcon = theme.emptyIcon;
            return (
              <Card key={col} className="rounded-xl border-border bg-muted/20" data-testid={`projects-column-${col.toLowerCase()}`}>
                <CardContent className="p-5">
                  <div className="mb-4 flex items-center gap-2" aria-label={`${col} projects`}>
                    <span className={`h-2 w-2 rounded-full ${theme.dot}`} aria-hidden="true" />
                    <h2 className="text-[15px] font-semibold text-foreground">{col}</h2>
                    <span className="rounded-full bg-muted/40 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{byCol[col].length}</span>
                  </div>

                  {byCol[col].length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-4 py-10 text-center">
                      <span className={`flex h-11 w-11 items-center justify-center rounded-full ${theme.emptyChip}`}>
                        <EmptyIcon className={`h-5 w-5 ${theme.emptyIconClass}`} aria-hidden="true" />
                      </span>
                      <p className="text-sm font-semibold text-foreground">{columnEmpty[col].title}</p>
                      <p className="max-w-[200px] text-sm leading-relaxed text-muted-foreground">{columnEmpty[col].body}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {byCol[col].map(j => {
                        const thumb = j.result?.video_url || (col === "Ready" ? j.result?.audio_url : undefined);
                        const isVideoThumb = !!j.result?.video_url;
                        const hue = (j.job_id.charCodeAt(0) * 37 + j.job_id.length * 13) % 360;
                        const title = j.voice_name || "Conversion";
                        return (
                          <Card key={j.job_id}
                            role="button" tabIndex={0}
                            aria-label={`Open project ${title}`}
                            onClick={() => navigate("/voice-changer")}
                            onKeyDown={e => (e.key === "Enter" || e.key === " ") && navigate("/voice-changer")}
                            className="group cursor-pointer rounded-lg border-border bg-background/50 transition-colors duration-200 outline-none hover:border-border hover:bg-background/80 focus-visible:ring-1 focus-visible:ring-ring/50"
                            data-testid="projects-card">
                            <CardContent className="p-3.5">
                              <div className="flex gap-3.5">
                                {/* Thumbnail / media preview */}
                                <div className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-lg border border-border" style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${hue + 50} 65% 25%))` }}>
                                  {col === "Ready" && thumb && isVideoThumb && (
                                    <video src={thumb} muted preload="metadata" playsInline className="absolute inset-0 h-full w-full object-cover" aria-hidden="true" />
                                  )}
                                  {(!thumb || !isVideoThumb) && (
                                    <span className="absolute inset-0 flex items-end gap-[3px] px-2 pb-2 opacity-80" aria-hidden="true">
                                      {Array.from({ length: 12 }).map((_, i) => (
                                        <span key={i} className="flex-1 rounded-sm bg-white/40" style={{ height: `${25 + ((i * 29 + hue) % 65)}%` }} />
                                      ))}
                                    </span>
                                  )}
                                  {col === "Ready" && (
                                    <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                                        <Play className="h-3 w-3 text-white/90" aria-hidden="true" />
                                      </span>
                                    </span>
                                  )}
                                  {j.duration_seconds != null && (
                                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-[10px] tabular-nums leading-tight text-white/90">
                                      {fmtDur(j.duration_seconds)}
                                    </span>
                                  )}
                                  {j.is_video && (
                                    <Film className="absolute left-1.5 top-1.5 h-3.5 w-3.5 text-white/70" aria-hidden="true" />
                                  )}
                                </div>

                                <div className="flex min-w-0 flex-1 flex-col">
                                  <div className="flex items-start justify-between gap-2">
                                    <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
                                    <Badge variant="outline"
                                      className={`shrink-0 rounded-md border px-1.5 py-0 text-xs font-medium uppercase tracking-wide ${statusBadge[col]}`}>
                                      {col === "Processing" && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" aria-hidden="true" />}
                                      {col}
                                    </Badge>
                                  </div>
                                  <p className="mt-1.5 truncate text-xs text-muted-foreground">
                                    {j.is_video ? "Video" : "Audio"}{j.duration_seconds != null ? ` · ${fmtDur(j.duration_seconds)}` : ""}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                                    {fmtDate(j.created_at) ? `Created ${fmtDate(j.created_at)}` : ""}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {j.language && (
                                      <span className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">{j.language}</span>
                                    )}
                                    {j.voice_name && (
                                      <span className="max-w-[110px] truncate rounded-md border border-border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">{j.voice_name}</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {col === "Processing" && j.progress != null && (
                                <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted/30">
                                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(4, j.progress)}%` }} />
                                </div>
                              )}
                              {col === "Failed" && j.error && (
                                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-red-700 dark:text-red-300/70" data-testid="projects-card-error">{j.error}</p>
                              )}

                              {/* Card footer actions */}
                              <div className="mt-3 flex items-center border-t border-border/60 pt-3">
                                {col === "Ready" && (j.result?.video_url || j.result?.audio_url) ? (
                                  <Button asChild variant="ghost" size="sm" data-testid="projects-download"
                                    onClick={e => e.stopPropagation()}
                                    className="h-8 flex-1 justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground hover:bg-muted/60">
                                    <a href={j.result.video_url || j.result.audio_url} target="_blank" rel="noreferrer"
                                      download={j.result.video_url ? `dreamvoice-${j.job_id}.mp4` : `dreamvoice-${j.job_id}.wav`}
                                      aria-label="Download result">
                                      <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                                    </a>
                                  </Button>
                                ) : <span className="flex-1" />}
                                <span className="mx-2 h-4 w-px bg-border/60" aria-hidden="true" />
                                <span className="flex flex-1 items-center justify-center gap-0.5 text-xs font-medium text-foreground">
                                  Open <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                                </span>
                                <span className="mx-2 h-4 w-px bg-border/60" aria-hidden="true" />
                                <Button variant="ghost" size="sm" aria-label={`Delete project ${title}`}
                                  data-testid="projects-delete-button"
                                  onClick={e => { e.stopPropagation(); setPendingDelete(j); }}
                                  className="h-8 w-8 rounded-md p-0 text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Info banner */}
      <Card className="rounded-xl border-border bg-muted/20" data-testid="projects-info-banner">
        <CardContent className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4 lg:flex-1">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <ListChecks className="h-5 w-5 text-primary" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-foreground">Organize. Track. Convert.</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                All your voice conversions in one place. Track progress, review results and download your converted media anytime.
              </p>
            </div>
          </div>
          <div className="hidden h-16 w-px bg-border/60 lg:block" aria-hidden="true" />
          <div className="grid gap-5 sm:grid-cols-3 lg:flex-1">
            {FEATURES.map(f => (
              <div key={f.title} className="flex items-start gap-2.5">
                <f.icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{f.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && !deleting && setPendingDelete(null)}>
        <DialogContent data-testid="projects-delete-dialog" className="border-border bg-card">
          <DialogHeader>
            <DialogTitle>Delete this project?</DialogTitle>
            <DialogDescription>
              "{pendingDelete?.voice_name || "Conversion"}" will be permanently removed,
              including its audio files. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" data-testid="projects-delete-cancel" disabled={deleting}
              onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" data-testid="projects-delete-confirm" disabled={deleting}
              onClick={confirmDelete}>
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Projects;
