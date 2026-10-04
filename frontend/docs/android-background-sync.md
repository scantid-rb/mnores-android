# Sincronización Android en segundo plano

## Arquitectura y elección

Estado revisado en `0.1.4`: Expo ~57.0.26, React Native 0.86.3, Expo Router,
CNG/managed con prebuild de EAS; inicialmente no había `android/` versionado.
SQLite (`mnores.db`) contiene inventario, sesión sin secretos, `pending_changes`
y `photo_queue`. Las fotos están en `documentDirectory/photos/`. El token continúa
en Expo SecureStore, con la clave y serialización originales. La URL se restaura
desde la configuración persistente; no se cambia producción ni API 1.4.5.

`expo-background-task` 57 ofrece un intervalo y programación recurrente. Para una
cola con trabajo puntual sin retraso periódico inicial se usa un módulo local de
Expo, `modules/ship-background-sync`, con AndroidX WorkManager 2.9.1 (la misma
versión utilizada por el módulo oficial de Expo 57), y `expo-task-manager`
~57.0.21 para cargar/ejecutar JS headless. No hay dependencia de terceros para
Headless JS, nuevo servidor, conversión a bare ni Android generado versionado.
El consumidor usa las interfaces nativas de TaskManager de Expo: comprobar esa
integración al actualizar el SDK.

Referencias:
- https://docs.expo.dev/versions/v57.0.0/sdk/background-task/
- https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/
- https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work
- https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/manage-work

## Programación y ejecución

Tras confirmar una escritura local de alta, edición, borrado o fotografía,
`reconcileBackgroundSync()` cuenta ambas colas y registra el consumidor
persistente. También se reconcilia al finalizar `runSync`, actualizar pendientes,
volver al primer plano e iniciar sesión. Una excepción de programación se registra
sin convertir una escritura ya guardada en una operación fallida; abrir/recuperar
la aplicación vuelve a intentar programarla.

WorkManager conserva solicitudes puntuales con nombre único
`ShipInventoryBackgroundSync`, `NetworkType.CONNECTED` y backoff exponencial de
30 segundos (el máximo lo limita WorkManager). No hay tarea periódica ni polling.
Una red conectada no garantiza acceso a Internet/API: el motor detecta ese fallo
y el worker conserva el trabajo para otro intento.

Se agrupa cualquier solicitud pendiente. Si ya está ejecutándose una solicitud,
se permite **un único sucesor** en la misma cadena (`APPEND_OR_REPLACE`), agrupando
las siguientes escrituras en él. Esto evita perder un cambio que llegue entre
la última lectura de SQLite y la finalización nativa del worker. No son workers
independientes acumulados por cada repuesto: como máximo hay uno ejecutándose y
un sucesor pendiente. Si no hay trabajo reintentable se cancelan solicitudes
pendientes, sin cancelar una ejecución que todavía posee el bloqueo de sync.

`index.js` define la tarea antes de cargar Expo Router. Android inicia el
consumidor persistido y TaskManager carga JS aunque el proceso anterior haya
muerto. La función no usa componentes, navegación, hooks ni `SyncContext`.
Restaura almacenamiento, URL y sesión; llama al mismo `runSync(token)` que la UI:
operaciones primero, reconciliación y fotografías cuando ya existe `server_id`.
Las confirmaciones se aplican mediante los métodos existentes de SQLite.
La identidad `client_local_id` se conserva al recuperar/reintentar altas.

Cada pasada headless tiene un presupuesto cooperativo de tres minutos, comprobado
entre operaciones; una petición en curso conserva su timeout actual de 20 s.
Si quedan operaciones/fotos, el worker devuelve `Result.retry()`. La espera nativa
del callback tiene un límite de ocho minutos. Una ejecución detenida por Android
puede continuar brevemente en JS; el mutex evita solaparla con otro intento.

## Concurrencia, recuperación y autenticación

Un mutex nativo compartido entre runtimes serializa `runSync` y los cambios de
sesión de login/logout. Se libera en `finally`, al destruir el runtime y con la
muerte del proceso. La inicialización SQLite es idempotente por runtime y **no**
restablece reclamaciones de otro sync vivo. Con el mutex adquirido, `runSync`
recupera `syncing` y `uploading` a `pending`; evita colas bloqueadas tras un cierre.

No se copia el token a WorkManager Data, preferencias, SQLite ni logs. El worker
lo recupera mediante `sessionRepository.restore()` y SecureStore. Antes de enviar,
el motor comprueba que sigue siendo el token actual. La suspensión de fondo por
autenticación es únicamente una bandera booleana sin secretos.

Con 401/403, o sin sesión disponible, la tarea termina y se suspende la programación
automática hasta que la aplicación vuelva a resolver la sesión. La comparación
del token rechazado con el actual evita suspender un nuevo login por una respuesta
antigua. Abrir la app con sesión restaurada o iniciar sesión habilita otra vez la
programación; la sincronización normal valida el token. El worker no hace logout,
no borra el inventario, las operaciones ni las fotografías.

