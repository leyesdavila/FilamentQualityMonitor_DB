/* ================================================================
   FilaPrint — app.js (versión productiva con mini gráficos)
   Frontend: dashboard, lotes, reportes, configuración, lightbox con Chart.js.
   Cada lote muestra una vista previa de su gráfica en la tarjeta.
   ================================================================ */

// ── Configuración de conexión ────────────────────────────────────
const API_BASE = 'http://localhost:5000/api';

// ── Límites de advertencia (por defecto) ─────────────────────────
const DEFAULT_LIMIT_LOW  = 1.723;
const DEFAULT_LIMIT_HIGH = 1.777;

// ── Estado global ────────────────────────────────────────────────
const App = {
  lotes:       [],
  currentView: 'dashboard',
  lbIndex:     0,
  lbPool:      [],
  limits: {
    low:  DEFAULT_LIMIT_LOW,
    high: DEFAULT_LIMIT_HIGH,
  },
  lbChart: null,
  // Mapa para referenciar mini gráficos activos
  miniCharts: new Map(),
};

// ── Carga de límites desde BD o localStorage ──────────────────────
async function loadLimits() {
  try {
    const res = await fetch(`${API_BASE}/caracteristicas`);
    if (res.ok) {
      const data = await res.json();
      App.limits.low = data.lowerlimit;
      App.limits.high = data.upperlimit;
      return;
    }
  } catch (err) {
    console.warn('[Limits] No se pudo cargar de la BD, usando localStorage');
  }
  const lo = parseFloat(localStorage.getItem('filaprint-limit-low'));
  const hi = parseFloat(localStorage.getItem('filaprint-limit-high'));
  if (!isNaN(lo)) App.limits.low = lo;
  if (!isNaN(hi)) App.limits.high = hi;
}

function saveLimits() {
  localStorage.setItem('filaprint-limit-low',  App.limits.low);
  localStorage.setItem('filaprint-limit-high', App.limits.high);
  saveLimitsToBackend();
}

