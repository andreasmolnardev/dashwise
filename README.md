# dashwise: Your Homelab, in one place
I've been self hosting for a while but did not find a dashboard that suits my needs and that I like the look of.
This is my attempt to solving that.

## Features
- Links: store your most important links for quick access
- Glanceables:
- Spotlight-like Search: 
- Integrations:

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
Selfh.st icons
Font Awesome
Nextjs, Shadcn

## Contributions
Feel free to contribute! I'll probably create a roadmap soon.
