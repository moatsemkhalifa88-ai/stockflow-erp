"use client";

import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signInAsDemo } from "@/lib/auth/actions";
import { DEMO_ACCOUNTS, type DemoAccount, type DemoAccountKey } from "@/lib/auth/demo-accounts";
import { cn } from "@/lib/cn";
import { DemoAccountCard } from "./demo-account-card";

const ERROR_MESSAGE = "Couldn't sign in — try again";
/** Matches the grid's exit transition (duration-200). */
const EXIT_MS = 200;

type Phase = { kind: "idle" } | { kind: "signing-in"; key: DemoAccountKey } | { kind: "signed-in"; key: DemoAccountKey };

/** One-tap sign-in: tap a card, the server signs in as that demo account, then the dashboard opens. */
export function DemoAccountPicker({ next }: { next?: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [shakingKey, setShakingKey] = useState<DemoAccountKey | null>(null);
  const [announcement, setAnnouncement] = useState("");

  async function select(account: DemoAccount) {
    if (phase.kind !== "idle") return;
    setError(null);
    setPhase({ kind: "signing-in", key: account.key });
    setAnnouncement(`Signing in as ${account.name}…`);

    const result = await signInAsDemo(account.key, next).catch(() => null);
    if (!result?.ok) {
      setPhase({ kind: "idle" });
      setShakingKey(account.key);
      setError(ERROR_MESSAGE);
      setAnnouncement(ERROR_MESSAGE);
      return;
    }

    setPhase({ kind: "signed-in", key: account.key });
    setAnnouncement("Signed in");
    window.setTimeout(() => router.push(result.redirectTo), EXIT_MS);
  }

  const busyKey = phase.kind === "idle" ? null : phase.key;

  return (
    <div>
      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2 sm:gap-4",
          "transition-[opacity,scale] duration-200 ease-in",
          phase.kind === "signed-in" && "scale-[0.98] opacity-50",
        )}
      >
        {DEMO_ACCOUNTS.map((account, index) => (
          <DemoAccountCard
            key={account.key}
            account={account}
            index={index}
            // Admin first and full width: 1 + 2 + 2, no orphaned card on two columns.
            className={index === 0 ? "sm:col-span-2" : undefined}
            state={busyKey === null ? "idle" : busyKey === account.key ? "loading" : "disabled"}
            shaking={shakingKey === account.key}
            onSelect={() => void select(account)}
            onShakeEnd={() => setShakingKey(null)}
          />
        ))}
      </div>

      {error && (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-sm font-medium text-red-700">
          <AlertCircle aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
