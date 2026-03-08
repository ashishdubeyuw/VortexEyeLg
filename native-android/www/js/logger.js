/**
 * VortexEye - Privacy-first Logger Module
 * Minimal, local-only diagnostics with explicit user consent.
 */

class VortexLogger {
    constructor() {
        this.maxLogs = 250;
        this.logs = [];
        this.privacyKey = 'vortex_privacy_consent';
        this.diagnosticsKey = 'vortex_diagnostics_enabled';
        this.refreshPrivacySettings();

        console.log('📋 VortexEye Logger initialized (local-only diagnostics)');
        if (this.diagnosticsEnabled) {
            this.info('Logger', 'Local diagnostics enabled');
        }
    }

    refreshPrivacySettings() {
        this.consentGranted = localStorage.getItem(this.privacyKey) === 'granted';
        this.diagnosticsEnabled = this.consentGranted && localStorage.getItem(this.diagnosticsKey) === 'true';
    }

    setConsent(granted) {
        localStorage.setItem(this.privacyKey, granted ? 'granted' : 'declined');
        if (!granted) {
            localStorage.setItem(this.diagnosticsKey, 'false');
            this.logs = [];
        } else if (!localStorage.getItem(this.diagnosticsKey)) {
            localStorage.setItem(this.diagnosticsKey, 'true');
        }
        this.refreshPrivacySettings();
        this.info('Privacy', granted ? 'Local diagnostics consent granted' : 'Local diagnostics declined');
    }

    setDiagnosticsEnabled(enabled) {
        const value = this.consentGranted && Boolean(enabled);
        localStorage.setItem(this.diagnosticsKey, value ? 'true' : 'false');
        this.refreshPrivacySettings();
        this.info('Privacy', value ? 'Local diagnostics enabled' : 'Local diagnostics disabled');
    }

    getTimestamp() {
        const now = new Date();
        return {
            iso: now.toISOString(),
            local: now.toLocaleString(),
            unix: now.getTime()
        };
    }

    sanitizeData(category, data) {
        if (!data || typeof data !== 'object') return null;

        switch (category) {
            case 'Location':
                return {
                    accuracy: data.accuracy ?? null,
                    heading: data.heading ?? null,
                    speed: data.speed ?? null
                };
            case 'Search':
                return {
                    queryLength: typeof data.query === 'string' ? data.query.length : undefined,
                    found: data.found,
                    durationMs: data.durationMs,
                    resultName: typeof data.result?.name === 'string' ? data.result.name.slice(0, 80) : undefined
                };
            case 'Voice':
                return {
                    captured: Boolean(data.transcript),
                    transcriptLength: typeof data.transcript === 'string' ? data.transcript.length : 0
                };
            case 'Indoor':
                return {
                    detectionCount: Array.isArray(data.detections) ? data.detections.length : undefined
                };
            default: {
                const sanitized = {};
                Object.entries(data).forEach(([key, value]) => {
                    if (['lat', 'lng', 'latitude', 'longitude', 'position', 'sessionId', 'device', 'userAgent'].includes(key)) {
                        return;
                    }
                    if (typeof value === 'string') {
                        sanitized[key] = value.slice(0, 120);
                    } else if (typeof value === 'number' || typeof value === 'boolean') {
                        sanitized[key] = value;
                    }
                });
                return Object.keys(sanitized).length ? sanitized : null;
            }
        }
    }

    shouldStore(level) {
        return this.diagnosticsEnabled || level === 'ERROR' || level === 'WARN';
    }

    log(level, category, message, data = null) {
        const sanitized = this.sanitizeData(category, data);
        const emoji = this.getLevelEmoji(level);
        const style = this.getLevelStyle(level);
        console.log(`%c${emoji} [${category}] ${message}`, style, sanitized || '');

        if (!this.shouldStore(level)) {
            return null;
        }

        const entry = {
            id: this.logs.length + 1,
            timestamp: this.getTimestamp(),
            level,
            category,
            message,
            data: sanitized
        };

        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        return entry;
    }

