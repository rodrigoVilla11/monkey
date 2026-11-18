"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { api, ApiError } from "@/lib/api-client";
import { formatMoneyDTO } from "@/lib/format";
import { useAccounts } from "@/lib/hooks/use-domain";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { MoneyDTO } from "@/shared/contracts/common";

/**
 * Aceptar un programado sin cuenta: elegir de qué cuenta salió la plata.
 *
 * Es el momento para el que existe la regla sin cuenta. Se ofrecen solo las
 * cuentas en la moneda del programado —el importe no se convierte al
 * aceptar— y al confirmar se materializan todas las ocurrencias vencidas en
 * esa cuenta, ya confirmadas. Lo usan Programados y la tarjeta del inicio.
 */
export function AcceptRuleDrawer({
  open,
  onOpenChange,
  spaceId,
  locale,
  rule,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  locale: string;
  rule: {
    readonly id: string;
    readonly title: string;
    readonly amount: MoneyDTO;
    readonly dueCount?: number;
  };
  onAccepted?: () => void;
}) {
  const queryClient = useQueryClient();
  const accounts = useAccounts(spaceId);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const eligible = (accounts.data ?? []).filter(
    (account) =>
      !account.isArchived && account.currency === rule.amount.currency,
  );

  const accept = async (): Promise<void> => {
    if (accountId === null) return;
    setBusy(true);
    try {
      const result = await api.post<{ created: number }>(
        `/spaces/${spaceId}/recurring/${rule.id}/materialize`,
        { accountId },
      );
      toast.success(
        result.created === 0
          ? "Ya estaba generado"
          : result.created === 1
            ? "Movimiento aceptado"
            : `${String(result.created)} movimientos aceptados`,
      );
      await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
      onOpenChange(false);
      onAccepted?.();
    } catch (error: unknown) {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo aceptar",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>¿De qué cuenta salió?</DrawerTitle>
          <DrawerDescription>
            {rule.title} · {formatMoneyDTO(rule.amount, locale)}
            {rule.dueCount !== undefined && rule.dueCount > 1
              ? ` · ${String(rule.dueCount)} vencidos, cada uno con su fecha`
              : ""}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          {eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay ninguna cuenta en {rule.amount.currency}.{" "}
              <Link href="/accounts" className="underline">
                Creá una
              </Link>{" "}
              o cambiá la moneda del programado.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {eligible.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => {
                    setAccountId(account.id);
                  }}
                  aria-pressed={account.id === accountId}
                  className={cn(
                    "min-h-touch rounded-xl border px-3 py-2 text-left",
                    account.id === accountId && "ring-2 ring-primary",
                  )}
                >
                  <span className="block text-sm font-medium">
                    {account.name}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {formatMoneyDTO(account.balance, locale)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <Button
            type="button"
            className="min-h-touch w-full"
            disabled={accountId === null || busy}
            onClick={() => {
              void accept();
            }}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <Check className="size-4" />
                Aceptar en esta cuenta
              </>
            )}
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
