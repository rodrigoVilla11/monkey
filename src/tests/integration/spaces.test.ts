import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { InMemoryMailer } from "@/server/mail/mailer";
import { register } from "@/server/services/auth/register";
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
} from "@/server/services/spaces/invitations";
import {
  changeMemberRole,
  leaveSpace,
  listMembers,
  removeMember,
  transferOwnership,
} from "@/server/services/spaces/members";
import {
  createSpace,
  deleteSpace,
  listSpaces,
} from "@/server/services/spaces/spaces";
import { forSpace } from "@/server/db/scoped";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Reglas de negocio de Spaces, membresías e invitaciones.
 *
 * La matriz de permisos por rol vive en role-matrix.test.ts. Acá se prueban
 * las reglas que van MÁS ALLÁ del rol mínimo: que un ADMIN no pueda tocar al
 * OWNER, que nadie se quede sin Space, que las invitaciones sean de un solo
 * uso y para el email correcto.
 */

const mailer = new InMemoryMailer();
const PASSWORD = "una-contraseña-bien-larga";

interface Person {
  readonly userId: string;
  readonly spaceId: string;
  readonly email: string;
  readonly name: string;
}

const createPerson = async (label: string): Promise<Person> => {
  const email = `${label}@spaces.test`;
  const { userId, spaceId } = await register(
    { email, password: PASSWORD, name: label },
    { mailer },
  );
  await testDb.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
  return { userId, spaceId, email, name: label };
};

const actorOf = (
  person: Person,
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
) => ({
  userId: person.userId,
  name: person.name,
  role,
});

const tokenFromMail = (to: string): string => {
  const message = mailer.lastTo(to);
  const match = /invite\/([\w-]+)/.exec(message?.text ?? "");
  if (!match?.[1]) throw new Error(`No hay token de invitación para ${to}`);
  return match[1];
};

beforeEach(async () => {
  await resetDatabase();
  mailer.clear();
});

afterAll(async () => {
  await resetDatabase();
  await disconnect();
});

describe("creación de Spaces", () => {
  it("crea el Space con el catálogo de categorías y al creador como OWNER", async () => {
    const rodrigo = await createPerson("rodrigo");

    const space = await createSpace(rodrigo.userId, rodrigo.name, {
      name: "Casa",
      primaryCurrency: "ARS",
    });

    expect(space.role).toBe("OWNER");
    expect(space.isPersonal).toBe(false);
    expect(space.primaryCurrency).toBe("ARS");
    expect(space.memberCount).toBe(1);

    const categories = await forSpace(space.id).category.findMany();
    expect(categories.length).toBeGreaterThan(30);
  });

  it("hereda la timezone de quien crea, no la del entorno", async () => {
    const rodrigo = await createPerson("rodrigo");
    await testDb.user.update({
      where: { id: rodrigo.userId },
      data: { timezone: "America/Argentina/Buenos_Aires" },
    });

    const space = await createSpace(rodrigo.userId, rodrigo.name, {
      name: "Viaje",
    });

    expect(space.timezone).toBe("America/Argentina/Buenos_Aires");
  });

  it("lista los Spaces con el rol de cada uno y el personal primero", async () => {
    const rodrigo = await createPerson("rodrigo");
    await createSpace(rodrigo.userId, rodrigo.name, { name: "Casa" });

    const spaces = await listSpaces(rodrigo.userId);

    expect(spaces).toHaveLength(2);
    expect(spaces[0]?.isPersonal).toBe(true);
    expect(spaces.every((s) => s.role === "OWNER")).toBe(true);
  });

  it("no lista los Spaces de otra persona", async () => {
    const rodrigo = await createPerson("rodrigo");
    const ana = await createPerson("ana");

    const spaces = await listSpaces(rodrigo.userId);
    expect(spaces.map((s) => s.id)).not.toContain(ana.spaceId);
  });
});

