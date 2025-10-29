/* ====== CONFIG (var pour éviter double-déclaration) ====== */
var CONFIG = {
  WEBAPP_BASE_URL: "https://script.google.com/macros/s/AKfycbyy826nPPtVW-HpyUSqzhJ-Eoq42_-rXhYHW3WXi3rT9cZ61dW264c7DDnfagnrXjM7/exec",
  MAX_IMAGE_DIM: 1600,
  MAX_FILE_SIZE_KB: 600,
  QUALITY: 0.85
};

/* ====== Helpers DOM/Date/Events ====== */
const qs  = (s, el=document)=> el.querySelector(s);
const qsa = (s, el=document)=> Array.from(el.querySelectorAll(s));
const todayStr = ()=>{ const d=new Date(), p=n=>n<10?'0'+n:n; return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
function on(el, ev, selOrFn, maybeFn){
  if(typeof selOrFn==='function'){ el.addEventListener(ev, selOrFn); }
  else{ el.addEventListener(ev, (e)=>{ const t=e.target.closest(selOrFn); if(t) maybeFn(e,t); }); }
}
const isIOS = ()=> /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints>1);

/* ====== Theme ====== */
(function(){ const t=localStorage.getItem('qc_theme')||'light'; document.documentElement.setAttribute('data-theme', t); })();
const themeToggleEl = qs('#themeToggle');
if (themeToggleEl){
  themeToggleEl.addEventListener('click', ()=>{
    const cur=document.documentElement.getAttribute('data-theme');
    const nxt=cur==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',nxt);
    localStorage.setItem('qc_theme',nxt);
  });
}

/* ====== Tabs ====== */
const tabsEl = qs('#tabs');
if (tabsEl){
  on(tabsEl, 'click', '.tab', (e,btn)=>{
    const target=btn.getAttribute('data-target');
    qsa('.tabs .tab').forEach(b=> b.classList.toggle('active', b===btn));
    qsa('.tabContent').forEach(s=> s.classList.toggle('active', s.id===target));
    if(target==='tabKPI'){ loadAndRenderKPI().catch(()=>{}); }
  });
}

/* ====== Defaults ====== */
qsa('input[type="date"]').forEach(i=>{ if(!i.value) i.value=todayStr(); });
qsa('form.qcForm select').forEach(s=>{ if(!s.value) s.value='OK'; });

/* ====== KO UI Rules ====== */
on(document, 'change', '.qblock select', (e, sel)=>{
  const block = sel.closest('.qblock');
  const details = qs('.koDetails', block);
  if(!details) return;
  const isKO = (sel.value||'').toUpperCase()==='KO';
  details.classList.toggle('hidden', !isKO);
  qsa('input[type="file"], textarea', details).forEach(el=> el.required=isKO);
});

/* ====== Loader ====== */
let _loader=0;
function showLoader(msg){ qs('#loaderMsg') && (qs('#loaderMsg').textContent=msg||'Chargement...'); qs('#globalLoader') && (qs('#globalLoader').style.display='flex'); _loader++; }
function hideLoader(){ _loader=Math.max(0,_loader-1); if(!_loader && qs('#globalLoader')) qs('#globalLoader').style.display='none'; }

/* ===================================================================== */
/* =========================== SCANNER REWORK ========================== */
/* ===================================================================== */

/* ---- Tech choice ---- */
const hasBarcodeDetector = typeof window.BarcodeDetector === 'function';
let ZX_READER = null;
function getZXReader(){
  if(!ZX_READER){
    if(window.ZXingBrowser && ZXingBrowser.BrowserMultiFormatReader) ZX_READER = new ZXingBrowser.BrowserMultiFormatReader();
    else if(window.ZXing && ZXing.BrowserMultiFormatReader) ZX_READER = new ZXing.BrowserMultiFormatReader();
  }
  return ZX_READER;
}
function setZXHints_(reader){
  const NS=(window.ZXingBrowser||window.ZXing);
  if(reader && reader.setHints && NS && NS.DecodeHintType && NS.BarcodeFormat){
    const hints=new Map();
    hints.set(NS.DecodeHintType.POSSIBLE_FORMATS,[NS.BarcodeFormat.EAN_13, NS.BarcodeFormat.CODE_128, NS.BarcodeFormat.CODE_39]);
    reader.setHints(hints);
  }
}
let BD = null;
async function getBarcodeDetector(){
  if(!hasBarcodeDetector) return null;
  if(!BD){
    try{
      BD = new window.BarcodeDetector({ formats: ['ean_13','code_128','code_39'] });
    }catch(_){
      try{
        BD = new window.BarcodeDetector({ formats: ['ean13','code128','code39'] });
      }catch(e){ BD = null; }
    }
  }
  return BD;
}

