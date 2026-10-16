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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
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
import com.watchdrift.ui.theme.ExactGreen
import com.watchdrift.ui.theme.SlowRed
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Rate and residuals for the current segment.
 *
 * The headline number carries its error bar, because a rate without one is not
 * a measurement. Precision here comes from elapsed SPAN, not from the number
 * of readings: doubling the span halves the error bar, while doubling the
 * readings only improves it by √2.
 */
@Composable
fun TrendScreen(vm: AppViewModel) {
    val data by vm.data.collectAsStateWithLifecycle()
    val selectedId by vm.selectedWatchId.collectAsStateWithLifecycle()
    val watch = data.watchById(selectedId)

    if (watch == null) {
        Text("No watch selected.", Modifier.padding(16.dp))
        return
    }

    val rs = data.readingsFor(watch.id)
    val info = Stats.watchRateInfo(rs)
    val fit = Stats.lsqFit(info.seg)
    val spec = vm.specSPerYear(watch)

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("Trend — ${watch.name}", color = Cyan,
            style = MaterialTheme.typography.titleMedium)

        if (rs.size < 2) {
            Text("Collecting — at least 2 readings are needed for a rate.", color = DimGrey)
            return@Column
        }

        val rate = info.rate
        if (rate != null) {
            val syr = rate * 365.25
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    Format.rate(rate),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = if (spec != null && abs(syr) > abs(spec)) SlowRed else Amber
                )
                fit?.let {
                    Text(
                        "± ${String.format(java.util.Locale.US, "%.2f", it.slopeStderr * 365.25)}",
                        color = DimGrey,
                        modifier = Modifier.padding(top = 6.dp)
                    )
                }
            }
            Text(Format.rate(rate, Format.RateUnit.PER_MONTH) + "   " +
                Format.rate(rate, Format.RateUnit.PER_DAY), color = DimGrey)
        }

        HorizontalDivider()

        val span = Stats.segSpanDays(info.seg)
        Kv2("segment", "${info.seg.size} readings over ${Format.days(span)}")
        Kv2("segments", "${info.segs.size} (split at resets/syncs)")
        info.life?.let { Kv2("lifetime", Format.rate(it) + "  (span-weighted)") }
        if (info.collecting) {
            Kv2(
                "status",
                "still collecting — needs about ${info.needDays?.toInt() ?: 0}d; " +
                    "showing ${if (info.source == "previous") "previous segment's" else "no"} rate"
            )
        }
        spec?.let { Kv2("spec", "±${it.toInt()} s/yr") }

        // What another month would buy. Precision scales as 1/span, so this is
        // the honest answer to "should I take more readings or just wait".
        fit?.let { f ->
            val projected = f.slopeStderr * 365.25 * (span / (span + 30.0))
            Kv2(
                "in 30 more days",
                "error bar about ±${String.format(java.util.Locale.US, "%.2f", projected)} s/yr"
            )
        }

        HorizontalDivider()
        Text("residuals — distance from the fitted line",
            style = MaterialTheme.typography.bodySmall, color = DimGrey)
        ResidualPlot(info.seg, fit, Modifier.fillMaxWidth().height(200.dp))

        fit?.let { f ->
            val res = info.seg.map { it.totalOffsetSec - Stats.fitAt(f, it.ts) }
            val rms = sqrt(res.sumOf { it * it } / max(res.size, 1))
            Text(
                "residual rms ${String.format(java.util.Locale.US, "%.3f", rms)}s — " +
                    "this is how well the watch follows a straight line, and it " +
                    "sets the error bar above.",
                style = MaterialTheme.typography.bodySmall, color = DimGrey
            )
        }
    }
}

@Composable
private fun Kv2(k: String, v: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(k, Modifier.weight(0.35f), color = DimGrey,
            style = MaterialTheme.typography.bodySmall)
        Text(v, Modifier.weight(0.65f), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ResidualPlot(seg: List<Reading>, fit: Stats.Fit?, modifier: Modifier = Modifier) {
    if (seg.size < 2 || fit == null) {
        Text("not enough data to plot", color = DimGrey)
        return
    }
    val res = seg.map { it.totalOffsetSec - Stats.fitAt(fit, it.ts) }
    val peak = max(res.maxOfOrNull { abs(it) } ?: 1.0, 1e-3)
    val t0 = seg.first().ts
    val tSpan = max(seg.last().ts - t0, 1.0)
    val axis = DimGrey.copy(alpha = 0.4f)

    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val mid = h / 2f
        drawLine(axis, Offset(0f, mid), Offset(w, mid), strokeWidth = 1f)
        // x is TIME-scaled, not index-scaled: readings are not evenly spaced,
        // and an index axis hides clustering that changes how much leverage
        // each reading has on the slope.
        seg.forEachIndexed { i, r ->
            val x = ((r.ts - t0) / tSpan).toFloat() * w
            val y = mid - (res[i] / peak).toFloat() * (mid * 0.9f)
            drawCircle(
                if (r.taps != null) ExactGreen else Amber,
                radius = if (r.taps != null) 4f else 3f,
                center = Offset(x, y)
            )
        }
    }
    Text(
        "±${String.format(java.util.Locale.US, "%.2f", peak)}s full scale · " +
            "green = tap-averaged, amber = press · x is real elapsed time",
        style = MaterialTheme.typography.bodySmall, color = DimGrey
    )
}
