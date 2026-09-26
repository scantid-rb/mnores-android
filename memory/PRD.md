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

### Fase 1 — Primera versión funcional (2026-09-26) ✅ (validación app e2e en Android pendiente)
- Proyecto Expo Router + TypeScript, providers (SafeArea, Query, Session, Keyboard).
- Config por env: EXPO_PUBLIC_API_BASE_URL (sin URLs hard-coded). Cleartext HTTP Android
  solo dev (app.json android.usesCleartextTraffic=true — QUITAR antes de producción HTTPS).
- API client centralizado (Bearer, timeout, parseo seguro, sin logs de token).
- Endpoints: /api/login, /api/me, /api/sync.
- Token en expo-secure-store; sesión (id, username, role, boat_id, last_sync_at) en SQLite.
- SQLite local (expo-sqlite) con tablas session, boats, categories, parts + índices
  (name, reference, location, category) y fallback web (storage util) para el preview.
- Sincronización inicial: /api/me (valida) → /api/sync → reconciliación en cache local.
- Pantallas: Login, Inventario (lista compacta, buscador permanente, chips de categoría,
  pull-to-refresh, estado de sync), Detalle (solo lectura), Sync (estado/contadores/manual),
  Perfil (usuario/rol/barco/versiones/logout).
- Gate de sesión offline: con sesión guardada entra directo a inventario sin red; sin sesión
  muestra login. El primer login sí requiere red.
- Búsqueda LOCAL sobre SQLite (LIKE + índices), disponible offline.
- Detección de conectividad (NetInfo): Online / Offline.

## NO implementado aún (fases posteriores)
CREATE/UPDATE/DELETE, pending_changes funcional, cola de sync, reintentos/backoff,
conflictos, fotos/cámara, sincronización de modificaciones, resto de menús por rol,
UI avanzada/animaciones, build de producción.

## Backlog priorizado
- P0 (Fase 2): CRUD local + tabla/lógica pending_changes (offline), local_id idempotente.
- P0 (Fase 3): Sync engine completo (push cola, results[].status, reintentos, conflictos,
  prueba de respuesta perdida / no duplicados).
- P1 (Fase 4): Fotos (GET/POST /api/photos/{id}) con cámara/galería y subida diferida.
- P1 (Fase 5): Resto de funciones/menús según rol; UX y robustez de errores.
- P2 (Fase 6): Pruebas finales + build Android (retirar cleartext, HTTPS).

## Próximas tareas
1. Validar en Android/Expo Go: login → sesión → /api/me → /api/sync → inventario → cerrar
   offline → reabrir → sigue en inventario con datos y búsqueda.
2. Al aprobar, comenzar Fase 2 (CRUD local + cola).
