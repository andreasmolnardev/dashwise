# Configuration

You can use the following environment variables for the container; the default values also work. The Go backend reads these directly and stores all data in its embedded SQLite database, so no external database service is required.

### Core Settings

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| INSTANCE_NAME | No | Dashwise | The dashboard's display name |
| DATA_DIR | No | `./data` | Directory holding the SQLite database, secret key, and other data files |
| DATABASE_PATH | No | `<DATA_DIR>/dashwise.sqlite` | Path to the embedded SQLite database |
| WEB_DIST | No | `../../web/dist` | Directory with the built web app to serve; the Docker image sets `/app/public` |
| PORT | No | `3000` | HTTP port for the backend server |
| ENVIRONMENT | No | `development` | Set to `production` for production behavior |
| DASHWISE_VERSION | No | `go-migration` | Version string reported by the update check |
| DASHWISE_GITHUB_REPO | No | `andreasmolnardev/dashwise` | GitHub repository used to check the latest release every six hours |
| LOG_LEVEL | No | `info` | Backend log level (`debug`, `info`, `warn`, `error`) |

### URLs

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| DASHWISE_URL | No | `http://localhost:3000` | Public Dashwise base URL used to derive the OIDC callback URL; set it to the external HTTPS address when enabling SSO behind a proxy |

### Authentication & Features

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| DISABLE_USER_SIGNUP | No | `false` | Disable user self-registration |
| ENABLE_SSO | No | `false` | Enable OpenID Connect sign-in and show the SSO button |
| OIDC_ISSUER_URL | When SSO is enabled | — | OIDC issuer URL used for provider discovery |
| OIDC_CLIENT_ID | When SSO is enabled | — | OAuth client ID registered with the identity provider |
| OIDC_CLIENT_SECRET | When SSO is enabled | — | OAuth client secret registered with the identity provider |
| OIDC_REDIRECT_URL | No | `${DASHWISE_URL}/api/v1/auth/callback` | Exact callback URL registered with the provider; public deployments must use HTTPS |
| OIDC_SCOPES | No | `openid,email,profile` | Additional comma-separated OIDC scopes |
| ALLOW_PRIVATE_PREVIEW_URLS | No | `false` | Allow integration JSON preview to fetch private/internal URLs |

### Appearance

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| SHOUTRRR_BINARY_PATH | No | `shoutrrr` | Path to the shoutrrr binary used for outgoing notifications. The Docker image supplies `/usr/local/bin/shoutrrr`. |

### Data Retention & Scheduled Jobs

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| NEWS_SUBSCRIPTION_RETENTION | No | `50` | Maximum number of latest articles retrieved and cached per news subscription (1–10000) |
| ACTIVITY_RETENTION_DAYS | No | `90` | Days to keep activity records (1–3650) |
| NEWS_REFRESH_INTERVAL_SECONDS | No | `1800` | Interval for the news refresh worker, in seconds (30 minutes) |

Secrets such as integration credentials and monitoring endpoint auth are encrypted at rest with a key file generated under `DATA_DIR/secret.key`.

### Frontend Build-time Variables

The web app reads a few `NEXT_PUBLIC_*` variables at build time (via Vite's env handling) as fallbacks, for example `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_ENABLE_SSO`, `NEXT_PUBLIC_DISABLE_USER_SIGNUP`, `NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL` (also answers to `ALLOW_INSECURE_CERTS_FOR_INTEGRATION_URLS`), and `NEXT_PUBLIC_DEFAULT_BG_URL`. The backend's `/api/v1/appConfig` and `/api/v1/appInfo` endpoints provide the runtime values (instance name, SSO flag, signup restriction), so these are rarely needed.

There is no PocketBase process to configure or expose; data migration from a legacy PocketBase install uses the migration archive under `/api/v1/migration/` (see [Development](Development.md)).
