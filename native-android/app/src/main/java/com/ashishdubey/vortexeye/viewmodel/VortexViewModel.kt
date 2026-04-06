package com.ashishdubey.vortexeye.viewmodel

import android.app.Application
import android.speech.tts.TextToSpeech
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ashishdubey.vortexeye.data.BuildingConfigs
import com.ashishdubey.vortexeye.service.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import java.util.Locale
import kotlin.math.abs

data class UiState(
    val mode: NavMode = NavMode.OUTDOOR,
    val navState: NavState = NavState.IDLE,
    val guidanceIcon: String = "📸",
    val guidanceText: String = "Point camera to scan for objects",
    val targetName: String = "",
    val statusText: String = "",
    val stepCount: Int = 0,
    val heading: Float = 0f,
    val compassDeg: Float = 0f,
    val altitude: Float = 0f,
    val floor: Int = 0,
    val gpsSignal: Int = 0,
    val posSource: String = "gps",
    val startLoc: String = "Current Location",
    val isOffline: Boolean = false,
    val routePreview: RoutePreview? = null,
    val indoorRoute: List<Quadrant>? = null,
    val indoorGeometry: List<GeoPoint>? = null,
    val outdoorGeometry: List<GeoPoint>? = null,
    val loading: Boolean = false,
    val loadingMsg: String = "",
    val micListening: Boolean = false,
    val ocrText: String = "",
    val targetDeviation: Float? = null,
    val targetLocked: String? = null,
    val steps: Int = 0,
    val floorConfidence: Float = 0f,
    val nearbyObstacles: Int = 0,
    val hazardLevel: String = "CLEAR"
)

data class RoutePreview(
    val dest: String, val distance: String, val duration: String
)

class VortexViewModel(app: Application) : AndroidViewModel(app) {

    val locationSvc = LocationService(app)
    val telephonySvc = TelephonyService(app)
    val stepSvc = StepCounterService(app)
    val indoorPos = IndoorPositioningService()
    val navSvc = NavigationService()
    val sensorSvc = SensorService(app)
    private val graphRepo = AssetIndoorGraphRepository(app)
    private val graphRouter = IndoorGraphRouter()
    private val hybridRouter = HybridRouter(graphRepo, graphRouter, navSvc)
    private val localCopilot = LocalCopilotService()
    private val offlinePackManager = OfflinePackManager(app)

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui

    private var cachedOutdoorRoute: RouteInfo? = null
    private var cachedDest: GeoPoint? = null
    private var currentTarget: String? = null
    val visionSvc = VisionService(app)
    private var latestDetections: List<Detection> = emptyList()
    private var latestOcrText: String = ""
    private var latestTargetLocked: String? = null
    private var latestTargetDeviation: Float = 0f
    private val speechDebounceMs = mutableMapOf<String, Long>()

    private val _startupReady = MutableStateFlow(false)

