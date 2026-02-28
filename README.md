# VortexEyeLg

## Getting a GitHub PAT for app logging

If your app needs to create logs in this repository through the GitHub API, use a **Personal Access Token (PAT)**.

### 1) Create the token

1. Open GitHub **Settings**.
2. Go to **Developer settings** → **Personal access tokens**.
3. Prefer **Fine-grained tokens** and click **Generate new token**.
4. Set:
   - **Repository access**: `ashishdubeyuw/VortexEyeLg`
   - **Permissions** (minimum required):
     - **Contents: Read and write** (if writing log files/commits)
     - **Issues: Read and write** (only if your app logs by creating issues)
5. Generate and copy the token once.

### 2) Store it safely

Do not hardcode the token. Save it as an environment variable:

```bash
export GITHUB_PAT="your_token_here"
```

### 3) Use it in API calls

Use the token in the `Authorization` header (the `token` scheme is broadly compatible):

```http
Authorization: token <your_token_here>
```

### Notes

- If your app runs in GitHub Actions, prefer the built-in `GITHUB_TOKEN` when possible.
- Rotate/revoke tokens if leaked.
