package com.watchdrift.core

import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Tap-averaged reading: the user taps on every tick, the LAST tap being the
 * watch's :00. Averaging many taps beats one press because random reaction
 * jitter falls as 1/sqrt(n) — and unlike a single press, a tap run reports its
 * own jitter, so a bad sample announces itself.
 *
 * Port of App.maybe_finalize_taps() / solve() from watch_drift.py.
 */
object TapSolver {

    /**
     * A real tick is 1s apart, so anything arriving within a fraction of a
     * second is not a tap: it is key auto-repeat, a held key, or a bounce.
     * Without this guard a held key produces dozens of entries ~50ms apart and
     * the tick-counting rounds each gap up to a full second — silently
     * destroying the timing model while still reporting a plausible tap count.
     */
    const val DEBOUNCE_MS = 450L

    /** Finalize this long after the last tap. */
    const val FINALIZE_AFTER_MS = 1800L

    const val MIN_TAPS = 3

    /** Above this the tick counting cannot be trusted at all. */
    const val MAX_JITTER_MS = 600.0

    data class Solution(
        /** Estimated instant, in ms, at which the watch showed :00. */
        val t0Ms: Double,
        val rmsMs: Double,
        val residMs: List<Double>,
        val tickIdx: List<Int>,
        val taps: List<Double>
    )

    sealed class Result {
        data class Ok(
            val t0Ms: Double,
            val rmsMs: Double,
            val nTaps: Int,
            val residMs: List<Double>,
            val tickIdx: List<Int>,
            val trimmed: Int,
            val driftMsPerTick: Double?,
            val spanTicks: Int?
        ) : Result()

        data class Rejected(val reason: String) : Result()
    }

    /**
     * Tick indices come from the GAPS between taps, not from tap order.
     * Assuming taps are consecutive seconds means one missed tick shifts every
     * earlier tap by a full second and wrecks the fit; here a 2s gap is simply
     * read as "two ticks passed".
     */
    fun solve(taps: List<Double>): Solution {
        val idx = mutableListOf(0)
        var acc = 0
        for (i in 0 until taps.size - 1) {
            // Math.rint, not roundToLong: Python's round() breaks exact .5
            // ties to even, Kotlin's rounds half up. A tap landing exactly
            // halfway between two ticks would then be counted as a different
            // number of ticks here than in the Python app, and tick counts are
            // load-bearing — one extra tick shifts the whole fit by a second.
            val ticks = Math.rint((taps[i + 1] - taps[i]) / 1000.0).toInt()
            acc += max1(ticks)
            idx.add(acc)
        }
        val last = idx.last()
        val t0 = taps.indices.sumOf { taps[it] + (last - idx[it]) * 1000.0 } / taps.size
        val res = taps.indices.map { taps[it] - (t0 - (last - idx[it]) * 1000.0) }
        val rms = sqrt(res.sumOf { it * it } / res.size)
        return Solution(t0, rms, res, idx, taps)
    }

    private fun max1(v: Int) = if (v < 1) 1 else v

    /**
     * Full finalize path: outlier trimming, sanity checks, and the per-tap
     * beat-drift slope.
     */
    fun finalize(rawTaps: List<Double>): Result {
        if (rawTaps.size < MIN_TAPS) {
            return Result.Rejected(
                "Only ${rawTaps.size} tap(s) — need at least $MIN_TAPS. Nothing recorded."
            )
        }

        var s = solve(rawTaps)
        var taps = s.taps

        // Trim outliers iteratively, not just one.
        //
        // A UI freeze delays when the tap is PROCESSED, which is when the
        // timestamp is taken — so a stalled phone produces a tap that is late
        // by the length of the stall. One freeze is common, two is not rare,
        // and a single-drop rule cannot handle two. Trim anything beyond 3x
        // the rms, re-fit, repeat — but never discard more than a fifth of the
        // taps, because past that the problem is the run itself, not a few bad
        // points.
        var trimmed = 0
        val maxTrim = max1(taps.size / 5)
        while (taps.size >= 4 && trimmed < maxTrim) {
            val worstI = s.residMs.indices.maxByOrNull { abs(s.residMs[it]) } ?: break
            if (abs(s.residMs[worstI]) <= 3 * s.rmsMs || s.rmsMs < 30) break
            val cand = taps.filterIndexed { i, _ -> i != worstI }
            val st = solve(cand)
            if (st.rmsMs >= s.rmsMs) break
            s = st
            taps = cand
            trimmed++
        }

        // A tick is 1s. More taps than seconds elapsed means the input was not
        // ticks at all — refuse rather than fit nonsense.
        val elapsedS = (taps.last() - taps.first()) / 1000.0
        if (taps.size > elapsedS + 2) {
            return Result.Rejected(
                "${taps.size} taps in ${elapsedS.roundToInt()}s — faster than the watch " +
                    "ticks. Nothing recorded (stuck key?)."
            )
        }

        if (s.rmsMs > MAX_JITTER_MS) {
            return Result.Rejected(
                "Taps too uneven (±${s.rmsMs.roundToInt()}ms) — tick counting unreliable. " +
                    "Nothing recorded, try again."
            )
        }

        // Per-tap deviation from the fitted beat. The rms alone hides the
        // shape: a steady drift through the run means the user was speeding up
        // or slowing down, which is a different thing from random scatter and
        // is correctable.
        var drift: Double? = null
        var spanTicks: Int? = null
        if (s.residMs.size >= 4) {
            val n = s.residMs.size
            val mi = s.tickIdx.sum().toDouble() / n
            val mr = s.residMs.sum() / n
            val sxx = s.tickIdx.sumOf { (it - mi) * (it - mi) }
            if (sxx > 0) {
                drift = round2(
                    s.residMs.indices.sumOf { (s.tickIdx[it] - mi) * (s.residMs[it] - mr) } / sxx
                )
            }
            spanTicks = s.tickIdx.last()
        }

        return Result.Ok(
            t0Ms = s.t0Ms,
            rmsMs = s.rmsMs,
            nTaps = taps.size,
            residMs = s.residMs,
            tickIdx = s.tickIdx,
            trimmed = trimmed,
            driftMsPerTick = drift,
            spanTicks = spanTicks
        )
    }

    /**
     * Precision contributed by the taps themselves: jitter/sqrt(n), floored at
     * 20ms. Below that the human is no longer the limiting term and claiming
     * better would be false precision.
     */
    fun tapErrSec(jitterMs: Double, nTaps: Int): Double =
        kotlin.math.max(jitterMs / 1000.0 / sqrt(nTaps.toDouble()), 0.02)

    private fun round2(v: Double) = Math.round(v * 100.0) / 100.0
}
