import { prisma, type PrismaClient } from "./client";

/**
 * Cliente SIN scope por Space.
 *
 * Se llama así a propósito: si aparece en un diff, tiene que saltar a la vista
 * y justificarse. Cada llamada esquiva la única barrera que impide filtrar
 * datos entre Spaces.
 *
 * Los usos legítimos son pocos y conocidos:
 *
 *  1. **Auth** — buscar un usuario por email en el login, validar tokens de
 *     verificación y refresh. Todo eso pasa antes de que exista un Space
 *     activo.
 *  2. **Registro** — crear el User y su Space personal. El Space todavía no
 *     existe cuando arranca la operación.
 *  3. **Resolución de acceso** — `requireSpaceAccess()` lee Membership para
 *     decidir a qué Space puede entrar quien pide. Es la función que PRODUCE
 *     el spaceId, así que no puede depender de él.
 *  4. **Invitaciones** — aceptar una invitación cruza de "sin Space" a
 *     "miembro del Space".
 *  5. **Job de recurrentes** — barre RecurringRule de todos los Spaces. Cada
 *     transacción que materializa se escribe con `forSpace(regla.spaceId)`.
 *
 * Cualquier otro uso es un bug. Si necesitás datos de dominio, usá `forSpace`.
 */
export const systemClient = (): PrismaClient => prisma;
