/* ============================================
   Pelichet QC — app.js (resize + loader + XHR)
   ============================================ */

/* ---------- Config globale sans redéclaration ---------- */
(function ensureConfig(){
  window.CONFIG = window.CONFIG || {};
  if (typeof window.CONFIG.WEBAPP_BASE_URL !== 'string') window.CONFIG.WEBAPP_BASE_URL = '';

  // Options de redimensionnement (par défaut désactivé = pas de compression)
  if (typeof window.CONFIG.RESIZE_ENABLED !== 'boolean') window.CONFIG.RESIZE_ENABLED = false;
  if (typeof window.CONFIG.MAX_IMAGE_DIM !== 'number') window.CONFIG.MAX_IMAGE_DIM = 1600; // plus grand côté
  if (typeof window.CONFIG.OUTPUT_MIME !== 'string') window.CONFIG.OUTPUT_MIME = 'image/jpeg'; // 'image/jpeg' | 'image/png'
  if (typeof window.CONFIG.QUALITY !== 'number') window.CONFIG.QUALITY = 0.85; // JPEG: 0..1

  // Charger config.json une seule fois
  if (!window.CONFIG.__loadedFromJson__) {
    fetch('config.json')
      .then(r=>r.ok?r.json():{})
      .then(c=>{
        Object.assign(window.CONFIG, c || {});
        window.CONFIG.__loadedFromJson__ = true;
      })
      .catch(()=>{});
  }
})();

/* ---------- Helpers DOM ---------- */
function qs(s, r=document){ return r.querySelector(s); }
function qsa(s, r=document){ return Array.from(r.querySelectorAll(s)); }

/* ---------- Loader overlay (avec progression) ---------- */
function showLoader(text='Traitement en cours…'){
  const el = document.getElementById('appLoader');
  if (!el) return;
  const textEl = el.querySelector('.loader-text');
  if (textEl) textEl.textContent = text;
  const bar = el.querySelector('.loader-bar');
  const pct = el.querySelector('.loader-percent');
  if (bar) bar.style.width = '0%';
  if (pct) pct.textContent = '0%';
  el.classList.add('visible');
}
function hideLoader(){
  const el = document.getElementById('appLoader');
  if (!el) return;
  el.classList.remove('visible');
}
function setLoaderProgress(loaded, total){
  const el = document.getElementById('appLoader');
  if (!el || !total || total<=0) return;
  const p = Math.min(100, Math.round(loaded*100/total));
  const bar = el.querySelector('.loader-bar');
  const pct = el.querySelector('.loader-percent');
  if (bar) bar.style.width = p + '%';
  if (pct) pct.textContent = p + '%';
}

/* ---------- Onglets ---------- */
function initTabs(){
  const headerTabs = document.querySelectorAll('.app-header .tab');
  const panes = document.querySelectorAll('.tab-pane');
  headerTabs.forEach(btn=>{
    btn.addEventListener('click',()=>{
      headerTabs.forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      const t = btn.dataset.tab;
      panes.forEach(p=>p.classList.remove('active'));
      const pane = document.getElementById('tab-'+t);
      if (pane) pane.classList.add('active');
      window.scrollTo({top:0, behavior:'smooth'});
    });
  });
}

/* ---------- Thème clair/sombre ---------- */
function initThemeToggle(){
  const toggle = document.getElementById('toggleTheme');
  if (!toggle) return;
  let theme = localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  setThemeColorMeta(theme);
  toggle.addEventListener('click', ()=>{
    theme = (theme==='dark')?'light':'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    setThemeColorMeta(theme);
  });
}
function setThemeColorMeta(theme){
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme==='dark' ? '#0f1115' : '#FF6A00');
}

/* ---------- Service Worker ---------- */
function initServiceWorker(){
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  }
}

