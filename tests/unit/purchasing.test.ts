import { describe, expect, it } from "vitest";
import { addDays, businessToday } from "@/lib/format";
import { allowedActions, canPerform } from "@/lib/purchasing";
import {
  readPurchaseOrderForm,
  validatePurchaseOrder,
  validateReceipt,
  type PurchaseOrderFormValues,
} from "@/lib/validation/purchase-order";
import { validateSupplier, EMPTY_SUPPLIER } from "@/lib/validation/supplier";

const SUPPLIER = "8a6b2f0e-3c1d-4e5f-9a7b-1c2d3e4f5a6b";
const WAREHOUSE = "11111111-2222-4333-8444-555555555555";
const P1 = "0f1e2d3c-4b5a-4968-8776-655443322110";
const P2 = "0f1e2d3c-4b5a-4968-8776-655443322111";
const LINE_A = "aaaaaaaa-2222-4333-8444-555555555555";
const LINE_B = "bbbbbbbb-2222-4333-8444-555555555555";

describe("purchase order form", () => {
  const valid: PurchaseOrderFormValues = {
    supplier_id: SUPPLIER,
    warehouse_id: WAREHOUSE,
    order_date: "2026-09-20",
    expected_delivery_date: "2026-09-27",
    notes: "",
    lines: [
      { product_id: P1, quantity: "10", unit_cost: "32.50" },
      { product_id: P2, quantity: "2", unit_cost: "0" },
    ],
  };

  it("reads repeated line fields in order and ignores fully blank rows", () => {
    const form = new FormData();
    form.set("supplier_id", SUPPLIER);
    for (const [p, q, c] of [
      [P1, "10", "32.50"],
      ["", "", ""],
      [P2, "2", "0"],
    ]) {
      form.append("line_product_id", p);
      form.append("line_quantity", q);
      form.append("line_unit_cost", c);
    }
    expect(readPurchaseOrderForm(form).lines).toEqual(valid.lines);
  });

  it("accepts a valid order and converts numbers", () => {
    const result = validatePurchaseOrder(valid, "2026-09-26");
    expect(result).toEqual({
      ok: true,
      value: {
        supplier_id: SUPPLIER,
        warehouse_id: WAREHOUSE,
        order_date: "2026-09-20",
        expected_delivery_date: "2026-09-27",
        notes: null,
        items: [
          { product_id: P1, quantity: 10, unit_cost: 32.5 },
          { product_id: P2, quantity: 2, unit_cost: 0 },
        ],
      },
    });
  });

  it("rejects future order dates, deliveries before the order and empty orders", () => {
    const result = validatePurchaseOrder(
      { ...valid, order_date: "2026-09-30", expected_delivery_date: "2026-09-29", lines: [] },
      "2026-09-26",
    );
    expect(result).toMatchObject({
      ok: false,
      errors: { order_date: expect.any(String), expected_delivery_date: expect.any(String), lines: expect.any(String) },
    });
  });

  it("reports line errors by position, including duplicate products", () => {
    const result = validatePurchaseOrder(
      {
        ...valid,
        lines: [
          { product_id: P1, quantity: "0", unit_cost: "1.234" },
          { product_id: P1, quantity: "1", unit_cost: "1" },
        ],
      },
      "2026-09-26",
    );
    expect(result).toMatchObject({
      ok: false,
      errors: {
        lineErrors: {
          0: { quantity: expect.any(String), unit_cost: expect.any(String) },
          1: { product_id: "This product is already on another line." },
        },
      },
    });
  });
});

describe("goods receipt form", () => {
  const outstanding = new Map([
    [LINE_A, 5],
    [LINE_B, 3],
  ]);

  function form(entries: [string, string][]): FormData {
    const f = new FormData();
    for (const [id, qty] of entries) {
      f.append("line_id", id);
      f.append("line_quantity", qty);
    }
    return f;
  }

  it("skips blank and zero lines", () => {
    expect(validateReceipt(form([[LINE_A, "5"], [LINE_B, "0"]]), outstanding)).toEqual({
      ok: true,
      items: [{ purchase_order_item_id: LINE_A, quantity: 5 }],
    });
  });

  it("rejects receiving more than is outstanding", () => {
    expect(validateReceipt(form([[LINE_B, "4"]]), outstanding)).toEqual({
      ok: false,
      lineErrors: { [LINE_B]: "Only 3 outstanding." },
    });
  });

  it("needs at least one quantity", () => {
    expect(validateReceipt(form([[LINE_A, ""], [LINE_B, "0"]]), outstanding)).toMatchObject({ ok: false, error: expect.any(String) });
  });
});

describe("purchase order actions per role and status", () => {
  it("lets only admins approve, and only submitted orders", () => {
    expect(canPerform("approve", "admin", "SUBMITTED")).toBe(true);
    expect(canPerform("approve", "purchasing", "SUBMITTED")).toBe(false);
    expect(canPerform("approve", "admin", "DRAFT")).toBe(false);
  });

  it("lets warehouse staff receive approved or partially received orders", () => {
    expect(allowedActions("warehouse_manager", "APPROVED")).toEqual(["receive"]);
    expect(allowedActions("warehouse_manager", "PARTIALLY_RECEIVED")).toEqual(["receive"]);
    expect(allowedActions("purchasing", "APPROVED")).toEqual(["cancel"]);
  });

  it("offers no cancellation once goods have arrived, and nothing on closed orders", () => {
    expect(canPerform("cancel", "admin", "PARTIALLY_RECEIVED")).toBe(false);
    expect(allowedActions("admin", "RECEIVED")).toEqual([]);
    expect(allowedActions("admin", "CANCELLED")).toEqual([]);
  });

  it("offers drafts for editing and submitting to purchasing", () => {
    expect(allowedActions("purchasing", "DRAFT")).toEqual(["edit", "submit", "cancel"]);
  });
});

describe("supplier form", () => {
  it("requires code, name and country and bounds the day fields", () => {
    const result = validateSupplier({ ...EMPTY_SUPPLIER, country: "", payment_terms_days: "400", lead_time_days: "-1" });
    expect(result).toMatchObject({
      ok: false,
      errors: {
        code: expect.any(String),
        name: expect.any(String),
        country: expect.any(String),
        payment_terms_days: expect.any(String),
        lead_time_days: expect.any(String),
      },
    });
  });
});

describe("date helpers", () => {
  it("adds days across month ends and gives today's business date as yyyy-mm-dd", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(businessToday(new Date("2026-09-25T22:30:00Z"))).toBe("2026-09-26");
  });
});
