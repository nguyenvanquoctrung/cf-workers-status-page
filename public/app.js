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

const ST = { running: false }
const ST2 = { running: false } // detailed (vietcdn-style) test state

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
    `<p class="st-sub">vietcdn-style rounds against the Cloudflare edge serving this page: ` +
    `one single-connection round, then one 6-connection round. Each row appears when its round finishes.</p>` +
    `<div id="stDetailRows"></div>` +
    `<div class="st-controls"><button class="btn" id="stDetailStart">Start detailed test</button>` +
    `<span class="st-status" id="stDetailStatus"></span></div></div>`
  $('#stStart').addEventListener('click', runSpeedtest)
  $('#stDetailStart').addEventListener('click', runDetailedTest)
}

// vietcdn-style: sequential single-connection then 6-connection download rounds
// against the Cloudflare edge. Rows appear progressively as each round finishes.
async function runDetailedTest() {
  if (ST2.running || ST.running) return
  ST2.running = true
  const btn = $('#stDetailStart')
  const status = $('#stDetailStatus')
  const rows = $('#stDetailRows')
  btn.disabled = true
  $('#stStart').disabled = true // concurrent tests would skew each other's numbers
  btn.textContent = 'Testing…'
  rows.innerHTML = ''
  try {
    const rounds = [
      { label: 'Single connection', streams: 1 },
      { label: '6 parallel connections', streams: 6 },
    ]
    for (const [i, rd] of rounds.entries()) {
      const rowId = `stDetailRow${i}`
      rows.insertAdjacentHTML(
        'beforeend',
        `<div class="st-drow"><div class="st-drow-head"><strong>${esc(rd.label)}</strong>` +
          `<span class="st-drow-server">Cloudflare edge (this site)</span></div>` +
          `<div class="st-drow-value" id="${rowId}"><span class="st-status">measuring…</span></div></div>`,
      )
      status.textContent = `Measuring ${rd.label.toLowerCase()}…`
      try {
        const mbps = await stDownload((v) => {
          const el = document.getElementById(rowId)
          if (el) el.innerHTML = `${v.toFixed(2)} <span class="st-unit">Mbps</span>`
        }, rd.streams)
        const el = document.getElementById(rowId)
        if (el) el.innerHTML = stRateHtml(mbps)
      } catch (e) {
        const el = document.getElementById(rowId)
        if (el) el.textContent = 'failed'
      }
    }
    status.textContent = 'Done.'
  } finally {
    ST2.running = false
    btn.disabled = false
    $('#stStart').disabled = false
    btn.textContent = 'Run again'
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

async function stDownload(onTick, streams = ST_STREAMS) {
  const t0 = performance.now()
  const graceEnd = t0 + ST_GRACE_MS
  const deadline = t0 + ST_WINDOW_MS
  let bytes = 0

  async function stream() {
    let fails = 0
    while (performance.now() < deadline) {
      const remain = deadline - performance.now()
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), Math.max(remain + 500, 1))
      try {
        const r = await fetch(
          `${ST_DL_URL}?r=${Math.random().toString(36).slice(2)}`,
          { cache: 'no-store', signal: ctrl.signal },
        )
        if (!r.ok || !r.body) throw new Error('bad download response')
        const reader = r.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const now = performance.now()
          if (now >= graceEnd) bytes += value.byteLength
          if (now >= deadline) {
            reader.cancel().catch(() => {})
            break
          }
        }
        fails = 0
      } catch (e) {
        if (performance.now() >= deadline) break // aborted by the deadline
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

// Live "N sec ago" ticker (UptimeFlare behavior): updates every second and
// reloads the page when data is older than 300s (avoids a stale dashboard).
function tickHero() {
  const lu = STATE.lastUpdate || {}
  const el = document.querySelector('.hero-sub')
  if (!el || !lu.time) return
  const next = heroMeta(lu)
  if (el.textContent !== next) el.textContent = next
  const secs = Math.max(0, Math.round((Date.now() - lu.time) / 1000))
  if (secs > 300 && Date.now() - OPENED_AT > 30000) location.reload()
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

async function refreshState() {
  try {
    const res = await fetch('api/state', { cache: 'no-store' })
    if (res.ok) {
      const st = await res.json()
      STATE = {
        monitors: st.monitors || {},
        lastUpdate: st.lastUpdate || {},
      }
      renderStatusHeader()
      renderMonitors()
      if (VIEW === 'incidents') renderIncidents()
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
    `your network actually uses, by watching special test queries arrive at their nameservers.</p></div>` +
    `<div class="st-controls"><button class="btn" id="leakGo">Run leak test</button>` +
    `<span class="st-status" id="leakStatus"></span></div>` +
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

// ---- DNS leak test (Phase 9, Card 2) ----
// Replicates the dnscheck.tools main flow: the browser opens a WebSocket to
// THEIR infrastructure, then fires special test subdomains at it. Their
// authoritative nameserver observes the DNS queries and pushes details back
// over the socket. Trigger fetches use mode:'no-cors' (their CORS only allows
// their own origin) — the DNS still resolves server-side; results arrive via WS.
const LEAK = { running: false }

function randHex8() {
  const b = new Uint8Array(4)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

async function runLeakTest() {
  if (LEAK.running) return
  const btn = $('#leakGo')
  const statusEl = $('#leakStatus')
  const out = $('#leakResults')
  if (!btn || !statusEl || !out) return
  LEAK.running = true
  btn.disabled = true
  out.innerHTML = ''
  const id = randHex8()
  const seen = new Map() // remoteIp -> {protos:Set, ecs:Set, count}
  let total = 0
  let finished = false
  let ws = null
  const finish = (timedOut) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    try {
      if (ws) ws.close()
    } catch (e) {}
    LEAK.running = false
    const b2 = $('#leakGo')
    if (b2) b2.disabled = false
    renderLeakResults(seen, total, timedOut)
  }
  const timer = setTimeout(() => finish(true), 20000)
  const failUnreachable = () => {
    clearTimeout(timer)
    finished = true
    LEAK.running = false
    const b2 = $('#leakGo')
    if (b2) b2.disabled = false
    const s2 = $('#leakStatus')
    if (s2) s2.innerHTML = ''
    const o2 = $('#leakResults')
    if (o2)
      o2.innerHTML = `<div class="dns-err">Leak test unreachable (dnscheck.tools WebSocket blocked) &mdash; DNS Lookup above still works.</div>`
  }
  statusEl.innerHTML = `<span class="spinner" aria-hidden="true"></span> Opening channel&hellip;`
  try {
    ws = await new Promise((resolve, reject) => {
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
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data)
      if (!m || !m.remoteIp) return
      let e = seen.get(m.remoteIp)
      if (!e) {
        e = { protos: new Set(), ecs: new Set(), count: 0 }
        seen.set(m.remoteIp, e)
      }
      if (m.proto) e.protos.add(String(m.proto))
      if (m.clientSubnet) e.ecs.add(String(m.clientSubnet))
      e.count++
      total++
      const s3 = $('#leakStatus')
      if (s3)
        s3.innerHTML =
          `<span class="spinner" aria-hidden="true"></span> Listening&hellip; ${total} ` +
          `quer${total === 1 ? 'y' : 'ies'} seen`
      if (total >= 8) finish(false)
    } catch (e) {
      /* ignore malformed messages */
    }
  }
  ws.onclose = () => finish(false)
  ws.onerror = () => {} // surfaced via onclose/timeout; never crash
  const s4 = $('#leakStatus')
  if (s4)
    s4.innerHTML = `<span class="spinner" aria-hidden="true"></span> Sending test queries&hellip;`
  for (const s of ['a', 'b', 'c', 'd']) {
    try {
      fetch(`https://${s}.${id}-nullip.test.dnscheck.tools/`, {
        mode: 'no-cors',
      }).catch(() => {})
    } catch (e) {}
  }
}

function renderLeakResults(seen, total, timedOut) {
  const statusEl = $('#leakStatus')
  const out = $('#leakResults')
  if (!statusEl || !out) return
  statusEl.innerHTML = ''
  const n = seen.size
  let html =
    `<div class="dns-meta">Your queries were seen from <b>${n} resolver${n === 1 ? '' : 's'}</b>` +
    (timedOut ? ' (stopped after 20s)' : '') +
    `</div>`
  if (!n) {
    out.innerHTML =
      html +
      `<div class="dns-empty">No resolvers observed${timedOut ? ' (timed out)' : ''} &mdash; ` +
      `your network may block the test queries, or the channel closed early.</div>`
    return
  }
  const entries = [...seen.entries()]
  html +=
    `<div class="dns-table-wrap"><table class="dns-table"><thead><tr>` +
    `<th>Resolver IP</th><th>Reverse DNS</th><th>Protocol</th><th>ECS subnet</th><th>Queries</th>` +
    `</tr></thead><tbody>` +
    entries
      .map(
        ([ip, e], i) =>
          `<tr><td class="dns-mono">${esc(ip)}</td>` +
          `<td class="dns-mono" id="leakPtr${i}"><span class="dns-note">&hellip;</span></td>` +
          `<td>${esc([...e.protos].join(', ') || '\u2014')}</td>` +
          `<td class="dns-mono">${esc([...e.ecs].join(', ') || '\u2014')}</td>` +
          `<td class="dns-num">${e.count}</td></tr>`,
      )
      .join('') +
    `</tbody></table></div>`
  out.innerHTML = html
  // Best-effort reverse DNS via the lookup providers (RDAP skipped — too heavy).
  entries.forEach(([ip], i) => {
    const cell = () => document.getElementById(`leakPtr${i}`)
    const arpa = ipv4ToArpa(ip) || ipv6ToArpa(ip)
    if (!arpa) {
      const c = cell()
      if (c) c.innerHTML = '<span class="dns-note">&mdash;</span>'
      return
    }
    dnsQuery(arpa, 'PTR')
      .then((res) => {
        const c = cell()
        if (!c) return
        const ptr =
          res.status === 0 && res.answers.length
            ? res.answers[0].data.replace(/\.$/, '')
            : null
        c.textContent = ptr || '\u2014'
      })
      .catch(() => {
        const c = cell()
        if (c) c.innerHTML = '<span class="dns-note">&mdash;</span>'
      })
  })
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
