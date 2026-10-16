package com.watchdrift.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.ShowChart
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material.icons.filled.Watch
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchdrift.ui.screens.DetailScreen
import com.watchdrift.ui.screens.InfoScreen
import com.watchdrift.ui.screens.LogScreen
import com.watchdrift.ui.screens.MarkScreen
import com.watchdrift.ui.screens.NtpBar
import com.watchdrift.ui.screens.TrendScreen
import com.watchdrift.ui.screens.WatchesScreen

enum class Tab(val label: String, val icon: ImageVector) {
    Watches("Watches", Icons.Filled.Watch),
    Mark("Mark", Icons.Filled.TouchApp),
    Log("Log", Icons.Filled.List),
    Trend("Trend", Icons.Filled.ShowChart),
    Info("Info", Icons.Filled.Info)
}

@Composable
fun WatchDriftApp(vm: AppViewModel) {
    var tab by remember { mutableStateOf(Tab.Mark) }
    var detailReadingId by remember { mutableStateOf<String?>(null) }

    val message by vm.message.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        if (message.isNotEmpty()) {
            snackbar.showSnackbar(message)
            vm.clearMessage()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t && detailReadingId == null,
                        onClick = { tab = t; detailReadingId = null },
                        icon = { Icon(t.icon, contentDescription = t.label) },
                        label = { Text(t.label, style = MaterialTheme.typography.labelSmall) }
                    )
                }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            NtpBar(vm, Modifier.fillMaxWidth())

            val openDetail = detailReadingId
            if (openDetail != null) {
                DetailScreen(vm, openDetail, onBack = { detailReadingId = null })
            } else {
                when (tab) {
                    Tab.Watches -> WatchesScreen(vm, onGoMark = { tab = Tab.Mark })
                    Tab.Mark -> MarkScreen(vm)
                    Tab.Log -> LogScreen(vm, onOpenDetail = { detailReadingId = it })
                    Tab.Trend -> TrendScreen(vm)
                    Tab.Info -> InfoScreen(vm)
                }
            }
        }
    }
}
