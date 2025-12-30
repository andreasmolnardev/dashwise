# dashwise: Your Homelab, in one place
I've been self hosting for a while but did not find a dashboard that suits my needs and that I like the look of.
This is my attempt to solving that.

> **Disclaimer:** This project is still under development. Therefore, only the working features of the app are listed in the features section. Integration with additional services is planned, but will not be available until widget implementation is complete.

> **Breaking Changes for v0.2:** ARM images now have a seperate tag of stable-arm. Also, a jobs container has been added to docker compose

## Screenshot
<img width="1165" height="828" alt="Screenshot 2025-11-18 at 17 24 19" src="https://github.com/user-attachments/assets/e5315f99-4a9f-49f6-8778-0e7cf77d2990" />


## Features
- GUI Editing: Edit and manage links, search engines, your wallpapers in settings via the GUI instead of relying purely on a config.
- Built-in Authentication: dashwise has Auth built right into it - and even features
- SSO via OIDC: While tested with PocketId, it should work via OIDC - which can be configured in Pocketbase directly.
- Links: store your most important links for quick access and group them into Link Groups. Folders coming soon.
- Monitor your links: Can be enabled via link details settings. Performs a GET request to that endpoint. Logs downtime.
- Glanceables: Customizable bits of one-line information next to the clock.
- Widgets: Modular blocks on the dashboard that show key info or actions at a glance. They can be moved and customized individually.
- Wallpapers: Upload them to dashwise directly, or even change the default one for new users by mounting one into the container
- Spotlight-like Search: Hit Ctrl+K from your dashboard, and you'll be able to search your links and integrations or use bangs for search engines specified in settings.
- Integrations: directly integrates with your favourite self hosted apps. For now only Karakeep is supported but more integrations are planned.

## Installation
Grab the docker compose file (docker-compose.prod.yaml), edit env vars, pull, deploy. That's it.

## Configuration
You can use the following environment variables for the main container:

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| NEXT_PUBLIC_PB_URL | Yes | `http://pocketbase:8090` | URL of the PocketBase instance |
| NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL | No | `false` | Enable SSL for integrations |
| PB_ADMIN_EMAIL | Yes | `default@dashwise.local` | Email of the PocketBase admin user |
| PB_ADMIN_PASSWORD | Yes | `DashwiseIsAwesome` | Password of the PocketBase admin user |
| NEXT_PUBLIC_APP_URL | Yes | `http://localhost:3000` | URL of the application |
| NEXT_PUBLIC_ENABLE_SSO | No | `false` | Enable Single Sign-On (SSO) |
| NEXT_PUBLIC_DEFAULT_BG_URL | No | `/dashboard-wallpaper.png` | Default background URL |
| NEXT_PUBLIC_JOBS_WEBHOOK_ENABLE | No | `false` | Explicitly enable the jobs webhook. Set to `1` or `true`- to force-enable the webhook regardless of whether a jobs URL is configured. |
| NEXT_PUBLIC_JOBS_URL | No | `http://127.0.0.1:3001` | URL of the jobs webhook endpoint. If overwritten, the jobs webhook is automatically enabled even if `NEXT_PUBLIC_JOBS_WEBHOOK_ENABLE` is not set. |

The jobs container can be configured with the following environment variables:

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| PB_URL | Yes | `http://pocketbase:8090` | Internal URL of the PocketBase instance used for API access |
| DASHWISE_URL | Yes | `http://dashwise:3000` | Internal URL of the Dashwise web application |
| PB_ADMIN_EMAIL | Yes | `default@dashwise.local` | Email of the PocketBase admin user for authentication |
| PB_ADMIN_PASSWORD | Yes | `DashwiseIsAwesome` | Password of the PocketBase admin user for authentication |
| SEARCHITEMS_SCHEDULE | No | `*/10 * * * *` | Cron expression defining the interval for the search item indexing job |
| MONITORING_INDEXER_SCHEDULE | No | `*/10 * * * *` | Cron expression defining how often the monitoring indexer runs |
| MONITORING_RUNNER_SCHEDULE | No | `*/1 * * * *` | Cron expression defining how often the monitoring runner executes |
| ALLOW_SSL | No | `false` | Enables SSL support for internal service communication |

## Tech Stack
Frontend, API Layer: Next.js
Backend: Pocketbase

## How it works
On signup, a json config is created for each user.
It's available to the frontend via a GET request to /api/v1/config.
Accessing it is handled by the ConfigContext.

## Open Source Projects that make dashwise possible

[Selfh.st icons](https://github.com/selfhst/icons),
[Font Awesome](https://fontawesome.com),
[Nextjs](https://github.com/vercel/next.js), [Shadcn](https://github.com/shadcn-ui/ui)

## Contributions

Feel free to contribute! I'll probably create a more detailed roadmap soon.

## Star History

<a href="https://www.star-history.com/#andreasmolnardev/dashwise-next&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=andreasmolnardev/dashwise-next&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=andreasmolnardev/dashwise-next&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=andreasmolnardev/dashwise-next&type=date&legend=top-left" />
 </picture>
</a>
