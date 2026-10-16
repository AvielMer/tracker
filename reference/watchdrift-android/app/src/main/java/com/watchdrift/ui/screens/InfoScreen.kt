package com.watchdrift.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchdrift.ui.AppViewModel
import com.watchdrift.ui.theme.Cyan
import com.watchdrift.ui.theme.DimGrey

/**
 * Profile notes for the selected watch, plus import/export.
 *
 * The notes are reachable at ANY reading count, including zero. The setup
 * guidance — which is exactly what someone needs before the first mark — is
 * useless if it only appears once there is enough data to fit.
 */
@Composable
fun InfoScreen(vm: AppViewModel) {
    val data by vm.data.collectAsStateWithLifecycle()
    val selectedId by vm.selectedWatchId.collectAsStateWithLifecycle()
    val watch = data.watchById(selectedId)
    val profile = vm.profileFor(watch)

    var pendingImport by remember { mutableStateOf<android.net.Uri?>(null) }

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let { pendingImport = it } }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri -> uri?.let { vm.exportData(it) } }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("Info — ${watch?.name ?: "no watch"}", color = Cyan,
            style = MaterialTheme.typography.titleMedium)

        if (watch != null && profile == null) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text("No profile for '${watch.name}'.", fontWeight = FontWeight.Bold)
                    Text(
                        "Profile matching is exact and case-insensitive, so a name " +
                            "with different punctuation will not match. Edit " +
                            "watch_profiles.json to add one.",
                        style = MaterialTheme.typography.bodySmall, color = DimGrey
                    )
                }
            }
        }

        profile?.let { p ->
            p.movement?.let { Row2("movement", it) }
            p.specSPerYear?.let { Row2("spec", "±${it.toInt()} s/yr") }
            p.battery?.let { Row2("battery", it) }
            if (p.notes.isNotEmpty()) {
                HorizontalDivider()
                p.notes.forEach { note ->
                    Text("· $note", style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        val rs = watch?.let { data.readingsFor(it.id) } ?: emptyList()
        if (rs.size < 2) {
            HorizontalDivider()
            Text("What to do next", fontWeight = FontWeight.Bold)
            Text(
                "Take a reading on the Mark tab: start a tap run and tap on every " +
                    "tick, with your LAST tap on :00. About 20 taps is the sweet " +
                    "spot — more does not help, because the NTP round trip becomes " +
                    "the limit, and a long run lets your rhythm creep.\n\n" +
                    "Then leave the watch alone. Rate precision comes from elapsed " +
                    "span, not from the number of readings: a month of waiting is " +
                    "worth far more than another hour of tapping.",
                style = MaterialTheme.typography.bodySmall
            )
        }

        HorizontalDivider()
        Text("Data", fontWeight = FontWeight.Bold)
        Text(
            "${data.watches.size} watches · ${data.readings.size} readings",
            style = MaterialTheme.typography.bodySmall, color = DimGrey
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                importLauncher.launch(arrayOf("application/json", "text/plain", "*/*"))
            }) { Text("Import…") }
            OutlinedButton(onClick = { exportLauncher.launch("watch_drift.json") }) {
                Text("Export…")
            }
        }
        Text(
            "The file format is identical to the Termux app's watch_drift.json, " +
                "so readings move between the two in either direction.",
            style = MaterialTheme.typography.bodySmall, color = DimGrey
        )
    }

    pendingImport?.let { uri ->
        AlertDialog(
            onDismissRequest = { pendingImport = null },
            title = { Text("Import readings") },
            text = {
                Text(
                    "Merge keeps everything you already have and adds anything new — " +
                        "this is almost always what you want, and it cannot lose a " +
                        "reading.\n\nReplace discards all current data first."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    vm.importData(uri, merge = true); pendingImport = null
                }) { Text("Merge") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { pendingImport = null }) { Text("Cancel") }
                    TextButton(onClick = {
                        vm.importData(uri, merge = false); pendingImport = null
                    }) { Text("Replace") }
                }
            }
        )
    }
}

@Composable
private fun Row2(k: String, v: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(k, Modifier.weight(0.3f), color = DimGrey,
            style = MaterialTheme.typography.bodySmall)
        Text(v, Modifier.weight(0.7f), style = MaterialTheme.typography.bodySmall)
    }
}
