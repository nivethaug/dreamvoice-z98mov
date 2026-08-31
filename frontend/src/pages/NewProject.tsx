import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, Film, Music, Loader2, CheckCircle2, AlertTriangle, Trash2,
  RefreshCw, Play, Pause, Volume2, Mic2, FileText, Languages, Sparkles,
  ArrowRight, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { projectStore } from "@/lib/projectStore";
import { uploadSourceMedia } from "@/lib/backend";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";

type MediaKind = "video" | "audio";
type UploadState = "empty" | "uploading" | "complete" | "error";

interface UploadedFile {
  name: string;
  kind: MediaKind;
  ext: string;
  size: number; // bytes
  duration: number; // seconds
  url: string;
  thumbnail?: string;
}

const VIDEO_EXTS = ["mp4", "mov"];
const AUDIO_EXTS = ["mp3", "wav", "m4a"];
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30 * 60;

const fmtSize = (b: number) =>
  b >= 1024 * 1024 * 1024 ? `${(b / 1024 ** 3).toFixed(2)} GB`
  : b >= 1024 * 1024 ? `${(b / 1024 ** 2).toFixed(1)} MB`
  : `${(b / 1024).toFixed(0)} KB`;

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

const actions = [
  { id: "change-voice", title: "Change Voice", desc: "Replace the speaker's voice while preserving the recording.", icon: Mic2 },
  { id: "transcribe", title: "Transcribe", desc: "Turn speech into editable text.", icon: FileText },
  { id: "dub", title: "Dub", desc: "Translate and voice your content.", icon: Languages },
];

/** Probe duration (and thumbnail for video) via a temporary media element. */
const probeMedia = (file: File): Promise<{ duration: number; thumbnail?: string }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith("video") || VIDEO_EXTS.includes(file.name.split(".").pop()!.toLowerCase()) ? "video" : "audio") as HTMLVideoElement;
    el.preload = "metadata";
    el.src = url;
    el.onloadedmetadata = () => {
      const duration = el.duration;
      let thumbnail: string | undefined;
      const done = () => { URL.revokeObjectURL(url); resolve({ duration, thumbnail }); };
      if (el.tagName === "VIDEO" && isFinite(duration) && duration > 0) {
        el.currentTime = Math.min(1, duration / 3);
        el.onseeked = () => {
          try {
            const c = document.createElement("canvas");
            c.width = 320;
            c.height = Math.round((el.videoHeight / (el.videoWidth || 1)) * 320) || 180;
            c.getContext("2d")!.drawImage(el, 0, 0, c.width, c.height);
            thumbnail = c.toDataURL("image/jpeg", 0.6);
          } catch { /* tainted/draw failure is fine */ }
          done();
        };
      } else done();
    };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read media file.")); };
  });