/* ---- Scanner state ---- */
let SCAN = { stream:null, target:null, running:false, raf:0, usingBD:false };

/* ---- Open modal ---- */
function openScannerFor(id){
  SCAN.target = id;
  const modal = qs('#scannerModal');
  if (modal) modal.style.display = 'grid';
}

/* ---- BarcodeDetector loop ---- */
async function loopBarcodeDetector_(video){
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {alpha:false, desynchronized:true});
  const detector = await getBarcodeDetector();
  if(!detector) return false;

  SCAN.usingBD = true;
  const step = async ()=>{
    if(!SCAN.running) return;
    try{
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      if(w<2 || h<2){ SCAN.raf = requestAnimationFrame(step); return; }
      canvas.width = w; canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const codes = await detector.detect(canvas);
      if(codes && codes.length){
        const val = (codes[0].rawValue||'').trim();
        if(val){
          const inp = document.getElementById(SCAN.target);
          if(inp) inp.value = val;
          closeScanner();
          return;
        }
      }
    }catch(_){}
    SCAN.raf = requestAnimationFrame(step);
  };
  step();
  return true;
}

/* ---- ZXing loop (frame-by-frame) ---- */
async function loopZXing_(video){
  const reader = getZXReader(); if(!reader) return false;
  setZXHints_(reader);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {alpha:false, desynchronized:true});

  const step = async ()=>{
    if(!SCAN.running) return;
    try{
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      if(w<2 || h<2){ SCAN.raf = requestAnimationFrame(step); return; }
      canvas.width = w; canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);

      try{
        if (reader.decodeFromCanvas){
          const res = await reader.decodeFromCanvas(canvas);
          const txt = (res && (res.text || (res.getText&&res.getText())))?.trim();
          if(txt){
            const inp = document.getElementById(SCAN.target);
            if(inp) inp.value = txt;
            closeScanner();
            return;
          }
        }
      }catch(_){}

      try{
        const url = canvas.toDataURL('image/jpeg', 0.9);
        const img = await imageFromDataURL_(url);
        const res = reader.decodeFromImage ? await reader.decodeFromImage(img)
                                           : (reader.decodeFromImageElement ? await reader.decodeFromImageElement(img) : null);
        const txt = (res && (res.text || (res.getText&&res.getText())))?.trim();
        if(txt){
          const inp = document.getElementById(SCAN.target);
          if(inp) inp.value = txt;
          closeScanner();
          return;
        }
      }catch(_){}
    }catch(_){}
    SCAN.raf = requestAnimationFrame(step);
  };
  step();
  return true;
}

/* ---- Start/Stop/Close ---- */
async function startScanner(){
  try{
    const v = qs('#scannerVideo');
    if (!v) throw new Error('Video manquante');
    v.setAttribute('playsinline','true'); v.muted = true;

    const st = await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} }
    });
    SCAN.stream = st; v.srcObject = st; await v.play(); SCAN.running = true;

    const okBD = await loopBarcodeDetector_(v);
    if(!okBD){
      const okZX = await loopZXing_(v);
      if(!okZX) throw new Error('Aucune techno de scan disponible');
    }
  }catch(e){
    alert("Caméra non accessible. Utilise l'upload de photo pour décoder.");
    stopScanner();
    try{
      if(SCAN.target){
        const inputFile = qsa('input.barcode-photo').find(i => i.getAttribute('data-target') === SCAN.target);
        if(inputFile){ inputFile.click(); }
      }
    }catch(_){}
  }
}
function stopScanner(){
  SCAN.running = false;
  if(SCAN.raf) cancelAnimationFrame(SCAN.raf);
  if(SCAN.stream){ SCAN.stream.getTracks().forEach(t=>{try{t.stop()}catch(_){}}); SCAN.stream=null; }
}
function closeScanner(){ stopScanner(); const m=qs('#scannerModal'); if(m) m.style.display='none'; }

const btnStart = qs('#scannerStart'), btnStop = qs('#scannerStop'), btnClose = qs('#scannerClose');
btnStart && btnStart.addEventListener('click', startScanner);
btnStop  && btnStop.addEventListener('click', stopScanner);
btnClose && btnClose.addEventListener('click', closeScanner);

on(document, 'click', 'button[data-scan]', (e,btn)=>{ openScannerFor(btn.getAttribute('data-scan')); });

/* ---- Upload → décodage ---- */
on(document,'change','input.barcode-photo', async (e,input)=>{
  await decodeBarcodeFromFile(input, input.getAttribute('data-target'));
});

