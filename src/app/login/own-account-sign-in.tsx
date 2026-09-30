"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { LoginForm } from "./login-form";

/** The regular email/password form, collapsed under the demo accounts until asked for. */
export function OwnAccountSignIn({ next, signedOut }: { next?: string; signedOut: boolean }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  function toggle() {
    const opening = !open;
    setOpen(opening);
    // Move focus into the form once it is no longer inert (next frame).
    if (opening) requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>("input[name=email]")?.focus());
  }

  return (
    <div>
      <div className="text-center">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="own-account-sign-in"
          className="rounded-md px-2 py-1.5 text-body-md font-medium text-brand-700 hover:text-brand-900 hover:underline"
        >
          {open ? "Hide" : "Sign in with your own account"}
        </button>
      </div>

      <div
        id="own-account-sign-in"
        ref={panel}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-250 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          {/* Padding keeps the focus rings inside the clipped area. */}
          <div className="px-1 pt-5 pb-1">
            <LoginForm next={next} signedOut={signedOut} />
          </div>
        </div>
      </div>
    </div>
  );
}
