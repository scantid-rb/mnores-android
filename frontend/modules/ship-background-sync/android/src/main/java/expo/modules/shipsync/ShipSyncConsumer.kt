package expo.modules.shipsync

import android.content.Context
import expo.modules.interfaces.taskManager.*

// Public constructor/class retained for TaskService's persisted reflective restore.
class ShipSyncConsumer(context: Context?, utils: TaskManagerUtilsInterface?) :
  TaskConsumer(context, utils), TaskConsumerInterface {
  private var task: TaskInterface? = null
  override fun taskType() = ShipSyncScheduler.NAME
  override fun didRegister(task: TaskInterface) { this.task = task }
  override fun didUnregister() { task = null }
  fun execute(callback: TaskExecutionCallback) {
    checkNotNull(task).execute(null, null, callback)
  }
}