const NewProject = () => {
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("empty");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null);
  const [action, setAction] = useState("change-voice");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const rawFileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const isVideo = VIDEO_EXTS.includes(ext);
    const isAudio = AUDIO_EXTS.includes(ext);
    setError("");
    if (!isVideo && !isAudio) {
      setError("Unsupported file type. Please upload MP4, MOV, MP3, WAV, or M4A.");
      setToast({ kind: "error", msg: "Unsupported file type" });
      return;
    }
    const max = isVideo ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
    if (f.size > max) {
      const msg = `File is too large. Maximum ${isVideo ? "video" : "audio"} size is ${isVideo ? "500" : "100"} MB.`;
      setError(msg);
      setToast({ kind: "error", msg });
      return;
    }
    // Duration probe
    let meta: { duration: number; thumbnail?: string };
    try {
      meta = await probeMedia(f);
    } catch {
      setError("Upload error. Could not read this media file.");
      setToast({ kind: "error", msg: "Upload error — could not read file" });
      setUploadState("error");
      return;
    }
    if (meta.duration > MAX_DURATION_SECONDS) {
      const msg = `This ${isVideo ? "video" : "audio"} is too long. Maximum duration is 30 minutes.`;
      setError(msg);
      setToast({ kind: "error", msg });
      return;
    }
    // Keep the raw File so Continue can upload it to the backend.
    rawFileRef.current = f;
    // Simulated upload progress (local file, no backend yet)
    setUploadState("uploading");
    setProgress(0);
    const replacing = !!file;
    const wasRemoved = useRefRemoved.current;
    useRefRemoved.current = false;
    const iv = setInterval(() => {
      setProgress(p => {
        const next = Math.min(100, p + 8 + Math.random() * 10);
        if (next >= 100) {
          clearInterval(iv);
          setFile({
            name: f.name, kind: isVideo ? "video" : "audio", ext: ext.toUpperCase(),
            size: f.size, duration: meta.duration, url: URL.createObjectURL(f), thumbnail: meta.thumbnail,
          });
          setUploadState("complete");
          setToast({ kind: "success", msg: replacing ? "File replaced" : wasRemoved ? "Ready when you are" : "Upload complete" });
        }
        return next;
      });
    }, 180);
  }, [file]);

  const useRefRemoved = useRef(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const removeFile = () => {
    if (file) URL.revokeObjectURL(file.url);
    useRefRemoved.current = true;
    setFile(null);
    setUploadState("empty");
    setProgress(0);
    setError("");
    setToast({ kind: "success", msg: "File removed" });
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 p-4 md:p-8" data-testid="new-project-page">
      {toast && (
        <div role="status" aria-live="polite"
          className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur ${
            toast.kind === "success"
              ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-700 dark:text-emerald-300"
              : "border-red-500/30 bg-red-950/90 text-red-700 dark:text-red-300"}`}>
          {toast.kind === "success"
            ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          {toast.msg}
          <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">Create Voice Project</h1>
          <p className="mt-1 text-sm text-muted-foreground">Upload a video or audio file to begin.</p>
        </div>
        <Button variant="ghost" onClick={() => navigate("/")} className="w-fit text-muted-foreground hover:text-foreground">Back to Studio</Button>
      </header>

      {/* Upload area */}
      {!file && uploadState !== "complete" && (
        <section aria-label="Upload area">
          <div
            role="button" tabIndex={0}
            aria-label="Upload your media file. Drag and drop or browse files."
            data-testid="new-project-upload-area"
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            onDragEnter={e => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
            onDragOver={e => e.preventDefault()}
            onDragLeave={e => { e.preventDefault(); if (--dragDepth.current <= 0) setDragging(false); }}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed px-6 py-8 text-center transition-colors ${
              dragging
                ? "border-border bg-muted/30"
                : error
                  ? "border-red-500/40 bg-red-500/[0.04]"
                  : "border-border bg-muted/30 hover:border-muted-foreground/40 hover:bg-muted/60"}`}
          >
            {uploadState === "uploading" ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-foreground" aria-hidden="true" />
                <p className="font-medium text-foreground">Uploading…</p>
                <div className="w-64 max-w-full"><Progress value={progress} className="h-2" /></div>
              </>
            ) : dragging ? (
              <>
                <Upload className="h-7 w-7 text-foreground" aria-hidden="true" />
                <p className="font-medium text-foreground">Drop your file to upload</p>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">Drop your video or audio here</p>
                <p className="text-xs text-muted-foreground">MP4 · MOV · MP3 · WAV · M4A</p>
                <Button variant="outline" size="sm" className="h-8 rounded-lg border-border bg-transparent text-foreground hover:bg-muted/60 hover:text-foreground" data-testid="new-project-browse-button">
                  Browse Files
                </Button>
              </>
            )}
            <p className="text-xs text-muted-foreground">Video up to 500 MB · Audio up to 100 MB · Max 30 minutes</p>
            {error && (
              <p role="alert" data-testid="new-project-upload-error" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {error}
              </p>
            )}
          </div>
          <input ref={inputRef} type="file" accept=".mp4,.mov,.mp3,.wav,.m4a,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-m4a"
            aria-label="File input" className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
        </section>
      )}

      {/* Uploaded file card + preview */}
      {file && uploadState === "complete" && (
        <section aria-label="Uploaded file" className="space-y-4" data-testid="new-project-file-card-section">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {file.thumbnail ? (
                <img src={file.thumbnail} alt="" aria-hidden="true" className="aspect-video h-11 w-[72px] shrink-0 rounded-lg border border-border object-cover" />
              ) : (
                <div className="flex aspect-video h-11 w-[72px] shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
                  {file.kind === "video" ? <Film className="h-4 w-4" aria-hidden="true" /> : <Music className="h-4 w-4" aria-hidden="true" />}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {file.kind === "video" ? "Video" : "Audio"} · {file.ext} · {fmtSize(file.size)} · {fmtTime(file.duration)}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Upload complete
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" data-testid="new-project-replace-button"
                className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => inputRef.current?.click()}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Replace
              </Button>
              <Button variant="ghost" size="sm" data-testid="new-project-remove-button"
                className="h-8 gap-1.5 text-muted-foreground hover:text-red-600 dark:text-red-400" onClick={removeFile}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
              </Button>
            </div>
          </div>
          <MediaPreview file={file} />
        </section>
      )}

      {/* Choose action */}
      {file && uploadState === "complete" && (
        <section aria-labelledby="action-heading" data-testid="new-project-action-section">
          <h2 id="action-heading" className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">What do you want to do?</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {actions.map(a => {
              const selected = action === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={selected}
                  data-testid={`new-project-action-${a.id}`}
                  onClick={() => setAction(a.id)}
                  className={`flex h-full flex-col gap-3 rounded-xl border p-5 text-left transition-colors ${
                    selected
                      ? "border-border bg-muted/30"
                      : "border-border bg-muted/30 hover:border-muted-foreground/40 hover:bg-muted/60"}`}>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    selected ? "bg-foreground text-background" : "bg-muted/30 text-muted-foreground"}`}>
                    <a.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{a.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.desc}</p>
                  </div>
                  {selected && <span className="flex items-center gap-1 text-xs font-medium text-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Selected
                  </span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Rights notice */}
      {file && uploadState === "complete" && (
        <Card className="border-amber-500/25 bg-amber-500/[0.06]" data-testid="new-project-rights-section">
          <CardContent className="space-y-4 p-5">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-amber-300">Voice Rights Notice</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Only upload or clone voices you own or have explicit permission to use. You are solely responsible for
                  voice licensing, consent, and compliance with applicable laws and third-party rights. DreamAgent does
                  not verify voice ownership or authorization.
                </p>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground">
              <Checkbox
                checked={rightsConfirmed}
                onCheckedChange={v => { setRightsConfirmed(v === true); projectStore.setRights(v === true); }}
                aria-label="Confirm voice rights and authorization"
                data-testid="new-project-rights-checkbox"
                className="mt-0.5" />
              <span>I confirm that I have the necessary rights and authorization to use this voice and accept responsibility for its use.</span>
            </label>
            {!rightsConfirmed && (
              <p className="text-xs text-muted-foreground" role="note">You must confirm voice rights before continuing.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Continue */}
      {file && uploadState === "complete" && (
        <div className="flex justify-end">
          <Button
            disabled={!rightsConfirmed || sending}
            data-testid="new-project-continue-button"
            onClick={async () => {
              setError("");
              // Upload the raw file to the backend so conversion can access it.
              let mediaId: string | undefined;
              if (rawFileRef.current) {
                setSending(true);
                try {
                  const up = await uploadSourceMedia(rawFileRef.current);
                  mediaId = up.media_id;
                } catch (e) {
                  setSending(false);
                  setError(e instanceof Error ? e.message : "Upload failed. Please try again.");
                  return;
                }
                setSending(false);
              }
              if (file) {
                projectStore.setMedia({
                  name: file.name, kind: file.kind, ext: file.ext, size: file.size,
                  duration: file.duration, url: file.url, thumbnail: file.thumbnail,
                  language: "English",
                  ...(mediaId ? { mediaId } : {}),
                });
              }
              navigate("/voice-changer");
            }}
            className="h-9 gap-1.5 rounded-lg bg-primary px-4 text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
            Continue
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
};

/** Media preview player — video or audio with waveform-style visualization. */
const MediaPreview = ({ file }: { file: UploadedFile }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(file.duration);
  const [volume, setVolume] = useState(1);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) { el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); }
  };

  const seek = (v: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = v;
    setTime(v);
  };

  // Static pseudo-waveform bars derived from the filename (deterministic).
  const bars = Array.from({ length: 64 }, (_, i) =>
    25 + Math.abs(Math.sin(i * 0.7 + file.name.length) * 35) + Math.abs(Math.sin(i * 0.21)) * 40
  );

  return (
    <Card className="border-border bg-muted/30" data-testid="new-project-media-preview">
      <CardContent className="space-y-4 p-4">
        {file.kind === "video" ? (
          <video
            ref={ref}
            src={file.url}
            poster={file.thumbnail}
            className="aspect-video w-full rounded-lg bg-black"
            aria-label={`Video preview of ${file.name}`}
            onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={e => setDuration(e.currentTarget.duration || file.duration)}
            onEnded={() => setPlaying(false)}
          />
        ) : (
          <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30 p-4" aria-hidden="true">
            <div className="flex h-24 items-center gap-1">
              {bars.map((h, i) => (
                <span key={i}
                  className={`w-full rounded-sm transition-colors ${i / bars.length <= time / (duration || 1) ? "bg-foreground/60" : "bg-muted"}`}
                  style={{ height: `${h}%` }} />
              ))}
            </div>
            <audio ref={ref} src={file.url} aria-label={`Audio preview of ${file.name}`}
              onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={e => setDuration(e.currentTarget.duration || file.duration)}
              onEnded={() => setPlaying(false)}
              className="hidden" />
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button variant="secondary" size="sm" onClick={toggle} aria-label={playing ? "Pause" : "Play"}
            data-testid="new-project-preview-play-button"
            className="h-9 w-9 shrink-0 rounded-full bg-muted/30 p-0 text-foreground hover:bg-muted">
            {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </Button>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtTime(time)} / {fmtTime(duration)}</span>
          <Slider
            value={[time]}
            max={duration || 1}
            step={0.1}
            onValueChange={([v]) => seek(v)}
            aria-label="Seek timeline"
            className="flex-1" />
          <div className="flex w-32 shrink-0 items-center gap-2">
            <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Slider value={[volume]} max={1} step={0.05}
              onValueChange={([v]) => { setVolume(v); if (ref.current) ref.current.volume = v; }}
              aria-label="Volume" className="flex-1" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default NewProject;
