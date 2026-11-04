# Smart Frames

Smart Frames are configurable full-screen views rendered by the retained React
frontend. Their configuration is stored in the authenticated user's
`screensaverPreferences` property in the Go backend. The current device can
override display rules in `dashwise_screensaver_device_rules` in local storage.

## Configuration

The Smart Frames settings page manages named frames, their widget sections and
layout, and their backgrounds. A frame can use the dashboard background, a
global frame background, a URL, uploaded images that rotate on a timer, or no
background. Widget sections use the existing widget renderer and can include
their normal configuration and integration consumer keys.

Display rules have global and per-device scopes. They control the manual
trigger button, inactivity timeout, and the frame used for manual and inactivity
triggers. Per-device rules override global rules. The Frame route accepts an
optional `frameId` query parameter to open a particular frame; without it, the
screen shows the configured frame carousel from its first frame.

## Runtime

The dashboard watches pointer, keyboard, touch, and wheel activity. When the
configured inactivity timeout elapses, it opens the selected frame. The manual
trigger button follows the same target rule when enabled. The frame view pages
horizontally, shows pagination dots and an exit control while active, and
requests the browser Screen Wake Lock when supported.

Uploaded wallpaper data is served through the Go wallpaper API. The frontend
revokes temporary object URLs when the view changes or unmounts.
