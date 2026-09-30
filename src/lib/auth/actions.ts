"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDemoAccountKey } from "./demo-accounts";
import { DEMO_ACCOUNT_EMAILS, demoPassword } from "./demo-credentials";

export interface SignInState {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
  email?: string;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Only allow redirects to same-origin relative paths. */
function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/dashboard";
  }
  return value;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const fieldErrors: SignInState["fieldErrors"] = {};
  if (!EMAIL_PATTERN.test(email)) fieldErrors.email = "Enter a valid email address.";
  if (password.length === 0) fieldErrors.password = "Enter your password.";
  if (fieldErrors.email || fieldErrors.password) return { fieldErrors, email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const message =
      error.code === "invalid_credentials"
        ? "Incorrect email or password."
        : error.code === "email_not_confirmed"
          ? "Your email address has not been confirmed yet."
          : "Sign-in failed. Please try again.";
    return { error: message, email };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export type DemoSignInResult = { ok: true; redirectTo: string } | { ok: false; error: string };

/**
 * One-tap sign-in for the demo accounts. The browser sends only which account
 * was tapped; the email and password never leave the server. Returns instead of
 * redirecting so the page can finish its exit animation before navigating.
 */
export async function signInAsDemo(key: string, next?: string): Promise<DemoSignInResult> {
  const failed: DemoSignInResult = { ok: false, error: "Couldn't sign in — try again" };
  if (!isDemoAccountKey(key)) return failed;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_ACCOUNT_EMAILS[key], password: demoPassword() });
  if (error) {
    // The reason goes to the server log only; the visitor gets the generic message.
    console.error(`Demo sign-in failed for ${key}: ${error.code ?? error.message}`);
    return failed;
  }
  return { ok: true, redirectTo: safeRedirectPath(next) };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?signedOut=1");
}
