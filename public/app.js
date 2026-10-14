/* cf-workers-status-page v2 frontend — vanilla JS, no build step. */
'use strict'

const $ = (sel) => document.querySelector(sel)

let CONFIG = null
let LOCATIONS = {}
let STATE = { monitors: {}, lastUpdate: {} }
let FILTER = ''
let VIEW = 'status' // 'status' | 'incidents' | 'speedtest'
let INC_MONTH = null // 'YYYY-MM' for the incidents view; null = current month
let INC_MONITOR = '' // monitor id filter for the incidents view
const OPENED_AT = Date.now()

const GROUP_LABEL = { Vietnam: '🇻🇳 Vietnam', International: '🌏 International' }
const groupOf = (m) => m.group || 'Other'
const groupLabel = (g) => GROUP_LABEL[g] || g

// All displayed clock times use Vietnam time.
const TIME_ZONE = 'Asia/Saigon'
const TZ_LABEL = 'GMT+7'

function expandedGroups() {
  try {
    const saved = JSON.parse(localStorage.getItem('expandedGroups') || 'null')
    if (Array.isArray(saved)) return new Set(saved)
  } catch (e) {}
  return null // null = default: everything collapsed (click a group to expand)
}
function saveExpandedGroups(set) {
  try {
    localStorage.setItem('expandedGroups', JSON.stringify([...set]))
  } catch (e) {}
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const dayStr = (d) => d.toISOString().split('T')[0]

// "2026-10-14" -> locale date like "10/14/2026" (UptimeFlare style).
// Built as a local date (not UTC) so timezones can't shift the day.
const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString()
}

// "14:56:16 14/10/2026" in Asia/Saigon.
const fmtDateTime = (ms) => {
  const d = new Date(ms)
  const date = d.toLocaleDateString('en-GB', { timeZone: TIME_ZONE })
  const time = d.toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour12: false })
  return `${time} ${date}`
}

// Hero subtitle, shared by the initial render and the 1s ticker.
function heroMeta(lu) {
  const secs = Math.max(0, Math.round((Date.now() - lu.time) / 1000))
  return `Last updated on: ${fmtDateTime(lu.time)} (${TZ_LABEL}) (${secs} sec ago)`
}

const MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>'
const SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>'

// Tabler outline icons (IconCircleCheck / IconAlertCircle / plain circle)
const CHECK_PATHS =
  '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M8 12.5l2.5 2.5l5 -5"/>'
const ALERT_PATHS =
  '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 8v4"/><path d="M12 16h.01"/>'
// Tabler alert-triangle (maintenance), UptimeFlare #FAB005
const TRIANGLE_PATHS =
  '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0z"/>'
const CIRCLE_PATHS = '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/>'
const tabler = (paths, size, color, cls) =>
  `<svg${cls ? ` class="${cls}"` : ''} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

// 3-state theme: 'auto' (follow OS) -> 'light' -> 'dark' -> 'auto'.
// Persisted in localStorage; in auto mode OS changes apply live.
function themeMode() {
  try {
    const v = localStorage.getItem('theme')
    return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto'
  } catch (e) {
    return 'auto'
  }
}
function systemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
function effectiveTheme() {
  const mode = themeMode()
  return mode === 'auto' ? (systemDark() ? 'dark' : 'light') : mode
}
function applyTheme() {
  const mode = themeMode()
  const eff = effectiveTheme()
  document.documentElement.dataset.theme = eff
  const btn = $('#themeBtn')
  if (btn) {
    btn.innerHTML = eff === 'dark' ? SUN : MOON
    const label =
      mode === 'auto'
        ? `Auto (${eff === 'dark' ? 'dark' : 'light'})`
        : mode === 'dark'
          ? 'Dark'
          : 'Light'
    btn.title = `Theme: ${label} — click to change`
    btn.setAttribute('aria-label', btn.title)
  }
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark']
  const next = order[(order.indexOf(themeMode()) + 1) % order.length]
  try {
    localStorage.setItem('theme', next)
  } catch (e) {}
  applyTheme()
}

// Per-day stats over the daysInHistogram window. Each entry:
// { day, avg, fails, locs, hasData, pct, downSecs }
// pct: day uptime % (null when no data). Downtime is estimated from fail
// episodes vs total check samples that day (fails counts incident episodes,
// not samples — this is the most faithful estimate the data model allows).
function dayStats(data) {
  const n = CONFIG.settings.daysInHistogram
  const days = []
  const d = new Date()
  d.setDate(d.getDate() - n)
  for (let i = 0; i < n; i++) {
    d.setDate(d.getDate() + 1)
    const day = dayStr(d)
    let avg = null
    let fails = 0
    let samples = 0
    const locs = []
    let hasData = false
    if (data && data.firstCheck <= day) {
      const e = data.checks && data.checks[day]
      if (e) {
        hasData = true
        fails = e.fails || 0
        let tot = 0
        let cnt = 0
        for (const loc of Object.keys(e.res || {})) {
          const r = e.res[loc]
          samples += r.n
          tot += r.a * r.n
          cnt += r.n
          locs.push({ loc, a: r.a })
        }
        if (cnt > 0) avg = tot / cnt
      }
    }
    let pct = null
    let downSecs = 0
    if (hasData) {
      if (fails === 0) {
        pct = 100
      } else {
        const checks = samples + fails
        const interval = checks > 0 ? 86400 / checks : 86400
        downSecs = Math.min(86400, Math.round(fails * interval))
        pct = Math.max(0, (1 - downSecs / 86400) * 100)
      }
    }
    days.push({ day, avg, fails, locs, hasData, pct, downSecs })
  }
  return days
}

// UptimeFlare-style overall: 1 - (estimated down seconds / monitored seconds),
// aggregated over the daysInHistogram window. Days without data (or before
// firstCheck) count toward neither side. Returns null when no day has data.
function overallInfo(data) {
  const days = dayStats(data).filter((dd) => dd.hasData && dd.pct != null)
  if (days.length === 0) return null
  const monSecs = days.length * 86400
  const downSecs = days.reduce((s, dd) => s + (dd.downSecs || 0), 0)
  return { pct: Math.max(0, (1 - downSecs / monSecs) * 100) }
}

// UptimeFlare 4-tier status colors.
function overallColor(pct) {
  if (pct >= 99.9) return '#059669'
  if (pct >= 99) return '#3BD671'
  if (pct >= 95) return '#F29030'
  return '#DF484A'
}

// UptimeFlare bar colors (util/color.ts, darker=false):
// >=99.9% green, 99-99.9% light green, 95-99% orange, <95% red, no data gray.
function barColor(dd) {
  if (!dd.hasData || dd.pct == null || Number.isNaN(dd.pct))
    return 'var(--bar-nodata)'
  if (dd.pct >= 99.9) return '#3BD671'
  if (dd.pct >= 99) return '#9DEAB8'
  if (dd.pct >= 95) return '#F29030'
  return '#DF484A'
}

function fmtDur(s) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

function monitorStatusIcon(monitor, data) {
  if (isInMaintenance(monitor.id, Date.now())) {
    return tabler(TRIANGLE_PATHS, '1.25em', '#FAB005', 'micon')
  }
  if (!data || typeof data.lastCheck === 'undefined') {
    return tabler(CIRCLE_PATHS, '1.25em', 'var(--muted)', 'micon')
  }
  return data.lastCheck.operational
    ? tabler(CHECK_PATHS, '1.25em', '#059669', 'micon')
    : tabler(ALERT_PATHS, '1.25em', 'var(--red-dark)', 'micon')
}

// Phase 6: latency threshold alerts ("degraded" state). Purely client-side:
// median of the last 12 ring-buffer points (~2h). Needs >= 3 points; a single
// spike can't trigger it (median, not mean). Never touches uptime math.
function latencyMedianMs(data) {
  const vals = ((data && data.latency) || [])
    .filter((p) => p && Number.isFinite(p.ms))
    .slice(-12)
    .map((p) => p.ms)
    .sort((a, b) => a - b)
  if (vals.length < 3) return null
  const mid = Math.floor(vals.length / 2)
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
}

function latencyDegraded(monitor, data) {
  const t = monitor.latencyThresholdMs
  if (!Number.isFinite(t) || t <= 0) return false
  const med = latencyMedianMs(data)
  return med != null && med > t
}

function latencyPill(monitor, data) {
  if (!latencyDegraded(monitor, data)) return ''
  const med = latencyMedianMs(data)
  const n = ((data && data.latency) || []).filter((p) => p && Number.isFinite(p.ms)).slice(-12)
    .length
  const tip = `Median latency ${Math.round(med)}ms over last ${n} checks (threshold ${monitor.latencyThresholdMs}ms)`
  return `<span class="lat-pill" title="${esc(tip)}">High latency</span>`
}

// ---- Scheduled maintenances (UptimeFlare-style). Display only: config-driven
// windows shown on the Incidents view; affected monitors get a yellow triangle.

function parseTs(v) {
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

function allMaintenances() {
  return (CONFIG.maintenances || []).filter((m) => m && parseTs(m.start) != null)
}

function maintActive(mt, now) {
  const s = parseTs(mt.start)
  const e = mt.end ? parseTs(mt.end) : null
  return s != null && s <= now && (e == null || now <= e)
}

function maintCovers(mt, monitorId) {
  return !mt.monitors || mt.monitors.length === 0 || mt.monitors.includes(monitorId)
}

function isInMaintenance(monitorId, now) {
  return allMaintenances().some((mt) => maintActive(mt, now) && maintCovers(mt, monitorId))
}

// Does the window overlap the calendar month 'YYYY-MM'?
function maintOverlapsMonth(mt, ym) {
  const [y, m] = ym.split('-').map(Number)
  const ms = new Date(y, m - 1, 1).getTime()
  const me = new Date(y, m, 1).getTime()
  const s = parseTs(mt.start)
  const e = mt.end ? parseTs(mt.end) : Infinity
  return s != null && s < me && e > ms
}

// "22:33:00 15/2/2026 (GMT+7)" in Asia/Saigon.
function fmtMaintTs(v) {
  return `${fmtDateTime(parseTs(v))} (${TZ_LABEL})`
}

function maintenanceCard(mt) {
  const color = mt.color || '#FAB005'
  const names = (mt.monitors || []).map((id) => {
    const m = CONFIG.monitors.find((x) => x.id === id)
    return m ? m.name : id
  })
  return (
    `<div class="maint">` +
    `<div class="maint-head">${tabler(TRIANGLE_PATHS, 22, color)}` +
    `<strong>${esc(mt.title || 'Scheduled Maintenance')}</strong>` +
    `<span class="maint-dates"><span><b>From:</b> ${esc(fmtMaintTs(mt.start))}</span>` +
    `<span><b>To:</b> ${esc(mt.end ? fmtMaintTs(mt.end) : 'Until further notice')}</span></span></div>` +
    (mt.body ? `<div class="maint-body">${esc(mt.body)}</div>` : '') +
    (names.length
      ? `<div class="maint-aff"><b>Affected components:</b><ul>${names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
      : '') +
    `</div>`
  )
}

let CHARTS = []
let STRIPS = {}

