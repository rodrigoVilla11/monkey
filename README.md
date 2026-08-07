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
| 5 · Spaces y membresías          | ✅     |
| 6 · Services de dominio y API v1 | ✅     |
| 7 · UI                           | ✅     |
| 8 · PWA                          | ✅     |

**Fase 1 completa.**

| Fase 2 — Análisis y control | Estado |
| --------------------------- | ------ |
| 9 · Presupuestos            | ✅     |
| 10 · Reportes               | ✅     |
| 11 · Transferencias         | ✅     |
| 12 · Recurrentes + cron     | ✅     |

**Fase 2 completa.**

| Fase 3 — Lo que falta      | Estado |
| -------------------------- | ------ |
| 13 · Metas de ahorro       | ✅     |
| 14 · Deudas                | ✅     |
| 15 · Importar/exportar CSV | ⏳     |
| 16 · Adjuntos              | ⏳     |
| 17 · División de gastos    | ⏳     |

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
| `pnpm db:seed`          | Datos de desarrollo: 3 usuarios y un Space compartido     |
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

**La única salida de emergencia** es [`src/server/db/raw/`](src/server/db/raw/),
donde vive el SQL crudo de los reportes —agrupar por mes necesita `date_trunc`,
y el `groupBy` de Prisma solo admite columnas—. Ahí la extensión no llega, así
que rige una regla propia: toda función recibe `spaceId` como primer parámetro y
lo filtra. Un test de arquitectura verifica que ningún otro directorio use
`$queryRaw`, y los tests de reportes comprueban el aislamiento consultando desde
un Space con datos del otro al lado.

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

### Autorización dentro de un Space

Los endpoints acotados a un Space **declaran su rol mínimo en el propio
`route()`**, y ahí se resuelve todo antes de llegar al handler:

```ts
export const PATCH = route<UpdateSpaceRequest, Params>(
  { body: schema, params: paramsSchema, space: { minRole: "ADMIN" } },
  async ({ body, access, db }) => {
    /* access y db ya están acotados */
  },
);
```

Declarar `space` obliga a que `params` traiga un `spaceId`, exige sesión con
email verificado, resuelve la membresía y entrega un `db` ya scopeado. **No hay
forma de escribir un endpoint de Space sin declarar qué rol hace falta.**

| Rol      | Puede                                                      |
| -------- | ---------------------------------------------------------- |
| `OWNER`  | Todo, incluido eliminar el Space y transferir la propiedad |
| `ADMIN`  | Todo salvo eliminar el Space o gestionar al OWNER          |
| `MEMBER` | Cuentas, categorías y movimientos. No gestiona miembros    |
| `VIEWER` | Solo lectura                                               |

**404, nunca 403, si no sos miembro.** Un 403 confirmaría que el Space existe.
El 403 (`INSUFFICIENT_ROLE`) se reserva para cuando sí sos miembro pero tu rol
no alcanza — ahí ya sabés que existe, así que no se filtra nada nuevo.

### El manifiesto de rutas

[`routes.manifest.ts`](src/server/api/routes.manifest.ts) declara cada endpoint
con su método, autenticación y rol mínimo. De ahí salen tres tests:

1. **[`routes-manifest.test.ts`](src/tests/arch/routes-manifest.test.ts)** recorre
   `app/api/**` y falla si hay un `route.ts` que no esté declarado.
2. **[`role-matrix.test.ts`](src/tests/integration/role-matrix.test.ts)** prueba
   cada endpoint acotado a Space contra cada rol.
3. La prueba de aislamiento usa el mismo inventario.

El primero es el que sostiene a los otros dos: **si agregás un endpoint y te
olvidás de registrarlo, la suite falla** — y por lo tanto ningún endpoint puede
quedar fuera de la matriz de permisos sin que alguien se entere.

### El job de recurrentes

`POST /api/v1/jobs/recurring` es el **único endpoint que cruza Spaces** y el
único que no se autentica con sesión: no hay un usuario detrás, hay un cron. Va
con `Authorization: Bearer $CRON_SECRET`, comparado en tiempo constante, y
`CRON_SECRET` es obligatorio en producción.

```
15 3 * * * curl -fsS -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://monkey.example/api/v1/jobs/recurring
```

**Si el job estuvo caído, se materializan TODAS las ocurrencias vencidas, cada
una con su fecha.** Si el alquiler vencía el 1 y el job recién corre el 20, la
transacción se fecha el 1. Las otras dos opciones son peores: saltear al futuro
perdería un gasto que sí salió de la cuenta, y meter una sola fechada hoy
pondría el alquiler de enero en el mes de marzo y todos los reportes mensuales
pasarían a mentir. La fecha es un hecho económico, no la hora a la que corrió un
proceso.

Tres frenos lo acompañan:

1. **Tope de 60 ocurrencias por regla y corrida.** Una regla diaria caída seis
   meses generaría 180 filas de un saque. Se reparte entre corridas — no se
   saltea nada, y lo que queda pendiente sale en el reporte y en el log.
2. **Idempotencia en la base.** Un unique parcial sobre
   `(spaceId, recurringRuleId, date)` impide que dos disparos del cron dupliquen
   el mismo mes. Dispararlo de más es inocuo.
3. **Una transacción de base por regla.** Si una regla falla —por ejemplo, no
   hay cotización cargada para su fecha— se cuenta como fallo y el barrido sigue
   con las demás.

