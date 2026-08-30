import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mic2, Library, Plus, ShieldCheck, CheckCircle2, Search, MoreVertical,
  AlertTriangle, Loader2, X, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { listVoices, type BackendVoice } from "@/lib/backend";

type Sort = "Recently Added" | "Name";

const formatDuration = (s: number | null) => {
  if (!s) return null;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const hueFor = (id: number) => (id * 47) % 360;

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
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading voice library…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8" data-testid="my-voices-page">
      {toast && (
        <div role="status" aria-live="polite"
          className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur ${
            toast.kind === "success" ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-300" : "border-red-500/30 bg-red-950/90 text-red-300"}`}>
          {toast.kind === "success" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          {toast.msg}
          <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">My Voices</h1>
          <p className="mt-1 text-sm text-zinc-400">Voices saved in your account ({voices.length}).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load} data-testid="my-voices-refresh-button"
            className="gap-2 bg-white/10 text-zinc-200 hover:bg-white/15">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
          </Button>
          <Button onClick={() => navigate("/voices/create")} data-testid="my-voices-create-button"
            className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
            <Plus className="h-4 w-4" aria-hidden="true" /> Create Voice
          </Button>
        </div>
      </header>

      {/* Search / sort */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" data-testid="my-voices-controls">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search voices..."
            aria-label="Search voices" data-testid="my-voices-search-input"
            className="border-white/10 bg-white/[0.03] pl-9 text-zinc-100 placeholder:text-zinc-500" />
        </div>
        <label htmlFor="voice-sort" className="sr-only">Sort voices</label>
        <select id="voice-sort" aria-label="Sort voices" data-testid="my-voices-sort-select"
          value={sort} onChange={e => setSort(e.target.value as Sort)}
          className="w-fit rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-indigo-500/50">
          <option>Recently Added</option><option>Name</option>
        </select>
      </div>

      {error ? (
        <Card className="border-red-500/25 bg-red-500/[0.05]" data-testid="my-voices-error">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-8 w-8 text-red-400" aria-hidden="true" />
            <p className="text-sm text-red-300">{error}</p>
            <Button onClick={load} variant="secondary" className="gap-2 bg-white/10 text-zinc-200 hover:bg-white/15">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
            </Button>
          </CardContent>
        </Card>
      ) : voices.length === 0 ? (
        <Card className="border-dashed border-white/15 bg-white/[0.02]" data-testid="my-voices-empty">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <Library className="h-10 w-10 text-zinc-600" aria-hidden="true" />
            <p className="font-medium text-zinc-300">No voices yet</p>
            <p className="max-w-sm text-sm text-zinc-500">Create a voice with a reference recording to use it in conversions.</p>
            <Button onClick={() => navigate("/voices/create")} className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
              <Plus className="h-4 w-4" aria-hidden="true" /> Create Voice
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-white/15 bg-white/[0.02]">
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Search className="h-8 w-8 text-zinc-600" aria-hidden="true" />
            <p className="text-sm text-zinc-400">No voices match your search.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="my-voices-grid">
          {filtered.map(v => (
            <Card key={v.voice_id} className="border-white/10 bg-white/[0.03] transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-xl hover:shadow-indigo-950/40"
              data-testid={`my-voices-card-${v.voice_id}`}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ background: `linear-gradient(135deg, hsl(${hueFor(v.voice_id)} 55% 45%), hsl(${hueFor(v.voice_id) + 40} 50% 30%))` }}>
                    <Mic2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-zinc-100">{v.name}</h3>
                    <p className="text-xs text-zinc-500">{v.voice_type}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">{(v.languages || []).join(" · ")}</p>
                    {v.description && <p className="mt-0.5 truncate text-[11px] text-zinc-500">{v.description}</p>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label={`More options for ${v.name}`}
                        data-testid={`my-voices-more-${v.voice_id}`} className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-100">
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="border-white/10 bg-[#12141a] text-zinc-200">
                      <DropdownMenuItem onClick={() => useVoice(v)}>
                        <Mic2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Use in Voice Changer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`gap-1 ${v.authorized ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"}`}>
                    {v.authorized ? <><ShieldCheck className="h-3 w-3" aria-hidden="true" /> Authorized</> : "No reference audio"}
                  </Badge>
                  {v.reference_duration != null && (
                    <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-zinc-400">
                      Reference {formatDuration(v.reference_duration)}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => useVoice(v)}
                    data-testid={`my-voices-use-${v.voice_id}`} className="gap-1.5 bg-indigo-500/15 text-xs text-indigo-300 hover:bg-indigo-500/25">
                    Use Voice
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-amber-500/25 bg-amber-500/[0.06]" data-testid="my-voices-rights-notice">
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

export default Myvoices;
