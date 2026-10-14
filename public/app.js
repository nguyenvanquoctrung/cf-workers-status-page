/* cf-workers-status-page v2 frontend — vanilla JS, no build step. */
'use strict'

const $ = (sel) => document.querySelector(sel)

let CONFIG = null
let LOCATIONS = {}
let STATE = { monitors: {}, lastUpdate: {} }
let FILTER = ''
let VIEW = 'status' // 'status' | 'incidents'
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
  return null // null = default: everything expanded
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
  const rawMax = Math.max(1, ...pts.map((p) => p.ms))
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

function setView(v) {
  VIEW = v
  $('#statusView').hidden = v !== 'status'
  $('#incidentsView').hidden = v !== 'incidents'
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === v)
  })
  document.title =
    (v === 'incidents' ? 'Incidents — ' : '') + CONFIG.settings.title
  if (v === 'incidents') renderIncidents()
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
    `<div class="monitor-row"><div class="monitor-name">${monitorStatusIcon(monitor, data)}${nameHtml}</div>` +
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
      const all = CONFIG.monitors.map((m) => groupOf(m))
      const exp = expandedGroups() || new Set(all)
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
  const all = CONFIG.monitors.map((m) => groupOf(m))
  const expanded = expandedGroups() || new Set(all)
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
        history.replaceState(null, '', a.dataset.view === 'incidents' ? '#incidents' : '#')
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
  setView(location.hash === '#incidents' ? 'incidents' : 'status')
  setInterval(refreshState, 30000)
  setInterval(tickHero, 1000)
}

init().catch((e) => {
  $('#monitors').innerHTML =
    `<div class="empty">Failed to load status page: ${esc(e.message)}</div>`
})