/* ---------- Décodage code-barres (photo) ---------- */
async function decodeFileToBarcode(file){
  // 1) Natif
  if ('BarcodeDetector' in window) {
    try{
      const bd = new window.BarcodeDetector({ formats: ['ean_13','code_128','code_39'] });
      const img = await fileToImage(file);
      const el  = await imageElementScaled(img, 800);
      const c = document.createElement('canvas');
      c.width  = el.naturalWidth || el.width;
      c.height = el.naturalHeight || el.height;
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (blob) {
        const bmp = await createImageBitmap(blob);
        const codes = await bd.detect(bmp);
        if (codes && codes[0] && codes[0].rawValue) return String(codes[0].rawValue);
      }
    } catch(_){}
  }
  // 2) ZXing
  const img = await fileToImage(file);
  const el  = await imageElementScaled(img, 800);
  const reader = new ZXingBrowser.BrowserMultiFormatReader();
  const hints = new Map();
  hints.set(ZXingBrowser.DecodeHintType.POSSIBLE_FORMATS, [
    ZXingBrowser.BarcodeFormat.EAN_13,
    ZXingBrowser.BarcodeFormat.CODE_128,
    ZXingBrowser.BarcodeFormat.CODE_39
  ]);
  reader.setHints(hints);
  try{
    const res = await reader.decodeFromImage(el);
    return res ? res.getText() : '';
  }catch{
    return '';
  }
}

/* ---------- Helpers Image / Resize ---------- */
function fileToImage(file){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    const fr = new FileReader();
    fr.onload = ()=> img.src = fr.result;
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
function imageElementScaled(img, minWidth=800){
  return new Promise(resolve=>{
    const baseW = img.naturalWidth || img.width || minWidth;
    const baseH = img.naturalHeight || img.height || minWidth;
    const scale = Math.max(1, Math.ceil(minWidth / Math.max(1, baseW)));
    const w = baseW * scale, h = baseH * scale;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const out = new Image();
    out.onload = ()=> resolve(out);
    out.src = c.toDataURL('image/png');
  });
}

/* Redimensionner un File → dataURL + ext (selon CONFIG) */
async function resizeFileIfNeeded(file){
  // Si désactivé: renvoie le dataURL d’origine (pas de compression intentionnelle)
  const dataUrl = await new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>resolve(fr.result);
    fr.onerror=reject;
    fr.readAsDataURL(file);
  });

  if (!window.CONFIG.RESIZE_ENABLED) {
    const ext = (file.name.split('.').pop()||'').toLowerCase();
    return { dataUrl, ext };
  }

  // Sinon: resize côté client
  return await resizeDataUrl(
    dataUrl,
    window.CONFIG.MAX_IMAGE_DIM,
    window.CONFIG.OUTPUT_MIME,
    window.CONFIG.QUALITY
  );
}

/* Redimensionne un dataURL → dataURL */
/* Redimensionne un dataURL → dataURL avec limite de taille */
async function resizeDataUrl(srcDataUrl, maxDim=1600, outMime='image/jpeg', quality=0.85){
  const img = await new Promise((resolve,reject)=>{
    const im = new Image();
    im.onload = ()=> resolve(im);
    im.onerror = reject;
    im.src = srcDataUrl;
  });

  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) return { dataUrl: srcDataUrl, ext: guessExtFromMime(outMime) };

  // Calcul des dimensions finales
  const ratio = w0 / h0;
  let w = w0, h = h0;
  if (Math.max(w0, h0) > maxDim) {
    if (w0 >= h0) { w = maxDim; h = Math.round(maxDim / ratio); }
    else { h = maxDim; w = Math.round(maxDim * ratio); }
  }

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  // Compression adaptative
  let q = quality;
  const maxBytes = (window.CONFIG.MAX_FILE_SIZE_KB || 600) * 1024;
  let dataUrl = c.toDataURL(outMime, q);
  let size = Math.round((dataUrl.length * 3) / 4); // est. bytes base64
  let tries = 0;

  while (size > maxBytes && q > 0.2 && tries < 6) {
    q -= 0.1;
    dataUrl = c.toDataURL(outMime, q);
    size = Math.round((dataUrl.length * 3) / 4);
    tries++;
  }

  console.log(`→ Redimensionné à ${Math.round(size/1024)} Ko (qualité=${q.toFixed(2)})`);
  return { dataUrl, ext: guessExtFromMime(outMime) };
}

