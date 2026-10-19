"use client";

import { useRef } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
} from "recharts";

import { formatMoneyDTO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SeriesPoint } from "@/shared/contracts/reports-v2";

/**
 * Serie temporal, en dos lecturas de los mismos datos.
 *
 * · `flow`    — barras de ingresos y egresos por corte
 * · `balance` — curva del patrimonio acumulado (el cash flow)
 *
 * Decisiones para móvil, las mismas que en el donut del dashboard:
 *  · **Sin tooltip flotante.** El dedo tapa justo lo que quiere mostrar. En
 *    su lugar, tocar el gráfico elige un corte y el detalle se muestra ARRIBA
 *    del gráfico, siempre en el mismo lugar (`onSelect`). El corte se calcula
 *    por posición horizontal, no por el evento de Recharts: con un toque no
 *    hay "hover" previo que lo haya activado.
 *  · **Sin animación.** Compite con el scroll, que es lo que el brief pide
 *    evitar.
 *  · **Sin eje Y.** A 375px de ancho se come un tercio de la pantalla para
 *    mostrar cifras que ya están en la tabla.
 *
 * Para un lector de pantalla el gráfico es una imagen con nombre (`title`);
 * los números están en la tabla de abajo, que sí se navega.
 */
export function SeriesChart({
  points,
  mode,
  title,
  selectedKey,
  onSelect,
}: {
  points: readonly SeriesPoint[];
  mode: "flow" | "balance";
  title: string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  // Recharts necesita `number` para la geometría. Es solo el alto de la barra:
  // los importes que se MUESTRAN salen siempre del bigint original.
  const data = points.map((point) => ({
    key: point.key,
    income: Number(BigInt(point.income.amountMinor)),
    expense: Number(BigInt(point.expense.amountMinor)),
    balance: Number(BigInt(point.runningBalance.amountMinor)),
  }));

  const labels = new Map(points.map((point) => [point.key, point.label]));

  /**
   * Qué corte se tocó. Sin eje Y ni márgenes laterales, el eje X ocupa todo
   * el ancho: las barras reparten el ancho en bandas iguales y la curva pone
   * sus puntos en los extremos y a distancias iguales.
   */
  const pick = (event: React.MouseEvent<HTMLDivElement>) => {
    const node = container.current;
    if (node === null || points.length === 0) return;

    const rect = node.getBoundingClientRect();
    if (rect.width === 0) return;

    const ratio = Math.min(
      Math.max((event.clientX - rect.left) / rect.width, 0),
      0.9999,
    );
    const index =
      mode === "flow"
        ? Math.floor(ratio * points.length)
        : Math.round(ratio * (points.length - 1));

    const point = points[index];
    if (point !== undefined) onSelect(point.key);
  };

  const axis = (
    <XAxis
      dataKey="key"
      tickFormatter={(value: string) => labels.get(value) ?? value}
      tickLine={false}
      axisLine={false}
      tick={{ fontSize: 10 }}
      // Con 12 meses o 31 días no entran todas las etiquetas a 375px.
      interval="preserveStartEnd"
      minTickGap={16}
    />
  );

  const marker =
    selectedKey === null ? null : (
      <ReferenceLine
        x={selectedKey}
        stroke="var(--foreground)"
        strokeOpacity={0.35}
        strokeDasharray="3 3"
      />
    );

  return (
    <div
      ref={container}
      role="img"
      aria-label={title}
      className="h-48 w-full"
      onClick={pick}
    >
      <ResponsiveContainer width="100%" height="100%">
        {mode === "flow" ? (
          <BarChart
            data={data}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} strokeOpacity={0.12} />
            {axis}
            {marker}
            <Bar
              dataKey="income"
              fill="var(--income)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="expense"
              fill="var(--expense)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        ) : (
          <AreaChart
            data={data}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--income)"
                  stopOpacity={0.28}
                />
                <stop offset="100%" stopColor="var(--income)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeOpacity={0.12} />
            {axis}
            {marker}
            <Area
              type="monotone"
              dataKey="balance"
              stroke="var(--income)"
              strokeWidth={2}
              fill="url(#balance-fill)"
              isAnimationActive={false}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Un corte que vale la pena listar, según lo que se está mirando. */
export const isVisibleRow = (
  point: SeriesPoint,
  mode: "flow" | "balance",
): boolean =>
  point.transactionCount > 0 ||
  // En la curva de patrimonio, el día de un desembolso de préstamo mueve
  // la curva aunque no haya ningún gasto: tiene que poder verse.
  (mode === "balance" && point.transferCount > 0);

/**
 * Tabla que acompaña al gráfico: es donde viven los números exactos.
 * Tocar una fila elige ese corte en el gráfico, y al revés.
 */
export function SeriesTable({
  points,
  locale,
  mode,
  selectedKey,
  onSelect,
}: {
  points: readonly SeriesPoint[];
  locale: string;
  mode: "flow" | "balance";
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  // Del más reciente al más viejo: es el que a uno le interesa primero.
  const rows = [...points]
    .reverse()
    .filter((point) => isVisibleRow(point, mode));

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Todavía no hay movimientos en este período
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {rows.map((point) => (
        <li key={point.key}>
          <button
            type="button"
            onClick={() => {
              onSelect(point.key);
            }}
            aria-pressed={point.key === selectedKey}
            className={cn(
              "flex w-full flex-col gap-0.5 px-1 py-2.5 text-left",
              point.key === selectedKey && "rounded-md bg-secondary/60",
            )}
          >
            {/* Título y resultado en una línea; el detalle debajo. A 375px
                "Octubre de 2026" más tres importes no entran en una sola. */}
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-sm">{point.title}</span>
              <span
                className={cn(
                  "shrink-0 text-sm font-medium tabular-nums",
                  mode === "flow" &&
                    BigInt(point.net.amountMinor) < 0n &&
                    "text-expense",
                )}
              >
                {mode === "flow"
                  ? formatMoneyDTO(point.net, locale, { signDisplay: "always" })
                  : formatMoneyDTO(point.runningBalance, locale)}
              </span>
            </span>

            <span className="flex gap-3 text-xs tabular-nums">
              {mode === "flow" && (
                <>
                  <span className="text-income">
                    {formatMoneyDTO(point.income, locale)}
                  </span>
                  <span className="text-expense">
                    {formatMoneyDTO(point.expense, locale)}
                  </span>
                </>
              )}
              <span className="text-muted-foreground">
                {point.transactionCount} mov.
                {point.transferCount > 0 &&
                  ` · ${String(point.transferCount)} transf.`}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
