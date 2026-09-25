"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useToast, type ToastInput } from "./toast";

/**
 * Shows a toast after a redirect (e.g. `?saved=created`) and removes the flag
 * from the URL so a refresh does not show it again.
 */
export function FlashToast({ param = "saved", messages }: { param?: string; messages: Record<string, ToastInput> }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const shown = useRef(false);
  const key = searchParams.get(param);

  useEffect(() => {
    if (!key || shown.current) return;
    const message = messages[key];
    if (!message) return;
    shown.current = true;
    toast(message);
    const next = new URLSearchParams(searchParams.toString());
    next.delete(param);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [key, messages, param, pathname, router, searchParams, toast]);

  return null;
}
