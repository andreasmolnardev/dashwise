## Screensaver / Smart Frames

This document describes the current screensaver behavior, how it is configured, and what remains to be implemented for the Smart Frames redesign.

### What Exists Today

**Data model**
- The configuration is stored in `user.screensaverPreferences` (JSON) with local overrides via `dashwise_screensaver_local` in `localStorage`.
- Current fields used by the screensaver renderer include:
	- `useHomePageStyle` (bool)
	- `clockFont` (string)
	- `clockFontWeight` (string, e.g. `font-normal`)
	- `color` (string, rgba)
	- `size` (number, rem)
	- `showButton` (bool)
	- `inactivityTimeout` (number, seconds)

**Runtime behavior**
- The dashboard screensaver component reads `user.screensaverPreferences` and merges local overrides when present.
- It currently renders a single full-screen clock view when active.
- The screensaver exits on click/tap.

**Settings**
- The settings navigation label has been renamed to “Smart frames”, but the actual settings page implementation is currently broken due to a corrupted rewrite.
- The intention is to keep using `screensaverPreferences` for both global and local configuration.

### What Is Working

- JSON configuration storage on `user.screensaverPreferences` is already wired and read by the screensaver renderer.
- Local override (`dashwise_screensaver_local`) is supported and hot-reloaded via the `dashwise_local_config_updated` event.
- The screensaver view itself renders and exits properly when activated.

### What Is Not Working Yet

- The Smart Frames settings UI is currently broken (the file is corrupted). It needs to be restored before users can manage frames or triggers.
- There is no frame carousel yet in the screensaver view. The renderer still shows a single clock widget.
- Wake Lock is not implemented in the current screensaver component, so screens can still dim or sleep.
- The overlays requested for Smart Frames (pagination dots and close button on hover) are not present.
- There is no widget-based frame system wired to the UI or runtime view yet.

### What Still Needs To Be Implemented

**Settings UI**
- Rebuild the settings page to manage Smart Frames stored in `screensaverPreferences.frames`.
- Add a horizontal carousel list of frames with drag-and-drop ordering and a drag handle.
- Provide a way to add frames by selecting any widget type from the widget catalog.

**Runtime screensaver view**
- Render frames from `screensaverPreferences.frames` instead of a single clock.
- Allow horizontal paging between frames (snap scrolling or similar).
- Show bottom pagination dots and a close button on hover.
- Add Wake Lock support to keep the screen active while the Smart Frame view is displayed.

**Compatibility**
- Keep supporting `screensaverPreferences` and `dashwise_screensaver_local` as the single source of truth.
- Provide a default fallback frame (clock) when no frames exist.
