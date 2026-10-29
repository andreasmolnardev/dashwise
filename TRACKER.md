# Upcoming Overall Work Goals

### 1. Integrations
As an "all-in-one" homelab dashboard, Dashwise acts as a presentation layer for your self-hosted services - meaning they integrate seamlessly into Dashwise. At least that's the goal. Achieving that requires building an integration architecuture.
Currently, you can already integrate apps with Dashwise using YAML integrations, which are a way to connect widgets to REST endpoints behind the scenes.
However, the existing YAML architecture isn't compatible with realtime data such as entity states from Home Assistant. While I could build a wrapper around polling intervals (which i kind of already did), SDK integrations are the way-to-go here, meaning you write code that exports data in a way Dashwise expects it. I don't really care about how that data is retrieved.
Sources could be:
- Websockets
- Traditional REST endpoints
- Existing SDKs bundled into the JS extension
- RPC/MCP

### 2. AI 
By leveraging the power of agents, you can focus on what's important which is why Dashwise will support more integrations with AI directly.

2.1 Mini-harness inside of dashwise

Used for internal jobs such as news summaries, notification summaries

2.2 An MCP server to connect Dashwise to external harnesses

At the end of the day, it shouldnt really matter which ai tools you're using. Integrating dashwise with them should be as easy as possible.   


### 3. Administration

--

## Added features

- **[sdk-integrations](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...sdk-integrations?expand=1) (latest commit: 2026-10-20):** Before, YAML integrations were limited to configured data fetches; the SDK draft lets integrations provide live data and actions through sources such as WebSockets, REST, bundled SDKs, RPC, or MCP.
- **[feature/jellyfin-integration-test-util](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...feature/jellyfin-integration-test-util?expand=1) (latest commit: 2026-09-29):** Before, inspecting an integration required running it through Dashwise; the CLI loads its YAML and prints resolved endpoints, widgets, and shortcuts.

## Minor Fixes and QoL enhancements

- **[pages-icons-fix](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...pages-icons-fix?expand=1) (latest commit: 2026-10-22):** Before, Dashwise guessed `/favicon.ico`; now it reads the icon declared by the site and resolves relative URLs and redirects, returning no icon when none is declared.

- Fix required: Notifications, job logs and monitoring history needs expiry while keeping stats such as uptime percentage long-term

- Fix required: News stuff gets inefficiently loaded


## Ideas Worth Reconsidering

- **[browser-locale](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...browser-locale?expand=1) (latest commit: 2026-08-24):** Locale defaults to `en-US` unless configured; consider defaulting to the browser locale while honoring an explicit user preference.
- **[copilot/rewrite-file-structure](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...copilot/rewrite-file-structure?expand=1) (latest commit: 2026-05-14):** Current News filter escaping handles quotes but not backslashes; port the backslash escaping fix to the current Hono data layer, not the old routes.
- **[detailed-builds](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...detailed-builds?expand=1) (latest commit: 2026-02-20):** App Info shows a version but no build date or commit; consider adding a build identifier to help diagnose stale deployments.
- **[move-integrations](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...move-integrations?expand=1) (latest commit: 2026-07-21):** Decide whether community YAML integrations should stay bundled or be loaded from a separate repository; the branch only removes the bundled copies.


## Previews / drafts

- **[codex/tanstack-router](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...codex/tanstack-router?expand=1) (latest commit: 2026-07-18):** Existing routes remain in use; this draft starts a migration to TanStack Router.
- **[arch-revamp](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...arch-revamp?expand=1) (latest commit: 2026-07-23):** No user-visible behavior change identified; this is a broad backend cleanup draft.

## Candidates for targeted integration

### [pages-icons-fix](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...pages-icons-fix?expand=1) / [origin/pages-icons-fix](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...pages-icons-fix?expand=1) · latest commit: 2026-10-22 (`+1 / -8`)

