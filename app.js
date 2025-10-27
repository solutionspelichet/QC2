/* Pelichet QC — app.js (Galerie pour code-barres, resize <= 600Ko, KPI, export) */

/* ---------- Config / chargement config.json si présent ---------- */
(function ensureConfig(){
  window.CONFIG = window.CONFIG || {};
  if (!window.CONFIG.__loadedFromJson__) {
    fetch('config.json').then(r=>r.ok?r.json():null).then(c=>{
      if (c) Object.assign(window.CONFIG, c);
      window.CONFIG.__loadedFromJson__ = true;
    }).catch(()=>{});
  }
  if (!window.CONFIG.WEBAPP_BASE_URL) {
    const ls = localStorage.getItem('WEBAPP_BASE_URL');
    if (ls) window.CONFIG.WEBAPP_BASE_URL = ls;
  }
})();

/* ---------- Helpers DOM ---------- */
const qs = (s, r=document)=> r.querySelector(s);
const qsa = (s, r=document)=> Array.from(r.querySelectorAll(s));

/* ---------- Thème ---------- */
function initTheme(){
  const toggle = qs('#toggleTheme');
  let theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
  document.documentElement.setAttribute('data-theme', theme);
  const meta = qs('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', theme==='dark'?'#0f1115':'#ff6a00');
  toggle?.addEventListener('click', ()=>{
    theme = theme==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    if (meta) meta.setAttribute('content', theme==='dark'?'#0f1115':'#ff6a00');
  });
}

/* ---------- Onglets ---------- */
function initTabs(){
  const tabs = qsa('.tabs .tab');
  const panes = qsa('.tab-pane');
  tabs.forEach(t=>{
    t.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const id = 'tab-' + t.dataset.tab;
      panes.forEach(p=>p.classList.remove('active'));
      qs('#'+id)?.classList.add('active');
      window.scrollTo({top:0,behavior:'smooth'});
    });
  });
}

/* ---------- Loader ---------- */
function showLoader(text='Traitement…'){
  const el = qs('#appLoader'); if (!el) return;
  el.querySelector('.loader-text').textContent = text;
  el.querySelector('.loader-bar').style.width = '0%';
  el.querySelector('.loader-percent').textContent = '0%';
  el.classList.add('visible');
}
function hideLoader(){ qs('#appLoader')?.classList.remove('visible'); }
function setLoaderProgress(loaded,total){
  if (!total) return;
  const p = Math.min(100, Math.round(loaded*100/total));
  qs('#appLoader .loader-bar').style.width = p+'%';
  qs('#appLoader .loader-percent').textContent = p+'%';
}

/* ---------- Service Worker ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}

/* ---------- Image utils + resize <= ~600Ko ---------- */
function guessExtFromMime(m){ return m==='image/png'?'png':'jpg'; }
async function fileToDataURL(file){
  return await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file);});
}
async function resizeDataUrl(srcDataUrl, maxDim=1600, outMime='image/jpeg', quality=0.85){
  const img = await new Promise((resolve,reject)=>{ const im=new Image(); im.onload=()=>resolve(im); im.onerror=reject; im.src=srcDataUrl;});
  const w0 = img.naturalWidth||img.width, h0 = img.naturalHeight||img.height;
  if (!w0 || !h0) return { dataUrl: srcDataUrl, ext: guessExtFromMime(outMime) };
  const ratio = w0/h0; let w=w0, h=h0;
  if (Math.max(w0,h0)>maxDim){ if (w0>=h0){ w=maxDim; h=Math.round(maxDim/ratio);} else { h=maxDim; w=Math.round(maxDim*ratio);} }
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(img,0,0,w,h);
  let q=quality, dataUrl=c.toDataURL(outMime,q), size=Math.round((dataUrl.length*3)/4), tries=0;
  const maxBytes=(window.CONFIG.MAX_FILE_SIZE_KB||600)*1024;
  while(size>maxBytes && q>0.2 && tries<6){ q-=0.1; dataUrl=c.toDataURL(outMime,q); size=Math.round((dataUrl.length*3)/4); tries++; }
  return { dataUrl, ext: guessExtFromMime(outMime) };
}
async function resizeFileIfNeeded(file){
  const raw = await fileToDataURL(file);
  if (!window.CONFIG.RESIZE_ENABLED) {
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    return { dataUrl: raw, ext };
  }
  return await resizeDataUrl(raw, window.CONFIG.MAX_IMAGE_DIM||1600, window.CONFIG.OUTPUT_MIME||'image/jpeg', window.CONFIG.QUALITY||0.85);
}