async function saveLimitsToBackend() {
  try {
    await fetch(`${API_BASE}/caracteristicas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lowerlimit: App.limits.low, upperlimit: App.limits.high })
    });
  } catch (err) {
    console.error('[Limits] Error al guardar en BD:', err);
  }
}

// ── Clasificación de estado ─────────────────────────────────────
function calcEstado(media, limLow, limHigh) {
  const rango  = limHigh - limLow;
  const margen = rango * 0.5;
  if (media >= limLow && media <= limHigh) return 'ok';
  if (media >= limLow - margen && media <= limHigh + margen) return 'warn';
  return 'alert';
}

// ── API ────────────────────────────────────────────────────────
async function fetchLotes(desde, hasta) {
  try {
    const params = new URLSearchParams({ desde, hasta });
    const res = await fetch(`${API_BASE}/lotes?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showConnectionBadge(true);
    return data.lotes || [];
  } catch (err) {
    console.error('[API] Error al obtener lotes:', err);
    showConnectionBadge(false);
    return [];
  }
}

async function fetchLoteData(lote_id) {
  try {
    const res = await fetch(`${API_BASE}/lotes/${lote_id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[API] Error al obtener datos del lote:', err);
    return { tiempos: [], mm: [] };
  }
}

async function pingBackend() {
  try {
    const res = await fetch(`${API_BASE}/status`, { signal: AbortSignal.timeout(3000) });
    showConnectionBadge(res.ok);
  } catch {
    showConnectionBadge(false);
  }
}

function showConnectionBadge(online) {
  const badge = document.getElementById('cfgBadge');
  if (badge) {
    badge.className   = `cfg-badge ${online ? 'online' : 'offline'}`;
    badge.textContent = online ? 'Conectado' : 'Sin conexión';
  }
  const pillText = document.getElementById('dbPillText');
  const pulseDot = document.getElementById('pulseDot');
  if (pillText) pillText.textContent = online ? 'Sistema activo' : 'Sin conexión';
  if (pulseDot) pulseDot.style.background = online ? 'var(--green)' : 'var(--red)';
}

// ── Razones de alerta ──────────────────────────────────────────
const RAZONES = [
  'Media fuera del rango nominal',
  'Valor mínimo por debajo del límite inferior',
  'Valor máximo excede límite superior',
  'Desviación estándar > 2σ',
  'Pico anómalo detectado',
];

// ── Re-clasificar lotes ────────────────────────────────────────
function reclasificarLotes() {
  const lo = App.limits.low;
  const hi = App.limits.high;
  App.lotes.forEach(l => {
    l.estado = calcEstado(l.metricas.media, lo, hi);
    l.razon  = l.estado !== 'ok' ? (l.razon || RAZONES[0]) : null;
  });
  updateKPIs();
}

// ── Helpers ───────────────────────────────────────────────────────
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function hoyLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtFecha(iso) {
  const [y, m, d] = iso.split('-');
  return `${parseInt(d)} ${MESES[parseInt(m)-1]} ${y}`;
}
function esHoy(iso) { return iso === hoyLocalISO(); }
function agruparPorDia(lotes) {
  return lotes.reduce((acc, l) => { (acc[l.fecha] = acc[l.fecha] || []).push(l); return acc; }, {});
}

// ── KPIs ──────────────────────────────────────────────────────────
function updateKPIs() {
  const lotes  = App.lotes;
  const ok     = lotes.filter(l => l.estado === 'ok').length;
  const alerts = lotes.filter(l => l.estado !== 'ok').length;
  const hoyISO = hoyLocalISO();
  const hoy    = lotes.filter(l => l.fecha === hoyISO).length;
  document.getElementById('kpiTotal').textContent = lotes.length;
  document.getElementById('kpiHoy').textContent   = hoy;
  document.getElementById('kpiOk').textContent    = ok;
  document.getElementById('kpiAlert').textContent = alerts;
}

// ── Badge HTML ────────────────────────────────────────────────────
function badgeHtml(estado) {
  const map = { ok: ['OK','ok'], warn: ['ALERTA','warn'], alert: ['ERROR','alert'] };
  const [txt, cls] = map[estado] || ['?','ok'];
  return `<span class="lote-badge badge-${cls}">${txt}</span>`;
}

// ── Mini gráfico en tarjeta ─────────────────────────────────────
async function initMiniChart(lote, canvas) {
  // Si ya tenemos los datos en caché, usarlos; si no, cargarlos
  if (!lote._tiempos || !lote._mm) {
    const data = await fetchLoteData(lote.id);
    lote._tiempos = data.tiempos;
    lote._mm = data.mm;
  }

  // Si no hay datos, dibujar un placeholder sencillo
  if (!lote._tiempos || !lote._mm || lote._tiempos.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim() || '#3d4560';
    ctx.font = '10px "IBM Plex Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('sin datos', canvas.width/2, canvas.height/2);
    return;
  }

  // Conversión de tiempos a segundos relativos
  const timesInSeconds = lote._tiempos.map(t => {
    const timePart = t.includes(' ') ? t.split(' ')[1] : t;
    const [h, m, s] = timePart.split(':').map(Number);
    return h * 3600 + m * 60 + s;
  });
  const startTime = timesInSeconds[0];
  const relativeSeconds = timesInSeconds.map(s => s - startTime);
  const mmValues = lote._mm.map(v => Number(v));

  // Destruir gráfico anterior si existe
  const existingChart = App.miniCharts.get(lote.id);
  if (existingChart) existingChart.destroy();

  const ctx = canvas.getContext('2d');
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f8ef7';

  const miniChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: relativeSeconds,
      datasets: [{
        data: mmValues,
        borderColor: accentColor,
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 1.2,
        tension: 0.1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { display: false },
        y: { display: false }
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      }
    }
  });

  App.miniCharts.set(lote.id, miniChart);
}

// ── Tarjeta HTML (ahora con canvas para mini gráfico) ────────────
function loteCardHtml(lote, idx) {
  const lo = App.limits.low;
  const hi = App.limits.high;
  const mediaVal  = lote.metricas.media;
  const mediaOk   = mediaVal >= lo && mediaVal <= hi;
  const mediaCls  = mediaOk ? 'v-ok' : (lote.estado === 'warn' ? 'v-warn' : 'v-alert');

  return `
    <div class="lote-card st-${lote.estado}" data-id="${lote.id}" data-idx="${idx}" style="animation-delay:${idx * .04}s">
      <div class="lote-status-bar"></div>
      <div class="lote-img-wrap">
        <canvas class="lote-mini-canvas" data-lote-id="${lote.id}"></canvas>
        ${badgeHtml(lote.estado)}
      </div>
      <div class="lote-body">
        <div class="lote-id">${lote.id}</div>
        <div class="lote-ts">${fmtFecha(lote.fecha)} · ${lote.hora}</div>
        <div class="lote-metrics">
          <div class="lm"><div class="lm-l">Media</div><div class="lm-v ${mediaCls}">${mediaVal}</div></div>
          <div class="lm"><div class="lm-l">Desv.</div><div class="lm-v">${lote.metricas.desv}</div></div>
          <div class="lm"><div class="lm-l">Mín/Máx</div><div class="lm-v">${lote.metricas.min}/${lote.metricas.max}</div></div>
          <div class="lm"><div class="lm-l">N datos</div><div class="lm-v">${lote.metricas.n}</div></div>
        </div>
      </div>
    </div>`;
}

// ── DASHBOARD render ──────────────────────────────────────────────
function renderDashboard() {
  const wrap  = document.getElementById('daysWrap');
  const sub   = document.getElementById('dashSub');
  const lotes = App.lotes;

  sub.textContent = `${lotes.length} lotes · ${Object.keys(agruparPorDia(lotes)).length} días`;

  if (lotes.length === 0) {
    wrap.innerHTML = '<div class="loading-msg">No hay lotes para mostrar.</div>';
    return;
  }

  App.miniCharts.forEach(chart => chart.destroy());
  App.miniCharts.clear();

  const porDia = agruparPorDia(lotes);
  const dias   = Object.keys(porDia).sort((a,b) => b.localeCompare(a));
  let globalIdx = 0, html = '';

  dias.forEach(dia => {
    const dl  = porDia[dia];
    const tag = esHoy(dia) ? `Hoy · ${fmtFecha(dia)}` : fmtFecha(dia);
    html += `
      <div class="day-group">
        <div class="day-header">
          <span class="day-tag">${tag}</span>
          <span class="day-count-tag">${dl.length} lote${dl.length !== 1 ? 's' : ''}</span>
          <div class="day-hr"></div>
        </div>
        <div class="day-cards">
          ${dl.map(l => loteCardHtml(l, globalIdx++)).join('')}
        </div>
      </div>`;
  });

  wrap.innerHTML = html;

  // Inicializar mini gráficos
  const canvases = wrap.querySelectorAll('.lote-mini-canvas');
  canvases.forEach(canvas => {
    const loteId = canvas.dataset.loteId;
    const lote = lotes.find(l => l.id === loteId);
    if (lote) {
      initMiniChart(lote, canvas);
    }
  });

  attachCardClicks(wrap, lotes);
}

// ── LOTES view render ─────────────────────────────────────────────
function renderLotes() {
  const grid   = document.getElementById('lotesGrid');
  const sort   = document.getElementById('lotesSort').value;
  const search = document.getElementById('lotesSearch').value.toLowerCase();

  let lotes = [...App.lotes];
  if (search) lotes = lotes.filter(l => l.id.toLowerCase().includes(search) || l.fecha.includes(search));

  if (sort === 'desc')              lotes.sort((a,b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora));
  else if (sort === 'asc')          lotes.sort((a,b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
  else if (sort === 'estado-alert') lotes.sort((a,b) => { const o = {alert:0,warn:1,ok:2}; return o[a.estado]-o[b.estado]; });
  else if (sort === 'estado-ok')    lotes.sort((a,b) => { const o = {ok:0,warn:1,alert:2}; return o[a.estado]-o[b.estado]; });

  if (lotes.length === 0) { grid.innerHTML = '<div class="loading-msg">Sin resultados.</div>'; return; }

  App.miniCharts.forEach(chart => chart.destroy());
  App.miniCharts.clear();

  grid.innerHTML = lotes.map((l, i) => loteCardHtml(l, i)).join('');

  // Inicializar mini gráficos
  const canvases = grid.querySelectorAll('.lote-mini-canvas');
  canvases.forEach(canvas => {
    const loteId = canvas.dataset.loteId;
    const lote = lotes.find(l => l.id === loteId);
    if (lote) {
      initMiniChart(lote, canvas);
    }
  });
  
  attachCardClicks(grid, lotes);
}

// ── REPORTES render ───────────────────────────────────────────────
function renderReportes() {
  const body    = document.getElementById('repBody');
  const sub     = document.getElementById('reportSub');
  const alertas = App.lotes.filter(l => l.estado !== 'ok');
  const lo      = App.limits.low;
  const hi      = App.limits.high;

  sub.textContent = `${alertas.length} lote${alertas.length !== 1 ? 's' : ''} con problemas · Límites: [${lo} – ${hi}]`;

  if (alertas.length === 0) {
    body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text3);font-family:var(--mono);">✓ Sin alertas en el rango seleccionado</td></tr>`;
    return;
  }

  body.innerHTML = alertas.map(l => {
    const badgeCls = l.estado === 'alert' ? 'rb-alert' : 'rb-warn';
    const badgeTxt = l.estado === 'alert' ? 'Error'    : 'Alerta';
    const mediaCls = l.estado === 'alert' ? 'td-red'   : 'td-amber';
    const desvioCls = Math.abs(l.metricas.media - (lo + hi) / 2) > (hi - lo) ? 'td-amber' : '';
    return `
      <tr>
        <td class="td-id">${l.id}</td>
        <td>${fmtFecha(l.fecha)}</td>
        <td>${l.hora}</td>
        <td class="${mediaCls}">${l.metricas.media}</td>
        <td class="${desvioCls}">${l.metricas.desv}</td>
        <td>${l.metricas.min} / ${l.metricas.max}</td>
        <td class="${mediaCls}">${lo} – ${hi}</td>
        <td><span class="rep-badge ${badgeCls}">${badgeTxt}</span></td>
        <td class="td-razon">${l.razon || '—'}</td>
      </tr>`;
  }).join('');
}

// ── Gráfico grande en lightbox ──────────────────────────────────
function renderLbChart(lote) {
  const canvas = document.getElementById('lbChartCanvas');
  const container = document.getElementById('lbChartContainer');

  if (App.lbChart) {
    App.lbChart.destroy();
    App.lbChart = null;
  }

  if (!lote._tiempos || !lote._mm || lote._tiempos.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  // Convertir tiempos a segundos desde la medianoche (hora real)
  const timesInSeconds = lote._tiempos.map(t => {
    const timePart = t.includes(' ') ? t.split(' ')[1] : t;
    const [h, m, s] = timePart.split(':').map(Number);
    return h * 3600 + m * 60 + s;
  });

  // Valores mm ya son numéricos
  const mmValues = lote._mm.map(v => Number(v));
  const lo = App.limits.low;
  const hi = App.limits.high;

  const ctx = canvas.getContext('2d');
  App.lbChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: timesInSeconds,              // ahora son absolutos
      datasets: [{
        label: 'Medida (mm)',
        data: mmValues,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f8ef7',
        backgroundColor: 'transparent',
        pointRadius: 1.5,
        pointHoverRadius: 5,
        tension: 0.1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          title: { 
            display: true,
            text: 'Hora del día',                                // título más descriptivo
            color: getComputedStyle(document.documentElement).getPropertyValue('--text2').trim() 
          },
          ticks: {
            callback: function(value) {
              const h = Math.floor(value / 3600);
              const m = Math.floor((value % 3600) / 60);
              const s = value % 60;
              return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            },
            color: getComputedStyle(document.documentElement).getPropertyValue('--text2').trim(),
          }
        },
        y: {
          title: { 
            display: true,
            text: 'mm',
            color: getComputedStyle(document.documentElement).getPropertyValue('--text2').trim() 
          },
          ticks: { 
            color: getComputedStyle(document.documentElement).getPropertyValue('--text2').trim() 
          }
        }
      },
      plugins: {
        annotation: {
          annotations: {
            lowLine: {
              type: 'line', yMin: lo, yMax: lo,
              borderColor: '#f87171', borderWidth: 2, borderDash: [5,5],
              label: { display: true, content: 'LCL ' + lo.toFixed(3), position: 'end', backgroundColor: 'rgba(248,113,113,0.8)', color: '#fff', font: { size: 10 } }
            },
            highLine: {
              type: 'line', yMin: hi, yMax: hi,
              borderColor: '#f87171', borderWidth: 2, borderDash: [5,5],
              label: { display: true, content: 'UCL ' + hi.toFixed(3), position: 'end', backgroundColor: 'rgba(248,113,113,0.8)', color: '#fff', font: { size: 10 } }
            }
          }
        },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `mm: ${ctx.parsed.y.toFixed(3)}`,
            title: items => {
              const sec = items[0].parsed.x;
              const h = Math.floor(sec / 3600);
              const m = Math.floor((sec % 3600) / 60);
              const s = sec % 60;
              return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }
          }
        }
      }
    }
  });
}

