package com.ashishdubey.vortexeye.service

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.YuvImage
import android.util.Log
import android.util.Size
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.support.common.FileUtil
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

data class Detection(
    val label: String, val confidence: Float, val box: RectF,
    val emoji: String, val distMeters: Float,
    val dirAngle: Float, val isObstacle: Boolean
)

data class OcrResult(
    val text: String, val blocks: List<OcrBlock>
)

data class OcrBlock(
    val text: String, val box: Rect?, val confidence: Float,
    val isNumber: Boolean, val isSignLike: Boolean
)

class VisionService(private val ctx: Context) {

    private var interpreter: Interpreter? = null
    private var labels: List<String> = emptyList()
    private var running = false
    private var target: String? = null
    private val imgSize = 300
    private var provider: ProcessCameraProvider? = null
    private var frameCnt = 0
    private val frameSkip = 2      // TFLite runs every 2nd frame (~15fps at 30fps camera)
    private val ocrSkip = 3        // OCR runs every 3rd frame (~10fps) when attention triggered
    private val textRecognizer: TextRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var ocrBusy = false

    private val _detections = MutableStateFlow<List<Detection>>(emptyList())
    val detections: StateFlow<List<Detection>> = _detections

    private val _ocrResult = MutableStateFlow(OcrResult("", emptyList()))
    val ocrResult: StateFlow<OcrResult> = _ocrResult

    // Active navigational lock
    private val _targetDeviation = MutableStateFlow(0f)
    val targetDeviation: StateFlow<Float> = _targetDeviation
    
    private val _targetLocked = MutableStateFlow<String?>(null)
    val targetLocked: StateFlow<String?> = _targetLocked

    private val _targetReached = MutableStateFlow(false)
    val targetReached: StateFlow<Boolean> = _targetReached

    // Internal Target tracking state
    private var lastKnownBoxArea = 0f
    private var missedFrames = 0
    private var smoothedDeviation = 0f
    private var deviationInit = false

    private val obstacleLabels = setOf("person", "chair", "table", "couch", "bed", "bicycle", "car", "motorcycle")
    private val textBearingLabels = setOf("signboard", "door", "screen")

    private var attentionTriggered = false
    private var lastAttentionTime = 0L

    // Semantic COCO_MAP — remaps raw COCO labels to indoor navigation concepts
    // Ported from PWA indoor-vision.js COCO_MAP
    private data class SemanticLabel(val name: String, val emoji: String, val display: String)
    private val cocoSemanticMap = mapOf(
        "person" to SemanticLabel("person", "🧍", "Person"),
        "bicycle" to SemanticLabel("obstacle", "🚲", "Bicycle"),
        "car" to SemanticLabel("obstacle", "🚗", "Car"),
        "motorcycle" to SemanticLabel("obstacle", "🏍️", "Motorcycle"),
        "bus" to SemanticLabel("obstacle", "🚌", "Bus"),
        "truck" to SemanticLabel("obstacle", "🚚", "Truck"),
        "traffic light" to SemanticLabel("signboard", "🚦", "Traffic Light"),
        "fire hydrant" to SemanticLabel("obstacle", "🧯", "Fire Hydrant"),
        "stop sign" to SemanticLabel("signboard", "🛑", "Stop Sign"),
        "bench" to SemanticLabel("chair", "🪑", "Bench"),
        "chair" to SemanticLabel("chair", "🪑", "Chair"),
        "couch" to SemanticLabel("couch", "🛋️", "Couch"),
        "potted plant" to SemanticLabel("plant", "🌿", "Plant"),
        "bed" to SemanticLabel("bed", "🛏️", "Bed"),
        "dining table" to SemanticLabel("table", "🍽️", "Table"),
        "toilet" to SemanticLabel("restroom", "🚻", "Restroom"),
        "tv" to SemanticLabel("signboard", "📺", "Screen"),
        "laptop" to SemanticLabel("screen", "💻", "Laptop"),
        "cell phone" to SemanticLabel("object", "📱", "Phone"),
        "book" to SemanticLabel("signboard", "📚", "Sign/Book"),
        "clock" to SemanticLabel("signboard", "🕐", "Clock"),
        "refrigerator" to SemanticLabel("door", "🚪", "Door"),
        "bottle" to SemanticLabel("obstacle", "🍶", "Bottle"),
        "cup" to SemanticLabel("obstacle", "☕", "Cup"),
        "backpack" to SemanticLabel("obstacle", "🎒", "Backpack"),
        "suitcase" to SemanticLabel("obstacle", "🧳", "Suitcase"),
        "umbrella" to SemanticLabel("obstacle", "☂️", "Umbrella"),
        "vase" to SemanticLabel("object", "🏺", "Vase"),
        "scissors" to SemanticLabel("obstacle", "✂️", "Scissors")
    )

