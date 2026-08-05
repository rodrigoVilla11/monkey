"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useMembers } from "@/lib/hooks/use-domain";
import { useSwitchSpace } from "@/lib/hooks/use-session";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SpaceSummary } from "@/shared/contracts/spaces";

/**
 * Selector de Space en el header.
 *
 * Se abre como bottom sheet (Drawer) y no como modal centrado: en un teléfono
 * el pulgar llega abajo, no al centro de la pantalla.
 *
 * Cuando el Space es compartido muestra los avatares de sus miembros, que es
 * la señal visual de "acá lo que cargues lo ve otra gente".
 */
export function SpaceSwitcher({
  space,
  spaces,
}: {
  space: SpaceSummary;
  spaces: readonly SpaceSummary[];
}) {
  const [open, setOpen] = useState(false);
  const switchSpace = useSwitchSpace();
  const router = useRouter();

  const select = (id: string): void => {
    setOpen(false);
    if (id !== space.id) switchSpace.mutate(id);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          className="-ml-2 flex min-h-touch items-center gap-2 rounded-lg px-2 text-left active:opacity-70"
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
            style={{ backgroundColor: space.color ?? "var(--muted)" }}
            aria-hidden
          >
            {space.icon ?? initials(space.name)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1">
              <span className="truncate font-semibold">{space.name}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </span>
            {space.memberCount > 1 && (
              <MemberAvatars spaceId={space.id} count={space.memberCount} />
            )}
          </span>
        </button>
      </DrawerTrigger>

      <DrawerContent className="pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>Cambiar de espacio</DrawerTitle>
        </DrawerHeader>

        <ul className="px-4 pb-2">
          {spaces.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  select(item.id);
                }}
                className="flex min-h-touch w-full items-center gap-3 rounded-lg px-2 py-3 text-left active:bg-accent"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
                  style={{ backgroundColor: item.color ?? "var(--muted)" }}
                  aria-hidden
                >
                  {item.icon ?? initials(item.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {item.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {item.isPersonal
                      ? "Personal"
                      : `${String(item.memberCount)} miembros`}
                    {" · "}
                    {item.primaryCurrency}
                  </span>
                </span>
                {item.id === space.id && (
                  <Check className="size-5 shrink-0 text-foreground" />
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="border-t p-4">
          <Button
            variant="outline"
            className="min-h-touch w-full"
            onClick={() => {
              setOpen(false);
              router.push("/settings/spaces/new");
            }}
          >
            <Plus className="size-4" />
            Crear espacio compartido
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Avatares apilados de los miembros. Máximo 3 + contador: más se vuelve
 * ilegible a 375px de ancho.
 */
function MemberAvatars({ spaceId, count }: { spaceId: string; count: number }) {
  const members = useMembers(spaceId);

  if (members.data === undefined) {
    return (
      <span className="block text-xs text-muted-foreground">
        {count} miembros
      </span>
    );
  }

  const shown = members.data.slice(0, 3);
  const rest = members.data.length - shown.length;

  return (
    <span className="flex items-center gap-1">
      <span className="flex -space-x-1.5">
        {shown.map((member) => (
          <Avatar
            key={member.userId}
            className="size-4 ring-2 ring-background"
            title={member.name}
          >
            {member.avatarUrl !== null && (
              <AvatarImage src={member.avatarUrl} alt="" />
            )}
            <AvatarFallback className="text-[8px]">
              {initials(member.name)}
            </AvatarFallback>
          </Avatar>
        ))}
      </span>
      {rest > 0 && (
        <span className={cn("text-[10px] text-muted-foreground")}>+{rest}</span>
      )}
    </span>
  );
}
