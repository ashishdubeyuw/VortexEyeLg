package com.ashishdubey.vortexeye.ui.theme

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object LiquidGlass {
    val bgDark = Color(0xFF020205)
    // Pure Glass: Reduced alpha for better transparency
    val surface = Color(0x33FFFFFF) 
    val surfaceDark = Color(0x660A0A1F)
    val accent = Color(0xFF7DF9FF)
    val accentAlt = Color(0xFFBB86FC)
    val neonGreen = Color(0xFF39FF14)
    val textSecondary = Color(0xFFD0D0FF)
    
    // Glass borders usually have a white highlight on top
    val glassBorder = Brush.verticalGradient(
        colors = listOf(Color(0x99FFFFFF), Color(0x11FFFFFF))
    )
    
    val accentGradient = Brush.linearGradient(
        colors = listOf(accent, accentAlt)
    )

    val cardShape = RoundedCornerShape(24.dp)
    val chipShape = RoundedCornerShape(16.dp)
    val pillShape = RoundedCornerShape(50)
    val hudShape = RoundedCornerShape(14.dp)

    val danger = Color(0xFFFF4757)
    val success = Color(0xFF2ED573)
    val warning = Color(0xFFFFD43B)
    val floorBadge = Color(0xFF6C5CE7)
    val border = Color(0x44FFFFFF)
    val borderGlow = Color(0x667DF9FF)
}

@Composable
fun LiquidGlassCard(
    modifier: Modifier = Modifier,
    glow: Boolean = false,
    content: @Composable ColumnScope.() -> Unit
) {
    val glowAlpha by rememberInfiniteTransition(label = "glow").animateFloat(
        initialValue = 0.2f, targetValue = 0.4f,
        animationSpec = infiniteRepeatable(tween(2500, easing = LinearEasing), RepeatMode.Reverse),
        label = "glow"
    )

    Column(
        modifier = modifier
            .clip(LiquidGlass.cardShape)
            .background(
                Brush.verticalGradient(
                    colors = listOf(Color(0x44FFFFFF), Color(0x11FFFFFF))
                )
            )
            .background(LiquidGlass.surfaceDark)
            .border(
                width = 1.dp,
                brush = if (glow) {
                    Brush.linearGradient(
                        listOf(
                            LiquidGlass.accent.copy(alpha = glowAlpha),
                            LiquidGlass.accentAlt.copy(alpha = glowAlpha * 0.5f)
                        )
                    )
                } else {
                    LiquidGlass.glassBorder
                },
                shape = LiquidGlass.cardShape
            )
            .padding(16.dp),
        content = content
    )
}

@Composable
fun HudChip(
    icon: String,
    value: String,
    modifier: Modifier = Modifier,
    accent: Color = LiquidGlass.accent,
    pulse: Boolean = false
) {
    val alpha by if (pulse) {
        rememberInfiniteTransition(label = "pulse").animateFloat(
            initialValue = 0.4f, targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(1000), RepeatMode.Reverse),
            label = "pulse"
        )
    } else {
        remember { mutableFloatStateOf(1f) }
    }

    Row(
        modifier = modifier
            .clip(LiquidGlass.hudShape)
            // Lighter transparent background to match quick indoor buttons
            .background(LiquidGlass.surface) 
            .border(0.5.dp, Color.White.copy(alpha = 0.2f), LiquidGlass.hudShape)
            .background(accent.copy(alpha = 0.15f * alpha))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
    ) {
        Text(icon, fontSize = 14.sp)
        Spacer(Modifier.width(6.dp))
        Text(
            value,
            color = Color.White,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1
        )
    }
}

@Composable
fun VortexEyeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = LiquidGlass.accent,
            background = LiquidGlass.bgDark,
            surface = LiquidGlass.bgDark
        ),
        typography = Typography(
            bodyMedium = TextStyle(fontSize = 14.sp, color = LiquidGlass.textSecondary),
            labelSmall = TextStyle(fontSize = 11.sp, color = LiquidGlass.textSecondary)
        ),
        content = content
    )
}

@Preview(showBackground = true, backgroundColor = 0xFF050510)
@Composable
fun PreviewGlass() {
    VortexEyeTheme {
        Box(Modifier.fillMaxSize().background(LiquidGlass.bgDark).padding(20.dp)) {
            LiquidGlassCard(glow = true) {
                Text("Liquid Glass", color = Color.White, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                HudChip(icon = "✨", value = "Crystal Clear")
            }
        }
    }
}
