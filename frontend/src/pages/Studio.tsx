import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AudioWaveform, Mic2, Languages, FileText, Plus, Play, Clock,
  Loader2, Upload, AlertTriangle, Sparkles, ArrowRight, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listJobs, type JobSummary } from "@/lib/backend";

type ProjectStatus = "Ready" | "Processing" | "Failed";

const statusStyle: Record<ProjectStatus, string> = {
  Ready: "border-border bg-muted/60 text-emerald-600 dark:text-emerald-400",
  Processing: "border-border bg-muted/60 text-amber-600 dark:text-amber-400",
  Failed: "border-border bg-muted/60 text-red-600 dark:text-red-400",
};

const statusOf = (state: string | null | undefined): ProjectStatus =>
  state === "completed" ? "Ready" : state === "failed" || state === "cancelled" ? "Failed" : "Processing";

const fmtDur = (s: number | null | undefined) => {
  if (!s) return null;
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const fmtEdited = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(+d)) return null;
  const diff = Date.now() - +d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const quickActions = [
  { title: "Change Voice", desc: "Replace the voice in an existing recording.", cta: "Start", icon: Mic2, to: "/new-project" },
  { title: "Clone Voice", desc: "Create a voice from an authorized sample.", cta: "Create", icon: AudioWaveform },
  { title: "Dubbing", desc: "Translate and voice your content.", cta: "Start", icon: Languages },
  { title: "Transcribe", desc: "Turn speech into editable text.", cta: "Transcribe", icon: FileText },
];

const sectionLabel = "mb-4 text-[15px] font-semibold text-foreground";

