import { useEffect, useState } from "react";
import {
  Mic2, Library, Plus, Play, Pencil, Trash2, ShieldCheck, Loader2,
  AlertTriangle, CheckCircle2, Headphones, Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

interface Voice {
  id: number;
  name: string;
  note: string;
  language: string;
  style: string;
  created: string;
  hue: number;
  authorized: boolean;
}

const initialVoices: Voice[] = [
  { id: 1, name: "My Voice", note: "Personal voice", language: "Tamil", style: "Natural · Conversational", created: "Mar 2026", hue: 248, authorized: true },
  { id: 2, name: "Tamil Female Voice", note: "Personal authorized voice", language: "Tamil", style: "Warm · Clear", created: "Feb 2026", hue: 300, authorized: true },
  { id: 3, name: "Female Presenter", note: "Studio voice", language: "English (Indian)", style: "Warm · Clear · Professional", created: "Jan 2026", hue: 190, authorized: false },
  { id: 4, name: "Male Narrator", note: "Studio voice", language: "English", style: "Deep · Professional", created: "Jan 2026", hue: 25, authorized: false },
];

const languages = ["Tamil", "English", "Hindi", "Telugu", "Malayalam", "Kannada", "Other"];

const Myvoices = () => {
  const [loading, setLoading] = useState(true);
  const [voices, setVoices] = useState<Voice[]>(initialVoices);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [voiceName, setVoiceName] = useState("My Voice");
  const [language, setLanguage] = useState("Tamil");
  const [rights, setRights] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = voices.filter(v =>
    v.name.toLowerCase().includes(query.toLowerCase()) ||
    v.language.toLowerCase().includes(query.toLowerCase())
  );

  const canCreate = voiceName.trim().length > 0 && rights;

  const handleCreate = () => {
    if (!canCreate) return;
    setVoices(prev => [...prev, {
      id: Date.now(), name: voiceName, note: "Personal authorized voice",
      language, style: "Natural · Conversational", created: "Just now", hue: 160, authorized: true,
    }]);
    setCreateOpen(false);
    setVoiceName("My Voice");
    setRights(false);
    setToast("Voice created successfully");
  };

  const handleDelete = (id: number) => {
    setVoices(prev => prev.filter(v => v.id !== id));
    setToast("Voice deleted");
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
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
      {toast && (
        <div role="status" aria-live="polite" className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/90 px-4 py-3 text-sm text-emerald-300 shadow-xl backdrop-blur">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {toast}
        </div>
      )}

      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">My Voices</h1>
          <p className="mt-1 text-sm text-zinc-400">Your personal voice library for cloning and conversion.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="w-fit gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
          <Plus className="h-4 w-4" aria-hidden="true" /> Create Voice
        </Button>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search voices…"
          aria-label="Search voices"
          className="border-white/10 bg-white/[0.03] pl-9 text-zinc-100 placeholder:text-zinc-500"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed border-white/15 bg-white/[0.02]">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <Library className="h-10 w-10 text-zinc-600" aria-hidden="true" />
            <p className="font-medium text-zinc-300">No voices found</p>
            <p className="max-w-sm text-sm text-zinc-500">Create your first voice from an authorized sample to start using it in projects.</p>
            <Button onClick={() => setCreateOpen(true)} className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
              <Plus className="h-4 w-4" aria-hidden="true" /> Create Voice
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(v => (
            <Card key={v.id} className="border-white/10 bg-white/[0.03] transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-xl hover:shadow-indigo-950/40">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ background: `linear-gradient(135deg, hsl(${v.hue} 55% 45%), hsl(${v.hue + 40} 50% 30%))` }}>
                    <Mic2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-zinc-100">{v.name}</h3>
                      {v.authorized && (
                        <Badge variant="outline" className="shrink-0 gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Authorized
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">{v.note}</p>
                    <p className="mt-1 text-xs text-zinc-400">{v.language} · {v.style}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-600">Created {v.created}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary" size="sm"
                    onClick={() => { setPreviewing(v.id); setTimeout(() => setPreviewing(null), 1800); }}
                    className="gap-1.5 bg-white/10 text-xs text-zinc-200 hover:bg-white/15"
                  >
                    {previewing === v.id ? <Headphones className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
                    {previewing === v.id ? "Playing…" : "Preview"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setToast(`${v.name} selected for use`)} className="bg-indigo-500/15 text-xs text-indigo-300 hover:bg-indigo-500/25">Use Voice</Button>
                  <Button variant="ghost" size="sm" aria-label={`Edit ${v.name}`} className="text-zinc-400 hover:bg-white/5 hover:text-zinc-200">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Delete ${v.name}`} onClick={() => handleDelete(v.id)} className="text-zinc-400 hover:bg-red-500/10 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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

      {/* Create Voice dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent role="dialog" aria-label="Create a voice" className="max-h-[85vh] overflow-y-auto border-white/10 bg-[#12141a] text-zinc-100">
          <DialogHeader>
            <DialogTitle>Create a Voice</DialogTitle>
            <DialogDescription className="text-zinc-400">1 Upload Sample → 2 Review → 3 Create</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-8 text-center">
              <Mic2 className="h-7 w-7 text-zinc-500" aria-hidden="true" />
              <p className="text-sm font-medium text-zinc-200">Upload an authorized voice sample</p>
              <p className="text-xs text-zinc-500">WAV · MP3 · M4A</p>
              <Button variant="secondary" size="sm" className="mt-1 bg-white/10 text-zinc-200 hover:bg-white/15">Browse Files</Button>
              <p className="text-[11px] text-zinc-500">Use a clear recording with minimal background noise.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-name" className="text-zinc-300">Voice Name</Label>
              <Input id="voice-name" value={voiceName} onChange={e => setVoiceName(e.target.value)} className="border-white/10 bg-white/[0.04]" />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger aria-label="Language" className="w-full border-white/10 bg-white/[0.04]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#12141a] text-zinc-100">
                  {languages.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Card className="border-amber-500/25 bg-amber-500/[0.06]">
              <CardContent className="space-y-3 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Voice Rights &amp; Responsibility
                </p>
                <p className="text-xs leading-relaxed text-zinc-400">
                  Only upload or clone voices you own or have explicit permission to use. You are solely responsible for voice licensing, consent, and compliance with applicable laws and third-party rights. DreamAgent does not verify voice ownership or authorization.
                </p>
                <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-zinc-300">
                  <Checkbox checked={rights} onCheckedChange={c => setRights(c === true)} className="mt-0.5" />
                  I confirm that I have the necessary rights and authorization to use this voice and accept responsibility for its use.
                </label>
              </CardContent>
            </Card>
            <Button disabled={!canCreate} onClick={handleCreate} className="w-full bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-40">
              Create Voice
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Myvoices;