const f1 = (v) => v.toFixed(1)
// Catmull-Rom -> cubic Bezier smoothing, UptimeFlare-style smooth latency line
const smoothPath = (pts) => {
  if (pts.length < 3) {
    return 'M' + pts.map((p) => `${f1(p.x)},${f1(p.y)}`).join('L')
  }
  let d = `M${f1(pts[0].x)},${f1(pts[0].y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    d +=
      `C${f1(p1.x + (p2.x - p0.x) / 6)},${f1(p1.y + (p2.y - p0.y) / 6)}` +
      ` ${f1(p2.x - (p3.x - p1.x) / 6)},${f1(p2.y - (p3.y - p1.y) / 6)}` +
      ` ${f1(p2.x)},${f1(p2.y)}`
  }
  return d
}

// Nice axis step from the 1/2/5/10 series
function niceStep(v) {
  if (!(v > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n >= 5 ? 10 : n >= 2 ? 5 : 2) * p
}

// Hour tick label in Asia/Saigon, 12h format without leading zero: "3AM", "12PM"
function hourLabel(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    hour12: true,
  }).formatToParts(new Date(ts * 1000))
  const h = parts.find((p) => p.type === 'hour').value
  const ap = parts.find((p) => p.type === 'dayPeriod').value
  return h + ap
}

// Bold tooltip timestamp like UptimeFlare, in Asia/Saigon:
// "Oct 14, 2026, 8:37:44 am (GMT+7)"
function fmtTs(ts) {
  const d = new Date(ts * 1000)
  const date = d.toLocaleDateString('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  let time = d.toLocaleTimeString('en-US', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
  time = time.replace(/ ([AP])M$/, (_, p) => ` ${p.toLowerCase()}m`)
  return `${date}, ${time} (${TZ_LABEL})`
}

// GĐ4: 12h intraday latency chart (UptimeFlare DetailChart style).
// Per-check points from the Worker's 12h ring buffer; failed checks leave gaps.
function latencyChart(monitor, data, ci) {
  const now = Date.now() / 1000
  const from = now - 12 * 3600
  const pts = ((data && data.latency) || []).filter((p) => p && p.t >= from - 1)
  CHARTS[ci] = { pts, from, now }

  const title = `<div class="chart-title">Response times(ms)</div>`
  if (pts.length < 2) {
    return title + `<div class="chart-nodata">No data yet</div>`
  }

  const W = 600
  const H = 150
  const padL = 46
  const padR = 8
  const padT = 8
  const padB = 20
  const thr =
    Number.isFinite(monitor.latencyThresholdMs) && monitor.latencyThresholdMs > 0
      ? monitor.latencyThresholdMs
      : 0
  const rawMax = Math.max(1, ...pts.map((p) => p.ms), thr)
  const step = niceStep(rawMax / 4)
  const maxV = Math.ceil(rawMax / step) * step
  const X = (t) => padL + ((t - from) / (now - from)) * (W - padL - padR)
  const Y = (v) => padT + (1 - v / maxV) * (H - padT - padB)

  let grid = ''
  for (let v = 0; v <= maxV + 1e-9; v += step) {
    const y = Y(v)
    grid +=
      `<line x1="${padL}" y1="${f1(y)}" x2="${W - padR}" y2="${f1(y)}" class="cgrid" vector-effect="non-scaling-stroke"/>` +
      `<text x="${padL - 6}" y="${f1(y + 3.5)}" text-anchor="end" class="ctick">${v.toLocaleString()}</text>`
  }
  let xticks = ''
  // Hour boundaries in Asia/Saigon (UTC+7, no DST) so labels sit on the hour.
  const TZ_OFF = 7 * 3600
  for (
    let t = Math.ceil((from + TZ_OFF) / 3600) * 3600 - TZ_OFF;
    t <= now;
    t += 3600
  ) {
    xticks += `<text x="${f1(X(t))}" y="${H - 6}" text-anchor="middle" class="ctick xt">${hourLabel(t)}</text>`
  }

  // Phase 6: dashed threshold line (always inside the plot: rawMax covers thr).
  let threshLine = ''
  if (thr > 0) {
    const ty = Y(thr)
    const ly = Math.max(ty - 5, 12)
    threshLine =
      `<line x1="${padL}" y1="${f1(ty)}" x2="${W - padR}" y2="${f1(ty)}" class="cthresh" vector-effect="non-scaling-stroke"/>` +
      `<text x="${W - padR - 4}" y="${f1(ly)}" text-anchor="end" class="cthresh-label">${thr.toLocaleString()}ms</text>`
  }

  // Break the line where a gap exceeds ~1.8x the median check interval
  // (failed checks store nothing, so they render as gaps like UptimeFlare).
  const dts = []
  for (let i = 1; i < pts.length; i++) dts.push(pts[i].t - pts[i - 1].t)
  const sorted = dts.slice().sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)] || 600
  const gapAt = Math.max(med * 1.8, 120)
  let line = ''
  let seg = []
  const flushSeg = () => {
    if (seg.length > 1) {
      line += `<path d="${smoothPath(seg.map((p) => ({ x: X(p.t), y: Y(p.ms) })))}" class="cline" vector-effect="non-scaling-stroke"/>`
    }
    seg = []
  }
  pts.forEach((p, i) => {
    if (i > 0 && p.t - pts[i - 1].t > gapAt) flushSeg()
    seg.push(p)
  })
  flushSeg()

  return (
    title +
    `<div class="chart-wrap" data-ci="${ci}">` +
    `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">` +
    grid +
    threshLine +
    `<g class="xticks">${xticks}</g>` +
    line +
    `</svg><div class="chart-tip" hidden></div></div>`
  )
}

// 90-day uptime bar strip (UptimeFlare signature element).
function uptimeStrip(monitor, data, ci) {
  const days = dayStats(data)
  STRIPS[ci] = days
  const bars = days
    .map(
      (dd) =>
        `<div class="ubar${dd.hasData && dd.fails > 0 ? ' clickable' : ''}"` +
        ` data-ci="${ci}" data-day="${dd.day}" style="background:${barColor(dd)}"` +
        ` role="img" aria-label="${esc(fmtDay(dd.day))}"></div>`,
    )
    .join('')
  return (
    `<div class="ustrip-wrap" data-mname="${esc(monitor.name)}">` +
    `<div class="ustrip" data-ci="${ci}">${bars}</div>` +
    `<div class="strip-tip" hidden></div></div>`
  )
}

function bindCharts() {
  document.querySelectorAll('.chart-wrap').forEach((wrap) => {
    const st = CHARTS[parseInt(wrap.dataset.ci, 10)]
    if (!st || !st.pts || st.pts.length < 2) return
    const svg = wrap.querySelector('svg')
    const tip = wrap.querySelector('.chart-tip')
    const { pts, from, now } = st
    // UptimeFlare "index" mode: hovering anywhere snaps to the nearest check.
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect()
      const fx = (e.clientX - r.left) / r.width
      const t = from + fx * (now - from)
      let bi = 0
      let bd = Infinity
      for (let i = 0; i < pts.length; i++) {
        const d = Math.abs(pts[i].t - t)
        if (d < bd) {
          bd = d
          bi = i
        }
      }
      const p = pts[bi]
      const locName = esc(LOCATIONS[p.loc] || p.loc || '')
      tip.innerHTML =
        `<div class="tip-ts">${fmtTs(p.t)}</div>` +
        (locName
          ? `<div>${Math.round(p.ms)}ms (${locName})</div>`
          : `<div>${Math.round(p.ms)}ms</div>`)
      tip.hidden = false
      const wr = wrap.getBoundingClientRect()
      let left = e.clientX - wr.left + 14
      left = Math.max(4, Math.min(left, wr.width - 170))
      tip.style.left = left + 'px'
      tip.style.top = Math.max(4, e.clientY - wr.top - 10) + 'px'
    })
    svg.addEventListener('mouseleave', () => {
      tip.hidden = true
    })
  })
}

function bindStrips() {
  document.querySelectorAll('.ustrip-wrap').forEach((wrap) => {
    const strip = wrap.querySelector('.ustrip')
    const tip = wrap.querySelector('.strip-tip')
    const ci = parseInt(strip.dataset.ci, 10)
    const lookup = {}
    for (const dd of STRIPS[ci] || []) lookup[dd.day] = dd

    const showTip = (bar) => {
      const dd = lookup[bar.dataset.day]
      if (!dd) return
      // UptimeFlare shows no tooltip at all for no-data days.
      if (!dd.hasData || dd.pct == null) {
        tip.hidden = true
        return
      }
      let html = `<span class="tip-label2">${dd.pct.toPrecision(4)}% at ${fmtDay(dd.day)}</span>`
      if (dd.downSecs > 0) {
        html += `<span class="tip-avg">Down for ${fmtDur(dd.downSecs)} (click for detail)</span>`
      }
      tip.innerHTML = html
      tip.hidden = false
      const wr = wrap.getBoundingClientRect()
      const br = bar.getBoundingClientRect()
      const tipW = tip.offsetWidth
      const tipH = tip.offsetHeight
      let left = br.left - wr.left + br.width / 2 - tipW / 2
      left = Math.max(4, Math.min(left, wr.width - tipW - 4))
      tip.style.left = left + 'px'
      tip.style.top = Math.max(0, bar.offsetTop - tipH - 8) + 'px'
    }

    strip.querySelectorAll('.ubar').forEach((bar) => {
      bar.addEventListener('mousemove', () => showTip(bar))
      bar.addEventListener('mouseleave', () => {
        tip.hidden = true
      })
      bar.addEventListener('click', () => {
        const dd = lookup[bar.dataset.day]
        if (dd && dd.downSecs > 0) openIncidentModal(wrap.dataset.mname, dd)
      })
    })
  })
}

// Drop oldest bars from the left so the strip fits its container width.
function fitStrips() {
  document.querySelectorAll('.ustrip').forEach((strip) => {
    let guard = 200
    while (strip.scrollWidth > strip.clientWidth + 1 && strip.children.length > 24 && guard-- > 0) {
      strip.removeChild(strip.firstElementChild)
    }
  })
}

function openIncidentModal(monitorName, dd) {
  const avgs = dd.locs
    .map((l) => `<div>${esc(LOCATIONS[l.loc] || l.loc)}: ${Math.round(l.a)}ms avg</div>`)
    .join('')
  $('#incidentModalTitle').textContent = `🚨 ${monitorName} incidents at ${fmtDay(dd.day)}`
  $('#incidentModalBody').innerHTML =
    `<div><strong>Monitor:</strong> ${esc(monitorName)}</div>` +
    `<div><strong>Uptime:</strong> ${dd.pct.toPrecision(4)}%</div>` +
    `<div><strong>Est. downtime:</strong> ${fmtDur(dd.downSecs)}</div>` +
    `<div><strong>Incident episodes:</strong> ${dd.fails}</div>` +
    (dd.avg != null ? `<div><strong>Avg response:</strong> ${Math.round(dd.avg)}ms</div>` : '') +
    (avgs ? `<div style="margin-top:8px"><strong>Per location:</strong>${avgs}</div>` : '')
  $('#incidentModal').hidden = false
}

function closeIncidentModal() {
  $('#incidentModal').hidden = true
}

// ---- Incidents view (UptimeFlare-style: month pager + monitor filter + list) ----

// All monitor-days with recorded failures, newest first.
function incidentEntries() {
  const out = []
  for (const m of CONFIG.monitors) {
    const data = STATE.monitors[m.id]
    if (!data) continue
    for (const dd of dayStats(data)) {
      if (dd.hasData && dd.fails > 0) {
        out.push({
          day: dd.day,
          monitor: m,
          fails: dd.fails,
          downSecs: dd.downSecs,
          avg: dd.avg,
        })
      }
    }
  }
  out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  return out
}

function curMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Earliest month that can still hold incident data: KV only retains
// daysInHistogram days, and each monitor starts at its own firstCheck.
// Paging earlier would misleadingly show "no incidents" for months whose
// data no longer exists.
function earliestMonthStr() {
  let earliest = null
  for (const m of CONFIG.monitors) {
    const data = STATE.monitors[m.id]
    const fc = data && data.firstCheck
    if (fc && (!earliest || fc < earliest)) earliest = fc
  }
  return (earliest || dayStr(new Date())).slice(0, 7)
}

function monthShift(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
  })
}

function renderIncidents() {
  const month = INC_MONTH || curMonthStr()
  const minMonth = earliestMonthStr()
  const maxMonth = curMonthStr()
  const entries = incidentEntries().filter(
    (e) =>
      e.day.startsWith(month) && (!INC_MONITOR || e.monitor.id === INC_MONITOR),
  )
  const options =
    `<option value="">All monitors</option>` +
    CONFIG.monitors
      .map(
        (m) =>
          `<option value="${esc(m.id)}"${INC_MONITOR === m.id ? ' selected' : ''}>${esc(m.name)}</option>`,
      )
      .join('')
  const list = entries.length
    ? entries
        .map(
          (e) =>
            `<div class="incident">` +
            `<div class="incident-head"><span class="incident-dot"></span>` +
            `<strong>${esc(e.monitor.name)}</strong>` +
            `<span class="incident-date">${fmtDay(e.day)}</span></div>` +
            `<div class="incident-body">Est. downtime ${fmtDur(e.downSecs)} &middot; ` +
            `${e.fails} incident episode${e.fails === 1 ? '' : 's'}` +
            (e.avg != null ? ` &middot; ${Math.round(e.avg)}ms avg` : '') +
            `</div></div>`,
        )
        .join('')
    : `<div class="no-incidents">No incidents recorded in ${esc(fmtMonth(month))}.</div>`
  const maints = allMaintenances()
    .filter(
      (mt) => maintOverlapsMonth(mt, month) && (!INC_MONITOR || maintCovers(mt, INC_MONITOR)),
    )
    .sort((a, b) => parseTs(b.start) - parseTs(a.start))
    .map(maintenanceCard)
    .join('')
  $('#incidents').innerHTML =
    `<div class="inc-controls"><select id="incMonitorFilter" aria-label="Filter by monitor">${options}</select></div>` +
    maints +
    list +
    `<div class="inc-pager">` +
    `<button class="btn" id="incPrev"${month <= minMonth ? ' disabled' : ''}>&larr; Backwards</button>` +
    `<span class="month-label">${esc(fmtMonth(month))}</span>` +
    `<button class="btn" id="incNext"${month >= maxMonth ? ' disabled' : ''}>Forward &rarr;</button>` +
    `</div>` +
    `<div class="inc-note">${esc(`Incident history is kept for the last ${CONFIG.settings.daysInHistogram} days.`)}</div>`
  $('#incMonitorFilter').addEventListener('change', (e) => {
    INC_MONITOR = e.target.value
    renderIncidents()
  })
  $('#incPrev').addEventListener('click', () => {
    INC_MONTH = monthShift(month, -1)
    renderIncidents()
  })
  $('#incNext').addEventListener('click', () => {
    INC_MONTH = monthShift(month, 1)
    renderIncidents()
  })
}

