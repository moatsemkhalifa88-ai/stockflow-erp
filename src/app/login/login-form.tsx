"use client";

import { AlertCircle } from "lucide-react";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useToast } from "@/components/ui/toast";
import { signIn, type SignInState } from "@/lib/auth/actions";

const INITIAL_STATE: SignInState = {};

export function LoginForm({ next, signedOut }: { next?: string; signedOut: boolean }) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE);
  const { toast } = useToast();

  useEffect(() => {
    if (signedOut) toast({ title: "You have been signed out", variant: "success" });
  }, [signedOut, toast]);

  return (
    <form action={formAction} noValidate className="space-y-5">
      {next && <input type="hidden" name="next" value={next} />}

      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <FormField
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        placeholder="you@company.com"
        defaultValue={state.email}
        error={state.fieldErrors?.email}
        required
        autoFocus
      />
      <FormField
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        error={state.fieldErrors?.password}
        required
      />

      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
