import { useEffect, useMemo, useState } from "react";
import {
  Users, FolderKanban, CheckCircle2, XCircle, Loader2, Mic2,
  Database, Clock, Search, ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getAdminOverview, type AdminOverview, type AdminUserStats } from "@/lib/backend";

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDuration(sec: number): string {
  if (!sec) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

const statusBadge = (status: string) => {
  const s = (status || "").toLowerCase();
  if (s === "completed") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">completed</Badge>;
  if (s === "failed") return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">failed</Badge>;
  if (s === "draft") return <Badge variant="outline">draft</Badge>;
  return <Badge variant="secondary">{status || "—"}</Badge>;
};

const Admin = () => {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    getAdminOverview()
      .then(setData)
      .catch((e) => setError(e?.message || "Failed to load admin data"));
  }, []);

  const users = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.users;
    return data.users.filter((u) => u.email.toLowerCase().includes(q));
  }, [data, query]);

  const totals = data?.totals;

  return (
    <div data-testid="admin-page" className="px-4 py-8 md:px-6">
      <div className="mb-6 flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin — Usage &amp; Users</h1>
          <p className="text-sm text-muted-foreground">
            Platform-wide usage statistics and per-user project lists.
          </p>
        </div>
      </div>

      {error && (
        <Card data-testid="admin-error" className="mb-6 border-red-300 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{error}</CardContent>
        </Card>
      )}

      {!data && !error && <p className="text-sm text-muted-foreground">Loading statistics…</p>}

      {totals && (
        <>
          {/* Platform statistics */}
          <section data-testid="admin-totals-section" aria-label="Platform statistics">
            <h2 className="mb-3 text-lg font-semibold">Platform statistics</h2>
            <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
              {[
                { label: "Users", value: totals.users, icon: Users, tid: "admin-stat-users" },
                { label: "Conversions", value: totals.jobs_total, icon: FolderKanban, tid: "admin-stat-conversions" },
                { label: "Completed", value: totals.jobs_completed, icon: CheckCircle2, tid: "admin-stat-completed" },
                { label: "Failed", value: totals.jobs_failed, icon: XCircle, tid: "admin-stat-failed" },
                { label: "Voices", value: totals.voices, icon: Mic2, tid: "admin-stat-voices" },
                { label: "Projects", value: totals.projects, icon: FolderKanban, tid: "admin-stat-projects" },
                { label: "Storage", value: fmtBytes(totals.storage_bytes), icon: Database, tid: "admin-stat-storage" },
                { label: "Audio Generated", value: fmtDuration(totals.output_audio_seconds), icon: Clock, tid: "admin-stat-audio" },
              ].map((s) => (
                <Card key={s.label} data-testid={s.tid}>
                  <CardHeader className="pb-1">
                    <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <s.icon className="h-3.5 w-3.5" aria-hidden="true" /> {s.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xl font-bold tabular-nums">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Users + projects */}
          <section data-testid="admin-users-section" aria-label="Users and their projects">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Users</h2>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  data-testid="admin-search-input"
                  aria-label="Search users by email"
                  placeholder="Search users…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-56 pl-8"
                />
              </div>
            </div>

            <div className="space-y-4">
              {users.map((u: AdminUserStats) => (
                <Card key={u.id} data-testid={`admin-user-card-${u.id}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <span>{u.email}</span>
                      {u.is_admin && <Badge className="bg-primary/10 text-primary hover:bg-primary/10">admin</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-4 grid grid-cols-3 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
                      <div>
                        <p className="text-xs text-muted-foreground">Conversions</p>
                        <p className="font-semibold tabular-nums" data-testid={`admin-user-${u.id}-conversions`}>
                          {u.jobs_total} ({u.jobs_completed}✓ {u.jobs_failed}✗)
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Processing</p>
                        <p className="flex items-center gap-1 font-semibold tabular-nums">
                          {u.jobs_processing > 0 && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                          {u.jobs_processing}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Audio</p>
                        <p className="font-semibold tabular-nums">{fmtDuration(u.output_audio_seconds)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Voices</p>
                        <p className="font-semibold tabular-nums">{u.voices}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Projects</p>
                        <p className="font-semibold tabular-nums">{u.projects}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Media files</p>
                        <p className="font-semibold tabular-nums">{u.media_files}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Storage</p>
                        <p className="font-semibold tabular-nums">{fmtBytes(u.storage_bytes)}</p>
                      </div>
                    </div>

                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Projects ({u.project_list.length})
                    </p>
                    {u.project_list.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No projects yet.</p>
                    ) : (
                      <ul data-testid={`admin-user-${u.id}-projects`} className="divide-y rounded-md border border-border">
                        {u.project_list.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                            <span className="truncate font-medium">{p.name}</span>
                            <span className="flex shrink-0 items-center gap-3">
                              <span className="text-xs text-muted-foreground">
                                {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—"}
                              </span>
                              {statusBadge(p.status)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
              {users.length === 0 && (
                <p className="text-sm text-muted-foreground">No users match “{query}”.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default Admin;