    getLevelEmoji(level) {
        const emojis = {
            DEBUG: '🔍',
            INFO: 'ℹ️',
            QUERY: '🔎',
            RESULT: '✅',
            WARN: '⚠️',
            ERROR: '❌',
            NAV: '🧭',
            GPS: '📍',
            VOICE: '🎤',
            VISION: '👁️'
        };
        return emojis[level] || '📋';
    }

    getLevelStyle(level) {
        const styles = {
            DEBUG: 'color: #888',
            INFO: 'color: #3b82f6',
            QUERY: 'color: #f59e0b; font-weight: bold',
            RESULT: 'color: #10b981; font-weight: bold',
            WARN: 'color: #f59e0b',
            ERROR: 'color: #ef4444; font-weight: bold',
            NAV: 'color: #6366f1',
            GPS: 'color: #14b8a6',
            VOICE: 'color: #8b5cf6',
            VISION: 'color: #ec4899'
        };
        return styles[level] || 'color: #333';
    }

    debug(category, message, data) { return this.log('DEBUG', category, message, data); }
    info(category, message, data) { return this.log('INFO', category, message, data); }
    warn(category, message, data) { return this.log('WARN', category, message, data); }
    error(category, message, data) { return this.log('ERROR', category, message, data); }

    query(query, context = {}) {
        return this.log('QUERY', 'Search', 'Query received', {
            query,
            hasPosition: Boolean(context.position)
        });
    }

    result(query, result, duration = null) {
        return this.log('RESULT', 'Search', 'Search completed', {
            query,
            result: result ? { name: result.displayName } : null,
            found: Boolean(result),
            durationMs: duration
        });
    }

    navigation(action, details) {
        return this.log('NAV', 'Navigation', action, details);
    }

    gps(action, position = null) {
        return this.log('GPS', 'Location', action, position || null);
    }

    voice(action, transcript = null) {
        return this.log('VOICE', 'Voice', action, { transcript });
    }

    vision(action, detections = null) {
        return this.log('VISION', 'Indoor', action, { detections });
    }

    getLogs() {
        return [...this.logs];
    }

    exportJSON() {
        return JSON.stringify({
            exportTime: new Date().toISOString(),
            diagnosticsEnabled: this.diagnosticsEnabled,
            totalLogs: this.logs.length,
            logs: this.logs
        }, null, 2);
    }

    exportText() {
        const lines = [];
        const divider = '='.repeat(80);
        lines.push(divider);
        lines.push('VORTEXEYE LOCAL DIAGNOSTIC LOG');
        lines.push(divider);
        lines.push(`Export Time: ${new Date().toLocaleString()}`);
        lines.push(`Diagnostics Enabled: ${this.diagnosticsEnabled ? 'Yes' : 'No'}`);
        lines.push(`Total Entries: ${this.logs.length}`);
        lines.push(divider);
        lines.push('');

        this.logs.forEach((log) => {
            const emoji = this.getLevelEmoji(log.level);
            const dataStr = log.data ? ` | Data: ${JSON.stringify(log.data)}` : '';
            lines.push(`[${log.timestamp.local}] ${emoji} [${log.level}] [${log.category}] ${log.message}${dataStr}`);
        });

        lines.push('');
        lines.push(divider);
        lines.push('END OF LOG');
        lines.push(divider);
        return lines.join('\n');
    }

    downloadLogs() {
        const json = this.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vortexeye-local-diagnostics.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.info('Logger', 'Logs downloaded locally');
    }

    downloadTextLogs() {
        const text = this.exportText();
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vortexeye-local-diagnostics.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.info('Logger', 'Text logs downloaded locally');
    }

    clear() {
        this.logs = [];
        this.info('Logger', 'Logs cleared');
    }
}

window.vxLog = new VortexLogger();
window.log = (message, data) => window.vxLog.info('App', message, data);