/* ---------- ZXing (décodage depuis image de la galerie) ---------- */
async function fileToImage(file){
  return await new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; const fr=new FileReader(); fr.onload=()=>img.src=fr.result; fr.onerror=reject; fr.readAsDataURL(file); });
}
async function imageElementScaled(img, minWidth=1200){
  return await new Promise(resolve=>{
    const w0=img.naturalWidth||img.width||minWidth, h0=img.naturalHeight||img.height||minWidth;
    const scale=Math.max(1, Math.ceil(minWidth/Math.max(1,w0)));
    const w=w0*scale, h=h0*scale;
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h);
    const out=new Image(); out.onload=()=>resolve(out); out.src=c.toDataURL('image/png');
  });
}
async function decodeFileToBarcode(file){
  // 1) API native (si dispo)
  if ('BarcodeDetector' in window) {
    try{
      const bd = new window.BarcodeDetector({ formats: ['ean_13','code_128','code_39'] });
      const img = await fileToImage(file);
      const el = await imageElementScaled(img, 1200);
      const c=document.createElement('canvas'); c.width=el.naturalWidth||el.width; c.height=el.naturalHeight||el.height;
      c.getContext('2d').drawImage(el,0,0,c.width,c.height);
      const blob = await new Promise(r=>c.toBlob(r,'image/png'));
      const bmp = await createImageBitmap(blob);
      const codes = await bd.detect(bmp);
      if (codes && codes[0] && codes[0].rawValue) return String(codes[0].rawValue);
    }catch(_){}
  }
  // 2) ZXing
  const img = await fileToImage(file);
  const el = await imageElementScaled(img, 1200);
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
  }catch{ return ''; }
}

/* ---------- KO blocks ---------- */
function initKoBlocks(){
  function refreshFor(container){
    qsa('.ko-extra', container).forEach(box=>{
      const name=box.getAttribute('data-for');
      const checked=qs(`input[name="${name}"]:checked`, container);
      box.style.display = (checked && checked.value==='KO')?'block':'none';
    });
  }
  qsa('.okko input[type=radio]').forEach(r=>{
    r.addEventListener('change', ()=> refreshFor(r.closest('form')||document));
  });
  qsa('form.qc-form').forEach(f=>refreshFor(f));
}

/* ---------- Hooks Caméra/Galerie -> cible (photo principale) ---------- */
function hookCameraGalleryPair(btnCamId, camId, btnGalId, galId, targetId, labelId){
  const btnCam=qs('#'+btnCamId), cam=qs('#'+camId), btnGal=qs('#'+btnGalId), gal=qs('#'+galId), tgt=qs('#'+targetId), lbl=qs('#'+labelId);
  function copy(src){
    if (!src.files||!src.files[0]) return;
    const dt=new DataTransfer(); dt.items.add(src.files[0]); tgt.files=dt.files;
    if (lbl) lbl.textContent=src.files[0].name;
  }
  btnCam?.addEventListener('click', ()=> cam?.click());
  btnGal?.addEventListener('click', ()=> gal?.click());
  cam?.addEventListener('change', ()=> copy(cam));
  gal?.addEventListener('change', ()=> copy(gal));
}

/* ---------- Lecture code-barres depuis galerie (3 formulaires) ---------- */
function initBarcodeFromGallery(){
  function wire(btnSel, fileSel, targetSel, statusSel){
    const btn=qs(btnSel), fi=qs(fileSel), target=qs(targetSel), status=qs(statusSel);
    if(!btn||!fi||!target) return;
    btn.addEventListener('click', ()=> fi.click());
    fi.addEventListener('change', async ()=>{
      if(!fi.files || !fi.files[0]) return;
      status && (status.textContent='Décodage en cours…');
      try{
        const code = await decodeFileToBarcode(fi.files[0]);
        if (code) {
          target.value = code;
          status && (status.textContent='✅ Code détecté : '+code);
        } else {
          status && (status.textContent='❌ Code non détecté. Essayez une autre photo (netteté, cadrage, lumière).');
          alert('Code non détecté. Choisissez une photo nette, bien cadrée et éclairée.');
        }
      }catch(e){
        status && (status.textContent='❌ Erreur décodage');
        alert('Erreur pendant le décodage: '+String(e.message||e));
      }
    });
  }
  wire('#btnCartonsBC', '#cartons_bc_file', '#cartons_code', '#cartons_bc_status');
  wire('#btnPaBC', '#pa_bc_file', '#pa_code', '#pa_bc_status');
  wire('#btnPdBC', '#pd_bc_file', '#pd_code', '#pd_bc_status');
}

