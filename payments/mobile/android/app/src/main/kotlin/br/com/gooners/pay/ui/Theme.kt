package br.com.gooners.pay.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// payments/design/tokens: the primitives the app uses.
object Tokens {
    val Midnight950 = Color(0xFF0B0F19)
    val Slate50 = Color(0xFFF8FAFC)
    val Slate100 = Color(0xFFF1F5F9)
    val Slate300 = Color(0xFFCBD5E1)
    val Slate400 = Color(0xFF94A3B8)
    val Slate600 = Color(0xFF475569)
    val Slate700 = Color(0xFF334155)
    val Slate800 = Color(0xFF1E293B)
    val Slate900 = Color(0xFF111827)
    val Mint400 = Color(0xFF34D399)
    val Mint500 = Color(0xFF10B981)
    val Mint700 = Color(0xFF047857)
    val Amber500 = Color(0xFFF59E0B)
    val Amber700 = Color(0xFFB45309)
    val Coral400 = Color(0xFFFB7185)
    val Coral700 = Color(0xFFBE123C)
    val Indigo400 = Color(0xFF818CF8)
    val Indigo700 = Color(0xFF4338CA)

    val TouchMin = 48.dp
    val KeypadKey = 72.dp
    val CtaHeight = 56.dp
}

private val Dark = darkColorScheme(
    primary = Tokens.Mint500, onPrimary = Tokens.Midnight950,
    secondary = Tokens.Indigo400, onSecondary = Tokens.Midnight950,
    background = Tokens.Midnight950, onBackground = Tokens.Slate50,
    surface = Tokens.Slate900, onSurface = Tokens.Slate50,
    surfaceVariant = Tokens.Slate800, onSurfaceVariant = Tokens.Slate300,
    outline = Tokens.Slate600,
    error = Tokens.Coral400, onError = Tokens.Midnight950,
    tertiary = Tokens.Amber500,
)

private val Light = lightColorScheme(
    primary = Tokens.Mint700, onPrimary = Color.White,
    secondary = Tokens.Indigo700, onSecondary = Color.White,
    background = Tokens.Slate50, onBackground = Tokens.Slate900,
    surface = Color.White, onSurface = Tokens.Slate900,
    surfaceVariant = Tokens.Slate100, onSurfaceVariant = Tokens.Slate700,
    outline = Tokens.Slate400,
    error = Tokens.Coral700, onError = Color.White,
    tertiary = Tokens.Amber700,
)

@Composable
fun GoonersPayTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
