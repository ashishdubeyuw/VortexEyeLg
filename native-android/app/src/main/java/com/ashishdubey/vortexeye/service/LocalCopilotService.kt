package com.ashishdubey.vortexeye.service

sealed class CopilotCommand {
    data class NavigateIndoor(val target: String) : CopilotCommand()
    data class NavigateOutdoor(val destination: String) : CopilotCommand()
    data class SwitchMode(val mode: NavMode) : CopilotCommand()
    data object Start : CopilotCommand()
    data object Stop : CopilotCommand()
    data object Unknown : CopilotCommand()
}

class LocalCopilotService {

    private val indoorPois = setOf("exit", "elevator", "lift", "stairs", "restroom", "bathroom", "door")

    fun parse(text: String): CopilotCommand {
        val normalized = text.lowercase().trim()
        if (normalized.isBlank()) return CopilotCommand.Unknown

        if (Regex("stop|cancel|quit").containsMatchIn(normalized)) return CopilotCommand.Stop
        if (Regex("start navigation|start nav|start").containsMatchIn(normalized)) return CopilotCommand.Start

        if (normalized.contains("indoor")) {
            if (normalized.contains("switch") || normalized.contains("engage") || normalized.contains("force")) {
                return CopilotCommand.SwitchMode(NavMode.INDOOR)
            }
        }
        if (normalized.contains("outdoor")) {
            if (normalized.contains("switch") || normalized.contains("engage") || normalized.contains("force")) {
                return CopilotCommand.SwitchMode(NavMode.OUTDOOR)
            }
        }

        val poiMatch = Regex("(?:find|where is|take me to|go to)\\s+(?:the\\s+)?([a-z ]+)").find(normalized)
        val candidate = poiMatch?.groupValues?.getOrNull(1)?.trim() ?: normalized
        val normalizedPoi = normalizePoi(candidate)
        if (indoorPois.contains(normalizedPoi)) {
            return CopilotCommand.NavigateIndoor(normalizedPoi)
        }

        val destMatch = Regex("(?:take me to|go to|navigate to|find|where is)\\s+(.+)").find(normalized)
        val destination = destMatch?.groupValues?.getOrNull(1)?.trim() ?: normalized
        return if (destination.isNotBlank()) CopilotCommand.NavigateOutdoor(destination) else CopilotCommand.Unknown
    }

    fun guidanceFor(command: CopilotCommand): String = when (command) {
        is CopilotCommand.NavigateIndoor -> "Searching indoor route to ${command.target}."
        is CopilotCommand.NavigateOutdoor -> "Planning outdoor route to ${command.destination}."
        is CopilotCommand.SwitchMode -> "Switching to ${command.mode.name.lowercase()} mode."
        CopilotCommand.Start -> "Starting navigation."
        CopilotCommand.Stop -> "Stopping navigation."
        CopilotCommand.Unknown -> "I did not understand. Please repeat your request."
    }

    fun normalizePoi(value: String): String = when (value.trim()) {
        "lift" -> "elevator"
        "bathroom", "toilet" -> "restroom"
        else -> value.trim()
    }
}
