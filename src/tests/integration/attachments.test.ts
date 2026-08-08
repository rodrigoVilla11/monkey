import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import {
  deleteAttachment,
  listAttachments,
  readAttachment,
  uploadAttachment,
} from "@/server/services/attachments";
import { setStorage, type Storage } from "@/server/storage";
import { MAX_ATTACHMENT_BYTES } from "@/shared/contracts/attachments";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Adjuntos contra Postgres real, con un storage en memoria.
 *
 * Lo que importa acá:
 *
 *  · El tipo sale de los BYTES. Un ejecutable renombrado a .jpg no entra.
 *  · Un adjunto de otro Space no se puede leer ni borrar, y responde 404 sin
 *    confirmar que exista.
 *  · Borrar borra el archivo de verdad, no solo la fila.
 */

const TIMEZONE = "Europe/Madrid";

/** Storage en memoria: los tests no tocan el disco. */
class MemoryStorage implements Storage {
  public readonly files = new Map<string, Uint8Array>();
  private counter = 0;

  public put(input: {
    spaceId: string;
    extension: string;
    bytes: Uint8Array;
  }): Promise<{ key: string; sizeBytes: number }> {
    this.counter += 1;
    const key = `${input.spaceId}/${String(this.counter)}.${input.extension}`;
    this.files.set(key, input.bytes);
    return Promise.resolve({ key, sizeBytes: input.bytes.byteLength });
  }

  public get(key: string): Promise<Uint8Array> {
    const found = this.files.get(key);
    if (found === undefined) return Promise.reject(new Error("no existe"));
    return Promise.resolve(found);
  }

  public remove(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }
}

let storage: MemoryStorage;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const PDF = new TextEncoder().encode("%PDF-1.7");
/** "MZ" es la firma de un ejecutable de Windows. */
const EXE = new TextEncoder().encode("MZ!");

interface Space {
  readonly spaceId: string;
  readonly userId: string;
  readonly transactionId: string;
}

let counter = 0;

const makeSpace = async (): Promise<Space> => {
  counter += 1;
  const label = counter.toString().padStart(3, "0");

  const user = await testDb.user.create({
    data: {
      email: `attach-${label}@monkey.test`,
      passwordHash: "hash",
      name: "Rodrigo",
      timezone: TIMEZONE,
      locale: "es-ES",
      emailVerifiedAt: new Date(),
    },
  });

  const space = await testDb.space.create({
    data: {
      name: `Space ${label}`,
      primaryCurrency: "EUR",
      timezone: TIMEZONE,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const db = forSpace(space.id);

  const account = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Corriente",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 100_000n,
    },
  });

  const transaction = await db.transaction.create({
    data: {
      spaceId: space.id,
      accountId: account.id,
      createdByUserId: user.id,
      createdByName: "Rodrigo",
      type: "EXPENSE",
      amountMinor: 5000n,
      currency: "EUR",
      date: new Date("2026-08-01T00:00:00Z"),
      description: "Con recibo",
    },
  });

  return { spaceId: space.id, userId: user.id, transactionId: transaction.id };
};

const upload = (
  space: Space,
  bytes: Uint8Array,
  filename = "recibo.jpg",
  transactionId = space.transactionId,
) =>
  systemClient().$transaction(async (tx) =>
    uploadAttachment(
      forSpace(space.spaceId),
      tx,
      space.spaceId,
      { userId: space.userId },
      { transactionId, filename, bytes },
    ),
  );

beforeEach(async () => {
  await resetDatabase();
  storage = new MemoryStorage();
  setStorage(storage);
});

afterAll(async () => {
  await disconnect();
});