describe("eliminación de Spaces", () => {
  it("no deja eliminar el único Space de una persona", async () => {
    const rodrigo = await createPerson("rodrigo");

    await expect(
      deleteSpace(rodrigo.spaceId, rodrigo.userId, rodrigo.name),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("elimina lógicamente y limpia el Space activo de todos", async () => {
    const rodrigo = await createPerson("rodrigo");
    const casa = await createSpace(rodrigo.userId, rodrigo.name, {
      name: "Casa",
    });
    await testDb.user.update({
      where: { id: rodrigo.userId },
      data: { activeSpaceId: casa.id },
    });

    await deleteSpace(casa.id, rodrigo.userId, rodrigo.name);

    const row = await testDb.space.findUnique({ where: { id: casa.id } });
    expect(row?.deletedAt).not.toBeNull();

    const user = await testDb.user.findUnique({
      where: { id: rodrigo.userId },
    });
    expect(user?.activeSpaceId).toBeNull();

    expect(await listSpaces(rodrigo.userId)).toHaveLength(1);
  });
});

describe("invitaciones", () => {
  it("manda el mail y aparece como pendiente", async () => {
    const rodrigo = await createPerson("rodrigo");
    await createPerson("ana");
    mailer.clear();

    const invitation = await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: "ana@spaces.test", role: "MEMBER" },
      { mailer },
    );

    expect(invitation.role).toBe("MEMBER");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain("te invitó");

    const pending = await listInvitations(rodrigo.spaceId);
    expect(pending).toHaveLength(1);
  });

  it("guarda el token hasheado, nunca en claro", async () => {
    const rodrigo = await createPerson("rodrigo");
    mailer.clear();
    await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: "nuevo@spaces.test", role: "VIEWER" },
      { mailer },
    );

    const plain = tokenFromMail("nuevo@spaces.test");
    const stored = await testDb.invitation.findFirst();

    expect(stored?.tokenHash).not.toBe(plain);
    expect(stored?.tokenHash).toHaveLength(64);
  });

  it("la vista previa no necesita sesión y no filtra nada del Space", async () => {
    const rodrigo = await createPerson("rodrigo");
    mailer.clear();
    await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: "ana@spaces.test", role: "ADMIN" },
      { mailer },
    );

    const preview = await previewInvitation(tokenFromMail("ana@spaces.test"));

    expect(preview.spaceName).toBe("Personal");
    expect(preview.role).toBe("ADMIN");
    expect(preview.invitedByName).toBe("rodrigo");
    // Solo lo justo para la pantalla: nada de miembros, cuentas ni saldos.
    expect(Object.keys(preview).sort()).toEqual([
      "email",
      "expiresAt",
      "invitedByName",
      "role",
      "spaceName",
    ]);
  });

  it("aceptar suma la membresía con el rol preasignado", async () => {
    const rodrigo = await createPerson("rodrigo");
    const ana = await createPerson("ana");
    mailer.clear();

    await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: ana.email, role: "MEMBER" },
      { mailer },
    );

    const result = await acceptInvitation(tokenFromMail(ana.email), {
      id: ana.userId,
      email: ana.email,
      name: ana.name,
    });

    expect(result.spaceId).toBe(rodrigo.spaceId);
    expect(result.role).toBe("MEMBER");

    const members = await listMembers(rodrigo.spaceId, rodrigo.userId);
    expect(members).toHaveLength(2);

    // El Space nuevo pasa a ser el activo: es lo que acaba de pedir ver.
    const user = await testDb.user.findUnique({ where: { id: ana.userId } });
    expect(user?.activeSpaceId).toBe(rodrigo.spaceId);
  });

  it("NO se puede aceptar con un email distinto al invitado", async () => {
    // Los enlaces viajan por mail, se reenvían y quedan en historiales.
    const rodrigo = await createPerson("rodrigo");
    await createPerson("ana");
    const intruso = await createPerson("intruso");
    mailer.clear();

    await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: "ana@spaces.test", role: "MEMBER" },
      { mailer },
    );

    await expect(
      acceptInvitation(tokenFromMail("ana@spaces.test"), {
        id: intruso.userId,
        email: intruso.email,
        name: intruso.name,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await listMembers(rodrigo.spaceId, rodrigo.userId)).toHaveLength(1);
  });

  it("el token es de un solo uso", async () => {
    const rodrigo = await createPerson("rodrigo");
    const ana = await createPerson("ana");
    mailer.clear();

    await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: ana.email, role: "MEMBER" },
      { mailer },
    );
    const token = tokenFromMail(ana.email);

    await acceptInvitation(token, {
      id: ana.userId,
      email: ana.email,
      name: ana.name,
    });

    await expect(
      acceptInvitation(token, {
        id: ana.userId,
        email: ana.email,
        name: ana.name,
      }),
    ).rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });

  it("invitar de nuevo revoca el enlace anterior", async () => {
    const rodrigo = await createPerson("rodrigo");
    const ana = await createPerson("ana");
    mailer.clear();

    await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: ana.email, role: "VIEWER" },
      { mailer },
    );
    const first = tokenFromMail(ana.email);

    await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: ana.email, role: "ADMIN" },
      { mailer },
    );
    const second = tokenFromMail(ana.email);

    expect(second).not.toBe(first);
    await expect(previewInvitation(first)).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
    expect((await previewInvitation(second)).role).toBe("ADMIN");
    // El índice único parcial garantiza una sola pendiente.
    expect(await listInvitations(rodrigo.spaceId)).toHaveLength(1);
  });

  it("una invitación revocada deja de servir", async () => {
    const rodrigo = await createPerson("rodrigo");
    mailer.clear();

    const invitation = await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: "ana@spaces.test", role: "MEMBER" },
      { mailer },
    );
    const token = tokenFromMail("ana@spaces.test");

    await revokeInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      invitation.id,
    );

    await expect(previewInvitation(token)).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
  });

  it("no se puede revocar una invitación de otro Space", async () => {
    const rodrigo = await createPerson("rodrigo");
    const ana = await createPerson("ana");
    mailer.clear();

    const ajena = await createInvitation(
      ana.spaceId,
      actorOf(ana, "OWNER"),
      { email: "tercero@spaces.test", role: "MEMBER" },
      { mailer },
    );

    // ID válido, pero de otro Space: 404, no una revocación ajena.
    await expect(
      revokeInvitation(rodrigo.spaceId, actorOf(rodrigo, "OWNER"), ajena.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await listInvitations(ana.spaceId)).toHaveLength(1);
  });

  it("no deja invitar a quien ya es miembro", async () => {
    const rodrigo = await createPerson("rodrigo");
    mailer.clear();

    await expect(
      createInvitation(
        rodrigo.spaceId,
        actorOf(rodrigo, "OWNER"),
        { email: rodrigo.email, role: "MEMBER" },
        { mailer },
      ),
    ).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
  });

  it("una invitación vencida da TOKEN_EXPIRED", async () => {
    const rodrigo = await createPerson("rodrigo");
    mailer.clear();

    await createInvitation(
      rodrigo.spaceId,
      actorOf(rodrigo, "OWNER"),
      { email: "ana@spaces.test", role: "MEMBER" },
      { mailer },
    );
    await testDb.invitation.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      previewInvitation(tokenFromMail("ana@spaces.test")),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });
});

