package com.watchdrift.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

/**
 * Dark by default, monospace throughout.
 *
 * Not nostalgia for the terminal: columns of signed numbers only line up in a
 * monospace face, and this app is read as columns of signed numbers. The
 * amber/cyan accents carry the same meanings they did in the curses version so
 * the two apps stay readable side by side during the migration.
 */

val Amber = Color(0xFFFFC107)
val Cyan = Color(0xFF4DD0E1)
val Gold = Color(0xFFFFD54F)
val SlowRed = Color(0xFFFF7043)
val FastBlue = Color(0xFF64B5F6)
val ExactGreen = Color(0xFF81C784)
val DimGrey = Color(0xFF9E9E9E)

private val DarkColors = darkColorScheme(
    primary = Amber,
    onPrimary = Color(0xFF1A1A1A),
    secondary = Cyan,
    background = Color(0xFF0D0D0D),
    onBackground = Color(0xFFE0E0E0),
    surface = Color(0xFF161616),
    onSurface = Color(0xFFE0E0E0),
    surfaceVariant = Color(0xFF1F1F1F),
    onSurfaceVariant = Color(0xFFBDBDBD),
    error = SlowRed
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF8D6E00),
    secondary = Color(0xFF00696E),
    background = Color(0xFFFAFAFA),
    onBackground = Color(0xFF1A1A1A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1A1A1A)
)

private val MonoTypography = Typography().let { base ->
    Typography(
        displayLarge = base.displayLarge.copy(fontFamily = FontFamily.Monospace),
        headlineSmall = base.headlineSmall.copy(fontFamily = FontFamily.Monospace),
        titleLarge = base.titleLarge.copy(fontFamily = FontFamily.Monospace),
        titleMedium = base.titleMedium.copy(fontFamily = FontFamily.Monospace),
        titleSmall = base.titleSmall.copy(fontFamily = FontFamily.Monospace),
        bodyLarge = base.bodyLarge.copy(fontFamily = FontFamily.Monospace),
        bodyMedium = base.bodyMedium.copy(fontFamily = FontFamily.Monospace),
        bodySmall = base.bodySmall.copy(fontFamily = FontFamily.Monospace),
        labelLarge = base.labelLarge.copy(fontFamily = FontFamily.Monospace),
        labelMedium = base.labelMedium.copy(fontFamily = FontFamily.Monospace),
        labelSmall = base.labelSmall.copy(fontFamily = FontFamily.Monospace)
    )
}

/** Tabular figures for log columns. */
val MonoSmall = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp)
val MonoTiny = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 11.sp)

@Composable
fun WatchDriftTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = MonoTypography,
        content = content
    )
}

/** A slow watch reads behind true time, so its offset is positive. */
fun deviationColor(sec: Double): Color = when {
    kotlin.math.abs(sec) < 0.005 -> ExactGreen
    sec > 0 -> SlowRed
    else -> FastBlue
}
