package com.ashishdubey.vortexeye.service

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.*
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class CellSignal(
    val type: String,
    val dbm: Int,
    val timingAdvance: Int,
    val cellId: Long
)

class TelephonyService(private val ctx: Context) {

    private val telephonyManager = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    
    private val _cellSignals = MutableStateFlow<List<CellSignal>>(emptyList())
    val cellSignals: StateFlow<List<CellSignal>> = _cellSignals

    fun scanCells() {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            return
        }

        val allCells = telephonyManager.allCellInfo ?: return
        val activeSignals = mutableListOf<CellSignal>()

        for (info in allCells) {
            if (!info.isRegistered) continue // Only care about towers we are actively pinging

            when (info) {
                is CellInfoNr -> { // 5G New Radio
                    val identity = info.cellIdentity as CellIdentityNr
                    val signal = info.cellSignalStrength as CellSignalStrengthNr
                    // Timing Advance gives us an extremely rough distance heuristic (depends heavily on the sub-carrier spacing)
                    // If unavailable, it returns CellInfo.UNAVAILABLE
                    val ta = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        signal.timingAdvanceMicros // API 34+
                    } else {
                        CellInfo.UNAVAILABLE
                    }
                    
                    activeSignals.add(
                        CellSignal(
                            type = "5G NR",
                            dbm = signal.dbm,
                            timingAdvance = ta, // Integer micros
                            cellId = identity.nci
                        )
                    )
                }
                is CellInfoLte -> { // Fallback to 4G LTE
                    val identity = info.cellIdentity as CellIdentityLte
                    val signal = info.cellSignalStrength as CellSignalStrengthLte
                    
                    activeSignals.add(
                        CellSignal(
                            type = "4G LTE",
                            dbm = signal.dbm,
                            timingAdvance = signal.timingAdvance, // 0..1282 multiplier
                            cellId = identity.ci.toLong()
                        )
                    )
                }
            }
        }
        
        // Sort by strongest signal (closest tower)
        _cellSignals.value = activeSignals.sortedByDescending { it.dbm }
    }
}