Errores de red/timeout conservan operaciones y fotos en `pending` sin agotar
el contador de fallos de las fotos. Rechazos definitivos y errores repetidos del
servidor conservan la política existente de filas `failed`, visibles/reintentables
desde la UI. No se reintentan automáticamente filas que requieren intervención.

Se mantienen sync inicial, manual y al recuperar conectividad. Al volver al primer
plano se refrescan consultas, sesión y contadores para mostrar lo realizado en fondo.
La fuente de verdad del trabajo es SQLite, nunca el contador React.

## Android, reinicio y límites

WorkManager persiste el trabajo y lo reprograma después del reinicio sin que
ShipInventory añada un receptor BOOT_COMPLETED. La ejecución con SecureStore y
almacenamiento privado requiere que el dispositivo esté desbloqueado.

Android decide el momento: cuando la red cumple la restricción puede ejecutar tan
pronto como el sistema lo permita, con demoras por Doze, cuotas o restricciones
de batería del fabricante. No se promete ejecución instantánea.

Eliminar el proceso (`adb shell am kill ...` cuando está en segundo plano) es
**distinto de Forzar detención**. Si el usuario fuerza la detención desde Ajustes
(o `am force-stop`), Android puede impedir el trabajo hasta volver a abrir la app.
Eso es una limitación Android, no un bug. Algunos fabricantes también restringen
la ejecución al retirar la app de recientes.

SQLite y WorkManager tienen bases diferentes: si el proceso muere exactamente
entre confirmar una escritura y completar su programación, la cola permanece
intacta, pero puede necesitar la reconciliación del siguiente arranque. No hay
una transacción atómica entre esas dos bases. Un fallo de registro inicial se
muestra en logs; no se oculta con un temporizador permanente.

## Build y validación

Se requiere un APK/development build que incluya el módulo nativo; **Expo Go no
puede probarlo** y una actualización solamente JS no lo instala. EAS mantiene
prebuild/autolinking, `preview-arm64` y las credenciales existentes. No versionar
`frontend/android/` generado: haría que EAS dejase de aplicar el prebuild habitual.

Comandos desde `frontend/`:

```sh
yarn test
yarn typecheck
yarn lint
EAS_BUILD_PROFILE=preview-arm64 npx expo prebuild --platform android --no-install
./android/gradlew -p android :ship-background-sync:compileDebugKotlin
```

Las pruebas Node necesitan Node >=22.13 por `node:sqlite`. Ejecutan el store nativo
real con una adaptación a SQLite de Node, el motor real con API simulada y la
orquestación headless sin React. No equivalen a una prueba del scheduler Android.

Resultado de esta implementación:
- 42 pruebas automatizadas aprobadas: persistencia/reapertura SQLite, altas,
  cambios, borrado, fotos, interrupción de reclamaciones, 401/403, diez fallos de
  red de fotografías, presupuesto, serialización lógica e idempotencia tras perder
  la respuesta de una creación ya recibida por el servidor; rechazo de llamadas
  con token obsoleto o sin sesión y protección ante escritura parcial del login.
- Expo Doctor: 20/20 comprobaciones aprobadas; instalación frozen-lockfile aprobada.
- Exportación Android/bytecode Hermes y prebuild `preview-arm64` aprobados;
  `reactNativeArchitectures=arm64-v8a`, autolinking de ambos módulos comprobado.
- ESLint de archivos modificados aprobado. `yarn lint` aprobado; la inspección
  adicional `eslint .` tiene 19 errores previos en `scripts/cmd-guard/vendor/`
  y tres avisos previos, sin corregir código ajeno a este cambio.
- Typecheck global conserva siete errores previos: `audit.tsx`, `part-edit.tsx`,
  métodos ausentes del fallback web y `theme.ts`. Comparado con el commit base.
  Se corrigieron los tipos de fotografía local y la tupla de configuración ARM64
  por estar relacionados con esta implementación; no hay errores nuevos.
- Compilación nativa Gradle no completada: este entorno no tiene SDK Android y la
  descarga de Gradle falló con `Network is unreachable`. No se ha construido un
  APK ni realizado una release. No hay dispositivo/emulador Android disponible.
- Casos reales de segundo plano, muerte de proceso, reinicio y agrupación nativa:
  pendientes de ejecución en dispositivo. No se presentan como pruebas superadas.

### Pruebas en APK de pruebas con dispositivo

Usar un servidor/cuenta de pruebas, sin manipular producción. Registrar contador
inicial, ID local, ID final del servidor y logs; esperar al scheduler sin abrir la
app en los casos de fondo. La confirmación más fuerte es observar el servidor
desde otro cliente, ya que abrir ShipInventory dispara sync normal.

```sh
adb logcat -s ShipInventoryBackgroundSync WM-WorkerWrapper ReactNativeJS
adb shell dumpsys jobscheduler
# Sólo con la aplicación previamente enviada a segundo plano:
adb shell am kill com.shipinventory.x6tence.app
```

