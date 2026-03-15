package com.ashishdubey.vortexeye.ui

import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.camera.view.PreviewView
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ashishdubey.vortexeye.service.NavMode
import com.ashishdubey.vortexeye.service.NavState
import com.ashishdubey.vortexeye.ui.theme.LiquidGlass
import com.ashishdubey.vortexeye.ui.theme.LiquidGlassCard
import com.ashishdubey.vortexeye.ui.theme.HudChip
import com.ashishdubey.vortexeye.ui.theme.VortexEyeTheme
import com.ashishdubey.vortexeye.viewmodel.UiState
import com.ashishdubey.vortexeye.viewmodel.VortexViewModel
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint as OsmGeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polyline

@Composable
fun VortexEyeApp(vm: VortexViewModel = viewModel()) {
    val ui by vm.ui.collectAsState()
    VortexEyeContent(
        ui = ui,
        onMicClick = { vm.setMicListening(true) },
        onGoClick = { vm.handleOutdoorNav(it) },
        onTargetClick = { vm.handleTarget(it) },
        onStartNav = { vm.startNavigation() },
        onStopNav = { vm.stopNavigation() },
        onVoiceResult = { vm.handleVoiceResult(it) },
        onMicDone = { vm.setMicListening(false) },
        vm = vm
    )
}

