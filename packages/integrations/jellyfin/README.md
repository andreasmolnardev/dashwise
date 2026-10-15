# Jellyfin integration

Configure the server's base URL (including any reverse-proxy path prefix), a Jellyfin user access token, and that user's ID. The library refresh runs every 15 minutes.

Dashwise currently marks only Audio items as playable. Before returning a source it posts a browser audio profile to Jellyfin's `Items/{itemId}/PlaybackInfo`, selects a media source that supports direct play or stream, then uses Jellyfin's documented universal audio stream endpoint with the returned media source and play session IDs. The source is requested as MP3 for broad browser compatibility. Movie and episode entries may appear in the library but are not marked playable yet; this first provider iteration does not claim universal browser support for Jellyfin video codecs/containers.

Jellyfin `ReportPlaybackStart`, `ReportPlaybackProgress`, and `ReportPlaybackStopped` are sent for started, paused/resumed/progress, and terminal events. The SDK's configured URL and bearer token are kept in the backend resolver's source auth headers for its media proxy; the native player receives only the resulting capability URL.
