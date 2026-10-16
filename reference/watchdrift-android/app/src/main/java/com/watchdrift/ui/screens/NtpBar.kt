package com.watchdrift.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchdrift.ui.AppViewModel
import com.watchdrift.ui.theme.DimGrey
import com.watchdrift.ui.theme.ExactGreen

/**
 * Sync state, always visible.
 *
 * Deliberately never subtle: if a sync has never succeeded the app is using
 * the raw phone clock, which can be a second or more out. That error would be
 * recorded as watch drift and never questioned, so an unsynced state is shown
 * in the error colour on every screen rather than tucked into a settings page.
 */
@Composable
fun NtpBar(vm: AppViewModel, modifier: Modifier = Modifier) {
    val snap by vm.ntp.state.collectAsStateWithLifecycle()
    val bad = !snap.synced

    Row(
        modifier
            .background(
                if (bad) MaterialTheme.colorScheme.errorContainer
                else MaterialTheme.colorScheme.surfaceVariant
            )
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        val age = snap.ageS()
        val ageText = when {
            age == null -> ""
            age < 60 -> "  ${age.toInt()}s"
            else -> "  ${(age / 60).toInt()}m"
        }
        Text(
            text = if (bad) snap.status else {
                "${snap.server ?: "—"}  ${fmtMs(snap.offsetMs)}  " +
                    "rtt ${snap.delayMs?.toInt() ?: "—"}ms$ageText"
            },
            style = MaterialTheme.typography.bodySmall,
            color = if (bad) MaterialTheme.colorScheme.onErrorContainer
            else if (age != null && age < 300) ExactGreen else DimGrey,
            modifier = Modifier.weight(1f)
        )
        IconButton(onClick = { vm.syncNtp() }) {
            Icon(Icons.Filled.Refresh, contentDescription = "Re-sync NTP")
        }
        IconButton(onClick = { vm.nextNtpServer() }) {
            Icon(Icons.Filled.SwapHoriz, contentDescription = "Next NTP server")
        }
    }
}

private fun fmtMs(v: Double): String =
    if (v >= 0) "+${v.toInt()}ms" else "${v.toInt()}ms"
