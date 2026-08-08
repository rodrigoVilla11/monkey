"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api-client";
import { initials } from "@/lib/format";
import { useMembers } from "@/lib/hooks/use-domain";
import { useActiveSpace } from "@/lib/hooks/use-session";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  ASSIGNABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  canManageMember,
  hasAtLeast,
  type AssignableRole,
} from "@/shared/roles";

/**
 * Miembros del Space.
 *
 * La UI usa `canManageMember` —la MISMA función que aplica el servidor— para
 * no ofrecer botones que van a dar 403. Pero es solo cosmética: el permiso
 * real se chequea en el servidor en cada request, siempre.
 */
export default function MembersPage() {
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const members = useMembers(spaceId);
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);

  const myRole = space?.role ?? "VIEWER";
  const canInvite = hasAtLeast(myRole, "ADMIN");

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AssignableRole }) =>
      api.patch(`/spaces/${spaceId}/members/${userId}`, { role }),
    onSuccess: async () => {
      toast.success("Rol actualizado");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.members(spaceId),
      });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo cambiar",
      );
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/spaces/${spaceId}/members/${userId}`),
    onSuccess: async () => {
      toast.success("Miembro expulsado");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.members(spaceId),
      });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo expulsar",
      );
    },
  });

  return (
    <div className="space-y-4 py-3">
      <Link
        href="/settings"
        className="flex min-h-touch items-center gap-1 text-sm text-muted-foreground"
      >
        <ChevronLeft className="size-4" />
        Ajustes
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Miembros</h1>
        {canInvite && (
          <Button
            size="sm"
            className="min-h-touch"
            onClick={() => {
              setShowInvite(true);
            }}
          >
            <UserPlus className="size-4" />
            Invitar
          </Button>
        )}
      </div>

      {members.data === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_unused, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {members.data.map((member) => {
            const manageable =
              !member.isSelf && canManageMember(myRole, member.role);

            return (
              <Card key={member.userId} className="gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    {member.avatarUrl !== null && (
                      <AvatarImage src={member.avatarUrl} alt="" />
                    )}
                    <AvatarFallback>{initials(member.name)}</AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {member.name}
                      {member.isSelf && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          (vos)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email}
                    </p>
                  </div>

                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ROLE_LABELS[member.role]}
                  </span>
                </div>

                {manageable && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    {ASSIGNABLE_ROLES.map((role) => (
                      <button
                        key={role}
                        type="button"
                        disabled={role === member.role || changeRole.isPending}
                        onClick={() => {
                          changeRole.mutate({ userId: member.userId, role });
                        }}
                        className={cn(
                          "min-h-touch rounded-full border px-3 text-xs",
                          role === member.role &&
                            "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {ROLE_LABELS[role]}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        remove.mutate(member.userId);
                      }}
                      className="ml-auto min-h-touch text-xs text-destructive underline underline-offset-4"
                    >
                      Expulsar
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <InviteSheet
        open={showInvite}
        onOpenChange={setShowInvite}
        spaceId={spaceId}
      />
    </div>
  );
}

function InviteSheet({
  open,
  onOpenChange,
  spaceId,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("MEMBER");

  const invite = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/invitations`, { email, role }),
    onSuccess: () => {
      toast.success("Invitación enviada");
      setEmail("");
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo invitar",
      );
    },
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>Invitar a alguien</DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-2">
            <Label>Permisos</Label>
            {ASSIGNABLE_ROLES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setRole(option);
                }}
                aria-pressed={role === option}
                className={cn(
                  "min-h-touch w-full rounded-lg border p-3 text-left",
                  role === option && "border-primary ring-1 ring-primary",
                )}
              >
                <span className="block text-sm font-medium">
                  {ROLE_LABELS[option]}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {ROLE_DESCRIPTIONS[option]}
                </span>
              </button>
            ))}
          </div>

          <Button
            className="min-h-touch w-full"
            disabled={email.trim() === "" || invite.isPending}
            onClick={() => {
              invite.mutate();
            }}
          >
            {invite.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Enviar invitación"
            )}
          </Button>

          <p className="text-xs text-muted-foreground">
            La invitación vence en 7 días y solo la puede aceptar esa dirección
            de email.
          </p>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
