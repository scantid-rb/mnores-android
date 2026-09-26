# MNORES INVENTORY — FASE 0
## Arquitectura propuesta del cliente Android (Expo / React Native / TypeScript)

- App Android version objetivo: `0.1.0`
- Backend (congelado, NO modificar): API `1.4.2` — `http://devmn.atwebpages.com`
- Principio rector: **el servidor PHP es la única fuente de verdad**. El SQLite local es cache + almacén de trabajo offline.

---

## A. ARQUITECTURA PROPUESTA (resumen)

### Capas (separación estricta de responsabilidades)
```
UI (screens/components)
   ↓  (solo llaman a hooks/repositories, NUNCA a HTTP)
Hooks (react-query: useQuery/useMutation)
   ↓
Repositories (parts, boats, categories, session)
   ↓
Local SQLite (expo-sqlite)  +  Sync Queue (tabla pending_changes)
   ↓
Sync Engine (orquestador: push cola → pull /api/sync → reconciliar)
   ↓
API Client (fetch tipado, Bearer token, manejo de errores)
   ↓
PHP API 1.4.2
```
Regla clave: **ninguna pantalla hace `fetch` directo**. La UI solo conoce repositories/hooks. Esto permite añadir cola, reintentos y conflictos después sin reescribir pantallas.

### Navegación
- **Stack raíz** con dos zonas:
  - `AuthStack`: `Login`
  - `AppStack` (tras sesión válida): navegación por **Tabs (máx. 3-4)**
    - `Inventory` (lista + buscador + filtros)
    - `Sync` (estado de sincronización / cola / "Sync now")
    - `Profile` (usuario, rol, barco, logout, versión app/API)
  - Pantallas modales sobre el stack: `PartDetail`, `AddEditPart`
- Decisión de arranque (gate): si existe sesión guardada → entra directo a `AppStack` (aunque no haya Internet). El login solo se muestra si NO hay sesión guardada. Esto cumple el requisito de "sesión offline".

### API Client
- Un único módulo `services/api/client.ts`.
- `BASE_URL` leído de `EXPO_PUBLIC_API_BASE_URL` (nunca hard-coded).
- Inyecta `Authorization: Bearer <token>` automáticamente.
- Timeout + parseo JSON seguro + normalización de errores a un tipo `ApiError` con `status` HTTP.
- Nunca loguea token ni password.

### Autenticación
- `POST /api/login` → guarda `token` en **expo-secure-store** (NO AsyncStorage).
- Metadatos de sesión no sensibles (id, username, role, boat_id) → tabla `session` en SQLite.
- `GET /api/me` para validar sesión cuando hay red.
- Logout: borra token de secure-store + limpia `session` (pero **no** borra `pending_changes` no sincronizadas).

### SQLite local
- `expo-sqlite` (SQLite nativo real, sobrevive reinicios).
- Tablas: `session`, `boats`, `categories`, `parts`, `pending_changes` (detalle en sección D).
- Índices para búsqueda rápida offline por `name`, `reference`, `location`.

### Repositories
- `partsRepository`, `boatsRepository`, `categoriesRepository`, `sessionRepository`, `queueRepository`.
- Exponen métodos de dominio (`getParts`, `searchParts`, `upsertFromServer`, `enqueueCreate`, etc.).
- Son la única capa que ejecuta SQL.

### Sync Engine (solo diseño en Fase 0, no se implementa completo aún)
- Servicio único `services/sync/syncEngine.ts`.
- Orquesta: (1) push de `pending_changes` a `POST /api/parts/push` en batches, (2) inspecciona `results[].status` individualmente, (3) pull `GET /api/sync`, (4) reconcilia cache local con `updated_at`/`server_time`.
- Disparadores: al iniciar app (si hay red), al recuperar conectividad (listener), y botón manual "Sync now".
- Reintentos con backoff acotado; nunca elimina una operación pendiente solo porque se intentó el HTTP.

### State management
- **Sesión / preferencias**: contexto ligero (`SessionContext`) + secure-store/SQLite.
- **Datos de servidor y cache**: `@tanstack/react-query` (ya montado en el template) apuntando a los repositories, no a HTTP directo.
- **Conectividad**: `@react-native-community/netinfo` expuesto por un hook `useConnectivity()` que distingue *sin Internet* / *Internet sin API* / *API OK*.

---

## B. ESTRUCTURA DE CARPETAS PROPUESTA

