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

const MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>'
const SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>'
const INFO =
  '<svg class="info-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'

// Tabler outline icons (IconCircleCheck / IconAlertCircle / plain circle)
const CHECK_PATHS =
  '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M8 12.5l2.5 2.5l5 -5"/>'
const ALERT_PATHS =
  '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 8v4"/><path d="M12 16h.01"/>'
const CIRCLE_PATHS = '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/>'
const tabler = (paths, size, color, cls) =>
  `<svg${cls ? ` class="${cls}"` : ''} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.theme = theme
  } catch (e) {}
  $('#themeBtn').innerHTML = theme === 'dark' ? SUN : MOON
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

function monitorStatusIcon(data) {
  if (!data || typeof data.lastCheck === 'undefined') {
    return tabler(CIRCLE_PATHS, '1.25em', 'var(--muted)', 'micon')
  }
  return data.lastCheck.operational
    ? tabler(CHECK_PATHS, '1.25em', '#059669', 'micon')
    : tabler(ALERT_PATHS, '1.25em', 'var(--red-dark)', 'micon')
}

let CHARTS = []
let STRIPS = {}

function latencyChart(monitor, data, ci) {
  const s = CONFIG.settings
  const n = s.daysInHistogram
  const days = dayStats(data)
  CHARTS[ci] = days

  // Too little data for a meaningful line: show a subtle placeholder
  // instead of a broken-looking stub (tiny segment / empty axes).
  const chartable = days.filter((dd) => dd.avg != null).length
  if (chartable < 2) {
    return `<div class="chart-nodata">No data yet</div>`
  }

  const W = 600
  const H = 150
  const padT = 14
  const padB = 26
  const padX = 8
  const maxV = Math.max(1, ...days.map((x) => x.avg || 0))
  const X = (i) => padX + (i * (W - padX * 2)) / (n - 1)
  const Y = (v) => padT + (1 - v / maxV) * (H - padT - padB)
  const base = H - padB

  let line = ''
  let dots = ''
  let hovers = ''
  const step = (W - padX * 2) / (n - 1)
  let seg = []
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
  const flush = () => {
    // Red incident dots only — no plain dots (UptimeFlare-style)
    if (seg.length === 1) {
      const p = seg[0]
      if (p.fails > 0) {
        dots += `<circle cx="${f1(X(p.i))}" cy="${f1(Y(p.avg))}" r="4.5" class="cdot bad"/>`
      }
    } else if (seg.length > 1) {
      const pts = seg.map((p) => ({ x: X(p.i), y: Y(p.avg) }))
      const d = smoothPath(pts)
      line += `<path d="${d}" class="cline" vector-effect="non-scaling-stroke"/>`
      for (const p of seg) {
        if (p.fails > 0) {
          dots += `<circle cx="${f1(X(p.i))}" cy="${f1(Y(p.avg))}" r="4.5" class="cdot bad"/>`
        }
      }
    }
    seg = []
  }
  days.forEach((dd, i) => {
    hovers += `<rect x="${(X(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" class="hov" data-i="${i}"/>`
    if (dd.avg == null) {
      flush()
      if (dd.fails > 0) {
        dots += `<circle cx="${X(i).toFixed(1)}" cy="${base.toFixed(1)}" r="4.5" class="cdot bad"/>`
      }
    } else {
      seg.push({ i, avg: dd.avg, fails: dd.fails })
    }
  })
  flush()

  return (
    `<div class="chart-title">Response times(ms)</div>` +
    `<div class="chart-wrap" data-ci="${ci}">` +
    `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">` +
    `<text x="${W - padX}" y="${padT - 4}" text-anchor="end" class="cmax">max ${Math.round(maxV)}ms</text>` +
    `<line x1="${padX}" y1="${base}" x2="${W - padX}" y2="${base}" class="caxis" vector-effect="non-scaling-stroke"/>` +
    line +
    dots +
    hovers +
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
    const days = CHARTS[parseInt(wrap.dataset.ci, 10)]
    if (!days) return
    const svg = wrap.querySelector('svg')
    const tip = wrap.querySelector('.chart-tip')
    const s = CONFIG.settings
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect()
      const i = Math.max(
        0,
        Math.min(days.length - 1, Math.round(((e.clientX - r.left) / r.width) * (days.length - 1))),
      )
      const dd = days[i]
      let label
      if (dd.avg == null && dd.fails === 0) {
        label = esc(s.dayInHistogramNoData)
      } else if (dd.fails > 0) {
        label = `${dd.fails} ${esc(s.dayInHistogramNotOperational)}`
      } else {
        label = esc(s.dayInHistogramOperational)
      }
      const avgs = dd.locs
        .map((l) => `<span class="tip-avg">${esc(LOCATIONS[l.loc] || l.loc)}: ${Math.round(l.a)}ms</span>`)
        .join('')
      tip.innerHTML =
        `<span class="tip-date">${fmtDay(dd.day)}</span>` +
        (dd.avg != null ? `<span class="tip-label">${Math.round(dd.avg)}ms avg</span>` : '') +
        `<span class="tip-label2">${label}</span>${avgs}`
      tip.hidden = false
      const wr = wrap.getBoundingClientRect()
      let left = e.clientX - wr.left + 14
      left = Math.max(4, Math.min(left, wr.width - 150))
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
      let html
      if (!dd.hasData || dd.pct == null) {
        html = `<span class="tip-date">${fmtDay(dd.day)}</span><span class="tip-label2">No Data</span>`
      } else {
        html = `<span class="tip-label2">${dd.pct.toPrecision(4)}% at ${fmtDay(dd.day)}</span>`
        if (dd.downSecs > 0) {
          html += `<span class="tip-avg">Down for ${fmtDur(dd.downSecs)} (click for detail)</span>`
        }
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
  $('#incidentModalTitle').textContent = `incidents at ${fmtDay(dd.day)}`
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
  $('#incidents').innerHTML =
    `<div class="inc-controls"><select id="incMonitorFilter" aria-label="Filter by monitor">${options}</select></div>` +
    list +
    `<div class="inc-pager">` +
    `<button class="btn" id="incPrev">&larr; Backwards</button>` +
    `<span class="month-label">${esc(fmtMonth(month))}</span>` +
    `<button class="btn" id="incNext">Forward &rarr;</button>` +
    `</div>`
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
      : `<a class="name-text" href="${esc(monitor.url)}" target="_blank" rel="noopener">${esc(monitor.name)}</a>`
  const descHtml = monitor.description
    ? `<span class="tooltip" tabindex="0">${INFO}<span class="tip">${esc(monitor.description)}</span></span>`
    : ''

  const up = overallInfo(data)
  const overallHtml = up
    ? `<span class="overall" style="color:${overallColor(up.pct)}">Overall: ${up.pct.toPrecision(4)}%</span>`
    : `<span class="overall" style="color:var(--muted)">${esc(CONFIG.settings.monitorLabelNoData)}</span>`

  return (
    `<section class="monitor" data-monitor="${esc(monitor.id)}">` +
    `<div class="monitor-row"><div class="monitor-name">${monitorStatusIcon(data)}${descHtml}${nameHtml}</div>` +
    `${overallHtml}</div>` +
    `${uptimeStrip(monitor, data, ci)}` +
    `${latencyChart(monitor, data, ci)}` +
    `<div class="hist-legend"><span>${CONFIG.settings.daysInHistogram} days ago</span><span>Today</span></div>` +
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
    const secs = Math.max(0, Math.round((Date.now() - lu.time) / 1000))
    const date = new Date(lu.time).toLocaleString()
    meta = `Last updated on: ${esc(date)} (${secs} sec ago)`
  }
  $('#statusHeader').innerHTML =
    `<div class="hero"><div class="hero-icon">${icon}</div>` +
    `<h1 class="hero-title">${esc(text)}</h1>` +
    (meta ? `<p class="hero-sub">${meta}</p>` : '') +
    `</div>`
}

// Live "N sec ago" ticker (UptimeFlare behavior): updates every second and
// reloads the page when data is older than 300s (avoids a stale dashboard).
function tickHero() {
  const lu = STATE.lastUpdate || {}
  const el = document.querySelector('.hero-sub')
  if (!el || !lu.time) return
  const secs = Math.max(0, Math.round((Date.now() - lu.time) / 1000))
  const date = new Date(lu.time).toLocaleString()
  const next = `Last updated on: ${date} (${secs} sec ago)`
  if (el.textContent !== next) el.textContent = next
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
  setTheme(document.documentElement.dataset.theme || 'light')

  $('#themeBtn').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
  })

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
