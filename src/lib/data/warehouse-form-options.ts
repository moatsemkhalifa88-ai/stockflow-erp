import "server-only";
import type { SelectOption } from "@/components/ui/select-field";
import { formatWarehouseType } from "@/lib/format";
import { WAREHOUSE_TYPES } from "@/lib/validation/warehouse";
import { getManagerOptions } from "./lookups";

export const WAREHOUSE_TYPE_OPTIONS: SelectOption[] = WAREHOUSE_TYPES.map((t) => ({ value: t, label: formatWarehouseType(t) }));

/**
 * Active admins and warehouse managers, plus the current manager if they are
 * no longer eligible (shown disabled, so the form still displays who it was).
 */
export async function getManagerSelectOptions(currentManagerId?: string | null): Promise<SelectOption[]> {
  const managers = await getManagerOptions();
  return managers
    .filter((m) => m.isActive || m.id === currentManagerId)
    .map((m) => ({
      value: m.id,
      label: `${m.fullName} (${m.email})${m.isActive ? "" : " - inactive"}`,
      disabled: !m.isActive && m.id !== currentManagerId,
    }));
}
