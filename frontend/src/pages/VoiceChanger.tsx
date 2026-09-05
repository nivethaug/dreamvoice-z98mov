import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Play, Pause, Volume2, Maximize2, Mic2, Search, Plus, CheckCircle2,
  AlertTriangle, ChevronDown, RotateCcw, Download, Film, Music, Pencil, ArrowRight,
  Loader2, X, SlidersHorizontal, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { projectStore, type ProjectMedia } from "@/lib/projectStore";
import { startConversion, getJobStatus, cancelJob, listVoices, fetchVoiceSample, type BackendVoice } from "@/lib/backend";

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), h = Math.floor(m / 60);
  return h > 0 ? `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

interface Voice {
  id: string; name: string; desc: string; tags: string; language: string;
  personal?: boolean; addedAt: number; initials: string; hue: number;
  authorized?: boolean; backendId?: number;
}

// Voice library loaded from the backend API (real voices only)
const useAllVoices = (): { voices: Voice[]; loading: boolean; reload: () => void } => {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = () => setTick(t => t + 1);
  useEffect(() => {
    let alive = true;
    listVoices()
      .then(list => { if (alive) setVoices(list.map(toVoice)); })
      .catch(() => { if (alive) setVoices([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tick]);
  return { voices, loading, reload };
};

const toVoice = (v: BackendVoice): Voice => {
  const id = String(v.voice_id);
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  const initials = v.name.trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "V";
  return {
    id, name: v.name, desc: v.description || "",
    tags: (v.languages || []).join(", "), language: (v.languages || [])[0] || "Other",
    personal: true, addedAt: v.created_at ? Date.parse(v.created_at) || 0 : 0,
    initials, hue: hash,
    authorized: v.authorized, backendId: v.voice_id, referenceUploaded: v.has_sample,
  };
};

const FILTERS = ["All", "My Voices", "English", "Tamil", "Hindi", "Other"] as const;
type Filter = (typeof FILTERS)[number];
type Sort = "Recommended" | "Recently Added" | "Name";

const DEFAULT_SETTINGS = { stability: 50, similarity: 75, style: 40, speed: 100, pitch: 50 };

const PROCESS_STEPS = [
  "Preparing media",
  "Analyzing speech",
  "Converting voice",
  "Enhancing audio",
  "Preparing final media",
];

type Phase = "setup" | "processing" | "complete";

const VoiceChanger = () => {
  const navigate = useNavigate();
  const media = projectStore.get().media as ProjectMedia | null;
  const rightsConfirmed = projectStore.get().rights.confirmed;

  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("setup");
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [sort, setSort] = useState<Sort>("Recommended");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null);
  const [previewing, setPreviewing] = useState<"original" | "target" | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const stopPreview = () => {
    const el = previewAudioRef.current;
    if (el) { el.pause(); el.currentTime = 0; }
    if (previewUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewing(null);
  };

  const playPreview = async (kind: "original" | "target") => {
    const el = previewAudioRef.current;
    if (!el) return;
    if (previewing === kind) { stopPreview(); return; }
    stopPreview();
    try {
      let url: string;
      if (kind === "original") {
        if (!media?.url) { setToast({ kind: "error", msg: "Upload source media first to preview the original voice." }); return; }
        url = media.url;
      } else {
        if (!selectedVoice?.backendId) { setToast({ kind: "error", msg: "Select a target voice first." }); return; }
        setPreviewing("target");
        url = await fetchVoiceSample(selectedVoice.backendId);
      }
      previewUrlRef.current = url;
      el.src = url;
      el.onended = stopPreview;
      el.onerror = () => { stopPreview(); setToast({ kind: "error", msg: "Preview playback failed." }); };
      await el.play();
      setPreviewing(kind);
    } catch (e) {
      stopPreview();
      setToast({ kind: "error", msg: e instanceof Error && e.message ? e.message : "Preview unavailable." });
    }
  };

  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Real backend job state (indeterminate — no fabricated percentage).
  const [jobStage, setJobStage] = useState<string>("queued");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultAudioUrl, setResultAudioUrl] = useState<string | null>(null);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [resultIsVideo, setResultIsVideo] = useState(false);
  const jobIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const { voices: allVoices, loading: voicesLoading } = useAllVoices();

  // Preselect pending voice (e.g. "Use Voice" from My Voices — backend voice id)
  useEffect(() => {
    if (voicesLoading) return;
    let id: string | null = null;
    try {
      const bId = localStorage.getItem("dreamvoice_pending_voice_id");
      if (bId) {
        id = bId;
        localStorage.removeItem("dreamvoice_pending_voice_id");
      }
    } catch { /* noop */ }
    if (!id) return;
    const v = allVoices.find(x => String(x.backendId) === id);
    if (v) setSelectedVoice(v);
  }, [allVoices, voicesLoading]);

  // Restore a completed job opened from the Projects page (?job=<id>)
  useEffect(() => {
    const jobId = searchParams.get("job");
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      try {
        const st = await getJobStatus(jobId);
        if (cancelled) return;
        const r = st.result || {};
        const url = r.audio_url || r.video_url || null;
        if (st.state === "completed" && url) {
          jobIdRef.current = jobId;
          setResultUrl(url);
          setResultAudioUrl(r.audio_url || null);
          setResultVideoUrl(r.video_url || null);
          setResultIsVideo(!!r.is_video || !!r.video_url);
          setPhase("complete");
        }
      } catch { /* ignore — stay in setup */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voices = useMemo(() => {
    let list = allVoices.filter(v =>
      v.name.toLowerCase().includes(query.toLowerCase()) ||
      v.desc.toLowerCase().includes(query.toLowerCase()));
    if (filter === "My Voices") list = list.filter(v => v.personal);
    else if (filter === "Other") list = list.filter(v => !v.personal && !["English", "Tamil", "Hindi"].includes(v.language));
    else if (filter !== "All") list = list.filter(v => v.language === filter);
    if (sort === "Recently Added") list = [...list].sort((a, b) => b.addedAt - a.addedAt);
    else if (sort === "Name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [allVoices, query, filter, sort]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const startProcessing = async () => {
    if (!media) { setError("No media selected. Please go back and upload a file."); return; }
    if (!selectedVoice) { setError("Please select a target voice before generating."); setToast({ kind: "error", msg: "Please select a target voice before generating." }); return; }
    if (!media.mediaId) {
      setError("This media is not registered with the backend. Please upload it again from New Project.");
      setToast({ kind: "error", msg: "Media missing — re-upload from New Project" });
      return;
    }
    if (!selectedVoice.backendId) {
      setError("This voice is not available for real conversion yet. Add an authorized voice sample first.");
      setToast({ kind: "error", msg: "Voice not authorized for real conversion" });
      return;
    }
    setError("");
    setResultUrl(null);
    setResultAudioUrl(null);
    setResultVideoUrl(null);
    setResultIsVideo(false);
    setJobStage("queued");
    setPhase("processing");
    try {
      const { job_id } = await startConversion({
        media_id: media.mediaId,
        voice_id: selectedVoice.backendId,
        source_language: media.language || "English",
        settings: { ...settings },
      });
      jobIdRef.current = job_id;
      pollRef.current = window.setInterval(async () => {
        try {
          const st = await getJobStatus(job_id);
          if (st.stage) setJobStage(st.stage);
          if (st.state === "completed") {
            stopPolling();
            const r = st.result || {};
            const url = r.audio_url || r.video_url || null;
            if (!url) {
              setPhase("setup");
              setError("Conversion finished but no output was produced. Please try again.");
              setToast({ kind: "error", msg: "No output produced" });
              return;
            }
            setResultUrl(url);
            setResultAudioUrl(r.audio_url || null);
            setResultVideoUrl(r.video_url || null);
            setResultIsVideo(!!r.is_video || !!r.video_url);
            setPhase("complete");
            setToast({ kind: "success", msg: "Voice conversion complete" });
          } else if (st.state === "failed") {
            stopPolling();
            setPhase("setup");
            const msg = st.error || "Voice conversion failed. Please try again.";
            setError(msg);
            setToast({ kind: "error", msg });
          } else if (st.state === "cancelled") {
            stopPolling();
            setPhase("setup");
            setToast({ kind: "error", msg: "Conversion cancelled" });
          }
        } catch (e) {
          stopPolling();
          setPhase("setup");
          const msg = e instanceof Error ? e.message : "Lost contact with the conversion job.";
          setError(msg);
          setToast({ kind: "error", msg });
        }
      }, 2000);
    } catch (e) {
      setPhase("setup");
      const msg = e instanceof Error ? e.message : "Could not start voice conversion.";
      setError(msg);
      setToast({ kind: "error", msg });
    }
  };

  useEffect(() => {
    return () => { stopPolling(); };
  }, []);

  const cancelProcessing = async () => {
    stopPolling();
    const id = jobIdRef.current;
    if (id) { try { await cancelJob(id); } catch { /* job may already be gone */ } }
    jobIdRef.current = null;
    setPhase("setup");
    setJobStage("queued");
    setToast({ kind: "error", msg: "Conversion cancelled" });
  };

  const activeStep = Math.min(PROCESS_STEPS.length - 1, Math.floor((progress / 100) * PROCESS_STEPS.length));

  const bars = Array.from({ length: 72 }, (_, i) =>
    25 + Math.abs(Math.sin(i * 0.63) * 35) + Math.abs(Math.sin(i * 0.19)) * 40);

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6 p-5 md:p-10" data-testid="voice-changer-page">
      {toast && (
        <div role="status" aria-live="polite"
          className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur ${
            toast.kind === "success" ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-700 dark:text-emerald-300" : "border-red-500/30 bg-red-950/90 text-red-700 dark:text-red-300"}`}>
          {toast.kind === "success" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          {toast.msg}
          <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">Voice Changer</h1>
          <p className="mt-1 text-sm text-muted-foreground">Replace the original speaker's voice while preserving the recording.</p>
        </div>
        {phase !== "processing" && (
          <Button variant="ghost" onClick={() => navigate("/new-project")}
            data-testid="voice-changer-back-button"
            className="w-fit gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Project
          </Button>
        )}
      </header>

      {/* No media state */}
      {!media && phase !== "processing" && (
        <Card className="border-red-500/25 bg-red-500/[0.04]" data-testid="voice-changer-no-media">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">No media selected</p>
            <p className="max-w-md text-xs text-muted-foreground">You haven't uploaded a project yet. Go back and upload a video or audio file to start changing voices.</p>
            <Button onClick={() => navigate("/new-project")} className="mt-1 gap-2 bg-primary text-primary-foreground hover:bg-primary">
              <ArrowRight className="h-4 w-4" aria-hidden="true" /> Create a Project
            </Button>
            <p className="mt-4 max-w-md text-xs leading-relaxed text-muted-foreground" data-testid="voice-changer-quality-hint-empty">
              Quality tip: your audio quality matters. Clean, natural speech from a single speaker produces better voice-conversion results — avoid background noise, music, echo, clipping, and distortion. For the best voice match, use a clean 30–60 second reference recording. Source audio matters too — unclear or noisy speech can remain in the converted result.
            </p>
          </CardContent>
        </Card>
      )}

      {/* PROCESSING STATE */}
      {phase === "processing" && (
        <Card className="border-primary/25 bg-muted/30" data-testid="voice-changer-processing">
          <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold text-foreground">Creating your new voice track</h2>
              <p className="mt-1 text-sm text-muted-foreground">Using {selectedVoice?.name} · {fmtTime(media?.duration || 0)} of media</p>
            </div>
            <div className="flex h-16 w-full max-w-xl items-center justify-center gap-1" aria-hidden="true">
              {bars.map((h, i) => (
                <span key={i} className="w-1.5 rounded-full bg-primary/70"
                  style={{
                    height: `${(h / 100) * (Math.abs(Math.sin(i * 0.5 + progress * 0.15)) * 0.7 + 0.3) * 64}px`,
                    animation: `pulse 1.2s ${i * 0.04}s ease-in-out infinite alternate`,
                  }} />
              ))}
            </div>
            <div className="w-full max-w-xl">
              <div className="mb-2 flex justify-between text-xs tabular-nums text-muted-foreground">
                <span>Progress</span><span>{Math.floor(progress)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted/30">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <ol className="w-full max-w-xl space-y-2 text-left text-sm" data-testid="voice-changer-processing-steps">
              {PROCESS_STEPS.map((step, i) => {
                const state = i < activeStep ? "done" : i === activeStep ? "current" : "pending";
                return (
                  <li key={step} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    state === "done" ? "border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-300"
                    : state === "current" ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground"}`}>
                    {state === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      : state === "current" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                      : <span className="h-4 w-4 shrink-0 rounded-full border-border" aria-hidden="true" />}
                    {step}
                  </li>
                );
              })}
            </ol>
            <Button variant="ghost" onClick={cancelProcessing}
              data-testid="voice-changer-cancel-button"
              className="gap-2 text-muted-foreground hover:text-red-600 dark:text-red-400">Cancel</Button>
          </CardContent>
        </Card>
      )}

      {/* COMPLETED STATE */}
      {phase === "complete" && media && selectedVoice && (
        <section data-testid="voice-changer-complete" className="space-y-6">
          <Card className="border-emerald-500/25 bg-emerald-500/[0.04]">
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Voice conversion complete</h2>
                  <p className="text-xs text-muted-foreground">Your new voice track is ready.</p>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => { setPhase("setup"); setProgress(0); }}
                data-testid="voice-changer-edit-voice-button"
                className="gap-1.5 border border-border bg-muted/30 text-foreground hover:bg-muted/60 hover:text-foreground">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit Voice
              </Button>
            </CardContent>
          </Card>

          <Tabs defaultValue="new" data-testid="voice-changer-result-tabs">
            <TabsList className="bg-muted/30">
              <TabsTrigger value="original" data-testid="voice-changer-tab-original">Original</TabsTrigger>
              <TabsTrigger value="new" data-testid="voice-changer-tab-new">New Voice</TabsTrigger>
            </TabsList>
            <TabsContent value="original" className="mt-4"><MediaPlayer media={media} label="Original" mockConverted={false} /></TabsContent>
            <TabsContent value="new" className="mt-4"><MediaPlayer media={media} label="New Voice" mockConverted src={resultUrl ?? undefined} srcKind={resultIsVideo ? "video" : "audio"} /></TabsContent>
          </Tabs>

          <Card className="border-border bg-muted/30">
            <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
              <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Voice</p><p className="mt-1 text-sm font-medium text-foreground">{selectedVoice.name}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Duration</p><p className="mt-1 text-sm font-medium text-foreground">{fmtTime(media.duration)}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Language</p><p className="mt-1 text-sm font-medium text-foreground">{media.language}</p></div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary" data-testid="voice-changer-download-audio"
              onClick={() => { const u = resultAudioUrl || resultUrl; if (u) window.open(u, "_blank"); else setToast({ kind: "error", msg: "No audio output available." }); }}>
              <Download className="h-4 w-4" aria-hidden="true" /> Download Audio
            </Button>
            {resultVideoUrl && (
              <Button variant="secondary" className="gap-2 border border-border bg-muted/30 text-foreground hover:bg-muted/60 hover:text-foreground" data-testid="voice-changer-download-video"
                onClick={() => { if (resultVideoUrl) window.open(resultVideoUrl, "_blank"); else setToast({ kind: "error", msg: "No video output available." }); }}>
                <Film className="h-4 w-4" aria-hidden="true" /> Download Video
              </Button>
            )}
            <Button variant="secondary" className="gap-2 border border-border bg-muted/30 text-foreground hover:bg-muted/60 hover:text-foreground" onClick={() => { setPhase("setup"); setProgress(0); }}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit Voice
            </Button>
            <Button className="ml-auto gap-2 bg-primary text-primary-foreground hover:bg-primary" data-testid="voice-changer-continue-publish-button"
              onClick={() => navigate("/publish")}>
              Continue to Publish <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </section>
      )}

      {/* SETUP: two-column workspace */}
      {media && phase === "setup" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          {/* LEFT column */}
          <div className="space-y-6">
            <MediaPlayer media={media} label="Source media" mockConverted={false} showMeta />

            {/* Source audio quality guidance */}
            <Card className="border-border bg-muted/30" data-testid="voice-changer-source-quality-note">
              <CardContent className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Volume2 className="h-4 w-4 text-primary" aria-hidden="true" /> Source audio also matters
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  The conversion preserves the source speech and delivery. Clear articulation and clean source audio generally produce better results.
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Noise, echo, mumbling, or distortion in the source may remain after voice conversion.
                </p>
              </CardContent>
            </Card>

            {/* Original Voice card */}
            <Card className="border-border bg-muted/30" data-testid="voice-changer-original-voice">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">Original Voice</h2>
                  <span className="rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-xs text-muted-foreground">Source voice</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-muted to-muted text-sm font-semibold text-foreground">OV</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Original Voice</p>
                    <p className="text-xs text-muted-foreground">Detected speaker</p>
                    <p className="mt-1 text-xs text-muted-foreground">{media.language} · {fmtTime(media.duration)}</p>
                  </div>
                  <Button variant="secondary" size="sm" className="gap-1.5 border border-border bg-muted/30 text-foreground hover:bg-muted/60 hover:text-foreground"
                    data-testid="voice-changer-preview-original-voice"
                    onClick={() => playPreview("original")}>
                    {previewing === "original"
                      ? <><span aria-hidden="true">■</span> Stop</>
                      : <><Play className="h-3.5 w-3.5" aria-hidden="true" /> Preview</>}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Before / After */}
            <Card className="border-border bg-muted/30" data-testid="voice-changer-compare">
              <CardContent className="p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Original Voice <span className="mx-1 text-muted-foreground/80">|</span> New Voice</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button variant="secondary" className="gap-2 border border-border bg-muted/30 text-foreground hover:bg-muted/60 hover:text-foreground"
                    data-testid="voice-changer-compare-original"
                    onClick={() => playPreview("original")}>
                    {previewing === "original" ? "■ Stop" : "▶ Original"}
                  </Button>
                  <Button variant="secondary" disabled={!selectedVoice || previewing === "target"}
                    className="gap-2 bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40"
                    data-testid="voice-changer-compare-new"
                    title={selectedVoice ? undefined : "Select a target voice first"}
                    onClick={() => playPreview("target")}>
                    {previewing === "target" ? "Loading…" : previewing === "target" ? "■ Stop" : "▶ New Voice"}
                  </Button>
                  <audio ref={previewAudioRef} className="hidden" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>

            {/* Rights notice (read-only after confirmation) */}
            <Card className="border-amber-500/25 bg-amber-500/[0.06]" data-testid="voice-changer-rights-section">
              <CardContent className="p-5">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-semibold text-amber-300">Voice Rights Notice</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Only upload or clone voices you own or have explicit permission to use. You are solely responsible for
                      voice licensing, consent, and compliance with applicable laws and third-party rights. DreamAgent does
                      not verify voice ownership or authorization.
                    </p>
                    {rightsConfirmed && (
                      <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Rights confirmed during project creation.
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT column */}
          <div className="space-y-6">
            {/* Target Voice */}
            <Card className="border-border bg-muted/30" data-testid="voice-changer-target-voice">
              <CardContent className="p-5">
                <h2 className="text-sm font-semibold text-foreground">Target Voice</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Choose the voice you want to use.</p>
                <p className="mt-2 text-xs leading-relaxed text-primary/80" data-testid="voice-changer-reference-quality-hint">
                  Better reference audio → better voice match. Use 30–60 seconds of clean, natural speech from one speaker for the best results.
                </p>

                <div className="relative mt-4">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input type="text" placeholder="Search voices" aria-label="Search voices" data-testid="voice-changer-search-input"
                    value={query} onChange={e => setQuery(e.target.value)}
                    className="w-full rounded-lg border border-border bg-muted/30 py-2 pl-9 pr-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50" />
                </div>

                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Voice filters" data-testid="voice-changer-filters">
                  {FILTERS.map(f => (
                    <button key={f} type="button" aria-pressed={filter === f}
                      data-testid={`voice-changer-filter-${f.toLowerCase().replace(/\s+/g, "-")}`}
                      onClick={() => setFilter(f)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        filter === f ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"}`}>
                      {f}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <label htmlFor="voice-sort" className="text-xs text-muted-foreground">Sort by</label>
                  <select id="voice-sort" aria-label="Sort voices" data-testid="voice-changer-sort-select"
                    value={sort} onChange={e => setSort(e.target.value as Sort)}
                    className="rounded-lg border border-border bg-muted/30 px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50">
                    <option>Recommended</option><option>Recently Added</option><option>Name</option>
                  </select>
                </div>

                <div className="mt-4 space-y-3" data-testid="voice-changer-voice-list">
                  {voices.length === 0 && (
                    <p className="rounded-lg border border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">No voices match your search.</p>
                  )}
                  {voices.map(v => {
                    const selected = selectedVoice?.id === v.id;
                    return (
                      <div key={v.id} role="radio" aria-checked={selected}
                        data-testid={`voice-changer-voice-${v.id}`}
                        className={`rounded-xl border p-3 transition-all ${
                          selected ? "border-primary/60 bg-primary/10 shadow-lg shadow-black/20" : "border-border bg-muted/30 hover:border-primary/30"}`}>
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                            style={{ background: `linear-gradient(135deg, hsl(${v.hue} 70% 55%), hsl(${v.hue + 30} 70% 45%))` }}>
                            {v.initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                              {v.name}
                              {v.personal && <span className="rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0 text-[11px] text-primary">Personal</span>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{v.desc}</p>
                            <p className="text-xs text-muted-foreground">{v.language}</p>
                          </div>
                        </div>
                        <div className="mt-2.5 flex justify-end gap-2">
                          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                            data-testid={`voice-changer-preview-${v.id}`}
                            onClick={() => setToast({ kind: "success", msg: `Previewing ${v.name}` })}>
                            <Play className="h-3 w-3" aria-hidden="true" /> Preview
                          </Button>
                          <Button size="sm"
                            className={`h-7 gap-1 px-3 text-xs ${selected ? "bg-primary text-primary-foreground hover:bg-primary" : "border border-border bg-muted/30 text-foreground hover:bg-muted/60"}`}
                            aria-pressed={selected}
                            data-testid={`voice-changer-select-${v.id}`}
                            onClick={() => { setSelectedVoice(v); setError(""); }}>
                            {selected ? <><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Selected</> : "Select"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Button variant="outline" size="sm" onClick={() => navigate("/my-voices")}
                  data-testid="voice-changer-add-voice-button"
                  className="mt-4 w-full gap-1.5 border-dashed border-border bg-transparent text-foreground hover:border-primary/40 hover:bg-primary/5">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add Voice
                </Button>
              </CardContent>
            </Card>

            {/* Voice Quality tips */}
            <Card className="border-primary/25 bg-primary/[0.05]" data-testid="voice-changer-quality-tips">
              <CardContent className="p-5">
                <button type="button" aria-expanded={tipsOpen} data-testid="voice-changer-quality-tips-toggle"
                  onClick={() => setTipsOpen(o => !o)}
                  className="flex w-full items-center justify-between gap-2 text-left">
                  <span className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <Info className="h-4 w-4 shrink-0" aria-hidden="true" /> Quality Tip: Your audio quality matters
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${tipsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Voice quality depends heavily on your recordings.
                </p>
                {tipsOpen && (
                  <div className="mt-3 space-y-3" data-testid="voice-changer-quality-tips-body">
                    <p className="text-xs font-medium text-foreground">For the best result:</p>
                    <ul className="space-y-1 text-xs text-muted-foreground" aria-label="For best results">
                      <li>• Use a clean 30–60 second target voice recording.</li>
                      <li>• Record one speaker only.</li>
                      <li>• Avoid music, echo, and background noise.</li>
                      <li>• Use natural speech with varied expression.</li>
                      <li>• Keep the source recording clear as well.</li>
                    </ul>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Think of voice conversion as replacing the speaker's voice while keeping the original speech. The cleaner the original and reference recordings, the better the result. Avoid background noise, music, echo, clipping, and distortion.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Voice Settings */}
            <Card className="border-border bg-muted/30" data-testid="voice-changer-settings">
              <CardContent className="p-5">
                <button type="button" aria-expanded={settingsOpen}
                  data-testid="voice-changer-settings-toggle"
                  onClick={() => setSettingsOpen(o => !o)}
                  className="flex w-full items-center justify-between text-left">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Voice Settings
                  </span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${settingsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {settingsOpen && (
                  <div className="mt-5 space-y-5" data-testid="voice-changer-settings-body">
                    {([
                      ["stability", "Stability", 0, 100],
                      ["similarity", "Similarity", 0, 100],
                      ["style", "Style / Expression", 0, 100],
                      ["speed", "Speed", 50, 150],
                      ["pitch", "Pitch", 0, 100],
                    ] as const).map(([key, label, min, max]) => (
                      <div key={key}>
                        <div className="mb-2 flex items-center justify-between">
                          <label htmlFor={`setting-${key}`} className="text-xs text-muted-foreground">{label}</label>
                          <span className="text-xs tabular-nums font-medium text-primary">{settings[key]}</span>
                        </div>
                        <Slider id={`setting-${key}`} value={[settings[key]]} min={min} max={max} step={1}
                          aria-label={label}
                          onValueChange={([v]) => setSettings(s => ({ ...s, [key]: v }))} />
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
                      data-testid="voice-changer-reset-settings-button"
                      className="gap-1.5 text-muted-foreground hover:text-foreground">
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset settings
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Generate */}
            <div className="space-y-2" data-testid="voice-changer-generate-section">
              {error && (
                <p role="alert" data-testid="voice-changer-error" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {error}
                </p>
              )}
              <Button onClick={startProcessing} data-testid="voice-changer-generate-button"
                className="w-full gap-2 bg-primary py-6 text-base font-semibold text-white hover:bg-primary">
                <Mic2 className="h-5 w-5" aria-hidden="true" /> Generate Voice
              </Button>
              <p className="text-center text-xs text-muted-foreground">Voice conversion will process the selected media.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Reusable media player card (works for both source and converted output). */
const MediaPlayer = ({ media, label, mockConverted, showMeta, src, srcKind }: {
  media: ProjectMedia; label: string; mockConverted: boolean; showMeta?: boolean;
  src?: string; srcKind?: "video" | "audio";
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(media.duration);
  const [volume, setVolume] = useState(1);
  const playUrl = src ?? media.url;
  const playKind = srcKind ?? media.kind;

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) { el.play().catch(() => {}); setPlaying(true); } else { el.pause(); setPlaying(false); }
  };

  const bars = Array.from({ length: 72 }, (_, i) =>
    25 + Math.abs(Math.sin(i * 0.63 + (mockConverted ? 2 : 0)) * 35) + Math.abs(Math.sin(i * 0.19)) * 40);

  return (
    <Card className="border-border bg-muted/30" data-testid={`voice-changer-media-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="space-y-4 p-4">
        {playKind === "video" ? (
          <video ref={ref} src={playUrl} poster={playKind === "video" ? media.thumbnail : undefined}
            className="aspect-video w-full rounded-lg bg-black"
            aria-label={`${label} video preview`}
            onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={e => setDuration(e.currentTarget.duration || media.duration)}
            onEnded={() => setPlaying(false)} />
        ) : (
          <div ref={containerRef} className="relative overflow-hidden rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex h-28 items-center gap-1" aria-hidden="true">
              {bars.map((h, i) => (
                <span key={i}
                  className={`w-full rounded-full ${mockConverted ? "bg-primary" : "bg-muted-foreground"} ${i / bars.length <= time / (duration || 1) ? "" : "opacity-25"}`}
                  style={{ height: `${h}%` }} />
              ))}
            </div>
            <audio ref={ref} src={playUrl} aria-label={`${label} audio preview`}
              onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={e => setDuration(e.currentTarget.duration || media.duration)}
              onEnded={() => setPlaying(false)} className="hidden" />
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button variant="secondary" size="sm" onClick={toggle} aria-label={playing ? "Pause" : "Play"}
            className="h-9 w-9 shrink-0 rounded-full bg-muted/30 p-0 text-foreground hover:bg-muted">
            {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </Button>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtTime(time)} / {fmtTime(duration)}</span>
          <Slider value={[time]} max={duration || 1} step={0.1}
            onValueChange={([v]) => { if (ref.current) { ref.current.currentTime = v; } setTime(v); }}
            aria-label="Seek timeline" className="flex-1" />
          <div className="flex w-28 shrink-0 items-center gap-2">
            <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Slider value={[volume]} max={1} step={0.05}
              onValueChange={([v]) => { setVolume(v); if (ref.current) ref.current.volume = v; }}
              aria-label="Volume" className="flex-1" />
          </div>
          {playKind === "video" && (
            <Button variant="ghost" size="sm" aria-label="Fullscreen"
              className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => containerRef.current?.requestFullscreen?.().catch(() => {}) || ref.current?.requestFullscreen?.().catch(() => {})}>
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        {showMeta && (
          <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-3">
            <div><span className="text-muted-foreground">Original file: </span><span className="truncate text-foreground">{media.name}</span></div>
            <div><span className="text-muted-foreground">Duration: </span><span className="text-foreground">{fmtTime(media.duration)}</span></div>
            <div><span className="text-muted-foreground">Language: </span><span className="text-foreground">{media.language}</span></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VoiceChanger;
