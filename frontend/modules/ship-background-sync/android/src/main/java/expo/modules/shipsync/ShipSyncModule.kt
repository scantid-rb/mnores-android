package expo.modules.shipsync

import expo.modules.interfaces.taskManager.TaskManagerInterface
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.sync.Mutex

class ShipSyncModule : Module() {
  companion object { private val syncMutex = Mutex() }
  private val owners = java.util.concurrent.ConcurrentHashMap<String, Any>()
  override fun definition() = ModuleDefinition {
    Name("ShipBackgroundSync")
    AsyncFunction("register") {
      val manager = checkNotNull(appContext.legacyModule<TaskManagerInterface>())
      manager.registerTask(ShipSyncScheduler.NAME, ShipSyncConsumer::class.java, emptyMap())
    }
    AsyncFunction("reconcile") { pending: Boolean ->
      ShipSyncScheduler.reconcile(checkNotNull(appContext.reactContext), pending)
    }
    AsyncFunction("resumeAuth") {
      ShipSyncScheduler.suspendAuth(checkNotNull(appContext.reactContext), false)
    }
    AsyncFunction("suspendAuth") {
      val context = checkNotNull(appContext.reactContext)
      ShipSyncScheduler.suspendAuth(context, true)
      ShipSyncScheduler.reconcile(context, false)
    }
    // Shared by foreground/headless runtimes; process death releases it naturally.
    AsyncFunction("acquireSync") Coroutine { owner: String ->
      // Mutex owners use reference identity. JS strings are reconstructed at
      // each bridge call, so retain an actual object keyed by the JS identifier.
      val handle = Any()
      syncMutex.lock(handle)
      owners[owner] = handle
      Unit
    }
    AsyncFunction("releaseSync") { owner: String ->
      synchronized(owners) {
        owners.remove(owner)?.let { handle ->
          if (syncMutex.holdsLock(handle)) syncMutex.unlock(handle)
        }
      }
    }
    OnDestroy {
      // A destroyed JS runtime cannot finish a promise/finally. Its claims will
      // be recovered by the next lock owner; do not strand the surviving process.
      synchronized(owners) {
        owners.values.forEach { handle -> if (syncMutex.holdsLock(handle)) syncMutex.unlock(handle) }
        owners.clear()
      }
    }
  }
}
