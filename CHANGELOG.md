# Changelog

Todos los cambios relevantes de la aplicación Android se documentan aquí.

## [0.1.3] - 2026-09-28

### Configuración y servidor
- Añadida configuración dinámica del servidor desde la aplicación.
- La URL del servidor ya no queda fijada para las comunicaciones HTTP; se resuelve en tiempo de ejecución.
- La URL seleccionada se persiste localmente y se valida como HTTPS.
- Añadida pantalla de Configuración del servidor, accesible desde el login mediante el botón de configuración.
- Añadido acceso a la configuración del servidor desde Administración.
- Añadido handshake público para comprobar disponibilidad, instalación y compatibilidad de la API antes de cambiar de servidor.
- Validación de versión de API requerida por la aplicación.
- Al cambiar de servidor se cierra la sesión y se eliminan los datos locales, caché, colas pendientes, estado de sincronización y fotografías locales, sin migración de datos.

### Funcionamiento offline
- Mantiene el inventario local disponible sin conexión.
- Las altas, modificaciones y borrados de repuestos se guardan localmente y se incorporan a la cola de sincronización.
- Las colas de fotografías permanecen locales hasta recuperar conectividad.
- Corregido el acceso al modo de sesión en las mutaciones de repuestos para permitir correctamente las operaciones offline.
- Verificado el comportamiento de las colas de creación, modificación, borrado y fotografías al cambiar de servidor.

### Acceso en solo lectura
- Añadido acceso al inventario local sin iniciar sesión cuando existe información almacenada.
- El modo solo lectura permite consultar inventario, buscar, filtrar y visualizar fotografías.
- Deshabilitadas las modificaciones, altas, borrados, cambios de cantidad, subida de fotografías y sincronización en modo solo lectura.
- Añadidas protecciones a nivel de mutación para impedir modificaciones aunque se intente acceder a ellas fuera de la interfaz.

### Fotografías
- Limitado el inventario a una fotografía por repuesto.
- Procesamiento de fotografías en JPEG con resolución máxima de 1600×1200.
- Compresión normal al 85 %, reduciendo hasta el 60 % si es necesario para respetar el límite de 8 MB.
- Se conserva la relación de aspecto original y no se realiza recorte.
- Desactivada la edición/recorte desde el selector de fotografías.
- Eliminación de fotografías locales al sustituir o eliminar un repuesto y limpieza de fotografías huérfanas.
- Añadida visualización de fotografías a pantalla completa.
- Añadido zoom mediante gesto de pellizco hasta 4×.

### Configuración de la aplicación
- Versión de la aplicación: 0.1.3.
- API requerida: 1.4.4.
- Timeout de peticiones: 20 segundos.
- Máximo de reintentos: 5.
- Ajustes de identidad y configuración de Expo/Android/iOS actualizados.
- Dependencias Expo/React Native actualizadas y validadas con Expo Doctor.

### Validación
- npx expo-doctor: 20/20 comprobaciones superadas.
- Sincronización comprobada con los dos servidores.
- Handshake comprobado con servidor compatible, servidor incompatible y URL sin API.
- Cambio de servidor comprobado con colas pendientes de creación, modificación, borrado y fotografías.
- Confirmado que las colas pendientes se destruyen al cambiar de servidor y no se envían al servidor nuevo.
