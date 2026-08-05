import { describe, expect, it, vi, afterEach } from "vitest";

import { clientIp, rateLimiter } from "@/server/api/rate-limit";

/**
 * El limitador usa `Date.now()`, así que los tests manipulan el reloj en vez de
 * esperar de verdad. Sin esto, probar una ventana de 5 minutos tardaría 5
 * minutos.
 */
afterEach(() => {
  vi.useRealTimers();
});

describe("rate limiter en memoria", () => {
  it("deja pasar hasta el límite y después corta", () => {
    const key = `test-basico-${String(Math.trunc(performance.now() * 1000))}`;

    for (let i = 0; i < 3; i += 1) {
      expect(
        rateLimiter.check(key, 3, 60).allowed,
        `intento ${String(i)}`,
      ).toBe(true);
    }

    const blocked = rateLimiter.check(key, 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("informa cuántos intentos quedan", () => {
    const key = `test-restantes-${String(Math.trunc(performance.now() * 1000))}`;

    expect(rateLimiter.check(key, 3, 60).remaining).toBe(2);
    expect(rateLimiter.check(key, 3, 60).remaining).toBe(1);
    expect(rateLimiter.check(key, 3, 60).remaining).toBe(0);
  });

  it("lleva contadores independientes por clave", () => {
    const suffix = String(Math.trunc(performance.now() * 1000));

    rateLimiter.check(`a-${suffix}`, 1, 60);
    expect(rateLimiter.check(`a-${suffix}`, 1, 60).allowed).toBe(false);
    // Otra IP no queda afectada.
    expect(rateLimiter.check(`b-${suffix}`, 1, 60).allowed).toBe(true);
  });

  it("es una ventana DESLIZANTE, no cubetas fijas", () => {
    // Con cubetas fijas se puede meter el doble del límite a caballo del corte
    // entre dos cubetas. Este test fija ese comportamiento.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T10:00:00Z"));

    const key = "ventana-deslizante";

    expect(rateLimiter.check(key, 2, 60).allowed).toBe(true);
    vi.setSystemTime(new Date("2026-08-05T10:00:50Z"));
    expect(rateLimiter.check(key, 2, 60).allowed).toBe(true);

    // A los 55 s el primer intento sigue dentro de la ventana: bloquea.
    vi.setSystemTime(new Date("2026-08-05T10:00:55Z"));
    expect(rateLimiter.check(key, 2, 60).allowed).toBe(false);

    // A los 61 s el primero ya salió: deja pasar uno más.
    vi.setSystemTime(new Date("2026-08-05T10:01:01Z"));
    expect(rateLimiter.check(key, 2, 60).allowed).toBe(true);
  });

  it("libera del todo pasada la ventana entera", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));

    const key = "ventana-completa";
    rateLimiter.check(key, 2, 60);
    rateLimiter.check(key, 2, 60);
    expect(rateLimiter.check(key, 2, 60).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-08-05T12:02:00Z"));
    expect(rateLimiter.check(key, 2, 60).allowed).toBe(true);
    expect(rateLimiter.check(key, 2, 60).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  it("toma el primer valor de x-forwarded-for, que es el cliente real", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("cae en x-real-ip si no hay forwarded", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
  });

  it("no rompe cuando no hay ninguna cabecera", () => {
    expect(clientIp(new Headers())).toBe("desconocida");
  });
});
