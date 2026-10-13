/* cf-workers-status-page v2 frontend — vanilla JS, no build step. */
'use strict'

const $ = (sel) => document.querySelector(sel)

let CONFIG = null
let LOCATIONS = {}
let STATE = { monitors: {}, lastUpdate: {} }
let FILTER = ''

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const dayStr = (d) => d.toISOString().split('T')[0]

const MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>'
const SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>'
const INFO =
  '<svg class="info-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'

function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.theme = theme
  } catch (e) {}
  $('#themeBtn').innerHTML = theme === 'dark' ? SUN : MOON
}

function statusPill(data) {
  const s = CONFIG.settings
  if (!data || typeof data.lastCheck === 'undefined') {
    return `<span class="pill pill-gray">${esc(s.monitorLabelNoData)}</span>`
  }
  return data.lastCheck.operational
    ? `<span class="pill pill-green">${esc(s.monitorLabelOperational)}</span>`
    : `<span class="pill pill-yellow">${esc(s.monitorLabelNotOperational)}</span>`
}

let CHARTS = []

function latencyChart(monitor, data, ci) {
  const s = CONFIG.settings
  const n = s.daysInHistogram
  const days = []
  const d = new Date()
  d.setDate(d.getDate() - n)
  for (let i = 0; i < n; i++) {
    d.setDate(d.getDate() + 1)
    const day = dayStr(d)
    let avg = null
    let fails = 0
    let locs = []
    if (data && data.firstCheck <= day) {
      const e = data.checks && data.checks[day]
      if (e) {
        fails = e.fails || 0
        let tot = 0
        let cnt = 0
        for (const loc of Object.keys(e.res || {})) {
          const r = e.res[loc]
          tot += r.a * r.n
          cnt += r.n
          locs.push({ loc, a: r.a })
        }
        if (cnt > 0) avg = tot / cnt
      }
    }
    days.push({ day, avg, fails, locs })
  }
  CHARTS[ci] = days

  const W = 600
  const H = 132
  const padT = 14
  const padB = 26
  const padX = 8
  const maxV = Math.max(1, ...days.map((x) => x.avg || 0))
  const X = (i) => padX + (i * (W - padX * 2)) / (n - 1)
  const Y = (v) => padT + (1 - v / maxV) * (H - padT - padB)
  const base = H - padB

  let line = ''
  let area = ''
  let dots = ''
  let hovers = ''
  const step = (W - padX * 2) / (n - 1)
  let seg = []
  const flush = () => {
    if (seg.length === 1) {
      const p = seg[0]
      dots += `<circle cx="${X(p.i).toFixed(1)}" cy="${Y(p.avg).toFixed(1)}" r="3.5" class="cdot${p.fails > 0 ? ' bad' : ''}"/>`
    } else if (seg.length > 1) {
      const pts = seg
        .map((p) => `${X(p.i).toFixed(1)},${Y(p.avg).toFixed(1)}`)
        .join(' ')
      line += `<polyline points="${pts}" class="cline" vector-effect="non-scaling-stroke"/>`
      area += `<polygon points="${X(seg[0].i).toFixed(1)},${base} ${pts} ${X(seg[seg.length - 1].i).toFixed(1)},${base}" class="carea"/>`
      for (const p of seg) {
        if (p.fails > 0) {
          dots += `<circle cx="${X(p.i).toFixed(1)}" cy="${Y(p.avg).toFixed(1)}" r="4.5" class="cdot bad"/>`
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
    `<div class="chart-wrap" data-ci="${ci}">` +
    `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">` +
    `<text x="${W - padX}" y="${padT - 4}" text-anchor="end" class="cmax">max ${Math.round(maxV)}ms</text>` +
    `<line x1="${padX}" y1="${base}" x2="${W - padX}" y2="${base}" class="caxis" vector-effect="non-scaling-stroke"/>` +
    area +
    line +
    dots +
    hovers +
    `</svg><div class="chart-tip" hidden></div></div>`
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
        `<span class="tip-date">${dd.day}</span>` +
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

function monitorCard(monitor, data, ci) {
  const nameHtml =
    monitor.linkable === false
      ? `<span>${esc(monitor.name)}</span>`
      : `<a href="${esc(monitor.url)}" target="_blank" rel="noopener">${esc(monitor.name)}</a>`
  const descHtml = monitor.description
    ? `<span class="tooltip" tabindex="0">${INFO}<span class="tip">${esc(monitor.description)}</span></span>`
    : ''

  return (
    `<div class="card" data-monitor="${esc(monitor.id)}">` +
    `<div class="monitor-head"><div class="monitor-name">${descHtml}${nameHtml}</div>` +
    `${statusPill(data)}</div>` +
    `${latencyChart(monitor, data, ci)}` +
    `<div class="hist-legend"><span>${CONFIG.settings.daysInHistogram} days ago</span><span>Today</span></div>` +
    `</div>`
  )
}

function renderStatusHeader() {
  const s = CONFIG.settings
  const lu = STATE.lastUpdate || {}
  const ok = !!lu.allOperational
  const cls = ok ? 'banner-green' : 'banner-yellow'
  const text = ok ? s.allmonitorsOperational : s.notAllmonitorsOperational

  let meta = ''
  if (lu.time) {
    const secs = Math.max(0, Math.round((Date.now() - lu.time) / 1000))
    const loc = LOCATIONS[lu.loc] || lu.loc || ''
    meta = `<span class="meta">checked ${secs} sec ago${loc ? ` (from ${esc(loc)})` : ''}</span>`
  }
  $('#statusHeader').innerHTML =
    `<div class="card status-banner ${cls}"><div class="row"><span>${esc(text)}</span>${meta}</div></div>`
}

function renderMonitors() {
  const term = FILTER.trim().toLowerCase()
  const list = CONFIG.monitors.filter((m) =>
    !term || m.name.toLowerCase().includes(term),
  )
  CHARTS = []
  $('#monitors').innerHTML = list.length
    ? list.map((m, i) => monitorCard(m, STATE.monitors[m.id], i)).join('')
    : `<div class="empty">No monitors match "${esc(FILTER)}".</div>`
  bindCharts()
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
  setInterval(refreshState, 30000)
}

init().catch((e) => {
  $('#monitors').innerHTML =
    `<div class="empty">Failed to load status page: ${esc(e.message)}</div>`
})
