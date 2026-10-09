Dashwise can make use of existing SSO Infrastructure by integrating with OIDC servers

# Setup

1. Edit the users collection. <br>
<img width="352" height="77" alt="image" src="https://github.com/user-attachments/assets/b1490635-d154-48c1-8b7e-715ff1bae827" /> <br>

2. In the "Options" tab, enable OAuth2 and add your provider. <br>
<img width="685" height="614" alt="image" src="https://github.com/user-attachments/assets/f303e780-dafa-4ad8-81e5-5d20880d022d" /> <br>

For details on the exact URLs, follow the docs of your preferrered SSO provider.

## Internal architecture

PocketBase verifies the user's credentials and TOTP code, if enabled. Dashwise then creates a session and returns an opaque `dws_` token. The client sends that token as a bearer credential for API requests. The client does not receive a PocketBase auth token.

Dashwise stores a SHA-256 hash of each session token. For existing user-scoped data operations, the session record also holds the PocketBase token in a hidden field for backend use. On each request, the backend hashes the supplied token, finds its session, checks its expiry and activity, and refreshes the internal PocketBase token. Sessions expire after 30 days without activity or 90 days from creation.

Logging out deletes the current session. Revoking a session deletes that session's record, so its token no longer authorizes requests. Device-code approval creates a separate session and token for the requesting device.
