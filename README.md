# dashwise: Your Homelab, in one place
I've been self hosting for a while but did not find a dashboard that suits my needs and that I like the look of.
This is my attempt to solving that.

> **Disclaimer:** This project is still under development. Therefore, only the working features of the app are listed in the features section. Integration with additional services is planned, but will not be available until widget implementation is complete.

## Screenshot
<img width="1445" height="827" alt="Screenshot 2025-10-22 at 08 03 40" src="https://github.com/user-attachments/assets/69061ca0-cba1-4c23-b7bd-59ca691507e0" />

## Features
- GUI Editing: Edit and manage links, search engines, your wallpapers in settings via the GUI instead of relying purely on a config.
- Built-in Authentication: dashwise has Auth built right into it - and even features
- SSO via OIDC: While tested with PocketId, it should work via OIDC - which can be configured in Pocketbase directly.
- Links: store your most important links for quick access and group them into Link Groups. Folders coming soon.
- Glanceables: Customizable bits of one-line information next to the clock.
- Wallpapers: Upload them to dashwise directly, or even change the default one for new users by mounting one into the container
- Spotlight-like Search: Hit Ctrl+K from your dashboard, and you'll be able to search your links and integrations or use bangs for search engines specified in settings.
- Integrations: directly integrates with your favourite self hosted apps. For now only Karakeep is supported but more integrations are planned.

## Installation
Grab the docker compose file (docker-compose.prod.yaml), edit env vars, pull, deploy. That's it.

## Configuration
You can use the following environment variables:

| Name | Required | Default Value | Description |
| --- | --- | --- | --- |
| NEXT_PUBLIC_PB_URL | Yes | `http://pocketbase:8090` | URL of the PocketBase instance |
| NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL | No | `false` | Enable SSL for integrations |
| PB_ADMIN_EMAIL | Yes | `default@dashwise.local` | Email of the PocketBase admin user |
| PB_ADMIN_PASSWORD | Yes | `DashwiseIsAwesome` | Password of the PocketBase admin user |
| NEXT_PUBLIC_APP_URL | Yes | `http://localhost:3000` | URL of the application |
| NEXT_PUBLIC_ENABLE_SSO | No | `false` | Enable Single Sign-On (SSO) |
| NEXT_PUBLIC_DEFAULT_BG_URL | No | `/dashboard-wallpaper.png` | Default background URL |

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
