package com.watchdrift.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchdrift.core.Format
import com.watchdrift.core.Stats
import com.watchdrift.data.Reading
import com.watchdrift.ui.AppViewModel
import com.watchdrift.ui.theme.Amber
import com.watchdrift.ui.theme.Cyan
import com.watchdrift.ui.theme.DimGrey
import com.watchdrift.ui.theme.SlowRed
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Everything known about one reading, including the conditions it was taken
 * under.
 *
 * The conditions matter as much as the number: a suspicious residual can be
 * checked against how it was measured instead of guessed at. A large
 * round-trip delay or a different NTP server is a measurement problem, not the
 * watch.
 */
@Composable
fun DetailScreen(vm: AppViewModel, readingId: String, onBack: () -> Unit) {
    val data by vm.data.collectAsStateWithLifecycle()
    val r = data.readings.firstOrNull { it.id == readingId }
    var confirmDelete by remember { mutableStateOf(false) }

    if (r == null) {
        Column(Modifier.padding(16.dp)) {
            Text("Reading not found.")
            OutlinedButton(onClick = onBack) { Text("Back") }
        }
        return
    }

    val watch = data.watchById(r.watchId)

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("Reading detail — ${watch?.name ?: "?"}", color = Cyan,
            style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(Format.ts(r.ts), color = DimGrey)
            Text(
                "${Format.deviation(r.totalOffsetSec)} ${Format.direction(r.totalOffsetSec)}",
                color = Amber, fontWeight = FontWeight.Bold
            )
        }

        HorizontalDivider()

        Kv("method", if (r.taps != null) "tap-averaged" else "single press")
        Kv(
            "NTP second",
            ":${r.ntpSeconds}s   raw ${fmt3(r.rawOffsetSec)}s   " +
                "adj ${if (r.minuteAdjust >= 0) "+" else ""}${r.minuteAdjust}m (${r.adjMode})"
        )
        r.readErrSec?.let { Kv("read error", "±${fmt3(it)}s") }
        Kv(
            "NTP server",
            "${r.ntpServer ?: "—"}   offset ${r.ntpOffsetMs ?: "—"}ms   " +
                "rtt ${r.ntpDelayMs ?: "—"}ms"
        )
        r.tempC?.let { Kv("temperature", "${it}°C") }

        if (r.postSync) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text("⚡ post-sync — starts a new segment", color = Amber)
                    SetAccuracyLine(r)
                }
            }
        }

        // ── Tap statistics ───────────────────────────────────────────────────
        if (r.taps != null) {
            HorizontalDivider()
            Kv("taps", "${r.taps} over ${r.tapSpanTicks ?: "?"} ticks")
            Kv(
                "your jitter",
                "±${r.tapJitterMs ?: "?"}ms rms" +
                    (r.tapResidMs?.maxOfOrNull { abs(it) }?.let { "   worst ${it}ms" } ?: "")
            )
            r.tapDriftMsPerTick?.let { d ->
                // Beat drift is the rhythm creeping, not random scatter — the
                // user speeding up or slowing down through the run. It is
                // flagged separately because it is systematic and therefore
                // correctable, unlike jitter.
                val steady = isSteady(d, r)
                Kv(
                    "beat drift",
                    "${Format.signed1(d)} ms/tick   " +
                        if (steady) "(steady)" else
                            if (d < 0) "(slowing down)" else "(speeding up)",
                    color = if (steady) null else Amber
                )
            }
            r.tapsTrimmed?.let { Kv("outliers dropped", "$it") }

            val effect = r.tapJitterMs?.let { it / sqrt(r.taps.toDouble()) }
            effect?.let {
                Kv(
                    "effect on :00",
                    "±${it.roundToInt()}ms  (jitter/√n — one bad tap barely moves it)"
                )
            }

            r.tapResidMs?.let { resid ->
                Text("per-tap deviation from the fitted beat",
                    style = MaterialTheme.typography.bodySmall, color = DimGrey)
                TapResidualPlot(resid, Modifier.fillMaxWidth().height(160.dp))
            }
        }

        HorizontalDivider()

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.adjustReading(r.id, -1) }) { Text("−1 min") }
            OutlinedButton(onClick = { vm.adjustReading(r.id, 1) }) { Text("+1 min") }
        }
        Text(
            "Use these if the app guessed the wrong minute — a reading that jumps " +
                "by about 60s against the trend.",
            style = MaterialTheme.typography.bodySmall, color = DimGrey
        )

        OutlinedButton(onClick = { vm.toggleReadingPostSync(r.id) }) {
            Text(if (r.postSync) "Remove post-sync flag" else "Flag as post-sync")
        }
        Text(
            "Post-sync splits the fit here. Only set it if the watch itself was " +
                "reset or synced at this reading.",
            style = MaterialTheme.typography.bodySmall, color = DimGrey
        )

        OutlinedButton(onClick = { confirmDelete = true }) {
            Text("Delete reading", color = SlowRed)
        }

        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back") }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this reading?") },
            text = {
                Text(
                    "It is a timestamped measurement and cannot be re-taken. " +
                        "Deleting shortens the segment span, which widens the error bar " +
                        "on the rate."
                )
            },
            confirmButton = {
                TextButton(onClick = { vm.deleteReading(r.id); confirmDelete = false; onBack() }) {
                    Text("Delete", color = SlowRed)
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep") } }
        )
    }
}

