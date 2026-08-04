import { NextResponse } from "next/server";

/**
 * Liveness probe. La usa el HEALTHCHECK del Dockerfile.
 *
 * A propósito NO toca la base: solo responde si el proceso está vivo. Un
 * readiness check con `SELECT 1` va a ir en /api/v1/system/ready cuando exista
 * la capa de base de datos (incremento 3).
 */
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
