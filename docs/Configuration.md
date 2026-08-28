# Configuration

You can use the following environment variables for the all-in-one container; the default values also work.

### Core Settings

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| INSTANCE_NAME / NEXT_PUBLIC_INSTANCE_NAME | No | Dashwise | The dashboard's display name |
| PB_URL / NEXT_PUBLIC_PB_URL | No (if start pocketbase is true) | `http://127.0.0.1:8090` | PocketBase URL. The backend accepts either name (`PB_URL` takes precedence); the frontend uses `NEXT_PUBLIC_PB_URL`. |
| START_POCKETBASE | No | `true` | Start the bundled PocketBase process; set to `false` to use an external instance |
| PB_BINARY_PATH | No | - | Path to an existing, executable PocketBase binary. Required when `START_POCKETBASE=true`; the application has no fallback path. The Docker image supplies `/usr/local/bin/pocketbase`. |
| PORT | No | `3000` | HTTP port for the backend server |
| ENVIRONMENT | No | `production` | Set to `dev` for development-only behavior |

### Development-only Cache

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| USE_LOCAL_FEED_CACHE | No | `false` | Use process-local feed variables instead of Redis. Only honored when `ENVIRONMENT=dev`; not recommended for production because cache is lost on restart and is not shared between processes. |

### Authentication

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| PB_ADMIN_EMAIL | Yes | `default@dashwise.local` | Email of the PocketBase admin user |
| PB_ADMIN_PASSWORD | Yes | `DashwiseIsAwesome` | Password of the PocketBase admin user |

### URLs

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| NEXT_PUBLIC_APP_URL / APP_BASE_URL | No | `http://localhost:3000` | Public URL of the application |
| NEXT_PUBLIC_BACKEND_URL | No | - | Backend URL for frontend API calls (fallback: window.location.origin in production) |
| DASHWISE_URL | No | - | Internal Dashwise URL used for server-side callbacks |

### Appearance & Features

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| NEXT_PUBLIC_DEFAULT_BG_URL | No | `/dashboard-wallpaper.png` | Default background URL for new users |
| NEXT_PUBLIC_ENABLE_SSO / ENABLE_SSO | No | `false` | Enable Single Sign-On (SSO) via OIDC |
| NEXT_PUBLIC_DISABLE_USER_SIGNUP / DISABLE_USER_SIGNUP | No | `false` | Disable user self-registration |

### SSL/TLS

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL / ALLOW_INSECURE_CERTS_FOR_INTEGRATION_URLS | No | `false` | Allow insecure SSL certificates for integration URLs |
| ALLOW_SSL | No | `false` | Enable SSL for internal service communication |
| LOG_LEVEL / BACKEND_LOG_LEVEL | No | - | Backend log level (debug, info, warn, error) |

### Background Processing

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| JOBS_MONITORING_RETRY_AFTER | No | `5000` | Time in milliseconds to wait before retrying a failed monitoring ping |

### Scheduled Jobs (Cron Expressions)

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| SHORTCUTS_SCHEDULE | No | `*/10 * * * *` | Interval for shortcut indexing job |
| ENABLE_ICONS_REFRESH | No | `false` | Enable automatic icon refresh job. Only the literal value `true` enables it; `1` does not. |
| PULL_ICONS_SCHEDULE | No | `0 */18 * * *` | How often the icons refresh job runs |
| MONITORING_INDEXER_SCHEDULE | No | `*/10 * * * *` | How often the monitoring indexer runs |
| MONITORING_RUNNER_SCHEDULE | No | `*/1 * * * *` | How often the monitoring runner executes |
| UPDATE_CHECK_SCHEDULE | No | `0 2 * * *` | Schedule for update check job |
| FEED_BUILDING_SCHEDULE | No | `*/30 * * * *` | Schedule for news feed building job |
| NOTIFICATION_FORWARDER_SCHEDULE | No | `* * * * *` | Schedule for notification forwarder job |
| DEFAULT_INTEGRATIONS_SCHEDULE | No | `0 4 * * *` | Schedule for default integrations sync |
| PAGECONFIG_CLEANUP_SCHEDULE | No | - | Deprecated/no-op. Page-config cleanup runs immediately when an integration is deleted; this variable is read for compatibility but does not schedule work. |
| MONITORING_OUTLIER_THRESHOLD_TYPE | No | `relative` | Threshold type for monitoring outliers (`absolute` or `relative`) |
| MONITORING_OUTLIER_THRESHOLD_VALUE | No | `50` (`500` when type is `absolute`) | Threshold value for monitoring outliers. Must be a positive number; invalid or missing values use `50` for `relative` and `500` for `absolute`. |

`DEFAULT_BG_URL` is deprecated/no-op on the backend. Use `NEXT_PUBLIC_DEFAULT_BG_URL` for the frontend background setting.
