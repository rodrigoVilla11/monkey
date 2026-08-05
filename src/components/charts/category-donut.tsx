"use client";

import { Pie, PieChart, ResponsiveContainer } from "recharts";

import { formatMoneyDTO } from "@/lib/format";
import type { CategoryBreakdownItem } from "@/shared/contracts/reports";

/**
 * Donut de gasto por categoría, con su tabla al lado.
 *
 * Decisiones deliberadas para móvil:
 *  · **Sin tooltip.** En un teléfono el dedo tapa justo lo que el tooltip
 *    quiere mostrar. La tabla de abajo da el mismo dato, siempre visible.
 *  · **Sin animación de entrada.** El gráfico aparece cuando el dashboard ya
 *    scrolleó; animarlo compite con el scroll, que es lo que pide el brief
 *    evitar.
 *  · El color sale de la categoría, así el mismo gasto se ve del mismo color
 *    en el donut, en la lista y en el grid de carga rápida.
 */
export function CategoryDonut({
  data,
  locale,
}: {
  data: readonly CategoryBreakdownItem[];
  locale: string;
}) {
  const slices = data.map((item) => ({
    name: item.name,
    // Recharts necesita un number para el ángulo. Es solo geometría: el
    // importe que se MUESTRA sale siempre del bigint original.
    value: Number(BigInt(item.total.amountMinor)),
    // El color va en el propio dato. Recharts 3 deprecó <Cell> justamente en
    // favor de esto.
    fill: item.color ?? "#71717a",
  }));

  return (
    <div className="space-y-3">
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="space-y-1.5">
        {data.map((item) => (
          <li
            key={item.categoryId ?? item.name}
            className="flex items-center gap-2 text-sm"
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.color ?? "#71717a" }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {item.percentage}%
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {formatMoneyDTO(item.total, locale)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
