import { env } from "@/env";

/**
 * Rate limiting.
 *
 * Dos mecanismos distintos porque protegen de cosas distintas:
 *
 *  · **Por IP** (acá) — ventana deslizante en memoria. Frena a un cliente que
 *    martilla un endpoint. Se pierde en cada redeploy, y con varias réplicas
 *    cada una lleva su cuenta: aceptable para un VPS con un contenedor.
 *
 *  · **Por email** (en el service de login, con `failedLoginCount` y
 *    `lockedUntil` en la tabla User) — ese SÍ tiene que sobrevivir a un
 *    redeploy, porque un ataque de fuerza bruta contra una cuenta concreta
 *    dura horas y reiniciar el proceso no puede limpiarle el contador.
 *
 * La interfaz existe para poder meter una implementación con Redis cuando haga
 * falta escalar horizontalmente, sin tocar los handlers.
 */

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowSeconds: number): RateLimitResult;
}

interface Bucket {
  /** Timestamps de los intentos dentro de la ventana. */
  hits: number[];
}

class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  public check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): RateLimitResult {
    if (!env.RATE_LIMIT_ENABLED) {
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }

    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const cutoff = now - windowMs;

    this.sweep(now, windowMs);

    const bucket = this.buckets.get(key) ?? { hits: [] };
    // Ventana deslizante de verdad, no cubetas fijas: sin esto, alguien puede
    // meter 2× el límite a caballo del corte entre dos cubetas.
    bucket.hits = bucket.hits.filter((time) => time > cutoff);

    if (bucket.hits.length >= limit) {
      const oldest = bucket.hits[0] ?? now;
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + windowMs - now) / 1000),
        ),
      };
    }

    bucket.hits.push(now);
    this.buckets.set(key, bucket);

    return {
      allowed: true,
      remaining: limit - bucket.hits.length,
      retryAfterSeconds: 0,
    };
  }

  /** Limpieza perezosa: sin esto el Map crece sin techo. */
  private sweep(now: number, windowMs: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;

    for (const [key, bucket] of this.buckets) {
      const alive = bucket.hits.filter((time) => time > now - windowMs);
      if (alive.length === 0) this.buckets.delete(key);
      else bucket.hits = alive;
    }
  }
}

export const rateLimiter: RateLimiter = new InMemoryRateLimiter();

/**
 * Límites por endpoint. Generosos para el uso normal y ajustados para lo que
 * de verdad se puede automatizar.
 */
export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 3600 },
  forgotPassword: { limit: 5, windowSeconds: 3600 },
  resendVerification: { limit: 5, windowSeconds: 3600 },
  refresh: { limit: 60, windowSeconds: 300 },
} as const;

/**
 * IP del cliente detrás del reverse proxy del VPS.
 *
 * Se toma el PRIMER valor de `x-forwarded-for`, que es el cliente original;
 * los siguientes son los proxies intermedios. Ojo: esto es confiable solo si
 * hay un proxy propio delante que reescriba el header. Expuesto directo a
 * internet, cualquiera puede falsificarlo.
 */
export const clientIp = (headers: Headers): string => {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded !== "") {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  return headers.get("x-real-ip") ?? "desconocida";
};
