"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api, qs } from "@/lib/api-client";
import { queryKeys, spaceScopeKey } from "@/lib/query-keys";
import type {
  AccountWithBalance,
  CreateAccountRequest,
  UpdateAccountRequest,
} from "@/shared/contracts/accounts";
import type { CategoryTreeNode } from "@/shared/contracts/categories";
import type { Page } from "@/shared/contracts/common";
import type { DashboardResponse } from "@/shared/contracts/reports";
import type {
  CreateTransactionRequest,
  TagDTO,
  TransactionDTO,
  TransactionFilters,
} from "@/shared/contracts/transactions";
import type {
  CreateTransferRequest,
  TransferDTO,
} from "@/shared/contracts/transfers";
import type { SpaceMember } from "@/shared/contracts/spaces";

/** Hooks del dominio financiero. Todos cuelgan de un spaceId. */

export const useAccounts = (spaceId: string, includeArchived = false) =>
  useQuery({
    queryKey: queryKeys.accounts(spaceId, includeArchived),
    queryFn: () =>
      api.get<{ accounts: AccountWithBalance[] }>(
        `/spaces/${spaceId}/accounts${qs({ includeArchived })}`,
      ),
    select: (data) => data.accounts,
    enabled: spaceId !== "",
  });

export const useCategories = (spaceId: string, kind?: "INCOME" | "EXPENSE") =>
  useQuery({
    queryKey: queryKeys.categories(spaceId, kind),
    queryFn: () =>
      api.get<{ categories: CategoryTreeNode[] }>(
        `/spaces/${spaceId}/categories${qs({ kind })}`,
      ),
    select: (data) => data.categories,
    // Las categorías cambian poco: no tiene sentido refetchear a cada rato.
    staleTime: 5 * 60_000,
    enabled: spaceId !== "",
  });

export const useTags = (spaceId: string) =>
  useQuery({
    queryKey: queryKeys.tags(spaceId),
    queryFn: () => api.get<{ tags: TagDTO[] }>(`/spaces/${spaceId}/tags`),
    select: (data) => data.tags,
    staleTime: 5 * 60_000,
    enabled: spaceId !== "",
  });

export const useMembers = (spaceId: string) =>
  useQuery({
    queryKey: queryKeys.members(spaceId),
    queryFn: () =>
      api.get<{ members: SpaceMember[] }>(`/spaces/${spaceId}/members`),
    select: (data) => data.members,
    enabled: spaceId !== "",
  });

export const useDashboard = (spaceId: string, month?: string) =>
  useQuery({
    queryKey: queryKeys.dashboard(spaceId, month),
    queryFn: () =>
      api.get<DashboardResponse>(
        `/spaces/${spaceId}/dashboard${qs({ month })}`,
      ),
    enabled: spaceId !== "",
  });

/**
 * Listado con scroll infinito.
 *
 * El cursor lo devuelve el servidor; acá solo se encadena. Con offset,
 * cargar un movimiento nuevo mientras alguien scrollea desplazaría la página
 * y aparecerían duplicados.
 */
export const useTransactions = (spaceId: string, filters: TransactionFilters) =>
  useInfiniteQuery({
    queryKey: queryKeys.transactions(spaceId, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<TransactionDTO>>(
        `/spaces/${spaceId}/transactions${qs({
          ...filters,
          cursor: pageParam,
          limit: 30,
        })}`,
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: spaceId !== "",
  });

// ────────────────────────────── mutaciones ───────────────────────────────────

/**
 * Invalida todo lo que depende de los movimientos de un Space.
 *
 * Se invalida el Space entero y no solo la lista: un movimiento nuevo cambia
 * también los saldos de las cuentas y todas las cifras del dashboard.
 * Invalidar de más cuesta un refetch; invalidar de menos deja números
 * mintiendo en pantalla.
 */
const useInvalidateSpace = (spaceId: string) => {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
};

export const useCreateTransaction = (spaceId: string) => {
  const invalidate = useInvalidateSpace(spaceId);

  return useMutation({
    mutationFn: (input: CreateTransactionRequest) =>
      api.post<{ transaction: TransactionDTO }>(
        `/spaces/${spaceId}/transactions`,
        input,
      ),
    onSuccess: invalidate,
  });
};

export const useCreateTransfer = (spaceId: string) => {
  const invalidate = useInvalidateSpace(spaceId);

  return useMutation({
    mutationFn: (input: CreateTransferRequest) =>
      api.post<{ transfer: TransferDTO }>(
        `/spaces/${spaceId}/transfers`,
        input,
      ),
    onSuccess: invalidate,
  });
};

export const useDeleteTransaction = (spaceId: string) => {
  const invalidate = useInvalidateSpace(spaceId);

  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/spaces/${spaceId}/transactions/${id}`),
    onSuccess: invalidate,
  });
};

export const useCreateAccount = (spaceId: string) => {
  const invalidate = useInvalidateSpace(spaceId);

  return useMutation({
    mutationFn: (input: CreateAccountRequest) =>
      api.post(`/spaces/${spaceId}/accounts`, input),
    onSuccess: invalidate,
  });
};

export const useUpdateAccount = (spaceId: string) => {
  const invalidate = useInvalidateSpace(spaceId);

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateAccountRequest & { id: string }) =>
      api.patch(`/spaces/${spaceId}/accounts/${id}`, input),
    // Se invalida el Space entero y no solo la lista de cuentas: cambiar el
    // saldo inicial o sacarla del inicio mueve el patrimonio del dashboard.
    onSuccess: invalidate,
  });
};

export const useDeleteAccount = (spaceId: string) => {
  const invalidate = useInvalidateSpace(spaceId);

  return useMutation({
    mutationFn: (id: string) => api.delete(`/spaces/${spaceId}/accounts/${id}`),
    onSuccess: invalidate,
  });
};

export const useArchiveAccount = (spaceId: string) => {
  const invalidate = useInvalidateSpace(spaceId);

  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.post(`/spaces/${spaceId}/accounts/${id}/archive`, { archived }),
    onSuccess: invalidate,
  });
};
