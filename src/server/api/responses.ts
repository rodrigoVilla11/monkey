import { NextResponse } from "next/server";

/**
 * Serialización de respuestas.
 *
 * El problema que resuelve: `JSON.stringify` TIRA con un `bigint`, y todos los
 * importes del dominio son bigint. Convertirlos a `number` tampoco sirve —
 * arriba de 2^53 se pierde precisión, que en una app de finanzas es
 * inaceptable.
 *
 * Solución: los bigint viajan como **string**. El cliente los vuelve a
 * convertir con los helpers de `shared/money.ts`.
 *
 * Las fechas van en ISO 8601. Las columnas @db.Date llegan como Date a
 * medianoche UTC y se recortan a "YYYY-MM-DD", que es lo que espera
 * `CalendarDate`.
 */

const serialize = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map(serialize);

  if (value !== null && typeof value === "object") {
    // Decimal de Prisma y similares: tienen toJSON propio y hay que respetarlo.
    if ("toJSON" in value && typeof value.toJSON === "function") {
      return (value as { toJSON: () => unknown }).toJSON();
    }

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = serialize(entry);
    }
    return output;
  }

  return value;
};

interface JsonOptions {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly cookies?: readonly string[];
}

export const json = (
  data: unknown,
  options: JsonOptions = {},
): NextResponse => {
  const response = NextResponse.json(serialize(data), {
    status: options.status ?? 200,
    headers: options.headers,
  });

  // append y no set: hay respuestas que mandan dos cookies (access y refresh).
  for (const cookie of options.cookies ?? []) {
    response.headers.append("set-cookie", cookie);
  }

  return response;
};

export const noContent = (cookies: readonly string[] = []): NextResponse => {
  const response = new NextResponse(null, { status: 204 });
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
};

/**
 * Descarga de un archivo generado.
 *
 * Vive acá y no en el handler que la usa porque la cabecera
 * `Content-Disposition` tiene una trampa: un nombre con comillas o saltos de
 * línea permite inyectar cabeceras. El nombre se sanea en un solo lugar.
 *
 * `no-store` porque lo que se descarga son datos financieros del usuario: no
 * pueden quedar en el caché de un proxy compartido.
 */
export const attachment = (
  content: string,
  options: { readonly filename: string; readonly contentType: string },
): NextResponse => {
  const safeName = options.filename.replace(/["\r\n\\]/g, "");

  return new NextResponse(content, {
    status: 200,
    headers: {
      "content-type": options.contentType,
      "content-disposition": `attachment; filename="${safeName}"`,
      "cache-control": "no-store",
    },
  });
};

export { serialize as serializeForJson };
