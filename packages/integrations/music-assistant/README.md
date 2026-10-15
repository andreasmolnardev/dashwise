# Music Assistant integration

Configure the Music Assistant web/API origin (usually `http://host:8095`) and a long-lived access token created in **Settings → Profile**. The integration uses the documented authenticated HTTP command interface at `/api` and loads players plus recently played tracks, albums, and podcast episodes.

Player shortcuts expose queue resume, pause, stop, next, and previous. Recently played items can be sent to a selected Music Assistant player with `player_queues/play_media` using their Music Assistant URI. This is remote playback on Music Assistant's configured speakers. Dashwise does not mark these resources playable in its native browser player: the Music Assistant streamserver delivers audio to configured players, and its documentation does not define a generic browser-ready stream URL for a library URI. No provider audio URL is synthesized or exposed.

Music Assistant's API command schemas are generated per server at `/api-docs`; command response shapes can vary by server version. The integration validates player/item envelopes and uses the `result` member when present. Current API documentation: [Music Assistant API](https://www.music-assistant.io/api/).
