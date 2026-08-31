import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2, Mic2, Languages, Clock, FolderKanban,
  Search, AlertTriangle, RefreshCw, Play, Download, Trash2,
  Film, ArrowRight, CircleDot,
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

const statusBadge: Record<Column, string> = {
  Processing: "border-amber-500/25 bg-amber-500/[0.08] text-amber-300",
  Ready: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300",
  Failed: "border-red-500/25 bg-red-500/[0.08] text-red-700 dark:text-red-300",
};

const columnEmpty: Record<Column, string> = {
  Processing: "No active conversions.",
  Ready: "No completed projects yet.",
  Failed: "No failures — all clear.",
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
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobs.length === 0
              ? "Your voice conversions will appear here."
              : `${jobs.length} conversion${jobs.length === 1 ? "" : "s"} · track progress, download results.`}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-72" data-testid="projects-controls">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects…"
              aria-label="Search projects" data-testid="projects-search-input"
              className="h-9 rounded-lg border-border bg-muted/30 pl-9 text-sm text-foreground placeholder:text-muted-foreground/80 focus-visible:ring-ring/40" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={load} data-testid="projects-refresh-button"
              className="h-9 gap-2 rounded-lg border-border bg-muted/30 text-sm text-foreground hover:bg-muted/60 hover:text-foreground">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={() => navigate("/new-project")} data-testid="projects-new-button"
              className="h-9 gap-2 rounded-lg bg-primary text-sm text-white hover:bg-primary">
              New Project
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
      ) : jobs.length === 0 ? (
        <Card className="rounded-xl border-dashed border-dashed border-border bg-muted/30" data-testid="projects-empty">
          <CardContent className="flex flex-col items-center gap-3 p-14 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/30">
              <FolderKanban className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-foreground">No projects yet</p>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              Start a voice conversion and it will show up here with its progress and results.
            </p>
            <Button onClick={() => navigate("/new-project")}
              className="mt-1 h-9 gap-2 rounded-lg bg-primary text-sm text-white hover:bg-primary">
              New Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-3" data-testid="projects-board">
          {COLUMNS.map(col => (
            <section key={col} aria-label={`${col} projects`} data-testid={`projects-column-${col.toLowerCase()}`}>
              <div className="mb-3 flex items-center gap-2 px-0.5">
                <span className={`h-1.5 w-1.5 rounded-full ${col === "Processing" ? "bg-amber-400" : col === "Ready" ? "bg-emerald-400" : "bg-red-400"}`} aria-hidden="true" />
                <h2 className="text-[13px] font-medium text-foreground">{col}</h2>
                <span className="text-xs tabular-nums text-muted-foreground/80">{byCol[col].length}</span>
              </div>
              <div className="space-y-3">
                {byCol[col].length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-transparent px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground/80">
                    {columnEmpty[col]}
                  </div>
                ) : byCol[col].map(j => {
                  const thumb = j.result?.video_url || (col === "Ready" ? j.result?.audio_url : undefined);
                  const isVideoThumb = !!j.result?.video_url;
                  const title = j.voice_name || "Conversion";
                  const meta = [
                    j.is_video ? "Video" : "Audio",
                    j.duration_seconds != null ? fmtDur(j.duration_seconds) : null,
                    j.language,
                  ].filter(Boolean).join(" · ");
                  return (
                    <Card key={j.job_id}
                      role="button" tabIndex={0}
                      aria-label={`Open project ${title}`}
                      onClick={() => navigate("/voice-changer")}
                      onKeyDown={e => (e.key === "Enter" || e.key === " ") && navigate("/voice-changer")}
                      className="group cursor-pointer rounded-xl border-border bg-muted/30 transition-colors duration-200 outline-none hover:border-border hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50"
                      data-testid="projects-card">
                      <CardContent className="flex gap-3.5 p-3.5">
                        {/* Thumbnail / media preview */}
                        <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
                          {col === "Ready" && thumb ? (
                            isVideoThumb ? (
                              <video src={thumb} muted preload="metadata" playsInline
                                className="h-full w-full object-cover" aria-hidden="true" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-primary/[0.08]">
                                <Mic2 className="h-5 w-5 text-primary/70" aria-hidden="true" />
                              </div>
                            )
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              {j.is_video
                                ? <Film className="h-5 w-5 text-muted-foreground/80" aria-hidden="true" />
                                : <Mic2 className="h-5 w-5 text-muted-foreground/80" aria-hidden="true" />}
                            </div>
                          )}
                          {col === "Ready" && (
                            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                                <Play className="h-3 w-3 text-white/90" aria-hidden="true" />
                              </span>
                            </span>
                          )}
                          {j.duration_seconds != null && col === "Ready" && (
                            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-xs tabular-nums leading-tight text-white/90">
                              {fmtDur(j.duration_seconds)}
                            </span>
                          )}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col py-0.5">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
                            <Badge variant="outline"
                              className={`shrink-0 rounded-md border px-1.5 py-0 text-xs font-medium uppercase tracking-wide ${statusBadge[col]}`}>
                              {col === "Processing" && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" aria-hidden="true" />}
                              {col === "Failed" && <CircleDot className="mr-1 h-2.5 w-2.5" aria-hidden="true" />}
                              {col}
                            </Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {fmtDate(j.created_at) ? `Created ${fmtDate(j.created_at)}` : ""}
                            {fmtDate(j.updated_at) && fmtDate(j.updated_at) !== fmtDate(j.created_at) ? ` · Updated ${fmtDate(j.updated_at)}` : ""}
                          </p>

                          {col === "Processing" && j.progress != null && (
                            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted/30">
                              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(4, j.progress)}%` }} />
                            </div>
                          )}
                          {col === "Failed" && j.error && (
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-red-700 dark:text-red-300/70" data-testid="projects-card-error">{j.error}</p>
                          )}

                          <div className="mt-auto flex items-center justify-between pt-2">
                            {col === "Ready" && j.result?.audio_url ? (
                              <Button asChild variant="ghost" size="sm" data-testid="projects-download"
                                onClick={e => e.stopPropagation()}
                                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                                <a href={j.result.audio_url} target="_blank" rel="noreferrer" download aria-label="Download result">
                                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                                </a>
                              </Button>
                            ) : <span />}
                            <span className="flex items-center gap-1.5">
                              <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                                Open <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                              </span>
                              <Button variant="ghost" size="sm" aria-label={`Delete project ${title}`}
                                data-testid="projects-delete-button"
                                onClick={e => { e.stopPropagation(); setPendingDelete(j); }}
                                className="h-7 w-7 p-0 text-muted-foreground/80 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300">
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

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
