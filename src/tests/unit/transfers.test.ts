import { describe, expect, it } from "vitest";

import {
  createTransferRequestSchema,
  updateTransferRequestSchema,
} from "@/shared/contracts/transfers";

/**
 * Contrato de transferencias.
 *
 * Lo que se prueba acá son las reglas que tienen que rebotar en el borde con un
 * 400, antes de llegar al service: una transferencia mal formada no debería
 * gastar una consulta a la base ni llegar a un 422 con un mensaje que habla de
 * otra cosa.
 */

const A = "a".repeat(24);
const B = "b".repeat(24);

describe("crear", () => {
  it("acepta lo mínimo: dos cuentas y un importe", () => {
    expect(
      createTransferRequestSchema.safeParse({
        fromAccountId: A,
        toAccountId: B,
        amountOutMinor: "1000",
      }).success,
    ).toBe(true);
  });

  it("rechaza un importe en cero", () => {
    // `amountMinorSchema` sí admite el cero —un movimiento en cero es raro pero
    // legítimo—. Una transferencia en cero no mueve nada y deja dos filas.
    expect(
      createTransferRequestSchema.safeParse({
        fromAccountId: A,
        toAccountId: B,
        amountOutMinor: "0",
      }).success,
    ).toBe(false);

    expect(
      createTransferRequestSchema.safeParse({
        fromAccountId: A,
        toAccountId: B,
        amountOutMinor: "1000",
        amountInMinor: "0",
      }).success,
    ).toBe(false);
  });

  it("rechaza la misma cuenta de los dos lados", () => {
    expect(
      createTransferRequestSchema.safeParse({
        fromAccountId: A,
        toAccountId: A,
        amountOutMinor: "1000",
      }).success,
    ).toBe(false);
  });

  it("rechaza importes negativos o con decimales", () => {
    for (const amount of ["-1000", "10.50", "1e3", ""]) {
      expect(
        createTransferRequestSchema.safeParse({
          fromAccountId: A,
          toAccountId: B,
          amountOutMinor: amount,
        }).success,
      ).toBe(false);
    }
  });
});

describe("editar", () => {
  it("exige al menos un campo", () => {
    expect(updateTransferRequestSchema.safeParse({}).success).toBe(false);
  });

  it("deja cambiar un solo campo", () => {
    expect(
      updateTransferRequestSchema.safeParse({ amountOutMinor: "5000" }).success,
    ).toBe(true);
    expect(
      updateTransferRequestSchema.safeParse({ date: "2026-08-01" }).success,
    ).toBe(true);
  });

  it("rechaza dejar el origen y el destino iguales", () => {
    expect(
      updateTransferRequestSchema.safeParse({
        fromAccountId: A,
        toAccountId: A,
      }).success,
    ).toBe(false);
  });

  it("no se queja si solo viene una de las dos cuentas", () => {
    // La otra sale de la transferencia actual y el service verifica que no
    // terminen siendo la misma.
    expect(
      updateTransferRequestSchema.safeParse({ toAccountId: B }).success,
    ).toBe(true);
  });
});
