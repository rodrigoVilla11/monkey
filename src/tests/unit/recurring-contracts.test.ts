import { describe, expect, it } from "vitest";

import {
  acceptRecurringRuleRequestSchema,
  createRecurringRuleRequestSchema,
  updateRecurringRuleRequestSchema,
} from "@/shared/contracts/recurring";

const base = {
  type: "EXPENSE",
  amountMinor: "95000",
  frequency: "MONTHLY",
  startDate: "2026-01-01",
  byMonthDay: 1,
} as const;

describe("programado sin cuenta", () => {
  it("se acepta si no se da por hecho", () => {
    const parsed = createRecurringRuleRequestSchema.safeParse({
      ...base,
      accountId: null,
      autoPost: false,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.accountId).toBeNull();
  });

  it("no puede darse por hecho: no habría dónde asentarlo", () => {
    const explicit = createRecurringRuleRequestSchema.safeParse({
      ...base,
      accountId: null,
      autoPost: true,
    });
    expect(explicit.success).toBe(false);
    if (!explicit.success) {
      expect(explicit.error.issues[0]?.path).toEqual(["autoPost"]);
    }

    // Omitir la cuenta es lo mismo que null, y `autoPost` por defecto es true.
    expect(createRecurringRuleRequestSchema.safeParse(base).success).toBe(
      false,
    );
  });

  it("con cuenta, darse por hecho sigue siendo el default", () => {
    const parsed = createRecurringRuleRequestSchema.safeParse({
      ...base,
      accountId: "acc_1",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.autoPost).toBe(true);
  });
});

describe("edición", () => {
  it("permite sacar la cuenta; el service decide si la combinación vale", () => {
    expect(
      updateRecurringRuleRequestSchema.safeParse({ accountId: null }).success,
    ).toBe(true);
  });

  it("exige al menos un campo", () => {
    expect(updateRecurringRuleRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("aceptar", () => {
  it("la cuenta es opcional en el contrato: la exige el service solo si falta en la regla", () => {
    expect(acceptRecurringRuleRequestSchema.safeParse({}).success).toBe(true);
    expect(
      acceptRecurringRuleRequestSchema.safeParse({ accountId: "acc_1" })
        .success,
    ).toBe(true);
  });
});
