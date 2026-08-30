import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AudioWaveform, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/backend";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate("/");
    } catch (err: any) {
      setError(err?.message || "Login failed. Check your email and password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0b0f] p-4 text-zinc-100">
      <div
        data-testid="login-page"
        className="w-full max-w-md space-y-6 rounded-2xl border border-white/10 bg-[#0d0f14] p-8"
      >
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/15">
            <AudioWaveform className="h-7 w-7 text-indigo-400" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-sm text-zinc-400">Sign in to your DreamVoice account</p>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              aria-label="Email"
              data-testid="login-email-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              aria-label="Password"
              data-testid="login-password-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p data-testid="login-error" role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={busy || !email || !password}
            data-testid="login-submit-button"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Sign in
          </Button>
        </form>

        <p className="text-center text-sm text-zinc-400">
          No account yet?{" "}
          <Link
            to="/signup"
            className="text-indigo-400 hover:text-indigo-300"
            data-testid="login-signup-link"
          >
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
