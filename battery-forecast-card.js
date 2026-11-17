/*
 * Battery Forecast Card for Home Assistant
 * Lists your battery sensors sorted by how many days they have left,
 * estimated from Home Assistant's long-term statistics.
 * https://github.com/Diess-tech/battery-forecast-card
 * MIT License - (c) 2026 Davide Sanna
 */
const BFC_VERSION = "0.1.0";

const BFC_I18N = {
  en: {
    title: "Batteries",
    due: (n, d) => (n === 0 ? `Nothing to replace in the next ${d} days` : n === 1 ? `1 to replace within ${d} days` : `${n} to replace within ${d} days`),
    days: (n) => (n === 1 ? "~1 day" : `~${n} days`),
    weeks: (n) => (n === 1 ? "~1 week" : `~${n} weeks`),
    months: (n) => (n === 1 ? "~1 month" : `~${n} months`),
    over_year: "> 1 year",
    empty: "Replace now",
    learning: "Estimating…",
    stable: "Stable",
    no_data: "No data",
    replaced: (d) => `replaced ${d}`,
    no_sensors: "No battery sensors found.",
    show_more: (n) => `Show ${n} more`,
    show_less: "Show less",
    left: "left",
  },
  it: {
    title: "Batterie",
    due: (n, d) => (n === 0 ? `Niente da cambiare nei prossimi ${d} giorni` : n === 1 ? `1 da cambiare entro ${d} giorni` : `${n} da cambiare entro ${d} giorni`),
    days: (n) => (n === 1 ? "~1 giorno" : `~${n} giorni`),
    weeks: (n) => (n === 1 ? "~1 settimana" : `~${n} settimane`),
    months: (n) => (n === 1 ? "~1 mese" : `~${n} mesi`),
    over_year: "> 1 anno",
    empty: "Da cambiare",
    learning: "Stima in corso…",
    stable: "Stabile",
    no_data: "Nessun dato",
    replaced: (d) => `cambiata ${d}`,
    no_sensors: "Nessun sensore batteria trovato.",
    show_more: (n) => `Mostra altre ${n}`,
    show_less: "Mostra meno",
    left: "rimasti",
  },
};

const BFC_NAME_SUFFIX = /[\s_-]*(battery level|battery|livello batteria|batteria|batterie|niveau de batterie|batterie|akku|bateria)\s*$/i;

function bfcEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function bfcGlob(pattern) {
  const re = "^" + String(pattern).split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$";
  return new RegExp(re);
}

/**
 * Estimate discharge from a series of daily means (oldest -> newest) plus the current value.
 * Returns { rate (% per day, positive = discharging), daysOfData, replacedAt (index or null) }.
 * Exposed as a static helper so it can be tested.
 */
function bfcEstimate(points, current, opts) {
  const o = Object.assign({ jump: 10, minDays: 7, window: 30 }, opts || {});
  // points: [{t: ms, v: number}] daily means
  const pts = points.filter((p) => typeof p.v === "number" && isFinite(p.v));
  const now = o.now || Date.now();
  pts.push({ t: now, v: current });
  // The battery was replaced (or recharged) where the level jumps up AND goes above
  // everything seen in the previous week: this ignores batteries whose reading bounces.
  let start = 0, replacedAt = null;
  for (let i = 1; i < pts.length; i++) {
    const prevMax = Math.max(...pts.slice(Math.max(0, i - 7), i).map((p) => p.v));
    if (pts[i].v - pts[i - 1].v >= o.jump && pts[i].v > prevMax + 5) { start = i; replacedAt = pts[i].t; }
  }
  let seg = pts.slice(start);
  const daysOfData = seg.length > 1 ? (seg[seg.length - 1].t - seg[0].t) / 86400000 : 0;
  if (daysOfData < o.minDays) return { rate: null, daysOfData, replacedAt };
  // batteries drain faster near the end: estimate on the most recent days only
  seg = seg.filter((p) => now - p.t <= o.window * 86400000);
  if (seg.length < 3) return { rate: null, daysOfData, replacedAt };
  // least squares slope in % per day
  const t0 = seg[0].t;
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of seg) {
    const x = (p.t - t0) / 86400000, y = p.v;
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (!den) return { rate: null, daysOfData, replacedAt };
  const slope = (n * sxy - sx * sy) / den;
  return { rate: -slope, daysOfData, replacedAt };
}

class BatteryForecastCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._stats = null;       // statistic_id -> [{t, v}]
    this._statsAt = 0;
    this._loading = false;
    this._expanded = false;
    this._sig = null;
    this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
  }

  static getStubConfig() { return {}; }

  setConfig(config) {
    this._config = Object.assign({
      threshold: 5,            // % considered "empty"
      warning_days: 30,        // red when it runs out within these days
      caution_days: 60,        // orange within these days
      low_level: 20,           // red anyway below this level
      days_history: 60,
      exclude_platforms: ["mobile_app", "browser_mod"],
      exclude: [],
      show_unavailable: true,
      show_type: true,
      limit: 10,
    }, config || {});
    this._sig = null;
    this._statsAt = 0;
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  get _t() {
    const lang = (this._config && this._config.language) ||
      (this._hass && ((this._hass.locale && this._hass.locale.language) || this._hass.language)) || "en";
    return BFC_I18N[String(lang).slice(0, 2)] || BFC_I18N.en;
  }

  getCardSize() { return 5; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }

  // ---------- which sensors ----------
  _entities() {
    const h = this._hass, c = this._config;
    const excl = (c.exclude || []).map(bfcGlob);
    const reg = h.entities || {};
    const overrides = {};
    let ids;
    if (Array.isArray(c.entities) && c.entities.length) {
      ids = c.entities.map((e) => {
        const o = typeof e === "string" ? { entity: e } : e;
        overrides[o.entity] = o;
        return o.entity;
      });
    } else {
      ids = Object.keys(h.states).filter((id) => {
        if (!id.startsWith("sensor.")) return false;
        const s = h.states[id];
        if (s.attributes.device_class !== "battery") return false;
        if (s.attributes.unit_of_measurement !== "%") return false;
        const r = reg[id];
        if (r && (r.hidden || r.hidden_by || r.disabled_by)) return false;
        if (r && (c.exclude_platforms || []).includes(r.platform)) return false;
        return true;
      });
      (c.include || []).forEach((id) => { if (!ids.includes(id)) ids.push(id); });
    }
    return ids
      .filter((id) => !excl.some((re) => re.test(id)))
      .filter((id) => h.states[id])
      .map((id) => ({ id, o: overrides[id] || {} }));
  }

  _name(id, o) {
    if (o.name) return o.name;
    const h = this._hass, s = h.states[id];
    const r = h.entities && h.entities[id];
    const dev = r && r.device_id && h.devices && h.devices[r.device_id];
    let n = s.attributes.friendly_name || id;
    const stripped = n.replace(BFC_NAME_SUFFIX, "").trim();
    if (stripped) n = stripped;
    else if (dev) n = dev.name_by_user || dev.name || n;
    return n;
  }

  _type(id, o) {
    if (o.type) return o.type;
    if (!this._config.show_type) return "";
    this._typeCache = this._typeCache || {};
    const cached = this._typeCache[id];
    if (cached && Date.now() - cached.at < 600000) return cached.v;
    const v = this._findType(id);
    this._typeCache[id] = { v, at: Date.now() };
    return v;
  }

  _findType(id) {
    const h = this._hass, s = h.states[id];
    if (s.attributes.battery_type) return s.attributes.battery_type;
    const r = h.entities && h.entities[id];
    if (!r || !r.device_id) return "";
    // a sibling entity of the same device that describes the battery type (Battery Notes, Matter...)
    for (const [eid, er] of Object.entries(h.entities)) {
      if (er.device_id !== r.device_id || eid === id) continue;
      if (/battery_type|tipo_batteria|battery_notes/.test(eid)) {
        const st = h.states[eid];
        if (st && !["unknown", "unavailable", ""].includes(st.state)) {
          return st.attributes.battery_type_and_quantity || st.state;
        }
      }
    }
    return "";
  }

  // ---------- statistics ----------
  async _loadStats(ids) {
    if (this._loading) return;
    this._loading = true;
    try {
      const start = new Date(Date.now() - this._config.days_history * 86400000);
      const res = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        statistic_ids: ids,
        period: "day",
        types: ["mean"],
      });
      const out = {};
      for (const [id, rows] of Object.entries(res || {})) {
        out[id] = rows.map((r) => ({ t: typeof r.start === "number" ? r.start : new Date(r.start).getTime(), v: r.mean }));
      }
      this._stats = out;
    } catch (e) {
      console.warn("battery-forecast-card: statistics not available", e);
      this._stats = this._stats || {};
    }
    this._statsAt = Date.now();
    this._loading = false;
    this._sig = null;
    this._update();
  }

  // ---------- model ----------
  _rows() {
    const c = this._config, T = this._t;
    return this._entities().map(({ id, o }) => {
      const s = this._hass.states[id];
      const lvl = parseFloat(s.state);
      const row = { id, name: this._name(id, o), type: this._type(id, o), level: isFinite(lvl) ? lvl : null };
      if (row.level === null) {
        row.status = "nodata"; row.label = T.no_data; row.sort = 1e9; return row;
      }
      const est = bfcEstimate((this._stats && this._stats[id]) || [], row.level, { window: c.days_window || 30 });
      row.replacedAt = est.replacedAt;
      if (row.level <= c.threshold) {
        row.days = 0; row.label = T.empty;
      } else if (est.rate === null) {
        row.days = null; row.label = this._stats ? T.learning : "…";
      } else if (est.rate < 0.02) {
        row.days = Infinity; row.label = T.stable;
      } else {
        row.days = (row.level - c.threshold) / est.rate;
        row.label = this._fmtDays(row.days);
      }
      if (row.days === 0 || row.level <= c.low_level || (row.days != null && row.days <= c.warning_days)) row.status = "red";
      else if (row.days != null && row.days <= c.caution_days) row.status = "orange";
      else if (row.days == null) row.status = row.level <= 40 ? "orange" : "grey";
      else row.status = "green";
      // sort: by days left; unknown estimates by level
      row.sort = row.days != null && isFinite(row.days) ? row.days : (row.days === Infinity ? 1e6 + row.level : 365 * (row.level / 100) * 2);
      if (row.level <= c.low_level) row.sort = Math.min(row.sort, row.level / 10);
      return row;
    });
  }

  _fmtDays(d) {
    const T = this._t;
    if (d < 14) return T.days(Math.max(1, Math.round(d)));
    if (d < 60) return T.weeks(Math.round(d / 7));
    if (d < 365) return T.months(Math.round(d / 30.4));
    return T.over_year;
  }

  _signature(rows) {
    return JSON.stringify([this._expanded, this._t === BFC_I18N.it, rows.map((r) => [r.id, r.level, r.label, r.type, r.name])]);
  }

  _update() {
    if (!this._config || !this._hass) return;
    const ids = this._entities().map((e) => e.id);
    const key = ids.join(",");
    if (key !== this._idsKey || Date.now() - this._statsAt > 6 * 3600 * 1000) {
      this._idsKey = key;
      if (ids.length) this._loadStats(ids);
    }
    const rows = this._rows();
    const sig = this._signature(rows);
    if (sig === this._sig) return;
    this._sig = sig;
    this._render(rows);
  }

  _onClick(ev) {
    const el = ev.composedPath().find((n) => n.dataset && (n.dataset.entity || n.dataset.action));
    if (!el) return;
    if (el.dataset.action === "toggle") {
      this._expanded = !this._expanded;
      this._sig = null;
      this._update();
      return;
    }
    const e = new Event("hass-more-info", { bubbles: true, composed: true });
    e.detail = { entityId: el.dataset.entity };
    this.dispatchEvent(e);
  }

  // ---------- render ----------
  _render(rows) {
    const c = this._config, T = this._t;
    let list = rows.slice();
    if (!c.show_unavailable) list = list.filter((r) => r.status !== "nodata");
    list.sort((a, b) => a.sort - b.sort);
    const due = list.filter((r) => r.status === "red").length;
    const limit = c.limit && c.limit > 0 ? c.limit : list.length;
    const shown = this._expanded ? list : list.slice(0, limit);
    const title = c.title === undefined ? T.title : c.title;
    const colors = { red: "#ef5350", orange: "#ffa726", green: "#66bb6a", grey: "#9e9e9e", nodata: "#9e9e9e" };

    const rowsHtml = shown.map((r) => {
      const col = colors[r.status];
      const lvl = r.level == null ? 0 : Math.max(0, Math.min(100, r.level));
      const icon = r.level == null ? "mdi:battery-unknown"
        : r.level <= 5 ? "mdi:battery-outline"
        : `mdi:battery-${Math.min(90, Math.max(10, Math.round(r.level / 10) * 10))}`.replace("battery-100", "battery");
      return `
        <div class="row" data-entity="${bfcEsc(r.id)}">
          <ha-icon icon="${r.level != null && r.level >= 95 ? "mdi:battery" : icon}" style="color:${col}"></ha-icon>
          <div class="info">
            <div class="top">
              <span class="name">${bfcEsc(r.name)}</span>
              ${r.type ? `<span class="type">${bfcEsc(r.type)}</span>` : ""}
            </div>
            <div class="bar"><div class="fill" style="width:${lvl}%;background:${col}"></div></div>
          </div>
          <div class="right">
            <div class="days" style="color:${r.status === "green" || r.status === "grey" ? "var(--primary-text-color)" : col}">${bfcEsc(r.label)}</div>
            <div class="lvl">${r.level == null ? "—" : Math.round(r.level) + "%"}</div>
          </div>
        </div>`;
    }).join("");

    const more = list.length > limit
      ? `<button class="more" data-action="toggle">${bfcEsc(this._expanded ? T.show_less : T.show_more(list.length - limit))}</button>` : "";

    this.shadowRoot.innerHTML = `
      <style>${BatteryForecastCard.styles}</style>
      <ha-card>
        ${title ? `<div class="head">
          <ha-icon class="hicon ${due ? "alert" : ""}" icon="${due ? "mdi:battery-alert-variant-outline" : "mdi:battery-heart-variant"}"></ha-icon>
          <div><div class="htitle">${bfcEsc(title)}</div><div class="hsub">${bfcEsc(T.due(due, c.warning_days))}</div></div>
        </div>` : ""}
        ${list.length ? `<div class="list">${rowsHtml}</div>${more}` : `<div class="emptyl">${bfcEsc(T.no_sensors)}</div>`}
      </ha-card>`;
  }
}