// ── Card click → lightbox ────────────────────────────────────────
async function attachCardClicks(container, lotes) {
  container.querySelectorAll('.lote-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      const id   = card.dataset.id;
      const lote = lotes.find(l => l.id === id);
      if (!lote) return;
      App.lbPool  = lotes;
      App.lbIndex = lotes.indexOf(lote);
      
      if (!lote._tiempos || !lote._mm) {
        const loteData = await fetchLoteData(id);
        lote._tiempos = loteData.tiempos;
        lote._mm = loteData.mm;
      }
      
      openLightbox(lote);
    });
  });
}

// ── Lightbox con gráfico grande ──────────────────────────────────
function openLightbox(lote) {
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lbImg');
  const cap = document.getElementById('lbCaption');

  // Ocultar imagen (ya no se usa)
  img.style.display = 'none';

  const estadoTxt = { ok: '✓ Verificado', warn: '⚠ Alerta', alert: '✕ Error' }[lote.estado] || '';
  cap.innerHTML = `<strong>${lote.id}</strong> · ${fmtFecha(lote.fecha)} ${lote.hora}<br>
    Media: ${lote.metricas.media} · Desv: ${lote.metricas.desv} · N: ${lote.metricas.n} · ${estadoTxt}`;

  renderLbChart(lote);
  lb.classList.add('open');
}

