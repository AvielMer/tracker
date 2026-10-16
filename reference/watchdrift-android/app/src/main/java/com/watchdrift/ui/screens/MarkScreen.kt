package com.watchdrift.ui.screens

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.changedToDownIgnoreConsumed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchdrift.core.Format
import com.watchdrift.core.Stats
import com.watchdrift.ui.AppViewModel
import com.watchdrift.ui.theme.Amber
import com.watchdrift.ui.theme.Cyan
import com.watchdrift.ui.theme.DimGrey
import kotlinx.coroutines.delay

/**
 * The recording screen.
 *
 * Tap mode is the primary action and the pad is deliberately large: the whole
 * method rests on tapping a steady rhythm, and hunting for a small button adds
 * jitter to every tap. A single press is kept as a secondary action because it
 * is still the fastest way to take a rough reading — its ±0.25s error is five
 * to ten times worse than a tap run, which the app records honestly rather
 * than hiding.
 */
@Composable
fun MarkScreen(vm: AppViewModel) {
    val data by vm.data.collectAsStateWithLifecycle()
    val selectedId by vm.selectedWatchId.collectAsStateWithLifecycle()
    val tap by vm.tap.collectAsStateWithLifecycle()
    val snap by vm.ntp.state.collectAsStateWithLifecycle()
    val minuteAdjust by vm.minuteAdjust.collectAsStateWithLifecycle()
    val syncArm by vm.syncArm.collectAsStateWithLifecycle()

    val watch = data.watchById(selectedId)

    // Live clock. Driven off the NTP snapshot's monotonic anchor, so it shows
    // true time rather than the phone's possibly-wrong wall clock.
    var nowMs by remember { mutableLongStateOf(0L) }
    LaunchedEffect(snap) {
        while (true) {
            nowMs = snap.nowMs().toLong()
            delay(50)
        }
    }

    Column(
        Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (watch == null) {
            Text("No watch selected — add one on the Watches tab.")
            return@Column
        }

        Text(watch.name, style = MaterialTheme.typography.titleLarge, color = Cyan)

        Text(
            Format.clock(nowMs.toDouble()),
            fontSize = 44.sp,
            fontWeight = FontWeight.Bold,
            color = Amber,
            modifier = Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center
        )

        val (canRecord, why) = snap.okToRecord()
        if (!canRecord) {
            Card(Modifier.fillMaxWidth()) {
                Text(
                    "⚠ $why",
                    Modifier.padding(12.dp),
                    color = MaterialTheme.colorScheme.error
                )
            }
        }

        // ── Flags ────────────────────────────────────────────────────────────
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = syncArm,
                onClick = { vm.toggleSyncArm() },
                label = { Text("Post-sync") }
            )
            OutlinedButton(onClick = { vm.bumpMinuteAdjust(-1) }) { Text("−1m") }
            Text(
                "${if (minuteAdjust >= 0) "+" else ""}${minuteAdjust}m",
                Modifier.align(Alignment.CenterVertically),
                color = if (minuteAdjust != 0) Amber else DimGrey
            )
            OutlinedButton(onClick = { vm.bumpMinuteAdjust(1) }) { Text("+1m") }
        }

        if (syncArm) {
            Text(
                "This reading starts a NEW segment. Only flag it if the watch " +
                    "itself was reset or synced.",
                style = MaterialTheme.typography.bodySmall,
                color = Amber
            )
        }

        Spacer(Modifier.height(4.dp))

        // ── Tap pad ──────────────────────────────────────────────────────────
        Box(
            Modifier
                .fillMaxWidth()
                .height(220.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(
                    if (tap.active) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)
                    else MaterialTheme.colorScheme.surfaceVariant
                )
                .border(
                    2.dp,
                    if (tap.active) Amber else MaterialTheme.colorScheme.outlineVariant,
                    RoundedCornerShape(16.dp)
                )
                .tapPad(enabled = tap.active && canRecord) { vm.onTap(it) },
            contentAlignment = Alignment.Center
        ) {
            if (tap.active) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("${tap.taps.size}", fontSize = 64.sp, fontWeight = FontWeight.Bold)
                    Text("taps — LAST tap at :00", color = DimGrey)
                    if (tap.rejected > 0) {
                        Text(
                            "${tap.rejected} bounce ignored",
                            style = MaterialTheme.typography.bodySmall,
                            color = DimGrey
                        )
                    }
                    Text(
                        "finishes ${TAP_HINT}s after your last tap",
                        style = MaterialTheme.typography.bodySmall,
                        color = DimGrey
                    )
                }
            } else {
                Text("Tap pad — start a run below", color = DimGrey)
            }
        }

        // ── Actions ──────────────────────────────────────────────────────────
        if (tap.active) {
            OutlinedButton(
                onClick = { vm.cancelTapMode() },
                modifier = Modifier.fillMaxWidth()
            ) { Text("Cancel run") }
        } else {
            Button(
                onClick = { vm.startTapMode() },
                enabled = canRecord,
                modifier = Modifier.fillMaxWidth().height(56.dp)
            ) { Text("Start tap run  (~20 taps)") }

            OutlinedButton(
                onClick = { vm.recordPress() },
                enabled = canRecord,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Single press  (±0.25s)") }
        }

        // ── Expected value ───────────────────────────────────────────────────
        // Shown so an off-trend reading is obvious at the moment it is taken,
        // while the watch is still in hand and can be re-read.
        val rs = data.readingsFor(watch.id)
        val pred = Stats.predictOffset(rs, snap.nowMs() / 1000.0)
        if (pred != null) {
            Text(
                "expected about ${Format.deviation(pred)} from the trend",
                style = MaterialTheme.typography.bodySmall,
                color = DimGrey
            )
        }
    }
}

private const val TAP_HINT = 1.8

/**
 * Timestamp on pointer-DOWN, from the input system's own event time.
 *
 * Two things matter here, and both are worth more than any amount of extra
 * tapping.
 *
 * First, DOWN rather than click: a Button's onClick fires on release, so the
 * recorded instant would include however long the finger stayed on the glass —
 * tens to hundreds of ms, and variable, which is precisely the jitter that
 * tap-averaging exists to beat.
 *
 * Second, the event's own `uptimeMillis` rather than a clock read inside the
 * handler: that field is stamped by the input system when the touch arrived,
 * so it excludes Compose's dispatch and recomposition delay. If the UI stalls,
 * a clock read in the handler is late by the length of the stall — the exact
 * failure the tap solver's outlier trimming had to be built to survive. Taking
 * the hardware event time removes most of that at the source.
 *
 * `uptimeMillis` is on SystemClock.uptimeMillis()'s timebase, which stops
 * during deep sleep, while the NTP anchor uses elapsedRealtime(). The two are
 * reconciled here with a delta sampled at the same instant. During a tap run
 * the screen is on and the device is not sleeping, so that delta is constant.
 */
private fun Modifier.tapPad(enabled: Boolean, onDown: (elapsedRealtimeMs: Long) -> Unit): Modifier =
    if (!enabled) this
    else this.pointerInput(Unit) {
        awaitPointerEventScope {
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val down = event.changes.firstOrNull { it.changedToDownIgnoreConsumed() }
                if (down != null) {
                    val skew = SystemClock.elapsedRealtime() - SystemClock.uptimeMillis()
                    onDown(down.uptimeMillis + skew)
                }
            }
        }
    }