BatteryForecastCard.estimate = bfcEstimate;

BatteryForecastCard.styles = `
  :host { display: block; }
  ha-card { padding: 16px; }
  .head { display: flex; align-items: center; margin-bottom: 10px; }
  .hicon { --mdc-icon-size: 26px; color: #66bb6a; background: rgba(102,187,106,0.15); border-radius: 50%; padding: 9px; margin-right: 12px; }
  .hicon.alert { color: #ef5350; background: rgba(239,83,80,0.15); }
  .htitle { font-size: 1.15rem; font-weight: 700; color: var(--primary-text-color); }
  .hsub { font-size: 0.85rem; color: var(--secondary-text-color); }
  .list { display: grid; grid-gap: 4px; }
  .row { display: flex; align-items: center; padding: 8px 6px; border-radius: 12px; cursor: pointer; }
  .row:hover { background: rgba(127,127,127,0.08); }
  .row > ha-icon { --mdc-icon-size: 24px; margin-right: 12px; flex: none; }
  .info { flex: 1; min-width: 0; }
  .top { display: flex; align-items: center; }
  .name { font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .type { flex: none; margin-left: 8px; font-size: 0.72rem; font-weight: 700; padding: 1px 7px; border-radius: 999px;
    background: rgba(127,127,127,0.18); color: var(--secondary-text-color); }
  .bar { height: 5px; border-radius: 3px; background: rgba(127,127,127,0.22); margin-top: 6px; overflow: hidden; }
  .fill { height: 100%; border-radius: 3px; }
  .right { flex: none; text-align: right; margin-left: 12px; min-width: 92px; }
  .days { font-weight: 700; font-size: 0.92rem; white-space: nowrap; }
  .lvl { font-size: 0.8rem; color: var(--secondary-text-color); }
  .more { width: 100%; margin-top: 8px; border: none; border-radius: 12px; padding: 9px; font: inherit; font-weight: 600;
    background: rgba(127,127,127,0.12); color: var(--primary-text-color); cursor: pointer; }
  .emptyl { color: var(--secondary-text-color); padding: 8px 4px; }
`;

if (!customElements.get("battery-forecast-card")) {
  customElements.define("battery-forecast-card", BatteryForecastCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "battery-forecast-card")) {
  window.customCards.push({
    type: "battery-forecast-card",
    name: "Battery Forecast Card",
    description: "Your battery sensors sorted by how many days they have left, estimated from Home Assistant statistics.",
    preview: true,
    documentationURL: "https://github.com/Diess-tech/battery-forecast-card",
  });
}
console.info(`%c BATTERY-FORECAST-CARD %c v${BFC_VERSION} `, "color:#fff;background:#66bb6a;font-weight:700", "color:#66bb6a");
