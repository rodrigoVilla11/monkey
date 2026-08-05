# 🐒 Monkey

Finanzas personales y compartidas. Mobile-first, pensada para instalarse en la
pantalla de inicio de un iPhone.

Los datos financieros viven dentro de **Spaces**: un Space puede ser personal o
compartido entre varias personas (por ejemplo una pareja llevando las cuentas
del hogar). Todo el dominio financiero cuelga de un `spaceId` y el aislamiento
entre Spaces se garantiza en la capa de acceso a datos, no en los handlers.

---

## Estado

| Incremento                       | Estado |
| -------------------------------- | ------ |
| 1 · Configuración del proyecto   | ✅     |
| 2 · Esquema Prisma y migraciones | ✅     |
| 3 · Capa de datos scopeada       | ✅     |
| 4 · Auth y sesiones              | ✅     |
| 5 · Spaces y membresías          | ⏳     |
| 6 · Services de dominio y API v1 | ⏳     |
| 7 · UI                           | ⏳     |
| 8 · PWA                          | ⏳     |

---

## Stack

Next.js 16 (App Router) · TypeScript 6 estricto · PostgreSQL 17 + Prisma 7 ·
Tailwind CSS 4 + shadcn/ui · Zod 4 · TanStack Query · Vitest · pnpm · Docker.

