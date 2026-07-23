# <img src="./apps/web/public/dashwise-icon.svg" alt="Dashwise icon" width="32" /> dashwise: Your Homelab, in one place
I've been self hosting for a while but did not find a dashboard that suits my needs and that I like the look of.
This is my attempt to solving that.

> **Disclaimer:** This project is being rewritten. If you want a stable version, use the
[legacy compose](https://github.com/andreasmolnardev/dashwise/blob/legacy/docker-compose.yaml) instead. Not every feature of the legacy version has been ported to the new one

> **Use of AI:** The development of this project is AI-Assisted by using it as a tool - not as a substitute for real programming skills.

## Screenshot
<img width="1165" height="828" alt="Screenshot 2025-11-18 at 17 24 19" src="https://github.com/user-attachments/assets/e5315f99-4a9f-49f6-8778-0e7cf77d2990" />


## Features
- **Principles**: Configure dashwise using its UI. No need to touch config files. Dashwise also has Authentication (including SSO) built in.
- **Dashboards** show Glanceables and Widgets, for example Links (which can be grouped into Link groups and folders)
- **Glanceables**: Customizable bits of one-line information next to the clock.
- **Widgets**: Modular blocks on the dashboard that show key info or actions at a glance. They can be moved and customized individually.
- **News**: Subscribe to RSS feeds to stay on top of everything.
- **Notfications** : Dashwise can receive notifications via PUSH requests to /api/v1/notifications/TOPIC-NAME
- **Spotlight-like Search**: Hit Ctrl+K from your dashboard, and you'll be able to search your links and integrations or use bangs for search engines specified in settings.
- **Integrations**: directly integrates with your favourite self hosted apps. Supported services are Karakeep, Dashdot, Beszel and Jellyfin. More integrations are planned

## Installation
For production depolyments, use the docker-compose.yaml (image is currently only built for arm, will change later).

For local development, install dependencies and start the workspace scripts:

```sh
bun install
bun run dev
```

The PocketBase backend can be either run using the aio container (default method) or connected to an external database (not recommended, migrations may fail)

## Configuration
See the [configuration reference](docs/Configuration.md) for all supported environment variables.

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
