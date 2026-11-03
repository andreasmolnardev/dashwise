Dashwise authentication is built into the Go backend; accounts live in the embedded SQLite database and no external identity service is required. Optional SSO uses OpenID Connect authorization code flow with PKCE. Enable it with `ENABLE_SSO=true` and configure `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`. Register `${DASHWISE_URL}/api/v1/auth/callback` with the identity provider, or set an explicit `OIDC_REDIRECT_URL`. Public deployments must use HTTPS.

Dashwise verifies the provider's signed ID token, issuer, audience, nonce, PKCE exchange, and verified email claim. External identities are linked by issuer and subject; a verified email can link the provider to an existing Dashwise account. New SSO accounts follow `DISABLE_USER_SIGNUP`. The callback places a short-lived, one-use ticket in an HttpOnly cookie and the SPA exchanges it for a regular Dashwise session, so the session token is not placed in the redirect URL.

An SSO-created account can add a local password from Account settings while signed in. Until then, local password login is disabled for that account, and account deletion requires the active SSO session plus email confirmation (and TOTP if configured).

# Accounts, Sessions, and Devices

## Account basics

Users sign up with email and password (`POST /api/v1/auth/signup`). Passwords are hashed with bcrypt. Signup can be disabled globally with `DISABLE_USER_SIGNUP`. Account deletion requires confirming the password.

## Sessions

Successful signup, login, or device approval creates a session and returns an opaque `dws_` token. The client sends that token as a bearer credential for API requests.

Dashwise stores only a SHA-256 hash of each session token, never the token itself. On each request the backend hashes the supplied token, finds its session, and checks its expiry. Sessions expire 90 days after creation; activity is tracked with a last-seen timestamp.

Logging out deletes the current session. Revoking a session from the sessions list deletes that session's record, so its token no longer authorizes requests. The sessions list/current/rename APIs return an explicit allowlist of public metadata (display name, client type, platform, created/expiry timestamps); they never return token material or hashes.

Live activity WebSockets validate the token's session before protected operations and periodically while idle, so a revoked session cannot keep a connection alive; revocation closes the connections and cleans up streams, timers, and subscriptions. Password changes require the current password and revoke every session for that user, including connections whose authentication was already in flight.

## Device logins

Device code flows under `/api/v1/auth/device-code/` let external tools request access: the device generates a code, and the user approves it in the web app. Approval creates a separate session and token for the requesting device.

## Notifications

Publishing to a notification topic requires authentication: callers can use either their own device/session bearer token for a topic they own or a scoped topic token in the URL path. User/password Basic authentication is not supported. Login, signup, and the public app-config/bootstrap metadata endpoints stay publicly accessible.
