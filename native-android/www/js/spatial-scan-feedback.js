/**
 * VortexEye — Spatial Scan-Gate Feedback
 * Accessibility-first audio/haptic cues for the 40° camera rotation gate.
 * Uses Web Audio API StereoPannerNode for left→right spatial sweep
 * and Capacitor Haptics plugin for synchronized vibration pulses.
 */

class SpatialScanFeedback {
    constructor() {
        this.ctx = null;
        this.tickTimer = null;
        this.active = false;
        this.progress = 0;

        // Tick cadence bounds (ms)
        this.TICK_MAX_MS = 800;
        this.TICK_MIN_MS = 80;

        // Tone config
        this.TICK_FREQ = 880;      // A5
        this.TICK_DUR = 0.06;     // 60ms burst
        this.CHIME_NOTES = [523.25, 659.25, 783.99]; // C5 E5 G5

        // Capacitor Haptics (feature-detected at runtime)
        this._haptics = null;
        this._initHaptics();
    }

    async _initHaptics() {
        try {
            if (window.Capacitor?.Plugins?.Haptics) {
                this._haptics = window.Capacitor.Plugins.Haptics;
            }
        } catch (_) { /* PWA fallback — no haptics */ }
    }

    _ensureAudioCtx() {
        if (!this.ctx || this.ctx.state === 'closed') {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    /** Begin the Geiger-counter tick loop */
    start() {
        if (this.active) return;
        this._ensureAudioCtx();
        this.active = true;
        this.progress = 0;
        this._scheduleTick();
    }

    /** Update progress (0.0 → 1.0) each orientation delta */
    update(progress) {
        this.progress = Math.min(1, Math.max(0, progress));
    }

    /** Fire success chime + haptic burst, then stop */
    complete() {
        this._clearTick();
        this._ensureAudioCtx();
        this._playChime();
        this._hapticBurst();
        this.active = false;
    }

    /** Abort feedback immediately */
    stop() {
        this._clearTick();
        this.active = false;
        this.progress = 0;
    }

    // ── Private ──────────────────────────────────────────────

    _scheduleTick() {
        if (!this.active) return;
        const interval = this.TICK_MAX_MS - (this.TICK_MAX_MS - this.TICK_MIN_MS) * this.progress;
        this.tickTimer = setTimeout(() => {
            this._playTick();
            this._hapticTap();
            this._scheduleTick();
        }, interval);
    }

    _clearTick() {
        if (this.tickTimer) { clearTimeout(this.tickTimer); this.tickTimer = null; }
    }

    _playTick() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const pan = this.ctx.createStereoPanner();

        // Stereo sweep: left ear at 0%, right ear at 100%
        pan.pan.value = (this.progress * 2) - 1; // -1 → +1

        osc.type = 'sine';
        osc.frequency.value = this.TICK_FREQ + (this.progress * 440); // pitch rises slightly

        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + this.TICK_DUR);

        osc.connect(gain).connect(pan).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + this.TICK_DUR);
    }

    _playChime() {
        if (!this.ctx) return;
        let t = this.ctx.currentTime;

        this.CHIME_NOTES.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const start = t + i * 0.15;

            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.5, start);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);

            osc.connect(gain).connect(this.ctx.destination);
            osc.start(start);
            osc.stop(start + 0.35);
        });
    }

    async _hapticTap() {
        try {
            if (this._haptics) await this._haptics.impact({ style: 'LIGHT' });
            else if (navigator.vibrate) navigator.vibrate(15);
        } catch (_) { }
    }

    async _hapticBurst() {
        try {
            if (this._haptics) await this._haptics.notification({ type: 'SUCCESS' });
            else if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 100]);
        } catch (_) { }
    }
}

window.SpatialScanFeedback = SpatialScanFeedback;
