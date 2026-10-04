package expo.modules.shipsync

import android.content.Context
import android.util.Log
import android.os.Handler
import android.os.Looper
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import expo.modules.interfaces.taskManager.TaskServiceProviderHelper
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeout

class ShipSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    if (ShipSyncScheduler.isSuspended(applicationContext)) return Result.success()
    Log.i(ShipSyncScheduler.NAME, "Starting background sync attempt $runAttemptCount")
    return try {
      val response = CompletableDeferred<String>()
      // TaskService uses Android Handlers; initialize and dispatch on main.
      Handler(Looper.getMainLooper()).post {
        try {
          val service = checkNotNull(TaskServiceProviderHelper.getTaskServiceImpl(applicationContext))
          val consumer = service.getTaskConsumers(applicationContext.packageName)
            .filterIsInstance<ShipSyncConsumer>().firstOrNull()
          if (consumer == null) response.complete("retry")
          else consumer.execute { result -> response.complete(result["result"] as? String ?: "retry") }
        } catch (e: Exception) { response.completeExceptionally(e) }
      }
      val outcome = withTimeout(8 * 60 * 1000L) { response.await() }
      Log.i(ShipSyncScheduler.NAME, "Background sync outcome: $outcome")
      when (outcome) {
        "auth" -> Result.success()
        "done" -> Result.success()
        else -> Result.retry()
      }
    } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
      Result.retry()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      Result.retry()
    }
  }
}
