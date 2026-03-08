/**
 * VortexEye — Native Voice Engine
 * Unified TTS + STT wrapper for Capacitor native plugins
 * with transparent Web Speech API fallback for PWA mode.
 *
 * Replaces voice-interface.js with mission-critical reliability:
 *  - Native TTS: @capacitor-community/text-to-speech
 *  - Native STT: @capacitor-community/speech-recognition
 *  - Fallback:   Web Speech API (browser/PWA)
 */

class NativeVoice {
    constructor() {
        this.isListening = false;
        this.onResultCallback = null;
        this.onListeningChangeCallback = null;

        this.audioEnabled = localStorage.getItem('vortex_audio_enabled') !== 'false';
        this.audioUnlocked = false;

        // Detect Capacitor native plugins
        this._tts = null;
        this._stt = null;
        this._useNative = false;
        this._initNative();

        // Web Speech API fallback refs
        this._webSynth = window.speechSynthesis || null;
        this._webRecog = null;
        this._initWebFallback();
    }

    async _initNative() {
        try {
            const cap = window.Capacitor;
            if (!cap || !cap.isNativePlatform()) return;

            const tts = cap.Plugins?.TextToSpeech;
            const stt = cap.Plugins?.SpeechRecognition;
            if (!tts || !stt) return;

            // Capability probe with timeout — Capacitor proxies are truthy
            // even when the plugin isn't installed, so we must verify with
            // a real call. If it hangs or throws, fall back to Web Speech.
            const probe = (fn, ms = 2000) => new Promise((res, rej) => {
                const timer = setTimeout(() => rej(new Error('timeout')), ms);
                fn().then(r => { clearTimeout(timer); res(r); })
                    .catch(e => { clearTimeout(timer); rej(e); });
            });

            await probe(() => tts.getSupportedLanguages());

            this._tts = tts;
            this._stt = stt;
            this._useNative = true;

            const perm = await this._stt.checkPermissions().catch(() => ({}));
            if (perm.speechRecognition !== 'granted') {
                await this._stt.requestPermissions().catch(() => { });
            }
            console.log('Native Voice Engine: TTS + STT verified and ready');
        } catch (e) {
            console.warn('Native Voice probe failed, using Web Speech fallback:', e.message);
            this._tts = null;
            this._stt = null;
            this._useNative = false;
        }
    }

    _initWebFallback() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        this._webRecog = new SR();
        this._webRecog.continuous = false;
        this._webRecog.interimResults = false;
        this._webRecog.lang = 'en-US';

        this._webRecog.onstart = () => {
            this.isListening = true;
            if (this.onListeningChangeCallback) this.onListeningChangeCallback(true);
        };
        this._webRecog.onend = () => {
            this.isListening = false;
            if (this.onListeningChangeCallback) this.onListeningChangeCallback(false);
        };
        this._webRecog.onresult = (e) => {
            const t = e.results[0][0].transcript;
            console.log('🎤 Heard:', t);
            if (this.onResultCallback) this.onResultCallback(t);
        };
        this._webRecog.onerror = (e) => {
            console.error('STT error:', e.error);
            this.isListening = false;
            if (this.onListeningChangeCallback) this.onListeningChangeCallback(false);
        };

