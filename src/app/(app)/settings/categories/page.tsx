"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api-client";
import { useActiveSpace } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  CATEGORY_KINDS,
  type CategoryDTO,
  type CategoryTreeNode,
} from "@/shared/contracts/categories";
import { hasAtLeast } from "@/shared/roles";

/**
 * Categorías.
 *
 * Las que vienen de fábrica se pueden renombrar, repintar y archivar como
 * cualquier otra: son una propuesta, no un catálogo cerrado. Lo que no se puede
 * es cambiarles el tipo — una categoría de gasto con movimientos cargados no
 * puede volverse de ingreso sin invertir el signo de todo lo que cuelga de ella.
 *
 * ── Archivar y borrar no son lo mismo ───────────────────────────────────────
 *
 * Archivar la saca del selector y no toca una sola fila del pasado. Borrar
 * reasigna —o deja sin categoría— todos los movimientos que la usaban, o sea
 * que reescribe en qué se gastó. Por eso archivar está a un toque y borrar
 * pide confirmación y avisa cuántos movimientos se lleva puestos.
 */
const KIND_LABEL: Record<(typeof CATEGORY_KINDS)[number], string> = {
  EXPENSE: "Gastos",
  INCOME: "Ingresos",
};

/** Un puñado de íconos de lucide, agrupados por para qué suelen servir. */
const ICONS = [
  "ShoppingCart",
  "Utensils",
  "Coffee",
  "Beer",
  "House",
  "Lamp",
  "Droplet",
  "Fuel",
  "Car",
  "Bus",
  "Plane",
  "HeartPulse",
  "Pill",
  "Dumbbell",
  "GraduationCap",
  "Book",
  "MonitorPlay",
  "PartyPopper",
  "Gift",
  "PawPrint",
  "Shirt",
  "Smartphone",
  "Wifi",
  "Hammer",
  "Briefcase",
  "Landmark",
  "Receipt",
  "Percent",
  "PiggyBank",
  "Wallet",
  "HandHeart",
  "CircleEllipsis",
] as const;

const COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#71717a",
] as const;