function navigateLb(dir) {
  App.lbIndex = (App.lbIndex + dir + App.lbPool.length) % App.lbPool.length;
  const lote = App.lbPool[App.lbIndex];
  if (!lote._tiempos || !lote._mm) {
    fetchLoteData(lote.id).then(data => {
      lote._tiempos = data.tiempos;
      lote._mm = data.mm;
      openLightbox(lote);
    });
  } else {
    openLightbox(lote);
  }
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  if (App.lbChart) {
    App.lbChart.destroy();
    App.lbChart = null;
  }
  const container = document.getElementById('lbChartContainer');
  if (container) container.style.display = 'none';
}

// ── Sidebar navigation ──────────────────────────────────────────
function switchView(view) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  App.currentView = view;

  const titles = { dashboard: 'Panel', lotes: 'Lotes', reportes: 'Reportes', configuracion: 'Configuración' };
  document.getElementById('topbarTitle').textContent = titles[view] || view;

  const showDates = ['dashboard','lotes'].includes(view);
  document.getElementById('dateRow').style.display = showDates ? 'flex' : 'none';

  if (view === 'dashboard')    renderDashboard();
  if (view === 'lotes')        renderLotes();
  if (view === 'reportes')     renderReportes();
}

// ── Theme ────────────────────────────────────────────────────────
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('tDark').classList.toggle('active',  t === 'dark');
  document.getElementById('tLight').classList.toggle('active', t === 'light');
  localStorage.setItem('filaprint-theme', t);
}