const Studio = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<JobSummary[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const jobs = await listJobs();
      setRecent(jobs.slice(0, 4));
    } catch (e: any) {
      setRecentError(e?.message || "Could not load projects");
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(t);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading studio…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-12 p-5 md:p-10">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground md:text-[28px]">Voice Studio</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Transform your recordings with AI voices.</p>
        </div>
        <Button asChild size="sm" className="h-9 gap-1.5 rounded-lg bg-primary px-3.5 text-white hover:bg-primary" data-testid="studio-new-project-button">
          <Link to="/new-project"><Plus className="h-4 w-4" aria-hidden="true" /> New Project</Link>
        </Button>
      </header>

      {/* Quick actions */}
      <section aria-labelledby="qa-heading">
        <h2 id="qa-heading" className={sectionLabel}>Quick Actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map(a => (
            <Card key={a.title} className="group rounded-xl border-border bg-muted/30 transition-colors duration-200 hover:border-border hover:bg-muted/60">
              <CardContent className="flex h-full min-h-[168px] flex-col gap-3 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary transition-colors group-hover:border-primary/40">
                    <a.icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{a.title}</h3>
                </div>
                <p className="text-[13px] leading-snug text-muted-foreground">{a.desc}</p>
                {a.to ? (
                  <Link to={a.to}
                    data-testid="studio-change-voice-start-button"
                    className="mt-auto flex items-center gap-1 pt-1 text-[13px] font-medium text-foreground/80 transition-colors hover:text-foreground">
                    {a.cta}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                ) : (
                  <span className="mt-auto flex items-center gap-1 pt-1 text-[13px] font-medium text-foreground/80">
                    {a.cta}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Create voice project */}
      <section aria-labelledby="upload-heading" data-da-source="src/pages/Studio.tsx:CreateVoiceProject">
        <h2 id="upload-heading" className={sectionLabel}>Create Voice Project</h2>
        <div className="space-y-4">
          <div
            role="button" tabIndex={0} aria-label="Upload media: drag and drop or browse files"
            data-testid="studio-upload-dropzone"
            onClick={() => navigate("/projects")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && navigate("/projects")}
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-indigo-400/25 bg-indigo-500/[0.05] px-6 py-10 text-center transition-colors hover:border-indigo-400/45 hover:bg-indigo-500/[0.09]"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-indigo-400/30 bg-indigo-500/15 text-indigo-300">
              <Upload className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium text-foreground">Drop your video or audio here</p>
            <p className="text-xs text-muted-foreground">MP4 · MOV · MP3 · WAV · M4A</p>
            <Button variant="outline" size="sm" className="h-8 rounded-lg border-border bg-transparent text-foreground hover:bg-muted/60 hover:text-foreground">
              Browse Files
            </Button>
            <p className="text-xs text-muted-foreground">Video up to 500 MB · Audio up to 100 MB · Max 30 minutes</p>
          </div>
          <Button onClick={() => navigate("/projects")} data-testid="studio-generate-voice-button" size="sm" className="h-9 gap-1.5 rounded-lg bg-primary px-4 text-primary-foreground hover:bg-primary/90">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Generate Voice
          </Button>
        </div>
      </section>

      {/* Recent projects */}
      <section aria-labelledby="recent-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="recent-heading" className="text-[15px] font-semibold text-foreground">Recent Projects</h2>
          <Link to="/projects" className="text-[13px] text-muted-foreground transition-colors hover:text-foreground">View all</Link>
        </div>
        {recentLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <p className="text-sm">Loading projects…</p>
          </div>
        ) : recentError ? (
          <Card className="rounded-xl border-red-500/25 bg-red-500/[0.05]" data-testid="studio-recent-error">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
              <p className="text-sm text-red-700 dark:text-red-300">{recentError}</p>
              <Button onClick={loadRecent} variant="secondary" className="h-8 gap-1.5 rounded-lg text-xs">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
              </Button>
            </CardContent>
          </Card>
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-10 text-center">
            <Mic2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">No projects yet</p>
            <p className="text-xs text-muted-foreground">Start a conversion and it will show up here.</p>
          </div>
        ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {recent.map(j => {
            const hue = (j.job_id.charCodeAt(0) * 37 + j.job_id.length * 13) % 360;
            const status = statusOf(j.state ?? j.status);
            const title = j.voice_name || j.filename || "Conversion";
            const duration = fmtDur(j.duration_seconds);
            return (
            <Card key={j.job_id}
              role="button" tabIndex={0}
              aria-label={`Open project ${title}`}
              data-testid="studio-recent-card"
              onClick={() => navigate(`/voice-changer?job=${j.job_id}`)}
              onKeyDown={e => (e.key === "Enter" || e.key === " ") && navigate(`/voice-changer?job=${j.job_id}`)}
              className="group cursor-pointer rounded-xl border-border bg-muted/30 outline-none transition-colors duration-200 hover:border-border hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50">
              <CardContent className="flex gap-4 p-3.5">
                <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-border" style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${hue + 50} 65% 28%))` }}>
                  <span className="absolute -right-3 -top-3 h-14 w-14 rounded-full bg-white/15 blur-md" aria-hidden="true" />
                  {status === "Ready" && j.result?.video_url && (
                    <video src={j.result.video_url} muted preload="metadata" playsInline className="absolute inset-0 h-full w-full object-cover" aria-hidden="true" />
                  )}
                  {status === "Ready" && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors group-hover:bg-black/60">
                        <Play className="h-3 w-3 text-white/90" aria-hidden="true" />
                      </span>
                    </span>
                  )}
                  {duration && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-xs tabular-nums leading-tight text-white/90">{duration}</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col py-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
                    <Badge variant="outline" className={`shrink-0 rounded-md border px-1.5 py-0 text-xs font-medium uppercase tracking-wide ${statusStyle[status]}`}>
                      {status === "Processing" && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" aria-hidden="true" />}
                      {status}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {[j.is_video ? "Video" : "Audio", j.voice_name, j.language].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden="true" /> {fmtEdited(j.updated_at || j.created_at) || "—"}
                    </span>
                    <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                      Open <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
        )}
      </section>

      {/* Rights notice */}
      <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div>
          <p className="text-xs font-medium text-amber-300/90">Voice Rights Notice</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Only upload or clone voices you own or have explicit permission to use. You are solely responsible for voice licensing, consent, and compliance with applicable laws and third-party rights. DreamAgent does not verify voice ownership or authorization.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Studio;