        // Android WebView voices load async
        if (this._webSynth) {
            this._webSynth.onvoiceschanged = () => {
                console.log('🗣️ TTS Voices loaded:', this._webSynth.getVoices().length);
            };
        }
    }

    // ── Public API (same surface as VoiceInterface) ──────────────

    unlockAudio() {
        if (this._useNative || this.audioUnlocked || !this.audioEnabled) return;
        try {
            if (this._webSynth) {
                const u = new SpeechSynthesisUtterance('ready');
                u.volume = 0;
                this._webSynth.speak(u);
            }
            this.audioUnlocked = true;
        } catch (_) { }
    }

    setAudioEnabled(enabled) {
        this.audioEnabled = enabled;
        localStorage.setItem('vortex_audio_enabled', enabled);
        if (enabled) this.speak('Voice audio enabled');
        else this.cancel();
    }

    /** High-priority cancel — immediate stop for obstacle overrides */
    async cancel() {
        try {
            if (this._useNative && this._tts) {
                await this._tts.stop();
            } else if (this._webSynth) {
                this._webSynth.cancel();
            }
        } catch (_) { }
    }

    /**
     * Speak text. Returns Promise.
     * For obstacle interrupt: call cancel() first, then speak().
     */
    async speak(text, options = {}) {
        if (!this.audioEnabled) {
            console.log('🔇 Audio disabled:', text);
            return;
        }

        if (this._useNative && this._tts) {
            return this._speakNative(text, options);
        }
        return this._speakWeb(text, options);
    }

    async _speakNative(text, opts) {
        try {
            await this._tts.speak({
                text,
                lang: opts.lang || 'en-US',
                rate: opts.rate || 1.0,
                pitch: opts.pitch || 1.0,
                volume: opts.volume || 1.0,
                category: 'ambient'
            });
            console.log('🔊 [Native] Speaking:', text);
        } catch (e) {
            console.warn('Native TTS error, falling back:', e);
            return this._speakWeb(text, opts);
        }
    }

    _speakWeb(text, opts) {
        return new Promise((resolve, reject) => {
            if (!this._webSynth) { reject('Not supported'); return; }
            this._webSynth.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = opts.rate || 1.0;
            u.pitch = opts.pitch || 1.0;
            u.volume = opts.volume || 1.0;
            u.lang = opts.lang || 'en-US';

            const voices = this._webSynth.getVoices();
            const pref = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Samantha') || v.name.includes('Google')))
                || voices.find(v => v.lang.startsWith('en'));
            if (pref) u.voice = pref;
            else if (voices.length) u.voice = voices[0];

            u.onend = () => resolve();
            u.onerror = (e) => reject(e);
            this._webSynth.speak(u);
            if (this._webSynth.resume) this._webSynth.resume();
            console.log('🔊 [Web] Speaking:', text);
        });
    }

    async startListening() {
        if (this.isListening) { this.stopListening(); return false; }

        if (this._useNative && this._stt) {
            return this._listenNative();
        }
        return this._listenWeb();
    }

    async _listenNative() {
        try {
            this.isListening = true;
            if (this.onListeningChangeCallback) this.onListeningChangeCallback(true);
            console.log('🎤 [Native] Listening...');

            const result = await this._stt.start({
                language: 'en-US',
                partialResults: false,
                popup: false
            });

            this.isListening = false;
            if (this.onListeningChangeCallback) this.onListeningChangeCallback(false);

            if (result.matches && result.matches.length > 0) {
                const t = result.matches[0];
                console.log('🎤 [Native] Heard:', t);
                if (this.onResultCallback) this.onResultCallback(t);
            }
            return true;
        } catch (e) {
            console.error('Native STT error:', e);
            this.isListening = false;
            if (this.onListeningChangeCallback) this.onListeningChangeCallback(false);
            return false;
        }
    }

    _listenWeb() {
        if (!this._webRecog) { console.warn('STT not available'); return false; }
        try {
            this._webRecog.start();
            return true;
        } catch (e) {
            console.error('Web STT error:', e);
            return false;
        }
    }

    stopListening() {
        if (this._useNative && this._stt) {
            this._stt.stop().catch(() => { });
        } else if (this._webRecog && this.isListening) {
            this._webRecog.stop();
        }
        this.isListening = false;
    }

    // ── NLP Intent Parser (identical logic from VoiceInterface) ──

    parseIntent(transcript) {
        const text = transcript.toLowerCase().trim();
        if (!text) return { type: 'unknown' };

        if (/(?:stop|cancel|never mind|quit)/i.test(text)) {
            return { type: 'stop' };
        }

        // Wheelchair mode toggle
        if (/wheelchair\s*mode\s*(on|enable)/i.test(text)) return { type: 'wheelchair', enabled: true };
        if (/wheelchair\s*mode\s*(off|disable)/i.test(text)) return { type: 'wheelchair', enabled: false };

        const indoorPOIs = ['exit', 'elevator', 'lift', 'stairs', 'restroom',
            'bathroom', 'door', 'meeting room', 'signboard'];

        const poiMatch = text.match(
            /(?:find(?: the)?|where is(?: the)?|take me to(?: the)?)\s+(exit|elevator|lift|stairs|restroom|bathroom|door|meeting room|signboard)/i
        );
        if (poiMatch) return { type: 'indoor_poi', target: this.normalizeTarget(poiMatch[1]) };
        if (indoorPOIs.includes(text)) return { type: 'indoor_poi', target: this.normalizeTarget(text) };

        const navMatch = text.match(/(?:take me to|go to|navigate to|find|where is|how do i get to)\s+(.+)/i);
        const dest = navMatch ? navMatch[1].trim() : text;
        return { type: 'navigate', destination: dest };
    }

    normalizeTarget(target) {
        const m = { 'lift': 'elevator', 'bathroom': 'restroom', 'toilet': 'restroom', 'way out': 'exit', 'emergency': 'emergency_exit' };
        target = target.toLowerCase().trim();
        return m[target] || target;
    }

    // ── Callback Setters ──

    onResult(callback) { this.onResultCallback = callback; }
    onListeningChange(callback) { this.onListeningChangeCallback = callback; }
    isSupported() { return this._useNative || !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
    isSynthesisSupported() { return this._useNative || !!window.speechSynthesis; }
}

window.NativeVoice = NativeVoice;
