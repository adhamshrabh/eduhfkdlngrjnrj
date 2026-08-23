import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, HelpCircle, LogIn } from "lucide-react";

import { AuroraBackground } from "@/components/AuroraBackground";
import { Logo } from "@/components/Logo";
import { Button, ErrorNote, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ar } from "@/lib/i18n";

export function LoginPage(): JSX.Element {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string } } };

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  if (status === "authenticated") return <Navigate to={location.state?.from?.pathname ?? "/stories"} replace />;

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(location.state?.from?.pathname ?? "/stories", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : ar.common.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 relative overflow-hidden">
      <AuroraBackground />

      <div className="w-full max-w-sm relative animate-slide-up">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl shadow-lift animate-scale-in overflow-hidden">
            <Logo size={64} />
          </div>
          <h1 className="text-display text-primary-dark">{ar.app.name}</h1>
          <p className="mt-1 text-body text-slate-500">{ar.app.tagline}</p>
        </div>
        {showForgot ? (
          <div className="bg-white/90 backdrop-blur rounded-3xl shadow-card p-6 space-y-4 animate-slide-up">
            <h2 className="text-h1 flex items-center gap-2"><HelpCircle size={22} className="text-primary" /> {ar.forgotPassword.title}</h2>
            <p className="text-body text-slate-600">{ar.forgotPassword.body}</p>
            <p className="text-body text-slate-600">{ar.forgotPassword.instructions}</p>
            <Button variant="ghost" icon={<ArrowRight size={18} />} onClick={() => setShowForgot(false)} className="w-full">
              {ar.forgotPassword.back}
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="bg-white/90 backdrop-blur rounded-3xl shadow-card p-6 space-y-4">
            <h2 className="text-h1">{ar.auth.title}</h2>
            <Field label={ar.auth.email} type="email" autoComplete="email" required
                   value={email} onChange={(e) => setEmail(e.target.value)} />
            <Field label={ar.auth.password} type="password" autoComplete="current-password" required
                   value={password} onChange={(e) => setPassword(e.target.value)} />
            {error ? <ErrorNote message={error} /> : null}
            <Button type="submit" size="lg" loading={busy} icon={<LogIn size={20} />} className="w-full">
              {busy ? ar.auth.submitting : ar.auth.submit}
            </Button>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="block w-full text-center text-caption text-primary hover:text-primary-dark transition-colors"
            >
              {ar.forgotPassword.link}
            </button>
            <p className="text-caption text-slate-400 text-center">{ar.auth.offlineHint}</p>
          </form>
        )}
      </div>
    </div>
  );
}