describe("gestión de miembros", () => {
  const setupShared = async () => {
    const owner = await createPerson("owner");
    const admin = await createPerson("admin");
    const member = await createPerson("member");
    mailer.clear();

    for (const [person, role] of [
      [admin, "ADMIN"],
      [member, "MEMBER"],
    ] as const) {
      await createInvitation(
        owner.spaceId,
        actorOf(owner, "OWNER"),
        { email: person.email, role },
        { mailer },
      );
      await acceptInvitation(tokenFromMail(person.email), {
        id: person.userId,
        email: person.email,
        name: person.name,
      });
    }

    return { owner, admin, member, spaceId: owner.spaceId };
  };

  it("un ADMIN no puede tocar al OWNER", async () => {
    const { owner, admin, spaceId } = await setupShared();

    await expect(
      changeMemberRole(
        spaceId,
        actorOf(admin, "ADMIN"),
        owner.userId,
        "VIEWER",
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ROLE" });

    await expect(
      removeMember(spaceId, actorOf(admin, "ADMIN"), owner.userId),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ROLE" });
  });

  it("un ADMIN no puede tocar a otro ADMIN", async () => {
    // Sin esta regla, dos administradores pueden expulsarse entre sí.
    const { owner, admin, member, spaceId } = await setupShared();
    await changeMemberRole(
      spaceId,
      actorOf(owner, "OWNER"),
      member.userId,
      "ADMIN",
    );

    await expect(
      removeMember(spaceId, actorOf(admin, "ADMIN"), member.userId),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ROLE" });
  });

  it("el OWNER sí puede gestionar a un ADMIN", async () => {
    const { owner, admin, spaceId } = await setupShared();

    await changeMemberRole(
      spaceId,
      actorOf(owner, "OWNER"),
      admin.userId,
      "VIEWER",
    );

    const members = await listMembers(spaceId, owner.userId);
    expect(members.find((m) => m.userId === admin.userId)?.role).toBe("VIEWER");
  });

  it("nadie puede cambiar su propio rol", async () => {
    const { owner, spaceId } = await setupShared();

    await expect(
      changeMemberRole(spaceId, actorOf(owner, "OWNER"), owner.userId, "ADMIN"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("el OWNER no puede abandonar sin transferir primero", async () => {
    const { owner, spaceId } = await setupShared();

    await expect(
      leaveSpace(spaceId, actorOf(owner, "OWNER")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("un miembro puede irse y deja de ver el Space", async () => {
    const { owner, member, spaceId } = await setupShared();

    await leaveSpace(spaceId, actorOf(member, "MEMBER"));

    expect(await listMembers(spaceId, owner.userId)).toHaveLength(2);
    expect((await listSpaces(member.userId)).map((s) => s.id)).not.toContain(
      spaceId,
    );
  });

  it("expulsar no borra lo que la persona había cargado", async () => {
    // Las transacciones son datos del Space, no de la persona.
    const { owner, member, spaceId } = await setupShared();
    const db = forSpace(spaceId);

    const account = await db.account.create({
      data: { spaceId, name: "Común", type: "BANK", currency: "EUR" },
    });
    await db.transaction.create({
      data: {
        spaceId,
        accountId: account.id,
        createdByUserId: member.userId,
        createdByName: member.name,
        type: "EXPENSE",
        amountMinor: 1500n,
        currency: "EUR",
        date: new Date("2026-08-05T00:00:00Z"),
      },
    });

    await removeMember(spaceId, actorOf(owner, "OWNER"), member.userId);

    const transactions = await db.transaction.findMany();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.createdByName).toBe("member");
  });
});

describe("transferencia de propiedad", () => {
  it("mueve el OWNER y deja al anterior como ADMIN", async () => {
    const owner = await createPerson("owner");
    const socio = await createPerson("socio");
    mailer.clear();

    await createInvitation(
      owner.spaceId,
      actorOf(owner, "OWNER"),
      { email: socio.email, role: "MEMBER" },
      { mailer },
    );
    await acceptInvitation(tokenFromMail(socio.email), {
      id: socio.userId,
      email: socio.email,
      name: socio.name,
    });

    await transferOwnership(
      owner.spaceId,
      actorOf(owner, "OWNER"),
      socio.userId,
    );

    const members = await listMembers(owner.spaceId, owner.userId);
    expect(members.find((m) => m.userId === socio.userId)?.role).toBe("OWNER");
    // Quien transfiere no pierde el acceso: queda como ADMIN.
    expect(members.find((m) => m.userId === owner.userId)?.role).toBe("ADMIN");
  });

  it("el Space nunca queda con dos OWNER ni con ninguno", async () => {
    const owner = await createPerson("owner");
    const socio = await createPerson("socio");
    mailer.clear();

    await createInvitation(
      owner.spaceId,
      actorOf(owner, "OWNER"),
      { email: socio.email, role: "MEMBER" },
      { mailer },
    );
    await acceptInvitation(tokenFromMail(socio.email), {
      id: socio.userId,
      email: socio.email,
      name: socio.name,
    });

    await transferOwnership(
      owner.spaceId,
      actorOf(owner, "OWNER"),
      socio.userId,
    );

    // Lo garantiza un índice único parcial en la base, no solo el código.
    const owners = await testDb.membership.count({
      where: { spaceId: owner.spaceId, role: "OWNER" },
    });
    expect(owners).toBe(1);
  });

  it("no se puede transferir a alguien que no es miembro", async () => {
    const owner = await createPerson("owner");
    const ajeno = await createPerson("ajeno");

    await expect(
      transferOwnership(owner.spaceId, actorOf(owner, "OWNER"), ajeno.userId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("registro de auditoría", () => {
  it("deja rastro de los cambios de miembros con el nombre del actor", async () => {
    const owner = await createPerson("owner");
    const ana = await createPerson("ana");
    mailer.clear();

    await createInvitation(
      owner.spaceId,
      actorOf(owner, "OWNER"),
      { email: ana.email, role: "MEMBER" },
      { mailer },
    );
    await acceptInvitation(tokenFromMail(ana.email), {
      id: ana.userId,
      email: ana.email,
      name: ana.name,
    });
    await changeMemberRole(
      owner.spaceId,
      actorOf(owner, "OWNER"),
      ana.userId,
      "ADMIN",
    );

    const logs = await forSpace(owner.spaceId).auditLog.findMany({
      orderBy: { createdAt: "asc" },
    });
    const actions = logs.map((l) => l.action);

    expect(actions).toContain("SPACE_CREATED");
    expect(actions).toContain("MEMBER_INVITED");
    expect(actions).toContain("INVITATION_ACCEPTED");
    expect(actions).toContain("MEMBER_ROLE_CHANGED");
    expect(logs.every((l) => l.actorName !== "")).toBe(true);
  });

  it("el audit log de un Space no se ve desde otro", async () => {
    const rodrigo = await createPerson("rodrigo");
    const ana = await createPerson("ana");

    const logs = await forSpace(rodrigo.spaceId).auditLog.findMany();
    expect(logs.every((l) => l.spaceId === rodrigo.spaceId)).toBe(true);
    expect(logs.some((l) => l.spaceId === ana.spaceId)).toBe(false);
  });
});