El motor de recurrencia ([`recurrence.ts`](src/shared/recurrence.ts)) es puro y
calcula cada ocurrencia **desde el ancla, nunca desde la anterior**. Encadenando
sumas, "cada mes el 31" pasaría por el 28 de febrero y se quedaría en el 28 para
siempre.

### PWA

Instalable en la pantalla de inicio de un iPhone. Los assets (10 íconos, 10
pantallas de arranque) se **generan** con `pnpm pwa:assets`: son SVG dibujado
con geometría pura, sin tipografías ni emoji, así que el mismo comando da el
mismo resultado en cualquier máquina.

El Service Worker se construye en un paso aparte —`serwist build`, que ya está
dentro de `pnpm build`— porque el plugin de webpack de Serwist obligaría a
abandonar Turbopack en todo el build.

| Recurso                               | Estrategia                               |
| ------------------------------------- | ---------------------------------------- |
| App shell (CSS, `/offline`, manifest) | Precarga: 67 kB, no 3 MB                 |
| `/_next/static/**`                    | CacheFirst — tienen hash, son inmutables |
| Íconos y splash                       | CacheFirst, 30 días                      |
| `GET /api/v1/spaces/:id/**`           | NetworkFirst, un caché **por Space**     |
| Resto de la API                       | Sin caché nunca                          |

**El requisito que el brief marca como bug clásico** —que el SW no sirva datos
de otro usuario o de otro Space— se ataca por tres lados, porque cualquiera
solo tiene un agujero:

1. **Un caché por Space** (`monkey-api-{spaceId}`). Cambiar de Space no puede
   leer el caché de otro: son cachés distintos.
2. **Purga explícita** al cerrar sesión y al cambiar de Space, disparada desde
   el cliente antes de navegar.
3. **Sello de usuario en cada respuesta cacheada.** Si al leerla el usuario
   actual no coincide, se descarta y se va a la red. Cubre el caso feo: que el
   mensaje de purga no llegue porque el SW estaba dormido.

Además se purga al activar una versión nueva del SW: un deploy puede cambiar la
forma de las respuestas.

Sobre offline: funciona cualquier pantalla ya visitada. Una que nunca se abrió
muestra la pantalla de sin conexión — es la contrapartida de no precargar 3 MB
en la instalación. **No hay cola de escrituras offline en la Fase 1**, y la
pantalla no promete lo contrario.

### Convenciones de dominio

- **Nada de floats para dinero.** Todos los importes son enteros (`BigInt`) en
  la unidad mínima de la moneda, con su `currency` ISO 4217 al lado. Sobre el
  cable viajan como **strings**: `JSON.stringify` no sabe serializar `bigint` y
  un `number` pierde precisión arriba de 2^53.
- **El importe siempre es positivo.** El signo lo determina el `type` de la
  transacción, no el valor. En las transferencias, donde las dos patas comparten
  el tipo TRANSFER, lo determina `transferDirection`.
- **Una transferencia no cambia el patrimonio.** Sus dos patas valen exactamente
  lo mismo en la moneda primaria, aunque las cuentas estén en monedas distintas.
  No se controla después: se calcula un solo importe en moneda primaria y se le
  asigna a las dos.
- **Entre monedas distintas se piden los dos importes, no una cotización.** El
  banco no aplica la cotización publicada: aplica la suya y cobra comisión.
  Diciendo cuánto salió y cuánto llegó, la cotización real de la operación sale
  sola y el saldo cuadra contra el extracto.
- **Un movimiento recurrente atrasado se materializa con SU fecha**, no con la
  del día en que corrió el job. Ver abajo.
- **Las deudas registran, no amortizan.** El saldo es `original − pagos`, sin
  capitalizar intereses. Calcular la cuota de un préstamo daría un número que no
  coincide con el recibo del banco —convenciones de días, comisiones, seguros,
  redondeos— y un número casi correcto en finanzas es peor que ninguno. La tasa
  sí se usa: para decir cuánto **cuesta por mes** el saldo pendiente, que es
  aritmética sobre lo que escribiste y no una predicción sobre tu banco.
- **La posición neta vive aparte de la curva de los reportes.** Esa curva es una
  posición de caja; meterle deudas redefiniría en silencio lo que significan
  todos los reportes que ya existen. Un préstamo recién recibido lo muestra: los
  10.000 € están en la cuenta —la caja sube— y el neto no se movió. Las dos
  cifras son ciertas y responden preguntas distintas.
- **Ahorrar no es gastar.** Un aporte a una meta nunca crea un movimiento:
  apartar 200 € no baja el patrimonio, la plata sigue siendo tuya. O se vincula
  a un movimiento que ya existe —la transferencia a la cuenta de ahorro— o es
  puro registro. Y el progreso de una meta son sus aportes, no el saldo de
  ninguna cuenta: atarlo al saldo se rompe apenas esa cuenta se use para otra
  cosa, y con dos metas sobre la misma cuenta las dos mostrarían el total.
- **Multi-moneda desde el día uno.** Cada transacción congela su tipo de cambio
  al crearse. Los reportes históricos nunca se recalculan con la tasa de hoy.
- **`spaceId` va en la URL**, no en el body ni en un header: hace que las
  cache keys del Service Worker queden scopeadas por Space, y que el aislamiento
  sea testeable endpoint por endpoint.
- **404, no 403,** cuando un recurso pertenece a otro Space. Un 403 confirmaría
  que el recurso existe.
