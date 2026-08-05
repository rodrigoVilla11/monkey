/**
 * Fixtures de desarrollo.
 *
 *   pnpm db:seed
 *
 * Deja un escenario listo para trabajar en la UI sin tener que registrarse y
 * aceptar invitaciones a mano cada vez:
 *
 *   · rodrigo@monkey.local — OWNER de su Space personal y de "Casa"
 *   · ana@monkey.local     — MEMBER de "Casa"
 *   · lucas@monkey.local   — VIEWER de "Casa"
 *
 * Contraseña de los tres: monkey-desarrollo-2026
 *
 * Es idempotente: si los usuarios ya existen, no hace nada. Y se niega a correr
 * contra una base que no sea de desarrollo.
 */
import "dotenv/config";

import { hashPassword } from "@/server/auth/password";
import { systemClient } from "@/server/db/system";
import { seedCategories } from "@/server/services/auth/register";

const PASSWORD = "monkey-desarrollo-2026";

const guardEnvironment = (): void => {
  const url = process.env.DATABASE_URL ?? "";

  if (process.env.NODE_ENV === "production") {
    throw new Error("El seed no corre en producción");
  }

  // Los datos de prueba tienen contraseñas conocidas: que no terminen en una
  // base real por un DATABASE_URL mal apuntado.
  if (!url.includes("localhost") && !url.includes("127.0.0.1")) {
    throw new Error(
      `El seed solo corre contra una base local. DATABASE_URL apunta a: ${url.replace(/:[^:@]*@/, ":***@")}`,
    );
  }
};

const main = async (): Promise<void> => {
  guardEnvironment();

  const db = systemClient();
  const existing = await db.user.findUnique({
    where: { email: "rodrigo@monkey.local" },
    select: { id: true },
  });

  if (existing !== null) {
    console.log("Los datos de desarrollo ya están cargados. Nada que hacer.");
    console.log("Para regenerarlos: pnpm db:reset && pnpm db:seed");
    await db.$disconnect();
    return;
  }

  const passwordHash = await hashPassword(PASSWORD);

  const makeUser = (
    email: string,
    name: string,
    timezone: string,
    locale: string,
  ) =>
    db.user.create({
      data: {
        email,
        passwordHash,
        name,
        timezone,
        locale,
        emailVerifiedAt: new Date(),
      },
    });

  const rodrigo = await makeUser(
    "rodrigo@monkey.local",
    "Rodrigo",
    "Europe/Madrid",
    "es-ES",
  );
  const ana = await makeUser(
    "ana@monkey.local",
    "Ana",
    "America/Argentina/Buenos_Aires",
    "es-AR",
  );
  const lucas = await makeUser(
    "lucas@monkey.local",
    "Lucas",
    "Europe/Madrid",
    "es-ES",
  );

  // Un Space personal por persona, igual que hace el registro real.
  for (const user of [rodrigo, ana, lucas]) {
    const personal = await db.space.create({
      data: {
        name: "Personal",
        primaryCurrency: user.locale === "es-AR" ? "ARS" : "EUR",
        timezone: user.timezone,
        isPersonal: true,
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    await seedCategories(db, personal.id, user.locale);
    await db.user.update({
      where: { id: user.id },
      data: { activeSpaceId: personal.id },
    });
  }

  // El Space compartido, que es el caso interesante para probar la UI.
  const casa = await db.space.create({
    data: {
      name: "Casa",
      primaryCurrency: "EUR",
      timezone: "Europe/Madrid",
      icon: "House",
      color: "#3b82f6",
      memberships: {
        create: [
          { userId: rodrigo.id, role: "OWNER" },
          { userId: ana.id, role: "MEMBER", invitedByUserId: rodrigo.id },
          { userId: lucas.id, role: "VIEWER", invitedByUserId: rodrigo.id },
        ],
      },
    },
  });
  await seedCategories(db, casa.id, "es-ES");

  const cuenta = await db.account.create({
    data: {
      spaceId: casa.id,
      name: "Cuenta conjunta",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 250_000n, // 2.500,00 €
      color: "#3b82f6",
      icon: "Landmark",
    },
  });

  const efectivo = await db.account.create({
    data: {
      spaceId: casa.id,
      name: "Efectivo",
      type: "CASH",
      currency: "EUR",
      initialBalanceMinor: 15_000n,
      color: "#22c55e",
      icon: "Banknote",
    },
  });

  const categorias = await db.category.findMany({
    where: { spaceId: casa.id, parentId: { not: null } },
    select: { id: true, name: true },
  });
  const buscar = (name: string): string =>
    categorias.find((c) => c.name === name)?.id ?? categorias[0]?.id ?? "";

  // Movimientos repartidos entre los dos miembros que pueden cargar, para que
  // se vean los avatares en el listado.
  const movimientos = [
    {
      d: "2026-08-01",
      desc: "Supermercado",
      amount: 8_450n,
      cat: "Supermercado",
      by: rodrigo,
      acc: cuenta,
    },
    {
      d: "2026-08-02",
      desc: "Alquiler agosto",
      amount: 95_000n,
      cat: "Alquiler o hipoteca",
      by: rodrigo,
      acc: cuenta,
    },
    {
      d: "2026-08-02",
      desc: "Café",
      amount: 380n,
      cat: "Cafetería",
      by: ana,
      acc: efectivo,
    },
    {
      d: "2026-08-03",
      desc: "Cena fuera",
      amount: 4_200n,
      cat: "Restaurantes",
      by: ana,
      acc: cuenta,
    },
    {
      d: "2026-08-04",
      desc: "Metro",
      amount: 1_100n,
      cat: "Transporte público",
      by: ana,
      acc: efectivo,
    },
    {
      d: "2026-08-04",
      desc: "Farmacia",
      amount: 1_890n,
      cat: "Farmacia",
      by: rodrigo,
      acc: cuenta,
    },
    {
      d: "2026-08-05",
      desc: "Internet",
      amount: 3_990n,
      cat: "Internet y teléfono",
      by: rodrigo,
      acc: cuenta,
    },
  ];

  for (const m of movimientos) {
    await db.transaction.create({
      data: {
        spaceId: casa.id,
        accountId: m.acc.id,
        categoryId: buscar(m.cat),
        createdByUserId: m.by.id,
        createdByName: m.by.name,
        type: "EXPENSE",
        amountMinor: m.amount,
        currency: "EUR",
        date: new Date(`${m.d}T00:00:00Z`),
        description: m.desc,
      },
    });
  }

  const salario = await db.category.findFirst({
    where: { spaceId: casa.id, name: "Salario" },
    select: { id: true },
  });

  await db.transaction.create({
    data: {
      spaceId: casa.id,
      accountId: cuenta.id,
      categoryId: salario?.id ?? null,
      createdByUserId: rodrigo.id,
      createdByName: rodrigo.name,
      type: "INCOME",
      amountMinor: 210_000n,
      currency: "EUR",
      date: new Date("2026-08-01T00:00:00Z"),
      description: "Nómina agosto",
    },
  });

  console.log("✓ Datos de desarrollo cargados\n");
  console.log("  Usuarios (contraseña: " + PASSWORD + ")");
  console.log("    rodrigo@monkey.local  OWNER de Casa");
  console.log("    ana@monkey.local      MEMBER de Casa");
  console.log("    lucas@monkey.local    VIEWER de Casa");
  console.log("\n  Space compartido 'Casa' con 2 cuentas y 8 movimientos.");

  await db.$disconnect();
};

main().catch((error: unknown) => {
  console.error(
    "✖ Falló el seed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