function guessExtFromMime(m){ return m==='image/png'?'png':'jpg'; }

/* ---------- Boutons "Décoder" ---------- */
function initDecodeButtons(){
  qsa('button[data-action="decode"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const input = qs('#'+btn.dataset.target);
      const out   = qs('#'+btn.dataset.out);
      if (!input || !out) return;
      if (!input.files || !input.files[0]) { alert('Sélectionnez une photo contenant le code-barres.'); return; }
      out.value = 'Décodage en cours…';
      const txt = await decodeFileToBarcode(input.files[0]);
      out.value = txt || '';
      if (!txt) alert('Aucun code-barres détecté. Réessayez avec une photo plus nette/rapprochée.');
    });
  });
}

/* ---------- KO: affichage/masquage + init ---------- */
function initKoBlocks(){
  function refreshFor(container){
    qsa('.ko-extra', container).forEach(box=>{
      const name = box.getAttribute('data-for');
      const checked = qs(`input[name="${name}"]:checked`, container);
      box.style.display = (checked && checked.value === 'KO') ? 'block' : 'none';
    });
  }
  qsa('.okko input[type=radio]').forEach(r=>{
    r.addEventListener('change', ()=>{
      const container = r.closest('form') || document;
      refreshFor(container);
    });
  });
  qsa('form.qc-form').forEach(f=>refreshFor(f));
}

/* ---------- Hook Caméra/Galerie -> champ cible ---------- */
function hookCameraGalleryPair(btnCamId, camId, btnGalId, galId, targetId, labelId){
  const btnCam = qs('#'+btnCamId);
  const cam    = qs('#'+camId);
  const btnGal = qs('#'+btnGalId);
  const gal    = qs('#'+galId);
  const tgt    = qs('#'+targetId);
  const label  = qs('#'+labelId);

  function copyToTarget(src){
    if (!src.files || !src.files[0]) return;
    const dt = new DataTransfer();
    dt.items.add(src.files[0]);
    tgt.files = dt.files;
    if (label) label.textContent = src.files[0].name;
  }
  if (btnCam && cam) btnCam.addEventListener('click', ()=> cam.click());
  if (btnGal && gal) btnGal.addEventListener('click', ()=> gal.click());
  if (cam && tgt) cam.addEventListener('change', ()=> copyToTarget(cam));
  if (gal && tgt) gal.addEventListener('change', ()=> copyToTarget(gal));
}

/* ---------- Réseau : fetch timeout + fallback XHR avec progression ---------- */
function fetchWithTimeout(input, init={}, timeoutMs=30000){
  return new Promise((resolve, reject)=>{
    const ctrl = new AbortController();
    const id = setTimeout(()=>{ ctrl.abort(); reject(new Error('Timeout réseau')); }, timeoutMs);
    fetch(input, { ...init, signal: ctrl.signal, redirect: 'follow', mode: 'cors' })
      .then(r=>{ clearTimeout(id); resolve(r); })
      .catch(e=>{ clearTimeout(id); reject(e); });
  });
}
function postFormDataXHR(url, formData, onProgress){
  return new Promise((resolve, reject)=>{
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.responseType = 'json';
    xhr.onload = ()=> {
      let body = xhr.response;
      if (!body && typeof xhr.responseText === 'string') {
        try { body = JSON.parse(xhr.responseText); } catch { /* noop */ }
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error('HTTP ' + xhr.status));
    };
    xhr.onerror = ()=> reject(new Error('Erreur réseau (XHR)'));
    xhr.ontimeout = ()=> reject(new Error('Timeout (XHR)'));
    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e)=>{
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.send(formData);
  });
}
async function sendFormToBackend(fd){
  const baseUrl = window.CONFIG && window.CONFIG.WEBAPP_BASE_URL || '';
  if (!baseUrl) throw new Error('URL backend non configurée');

  // 1) Tentative via fetch
  try{
    const r = await fetchWithTimeout(baseUrl, { method: 'POST', body: fd }, 45000);
    let js = null;
    try { js = await r.json(); } 
    catch { const t = await r.text(); js = JSON.parse(t); }
    return js;
  }catch(_){
    // 2) Fallback XHR (Android friendly + progression)
    return await postFormDataXHR(baseUrl, fd, (loaded,total)=> setLoaderProgress(loaded,total));
  }
}