// ---- Speedtest (self-hosted, vietcdn.net-style) ----
// Measures ping/download/upload from the visitor's browser to the
// Cloudflare edge serving this page. All test data is self-hosted:
// download pulls public/speedtest-20m.bin (static asset), upload POSTs
// to the Worker's /speedtest/upload endpoint (reads and discards).
// Fixed 10s window per phase, 1s warmup grace; Mbps =
// 8 * bytes/sec * 1.1 / 1048576 (1.1 = protocol overhead compensation).

const ST_DL_URL = 'speedtest-20m.bin'
const ST_STREAMS = 4
const ST_WINDOW_MS = 10000
const ST_GRACE_MS = 1000
const ST_UP_CHUNK = 2 * 1024 * 1024

// Phase 8c: detailed test servers — vietcdn.net's real servers first
// (their infrastructure, per Jeremie's decision), then the self-hosted
// Cloudflare edge row as a fallback that always works. URLs extracted
// from vietcdn.net's page source (speedtestFiles array); all verified
// reachable with `Access-Control-Allow-Origin: *` on 2026-10-14.
// `code` = flagcdn flag code, `cdn` = vietcdn's CDN id (their page pins
// HKG as the closest server for VN visitors — mirrored here).
const ST_DETAIL_SERVERS = [
  { name: 'Netherlands', code: 'nl', cdn: 'DEFAULT', url: 'https://45.download.real-debrid.com/speedtest/testDefault.rar' },
  { name: 'RBX (France)', code: 'fr', cdn: 'RBX', url: 'https://rbx.download.real-debrid.com/speedtest/test.rar' },
  { name: 'HKG1 (Hong Kong)', code: 'hk', cdn: 'HKG', url: 'https://hkg1.download.real-debrid.com/speedtest/test.rar' },
  { name: 'SGP1 (Singapore)', code: 'sg', cdn: 'SGP', url: 'https://sgp1.download.real-debrid.com/speedtest/test.rar' },
  { name: 'TYO1 (Japan)', code: 'jp', cdn: 'TYO', url: 'https://tyo1.download.real-debrid.com/speedtest/test.rar' },
  { name: 'LAX1 (USA)', code: 'us', cdn: 'LAX', url: 'https://lax1.download.real-debrid.com/speedtest/test.rar' },
  { name: 'TLV1 (Israel)', code: 'il', cdn: 'TLV', url: 'https://tlv1.download.real-debrid.com/speedtest/test.rar' },
  { name: 'Cloudflare (via Real-Debrid)', code: 'cf', cdn: 'CF', url: 'https://45.download.real-debrid.cloud/speedtest/testCloudflare.rar' },
  { name: 'Cloudflare edge (this site)', code: 'cf', cdn: null, url: ST_DL_URL },
]
// vietcdn pins HKG1 as the closest server for visitors in Vietnam.
const ST_CLOSEST_CDN = 'HKG'
// vietcdn's worker uses a 1.5s warmup grace for these multi-server rounds.
const ST_DETAIL_GRACE_MS = 1500

// Flag per row, mirroring vietcdn.net: flagcdn.com flag images, orange
// cloud badge for Cloudflare rows.
function stFlagHtml(code) {
  if (code === 'cf') return '<span class="st-cf">☁</span>'
  return `<img class="st-flag" src="https://flagcdn.com/56x42/${code}.png" alt="" loading="lazy">`
}

// Cache-buster style mirrored from vietcdn's worker: path-style for
// *.download.* hosts, query-style otherwise.
function stDlUrl(url) {
  const r = Math.random().toString(36).slice(2)
  return url.indexOf('.download.') > 0 ? `${url}/${r}` : `${url}?r=${r}`
}

const ST = { running: false }
const ST2 = { running: false, stop: false } // detailed (vietcdn-style) test state

function stMbps(bytes, secs) {
  return ((8 * bytes) / secs / 1048576) * 1.1
}

function stMedian3(a, b, c) {
  return [a, b, c].sort((x, y) => x - y)[1]
}

function stRateHtml(mbps) {
  return (
    `${mbps.toFixed(2)} <span class="st-unit">Mbps</span>` +
    `<div class="st-sub2">${(mbps / 8).toFixed(2)} MB/s</div>`
  )
}

function renderSpeedtest() {
  // Never wipe an in-progress test (e.g. hashchange re-render while the
  // detailed test is running) — rows would vanish mid-measurement.
  if (ST.running || ST2.running) return
  $('#speedtest').innerHTML =
    `<div class="st-head"><h2>Speedtest</h2>` +
    `<p class="st-sub">Measures your connection to the Cloudflare edge serving this page. ` +
    `Download pulls a 20&nbsp;MB test file hosted here; upload sends generated random data ` +
    `to this worker and discards it. Nothing leaves this site.</p></div>` +
    `<div class="st-metrics">` +
    `<div class="st-metric"><div class="st-label">Ping</div><div class="st-value" id="st-ping">—</div></div>` +
    `<div class="st-metric"><div class="st-label">Download</div><div class="st-value" id="st-down">—</div></div>` +
    `<div class="st-metric"><div class="st-label">Upload</div><div class="st-value" id="st-up">—</div></div>` +
    `</div>` +
    `<div class="st-controls"><button class="btn" id="stStart">Start test</button>` +
    `<span class="st-status" id="stStatus"></span></div>` +
    `<div class="st-detail"><h3>Detailed test</h3>` +
    `<p class="st-sub">vietcdn-style rounds against 8 Real-Debrid servers plus the Cloudflare edge serving this page. ` +
    `Each server is measured twice — one single-connection round, then one 6-connection round — and each row appears when its round finishes. ` +
    `Full run takes about 3 minutes.</p>` +
    `<p class="st-note">Test files hosted by Real-Debrid (vietcdn.net infrastructure), except the Cloudflare edge row served from this site.</p>` +
    `<div class="st-progress"><div class="st-progress-fill" id="stDetailProgress"></div></div>` +
    `<div id="stDetailRows"></div>` +
    `<div class="st-summary" id="stDetailSummary"></div>` +
    `<div class="st-controls"><button class="btn" id="stDetailStart">Start detailed test</button>` +
    `<button class="btn" id="stDetailStop" disabled>Stop</button>` +
    `<span class="st-status" id="stDetailStatus"></span></div></div>`
  $('#stStart').addEventListener('click', runSpeedtest)
  $('#stDetailStart').addEventListener('click', runDetailedTest)
  $('#stDetailStop').addEventListener('click', () => {
    ST2.stop = true
  })
}

// vietcdn-style: for each server (vietcdn's 8 real servers, then the
// self-hosted Cloudflare edge), a sequential single-connection round
// followed by a 6-connection round. Row layout mirrors vietcdn.net:
// [flag] [name (+📍 closest) (+Multi badge)] [live Mbps / final MB/s].
// Rows appear progressively as each round starts, numbers update live.
async function runDetailedTest() {
  if (ST2.running || ST.running) return
  ST2.running = true
  ST2.stop = false
  const startBtn = $('#stDetailStart')
  const stopBtn = $('#stDetailStop')
  const status = $('#stDetailStatus')
  const rows = $('#stDetailRows')
  const progress = $('#stDetailProgress')
  const summary = $('#stDetailSummary')
  startBtn.disabled = true
  stopBtn.disabled = false
  $('#stStart').disabled = true // concurrent tests would skew each other's numbers
  startBtn.textContent = 'Testing…'
  rows.innerHTML = ''
  summary.innerHTML = ''
  progress.style.width = '0%'
  const rounds = [
    { label: 'Single connection', multi: false, streams: 1 },
    { label: '6 parallel connections', multi: true, streams: 6 },
  ]
  const total = ST_DETAIL_SERVERS.length
  const totalRounds = total * rounds.length
  let doneRounds = 0
  let best = null // fastest single-connection result {name, mbps}
  try {
    for (const [si, srv] of ST_DETAIL_SERVERS.entries()) {
      for (const [ri, rd] of rounds.entries()) {
        if (ST2.stop) break
        const i = si * rounds.length + ri
        const isClosest = srv.cdn === ST_CLOSEST_CDN
        rows.insertAdjacentHTML(
          'beforeend',
          `<div class="st-drow${isClosest ? ' closest' : ''}">` +
            `<div class="st-dflag">${stFlagHtml(srv.code)}</div>` +
            `<div class="st-dname">${isClosest ? '<span class="st-pin">📍</span>' : ''}${esc(srv.name)}` +
            (rd.multi ? '<span class="st-multi">Multi</span>' : '') +
            `</div><div class="st-dspeed">` +
            `<div class="st-mbps" id="stMbps${i}">—</div>` +
            `<div class="st-mbs" id="stMbs${i}"></div></div></div>`,
        )
        status.textContent = `Server ${si + 1}/${total} — ${srv.name}, ${rd.label.toLowerCase()}…`
        const mbpsEl = () => document.getElementById(`stMbps${i}`)
        const mbsEl = () => document.getElementById(`stMbs${i}`)
        try {
          const mbps = await stDownload((v) => {
            const n = mbpsEl()
            if (n) n.textContent = `${v.toFixed(2)} Mbps`
          }, rd.streams, srv.url, ST_DETAIL_GRACE_MS)
          const m = mbpsEl()
          if (m) {
            if (ST2.stop) {
              m.textContent = 'stopped'
            } else {
              m.textContent = `${mbps.toFixed(2)} Mbps`
              const s = mbsEl()
              // vietcdn shows MB/s with 1 decimal
              if (s) s.textContent = `${Math.round((mbps / 8) * 10) / 10} MB/s`
              if (!rd.multi && (!best || mbps > best.mbps)) best = { name: srv.name, mbps }
            }
          }
        } catch (e) {
          const m = mbpsEl()
          if (m) m.textContent = ST2.stop ? 'stopped' : 'failed'
        }
        doneRounds++
        progress.style.width = `${Math.round((doneRounds / totalRounds) * 100)}%`
      }
      if (ST2.stop) break
    }
    if (!ST2.stop && best) {
      summary.innerHTML =
        `<span class="st-pin">📍</span> Closest server: <strong>${esc(ST_DETAIL_SERVERS.find((s) => s.cdn === ST_CLOSEST_CDN).name)}</strong>` +
        ` · Fastest (single connection): <strong>${esc(best.name)}</strong> at ${best.mbps.toFixed(2)} Mbps`
    }
    status.textContent = ST2.stop ? 'Stopped.' : 'Done.'
  } finally {
    ST2.running = false
    ST2.stop = false
    startBtn.disabled = false
    stopBtn.disabled = true
    $('#stStart').disabled = false
    startBtn.textContent = 'Run again'
  }
}

async function runSpeedtest() {
  if (ST.running || ST2.running) return
  ST.running = true
  const btn = $('#stStart')
  const status = $('#stStatus')
  btn.disabled = true
  $('#stDetailStart').disabled = true // concurrent tests would skew each other's numbers
  btn.textContent = 'Testing…'
  try {
    status.textContent = 'Measuring ping…'
    const ping = await stPing().catch(() => null)
    $('#st-ping').textContent = ping == null ? 'failed' : `${Math.round(ping)} ms`

    status.textContent = 'Measuring download…'
    const down = await stDownload((mbps) => {
      $('#st-down').textContent = `${mbps.toFixed(1)} Mbps`
    }).catch(() => null)
    $('#st-down').innerHTML = down == null ? 'failed' : stRateHtml(down)

    status.textContent = 'Measuring upload…'
    const up = await stUpload((mbps) => {
      $('#st-up').textContent = `${mbps.toFixed(1)} Mbps`
    }).catch(() => null)
    $('#st-up').innerHTML = up == null ? 'failed' : stRateHtml(up)

    status.textContent = 'Done.'
  } finally {
    ST.running = false
    btn.disabled = false
    $('#stDetailStart').disabled = false
    btn.textContent = 'Test again'
  }
}

