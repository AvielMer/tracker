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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchdrift.core.Format
import com.watchdrift.core.Stats
import com.watchdrift.data.Watch
import com.watchdrift.ui.AppViewModel
import com.watchdrift.ui.theme.Amber
import com.watchdrift.ui.theme.Cyan
import com.watchdrift.ui.theme.DimGrey
import com.watchdrift.ui.theme.SlowRed
import kotlin.math.abs

@Composable
fun WatchesScreen(vm: AppViewModel, onGoMark: () -> Unit) {
    val data by vm.data.collectAsStateWithLifecycle()
    val selectedId by vm.selectedWatchId.collectAsStateWithLifecycle()

    var showAdd by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<Watch?>(null) }

    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.weight(1f).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(data.watches, key = { it.id }) { w ->
                WatchCard(
                    vm = vm,
                    watch = w,
                    selected = w.id == selectedId,
                    onSelect = { vm.selectWatch(w.id); onGoMark() },
                    onLongPress = { confirmDelete = w }
                )
            }
            if (data.watches.isEmpty()) {
                item {
                    Text(
                        "No watches yet. Add one, then take a reading on the Mark tab.\n\n" +
                            "If you already have a watch_drift.json from Termux, import it " +
                            "from the Info tab — nothing is lost.",
                        color = DimGrey
                    )
                }
            }
        }

        ExtendedFloatingActionButton(
            onClick = { showAdd = true },
            modifier = Modifier.padding(16.dp).align(Alignment.End),
            icon = { Icon(Icons.Filled.Add, null) },
            text = { Text("Add watch") }
        )
    }

    if (showAdd) {
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showAdd = false },
            title = { Text("Add watch") },
            text = {
                Column {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Name") },
                        singleLine = true
                    )
                    Text(
                        "The name is matched against watch_profiles.json exactly " +
                            "(case-insensitive), so \"GWBX5600\" will not match \"GW-BX5600\".",
                        style = MaterialTheme.typography.bodySmall,
                        color = DimGrey,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { vm.addWatch(name); showAdd = false }) { Text("Add") }
            },
            dismissButton = {
                TextButton(onClick = { showAdd = false }) { Text("Cancel") }
            }
        )
    }

    confirmDelete?.let { w ->
        val n = data.readingsFor(w.id).size
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Delete '${w.name}'?") },
            text = {
                Text(
                    "This also deletes $n reading(s). They are timestamped " +
                        "measurements that cannot be re-taken, and there is no undo. " +
                        "Export from the Info tab first if you are unsure."
                )
            },
            confirmButton = {
                TextButton(onClick = { vm.deleteWatch(w.id); confirmDelete = null }) {
                    Text("Delete", color = SlowRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = null }) { Text("Keep") }
            }
        )
    }
}

@Composable
private fun WatchCard(
    vm: AppViewModel,
    watch: Watch,
    selected: Boolean,
    onSelect: () -> Unit,
    onLongPress: () -> Unit
) {
    val info = vm.rateInfo(watch.id)
    val spec = vm.specSPerYear(watch)

    Card(
        Modifier.fillMaxWidth().clickable(onClick = onSelect),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
            else MaterialTheme.colorScheme.surface
        )
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    watch.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (selected) Cyan else MaterialTheme.colorScheme.onSurface
                )
                Text("${info?.seg?.size ?: 0}r", color = DimGrey)
            }

            val rate = info?.rate
            if (rate == null) {
                Text("collecting — needs at least 2 readings", color = DimGrey)
            } else {
                val syr = rate * 365.25
                // A rate from a segment too young to trust is labelled as
                // borrowed from the previous one, not presented as measured.
                val label = when (info.source) {
                    "previous" -> "previous segment"
                    else -> "${Format.days(Stats.segSpanDays(info.seg))} span"
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        Format.rate(rate),
                        color = if (spec != null && abs(syr) > abs(spec)) SlowRed else Amber,
                        fontWeight = FontWeight.Bold
                    )
                    Text(label, color = DimGrey)
                }
                if (info.collecting) {
                    Text(
                        "segment still young — " +
                            "needs ~${info.needDays?.toInt() ?: 0}d",
                        style = MaterialTheme.typography.bodySmall,
                        color = DimGrey
                    )
                }
                if (spec != null) {
                    Text(
                        "spec ±${spec.toInt()} s/yr" +
                            if (abs(syr) > abs(spec)) "  — OUT OF SPEC" else "  — in spec",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (abs(syr) > abs(spec)) SlowRed else DimGrey
                    )
                }
            }

            TextButton(onClick = onLongPress) { Text("Delete…", color = SlowRed) }
        }
    }
}
