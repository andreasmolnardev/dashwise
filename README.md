# <img src="./apps/web/public/dashwise-icon.svg" alt="Dashwise icon" width="32" /> dashwise: Your Homelab, in one place
I've been self hosting for a while but did not find a dashboard that suits my needs and that I like the look of.
This is my attempt to solving that.

> **Disclaimer:** This project is being rewritten. If you want a stable version, use the
[legacy compose](https://github.com/andreasmolnardev/dashwise/blob/legacy/docker-compose.yaml) instead. Not every feature of the legacy version has been ported to the new one

> **Use of AI:** The development of this project is AI-Assisted by using it as a tool - not as a substitute for real programming skills.

## Screenshot
<img width="1165" height="828" alt="Screenshot 2025-11-18 at 17 24 19" src="https://github.com/user-attachments/assets/e5315f99-4a9f-49f6-8778-0e7cf77d2990" />


## Features
- GUI Editing: Edit and manage links, search engines, your wallpapers in settings via the GUI instead of relying purely on a config.
- Built-in Authentication: dashwise has Auth built right into it - and even features
- SSO via OIDC: While tested with PocketId, it should work via OIDC - which can be configured in Pocketbase directly.
- Links: store your most important links for quick access and group them into Link Groups and Folders coming. Links can also be monitored with downtime being logged.
- Glanceables: Customizable bits of one-line information next to the clock.
- Widgets: Modular blocks on the dashboard that show key info or actions at a glance. They can be moved and customized individually.
- News: Subscribe to RSS feeds to stay on top of everything.
- Notfications: Dashwise can receive notifications via PUSH requests to /api/v1/notifications/TOPIC-NAME
- Wallpapers: Upload them to dashwise directly, or even change the default one for new users by mounting one into the container
- Spotlight-like Search: Hit Ctrl+K from your dashboard, and you'll be able to search your links and integrations or use bangs for search engines specified in settings.
- Integrations: directly integrates with your favourite self hosted apps. Supported services are Karakeep, Dashdot, Beszel and Jellyfin. More integrations are planned

## Installation
For production depolyments, use the docker-compose.yaml (image is currently only built for arm, will change later).

For local development, install dependencies and start the workspace scripts:

```sh
bun install
bun run dev
```

The PocketBase backend can be either run using the aio container (default method) or connected to an external database (not recommended, migrations may fail)

## Configuration
You can use the following environment variables for the all-in-one container - default values will also work:

### Core Settings
| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| INSTANCE_NAME / NEXT_PUBLIC_INSTANCE_NAME | No | Dashwise | The dashboard's display name |
| PB_URL / NEXT_PUBLIC_PB_URL | No (if start pocketbase is true) | `http://127.0.0.1:8090` | PocketBase URL. Backend uses `PB_URL`, frontend uses `NEXT_PUBLIC_PB_URL` |
| START_POCKETBASE | No | `true` | Start the bundled PocketBase process; set to `false` to use an external instance |
| PB_BINARY_PATH | No | - | Path to PocketBase binary (default: `pocketbase/pocketbase`) |
| PORT | No | `3000` | HTTP port for the backend server |

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
| DASHWISE_URL | No | - | Internal Dashwise URL for jobs container communication |

### Appearance & Features
| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| NEXT_PUBLIC_DEFAULT_BG_URL / DEFAULT_BG_URL | No | `/dashboard-wallpaper.png` | Default background URL for new users |
| NEXT_PUBLIC_ENABLE_SSO / ENABLE_SSO | No | `false` | Enable Single Sign-On (SSO) via OIDC |
| NEXT_PUBLIC_DISABLE_USER_SIGNUP / DISABLE_USER_SIGNUP | No | `false` | Disable user self-registration |

### SSL/TLS
| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL / ALLOW_INSECURE_CERTS_FOR_INTEGRATION_URLS | No | `false` | Allow insecure SSL certificates for integration URLs |
| ALLOW_SSL | No | `false` | Enable SSL for internal service communication |
| LOG_LEVEL / BACKEND_LOG_LEVEL | No | - | Backend log level (debug, info, warn, error) |

### Jobs & Background Processing
| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| JOBS_URL / NEXT_PUBLIC_JOBS_URL | No | `http://127.0.0.1:3001` | URL of the jobs service |
| JOBS_WEBHOOK_ENABLE / NEXT_PUBLIC_JOBS_WEBHOOK_ENABLE | No | `false` | Explicitly enable the jobs webhook. Set to `1` or `true` to force-enable |
| JOBS_WEBHOOK_URL | No | `http://jobs:3000/api/forward-notifications` | Webhook URL for forwarding notifications to jobs |
| JOBS_MONITORING_RETRY_AFTER | No | `5000` | Time in milliseconds to wait before retrying a failed monitoring ping |

### Scheduled Jobs (Cron Expressions)
| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| SEARCHITEMS_SCHEDULE | No | `*/10 * * * *` | Interval for search item indexing job |
| ENABLE_ICONS_REFRESH | No | `false` | Enable automatic icon refresh job |
| PULL_ICONS_SCHEDULE | No | `0 */6 * * *` | How often the icons refresh job runs |
| MONITORING_INDEXER_SCHEDULE | No | `*/10 * * * *` | How often the monitoring indexer runs |
| MONITORING_RUNNER_SCHEDULE | No | `*/1 * * * *` | How often the monitoring runner executes |
| UPDATE_CHECK_SCHEDULE | No | `0 2 * * *` | Schedule for update check job |
| FEED_BUILDING_SCHEDULE | No | `*/30 * * * *` | Schedule for news feed building job |
| NOTIFICATION_FORWARDER_SCHEDULE | No | `* * * * *` | Schedule for notification forwarder job |
| DEFAULT_INTEGRATIONS_SCHEDULE | No | `0 4 * * *` | Schedule for default integrations sync |
| PAGECONFIG_CLEANUP_SCHEDULE | No | `0 5 * * *` | Schedule for page config cleanup |
| MONITORING_OUTLIER_THRESHOLD_TYPE | No | `relative` | Threshold type for monitoring outliers (`absolute` or `relative`) |
| MONITORING_OUTLIER_THRESHOLD_VALUE | No | `50` | Threshold value for monitoring outliers |

## Tech Stack
Frontend: React SPA bundled with Bun
API Layer: Bun with Hono
Backend: Pocketbase

## How it works
Each user has page-based config records in `pageConfig` (for example `home`, `news`, `lab`) plus user-level preferences.
The frontend reads and refreshes page config through the `usePageConfig` hook.

## Open Source Projects that make dashwise possible

[Selfh.st icons](https://github.com/selfhst/icons),
[Font Awesome](https://fontawesome.com),
[Bun](https://bun.sh), [React](https://react.dev), [Shadcn](https://github.com/shadcn-ui/ui)

## Contributions

Feel free to contribute! I'll probably create a more detailed roadmap soon.

### Creating an integration
Refer to docs/integrations.md for more

## Star History

<a href="https://www.star-history.com/#andreasmolnardev/dashwise-next&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=andreasmolnardev/dashwise-next&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=andreasmolnardev/dashwise-next&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=andreasmolnardev/dashwise-next&type=date&legend=top-left" />
 </picture>
</a>
