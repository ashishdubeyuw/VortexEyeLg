window.VortexEyeOTASecurity = (() => {
    const OTA_BRANCH = 'copilot/native-android-hardening';
    const MANIFEST_URL = `https://raw.githubusercontent.com/ashishdubeyuw/VortexEyeLg/${OTA_BRANCH}/version.json`;
    const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjGZ0NhEmbhrKKyQIzKInwxbtHzTI
PKb3fP4i1hhfLcjl9PxA2SsJDIdQLSH6DJAZchYOYyLu8mfUoLDOvF4puA==
-----END PUBLIC KEY-----`;

    function canonicalManifest(manifest) {
        return JSON.stringify({
            version: manifest.version,
            url: manifest.url,
            notes: manifest.notes || '',
            sha256: manifest.sha256
        });
    }

    function pemToArrayBuffer(pem) {
        const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
        const raw = atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) {
            bytes[i] = raw.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async function importPublicKey() {
        return crypto.subtle.importKey(
            'spki',
            pemToArrayBuffer(PUBLIC_KEY_PEM),
            {
                name: 'ECDSA',
                namedCurve: 'P-256'
            },
            false,
            ['verify']
        );
    }

    function base64ToArrayBuffer(value) {
        const raw = atob(value);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) {
            bytes[i] = raw.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async function sha256Hex(buffer) {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    async function verifyManifest(manifest) {
        if (!manifest?.version || !manifest?.url || !manifest?.sha256 || !manifest?.signature) {
            return { ok: false, error: 'Manifest is missing required signed fields.' };
        }

        try {
            const key = await importPublicKey();
            const payload = new TextEncoder().encode(canonicalManifest(manifest));
            const signature = base64ToArrayBuffer(manifest.signature);
            const verified = await crypto.subtle.verify(
                {
                    name: 'ECDSA',
                    hash: 'SHA-256'
                },
                key,
                signature,
                payload
            );

            if (!verified) {
                return { ok: false, error: 'Manifest signature verification failed.' };
            }

            return { ok: true };
        } catch (error) {
            return { ok: false, error: error.message || 'Manifest verification failed.' };
        }
    }

    async function verifyBundle(url, expectedSha256) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) {
                return { ok: false, error: `Bundle fetch failed with status ${response.status}.` };
            }

            const buffer = await response.arrayBuffer();
            const digest = await sha256Hex(buffer);
            if (digest !== expectedSha256) {
                return { ok: false, error: 'Bundle integrity verification failed.' };
            }

            return { ok: true, digest };
        } catch (error) {
            return { ok: false, error: error.message || 'Bundle verification failed.' };
        }
    }

    return {
        MANIFEST_URL,
        verifyManifest,
        verifyBundle
    };
})();
