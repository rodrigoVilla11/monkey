/**
 * Crea el primer usuario sin pasar por el flujo de mail.
 *
 *   pnpm user:create rodrigo@ejemplo.com "Rodrigo" "mi-contraseña-larga"
 *
 * Sirve para arrancar una instancia nueva en el VPS: crea la cuenta con el
 * email YA VERIFICADO, así se puede entrar antes de tener el envío de mails
 * configurado.
 *
 * Reutiliza el mismo service que el registro normal — un mailer de descarte
 * evita el envío — para que no exista un segundo camino de creación de
 * usuarios que se pueda desincronizar del real.
 */
// Primero de todo: Next carga los .env por su cuenta, pero un script suelto
// no. Los imports ESM se evalúan en orden, así que esto tiene que ir antes de
// cualquier módulo que lea `env`.
import "dotenv/config";

import { systemClient } from "@/server/db/system";
import { register } from "@/server/services/auth/register";
import type { Mailer } from "@/server/mail/mailer";
import { normalizeEmail } from "@/shared/email";
import { registerRequestSchema } from "@/shared/contracts/auth";

const noopMailer: Mailer = { send: () => Promise.resolve() };

const main = async (): Promise<void> => {
  const [email, name, password] = process.argv.slice(2);

  if (!email || !name || !password) {
    console.error(
      'Uso: pnpm user:create <email> "<nombre>" "<contraseña>"\n\n' +
        "La contraseña necesita al menos 10 caracteres.",
    );
    process.exit(1);
  }

  const parsed = registerRequestSchema.safeParse({ email, name, password });
  if (!parsed.success) {
    console.error("Datos inválidos:");
    for (const issue of parsed.error.issues) {
      console.error(`  · ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const { userId, spaceId } = await register(parsed.data, {
    mailer: noopMailer,
  });

  // Se da por verificado: no hay mail que abrir.
  await systemClient().user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });

  console.log("✓ Usuario creado y verificado");
  console.log(`  email:   ${normalizeEmail(email)}`);
  console.log(`  usuario: ${userId}`);
  console.log(`  space:   ${spaceId} (Personal)`);
  console.log("\nYa podés iniciar sesión.");

  await systemClient().$disconnect();
};

main().catch((error: unknown) => {
  console.error(
    "✖ No se pudo crear el usuario:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