    private val targetMapping = mapOf(
        "exit" to listOf("door", "signboard"),
        "door" to listOf("door"),
        "elevator" to listOf("door", "signboard"),
        "restroom" to listOf("restroom"),
        "stairs" to listOf("signboard"),
        "signboard" to listOf("signboard", "screen")
    )

    // Regex for apartment/room/floor numbers
    private val numberPatterns = listOf(
        Regex("(?i)(?:apt|apartment|unit|suite|ste|room|rm|#)\\s*[A-Z]?\\d+[A-Z]?"),
        Regex("\\d{1,5}[A-Z]?"),
        Regex("[A-Z]-?\\d{1,4}")
    )
    private val signPatterns = listOf(
        Regex("(?i)(exit|restroom|bathroom|elevator|lift|stairs|lobby|parking|office|floor|level|entrance|reception|emergency)"),
        Regex("(?i)(men|women|no\\s+entry|fire|caution|warning|danger|push|pull|open|closed)")
    )

    fun loadModel() {
        try {
            val modelBuffer = FileUtil.loadMappedFile(ctx, "detect.tflite")
            
            try {
                val nnapiOptions = Interpreter.Options().apply {
                    setNumThreads(4)
                    setUseNNAPI(true)
                }
                interpreter = Interpreter(modelBuffer, nnapiOptions)
                Log.d("VisionSvc", "TFLite loaded WITH NNAPI")
            } catch (e: Exception) {
                Log.d("VisionSvc", "NNAPI init failed, falling back to CPU", e)
                val cpuOptions = Interpreter.Options().apply { setNumThreads(4) }
                interpreter = Interpreter(modelBuffer, cpuOptions)
                Log.d("VisionSvc", "TFLite loaded WITH CPU")
            }
            
            labels = try {
                val raw = FileUtil.loadLabels(ctx, "labelmap.txt")
                raw.filter { it.isNotBlank() }
            } catch (_: Exception) { cocoLabels() }
            Log.d("VisionSvc", "TFLite ready, ${labels.size} labels: [${labels.take(5).joinToString()}]")
            Log.d("VisionSvc", "Labels[0]=\"${labels.getOrNull(0)}\", [15]=\"${labels.getOrNull(15)}\", [61]=\"${labels.getOrNull(61)}\"")
        } catch (e: Exception) {
            labels = cocoLabels()
            Log.e("VisionSvc", "Critical TFLite Load Failure", e)
        }
    }

    fun setTarget(t: String?) { target = t; _targetReached.value = false; _targetDeviation.value = 0f; deviationInit = false }
    fun clearTarget() {
        target = null
        _detections.value = emptyList()
        _ocrResult.value = OcrResult("", emptyList())
        _targetDeviation.value = 0f
        _targetLocked.value = null
        _targetReached.value = false
        deviationInit = false
        lastKnownBoxArea = 0f
        missedFrames = 0
    }