    init {
        tts = TextToSpeech(app) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.US
                ttsReady = true
                if (_startupReady.value) {
                    speak("Welcome to Vortex Eye. Select a destination to start.")
                }
            }
        }

        viewModelScope.launch {
            locationSvc.mode.collect { mode ->
                _ui.value = _ui.value.copy(mode = mode)
            }
        }
        viewModelScope.launch {
            locationSvc.position.collect { pos ->
                if (pos != null) {
                    val signal = locationSvc.signalPercent()
                    val src = when {
                        pos.accuracy < 10 -> "gps"
                        pos.accuracy < 50 -> "wifi"
                        else -> "gps"
                    }
                    _ui.value = _ui.value.copy(
                        heading = pos.heading ?: 0f,
                        compassDeg = pos.heading ?: 0f,
                        gpsSignal = signal,
                        posSource = src
                    )
                    locationSvc.checkEnvironment(pos.lat, pos.lng)
                    sensorSvc.seedSeaLevelFromGps(
                        altitudeMeters = pos.altitude,
                        accuracyMeters = pos.accuracy,
                        isLikelyIndoor = locationSvc.insideBuilding || _ui.value.mode == NavMode.INDOOR
                    )
                    if (_ui.value.navState == NavState.EGRESS && pos.accuracy < 10f) {
                        onEgressComplete()
                    }
                }
            }
        }
        viewModelScope.launch {
            stepSvc.steps.collect { sd ->
                _ui.value = _ui.value.copy(stepCount = sd.stepCount)
                if (sd.stepCount > 0) {
                    indoorPos.updatePosition(sd, locationSvc.heading())
                    refreshIndoorAutopilotGuidance(forceSpeak = false)
                }
            }
        }
        viewModelScope.launch {
            sensorSvc.floor.collect { flr ->
                val alt = sensorSvc.relAltitude.value
                _ui.value = _ui.value.copy(
                    altitude = alt,
                    floor = flr,
                    floorConfidence = sensorSvc.floorConfidence.value
                )
            }
        }
        viewModelScope.launch {
            sensorSvc.floorConfidence.collect { conf ->
                _ui.value = _ui.value.copy(floorConfidence = conf)
            }
        }
        viewModelScope.launch {
            sensorSvc.pressure.collect { hpa ->
                if (hpa > 0f) indoorPos.ekf().updatePressure(hpa)
            }
        }
        viewModelScope.launch {
            sensorSvc.heading.collect { deg ->
                _ui.value = _ui.value.copy(compassDeg = deg)
            }
        }

        viewModelScope.launch {
            visionSvc.ocrResult.collect { ocr ->
                latestOcrText = ocr.text
                if (ocr.blocks.isNotEmpty()) {
                    val signs = ocr.blocks.filter { it.isSignLike || it.isNumber }
                    val display = signs.joinToString(" · ") { it.text }.take(80)
                    if (display.isNotBlank() && display != _ui.value.ocrText) {
                        _ui.value = _ui.value.copy(ocrText = display)
                        if (isIndoorAutopilotActive()) {
                            speakThrottled("ocr_scene", "Visual sign detected: $display", 6000)
                        }
                    }
                    
                    // Announce apartment numbers out loud
                    val numbers = ocr.blocks.filter { it.isNumber }
                    if (numbers.isNotEmpty() && _ui.value.navState != NavState.IDLE) {
                        val numsToSay = numbers.joinToString(", ") { it.text }
                        if (isIndoorAutopilotActive()) {
                            speakThrottled("ocr_numbers", "Number markers ahead: $numsToSay", 7000)
                        }
                    }
                }
                refreshIndoorAutopilotGuidance(forceSpeak = false)
            }
        }
        viewModelScope.launch {
            visionSvc.targetDeviation.collect { dev ->
                latestTargetDeviation = dev
                _ui.value = _ui.value.copy(targetDeviation = dev)
                refreshIndoorAutopilotGuidance(forceSpeak = false)
            }
        }
        viewModelScope.launch {
            visionSvc.targetLocked.collect { lockedId ->
                latestTargetLocked = lockedId
                _ui.value = _ui.value.copy(targetLocked = lockedId)
                if (lockedId != null && _ui.value.navState == NavState.EGRESS) {
                    speakThrottled("target_lock", "Target locked: $lockedId", 3500)
                }
                refreshIndoorAutopilotGuidance(forceSpeak = false)
            }
        }
        viewModelScope.launch {
            visionSvc.targetReached.collect { reached ->
                if (reached && isIndoorAutopilotActive()) {
                    _ui.value = _ui.value.copy(
                        guidanceIcon = "🎯",
                        guidanceText = "Target reached. Stabilizing transition.",
                        statusText = "Autopilot: target reached"
                    )
                    speakThrottled("target_reached", "Target reached.", 2500)
                    if (_ui.value.navState == NavState.EGRESS) {
                        onEgressComplete()
                    }
                }
            }
        }
        viewModelScope.launch {
            visionSvc.detections.collect { list ->
                latestDetections = list
                val closeObstacles = list.filter { it.isObstacle && it.distMeters < 1.5f }
                val severeObstacles = list.filter { it.isObstacle && it.distMeters < 1.0f }
                val hazard = when {
                    severeObstacles.isNotEmpty() -> "HIGH"
                    closeObstacles.isNotEmpty() -> "MEDIUM"
                    else -> "CLEAR"
                }
                _ui.value = _ui.value.copy(
                    nearbyObstacles = closeObstacles.size,
                    hazardLevel = hazard
                )
                if (closeObstacles.isNotEmpty() && isIndoorAutopilotActive()) {
                    val obsNames = closeObstacles.joinToString(" and ") { it.label }
                    speakThrottled("obstacles", "Caution. Obstacle ahead: $obsNames", 4500)
                }
                refreshIndoorAutopilotGuidance(forceSpeak = false)
            }
        }
        viewModelScope.launch {
            stepSvc.steps.collect { stepData ->
                _ui.value = _ui.value.copy(steps = stepData.stepCount)
            }
        }
    }

    fun onPermissionsGranted() {
        if (_startupReady.value) return
        
        locationSvc.start()
        sensorSvc.start()
        telephonySvc.scanCells()
        
        viewModelScope.launch(Dispatchers.IO) {
            visionSvc.loadModel()
            graphRepo.loadGraph("demo")
            try {
                val graphJson = getApplication<Application>().assets
                    .open("indoor_graph_demo.json")
                    .bufferedReader()
                    .use { it.readText() }
                offlinePackManager.cacheIndoorGraphJson("demo", graphJson)
            } catch (_: Exception) {
            }
            _startupReady.value = true
            
            launch(kotlinx.coroutines.Dispatchers.Main) {
                if (ttsReady) {
                    speak("Welcome to Vortex Eye. Select a destination to start.")
                }
            }
        }
    }

    fun restartLocation() {
        locationSvc.start()
        sensorSvc.start()
    }

    fun speak(msg: String) {
        if (ttsReady) tts?.speak(msg, TextToSpeech.QUEUE_FLUSH, null, null)
    }

    fun initIndoor(configName: String = "demo") {
        val cfg = BuildingConfigs.get(configName)
        sensorSvc.configureBuildingFloorModel(
            groundAltitudeM = cfg.groundAltitudeM,
            floorHeightMeters = cfg.floorHeightM,
            groundFloorNumber = cfg.groundFloorNumber
        )
        indoorPos.initGrid(cfg)
        val pos = locationSvc.position.value
        if (pos != null) indoorPos.setAnchor(pos.lat, pos.lng)
        _ui.value = _ui.value.copy(mode = NavMode.INDOOR)
        refreshIndoorAutopilotGuidance(forceSpeak = true)
    }

    fun handleTarget(target: String) {
        viewModelScope.launch {
            val normalizedTarget = localCopilot.normalizePoi(target)
            _ui.value = _ui.value.copy(
                targetName = normalizedTarget,
                statusText = "Searching...", 
                loading = true,
                navState = NavState.INDOOR_NAV
            )
            locationSvc.navState = NavState.INDOOR_NAV
            switchMode(NavMode.INDOOR)
            initIndoor()
            stepSvc.start()
            visionSvc.start()
            visionSvc.setTarget(normalizedTarget)

            val result = indoorPos.selectOptimalTarget(normalizedTarget)
            val ekfState = indoorPos.ekf().state
            val graphRoute = hybridRouter.routeIndoorToPoi(
                poiTag = normalizedTarget,
                floor = (_ui.value.floor - 1).coerceAtLeast(0),
                xMeters = ekfState.x.toDouble(),
                yMeters = ekfState.y.toDouble(),
                wheelchairMode = indoorPos.wheelchairMode
            )

            if (result != null || graphRoute != null) {
                val instr = indoorPos.getNextInstruction()
                val candidates = indoorPos.getAllCandidates()
                
                // Convert indoor Quadrant grid to global GPS coordinates for the map
                val anchorLat = indoorPos.anchorLat
                val anchorLng = indoorPos.anchorLng
                val cellSize = indoorPos.getConfig()?.cellSize ?: 1
                val legacyGeoPts = result?.route?.map { q ->
                    val rx = q.col * cellSize
                    val ry = q.row * cellSize
                    val dLat = ry / 111111.0
                    val dLng = rx / (111111.0 * kotlin.math.cos(Math.toRadians(anchorLat)))
                    GeoPoint(anchorLat + dLat, anchorLng + dLng)
                } ?: emptyList()
                val geoPts = if (graphRoute != null && graphRoute.geometry.isNotEmpty()) graphRoute.geometry else legacyGeoPts
                val leadInstruction = graphRoute?.instructions?.firstOrNull() ?: instr.second
                val pathTitle = when {
                    graphRoute != null -> "Route: ${(graphRoute.distanceMeters).toInt()}m (graph)"
                    result != null -> "Route: ${result.pathLength} steps · Score ${result.score.toInt()}"
                    else -> "Route ready"
                }

                _ui.value = _ui.value.copy(
                    indoorRoute = result?.route,
                    indoorGeometry = geoPts,
                    guidanceIcon = instr.first,
                    guidanceText = leadInstruction,
                    statusText = pathTitle,
                    loading = false
                )
                if (graphRoute != null) {
                    speak("Graph route ready to ${graphRoute.targetLabel}. Distance ${(graphRoute.distanceMeters).toInt()} meters.")
                } else if (candidates.size > 1 && result != null) {
                    speak("Found ${candidates.size} ${normalizedTarget}s. Best route is to ${result.label}, ${result.pathLength} quadrants away.")
                } else if (result != null) {
                    speak("Found $normalizedTarget at ${result.label}. ${result.pathLength} quadrants away.")
                }
                refreshIndoorAutopilotGuidance(forceSpeak = true)
            } else {
                _ui.value = _ui.value.copy(
                    guidanceIcon = "🔍",
                    guidanceText = "Scanning for $normalizedTarget...",
                    loading = false
                )
                speak("Looking for $normalizedTarget. Point camera and scan around.")
                refreshIndoorAutopilotGuidance(forceSpeak = false)
            }
        }
    }

    fun handleOutdoorNav(dest: String) {
        viewModelScope.launch {
            currentTarget = dest
            _ui.value = _ui.value.copy(targetName = dest, statusText = "Routing...", loading = true)

            val isIndoor = locationSvc.insideBuilding
            if (isIndoor) {
                startEgress(dest)
            } else {
                computeOutdoorRoute(dest)
            }
        }
    }

    private suspend fun startEgress(finalDest: String) {
        _ui.value = _ui.value.copy(
            navState = NavState.EGRESS,
            guidanceIcon = "🚪",
            guidanceText = "Exit the building first",
            statusText = "Finding exit..."
        )
        locationSvc.navState = NavState.EGRESS
        speak("You are indoors. Please find the nearest exit first.")

        initIndoor()
        stepSvc.start()
        visionSvc.start()
        visionSvc.setTarget("exit")
        val exitResult = indoorPos.selectOptimalTarget("exit")
        if (exitResult != null) {
            val instr = indoorPos.getNextInstruction()

            val anchorLat = indoorPos.anchorLat
            val anchorLng = indoorPos.anchorLng
            val cellSize = indoorPos.getConfig()?.cellSize ?: 1
            val geoPts = exitResult.route.map { q ->
                val rx = q.col * cellSize
                val ry = q.row * cellSize
                val dLat = ry / 111111.0
                val dLng = rx / (111111.0 * kotlin.math.cos(Math.toRadians(anchorLat)))
                GeoPoint(anchorLat + dLat, anchorLng + dLng)
            }

            _ui.value = _ui.value.copy(
                indoorRoute = exitResult.route,
                indoorGeometry = geoPts,
                guidanceIcon = instr.first,
                guidanceText = instr.second,
                statusText = "Exit: ${exitResult.pathLength} steps",
                loading = false
            )
            speak("Exit found at ${exitResult.label}. ${exitResult.pathLength} quadrants away.")
            refreshIndoorAutopilotGuidance(forceSpeak = true)
        } else {
            _ui.value = _ui.value.copy(
                guidanceIcon = "🚪",
                guidanceText = "Head toward the nearest exit",
                loading = false
            )
            speak("Head toward the nearest exit. I will start outdoor navigation when GPS signal is available.")
            refreshIndoorAutopilotGuidance(forceSpeak = false)
        }

        val pos = locationSvc.position.value
        val origin = if (pos != null) GeoPoint(pos.lat, pos.lng) else null
        val (geo, route) = hybridRouter.prefetchOutdoorRoute(origin, finalDest)
        if (geo != null) {
            cachedOutdoorRoute = route
            cachedDest = geo
            _ui.value = _ui.value.copy(targetName = geo.name.split(",").take(2).joinToString(",").trim())
            if (route != null) {
                offlinePackManager.cacheLastOutdoorRoute(geo.name, route)
            }
        }
    }

    private fun onEgressComplete() {
        val route = cachedOutdoorRoute ?: return
        val dest = cachedDest ?: return
        val distTxt = navSvc.formatDistance(route.distance)
        val durTxt = navSvc.formatDuration(route.duration, route.distance)

        _ui.value = _ui.value.copy(
            navState = NavState.OUTDOOR_NAV,
            mode = NavMode.OUTDOOR,
            outdoorGeometry = route.geometry,
            indoorRoute = null,
            routePreview = RoutePreview(dest.name.split(",").take(2).joinToString(",").trim(), distTxt, durTxt),
            statusText = "$distTxt • $durTxt",
            guidanceIcon = "🧭",
            guidanceText = "Outdoor navigation started"
        )
        locationSvc.navState = NavState.OUTDOOR_NAV
        locationSvc.unlockMode()
        speak("You are outside. Route found: $distTxt, $durTxt.")
        if (route.steps.isNotEmpty()) speak(route.steps[0].instruction)
    }

    private suspend fun computeOutdoorRoute(dest: String) {
        _ui.value = _ui.value.copy(navState = NavState.OUTDOOR_NAV)
        locationSvc.navState = NavState.OUTDOOR_NAV

        val pos = locationSvc.position.value
        if (pos == null) {
            _ui.value = _ui.value.copy(
                statusText = "Waiting for GPS signal...",
                loading = false,
                navState = NavState.IDLE
            )
            speak("GPS signal not available yet. Please wait and try again.")
            return
        }
        val origin = GeoPoint(pos.lat, pos.lng)
        val geo = navSvc.geocode(dest, origin)
        if (geo == null) {
            _ui.value = _ui.value.copy(statusText = "Location not found", loading = false, navState = NavState.IDLE)
            speak("Sorry, I could not find that location.")
            return
        }

        val route = navSvc.getRoute(origin, geo)
        if (route == null) {
            _ui.value = _ui.value.copy(statusText = "Route failed", loading = false, navState = NavState.IDLE)
            speak("Could not calculate a route.")
            return
        }

        val distTxt = navSvc.formatDistance(route.distance)
        val durTxt = navSvc.formatDuration(route.duration, route.distance)
        cachedOutdoorRoute = route; cachedDest = geo
        offlinePackManager.cacheLastOutdoorRoute(geo.name, route)

        val resolvedName = geo.name.split(",").take(2).joinToString(",").trim()
        _ui.value = _ui.value.copy(
            targetName = resolvedName,
            outdoorGeometry = route.geometry,
            routePreview = RoutePreview(resolvedName, distTxt, durTxt),
            statusText = "$distTxt • $durTxt",
            loading = false,
            mode = NavMode.OUTDOOR
        )
        // Hard lock to OUTDOOR mode since we have a definitive outdoor route calculated
        locationSvc.forceMode(NavMode.OUTDOOR)
        speak("Route found. $distTxt, $durTxt.")
    }

    fun startNavigation() {
        val currentMode = locationSvc.mode.value
        val defaultState = if (currentMode == NavMode.INDOOR && (locationSvc.navState == NavState.EGRESS || locationSvc.navState == NavState.IDLE)) {
            // Either navigating to an indoor POI or trying to exit
            if (locationSvc.navState == NavState.EGRESS) NavState.EGRESS else NavState.INDOOR_NAV
        } else {
            NavState.OUTDOOR_NAV
        }
        
        _ui.value = _ui.value.copy(navState = defaultState, routePreview = null)
        locationSvc.navState = defaultState
        
        val r = cachedOutdoorRoute
        if (defaultState == NavState.OUTDOOR_NAV && r != null && r.steps.isNotEmpty()) {
            speak(r.steps[0].instruction)
        } else if (defaultState == NavState.INDOOR_NAV || defaultState == NavState.EGRESS) {
            val hasIndoorPath = (_ui.value.indoorRoute?.isNotEmpty() == true) || (_ui.value.indoorGeometry?.isNotEmpty() == true)
            if (hasIndoorPath) {
                speak(_ui.value.guidanceText)
            }
        }
    }

    fun stopNavigation() {
        _ui.value = _ui.value.copy(
            navState = NavState.IDLE, outdoorGeometry = null, indoorRoute = null, indoorGeometry = null,
            routePreview = null, targetName = "", statusText = "",
            guidanceIcon = "📸", guidanceText = "Point camera to scan for objects"
        )
        locationSvc.navState = NavState.IDLE
        locationSvc.unlockMode() // Remove any navigation hard-locks
        cachedOutdoorRoute = null; cachedDest = null; currentTarget = null
        visionSvc.clearTarget()
        visionSvc.stop()
        latestDetections = emptyList()
        latestOcrText = ""
        latestTargetLocked = null
        latestTargetDeviation = 0f
        speak("Navigation stopped.")
    }

    fun setMicListening(v: Boolean) {
        _ui.value = _ui.value.copy(micListening = v)
    }

    fun handleVoiceResult(transcript: String) {
        val command = localCopilot.parse(transcript)
        when (command) {
            is CopilotCommand.NavigateIndoor -> {
                speak(localCopilot.guidanceFor(command))
                handleTarget(command.target)
            }
            is CopilotCommand.NavigateOutdoor -> {
                speak(localCopilot.guidanceFor(command))
                handleOutdoorNav(command.destination)
            }
            is CopilotCommand.SwitchMode -> {
                switchMode(command.mode)
                speak(localCopilot.guidanceFor(command))
            }
            CopilotCommand.Start -> {
                startNavigation()
                speak(localCopilot.guidanceFor(command))
            }
            CopilotCommand.Stop -> {
                stopNavigation()
            }
            CopilotCommand.Unknown -> {
                speak(localCopilot.guidanceFor(command))
            }
        }
    }

    private fun switchMode(m: NavMode) {
        locationSvc.forceMode(m)
        _ui.value = _ui.value.copy(mode = m)
        refreshIndoorAutopilotGuidance(forceSpeak = false)
    }

    private fun isIndoorAutopilotActive(): Boolean {
        val state = _ui.value.navState
        return _ui.value.mode == NavMode.INDOOR && (state == NavState.INDOOR_NAV || state == NavState.EGRESS || state == NavState.INGRESS)
    }

    private fun refreshIndoorAutopilotGuidance(forceSpeak: Boolean) {
        if (!isIndoorAutopilotActive()) return

        val nearestObstacle = latestDetections
            .filter { it.isObstacle }
            .minByOrNull { it.distMeters }

        val hardHazard = nearestObstacle != null && nearestObstacle.distMeters < 1.0f && abs(nearestObstacle.dirAngle) < 18f
        if (hardHazard) {
            val hazard = nearestObstacle ?: return
            val hazardText = "STOP. ${hazard.label} ahead at ${"%.1f".format(hazard.distMeters)} meters. Shift slightly and continue."
            _ui.value = _ui.value.copy(
                guidanceIcon = "🛑",
                guidanceText = hazardText,
                statusText = "Autopilot safety override"
            )
            if (forceSpeak) speakThrottled("hard_hazard", hazardText, 2000)
            return
        }

        val lock = latestTargetLocked
        if (!lock.isNullOrBlank()) {
            val dev = latestTargetDeviation
            val correction = when {
                dev > 10f -> "Correct left ${dev.toInt()}°"
                dev < -10f -> "Correct right ${abs(dev).toInt()}°"
                else -> "Hold heading"
            }
            val guidance = "$correction toward $lock"
            _ui.value = _ui.value.copy(
                guidanceIcon = if (abs(dev) <= 10f) "🔒" else if (dev > 0f) "⬅️" else "➡️",
                guidanceText = guidance,
                statusText = "Autopilot tracking visual target"
            )
            if (forceSpeak) speakThrottled("target_track", guidance, 2800)
            return
        }

        val target = _ui.value.targetName.lowercase().trim()
        if (target.isNotBlank() && latestOcrText.isNotBlank()) {
            val ocrHit = when (target) {
                "restroom" -> listOf("restroom", "bathroom", "men", "women").any { latestOcrText.lowercase().contains(it) }
                "elevator" -> listOf("elevator", "lift").any { latestOcrText.lowercase().contains(it) }
                "exit" -> latestOcrText.lowercase().contains("exit")
                else -> latestOcrText.lowercase().contains(target)
            }
            if (ocrHit) {
                val msg = "Signage confirms $target nearby. Keep camera centered and proceed."
                _ui.value = _ui.value.copy(
                    guidanceIcon = "📋",
                    guidanceText = msg,
                    statusText = "Autopilot: OCR confirmation"
                )
                if (forceSpeak) speakThrottled("ocr_confirm", msg, 3200)
                return
            }
        }

        val fallback = indoorPos.getNextInstruction()
        _ui.value = _ui.value.copy(
            guidanceIcon = fallback.first,
            guidanceText = fallback.second,
            statusText = if (_ui.value.statusText.isBlank()) "Autopilot guiding route" else _ui.value.statusText
        )
    }

    private fun speakThrottled(key: String, message: String, cooldownMs: Long) {
        val now = System.currentTimeMillis()
        val last = speechDebounceMs[key] ?: 0L
        if (now - last >= cooldownMs) {
            speechDebounceMs[key] = now
            speak(message)
        }
    }

    override fun onCleared() {
        super.onCleared()
        locationSvc.stop(); stepSvc.stop(); sensorSvc.stop(); visionSvc.stop(); tts?.shutdown()
    }
}
