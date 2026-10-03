package expo.modules.shipsync

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

object ShipSyncScheduler {
  const val NAME = "ShipInventoryBackgroundSync"
  private fun prefs(context: Context) = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)
  fun isSuspended(context: Context) = prefs(context).getBoolean("authSuspended", false)
  fun suspendAuth(context: Context, suspended: Boolean) {
    check(prefs(context).edit().putBoolean("authSuspended", suspended).commit())
  }

  // Calls are serialized on the native async queue, and here across runtimes.
  // Coalesce pending work; allow at most one successor of an executing worker.
  @Synchronized fun reconcile(context: Context, pending: Boolean) {
    val manager = WorkManager.getInstance(context)
    val work = manager.getWorkInfosForUniqueWork(NAME).get()
    if (!pending || isSuspended(context)) {
      // Never cancel an executing JS sync: it owns the sync lock until completion.
      work.filter { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }
        .forEach { manager.cancelWorkById(it.id).result.get() }
      return
    }
    if (work.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }) return
    val request = OneTimeWorkRequestBuilder<ShipSyncWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .addTag(NAME).build()
    manager.enqueueUniqueWork(NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request).result.get()
  }
}