// ── Reloj con fecha ──────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('sidebarClock');
  if (!el) return;
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  const hora  = ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.textContent = `${fecha} · ${hora}`;
}

// ── Date picker personalizado ───────────────────────────────────
const MESES_PICKER = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function buildDatePicker(containerId, dateObj) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const selDay = document.createElement('select'); selDay.className = 'dp-day';
  const selMon = document.createElement('select'); selMon.className = 'dp-month';
  const selYr  = document.createElement('select'); selYr.className  = 'dp-year';

  for (let d = 1; d <= 31; d++) {
    const o = document.createElement('option');
    o.value = String(d).padStart(2,'0'); o.textContent = String(d).padStart(2,'0');
    if (d === dateObj.getDate()) o.selected = true;
    selDay.appendChild(o);
  }
  MESES_PICKER.forEach((m, i) => {
    const o = document.createElement('option');
    o.value = String(i+1).padStart(2,'0'); o.textContent = m;
    if (i === dateObj.getMonth()) o.selected = true;
    selMon.appendChild(o);
  });
  const curYear = dateObj.getFullYear();
  for (let y = curYear - 3; y <= curYear; y++) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === curYear) o.selected = true;
    selYr.appendChild(o);
  }
  const s1 = document.createElement('span'); s1.className = 'dp-sep'; s1.textContent = '/';
  const s2 = document.createElement('span'); s2.className = 'dp-sep'; s2.textContent = '/';
  container.innerHTML = '';
  container.append(selDay, s1, selMon, s2, selYr);
}

