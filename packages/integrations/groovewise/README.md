# Groovewise integration

Configure **Groovewise URL** with the server origin, with or without a trailing `/v1` (for example `https://music.example.test`). The integration trims a trailing `/v1` and follows the API's OpenAPI server base at `/v1`. Add a bearer access token with library read and playback tracking access.

The integration imports `/v1/items`, subscribed podcasts, and each podcast's episode list. Groovewise's OpenAPI leaves item and episode response schemas unspecified, so resources are accepted only when they contain a string `id`; display fields use `title`/`name`, `artist`, `album`, and `duration`/`duration_seconds` when present. Podcast episode identity is the parent podcast `id` plus the episode `id`.

Music streams use `GET /v1/items/{id}/stream`; podcast streams use `GET /v1/podcasts/{podcastId}/episodes/{episodeId}/stream`. On actual playback start, Dashwise calls `/v1/playback/start` and stores the returned ID for that media session. Progress, pause, resume, stop, end, and session disposal are mapped to the documented sync/end routes. Because the specification gives no units, `time_start`, `sync_at`, and `time_end` are sent in seconds, matching the player event positions. A pause closes the current Groovewise playback record; resume opens another record at the reported position.
