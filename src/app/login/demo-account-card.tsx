"use client";

import { ChevronRight, ClipboardList, Loader2, ShieldCheck, ShoppingCart, Warehouse, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import type { DemoAccount } from "@/lib/auth/demo-accounts";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/roles";
import { cn } from "@/lib/cn";

/** Each role has its own icon and accent, so roles never differ by colour alone. Static class strings for Tailwind. */
const ROLE_STYLE: Record<AppRole, { icon: LucideIcon; avatar: string; focus: string }> = {
  admin: { icon: ShieldCheck, avatar: "bg-slate-100 text-slate-700 ring-slate-200", focus: "focus-visible:outline-slate-600" },
  purchasing: { icon: ClipboardList, avatar: "bg-blue-50 text-blue-700 ring-blue-200", focus: "focus-visible:outline-blue-600" },
  sales: { icon: ShoppingCart, avatar: "bg-emerald-50 text-emerald-700 ring-emerald-200", focus: "focus-visible:outline-emerald-600" },
  warehouse_manager: { icon: Warehouse, avatar: "bg-amber-50 text-amber-800 ring-amber-200", focus: "focus-visible:outline-amber-600" },
};

export type DemoCardState = "idle" | "loading" | "disabled";

export function DemoAccountCard({
  account,
  state,
  shaking,
  index,
  className,
  onSelect,
  onShakeEnd,
}: {
  account: DemoAccount;
  state: DemoCardState;
  shaking: boolean;
  /** Position in the grid, for the staggered entrance. */
  index: number;
  className?: string;
  onSelect: () => void;
  onShakeEnd: () => void;
}) {
  const { icon: Icon, avatar, focus } = ROLE_STYLE[account.role];
  const loading = state === "loading";

  // The wrapper is the grid cell and carries the error shake, so it never competes with the button's entrance animation.
  // min-w-0: a grid cell must not grow to fit the untruncated description.
  return (
    <div
      className={cn("min-w-0", shaking && "motion-safe:animate-shake", className)}
      onAnimationEnd={(event) => {
        if (event.animationName === "shake") onShakeEnd();
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={state !== "idle"}
        aria-label={`Sign in as ${account.name}, ${ROLE_LABELS[account.role]}`}
        aria-busy={loading}
        style={{ "--delay": `${index * 60}ms` } as CSSProperties}
        className={cn(
          "group flex min-h-12 w-full items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-5 text-start shadow-card",
          "transition-[translate,scale,box-shadow,opacity] duration-150 ease-out",
          "motion-safe:animate-card-in motion-safe:[animation-delay:var(--delay)]",
          "enabled:hover:shadow-card-hover motion-safe:enabled:hover:-translate-y-0.5",
          "motion-safe:enabled:active:scale-[0.97] enabled:active:duration-100 enabled:active:ease-in-out",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          focus,
          loading && "opacity-80",
          state === "disabled" && "cursor-not-allowed opacity-60",
        )}
      >
        <span aria-hidden className={cn("flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", avatar)}>
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-md font-semibold text-slate-900">{account.name}</span>
          <span className="block truncate text-body-md text-slate-600">{account.description}</span>
        </span>
        {loading ? (
          <Loader2 aria-hidden className="size-5 shrink-0 animate-spin-fast text-slate-500" />
        ) : (
          <ChevronRight
            aria-hidden
            className="size-5 shrink-0 text-slate-500 transition-transform duration-150 rtl:-scale-x-100 group-enabled:group-hover:translate-x-0.5 rtl:group-enabled:group-hover:-translate-x-0.5"
          />
        )}
      </button>
    </div>
  );
}
