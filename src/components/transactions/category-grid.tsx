"use client";

import { ChevronLeft } from "lucide-react";
import { useMemo, useState } from "react";

import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { cn } from "@/lib/utils";
import type {
  CategoryDTO,
  CategoryTreeNode,
} from "@/shared/contracts/categories";

/**
 * Grid de categorías con íconos.
 *
 * Se elige tocando un ícono, no desplegando un `<select>`: reconocer un
 * símbolo es mucho más rápido que leer una lista, y es lo que permite que la
 * carga sean tres toques.
 *
 * Al tocar una categoría con subcategorías se abre su segundo nivel en el
 * mismo lugar, sin navegar ni abrir otra hoja.
 */
export function CategoryGrid({
  categories,
  selectedId,
  onSelect,
}: {
  categories: readonly CategoryTreeNode[];
  selectedId: string | null;
  onSelect: (category: CategoryDTO | null) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const expanded = useMemo(
    () => categories.find((c) => c.id === expandedId),
    [categories, expandedId],
  );

  if (expanded !== undefined) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => {
            setExpandedId(null);
          }}
          className="flex min-h-touch items-center gap-1 text-sm text-muted-foreground"
        >
          <ChevronLeft className="size-4" />
          {expanded.name}
        </button>

        <div className="grid grid-cols-4 gap-2">
          {/* La categoría padre también es elegible: no todo gasto de
              "Transporte" es de una subcategoría concreta. */}
          <CategoryTile
            category={expanded}
            selected={selectedId === expanded.id}
            onSelect={onSelect}
            label="General"
          />
          {expanded.children.map((child) => (
            <CategoryTile
              key={child.id}
              category={child}
              selected={selectedId === child.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {categories.map((category) => {
        if (category.children.length === 0) {
          return (
            <CategoryTile
              key={category.id}
              category={category}
              selected={selectedId === category.id}
              onSelect={onSelect}
            />
          );
        }

        /**
         * Una madre se muestra elegida cuando lo está una de sus hijas, y con
         * el nombre de la hija.
         *
         * Sin esto, elegir "Supermercado" y volver al primer nivel dejaba la
         * pantalla sin ninguna marca: parecía que no había nada elegido. Con
         * un tilde en la madre pero sin decir cuál, tampoco alcanza — la
         * pregunta es "¿qué elegí?", no "¿elegí algo?".
         */
        const child = category.children.find((one) => one.id === selectedId);

        return (
          <CategoryTile
            key={category.id}
            category={category}
            selected={child !== undefined}
            label={child?.name}
            hasChildren
            onSelect={() => {
              setExpandedId(category.id);
            }}
          />
        );
      })}
    </div>
  );
}

function CategoryTile({
  category,
  selected,
  hasChildren = false,
  label,
  onSelect,
}: {
  category: CategoryDTO;
  selected: boolean;
  hasChildren?: boolean;
  label?: string;
  onSelect: (category: CategoryDTO | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(selected ? null : category);
      }}
      aria-pressed={selected}
      className={cn(
        "flex min-h-touch flex-col items-center gap-1.5 rounded-xl p-2",
        "active:scale-95 motion-safe:transition-transform",
        selected && "ring-2 ring-primary",
      )}
    >
      <span
        className="relative flex size-11 items-center justify-center rounded-full"
        style={{ backgroundColor: `${category.color ?? "#71717a"}26` }}
      >
        <DynamicIcon
          name={category.icon}
          className="size-5"
          style={{ color: category.color ?? undefined }}
        />
        {hasChildren && (
          <span
            className="absolute right-0 bottom-0 size-1.5 rounded-full bg-foreground/60"
            aria-hidden
          />
        )}
      </span>
      <span className="line-clamp-2 text-center text-[10px] leading-tight font-medium">
        {label ?? category.name}
      </span>
    </button>
  );
}
