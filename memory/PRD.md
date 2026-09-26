# PRD — MNores Inventory (cliente Android)

## Problem statement (original)
Cliente Android **offline-first** para MNores Inventory, consumiendo EXCLUSIVAMENTE la API
PHP existente (API 1.4.2 en http://devmn.atwebpages.com). El servidor es la única fuente
de verdad. No crear otro backend / base de datos / autenticación. Tecnología: Expo + React
Native + TypeScript. Entrega por fases (Fase 0 arquitectura → Fase 6 build).

## Aclaración de alcance (del cliente, tras Fase 1)
- A largo plazo la app debe exponer **todas** las funciones de la app web que correspondan
  al rol/permisos del usuario. Los menús actuales (Inventario / Sync / Perfil) son solo la
  estructura INICIAL para validar la arquitectura, NO la estructura definitiva.
- Online: acceso a todas las funciones del rol, respetando los permisos del backend. UI
  específica de Android (no copiar la web visualmente).
- Offline-first: inventario, búsqueda, detalle, crear/editar/eliminar, cantidades y fotos
  según permisos; los cambios van a la cola local y se sincronizan al reconectar. Funciones
  que dependan obligatoriamente del servidor pueden quedar deshabilitadas offline.
- Restricción firme: NO añadir/modificar backend, API, auth ni base de datos PHP.

## Arquitectura (aprobada en Fase 0)
UI → Hooks (react-query) → Repositories → SQLite local + Sync Queue → Sync Engine →
API Client → PHP API. Ninguna pantalla hace fetch directo. SQLite es la persistencia real;
react-query solo orquesta lecturas. Token en expo-secure-store; metadatos de sesión en SQLite.
Detalle completo en /app/memory/PHASE0_ARCHITECTURE.md.

## Personas / roles
admin, inspector, chief_engineer, mechanic. La UI respeta permisos; el servidor es la
autoridad final.

## Implementado

### Fase 0 — Análisis/arquitectura (2026-09-26) ✅
- Propuesta completa de arquitectura, carpetas, dependencias, modelo de datos, flujos y plan.

### Fase 1 — Primera versión funcional (2026-09-26) ✅ APROBADA
- Login, sesión segura (token en secure-store), /api/me, /api/sync, SQLite, inventario,
  búsqueda local y gate offline. Validada en Android/Expo Go por el cliente.

### Fase 2 — Offline-first CRUD + cola de sincronización (2026-09-26) ✅ (validación device pendiente)
- Tabla `pending_changes` (queue_id, action, entity, entity_id, row_uid, client_local_id,
  payload, base_updated_at, created_at, retry_count, last_error, status) persistente en SQLite;
  recuperación de operaciones 'syncing' huérfanas al iniciar.
- `parts` migrada a PK local `row_uid` (+ server_id nullable, pending_delete, sync_state) para
  soportar creates offline sin id de servidor. Migración por PRAGMA user_version=2.
- CREATE/UPDATE/DELETE local-first y atómicos (parte + cola en una transacción SQLite).
- `client_local_id` estable: se genera una vez y se reutiliza en cada reintento (idempotencia
  por (boat_id, client_local_id)). Verificado por curl: reintento → mismo id, sin duplicado.
- Consolidación de updates: taps repetidos de cantidad y edición previa a sync se fusionan en
  una sola operación pendiente por repuesto (create+edit → un solo create).
- Sync Engine funcional: push batch a /api/parts/push, procesa results[].status por operación
  (ok, conflict_overwritten, not_found, forbidden, invalid), retry acotado (máx 5) sin bucles,
  no pierde ni duplica; luego GET /api/sync + reconciliación protegiendo filas con pendientes.
  Disparos: al iniciar (si hay red), al recuperar conexión, y botón manual "Sincronizar ahora".
- Conflictos: conflict_overwritten → aviso neutral + reconciliación por /api/sync (estado final
  del servidor). Sin política de resolución inventada en el cliente.
- Permisos de rol en UI: chief_engineer crea/edita/elimina/cambia cantidad; mechanic solo
  cantidad. El servidor sigue siendo la autoridad (forbidden manejado).
- UX: indicadores discretos por repuesto (pendiente/sincronizando/sincronizado/error/conflicto),
  banner de pendientes, FAB de alta, +/- de cantidad inline y en detalle, confirmación de
  borrado en dos pasos (sin Alert). El inventario no se bloquea durante la sync.

### Fase 2 — Correcciones tras pruebas en dispositivo (2026-09-26)
- BUG SYNC (raíz): el backend devuelve HTTP 500 (cuerpo vacío) en creates con `category_id`
  null/omitido; el cliente clasificaba cualquier error != 401/403 como "Sin conexión". Fixes
  (solo cliente): (1) `ApiError.kind` (network/timeout/http/parse/api) + snippet de cuerpo;
  (2) el engine distingue conectividad real de errores HTTP/parse/API y NO los llama "sin
  conexión"; (3) envío por-ítem para que un ítem inválido no bloquee al resto de la cola;
  (4) tarjeta "Diagnóstico" en la pantalla Sync (método, URL, status HTTP, timeout, error de
  fetch, JSON válido, clasificación, recorte de respuesta) sin exponer tokens; (5) categoría
  ahora obligatoria en el formulario para no encolar operaciones que el servidor rechazaría.
  Recuperación de un pendiente atascado sin categoría: abrir el repuesto → Editar → elegir
  categoría → Guardar (se fusiona en el create) → sincroniza. No se borra ningún pendiente.
- BUG TECLADO (raíz): el componente `Field` estaba declarado DENTRO de `PartEditScreen`, por lo
  que cada `onChangeText` creaba una nueva identidad de componente y React remontaba los
  `TextInput`, perdiendo el foco. Fix: `Field` movido a ámbito de módulo (identidad estable).

## NO implementado aún (fases posteriores)
Fotos/cámara, administración de usuarios/barcos/categorías, resto de menús por rol,
UI avanzada/animaciones, build de producción.

## Backlog priorizado
- P0 (Fase 3): Sincronización completa/robustez avanzada, escenarios de conflicto extendidos.
- P1 (Fase 4): Fotos (GET/POST /api/photos/{id}) con cámara/galería y subida diferida.
- P1 (Fase 5): Resto de funciones/menús según rol; UX y robustez de errores.
- P2 (Fase 6): Pruebas finales + build Android (retirar cleartext, HTTPS).

## Próximas tareas
1. Validar Fase 2 en Android/Expo Go (matriz A–H: online CRUD, offline create/update/delete,
   retry, idempotencia, permisos, conflicto).
2. Al aprobar, comenzar Fase 3.