    fun bindCamera(owner: LifecycleOwner, preview: PreviewView) {
        try {
            val future = ProcessCameraProvider.getInstance(ctx)
            future.addListener({
                try {
                    val prov = future.get()
                    provider = prov
                    prov.unbindAll()

                    val prev = Preview.Builder().build()
                    prev.setSurfaceProvider(preview.surfaceProvider)

                    val analysis = ImageAnalysis.Builder()
                        .setTargetResolution(Size(640, 480))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                        .build()

                    analysis.setAnalyzer(ContextCompat.getMainExecutor(ctx)) { proxy ->
                        try {
                            frameCnt++
                            var willCloseAsync = false
                            
                            if (running && frameCnt % frameSkip == 0) processFrame(proxy)
                            
                            val dynamicOcrSkip = if (attentionTriggered) ocrSkip else 15
                            if (running && frameCnt % dynamicOcrSkip == 0 && !ocrBusy) {
                                willCloseAsync = true
                                runOcr(proxy)
                            }
                            
                            if (!willCloseAsync) {
                                proxy.close()
                            }
                        } catch (e: Exception) {
                            Log.e("VisionSvc", "Frame error", e)
                            proxy.close()
                        }
                    }

                    prov.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, prev, analysis)
                    Log.d("VisionSvc", "Camera bound")
                } catch (e: Exception) {
                    Log.e("VisionSvc", "Camera bind failed", e)
                }
            }, ContextCompat.getMainExecutor(ctx))
        } catch (e: Exception) {
            Log.e("VisionSvc", "Camera init failed", e)
        }
    }

    fun releaseCamera() {
        try {
            provider?.unbindAll()
            provider = null
        } catch (e: Exception) {
            Log.e("VisionSvc", "Release error", e)
        }
    }

    fun start() { running = true }
    fun stop() { 
        running = false
        releaseCamera() 
        _targetLocked.value = null
        lastKnownBoxArea = 0f
        missedFrames = 0
        deviationInit = false
    }

    // ── TFLite Object Detection ──
    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    private fun processFrame(proxy: ImageProxy) {
        val interp = interpreter
        if (interp == null) {
            Log.w("VisionSvc", "processFrame: interpreter is NULL, skipping")
            return
        }
        val bmp = yuvToBitmap(proxy)
        if (bmp == null) {
            Log.w("VisionSvc", "processFrame: yuvToBitmap returned NULL")
            return
        }
        val scaled = Bitmap.createScaledBitmap(bmp, imgSize, imgSize, true)

        val input = ByteBuffer.allocateDirect(imgSize * imgSize * 3).order(ByteOrder.nativeOrder())
        for (y in 0 until imgSize) {
            for (x in 0 until imgSize) {
                val px = scaled.getPixel(x, y)
                input.put(((px shr 16) and 0xFF).toByte())
                input.put(((px shr 8) and 0xFF).toByte())
                input.put((px and 0xFF).toByte())
            }
        }
        bmp.recycle(); scaled.recycle()

        val boxes = Array(1) { Array(10) { FloatArray(4) } }
        val classes = Array(1) { FloatArray(10) }
        val scores = Array(1) { FloatArray(10) }
        val count = FloatArray(1)
        val outputs = HashMap<Int, Any>()
        outputs[0] = boxes; outputs[1] = classes; outputs[2] = scores; outputs[3] = count

        input.rewind() // CRITICAL: Reset position to 0 before inference

        try {
            interp.runForMultipleInputsOutputs(arrayOf(input), outputs)
        } catch (e: Exception) {
            Log.e("VisionSvc", "Inference failed", e)
            return
        }

        val results = mutableListOf<Detection>()
        val n = count[0].toInt().coerceAtMost(10)
        Log.d("VisionSvc", "Inference OK: count=$n, top3=${(0 until minOf(3, n)).map { "cls=${classes[0][it].toInt()}(${scores[0][it].let { s -> "%.0f".format(s * 100) }}%)" }.joinToString()}")
        var lockedDev: Float? = null
        var textBearingLocal = false
        val seenLabels = mutableSetOf<String>()
        
        for (i in 0 until n) {
            val score = scores[0][i]
            val clsIdx = classes[0][i].toInt()
            val rawLbl = if (clsIdx in labels.indices) labels[clsIdx] else "object"
            if (rawLbl.isBlank()) continue

            // Semantic remapping: translate raw COCO label to navigation concept
            val semantic = cocoSemanticMap[rawLbl]
            val lbl = semantic?.name ?: rawLbl
            val emoji = semantic?.emoji ?: "🔵"
            val displayName = semantic?.display ?: rawLbl

            val isTextBearing = textBearingLabels.contains(lbl)
            if (score < if (isTextBearing) 0.25f else 0.30f) continue
            if (lbl in seenLabels) continue
            seenLabels.add(lbl)
            Log.d("VisionSvc", "  DET[$i]: $rawLbl→$lbl (${(score * 100).toInt()}%)")
            
            if (isTextBearing) {
                textBearingLocal = true
            }

            val box = RectF(boxes[0][i][1], boxes[0][i][0], boxes[0][i][3], boxes[0][i][2])
            val dist = estimateDistance(box)
            val angle = estimateAngle(box)
            val isObs = obstacleLabels.contains(lbl) && dist < 2f
            results.add(Detection(displayName, score, box, emoji, dist, angle, isObs))
            
            // TARGET LOCK LOGIC — matches against semantic names
            if (target != null && matchesTarget(lbl)) {
                _targetLocked.value = displayName
                lastKnownBoxArea = box.width() * box.height()
                missedFrames = 0
                lockedDev = angle
                
                if (lastKnownBoxArea > 0.40f) {
                    _targetReached.value = true
                }
            }
        }
        _detections.value = results
        
        if (textBearingLocal) {
            attentionTriggered = true
            lastAttentionTime = System.currentTimeMillis()
        } else if (System.currentTimeMillis() - lastAttentionTime > 4000) {
            attentionTriggered = false
        }

        // PERSISTENT LOCK: If we didn't see it this frame but recently locked it, hold the deviation steady and check for door cross
        if (target != null) {
            if (lockedDev != null) {
                if (!deviationInit) {
                    smoothedDeviation = lockedDev
                    deviationInit = true
                } else {
                    smoothedDeviation += 0.15f * (lockedDev - smoothedDeviation)
                }
                _targetDeviation.value = smoothedDeviation
            } else if (_targetLocked.value != null) {
                missedFrames++
                // If the bounding box was huge and just disappeared, the user literally walked *through* the door. 
                if (lastKnownBoxArea > 0.25f && missedFrames > 3) {
                    _targetReached.value = true
                    _targetLocked.value = null
                } else if (missedFrames > 15) {
                    // We completely lost line of sight of the door. Break lock.
                    _targetLocked.value = null
                }
            }
        }
    }

    // ── ML Kit OCR ──
    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    private fun runOcr(proxy: ImageProxy) {
        val mediaImage = proxy.image
        if (mediaImage == null) {
            proxy.close()
            return
        }
        ocrBusy = true
        val inputImg = InputImage.fromMediaImage(mediaImage, proxy.imageInfo.rotationDegrees)

        textRecognizer.process(inputImg)
            .addOnSuccessListener { visionText ->
                val fullText = visionText.text
                val blocks = mutableListOf<OcrBlock>()

                for (block in visionText.textBlocks) {
                    for (line in block.lines) {
                        val txt = line.text.trim()
                        if (txt.length < 2) continue

                        val isNum = numberPatterns.any { it.containsMatchIn(txt) }
                        val isSign = signPatterns.any { it.containsMatchIn(txt) }
                        val conf = line.confidence ?: 0.5f

                        if (isNum || isSign || txt.length >= 3) {
                            blocks.add(OcrBlock(
                                text = txt,
                                box = line.boundingBox,
                                confidence = conf,
                                isNumber = isNum,
                                isSignLike = isSign
                            ))
                        }

                        // Check if OCR text matches navigation target
                        if (target != null && isSign) {
                            val t = target!!.lowercase()
                            if (txt.lowercase().contains(t) ||
                                (t == "restroom" && txt.lowercase().let { it.contains("restroom") || it.contains("bathroom") || it.contains("men") || it.contains("women") }) ||
                                (t == "exit" && txt.lowercase().contains("exit")) ||
                                (t == "elevator" && txt.lowercase().let { it.contains("elevator") || it.contains("lift") })
                            ) {
                                _targetLocked.value = "Sign: $txt"
                                
                                // Calculate OCR bounding box deviation
                                line.boundingBox?.let { r ->
                                    val rF = RectF(
                                        r.left / mediaImage.width.toFloat(), 
                                        r.top / mediaImage.height.toFloat(),
                                        r.right / mediaImage.width.toFloat(),
                                        r.bottom / mediaImage.height.toFloat()
                                    )
                                    val area = rF.width() * rF.height()
                                    _targetDeviation.value = estimateAngle(rF)
                                    
                                    if (area > 0.40f) {
                                        _targetReached.value = true
                                    }
                                }
                            }
                        }
                    }
                }

                _ocrResult.value = OcrResult(fullText, blocks)
            }
            .addOnFailureListener { e ->
                Log.e("VisionSvc", "OCR failed", e)
            }
            .addOnCompleteListener {
                ocrBusy = false
                proxy.close()
            }
    }

    private fun yuvToBitmap(proxy: ImageProxy): Bitmap? {
        return try {
            val yPlane = proxy.planes[0]
            val uPlane = proxy.planes[1]
            val vPlane = proxy.planes[2]

            val w = proxy.width
            val h = proxy.height

            val yBuf = yPlane.buffer
            val uBuf = uPlane.buffer
            val vBuf = vPlane.buffer

            val yRowStride = yPlane.rowStride
            val uvRowStride = uPlane.rowStride
            val uvPixelStride = uPlane.pixelStride

            // Build NV21 byte array: Y plane + interleaved VU
            val nv21 = ByteArray(w * h * 3 / 2)

            // Copy Y plane (handle row stride padding)
            var pos = 0
            for (row in 0 until h) {
                yBuf.position(row * yRowStride)
                yBuf.get(nv21, pos, w)
                pos += w
            }

            // Copy UV planes into NV21 interleaved VU format
            val uvH = h / 2
            val uvW = w / 2
            for (row in 0 until uvH) {
                for (col in 0 until uvW) {
                    val uvOffset = row * uvRowStride + col * uvPixelStride
                    nv21[pos++] = vBuf.get(uvOffset)  // V first (NV21)
                    nv21[pos++] = uBuf.get(uvOffset)  // then U
                }
            }

            val yuv = YuvImage(nv21, ImageFormat.NV21, w, h, null)
            val out = ByteArrayOutputStream()
            yuv.compressToJpeg(Rect(0, 0, w, h), 85, out)
            val jpg = out.toByteArray()
            var bmp = BitmapFactory.decodeByteArray(jpg, 0, jpg.size) ?: return null

            val rotation = proxy.imageInfo.rotationDegrees
            if (rotation != 0) {
                val matrix = Matrix()
                matrix.postRotate(rotation.toFloat())
                val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, matrix, true)
                bmp.recycle()
                bmp = rotated
            }
            bmp
        } catch (e: Exception) {
            Log.e("VisionSvc", "YUV conversion error", e)
            null
        }
    }

    private fun matchesTarget(label: String): Boolean {
        val t = target ?: return false
        val matches = targetMapping[t] ?: listOf(t)
        return matches.any { label.contains(it, ignoreCase = true) }
    }

    private fun estimateDistance(box: RectF): Float {
        val h = box.height().coerceAtLeast(0.01f)
        return (0.3f / h).coerceIn(0.3f, 15f)
    }

    private fun estimateAngle(box: RectF): Float {
        val cx = (box.left + box.right) / 2f
        return (cx - 0.5f) * 60f
    }

    private fun cocoLabels(): List<String> = listOf(
        "person", "bicycle", "car", "motorcycle", "airplane", "bus",
        "train", "truck", "boat", "traffic light", "fire hydrant",
        "stop sign", "parking meter", "bench", "bird", "cat", "dog",
        "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe",
        "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
        "skis", "snowboard", "sports ball", "kite", "baseball bat",
        "baseball glove", "skateboard", "surfboard", "tennis racket",
        "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl",
        "banana", "apple", "sandwich", "orange", "broccoli", "carrot",
        "hot dog", "pizza", "donut", "cake", "chair", "couch",
        "potted plant", "bed", "dining table", "toilet", "tv", "laptop",
        "mouse", "remote", "keyboard", "cell phone", "microwave", "oven",
        "toaster", "sink", "refrigerator", "book", "clock", "vase",
        "scissors", "teddy bear", "hair drier", "toothbrush"
    )
}