export default function CategoriesPage() {
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";

  const [kind, setKind] = useState<(typeof CATEGORY_KINDS)[number]>("EXPENSE");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CategoryDTO | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(
    null,
  );

  const categories = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "categories-admin", kind],
    queryFn: () =>
      api.get<{ categories: CategoryTreeNode[] }>(
        `/spaces/${spaceId}/categories?kind=${kind}&includeArchived=true`,
      ),
    select: (data) => data.categories,
    enabled: spaceId !== "",
  });

  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");

  const visible = (categories.data ?? []).filter(
    (category) => showArchived || !category.isArchived,
  );

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center gap-2">
        <Link
          href="/settings"
          className="-ml-2 flex min-h-touch min-w-touch items-center justify-center text-muted-foreground"
          aria-label="Volver a ajustes"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="flex-1 text-xl font-semibold">Categorías</h1>
        {canEdit && (
          <Button
            size="sm"
            className="min-h-touch"
            onClick={() => {
              setCreating({ parentId: null });
            }}
          >
            <Plus className="size-4" />
            Nueva
          </Button>
        )}
      </div>

      <div className="flex rounded-full bg-secondary p-1">
        {CATEGORY_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setKind(option);
            }}
            aria-pressed={kind === option}
            className={cn(
              "min-h-touch flex-1 rounded-full text-sm font-medium",
              kind === option
                ? option === "EXPENSE"
                  ? "bg-expense text-expense-foreground"
                  : "bg-income text-income-foreground"
                : "text-muted-foreground",
            )}
          >
            {KIND_LABEL[option]}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          setShowArchived(!showArchived);
        }}
        aria-pressed={showArchived}
        className="min-h-touch text-xs text-muted-foreground"
      >
        {showArchived ? "Ocultar las archivadas" : "Ver también las archivadas"}
      </button>

      {categories.data === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_unused, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((category) => (
            <Card key={category.id} className="gap-0 overflow-hidden p-0">
              <CategoryRow
                category={category}
                canEdit={canEdit}
                onEdit={() => {
                  setEditing(category);
                }}
              />

              {category.children
                .filter((child) => showArchived || !child.isArchived)
                .map((child) => (
                  <CategoryRow
                    key={child.id}
                    category={child}
                    canEdit={canEdit}
                    nested
                    onEdit={() => {
                      setEditing(child);
                    }}
                  />
                ))}

              {canEdit && !category.isArchived && (
                <button
                  type="button"
                  onClick={() => {
                    setCreating({ parentId: category.id });
                  }}
                  className="flex min-h-touch w-full items-center gap-2 border-t px-4 py-2 pl-12 text-left text-xs text-muted-foreground"
                >
                  <Plus className="size-3.5" />
                  Subcategoría de {category.name}
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      {editing !== null && (
        <EditCategorySheet
          key={editing.id}
          open
          onOpenChange={(value) => {
            if (!value) setEditing(null);
          }}
          spaceId={spaceId}
          category={editing}
          siblings={categories.data ?? []}
        />
      )}

      {creating !== null && (
        <NewCategorySheet
          open
          onOpenChange={(value) => {
            if (!value) setCreating(null);
          }}
          spaceId={spaceId}
          kind={kind}
          parentId={creating.parentId}
        />
      )}
    </div>
  );
}

function CategoryRow({
  category,
  canEdit,
  nested = false,
  onEdit,
}: {
  category: CategoryDTO;
  canEdit: boolean;
  nested?: boolean;
  onEdit: () => void;
}) {
  const body = (
    <>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${category.color ?? "#71717a"}26` }}
      >
        <DynamicIcon
          name={category.icon}
          className="size-4"
          style={{ color: category.color ?? undefined }}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
      {category.isArchived && (
        <span className="shrink-0 text-xs text-muted-foreground">
          archivada
        </span>
      )}
    </>
  );

  const shell = cn(
    "flex w-full items-center gap-3 border-t px-4 py-3 text-left first:border-t-0",
    nested && "pl-12",
    category.isArchived && "opacity-60",
  );

  return canEdit ? (
    <button type="button" onClick={onEdit} className={shell}>
      {body}
    </button>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/** Los campos que comparten crear y editar. */
function CategoryFields({
  name,
  onName,
  icon,
  onIcon,
  color,
  onColor,
}: {
  name: string;
  onName: (value: string) => void;
  icon: string | null;
  onIcon: (value: string) => void;
  color: string | null;
  onColor: (value: string) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="category-name">Nombre</Label>
        <Input
          id="category-name"
          value={name}
          onChange={(e) => {
            onName(e.target.value);
          }}
          placeholder="Supermercado"
          className="min-h-touch"
        />
      </div>

      <div className="space-y-2">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onColor(option);
              }}
              aria-label={`Color ${option}`}
              aria-pressed={color === option}
              className={cn(
                "size-9 rounded-full",
                color === option && "ring-2 ring-foreground ring-offset-2",
              )}
              style={{ backgroundColor: option }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Ícono</Label>
        <div className="grid grid-cols-6 gap-2">
          {ICONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onIcon(option);
              }}
              aria-label={option}
              aria-pressed={icon === option}
              className={cn(
                "flex min-h-touch items-center justify-center rounded-xl border",
                icon === option && "border-primary bg-primary/10",
              )}
            >
              <DynamicIcon
                name={option}
                className="size-5"
                style={{ color: color ?? undefined }}
              />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function NewCategorySheet({
  open,
  onOpenChange,
  spaceId,
  kind,
  parentId,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  kind: (typeof CATEGORY_KINDS)[number];
  parentId: string | null;
}) {
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/categories`, {
        name,
        kind,
        parentId,
        icon,
        color,
      }),
    onSuccess: async () => {
      toast.success("Categoría creada");
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo crear",
      );
    },
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>
            {parentId === null ? "Nueva categoría" : "Nueva subcategoría"}
          </DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <CategoryFields
            name={name}
            onName={setName}
            icon={icon}
            onIcon={setIcon}
            color={color}
            onColor={setColor}
          />

          <Button
            className="min-h-touch w-full"
            disabled={name.trim() === "" || create.isPending}
            onClick={() => {
              create.mutate();
            }}
          >
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Crear"
            )}
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function EditCategorySheet({
  open,
  onOpenChange,
  spaceId,
  category,
  siblings,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  category: CategoryDTO;
  /** Las de primer nivel, para elegir a dónde reasignar al borrar. */
  siblings: readonly CategoryTreeNode[];
}) {
  const queryClient = useQueryClient();

  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon);
  const [color, setColor] = useState(category.color);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reassignTo, setReassignTo] = useState<string | null>(null);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/spaces/${spaceId}/categories/${category.id}`, body),
    onSuccess: async (_data, body) => {
      toast.success(
        "isArchived" in body
          ? body.isArchived === true
            ? "Archivada"
            : "Sacada del archivo"
          : "Categoría actualizada",
      );
      onOpenChange(false);
      await invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo guardar",
      );
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      api.delete(
        `/spaces/${spaceId}/categories/${category.id}${
          reassignTo === null ? "" : `?reassignTo=${reassignTo}`
        }`,
      ),
    onSuccess: async () => {
      toast.success("Categoría eliminada");
      onOpenChange(false);
      await invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo eliminar",
      );
    },
  });

  const busy = patch.isPending || remove.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>{category.name}</DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <CategoryFields
            name={name}
            onName={setName}
            icon={icon}
            onIcon={setIcon}
            color={color}
            onColor={setColor}
          />

          <Button
            className="min-h-touch w-full"
            disabled={name.trim() === "" || busy}
            onClick={() => {
              patch.mutate({ name, icon, color });
            }}
          >
            {patch.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Guardar cambios"
            )}
          </Button>

          <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <div className="min-w-0">
              <Label htmlFor="category-archived">Archivada</Label>
              <p className="text-xs text-muted-foreground">
                Deja de aparecer al cargar un movimiento. Lo ya cargado no se
                toca: los reportes del pasado siguen diciendo lo mismo.
                {category.parentId === null &&
                  " Sus subcategorías la acompañan."}
              </p>
            </div>
            <Switch
              id="category-archived"
              checked={category.isArchived}
              disabled={busy}
              onCheckedChange={(checked) => {
                patch.mutate({ isArchived: checked });
              }}
            />
          </div>

          {/**
           * Borrar está detrás de una confirmación y no de un tacho suelto: es
           * la única acción de esta pantalla que reescribe el pasado.
           */}
          {!confirmDelete ? (
            <Button
              variant="ghost"
              className="min-h-touch w-full text-expense"
              disabled={busy}
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              <Trash2 className="size-4" />
              Eliminar
            </Button>
          ) : (
            <div className="space-y-3 rounded-xl border border-expense/40 p-3">
              <p className="text-xs">
                Eliminar no es archivar: los movimientos que usan esta categoría
                {category.parentId === null && " y sus subcategorías"} pasan a
                la que elijas, o quedan sin categoría. Eso cambia los reportes
                de meses ya cerrados.
              </p>

              <div className="space-y-1.5">
                <Label>Los movimientos pasan a</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReassignTo(null);
                    }}
                    aria-pressed={reassignTo === null}
                    className={cn(
                      "min-h-touch rounded-full border px-3 text-sm",
                      reassignTo === null &&
                        "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    Sin categoría
                  </button>
                  {siblings
                    .filter((one) => one.id !== category.id && !one.isArchived)
                    .map((one) => (
                      <button
                        key={one.id}
                        type="button"
                        onClick={() => {
                          setReassignTo(one.id);
                        }}
                        aria-pressed={reassignTo === one.id}
                        className={cn(
                          "min-h-touch rounded-full border px-3 text-sm",
                          reassignTo === one.id &&
                            "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {one.name}
                      </button>
                    ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="min-h-touch flex-1"
                  disabled={busy}
                  onClick={() => {
                    setConfirmDelete(false);
                  }}
                >
                  Mejor no
                </Button>
                <Button
                  className="min-h-touch flex-1 bg-expense text-expense-foreground"
                  disabled={busy}
                  onClick={() => {
                    remove.mutate();
                  }}
                >
                  {remove.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Eliminar"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