describe("el tipo sale de los bytes", () => {
  it("acepta JPEG, PNG y PDF", async () => {
    const space = await makeSpace();

    expect((await upload(space, JPEG)).mimeType).toBe("image/jpeg");
    expect((await upload(space, PNG, "a.png")).mimeType).toBe("image/png");
    expect((await upload(space, PDF, "a.pdf")).mimeType).toBe(
      "application/pdf",
    );
  });

  it("rechaza un ejecutable aunque se llame recibo.jpg", async () => {
    const space = await makeSpace();

    // Es EL caso del módulo: el nombre y el Content-Type los pone quien sube.
    await expect(upload(space, EXE, "recibo.jpg")).rejects.toThrow(
      /Solo se admiten imágenes/,
    );
    expect(storage.files.size).toBe(0);
  });

  it("ignora la extensión del nombre y guarda la real", async () => {
    const space = await makeSpace();

    const attachment = await upload(space, PDF, "factura.jpg");

    expect(attachment.mimeType).toBe("application/pdf");
    // La clave del storage lleva la extensión real, no la del nombre.
    expect([...storage.files.keys()][0]).toMatch(/\.pdf$/);
  });

  it("rechaza un archivo vacío", async () => {
    const space = await makeSpace();
    await expect(upload(space, new Uint8Array())).rejects.toThrow(/vacío/);
  });

  it("rechaza lo que pase del tamaño máximo", async () => {
    const space = await makeSpace();
    const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    huge.set(JPEG);

    await expect(upload(space, huge)).rejects.toThrow(/pesa más de/);
    expect(storage.files.size).toBe(0);
  });
});

describe("la clave del storage no viene del nombre", () => {
  it("un nombre con rutas no se convierte en una ruta", async () => {
    const space = await makeSpace();

    const attachment = await upload(space, JPEG, "../../etc/passwd");
    const key = [...storage.files.keys()][0] ?? "";

    // La clave es generada; el nombre original solo se muestra, saneado.
    expect(key).not.toContain("..");
    expect(key).toMatch(/^[^/]+\/[^/]+\.jpg$/);
    expect(attachment.originalName).toBe("..-..-etc-passwd");
  });
});

describe("primero el archivo, después la fila", () => {
  it("si falla la fila no queda una referencia rota", async () => {
    const space = await makeSpace();

    // Un movimiento que no existe: el service tira antes de escribir nada.
    await expect(
      upload(space, JPEG, "recibo.jpg", "movimiento-inexistente"),
    ).rejects.toThrow(/No se encontró el movimiento/);

    expect(storage.files.size).toBe(0);
    expect(
      await testDb.attachment.count({ where: { spaceId: space.spaceId } }),
    ).toBe(0);
  });

  it("una fila sin archivo responde 404, no 500", async () => {
    const space = await makeSpace();
    const attachment = await upload(space, JPEG);

    // Se simula que alguien limpió el directorio a mano.
    storage.files.clear();

    await expect(
      readAttachment(forSpace(space.spaceId), attachment.id),
    ).rejects.toThrow(/ya no está disponible/);
  });
});

describe("lectura", () => {
  it("devuelve los bytes tal cual", async () => {
    const space = await makeSpace();
    const attachment = await upload(space, PNG, "grafico.png");

    const content = await readAttachment(
      forSpace(space.spaceId),
      attachment.id,
    );

    expect([...content.bytes]).toEqual([...PNG]);
    expect(content.mimeType).toBe("image/png");
    expect(content.filename).toBe("grafico.png");
  });

  it("el listado sale del movimiento e incluye quién lo subió", async () => {
    const space = await makeSpace();
    await upload(space, JPEG, "uno.jpg");
    await upload(space, PDF, "dos.pdf");

    const list = await listAttachments(
      forSpace(space.spaceId),
      space.spaceId,
      space.transactionId,
    );

    expect(list).toHaveLength(2);
    expect(list[0]?.uploadedBy.name).toBe("Rodrigo");
    expect(list[0]?.isImage).toBe(true);
    expect(list[1]?.isImage).toBe(false);
    expect(list[0]?.downloadPath).toBe(
      `/api/v1/spaces/${space.spaceId}/attachments/${list[0]?.id ?? ""}`,
    );
  });

  it("un movimiento inexistente da 404", async () => {
    const space = await makeSpace();

    await expect(
      listAttachments(forSpace(space.spaceId), space.spaceId, "no-existe"),
    ).rejects.toThrow(/No se encontró el movimiento/);
  });
});

