"use client";

import { Boxes, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/auth/roles";
import { cn } from "@/lib/cn";
import { navigationForRole, type NavItem } from "@/lib/navigation";

interface SidebarProps {
  role: AppRole;
  mobileOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ role, mobileOpen, onClose }: SidebarProps) {
  const sections = navigationForRole(role);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-slate-900/50 transition-opacity lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        id="app-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-slate-200 transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600">
              <Boxes aria-hidden className="size-5 text-white" />
            </span>
            <span className="text-base font-semibold tracking-tight text-white">
              StockFlow <span className="font-normal text-sidebar-muted">ERP</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-sidebar-muted hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav aria-label="Main navigation" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-3 pb-2 text-xs font-semibold tracking-wider text-sidebar-muted uppercase">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <SidebarLink item={item} onNavigate={onClose} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-3 text-xs text-sidebar-muted">Phase 4 · Sales and transfers</div>
      </aside>
    </>
  );
}

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors";

  if (!item.available) {
    return (
      <span className={cn(base, "cursor-not-allowed text-slate-500")} aria-disabled title="Coming in a later phase">
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="flex-1">{item.label}</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">Soon</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(base, active ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-sidebar-hover hover:text-white")}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {item.label}
    </Link>
  );
}
