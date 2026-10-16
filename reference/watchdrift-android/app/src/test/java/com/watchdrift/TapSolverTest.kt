package com.watchdrift

import com.watchdrift.core.TapSolver
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the tap solver against the Python implementation.
 *
 * tapref.json holds eight tap sequences run through watch_drift.py's own
 * solve()/finalize() logic: a clean run, a jittered run, a missed tick, one
 * and two UI-freeze outliers, a sagging rhythm, a too-short run, and a stuck
 * key. The trimming thresholds in particular are easy to get subtly wrong on a
 * port, and a wrong threshold silently changes recorded readings rather than
 * throwing.
 */
class TapSolverTest {

    private val tol = 1e-6

    private val ref: JSONObject by lazy {
        JSONObject(
            javaClass.classLoader!!.getResourceAsStream("tapref.json")!!
                .bufferedReader().use { it.readText() }
        )
    }

    private fun taps(case: String): List<Double> {
        val arr = ref.getJSONObject(case).getJSONArray("taps")
        return (0 until arr.length()).map { arr.getDouble(it) }
    }

    private fun expected(case: String): JSONObject =
        ref.getJSONObject(case).getJSONObject("expected")

    private fun checkAccepted(case: String) {
        val exp = expected(case)
        assertTrue("$case should be accepted by python", !exp.has("rejected"))

        val result = TapSolver.finalize(taps(case))
        assertTrue(
            "$case: expected Ok, got $result",
            result is TapSolver.Result.Ok
        )
        result as TapSolver.Result.Ok

        assertEquals("$case: t0", exp.getDouble("t0"), result.t0Ms, 1e-6)
        assertEquals("$case: rms", exp.getDouble("rms"), result.rmsMs, 1e-6)
        assertEquals("$case: tap count", exp.getInt("n"), result.nTaps)
        assertEquals("$case: trimmed", exp.getInt("trimmed"), result.trimmed)

        if (exp.isNull("drift")) {
            assertNull("$case: drift", result.driftMsPerTick)
        } else {
            assertEquals("$case: drift", exp.getDouble("drift"), result.driftMsPerTick!!, 1e-9)
        }

        if (exp.isNull("span")) {
            assertNull("$case: span", result.spanTicks)
        } else {
            assertEquals("$case: span ticks", exp.getInt("span"), result.spanTicks)
        }

        // Tick indices are the part that breaks first on a port: they come
        // from gaps, not tap order, so a rounding difference shifts every
        // later index by one full second.
        val expIdx = exp.getJSONArray("idx")
        assertEquals("$case: index count", expIdx.length(), result.tickIdx.size)
        for (i in 0 until expIdx.length()) {
            assertEquals("$case: tick index $i", expIdx.getInt(i), result.tickIdx[i])
        }

        val expResid = exp.getJSONArray("resid")
        assertEquals("$case: residual count", expResid.length(), result.residMs.size)
        for (i in 0 until expResid.length()) {
            assertEquals(
                "$case: residual $i",
                expResid.getDouble(i), result.residMs[i], 1e-6
            )
        }
    }

    @Test fun `perfect one hertz run`() = checkAccepted("perfect")
    @Test fun `jittered run`() = checkAccepted("jittered")
    @Test fun `missed tick is read as two ticks elapsed`() = checkAccepted("missedTick")
    @Test fun `one ui freeze outlier`() = checkAccepted("oneOutlier")
    @Test fun `two ui freeze outliers`() = checkAccepted("twoOutliers")
    @Test fun `sagging rhythm shows as beat drift`() = checkAccepted("beatDrift")

    @Test
    fun `too few taps is refused`() {
        val r = TapSolver.finalize(taps("tooFew"))
        assertTrue(r is TapSolver.Result.Rejected)
        assertTrue((r as TapSolver.Result.Rejected).reason.contains("need at least"))
    }

    @Test
    fun `a stuck key is refused rather than fitted`() {
        // 20 taps in 1 second is not a watch ticking. Fitting it would produce
        // a plausible-looking reading from nonsense.
        val r = TapSolver.finalize(taps("stuckKey"))
        assertTrue("expected rejection, got $r", r is TapSolver.Result.Rejected)
        assertTrue((r as TapSolver.Result.Rejected).reason.contains("faster than"))
    }

    @Test
    fun `beat drift recovers the injected slope`() {
        // beatDrift was built with exactly -5 ms per tick of sag.
        val r = TapSolver.finalize(taps("beatDrift")) as TapSolver.Result.Ok
        assertEquals(-5.0, r.driftMsPerTick!!, 1e-9)
    }

    @Test
    fun `tap error floors at twenty milliseconds`() {
        // Below ~20ms the human is no longer the limiting term — NTP half-rtt
        // is. Claiming better would be false precision.
        assertEquals(0.02, TapSolver.tapErrSec(1.0, 100), tol)
        assertEquals(0.05, TapSolver.tapErrSec(500.0, 100), tol)
    }

    @Test
    fun `more taps improve precision as one over root n`() {
        val four = TapSolver.tapErrSec(400.0, 4)
        val sixteen = TapSolver.tapErrSec(400.0, 16)
        assertEquals(2.0, four / sixteen, 1e-9)
    }
}