Autenticación propia (argon2id + JWT con `jose`), no Auth.js — ver
[Autenticación](#autenticación).

**Requisito arquitectónico:** la API REST de `app/api/v1/**` es la fuente de
verdad. El frontend web la consume por `fetch` como cualquier otro cliente, así
que una futura app nativa en Expo puede reutilizar el backend y los tipos de
`src/shared/**` tal cual.

---

## Levantar el proyecto

Necesitás **Node ≥ 24**, **pnpm 11** y **Docker**.

```bash
# 1. Dependencias
pnpm install

# 2. Configuración
cp .env.example .env
```

Generá un `AUTH_SECRET` y pegalo en el `.env`:

```bash
openssl rand -base64 48                                  # macOS / Linux / Git Bash
```

```powershell
[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }))   # PowerShell
```

```bash
# 3. Postgres + servidor de mail
pnpm docker:up

# 4. Migraciones            (disponible desde el incremento 2)
pnpm db:migrate

# 5. A trabajar
pnpm dev
```

| Servicio         | URL                   |
| ---------------- | --------------------- |
| App              | http://localhost:3000 |
| Mailpit (mails)  | http://localhost:8025 |
| Postgres (dev)   | `localhost:5442`      |
| Postgres (tests) | `localhost:5443`      |

Los mails de verificación, invitación y reset **no salen a internet** en
desarrollo: los captura Mailpit y los ves en su interfaz web.

---

## Comandos

| Comando                 | Qué hace                                                  |
| ----------------------- | --------------------------------------------------------- |
| `pnpm dev`              | Servidor de desarrollo                                    |
| `pnpm build`            | `prisma generate` + build de producción                   |
| `pnpm check`            | typecheck + lint + formato + tests (lo que corre en CI)   |
| `pnpm typecheck`        | `tsc --noEmit`                                            |
| `pnpm lint`             | ESLint, incluidas las reglas de arquitectura              |
| `pnpm format`           | Prettier sobre todo el repo                               |
| `pnpm test`             | Tests unitarios y de arquitectura (sin base de datos)     |
| `pnpm test:integration` | Tests de integración (necesita `pnpm docker:up`)          |
| `pnpm db:migrate`       | Crea y aplica una migración en desarrollo                 |
| `pnpm db:deploy`        | Aplica migraciones ya versionadas (producción)            |
| `pnpm db:studio`        | Explorador visual de la base                              |
| `pnpm user:create`      | Crea el primer usuario (disponible desde el incremento 4) |

> Nunca se usa `prisma db push`. Todos los cambios de esquema van por
> migraciones versionadas y commiteadas.

---

## Variables de entorno

Se validan con Zod en [`src/env.schema.ts`](src/env.schema.ts) al arrancar el
server. Si falta algo o está mal, el proceso no levanta y te dice exactamente
qué. La lista completa y comentada está en [`.env.example`](.env.example).

Las obligatorias sin default:

| Variable       | Para qué                                                     |
| -------------- | ------------------------------------------------------------ |
| `DATABASE_URL` | Conexión a PostgreSQL                                        |
| `AUTH_SECRET`  | Firma de los JWT. Mínimo 32 caracteres                       |
| `CRON_SECRET`  | Protege el endpoint de recurrentes. Solo obligatoria en prod |

### Configuración regional

No hay ningún país hardcodeado. `DEFAULT_LOCALE`, `DEFAULT_CURRENCY` y
`DEFAULT_TIMEZONE` son solo el punto de partida que se le propone a un usuario
nuevo — después cada usuario tiene su locale y su timezone, y cada Space su
propia moneda primaria.

```bash
# España
DEFAULT_LOCALE=es-ES   DEFAULT_CURRENCY=EUR   DEFAULT_TIMEZONE=Europe/Madrid

# Argentina
DEFAULT_LOCALE=es-AR   DEFAULT_CURRENCY=ARS   DEFAULT_TIMEZONE=America/Argentina/Buenos_Aires
```

---

## Docker

### Desarrollo

`docker-compose.yml` levanta **solo las dependencias** (Postgres, Postgres de
test, Mailpit). La app corre en el host con `pnpm dev`, que da hot reload
instantáneo y evita pelear con bind mounts de `node_modules` en Windows.

### Producción

```bash
# En el VPS
cp .env.example .env.production      # completar con valores reales
docker compose -f docker-compose.prod.yml up -d --build
```

El `Dockerfile` es multi-stage (deps → build → runtime) y usa el output
`standalone` de Next: la imagen final no lleva pnpm ni devDependencies. Corre
como usuario sin privilegios y aplica `prisma migrate deploy` antes de aceptar
tráfico.

Postgres no publica puertos al host. Poné un reverse proxy (Caddy, Traefik,
nginx) delante para el TLS: `APP_URL` tiene que ser `https` porque las cookies
de sesión van con `Secure`.

---

## Arquitectura

```
src/
├── shared/      Tipos y lógica pura. CERO dependencias de Next, React o Prisma:
│                un cliente Expo tiene que poder importar esto tal cual.
├── server/
│   ├── db/      Acceso a datos. Único lugar del código que ve el PrismaClient.
│   ├── auth/    Hash de passwords, JWT, resolución de sesión (cookie o Bearer).
│   ├── api/     Wrapper de handlers, errores, autorización, manifiesto de rutas.
│   └── services/ Lógica de negocio. Funciones puras que reciben dependencias.
├── app/
│   ├── api/v1/  La API. Fuente de verdad para web y nativo.
│   └── (app)/   UI. Consume la API v1 por fetch, igual que cualquier cliente.
├── lib/         Cliente web: fetch tipado, TanStack Query, hooks.
└── tests/
    ├── unit/         Lógica de negocio
    ├── arch/         Reglas de arquitectura verificadas sobre el código
    └── integration/  Aislamiento entre Spaces y matriz de permisos
```

### Reglas que el linter hace cumplir

No son convenciones: si las rompés, no pasa `pnpm check`.

1. **El `PrismaClient` sin scope solo se importa desde `src/server/db/**`.**
   El resto del código usa `forSpace(spaceId)`. Es imposible olvidarse de
   filtrar por Space por accidente.
2. **`src/shared/**` no importa Next, React ni Prisma.** Garantiza que el
   futuro cliente nativo pueda reutilizar los contratos.
3. **`process.env` solo se lee en los puntos de entrada del proceso.** Todo lo
   demás usa `env`, ya validado.

Además de ESLint, [`src/tests/arch/source-rules.test.ts`](src/tests/arch/source-rules.test.ts)
verifica lo mismo sobre el código fuente — porque una regla de ESLint se puede
desactivar con un comentario.

### Cómo se garantiza el aislamiento entre Spaces

Son tres capas independientes. Para filtrar datos de otro Space habría que
atravesar las tres a la vez.

1. **Extensión de Prisma** ([`space-scope.ts`](src/server/db/space-scope.ts)) —
   toda operación pasa por un hook que inyecta el filtro `spaceId` en los
   `where` y el valor correcto en los `data`. Un modelo sin clasificar hace
   fallar la consulta en vez de dejarla pasar sin filtro.

2. **Claves foráneas compuestas** — toda relación entre entidades del dominio
   usa `(spaceId, id)` en vez de `(id)`. La extensión garantiza que una fila
   nazca en el Space correcto, pero no valida los IDs que vienen en el body;
   la FK compuesta convierte "transacción del Space A apuntando a una cuenta
   del Space B" en un error de PostgreSQL.

3. **Tests de integración** ([`space-scope.test.ts`](src/tests/integration/space-scope.test.ts))
   — dos Spaces con datos reales y 26 pruebas que intentan cruzarlos pasando
   IDs válidos del otro por todas las vías posibles.

Y una cuarta que evita que las tres se pudran:
[`db-scope-coverage.test.ts`](src/tests/arch/db-scope-coverage.test.ts) lee
`schema.prisma` y falla si un modelo nuevo queda sin clasificar o si una
relación entre modelos scopeados no usa FK compuesta.

### Autenticación

Una sola resolución de sesión, [`resolveSession`](src/server/auth/session.ts),
que acepta las dos formas de manera transparente:

| Cliente | Credencial                  | Dónde viven los tokens                                    |
| ------- | --------------------------- | --------------------------------------------------------- |
| Web     | cookie httpOnly `monkey_at` | El navegador. JavaScript no puede leerlos                 |
| Nativo  | `Authorization: Bearer`     | Llavero del sistema. Se piden con `X-Client-Type: native` |

- **Access token**: JWT de 15 minutos, sin estado.
- **Refresh token**: opaco, 60 días, guardado **hasheado** y **rotativo**. Si
  llega uno ya rotado, se asume copia robada y se cierran todas las sesiones
  del usuario.
- **Revocación inmediata**: `User.sessionsRevokedAt` se compara con el `iat` de
  cada access token, así "cerrar sesión en todos los dispositivos" y el reset
  de contraseña surten efecto en el acto y no cuando expira el token.
- Contraseñas con **argon2id** (19 MiB, t=2). El login corre el hash incluso
  cuando el email no existe, para que el tiempo de respuesta no permita
  enumerar cuentas.

### Convenciones de dominio

- **Nada de floats para dinero.** Todos los importes son enteros (`BigInt`) en
  la unidad mínima de la moneda, con su `currency` ISO 4217 al lado. Sobre el
  cable viajan como **strings**: `JSON.stringify` no sabe serializar `bigint` y
  un `number` pierde precisión arriba de 2^53.
- **El importe siempre es positivo.** El signo lo determina el `type` de la
  transacción, no el valor.
- **Multi-moneda desde el día uno.** Cada transacción congela su tipo de cambio
  al crearse. Los reportes históricos nunca se recalculan con la tasa de hoy.
- **`spaceId` va en la URL**, no en el body ni en un header: hace que las
  cache keys del Service Worker queden scopeadas por Space, y que el aislamiento
  sea testeable endpoint por endpoint.
- **404, no 403,** cuando un recurso pertenece a otro Space. Un 403 confirmaría
  que el recurso existe.
