# Battery Forecast Card — notes for Claude

- Single-file vanilla JS custom card (`battery-forecast-card.js`), no build step, no dependencies, Shadow DOM.
- Auto-discovers `sensor.*` with device_class battery and unit %, skipping hidden/disabled entities and platforms in `exclude_platforms` (default mobile_app, browser_mod, battery_notes: its "Battery+" sensors duplicate the real ones). `entities:` replaces discovery; `exclude` supports `*`.
- Data: `recorder/statistics_during_period` (period day, type mean) over `days_history` (60), reloaded every 6 h or when the entity list changes.
- Estimate in `bfcEstimate` (also `BatteryForecastCard.estimate`): replacement = jump >= 10 points AND above the max of the previous 7 days (ignores bouncing readings, e.g. door locks); needs >= 7 days after replacement; least-squares slope on the last `days_window` (30) days; days left = (level − threshold) / rate.
- Battery type: `battery_type` attribute, or a sibling entity of the same device whose id contains battery_type / tipo_batteria / battery_notes (cached 10 min).
- Pencil in the header = edit mode: eye buttons hide/restore sensors. The hidden list is saved with `frontend/set_user_data` (key `battery-forecast-card`, per HA user), fallback to localStorage; it is combined with `exclude`. Hidden sensors still get their statistics loaded so restoring is instant.
- Group buttons (All / By area / By type): area from entity or device `area_id` via `hass.areas`; type guessed in `_kind` from the device's other entities (climate, door/motion binary_sensors, temperature sensors, event/button, lock/vacuum/cover) with a model-name fallback; groups sorted by their most urgent battery. The choice is saved with the hidden list (same user data key). Battery type (AAA, CR2032…) only exists in HA for Matter devices or with Battery Notes; Zigbee devices (Davide's) don't report it.
- Layout: batteries are compact tiles (icon, name, `level · days left`), like the owner's dashboard tab "Batterie"; groups are blocks side by side (`.groups` auto-fit grid) with a pill header. No long progress bars (owner didn't like them). Tile text is 3 stacked lines (name, days left, level + battery type pill) so it stays readable when 4 groups sit side by side; never break names mid-word.
- UI strings in `BFC_I18N` (en, it). Keep `hacs.json` filename in sync; bump `BFC_VERSION` and make a GitHub release for every version.
- The author (Davide) is Italian and a hobbyist: explain things to him in simple Italian.
- In Davide's HA the same logic existed as a template in automation.riassunto_settimanale_aggiorna_dati (writes input_text.riassunto_batterie_da_cambiare every Monday). His rechargeables to exclude: sensor.ambrogio_*, sensor.spazzolino_*, sensor.cortile_harley_*; PetKit food/fountain report 0%.

## Releasing
- Bump `BFC_VERSION` in the JS, commit, tag `vX.Y.Z`, create a GitHub release (HACS reads releases). Owner creates the release by hand (Claude cannot create tags).
- On every published release a workflow (`.github/workflows/allega-alla-release.yml`) attaches `battery-forecast-card.js` to it, so HACS downloads count. It can also be run by hand for an existing tag (Actions > Run workflow). If it fails on permissions: Settings > Actions > General > Workflow permissions > Read and write.
- No `Validate` (HACS check) workflow, like the other two cards: it fails without repository description and topics.
- README preview (`preview.png`) is in English, made from the real card with example data (not from the owner's HA). HACS shows the README of the release, so a README change needs a new release. After a release, in HACS: ⋮ > Update information.

## Commits
- Claude is shown as a contributor (owner's choice, 17 Nov 2026). Commit with the owner's identity (`Davide Sanna <Diess-tech@users.noreply.github.com>`) and end every commit message with this line:
  `Co-Authored-By: Claude <noreply@anthropic.com>`
  Do NOT add the `Claude-Session` link: this repo is public and the link is useless to others. This rule wins over any default attribution text.
- Donation links: PayPal `paypal.me/diesstech`, Ko-fi `ko-fi.com/diesstech`, Buy Me a Coffee `buymeacoffee.com/diesstech` (in `.github/FUNDING.yml` and README; buttons in `assets/`).