function getPickerValue(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return '';
  const d = c.querySelector('.dp-day').value;
  const m = c.querySelector('.dp-month').value;
  const y = c.querySelector('.dp-year').value;
  return `${y}-${m}-${d}`;
}

function setDefaultDates() {
  const hoy   = new Date();
  const hace7 = new Date(); hace7.setDate(hoy.getDate() - 6);
  buildDatePicker('datePickerFrom', hace7);
  buildDatePicker('datePickerTo',   hoy);
}

// ── Recargar datos ────────────────────────────────────────────────
async function reloadData() {
  const desde  = getPickerValue('datePickerFrom');
  const hasta  = getPickerValue('datePickerTo');
  App.lotes    = await fetchLotes(desde, hasta);
  updateKPIs();
  if (App.currentView === 'dashboard') renderDashboard();
  if (App.currentView === 'lotes')     renderLotes();
  if (App.currentView === 'reportes')  renderReportes();
}

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  await loadLimits();

  const savedTheme = localStorage.getItem('filaprint-theme') || 'dark';
  applyTheme(savedTheme);

  setDefaultDates();
  updateClock();
  setInterval(updateClock, 1000);

  document.getElementById('cfgLimitLow').value = App.limits.low;
  document.getElementById('cfgLimitHigh').value = App.limits.high;

  // Cargar lotes iniciales
  const desde = getPickerValue('datePickerFrom');
  const hasta = getPickerValue('datePickerTo');
  App.lotes = await fetchLotes(desde, hasta);
  updateKPIs();
  renderDashboard();
  pingBackend();

  // ── Eventos ──────────────────────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('sidebarCollapseBtn').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('filaprint-sidebar', sb.classList.contains('collapsed') ? 'collapsed' : 'open');
  });
  if (localStorage.getItem('filaprint-sidebar') === 'collapsed') {
    document.getElementById('sidebar').classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
  }

  document.getElementById('btnFilter').addEventListener('click', reloadData);
  document.getElementById('btnRefresh').addEventListener('click', async () => {
    const btn = document.getElementById('btnRefresh');
    btn.style.opacity = '.4';
    await reloadData();
    setTimeout(() => btn.style.opacity = '1', 600);
  });

  document.getElementById('lotesSearch').addEventListener('input', renderLotes);
  document.getElementById('lotesSort').addEventListener('change', renderLotes);

  document.querySelectorAll('.vt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('lotesGrid').dataset.vt = btn.dataset.vt;
    });
  });

  // Lightbox
  document.getElementById('lbClose').addEventListener('click', closeLightbox);
  document.getElementById('lbBackdrop').addEventListener('click', closeLightbox);
  document.getElementById('lbPrev').addEventListener('click', () => navigateLb(-1));
  document.getElementById('lbNext').addEventListener('click', () => navigateLb(+1));
  document.addEventListener('keydown', e => {
    if (!document.getElementById('lightbox').classList.contains('open')) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   navigateLb(-1);
    if (e.key === 'ArrowRight')  navigateLb(+1);
  });

  // Configuración
  document.getElementById('tDark').addEventListener('click',  () => applyTheme('dark'));
  document.getElementById('tLight').addEventListener('click', () => applyTheme('light'));

  const btnSaveLimits = document.getElementById('btnSaveLimits');
  if (btnSaveLimits) {
    btnSaveLimits.addEventListener('click', () => {
      const lo = parseFloat(document.getElementById('cfgLimitLow').value);
      const hi = parseFloat(document.getElementById('cfgLimitHigh').value);
      if (isNaN(lo) || isNaN(hi) || lo >= hi) {
        alert('Límites inválidos: el valor inferior debe ser menor que el superior.');
        return;
      }
      App.limits.low  = lo;
      App.limits.high = hi;
      saveLimits();
      reclasificarLotes();
      if (App.currentView === 'dashboard') renderDashboard();
      if (App.currentView === 'lotes')     renderLotes();
      if (App.currentView === 'reportes')  renderReportes();
      btnSaveLimits.textContent = '✓ Guardado';
      btnSaveLimits.style.background = 'var(--green-bg)';
      btnSaveLimits.style.color      = 'var(--green)';
      setTimeout(() => {
        btnSaveLimits.textContent      = 'Aplicar límites';
        btnSaveLimits.style.background = '';
        btnSaveLimits.style.color      = '';
      }, 2000);
    });
  }

  const cfgEndpoint = document.getElementById('cfgEndpoint');
  if (cfgEndpoint) {
    cfgEndpoint.value = API_BASE;
    cfgEndpoint.addEventListener('change', () => {
      console.log('[Config] Endpoint actualizado (requiere recarga para aplicar):', cfgEndpoint.value);
    });
  }

  // ── LIMPIAR BASE DE DATOS ──────────────────────────────────────
  const btnClearDB = document.getElementById('btnClearDB');
  if (btnClearDB) {
    btnClearDB.addEventListener('click', async () => {
      if (!confirm('¿Está seguro de eliminar TODOS los lotes y mediciones? Esta acción no se puede deshacer.')) return;
      try {
        const res = await fetch(`${API_BASE}/diametro`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al limpiar');
        await reloadData();
      } catch (err) {
        alert('No se pudo limpiar la base de datos.');
        console.error(err);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', init);