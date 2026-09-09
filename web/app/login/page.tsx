"use client";

import { useState, useActionState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  loginWithEmail,
  registerWithEmail,
  loginWithSandbox,
  type AuthState,
} from "./actions";
import { createClient } from "@/lib/supabase/client";

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function AuthForm() {
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("tab") === "register" ? "register" : "login";
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Form input state for live client validation and convenience filling
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");

  const [loginState, loginAction, loginPending] = useActionState<AuthState, FormData>(
    loginWithEmail,
    {}
  );

  const [registerState, registerAction, registerPending] = useActionState<AuthState, FormData>(
    registerWithEmail,
    {}
  );

  const handleFillSandbox = () => {
    setEmailInput("qa@example.com");
    setPasswordInput("changeme123");
    setMode("login");
  };

  const handleGithubOAuth = async () => {
    setOauthLoading(true);
    try {
      const supabase = createClient();
      const isLive =
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://mock.supabase.co";

      if (isLive) {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "github",
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) {
          alert(`GitHub OAuth: ${error.message}`);
          setOauthLoading(false);
        }
      } else {
        // Local simulation fallback
        window.location.href = "/dashboard";
      }
    } catch {
      setOauthLoading(false);
    }
  };

  const isPasswordValid = passwordInput.length >= 6;
  const doPasswordsMatch =
    confirmPasswordInput.length > 0 && passwordInput === confirmPasswordInput;

  return (
    <div className="w-full max-w-[420px]">
      <Card className="border-slate-200/90 bg-white shadow-xl shadow-slate-200/40 rounded-2xl overflow-hidden">
        <CardHeader className="space-y-4 pb-5 pt-6 px-6">
          {/* Mode Switcher Segmented Control */}
          <div className="grid grid-cols-2 rounded-xl bg-slate-100/90 p-1 border border-slate-200/80">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-lg py-2 text-xs font-semibold tracking-tight transition-all duration-150 ${
                mode === "login"
                  ? "bg-white text-slate-950 shadow-sm font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-lg py-2 text-xs font-semibold tracking-tight transition-all duration-150 ${
                mode === "register"
                  ? "bg-white text-slate-950 shadow-sm font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Create Account
            </button>
          </div>

          <div>
            <CardTitle className="text-xl font-bold tracking-tight text-slate-950">
              {mode === "login" ? "Sign in to AutoQA" : "Create developer account"}
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {mode === "login"
                ? "Enter your credentials or authenticate via GitHub OAuth."
                : "Register with Supabase Auth to connect your Git repositories."}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 px-6 pb-6">
          {/* GitHub OAuth Button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleGithubOAuth}
            disabled={oauthLoading}
            className="w-full h-11 border-slate-300/90 bg-white text-slate-900 hover:bg-slate-50 hover:text-slate-950 font-semibold text-xs tracking-tight shadow-sm gap-2.5 transition-all active:scale-[0.99]"
          >
            <GithubIcon className="h-4 w-4 shrink-0" />
            <span>
              {oauthLoading ? "Connecting to GitHub…" : "Continue with GitHub"}
            </span>
          </Button>

          {/* Divider with subtle label */}
          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-slate-200" />
            <span className="bg-white px-3 text-[10px] uppercase font-bold tracking-widest text-slate-400">
              or continue with email
            </span>
          </div>

          {/* Sign In Form */}
          {mode === "login" ? (
            <form action={loginAction} className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="email"
                  className="text-xs font-semibold text-slate-800"
                >
                  Email address
                </Label>
                <div className="relative">
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    placeholder="developer@company.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    required
                    className="h-10 pl-9 pr-3 text-xs border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-slate-900 focus-visible:ring-1 focus-visible:ring-slate-900"
                  />
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="password"
                    className="text-xs font-semibold text-slate-800"
                  >
                    Password
                  </Label>
                  <span className="text-[11px] text-slate-400 hover:text-slate-700 cursor-pointer">
                    Forgot password?
                  </span>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    required
                    className="h-10 pl-9 pr-10 text-xs border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-slate-900 focus-visible:ring-1 focus-visible:ring-slate-900"
                  />
                  <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {loginState?.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs text-red-700 font-medium">
                  {loginState.error}
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={loginPending}
                className="w-full h-10 bg-slate-950 hover:bg-slate-800 text-white font-semibold text-xs tracking-tight shadow-sm active:scale-[0.99] transition-all mt-1 gap-2"
              >
                {loginPending ? "Authenticating…" : "Sign In to Control Center"}
                {!loginPending && <ArrowRight className="h-3.5 w-3.5" />}
              </Button>
            </form>
          ) : (
            /* Registration Form */
            <form action={registerAction} className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="reg-email"
                  className="text-xs font-semibold text-slate-800"
                >
                  Work email
                </Label>
                <div className="relative">
                  <Input
                    id="reg-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="developer@company.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    required
                    className="h-10 pl-9 pr-3 text-xs border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-slate-900 focus-visible:ring-1 focus-visible:ring-slate-900"
                  />
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label
                  htmlFor="reg-password"
                  className="text-xs font-semibold text-slate-800"
                >
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="reg-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    required
                    className="h-10 pl-9 pr-10 text-xs border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-slate-900 focus-visible:ring-1 focus-visible:ring-slate-900"
                  />
                  <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label
                  htmlFor="reg-confirm"
                  className="text-xs font-semibold text-slate-800"
                >
                  Confirm password
                </Label>
                <div className="relative">
                  <Input
                    id="reg-confirm"
                    name="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    value={confirmPasswordInput}
                    onChange={(e) => setConfirmPasswordInput(e.target.value)}
                    required
                    className="h-10 pl-9 pr-3 text-xs border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-slate-900 focus-visible:ring-1 focus-visible:ring-slate-900"
                  />
                  <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* Password Requirement Chips */}
              {passwordInput.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                      isPasswordValid
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-500 border border-slate-200"
                    }`}
                  >
                    <Check className="h-3 w-3" />
                    Min 6 characters
                  </span>
                  {confirmPasswordInput.length > 0 && (
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                        doPasswordsMatch
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-rose-50 text-rose-700 border border-rose-200"
                      }`}
                    >
                      <Check className="h-3 w-3" />
                      {doPasswordsMatch ? "Passwords match" : "Mismatch"}
                    </span>
                  )}
                </div>
              )}

              {registerState?.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs text-red-700 font-medium">
                  {registerState.error}
                </div>
              ) : null}

              {registerState?.success ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 text-xs text-emerald-800 font-medium">
                  {registerState.success}
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={registerPending}
                className="w-full h-10 bg-slate-950 hover:bg-slate-800 text-white font-semibold text-xs tracking-tight shadow-sm active:scale-[0.99] transition-all mt-1 gap-2"
              >
                {registerPending ? "Creating account…" : "Create Supabase Account"}
                {!registerPending && <ArrowRight className="h-3.5 w-3.5" />}
              </Button>
            </form>
          )}

          {/* Development & Sandbox Runner Callout */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                <Terminal className="h-3.5 w-3.5 text-slate-700" />
                <span>Docker Sandbox Mode</span>
              </div>
              <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                Playwright Auth
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed mb-3">
              Automated journeys run against the seeded test user (<code className="font-mono text-slate-900 bg-white px-1 py-0.5 rounded border border-slate-200">qa@example.com</code>).
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFillSandbox}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs text-center"
              >
                Fill Credentials
              </button>
              <form action={loginWithSandbox} className="flex-1">
                <button
                  type="submit"
                  className="w-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 transition-colors shadow-xs text-center"
                >
                  Instant 1-Click Login
                </button>
              </form>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security & System Trust Footer */}
      <div className="mt-6 flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <Lock className="h-3.5 w-3.5 text-slate-400" />
          <span>Encrypted via Supabase Auth &amp; AES-256 Vault</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <Link href="/" className="hover:text-slate-600 transition-colors">
            Terms of Service
          </Link>
          <span>•</span>
          <Link href="/" className="hover:text-slate-600 transition-colors">
            Privacy Policy
          </Link>
          <span>•</span>
          <Link href="/" className="hover:text-slate-600 transition-colors">
            Security Overview
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-[#fafaf9] text-slate-900 px-4 py-12 selection:bg-slate-200">
      {/* Structural graph grid pattern matching landing page */}
      <div className="pointer-events-none absolute inset-0 bg-grid-light mask-radial-light opacity-70" />

      {/* Top Header Navigation */}
      <div className="absolute top-6 left-6 right-6 max-w-6xl mx-auto flex items-center justify-between z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-950 transition-colors rounded-lg border border-slate-200 bg-white/90 backdrop-blur-xs px-3 py-1.5 shadow-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Overview</span>
        </Link>

        <div className="hidden sm:flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 backdrop-blur-xs px-3 py-1 text-xs text-slate-600 shadow-xs">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-[11px] font-semibold text-slate-700">
            Supabase Auth v2 • Operational
          </span>
        </div>
      </div>

      {/* Main Brand Identifier */}
      <div className="relative mb-6 flex flex-col items-center text-center z-10">
        <Link href="/" className="mb-2 flex items-center gap-2.5 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white font-mono font-bold text-sm shadow-md group-hover:scale-105 transition-transform">
            PR
          </div>
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-slate-950">
          PR Testing Engine
        </h1>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">
          Autonomous testing platform for Claude Code &amp; Cursor
        </p>
      </div>

      {/* Auth Card Container */}
      <div className="relative z-10 w-full flex justify-center">
        <Suspense
          fallback={
            <div className="w-full max-w-[420px] h-[480px] rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-xs text-slate-400">
              Loading authentication…
            </div>
          }
        >
          <AuthForm />
        </Suspense>
      </div>
    </div>
  );
}
