import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AudioWaveform, Mic2, Languages, FileText, Plus, Play, Clock,
  CheckCircle2, Loader2, Upload, Film, AlertTriangle, Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Ready: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Processing: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Draft: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  Published: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
};

const quickActions = [
  { title: "Change Voice", desc: "Replace the voice in an existing recording.", cta: "Start", icon: Mic2 },
  { title: "Clone Voice", desc: "Create a voice from an authorized voice sample.", cta: "Create Voice", icon: AudioWaveform },
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

const Studio = () => {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(67);
  const [showProcessing, setShowProcessing] = useState(false);
  const [file] = useState({ name: "dreamagent-demo.mp4", duration: "04:32", res: "1080p", audio: "48 kHz audio" });

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
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading studio…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-4 md:p-8">
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">Voice Studio</h1>
          <p className="mt-1 text-sm text-zinc-400">Transform your recordings with AI voices.</p>
        </div>
        <Button className="w-fit gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
          <Plus className="h-4 w-4" aria-hidden="true" /> New Project
        </Button>
      </header>

      {/* Quick actions */}
      <section aria-labelledby="qa-heading">
        <h2 id="qa-heading" className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Quick Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map(a => (
            <Card key={a.title} className="group border-white/10 bg-white/[0.03] transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:bg-white/[0.05] hover:shadow-xl hover:shadow-indigo-950/40">
              <CardContent className="flex h-full flex-col gap-3 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/25 to-purple-500/25 text-indigo-300">
                  <a.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold text-zinc-100">{a.title}</CardTitle>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{a.desc}</p>
                </div>
                <Button variant="secondary" size="sm" className="mt-auto w-fit bg-white/10 text-zinc-200 hover:bg-white/15">{a.cta}</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Upload workspace preview */}
      <section aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Create Voice Project</h2>
        <Card className="border-dashed border-white/15 bg-white/[0.02]">
          <CardContent className="p-6 md:p-8">
            {!showProcessing ? (
              <>
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-10 text-center">
                  <Upload className="h-8 w-8 text-zinc-500" aria-hidden="true" />
                  <p className="font-medium text-zinc-200">Drop your video or audio here</p>
                  <p className="text-xs text-zinc-500">MP4 · MOV · MP3 · WAV · M4A</p>
                  <Button variant="secondary" size="sm" className="bg-white/10 text-zinc-200 hover:bg-white/15">Browse Files</Button>
                </div>
                <p className="mt-4 text-center text-xs text-zinc-500">
                  Your original video is preserved. Voice processing will only affect the selected speech/audio track.
                </p>
                <div className="mt-5 flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
                      <Film className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{file.name}</p>
                      <p className="text-xs text-zinc-500">{file.duration} · {file.res} · {file.audio}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" className="bg-white/10 hover:bg-white/15">Replace</Button>
                    <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-red-400">Remove</Button>
                  </div>
                </div>
                <Button onClick={() => setShowProcessing(true)} className="mt-5 w-full gap-2 bg-indigo-500 text-white hover:bg-indigo-400 sm:w-auto">
                  <Sparkles className="h-4 w-4" aria-hidden="true" /> Generate Voice
                </Button>
              </>
            ) : (
              <div className="space-y-5" role="status" aria-live="polite">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-100">Creating your new voice track</h3>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={progress} className="h-2 flex-1" />
                    <span className="text-sm tabular-nums text-zinc-300">{progress}%</span>
                  </div>
                </div>
                <ul className="space-y-2">
                  {processingSteps.map(s => (
                    <li key={s.label} className="flex items-center gap-2.5 text-sm">
                      {s.state === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />}
                      {s.state === "active" && <Loader2 className="h-4 w-4 animate-spin text-amber-400" aria-hidden="true" />}
                      {s.state === "pending" && <span className="h-4 w-4 rounded-full border border-white/20" aria-hidden="true" />}
                      <span className={s.state === "pending" ? "text-zinc-500" : "text-zinc-200"}>{s.label}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex h-14 items-end gap-1 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02] px-3" aria-hidden="true">
                  {Array.from({ length: 40 }).map((_, i) => (
                    <span key={i} className="w-full animate-pulse rounded-sm bg-gradient-to-t from-indigo-500/60 to-purple-400/60"
                      style={{ height: `${20 + Math.abs(Math.sin(i * 1.3)) * 70}%`, animationDelay: `${i * 60}ms` }} />
                  ))}
                </div>
                <p className="text-xs text-zinc-500">Keep this window open while your voice track is being prepared.</p>
                <Button variant="ghost" size="sm" onClick={() => { setShowProcessing(false); setProgress(67); }} className="text-zinc-400 hover:text-red-400">Cancel</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Recent projects */}
      <section aria-labelledby="recent-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-heading" className="text-sm font-medium uppercase tracking-wide text-zinc-500">Recent Projects</h2>
          <Link to="/projects" className="text-xs text-indigo-400 hover:text-indigo-300">View all</Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {recentProjects.map(p => (
            <Card key={p.id} className="group border-white/10 bg-white/[0.03] transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-xl hover:shadow-indigo-950/40">
              <CardContent className="flex gap-4 p-4">
                <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 60% 25%), hsl(${p.hue + 40} 55% 15%))` }}>
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Play className="h-5 w-5 text-white/80 transition-transform group-hover:scale-110" aria-hidden="true" />
                  </span>
                  <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] tabular-nums text-white/90">{p.duration}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-sm font-medium text-zinc-100">{p.name}</h3>
                    <Badge variant="outline" className={`shrink-0 text-[10px] ${statusStyle[p.status]}`}>{p.status}</Badge>
                  </div>
                  <dl className="mt-1.5 space-y-0.5 text-xs text-zinc-400">
                    <div className="flex items-center gap-1"><Mic2 className="h-3 w-3" aria-hidden="true" /><dd>{p.voice}</dd></div>
                    <div className="flex items-center gap-1"><Languages className="h-3 w-3" aria-hidden="true" /><dd>{p.language}</dd></div>
                    <div className="flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" /><dd>Edited {p.edited}</dd></div>
                  </dl>
                  <Button variant="secondary" size="sm" className="mt-2.5 h-8 bg-white/10 text-xs text-zinc-200 hover:bg-white/15">Open</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Rights notice */}
      <Card className="border-amber-500/25 bg-amber-500/[0.06]">
        <CardContent className="flex gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-amber-300">Voice Rights Notice</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Only upload or clone voices you own or have explicit permission to use. You are solely responsible for voice licensing, consent, and compliance with applicable laws and third-party rights. DreamAgent does not verify voice ownership or authorization.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Studio;