/* ---------- Envoi formulaires -> Apps Script ---------- */
function initForms(){
  qsa('.qc-form').forEach(form=>{
    form.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const type = form.dataset.type;
      const result = qs('.result', form); if (result) result.textContent='';

      const date = qs('input[name="date_jour"]', form).value;
      const codeBarres = qs('input[name="code_barres"]', form).value.trim();
      if (!date || !codeBarres) { alert('Date et code-barres requis.'); return; }

      showLoader('Envoi en cours…');

      try{
        // Photo principale
        const photoInput = qs('input[name="photo_principale"]', form);
        let photoMain = null;
        if (photoInput && photoInput.files && photoInput.files[0]) {
          photoMain = await resizeFileIfNeeded(photoInput.files[0]);
        }

        // Questions selon type
        const questionsMap = {
          Cartons: ['callage_papier','intercalaires_livres','ordre_colonnes','scotch','depoussierage'],
          Palettes_Avant: ['cartons_etat','intercalaires_cartons','ordre_cartons','cerclage','stabilite'],
          Palettes_Destination: ['cartons_etat','cerclage']
        };
        const questions = questionsMap[type] || [];

        const answers = [];
        for (const q of questions) {
          const val = (qs(`input[name="${q}"]:checked`, form) || {}).value;
          if (!val) { alert('Veuillez répondre à toutes les questions.'); hideLoader(); return; }

          let photo = null;      // compat backend (1ère photo)
          let photos = [];       // multiples
          let commentaire = '';

          if (val === 'KO') {
            const fileInput = qs(`input[data-photofor="${q}"]`, form);
            const ta = qs(`textarea[data-commentfor="${q}"]`, form);
            commentaire = (ta && ta.value.trim()) || '';

            if (!fileInput || !fileInput.files || fileInput.files.length===0 || !commentaire) {
              alert(`Pour "${q}", en KO il faut au moins 1 photo + un commentaire.`);
              hideLoader();
              return;
            }
            for (const f of fileInput.files) {
              const resized = await resizeFileIfNeeded(f);
              photos.push(resized);
            }
            if (photos.length>0) photo = photos[0];
          }
          answers.push({ field: q, value: val, photo, photos, commentaire });
        }

        const payload = { date_jour: date, type, code_barres: codeBarres, photo_principale: photoMain, answers };

        const fd = new FormData();
        fd.append('route', 'qc');
        fd.append('type', type);
        fd.append('payload', JSON.stringify(payload));

        const js = await sendFormToBackend(fd);
        if (!js || !js.ok) throw new Error((js && js.error) || 'Erreur serveur');

        if (result) result.textContent = '✅ Enregistrement réussi';
        form.reset();
        initKoBlocks(); // referme les blocs KO
      }catch(err){
        if (result) result.textContent = '❌ ' + String(err.message || err);
      }finally{
        hideLoader();
      }
    });
  });
}

/* =========================
   KPI — synthèse + tableau + courbe
   ========================= */
