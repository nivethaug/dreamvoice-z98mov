import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mic2, Library, Plus, Play, ShieldCheck, CheckCircle2, Search, MoreVertical,
  Pencil, Copy, Trash2, AlertTriangle, Loader2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { voiceStore, type Voice } from "@/lib/voiceStore";

const FILTERS = ["All", "My Voices", "AI Voices", "Tamil", "English", "Hindi", "Other"] as const;
type Filter = (typeof FILTERS)[number];
type Sort = "Recommended" | "Recently Added" | "Name";

const Myvoices = () => {
  const navigate = useNavigate();
  const [, force] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [sort, setSort] = useState<Sort>("Recommended");
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null);

  const [previewVoice, setPreviewVoice] = useState<Voice | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "generating" | "ready" | "playing">("idle");

  const [editVoice, setEditVoice] = useState<Voice | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [deleteVoice, setDeleteVoice] = useState<Voice | null>(null);

  useEffect(() => voiceStore.subscribe(() => force(n => n + 1)), []);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 400); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const voices = voiceStore.getVoices();
  const personalCount = voices.filter(v => v.personal).length;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    let list = voices.filter(v =>
      v.name.toLowerCase().includes(q) || v.desc.toLowerCase().includes(q) ||
      v.languages.join(" ").toLowerCase().includes(q));
    if (filter === "My Voices") list = list.filter(v => v.personal);
    else if (filter === "AI Voices") list = list.filter(v => !v.personal);
    else if (filter !== "All") list = list.filter(v => v.languages.includes(filter));
    if (sort === "Recently Added") list = [...list].sort((a, b) => b.addedAt - a.addedAt);
    else if (sort === "Name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [voices, query, filter, sort]);

  const useVoice = (v: Voice) => {
    voiceStore.setPendingVoiceId(v.id);
    navigate("/voice-changer");
  };

  const openPreview = (v: Voice) => { setPreviewVoice(v); setPreviewState("idle"); };
  const generatePreview = () => {
    setPreviewState("generating");
    setTimeout(() => setPreviewState("ready"), 1600);
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
          <p className="mt-1 text-sm text-zinc-400">Manage your personal and authorized voices.</p>
        </div>
        <Button onClick={() => navigate("/voices/create")} data-testid="my-voices-create-button"
          className="w-fit gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
          <Plus className="h-4 w-4" aria-hidden="true" /> Create Voice
        </Button>
      </header>

      {/* Search / filter / sort */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" data-testid="my-voices-controls">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search voices..."
            aria-label="Search voices" data-testid="my-voices-search-input"
            className="border-white/10 bg-white/[0.03] pl-9 text-zinc-100 placeholder:text-zinc-500" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Voice filters" data-testid="my-voices-filters">
            {FILTERS.map(f => (
              <button key={f} type="button" aria-pressed={filter === f}
                data-testid={`my-voices-filter-${f.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                  filter === f ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200"}`}>
                {f}
              </button>
            ))}
          </div>
          <label htmlFor="voice-sort" className="sr-only">Sort voices</label>
          <select id="voice-sort" aria-label="Sort voices" data-testid="my-voices-sort-select"
            value={sort} onChange={e => setSort(e.target.value as Sort)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-indigo-500/50">
            <option>Recommended</option><option>Recently Added</option><option>Name</option>
          </select>
        </div>
      </div>

      {personalCount === 0 ? (
        <Card className="border-dashed border-white/15 bg-white/[0.02]" data-testid="my-voices-empty">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <Library className="h-10 w-10 text-zinc-600" aria-hidden="true" />
            <p className="font-medium text-zinc-300">No personal voices yet</p>
            <p className="max-w-sm text-sm text-zinc-500">Create an authorized voice to use across your DreamVoice projects.</p>
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
            <Card key={v.id} className="border-white/10 bg-white/[0.03] transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-xl hover:shadow-indigo-950/40"
              data-testid={`my-voices-card-${v.id}`}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ background: `linear-gradient(135deg, hsl(${v.hue} 55% 45%), hsl(${v.hue + 40} 50% 30%))` }}>
                    <Mic2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-zinc-100">{v.name}</h3>
                    <p className="text-xs text-zinc-500">{v.type}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">{v.languages.join(" · ")}</p>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">{v.desc}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label={`More options for ${v.name}`}
                        data-testid={`my-voices-more-${v.id}`} className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-100">
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="border-white/10 bg-[#12141a] text-zinc-200">
                      <DropdownMenuItem onClick={() => { setEditVoice(v); setEditName(v.name); setEditDesc(v.desc); }}>
                        <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { voiceStore.duplicateVoice(v.id); setToast({ kind: "success", msg: `${v.name} duplicated` }); }}>
                        <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-400 focus:text-red-300" onClick={() => setDeleteVoice(v)}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div>
                  <Badge variant="outline" className={`gap-1 ${v.authorized ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"}`}>
                    {v.authorized ? <><ShieldCheck className="h-3 w-3" aria-hidden="true" /> Authorized voice</> : "Synthetic voice"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => openPreview(v)}
                    data-testid={`my-voices-preview-${v.id}`} className="gap-1.5 bg-white/10 text-xs text-zinc-200 hover:bg-white/15">
                    <Play className="h-3.5 w-3.5" aria-hidden="true" /> Preview
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => useVoice(v)}
                    data-testid={`my-voices-use-${v.id}`} className="gap-1.5 bg-indigo-500/15 text-xs text-indigo-300 hover:bg-indigo-500/25">
                    Use Voice
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Preview modal */}
      <Dialog open={!!previewVoice} onOpenChange={o => { if (!o) setPreviewVoice(null); }}>
        <DialogContent role="dialog" aria-label="Voice preview" className="border-white/10 bg-[#12141a] text-zinc-100">
          <DialogHeader>
            <DialogTitle>Voice Preview — {previewVoice?.name}</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Demo placeholder — no real audio is generated yet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-300">
              “Hello, welcome to my channel. Today we're going to explore something interesting.”
            </div>
            {previewState !== "idle" && (
              <div className="flex h-16 items-end gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-3" aria-hidden="true">
                {Array.from({ length: 48 }, (_, i) => (
                  <div key={i} className="flex-1 rounded-sm bg-indigo-500/60"
                    style={{ height: `${15 + Math.abs(Math.sin(i * 0.5)) * 70}%`, opacity: previewState === "generating" ? 0.35 : 0.8 }} />
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={generatePreview} disabled={previewState === "generating"}
                data-testid="my-voices-generate-preview" className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
                {previewState === "generating" ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Generating…</> : "Generate Preview"}
              </Button>
              <Button variant="secondary" disabled={previewState !== "ready" && previewState !== "playing"}
                onClick={() => setPreviewState(s => (s === "playing" ? "ready" : "playing"))}
                data-testid="my-voices-play-preview" className="gap-2 bg-white/10 text-zinc-200 hover:bg-white/15">
                {previewState === "playing" ? <>Pause</> : <><Play className="h-4 w-4" aria-hidden="true" /> Play</>}
              </Button>
            </div>
            {previewState === "ready" && <p className="text-xs text-amber-400">Demo preview — real voice generation connects in the next phase.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editVoice} onOpenChange={o => { if (!o) setEditVoice(null); }}>
        <DialogContent role="dialog" aria-label="Edit voice" className="border-white/10 bg-[#12141a] text-zinc-100">
          <DialogHeader>
            <DialogTitle>Edit Voice</DialogTitle>
            <DialogDescription className="text-zinc-400">Update the details for this voice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-zinc-300">Voice Name</Label>
              <Input id="edit-name" value={editName} onChange={e => setEditName(e.target.value)}
                className="border-white/10 bg-white/[0.04]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-desc" className="text-zinc-300">Description</Label>
              <Textarea id="edit-desc" value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3}
                className="border-white/10 bg-white/[0.04]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditVoice(null)}>Cancel</Button>
            <Button disabled={!editName.trim()} onClick={() => {
              if (editVoice) voiceStore.updateVoice(editVoice.id, { name: editName.trim(), desc: editDesc.trim() });
              setEditVoice(null);
              setToast({ kind: "success", msg: "Voice updated" });
            }} className="bg-indigo-500 text-white hover:bg-indigo-400">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteVoice} onOpenChange={o => { if (!o) setDeleteVoice(null); }}>
        <DialogContent role="dialog" aria-label="Delete voice" className="border-white/10 bg-[#12141a] text-zinc-100">
          <DialogHeader>
            <DialogTitle>Delete this voice?</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Deleting this voice will remove it from your voice library.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteVoice(null)} data-testid="my-voices-delete-cancel">Cancel</Button>
            <Button variant="destructive" data-testid="my-voices-delete-confirm"
              onClick={() => {
                if (deleteVoice) voiceStore.deleteVoice(deleteVoice.id);
                setToast({ kind: "success", msg: "Voice deleted" });
                setDeleteVoice(null);
              }}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