/**
 * How close the watch was set to :00.
 *
 * Only meaningful on a post-sync reading: only then is the watch known to be
 * at zero, so the sub-second part is the user's setting error rather than the
 * watch's accumulated offset.
 */
@Composable
private fun SetAccuracyLine(r: Reading) {
    if (!r.rawResMs) {
        Text(
            "set-to-:00 accuracy not recoverable — this reading was stored at 0.1s",
            style = MaterialTheme.typography.bodySmall, color = DimGrey
        )
        return
    }
    val ms = (abs(r.rawOffsetSec) * 1000).roundToInt()
    Text("set to within ${ms}ms of :00", style = MaterialTheme.typography.bodySmall)
}

/** Is the beat drift within noise, given the jitter and the number of taps? */
private fun isSteady(driftMsPerTick: Double, r: Reading): Boolean {
    val n = r.taps ?: return true
    val jitter = r.tapJitterMs ?: return true
    val span = (r.tapSpanTicks ?: n).toDouble()
    if (n < 4 || span <= 0) return true
    // Standard error on a slope fitted to n points spread over `span` ticks.
    val se = jitter * sqrt(12.0) / (span * sqrt(n.toDouble()))
    return abs(driftMsPerTick) < 2 * se
}

@Composable
private fun Kv(k: String, v: String, color: Color? = null) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(k, Modifier.weight(0.38f), color = color ?: DimGrey,
            style = MaterialTheme.typography.bodySmall)
        Text(v, Modifier.weight(0.62f), color = color ?: MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.bodySmall)
    }
}

/** Scatter of per-tap residuals, in tap order. Shape matters, not just rms. */
@Composable
private fun TapResidualPlot(resid: List<Int>, modifier: Modifier = Modifier) {
    val peak = max(resid.maxOfOrNull { abs(it) } ?: 1, 1)
    val axis = DimGrey.copy(alpha = 0.4f)
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val mid = h / 2f
        drawLine(axis, Offset(0f, mid), Offset(w, mid), strokeWidth = 1f)
        if (resid.size < 2) return@Canvas
        val dx = w / (resid.size - 1).toFloat()
        resid.forEachIndexed { i, v ->
            val x = i * dx
            val y = mid - (v.toFloat() / peak) * (mid * 0.9f)
            drawCircle(Amber, radius = 3f, center = Offset(x, y))
        }
    }
    Text(
        "±${peak}ms full scale · left = first tap",
        style = MaterialTheme.typography.bodySmall,
        color = DimGrey
    )
}

private fun fmt3(v: Double) = String.format(java.util.Locale.US, "%.3f", v)
