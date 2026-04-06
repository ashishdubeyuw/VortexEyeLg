# VortexEye Security Assessment Report

Date: 2026-03-07  
Repository: `ashishdubeyuw/VortexEyeLg`  
Scope reviewed: packaged web app extracted from `www.zip`  
Code modification policy followed: **application code was not changed**

## Executive Summary

I reviewed the packaged application contained in `www.zip` and found **7 security problems** that should be addressed.

Severity breakdown:

- **2 Critical**
- **4 High**
- **1 Medium**

## Method Used

- Inspected the repository root and packaged application contents
- Extracted `www.zip` to a temporary analysis directory without modifying the app
- Performed manual static review of HTML/JavaScript entry points and security-sensitive flows
- Verified high-risk findings directly in the bundled files

## Findings

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | Critical | Hardcoded GitHub personal access token embedded in client-side code | `www.zip -> js/logger.js:17` |
| 2 | Critical | Automatic log upload to GitHub from the client without clear user consent | `www.zip -> js/logger.js:28-50`, `js/logger.js:424-538` |
| 3 | High | Sensitive operational logs persisted in `localStorage` | `www.zip -> js/logger.js:4`, `js/logger.js:62-67`, `js/logger.js:92-104` |
| 4 | High | OTA update flow downloads remote bundle without integrity/signature verification | `www.zip -> js/app.js:43-80`, `version.json:2-5` |
| 5 | High | DOM-based XSS risk from remote search results inserted with `innerHTML` | `www.zip -> js/app.js:1404-1408` |
| 6 | High | External scripts loaded from CDNs without integrity controls, and no CSP is present | `www.zip -> index.html:205-232` |
| 7 | Medium | Privileged filesystem/git browser objects are exposed on `window`, increasing impact if XSS occurs | `www.zip -> index.html:206-214` |

## Detailed Findings

### 1) Hardcoded GitHub PAT in client-side code

**Severity:** Critical  
**Evidence:** `www.zip -> js/logger.js:17`

The app contains a GitHub personal access token directly in browser-delivered JavaScript:

- `this.gitToken = 'github_pat_...'`

Because this code is shipped to the client, any user or attacker with access to the app package can recover the token and use it against the linked GitHub repository or account scope granted to that token.

**Why this matters**

- Secret exposure is immediate
- Token misuse can lead to repository compromise, data tampering, or unauthorized API access
- Once published, the token should be treated as fully compromised

**Proposed improvement**

- Revoke and rotate the exposed token immediately
- Never place long-lived secrets in client-side code
- Move upload/sync logic behind a server-controlled API that stores secrets securely

---

### 2) Automatic GitHub log upload from the client

**Severity:** Critical  
**Evidence:** `www.zip -> js/logger.js:28-50`, `js/logger.js:424-538`

The logger initializes GitHub sync automatically, triggers sync on startup, on reconnect, and every 60 seconds, and uploads log content directly to GitHub using the embedded token.

The uploaded content includes device identifiers and log details built from runtime data:

- session/device metadata
- browser/OS details
- screen size
- application log entries

**Why this matters**

- Creates direct client-to-GitHub data exfiltration behavior
- Appears to happen automatically rather than through explicit opt-in
- Increases privacy, compliance, and incident-response risk

**Proposed improvement**

- Disable automatic client-side sync
- Require explicit user consent before any telemetry upload
- Minimize logged data and redact location/device-sensitive fields
- Route telemetry through a controlled backend with authentication, authorization, and retention rules

---

### 3) Sensitive logs stored in `localStorage`

**Severity:** High  
**Evidence:** `www.zip -> js/logger.js:4`, `js/logger.js:62-67`, `js/logger.js:92-104`

The logger persists logs in `localStorage`, which is accessible to any script running in the same origin. If the app later suffers script injection or a malicious dependency executes in origin context, stored logs can be read and exfiltrated.

**Why this matters**

- `localStorage` is not appropriate for sensitive telemetry
- Data can persist across sessions longer than intended
- The same module also builds logs containing operational and device context

