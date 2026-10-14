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

function histogram(monitor, data) {
  const s = CONFIG.settings
  const n = s.daysInHistogram
  const start = new Date()
  start.setDate(start.getDate() - n)

  let bars = ''
  for (let i = 0; i < n; i++) {
    start.setDate(start.getDate() + 1)
    const day = dayStr(start)

    let cls = 'bar-empty'
    let label = s.dayInHistogramNoData
    let avgs = ''
    if (data && data.firstCheck <= day) {
      const entry = data.checks && data.checks[day]
      if (entry && entry.fails > 0) {
        cls = 'bar-yellow'
        label = `${entry.fails} ${s.dayInHistogramNotOperational}`
      } else {
        cls = 'bar-green'
        label = s.dayInHistogramOperational
      }
      if (entry && entry.res) {
        avgs = Object.keys(entry.res)
          .map(
            (loc) =>
              `<span class="tip-avg">${esc(LOCATIONS[loc] || loc)}: ${entry.res[loc].a}ms</span>`,
          )
          .join('')
      }
    }

    bars +=
      `<div class="hitbox tooltip"><div class="bar ${cls}"></div>` +
      `<div class="tip"><span class="tip-date">${day}</span>` +
      `<span class="tip-label">${esc(label)}</span>${avgs}</div></div>`
  }
  return `<div class="histogram">${bars}</div>`
}

function monitorCard(monitor, data) {
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
    `${histogram(monitor, data)}` +
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
  $('#monitors').innerHTML = list.length
    ? list.map((m) => monitorCard(m, STATE.monitors[m.id])).join('')
    : `<div class="empty">No monitors match "${esc(FILTER)}".</div>`
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
