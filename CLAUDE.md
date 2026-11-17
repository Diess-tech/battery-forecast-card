# Battery Forecast Card — notes for Claude

- Single-file vanilla JS custom card (`battery-forecast-card.js`), no build step, no dependencies, Shadow DOM.
- Auto-discovers `sensor.*` with device_class battery and unit %, skipping hidden/disabled entities and platforms in `exclude_platforms` (default mobile_app, browser_mod). `entities:` replaces discovery; `exclude` supports `*`.
- Data: `recorder/statistics_during_period` (period day, type mean) over `days_history` (60), reloaded every 6 h or when the entity list changes.
- Estimate in `bfcEstimate` (also `BatteryForecastCard.estimate`): replacement = jump >= 10 points AND above the max of the previous 7 days (ignores bouncing readings, e.g. door locks); needs >= 7 days after replacement; least-squares slope on the last `days_window` (30) days; days left = (level − threshold) / rate.
- Battery type: `battery_type` attribute, or a sibling entity of the same device whose id contains battery_type / tipo_batteria / battery_notes (cached 10 min).
- UI strings in `BFC_I18N` (en, it). Keep `hacs.json` filename in sync; bump `BFC_VERSION` and make a GitHub release for every version.
- The author (Davide) is Italian and a hobbyist: explain things to him in simple Italian.
- In Davide's HA the same logic existed as a template in automation.riassunto_settimanale_aggiorna_dati (writes input_text.riassunto_batterie_da_cambiare every Monday). His rechargeables to exclude: sensor.ambrogio_*, sensor.spazzolino_*, sensor.cortile_harley_*; PetKit food/fountain report 0%.
