package com.watchdrift.core

import com.watchdrift.data.Reading
import com.watchdrift.ntp.NtpRepository
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Builds a Reading from a captured instant. Shared by press and tap modes.
 *
 * Port of App._record_reading() from watch_drift.py.
 */
object Recorder {

    data class Outcome(
        val reading: Reading?,
        val message: String,
        val offTrendWarning: String? = null
    )

    /**
     * @param t0Ms the instant, in true (NTP-corrected) ms, at which the watch
     *   showed :00
     * @param manualMinuteAdjust user-set whole-minute correction; 0 means let
     *   the app infer it from the trend
     * @param postSync the watch was just reset/synced, so this reading is a
     *   new baseline and starts a new segment
     */
    fun build(
        watchId: String,
        t0Ms: Double,
        snap: NtpRepository.Snapshot,
        history: List<Reading>,
        manualMinuteAdjust: Int,
        postSync: Boolean,
        tap: TapSolver.Result.Ok? = null,
        tempC: Double? = null
    ): Outcome {
        val (ok, why) = snap.okToRecord()
        if (!ok) return Outcome(null, "✖ $why")

        val tSec = t0Ms / 1000.0

        // Keep the true fractional second for BOTH methods.
        //
        // Truncating a press to a whole second is biased by SIGN, not merely
        // coarse: a slow watch at +0.18s truncates to 0.00 (toward zero) while
        // a fast watch at -0.2s (NTP :59.8) truncates to -1.0 (away from
        // zero). That is up to ~1s of error in opposite directions depending
        // on which way the watch runs — it would bend a fit, not just blur it.
        // The real uncertainty of a press belongs in readErrSec, where the
        // regression can weigh it, not in a thrown-away fraction.
        val s = (t0Ms / 1000.0).mod(60.0)
        val raw = if (s <= 30.0) s else s - 60.0

        val pred = Stats.predictOffset(history, tSec)

        val adj: Int
        val mode: String
        when {
            postSync -> {
                adj = manualMinuteAdjust; mode = "sync"
            }
            manualMinuteAdjust != 0 || pred == null -> {
                adj = manualMinuteAdjust
                mode = if (manualMinuteAdjust != 0) "manual" else "raw"
            }
            else -> {
                // Math.rint to match Python's round(): half-to-even. A
                // prediction landing exactly on a half-minute boundary must
                // pick the same minute here as in the Termux app, or the same
                // press yields readings 60s apart on the two.
                adj = Math.rint((pred - raw) / 60.0).toInt(); mode = "auto"
            }
        }

        // 3 dp, not 1. Rounding to 0.1s quantises every reading to 100ms,
        // which is COARSER than the measurement itself: a tap reading resolves
        // to ~20ms and a practised press to ~50ms. Rounding to a tenth threw
        // away the better half of the information and put a 100ms staircase
        // into the data the regression fits. Display still shows 0.1s; only
        // the stored value keeps the resolution.
        val total = round3(raw + adj * 60.0)

        val warn = if (!postSync && pred != null && abs(total - pred) > 10) {
            "off-trend (expected ${Format.deviation(pred)}) — retake?"
        } else null

        // NTP contributes its own uncertainty. Roughly half the round-trip
        // delay bounds the asymmetry error, and a VPN can make that large — no
        // amount of careful tapping beats a 300ms network bias, so it has to
        // go into the error budget too.
        val ntpErr = snap.delayMs?.let { it / 2000.0 } ?: 0.05

        val readErr: Double
        if (tap != null) {
            val tapErr = TapSolver.tapErrSec(tap.rmsMs, tap.nTaps)
            readErr = round3(sqrt(tapErr * tapErr + ntpErr * ntpErr))
        } else {
            // A single press carries the full spread of hand-eye reaction:
            // roughly 0.25s, and unlike tap-averaging nothing cancels it.
            readErr = round3(sqrt(Stats.PRESS_ERR * Stats.PRESS_ERR + ntpErr * ntpErr))
        }

        val reading = Reading(
            id = t0Ms.toLong().toString(),
            watchId = watchId,
            ts = tSec,
            ntpSeconds = (Math.rint(s).toInt()) % 60,
            minuteAdjust = adj,
            adjMode = mode,
            rawOffsetSec = round3(raw),
            rawResMs = true,
            totalOffsetSec = total,
            method = if (tap != null) "tap" else "press",
            ntpServer = snap.server,
            ntpOffsetMs = round1(snap.offsetMs),
            ntpDelayMs = snap.delayMs?.let { round1(it) },
            postSync = postSync,
            readErrSec = readErr,
            taps = tap?.nTaps,
            tapJitterMs = tap?.let { round1(it.rmsMs) },
            tapResidMs = tap?.residMs?.map { Math.rint(it).toInt() },
            tapDriftMsPerTick = tap?.driftMsPerTick,
            tapSpanTicks = tap?.spanTicks,
            tapsTrimmed = tap?.trimmed?.takeIf { it > 0 },
            tempC = tempC
        )

        val prec = if (tap != null) {
            val d = tap.driftMsPerTick?.let { " drift ${Format.signed1(it)}ms/tick" } ?: ""
            val t = if (tap.trimmed > 0) " (${tap.trimmed} outlier dropped)" else ""
            "  [${tap.nTaps} taps ±${tap.rmsMs.roundToInt()}ms$d$t]"
        } else ""

        val msg = buildString {
            if (postSync) append("SYNC ")
            append("Recorded raw=${Format.deviation(raw)} ")
            append("adj=${if (adj >= 0) "+$adj" else "$adj"}m($mode) ")
            append("total=${Format.deviation(total)} (${Format.direction(total)})")
            append(prec)
        }

        return Outcome(reading, msg, warn)
    }

    /**
     * When a new postSync reading is recorded, delete immediately preceding
     * readings of the same watch that are ALSO postSync — only the freshest
     * sync baseline is kept. Stops at the first non-sync reading, so real
     * drift data is never touched.
     */
    fun pruneStaleSyncs(all: List<Reading>, watchId: String): Pair<List<Reading>, Int> {
        val rs = all.filter { it.watchId == watchId }.sortedBy { it.ts }
        if (rs.size < 2) return all to 0
        val drop = mutableSetOf<String>()
        for (r in rs.dropLast(1).reversed()) {
            if (r.postSync) drop.add(r.id) else break
        }
        if (drop.isEmpty()) return all to 0
        return all.filter { it.id !in drop } to drop.size
    }

    private fun round1(v: Double) = Math.round(v * 10.0) / 10.0
    private fun round3(v: Double) = Math.round(v * 1000.0) / 1000.0
}
