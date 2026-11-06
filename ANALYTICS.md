# Arrow Escape analytics

The web game and Chrome WebAPK use the GA4 Web stream `G-TLQF7ETW8C`.
The Google tag loads asynchronously; a blocked tag must not prevent gameplay.
Advertising signals are disabled. Browser Do Not Track and Global Privacy Control are respected.
Custom events contain game metadata, not player names, emails, or saved game contents.

## Reports

- **Reports > Realtime**: users active in the last 5/30 minutes and recent event counts. This is not an exact concurrent-player counter.
- **Reports > Engagement > Events** (or the Events report under the engagement collection): game starts, APK clicks, and installed-app opens. Normal reports take longer than Realtime to populate.
- Built-in engagement time includes the home screen. Use the custom `play_seconds` metric below for gameplay time.

## Custom definitions

In **Admin > Data display > Custom definitions**, create event-scoped dimensions:

| Display name | Event parameter | Meaning |
| --- | --- | --- |
| App mode | `app_mode` | `browser` or `installed` |
| Game mode | `game_mode` | `original`, `color`, or `adventure` |
| Play hour (India) | `play_hour` | 0–23 in Asia/Kolkata |
| Play date (India) | `play_date` | Local date when activity occurred |
| Level number | `level_number` | Optional breakdown by level |

Create one event-scoped custom metric: **Gameplay seconds**, parameter **`play_seconds`**, unit **Seconds**.
In Explorations, use the `gameplay_time` event with this metric; group by Play hour (India) to inspect when players play.
Custom definitions collect reportable values after registration; they are not retroactive.

## Events and limits

| Event | Meaning |
| --- | --- |
| `apk_download_click` | A click on the APK link; not a completed download or installation |
| `installed_app_open` | Game opened in an installed display mode |
| `installed_app_first_open` | First observed installed-mode open since this tracking was added, once per retained local storage |
| `pwa_install_accepted` | Browser install accepted; on Android this can occur before the WebAPK finishes installing |
| `game_start` | Actual entry into gameplay from the home screen |
| `level_start` / `level_end` | Level attempt and result (`success` true/false) |
| `gameplay_time` | Visible, unpaused play time, emitted in roughly 30-second chunks and when leaving/pausing |

Installed-mode first opens are an estimate of app use, not an OS installation inventory.
Cleared storage, separate browser profiles, and never-opened installations affect counts.
No historical install count or uninstall count is available from this web implementation.

Offline custom events are buffered best-effort on the device (up to 200 events, retained at most 7 days) and sent when online and the Google tag loads.
GA4 uses delivery time for its standard event timestamp; `play_date` and `play_hour` preserve the original India time.
Offline users do not appear live. Ad blockers, privacy settings, and storage restrictions can reduce measured counts.
Saving the queue uses separate analytics keys and does not modify game progress.

## Verification

Run `node --experimental-vm-modules --test analytics.test.mjs`.
Then open the game online, start a level, pause via Settings, return Home, and check events in Realtime.