/* ---- Décodage robuste d'une photo (HEIC iPhone → JPEG) ---- */
async function decodeBarcodeFromFile(inputEl, targetId){
  const file = inputEl.files && inputEl.files[0];
  if(!file) return;

  try{
    const reader = getZXReader();
    setZXHints_(reader);

    // img devient JPEG “safe” si la source était HEIC/HEIF
    const img = await imageFromFileRaw_(file);

    // Multi-rotations + multi-échelles
    const rotations = [0, 90, 180, 270];
    const scales    = [1.0, 0.85, 0.7, 0.55, 0.42];

    for(const rot of rotations){
      for(const sc of scales){
        const canvas = canvasFromImageNormalize_(img, sc, 1600, true, rot);

        if(reader && reader.decodeFromCanvas){
          try{
            const res = await reader.decodeFromCanvas(canvas);
            const txt = (res && (res.text || (res.getText&&res.getText())))?.trim();
            if(txt){ const t=document.getElementById(targetId); if(t) t.value=txt; return; }
          }catch(_){}
        }

        try{
          const url = canvas.toDataURL('image/jpeg', 0.92);
          const tmp = await imageFromDataURL_(url);
          let res=null, txt='';
          if(reader){
            if(reader.decodeFromImage) res = await reader.decodeFromImage(tmp);
            else if(reader.decodeFromImageElement) res = await reader.decodeFromImageElement(tmp);
            if(res) txt = (res.text || (res.getText&&res.getText()) || '').trim();
          }
          if(txt){ const t=document.getElementById(targetId); if(t) t.value=txt; return; }
        }catch(_){}
      }
    }
    alert("Aucun code-barres détecté sur la photo. Éclaire bien, recadre et évite le flou.");
  }catch(e){
    alert("Échec décodage image : " + (e && e.message ? e.message : e));
  }
}

/* ---- Helpers images ---- */
async function imageFromFileRaw_(file){
  let blob = file;

  // iPhone : HEIC/HEIF → JPEG
  const isHeic = /image\/heic|image\/heif/i.test(file.type) || /\.heic$/i.test(file.name || "");
  if (isHeic && window.heic2any){
    try{
      blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    }catch(e){
      console.warn("Conversion HEIC->JPEG échouée, on tente quand même:", e);
    }
  }

  const dataURL = await new Promise((ok, ko) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = ko;
    fr.readAsDataURL(blob);
  });

  return await new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = ko;
    img.src = dataURL;
  });
}
function imageFromDataURL_(dataURL){
  return new Promise((ok,ko)=>{ const img=new Image(); img.onload=()=>ok(img); img.onerror=ko; img.src=dataURL; });
}
/**
 * Dessine l'image sur un canvas:
 * - redimension max (maxDim)
 * - scale supplémentaire
 * - rotation (0/90/180/270)
 * - boost contraste léger
 */
function canvasFromImageNormalize_(img, scale, maxDim, boostContrast, rotateDeg){
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const maxSide = Math.max(iw, ih);
  let rw = iw, rh = ih;
  if(maxSide > maxDim){ const sc = maxDim / maxSide; rw = Math.round(rw*sc); rh = Math.round(rh*sc); }
  rw = Math.max(8, Math.round(rw*scale));
  rh = Math.max(8, Math.round(rh*scale));

  const rot = (rotateDeg||0) % 360;
  const rad = rot * Math.PI / 180;
  const sw = (rot===90||rot===270) ? rh : rw;
  const sh = (rot===90||rot===270) ? rw : rh;

  const c=document.createElement('canvas'); c.width=sw; c.height=sh;
  const ctx=c.getContext('2d', {alpha:false, desynchronized:true});
  ctx.save();
  ctx.translate(sw/2, sh/2);
  ctx.rotate(rad);
  ctx.drawImage(img, -rw/2, -rh/2, rw, rh);
  ctx.restore();

  if(boostContrast){
    const id=ctx.getImageData(0,0,sw,sh), d=id.data, gamma=0.9, contrast=1.25, mid=128;
    for(let i=0;i<d.length;i+=4){
      let r=d[i], g=d[i+1], b=d[i+2];
      r=255*Math.pow(r/255,gamma); g=255*Math.pow(g/255,gamma); b=255*Math.pow(b/255,gamma);
      r=(r-mid)*contrast+mid; g=(g-mid)*contrast+mid; b=(b-mid)*contrast+mid;
      d[i]=r<0?0:r>255?255:r; d[i+1]=g<0?0:g>255?255:g; d[i+2]=b<0?0:b>255?255:b;
    }
    ctx.putImageData(id,0,0);
  }
  return c;
}

