# Groovewise integration

Configure **Groovewise URL** with the server origin, with or without a trailing `/v1` (for example `https://music.example.test`). The integration trims a trailing `/v1` and follows the API's OpenAPI server base at `/v1`. Add a bearer access token with library read access.

The integration imports `/v1/items`, subscribed podcasts, and each podcast's episode list. Groovewise's OpenAPI leaves item and episode response schemas unspecified, so resources are accepted only when they contain a string `id`; display fields use `title`/`name`, `artist`, `album`, and `duration`/`duration_seconds` when present. Podcast episode identity is the parent podcast `id` plus the episode `id`. Resource entries open Groovewise from Dashwise; playback recording on the Groovewise side is not driven by Dashwise resources.
