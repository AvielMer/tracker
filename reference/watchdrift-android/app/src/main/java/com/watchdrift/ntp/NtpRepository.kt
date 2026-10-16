package com.watchdrift.ntp

import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/**
 * NTP sync state and the app's notion of true time.
 *
 * The one invariant that matters: if a sync has never succeeded, the app must
 * be LOUD about it. A phone can easily be a second or more out, and recording
 * against the raw phone clock produces data that looks fine and is wrong —
 * which would be attributed to the watch and never questioned. So recording is
 * refused rather than warned about.
 *
 * [Snapshot] exists because a reading must be computed from, and labelled
 * with, the SAME sync. Checking "is it ok to record", then asking for the
 * time, then reading the offset lets a background sync land in between, so the
 * stored conditions would describe a different sync than the measurement used.
 * One snapshot covers a whole reading.
 */
class NtpRepository {

    companion object {
        /** After 30 min, a sync is too old to record against. */
        const val STALE_S = 1800L

        val SERVERS = listOf(
            "pool.ntp.org",
            "time.google.com",
            "time.cloudflare.com",
            "time.windows.com",
            "il.pool.ntp.org"
        )
    }

    data class Snapshot(
        val synced: Boolean,
        val offsetMs: Double,
        val delayMs: Double?,
        val server: String?,
        /** Unix seconds when this sync completed (from the monotonic anchor). */
        val syncTs: Double,
        val status: String,
        /** Monotonic anchor: elapsedRealtime at the moment of sync. */
        private val anchorElapsedMs: Long = 0L,
        /** True unix time in ms at that anchor. */
        private val anchorTrueMs: Double = 0.0
    ) {
        /**
         * True time now, in ms.
         *
         * Derived from the monotonic clock, not the wall clock, so an OS or
         * operator clock step mid-session cannot corrupt a reading in flight.
         */
        fun nowMs(): Double {
            if (!synced) return System.currentTimeMillis().toDouble()
            return anchorTrueMs + (SystemClock.elapsedRealtime() - anchorElapsedMs)
        }

        /** True time, in ms, at a given monotonic instant. */
        fun trueMsAtElapsed(elapsedMs: Long): Double {
            if (!synced) return System.currentTimeMillis().toDouble()
            return anchorTrueMs + (elapsedMs - anchorElapsedMs)
        }

        fun ageS(): Double? =
            if (!synced) null
            else (SystemClock.elapsedRealtime() - anchorElapsedMs) / 1000.0

        /** (ok, reason) — recording is refused, not merely warned about. */
        fun okToRecord(): Pair<Boolean, String> {
            if (!synced) return false to "NOT SYNCED to NTP — sync before recording."
            val age = ageS() ?: return false to "NOT SYNCED to NTP."
            if (age > STALE_S) {
                return false to
                    "NTP sync is ${(age / 60).toInt()} min old — re-sync before recording."
            }
            return true to ""
        }
    }

    private val _state = MutableStateFlow(
        Snapshot(
            synced = false, offsetMs = 0.0, delayMs = null, server = null,
            syncTs = 0.0, status = "not synced"
        )
    )
    val state: StateFlow<Snapshot> = _state.asStateFlow()

    /** Index of the preferred server; persisted by the caller. */
    var serverIdx: Int = 0
        private set

    var onServerChange: ((String) -> Unit)? = null

    fun selectServer(index: Int) {
        serverIdx = ((index % SERVERS.size) + SERVERS.size) % SERVERS.size
        onServerChange?.invoke(SERVERS[serverIdx])
    }

    fun nextServer() {
        selectServer(serverIdx + 1)
    }

    /**
     * Sync against the selected server, falling back to the others.
     *
     * Failover matters because the first server in the list is not reliably
     * reachable; without it a failed sync leaves the app on the bare system
     * clock while still looking normal.
     */
    suspend fun sync(tryOthers: Boolean = true): Snapshot = withContext(Dispatchers.IO) {
        val order = buildList {
            add(serverIdx)
            if (tryOthers) addAll(SERVERS.indices.filter { it != serverIdx })
        }

        val errors = mutableListOf<String>()
        for (i in order) {
            val server = SERVERS[i]
            _state.value = _state.value.copy(status = "syncing $server…")
            val sample = try {
                SntpClient.bestOf(server)
            } catch (e: Exception) {
                errors.add("$server: ${e.javaClass.simpleName}")
                continue
            }

            if (i != serverIdx) {
                // this one worked and the preferred one didn't — make it the
                // preferred one, so the next launch starts where you left off
                serverIdx = i
                onServerChange?.invoke(server)
            }

            val snap = Snapshot(
                synced = true,
                offsetMs = sample.offsetMs,
                delayMs = sample.delayMs,
                server = server,
                syncTs = sample.trueTimeAtResponseMs / 1000.0,
                status = "NTP OK [$server]  offset ${fmtSigned(sample.offsetMs)}ms  " +
                    "rtt ${sample.delayMs.toInt()}ms",
                anchorElapsedMs = sample.elapsedRealtimeAtResponseMs,
                anchorTrueMs = sample.trueTimeAtResponseMs
            )
            _state.value = snap
            return@withContext snap
        }

        val failed = _state.value.copy(
            synced = false,
            status = "NTP FAILED (${errors.take(3).joinToString(", ")}) — " +
                "NOT SYNCED: do not record."
        )
        _state.value = failed
        failed
    }

    private fun fmtSigned(v: Double): String =
        if (v >= 0) "+${v.toInt()}" else "${v.toInt()}"
}
