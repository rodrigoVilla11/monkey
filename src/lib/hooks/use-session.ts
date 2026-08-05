"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { purgeApiCaches, setServiceWorkerUser } from "@/lib/sw-bridge";
import type { SessionUser } from "@/shared/contracts/auth";
import type { SpaceSummary } from "@/shared/contracts/spaces";

/**
 * Sesión y Space activo.
 *
 * `activeSpaceId` vive en el servidor (columna de User), no en localStorage:
 * así se comparte entre dispositivos y sobrevive a limpiar el navegador.
 */

export const useSession = () => {
  const query = useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const result = await api.get<{ user: SessionUser }>("/me");
      /**
       * Se le dice al Service Worker quién está usando la app. Con eso puede
       * descartar cualquier respuesta que quedara cacheada por otra sesión —
       * la red de seguridad para cuando el mensaje de purga no llegó porque el
       * SW estaba dormido.
       */
      void setServiceWorkerUser(result.user.id);
      return result;
    },
    select: (data) => data.user,
    retry: false,
  });

  return query;
};

export const useSpaces = () =>
  useQuery({
    queryKey: queryKeys.spaces,
    queryFn: () => api.get<{ spaces: SpaceSummary[] }>("/spaces"),
    select: (data) => data.spaces,
  });

/**
 * El Space que se está mirando.
 *
 * Si el guardado ya no existe (lo borraron, o te expulsaron), cae en el
 * primero disponible en vez de dejar la app en blanco.
 */
export const useActiveSpace = (): {
  space: SpaceSummary | undefined;
  spaces: SpaceSummary[] | undefined;
  isLoading: boolean;
} => {
  const session = useSession();
  const spaces = useSpaces();

  const list = spaces.data;
  const activeId = session.data?.activeSpaceId;

  const space =
    list === undefined
      ? undefined
      : (list.find((s) => s.id === activeId) ?? list[0]);

  return {
    space,
    spaces: list,
    isLoading: session.isLoading || spaces.isLoading,
  };
};

/**
 * Cambio de Space activo.
 *
 * Limpia TODA la caché de queries antes de navegar. Es el mismo bug que el
 * brief pide evitar en el Service Worker: sin limpiar, la pantalla nueva
 * muestra por un instante los saldos del Space anterior.
 */
export const useSwitchSpace = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (spaceId: string) =>
      api.put<{ user: SessionUser }>("/me/active-space", { spaceId }),
    onSuccess: async (data) => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, data);
      // Se purga ANTES de navegar: si no, la pantalla nueva puede alcanzar a
      // pintar los saldos del Space anterior desde caché.
      await purgeApiCaches(data.user.id);
      router.refresh();
    },
  });
};

export const useLogout = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: async () => {
      // Se limpia igual si el logout falló: la intención de la persona es
      // salir, y dejar datos en pantalla sería peor.
      queryClient.clear();
      await purgeApiCaches();
      router.replace("/login");
    },
  });
};
