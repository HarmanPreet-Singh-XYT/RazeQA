"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        setHasSession(Boolean(session));
      } catch {
        setHasSession(false);
      } finally {
        setCheckingSession(false);
      }
    }
    checkAuth();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push("/dashboard");
        }, 2000);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isPasswordValid = password.length >= 6;
  const doPasswordsMatch =
    confirmPassword.length > 0 && password === confirmPassword;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-50 via-slate-50 to-slate-100 -z-10" />

      <div className="w-full max-w-[420px]">
        {/* Top brand header */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white font-mono font-bold text-sm shadow-md mb-3">
            QA
          </div>
          <span className="font-bold text-slate-900 tracking-tight text-xl">
            RazeQA
          </span>
          <p className="text-xs text-slate-500 mt-1">
            Autonomous PR Verification Engine
          </p>
        </div>

        <Card className="border-slate-200/90 bg-white shadow-xl shadow-slate-200/40 rounded-2xl overflow-hidden">
          <CardHeader className="space-y-2 pb-4 pt-6 px-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 mb-1">
              <KeyRound className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl font-bold text-slate-900">
              Reset your password
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Enter your new password below to update your account credentials.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6 pb-6 pt-2">
            {checkingSession ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-500 text-xs">
                <RefreshCw className="h-5 w-5 animate-spin mb-2 text-indigo-600" />
                <span>Verifying reset session...</span>
              </div>
            ) : !hasSession && !success ? (
              <div className="space-y-4 text-center py-2">
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2 text-left">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    Your password reset link is invalid, expired, or has already been used. Please request a new link from the login page.
                  </span>
                </div>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-1.5 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-all shadow-sm"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to Login
                </Link>
              </div>
            ) : success ? (
              <div className="space-y-4 text-center py-4">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-800 flex flex-col items-center gap-2">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  <span className="font-semibold text-sm text-emerald-900">
                    Password updated successfully!
                  </span>
                  <span>Redirecting you to the dashboard...</span>
                </div>
                <Button
                  onClick={() => router.push("/dashboard")}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-xs font-semibold"
                >
                  Go to Dashboard Now
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label
                    htmlFor="password"
                    className="text-xs font-semibold text-slate-700"
                  >
                    New Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pl-9 pr-9 text-xs h-9 bg-slate-50/50 border-slate-200 focus:bg-white transition-all"
                      required
                      minLength={6}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {password.length > 0 && !isPasswordValid && (
                    <p className="text-[10px] text-amber-600 font-medium">
                      Password must be at least 6 characters
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="confirmPassword"
                    className="text-xs font-semibold text-slate-700"
                  >
                    Confirm New Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pl-9 pr-9 text-xs h-9 bg-slate-50/50 border-slate-200 focus:bg-white transition-all"
                      required
                    />
                  </div>
                  {confirmPassword.length > 0 && !doPasswordsMatch && (
                    <p className="text-[10px] text-rose-600 font-medium">
                      Passwords do not match
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={loading || !isPasswordValid || !doPasswordsMatch}
                  className="w-full h-9 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition-all"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin mr-2" />
                      Updating Password...
                    </>
                  ) : (
                    <>
                      Update Password
                      <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                    </>
                  )}
                </Button>

                <div className="pt-2 text-center">
                  <Link
                    href="/login"
                    className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 font-medium transition-colors"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Back to Login
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
