# Media playback

Dashwise has one media player in the authenticated application shell. It survives client-side navigation. Integrations expose playable resources and resolve them to a URL, optional authentication headers, and optional metadata when playback is requested.

## Integration contract

Mark an SDK resource with `playback: true`. Add `playback.resolve` to its integration definition:

```ts
playback: {
  async resolve(runtime, resource, identity) {
    const token = await runtime.secrets.get("accessToken");
    return {
      source: {
        url: `${runtime.config.url}/items/${encodeURIComponent(resource.upstreamId ?? resource.id)}/stream`,
        auth: { headers: { Authorization: `Bearer ${token}` } },
        kind: "audio",
        metadata: { title: resource.name },
      },
      context: { upstreamPlaybackId: null },
    };
  },
  listeners: {
    async started(runtime, session, event) {
      // Create an upstream reporting session after playback actually begins.
      // session.context holds adapter-specific state for this playback session.
    },
    async progress(runtime, session, event) {
      // event.positionSeconds uses seconds throughout Dashwise.
    },
  },
  async dispose(runtime, session) {
    // Release provider resources when a session closes or expires.
  },
}
```

The resolver runs on the backend. Its source authentication and adapter context are never returned to the browser. Each session retains its originating user, integration instance, collection, and resource. The browser receives a scoped stream URL and public metadata.

Listeners are optional and scoped to the integration that resolved the resource. Supported events are `started`, `paused`, `resumed`, `progress`, `ended`, `stopped`, and `error`. Events include a monotonically increasing sequence number and optional position and reason. `ended`, `stopped`, and `error` terminate the session. Providers decide how pause/resume maps to their upstream session model.

Playable Shortcut resources receive the standard Play and Add to queue actions automatically; integrations do not need to declare ordinary actions with those names. Existing integration actions continue to work independently.

## HTTP API

- `POST /api/v1/media/sessions` with `{ resource: { integrationInstanceId, collectionId, resourceId } }` resolves a source and returns `{ id, source: { url, metadata?, kind?, mimeType? } }`.
- `POST /api/v1/media/sessions/:id/events` submits an observed event and returns `{ accepted }`.
- `DELETE /api/v1/media/sessions/:id` releases the session.
- `GET` and `HEAD /api/v1/media/streams/:id?capability=...` access its stream.

Creating, reporting, and deleting sessions require Dashwise authentication and ownership. The random stream capability authorizes access only to that session's media; treat the URL as a temporary credential. Streaming forwards byte ranges and relevant response headers without loading the entire file into memory. Requests use the integration network guard and its explicitly configured private server addresses.

Sessions live in memory, so a backend restart requires resolving a fresh source. No PocketBase migration is needed. Upstream authentication renewal remains the responsibility of each provider.

## Player API

`useMediaPlayer()` exposes resource playback, queueing, direct public URL playback, transport controls, seeking, and volume. The native media elements stay mounted in the authenticated shell. Browser autoplay restrictions can require pressing Play after asynchronous source resolution.

## Provider scope

- **Groovewise:** music and podcast episode discovery, authenticated audio streaming, playback start/progress/end reporting. The supplied OpenAPI omits item/episode schemas and time units; the adapter assumes seconds and accepts the documented array lists. Configure a Groovewise server URL and access token. Pause ends an upstream listening segment; resuming creates another segment at the current position.
- **Jellyfin:** authenticated audio playback and playback reporting using a user access token and user ID. Broader video support, subtitle selection, and HLS transcoding require a subsequent implementation.
- **Music Assistant:** server-managed player controls and sending recently played library items to a chosen Music Assistant queue/player. It does not mark those items as playable in the local Dashwise player: the documented command API does not establish a generic full-track browser stream contract. Configure its server URL and a long-lived access token.

The initial media proxy supports ordinary HTTP audio/video streams. It rejects HLS playlists because protected HLS requires proxying playlist segments and keys as well as the top-level URL. Dashwise does not transcode media itself. Protected artwork is not yet proxied; omit artwork unless it has a browser-accessible URL.

Provider API references: [Groovewise supplied OpenAPI](../packages/integrations/groovewise/README.md), [Jellyfin audio API](https://typescript-sdk.jellyfin.org/classes/generated-client.AudioApi.html), [Jellyfin session reporting](https://typescript-sdk.jellyfin.org/functions/generated-client.SessionApiFp.html), and [Music Assistant command API](https://www.music-assistant.io/api/).
