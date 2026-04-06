package com.ashishdubey.vortexeye.service

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class HybridRouter(
    private val graphRepository: IndoorGraphRepository,
    private val indoorRouter: IndoorGraphRouter,
    private val outdoorRouter: NavigationService
) {

    suspend fun routeIndoorToPoi(
        poiTag: String,
        floor: Int,
        xMeters: Double,
        yMeters: Double,
        wheelchairMode: Boolean = false
    ): IndoorRoute? = withContext(Dispatchers.Default) {
        val graph = graphRepository.loadGraph("demo") ?: return@withContext null
        return@withContext indoorRouter.routeToPoi(
            graph = graph,
            floor = floor,
            xMeters = xMeters,
            yMeters = yMeters,
            targetTag = poiTag,
            wheelchairMode = wheelchairMode
        )
    }

    suspend fun prefetchOutdoorRoute(origin: GeoPoint?, destinationText: String): Pair<GeoPoint?, RouteInfo?> {
        val geo = outdoorRouter.geocode(destinationText, origin)
        if (geo == null) return null to null
        val route = outdoorRouter.getRoute(origin ?: GeoPoint(geo.lat, geo.lng), geo)
        return geo to route
    }
}