async function stPing() {
  const samples = []
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    const r = await fetch('api/state', { cache: 'no-store' })
    if (!r.ok) throw new Error('ping failed')
    await r.arrayBuffer() // ensure the full response arrived
    samples.push(performance.now() - t0)
  }
  return stMedian3(samples[0], samples[1], samples[2])
}

async function stDownload(onTick, streams = ST_STREAMS, url = ST_DL_URL, graceMs = ST_GRACE_MS) {
  const t0 = performance.now()
  const graceEnd = t0 + graceMs
  const deadline = t0 + ST_WINDOW_MS
  let bytes = 0

  async function stream() {
    let fails = 0
    while (performance.now() < deadline && !ST2.stop) {
      const remain = deadline - performance.now()
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), Math.max(remain + 500, 1))
      try {
        const r = await fetch(stDlUrl(url), { cache: 'no-store', signal: ctrl.signal })
        if (!r.ok || !r.body) throw new Error('bad download response')
        const reader = r.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const now = performance.now()
          if (now >= graceEnd) bytes += value.byteLength
          if (now >= deadline || ST2.stop) {
            reader.cancel().catch(() => {})
            break
          }
        }
        fails = 0
      } catch (e) {
        if (performance.now() >= deadline || ST2.stop) break // aborted by the deadline / Stop
        if (++fails > 3) throw new Error('download failed')
        await new Promise((res) => setTimeout(res, 300))
      } finally {
        clearTimeout(to)
      }
    }
  }

  const tick = setInterval(() => {
    const el = (performance.now() - graceEnd) / 1000
    if (el > 0 && bytes > 0) onTick(stMbps(bytes, el))
  }, 250)
  try {
    await Promise.all(Array.from({ length: streams }, stream))
  } finally {
    clearInterval(tick)
  }
  if (bytes === 0) throw new Error('no bytes received')
  return stMbps(bytes, (deadline - graceEnd) / 1000)
}

let stUpBlob = null
function stUpPayload() {
  if (!stUpBlob) {
    // crypto.getRandomValues caps at 64KB per call — fill in chunks.
    const buf = new Uint8Array(ST_UP_CHUNK)
    for (let i = 0; i < buf.length; i += 65536) {
      crypto.getRandomValues(buf.subarray(i, Math.min(i + 65536, buf.length)))
    }
    stUpBlob = new Blob([buf], { type: 'application/octet-stream' })
  }
  return stUpBlob
}

async function stUpload(onTick) {
  const t0 = performance.now()
  const graceEnd = t0 + ST_GRACE_MS
  const deadline = t0 + ST_WINDOW_MS
  const blob = stUpPayload()
  let bytes = 0

  async function stream() {
    let fails = 0
    while (performance.now() < deadline) {
      const remain = deadline - performance.now()
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), Math.max(remain + 500, 1))
      const start = performance.now()
      try {
        const r = await fetch('speedtest/upload', {
          method: 'POST',
          body: blob,
          signal: ctrl.signal,
        })
        if (!r.ok) throw new Error('bad upload response')
        await r.json()
        if (start >= graceEnd) bytes += blob.size
        fails = 0
      } catch (e) {
        if (performance.now() >= deadline) break // aborted by the deadline
        if (++fails > 3) throw new Error('upload failed')
        await new Promise((res) => setTimeout(res, 300))
      } finally {
        clearTimeout(to)
      }
    }
  }

  const tick = setInterval(() => {
    const el = (performance.now() - graceEnd) / 1000
    if (el > 0 && bytes > 0) onTick(stMbps(bytes, el))
  }, 250)
  try {
    await Promise.all(Array.from({ length: ST_STREAMS }, stream))
  } finally {
    clearInterval(tick)
  }
  if (bytes === 0) throw new Error('no bytes uploaded')
  return stMbps(bytes, (deadline - graceEnd) / 1000)
}

function setView(v) {
  VIEW = v
  $('#statusView').hidden = v !== 'status'
  $('#incidentsView').hidden = v !== 'incidents'
  $('#speedtestView').hidden = v !== 'speedtest'
  $('#dnsView').hidden = v !== 'dns'
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === v)
  })
  document.title =
    (v === 'incidents'
      ? 'Incidents — '
      : v === 'speedtest'
        ? 'Speedtest — '
        : v === 'dns'
          ? 'DNS Tools — '
          : '') + CONFIG.settings.title
  if (v === 'incidents') renderIncidents()
  if (v === 'speedtest') renderSpeedtest()
  if (v === 'dns') renderDnsTools()
}

function monitorCard(monitor, data, ci) {
  const nameHtml =
    monitor.linkable === false
      ? `<span class="name-text">${esc(monitor.name)}</span>`
      : `<a class="name-text" href="${esc(monitor.url)}" target="_blank" rel="noopener" title="${esc(monitor.url)}">${esc(monitor.name)}</a>`

  const up = overallInfo(data)
  const overallHtml = up
    ? `<span class="overall" style="color:${overallColor(up.pct)}">Overall: ${up.pct.toPrecision(4)}%</span>`
    : `<span class="overall" style="color:var(--muted)">${esc(CONFIG.settings.monitorLabelNoData)}</span>`

  return (
    `<section class="monitor" data-monitor="${esc(monitor.id)}">` +
    `<div class="monitor-row"><div class="monitor-name">${monitorStatusIcon(monitor, data)}${nameHtml}${latencyPill(monitor, data)}</div>` +
    `${overallHtml}</div>` +
    `${uptimeStrip(monitor, data, ci)}` +
    `${latencyChart(monitor, data, ci)}` +
    `</section>`
  )
}

function renderStatusHeader() {
  const s = CONFIG.settings
  const lu = STATE.lastUpdate || {}
  const ok = !!lu.allOperational
  const text = ok ? s.allmonitorsOperational : s.notAllmonitorsOperational
  const icon = ok
    ? tabler(CHECK_PATHS, 64, '#059669')
    : tabler(ALERT_PATHS, 64, '#b91c1c')

  let meta = ''
  if (lu.time) {
    meta = heroMeta(lu)
  }
  $('#statusHeader').innerHTML =
    `<div class="hero"><div class="hero-icon">${icon}</div>` +
    `<h1 class="hero-title">${esc(text)}</h1>` +
    (meta ? `<p class="hero-sub">${esc(meta)}</p>` : '') +
    `</div>`
}

// Live "N sec ago" ticker: updates every second. Reloads only when monitor data
// is genuinely stale (>30 min ~= 3 missed 10-min cron runs) AND no measurement
// is running — a reload mid-test would destroy speedtest/leak-test results.
function tickHero() {
  const lu = STATE.lastUpdate || {}
  const el = document.querySelector('.hero-sub')
  if (!el || !lu.time) return
  const next = heroMeta(lu)
  if (el.textContent !== next) el.textContent = next
  const secs = Math.max(0, Math.round((Date.now() - lu.time) / 1000))
  const measuring = (typeof ST !== 'undefined' && ST.running)
    || (typeof ST2 !== 'undefined' && ST2.running)
    || (typeof LEAK !== 'undefined' && LEAK.running)
  if (secs > 1800 && !measuring && Date.now() - OPENED_AT > 30000) location.reload()
}

// Number of monitors in a group currently NOT operational (last check failed).
function groupDownCount(ids) {
  let down = 0
  for (const id of ids) {
    const data = STATE.monitors[id]
    if (data && data.lastCheck && data.lastCheck.operational === false) down++
  }
  return down
}

function groupCountColor(down, total) {
  if (down === 0) return '#059669'
  if (down === total) return '#DF484A'
  return '#F29030'
}

const CHEVRON =
  '<svg class="mgroup-chev" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6l6 -6"/></svg>'

function groupSection(name, monitors, expanded) {
  const ids = monitors.map((m) => m.id)
  const down = groupDownCount(ids)
  const color = groupCountColor(down, ids.length)
  const cards = monitors
    .map((m) => monitorCard(m, STATE.monitors[m.id], nextCi()))
    .join('')
  return (
    `<div class="mgroup${expanded ? ' open' : ''}" data-group="${esc(name)}">` +
    `<button class="mgroup-head" aria-expanded="${expanded ? 'true' : 'false'}">` +
    `<span class="mgroup-name">${esc(groupLabel(name))}</span>` +
    `<span class="mgroup-right"><span class="mgroup-count" style="color:${color}">` +
    `${ids.length - down}/${ids.length} Operational</span>${CHEVRON}</span>` +
    `</button>` +
    `<div class="mgroup-panel">${cards}</div>` +
    `</div>`
  )
}

let CI_COUNTER = 0
function nextCi() {
  return CI_COUNTER++
}

function bindGroups() {
  document.querySelectorAll('.mgroup-head').forEach((head) => {
    head.addEventListener('click', () => {
      const group = head.closest('.mgroup')
      const name = group.dataset.group
      const open = group.classList.toggle('open')
      head.setAttribute('aria-expanded', open ? 'true' : 'false')
      const exp = expandedGroups() || new Set()
      if (open) exp.add(name)
      else exp.delete(name)
      saveExpandedGroups(exp)
      if (open) fitStrips() // strips inside a collapsed panel had no layout at render time
    })
  })
}

function renderMonitors() {
  const term = FILTER.trim().toLowerCase()
  const list = CONFIG.monitors.filter(
    (m) =>
      !term ||
      m.name.toLowerCase().includes(term) ||
      (m.description || '').toLowerCase().includes(term),
  )
  CHARTS = []
  STRIPS = {}
  CI_COUNTER = 0
  if (!list.length) {
    $('#monitors').innerHTML = `<div class="empty">No monitors match "${esc(FILTER)}".</div>`
    return
  }
  // groups in first-appearance order (config order)
  const order = []
  const seen = new Set()
  for (const m of list) {
    const g = groupOf(m)
    if (!seen.has(g)) {
      seen.add(g)
      order.push(g)
    }
  }
  const expanded = expandedGroups() || new Set()
  $('#monitors').innerHTML = order
    .map((g) =>
      groupSection(
        g,
        list.filter((m) => groupOf(m) === g),
        expanded.has(g),
      ),
    )
    .join('')
  bindCharts()
  bindStrips()
  fitStrips()
  bindGroups()
}

function render() {
  document.title = CONFIG.settings.title
  $('#pageTitle').textContent = CONFIG.settings.title
  const logo = $('#logo')
  if (CONFIG.settings.logo) {
    logo.src = CONFIG.settings.logo
    logo.style.display = ''
  } else {
    logo.style.display = 'none'
  }
  renderStatusHeader()
  renderMonitors()
}

// ---- Phase 7: browser-based latency measurement (ping.nextdns.io-style).
// Measures RTT from the VISITOR's browser to each endpoint via /info
// (which sends Access-Control-Allow-Origin: *; /resolve does not).
// Display-only and on-demand — no Worker/KV involvement.

function infoUrlFor(monitor) {
  try {
    const u = new URL(monitor.url)
    if (!/^https?:$/.test(u.protocol)) return null
    return `${u.protocol}//${u.host}/info`
  } catch {
    return null
  }
}

function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

let BLAT_RUNNING = false

function renderBrowserLatency() {
  $('#browserLatency').innerHTML =
    `<div class="blat">` +
    `<h3 class="blat-title">Latency from your browser</h3>` +
    `<p class="blat-sub">Measured live from your device to each endpoint — unlike the charts above, which are measured from the Cloudflare server.</p>` +
    `<button class="btn" id="blatBtn">Measure now</button>` +
    `<div class="blat-progress" id="blatProgress" hidden></div>` +
    `<div class="blat-results" id="blatResults"></div>` +
    `</div>`
  $('#blatBtn').addEventListener('click', measureBrowserLatency)
}

