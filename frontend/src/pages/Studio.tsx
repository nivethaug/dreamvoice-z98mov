import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AudioWaveform, Mic2, Languages, FileText, Plus, Play, Clock,
  CheckCircle2, Loader2, Upload, Film, AlertTriangle, Sparkles, ArrowRight,
  Timer, Monitor, Volume2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

type ProjectStatus = "Ready" | "Processing" | "Draft" | "Published";

interface RecentProject {
  id: number;
  name: string;
  duration: string;
  voice: string;
  language: string;
  status: ProjectStatus;
  edited: string;
  hue: number;
}

const recentProjects: RecentProject[] = [
  { id: 1, name: "My YouTube Intro", duration: "01:12", voice: "Male Narrator", language: "English", status: "Ready", edited: "2 hours ago", hue: 248 },
  { id: 2, name: "AI Tutorial #12", duration: "08:45", voice: "Female Presenter", language: "English", status: "Processing", edited: "5 hours ago", hue: 190 },
  { id: 3, name: "Tamil → English Video", duration: "06:20", voice: "Tamil Presenter", language: "Tamil", status: "Ready", edited: "Yesterday", hue: 25 },
  { id: 4, name: "DreamAgent Demo", duration: "04:32", voice: "My Voice", language: "English", status: "Draft", edited: "3 days ago", hue: 150 },
];

const statusStyle: Record<ProjectStatus, string> = {
  Ready: "border-border bg-muted/60 text-emerald-600 dark:text-emerald-400",
  Processing: "border-border bg-muted/60 text-amber-600 dark:text-amber-400",
  Draft: "border-border bg-card text-muted-foreground",
  Published: "border-border bg-muted/60 text-foreground",
};

const quickActions = [
  { title: "Change Voice", desc: "Replace the voice in an existing recording.", cta: "Start", icon: Mic2, to: "/new-project" },
  { title: "Clone Voice", desc: "Create a voice from an authorized sample.", cta: "Create", icon: AudioWaveform },
  { title: "Dubbing", desc: "Translate and voice your content.", cta: "Start", icon: Languages },
  { title: "Transcribe", desc: "Turn speech into editable text.", cta: "Transcribe", icon: FileText },
];

const processingSteps = [
  { label: "Upload processed", state: "done" },
  { label: "Speech detected", state: "done" },
  { label: "Voice conversion", state: "done" },
  { label: "Audio mastering", state: "active" },
  { label: "Final video", state: "pending" },
] as const;

const sectionLabel = "mb-4 text-[15px] font-semibold text-foreground";

const Studio = () => {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(67);
  const [showProcessing, setShowProcessing] = useState(false);
  const [file] = useState({ name: "dreamagent-demo.mp4", duration: "04:32", res: "1080p", audio: "48 kHz", size: "68.4 MB" });

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!showProcessing) return;
    const i = setInterval(() => setProgress(p => Math.min(100, p + 1)), 400);
    return () => clearInterval(i);
  }, [showProcessing]);

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

      {/* Upload workspace preview */}
      <section aria-labelledby="upload-heading">
        <h2 id="upload-heading" className={sectionLabel}>Create Voice Project</h2>
        {!showProcessing ? (
          <div className="space-y-4">
            <div
              role="button" tabIndex={0} aria-label="Upload media: drag and drop or browse files"
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
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
                  <Film className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Timer className="h-3 w-3" aria-hidden="true" />{file.duration}</span>
                    <span className="flex items-center gap-1"><Monitor className="h-3 w-3" aria-hidden="true" />{file.res}</span>
                    <span className="flex items-center gap-1"><Volume2 className="h-3 w-3" aria-hidden="true" />{file.audio}</span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">{file.size}</span>
                <Button variant="outline" size="sm" className="h-8 rounded-lg border-border bg-transparent text-foreground hover:bg-muted/60 hover:text-foreground">Replace</Button>
                <Button size="sm" className="h-8 rounded-lg border border-red-500/30 bg-red-500/15 text-red-400 hover:bg-red-500/25 hover:text-red-300">Remove</Button>
              </div>
            </div>
            <Button onClick={() => setShowProcessing(true)} size="sm" className="h-9 gap-1.5 rounded-lg bg-primary px-4 text-primary-foreground hover:bg-primary/90">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Generate Voice
            </Button>
          </div>
        ) : (
          <Card className="rounded-xl border-border bg-muted/30">
            <CardContent className="space-y-5 p-5" role="status" aria-live="polite">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Creating your new voice track</h3>
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={progress} className="h-1.5 flex-1" />
                  <span className="text-xs tabular-nums text-muted-foreground">{progress}%</span>
                </div>
              </div>
              <ul className="space-y-2">
                {processingSteps.map(s => (
                  <li key={s.label} className="flex items-center gap-2.5 text-sm">
                    {s.state === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                    {s.state === "active" && <Loader2 className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" aria-hidden="true" />}
                    {s.state === "pending" && <span className="h-4 w-4 rounded-full border border-border" aria-hidden="true" />}
                    <span className={s.state === "pending" ? "text-muted-foreground" : "text-foreground"}>{s.label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Keep this window open while your voice track is being prepared.</p>
              <Button variant="ghost" size="sm" onClick={() => { setShowProcessing(false); setProgress(67); }} className="text-muted-foreground hover:text-red-600 dark:text-red-400">Cancel</Button>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Recent projects */}
      <section aria-labelledby="recent-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="recent-heading" className="text-[15px] font-semibold text-foreground">Recent Projects</h2>
          <Link to="/projects" className="text-[13px] text-muted-foreground transition-colors hover:text-foreground">View all</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {recentProjects.map(p => (
            <Card key={p.id} className="group rounded-xl border-border bg-muted/30 transition-colors duration-200 hover:border-border hover:bg-muted/60">
              <CardContent className="flex gap-4 p-3.5">
                <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-border" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 70% 45%), hsl(${p.hue + 50} 65% 28%))` }}>
                  <span className="absolute -right-3 -top-3 h-14 w-14 rounded-full bg-white/15 blur-md" aria-hidden="true" />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors group-hover:bg-black/60">
                      <Play className="h-3 w-3 text-white/90" aria-hidden="true" />
                    </span>
                  </span>
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-xs tabular-nums leading-tight text-white/90">{p.duration}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col py-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-sm font-medium text-foreground">{p.name}</h3>
                    <Badge variant="outline" className={`shrink-0 rounded-md border px-1.5 py-0 text-xs font-medium uppercase tracking-wide ${statusStyle[p.status]}`}>
                      {p.status === "Processing" && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" aria-hidden="true" />}
                      {p.status}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{p.voice} · {p.language}</p>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden="true" /> {p.edited}
                    </span>
                    <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                      Open <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
