package com.watchdrift

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.watchdrift.ui.AppViewModel
import com.watchdrift.ui.WatchDriftApp
import com.watchdrift.ui.theme.WatchDriftTheme

class MainActivity : ComponentActivity() {

    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // A tap run takes 20-60 seconds of steady tapping with no other input.
        // If the screen times out mid-run the readings collected so far are
        // lost, so the display is held on while the app is in front.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        setContent {
            WatchDriftTheme {
                WatchDriftApp(vm)
            }
        }
    }
}