/* ---------- Réseau (timeout + fallback XHR Android) ---------- */
function fetchWithTimeout(input, init={}, timeoutMs=30000){
  return new Promise((resolve,reject)=>{
    const ctrl=new AbortController(); const id=setTimeout(()=>{ctrl.abort();reject(new Error('Timeout réseau'));},timeoutMs);
    fetch(input,{...init,signal:ctrl.signal,redirect:'follow',mode:'cors'})
      .then(r=>{clearTimeout(id);resolve(r);}).catch(e=>{clearTimeout(id);reject(e);});
  });
}
function postFormDataXHR(url, formData, onProgress){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest(); xhr.open('POST', url, true); xhr.responseType='json';
    xhr.onload=()=>{ const body=xhr.response || (xhr.responseText?JSON.parse(xhr.responseText):null); (xhr.status>=200&&xhr.status<300)?resolve(body):reject(new Error('HTTP '+xhr.status)); };
    xhr.onerror=()=>reject(new Error('Erreur réseau XHR')); xhr.ontimeout=()=>reject(new Error('Timeout XHR'));
    if (xhr.upload && typeof onProgress==='function'){ xhr.upload.onprogress=(e)=>{ if(e.lengthComputable) onProgress(e.loaded,e.total); }; }
    xhr.send(formData);
  });
}
async function sendFormToBackend(fd){
  const baseUrl=window.CONFIG.WEBAPP_BASE_URL; if(!baseUrl) throw new Error('URL backend non configurée');
  try{
    const r=await fetchWithTimeout(baseUrl,{method:'POST',body:fd},45000);
    let js=null; try{ js=await r.json(); }catch{ js=JSON.parse(await r.text()); }
    return js;
  }catch(_){ return await postFormDataXHR(baseUrl, fd, (l,t)=> setLoaderProgress(l,t)); }
}

/* ---------- Formulaires ---------- */
function defaultTodayOnDates(){
  const today = new Date().toISOString().slice(0,10);
  qsa('form.qc-form input[type="date"]').forEach(i=>{ if(!i.value) i.value=today; });
}
function ensureOkDefault(){
  qsa('form.qc-form').forEach(f=>{
    qsa('.okko input[value="OK"]', f).forEach(r=>{ r.checked = true; });
  });
}
function initForms(){
  qsa('.qc-form').forEach(form=>{
    form.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const type=form.dataset.type; const result=qs('.result', form); if(result) result.textContent='';
      const date=qs('input[name="date_jour"]', form).value;
      const code=qs('input[name="code_barres"]', form).value.trim();
      if(!date||!code){ alert('Date et code-barres requis.'); return; }
      showLoader('Envoi en cours…');

      try{
        // Photo principale
        let main=null; 
        const target = form.querySelector('input[name="photo_principale"]') || qs('#cartons_photo_target') || qs('#pa_photo_target') || qs('#pd_photo_target');
        const theFile = target?.files?.[0] || null;
        if (theFile) main = await resizeFileIfNeeded(theFile);

        // Questions
        const questionsMap = {
          Cartons: ['callage_papier','intercalaires_livres','ordre_colonnes','scotch','depoussierage'],
          Palettes_Avant: ['cartons_etat','intercalaires_cartons','ordre_cartons','cerclage','stabilite'],
          Palettes_Destination: ['cartons_etat','cerclage']
        };
        const questions = questionsMap[type]||[];

        const answers=[];
        for(const q of questions){
          const v=(qs(`input[name="${q}"]:checked`, form)||{}).value;
          if(!v){ alert('Veuillez répondre à toutes les questions.'); hideLoader(); return; }
          let photos=[], commentaire='';
          if (v==='KO'){
            const fi=qs(`input[data-photofor="${q}"]`, form);
            const ta=qs(`textarea[data-commentfor="${q}"]`, form);
            commentaire=(ta?.value||'').trim();
            if(!fi || !fi.files || fi.files.length===0 || !commentaire){ alert(`Pour "${q}", en KO il faut au moins 1 photo + un commentaire.`); hideLoader(); return; }
            for(const f of fi.files){ photos.push(await resizeFileIfNeeded(f)); }
          }
          answers.push({ field:q, value:v, photos, commentaire });
        }

        const payload={ date_jour:date, type, code_barres:code, photo_principale:main, answers };
        const fd=new FormData(); fd.append('route','qc'); fd.append('type',type); fd.append('payload', JSON.stringify(payload));
        const js=await sendFormToBackend(fd);
        if(!js||!js.ok) throw new Error((js&&js.error)||'Erreur serveur');
        result.textContent='✅ Enregistrement réussi';
        form.reset(); defaultTodayOnDates(); ensureOkDefault(); initKoBlocks();
      }catch(e){ result.textContent='❌ '+String(e.message||e); }
      finally{ hideLoader(); }
    });
  });
}