async function measureOne(monitor) {
  const url = infoUrlFor(monitor)
  if (!url) return { monitor, ok: false }
  const t0 = performance.now()
  try {
    const res = await fetch(url, { cache: 'no-store', signal: timeoutSignal(5000) })
    const ms = Math.round(performance.now() - t0)
    let serverMs = null
    try {
      const j = await res.json()
      const rtt = Number(j && j.rtt)
      if (Number.isFinite(rtt)) serverMs = Math.round(rtt / 1000)
    } catch {
      /* server-reported number is optional */
    }
    if (!res.ok) return { monitor, ok: false }
    return { monitor, ok: true, ms, serverMs }
  } catch {
    return { monitor, ok: false }
  }
}

async function measureBrowserLatency() {
  if (BLAT_RUNNING) return
  BLAT_RUNNING = true
  const btn = $('#blatBtn')
  const prog = $('#blatProgress')
  const out = $('#blatResults')
  btn.disabled = true
  btn.textContent = 'Measuring…'
  prog.hidden = false
  out.innerHTML = ''
  const monitors = CONFIG.monitors.filter((m) => infoUrlFor(m))
  const total = monitors.length
  let done = 0
  prog.textContent = `Measuring 0/${total}…`
  const results = await Promise.all(
    monitors.map((m) =>
      measureOne(m).then((r) => {
        done++
        prog.textContent = `Measuring ${done}/${total}…`
        return r
      }),
    ),
  )
  const okRows = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms)
  const failRows = results.filter((r) => !r.ok)
  out.innerHTML =
    okRows
      .map(
        (r, i) =>
          `<div class="blat-row${i === 0 ? ' blat-fastest' : ''}">` +
          `<span class="blat-name">${i === 0 ? '■ ' : ''}${esc(r.monitor.name)}</span>` +
          `<span class="blat-ms">${r.ms} ms` +
          (r.serverMs != null ? ` <span class="blat-server">server: ${r.serverMs} ms</span>` : '') +
          `</span></div>`,
      )
      .join('') +
    failRows
      .map(
        (r) =>
          `<div class="blat-row blat-failed">` +
          `<span class="blat-name">${esc(r.monitor.name)}</span>` +
          `<span class="blat-ms">failed</span></div>`,
      )
      .join('')
  prog.hidden = true
  btn.disabled = false
  btn.textContent = 'Measure again'
  BLAT_RUNNING = false
}

// A bad /api/state payload must never blank the page: validate the shape
// before touching STATE, and guard each render so an exception keeps the
// last good DOM (next 30s cycle retries).
function validStatePayload(st) {
  return (
    st &&
    typeof st === 'object' &&
    st.monitors &&
    typeof st.monitors === 'object' &&
    !Array.isArray(st.monitors)
  )
}

async function refreshState() {
  try {
    const res = await fetch('api/state', { cache: 'no-store' })
    if (!res.ok) return // keep last rendered state on HTTP error
    let st
    try {
      st = await res.json()
    } catch (e) {
      console.warn('[status] bad /api/state JSON, keeping last state')
      return
    }
    if (!validStatePayload(st)) {
      console.warn('[status] bad /api/state payload shape, keeping last state')
      return
    }
    STATE = {
      monitors: st.monitors,
      lastUpdate: st.lastUpdate || {},
    }
    for (const fn of [renderStatusHeader, renderMonitors]) {
      try {
        fn()
      } catch (e) {
        console.error('[status] render failed, keeping last DOM:', e)
      }
    }
    if (VIEW === 'incidents') {
      try {
        renderIncidents()
      } catch (e) {
        console.error('[status] incidents render failed, keeping last DOM:', e)
      }
    }
  } catch (e) {
    /* keep last rendered state on network hiccup */
  }
}

// ---- DNS Tools (Phase 9) ----
// Provider abstraction: PRIMARY = dnscheck.tools/addr.tools infrastructure;
// FALLBACK = Cloudflare public DoH. DNS_PROVIDER_ORDER controls priority —
// swapping providers (or trimming to one) is a one-line change here.

const DNS_TYPE_NAMES = {
  1: 'A', 28: 'AAAA', 5: 'CNAME', 15: 'MX', 16: 'TXT',
  2: 'NS', 6: 'SOA', 33: 'SRV', 12: 'PTR', 257: 'CAA',
}
const dnsTypeName = (n) => DNS_TYPE_NAMES[n] || `TYPE${n}`

// Both providers answer {Status, Answer:[{name,type:<num>,TTL?,data}]} —
// normalize to a common shape.
function normalizeDnsAnswer(j) {
  const answers = Array.isArray(j.Answer) ? j.Answer : []
  return {
    status: typeof j.Status === 'number' ? j.Status : -1,
    answers: answers.map((a) => ({
      name: String(a.name ?? ''),
      type: dnsTypeName(Number(a.type)),
      ttl:
        a.TTL != null && Number.isFinite(Number(a.TTL))
          ? Number(a.TTL)
          : null,
      data: String(a.data ?? ''),
    })),
  }
}

const DNS_PROVIDERS = {
  addrtools: {
    label: 'addr.tools',
    lookup: async (name, typeName) => {
      const r = await fetch(
        `https://addr.tools/dns/${encodeURIComponent(name)}/${encodeURIComponent(typeName.toLowerCase())}`,
      )
      if (!r.ok) throw new Error(`addr.tools HTTP ${r.status}`)
      return normalizeDnsAnswer(await r.json()) // throws on non-JSON → fallback
    },
  },
  cfdoh: {
    label: 'Cloudflare DoH',
    lookup: async (name, typeName) => {
      const r = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(typeName)}`,
        { headers: { accept: 'application/dns-json' } },
      )
      if (!r.ok) throw new Error(`Cloudflare DoH HTTP ${r.status}`)
      return normalizeDnsAnswer(await r.json())
    },
  },
}
// One-line provider swap: reorder or trim this list.
const DNS_PROVIDER_ORDER = ['addrtools', 'cfdoh']

// Query providers in order; first success wins. Throws only if all fail.
async function dnsQuery(name, typeName) {
  const t0 = performance.now()
  let lastErr = null
  for (const key of DNS_PROVIDER_ORDER) {
    try {
      const res = await DNS_PROVIDERS[key].lookup(name, typeName)
      return {
        ...res,
        via: DNS_PROVIDERS[key].label,
        fallback: key !== DNS_PROVIDER_ORDER[0],
        ms: Math.max(1, Math.round(performance.now() - t0)),
      }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('all DNS providers failed')
}

function ipv4ToArpa(ip) {
  const parts = ip.trim().split('.')
  if (
    parts.length !== 4 ||
    parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)
  )
    return null
  return parts.reverse().join('.') + '.in-addr.arpa'
}

function ipv6ToArpa(ip) {
  const t = ip.trim().toLowerCase()
  if (!/^[0-9a-f:.]+$/.test(t) || !t.includes(':')) return null
  const halves = t.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (left.concat(right).some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  const missing = 8 - left.length - right.length
  if (missing < 0) return null
  const groups = left.concat(new Array(missing).fill('0'), right)
  if (groups.length !== 8) return null
  return (
    groups
      .map((g) => g.padStart(4, '0'))
      .join('')
      .split('')
      .reverse()
      .join('.') + '.ip6.arpa'
  )
}

function validDnsName(s) {
  const t = s.trim().replace(/\.$/, '')
  if (!t || t.length > 253) return false
  return t
    .split('.')
    .every((label) => /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label))
}

const DNS_LOOKUP_TYPES = [
  'A', 'AAAA', 'CNAME', 'MX', 'TXT',
  'NS', 'SOA', 'SRV', 'PTR', 'CAA',
]

function renderDnsTools() {
  $('#dnsTools').innerHTML =
    `<div class="dns-card"><div class="st-head"><h2>DNS Lookup</h2>` +
    `<p class="st-sub">Query DNS records for any domain. Primary source: dnscheck.tools ` +
    `(addr.tools) infrastructure — automatic fallback to Cloudflare DNS-over-HTTPS.</p></div>` +
    `<div class="dns-form">` +
    `<input id="dnsName" type="text" placeholder="example.com" autocomplete="off" spellcheck="false" aria-label="Domain name">` +
    `<select id="dnsType" aria-label="Record type">` +
    DNS_LOOKUP_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('') +
    `</select>` +
    `<button class="btn" id="dnsGo">Lookup</button>` +
    `</div>` +
    `<div class="dns-status" id="dnsStatus"></div>` +
    `<div id="dnsResults"></div></div>` +
    `<div class="dns-card"><div class="st-head"><h2>DNS Leak Test</h2>` +
    `<p class="st-sub">Powered by dnscheck.tools infrastructure. Discovers which DNS resolvers ` +
    `your network actually uses, checks DNSSEC validation and connection details &mdash; ` +
    `mirroring dnscheck.tools.</p></div>` +
    `<div class="st-controls"><button class="btn" id="leakGo">Run leak test</button>` +
    `<span class="st-status" id="leakStatus"></span></div>` +
    `<div class="leak-pills" id="leakPills"></div>` +
    `<div id="leakResults"></div></div>`
  $('#dnsGo').addEventListener('click', runDnsLookup)
  $('#dnsName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runDnsLookup()
  })
  $('#leakGo').addEventListener('click', runLeakTest)
}

let DNS_LOOKUP_RUNNING = false
async function runDnsLookup() {
  if (DNS_LOOKUP_RUNNING) return
  const nameEl = $('#dnsName')
  const typeEl = $('#dnsType')
  const statusEl = $('#dnsStatus')
  const out = $('#dnsResults')
  if (!nameEl || !typeEl || !statusEl || !out) return
  let qname = nameEl.value.trim()
  const qtype = typeEl.value
  out.innerHTML = ''
  if (!qname) {
    statusEl.innerHTML = `<span class="dns-err">Enter a domain name or IP address.</span>`
    return
  }
  if (qtype === 'PTR') {
    const arpa = ipv4ToArpa(qname) || ipv6ToArpa(qname)
    if (arpa) qname = arpa
    else if (!validDnsName(qname)) {
      statusEl.innerHTML = `<span class="dns-err">For PTR, enter an IP address or a valid reverse-DNS name.</span>`
      return
    }
  } else if (!validDnsName(qname)) {
    statusEl.innerHTML = `<span class="dns-err">&ldquo;${esc(qname)}&rdquo; doesn&rsquo;t look like a valid domain name.</span>`
    return
  }
  DNS_LOOKUP_RUNNING = true
  $('#dnsGo').disabled = true
  statusEl.innerHTML = `<span class="spinner" aria-hidden="true"></span> Querying ${esc(qname)} ${esc(qtype)}&hellip;`
  try {
    const res = await dnsQuery(qname, qtype)
    renderDnsResults(res, qname, qtype)
  } catch (e) {
    statusEl.innerHTML = ''
    out.innerHTML =
      `<div class="dns-err">Lookup failed: ${esc(e && e.message ? e.message : 'network error')}. ` +
      `Both providers unreachable &mdash; check your connection and try again.</div>`
  } finally {
    DNS_LOOKUP_RUNNING = false
    const b = $('#dnsGo')
    if (b) b.disabled = false
  }
}

function renderDnsResults(res, qname, qtype) {
  const statusEl = $('#dnsStatus')
  const out = $('#dnsResults')
  if (!statusEl || !out) return
  const meta =
    `<div class="dns-meta">${esc(qname)} ${esc(qtype)} &middot; ${res.ms} ms &middot; via ${esc(res.via)}` +
    (res.fallback ? ` <span class="dns-note">(fallback)</span>` : '') +
    `</div>`
  statusEl.innerHTML = ''
  if (res.status === 3) {
    out.innerHTML =
      meta +
      `<div class="dns-empty">No records found (NXDOMAIN) &mdash; &ldquo;${esc(qname)}&rdquo; does not exist.</div>`
    return
  }
  if (res.status !== 0 || !res.answers.length) {
    const why =
      res.status === 2 ? 'server failure (SERVFAIL)' : `DNS status ${res.status}`
    out.innerHTML =
      meta +
      `<div class="dns-empty">No ${esc(qtype)} records for &ldquo;${esc(qname)}&rdquo; (${why}).</div>`
    return
  }
  out.innerHTML =
    meta +
    `<div class="dns-table-wrap"><table class="dns-table"><thead><tr>` +
    `<th>Name</th><th>Type</th><th>TTL</th><th>Data</th>` +
    `</tr></thead><tbody>` +
    res.answers
      .map(
        (a) =>
          `<tr><td class="dns-mono">${esc(a.name)}</td><td>${esc(a.type)}</td>` +
          `<td class="dns-num">${a.ttl == null ? '&mdash;' : esc(String(a.ttl))}</td>` +
          `<td class="dns-mono dns-data">${esc(a.data)}</td></tr>`,
      )
      .join('') +
    `</tbody></table></div>`
}

// ---- DNS leak test (Phase 9b: mirrors dnscheck.tools main page) ----
// Logic ported from https://github.com/brianshea2/addr.tools
// (website/dnscheck.tools/main.js, AGPL-3.0). The original runs first-party;
// this port runs cross-origin, so the browser "connected" signal used for the
// DNSSEC matrix is read via <link rel=stylesheet> onload/onerror instead of
// fetch() r.ok (a plain fetch would reject on CORS regardless of DNS outcome).
// A calibration probe against a known-good test domain gates the matrix: if it
// cannot load, the matrix is honestly marked untestable, never faked.
// ECH status is deliberately omitted: X-ECH-Status is not readable cross-origin.
const LEAK_ALGS = ['alg13', 'alg14', 'alg15', 'alg18']
const LEAK_ALG_LABELS = ['ECDSA P-256', 'ECDSA P-384', 'Ed25519', 'ML-DSA-44']
const LEAK_SIGS = ['badsig', 'expiredsig', 'nosig']
const LEAK_SIG_LABELS = ['Invalid', 'Expired', 'Missing']
const LEAK = { running: false }
// UI state for the "Your IP addresses" section, kept outside the ephemeral LS
// run state so "(show more)" keeps working after the test finishes (LS=null).
let leakUiIps = [] // snapshot of [ip, src] entries
let leakUiShowMore = false
let leakUiRender = 0 // enrichment token: stale async fills are dropped
// Per-run state (null when idle).
let LS = null

function randHex8() {
  const b = new Uint8Array(4)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// Trigger FQDN builders, mirroring the original's query names (kept pure for
// testability).
const leakNullipFqdn = (id, s) => `${s}.${id}-nullip.test.dnscheck.tools`
const leakIpv6Fqdn = (id) => `${id}-nullip.test-ipv6.dnscheck.tools`
const leakAlgFqdn = (id, alg) => `${id}.test-${alg}.dnscheck.tools`
const leakSigFqdn = (id, sig, alg) => `${id}-${sig}.test-${alg}.dnscheck.tools`

function leakPill(label, cls, title) {
  return (
    `<span class="leak-pill${cls ? ' leak-' + cls : ''}"` +
    (title ? ` title="${esc(title)}"` : '') +
    `>${esc(label)}</span>`
  )
}

// Status pills in fixed order like the original's status bar: RTT, IPv6, ADoX,
// EDNS, DNSSEC. Only pills with data are shown.
function drawPills() {
  const bar = document.getElementById('leakPills')
  if (!bar || !LS) return
  const order = ['rtt', 'ipv6', 'adox', 'edns', 'dnssec']
  bar.innerHTML = order
    .map((k) => (LS.pills[k] ? leakPill(LS.pills[k].label, LS.pills[k].cls, LS.pills[k].title) : ''))
    .join('')
  drawStatusBar()
}

// Bottom status bar mirroring the original's fixed bar: "{rtt}ms  IPv6  EDNS
// DNSSEC  ECH" indicators plus the "dns: N" query counter. ECH is rendered
// "n/a": the X-ECH-Status header is only exposed to dnscheck.tools itself,
// so a cross-origin page can never read it — shown honestly, never faked.
function drawStatusBar() {
  if (!LS) return
  const sb = document.getElementById('leakSbPills')
  if (sb) {
    const p = LS.pills
    const items = []
    if (p.rtt) items.push(leakPill(p.rtt.label, p.rtt.cls, p.rtt.title))
    if (p.ipv6) items.push(leakPill('IPv6', p.ipv6.cls, p.ipv6.title))
    if (p.edns) items.push(leakPill('EDNS', p.edns.cls, p.edns.title))
    if (p.dnssec) items.push(leakPill('DNSSEC', p.dnssec.cls, p.dnssec.title))
    items.push(
      leakPill(
        'ECH',
        'na',
        'Encrypted Client Hello\n\nNot detectable from this page: the ' +
          'X-ECH-Status header is only exposed to dnscheck.tools itself, ' +
          'never cross-origin.',
      ),
    )
    sb.innerHTML = items.join(' ')
  }
  const dns = document.getElementById('leakSbDns')
  if (dns) dns.textContent = `dns: ${LS.total}`
}

// Cross-origin "connected" probe (Phase 9c fix). The 9b <link rel=stylesheet>
// technique was broken by design: browsers MIME-check stylesheets and their
// server answers Content-Type: text/plain, so onload NEVER fired. The correct
// port of the original's first-party fetch().ok signal is a no-cors fetch:
//   - DNS resolves + TLS ok + HTTP 200 "Connected" -> promise RESOLVES
//     (opaque response) -> connected = true
//   - DNS failure / validating resolver SERVFAILs the badsig query /
//     connection refused -> promise REJECTS -> connected = false
// (no-cors never rejects on CORS — that only applies to default cors mode.)
function probeConnected(fqdn, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => done(false), timeoutMs)
    function done(v) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    try {
      fetch(`https://${fqdn}/`, { mode: 'no-cors', cache: 'no-store' })
        .then(() => done(true))
        .catch(() => done(false))
    } catch (e) {
      done(false)
    }
  })
}

