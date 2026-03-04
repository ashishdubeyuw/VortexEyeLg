/**
 * VortexEye - Indoor Vision Module
 * Camera-based object detection with OCR for sign reading
 * Uses YOLOv8 concepts (simulated for MVP, real model in Phase 2)
 */

class IndoorVision {
    constructor() {
        this.videoElement = null;
        this.canvasElement = null;
        this.ctx = null;
        this.stream = null;
        this.isRunning = false;
        this.currentTarget = null;
        this.detections = [];
        this.onDetectionCallback = null;
        this.onTargetReachedCallback = null;
        this._targetReachedFired = false;

        // Scan-phase gate — user must rotate camera before detection fires
        this._scanRequired = false;
        this._scanComplete = false;
        this._scanRotation = 0;       // accumulated °
        this._scanThreshold = 40;     // degrees needed
        this._lastAlpha = null;       // last deviceorientation alpha
        this._onOrientation = null;   // listener ref for cleanup

        // Haptic/Audio spatial feedback for scan gate (accessibility)
        this.scanFeedback = window.SpatialScanFeedback ? new SpatialScanFeedback() : null;

        // Sequence parameters for navigation_default
        this.navSequence = ['door', 'exit_sign', 'signboard', 'elevator'];
        this.currentSequenceIndex = 0;
        this.detectionCount = 0;
        this.requiredDetectionsToAdvance = 5;

        // Detection classes for indoor navigation
        this.CLASSES = {
            0: { name: 'exit_sign', emoji: '🚪', label: 'Exit' },
            1: { name: 'door', emoji: '🚪', label: 'Door' },
            2: { name: 'elevator', emoji: '🛗', label: 'Elevator' },
            3: { name: 'stairs', emoji: '🪜', label: 'Stairs' },
            4: { name: 'emergency_exit', emoji: '🆘', label: 'Emergency Exit' },
            5: { name: 'restroom', emoji: '🚻', label: 'Restroom' },
            6: { name: 'signboard', emoji: '🪧', label: 'Sign' },
            7: { name: 'lollipop', emoji: '🍭', label: 'Lollipop' },
            8: { name: 'lolipop', emoji: '🍭', label: 'Lollipop' }
        };

        this.simulatedDetections = [];
        this.STRIDE_LENGTH_METERS = 0.75;

        // AR Debounce/Smoothing State
        this.activeDetections = []; // Stores persistent boxes
        this.DETECTION_LIFETIME_MS = 2000;
        this.INTERPOLATION_SPEED = 0.15; // Speed for box smoothing

        // COCO-SSD real model
        this.cocoModel = null;
        this.modelLoading = false;
        this._lastInferenceTime = 0;
        this.INFERENCE_INTERVAL_MS = 350;
        this.MIN_CONFIDENCE = 0.3;

        // OCR — Tesseract.js worker (parallel pipeline)
        this.ocrWorker = null;
        this.ocrReady = false;
        this.ocrLoading = false;
        this.OCR_INTERVAL_MS = 1500;
        this._lastOcrTime = 0;
        this._lastOcrAnnounced = 0;

        // COCO class → VortexEye class mapping (all 80 COCO classes)
        this.COCO_MAP = {
            // People & Animals
            'person': { name: 'person', emoji: '🧍', label: 'Person' },
            'bicycle': { name: 'obstacle', emoji: '🚲', label: 'Bicycle' },
            'car': { name: 'obstacle', emoji: '🚗', label: 'Car' },
            'motorcycle': { name: 'obstacle', emoji: '🏍️', label: 'Motorcycle' },
            'airplane': { name: 'object', emoji: '✈️', label: 'Airplane' },
            'bus': { name: 'obstacle', emoji: '🚌', label: 'Bus' },
            'train': { name: 'obstacle', emoji: '🚆', label: 'Train' },
            'truck': { name: 'obstacle', emoji: '🚚', label: 'Truck' },
            'boat': { name: 'object', emoji: '⛵', label: 'Boat' },
            'traffic light': { name: 'signboard', emoji: '🚦', label: 'Traffic Light' },
            'fire hydrant': { name: 'obstacle', emoji: '🧯', label: 'Fire Hydrant' },
            'stop sign': { name: 'signboard', emoji: '🛑', label: 'Stop Sign' },
            'parking meter': { name: 'obstacle', emoji: '🅿️', label: 'Parking Meter' },
            'bench': { name: 'chair', emoji: '🪑', label: 'Bench' },
            'bird': { name: 'object', emoji: '🐦', label: 'Bird' },
            'cat': { name: 'object', emoji: '🐱', label: 'Cat' },
            'dog': { name: 'object', emoji: '🐶', label: 'Dog' },
            'horse': { name: 'object', emoji: '🐴', label: 'Horse' },
            'sheep': { name: 'object', emoji: '🐑', label: 'Sheep' },
            'cow': { name: 'object', emoji: '🐮', label: 'Cow' },
            'elephant': { name: 'object', emoji: '🐘', label: 'Elephant' },
            'bear': { name: 'object', emoji: '🐻', label: 'Bear' },
            'zebra': { name: 'object', emoji: '🦓', label: 'Zebra' },
            'giraffe': { name: 'object', emoji: '🦒', label: 'Giraffe' },
            // Carried Objects
            'backpack': { name: 'obstacle', emoji: '🎒', label: 'Backpack' },
            'umbrella': { name: 'obstacle', emoji: '☂️', label: 'Umbrella' },
            'handbag': { name: 'obstacle', emoji: '👜', label: 'Handbag' },
            'tie': { name: 'object', emoji: '👔', label: 'Tie' },
            'suitcase': { name: 'obstacle', emoji: '🧳', label: 'Suitcase' },
            'frisbee': { name: 'object', emoji: '🥏', label: 'Frisbee' },
            'skis': { name: 'object', emoji: '🎿', label: 'Skis' },
            'snowboard': { name: 'object', emoji: '🏂', label: 'Snowboard' },
            'sports ball': { name: 'object', emoji: '⚽', label: 'Ball' },
            'kite': { name: 'object', emoji: '🪁', label: 'Kite' },
            'baseball bat': { name: 'obstacle', emoji: '🏏', label: 'Bat' },
            'baseball glove': { name: 'object', emoji: '🧤', label: 'Glove' },
            'skateboard': { name: 'obstacle', emoji: '🛹', label: 'Skateboard' },
            'surfboard': { name: 'object', emoji: '🏄', label: 'Surfboard' },
            'tennis racket': { name: 'object', emoji: '🎾', label: 'Racket' },
            // Kitchen & Dining
            'bottle': { name: 'obstacle', emoji: '🍾', label: 'Bottle' },
            'wine glass': { name: 'obstacle', emoji: '🍷', label: 'Glass' },
            'cup': { name: 'obstacle', emoji: '☕', label: 'Cup' },
            'fork': { name: 'object', emoji: '🍴', label: 'Fork' },
            'knife': { name: 'obstacle', emoji: '🔪', label: 'Knife' },
            'spoon': { name: 'object', emoji: '🥄', label: 'Spoon' },
            'bowl': { name: 'object', emoji: '🍜', label: 'Bowl' },
            'banana': { name: 'object', emoji: '🍌', label: 'Banana' },
            'apple': { name: 'object', emoji: '🍎', label: 'Apple' },
            'sandwich': { name: 'object', emoji: '🥪', label: 'Sandwich' },
            'orange': { name: 'object', emoji: '🍊', label: 'Orange' },
            'broccoli': { name: 'object', emoji: '🥦', label: 'Broccoli' },
            'carrot': { name: 'object', emoji: '🥕', label: 'Carrot' },
            'hot dog': { name: 'object', emoji: '🌭', label: 'Hot Dog' },
            'pizza': { name: 'object', emoji: '🍕', label: 'Pizza' },
            'donut': { name: 'object', emoji: '🍩', label: 'Donut' },
            'cake': { name: 'object', emoji: '🎂', label: 'Cake' },
            // Furniture & Indoor
            'chair': { name: 'chair', emoji: '🪑', label: 'Chair' },
            'couch': { name: 'couch', emoji: '🛋️', label: 'Couch' },
            'potted plant': { name: 'plant', emoji: '🌿', label: 'Plant' },
            'bed': { name: 'bed', emoji: '🛏️', label: 'Bed' },
            'dining table': { name: 'table', emoji: '🍽️', label: 'Table' },
            'toilet': { name: 'restroom', emoji: '🚻', label: 'Restroom' },
            // Electronics & Screens
            'tv': { name: 'signboard', emoji: '📺', label: 'Screen' },
            'laptop': { name: 'object', emoji: '💻', label: 'Laptop' },
            'mouse': { name: 'object', emoji: '🖱️', label: 'Mouse' },
            'remote': { name: 'object', emoji: '📱', label: 'Remote' },
            'keyboard': { name: 'object', emoji: '⌨️', label: 'Keyboard' },
            'cell phone': { name: 'object', emoji: '📱', label: 'Phone' },
            'microwave': { name: 'object', emoji: '📭', label: 'Microwave' },
            'oven': { name: 'object', emoji: '🍳', label: 'Oven' },
            'toaster': { name: 'object', emoji: '🍞', label: 'Toaster' },
            'sink': { name: 'object', emoji: '🚰', label: 'Sink' },
            'refrigerator': { name: 'door', emoji: '🚪', label: 'Door/Fridge' },
            // Indoor Landmarks
            'book': { name: 'signboard', emoji: '📚', label: 'Book/Sign' },
            'clock': { name: 'signboard', emoji: '🕐', label: 'Clock' },
            'vase': { name: 'object', emoji: '🏺', label: 'Vase' },
            'scissors': { name: 'obstacle', emoji: '✂️', label: 'Scissors' },
            'teddy bear': { name: 'object', emoji: '🧸', label: 'Teddy Bear' },
            'hair drier': { name: 'object', emoji: '💇', label: 'Hair Drier' },
            'toothbrush': { name: 'object', emoji: '🪥', label: 'Toothbrush' },
        };

        // Obstacle proximity threshold (meters)
        this.OBSTACLE_DISTANCE_M = 0.5;
        this._lastObstacleAlert = 0;
    }


