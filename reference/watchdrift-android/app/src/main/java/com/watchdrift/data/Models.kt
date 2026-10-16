package com.watchdrift.data

/**
 * The domain model. Deliberately free of any Android or JSON dependency, so
 * the statistics engine that operates on it can be unit-tested on a plain JVM
 * with nothing mocked. JSON mapping lives in Json.kt.
 *
 * Field names mirror the on-disk schema of the Termux app's watch_drift.json.
 * Years of readings live in that file and the names are load-bearing, so
 * nothing here renames or restructures one.
 */

data class Watch(
    val id: String,
    val name: String,
    val specSPerYear: Double? = null,
    val toleranceS: Double? = null,
    /** Keys from the file this version does not know about, preserved on save. */
    val extras: Map<String, Any?> = emptyMap()
)

data class Reading(
    val id: String,
    val watchId: String,
    /** Unix seconds, fractional. */
    val ts: Double,
    val ntpSeconds: Int,
    val minuteAdjust: Int,
    val adjMode: String,
    val rawOffsetSec: Double,
    val totalOffsetSec: Double,
    val method: String? = null,
    val ntpServer: String? = null,
    val ntpOffsetMs: Double? = null,
    val ntpDelayMs: Double? = null,
    /** Taken right after the watch was reset or synced: starts a new segment. */
    val postSync: Boolean = false,
    /**
     * True once rawOffsetSec is stored at ms resolution (post 2026-09-14).
     * Older rows stored 1 dp, so their sub-second part is a rounding artifact,
     * not a measurement — without this flag the detail screen cannot tell
     * "-0.0" (unknown, ±50ms) from a real 0 ms hit.
     */
    val rawResMs: Boolean = false,
    val readErrSec: Double? = null,
    val taps: Int? = null,
    val tapJitterMs: Double? = null,
    val tapResidMs: List<Int>? = null,
    val tapDriftMsPerTick: Double? = null,
    val tapSpanTicks: Int? = null,
    val tapsTrimmed: Int? = null,
    /** Ambient temperature at the reading, if a sensor was available. */
    val tempC: Double? = null,
    val extras: Map<String, Any?> = emptyMap()
)

data class AppData(
    val watches: List<Watch> = emptyList(),
    val readings: List<Reading> = emptyList(),
    val settings: Map<String, Any?> = emptyMap()
) {
    fun readingsFor(watchId: String): List<Reading> =
        readings.filter { it.watchId == watchId }.sortedBy { it.ts }

    fun watchById(id: String?): Watch? = watches.firstOrNull { it.id == id }
}

/** Reference data for a watch: movement, spec, battery, notes. Hand-edited. */
data class Profile(
    val match: String,
    val name: String? = null,
    val movement: String? = null,
    val specSPerYear: Double? = null,
    val toleranceS: Double? = null,
    val battery: String? = null,
    val notes: List<String> = emptyList()
)
