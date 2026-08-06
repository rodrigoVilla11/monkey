"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
} from "recharts";

import { formatMoneyDTO } from "@/lib/format";
import type { MonthlyPoint } from "@/shared/contracts/reports-v2";

/**
 * Serie mensual, en dos lecturas de los mismos datos.
 *
 * · `flow`    — barras de ingresos y egresos por mes
 * · `balance` — curva del patrimonio acumulado (el cash flow)
 *
 * Decisiones para móvil, las mismas que en el donut del dashboard:
 *  · **Sin tooltip.** El dedo tapa justo lo que quiere mostrar. Los números
 *    van en la tabla de abajo, siempre visibles.
 *  · **Sin animación.** Compite con el scroll, que es lo que el brief pide
 *    evitar.
 *  · **Sin eje Y.** A 375px de ancho se come un tercio de la pantalla para
 *    mostrar cifras que ya están en la tabla.
 */
export function MonthlyChart({
  points,
  mode,
}: {
  points: readonly MonthlyPoint[];
  mode: "flow" | "balance";
}) {
  // Recharts necesita `number` para la geometría. Es solo el alto de la barra:
  // los importes que se MUESTRAN salen siempre del bigint original.
  const data = points.map((point) => ({
    label: point.label,
    income: Number(BigInt(point.income.amountMinor)),
    expense: Number(BigInt(point.expense.amountMinor)),
    balance: Number(BigInt(point.runningBalance.amountMinor)),
  }));

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {mode === "flow" ? (
          <BarChart
            data={data}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} strokeOpacity={0.12} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              // Con 12 meses no entran todas las etiquetas a 375px.
              interval="preserveStartEnd"
              minTickGap={12}
            />
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
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
              minTickGap={12}
            />
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

/** Tabla que acompaña al gráfico: es donde viven los números exactos. */
export function MonthlyTable({
  points,
  locale,
  mode,
}: {
  points: readonly MonthlyPoint[];
  locale: string;
  mode: "flow" | "balance";
}) {
  // Del más reciente al más viejo: es el que a uno le interesa primero.
  const rows = [...points]
    .reverse()
    .filter((point) => point.transactionCount > 0);

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
        <li
          key={point.month}
          className="flex items-center justify-between gap-2 py-2.5 text-sm"
        >
          <span className="w-16 shrink-0 text-xs text-muted-foreground">
            {point.label}
          </span>

          {mode === "flow" ? (
            <span className="flex flex-1 items-center justify-end gap-3 tabular-nums">
              <span className="text-xs text-income">
                {formatMoneyDTO(point.income, locale)}
              </span>
              <span className="text-xs text-expense">
                {formatMoneyDTO(point.expense, locale)}
              </span>
              <span
                className={
                  BigInt(point.net.amountMinor) < 0n
                    ? "w-24 text-right font-medium text-expense"
                    : "w-24 text-right font-medium"
                }
              >
                {formatMoneyDTO(point.net, locale, { signDisplay: "always" })}
              </span>
            </span>
          ) : (
            <span className="flex-1 text-right font-medium tabular-nums">
              {formatMoneyDTO(point.runningBalance, locale)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
