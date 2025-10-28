/* =======================
   Pelichet QC - Frontend
   app.js (complet)
   ======================= */

/* ---------- CONFIG (unique) ---------- */
(function initConfig(){
  if(!window.CONFIG){
    window.CONFIG = {
      WEBAPP_BASE_URL: "",     // <-- colle ici l’URL /exec Apps Script
      RESIZE_ENABLED: true,
      MAX_IMAGE_DIM: 1600,     // plus petit côté max, pour limiter la taille
      OUTPUT_MIME: "image/jpeg",
      QUALITY: 0.85,           // qualité initiale (baissera si > 600 Ko)
      MAX_FILE_SIZE_KB: 600
    };
  }
})();

/* ---------- Helpers DOM ---------- */
const qs  = (sel, el=document)=> el.querySelector(sel);
const qsa = (sel, el=document)=> Array.from(el.querySelectorAll(sel));

function todayStr(){
  const d = new Date();
  const p = n => (n<10?'0':'')+n;
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

/* ---------- Loader ---------- */
let _loaderCount = 0;
function showLoader(msg){
  let el = qs('#globalLoader');
  if(!el){
    el = document.createElement('div');
    el.id = 'globalLoader';
    el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);z-index:99999;color:#fff;font:600 16px/1.2 system-ui';
    el.innerHTML = `<div style="background:#111;padding:16px 18px;border-radius:12px;min-width:220px;text-align:center">
      <div class="spinner" style="width:28px;height:28px;border-radius:50%;border:3px solid #999;border-top-color:#ff6a00;margin:0 auto 8px;animation:spin .8s linear infinite"></div>
      <div id="loaderMsg">${msg||'Chargement...'}</div>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(el);
  } else {
    qs('#loaderMsg', el).textContent = msg || 'Chargement...';
  }
  el.style.display = 'flex';
  _loaderCount++;
}
function hideLoader(){
  _loaderCount = Math.max(0, _loaderCount-1);
  const el = qs('#globalLoader');
  if(el && _loaderCount===0) el.style.display = 'none';
}

/* ---------- Fetch utils ---------- */
function fetchWithTimeout(url, options={}, timeoutMs=30000){
  return new Promise((resolve, reject)=>{
    const ctrl = new AbortController();
    const id = setTimeout(()=>{ ctrl.abort(); reject(new Error('Timeout')); }, timeoutMs);
    fetch(url, {...options, signal: ctrl.signal}).then(r=>{ clearTimeout(id); resolve(r); }).catch(err=>{ clearTimeout(id); reject(err); });
  });
}

/* ---------- Tabs ---------- */
function setupTabs(){
  const tabs = qsa('nav .tab');
  const sections = qsa('.tabContent');
  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const t = btn.getAttribute('data-target');
      sections.forEach(s=> s.classList.toggle('active', s.id === t));
      // auto-chargement KPI
      if(t==='tabKpi') loadAndRenderKpi().catch(()=>{});
    });
  });
}

/* ---------- Theme ---------- */
function setupTheme(){
  const t = localStorage.getItem('qc_theme') || 'dark';
  document.documentElement.dataset.theme = t;
  const toggle = qs('#themeToggle');
  if(toggle){
    toggle.addEventListener('click', ()=>{
      const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = cur;
      localStorage.setItem('qc_theme', cur);
    });
  }
}

/* ---------- Dates & defaults ---------- */
function setDefaultDatesAndOK(){
  qsa('input[type="date"]').forEach(inp=>{
    if(!inp.value) inp.value = todayStr();
  });
  // tous les selects OK par défaut
  qsa('form.qcForm select').forEach(sel=>{
    if(!sel.value) sel.value = 'OK';
  });
}

/* ---------- KO sections show/hide + requirements ---------- */
function setupKOSections(){
  qsa('form.qcForm .qblock').forEach(block=>{
    const sel = qs('select', block);
    const details = qs('.koDetails', block);
    if(!sel || !details) return;

    const toggle = ()=>{
      const isKO = (sel.value || '').toUpperCase()==='KO';
      details.classList.toggle('hidden', !isKO);
      const files = qsa('input[type="file"]', details);
      const ta = qs('textarea', details);
      files.forEach(f=> f.required = isKO);
      if(ta) ta.required = isKO;
    };
    sel.addEventListener('change', toggle);
    toggle(); // init
  });
}

/* ---------- Image -> dataURL (<= 600 Ko) ---------- */
function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
function imageElementFromFile(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>{
      const img = new Image();
      img.onload = ()=> resolve(img);
      img.onerror = reject;
      img.src = fr.result;
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
async function resizeToLimit(file){
  // Si la compression est désactivée, renvoie base64 direct
  if(!CONFIG.RESIZE_ENABLED) return { dataUrl: await fileToDataUrl(file), ext: guessExt(file) };

  const img = await imageElementFromFile(file);

  const maxDim = CONFIG.MAX_IMAGE_DIM || 1600;
  const mime   = CONFIG.OUTPUT_MIME || 'image/jpeg';

  let {w,h} = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  let scale = 1;
  if(w>h && w>maxDim) scale = maxDim / w;
  if(h>=w && h>maxDim) scale = maxDim / h;
  if(scale<=0) scale = 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w*scale));
  canvas.height= Math.max(1, Math.round(h*scale));
  const ctx = canvas.getContext('2d', {alpha:false, desynchronized:true});
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // tente qualité décroissante jusqu’à <= MAX_FILE_SIZE_KB
  const maxKB = CONFIG.MAX_FILE_SIZE_KB || 600;
  let q = CONFIG.QUALITY || 0.85;
  let dataUrl = canvas.toDataURL(mime, q);

  const toKB = (d)=> Math.round((d.length * 3 / 4) / 1024); // approx base64->bytes
  let kb = toKB(dataUrl);
  while(kb > maxKB && q > 0.4){
    q = Math.max(0.4, q - 0.08);
    dataUrl = canvas.toDataURL(mime, q);
    kb = toKB(dataUrl);
  }
  return { dataUrl, ext: mime.split('/')[1] || 'jpg' };
}
function guessExt(file){
  const t = (file && file.type) || '';
  if(t.includes('png')) return 'png';
  if(t.includes('webp')) return 'webp';
  if(t.includes('heic')||t.includes('heif')) return 'heic';
  return 'jpg';
}
async function filesToDataUrlsLimited(fileList){
  const out = [];
  for(const f of Array.from(fileList||[])){
    const packed = await resizeToLimit(f);
    out.push(packed);
  }
  return out;
}

/* ---------- Build payload from form ---------- */
async function buildPayload(form){
  const type = form.dataset.type;
  const date = qs('input[name="date_saisie"]', form).value.trim();
  const code = qs('input[name="code_barres"]', form).value.trim();

  // Photo principale
  let photo_principale = null;
  const mainFile = qs('input[name="photo_principale"]', form).files[0];
  if(mainFile){
    photo_principale = await resizeToLimit(mainFile);
  }

  // Questions
  const answers = [];
  qsa('.qblock', form).forEach(block=>{
    const sel = qs('select', block);
    if(!sel) return;
    const field = sel.name;
    const value = sel.value || 'OK';
    const details = qs('.koDetails', block);
    let photos = [];
    let commentaire = '';
    if(value.toUpperCase()==='KO' && details){
      const files = qsa('input[type="file"]', details).flatMap(i=> Array.from(i.files||[]));
      if(files.length){
        // multiples photos KO
        photos = await filesToDataUrlsLimited(files);
      }
      const ta = qs('textarea', details);
      if(ta) commentaire = (ta.value||'').trim();
    }
    answers.push({ field, value, photos, commentaire });
  });

  return {
    type,
    payload: {
      date_jour: date,
      code_barres: code,
      photo_principale,
      answers
    }
  };
}

/* ---------- Submit handling ---------- */
async function postQC(form){
  const base = CONFIG.WEBAPP_BASE_URL;
  if(!base){ alert("URL backend non configurée.\nRenseigne CONFIG.WEBAPP_BASE_URL dans app.js"); throw new Error('No backend'); }
  const type = form.dataset.type;

  const url = new URL(base);
  url.searchParams.set('route','qc');
  url.searchParams.set('type', type);

  const body = await buildPayload(form);
  const btn = qs('button[type="submit"]', form);
  btn && (btn.disabled = true);

  showLoader('Envoi en cours…');
  try{
    const res = await fetchWithTimeout(url.toString(), {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'payload=' + encodeURIComponent(JSON.stringify(body.payload))
    }, 60000);
    const js = await res.json();
    if(!js.ok){
      alert('Erreur serveur: ' + (js.error||'inconnue'));
      return;
    }
    // succès
    alert('✔ Enregistré dans ' + (js.sheet || type));
    // reset “KO détails”, mais pas la date
    qsa('select', form).forEach(s=> s.value='OK');
    qsa('.koDetails', form).forEach(d=>{
      d.classList.add('hidden');
      qsa('input[type="file"]', d).forEach(i=> i.value='');
      const ta = qs('textarea', d); if(ta) ta.value='';
    });
    const code = qs('input[name="code_barres"]', form); if(code) code.value='';
    const photo = qs('input[name="photo_principale"]', form); if(photo) photo.value='';
  }catch(err){
    alert('Échec réseau: ' + String(err && err.message || err));
  }finally{
    hideLoader();
    btn && (btn.disabled = false);
  }
}

/* ---------- Form bindings ---------- */
function setupForms(){
  qsa('form.qcForm').forEach(form=>{
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      // validations basiques
      const date = qs('input[name="date_saisie"]', form).value.trim();
      const code = qs('input[name="code_barres"]', form).value.trim();
      if(!date || !code){ alert('Date et code-barres sont obligatoires.'); return; }

      // si KO quelque part, photo+commentaire requis (déjà géré via required, mais on double check)
      let ok = true;
      qsa('.qblock', form).forEach(block=>{
        const sel = qs('select', block);
        const isKO = (sel.value||'').toUpperCase()==='KO';
        if(isKO){
          const d = qs('.koDetails', block);
          const hasFile = qsa('input[type="file"]', d).some(i=> (i.files&&i.files.length>0));
          const ta = qs('textarea', d);
          const hasComment = ta && ta.value.trim().length>0;
          if(!hasFile || !hasComment) ok = false;
        }
      });
      if(!ok){ alert('Pour chaque KO: photo(s) et commentaire sont obligatoires.'); return; }

      await postQC(form);
    });
  });
}

/* ---------- KPI ---------- */
let CHARTS = [];
async function loadAndRenderKpi(){
  const base = CONFIG.WEBAPP_BASE_URL;
  if(!base){ qs('#kpiResults').textContent = 'Backend non configuré.'; return; }

  const url = new URL(base);
  url.searchParams.set('route','kpi');

  const box = qs('#kpiResults'); box.textContent = 'Chargement KPI…';
  showLoader('Chargement KPI…');
  try{
    const js = await fetchWithTimeout(url.toString(), {}, 30000).then(r=>r.json());
    if(!js.ok){ box.textContent = 'Erreur KPI: ' + (js.error||'inconnue'); return; }
    renderKpi(js.kpi);
  }catch(e){
    box.textContent = 'Erreur KPI réseau.';
  }finally{
    hideLoader();
  }
}

function renderKpi(kpi){
  // clean old charts
  CHARTS.forEach(c=>{ try{ c.destroy(); }catch{} });
  CHARTS = [];
  const wrap = qs('#kpiResults');
  wrap.innerHTML = '';

  const TYPES = ['Cartons','Palettes_Avant','Palettes_Destination'];
  const empty = ()=>({
    summary:{ total_entries:0, entries_with_any_KO:0, entries_with_any_KO_pct:0, total_KO_items:0, avg_KO_per_entry:0 },
    per_question:{},
    by_date:[]
  });

  TYPES.forEach(t=>{
    const obj = (kpi && kpi[t]) ? kpi[t] : empty();
    const sum = obj.summary || empty().summary;
    const perQ = obj.per_question || {};
    const series = Array.isArray(obj.by_date) ? obj.by_date : [];

    // synthèse
    const cardS = document.createElement('div');
    cardS.className = 'kpi-card card';
    cardS.innerHTML = `
      <h3>${t} — Synthèse</h3>
      <div class="kpi-legend">
        <strong>Contrôles</strong> : ${sum.total_entries}
        &nbsp;|&nbsp;<strong>≥1 KO</strong> : ${sum.entries_with_any_KO} (${sum.entries_with_any_KO_pct}%)
        &nbsp;|&nbsp;<strong>Total KO</strong> : ${sum.total_KO_items}
        &nbsp;|&nbsp;<strong>KO moyens/entrée</strong> : ${sum.avg_KO_per_entry}
      </div>`;
    wrap.appendChild(cardS);

    // tableau questions
    const rows = Object.keys(perQ).map(q=>{
      const it = perQ[q] || {OK:0,KO:0,ko_pct:0};
      return `<tr><td>${q}</td><td>${it.OK}</td><td>${it.KO}</td><td>${it.ko_pct}%</td></tr>`;
    }).join('');
    const cardT = document.createElement('div');
    cardT.className = 'kpi-card card';
    cardT.innerHTML = `
      <h3>${t} — Par point (OK vs KO)</h3>
      <table class="kpi">
        <thead><tr><th>Point</th><th>OK</th><th>KO</th><th>% KO</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">Aucune donnée</td></tr>'}</tbody>
      </table>`;
    wrap.appendChild(cardT);

    // graph % KO par jour
    const labels = series.map(s=>s.date);
    const data = series.map(s=>s.taux_ko_pct);
    const cardG = document.createElement('div');
    cardG.className = 'kpi-card card';
    cardG.innerHTML = `<h3>${t} — Taux KO % par jour</h3><div class="chart-wrap"><canvas></canvas></div>`;
    wrap.appendChild(cardG);

    if(typeof Chart!=='undefined'){
      const ctx = qs('canvas', cardG).getContext('2d');
      const ch = new Chart(ctx,{
        type:'line',
        data:{
          labels,
          datasets:[{ label:'Taux KO %', data, tension:0.2, fill:false, pointRadius:3 }]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          animation:false,
          transitions:{ active:{ animation:{ duration:0 } } },
          scales:{
            y:{ beginAtZero:true, ticks:{ callback:v=>`${v}%` } }
          },
          plugins:{ legend:{ display:false }, tooltip:{ animation:false } }
        }
      });
      CHARTS.push(ch);
    } else {
      const p = document.createElement('p'); p.textContent='⚠️ Chart.js non chargé.'; cardG.appendChild(p);
    }
  });

  const total = (kpi?.Cartons?.summary?.total_entries||0)+(kpi?.Palettes_Avant?.summary?.total_entries||0)+(kpi?.Palettes_Destination?.summary?.total_entries||0);
  if(total===0){
    const p = document.createElement('p'); p.textContent='Aucune donnée disponible.'; wrap.appendChild(p);
  }
}

/* ---------- Scanner (iPhone-friendly) ---------- */
let _scanner = { stream:null, reader:null, targetInputId:null, running:false };

function isIOS(){
  return /iP(hone|ad|od)/.test(navigator.platform) || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
}
function openScannerFor(targetInputId){
  _scanner.targetInputId = targetInputId;
  const modal = qs('#scannerModal'); if(modal) modal.style.display='grid';
}
function closeScanner(){
  stopScanner();
  const modal = qs('#scannerModal'); if(modal) modal.style.display='none';
}
async function startScanner(){
  try{
    if(!_scanner.reader){
      if(window.ZXingBrowser && ZXingBrowser.BrowserMultiFormatReader){
        _scanner.reader = new ZXingBrowser.BrowserMultiFormatReader();
      }else if(window.ZXing && ZXing.BrowserMultiFormatReader){
        _scanner.reader = new ZXing.BrowserMultiFormatReader(); // fallback nom
      }else{
        alert("Librairie ZXing non chargée.");
        return;
      }
    }
    const video = qs('#scannerVideo');
    if(!video){ alert('Video non trouvée'); return; }
    video.setAttribute('playsinline','true'); video.muted = true;

    const constraints = {
      audio:false,
      video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    _scanner.stream = stream;
    video.srcObject = stream;
    await video.play();

    const hints = new Map();
    const NS = (window.ZXingBrowser && ZXingBrowser) || (window.ZXing && ZXing);
    hints.set(NS.DecodeHintType.POSSIBLE_FORMATS, [
      NS.BarcodeFormat.EAN_13,
      NS.BarcodeFormat.CODE_128,
      NS.BarcodeFormat.CODE_39
    ]);
    _scanner.reader.setHints && _scanner.reader.setHints(hints);
    _scanner.running = true;

    const tick = async ()=>{
      if(!_scanner.running) return;
      try{
        // Certains builds exigent deviceId; ici on laisse "undefined" pour prendre la caméra active
        const res = await _scanner.reader.decodeOnceFromVideoDevice(undefined, 'scannerVideo');
        if(res){
          const text = (res.text || (res.getText && res.getText()) || '').trim();
          if(text){
            const input = document.getElementById(_scanner.targetInputId);
            if(input) input.value = text;
            closeScanner();
            return;
          }
        }
      }catch(_){ /* ignore, on relance */ }
      setTimeout(tick, 250);
    };
    setTimeout(tick, 250);

  }catch(err){
    alert("Caméra non accessible.\n- Autorise l’accès Caméra dans Safari.\n- Si PWA, teste dans Safari direct.\nDétail: " + (err && err.message || err));
    stopScanner();
  }
}
function stopScanner(){
  _scanner.running = false;
  try{ _scanner.reader && _scanner.reader.reset && _scanner.reader.reset(); }catch(_){}
  if(_scanner.stream){
    _scanner.stream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
    _scanner.stream = null;
  }
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  setupTabs();
  setupTheme();
  setDefaultDatesAndOK();
  setupKOSections();
  setupForms();

  // Boutons “Scanner”
  qsa('button[data-scan]').forEach(btn=>{
    btn.addEventListener('click', ()=> openScannerFor(btn.getAttribute('data-scan')));
  });
  // Modal controls
  const bStart = qs('#scannerStart'), bStop = qs('#scannerStop'), bClose = qs('#scannerClose');
  if(bStart) bStart.addEventListener('click', startScanner);
  if(bStop)  bStop.addEventListener('click', stopScanner);
  if(bClose) bClose.addEventListener('click', closeScanner);

  // charge KPI si onglet actif au chargement
  if(qs('#tabKpi').classList.contains('active')){
    loadAndRenderKpi().catch(()=>{});
  }
});