1. **Abierta:** offline, alta en cola, reconectar; verificar sync habitual y cero
   pendientes sin duplicado.
2. **Segundo plano:** offline, alta, botón Inicio, reconectar; observar confirmación
   desde otro cliente antes de volver a abrir ShipInventory.
3. **Proceso eliminado:** repetir el caso anterior con `am kill` después de Inicio;
   comprobar nuevo arranque headless y confirmación sin abrir la app. No usar
   `force-stop` para simular muerte ordinaria.
4. **Foto:** alta y edición offline con foto, fondo y reconexión; comprobar ID antes
   de subida, imagen recibida y eliminación local sólo tras confirmación.
5. **Offline prolongado:** generar muchos cambios; inspeccionar trabajo agrupado,
   sin un worker por cambio; reconectar y verificar todos los resultados.
6. **401/403:** invalidar token en servidor de pruebas o simular respuestas; comprobar
   colas/ficheros intactos, pausa de fondo y éxito tras resolver sesión.
7. **Idempotencia:** proxy de pruebas acepta alta pero descarta respuesta; repetir
   intento y comprobar un único ID remoto con el mismo ID local.
8. **Reinicio:** crear offline, confirmar programación, reiniciar, desbloquear y
   recuperar red sin abrir la aplicación; observar ejecución y vaciado de cola.
9. **Force Stop:** comprobar que no se exige sync mientras está forzada; abrir otra
   vez y verificar recuperación. Repetir si procede con restricciones del fabricante.


## Correcciones P1/P2 de la revisión del PR #2

El login mantiene el bloqueo de sincronización durante toda la transición:
respuesta de login → suspender background → retirar y confirmar retirada del token
anterior → limpiar datos si cambia el propietario (también si no hay propietario
conocido) → guardar metadata nueva → guardar token nuevo en SecureStore → reactivar
background → reconciliar programación. Si falla la retirada, no se modifica SQLite.
La versión instalada de SecureStore confirma escritura y retirada Android mediante
`SharedPreferences.commit()`, comprobado en su fuente; no se añadió código nativo.

| Momento de interrupción | Estado restaurable |
|---|---|
| Antes de retirar el token anterior | Token A, metadata y colas A |
| Después de retirarlo | Sin token, metadata/colas A |
| Durante la limpieza SQLite | Sin token; SQLite confirma o revierte su transacción |
| Tras limpiar los datos | Sin token ni datos antiguos |
| Después de guardar metadata B / antes de guardar token B | Metadata B sin token |
| Después de guardar token B / antes de resumeAuth | Token y metadata B; sin colas A; background suspendido |

`restore()` comparte el bloqueo y no publica credenciales sin metadata. `logout()`
retira el token pero conserva el propietario no secreto del inventario retenido:
ese propietario no constituye una sesión autenticada. Así un login posterior de
B reconoce y limpia los datos A. `runSync()` llama a `/api/me` antes de cualquier
push/subida y compara su ID con la sesión SQLite; una discrepancia termina como
error de autenticación sin procesar ninguna cola. Errores de red de esta validación
conservan el trabajo. La suspensión condicional de un token rechazado está dentro
del repositorio, evitando bloqueos anidados y la suspensión de un login posterior.

Las fotos sin ID remoto cuyo CREATE termina failed (rechazo definitivo o máximo
de reintentos) pasan a `failed`, con marcador `parent_create_failed`, **en la misma
transacción** que el padre. Siguen presentes en SQLite y en disco, pero dejan de
contar como trabajo reintentable. Adjuntar una foto a un padre ya fallido aplica
el mismo estado; inicialización/recuperación reparan el estado escrito por versiones
anteriores. Corregir o reintentar el CREATE reactiva sus fotos dependientes; su
confirmación asigna el ID remoto y permite subirlas. Las fotos fallidas por errores
propios de subida no se reactivan incidentalmente. `discardFailed()` conserva su
limpieza explícita de filas y archivos.

Al corregir un CREATE cuyo resultado pudo perderse (máximo de reintentos), se
conservan el payload original y `client_local_id`; la edición se difiere hasta
confirmar el alta idempotente. Así se recuperan padre y foto sin alterar el alta
que el servidor podría haber recibido previamente.

Regresiones: 42 tests aprobados, incluyendo snapshots de todos los límites de
persistencia del login, restauración headless de cada snapshot, rollback real de
SQLite, logout/cambio de usuario, falla al retirar credenciales, metadata antigua
sin propietario, discrepancia de `/api/me`, red/401 en su validación, suspensión
antigua tras nuevo login, invalid/forbidden/MAX_RETRIES con foto, corrección,
reintento, reparación de estado legado y descarte. Estos tests usan SQLite real y
SecureStore/API simulados; no equivalen a matar un proceso Android físico en cada
instrucción. Kotlin/WorkManager, backend, permisos y UI no se modificaron.