let CHARTS = [];
function initKpi(){
  const btnKpi = qs('#btnKpi'); if (btnKpi) btnKpi.addEventListener('click', loadAndRenderKpi);
  const btnExport = qs('#btnExport'); if (btnExport) btnExport.addEventListener('click', doExportXlsx);
}
async function loadAndRenderKpi(){
  const from = qs('#kpi_from').value;
  const to   = qs('#kpi_to').value;

  const baseUrl = window.CONFIG && window.CONFIG.WEBAPP_BASE_URL || '';
  if (!baseUrl) { alert('URL backend non configurée.'); return; }

  const url = new URL(baseUrl);
  url.searchParams.set('route','kpi');
  if (from) url.searchParams.set('from', from);
  if (to)   url.searchParams.set('to', to);

  const box = qs('#kpiResults'); if (box) box.textContent = 'Chargement KPI…';
  showLoader('Chargement KPI…');
  try{
    const js = await fetchWithTimeout(url.toString(), {}, 30000).then(r=>r.json());
    if (!js.ok) { box.textContent='Erreur KPI'; return; }
    renderKpi(js.kpi);
  }catch{
    box.textContent='Erreur KPI';
  }finally{
    hideLoader();
  }
}
function doExportXlsx(){
  const from = qs('#kpi_from').value, to = qs('#kpi_to').value;
  const baseUrl = window.CONFIG && window.CONFIG.WEBAPP_BASE_URL || '';
  if (!baseUrl) { alert('URL backend non configurée.'); return; }
  const url = new URL(baseUrl);
  url.searchParams.set('route','export');
  if (from) url.searchParams.set('from', from);
  if (to)   url.searchParams.set('to', to);

  showLoader('Préparation de l’export…');
  fetchWithTimeout(url.toString(), {}, 45000)
    .then(r=>r.json())
    .then(js=>{
      if (!js.ok) { alert('Export échoué'); return; }
      const href = js.directDownloadUrl || js.webViewLink;
      window.open(href, '_blank');
    })
    .catch(()=> alert('Export échoué'))
    .finally(hideLoader);
}
function renderKpi(kpi){
  // Nettoyage des anciens graphs
  CHARTS.forEach(ch=>{ try{ ch.destroy(); }catch{} });
  CHARTS = [];

  const wrap = qs('#kpiResults');
  wrap.innerHTML = '';

  // On force l’affichage des 3 familles, même si le backend n’en renvoie qu’une partie
  const TYPES = ['Cartons', 'Palettes_Avant', 'Palettes_Destination'];

  // Helper pour objet KPI vide
  const empty = ()=>({
    summary: {
      total_entries: 0, entries_with_any_KO: 0, entries_with_any_KO_pct: 0,
      total_KO_items: 0, avg_KO_per_entry: 0
    },
    per_question: {},
    by_date: []
  });

  TYPES.forEach(t=>{
    const obj = (kpi && kpi[t]) ? kpi[t] : empty();
    const sum = obj.summary || empty().summary;
    const perQ = obj.per_question || {};
    const series = Array.isArray(obj.by_date) ? obj.by_date : [];

    // Carte synthèse
    const cardS = document.createElement('div');
    cardS.className='kpi-card card';
    cardS.innerHTML = `
      <h3>${t} — Synthèse</h3>
      <div class="kpi-legend">
        <strong>Contrôles</strong> : ${sum.total_entries||0}
        &nbsp;|&nbsp;<strong>≥1 KO</strong> : ${sum.entries_with_any_KO||0} (${sum.entries_with_any_KO_pct||0}%)
        &nbsp;|&nbsp;<strong>Total KO</strong> : ${sum.total_KO_items||0}
        &nbsp;|&nbsp;<strong>KO moyens/entrée</strong> : ${sum.avg_KO_per_entry||0}
      </div>`;
    wrap.appendChild(cardS);

    // Tableau par question
    const rows = Object.keys(perQ).map(q=>{
      const it = perQ[q] || {OK:0, KO:0, ko_pct:0};
      return `<tr><td>${q}</td><td>${it.OK}</td><td>${it.KO}</td><td>${it.ko_pct}%</td></tr>`;
    }).join('');
    const cardT = document.createElement('div');
    cardT.className='kpi-card card';
    cardT.innerHTML = `
      <h3>${t} — Par point (OK vs KO)</h3>
      <table class="kpi">
        <thead><tr><th>Point</th><th>OK</th><th>KO</th><th>% KO</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">Aucune donnée</td></tr>'}</tbody>
      </table>`;
    wrap.appendChild(cardT);

    // Courbe par jour (avec animations désactivées)
    const labels = series.map(s=>s.date);
    const taux   = series.map(s=>s.taux_ko_pct);
    const cardL = document.createElement('div');
    cardL.className='kpi-card card';
    cardL.innerHTML = `<h3>${t} — Taux KO % par jour</h3><div class="chart-wrap"><canvas></canvas></div>`;
    wrap.appendChild(cardL);

    if (typeof Chart !== 'undefined') {
      const style = getComputedStyle(document.documentElement);
      const ctx = cardL.querySelector('canvas').getContext('2d');

      // IMPORTANT: animation désactivée pour éviter les boucles de reflow
      const chart = new Chart(ctx,{
        type:'line',
        data:{
          labels,
          datasets:[{
            label:'Taux KO %',
            data: taux,
            tension:0.2,
            fill:false,
            pointRadius:3
          }]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,     // on force la hauteur via CSS
          animation:false,               // <- désactive animations
          transitions: { active: { animation: { duration: 0 } } },
          interaction:{ mode:'nearest', intersect:false },
          scales:{
            x:{
              ticks:{ color:style.getPropertyValue('--muted') },
              grid:{ color:'rgba(127,127,127,0.2)' }
            },
            y:{
              beginAtZero:true,
              ticks:{
                color:style.getPropertyValue('--muted'),
                callback:v=>`${v}%`
              },
              grid:{ color:'rgba(127,127,127,0.2)' }
            }
          },
          plugins:{
            legend:{ labels:{ color:style.getPropertyValue('--text') } },
            tooltip:{ animation:false }
          }
        }
      });
      CHARTS.push(chart);
    } else {
      const warn = document.createElement('p');
      warn.textContent = '⚠️ Chart.js non chargé.';
      cardL.appendChild(warn);
    }
  });

  // S’il n’y a vraiment aucune donnée nulle part, on l’indique
  const totalEntries =
    (kpi?.Cartons?.summary?.total_entries || 0) +
    (kpi?.Palettes_Avant?.summary?.total_entries || 0) +
    (kpi?.Palettes_Destination?.summary?.total_entries || 0);
  if (totalEntries === 0) {
    const info = document.createElement('p');
    info.textContent = 'Aucune donnée pour la période choisie.';
    wrap.appendChild(info);
  }
}


