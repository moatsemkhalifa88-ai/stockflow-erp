import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  ClipboardList,
  History,
  LayoutDashboard,
  type LucideIcon,
  Package,
  PackageCheck,
  ScrollText,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import type { AppRole } from "@/lib/auth/roles";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: readonly AppRole[];
  /** False while the module is still on the roadmap; rendered as "Soon". */
  available: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const EVERYONE: readonly AppRole[] = ["admin", "warehouse_manager", "purchasing", "sales"];
const OPERATIONS: readonly AppRole[] = ["admin", "warehouse_manager"];

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: EVERYONE, available: true },
      { label: "Alerts", href: "/alerts", icon: Bell, roles: EVERYONE, available: true },
    ],
  },
  {
    title: "Inventory",
    items: [
      { label: "Products", href: "/products", icon: Package, roles: EVERYONE, available: true },
      { label: "Inventory", href: "/inventory", icon: Boxes, roles: EVERYONE, available: true },
      { label: "Stock Movements", href: "/movements", icon: History, roles: OPERATIONS, available: true },
      { label: "Warehouses", href: "/warehouses", icon: Warehouse, roles: EVERYONE, available: true },
      { label: "Transfers", href: "/transfers", icon: ArrowLeftRight, roles: OPERATIONS, available: true },
    ],
  },
  {
    title: "Purchasing",
    items: [
      { label: "Purchase Orders", href: "/purchase-orders", icon: ClipboardList, roles: ["admin", "warehouse_manager", "purchasing"], available: true },
      { label: "Goods Receipts", href: "/goods-receipts", icon: PackageCheck, roles: ["admin", "warehouse_manager", "purchasing"], available: true },
      { label: "Suppliers", href: "/suppliers", icon: Truck, roles: ["admin", "purchasing"], available: true },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "Sales Orders", href: "/sales-orders", icon: ShoppingCart, roles: ["admin", "warehouse_manager", "sales"], available: true },
      { label: "Customers", href: "/customers", icon: Users, roles: ["admin", "sales"], available: true },
    ],
  },
  {
    title: "Analytics",
    items: [
      { label: "Reports", href: "/reports", icon: BarChart3, roles: EVERYONE, available: true },
      { label: "Audit Log", href: "/audit-log", icon: ScrollText, roles: ["admin"], available: true },
    ],
  },
];

export function navigationForRole(role: AppRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}

/** Human labels for URL segments, used by breadcrumbs. */
export const SEGMENT_LABELS: Record<string, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) => section.items.map((item) => [item.href.slice(1), item.label])),
);
