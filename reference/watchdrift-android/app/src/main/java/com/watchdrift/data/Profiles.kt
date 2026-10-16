package com.watchdrift.data

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Reference data for each watch: movement, spec, battery, notes.
 *
 * Read-only as far as the app is concerned — it is a file edited by hand, so
 * a copy in filesDir (user-editable, importable) wins over the one bundled in
 * assets. A malformed file must never stop the recorder, so any error just
 * yields no profiles.
 */
class Profiles(private val context: Context) {

    private var cache: List<Profile> = emptyList()
    private var cachedMtime: Long = -1

    private val overrideFile: File get() = File(context.filesDir, "watch_profiles.json")

    fun all(): List<Profile> {
        val mtime = if (overrideFile.exists()) overrideFile.lastModified() else 0L
        if (mtime == cachedMtime && cache.isNotEmpty()) return cache
        cache = runCatching {
            val text = if (overrideFile.exists()) overrideFile.readText()
            else context.assets.open("watch_profiles.json").bufferedReader().use { it.readText() }
            parseProfiles(text)
        }.getOrElse { emptyList() }
        cachedMtime = mtime
        return cache
    }

    /**
     * Profile matching this watch, or null.
     *
     * Case-insensitive but an exact string compare: "GWBX5600" does not match
     * "GW-BX5600". Deliberate — a fuzzy match would silently attach the wrong
     * watch's spec to a reading series.
     */
    fun forWatch(watch: Watch?): Profile? {
        if (watch == null) return null
        val name = watch.name.trim().lowercase()
        return all().firstOrNull { it.match.trim().lowercase() == name }
    }

    /** Spec in s/yr: the watch's own setting wins, else the profile's. */
    fun specSPerYear(watch: Watch?): Double? =
        watch?.specSPerYear ?: forWatch(watch)?.specSPerYear

    fun toleranceS(watch: Watch?): Double =
        watch?.toleranceS ?: forWatch(watch)?.toleranceS ?: 30.0

    /** Replace the bundled profiles with a hand-edited file. */
    fun saveOverride(text: String): Boolean = runCatching {
        JSONObject(text)                 // validate before replacing
        overrideFile.writeText(text)
        cachedMtime = -1
        true
    }.getOrElse { false }
}
