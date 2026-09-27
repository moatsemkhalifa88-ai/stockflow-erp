import { describe, expect, it } from "vitest";
import { allowedSalesActions, allowedTransferActions, canPerformSalesAction } from "@/lib/sales";
import { EMPTY_CUSTOMER, validateCustomer } from "@/lib/validation/customer";
import { lineAmounts, validateSalesOrder, type SalesOrderFormValues } from "@/lib/validation/sales-order";
import { validateTransfer } from "@/lib/validation/transfer";

const CUSTOMER = "8a6b2f0e-3c1d-4e5f-9a7b-1c2d3e4f5a6b";
const WH_A = "11111111-2222-4333-8444-555555555555";
const WH_B = "11111111-2222-4333-8444-666666666666";
const P1 = "0f1e2d3c-4b5a-4968-8776-655443322110";
const P2 = "0f1e2d3c-4b5a-4968-8776-655443322111";

describe("sales line amounts (same rounding as the database)", () => {
  it("matches the generated columns on sales_order_items", () => {
    expect(lineAmounts(3, 69, 10)).toEqual({ gross: 207, discount: 20.7, total: 186.3 });
    expect(lineAmounts(7, 12.99, 12.5)).toEqual({ gross: 90.93, discount: 11.37, total: 79.56 });
    expect(lineAmounts(1, 159, 0)).toEqual({ gross: 159, discount: 0, total: 159 });
    expect(lineAmounts(2, 10, 100)).toEqual({ gross: 20, discount: 20, total: 0 });
  });
});

describe("sales order form", () => {
  const valid: SalesOrderFormValues = {
    customer_id: CUSTOMER,
    warehouse_id: WH_A,
    order_date: "2026-09-20",
    requested_delivery_date: "2026-09-25",
    notes: "",
    lines: [
      { product_id: P1, quantity: "3", unit_price: "69.00", discount_percent: "10" },
      { product_id: P2, quantity: "1", unit_price: "159", discount_percent: "" },
    ],
  };

  it("accepts a valid order; a blank discount means 0%", () => {
    const result = validateSalesOrder(valid, "2026-09-27");
    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [
          { product_id: P1, quantity: 3, unit_price: 69, discount_percent: 10 },
          { product_id: P2, quantity: 1, unit_price: 159, discount_percent: 0 },
        ],
      },
    });
  });

  it("rejects discounts over 100%, duplicate products and future order dates", () => {
    const result = validateSalesOrder(
      {
        ...valid,
        order_date: "2026-09-30",
        lines: [
          { product_id: P1, quantity: "1", unit_price: "1", discount_percent: "120" },
          { product_id: P1, quantity: "1", unit_price: "1", discount_percent: "0" },
        ],
      },
      "2026-09-27",
    );
    expect(result).toMatchObject({
      ok: false,
      errors: {
        order_date: expect.any(String),
        lineErrors: { 0: { discount_percent: "0 to 100." }, 1: { product_id: expect.any(String) } },
      },
    });
  });
});

describe("transfer form", () => {
  it("requires different warehouses", () => {
    expect(
      validateTransfer({
        source_warehouse_id: WH_A,
        destination_warehouse_id: WH_A,
        notes: "",
        lines: [{ product_id: P1, quantity: "1" }],
      }),
    ).toMatchObject({ ok: false, errors: { destination_warehouse_id: expect.stringContaining("different") } });
  });

  it("accepts a valid request", () => {
    expect(
      validateTransfer({ source_warehouse_id: WH_A, destination_warehouse_id: WH_B, notes: "", lines: [{ product_id: P1, quantity: "5" }] }),
    ).toEqual({
      ok: true,
      value: { source_warehouse_id: WH_A, destination_warehouse_id: WH_B, notes: null, items: [{ product_id: P1, quantity: 5 }] },
    });
  });
});

describe("customer form", () => {
  it("validates type, credit limit and payment terms", () => {
    expect(
      validateCustomer({ ...EMPTY_CUSTOMER, code: "CUS-031", name: "Test", customer_type: "VIP", credit_limit: "-5", payment_terms_days: "400" }),
    ).toMatchObject({
      ok: false,
      errors: { customer_type: expect.any(String), credit_limit: expect.any(String), payment_terms_days: expect.any(String) },
    });
  });
});

describe("sales order actions per role and status", () => {
  it("lets sales run the commercial steps and the warehouse run the physical ones", () => {
    expect(allowedSalesActions("sales", "DRAFT")).toEqual(["edit", "confirm", "cancel"]);
    expect(allowedSalesActions("sales", "CONFIRMED")).toEqual(["cancel"]);
    expect(allowedSalesActions("warehouse_manager", "CONFIRMED")).toEqual(["process"]);
    expect(allowedSalesActions("warehouse_manager", "PROCESSING")).toEqual(["ship"]);
    expect(allowedSalesActions("warehouse_manager", "SHIPPED")).toEqual(["complete", "reverse"]);
  });

  it("never offers cancel after shipping, and nothing on closed orders", () => {
    expect(canPerformSalesAction("cancel", "admin", "SHIPPED")).toBe(false);
    expect(allowedSalesActions("admin", "COMPLETED")).toEqual([]);
    expect(allowedSalesActions("admin", "CANCELLED")).toEqual([]);
  });

  it("gives purchasing nothing on sales orders", () => {
    expect(allowedSalesActions("purchasing", "DRAFT")).toEqual([]);
  });
});

describe("transfer actions per role and status", () => {
  it("keeps approval with admins and execution with the warehouse", () => {
    expect(allowedTransferActions("warehouse_manager", "REQUESTED")).toEqual(["cancel"]);
    expect(allowedTransferActions("admin", "REQUESTED")).toEqual(["approve", "reject", "cancel"]);
    expect(allowedTransferActions("warehouse_manager", "APPROVED")).toEqual(["execute", "cancel"]);
    expect(allowedTransferActions("sales", "APPROVED")).toEqual([]);
    expect(allowedTransferActions("admin", "COMPLETED")).toEqual([]);
  });
});
