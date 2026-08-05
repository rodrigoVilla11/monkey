import { hash, verify } from "@node-rs/argon2";

/**
 * Hashing de contraseñas con argon2id.
 *
 * Se usa `@node-rs/argon2` (implementación en Rust con binarios precompilados)
 * en lugar del paquete `argon2`, que es node-gyp: aquel necesitaría toolchain
 * de compilación en el builder de Docker y que la libc del runtime coincida.
 * Mismo algoritmo, sin esa clase de problemas.
 *
 * Parámetros: los recomendados por el RFC 9106 para el perfil de segunda
 * opción (memoria moderada), que es lo razonable en un VPS chico.
 */
const OPTIONS = {
  /** 19 MiB. Es el costo dominante contra ataques con GPU. */
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  /** argon2id: resistente tanto a canales laterales como a GPU. */
  algorithm: 2,
  outputLen: 32,
} as const;

export const hashPassword = async (password: string): Promise<string> =>
  hash(password, OPTIONS);

/**
 * Verifica una contraseña contra su hash.
 *
 * Devuelve `false` ante un hash corrupto o de otro algoritmo en vez de
 * propagar la excepción: para quien llama, "no coincide" y "no se pudo
 * comparar" tienen el mismo desenlace, y así un registro roto no se convierte
 * en un 500.
 */
export const verifyPassword = async (
  hashed: string,
  password: string,
): Promise<boolean> => {
  try {
    return await verify(hashed, password, OPTIONS);
  } catch {
    return false;
  }
};

/**
 * Hash de referencia sobre el que se compara cuando el email no existe.
 *
 * Sin esto, un login con email inexistente responde mucho más rápido que uno
 * con email real y password incorrecta, y esa diferencia de tiempo permite
 * enumerar qué cuentas existen. Se gasta el mismo trabajo de CPU en los dos
 * casos.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$b6dSNyF0hcVfLp2mUiXPy0F1M3aTdRaqiSJPPX5PPCg";