Adaptada a Expo Router (routing por ficheros en `app/`) manteniendo tu separación lógica en `src/`:

```
frontend/
├── app/                          # Rutas (Expo Router) — SOLO pantallas
│   ├── _layout.tsx               # Root: providers + gate de sesión
│   ├── index.tsx                 # Redirect según sesión (login vs tabs)
│   ├── login.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx           # Tabs: Inventory / Sync / Profile
│   │   ├── index.tsx             # Inventario (lista + buscador + filtros)
│   │   ├── sync.tsx
│   │   └── profile.tsx
│   ├── part/
│   │   └── [id].tsx              # Detalle
│   └── part-edit.tsx             # Alta/Edición (modal)
│
└── src/
    ├── components/               # UI reutilizable (PartRow, SyncBadge, SearchBar...)
    ├── services/
    │   ├── api/                  # client.ts + endpoints tipados
    │   ├── auth/                 # login, token secure-store, sesión
    │   └── sync/                 # syncEngine, connectivity
    ├── database/                 # init sqlite, migraciones, schema
    ├── repositories/             # parts / boats / categories / session / queue
    ├── state/                    # SessionContext, providers
    ├── hooks/                    # useConnectivity, useParts, useSession...
    ├── types/                    # Part, Boat, Category, User, QueueItem, ApiResponses
    ├── utils/                    # localId (ULID), fechas, logger sin secretos
    └── theme.ts                  # tokens de color (ya existe en template)
```

**Por qué difiere ligeramente de tu propuesta:** el template Emergent usa **Expo Router** (routing basado en ficheros dentro de `app/`). Por eso las *pantallas* viven en `app/` y todo lo no-navegable (components, services, database, repositories, etc.) vive en `src/`. La intención de tu árbol (`screens/`, `navigation/`, `services/`, `database/`, `repositories/`, `state/`, `hooks/`, `types/`, `utils/`) se conserva 1:1 dentro de `src/`, salvo que `navigation/` la resuelve Expo Router con los `_layout.tsx`.

---

## C. DEPENDENCIAS (mínimas, solo lo necesario)

| Dependencia | Para qué sirve | ¿Necesaria? |
|---|---|---|
| `expo`, `expo-router`, `react-native`, `typescript` | Base del proyecto | Sí (ya en template) |
| `@tanstack/react-query` | Estado de datos servidor/cache, invalidación | Sí (ya en template) |
| `expo-sqlite` | Base local persistente + cola offline | Sí (Fase 1/2) |
| `expo-secure-store` | Guardar token de forma segura (no en AsyncStorage) | Sí (Fase 1) |
| `@react-native-community/netinfo` | Detectar conectividad real y reintentos automáticos | Sí (Fase 3/5) |
| `expo-image-picker` + `expo-camera` | Tomar/seleccionar foto de repuesto | Solo en Fase 4 (no instalar aún) |
| `expo-image` | Render/caché de imágenes | Solo en Fase 4 |
| `ulid` (o `expo-crypto`) | Generar `local_id` estable para idempotencia | Sí (Fase 2). Alternativa sin dependencia: `expo-crypto` (ya disponible en Expo) |

**No instalar todavía** (control de coste): nada de fotos/cámara hasta Fase 4, sin librerías de UI pesadas, sin gestores de estado extra (react-query cubre el caso).

---

## D. MODELO DE DATOS LOCAL (SQLite)

```sql
-- session (una sola fila activa)
session(
  id INTEGER,            -- user id del servidor
  username TEXT,
  role TEXT,             -- admin|inspector|chief_engineer|mechanic
  boat_id INTEGER,
  last_sync_at TEXT      -- server_time del último /api/sync
)
-- token NUNCA aquí: va en expo-secure-store

boats(
  id INTEGER PRIMARY KEY,
  name TEXT,
  registration TEXT,
  is_active INTEGER,
  updated_at TEXT,
  deleted_at TEXT
)

categories(
  id INTEGER PRIMARY KEY,
  name TEXT,
  is_system INTEGER,
  updated_at TEXT,
  deleted_at TEXT
)

parts(
  id INTEGER PRIMARY KEY,       -- id de servidor (NULL mientras solo local)
  local_id TEXT,                -- para creaciones offline aún sin id de servidor
  boat_id INTEGER,
  name TEXT,
  reference TEXT,
  category_id INTEGER,
  location TEXT,
  quantity INTEGER,
  notes TEXT,
  photo_path TEXT,
  updated_at TEXT,              -- server updated_at conocido (base para conflictos)
  deleted_at TEXT,
  sync_state TEXT               -- synced|pending|syncing|conflict|error
)
-- índices: parts(name), parts(reference), parts(location), parts(boat_id)

pending_changes(
  queue_id TEXT PRIMARY KEY,    -- UUID/ULID local
  action TEXT,                  -- create|update|delete|photo
  part_id INTEGER,              -- id servidor si se conoce (nullable)
  local_id TEXT,                -- para creates offline (idempotencia)
  payload TEXT,                 -- JSON de la operación
  base_updated_at TEXT,         -- updated_at servidor previo (control de concurrencia)
  created_at TEXT,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  status TEXT                   -- pending|syncing|completed|conflict|failed
)
```

