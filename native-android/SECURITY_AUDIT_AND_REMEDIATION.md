# VortexEye Native Android — Security Audit & Remediation

Date: 2026-03-15

## Scope

Scanned:
- source under `app/src/main/**`
- build and manifest configs
- local machine config files

## Findings

### 1) API keys / secrets exposure

**Result:** No live API keys/tokens detected in source.

**Observed:**
- `VortexApplication.kt` uses App Center with placeholder UUID `00000000-0000-0000-0000-000000000000`.

**Risk:** Low (placeholder), but if replaced with production key in code, it becomes a secret-management concern.

**Fix:**
- Keep production telemetry keys in CI/CD injected build config (e.g., `BuildConfig` field via env var).
- Never commit production keys to repository.

---

### 2) Machine-local sensitive file present

**Observed:** `local.properties` contains local SDK path.

**Risk:** Medium for operational hygiene (leaks local environment details).

**Fix:**
- Ensure `local.properties` is git-ignored and never committed.

---

### 3) Backup policy

**Observed:** `android:allowBackup="true"` in `AndroidManifest.xml`.

**Risk:** Medium for privacy-sensitive app data on some backup paths.

**Fix:**
- Set `android:allowBackup="false"` for production builds, or
- define strict backup rules (`fullBackupContent`) with explicit exclusions.

---

### 4) Broad permission surface

**Observed permissions:**
- `READ_PHONE_STATE`
- `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`
- `CAMERA`
- `RECORD_AUDIO`
- `HIGH_SAMPLING_RATE_SENSORS`

**Risk:** Medium (privacy + policy review burden).

**Fix:**
- Keep only strictly necessary permissions.
- If telephony feature is optional, feature-flag and remove `READ_PHONE_STATE` for non-research builds.
- Add in-app rationale and least-privilege runtime requests.

---

### 5) Network dependency trust/risk

**Observed external endpoints:**
- Overpass mirrors
- Nominatim
- OSRM public endpoint

**Risk:** Medium (availability, integrity, rate limiting, data exposure to public infra).

**Fix:**
- Prefer self-hosted OSM stack for production/research reproducibility.
- Add request retry with exponential backoff and endpoint health scoring.
- Add timeout + circuit breaker per endpoint.

---

### 6) Build artifact and patch residue

**Observed:**
- `AndroidManifest.xml.orig`
- `AndroidManifest.xml.rej`

**Risk:** Low-medium (confusion and accidental leakage of stale config).

**Fix:**
- Remove patch residue files from source tree.

---

## Recommended Hardening Plan (Priority)

1. Add/restore strict `.gitignore` and confirm no generated/local files are tracked.
2. Disable backup in production manifest or add strict backup rules.
3. Gate `READ_PHONE_STATE` behind build flavor; remove when not required.
4. Move telemetry/API config to CI-injected build config, not hardcoded source.
5. Migrate public routing/geocode dependencies to self-hosted endpoints for reliability and governance.

## Quick Verification Commands

```zsh
# check for likely secrets
grep -RInE 'AIza|api[_-]?key|secret|token|private_key|client_secret' app/src/main

# verify local.properties is ignored
git check-ignore -v local.properties

# scan manifest-sensitive flags
grep -nE 'allowBackup|usesCleartextTraffic|READ_PHONE_STATE|RECORD_AUDIO|CAMERA' app/src/main/AndroidManifest.xml
```
