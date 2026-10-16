package com.watchdrift.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * JSON mapping for the on-disk watch_drift.json format.
 *
 * Kept apart from Models.kt so the domain model and the statistics engine have
 * no JSON dependency and can be unit-tested on a plain JVM.
 *
 * Unknown keys are carried through verbatim via `extras`, so a file written by
 * a newer version of the Termux app is never silently stripped by this one.
 */

private val WATCH_KNOWN = setOf("id", "name", "spec_s_per_year", "tolerance_s")

private val READING_KNOWN = setOf(
    "id", "watchId", "ts", "ntpSeconds", "minuteAdjust", "adjMode",
    "rawOffsetSec", "rawResMs", "totalOffsetSec", "method", "ntpServer",
    "ntpOffsetMs", "ntpDelayMs", "postSync", "readErrSec", "taps",
    "tapJitterMs", "tapResidMs", "tapDriftMsPerTick", "tapSpanTicks",
    "tapsTrimmed", "tempC"
)

// ── Parsing ───────────────────────────────────────────────────────────────────

fun parseAppData(text: String): AppData = appDataFromJson(JSONObject(text))

fun appDataFromJson(o: JSONObject): AppData {
    val ws = o.optJSONArray("watches") ?: JSONArray()
    val rs = o.optJSONArray("readings") ?: JSONArray()
    return AppData(
        watches = (0 until ws.length()).map { watchFromJson(ws.getJSONObject(it)) },
        readings = (0 until rs.length()).map { readingFromJson(rs.getJSONObject(it)) },
        settings = o.optJSONObject("settings")?.toMap() ?: emptyMap()
    )
}

fun watchFromJson(o: JSONObject): Watch = Watch(
    id = o.optString("id"),
    name = o.optString("name"),
    specSPerYear = o.optDoubleOrNull("spec_s_per_year"),
    toleranceS = o.optDoubleOrNull("tolerance_s"),
    extras = o.toMap().filterKeys { it !in WATCH_KNOWN }
)

fun readingFromJson(o: JSONObject): Reading {
    val resid = o.optJSONArray("tapResidMs")?.let { arr ->
        (0 until arr.length()).map { arr.getInt(it) }
    }
    return Reading(
        id = o.optString("id"),
        watchId = o.optString("watchId"),
        ts = o.optDouble("ts", 0.0),
        ntpSeconds = o.optInt("ntpSeconds", 0),
        minuteAdjust = o.optInt("minuteAdjust", 0),
        adjMode = o.optString("adjMode", "raw"),
        rawOffsetSec = o.optDouble("rawOffsetSec", 0.0),
        totalOffsetSec = o.optDouble("totalOffsetSec", 0.0),
        method = o.optStringOrNull("method"),
        ntpServer = o.optStringOrNull("ntpServer"),
        ntpOffsetMs = o.optDoubleOrNull("ntpOffsetMs"),
        ntpDelayMs = o.optDoubleOrNull("ntpDelayMs"),
        postSync = o.optBoolean("postSync", false),
        rawResMs = o.optBoolean("rawResMs", false),
        readErrSec = o.optDoubleOrNull("readErrSec"),
        taps = o.optIntOrNull("taps"),
        tapJitterMs = o.optDoubleOrNull("tapJitterMs"),
        tapResidMs = resid,
        tapDriftMsPerTick = o.optDoubleOrNull("tapDriftMsPerTick"),
        tapSpanTicks = o.optIntOrNull("tapSpanTicks"),
        tapsTrimmed = o.optIntOrNull("tapsTrimmed"),
        tempC = o.optDoubleOrNull("tempC"),
        extras = o.toMap().filterKeys { it !in READING_KNOWN }
    )
}

fun profileFromJson(o: JSONObject): Profile {
    val n = o.optJSONArray("notes")
    return Profile(
        match = o.optString("match"),
        name = o.optStringOrNull("name"),
        movement = o.optStringOrNull("movement"),
        specSPerYear = o.optDoubleOrNull("spec_s_per_year"),
        toleranceS = o.optDoubleOrNull("tolerance_s"),
        battery = o.optStringOrNull("battery"),
        notes = if (n == null) emptyList() else (0 until n.length()).map { n.getString(it) }
    )
}

fun parseProfiles(text: String): List<Profile> = runCatching {
    val arr = JSONObject(text).optJSONArray("profiles") ?: return emptyList()
    (0 until arr.length()).map { profileFromJson(arr.getJSONObject(it)) }
}.getOrElse { emptyList() }

// ── Serialising ───────────────────────────────────────────────────────────────

fun AppData.toJson(): JSONObject = JSONObject().apply {
    put("watches", JSONArray().apply { watches.forEach { put(it.toJson()) } })
    put("readings", JSONArray().apply { readings.forEach { put(it.toJson()) } })
    if (settings.isNotEmpty()) put("settings", JSONObject(settings))
}

fun Watch.toJson(): JSONObject = JSONObject().apply {
    extras.forEach { (k, v) -> put(k, v) }
    put("id", id)
    put("name", name)
    specSPerYear?.let { put("spec_s_per_year", it) }
    toleranceS?.let { put("tolerance_s", it) }
}

fun Reading.toJson(): JSONObject = JSONObject().apply {
    extras.forEach { (k, v) -> put(k, v) }
    put("id", id)
    put("watchId", watchId)
    put("ts", ts)
    put("ntpSeconds", ntpSeconds)
    put("minuteAdjust", minuteAdjust)
    put("adjMode", adjMode)
    put("rawOffsetSec", rawOffsetSec)
    if (rawResMs) put("rawResMs", true)
    put("totalOffsetSec", totalOffsetSec)
    method?.let { put("method", it) }
    ntpServer?.let { put("ntpServer", it) }
    ntpOffsetMs?.let { put("ntpOffsetMs", it) }
    ntpDelayMs?.let { put("ntpDelayMs", it) }
    if (postSync) put("postSync", true)
    readErrSec?.let { put("readErrSec", it) }
    taps?.let { put("taps", it) }
    tapJitterMs?.let { put("tapJitterMs", it) }
    tapResidMs?.let { r -> put("tapResidMs", JSONArray().apply { r.forEach { put(it) } }) }
    tapDriftMsPerTick?.let { put("tapDriftMsPerTick", it) }
    tapSpanTicks?.let { put("tapSpanTicks", it) }
    tapsTrimmed?.let { put("tapsTrimmed", it) }
    tempC?.let { put("tempC", it) }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// org.json returns 0 or "" for a missing key rather than null, which would turn
// an absent spec into a real 0 s/yr. These keep absence distinguishable.

fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (!has(key) || isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }

fun JSONObject.optIntOrNull(key: String): Int? =
    if (!has(key) || isNull(key)) null else optInt(key)

fun JSONObject.optStringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

fun JSONObject.toMap(): Map<String, Any?> =
    keys().asSequence().associateWith { k -> if (isNull(k)) null else get(k) }