**Proposed improvement**

- Avoid storing sensitive telemetry in `localStorage`
- Use short-lived in-memory storage where possible
- If persistence is necessary, reduce scope and retention, and encrypt server-side after upload rather than in browser storage

---

### 4) OTA update flow lacks integrity verification

**Severity:** High  
**Evidence:** `www.zip -> js/app.js:43-80`, `version.json:2-5`

The application fetches a remote `version.json`, reads a remote bundle URL, downloads the update package, and installs it. The current flow checks version values but does not show cryptographic signature verification or bundle integrity validation before install.

**Why this matters**

- If the update source, release pipeline, or distribution path is compromised, malicious code could be delivered
- HTTPS alone does not provide release authenticity guarantees

**Proposed improvement**

- Sign release manifests and update bundles
- Verify signatures/hashes before download and before install
- Restrict updates to trusted release channels and fail closed on verification errors

---

### 5) DOM XSS risk through `innerHTML`

**Severity:** High  
**Evidence:** `www.zip -> js/app.js:1404-1408`

Remote geocoding results are rendered by building HTML strings and assigning them with `innerHTML`:

- `dropdown.innerHTML = results.map(...)`

The rendered values derive from `r.display_name`, which comes from remote API response data. If an upstream API response is malicious or tampered with, this can allow HTML/script injection into the page.

**Why this matters**

- `innerHTML` with remote data is a classic XSS sink
- A successful XSS would become more severe because the page also exposes filesystem/git helpers globally

**Proposed improvement**

- Replace string-based HTML rendering with safe DOM creation APIs
- Use `textContent` for user/remote strings
- Validate and encode all untrusted data before rendering

---

### 6) Third-party CDN scripts loaded without integrity controls and no CSP

**Severity:** High  
**Evidence:** `www.zip -> index.html:205-232`

The app loads multiple third-party scripts from external CDNs, including `unpkg.com` and `cdn.jsdelivr.net`. The HTML does not show Subresource Integrity protections, and there is no visible Content Security Policy.

**Why this matters**

- Compromise of a CDN, package, or dependency path can inject malicious JavaScript into the app
- Without a CSP, browser-side mitigation for script injection is weaker

**Proposed improvement**

- Self-host critical third-party assets where feasible
- Pin exact versions and add Subresource Integrity where supported
- Add a strict Content Security Policy tailored to the app’s runtime needs

---

### 7) Privileged helpers exposed on `window`

**Severity:** Medium  
**Evidence:** `www.zip -> index.html:206-214`

The page exposes the following objects globally:

- `window.fs`
- `window.pfs`
- `window.git`
- `window.gitHttp`

By itself this is not a full exploit, but it increases attacker capability if any script injection occurs because useful primitives are already reachable from global scope.

**Why this matters**

- Broadens the blast radius of any DOM XSS or malicious third-party script
- Makes sensitive internals easier to invoke from injected code

**Proposed improvement**

- Avoid exposing privileged objects globally
- Keep internal helpers scoped within modules
- Only initialize privileged functionality when required

## Overall Proposed Improvement Plan

1. **Emergency response**
   - Revoke the exposed GitHub token immediately
   - Review GitHub audit logs for misuse

2. **Secrets and telemetry**
   - Remove secrets from client code
   - Disable direct client uploads to GitHub
   - Add explicit consent and data minimization for telemetry

3. **Update security**
   - Add signed manifests and bundle integrity verification
   - Restrict and monitor release/update channels

4. **Frontend hardening**
   - Eliminate `innerHTML` for remote content
   - Add CSP and SRI
   - Reduce globally exposed privileged objects

5. **Data protection**
   - Reduce or eliminate sensitive `localStorage` use
   - Apply retention controls and redact sensitive fields from logs

## Notes / Limitations

- This assessment was performed on the packaged artifact in `www.zip`, not a full unbundled source repository.
- No existing repository test, lint, or build pipeline was present at the repo root to run before analysis.
- The findings above are based on directly verified code paths in the packaged app and are sufficient to justify remediation work.
