package com.watchdrift.core

import com.watchdrift.data.Reading
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/** Display formatting. Port of the fmt_* helpers in watch_drift.py. */
object Format {

    private val tsFormat = SimpleDateFormat("yy-MM-dd HH:mm", Locale.US)
    private val clockFormat = SimpleDateFormat("HH:mm:ss", Locale.US)

    fun ts(unixSec: Double): String = tsFormat.format(Date((unixSec * 1000).toLong()))

    fun clock(unixMs: Double): String = clockFormat.format(Date(unixMs.toLong()))

    fun signed1(v: Double): String = String.format(Locale.US, "%+.1f", v)

    /** "+1.2s SLOW" / "-0.3s FAST" / "0.00s EXACT". */
    fun deviation(sec: Double): String {
        if (abs(sec) < 0.005) return "0.00s"
        return String.format(Locale.US, "%+.1fs", sec)
    }

    /** Fixed-width for the log column; never widens past 7 chars. */
    fun deviationShort(sec: Double): String {
        if (abs(sec) < 0.05) return "  0.0s"
        return String.format(Locale.US, "%+.1fs", sec)
    }

    /** A slow watch reads a time BEHIND true time, so its offset is positive. */
    fun direction(sec: Double): String = when {
        abs(sec) < 0.005 -> "EXACT"
        sec > 0 -> "SLOW"
        else -> "FAST"
    }

    fun sPerYear(sPerDay: Double): String =
        String.format(Locale.US, "%+.1f s/yr", sPerDay * 365.25)

    fun rate(sPerDay: Double, unit: RateUnit = RateUnit.PER_YEAR): String = when (unit) {
        RateUnit.PER_YEAR -> String.format(Locale.US, "%+.1f s/yr", sPerDay * 365.25)
        RateUnit.PER_MONTH -> String.format(Locale.US, "%+.2f s/mo", sPerDay * 30.44)
        RateUnit.PER_DAY -> String.format(Locale.US, "%+.3f s/d", sPerDay)
    }

    enum class RateUnit { PER_YEAR, PER_MONTH, PER_DAY }

    /** Short tag for how a reading was taken: "T26", "P", "p!". */
    fun method(r: Reading): String = when {
        r.taps != null -> "T${r.taps}"
        r.method == "press" -> "P"
        else -> "p"
    }

    fun days(d: Double): String = when {
        d < 1 -> String.format(Locale.US, "%.1fd", d)
        d < 100 -> String.format(Locale.US, "%.0fd", d)
        else -> String.format(Locale.US, "%.0fd", d)
    }
}
