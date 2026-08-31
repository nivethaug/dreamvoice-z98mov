import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Upload, Music, Play, Pause, Volume2, CheckCircle2,
  AlertTriangle, Loader2, RefreshCw, Trash2, ShieldCheck, X, Mic2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { voiceStore, type Voice } from "@/lib/voiceStore";
import { createVoice, uploadVoiceReference } from "@/lib/backend";

const AUDIO_TYPES = ["audio/wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a"];
const AUDIO_EXTS = ["wav", "mp3", "m4a"];
const MAX_SIZE = 100 * 1024 * 1024;
const MAX_DURATION = 600;

const LANGUAGES = ["Tamil", "English", "Hindi", "Telugu", "Malayalam", "Kannada", "Other"];
const CATEGORIES = ["Personal", "Professional", "Narrator", "Character", "Other"];
const STEPS = ["Upload Sample", "Review", "Create Voice"];

const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);
const fmtTime = (t: number) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

interface Sample {
  name: string;
  size: number;
  duration: number;
  format: string;
  url: string;
  quality: "Good" | "Needs improvement" | "Poor";
}

const CreateVoice = () => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);

  const [name, setName] = useState("My Voice");
  const [desc, setDesc] = useState("Personal voice for YouTube videos");
  const [langs, setLangs] = useState<string[]>(["Tamil", "English"]);
  const [category, setCategory] = useState("Personal");
  const [rightsOk, setRightsOk] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [volume, setVolume] = useState(1);

  // Real backend integration state
  const rawSampleRef = useRef<File | null>(null);
  const [backendError, setBackendError] = useState("");

  const [progressPct, setProgressPct] = useState(0);
  const [createFailed, setCreateFailed] = useState(false);
  const [createdVoice, setCreatedVoice] = useState<Voice | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewState, setPreviewState] = useState<"idle" | "generating" | "ready">("idle");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const fail = (msg: string) => { setError(msg); setToast({ kind: "error", msg }); };

  const readDuration = (file: File, url: string): Promise<number> =>
    new Promise(resolve => {
      const a = document.createElement("audio");
      a.preload = "metadata";
      a.src = url;
      a.onloadedmetadata = () => resolve(isFinite(a.duration) ? a.duration : 120);
      a.onerror = () => resolve(120);
    });

  const handleFile = async (file: File) => {
    setError("");
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!AUDIO_TYPES.includes(file.type) && !AUDIO_EXTS.includes(ext)) {
      return fail("Unsupported file type. Please upload WAV, MP3, or M4A.");
    }
    if (file.size > MAX_SIZE) {
      return fail("File is too large. Maximum audio size is 100 MB.");
    }
    const url = URL.createObjectURL(file);
    const duration = await readDuration(file, url);
    if (duration > MAX_DURATION) {
      URL.revokeObjectURL(url);
      return fail("This recording is too long. Maximum sample length is 10 minutes.");
    }
    // Keep the raw File for the backend upload on Create.
    rawSampleRef.current = file;
    setUploading(true);
    setProgress(0);
    const iv = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(iv); return 100; }
        return p + Math.random() * 18;
      });
    }, 180);
    setTimeout(() => {
      clearInterval(iv);
      setProgress(100);
      setUploading(false);
      const quality: Sample["quality"] = duration >= 30 && file.size > 1024 * 1024 ? "Good" : duration >= 10 ? "Needs improvement" : "Poor";
      setSample({ name: file.name, size: file.size, duration, format: ext.toUpperCase(), url, quality });
      setToast({ kind: "success", msg: "Voice sample uploaded" });
    }, 2200);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const removeSample = () => {
    if (sample) URL.revokeObjectURL(sample.url);
    setSample(null);
    setPlaying(false);
    setCurTime(0);
    setToast({ kind: "success", msg: "Sample removed" });
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };

  // Real backend voice creation: register voice, then upload the reference
  // sample. The backend marks the voice authorized once the reference passes
  // its checks (duration ≤ 10 min, valid audio).
  const startCreate = async () => {
    setStep(2);
    setCreateFailed(false);
    setBackendError("");
    setProgressPct(10);
    try {
      if (!rawSampleRef.current) throw new Error("Voice sample missing. Please upload it again.");
      const { voice_id } = await createVoice({
        name: name.trim() || "My Voice",
        description: desc.trim() || "Personal voice",
        languages: langs,
        voice_type: "personal",
      });
      setProgressPct(45);
      await uploadVoiceReference(voice_id, rawSampleRef.current);
      setProgressPct(100);
      const v = voiceStore.addVoice({
        name: name.trim() || "My Voice",
        type: "Personal",
        languages: langs,
        language: langs[0] ?? "English",
        desc: desc.trim() || "Personal voice",
        personal: true,
        authorized: true,
        category,
        addedAt: Date.now(),
        initials: (name.trim() || "My Voice").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase(),
        hue: 265,
      });
      voiceStore.updateVoice(v.id, { authorized: true, backendId: voice_id });
      setCreatedVoice(v);
      setToast({ kind: "success", msg: "Voice created" });
    } catch (err: unknown) {
      setBackendError(err instanceof Error ? err.message : "Voice creation failed. Please try again.");
      setCreateFailed(true);
    }
  };

  const useCreated = () => {
    if (createdVoice) voiceStore.setPendingVoiceId(createdVoice.id);
    navigate("/voice-changer");
  };

  const CREATE_STEPS = ["Uploading sample", "Analyzing recording", "Creating voice profile", "Preparing voice", "Finalizing"];
  const activeStep = Math.min(CREATE_STEPS.length - 1, Math.floor((progressPct / 100) * CREATE_STEPS.length));

  const canContinueStep1 = !!sample && name.trim() !== "" && langs.length > 0 && rightsOk;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8" data-testid="create-voice-page">
      {toast && (
        <div role="status" aria-live="polite"
          className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur ${
            toast.kind === "success" ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-300" : "border-red-500/30 bg-red-950/90 text-red-300"}`}>
          {toast.kind === "success" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          {toast.msg}
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}><X className="h-3.5 w-3.5 opacity-60" aria-hidden="true" /></button>
        </div>
      )}

      <header className="space-y-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/my-voices")} className="gap-1.5 text-zinc-400 hover:text-zinc-100">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to My Voices
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">Create a Voice</h1>
        <p className="text-sm text-zinc-400">Create a voice from an authorized voice recording.</p>
      </header>

      {/* Step indicator */}
      <ol className="flex items-center gap-2" aria-label="Create voice steps" data-testid="create-voice-steps">
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "active" : "todo";
          return (
            <li key={s} className="flex flex-1 items-center gap-2" aria-current={state === "active" ? "step" : undefined}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                state === "done" ? "bg-emerald-500/20 text-emerald-400" : state === "active" ? "bg-indigo-500 text-white" : "border border-white/15 text-zinc-500"}`}>
                {state === "done" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </div>
              <span className={`hidden text-xs sm:block ${state === "active" ? "text-zinc-100" : "text-zinc-500"}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-emerald-500/40" : "bg-white/[0.07]"}`} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      {/* STEP 0: Upload + details */}
      {step === 0 && (
        <div className="space-y-6">
          {/* Reference quality guidance */}
          <Card className="border-indigo-500/25 bg-indigo-500/[0.05]" data-testid="create-voice-quality-tips">
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold text-indigo-200">Get the best voice match</h2>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                Voice quality depends heavily on your recordings.
              </p>
              <p className="mt-2 text-xs font-medium text-zinc-300">For the best result:</p>
              <ul className="mt-1.5 grid gap-1.5 text-xs text-zinc-400 sm:grid-cols-2" aria-label="Reference recording tips">
                <li>• Use a clean 30–60 second target voice recording.</li>
                <li>• Record one speaker only.</li>
                <li>• Avoid music, echo, and background noise.</li>
                <li>• Use natural speech with varied expression.</li>
                <li>• Keep the source recording clear as well.</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-white/[0.07] bg-white/[0.02]" data-testid="create-voice-upload-section">
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-zinc-100">Upload Voice Sample</h2>

              {!sample && !uploading && (
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => inputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload voice sample — drop a file or browse"
                  data-testid="create-voice-dropzone"
                  className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                    dragging ? "border-indigo-500/70 bg-indigo-500/10" : "border-white/15 bg-white/[0.02] hover:border-indigo-500/40"}`}>
                  <Upload className="h-10 w-10 text-indigo-400" aria-hidden="true" />
                  <p className="text-sm font-medium text-zinc-200">Drop a clear voice recording here</p>
                  <p className="text-xs text-zinc-500">WAV · MP3 · M4A</p>
                  <Button variant="secondary" className="gap-2 border border-white/[0.08] bg-white/[0.04] text-zinc-100 hover:bg-white/[0.08]"
                    data-testid="create-voice-browse-button" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}>
                    Browse Files
                  </Button>
                  <p className="text-xs text-zinc-500">Audio up to 100 MB · Max 10 minutes</p>
                </div>
              )}

              {uploading && (
                <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-10" aria-live="polite" data-testid="create-voice-uploading">
                  <Loader2 className="h-8 w-8 animate-spin text-indigo-400" aria-hidden="true" />
                  <p className="text-sm text-zinc-300">Uploading sample… {Math.min(100, Math.round(progress))}%</p>
                  <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
                  </div>
                </div>
              )}

              <input ref={inputRef} type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" className="hidden"
                aria-label="Voice sample file input"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />

              {error && (
                <p role="alert" data-testid="create-voice-error" className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {error}
                </p>
              )}

              {sample && sample.quality !== "Good" && (
                <div role="alert" data-testid="create-voice-quality-warning"
                  className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    This recording may produce a lower-quality voice match. Try a clean 30–60 second recording with one speaker and minimal background noise.
                  </span>
                </div>
              )}

              {sample && (
                <div className="mt-4 space-y-4" data-testid="create-voice-sample-card">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-zinc-100">Voice Sample</h3>
                    <Badge variant="outline" className={
                      sample.quality === "Good" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : sample.quality === "Needs improvement" ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                      : "border-red-500/30 bg-red-500/10 text-red-400"}>
                      Sample quality: {sample.quality}
                    </Badge>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                      <span className="flex items-center gap-1.5 font-medium text-zinc-200"><Music className="h-3.5 w-3.5" aria-hidden="true" /> {sample.name}</span>
                      <span>Size: {fmtSize(sample.size)}</span>
                      <span>Duration: {fmtTime(sample.duration)}</span>
                      <span>Format: {sample.format}</span>
                    </div>
                    <div className="mt-3 flex h-16 items-end gap-[2px] rounded-lg bg-white/[0.02] p-2" aria-hidden="true">
                      {Array.from({ length: 60 }, (_, i) => (
                        <div key={i} className="flex-1 rounded-sm bg-indigo-500/50"
                          style={{ height: `${18 + Math.abs(Math.sin(i * 0.4)) * 75}%` }} />
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button size="sm" onClick={togglePlay} data-testid="create-voice-play-button"
                        className="h-8 gap-1.5 bg-indigo-500 text-white hover:bg-indigo-400">
                        {playing ? <><Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause</> : <><Play className="h-3.5 w-3.5" aria-hidden="true" /> Play</>}
                      </Button>
                      <span className="font-mono text-xs text-zinc-500">{fmtTime(curTime)} / {fmtTime(sample.duration)}</span>
                      <div className="flex items-center gap-1.5">
                        <Volume2 className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                        <input type="range" min={0} max={1} step={0.05} value={volume} aria-label="Sample playback volume"
                          data-testid="create-voice-volume"
                          onChange={e => { setVolume(Number(e.target.value)); if (audioRef.current) audioRef.current.volume = Number(e.target.value); }}
                          className="h-1 w-20 accent-indigo-500" />
                      </div>
                      <input type="range" min={0} max={sample.duration} step={0.1} value={curTime} aria-label="Sample playback position"
                        data-testid="create-voice-timeline"
                        onChange={e => { const t = Number(e.target.value); setCurTime(t); if (audioRef.current) audioRef.current.currentTime = t; }}
                        className="h-1 min-w-[120px] flex-1 accent-indigo-500" />
                    </div>
                    <audio ref={audioRef} src={sample.url} preload="metadata"
                      onTimeUpdate={e => setCurTime(e.currentTarget.currentTime)}
                      onEnded={() => setPlaying(false)} onPlay={() => setPlaying(true)} className="hidden" />
                    <div className="mt-4 flex gap-2">
                      <Button variant="outline" size="sm" data-testid="create-voice-replace-button"
                        onClick={() => inputRef.current?.click()} className="gap-1.5 border-white/15 text-zinc-300">
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Replace
                      </Button>
                      <Button variant="outline" size="sm" data-testid="create-voice-remove-button"
                        onClick={removeSample} className="gap-1.5 border-red-500/30 text-red-300 hover:bg-red-500/10">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <ul className="mt-5 grid gap-1.5 text-xs text-zinc-500 sm:grid-cols-2" aria-label="Recording recommendations">
                <li>• Clear speech</li><li>• Minimal background noise</li>
                <li>• One speaker</li><li>• No music</li>
                <li className="sm:col-span-2">• Natural speaking voice</li>
              </ul>
              <p className="mt-3 text-xs text-amber-400/90">Use only voices you own or have explicit permission to use.</p>
            </CardContent>
          </Card>

          {sample && (
            <Card className="border-white/[0.07] bg-white/[0.02]" data-testid="create-voice-details-section">
              <CardContent className="space-y-5 p-6">
                <h2 className="text-sm font-semibold text-zinc-100">Voice Details</h2>
                <div className="space-y-2">
                  <Label htmlFor="voice-name" className="text-zinc-300">Voice Name</Label>
                  <Input id="voice-name" value={name} onChange={e => setName(e.target.value)} data-testid="create-voice-name-input"
                    className="border-white/[0.08] bg-white/[0.04] text-zinc-100" placeholder="My Voice" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="voice-desc" className="text-zinc-300">Description</Label>
                  <Textarea id="voice-desc" rows={3} value={desc} onChange={e => setDesc(e.target.value)}
                    data-testid="create-voice-desc-input"
                    className="border-white/[0.08] bg-white/[0.04] text-zinc-100" placeholder="Personal voice for YouTube videos" />
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm text-zinc-300">Languages</legend>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Voice languages" data-testid="create-voice-languages">
                    {LANGUAGES.map(l => {
                      const on = langs.includes(l);
                      return (
                        <button key={l} type="button" aria-pressed={on} data-testid={`create-voice-lang-${l.toLowerCase()}`}
                          onClick={() => setLangs(ls => (on ? ls.filter(x => x !== l) : [...ls, l]))}
                          className={`rounded-full border px-3 py-1 text-xs ${on ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200" : "border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"}`}>
                          {l}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="space-y-2">
                  <Label htmlFor="voice-category" className="text-zinc-300">Voice Category</Label>
                  <select id="voice-category" value={category} aria-label="Voice category" data-testid="create-voice-category"
                    onChange={e => setCategory(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500/50">
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </CardContent>
            </Card>
          )}

          {sample && (
            <Card className="border-amber-500/25 bg-amber-500/[0.06]" data-testid="create-voice-rights-notice">
              <CardContent className="space-y-3 p-5">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-amber-300">Voice Rights & Responsibility</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                      Only upload or clone voices you own or have explicit permission to use. You are solely responsible for voice licensing, consent, and compliance with applicable laws and third-party rights. DreamAgent does not verify voice ownership or authorization.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox id="voice-rights" checked={rightsOk} onCheckedChange={c => setRightsOk(c === true)}
                    data-testid="create-voice-rights-checkbox" className="mt-0.5" />
                  <label htmlFor="voice-rights" className="text-xs leading-relaxed text-zinc-300">
                    I confirm that I have the necessary rights and authorization to use this voice and accept responsibility for its use.
                  </label>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button disabled={!canContinueStep1} onClick={() => setStep(1)} data-testid="create-voice-continue-button"
              className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
              Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 1: Review */}
      {step === 1 && sample && (
        <div className="space-y-6" data-testid="create-voice-review">
          <Card className="border-white/[0.07] bg-white/[0.02]">
            <CardContent className="space-y-5 p-6">
              <h2 className="text-sm font-semibold text-zinc-100">Review Voice</h2>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Voice Sample</p>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                    <span className="flex items-center gap-1.5 font-medium text-zinc-200"><Music className="h-3.5 w-3.5" aria-hidden="true" /> {sample.name}</span>
                    <span>{fmtSize(sample.size)}</span><span>{fmtTime(sample.duration)}</span><span>{sample.format}</span>
                  </div>
                  <div className="mt-3 flex h-12 items-end gap-[2px] rounded-lg bg-white/[0.02] p-2" aria-hidden="true">
                    {Array.from({ length: 60 }, (_, i) => (
                      <div key={i} className="flex-1 rounded-sm bg-indigo-500/50" style={{ height: `${18 + Math.abs(Math.sin(i * 0.4)) * 75}%` }} />
                    ))}
                  </div>
                </div>
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Voice Name</dt>
                  <dd className="mt-1 text-sm text-zinc-100">{name || "My Voice"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Languages</dt>
                  <dd className="mt-1 text-sm text-zinc-100">{langs.join(", ")}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Description</dt>
                  <dd className="mt-1 text-sm text-zinc-100">{desc || "Personal voice for YouTube videos"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rights confirmation</dt>
                  <dd className="mt-1 flex items-center gap-1.5 text-sm text-emerald-400">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Authorization confirmed
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)} data-testid="create-voice-review-back"
              className="border-white/15 text-zinc-300">Back</Button>
            <Button onClick={startCreate} data-testid="create-voice-review-continue"
              className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
              Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: Create / success / failed */}
      {step === 2 && sample && (
        <div className="space-y-6">
          {!createdVoice && !createFailed && (
            <Card className="border-white/[0.07] bg-white/[0.02]" data-testid="create-voice-processing">
              <CardContent className="space-y-6 p-8">
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-zinc-100">Creating your voice</h2>
                  <p className="mt-1 text-xs text-zinc-500">{Math.round(progressPct)}%</p>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="mx-auto flex h-20 max-w-md items-end justify-center gap-1" aria-hidden="true">
                  {Array.from({ length: 40 }, (_, i) => (
                    <div key={i} className="w-1.5 rounded-full bg-indigo-500/60"
                      style={{ height: `${20 + Math.abs(Math.sin(i * 0.6 + progressPct / 15)) * 70}%`, transition: "height 0.3s" }} />
                  ))}
                </div>
                <ol className="mx-auto max-w-sm space-y-2.5" aria-live="polite" data-testid="create-voice-steps-list">
                  {CREATE_STEPS.map((s, i) => (
                    <li key={s} className="flex items-center gap-2.5 text-sm">
                      {i < activeStep ? <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                        : i === activeStep ? <Loader2 className="h-4 w-4 animate-spin text-indigo-400" aria-hidden="true" />
                        : <div className="h-4 w-4 rounded-full border border-white/15" aria-hidden="true" />}
                      <span className={i < activeStep ? "text-zinc-400" : i === activeStep ? "text-zinc-100" : "text-zinc-600"}>{s}</span>
                    </li>
                  ))}
                </ol>
                <div className="text-center">
                  <Button variant="outline" onClick={() => { setStep(1); setProgressPct(0); }} data-testid="create-voice-cancel"
                    className="border-white/15 text-zinc-300">Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {createFailed && (
            <Card className="border-red-500/30 bg-red-500/[0.06]" data-testid="create-voice-failed">
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <AlertTriangle className="h-8 w-8 text-red-400" aria-hidden="true" />
                <p className="font-medium text-red-300">Voice creation failed</p>
                <p className="text-sm text-zinc-400">Something went wrong while creating your voice. Please try again.</p>
                <Button onClick={startCreate} className="bg-indigo-500 text-white hover:bg-indigo-400">Try Again</Button>
              </CardContent>
            </Card>
          )}

          {createdVoice && (
            <Card className="border-emerald-500/25 bg-white/[0.03]" data-testid="create-voice-success">
              <CardContent className="space-y-5 p-8">
                <div className="flex flex-col items-center gap-2 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-zinc-100">Voice Created</h2>
                </div>
                <div className="mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 text-white">
                    <Mic2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-zinc-100">{createdVoice.name}</p>
                    <p className="text-xs text-zinc-500">{createdVoice.desc}</p>
                    <p className="text-xs text-zinc-500">{createdVoice.languages.join(" · ")}</p>
                  </div>
                  <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ready
                  </Badge>
                </div>

                {previewOpen && (
                  <div className="mx-auto max-w-sm space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4" data-testid="create-voice-preview">
                    <p className="text-xs font-medium text-zinc-300">Voice Preview</p>
                    <p className="text-sm leading-relaxed text-zinc-400">“Hello, welcome to my channel. Today we're going to explore something interesting.”</p>
                    {previewState !== "idle" && (
                      <div className="flex h-12 items-end gap-1" aria-hidden="true">
                        {Array.from({ length: 36 }, (_, i) => (
                          <div key={i} className="flex-1 rounded-sm bg-indigo-500/60" style={{ height: `${15 + Math.abs(Math.sin(i * 0.5)) * 70}%` }} />
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={previewState === "generating"} onClick={() => { setPreviewState("generating"); setTimeout(() => setPreviewState("ready"), 1500); }}
                        className="gap-1.5 bg-indigo-500 text-white hover:bg-indigo-400">
                        {previewState === "generating" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Generating…</> : "Generate Preview"}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={previewState !== "ready"} className="gap-1.5 border border-white/[0.08] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08] hover:text-zinc-100">
                        <Play className="h-3.5 w-3.5" aria-hidden="true" /> Play
                      </Button>
                      <Button size="sm" variant="secondary" disabled className="gap-1.5 bg-white/[0.06] text-zinc-400">
                        <Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause
                      </Button>
                    </div>
                    <p className="text-xs text-amber-400">Demo preview — no real audio is generated yet.</p>
                  </div>
                )}

                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" onClick={() => setPreviewOpen(o => !o)} data-testid="create-voice-success-preview"
                    className="border-white/15 text-zinc-300">Preview Voice</Button>
                  <Button onClick={useCreated} data-testid="create-voice-success-use"
                    className="bg-indigo-500 text-white hover:bg-indigo-400">Use Voice</Button>
                  <Button variant="ghost" onClick={() => navigate("/my-voices")} data-testid="create-voice-success-back"
                    className="text-zinc-400 hover:text-zinc-100">Back to My Voices</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default CreateVoice;