/* ===================================================================== */
/* ========================= FIN SCANNER REWORK ======================== */
/* ===================================================================== */

/* ====== Compression images (≤ 600 Ko) pour envoi ====== */
function imageFromFile(file){ return new Promise((ok,ko)=>{ const fr=new FileReader(); fr.onload=()=>{ const img=new Image(); img.onload=()=>ok(img); img.onerror=ko; img.src=fr.result; }; fr.onerror=ko; fr.readAsDataURL(file); }); }
async function resizeToLimit(file){
  const img=await imageFromFile(file);
  const maxDim=CONFIG.MAX_IMAGE_DIM, mime='image/jpeg';
  let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height, sc=1;
  if(w>h && w>maxDim) sc=maxDim/w; if(h>=w && h>maxDim) sc=maxDim/h; if(sc<=0) sc=1;
  const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w*sc)); c.height=Math.max(1,Math.round(h*sc));
  const ctx=c.getContext('2d',{alpha:false,desynchronized:true}); ctx.drawImage(img,0,0,c.width,c.height);
  let q=CONFIG.QUALITY||0.85; let out=c.toDataURL(mime,q);
  const toKB=d=>Math.round((d.length*3/4)/1024);
  while(toKB(out)>(CONFIG.MAX_FILE_SIZE_KB||600) && q>0.4){ q=Math.max(0.4, q-0.08); out=c.toDataURL(mime,q); }
  return out;
}
async function filesToDataURLsLimited(list){ const out=[]; for(const f of Array.from(list||[])) out.push(await resizeToLimit(f)); return out; }

/* ====== Build payload JSON ====== */
async function buildPayload(form){
  const date = qs('input[name="date_saisie"]', form).value.trim();
  const code = qs('input[name="code_barres"]', form).value.trim();

  // photo principale (compressée)
  const main = qs('input[name="photo_principale"]', form).files[0];
  const photo_principale = main ? await resizeToLimit(main) : null;

  const answers = [];
  const blocks = qsa('.qblock', form);

  for (const b of blocks){
    const sel = qs('select', b);
    if (!sel) continue;

    const field = sel.name;
    const value = sel.value || 'OK';

    let photos = [];
    let commentaire = '';

    if ((value || '').toUpperCase() === 'KO'){
      const details = qs('.koDetails', b);
      if (details){
        // rassembler tous les <input type="file"> KO
        const fileInputs = qsa('input[type="file"]', details);
        const files = [];
        for (const fi of fileInputs){
          if (fi.files && fi.files.length){
            for (const f of fi.files) files.push(f);
          }
        }
        if (files.length){
          photos = [];
          for (const f of files){
            photos.push(await resizeToLimit(f));
          }
        }
        const ta = qs('textarea', details);
        if (ta) commentaire = (ta.value || '').trim();
      }
    }

    answers.push({ field, value, photos, commentaire });
  }

  return { date_jour: date, code_barres: code, photo_principale, answers };
}

/* ====== Submit vers Apps Script ====== */
on(document,'submit','form.qcForm', async (e, form)=>{
  e.preventDefault();
  // validation KO
  let ok=true;
  qsa('.qblock',form).forEach(b=>{
    const sel=qs('select',b), isKO=(sel.value||'').toUpperCase()==='KO';
    if(isKO){
      const d=qs('.koDetails',b);
      const hasFile=qsa('input[type="file"]',d).some(i=> i.files && i.files.length);
      const hasComment=(qs('textarea',d)?.value||'').trim().length>0;
      if(!hasFile || !hasComment) ok=false;
    }
  });
  if(!ok){ alert('Pour chaque KO : photo(s) et commentaire obligatoires.'); return; }

  if(!CONFIG.WEBAPP_BASE_URL){ alert('URL backend non configurée.'); return; }
  const type = form.dataset.type;
  const url = new URL(CONFIG.WEBAPP_BASE_URL);
  url.searchParams.set('route','qc'); url.searchParams.set('type',type);

  showLoader('Envoi en cours…');
  try{
    const payload = await buildPayload(form);
    const r = await fetch(url.toString(), {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body: 'payload=' + encodeURIComponent(JSON.stringify(payload))
    });
    const js = await r.json();
    if(!js.ok){ alert('Erreur backend: '+(js.error||'inconnue')); }
    else{
      alert('✔ Enregistré');
      // reset contrôlé (on reste sur l’onglet)
      qsa('select',form).forEach(s=> s.value='OK');
      qsa('.koDetails',form).forEach(d=>{
        d.classList.add('hidden');
        qsa('input[type="file"]',d).forEach(i=> i.value='');
        const ta=qs('textarea',d); if(ta) ta.value='';
      });
      const code=qs('input[name="code_barres"]',form); if(code) code.value='';
      const photo=qs('input[name="photo_principale"]',form); if(photo) photo.value='';
      const date=qs('input[name="date_saisie"]',form); if(date) date.value=todayStr();
    }
  }catch(e){
    alert('Échec réseau: '+(e&&e.message||e));
  }finally{
    hideLoader();
  }
});