// ---- IP enrichment (Phase 9c): RDAP registrant + geolocation, mirroring
// dnscheck.tools' "Your IP addresses" / "Your DNS resolvers" display.
// Everything is best-effort: failures resolve to null and the core leak
// results render regardless. Results are cached per IP.

// Skip enrichment for non-routable addresses (RDAP/geo would fail anyway).
function isPrivateIp(ip) {
  if (typeof ip !== 'string') return true
  if (ip.includes(':')) {
    const h = ip.toLowerCase()
    if (h === '::1') return true
    if (/^(fc|fd)/.test(h)) return true // fc00::/7 unique local
    const first = h.split(':')[0] || ''
    const n = parseInt(first, 16)
    if (!isNaN(n) && n >= 0xfe80 && n <= 0xfebf) return true // fe80::/10 link-local
    return false
  }
  const p = ip.split('.')
  if (p.length !== 4) return true
  const n = p.map(Number)
  if (n.some((x) => !(x >= 0 && x <= 255))) return true
  return (
    n[0] === 10 ||
    n[0] === 127 ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && n[1] === 168) ||
    (n[0] === 169 && n[1] === 254)
  )
}

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number)
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3]
}

function cidr4Contains(cidr, ip) {
  const parts = String(cidr).split('/')
  if (parts.length !== 2) return false
  const b = parseInt(parts[1], 10)
  if (!(b >= 0 && b <= 32)) return false
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(parts[0]) || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false
  const mask = b === 0 ? 0 : ((0xffffffff - (2 ** (32 - b) - 1)) >>> 0)
  return (ipv4ToInt(parts[0]) & mask) === (ipv4ToInt(ip) & mask)
}

function expandIPv6(ip) {
  const [head, tail] = String(ip).split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined && tail !== '' ? tail.split(':') : tail === '' ? [] : null
  const tt = t === null ? [] : t
  if (String(ip).includes('::') === false && h.length !== 8) throw new Error('bad v6')
  const missing = 8 - h.length - tt.length
  if (missing < 0) throw new Error('bad v6')
  const parts = [...h, ...Array(missing).fill('0'), ...tt]
  if (parts.length !== 8) throw new Error('bad v6')
  return parts
    .map((p) => {
      if (!/^[0-9a-fA-F]{1,4}$/.test(p)) throw new Error('bad v6')
      return p.padStart(4, '0')
    })
    .join('')
}

function cidr6Contains(cidr, ip) {
  try {
    const parts = String(cidr).split('/')
    if (parts.length !== 2) return false
    const b = parseInt(parts[1], 10)
    if (!(b >= 0 && b <= 128)) return false
    const n = expandIPv6(parts[0])
    const a = expandIPv6(ip)
    const full = Math.floor(b / 4)
    if (n.slice(0, full) !== a.slice(0, full)) return false
    const rem = b % 4
    if (rem === 0) return true
    const mask = 16 - (16 >> rem)
    return (parseInt(n[full], 16) & mask) === (parseInt(a[full], 16) & mask)
  } catch (e) {
    return false
  }
}

// IANA RDAP bootstrap (CORS-open), fetched once per page load.
let rdapBootstrapP = null
function rdapBootstrap() {
  if (!rdapBootstrapP) {
    rdapBootstrapP = Promise.all([
      fetch('https://data.iana.org/rdap/ipv4.json').then((r) => {
        if (!r.ok) throw new Error('bootstrap v4')
        return r.json()
      }),
      fetch('https://data.iana.org/rdap/ipv6.json').then((r) => {
        if (!r.ok) throw new Error('bootstrap v6')
        return r.json()
      }),
    ])
      .then(([v4, v6]) => ({ v4: v4.services || [], v6: v6.services || [] }))
      .catch(() => null)
  }
  return rdapBootstrapP
}

async function rdapServiceFor(ip) {
  const bs = await rdapBootstrap()
  if (!bs) return null
  const v6 = ip.includes(':')
  const services = v6 ? bs.v6 : bs.v4
  const contains = v6 ? cidr6Contains : cidr4Contains
  for (const [cidrs, urls] of services) {
    const url = (urls || []).find((u) => typeof u === 'string' && u.startsWith('https://'))
    if (!url) continue
    for (const cidr of cidrs || []) {
      try {
        if (contains(cidr, ip)) return url
      } catch (e) {}
    }
  }
  return null
}

// Registrant name from an RDAP response, ported from the original's
// getReg(): registrant-role vCard fn (org preferred), LLC/Ltd/Inc suffix
// stripped, falling back to the network name / handle.
function rdapRegistrantName(data) {
  if (!data || typeof data !== 'object') return null
  const entities = Array.isArray(data.entities) ? data.entities : []
  const vcards = []
  for (const e of entities) {
    if (!e || !Array.isArray(e.roles) || !e.roles.includes('registrant')) continue
    const rows = (e.vcardArray && e.vcardArray[1]) || []
    const o = {}
    for (const row of rows) {
      if (Array.isArray(row)) o[row[0]] = row[3]
    }
    if (o.fn) vcards.push(o)
  }
  const org = vcards.find((v) => v.kind === 'org')
  let name = (org || vcards[0] || {}).fn || null
  if (name) name = String(name).replace(/,?\s+(?:l\.?l\.?c\.?|ltd\.?|inc\.?)$/i, '').trim()
  return name || data.name || data.handle || null
}

async function rdapRegistrant(ip) {
  if (isPrivateIp(ip)) return null
  const svc = await rdapServiceFor(ip)
  if (!svc) return null
  const base = svc.endsWith('/') ? svc : svc + '/'
  const r = await fetch(`${base}ip/${encodeURIComponent(ip)}`, {
    headers: { accept: 'application/rdap+json' },
  })
  if (!r.ok) return null
  return rdapRegistrantName(await r.json())
}

// "City, Region, CC" via ip.addr.tools (CORS-open), like the original's getGeo.
async function geoFor(ip) {
  if (isPrivateIp(ip)) return null
  const r = await fetch(`https://ip.addr.tools/${encodeURIComponent(ip)}`)
  if (!r.ok) return null
  const o = await r.json()
  const s = [o.city, o.region, o.country].filter(Boolean).join(', ')
  return s || null
}

const ipEnrichCache = {} // ip -> Promise<{reg, geo}>
function enrichIp(ip) {
  if (!ipEnrichCache[ip]) {
    ipEnrichCache[ip] = (async () => {
      // Like the original: private/reserved addresses are labeled "Reserved".
      if (isPrivateIp(ip)) return { reg: 'Reserved', geo: null }
      const [reg, geo] = await Promise.all([
        rdapRegistrant(ip).catch(() => null),
        geoFor(ip).catch(() => null),
      ])
      return { reg: reg || null, geo: geo || null }
    })()
  }
  return ipEnrichCache[ip]
}

// Reverse DNS for an IP via the DNS lookup providers (extracted from
// renderLeakResults so the grouped re-render can reuse it).
async function ptrFor(ip) {
  const arpa = ipv4ToArpa(ip) || ipv6ToArpa(ip)
  if (!arpa) return null
  const res = await dnsQuery(arpa, 'PTR')
  return res.status === 0 && res.answers.length ? res.answers[0].data.replace(/\.$/, '') : null
}