- Fixes incorrect or missing site icons caused by assuming sites serve `/favicon.ico`.
- Reads icon URLs declared by the page, resolves relative URLs and redirects, and times out slow page requests.
- **Recommendation:** Rebase onto `dev`, check sites with no declared icon and sites that time out, then merge. Forward-port to `experimental` if it remains the release candidate.

### [origin/browser-locale](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...browser-locale?expand=1) · latest commit: 2026-08-24 (`+1 / -104`)

- Uses the browser's locale for calendar/date presentation instead of relying on a fixed locale.
- **Recommendation:** Port the behavior to `dev` if the current app still forces a locale; do not merge this old branch wholesale.

## Review before carrying forward

### [feature/jellyfin-integration-test-util](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...feature/jellyfin-integration-test-util?expand=1) · latest commit: 2026-09-29 (`+1 / -9`)

- Adds a CLI package that loads integration YAML and runs endpoints, computed values, lookup tables, widgets, and shortcuts.
- **Recommendation:** Compare its reusable-package approach with the newer CLI on [sdk-integrations](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...sdk-integrations?expand=1); carry over any unique behavior only if this package is still wanted.

### [origin/copilot/rewrite-file-structure](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...copilot/rewrite-file-structure?expand=1) · latest commit: 2026-05-14 (`+2 / -690`)

- Fixes PocketBase filters mishandling backslashes in News feed update and category-rename requests; also reorganizes route types in the older app.
- **Recommendation:** Check whether current Hono routes need the same escaping fix. Port it if needed, not the branch.

### [origin/detailed-builds](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...detailed-builds?expand=1) · latest commit: 2026-02-20 (`+1 / -778`)

- Adds a build date to the app and documents the build process.
- **Recommendation:** Do not merge as-is; port the build-date display only if it remains useful.

### [origin/move-integrations](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...move-integrations?expand=1) · latest commit: 2026-07-21 (`+1 / -234`)

- Removes bundled integration YAML files as part of moving their source to a separate community integrations repository. This is a packaging/source-of-truth change, not a bug fix.
- Current `experimental` still bundles YAML integrations; revisit the source-of-truth decision, but do not merge the deletions without an external loading/distribution plan.

### [sdk-integrations](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...sdk-integrations?expand=1) / [origin/sdk-integrations](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...sdk-integrations?expand=1) · latest commit: 2026-10-20 (`+105 / -8`)

- Adds an integration SDK/runtime, Home Assistant and REST examples, live integration contributions, and media playback providers.
- Includes outbound network guards and changes intended to avoid stale or duplicated dashboard updates.
- **Recommendation:** Keep this as a separate `experimental` project and review it in smaller pieces. Do not merge the whole branch into `dev`.

## Ahead only in commit history

### [origin/aio-preview](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...aio-preview?expand=1) · latest commit: 2026-09-03 (`+4 / -26`)

- No file diff against `origin/dev`; the ahead commits only change the commit graph.
- **Recommendation:** No merge.

### [origin/stable-release](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...stable-release?expand=1) · latest commit: 2026-01-20 (`+5 / -800`)

- No file diff against `origin/dev`; the ahead commits only change the commit graph.
- **Recommendation:** No merge.

## Discarded draft branches

### [origin/codex/tanstack-router](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...codex/tanstack-router?expand=1) · latest commit: 2026-07-18 (`+1 / -195`)

- WIP migration of the web app to TanStack Router.
- **Recommendation:** Discard as a draft; do not merge.

### [origin/arch-revamp](https://github.com/andreasmolnardev/dashwise-next/compare/experimental...arch-revamp?expand=1) · latest commit: 2026-07-23 (`+2 / -183`)

- Broad cleanup and reorganization across backend jobs and data code, with no specific user-facing fix identified.
- **Recommendation:** Discard as a draft; do not merge.

## Excluded branches

Branches whose tips are already ancestors of `origin/experimental` are intentionally omitted here. The local `slider-improve` and `config-fix` tips are already in `origin/dev` history, so they are not ahead of `dev`.
