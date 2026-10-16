package com.watchdrift.data

import android.content.Context
import android.net.Uri
import java.io.File

/**
 * Reads and writes watch_drift.json.
 *
 * Writes go through a temp file and an atomic rename, with a .bak of the last
 * good file. A half-written data file is not a cosmetic problem here: it is
 * the loss of a multi-month measurement series that cannot be re-taken,
 * because the readings are timestamped events that already happened.
 */
class DataStore(private val context: Context) {

    val dataFile: File get() = File(context.filesDir, "watch_drift.json")
    private val backupFile: File get() = File(context.filesDir, "watch_drift.json.bak")
    private val tempFile: File get() = File(context.filesDir, "watch_drift.json.tmp")

    fun load(): AppData {
        if (!dataFile.exists()) {
            // A backup surviving without the main file means a write was
            // interrupted. Recover rather than silently starting empty — an
            // empty start looks like a working app and loses everything.
            if (backupFile.exists()) {
                return runCatching { parseAppData(backupFile.readText()) }.getOrElse { AppData() }
            }
            return AppData()
        }
        return runCatching { parseAppData(dataFile.readText()) }
            .getOrElse {
                runCatching { parseAppData(backupFile.readText()) }.getOrElse { AppData() }
            }
    }

    fun save(data: AppData) {
        val json = data.toJson().toString(2)
        tempFile.writeText(json)
        if (dataFile.exists()) dataFile.copyTo(backupFile, overwrite = true)
        if (!tempFile.renameTo(dataFile)) {
            dataFile.writeText(json)
            tempFile.delete()
        }
    }

    /** Import a watch_drift.json exported from Termux. Null on parse failure. */
    fun importFrom(uri: Uri): AppData? =
        context.contentResolver.openInputStream(uri)?.use { stream ->
            runCatching { parseAppData(stream.readBytes().decodeToString()) }.getOrNull()
        }

    fun exportTo(uri: Uri, data: AppData): Boolean = runCatching {
        context.contentResolver.openOutputStream(uri)?.use {
            it.write(data.toJson().toString(2).toByteArray())
        }
        true
    }.getOrElse { false }

    /**
     * Merge imported readings into existing ones, keyed by reading id.
     *
     * Union, not replace: the Termux app and this one may each hold readings
     * the other has not seen, and a reading is an unrepeatable timestamped
     * event. Losing one to an import is not recoverable, so an existing
     * reading always wins over an incoming one with the same id.
     */
    fun merge(current: AppData, incoming: AppData): AppData {
        val watches = LinkedHashMap<String, Watch>()
        current.watches.forEach { watches[it.id] = it }
        incoming.watches.forEach { watches.putIfAbsent(it.id, it) }

        val readings = LinkedHashMap<String, Reading>()
        current.readings.forEach { readings[it.id] = it }
        incoming.readings.forEach { readings.putIfAbsent(it.id, it) }

        return AppData(
            watches = watches.values.toList(),
            readings = readings.values.sortedBy { it.ts },
            settings = current.settings
        )
    }
}
