package com.ashishdubey.vortexeye.data

data class Cell(
    val row: Int,
    val col: Int,
    val label: String,
    val pois: List<String>,
    val walkable: Boolean,
    val accessible: Boolean
)

data class Beacon(
    val id: String,
    val label: String,
    val x: Int,
    val y: Int
)

data class BuildingConfig(
    val name: String,
    val rows: Int,
    val cols: Int,
    val cellSize: Int,
    val entryRow: Int,
    val entryCol: Int,
    val cells: List<Cell>,
    val beacons: List<Beacon> = emptyList(),
    val groundAltitudeM: Float? = null,
    val floorHeightM: Float = 3.5f,
    val groundFloorNumber: Int = 0
)

object BuildingConfigs {
    val default = BuildingConfig(
        name = "Generic Building", rows = 3, cols = 4, cellSize = 5,
        entryRow = 1, entryCol = 0,
        cells = listOf(
            Cell(0,0,"Entry", listOf("exit","door"),true,true),
            Cell(0,1,"Hallway", emptyList(),true,true),
            Cell(0,2,"Hallway", emptyList(),true,true),
            Cell(0,3,"Stairs", listOf("stairs"),true,false),
            Cell(1,0,"Lobby", listOf("door"),true,true),
            Cell(1,1,"Lounge", emptyList(),true,true),
            Cell(1,2,"Cafe", listOf("lollipop"),true,true),
            Cell(1,3,"Elevator", listOf("elevator"),true,true),
            Cell(2,0,"Restroom", listOf("restroom"),true,true),
            Cell(2,1,"Office", emptyList(),true,true),
            Cell(2,2,"Office", emptyList(),true,true),
            Cell(2,3,"Side Exit", listOf("exit","door","emergency_exit"),true,true)
        ),
        groundAltitudeM = 56f,
        floorHeightM = 3.5f,
        groundFloorNumber = 0
    )

    val demo = BuildingConfig(
        name = "Demo Venue", rows = 4, cols = 5, cellSize = 4,
        entryRow = 0, entryCol = 2,
        cells = listOf(
            Cell(0,0,"Main Exit", listOf("exit","door"),true,true),
            Cell(0,1,"Reception", emptyList(),true,true),
            Cell(0,2,"Main Entry", listOf("exit","door"),true,true),
            Cell(0,3,"Info Desk", listOf("signboard"),true,true),
            Cell(0,4,"East Exit", listOf("exit","door"),true,true),
            Cell(1,0,"Hallway W", emptyList(),true,true),
            Cell(1,1,"Auditorium", emptyList(),true,true),
            Cell(1,2,"Auditorium", emptyList(),true,true),
            Cell(1,3,"Auditorium", emptyList(),true,true),
            Cell(1,4,"Hallway E", emptyList(),true,true),
            Cell(2,0,"Restroom W", listOf("restroom"),true,true),
            Cell(2,1,"Demo Area", emptyList(),true,true),
            Cell(2,2,"Demo Area", listOf("lollipop"),true,true),
            Cell(2,3,"Demo Area", emptyList(),true,true),
            Cell(2,4,"Restroom E", listOf("restroom"),true,true),
            Cell(3,0,"Fire Exit W", listOf("exit","emergency_exit","door"),true,true),
            Cell(3,1,"Storage", emptyList(),false,false),
            Cell(3,2,"Elevator", listOf("elevator"),true,true),
            Cell(3,3,"Stairs", listOf("stairs"),true,false),
            Cell(3,4,"Fire Exit E", listOf("exit","emergency_exit","door"),true,true)
        ),
        beacons = listOf(
            Beacon("b1","Entry Beacon",2,0),
            Beacon("b2","West Beacon",0,2),
            Beacon("b3","East Beacon",4,2),
            Beacon("b4","Elevator Beacon",2,3)
        ),
        groundAltitudeM = 56f,
        floorHeightM = 3.5f,
        groundFloorNumber = 0
    )

    fun get(name: String): BuildingConfig = when (name) {
        "demo" -> demo
        else -> default
    }
}
