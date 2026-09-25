"use client";

import { ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SEGMENT_LABELS } from "@/lib/navigation";

function labelFor(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  if (segment === "new") return "New";
  if (segment === "edit") return "Edit";
  // Record ids / document numbers: keep them short.
  if (/^[0-9a-f-]{36}$/i.test(segment)) return `${segment.slice(0, 8)}…`;
  return decodeURIComponent(segment)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm text-slate-500">
        <li>
          <Link href="/dashboard" className="flex items-center hover:text-slate-900" aria-label="Home">
            <Home className="size-4" />
          </Link>
        </li>
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join("/")}`;
          const isLast = index === segments.length - 1;
          return (
            <li key={href} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-slate-400" />
              {isLast ? (
                <span aria-current="page" className="truncate font-medium text-slate-900">
                  {labelFor(segment)}
                </span>
              ) : (
                <Link href={href} className="truncate hover:text-slate-900">
                  {labelFor(segment)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