describe("borrado", () => {
  it("borra el archivo de verdad, no solo la fila", async () => {
    const space = await makeSpace();
    const attachment = await upload(space, JPEG);

    expect(storage.files.size).toBe(1);

    await systemClient().$transaction(async (tx) => {
      await deleteAttachment(forSpace(space.spaceId), tx, attachment.id);
    });

    // Un adjunto es un documento personal: "borrar" tiene que borrar.
    expect(storage.files.size).toBe(0);

    const list = await listAttachments(
      forSpace(space.spaceId),
      space.spaceId,
      space.transactionId,
    );
    expect(list).toHaveLength(0);
  });

  it("la fila queda por trazabilidad", async () => {
    const space = await makeSpace();
    const attachment = await upload(space, JPEG);

    await systemClient().$transaction(async (tx) => {
      await deleteAttachment(forSpace(space.spaceId), tx, attachment.id);
    });

    const row = await testDb.attachment.findUnique({
      where: { id: attachment.id },
      select: { deletedAt: true, uploadedByUserId: true },
    });

    expect(row?.deletedAt).not.toBeNull();
    expect(row?.uploadedByUserId).toBe(space.userId);
  });

  it("borrar dos veces no revienta", async () => {
    const space = await makeSpace();
    const attachment = await upload(space, JPEG);

    await systemClient().$transaction(async (tx) => {
      await deleteAttachment(forSpace(space.spaceId), tx, attachment.id);
    });

    await expect(
      systemClient().$transaction(async (tx) => {
        await deleteAttachment(forSpace(space.spaceId), tx, attachment.id);
      }),
    ).rejects.toThrow(/No se encontró el adjunto/);
  });
});

describe("límites", () => {
  it("no admite más de diez por movimiento", async () => {
    const space = await makeSpace();

    for (let i = 0; i < 10; i += 1) {
      await upload(space, JPEG, `recibo-${String(i)}.jpg`);
    }

    await expect(upload(space, JPEG, "once.jpg")).rejects.toThrow(
      /como mucho 10 adjuntos/,
    );
  });

  it("borrar uno libera sitio", async () => {
    const space = await makeSpace();

    const first = await upload(space, JPEG, "uno.jpg");
    for (let i = 1; i < 10; i += 1) {
      await upload(space, JPEG, `recibo-${String(i)}.jpg`);
    }

    await systemClient().$transaction(async (tx) => {
      await deleteAttachment(forSpace(space.spaceId), tx, first.id);
    });

    await expect(upload(space, JPEG, "nuevo.jpg")).resolves.toBeDefined();
  });
});

describe("aislamiento entre Spaces", () => {
  it("no se puede leer el adjunto de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    const foreign = await upload(other, JPEG, "ajeno.jpg");

    // 404 y no 403: confirmar que existe ya sería filtrar.
    await expect(
      readAttachment(forSpace(mine.spaceId), foreign.id),
    ).rejects.toThrow(/No se encontró el adjunto/);
  });

  it("no se puede borrar el adjunto de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    const foreign = await upload(other, JPEG, "ajeno.jpg");

    await expect(
      systemClient().$transaction(async (tx) => {
        await deleteAttachment(forSpace(mine.spaceId), tx, foreign.id);
      }),
    ).rejects.toThrow(/No se encontró el adjunto/);

    // Y el archivo del otro sigue ahí.
    expect(storage.files.size).toBe(1);
  });

  it("no se puede adjuntar a un movimiento de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    await expect(
      upload(mine, JPEG, "recibo.jpg", other.transactionId),
    ).rejects.toThrow(/No se encontró el movimiento/);

    expect(storage.files.size).toBe(0);
  });

  it("el listado de un Space no ve los adjuntos del otro", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    await upload(other, JPEG, "ajeno.jpg");

    const list = await listAttachments(
      forSpace(mine.spaceId),
      mine.spaceId,
      mine.transactionId,
    );

    expect(list).toHaveLength(0);
  });
});
