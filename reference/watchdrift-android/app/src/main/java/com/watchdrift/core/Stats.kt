package com.watchdrift.core

import com.watchdrift.data.Reading
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Port of the statistics engine from watch_drift.py.
 *
 * This file is deliberately a line-for-line translation, not a redesign. The
 * constants and the branch structure were arrived at empirically against real
 * readings, and StatsTest.kt asserts this code reproduces the Python output on
 * the actual data file to 1e-6. Change the maths here and that test fails —
 * which is the point.
 */
object Stats {

    /**
     * Legacy whole-second rows: truncation noise, not ±1s.
     *
     * A press recorded as a whole second is the true value truncated, so the
     * error is uniform on [0,1): mean 0.5s, rms about that mean 1/sqrt(12) =
     * 0.29s. The 0.5s mean shift is CONSTANT within a segment, so it cancels
     * in the slope and biases no rate. Only the 0.29s scatter is real noise.
     * Measured against 13 legacy Citizen readings the residual rms was 0.37s,
     * so the user's own timing added almost nothing on top of truncation.
     * Using 1.0 here would triple every legacy error bar for no reason.
     */
    const val READ_ERR = 0.3

    /** Spread of a single hand-eye press, seconds. */
    const val PRESS_ERR = 0.25

    /**
     * Typical reading error for a set of readings, in seconds.
     *
     * A tap-averaged reading is 10-50x better than an eyeball read; using the
     * flat fallback for those would inflate every error bar and hide real
     * scatter. Uses the WORST reading present, since the fit is limited by its
     * noisiest input.
     */
    fun readErr(rs: List<Reading>): Double {
        if (rs.isEmpty()) return READ_ERR
        return rs.maxOf { it.readErrSec ?: READ_ERR }
    }

    /** slope in s/day, intercept, and the 1-sigma uncertainty on the slope. */
    data class Fit(val slope: Double, val intercept: Double, val slopeStderr: Double)

    /**
     * Least-squares linear fit over chronological readings, for
     * y = slope*(ts/86400) + intercept.
     *
     * Returns null for fewer than 2 points or a zero time span. With only 2
     * points the fit has no spare degrees of freedom, so scatter cannot be
     * estimated from the data and READ_ERR is used as the noise floor instead.
     * Two rates differing by less than the sum of their errors are not
     * distinguishable.
     */
    fun lsqFit(rs: List<Reading>): Fit? {
        val n = rs.size
        if (n < 2) return null
        val xs = rs.map { it.ts / 86400.0 }
        val ys = rs.map { it.totalOffsetSec }
        val mx = xs.sum() / n
        val my = ys.sum() / n
        val sxx = xs.sumOf { (it - mx) * (it - mx) }
        if (sxx < 1e-9) return null
        val slope = xs.indices.sumOf { (xs[it] - mx) * (ys[it] - my) } / sxx
        val icept = my - slope * mx
        val sigma: Double = if (n > 2) {
            val res = xs.indices.map { ys[it] - (slope * xs[it] + icept) }
            val s2 = res.sumOf { it * it } / (n - 2)   // unbiased: 2 dof used
            max(sqrt(s2), readErr(rs))                 // never below read noise
        } else {
            readErr(rs)
        }
        return Fit(slope, icept, sigma / sqrt(sxx))
    }

    fun fitAt(fit: Fit, ts: Double): Double = fit.slope * (ts / 86400.0) + fit.intercept

    /**
     * Split chronological readings into segments at discontinuities
     * (resets / radio syncs / shocks).
     *
     * ADJ rows do NOT break segments — totalOffsetSec is continuous through a
     * minute correction. Break rule: a reading deviating from the segment
     * prediction by more than 5s + 0.1s per day of gap (allowance for
     * rate-estimate error).
     */
    fun segmentReadings(rs: List<Reading>): List<List<Reading>> {
        val segs = mutableListOf<List<Reading>>()
        var cur = mutableListOf<Reading>()
        for (r in rs) {
            if (cur.isEmpty()) {
                cur = mutableListOf(r)
                continue
            }
            if (r.postSync) {
                // user-flagged: taken right after an atomic/radio sync —
                // always starts a fresh segment regardless of jump size
                segs.add(cur)
                cur = mutableListOf(r)
                continue
            }
            val gapDays = (r.ts - cur.last().ts) / 86400.0
            val fit = lsqFit(cur)
            if (fit == null) {
                // Only one point so far: no rate is known, so "expected" would
                // mean "assume zero drift". After a long gap a perfectly
                // healthy watch then looks like a discontinuity and the
                // segment is split in two, destroying the fit. Wait for a
                // baseline instead.
                cur.add(r)
                continue
            }
            val pred = fitAt(fit, r.ts)
            val thr = 5.0 + 0.1 * gapDays
            if (abs(r.totalOffsetSec - pred) > thr) {
                segs.add(cur)
                cur = mutableListOf(r)
            } else {
                cur.add(r)
            }
        }
        if (cur.isNotEmpty()) segs.add(cur)
        return segs
    }

