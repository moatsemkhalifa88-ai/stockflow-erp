"use client";

import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AppRole } from "@/lib/auth/roles";
import { Breadcrumbs } from "./breadcrumbs";
import { Sidebar } from "./sidebar";
import { UserMenu } from "./user-menu";

export interface ShellUser {
  fullName: string;
  email: string;
  role: AppRole;
  roleName: string;
}

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <Sidebar role={user.role} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex min-h-dvh flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open navigation"
            aria-controls="app-sidebar"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <UserMenu fullName={user.fullName} email={user.email} roleName={user.roleName} />
        </header>

        <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
