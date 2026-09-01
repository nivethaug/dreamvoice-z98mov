import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mic2, Library, Plus, ShieldCheck, Search, Play, CheckCircle2,
  AlertTriangle, Loader2, X, RefreshCw, Calendar, Globe, Tag, MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listVoices, type BackendVoice } from "@/lib/backend";

type Sort = "Recently Added" | "Name";

const formatDuration = (s: number | null) => {
  if (!s) return null;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const hueFor = (id: number) => (id * 47) % 360;

const waveBarsFor = (id: number) =>
  Array.from({ length: 32 }, (_, i) => {
    const x = Math.sin((id * 7 + i * 3.7) * 1.3) * 0.5 + 0.5;
    const y = Math.cos((id * 11 + i * 2.1) * 0.9) * 0.5 + 0.5;
    return 0.2 + (x * 0.6 + y * 0.4) * 0.8;
  });

const Myvoices = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<BackendVoice[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("Recently Added");
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listVoices();
      setVoices(list);
    } catch (e: any) {
      setError(e?.message || "Could not load voices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    let list = voices.filter(v =>
      v.name.toLowerCase().includes(q) ||
      (v.description || "").toLowerCase().includes(q) ||
      (v.languages || []).join(" ").toLowerCase().includes(q));
    if (sort === "Recently Added") {
      list = [...list].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    } else if (sort === "Name") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [voices, query, sort]);

  const useVoice = (v: BackendVoice) => {
    try { localStorage.setItem("dreamvoice_pending_voice_id", String(v.voice_id)); } catch { /* noop */ }
    navigate("/voice-changer");
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading voice library…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-8 p-5 md:p-10" data-testid="my-voices-page">
      {toast && (
        <div role="status" aria-live="polite"
          className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur ${
            toast.kind === "success" ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-700 dark:text-emerald-300" : "border-red-500/30 bg-red-950/90 text-red-700 dark:text-red-300"}`}>
          {toast.kind === "success" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          {toast.msg}
          <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-[32px] font-bold leading-tight tracking-tight text-foreground">My Voices</h1>
          <p className="mt-1 text-sm text-muted-foreground">Voices saved in your account ({voices.length})</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load} data-testid="my-voices-refresh-button"
            className="h-9 gap-2 rounded-lg border-border bg-muted/30 text-sm text-foreground hover:bg-muted/60 hover:text-foreground">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
          </Button>
          <Button onClick={() => navigate("/voices/create")} data-testid="my-voices-create-button"
            className="h-9 gap-2 rounded-lg bg-primary text-sm text-white hover:bg-primary">
            <Plus className="h-4 w-4" aria-hidden="true" /> Create Voice
          </Button>
        </div>
      </header>

      {/* Search / sort */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" data-testid="my-voices-controls">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search voices..."
            aria-label="Search voices" data-testid="my-voices-search-input"
            className="h-9 rounded-lg border-border bg-muted/30 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/40" />
        </div>
        <label htmlFor="voice-sort" className="sr-only">Sort voices</label>
        <select id="voice-sort" aria-label="Sort voices" data-testid="my-voices-sort-select"
          value={sort} onChange={e => setSort(e.target.value as Sort)}
          className="h-9 w-fit rounded-lg border border-border bg-muted/30 px-2.5 text-xs text-foreground outline-none focus:border-primary/50">
          <option>Recently Added</option><option>Name</option>
        </select>
      </div>

      {error ? (
        <Card className="rounded-xl border-red-500/25 bg-red-500/[0.05]" data-testid="my-voices-error">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" aria-hidden="true" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <Button onClick={load} variant="secondary" className="h-9 gap-2 rounded-lg border-border bg-muted/30 text-sm text-foreground hover:bg-muted/60 hover:text-foreground">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
            </Button>
          </CardContent>
        </Card>
      ) : voices.length === 0 ? (
        <Card className="rounded-xl border-dashed border-border bg-muted/30" data-testid="my-voices-empty">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <Library className="h-10 w-10 text-muted-foreground/80" aria-hidden="true" />
            <p className="font-medium text-foreground">No voices yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">Create a voice with a reference recording to use it in conversions.</p>
            <Button onClick={() => navigate("/voices/create")} className="h-9 gap-2 rounded-lg bg-primary text-sm text-white hover:bg-primary">
              <Plus className="h-4 w-4" aria-hidden="true" /> Create Voice
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="rounded-xl border-dashed border-border bg-muted/30">
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Search className="h-8 w-8 text-muted-foreground/80" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No voices match your search.</p>
          </CardContent>
        </Card>
      ) : (
        <section className="space-y-3">
          <h2 className="text-[15px] font-bold text-foreground">Voice Library <span className="font-normal text-muted-foreground">({filtered.length})</span></h2>
          <div className="space-y-3" data-testid="my-voices-grid">
          {filtered.map(v => (
            <div key={v.voice_id}
              className="relative flex flex-col gap-6 rounded-2xl border border-border bg-card/60 p-6 transition-colors hover:border-border hover:bg-card md:flex-row md:items-center md:gap-6 lg:gap-8"
              data-testid={`my-voices-row-${v.voice_id}`}>
              {/* Zone 1 — info */}
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10"
                  style={{ color: `hsl(${hueFor(v.voice_id)} 65% 60%)` }} aria-hidden="true">
                  <Mic2 className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[15px] font-semibold text-foreground">{v.name}</h3>
                    <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 px-2 py-0 text-[10px] font-medium normal-case text-primary">Personal</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {(v.languages || []).length > 0 ? v.languages.join(" • ") : v.voice_type}
                  </p>
                  {v.description && <p className="mt-1 truncate text-xs text-muted-foreground/80">{v.description}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`gap-1 rounded-md px-2 py-0.5 text-[10px] ${v.authorized ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-muted-foreground/30 text-muted-foreground"}`}>
                      {v.authorized ? <><ShieldCheck className="h-3 w-3" aria-hidden="true" /> Authorized</> : "Not authorized"}
                    </Badge>
                    {v.reference_duration != null && (
                      <Badge variant="outline" className="rounded-md border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        Reference {formatDuration(v.reference_duration)}
                      </Badge>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => useVoice(v)}
                    data-testid={`my-voices-use-${v.voice_id}`}
                    className="mt-3 h-8 gap-1.5 rounded-lg border-border bg-muted/40 px-3 text-xs font-medium text-foreground hover:bg-muted/60">
                    <Play className="h-3 w-3 fill-current" aria-hidden="true" /> Use Voice
                  </Button>
                </div>
              </div>
              {/* Zone 2 — play + waveform */}
              <div className="flex shrink-0 flex-col items-center gap-2 md:w-[220px] lg:w-[300px]">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    aria-label={`Preview ${v.name}`}
                    data-testid={`my-voices-play-${v.voice_id}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/25 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => useVoice(v)}>
                    <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
                  </button>
                  <div className="flex h-12 w-32 items-center gap-[3px] text-muted-foreground/70 md:w-36 lg:w-56" aria-hidden="true">
                    {waveBarsFor(v.voice_id).map((h, i) => (
                      <span key={i} className="w-[3px] rounded-full bg-current" style={{ height: `${Math.round(h * 100)}%`, opacity: 0.3 + h * 0.6 }} />
                    ))}
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  0:00 / {v.reference_duration != null ? formatDuration(v.reference_duration) : "1:00"}
                </span>
              </div>
              {/* Zone 3 — metadata */}
              <div className="flex shrink-0 flex-col gap-2.5 md:pr-6">
                <div className="flex items-center gap-2 text-xs">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">Created</span>
                  <span className="ml-auto pl-4 text-foreground">{(v.created_at || "").slice(0, 10)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">Language</span>
                  <span className="ml-auto pl-4 text-foreground">{(v.languages || []).join(", ") || "—"}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">Type</span>
                  <span className="ml-auto pl-4 text-foreground">{v.voice_type || "Personal Voice"}</span>
                </div>
              </div>
              {/* Overflow menu */}
              <button type="button" aria-label={`More options for ${v.name}`}
                data-testid={`my-voices-more-${v.voice_id}`}
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          </div>
        </section>
      )}

      {/* Create next voice panel */}
      <button type="button" onClick={() => navigate("/voices/create")}
        data-testid="my-voices-create-panel"
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/[0.04] p-6 text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/[0.08] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="text-sm font-medium">Create your next voice</span>
      </button>

      <Card className="rounded-xl border-amber-500/25 bg-amber-500/[0.06]" data-testid="my-voices-rights-notice">
        <CardContent className="flex gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-amber-300">Voice Rights Notice</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Only upload or clone voices you own or have explicit permission to use. You are solely responsible for voice licensing, consent, and compliance with applicable laws and third-party rights. DreamAgent does not verify voice ownership or authorization.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Myvoices;
