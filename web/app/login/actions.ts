"use server";

import { redirect } from "next/navigation";
import { getTestUser } from "@/lib/auth";
import { isFieldFilled } from "@/lib/form-validation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  success?: string;
};

export async function loginWithEmail(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Please provide both email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  if (!data?.user) {
    return { error: "Failed to sign in. Please try again." };
  }

  redirect("/dashboard");
}

export async function registerWithEmail(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!isFieldFilled(email) || !isFieldFilled(password)) {
    return { error: "Please enter an email and password." };
  }

  if (password.length < 6) {
    return { error: "Password must be at least 6 characters long." };
  }

  if (confirmPassword && password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message };
  }

  // Email confirmation required before a session exists
  if (data?.user && !data.session) {
    return {
      success:
        "Registration initiated! Check your email inbox to confirm your account.",
    };
  }

  if (data?.user) {
    redirect("/dashboard");
  }

  return { error: "Failed to register account." };
}

/**
 * Signs in as the seeded test account through real Supabase auth (not a
 * bypass) — convenience button for demoing the sandbox's automated login
 * flow. The account must actually exist in Supabase; if it doesn't, this
 * surfaces the same error a real failed login would.
 */
export async function loginWithSandbox(
  _prevState: AuthState,
  _formData: FormData
): Promise<AuthState> {
  const testUser = getTestUser();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: testUser.email,
    password: testUser.password,
  });

  if (error || !data?.user) {
    return {
      error:
        error?.message ??
        "Seeded test account is not provisioned in Supabase yet.",
    };
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
