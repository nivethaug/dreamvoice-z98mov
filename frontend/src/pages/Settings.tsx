import { useEffect, useState } from "react";
import {
  Loader2, Settings as SettingsIcon, User, ShieldCheck, SlidersHorizontal,
  CheckCircle2, AlertCircle, Save, Youtube, Bell, Palette, Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

type Tab = "Profile" | "Security" | "Preferences";

interface Profile {
  name: string;
  email: string;
  studio: string;
}

const tabs: { id: Tab; icon: typeof User }[] = [
  { id: "Profile", icon: User },
  { id: "Security", icon: ShieldCheck },
  { id: "Preferences", icon: SlidersHorizontal },
];

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("Profile");
  const [profile, setProfile] = useState<Profile>({ name: "Arun Kumar", email: "arun@dreamagent.cloud", studio: "DreamVoice Studio" });
  const [errors, setErrors] = useState<Partial<Record<keyof Profile, string>>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null);
  const [prefs, setPrefs] = useState({ emails: true, processingAlerts: true, weeklyDigest: false });
  const [theme, setTheme] = useState("Dark");
  const [language, setLanguage] = useState("English");
  const [defaultStability, setDefaultStability] = useState(72);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const validate = (): boolean => {
    const e: Partial<Record<keyof Profile, string>> = {};
    if (profile.name.trim().length < 2) e.name = "Name must be at least 2 characters.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profile.email)) e.email = "Enter a valid email address.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (tab !== "Profile") { setToast({ kind: "success", msg: "Settings saved" }); return; }
    if (!validate()) { setToast({ kind: "error", msg: "Please fix the errors before saving." }); return; }
    setSaving(true);
    setTimeout(() => { setSaving(false); setToast({ kind: "success", msg: "Profile updated successfully" }); }, 900);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading settings…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      {toast && (
        <div role="status" aria-live="polite" className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur ${
          toast.kind === "success"
            ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-700 dark:text-emerald-300"
            : "border-red-500/30 bg-red-950/90 text-red-700 dark:text-red-300"}`}>
          {toast.kind === "success"
            ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            : <AlertCircle className="h-4 w-4" aria-hidden="true" />}
          {toast.msg}
        </div>
      )}

      <header>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          <SettingsIcon className="h-6 w-6 text-primary" aria-hidden="true" /> Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile, security, and studio preferences.</p>
      </header>

      {/* Tabs */}
      <div role="tablist" aria-label="Settings sections" className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              tab === t.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" aria-hidden="true" /> {t.id}
          </button>
        ))}
      </div>

      <Card className="border-border bg-muted/30">
        <CardContent className="space-y-6 p-6">
          {tab === "Profile" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-foreground">Full Name</Label>
                <Input
                  id="name"
                  value={profile.name}
                  onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                  aria-label="Full name"
                  className={`border-border bg-muted/30 text-foreground ${errors.name ? "border-red-500/60" : ""}`}
                />
                {errors.name && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{errors.name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={profile.email}
                  onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                  aria-label="Email address"
                  className={`border-border bg-muted/30 text-foreground ${errors.email ? "border-red-500/60" : ""}`}
                />
                {errors.email && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{errors.email}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="studio" className="text-foreground">Studio Name</Label>
                <Input
                  id="studio"
                  value={profile.studio}
                  onChange={e => setProfile(p => ({ ...p, studio: e.target.value }))}
                  aria-label="Studio name"
                  className="border-border bg-muted/30 text-foreground"
                />
              </div>
            </div>
          )}

          {tab === "Security" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="current-pw" className="text-foreground">Current Password</Label>
                <Input id="current-pw" type="password" placeholder="••••••••" aria-label="Current password" className="border-border bg-muted/30 text-foreground placeholder:text-muted-foreground/80" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-pw" className="text-foreground">New Password</Label>
                  <Input id="new-pw" type="password" placeholder="••••••••" aria-label="New password" className="border-border bg-muted/30 text-foreground placeholder:text-muted-foreground/80" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-pw" className="text-foreground">Confirm New Password</Label>
                  <Input id="confirm-pw" type="password" placeholder="••••••••" aria-label="Confirm new password" className="border-border bg-muted/30 text-foreground placeholder:text-muted-foreground/80" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Two-Factor Authentication</p>
                  <p className="text-xs text-muted-foreground">Require a verification code at sign-in.</p>
                </div>
                <Switch aria-label="Toggle two-factor authentication" />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <Youtube className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium text-foreground">YouTube Connection</p>
                    <p className="text-xs text-muted-foreground">Connect an account to publish directly.</p>
                  </div>
                </div>
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">Not connected</Badge>
              </div>
            </div>
          )}

          {tab === "Preferences" && (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-foreground"><Palette className="h-3.5 w-3.5" aria-hidden="true" /> Theme</Label>
                  <Select value={theme} onValueChange={setTheme}>
                    <SelectTrigger aria-label="Theme" className="w-full border-border bg-muted/30 text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="border-border bg-card text-foreground">
                      <SelectItem value="Dark">Dark</SelectItem>
                      <SelectItem value="System">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-foreground"><Globe className="h-3.5 w-3.5" aria-hidden="true" /> Interface Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger aria-label="Interface language" className="w-full border-border bg-muted/30 text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="border-border bg-card text-foreground">
                      {["English", "Tamil", "Hindi", "Telugu"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Default Voice Stability — <span className="tabular-nums text-primary">{defaultStability}</span></Label>
                <Slider
                  value={[defaultStability]}
                  onValueChange={v => setDefaultStability(v[0])}
                  min={0} max={100} step={1}
                  aria-label="Default voice stability"
                />
              </div>
              <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground"><Bell className="h-4 w-4" aria-hidden="true" /> Notifications</p>
                {([
                  ["emails", "Product emails", "News about DreamVoice features and updates."],
                  ["processingAlerts", "Processing alerts", "Notify me when a voice conversion finishes."],
                  ["weeklyDigest", "Weekly digest", "A weekly summary of studio activity."],
                ] as const).map(([key, title, desc]) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-foreground">{title}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch
                      checked={prefs[key]}
                      onCheckedChange={c => setPrefs(p => ({ ...p, [key]: c }))}
                      aria-label={title}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-border pt-5">
            <Button onClick={handleSave} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save Changes
            </Button>
            <Button variant="ghost" className="text-muted-foreground hover:bg-muted/60 hover:text-foreground">Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Settings;