/* ---------- KPI ---------- */
let CHARTS=[];
function initKpi(){
  qs('#btnKpi')?.addEventListener('click', loadAndRenderKpi);
  qs('#btnExport')?.addEventListener('click', doExportXlsx);
}
async function loadAndRenderKpi(){
  const base=window.CONFIG.WEBAPP_BASE_URL; if(!base){ alert('URL backend non configurée'); return;}
  const url=new URL(base); url.searchParams.set('route','kpi');
  const f=qs('#kpi_from').value, t=qs('#kpi_to').value; if(f) url.searchParams.set('from',f); if(t) url.searchParams.set('to',t);
  const box=qs('#kpiResults'); box.textContent='Chargement KPI…'; showLoader('Chargement KPI…');
  try{
    const js=await fetchWithTimeout(url.toString(),{},30000).then(r=>r.json());
    if(!js.ok){ box.textContent='Erreur KPI'; return; }
    renderKpi(js.kpi);
  }catch{ box.textContent='Erreur KPI'; } finally{ hideLoader(); }
}
function doExportXlsx(){
  const base=window.CONFIG.WEBAPP_BASE_URL; if(!base){ alert('URL backend non configurée'); return;}
  const url=new URL(base); url.searchParams.set('route','export');
  const f=qs('#kpi_from').value, t=qs('#kpi_to').value; if(f) url.searchParams.set('from',f); if(t) url.searchParams.set('to',t);
  showLoader('Préparation export…');
  fetchWithTimeout(url.toString(),{},45000).then(r=>r.json()).then(js=>{
    if(!js.ok){ alert('Export échoué'); return; }
    window.open(js.directDownloadUrl||js.webViewLink,'_blank');
  }).catch(()=> alert('Export échoué')).finally(hideLoader);
}
function renderKpi(kpi){
  CHARTS.forEach(c=>{ try{c.destroy();}catch{} }); CHARTS=[];
  const wrap=qs('#kpiResults'); wrap.innerHTML='';
  const TYPES=['Cartons','Palettes_Avant','Palettes_Destination'];
  const empty=()=>({ summary:{ total_entries:0, entries_with_any_KO:0, entries_with_any_KO_pct:0, total_KO_items:0, avg_KO_per_entry:0 }, per_question:{}, by_date:[] });

  TYPES.forEach(t=>{
    const obj=(kpi&&kpi[t])?kpi[t]:empty();
    const sum=obj.summary||empty().summary; const perQ=obj.per_question||{}; const series=Array.isArray(obj.by_date)?obj.by_date:[];
    const cardS=document.createElement('div'); cardS.className='kpi-card'; cardS.innerHTML=`
      <h3>${t} — Synthèse</h3>
      <div class="kpi-legend">
        <strong>Contrôles</strong> : ${sum.total_entries||0}
        &nbsp;|&nbsp;<strong>≥1 KO</strong> : ${sum.entries_with_any_KO||0} (${sum.entries_with_any_KO_pct||0}%)
        &nbsp;|&nbsp;<strong>Total KO</strong> : ${sum.total_KO_items||0}
        &nbsp;|&nbsp;<strong>KO moyens/entrée</strong> : ${sum.avg_KO_per_entry||0}
      </div>`;
    wrap.appendChild(cardS);

    const rows = Object.keys(perQ).map(q=>{
      const it=perQ[q]||{OK:0,KO:0,ko_pct:0};
      return `<tr><td>${q}</td><td>${it.OK}</td><td>${it.KO}</td><td>${it.ko_pct}%</td></tr>`;
    }).join('');
    const cardT=document.createElement('div'); cardT.className='kpi-card'; cardT.innerHTML=`
      <h3>${t} — Par point (OK vs KO)</h3>
      <table class="kpi"><thead><tr><th>Point</th><th>OK</th><th>KO</th><th>% KO</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Aucune donnée</td></tr>'}</tbody></table>`;
    wrap.appendChild(cardT);

    const labels=series.map(s=>s.date), taux=series.map(s=>s.taux_ko_pct);
    const cardL=document.createElement('div'); cardL.className='kpi-card'; cardL.innerHTML=`<h3>${t} — Taux KO % par jour</h3><canvas></canvas>`;
    wrap.appendChild(cardL);
    if (typeof Chart!=='undefined'){
      const style=getComputedStyle(document.documentElement);
      const ctx=cardL.querySelector('canvas').getContext('2d');
      const ch=new Chart(ctx,{
        type:'line',
        data:{ labels, datasets:[{ label:'Taux KO %', data:taux, tension:0.2, fill:false, pointRadius:3 }] },
        options:{
          responsive:true, maintainAspectRatio:false, animation:false,
          scales:{
            x:{ ticks:{ color:style.getPropertyValue('--muted') }, grid:{ color:'rgba(127,127,127,0.2)' } },
            y:{ beginAtZero:true, ticks:{ color:style.getPropertyValue('--muted'), callback:v=>`${v}%` }, grid:{ color:'rgba(127,127,127,0.2)' } }
          },
          plugins:{ legend:{ labels:{ color:style.getPropertyValue('--text') } }, tooltip:{ animation:false } }
        }
      });
      CHARTS.push(ch);
    } else {
      const p=document.createElement('p'); p.textContent='⚠️ Chart.js non chargé.'; cardL.appendChild(p);
    }
  });

  const total=(kpi?.Cartons?.summary?.total_entries||0)+(kpi?.Palettes_Avant?.summary?.total_entries||0)+(kpi?.Palettes_Destination?.summary?.total_entries||0);
  if (!total){ const p=document.createElement('p'); p.textContent='Aucune donnée pour la période choisie.'; wrap.appendChild(p); }
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  if (window.__QC_INIT__) return; window.__QC_INIT__=true;

  initTheme(); initTabs(); initKoBlocks();
  // Dates par défaut + OK cochés
  (function(){ const today=new Date().toISOString().slice(0,10); qsa('form.qc-form input[type="date"]').forEach(i=>{ if(!i.value) i.value=today; }); })();
  (function(){ qsa('form.qc-form').forEach(f=> qsa('.okko input[value="OK"]', f).forEach(r=> r.checked=true)); })();

  // Photo principale (caméra/galerie)
  function hookPair(btnCamId, camId, btnGalId, galId, targetId, labelId){
    const btnCam=qs('#'+btnCamId), cam=qs('#'+camId), btnGal=qs('#'+btnGalId), gal=qs('#'+galId), tgt=qs('#'+targetId), lbl=qs('#'+labelId);
    function copy(src){
      if (!src.files||!src.files[0]) return;
      const dt=new DataTransfer(); dt.items.add(src.files[0]); tgt.files=dt.files;
      if (lbl) lbl.textContent=src.files[0].name;
    }
    btnCam?.addEventListener('click', ()=> cam?.click());
    btnGal?.addEventListener('click', ()=> gal?.click());
    cam?.addEventListener('change', ()=> copy(cam));
    gal?.addEventListener('change', ()=> copy(gal));
  }
  hookPair('btnCartonsPhotoCam','cartons_photo_cam','btnCartonsPhotoGal','cartons_photo_gal','cartons_photo_target','cartons_photo_label');
  hookPair('btnPaPhotoCam','pa_photo_cam','btnPaPhotoGal','pa_photo_gal','pa_photo_target','pa_photo_label');
  hookPair('btnPdPhotoCam','pd_photo_cam','btnPdPhotoGal','pd_photo_gal','pd_photo_target','pd_photo_label');

  // Code-barres depuis galerie
  (function initBarcodeFromGallery(){
    function wire(btnSel, fileSel, targetSel, statusSel){
      const btn=qs(btnSel), fi=qs(fileSel), target=qs(targetSel), status=qs(statusSel);
      if(!btn||!fi||!target) return;
      btn.addEventListener('click', ()=> fi.click());
      fi.addEventListener('change', async ()=>{
        if(!fi.files || !fi.files[0]) return;
        status && (status.textContent='Décodage en cours…');
        try{
          const code = await decodeFileToBarcode(fi.files[0]);
          if (code) {
            target.value = code;
            status && (status.textContent='✅ Code détecté : '+code);
          } else {
            status && (status.textContent='❌ Code non détecté. Essayez une autre photo (netteté, cadrage, lumière).');
            alert('Code non détecté. Choisissez une photo nette, bien cadrée et éclairée.');
          }
        }catch(e){
          status && (status.textContent='❌ Erreur décodage');
          alert('Erreur pendant le décodage: '+String(e.message||e));
        }
      });
    }
    wire('#btnCartonsBC', '#cartons_bc_file', '#cartons_code', '#cartons_bc_status');
    wire('#btnPaBC', '#pa_bc_file', '#pa_code', '#pa_bc_status');
    wire('#btnPdBC', '#pd_bc_file', '#pd_code', '#pd_bc_status');
  })();

  // Soumission + KPI
  initForms(); 
  qs('#btnKpi')?.addEventListener('click', loadAndRenderKpi);
  qs('#btnExport')?.addEventListener('click', doExportXlsx);
});