// Pure derivation of the DNSSEC matrix status, ported from the original's
// drawDNSSEC. tests[i]: undefined = pending; i<4 = valid-signature tests;
// i>=4 = bad-signature tests (index 4 + 4*sigIdx + algIdx).
function dnssecSummary(tests) {
  let done = true
  let error = false
  let fail = false
  let mldsaFail = false
  for (let i = 0; i < 16; i++) {
    const got = tests[i]
    if (got === undefined) {
      done = false
      continue
    }
    if (i < 4) {
      if (!got) error = true
      continue
    }
    if (got && i % 4 === 3) mldsaFail = true
    else if (got) fail = true
  }
  return { done, error, fail, mldsaFail }
}

// Ported cell logic: got=true means the invalid/expired/unsigned domain
// CONNECTED (the resolver did not validate) -> FAIL (red); got=false -> PASS
// (green). ML-DSA-44 is special-cased yellow FAIL* with a footnote, exactly
// like the original (not yet widely validated).
function dnssecCellState(i) {
  const got = LS.dnssec[i]
  if (got === undefined || i < 4) return null
  const mldsa = i % 4 === 3
  if (got && mldsa) return { text: 'FAIL*', cls: 'dsec-warn' }
  if (got) return { text: 'FAIL', cls: 'dsec-fail' }
  return { text: 'PASS', cls: 'dsec-pass' }
}

function drawDNSSEC() {
  if (!LS) return
  for (let i = 0; i < 16; i++) {
    const got = LS.dnssec[i]
    if (got === undefined || i >= 4) {
      if (i >= 4) {
        const st = dnssecCellState(i)
        const cell = document.getElementById(`dsec-${i}`)
        if (cell && st) {
          cell.className = st.cls
          cell.textContent = st.text
        }
      }
      continue
    }
    // i < 4: valid-signature test failed -> whole column ERR (original skips
    // this algorithm's bad-signature probes, so those cells stay pending).
    if (!got) {
      for (let r = 0; r < 3; r++) {
        const cell = document.getElementById(`dsec-${4 + r * 4 + i}`)
        if (cell) {
          cell.className = 'dsec-warn'
          cell.textContent = 'ERR'
        }
      }
    }
  }
  const sum = dnssecSummary(LS.dnssec)
  const fn = document.getElementById('dsecFootnote')
  if (fn) fn.hidden = !sum.mldsaFail
  if (sum.error)
    LS.pills.dnssec = {
      label: 'DNSSEC',
      cls: 'yellow',
      title: 'Domain Name System Security Extensions\n\nAn error occurred',
    }
  else if (sum.fail)
    LS.pills.dnssec = {
      label: 'DNSSEC',
      cls: 'red',
      title: 'Domain Name System Security Extensions\n\nYour DNS responses are not authenticated',
    }
  else if (sum.done)
    LS.pills.dnssec = {
      label: 'DNSSEC',
      cls: 'green',
      title: 'Domain Name System Security Extensions\n\nYour DNS responses are authenticated',
    }
  drawPills()
}

function dnssecMatrixHtml() {
  const head =
    `<tr><th>Signature</th>` + LEAK_ALG_LABELS.map((l) => `<th>${esc(l)}</th>`).join('') + `</tr>`
  const body = LEAK_SIG_LABELS.map(
    (sigLabel, sigIdx) =>
      `<tr><th>${esc(sigLabel)}</th>` +
      LEAK_ALGS.map(
        (_, algIdx) =>
          `<td id="dsec-${4 + 4 * sigIdx + algIdx}" class="dsec-pending"><span>&middot;&middot;&middot;</span></td>`,
      ).join('') +
      `</tr>`,
  ).join('')
  return (
    `<div class="dns-table-wrap"><table class="dns-table dsec-table">` +
    `<thead>${head}</thead><tbody>${body}</tbody></table></div>` +
    `<div class="dns-note dsec-footnote" id="dsecFootnote" hidden>* ML-DSA-44 is a new signature algorithm not yet widely validated.</div>`
  )
}

// DNSSEC validation matrix, mirroring the original's testDNS sequence: per
// algorithm, probe the valid-signature domain; only if it connects, probe its
// badsig/expiredsig/nosig variants. connected=true on a bad variant means the
// resolver failed to validate -> FAIL.
async function runDnssecMatrix(id) {
  const alive = () => LS && !LS.finished
  // Calibration: probe a valid-signature alg domain (resolves to a real IP).
  // NOTE: never calibrate against the nullip domains — they intentionally
  // resolve to 0.0.0.0 (that's their purpose: trigger a DNS query without a
  // real server), so an HTTP fetch to them can never succeed. The original
  // uses nullip queries only as DNS triggers and measures "connected" on the
  // alg domains. If even the alg domain won't connect here, the probe
  // technique is blocked in this browser (or DNS is down) — mark the matrix
  // untestable instead of guessing.
  const calOk = await probeConnected(leakAlgFqdn(id, 'alg15'), 8000)
  if (!alive()) return
  if (!calOk) {
    LS.dnssecSkipped = true
    const note = document.getElementById('leakDnssecNote')
    if (note)
      note.innerHTML =
        `<span class="dns-note">DNSSEC validation tests could not run in this browser ` +
        `(network blocked or DNS unavailable) &mdash; resolver results above are unaffected.</span>`
    return
  }
  const valids = await Promise.all(
    LEAK_ALGS.map((alg, algIdx) =>
      probeConnected(leakAlgFqdn(id, alg), 10000).then((ok) => {
        if (!alive()) return false
        LS.dnssec[algIdx] = ok
        drawDNSSEC()
        return ok
      }),
    ),
  )
  if (!alive()) return
  await Promise.all(
    LEAK_ALGS.map((alg, algIdx) => {
      if (!valids[algIdx]) return Promise.resolve()
      return Promise.all(
        LEAK_SIGS.map((sig, sigIdx) =>
          probeConnected(leakSigFqdn(id, sig, alg), 15000).then((connected) => {
            if (!alive()) return
            LS.dnssec[4 + 4 * sigIdx + algIdx] = connected
            drawDNSSEC()
          }),
        ),
      )
    }),
  )
  if (alive()) LS.dnssecDone = true
}

// Average DNS round-trip time, ported from the original's testRTT: 5 rounds of
// fire-and-forget fetches to random unresolvable names across 3 TLDs.
async function runRtt() {
  const alive = () => LS && !LS.finished
  const rtts = []
  for (let i = 0; i < 5; i++) {
    for (const tld of ['com', 'net', 'org']) {
      if (!alive()) return
      const name = `test-${Math.random().toString(36).slice(2)}.null-addr.${tld}`
      const start = Date.now()
      try {
        await fetch('https://' + name).catch(() => {})
      } catch (e) {}
      rtts.push(Date.now() - start)
      const avg = Math.round(rtts.reduce((a, x) => a + x, 0) / rtts.length)
      LS.pills.rtt = {
        label: `${avg}ms`,
        cls: avg <= 150 ? 'green' : avg <= 500 ? 'yellow' : 'red',
        title: `Average DNS round-trip time over ${rtts.length} queries`,
      }
      drawPills()
    }
  }
}

// "Your IP addresses", ported from the original's testIPs minus the
// microphone-permission flow: myipv4/myipv6 endpoints (CORS-open, text/plain)
// plus best-effort WebRTC ICE candidates via STUN. Source is tracked so the
// extended (WebRTC) list hides behind "(show more)" like the original.
function detectIps() {
  const addIp = (str, src) => {
    str = String(str || '').trim()
    if (!str || !/^[0-9a-fA-F.:]+$/.test(str) || !LS || LS.ips[str]) return
    LS.ips[str] = src || 'net'
    leakUiIps = Object.entries(LS.ips)
    drawIps()
  }
  fetch('https://myipv4.addr.tools/plain')
    .then((r) => {
      if (!r.ok) throw new Error('bad status')
      return r.text()
    })
    .then((s) => addIp(s, 'net'))
    .catch(() => {})
  fetch('https://myipv6.addr.tools/plain')
    .then((r) => {
      if (!r.ok) throw new Error('bad status')
      return r.text()
    })
    .then((s) => addIp(s, 'net'))
    .catch(() => {})
  try {
    if (typeof RTCPeerConnection === 'undefined') return
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:myip.addr.tools:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
    })
    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (!candidate || !candidate.candidate) return
      const ip = candidate.candidate.split(' ')[4]
      if (ip && /^[0-9a-fA-F.:]+$/.test(ip) && !ip.endsWith('.local')) addIp(ip, 'webrtc')
    })
    try {
      pc.createDataChannel('dummy')
    } catch (e) {}
    pc.createOffer()
      .then((d) => pc.setLocalDescription(d))
      .catch(() => {})
    setTimeout(() => {
      try {
        pc.close()
      } catch (e) {}
    }, 6000)
  } catch (e) {}
}

// Mirrors the original's IP list: registrant name above the IP, "City, Region,
// CC" beside it. Registrant/geo fill in async (best-effort); the extended
// WebRTC list hides behind "(show more)". Uses module-level leakUi* state so
// the toggle works even after the run ends (LS is nulled on finish).
function drawIps() {
  const el = document.getElementById('leakIps')
  if (!el) return
  const entries = leakUiIps
  const wrap = document.getElementById('leakShowMoreWrap')
  if (!entries.length) {
    el.innerHTML = `<span class="dns-note">Detecting&hellip;</span>`
    if (wrap) wrap.innerHTML = ''
    return
  }
  const primary = entries.filter(([, s]) => s !== 'webrtc')
  const extra = entries.filter(([, s]) => s === 'webrtc')
  const showAll = leakUiShowMore || !extra.length
  const list = showAll ? entries : primary
  const tok = ++leakUiRender
  el.innerHTML =
    `<ul class="leak-ips">` +
    list
      .map(
        ([ip], i) =>
          `<li><div class="leak-reg" id="leakIpReg${i}"><span class="dns-note">&hellip;</span></div>` +
          `<div><span class="dns-mono">${esc(ip)}</span>` +
          `<span class="leak-geo" id="leakIpGeo${i}"></span></div></li>`,
      )
      .join('') +
    `</ul>`
  if (wrap) {
    if (extra.length && !leakUiShowMore) {
      wrap.innerHTML = `(<span class="link" id="leakShowMore">show more</span>)`
      const t = document.getElementById('leakShowMore')
      if (t)
        t.addEventListener('click', () => {
          leakUiShowMore = true
          drawIps()
        })
    } else {
      wrap.innerHTML = ''
    }
  }
  list.forEach(([ip], i) => {
    enrichIp(ip)
      .then(({ reg, geo }) => {
        if (leakUiRender !== tok) return
        const r = document.getElementById(`leakIpReg${i}`)
        const g = document.getElementById(`leakIpGeo${i}`)
        if (r) r.innerHTML = reg ? esc(reg) : '<span class="dns-note">&mdash;</span>'
        if (g) g.textContent = geo || ''
      })
      .catch(() => {})
  })
}

