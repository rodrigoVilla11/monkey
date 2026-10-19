"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  formatCalendarDate,
  isCalendarDate,
  monthRange,
  type CalendarDate,
  type DateRange,
} from "@/shared/dates";
import {
  canStepForward,
  describeRange,
  exceedsMaxRange,
  isOrderedRange,
  isSingleMonth,
  MAX_RANGE_MONTHS,
  PERIOD_PRESETS,
  presetRange,
  sameRange,
  shiftRange,
  type PeriodPreset,
} from "@/shared/periods";

const PRESET_LABELS: Record<PeriodPreset, string> = {
  "this-week": "Esta semana",
  "last-week": "Semana pasada",
  "this-month": "Este mes",
  "last-month": "Mes pasado",
  "last-3-months": "Últimos 3 meses",
  "last-6-months": "Últimos 6 meses",
  "last-12-months": "Últimos 12 meses",
  "this-year": "Este año",
  "last-year": "Año pasado",
};

/**
 * Selector de período de los reportes.
 *
 * Una barra con flechas para ir al período anterior o siguiente —del mismo
 * largo que el actual— y, en el medio, el nombre del período, que abre un
 * drawer con tres formas de elegir: atajos, un mes puntual y un rango libre.
 *
 * El mismo período aplica a todas las pestañas: cambiar de pestaña no cambia
 * de qué se está hablando.
 */
export function PeriodPicker({
  range,
  today,
  locale,
  weekStartsOn,
  onChange,
}: {
  range: DateRange;
  today: CalendarDate;
  locale: string;
  /** 0 = domingo … 6 = sábado. Para los atajos semanales. */
  weekStartsOn: number;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);

  const apply = (next: DateRange) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-touch shrink-0"
          aria-label="Período anterior"
          onClick={() => {
            onChange(shiftRange(range, -1));
          }}
        >
          <ChevronLeft />
        </Button>

        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="flex min-h-touch min-w-0 flex-1 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs"
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">
            {describeRange(range, locale)}
          </span>
        </button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-touch shrink-0"
          aria-label="Período siguiente"
          disabled={!canStepForward(range, today)}
          onClick={() => {
            onChange(shiftRange(range, 1));
          }}
        >
          <ChevronRight />
        </Button>
      </div>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Período</DrawerTitle>
          </DrawerHeader>

          <DrawerBody className="space-y-6">
            <Section label="Atajos">
              <div className="flex flex-wrap gap-2">
                {PERIOD_PRESETS.map((preset) => {
                  const candidate = presetRange(preset, today, weekStartsOn);
                  return (
                    <Chip
                      key={preset}
                      active={sameRange(candidate, range)}
                      onClick={() => {
                        apply(candidate);
                      }}
                    >
                      {PRESET_LABELS[preset]}
                    </Chip>
                  );
                })}
              </div>
            </Section>

            <MonthGrid
              range={range}
              today={today}
              locale={locale}
              onPick={apply}
            />

            <CustomRange range={range} onApply={apply} />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}

// ──────────────────────────── mes puntual ────────────────────────────────────

function MonthGrid({
  range,
  today,
  locale,
  onPick,
}: {
  range: DateRange;
  today: CalendarDate;
  locale: string;
  onPick: (range: DateRange) => void;
}) {
  const selectedMonth = isSingleMonth(range) ? range.start.slice(0, 7) : null;
  const currentMonth = today.slice(0, 7);
  const currentYear = Number(currentMonth.slice(0, 4));

  // Se abre en el año del período que se está mirando, sea un mes o no.
  const [year, setYear] = useState(Number(range.start.slice(0, 4)));

  const months = Array.from(
    { length: 12 },
    (_, index) => `${String(year)}-${String(index + 1).padStart(2, "0")}`,
  );

  return (
    <Section label="Mes">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Año anterior"
          onClick={() => {
            setYear((value) => value - 1);
          }}
        >
          <ChevronLeft />
        </Button>
        <span className="text-sm font-medium tabular-nums">{year}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Año siguiente"
          disabled={year >= currentYear}
          onClick={() => {
            setYear((value) => value + 1);
          }}
        >
          <ChevronRight />
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {months.map((month) => {
          const first = `${month}-01`;
          const future = month > currentMonth;
          const active = month === selectedMonth;

          return (
            <button
              key={month}
              type="button"
              disabled={future}
              aria-pressed={active}
              onClick={() => {
                onPick(monthRange(first));
              }}
              className={cn(
                "min-h-touch rounded-md border text-sm capitalize",
                active && "border-primary bg-primary text-primary-foreground",
                future && "opacity-40",
              )}
            >
              {formatCalendarDate(first, locale, { month: "short" })}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ──────────────────────────── rango libre ────────────────────────────────────

function CustomRange({
  range,
  onApply,
}: {
  range: DateRange;
  onApply: (range: DateRange) => void;
}) {
  const [from, setFrom] = useState(range.start);
  const [to, setTo] = useState(range.end);

  const candidate: DateRange = { start: from, end: to };
  const complete = isCalendarDate(from) && isCalendarDate(to);

  const error = !complete
    ? null
    : !isOrderedRange(candidate)
      ? "El inicio tiene que ser anterior al fin"
      : exceedsMaxRange(candidate)
        ? `Como máximo ${String(MAX_RANGE_MONTHS)} meses`
        : null;

  return (
    <Section label="Personalizado">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="period-from">Desde</Label>
          <Input
            id="period-from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
            className="min-h-touch"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="period-to">Hasta</Label>
          <Input
            id="period-to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
            className="min-h-touch"
          />
        </div>
      </div>

      {error !== null && <p className="text-xs text-destructive">{error}</p>}

      <Button
        type="button"
        className="min-h-touch w-full"
        disabled={!complete || error !== null}
        onClick={() => {
          onApply(candidate);
        }}
      >
        Aplicar
      </Button>
    </Section>
  );
}

// ─────────────────────────────── piezas ──────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-touch rounded-full border px-3 text-sm",
        active && "border-primary bg-primary text-primary-foreground",
      )}
    >
      {children}
    </button>
  );
}
