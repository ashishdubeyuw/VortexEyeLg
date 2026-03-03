/**
 * VortexEye - Logger Module
 * Centralized logging with timestamps, device info, and export capability
 * Logs are persisted to localStorage for durability across page refreshes
 */

class VortexLogger {
    constructor() {
        this.STORAGE_KEY = 'vortexeye_logs';
        this.maxLogs = 1000; // Keep last 1000 entries
        this.sessionId = this.generateSessionId();
        this.deviceInfo = this.getDeviceInfo();

        // GitHub Offline Logging Config
        this.gitDir = '/vortexeye-logs';
        this.gitRepoUrl = 'https://github.com/ashishdubeyuw/VortexEyeLg';
        this.gitToken = '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'; // Replace with a valid GitHub PAT for testing

        // Load existing logs from localStorage
        this.logs = this.loadFromStorage();

        // Auto-save every 10 seconds
        this.autoSaveInterval = setInterval(() => this.saveToStorage(), 10000);

        // Save on page unload
        window.addEventListener('beforeunload', () => this.saveToStorage());

        // Initialize isomorphic-git repository for offline syncing
        this.initGitRepo();

        // Auto-sync when device comes online
        window.addEventListener('online', () => {
            console.log('🌐 Device is online, attempting to sync logs to GitHub...');
            this.syncToGitHub();
        });

        // Also attempt a sync on startup if online
        if (navigator.onLine) {
            setTimeout(() => this.syncToGitHub().catch(e => console.error('Startup sync failed:', e)), 5000);
        }

        // Periodic sync every 60 seconds
        this._syncInterval = setInterval(async () => {
            if (navigator.onLine) {
                try {
                    await this.syncToGitHub();
                } catch (e) {
                    console.error('Periodic sync failed:', e);
                }
            }
        }, 60000);

        console.log('📋 VortexEye Logger initialized (localStorage enabled)');
        this.info('Logger', 'Session started', { sessionId: this.sessionId, device: this.deviceInfo });
    }