@Composable
fun VortexEyeContent(
    ui: UiState,
    onMicClick: () -> Unit,
    onGoClick: (String) -> Unit,
    onTargetClick: (String) -> Unit,
    onStartNav: () -> Unit,
    onStopNav: () -> Unit,
    onVoiceResult: (String) -> Unit,
    onMicDone: () -> Unit,
    vm: VortexViewModel? = null
) {
    var destText by remember { mutableStateOf(TextFieldValue("")) }
    var showSettings by remember { mutableStateOf(false) }

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        onMicDone()
        val matches = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
        if (!matches.isNullOrEmpty()) {
            destText = TextFieldValue(matches[0])
            onVoiceResult(matches[0])
        }
    }

    VortexEyeTheme {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(LiquidGlass.bgDark)
                .liquidBackground()
        ) {
            val immersiveIndoorHudActive = ui.mode == NavMode.INDOOR && ui.navState != NavState.IDLE
            // ── Map/Camera Layer ──
            // Chief Architect Directive: Camera is an active tool, not a passive background.
            // Only show the camera if we are INDOORS AND actively navigating (e.g., Egress or finding a room).
            // Otherwise, default to the Map to establish spatial context.
            val showCamera = ui.mode == NavMode.INDOOR && ui.navState != NavState.IDLE
            if (showCamera && vm != null) {
                Box(modifier = Modifier.fillMaxSize()) {
                    CameraPreviewView(vm, Modifier.fillMaxSize())
                    if (ui.ocrText.isNotBlank()) {
                        Row(
                            modifier = Modifier
                                .align(Alignment.BottomStart)
                                .padding(start = 12.dp, bottom = if (ui.navState != NavState.IDLE) 180.dp else 40.dp)
                                .clip(LiquidGlass.hudShape)
                                .border(1.dp, LiquidGlass.glassBorder, LiquidGlass.hudShape)
                                .background(LiquidGlass.surfaceDark)
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("📋", fontSize = 16.sp)
                            Spacer(Modifier.width(8.dp))
                            Text(
                                ui.ocrText,
                                color = LiquidGlass.neonGreen,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 2
                            )
                        }
                    }

                    // ── TFLite Detection Overlay ──
                    val dets = vm.visionSvc.detections.collectAsState().value
                    if (dets.isNotEmpty()) {
                        Column(
                            modifier = Modifier
                                .align(Alignment.TopStart)
                                .padding(start = 12.dp, top = 160.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            dets.take(5).forEach { det ->
                                val chipColor = if (det.isObstacle) LiquidGlass.danger.copy(0.7f) else LiquidGlass.accent.copy(0.5f)
                                Row(
                                    modifier = Modifier
                                        .clip(LiquidGlass.hudShape)
                                        .background(Color.Black.copy(0.6f))
                                        .border(1.dp, chipColor, LiquidGlass.hudShape)
                                        .padding(horizontal = 10.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(det.emoji, fontSize = 14.sp)
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        "${det.label} · ${"%,.1f".format(det.distMeters)}m",
                                        color = Color.White,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }
                    }

                    // ── Target Lock Banner ──
                    ui.targetLocked?.let { lockedLabel ->
                        Row(
                            modifier = Modifier
                                .align(Alignment.TopCenter)
                                .padding(top = 70.dp)
                                .clip(LiquidGlass.hudShape)
                                .border(1.dp, LiquidGlass.success, LiquidGlass.hudShape)
                                .background(Color.Black.copy(0.7f))
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("🔒", fontSize = 18.sp)
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "TARGET LOCKED: $lockedLabel",
                                color = LiquidGlass.success,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Black
                            )
                        }
                    }

                    // ── Target Deviation Tracking Overlay ──
                    ui.targetDeviation?.let { devAngle ->
                        val color = if (kotlin.math.abs(devAngle) < 10f) LiquidGlass.success else LiquidGlass.warning
                        val dirText = if (devAngle < -10f) "Drifting Left" else if (devAngle > 10f) "Drifting Right" else "On Target"
                        Row(
                            modifier = Modifier
                                .align(Alignment.TopCenter)
                                .padding(top = 110.dp)
                                .clip(LiquidGlass.hudShape)
                                .border(1.dp, color, LiquidGlass.hudShape)
                                .background(Color.Black.copy(0.6f))
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            val arrow = if (devAngle < -10f) "⬅️" else if (devAngle > 10f) "➡️" else "🔒"
                            Text(arrow, fontSize = 18.sp)
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "$dirText: ${kotlin.math.abs(devAngle).toInt()}°",
                                color = color,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    OsmMap(
                        vm = vm,
                        geometry = ui.outdoorGeometry,
                        indoorGeometry = ui.indoorGeometry,
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .size(160.dp)
                            .padding(12.dp)
                            .clip(LiquidGlass.cardShape)
                            .border(1.dp, LiquidGlass.glassBorder, LiquidGlass.cardShape)
                    )

                    IndoorImmersiveHud(
                        ui = ui,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(horizontal = 12.dp, vertical = 12.dp)
                    )
                }
            } else if (vm != null) {
                Box(modifier = Modifier.fillMaxSize()) {
                    OsmMap(vm = vm, geometry = ui.outdoorGeometry, indoorGeometry = ui.indoorGeometry, modifier = Modifier.fillMaxSize())
                    val curPos = vm.locationSvc.position.collectAsState().value
                    if (curPos == null) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.Center)
                                .clip(LiquidGlass.hudShape)
                                .background(LiquidGlass.surfaceDark)
                                .border(1.dp, LiquidGlass.glassBorder, LiquidGlass.hudShape)
                                .padding(horizontal = 20.dp, vertical = 14.dp)
                        ) {
                            Text("📡 Acquiring GPS…", color = LiquidGlass.accent, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        }
                    }

                    if (immersiveIndoorHudActive) {
                        IndoorImmersiveHud(
                            ui = ui,
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(horizontal = 12.dp, vertical = 12.dp)
                        )
                    }
                }
            } else {
                Box(modifier = Modifier.fillMaxSize().background(Color.Transparent), contentAlignment = Alignment.Center) {
                    Text("Interactive Glass Layer", color = Color.White.copy(0.3f), fontWeight = FontWeight.Light)
                }
            }

            // ── Main UI Overlay ──
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp)
            ) {
                Spacer(Modifier.height(48.dp))

                // ── HUD Strip ──
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    HudChip(
                        icon = if (ui.mode == NavMode.INDOOR) "🏢" else "🗺️",
                        value = if (ui.mode == NavMode.INDOOR) "Indoor" else "Outdoor",
                        accent = if (ui.mode == NavMode.INDOOR) LiquidGlass.accentAlt else LiquidGlass.accent
                    )
                    HudChip(icon = "🧭", value = "${ui.compassDeg.toInt()}°")
                    HudChip(icon = "👟", value = "${ui.steps}")
                    HudChip(icon = "🏢", value = "F${ui.floor}", accent = LiquidGlass.floorBadge)
                    Spacer(Modifier.width(8.dp)) // Changed from weight(1f) to width since it's scrollable now
                    HudChip(
                        icon = "📡",
                        value = "${ui.gpsSignal}%",
                        accent = when {
                            ui.gpsSignal > 70 -> LiquidGlass.success
                            ui.gpsSignal > 30 -> LiquidGlass.warning
                            else -> LiquidGlass.danger
                        },
                        pulse = ui.gpsSignal < 30
                    )
                    Icon(
                        Icons.Default.Settings,
                        "Settings",
                        tint = Color.White.copy(0.7f),
                        modifier = Modifier
                            .size(24.dp)
                            .clickable { showSettings = true }
                    )
                }

                Spacer(Modifier.height(16.dp))

                // ── Search & Controls ──
                LiquidGlassCard(glow = true) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("📍", fontSize = 14.sp)
                        Spacer(Modifier.width(8.dp))
                        Text(ui.startLoc, color = LiquidGlass.accent, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(12.dp))
                    Divider(color = Color.White.copy(0.1f))
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
                        Icon(Icons.Default.Search, null, tint = Color.White.copy(0.6f), modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        BasicTextField(
                            value = destText,
                            onValueChange = { destText = it },
                            textStyle = TextStyle(color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium),
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
                            keyboardActions = androidx.compose.foundation.text.KeyboardActions(
                                onSearch = {
                                    if (destText.text.isNotBlank()) onGoClick(destText.text)
                                    focusManager.clearFocus()
                                }
                            ),
                            modifier = Modifier.weight(1f),
                            decorationBox = { inner ->
                                if (destText.text.isEmpty()) Text("Search Destination...", color = Color.White.copy(0.4f))
                                inner()
                            }
                        )
                        
                        // Glass Buttons
                        GlassIconButton(icon = Icons.Default.Mic, active = ui.micListening) {
                            onMicClick()
                            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
                                putExtra(RecognizerIntent.EXTRA_PROMPT, "Where to?")
                            }
                            speechLauncher.launch(intent)
                        }
                        Spacer(Modifier.width(8.dp))
                        GlassIconButton(icon = Icons.Default.ArrowForward, primary = true) {
                            if (destText.text.isNotBlank()) {
                                onGoClick(destText.text)
                                focusManager.clearFocus()
                            }
                        }
                    }
                }

                // ── Active Target ──
                if (ui.targetName.isNotBlank() && ui.targetLocked == null) {
                    Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(LiquidGlass.hudShape)
                            .background(LiquidGlass.surfaceDark)
                            .border(1.dp, LiquidGlass.glassBorder, LiquidGlass.hudShape)
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("🎯", fontSize = 18.sp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(ui.targetName, color = Color.White, fontWeight = FontWeight.Bold)
                            Text(ui.statusText, color = LiquidGlass.accent, fontSize = 12.sp)
                        }
                    }
                }

                // ── LOCKED TARGET HUD ──
                if (ui.targetLocked != null) {
                    Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(LiquidGlass.hudShape)
                            .background(Color(0xFF0D331A).copy(0.8f)) // Deep Green locked tint
                            .border(1.dp, LiquidGlass.success, LiquidGlass.hudShape)
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("🔒", fontSize = 22.sp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("Target Locked: ${ui.targetLocked}", color = LiquidGlass.success, fontWeight = FontWeight.ExtraBold)
                            
                            val devMsg = when {
                                ui.targetDeviation == null -> "Tracking..."
                                ui.targetDeviation > 10f -> "Drifting Right - Correct Left"
                                ui.targetDeviation < -10f -> "Drifting Left - Correct Right"
                                else -> "On Path"
                            }
                            Text(devMsg, color = Color.White.copy(0.9f), fontSize = 13.sp)
                        }
                    }
                }

                // ── Navigation Instructions ──
                if (ui.navState != NavState.IDLE) {
                    Spacer(Modifier.height(12.dp))
                    LiquidGlassCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(ui.guidanceIcon, fontSize = 32.sp)
                            Spacer(Modifier.width(14.dp))
                            Column {
                                Text(ui.guidanceText, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
                                Text(ui.statusText, color = Color.White.copy(0.6f), fontSize = 13.sp)
                            }
                        }
                    }
                }
            }

            // ── Bottom Sheet (Route Preview) ──
            ui.routePreview?.let { rp ->
                Box(modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp)) {
                    LiquidGlassCard(glow = true) {
                        Text(rp.dest, color = Color.White, fontWeight = FontWeight.Black, fontSize = 18.sp)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            HudChip(icon = "🚶", value = rp.distance, accent = LiquidGlass.neonGreen)
                            HudChip(icon = "⏱️", value = rp.duration)
                        }
                        Spacer(Modifier.height(16.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Button(
                                onClick = onStartNav,
                                colors = ButtonDefaults.buttonColors(containerColor = LiquidGlass.accent),
                                shape = LiquidGlass.pillShape,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("START", color = Color.Black, fontWeight = FontWeight.ExtraBold)
                            }
                            OutlinedButton(
                                onClick = onStopNav,
                                shape = LiquidGlass.pillShape,
                                modifier = Modifier.weight(1f),
                                border = ButtonDefaults.outlinedButtonBorder.copy(
                                    brush = Brush.linearGradient(listOf(LiquidGlass.danger, LiquidGlass.danger.copy(0.4f)))
                                )
                            ) {
                                Text("CANCEL", color = LiquidGlass.danger, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            // ── Quick Access ──
            if (ui.navState == NavState.IDLE && ui.routePreview == null) {
                Box(modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp)) {
                    LiquidGlassCard {
                        Text("QUICK INDOOR", color = Color.White.copy(0.5f), fontSize = 10.sp, fontWeight = FontWeight.Black)
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("🚪 Exit" to "exit", "🚻 WC" to "restroom", "🛗 Lift" to "elevator", "🪜 Stairs" to "stairs")
                                .forEach { (label, target) ->
                                    Box(
                                        modifier = Modifier
                                            .weight(1f)
                                            .clip(LiquidGlass.chipShape)
                                            .background(LiquidGlass.surface)
                                            .border(0.5.dp, Color.White.copy(0.2f), LiquidGlass.chipShape)
                                            .clickable { onTargetClick(target) }
                                            .padding(vertical = 12.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(label, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
                        }
                    }
                }
            }

            if (showSettings) SettingsOverlay { showSettings = false }
        }
    }
}

@Composable
fun GlassIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    primary: Boolean = false,
    active: Boolean = false,
    onClick: () -> Unit
) {
    val scale by animateFloatAsState(if (active) 1.2f else 1f, label = "btn")
    Box(
        modifier = Modifier
            .size(40.dp)
            .scale(scale)
            .clip(CircleShape)
            .background(if (primary) LiquidGlass.accentGradient else SolidColor(Color.White.copy(0.1f)))
            .border(1.dp, Color.White.copy(0.2f), CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, null, tint = if (primary) Color.Black else Color.White, modifier = Modifier.size(20.dp))
    }
}

@Composable
fun Modifier.liquidBackground(): Modifier {
    val infiniteTransition = rememberInfiniteTransition(label = "bg")
    val animOffset by infiniteTransition.animateFloat(
        initialValue = 0f, targetValue = 1000f,
        animationSpec = infiniteRepeatable(tween(20000, easing = LinearEasing)),
        label = "bg"
    )
    
    return this.drawBehind {
        val color1 = Color(0xFF0A0A2A)
        val color2 = Color(0xFF1A0A2A)
        drawRect(Brush.linearGradient(listOf(color1, color2, color1)))
        
        // Blurred blobs
        drawCircle(
            brush = Brush.radialGradient(listOf(LiquidGlass.accent.copy(0.15f), Color.Transparent)),
            radius = 600f,
            center = Offset(size.width * 0.2f + animOffset % 200, size.height * 0.3f)
        )
        drawCircle(
            brush = Brush.radialGradient(listOf(LiquidGlass.accentAlt.copy(0.1f), Color.Transparent)),
            radius = 800f,
            center = Offset(size.width * 0.8f - (animOffset % 300), size.height * 0.7f)
        )
    }
}

@Composable
fun IndoorImmersiveHud(
    ui: UiState,
    modifier: Modifier = Modifier
) {
    val trackingScoreTarget = when {
        ui.targetLocked != null -> 0.95f
        ui.ocrText.isNotBlank() -> 0.65f
        else -> 0.35f
    }
    val trackingScore by animateFloatAsState(trackingScoreTarget, label = "trackingScore")
    val floorConf by animateFloatAsState(ui.floorConfidence.coerceIn(0f, 1f), label = "floorConfidence")
    val deviation = ui.targetDeviation ?: 0f
    val centered = kotlin.math.abs(deviation) < 8f

    val safetyColor = when (ui.hazardLevel) {
        "HIGH" -> LiquidGlass.danger
        "MEDIUM" -> LiquidGlass.warning
        else -> LiquidGlass.success
    }
    val safetyText = when (ui.hazardLevel) {
        "HIGH" -> "Safety override active"
        "MEDIUM" -> "Obstacle caution"
        else -> "Path clear"
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(LiquidGlass.cardShape)
            .background(Color.Black.copy(0.62f))
            .border(1.dp, LiquidGlass.glassBorder, LiquidGlass.cardShape)
            .padding(horizontal = 14.dp, vertical = 12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text("IMMERSIVE INDOOR HUD", color = Color.White.copy(0.85f), fontWeight = FontWeight.Black, fontSize = 11.sp)
            Text(
                if (ui.targetLocked != null) "VISION LOCK" else "ASSIST",
                color = if (ui.targetLocked != null) LiquidGlass.success else LiquidGlass.accent,
                fontWeight = FontWeight.Bold,
                fontSize = 11.sp
            )
        }

        Spacer(Modifier.height(8.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(LiquidGlass.hudShape)
                    .background(Color.Black.copy(0.35f))
                    .border(1.dp, if (centered) LiquidGlass.success else LiquidGlass.warning, LiquidGlass.hudShape)
                    .padding(8.dp)
            ) {
                Text(
                    text = if (centered) "🎯 Heading aligned" else "↔ Adjust ${kotlin.math.abs(deviation).toInt()}°",
                    color = if (centered) LiquidGlass.success else LiquidGlass.warning,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(LiquidGlass.hudShape)
                    .background(Color.Black.copy(0.35f))
                    .border(1.dp, safetyColor, LiquidGlass.hudShape)
                    .padding(8.dp)
            ) {
                Text(
                    text = "${ui.nearbyObstacles} obstacles · $safetyText",
                    color = safetyColor,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1
                )
            }
        }

        Spacer(Modifier.height(10.dp))

        Text("Tracking confidence", color = Color.White.copy(0.7f), fontSize = 11.sp)
        LinearProgressIndicator(
            progress = trackingScore,
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(LiquidGlass.pillShape),
            color = LiquidGlass.accent,
            trackColor = Color.White.copy(0.15f)
        )

        Spacer(Modifier.height(8.dp))

        Text("Floor confidence (F${ui.floor})", color = Color.White.copy(0.7f), fontSize = 11.sp)
        LinearProgressIndicator(
            progress = floorConf,
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(LiquidGlass.pillShape),
            color = if (floorConf > 0.7f) LiquidGlass.success else LiquidGlass.warning,
            trackColor = Color.White.copy(0.15f)
        )

        Spacer(Modifier.height(8.dp))

        Text(
            text = ui.guidanceText,
            color = Color.White,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2
        )
    }
}

@Composable
fun CameraPreviewView(vm: VortexViewModel, modifier: Modifier = Modifier) {
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) { onDispose { vm.visionSvc.releaseCamera() } }
    AndroidView(
        factory = { ctx ->
            PreviewView(ctx).also { preview ->
                preview.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                try {
                    vm.visionSvc.bindCamera(owner, preview)
                    vm.visionSvc.start()
                } catch (e: Exception) { android.util.Log.e("Camera", "Fail", e) }
            }
        },
        modifier = modifier,
        onRelease = { vm.visionSvc.releaseCamera() }
    )
}

@Composable
fun OsmMap(
    vm: VortexViewModel,
    geometry: List<com.ashishdubey.vortexeye.service.GeoPoint>?,
    indoorGeometry: List<com.ashishdubey.vortexeye.service.GeoPoint>?,
    modifier: Modifier = Modifier
) {
    val currentPos = vm.locationSvc.position.collectAsState().value
    val lifecycleOwner = LocalLifecycleOwner.current
    var isMapInitialized by remember { mutableStateOf(false) }

    AndroidView(
        factory = { ctx ->
            Configuration.getInstance().userAgentValue = ctx.packageName
            val mapView = MapView(ctx)
            mapView.setTileSource(TileSourceFactory.MAPNIK)
            mapView.setMultiTouchControls(true)
            mapView.controller.setZoom(17.0)
            mapView.onResume()
            
            val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
                when (event) {
                    androidx.lifecycle.Lifecycle.Event.ON_RESUME -> mapView.onResume()
                    androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                    else -> {}
                }
            }
            lifecycleOwner.lifecycle.addObserver(observer)
            mapView.tag = observer
            mapView
        },
        update = { mv ->
            mv.overlays.removeAll { it is Polyline || it is Marker }
            currentPos?.let { pos ->
                val geoPoint = OsmGeoPoint(pos.lat, pos.lng)
                if (!isMapInitialized) {
                    mv.controller.setZoom(19.5)
                    mv.controller.setCenter(geoPoint)
                    isMapInitialized = true
                } else {
                    mv.controller.animateTo(geoPoint)
                }
                val marker = Marker(mv).apply {
                    position = geoPoint
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                }
                mv.overlays.add(marker)
            }
            geometry?.let { pts ->
                if (pts.size >= 2) {
                    val line = Polyline().apply {
                        outlinePaint.color = android.graphics.Color.parseColor("#4B0082") // Dark Purple
                        outlinePaint.strokeWidth = 14f
                        outlinePaint.strokeCap = android.graphics.Paint.Cap.ROUND
                        outlinePaint.strokeJoin = android.graphics.Paint.Join.ROUND
                        setPoints(pts.map { OsmGeoPoint(it.lat, it.lng) })
                    }
                    mv.overlays.add(line)
                }
            }
            indoorGeometry?.let { pts ->
                if (pts.size >= 2) {
                    val line = Polyline().apply {
                        outlinePaint.color = android.graphics.Color.parseColor("#FFA500") // Orange
                        outlinePaint.strokeWidth = 14f
                        outlinePaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(15f, 25f), 0f) // Dotted Line
                        outlinePaint.strokeCap = android.graphics.Paint.Cap.ROUND
                        outlinePaint.strokeJoin = android.graphics.Paint.Join.ROUND
                        setPoints(pts.map { OsmGeoPoint(it.lat, it.lng) })
                    }
                    mv.overlays.add(line)
                }
            }
            mv.invalidate()
        },
        onRelease = { mv ->
            val observer = mv.tag as? androidx.lifecycle.LifecycleEventObserver
            if (observer != null) {
                lifecycleOwner.lifecycle.removeObserver(observer)
            }
            mv.onDetach()
        },
        modifier = modifier
    )
}

@Composable
fun SettingsOverlay(onClose: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black.copy(0.7f)).clickable { onClose() },
        contentAlignment = Alignment.Center
    ) {
        LiquidGlassCard(modifier = Modifier.fillMaxWidth(0.85f).clickable(enabled = false) {}, glow = true) {
            Text("CONFIGURATION", color = Color.White, fontWeight = FontWeight.Black, fontSize = 16.sp)
            Spacer(Modifier.height(20.dp))
            SettingsRow("Audio Guidance", true) {}
            SettingsRow("Haptic Feedback", true) {}
            SettingsRow("Diagnostic Mode", false) {}
            Spacer(Modifier.height(20.dp))
            Text("VORTEX EYE v2.0", color = Color.White.copy(0.3f), fontSize = 10.sp, fontWeight = FontWeight.Bold)
            Text("© 2026 Developed by Ashish Dubey UW", color = LiquidGlass.accent.copy(0.6f), fontSize = 10.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
fun SettingsRow(label: String, default: Boolean, onToggle: (Boolean) -> Unit) {
    var checked by remember { mutableStateOf(default) }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
    ) {
        Text(label, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        Switch(
            checked = checked,
            onCheckedChange = { checked = it; onToggle(it) },
            colors = SwitchDefaults.colors(checkedTrackColor = LiquidGlass.accent)
        )
    }
}

@Preview(showSystemUi = true)
@Composable
fun PreviewVortexEyeApp() {
    VortexEyeContent(
        ui = UiState(
            targetName = "Main Entrance",
            statusText = "Heading North-East",
            navState = NavState.OUTDOOR_NAV,
            gpsSignal = 92,
            compassDeg = 120f,
            startLoc = "Terminal 3"
        ),
        onMicClick = {}, onGoClick = {}, onTargetClick = {}, onStartNav = {}, onStopNav = {}, onVoiceResult = {}, onMicDone = {}
    )
}
