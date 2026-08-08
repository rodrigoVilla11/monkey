import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { env } from "@/env";

/**
 * Almacenamiento de archivos, detrás de una interfaz.
 *
 * Hoy hay un único driver —el disco local— pero nada del dominio lo sabe: los
 * services hablan con `getStorage()` y reciben una clave opaca. Un driver de S3
 * o de R2 entra acá sin tocar ni el service de adjuntos ni la base.
 *
 * ── La clave es generada, nunca derivada del nombre del archivo ─────────────
 *
 * Es la defensa contra el path traversal, y es una defensa por construcción y
 * no por saneamiento: si la clave se armara con el nombre que manda el cliente,
 * habría que acertar con TODAS las formas de escribir `..` —codificadas, con
 * barras invertidas, con bytes nulos— y basta fallar una vez. Generando la
 * clave, el nombre original nunca toca el sistema de archivos.
 *
 * El `spaceId` va en la ruta solo para que un humano pueda mirar el directorio
 * y entender qué hay; el aislamiento lo garantiza la base, no la carpeta.
 */

export interface StoredFile {
  /** Clave opaca. Es lo único que se guarda en la base. */
  readonly key: string;
  readonly sizeBytes: number;
}

export interface Storage {
  put(input: {
    readonly spaceId: string;
    readonly extension: string;
    readonly bytes: Uint8Array;
  }): Promise<StoredFile>;

  get(key: string): Promise<Uint8Array>;

  remove(key: string): Promise<void>;
}

/**
 * Driver de disco local.
 *
 * Pensado para una instalación de una persona o una pareja en un VPS, que es el
 * caso de esta app. Para algo más grande entra otro driver.
 */
class LocalStorage implements Storage {
  private readonly root: string;

  public constructor(directory: string) {
    this.root = resolve(directory);
  }

  public async put(input: {
    readonly spaceId: string;
    readonly extension: string;
    readonly bytes: Uint8Array;
  }): Promise<StoredFile> {
    // La clave la genera el servidor. El nombre original ni se mira.
    const key = `${input.spaceId}/${randomUUID()}.${input.extension}`;
    const path = this.resolveKey(key);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.bytes);

    return { key, sizeBytes: input.bytes.byteLength };
  }

  public async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolveKey(key)));
  }

  public async remove(key: string): Promise<void> {
    // `force` para que borrar dos veces no reviente: puede pasar si una
    // petición se reintenta.
    await rm(this.resolveKey(key), { force: true });
  }

  /**
   * Traduce una clave a una ruta y verifica que no se salga del directorio.
   *
   * Las claves las genera este mismo módulo, así que esto no debería poder
   * fallar nunca. Está igual porque las claves viven en la base y una fila
   * manipulada —o una migración futura mal hecha— no puede convertirse en
   * lectura arbitraria del disco.
   */
  private resolveKey(key: string): string {
    const path = resolve(join(this.root, key));

    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error("Clave de storage fuera del directorio permitido");
    }

    return path;
  }
}

let instance: Storage | undefined;

export const getStorage = (): Storage => {
  instance ??= new LocalStorage(env.STORAGE_LOCAL_DIR);
  return instance;
};

/** Solo para tests: permite inyectar un driver en memoria. */
export const setStorage = (storage: Storage): void => {
  instance = storage;
};