/* ---------- Boot (anti double init) ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  if (window.__QC_INIT__) return;
  window.__QC_INIT__ = true;

  initTabs();
  initThemeToggle();
  initDecodeButtons();
  initKoBlocks();
  initForms();
  initKpi();
  initServiceWorker();

  // Hooks Caméra/Galerie -> cibles (IDs alignés avec index.html)
  hookCameraGalleryPair('btnCartonsPhotoCam','cartons_photo_cam','btnCartonsPhotoGal','cartons_photo_gal','cartons_photo_target','cartons_photo_label');
  hookCameraGalleryPair('btnCartonsBcCam','cartons_bc_cam','btnCartonsBcGal','cartons_bc_gal','cartons_barcode_file','cartons_bc_label');

  hookCameraGalleryPair('btnPaPhotoCam','pa_photo_cam','btnPaPhotoGal','pa_photo_gal','pa_photo_target','pa_photo_label');
  hookCameraGalleryPair('btnPaBcCam','pa_bc_cam','btnPaBcGal','pa_bc_gal','pa_barcode_file','pa_bc_label');

  hookCameraGalleryPair('btnPdPhotoCam','pd_photo_cam','btnPdPhotoGal','pd_photo_gal','pd_photo_target','pd_photo_label');
  hookCameraGalleryPair('btnPdBcCam','pd_bc_cam','btnPdBcGal','pd_bc_gal','pd_barcode_file','pd_bc_label');
});