    /**
     * Load logs from localStorage
     */
    loadFromStorage() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                console.log(`📋 Loaded ${data.length} logs from localStorage`);
                return data;
            }
        } catch (e) {
            console.warn('Failed to load logs from localStorage:', e);
        }
        return [];
    }

    /**
     * Write logs asynchronously to lightning-fs
     */
    async writeLogsToFs() {
        if (!window.pfs) return;
        try {
            const filename = `${this.gitDir}/session-${this.sessionId}.json`;
            const content = this.exportJSON();
            // Use isomorphic-git compatible virtual fs
            await window.pfs.writeFile(filename, content, 'utf8');
        } catch (e) {
            console.warn('Failed to write logs to virtual FS:', e);
        }
    }

    /**
     * Save logs to localStorage
     */
    saveToStorage() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.logs));
            // Also write to our virtual filesystem
            this.writeLogsToFs();
        } catch (e) {
            console.warn('Failed to save logs to localStorage:', e);
            // If storage is full, trim older logs
            if (e.name === 'QuotaExceededError') {
                this.logs = this.logs.slice(-500);
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.logs));
            }
        }
    }

    /**
     * Clear logs from localStorage
     */
    clearStorage() {
        localStorage.removeItem(this.STORAGE_KEY);
        this.logs = [];
        console.log('📋 Logs cleared from localStorage');
    }

    /**
     * Generate unique session ID
     */
    generateSessionId() {
        return `VE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Stable device fingerprint for log filename
     * Same device always maps to the same file in GitHub
     */
    getDeviceId() {
        const ua = navigator.userAgent;
        const os = ua.includes('Android') ? 'android'
            : ua.includes('iPhone') ? 'iphone'
                : ua.includes('iPad') ? 'ipad'
                    : ua.includes('Mac') ? 'mac'
                        : ua.includes('Windows') ? 'win' : 'unknown';
        const model = ua.match(/(?:Android [\d.]+; )([^;)]+)/)?.[1]
            || ua.match(/(?:iPhone|iPad);[^)]*([A-Z]+\d+[^;)]*)/)?.[1]
            || os;
        let slug = model.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 24);
        // Guard: blank or too-short slug (some Android UAs fail the regex)
        if (!slug || slug.length < 3) slug = os;
        const res = `${screen.width}x${screen.height}`;
        return `${os}-${slug}-${res}`;
    }

    /**
     * Get device/browser information
     */
    getDeviceInfo() {
        const ua = navigator.userAgent;
        let device = 'Unknown';
        let browser = 'Unknown';
        let os = 'Unknown';

        // Detect OS
        if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
        else if (ua.includes('Android')) os = 'Android';
        else if (ua.includes('Mac')) os = 'macOS';
        else if (ua.includes('Windows')) os = 'Windows';
        else if (ua.includes('Linux')) os = 'Linux';

        // Detect browser
        if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
        else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
        else if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Edg')) browser = 'Edge';

        // Detect device type
        if (ua.includes('Mobile')) device = 'Mobile';
        else if (ua.includes('Tablet') || ua.includes('iPad')) device = 'Tablet';
        else device = 'Desktop';

        return {
            device,
            browser,
            os,
            userAgent: ua,
            screenWidth: screen.width,
            screenHeight: screen.height,
            language: navigator.language
        };
    }

    /**
     * Format timestamp
     */
    getTimestamp() {
        const now = new Date();
        return {
            iso: now.toISOString(),
            local: now.toLocaleString(),
            unix: now.getTime()
        };
    }

    /**
     * Core log function
     */
    log(level, category, message, data = null) {
        const entry = {
            id: this.logs.length + 1,
            timestamp: this.getTimestamp(),
            level,
            category,
            message,
            data,
            sessionId: this.sessionId
        };

        // Add to logs array
        this.logs.push(entry);

        // Trim if too many logs
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        // Console output with styling
        const emoji = this.getLevelEmoji(level);
        const style = this.getLevelStyle(level);
        console.log(
            `%c${emoji} [${entry.timestamp.local}] [${category}] ${message}`,
            style,
            data || ''
        );

        return entry;
    }

    /**
     * Get emoji for log level
     */
    getLevelEmoji(level) {
        const emojis = {
            'DEBUG': '🔍',
            'INFO': 'ℹ️',
            'QUERY': '🔎',
            'RESULT': '✅',
            'WARN': '⚠️',
            'ERROR': '❌',
            'NAV': '🧭',
            'GPS': '📍',
            'VOICE': '🎤',
            'VISION': '👁️'
        };
        return emojis[level] || '📋';
    }

    /**
     * Get console style for log level
     */
    getLevelStyle(level) {
        const styles = {
            'DEBUG': 'color: #888',
            'INFO': 'color: #3b82f6',
            'QUERY': 'color: #f59e0b; font-weight: bold',
            'RESULT': 'color: #10b981; font-weight: bold',
            'WARN': 'color: #f59e0b',
            'ERROR': 'color: #ef4444; font-weight: bold',
            'NAV': 'color: #6366f1',
            'GPS': 'color: #14b8a6',
            'VOICE': 'color: #8b5cf6',
            'VISION': 'color: #ec4899'
        };
        return styles[level] || 'color: #333';
    }

    // Convenience methods
    debug(category, message, data) { return this.log('DEBUG', category, message, data); }
    info(category, message, data) { return this.log('INFO', category, message, data); }
    warn(category, message, data) { return this.log('WARN', category, message, data); }
    error(category, message, data) { return this.log('ERROR', category, message, data); }

    // Specialized logging for VortexEye features
    query(query, context = {}) {
        return this.log('QUERY', 'Search', `Query: "${query}"`, {
            query,
            ...context,
            position: context.position ? `${context.position.lat.toFixed(6)}, ${context.position.lng.toFixed(6)}` : null
        });
    }

    result(query, result, duration = null) {
        return this.log('RESULT', 'Search', `Result for "${query}"`, {
            query,
            result: result ? {
                lat: result.lat?.toFixed(6),
                lng: result.lng?.toFixed(6),
                name: result.displayName
            } : null,
            found: !!result,
            durationMs: duration
        });
    }

    navigation(action, details) {
        return this.log('NAV', 'Navigation', action, details);
    }

    gps(action, position = null) {
        return this.log('GPS', 'Location', action, position ? {
            lat: position.lat?.toFixed(6),
            lng: position.lng?.toFixed(6),
            accuracy: position.accuracy
        } : null);
    }

    voice(action, transcript = null) {
        return this.log('VOICE', 'Voice', action, { transcript });
    }

    vision(action, detections = null) {
        return this.log('VISION', 'Indoor', action, { detections });
    }

    /**
     * Get all logs
     */
    getLogs() {
        return this.logs;
    }

    /**
     * Get logs filtered by category or level
     */
    filter(options = {}) {
        let filtered = [...this.logs];

        if (options.level) {
            filtered = filtered.filter(l => l.level === options.level);
        }
        if (options.category) {
            filtered = filtered.filter(l => l.category === options.category);
        }
        if (options.since) {
            filtered = filtered.filter(l => l.timestamp.unix >= options.since);
        }

        return filtered;
    }

    /**
     * Export logs as JSON
     */
    exportJSON() {
        const exportData = {
            exportTime: new Date().toISOString(),
            sessionId: this.sessionId,
            device: this.deviceInfo,
            totalLogs: this.logs.length,
            logs: this.logs
        };

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Upload logs to server
     */
    async uploadLogs() {
        try {
            const data = {
                sessionId: this.sessionId,
                device: this.deviceInfo,
                exportTime: new Date().toISOString(),
                logs: this.logs
            };

            const response = await fetch('/api/logs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('✅ Logs uploaded successfully:', result);
                this.info('Logger', 'Logs uploaded to server', { file: result.file });
                return true;
            } else {
                throw new Error(`Server returned ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to upload logs:', error);
            this.warn('Logger', 'Log upload failed', { error: error.message });
            return false;
        }
    }

    /**
     * Initialize Git Repository for offline sync
     */
    async initGitRepo() {
        if (!window.fs || !window.pfs || !window.git) {
            console.warn('Isomorphic-git not loaded properly.');
            return;
        }

        try {
            // Check if dir exists
            try {
                await window.pfs.stat(this.gitDir);
            } catch (e) {
                // Directory doesn't exist, create it
                await window.pfs.mkdir(this.gitDir);
                // Initialize git repository
                await window.git.init({ fs: window.fs, dir: this.gitDir, defaultBranch: 'main' });
                await window.git.addRemote({
                    fs: window.fs,
                    dir: this.gitDir,
                    remote: 'origin',
                    url: this.gitRepoUrl
                });
                console.log('📋 Initialized offline git repository at', this.gitDir);
            }
        } catch (e) {
            console.error('Failed to initialize git repository:', e);
        }
    }

    /**
     * Sync logs to GitHub as human-readable .txt, appending to a device-stable file
     */
    async syncToGitHub() {
        if (!this.gitToken || this.gitToken === 'UPDATE_ME_WITH_YOUR_PAT') {
            console.error('❌ GitHub PAT not configured.');
            return { success: false, error: 'No PAT configured' };
        }

        console.group('🔵 GitHub Sync Attempt');
        console.log('Device ID:', this.getDeviceId(), '| Online:', navigator.onLine, '| Logs:', this.logs.length);

        try {
            const deviceId = this.getDeviceId();
            const filename = `logs/${deviceId}.txt`;
            const apiUrl = `https://api.github.com/repos/ashishdubeyuw/VortexEyeLg/contents/${filename}`;
            const headers = {
                'Authorization': `token ${this.gitToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'VortexEye'
            };

            const _fetchFileMeta = async () => {
                try {
                    const ck = await fetch(apiUrl, { headers });
                    if (ck.ok) {
                        const j = await ck.json();
                        // UTF-8 safe base64 decode (handles emoji in existing logs)
                        const raw = j.content.replace(/\n/g, '');
                        let text = '';
                        try {
                            const bin = atob(raw);
                            const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
                            text = new TextDecoder().decode(bytes);
                        } catch (_decErr) {
                            // Fallback: if decoding fails, start fresh
                            console.warn('Existing log decode failed, will overwrite');
                            text = '';
                        }
                        return { sha: j.sha, text };
                    }
                } catch (_) { }
                return { sha: null, text: '' };
            };

            let { sha: existingSha, text: existingText } = await _fetchFileMeta();
            console.log('Existing file SHA:', existingSha || 'none (new file)');

            const since = this._lastSyncedLogCount || 0;
            const newLogs = this.logs.slice(since);
            if (newLogs.length === 0 && existingSha) {
                console.log('📌 No new logs since last sync');
                console.groupEnd();
                return { success: true };
            }

            const divider = '='.repeat(72);
            const newBlock = [
                divider,
                `SYNC  : ${new Date().toLocaleString()}`,
                `DEVICE: ${deviceId}  |  OS: ${this.deviceInfo.os}  |  Browser: ${this.deviceInfo.browser}`,
                `SCREEN: ${this.deviceInfo.screenWidth}x${this.deviceInfo.screenHeight}`,
                `NEW ENTRIES: ${newLogs.length}  (total session: ${this.logs.length})`,
                divider,
                ...newLogs.map(log => {
                    const emoji = this.getLevelEmoji(log.level);
                    const t = log.timestamp.local;
                    const data = log.data ? `  >>  ${JSON.stringify(log.data)}` : '';
                    return `[${t}]  ${emoji}  [${log.level.padEnd(6)}]  [${log.category}]  ${log.message}${data}`;
                }),
                ''
            ].join('\n');

            const fullText = existingText ? existingText + '\n' + newBlock : newBlock;

            // UTF-8 safe base64 encoding (works on all mobile browsers)
            const _toB64 = (str) => {
                const bytes = new TextEncoder().encode(str);
                let bin = '';
                bytes.forEach(b => bin += String.fromCharCode(b));
                return btoa(bin);
            };
            const content = _toB64(fullText);

            const body = {
                message: `[VortexEye] ${deviceId} +${newLogs.length} entries — ${new Date().toISOString()}`,
                content,
                branch: 'main'
            };
            if (existingSha) body.sha = existingSha;

            console.log(`Pushing ${newLogs.length} new entries to ${filename}...`);
            let resp = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });

            // 422 = SHA conflict (race condition) — retry once with fresh SHA
            if (resp.status === 422) {
                console.warn('⚠️ 422 SHA conflict — re-fetching and retrying...');
                const fresh = await _fetchFileMeta();
                if (fresh.sha) body.sha = fresh.sha;
                resp = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });
            }

            if (resp.ok || resp.status === 201) {
                this._lastSyncedLogCount = this.logs.length;
                console.log(`✅ Synced to GitHub: ${filename} (+${newLogs.length} lines)`);
                console.groupEnd();
                this.info('Logger', 'GitHub sync OK', { file: filename, added: newLogs.length });
                return { success: true };
            } else {
                const errText = await resp.text();
                throw new Error(`GitHub API ${resp.status}: ${errText}`);
            }
        } catch (error) {
            console.error('❌ GitHub sync failed:', error.message);
            console.groupEnd();
            this.error('Logger', 'GitHub sync failed', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Download logs as JSON file
     */
    downloadLogs() {
        const json = this.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `vortexeye-logs-${this.sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.info('Logger', 'Logs downloaded (JSON)', { filename: a.download });

        // Also try to upload to server
        this.uploadLogs();
    }

    /**
     * Export logs as plain text
     */
    exportText() {
        const lines = [];
        const divider = '='.repeat(80);

        // Header
        lines.push(divider);
        lines.push('VORTEXEYE NAVIGATION LOG');
        lines.push(divider);
        lines.push(`Session ID: ${this.sessionId}`);
        lines.push(`Export Time: ${new Date().toLocaleString()}`);
        lines.push(`Device: ${this.deviceInfo.device} | ${this.deviceInfo.browser} | ${this.deviceInfo.os}`);
        lines.push(`Screen: ${this.deviceInfo.screenWidth}x${this.deviceInfo.screenHeight}`);
        lines.push(`Total Entries: ${this.logs.length}`);
        lines.push(divider);
        lines.push('');

        // Log entries
        this.logs.forEach(log => {
            const emoji = this.getLevelEmoji(log.level);
            const time = log.timestamp.local;
            const dataStr = log.data ? ` | Data: ${JSON.stringify(log.data)}` : '';

            lines.push(`[${time}] ${emoji} [${log.level}] [${log.category}] ${log.message}${dataStr}`);
        });

        lines.push('');
        lines.push(divider);
        lines.push('END OF LOG');
        lines.push(divider);

        return lines.join('\n');
    }

    /**
     * Download logs as plain text file
     */
    downloadTextLogs() {
        const text = this.exportText();
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `vortexeye-logs-${this.sessionId}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.info('Logger', 'Logs downloaded (TXT)', { filename: a.download });
    }

    /**
     * Print summary to console
     */
    printSummary() {
        const summary = {
            sessionId: this.sessionId,
            device: this.deviceInfo,
            totalLogs: this.logs.length,
            byLevel: {},
            byCategory: {}
        };

        this.logs.forEach(log => {
            summary.byLevel[log.level] = (summary.byLevel[log.level] || 0) + 1;
            summary.byCategory[log.category] = (summary.byCategory[log.category] || 0) + 1;
        });

        console.table(summary.byLevel);
        console.table(summary.byCategory);

        return summary;
    }

    /**
     * Clear all logs
     */
    clear() {
        this.logs = [];
        this.info('Logger', 'Logs cleared');
    }
}

// Create global logger instance
window.vxLog = new VortexLogger();

// Convenience function for quick logging
window.log = (message, data) => window.vxLog.info('App', message, data);