**La cola sobrevive al cierre de la app** porque `pending_changes` es una tabla SQLite persistente, nunca memoria.

---

## E. FLUJO DE DATOS

### Online
```
acción usuario → escribe parts (sync_state=pending) → inserta en pending_changes
→ syncEngine hace POST /api/parts/push (batch) → inspecciona results[].status uno a uno
→ mapea local_id→id, guarda updated_at → GET /api/sync → reconcilia cache
→ marca sync_state=synced y elimina fila de la cola
```

### Offline
```
acción usuario → escribe parts (sync_state=pending) → inserta en pending_changes
→ el usuario sigue trabajando con la cache local (búsqueda/filtros funcionan)
→ NO se muestra login solo por falta de red
```

### Reconexión
```
netinfo detecta red → syncEngine automático → push cola → results por operación
→ pull /api/sync → reconciliación → estado sincronizado
(reintentos con backoff; 401/403 → pedir login sin borrar la cola)
```

### Idempotencia (diseño, no se implementa completo aún)
- El `local_id` se genera UNA vez al crear offline y **se conserva en todos los reintentos** del mismo CREATE.
- El backend deduplica por `(boat_id, client_local_id)`, así que reintentar un create con respuesta perdida devuelve el mismo registro → **nunca duplica**.

---

## F. PLAN DE IMPLEMENTACIÓN (por fases, validando en cada una)

| Fase | Alcance | Test de aceptación clave |
|---|---|---|
| **Fase 1** | Proyecto Expo + navegación + API client + Login + sesión segura + `/api/me` + gate de sesión offline | Login OK, token en secure-store, `/api/me` OK, reingreso sin red |
| **Fase 2** | SQLite local + esquema + `/api/sync` inicial + inventario (lista/búsqueda/filtros/detalle) | Cache persiste tras reinicio, búsqueda offline |
| **Fase 3** | CRUD local + cola `pending_changes` (offline) | Crear/editar/borrar offline, cola sobrevive reinicio |
| **Fase 4** | Sync engine completo (push/pull, reintentos, conflictos, idempotencia lost-response) | Test crítico "respuesta perdida → un solo registro" |
| **Fase 5** | Fotos (`GET/POST /api/photos/{id}`) con cámara/galería + subida diferida | Foto offline + reintento al reconectar |
| **Fase 6** | UX, robustez de errores, estados de sync, y build Android | Todos los acceptance tests del doc §35 |

Primer hito concreto (cuando aprobemos Fase 1):
`LOGIN → /api/me → sesión local → /api/sync → inventario local`

---

## NOTAS TÉCNICAS QUE REQUIEREN TU DECISIÓN (importantes)

1. **HTTP en Android (cleartext):** el backend de desarrollo es `http://` (no HTTPS). Android bloquea tráfico HTTP en claro por defecto. Para pruebas contra `devmn.atwebpages.com` habrá que habilitar `usesCleartextTraffic` en `app.json` **solo para desarrollo**. Esto es config del cliente, **no** toca el backend. En producción se cambiará `EXPO_PUBLIC_API_BASE_URL` a HTTPS y se retira el cleartext. ¿Lo dejo previsto así?

2. **`expo-secure-store` en web:** el preview de Emergent corre también en web (donde secure-store no aplica). Para Android real funciona bien; en el preview web usaremos un fallback del util de storage. No afecta al build Android.

3. **Credenciales:** no pondré usuario/password reales en el código. Para probar el login necesitaré que me facilites (por chat, no en el repo) un usuario/clave de desarrollo cuando lleguemos a Fase 1.