async function runLeakTest() {
  if (LEAK.running) return
  const btn = $('#leakGo')
  const statusEl = $('#leakStatus')
  const out = $('#leakResults')
  const bar = $('#leakPills')
  if (!btn || !statusEl || !out) return
  LEAK.running = true
  btn.disabled = true
  statusEl.innerHTML = ''
  if (bar) bar.innerHTML = ''
  out.innerHTML =
    `<div class="leak-sec-title">Your IP addresses <span id="leakShowMoreWrap"></span></div><div id="leakIps"></div>` +
    `<div class="leak-sec-title">DNSSEC Validation Tests</div>` +
    `<div id="leakDnssec">${dnssecMatrixHtml()}<div class="dns-note" id="leakDnssecNote"></div></div>` +
    `<div id="leakResolvers"></div>` +
    `<div class="leak-statusbar"><span class="leak-sb-pills" id="leakSbPills"></span>` +
    `<span class="leak-sb-dns dns-mono" id="leakSbDns">dns: 0</span></div>`

  const id = randHex8()
  leakUiIps = []
  leakUiShowMore = false
  LS = {
    finished: false,
    runId: id,
    t0: Date.now(),
    seen: new Map(), // remoteIp -> {protos:Set, ecs:Set, count}
    ips: {},
    udpSizes: [],
    pills: {},
    dnssec: new Array(16), // undefined = pending
    dnssecDone: false,
    dnssecSkipped: false,
    seenIPv6: false,
    seenADoX: false,
    total: 0,
    ws: null,
    finTimer: null,
  }
  drawIps()

  const finish = (timedOut) => {
    const st = LS
    if (!st || st.finished) return
    st.finished = true
    if (st.finTimer) clearInterval(st.finTimer)
    try {
      if (st.ws) st.ws.close()
    } catch (e) {}
    LEAK.running = false
    const b2 = $('#leakGo')
    if (b2) b2.disabled = false
    // IPv6 status when never observed (ported from the original).
    if (!st.seenIPv6 && !st.pills.ipv6)
      st.pills.ipv6 = {
        label: 'IPv6',
        cls: 'red',
        title: 'Your DNS resolvers cannot reach nameservers over IPv6',
      }
    drawPills()
    renderLeakResults(st, timedOut)
    LS = null
  }

  const failUnreachable = () => {
    const st = LS
    if (st && st.finTimer) clearInterval(st.finTimer)
    if (st) st.finished = true
    LS = null
    LEAK.running = false
    const b2 = $('#leakGo')
    if (b2) b2.disabled = false
    const s2 = $('#leakStatus')
    if (s2) s2.innerHTML = ''
    const bar2 = document.getElementById('leakPills')
    if (bar2) bar2.innerHTML = ''
    const o2 = $('#leakResults')
    if (o2)
      o2.innerHTML = `<div class="dns-err">Leak test unreachable (dnscheck.tools WebSocket blocked) &mdash; DNS Lookup above still works.</div>`
  }

  // Finish once the DNSSEC matrix has settled (or was skipped) and we've
  // listened a while; hard cap 45s.
  LS.finTimer = setInterval(() => {
    const st = LS
    if (!st || st.finished) {
      clearInterval(LS ? LS.finTimer : undefined)
      return
    }
    const elapsed = Date.now() - st.t0
    if ((st.dnssecDone || st.dnssecSkipped) && elapsed >= 12000) {
      clearInterval(st.finTimer)
      finish(false)
    } else if (elapsed >= 45000) {
      clearInterval(st.finTimer)
      finish(true)
    }
  }, 1000)

  statusEl.innerHTML = `<span class="spinner" aria-hidden="true"></span> Opening channel&hellip;`
  try {
    LS.ws = await new Promise((resolve, reject) => {
      let w
      try {
        w = new WebSocket(`wss://ws.dnscheck.tools/watch/${id}`)
      } catch (e) {
        reject(e)
        return
      }
      let settled = false
      const to = setTimeout(() => {
        if (!settled) {
          settled = true
          try {
            w.close()
          } catch (e) {}
          reject(new Error('timeout'))
        }
      }, 8000)
      w.onopen = () => {
        if (!settled) {
          settled = true
          clearTimeout(to)
          resolve(w)
        }
      }
      w.onerror = () => {
        if (!settled) {
          settled = true
          clearTimeout(to)
          reject(new Error('error'))
        }
      }
      w.onclose = () => {
        if (!settled) {
          settled = true
          clearTimeout(to)
          reject(new Error('closed'))
        }
      }
    })
  } catch (e) {
    failUnreachable()
    return
  }

  LS.ws.onmessage = (ev) => {
    const st = LS
    if (!st || st.finished) return
    try {
      const m = JSON.parse(ev.data)
      if (!m || !m.remoteIp) return
      let e = st.seen.get(m.remoteIp)
      if (!e) {
        e = { protos: new Set(), ecs: new Set(), count: 0 }
        st.seen.set(m.remoteIp, e)
      }
      if (m.proto) e.protos.add(String(m.proto))
      if (m.clientSubnet) e.ecs.add(String(m.clientSubnet))
      e.count++
      st.total++
      // EDNS support + advertised UDP buffer sizes (ported from the original).
      if (m.isEdns0 && m.udpSize && !st.udpSizes.includes(m.udpSize)) {
        st.udpSizes.push(m.udpSize)
        st.udpSizes.sort((a, b) => a - b)
        st.pills.edns = {
          label: 'EDNS',
          cls: st.udpSizes[0] < 1200 ? 'yellow' : 'green',
          title: `Extension Mechanisms for DNS\n\nAdvertised UDP buffer sizes: ${st.udpSizes.join(', ')}`,
        }
        drawPills()
      }
      // IPv6 reachability (ported).
      if (!st.seenIPv6 && String(m.remoteIp).includes(':')) {
        st.seenIPv6 = true
        st.pills.ipv6 = {
          label: 'IPv6',
          cls: 'green',
          title: 'Your DNS resolvers connect to nameservers over IPv6',
        }
        drawPills()
      }
      // ADoX: encrypted transport to the authoritative nameservers (ported).
      if (!st.seenADoX && (m.proto === 'TLS' || m.proto === 'QUIC')) {
        st.seenADoX = true
        st.pills.adox = {
          label: 'ADoX',
          cls: 'blue',
          title:
            'Authoritative DoT/DoQ\n\nOne or more queries from your DNS resolvers to our authoritative nameservers used an encrypted transport',
        }
        drawPills()
      }
      const s3 = $('#leakStatus')
      if (s3)
        s3.innerHTML =
          `<span class="spinner" aria-hidden="true"></span> Listening&hellip; ${st.total} ` +
          `quer${st.total === 1 ? 'y' : 'ies'} seen`
      const sbd = document.getElementById('leakSbDns')
      if (sbd) sbd.textContent = `dns: ${st.total}`
    } catch (e) {
      /* ignore malformed messages */
    }
  }
  LS.ws.onclose = () => finish(false)
  LS.ws.onerror = () => {} // surfaced via onclose/timeout; never crash

  const s4 = $('#leakStatus')
  if (s4) s4.innerHTML = `<span class="spinner" aria-hidden="true"></span> Sending test queries&hellip;`
  // Resolver-discovery triggers (ported from the original's testDNS), plus the
  // IPv6 trigger. no-cors: their CORS only allows their own origin; the DNS
  // still resolves server-side and results arrive over the WebSocket.
  for (const s of ['a', 'b', 'c', 'd']) {
    try {
      fetch(`https://${leakNullipFqdn(id, s)}/`, { mode: 'no-cors' }).catch(() => {})
    } catch (e) {}
  }
  try {
    fetch(`https://${leakIpv6Fqdn(id)}/`, { mode: 'no-cors' }).catch(() => {})
  } catch (e) {}

  // Independent sub-tasks run concurrently (the original runs them in order;
  // each result is independent, so this only shortens the run).
  detectIps()
  runRtt()
  runDnssecMatrix(id)
}

function renderLeakResults(st, timedOut) {
  const statusEl = $('#leakStatus')
  const out = $('#leakResolvers')
  if (!statusEl || !out) return
  statusEl.innerHTML = ''
  out.dataset.runId = st.runId
  const seen = st.seen
  const n = seen.size
  const meta =
    `<div class="leak-sec-title">Your DNS resolvers</div>` +
    `<div class="dns-meta">Your queries were seen from <b>${n} resolver${n === 1 ? '' : 's'}</b>` +
    (timedOut ? ' (stopped after 45s)' : '') +
    `</div>`
  if (!n) {
    out.innerHTML =
      meta +
      `<div class="dns-empty">No resolvers observed${timedOut ? ' (timed out)' : ''} &mdash; ` +
      `your network may block the test queries, or the channel closed early.</div>`
    return
  }
  const entries = [...seen.entries()]
  const ecsAll = [...new Set(entries.flatMap(([, e]) => [...e.ecs]))]
  const ecsLine = ecsAll.length
    ? `<div class="dns-meta">Your DNS resolvers advertise your IP subnet (ECS): ` +
      `<span class="dns-mono">${esc(ecsAll.join(', '))}</span></div>`
    : ''
  const headRow =
    `<tr><th>Resolver IP</th><th>Reverse DNS</th><th>Location</th><th>Protocol</th><th>Queries</th></tr>`
  // Immediate render with placeholders; enrich async, then regroup by registrant.
  out.innerHTML =
    meta +
    `<div class="dns-table-wrap"><table class="dns-table"><thead>${headRow}</thead><tbody>` +
    entries
      .map(
        ([ip, e], i) =>
          `<tr><td class="dns-mono">${esc(ip)}</td>` +
          `<td class="dns-mono" id="leakPtr${i}"><span class="dns-note">&hellip;</span></td>` +
          `<td id="leakGeo${i}"><span class="dns-note">&hellip;</span></td>` +
          `<td>${esc([...e.protos].join(', ') || '—')}</td>` +
          `<td class="dns-num">${e.count}</td></tr>`,
      )
      .join('') +
    `</tbody></table></div>` +
    ecsLine

  const alive = () => out.dataset.runId === st.runId
  const jobs = entries.map(async ([ip, e], i) => {
    const [enr, ptr] = await Promise.all([
      enrichIp(ip).catch(() => ({ reg: null, geo: null })),
      ptrFor(ip).catch(() => null),
    ])
    const row = { ip, e, reg: enr.reg, geo: enr.geo, ptr }
    if (alive()) {
      const pc = document.getElementById(`leakPtr${i}`)
      const gc = document.getElementById(`leakGeo${i}`)
      if (pc) pc.innerHTML = ptr ? esc(ptr) : '<span class="dns-note">&mdash;</span>'
      if (gc) gc.innerHTML = enr.geo ? esc(enr.geo) : '<span class="dns-note">&mdash;</span>'
    }
    return row
  })
  // Once all enrichment settles, re-render grouped by registrant like the original.
  Promise.all(jobs)
    .then((rows) => {
      if (!alive()) return
      const groups = new Map()
      for (const r of rows) {
        const key = r.reg || 'Unknown'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(r)
      }
      let html = meta + `<div class="dns-table-wrap"><table class="dns-table"><thead>${headRow}</thead><tbody>`
      for (const [key, rs] of groups) {
        html += `<tr class="leak-regrow"><td colspan="5">${esc(key)}</td></tr>`
        for (const r of rs) {
          html +=
            `<tr><td class="dns-mono">${esc(r.ip)}</td>` +
            `<td class="dns-mono">${r.ptr ? esc(r.ptr) : '<span class="dns-note">&mdash;</span>'}</td>` +
            `<td>${r.geo ? esc(r.geo) : '<span class="dns-note">&mdash;</span>'}</td>` +
            `<td>${esc([...r.e.protos].join(', ') || '—')}</td>` +
            `<td class="dns-num">${r.e.count}</td></tr>`
        }
      }
      out.innerHTML = html + `</tbody></table></div>` + ecsLine
    })
    .catch(() => {})
}

async function init() {
  applyTheme()
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (themeMode() === 'auto') applyTheme()
    })

  $('#themeBtn').addEventListener('click', cycleTheme)

  $('#incidentModalClose').addEventListener('click', closeIncidentModal)
  $('#incidentModal').addEventListener('click', (e) => {
    if (e.target.id === 'incidentModal') closeIncidentModal()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#incidentModal').hidden) closeIncidentModal()
  })

  const input = $('#filterInput')
  input.addEventListener('input', (e) => {
    if (e.target.value === '/') return
    FILTER = e.target.value
    renderMonitors()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') e.target.blur()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault()
      input.focus()
    }
  })

  // View navigation (UptimeFlare-style header links)
  document.querySelectorAll('.nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault()
      setView(a.dataset.view)
      try {
        const h =
          a.dataset.view === 'incidents'
            ? '#incidents'
            : a.dataset.view === 'speedtest'
              ? '#speedtest'
              : a.dataset.view === 'dns'
                ? '#dns'
                : '#'
        history.replaceState(null, '', h)
      } catch (err) {}
    })
  })
  $('#logo').addEventListener('click', () => setView('status'))
  $('.brand').style.cursor = 'pointer'
  $('.brand').addEventListener('click', () => setView('status'))

  const [cfg, loc] = await Promise.all([
    fetch('config.json').then((r) => {
      if (!r.ok) throw new Error('config.json not found — run npm run build')
      return r.json()
    }),
    fetch('locations.json').then((r) => (r.ok ? r.json() : {})),
  ])
  CONFIG = cfg
  LOCATIONS = loc || {}

  await refreshState()
  render()
  renderBrowserLatency()
  const viewFromHash = () =>
    location.hash === '#incidents'
      ? 'incidents'
      : location.hash === '#speedtest'
        ? 'speedtest'
        : location.hash === '#dns'
          ? 'dns'
          : 'status'
  setView(viewFromHash())
  window.addEventListener('hashchange', () => setView(viewFromHash()))
  setInterval(refreshState, 30000)
  setInterval(tickHero, 1000)
}

init().catch((e) => {
  $('#monitors').innerHTML =
    `<div class="empty">Failed to load status page: ${esc(e.message)}</div>`
})
