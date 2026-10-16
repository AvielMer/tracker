package com.watchdrift.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
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
import com.watchdrift.ui.theme.MonoSmall
import com.watchdrift.ui.theme.deviationColor
import kotlin.math.abs

/**
 * The reading log, newest first.
 *
 * The residual column is the useful one: it is the distance from the fitted
 * line, not the raw offset, so a mis-set minute or a bad tap run stands out
 * immediately even when the absolute number looks plausible.
 */
@Composable
fun LogScreen(vm: AppViewModel, onOpenDetail: (String) -> Unit) {
    val data by vm.data.collectAsStateWithLifecycle()
    val selectedId by vm.selectedWatchId.collectAsStateWithLifecycle()
    val watch = data.watchById(selectedId)

    if (watch == null) {
        Text("No watch selected.", Modifier.padding(16.dp))
        return
    }

    val rs = data.readingsFor(watch.id)
    val info = Stats.watchRateInfo(rs)

    // Residuals are computed per SEGMENT: a reading is only meaningfully
    // "off-trend" relative to the run it belongs to, not to a line drawn
    // across a reset.
    val residuals = HashMap<String, Double>()
    for (seg in info.segs) {
        val fit = Stats.lsqFit(seg) ?: continue
        for (r in seg) residuals[r.id] = r.totalOffsetSec - Stats.fitAt(fit, r.ts)
    }
    val segStartIds = info.segs.mapNotNull { it.firstOrNull()?.id }.toSet()

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(watch.name, color = Cyan, fontWeight = FontWeight.Bold)
            Text("${rs.size} readings · ${info.segs.size} segment(s)", color = DimGrey)
        }
        HorizontalDivider()

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("DATE/TIME", color = DimGrey, style = MonoSmall)
            Text("TOTAL", Modifier.weight(1f), color = DimGrey, style = MonoSmall)
            Text("M", color = DimGrey, style = MonoSmall)
            Text("resid", color = DimGrey, style = MonoSmall)
        }
        HorizontalDivider()

        LazyColumn(Modifier.weight(1f)) {
            items(rs.reversed(), key = { it.id }) { r ->
                LogRow(
                    r = r,
                    residual = residuals[r.id],
                    isSegStart = r.id in segStartIds,
                    onClick = { onOpenDetail(r.id) }
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
            }
            if (rs.isEmpty()) {
                item { Text("No readings yet.", Modifier.padding(16.dp), color = DimGrey) }
            }
        }
    }
}

@Composable
private fun LogRow(
    r: Reading,
    residual: Double?,
    isSegStart: Boolean,
    onClick: () -> Unit
) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(Format.ts(r.ts), style = MonoSmall, color = DimGrey)
        Text(
            Format.deviationShort(r.totalOffsetSec),
            Modifier.weight(1f),
            style = MonoSmall,
            color = deviationColor(r.totalOffsetSec),
            fontWeight = FontWeight.Bold
        )
        Text(Format.method(r), style = MonoSmall, color = DimGrey)
        Text(
            residual?.let { String.format(java.util.Locale.US, "%+.2f", it) } ?: "  ·",
            style = MonoSmall,
            // A residual beyond half a second is worth a second look; beyond
            // that the fit is being pulled by a reading rather than describing
            // it.
            color = if (residual != null && abs(residual) > 0.5) Amber else DimGrey
        )
        if (r.postSync) Text("⚡", style = MonoSmall, color = Amber)
        if (isSegStart && !r.postSync) Text("┌", style = MonoSmall, color = DimGrey)
    }
}