    fun segSpanDays(seg: List<Reading>): Double =
        if (seg.isEmpty()) 0.0 else (seg.last().ts - seg.first().ts) / 86400.0

    /**
     * Days of data needed before a rate number is trustworthy: 2x reading
     * error must be smaller than accumulated drift. Sharper readings
     * (tap-averaged) need proportionally less time.
     */
    fun minWindowDays(rateEst: Double?, rs: List<Reading>? = null): Double {
        val err = if (rs != null) readErr(rs) else READ_ERR
        if (rateEst == null || abs(rateEst) < 1e-6) return 21.0
        return min(45.0, max(2.0, (2 * err) / abs(rateEst)))
    }

    /** Most recent earlier segment with a valid fit. */
    fun prevSegmentSlope(segs: List<List<Reading>>, beforeIdx: Int): Pair<Double, Double>? {
        for (s in segs.subList(0, beforeIdx).reversed()) {
            val f = lsqFit(s)
            if (f != null && segSpanDays(s) >= 2) return Pair(f.slope, segSpanDays(s))
        }
        return null
    }

    /** Span-weighted average of per-segment slopes (valid across resets). */
    fun lifetimeRate(segs: List<List<Reading>>): Double? {
        var num = 0.0
        var den = 0.0
        for (s in segs) {
            val f = lsqFit(s)
            val d = segSpanDays(s)
            if (f != null && d >= 2) {
                num += f.slope * d
                den += d
            }
        }
        return if (den > 0) num / den else null
    }

    data class RateInfo(
        val rate: Double?,
        val collecting: Boolean,
        val needDays: Double?,
        val source: String,
        val seg: List<Reading>,
        val segs: List<List<Reading>>,
        val life: Double?
    )

    /** Describes the current segment's rate situation. */
    fun watchRateInfo(readings: List<Reading>): RateInfo {
        val rs = readings.sortedBy { it.ts }
        if (rs.size < 2) {
            return RateInfo(
                rate = null, collecting = true, needDays = null, source = "none",
                seg = rs, segs = if (rs.isNotEmpty()) listOf(rs) else emptyList(),
                life = null
            )
        }
        val segs = segmentReadings(rs)
        val seg = segs.last()
        val fit = lsqFit(seg)
        val prevSlope = prevSegmentSlope(segs, segs.size - 1)?.first
        val life = lifetimeRate(segs)
        val est = fit?.slope ?: prevSlope ?: life
        val need = minWindowDays(est, seg)
        val span = segSpanDays(seg)
        if (fit != null && span >= need) {
            return RateInfo(fit.slope, false, need, "segment", seg, segs, life)
        }
        // young segment — fall back to previous segment / lifetime if available
        val fallback = prevSlope ?: life
        return RateInfo(
            rate = fallback,
            collecting = true,
            needDays = need,
            source = if (fallback != null) "previous" else "none",
            seg = seg, segs = segs, life = life
        )
    }

    /** Regression-based s/day of the current segment (or fallback), or null. */
    fun driftPerDay(readings: List<Reading>): Double? = watchRateInfo(readings).rate

    /**
     * Expected total offset at [atTs], using the current segment's fit; for a
     * young segment, extrapolate from its last point with the previous
     * segment's slope. Null if no usable history.
     */
    fun predictOffset(readings: List<Reading>, atTs: Double): Double? {
        val rs = readings.sortedBy { it.ts }
        if (rs.isEmpty()) return null
        val info = watchRateInfo(rs)
        val seg = info.seg
        val fit = lsqFit(seg)
        if (fit != null && segSpanDays(seg) >= 2) return fitAt(fit, atTs)
        val rate = info.rate ?: return null
        val last = if (seg.isNotEmpty()) seg.last() else rs.last()
        return last.totalOffsetSec + rate * ((atTs - last.ts) / 86400.0)
    }

    // ── Deviation ────────────────────────────────────────────────────────────
    //
    //  The user presses at the moment THEIR WATCH shows :00.
    //  NTP seconds S at that instant is the deviation:
    //    S = 0      -> 0   (exact)
    //    S = 1..30  -> +S  (watch is S seconds SLOW)
    //    S = 31..59 -> -(60-S)  (watch is that many seconds FAST)
    //  A whole-minute correction M is added on top: total = raw + M*60.

    fun rawDeviation(ntpSeconds: Int): Int {
        val s = ((ntpSeconds % 60) + 60) % 60
        return if (s <= 30) s else s - 60
    }

    fun totalDeviation(ntpSeconds: Int, minuteAdjust: Int): Int =
        rawDeviation(ntpSeconds) + minuteAdjust * 60

    /** Fractional deviation from a fractional second-of-minute. */
    fun rawDeviationFractional(secondOfMinute: Double): Double {
        var s = secondOfMinute % 60.0
        if (s < 0) s += 60.0
        return if (s <= 30.0) s else s - 60.0
    }

    const val SEC_PER_YEAR = 365.25 * 24 * 3600

    fun sPerDayToSPerYear(sPerDay: Double): Double = sPerDay * 365.25
}
