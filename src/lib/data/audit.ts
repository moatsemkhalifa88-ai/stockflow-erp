import "server-only";
import { businessDayRange } from "@/lib/format";
import { pageRange } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/types/database";
import { unwrap, unwrapPage, type Page } from "./common";

/* Audit log (admins only - enforced by RLS). */

export interface AuditEntry {
  id: number;
  occurredAt: string;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Json;
  oldValues: Json | null;
  newValues: Json | null;
}

export interface AuditFilters {
  action?: string;
  entityType?: string;
  /** An email, or "system" for entries without a user. */
  user?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page: number;
}

function toEntry(r: Tables<"audit_log">): AuditEntry {
  return {
    id: r.id,
    occurredAt: r.occurred_at,
    userEmail: r.user_email,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    details: r.details,
    oldValues: r.old_values,
    newValues: r.new_values,
  };
}

export const AUDIT_PAGE_SIZE = 50;

export async function listAuditLog(f: AuditFilters): Promise<Page<AuditEntry>> {
  const supabase = await createClient();
  let query = supabase.from("audit_log").select("*", { count: "exact" });
  if (f.action) query = query.eq("action", f.action);
  if (f.entityType) query = query.eq("entity_type", f.entityType);
  if (f.entityId) query = query.eq("entity_id", f.entityId);
  if (f.user === "system") query = query.is("user_email", null);
  else if (f.user) query = query.eq("user_email", f.user);
  if (f.from) query = query.gte("occurred_at", businessDayRange(f.from).start);
  if (f.to) query = query.lte("occurred_at", businessDayRange(f.to).end);

  const { from, to } = pageRange(f.page, AUDIT_PAGE_SIZE);
  const result = await query.order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  const page = unwrapPage(result, "audit log");
  return { rows: page.rows.map(toEntry), total: page.total };
}

export interface AuditFacets {
  actions: { value: string; entries: number }[];
  entityTypes: { value: string; entries: number }[];
  users: { value: string; entries: number }[];
}

export async function getAuditFacets(): Promise<AuditFacets> {
  const supabase = await createClient();
  const rows = unwrap(await supabase.rpc("audit_log_facets"), "audit log filters");
  const pick = (facet: string) => rows.filter((r) => r.facet === facet).map((r) => ({ value: r.value, entries: r.entries }));
  return { actions: pick("action"), entityTypes: pick("entity_type"), users: pick("user") };
}