    /**
     * Convert meters to approximate walking steps
     * Uses average stride length of 0.75m
     */
    metersToSteps(meters) {
        return Math.round(meters / this.STRIDE_LENGTH_METERS);
    }

    async loadModel() {
        if (this.cocoModel || this.modelLoading) return;
        this.modelLoading = true;

        // Load COCO-SSD and Tesseract OCR worker in parallel
        const [cocoResult] = await Promise.allSettled([
            this._loadCOCO(),
            this._loadOCR()
        ]);

        if (cocoResult.status === 'rejected') {
            console.error('COCO-SSD load failed:', cocoResult.reason);
        }
        this.modelLoading = false;
    }

    async _loadCOCO() {
        if (!window.cocoSsd) {
            console.warn('COCO-SSD not available, using simulated detection');
            return;
        }
        console.log('🤖 Loading COCO-SSD...');
        this.cocoModel = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
        console.log('🤖 COCO-SSD loaded');
    }

    async _loadOCR() {
        if (this.ocrReady || this.ocrLoading || !window.Tesseract) return;
        this.ocrLoading = true;
        try {
            console.log('🔤 Loading Tesseract OCR worker (local WASM bundle)...');
            // Local paths — all files bundled in www/lib/tesseract/
            const base = 'lib/tesseract';
            const opts = {
                workerPath: `${base}/worker.min.js`,
                corePath: `${base}/tesseract-core.wasm.js`,
                langPath: `${base}`,
                cacheMethod: 'none',
                logger: () => { }
            };

            const workerPromise = (async () => {
                const worker = await window.Tesseract.createWorker(opts);
                await worker.loadLanguage('eng');
                await worker.initialize('eng');
                return worker;
            })();

            const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('OCR worker timeout (20s)')), 20000));
            this.ocrWorker = await Promise.race([workerPromise, timeout]);

            // Removed tessedit_char_whitelist (letting the Tesseract language model use its full dict)

            this.ocrReady = true;
            console.log('🔤 Tesseract OCR ready (local)');
        } catch (e) {
            console.warn('🔤 Tesseract OCR init failed:', e.message || e);
            this.ocrWorker = null;
            this.ocrReady = false;
        }
        this.ocrLoading = false;
    }

    /**
     * Initialize camera
     */
    async initCamera() {
        // Reuse existing stream — prevents double-init stall on Android/iOS
        if (this.stream && this.stream.active) {
            console.log('📸 Camera already active, reusing stream');
            return true;
        }

        this.videoElement = document.getElementById('cameraFeed');
        this.canvasElement = document.getElementById('detectionCanvas');

        if (!this.videoElement || !this.canvasElement) {
            throw new Error('Video or canvas element not found');
        }

        this.ctx = this.canvasElement.getContext('2d');

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });

            this.videoElement.srcObject = this.stream;

            // Wait for actual pixel dimensions — loadedmetadata fires too early on mobile
            await new Promise(resolve => {
                const sync = () => {
                    if (this.videoElement.videoWidth > 0) {
                        this._syncCanvasSize();
                        resolve();
                    }
                };
                this.videoElement.addEventListener('playing', sync, { once: true });
                this.videoElement.addEventListener('canplay', sync, { once: true });
                // Polling fallback for browsers that skip both events
                const poll = setInterval(() => {
                    if (this.videoElement.videoWidth > 0) {
                        clearInterval(poll);
                        this._syncCanvasSize();
                        resolve();
                    }
                }, 100);
                // Begin playback
                this.videoElement.play().catch(() => { });
            });

            // Keep canvas in sync with video size on orientation/layout changes
            this._attachResizeObserver();

            console.log(`📸 Camera initialized (${this.canvasElement.width}×${this.canvasElement.height})`);

            // Load COCO-SSD model in background
            this.loadModel();

            return true;
        } catch (err) {
            console.error('Camera error:', err);
            throw err;
        }
    }

    /** Sync canvas pixel dimensions to video element dimensions */
    _syncCanvasSize() {
        const w = this.videoElement.videoWidth || this.videoElement.clientWidth;
        const h = this.videoElement.videoHeight || this.videoElement.clientHeight;
        if (w > 0 && h > 0 && (this.canvasElement.width !== w || this.canvasElement.height !== h)) {
            this.canvasElement.width = w;
            this.canvasElement.height = h;
        }
    }

    /** Attach a ResizeObserver + orientationchange to keep canvas size correct */
    _attachResizeObserver() {
        if (this._resizeObserver) return;
        const onResize = () => this._syncCanvasSize();
        if (window.ResizeObserver) {
            this._resizeObserver = new ResizeObserver(onResize);
            this._resizeObserver.observe(this.videoElement);
        }
        window.addEventListener('orientationchange', () => setTimeout(onResize, 300));
        window.addEventListener('resize', onResize);
    }

    /**
     * Start detection loop
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.detectionLoop();

        // Start a SEPARATE async inference loop for COCO-SSD
        // This decouples async model.detect() from the sync render loop
        if (this.cocoModel || this.modelLoading) {
            this._startInferenceLoop();
        } else {
            // Model not yet loaded — start inference loop once it loads
            const origLoad = this.loadModel.bind(this);
            this.loadModel = async () => {
                await origLoad();
                if (this.cocoModel && this.isRunning) this._startInferenceLoop();
            };
        }

        console.log('🔍 Indoor vision started');
    }

    /**
     * Async inference loop — runs independently from the render loop.
     * Writes results directly to activeDetections.
     */
    async _startInferenceLoop() {
        while (this.isRunning) {
            const now = Date.now();
            if (this._scanComplete && this.currentTarget) {
                const tasks = [];
                if (this.cocoModel) tasks.push(this._runRealInference(now));
                // OCR runs on slower cadence to avoid blocking
                if (this.ocrReady && now - this._lastOcrTime >= this.OCR_INTERVAL_MS) {
                    this._lastOcrTime = now;
                    tasks.push(this._runOCRInference(now));
                }
                if (tasks.length) await Promise.allSettled(tasks);
            }
            await new Promise(r => setTimeout(r, this.INFERENCE_INTERVAL_MS));
        }
    }

    /**
     * Run Tesseract OCR on the centre 65% of the camera frame.
     * Merges result text onto matching active detection or creates a
     * synthetic signboard detection when freestanding text is found.
     */
    async _runOCRInference(now) {
        if (!this.ocrReady || !this.videoElement || !this.canvasElement) return;
        const vW = this.videoElement.videoWidth;
        const vH = this.videoElement.videoHeight;
        if (!vW || !vH) return;

        // Crop centre 65% of frame for cleaner OCR
        const cropX = Math.floor(vW * 0.175);
        const cropY = Math.floor(vH * 0.175);
        const cropW = Math.floor(vW * 0.65);
        const cropH = Math.floor(vH * 0.65);

        const tmp = document.createElement('canvas');
        tmp.width = cropW;
        tmp.height = cropH;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(this.videoElement, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        // Preprocess: Grayscale conversion improves Tesseract binarization in natural scenes
        const imgData = tctx.getImageData(0, 0, cropW, cropH);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
            const avg = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
            d[i] = d[i + 1] = d[i + 2] = avg; // Assign grayscale luminance to RGB channels
        }
        tctx.putImageData(imgData, 0, 0);

        try {
            const { data } = await this.ocrWorker.recognize(tmp);
            const raw = (data.text || '').trim();
            // In-the-wild OCR confidences are very low due to lighting/shadows. 
            // 30% is a much safer threshold for real-world signs.
            if (!raw || data.confidence < 30) return;

            // Clean and validate via NLP post-processor
            const text = this._cleanOCRText(raw);
            if (!text || text.length < 2) return;

            console.log(`🔤 OCR detected: "${text}" (conf=${Math.round(data.confidence)}%)`);

            // Try to attach OCR text to the most recently seen sign/door detection
            const signDet = this.activeDetections.find(
                d => ['signboard', 'door', 'exit_sign', 'emergency_exit'].includes(d.className)
            );
            if (signDet) {
                signDet.ocrText = text;
                signDet.ocrConf = data.confidence;
                signDet.lastSeen = now;
            } else {
                // Create a synthetic signboard detection for the text
                const W = this.canvasElement.width;
                const H = this.canvasElement.height;
                const synth = {
                    id: 'ocr_sign',
                    classId: 6, className: 'signboard',
                    label: 'Sign', emoji: '🪧',
                    confidence: data.confidence / 100,
                    bbox: { x: W * 0.175, y: H * 0.175, width: W * 0.65, height: H * 0.25 },
                    direction: 'ahead',
                    directionInfo: { direction: 'ahead', angleDegrees: 0, instruction: 'Go straight ahead' },
                    distanceMeters: 2, distance: this.metersToSteps(2),
                    ocrText: text, ocrConf: data.confidence,
                    lastSeen: now
                };
                const existing = this.activeDetections.find(d => d.id === 'ocr_sign');
                if (existing) {
                    existing.ocrText = text;
                    existing.ocrConf = data.confidence;
                    existing.lastSeen = now;
                } else {
                    this.activeDetections.push(synth);
                }
            }

            // Fire detection callback for voice announcement (8s cooldown for OCR)
            if (this.onDetectionCallback && now - this._lastOcrAnnounced >= 8000) {
                this._lastOcrAnnounced = now;
                const target = this.activeDetections.find(d => d.ocrText === text);
                if (target) this.onDetectionCallback({ ...target, _ocrAnnounce: true });
            }
        } catch (e) {
            console.error('OCR Inference Error:', e);
        }
    }

    /**
     * NLP post-processor for raw Tesseract OCR output.
     * Strips noise chars, normalizes common OCR misreads,
     * and validates the result is human-readable.
     */
    _cleanOCRText(raw) {
        if (!raw) return null;

        let t = raw;

        // 1. Collapse whitespace and line breaks
        t = t.replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

        // 2. Strip non-printable and control characters
        t = t.replace(/[^\x20-\x7E]/g, '');

        // 3. Remove isolated single-char fragments (common OCR garbage)
        //    e.g. "E x i t" → keep, but "a . # r" → junk
        t = t.replace(/(?:^|\s)[^a-zA-Z0-9](?:\s|$)/g, ' ');

        // 4. Strip sequences of 3+ punctuation/symbols
        t = t.replace(/[^a-zA-Z0-9\s]{3,}/g, '');

        // 5. Common OCR character substitution corrections
        const subs = {
            '|': 'I', '0': 'O', '1': 'I', '5': 'S',
            '$': 'S', '@': 'A', '!': 'I'
        };
        // Only apply subs for isolated characters (not in numbers like "Room 501")
        t = t.replace(/\b([|0158$@!])\b/g, (_, ch) => subs[ch] || ch);

        // 6. Collapse repeated whitespace after all cleanup
        t = t.replace(/\s{2,}/g, ' ').trim();

        // 7. Readability check: must contain at least one 2+ letter word
        const hasWord = /[a-zA-Z]{2,}/.test(t);
        if (!hasWord) return null;

        // 8. Capitalize first letter for TTS clarity
        t = t.charAt(0).toUpperCase() + t.slice(1);

        return t;
    }

    /**
     * Stop detection loop
     */
    stop() {
        this.isRunning = false;

        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }

        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        this._stopOrientationTracking();
        this._scanComplete = false;
        this._scanRotation = 0;

        // Terminate OCR worker cleanly
        if (this.ocrWorker) {
            this.ocrWorker.terminate().catch(() => { });
            this.ocrWorker = null;
            this.ocrReady = false;
        }

        console.log('🔍 Indoor vision stopped');
    }

    /**
     * Main detection loop
     */
    detectionLoop() {
        if (!this.isRunning) return;

        this._syncCanvasSize();
        const W = this.canvasElement.width;
        const H = this.canvasElement.height;

        if (!this.ctx || W === 0 || H === 0) {
            requestAnimationFrame(() => this.detectionLoop());
            return;
        }

        this.ctx.clearRect(0, 0, W, H);

        // Corner frame
        const cL = 22;
        this.ctx.strokeStyle = this._scanComplete ? '#10b981' : '#6366f1';
        this.ctx.lineWidth = 3;
        this.ctx.globalAlpha = 0.55;
        [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]].forEach(([x, y, dx, dy]) => {
            this.ctx.beginPath();
            this.ctx.moveTo(x + dx * cL, y);
            this.ctx.lineTo(x, y);
            this.ctx.lineTo(x, y + dy * cL);
            this.ctx.stroke();
        });
        this.ctx.globalAlpha = 1.0;

        // Scan phase: draw a progress arc in the centre
        if (this.currentTarget && !this._scanComplete) {
            this._drawScanProgress(W, H);
        } else {
            this.detectObjects();
            this.drawDetections();

            // Proximity check: if any target detection bbox fills >50% of frame, fire target_reached
            if (this.currentTarget && this.onTargetReachedCallback && !this._targetReachedFired) {
                const tgt = this.currentTarget === 'navigation_default'
                    ? this.navSequence[this.currentSequenceIndex]
                    : this.currentTarget;
                const hit = this.detections.find(d => d.className === tgt && d.bbox.width / W > 0.5);
                if (hit) {
                    this._targetReachedFired = true;
                    this.onTargetReachedCallback(hit);
                }
            }

            // No-detection feedback (only after scan is done)
            if (this.currentTarget && this.detections.length === 0 && this.onDetectionCallback) {
                const now = Date.now();
                if (!this._lastNoDetTime || now - this._lastNoDetTime >= 3000) {
                    this._lastNoDetTime = now;
                    this.onDetectionCallback(null);
                }
            }
        }

        requestAnimationFrame(() => this.detectionLoop());
    }

    /** Draw animated arc showing scan rotation progress */
    _drawScanProgress(W, H) {
        const cx = W / 2, cy = H / 2;
        const r = Math.min(W, H) * 0.18;
        const progress = this._scanRotation / this._scanThreshold;
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + (2 * Math.PI * progress);

        // Track ring
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        this.ctx.strokeStyle = 'rgba(99,102,241,0.25)';
        this.ctx.lineWidth = 6;
        this.ctx.stroke();

        // Fill arc
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r, startAngle, endAngle);
        this.ctx.strokeStyle = '#6366f1';
        this.ctx.lineWidth = 6;
        this.ctx.stroke();

        // Center label
        const pct = Math.round(progress * 100);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = `bold ${Math.max(14, W * 0.045)}px Inter,sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`${pct}%`, cx, cy + 6);
        this.ctx.font = `${Math.max(11, W * 0.032)}px Inter,sans-serif`;
        this.ctx.fillStyle = 'rgba(255,255,255,0.75)';
        this.ctx.fillText('Rotate slowly', cx, cy + r + 22);
        this.ctx.textAlign = 'left';
    }

    /**
     * Detect objects in current frame
     * MVP: Simulated detection, Phase 2: Real YOLOv8 with OCR
     */
    detectObjects() {
        if (!this.currentTarget && !this.simulatedObstacle) { this.detections = []; this.activeDetections = []; return; }
        if (!this._scanComplete && !this.simulatedObstacle) return;

        if (this.simulatedObstacle) {
            if (Math.random() < 0.2) { this.triggerObstacleWarning(); return; }
        }

        const now = Date.now();

        // Simulated inference (sync, only when model unavailable)
        if (!this.cocoModel) {
            this._runSimulatedInference(now);
        }
        // Real inference runs in separate async _startInferenceLoop — NOT here

        // Prune expired active detections
        this.activeDetections = this.activeDetections.filter(d => (now - d.lastSeen) < this.DETECTION_LIFETIME_MS);
        this.detections = [...this.activeDetections];

        // 0.5m proximity obstacle alert (indoor mode only)
        if (this.detections.length > 0) {
            const close = this.detections.find(d => d.distanceMeters <= this.OBSTACLE_DISTANCE_M);
            if (close && now - this._lastObstacleAlert > 4000) {
                this._lastObstacleAlert = now;
                close.isObstacle = true;
                if (this.onDetectionCallback) this.onDetectionCallback(close);
            }
        }

        if (this.onDetectionCallback && this.detections.length > 0) {
            const primary = this.detections.reduce((p, c) => (p.lastSeen > c.lastSeen) ? p : c);
            if (!this._lastCbTime || now - this._lastCbTime >= 2000) {
                this._lastCbTime = now;
                this._lastNoDetTime = now;
                this.onDetectionCallback(primary);
            }
        }
    }

    /**
     * Run real COCO-SSD inference on the camera frame
     */
    async _runRealInference(now) {
        try {
            // Capture timestamp BEFORE inference — this is when the frame was actually grabbed
            const frameTs = Date.now();
            const preds = await this.cocoModel.detect(this.videoElement);
            const W = this.canvasElement.width;
            const H = this.canvasElement.height;
            const vW = this.videoElement.videoWidth || W;
            const vH = this.videoElement.videoHeight || H;
            const sx = W / vW;
            const sy = H / vH;

            preds.forEach(pred => {
                if (pred.score < this.MIN_CONFIDENCE) return;

                const mapped = this.COCO_MAP[pred.class] || {
                    name: 'object', emoji: '📦', label: pred.class.charAt(0).toUpperCase() + pred.class.slice(1)
                };

                const [rx, ry, rw, rh] = pred.bbox;
                const bx = rx * sx, by = ry * sy, bw = rw * sx, bh = rh * sy;
                const cx = bx + bw / 2;
                const dir = this.calculateDirection(cx);

                const refH = (pred.class === 'person') ? 1.7
                    : (pred.class === 'door' || pred.class === 'refrigerator') ? 2.0
                        : (pred.class === 'chair' || pred.class === 'dining table') ? 0.8
                            : 0.6;
                const focalPx = H * 1.2;
                const estDist = Math.max(0.2, (refH * focalPx) / bh);

                const id = mapped.name + '_' + Math.floor(cx / 50);
                const det = {
                    id, classId: 0, className: mapped.name,
                    label: mapped.label, emoji: mapped.emoji,
                    confidence: pred.score,
                    bbox: { x: bx, y: by, width: bw, height: bh },
                    direction: dir.direction, directionInfo: dir,
                    distanceMeters: parseFloat(estDist.toFixed(1)),
                    distance: this.metersToSteps(estDist),
                    ocrText: null, lastSeen: now, cocoClass: pred.class,
                    _frameTs: frameTs  // Temporal sync: when the camera frame was captured
                };

                const existing = this.activeDetections.find(d => d.id === id);
                if (existing) {
                    existing.bbox.x += (det.bbox.x - existing.bbox.x) * this.INTERPOLATION_SPEED;
                    existing.bbox.y += (det.bbox.y - existing.bbox.y) * this.INTERPOLATION_SPEED;
                    existing.bbox.width += (det.bbox.width - existing.bbox.width) * this.INTERPOLATION_SPEED;
                    existing.bbox.height += (det.bbox.height - existing.bbox.height) * this.INTERPOLATION_SPEED;
                    existing.confidence = det.confidence;
                    existing.direction = det.direction;
                    existing.directionInfo = det.directionInfo;
                    existing.distanceMeters = det.distanceMeters;
                    existing.distance = det.distance;
                    existing.lastSeen = now;
                } else {
                    this.activeDetections.push(det);
                }
            });
        } catch (e) {
            console.warn('COCO-SSD inference error:', e);
        }
    }

    /**
     * Simulated detection fallback when COCO-SSD is unavailable
     */
    _runSimulatedInference(now) {
        if (Math.random() >= 0.20) return;

        let classInfo;
        if (this.currentTarget === 'navigation_default') {
            classInfo = this.getClassByTargetName(this.navSequence[this.currentSequenceIndex]);
        } else {
            classInfo = this.getClassByTargetName(this.currentTarget);
        }
        if (!classInfo) return;

        const W = this.canvasElement.width, H = this.canvasElement.height;
        const bx = W * (0.2 + Math.random() * 0.3);
        const bw = W * (0.2 + Math.random() * 0.1);
        const by = H * (0.2 + Math.random() * 0.3);
        const bh = H * (0.2 + Math.random() * 0.1);
        const dir = this.calculateDirection(bx + bw / 2);
        const dist = Math.floor(3 + Math.random() * 8);

        let ocrText = null;
        if (classInfo.name === 'signboard') {
            ocrText = ['Meeting Room A', 'Cafeteria', 'Level 2', 'Restrooms', 'Exit', 'Stairs'][Math.floor(Math.random() * 6)];
        }

        const det = {
            id: classInfo.id, classId: classInfo.id,
            className: classInfo.name, label: classInfo.label, emoji: classInfo.emoji,
            confidence: 0.85 + Math.random() * 0.1,
            bbox: { x: bx, y: by, width: bw, height: bh },
            direction: dir.direction, directionInfo: dir,
            distanceMeters: dist, distance: this.metersToSteps(dist),
            ocrText, lastSeen: now
        };

        const existing = this.activeDetections.find(d => d.id === det.id);
        if (existing) {
            existing.bbox.x += (det.bbox.x - existing.bbox.x) * this.INTERPOLATION_SPEED;
            existing.bbox.y += (det.bbox.y - existing.bbox.y) * this.INTERPOLATION_SPEED;
            existing.bbox.width += (det.bbox.width - existing.bbox.width) * this.INTERPOLATION_SPEED;
            existing.bbox.height += (det.bbox.height - existing.bbox.height) * this.INTERPOLATION_SPEED;
            existing.confidence = det.confidence; existing.direction = det.direction;
            existing.directionInfo = det.directionInfo; existing.distance = det.distance;
            existing.distanceMeters = det.distanceMeters; existing.lastSeen = now;
            if (!existing.ocrText && det.ocrText) existing.ocrText = det.ocrText;
        } else {
            this.activeDetections.push(det);
        }

        if (this.currentTarget === 'navigation_default') {
            this.detectionCount++;
            if (this.detectionCount >= this.requiredDetectionsToAdvance) {
                this.detectionCount = 0;
                this.currentSequenceIndex = (this.currentSequenceIndex < this.navSequence.length - 1)
                    ? this.currentSequenceIndex + 1 : 0;
                console.log(`🧭 Sequence Advanced: Now looking for ${this.navSequence[this.currentSequenceIndex]}`);
            }
        }
    }

    /**
     * Get class info by target name
     */
    getClassByTargetName(targetName) {
        const target = targetName.toLowerCase();

        for (const [id, classInfo] of Object.entries(this.CLASSES)) {
            if (classInfo.name.includes(target) ||
                classInfo.label.toLowerCase().includes(target) ||
                target.includes(classInfo.label.toLowerCase())) {
                return { id: parseInt(id), ...classInfo };
            }
        }

        // Default to exit sign for unknown targets
        return { id: 0, ...this.CLASSES[0] };
    }

    /**
     * Calculate direction and degrees based on object position in frame
     * Uses camera FOV to determine actual turning angle
     */
    calculateDirection(objectCenterX) {
        const frameCenter = this.canvasElement.width / 2;
        const frameWidth = this.canvasElement.width;

        // Assume ~60° horizontal FOV for typical phone camera
        const HORIZONTAL_FOV = 60;

        // Calculate offset from center (-0.5 to 0.5)
        const offsetRatio = (objectCenterX - frameCenter) / frameWidth;

        // Convert to degrees (-30° to +30° for 60° FOV)
        const angleDegrees = Math.round(offsetRatio * HORIZONTAL_FOV);

        // Determine direction category
        let direction;
        let instruction;

        if (Math.abs(angleDegrees) <= 10) {
            direction = 'ahead';
            instruction = 'Go straight ahead';
        } else if (angleDegrees < -10 && angleDegrees >= -30) {
            direction = 'slight_left';
            instruction = `Turn ${Math.abs(angleDegrees)}° left`;
        } else if (angleDegrees > 10 && angleDegrees <= 30) {
            direction = 'slight_right';
            instruction = `Turn ${angleDegrees}° right`;
        } else if (angleDegrees < -30) {
            direction = 'left';
            instruction = `Turn ${Math.abs(angleDegrees)}° left`;
        } else {
            direction = 'right';
            instruction = `Turn ${angleDegrees}° right`;
        }

        return {
            direction,
            angleDegrees,
            instruction
        };
    }

    /**
     * Calculate turn instruction when target is NOT in frame
     * Called when user needs to scan/rotate to find target
     */
    getScanInstruction(lastKnownDirection) {
        const instructions = {
            'left': 'Turn 90° left and scan',
            'right': 'Turn 90° right and scan',
            'behind': 'Turn around (180°) and scan',
            'unknown': 'Rotate slowly to scan surroundings'
        };
        return instructions[lastKnownDirection] || instructions['unknown'];
    }

    /**
     * Draw detection boxes and AR labels
     */
    drawDetections() {
        this.detections.forEach(det => {
            const { bbox, label, confidence, direction, distance, emoji, ocrText } = det;

            // 1. Draw glowing bounding box
            this.ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
            this.ctx.lineWidth = 3;
            this.ctx.shadowColor = '#6366f1';
            this.ctx.shadowBlur = 18;
            this.ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
            this.ctx.shadowBlur = 0;

            // Corner accents
            const cornerLength = 22;
            this.ctx.strokeStyle = '#10b981';
            this.ctx.lineWidth = 5;

            // Top-left
            this.ctx.beginPath();
            this.ctx.moveTo(bbox.x, bbox.y + cornerLength);
            this.ctx.lineTo(bbox.x, bbox.y);
            this.ctx.lineTo(bbox.x + cornerLength, bbox.y);
            this.ctx.stroke();

            // Top-right
            this.ctx.beginPath();
            this.ctx.moveTo(bbox.x + bbox.width - cornerLength, bbox.y);
            this.ctx.lineTo(bbox.x + bbox.width, bbox.y);
            this.ctx.lineTo(bbox.x + bbox.width, bbox.y + cornerLength);
            this.ctx.stroke();

            // Bottom-left
            this.ctx.beginPath();
            this.ctx.moveTo(bbox.x, bbox.y + bbox.height - cornerLength);
            this.ctx.lineTo(bbox.x, bbox.y + bbox.height);
            this.ctx.lineTo(bbox.x + cornerLength, bbox.y + bbox.height);
            this.ctx.stroke();

            // Bottom-right
            this.ctx.beginPath();
            this.ctx.moveTo(bbox.x + bbox.width - cornerLength, bbox.y + bbox.height);
            this.ctx.lineTo(bbox.x + bbox.width, bbox.y + bbox.height);
            this.ctx.lineTo(bbox.x + bbox.width, bbox.y + bbox.height - cornerLength);
            this.ctx.stroke();

            // 2. Format AR Label content
            const confPct = Math.round(confidence * 100);
            const titleText = `${emoji || ''} ${label.toUpperCase()}`;
            const subText = `${distance}m · ${direction.toUpperCase()} · ${confPct}%`;
            const ocrLine = ocrText ? `🔤 ${ocrText}` : null;

            // Measure text for background sizing
            this.ctx.font = 'bold 18px Inter, sans-serif';
            const titleWidth = this.ctx.measureText(titleText).width;

            this.ctx.font = '600 14px Inter, sans-serif';
            const subWidth = this.ctx.measureText(subText).width;

            let ocrWidth = 0;
            if (ocrLine) {
                this.ctx.font = 'bold 15px Inter, sans-serif';
                ocrWidth = this.ctx.measureText(ocrLine).width;
            }

            const boxWidth = Math.max(titleWidth, subWidth, ocrWidth) + 36;
            const boxHeight = ocrLine ? 78 : 58;

            // 3. Determine AR Tag Position
            let tagY = bbox.y - boxHeight - 20;
            let pointerY = bbox.y;

            if (tagY < 10) {
                tagY = bbox.y + bbox.height + 20;
                pointerY = bbox.y + bbox.height;
            }

            const tagX = bbox.x + (bbox.width / 2) - (boxWidth / 2);

            // 4. Draw pointer line
            this.ctx.beginPath();
            this.ctx.moveTo(bbox.x + (bbox.width / 2), pointerY);
            this.ctx.lineTo(bbox.x + (bbox.width / 2), tagY + (tagY < bbox.y ? boxHeight : 0));
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            this.ctx.lineWidth = 2.5;
            this.ctx.setLineDash([5, 5]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            // 5. Draw AR Tag Background — yellow accent border when OCR text is present
            this.ctx.fillStyle = 'rgba(10, 10, 26, 0.9)';
            this.ctx.strokeStyle = ocrLine ? 'rgba(250, 204, 21, 0.9)' : 'rgba(99, 102, 241, 0.7)';
            this.ctx.lineWidth = ocrLine ? 2.5 : 2;

            this.ctx.beginPath();
            this.ctx.roundRect(tagX, tagY, boxWidth, boxHeight, 10);
            this.ctx.fill();
            this.ctx.stroke();

            // 6. Draw AR Tag Text
            this.ctx.textAlign = 'center';
            const cx = tagX + boxWidth / 2;

            // Title line (bigger, bolder)
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 18px Inter, sans-serif';
            this.ctx.fillText(titleText, cx, tagY + 24);

            // Sub line (bolder weight)
            this.ctx.fillStyle = '#10b981';
            this.ctx.font = '600 14px Inter, sans-serif';
            this.ctx.fillText(subText, cx, tagY + 44);

            // OCR text line (yellow, bold)
            if (ocrLine) {
                this.ctx.fillStyle = '#facc15';
                this.ctx.font = 'bold 15px Inter, sans-serif';
                this.ctx.fillText(ocrLine, cx, tagY + 66);
            }

            this.ctx.textAlign = 'left';
        });
    }

    /**
     * Set target to search for
     */
    setTarget(target) {
        this.currentTarget = target;
        this.detections = [];
        this._lastCbTime = null;
        this._lastNoDetTime = null;

        // Require fresh scan for every new target
        this._scanComplete = false;
        this._scanRotation = 0;
        this._lastAlpha = null;
        this._startOrientationTracking();

        if (target === 'navigation_default') {
            this.currentSequenceIndex = 0;
            this.detectionCount = 0;
        }
        console.log(`🎯 Target set: ${target} — scan required`);
    }

    /** Begin tracking device rotation via deviceorientation */
    _startOrientationTracking() {
        this._stopOrientationTracking();
        if (this.scanFeedback) this.scanFeedback.start();
        this._onOrientation = (e) => {
            if (this._scanComplete || e.alpha === null) return;
            if (this._lastAlpha === null) { this._lastAlpha = e.alpha; return; }
            let delta = Math.abs(e.alpha - this._lastAlpha);
            if (delta > 180) delta = 360 - delta;
            this._scanRotation = Math.min(this._scanThreshold, this._scanRotation + delta);
            this._lastAlpha = e.alpha;

            const progress = this._scanRotation / this._scanThreshold;
            if (this.scanFeedback) this.scanFeedback.update(progress);

            if (this._scanRotation >= this._scanThreshold) {
                this._scanComplete = true;
                this._stopOrientationTracking();
                if (this.scanFeedback) this.scanFeedback.complete();
                console.log('✅ Scan complete — detection enabled');
                if (this.onDetectionCallback) this.onDetectionCallback({ _scanDone: true });
            }
        };
        window.addEventListener('deviceorientation', this._onOrientation);
    }

    /** Remove orientation listener */
    _stopOrientationTracking() {
        if (this._onOrientation) {
            window.removeEventListener('deviceorientation', this._onOrientation);
            this._onOrientation = null;
        }
        if (this.scanFeedback) this.scanFeedback.stop();
    }

    /**
     * Clear current target
     */
    clearTarget() {
        this.currentTarget = null;
        this.detections = [];
    }

    /**
     * Set simulated obstacle state (from Debug Panel)
     */
    setSimulatedObstacle(active) {
        this.simulatedObstacle = active;
        if (active) {
            this.triggerObstacleWarning();
        }
    }

    /**
     * Trigger an immediate obstacle warning
     */
    triggerObstacleWarning() {
        // Create a fake "Wall" detection
        const wallDetection = {
            label: 'Obstacle',
            confidence: 0.99,
            distance: 1.0, // 1 meter away
            direction: 'ahead',
            emoji: '🧱',
            isObstacle: true,
            bbox: { x: this.canvasElement.width * 0.1, y: this.canvasElement.height * 0.1, width: this.canvasElement.width * 0.8, height: this.canvasElement.height * 0.8 }
        };

        if (this.onDetectionCallback) {
            this.onDetectionCallback(wallDetection);
        }
    }

    /**
     * Set detection callback
     */
    onDetection(callback) {
        this.onDetectionCallback = callback;
    }

    /**
     * Set callback for when user is physically close to target
     * (bounding box >50% of frame width)
     */
    onTargetReached(callback) {
        this.onTargetReachedCallback = callback;
        this._targetReachedFired = false;
    }

    /**
     * Get current detections
     */
    getDetections() {
        return this.detections;
    }

    /**
     * Generate guidance text based on detection with degree-based turning
     */
    generateGuidance(detection) {
        if (!detection) {
            return {
                icon: '🔍',
                text: `Scanning for ${this.currentTarget || 'targets'}...`,
                instruction: this.getScanInstruction('unknown')
            };
        }

        const dirInfo = detection.directionInfo || {
            direction: detection.direction || 'ahead',
            angleDegrees: 0,
            instruction: 'Go straight ahead'
        };

        let guidance = dirInfo.instruction;
        if (detection.distance) guidance += `, ${detection.distance} steps`;

        // Enrich with OCR sign text when available
        let ocrRead = null;
        if (detection.ocrText) {
            ocrRead = detection.ocrText;
            guidance = `Sign reads: "${ocrRead}". ${guidance}`;
        }

        let icon = detection.emoji || '🎯';
        if (dirInfo.direction.includes('left')) icon = '↩️';
        else if (dirInfo.direction.includes('right')) icon = '↪️';
        else if (dirInfo.direction === 'ahead') icon = '⬆️';
        if (ocrRead) icon = '🔤';

        return {
            icon,
            text: `${detection.label} detected: ${guidance}`,
            ocrRead,
            degrees: dirInfo.angleDegrees,
            direction: dirInfo.direction
        };
    }
}

// Export global instance
window.IndoorVision = IndoorVision;
