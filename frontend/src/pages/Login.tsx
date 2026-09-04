import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
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
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div
        data-testid="login-page"
        className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-8"
      >
        <div className="space-y-2 text-center">
          <img src="/uploads/image_2027_20260904_173536_2117e084.webp" alt="DreamVoice logo" className="h-14 w-14 object-contain" />
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Sign in to your DreamVoice account</p>
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
            <p data-testid="login-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
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

        <p className="text-center text-sm text-muted-foreground">
          No account yet?{" "}
          <Link
            to="/signup"
            className="text-primary hover:text-primary"
            data-testid="login-signup-link"
          >
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