/* ====== KPI ====== */
let CHARTS=[];
async function loadAndRenderKPI(){
  const base=CONFIG.WEBAPP_BASE_URL; const box=qs('#kpiResults'); if(!base){ if(box) box.textContent='Backend non configuré'; return; }
  const url=new URL(base); url.searchParams.set('route','kpi');
  if(box) box.textContent='Chargement KPI…'; showLoader('Chargement KPI…');
  try{
    const js=await fetch(url.toString()).then(r=>r.json());
    if(!js.ok){ if(box) box.textContent='Erreur KPI : '+(js.error||'inconnue'); return; }
    renderKPI(js.kpi);
  }catch{ if(box) box.textContent='Erreur KPI réseau.'; }
  finally{ hideLoader(); }
}
function renderKPI(kpi){
  CHARTS.forEach(c=>{try{c.destroy()}catch{}}); CHARTS=[];
  const wrap=qs('#kpiResults'); if(!wrap) return; wrap.innerHTML='';
  const TYPES=['Cartons','Palettes_Avant','Palettes_Destination'];
  const empty=()=>({summary:{total_entries:0,entries_with_any_KO:0,entries_with_any_KO_pct:0,total_KO_items:0,avg_KO_per_entry:0},per_question:{},by_date:[]});

  TYPES.forEach(t=>{
    const obj=(kpi&&kpi[t])?kpi[t]:empty(), sum=obj.summary||empty().summary, perQ=obj.per_question||{}, series=Array.isArray(obj.by_date)?obj.by_date:[];
    const cardS=document.createElement('div'); cardS.className='kpi-card'; cardS.innerHTML=
      `<h3>${t} — Synthèse</h3>
       <div><b>Contrôles</b> : ${sum.total_entries}
       &nbsp;|&nbsp;<b>≥1 KO</b> : ${sum.entries_with_any_KO} (${sum.entries_with_any_KO_pct}%)
       &nbsp;|&nbsp;<b>Total KO</b> : ${sum.total_KO_items}
       &nbsp;|&nbsp;<b>KO/entrée</b> : ${sum.avg_KO_per_entry}</div>`;
    wrap.appendChild(cardS);

    const rows=Object.keys(perQ).map(q=>{
      const it=perQ[q]||{OK:0,KO:0,ko_pct:0};
      return `<tr><td>${q}</td><td>${it.OK}</td><td>${it.KO}</td><td>${it.ko_pct}%</td></tr>`;
    }).join('');
    const cardT=document.createElement('div'); cardT.className='kpi-card'; cardT.innerHTML=
      `<h3>${t} — Par point</h3>
       <table class="kpi"><thead><tr><th>Point</th><th>OK</th><th>KO</th><th>% KO</th></tr></thead>
       <tbody>${rows||'<tr><td colspan="4">Aucune donnée</td></tr>'}</tbody></table>`;
    wrap.appendChild(cardT);

    const labels=series.map(s=>s.date), data=series.map(s=>s.taux_ko_pct);
    const cardG=document.createElement('div'); cardG.className='kpi-card'; cardG.innerHTML=`<h3>${t} — Taux KO % par jour</h3><div class="chart"><canvas></canvas></div>`;
    wrap.appendChild(cardG);
    if(typeof Chart!=='undefined'){
      const ctx=qs('canvas',cardG).getContext('2d');
      const ch=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'% KO',data,tension:.2,pointRadius:3}]},
        options:{responsive:true,maintainAspectRatio:false,animation:false,scales:{y:{beginAtZero:true,ticks:{callback:v=>`${v}%`}}},plugins:{legend:{display:false},tooltip:{animation:false}}}});
      CHARTS.push(ch);
    } else {
      const p=document.createElement('p'); p.textContent='Chart.js non chargé'; cardG.appendChild(p);
    }
  });
}
const btnKpi = qs('#btnKpiRefresh');
btnKpi && btnKpi.addEventListener('click', ()=> loadAndRenderKPI().catch(()=>{}) );
