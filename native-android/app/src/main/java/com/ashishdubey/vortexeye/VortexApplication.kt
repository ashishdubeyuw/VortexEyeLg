package com.ashishdubey.vortexeye

import android.app.Application
import com.microsoft.appcenter.AppCenter
import com.microsoft.appcenter.analytics.Analytics
import com.microsoft.appcenter.crashes.Crashes
import com.microsoft.appcenter.distribute.Distribute
import org.osmdroid.config.Configuration
import java.io.File

class VortexApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val osmCfg = Configuration.getInstance()
        osmCfg.userAgentValue = packageName
        osmCfg.osmdroidTileCache = File(cacheDir, "osmdroid/tiles")
        osmCfg.osmdroidBasePath = File(cacheDir, "osmdroid")

        AppCenter.start(this, "00000000-0000-0000-0000-000000000000",
            Analytics::class.java, Crashes::class.java, Distribute::class.java)
    }
}
