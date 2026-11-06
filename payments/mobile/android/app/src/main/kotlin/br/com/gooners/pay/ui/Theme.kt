package br.com.gooners.pay.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

// The app's theme, built from the generated tokens (DesignTokens.kt, from payments/design/tokens.json).

/** Sizes the screens use, from the tokens. */
object Tokens {
    val TouchMin = Sizes.TouchMin
    val KeypadKey = Sizes.KeypadKey
    val CtaHeight = Sizes.CtaHeight
}

/** The semantic colours of the theme in use, for what Material's roles do not name. */
val LocalSemantic = staticCompositionLocalOf { Themes.Dark }

/** The semantic colours of the theme in use. */
val semantic: SemanticColors
    @Composable @ReadOnlyComposable get() = LocalSemantic.current

// Material's primary is also a text colour (text buttons, the selected tab): in light it is
// the action outline green, the shade that reads on white; filled buttons use action-fill.
// Every container role is mapped too, or Material's own defaults (lavender containers, a
// tinted elevation) would leak into the navigation bar, chips, cards and snackbars.
private fun scheme(s: SemanticColors, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val primary = if (dark) s.actionFill else s.actionBorder
    val onStrong = if (dark) s.canvas else Palette.White
    return base.copy(
        primary = primary, onPrimary = if (dark) s.onAction else Palette.White,
        primaryContainer = s.actionFill, onPrimaryContainer = s.onAction,
        inversePrimary = if (dark) Palette.Mint700 else Palette.Mint400,
        secondary = s.infoText, onSecondary = onStrong,
        secondaryContainer = s.surfaceRaised, onSecondaryContainer = s.textPrimary,
        tertiary = s.attentionText, onTertiary = onStrong,
        tertiaryContainer = s.attentionFill, onTertiaryContainer = s.onAttention,
        background = s.canvas, onBackground = s.textPrimary,
        surface = s.surface, onSurface = s.textPrimary,
        surfaceVariant = s.surfaceRaised, onSurfaceVariant = s.textSecondary,
        surfaceTint = s.surface,
        inverseSurface = s.textPrimary, inverseOnSurface = s.canvas,
        surfaceBright = s.surface, surfaceDim = s.canvas,
        surfaceContainerLowest = s.canvas, surfaceContainerLow = s.surface, surfaceContainer = s.surface,
        surfaceContainerHigh = s.surfaceRaised, surfaceContainerHighest = s.surfaceRaised,
        outline = s.border, outlineVariant = s.border,
        error = s.alertText, onError = onStrong,
        errorContainer = s.alertFill, onErrorContainer = s.onAlert,
        scrim = Palette.Black,
    )
}

private val type = Typography(
    displayLarge = TypeScale.AmountDisplay,
    displaySmall = TypeScale.Kpi,
    headlineSmall = TypeScale.Headline,
    titleLarge = TypeScale.Title,
    bodyLarge = TypeScale.Body,
    bodyMedium = TypeScale.Body.copy(fontSize = TypeScale.Label.fontSize, lineHeight = TypeScale.Label.lineHeight),
    labelLarge = TypeScale.Label,
    labelSmall = TypeScale.Overline,
    bodySmall = TypeScale.Caption,
)

private val shapes = Shapes(
    extraSmall = RoundedCornerShape(Radius.Sm),
    small = RoundedCornerShape(Radius.Sm),
    medium = RoundedCornerShape(Radius.Md),
    large = RoundedCornerShape(Radius.Lg),
    extraLarge = RoundedCornerShape(Radius.Xl),
)

@Composable
fun GoonersPayTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val s = if (dark) Themes.Dark else Themes.Light
    CompositionLocalProvider(LocalSemantic provides s) {
        MaterialTheme(colorScheme = scheme(s, dark), typography = type, shapes = shapes, content = content)
    }
}
