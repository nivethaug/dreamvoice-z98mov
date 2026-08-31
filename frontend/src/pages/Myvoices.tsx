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
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">My Voices</h1>
          <p className="mt-1 text-sm text-muted-foreground">Voices saved in your account ({voices.length}).</p>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="my-voices-grid">
          {filtered.map(v => (
            <Card key={v.voice_id}
              className="rounded-xl border-border bg-muted/30 transition-colors duration-200 hover:border-border hover:bg-muted/60"
              data-testid={`my-voices-card-${v.voice_id}`}>
              <CardContent className="space-y-3.5 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                    style={{ background: `hsl(${hueFor(v.voice_id)} 45% 55% / 0.16)`, color: `hsl(${hueFor(v.voice_id)} 70% 72%)` }}>
                    <Mic2 className="h-[18px] w-[18px]" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground">{v.name}</h3>
                    <p className="text-xs text-muted-foreground">{v.voice_type}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{(v.languages || []).join(" · ")}</p>
                    {v.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{v.description}</p>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label={`More options for ${v.name}`}
                        data-testid={`my-voices-more-${v.voice_id}`} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="border-border bg-card text-foreground">
                      <DropdownMenuItem onClick={() => useVoice(v)}>
                        <Mic2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Use in Voice Changer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`gap-1 ${v.authorized ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-primary/30 bg-primary/10 text-primary"}`}>
                    {v.authorized ? <><ShieldCheck className="h-3 w-3" aria-hidden="true" /> Authorized</> : "No reference audio"}
                  </Badge>
                  {v.reference_duration != null && (
                    <Badge variant="outline" className="rounded-md border-border bg-muted/30 px-1.5 py-0 text-xs font-normal text-muted-foreground">
                      Reference {formatDuration(v.reference_duration)}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => useVoice(v)}
                    data-testid={`my-voices-use-${v.voice_id}`}
                    className="h-8 gap-1.5 rounded-lg border-border bg-muted/30 text-xs text-foreground hover:bg-muted/60 hover:text-foreground">
                    Use Voice
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
