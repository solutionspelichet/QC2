/* ========================== CONFIG ========================== */
var CONFIG = {
  WEBAPP_BASE_URL: "https://script.google.com/macros/s/AKfycbyy826nPPtVW-HpyUSqzhJ-Eoq42_-rXhYHW3WXi3rT9cZ61dW264c7DDnfagnrXjM7/exec",
  MAX_IMAGE_DIM: 1600,   // redimension long côté
  MAX_FILE_SIZE_KB: 600, // taille cible après compression
  QUALITY: 0.85          // qualité JPEG par défaut
};

/* ========================== HELPERS ========================== */
const qs  = (s, el=document)=> el.querySelector(s);
const qsa = (s, el=document)=> Array.from(el.querySelectorAll(s));
function on(el, ev, selOrFn, maybeFn){
  if(typeof selOrFn==='function'){ el.addEventListener(ev, selOrFn); }
  else{ el.addEventListener(ev, e=>{ const t=e.target.closest(selOrFn); if(t) maybeFn(e,t); }); }
}
const todayStr = ()=>{
  const d=new Date(), p=n=>n<10?'0'+n:n;
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
};
function loadScriptOnce(src){
  return new Promise((resolve,reject)=>{
    if ([...document.scripts].some(s => s.src && s.src.split('?')[0] === src.split('?')[0])) return resolve();
    const s=document.createElement('script');
    s.src=src; s.async=true; s.crossOrigin='anonymous';
    s.onload=()=>resolve(); s.onerror=()=>reject(new Error('Échec chargement: '+src));
    document.head.appendChild(s);
  });
}

// Quagga2 optionnel (si tu auto-héberges libs/quagga.min.js)
async function ensureQuagga(){
  if (window.Quagga) return;
  // 👉 soit tu déposes le fichier dans ton repo: /QC2/libs/quagga.min.js
  // (conseillé, plus de CORS/404)
  await loadScriptOnce(location.origin + location.pathname.replace(/\/[^/]*$/,'/') + 'libs/quagga.min.js')
    .catch(()=>{}); // on ignore si absent
}
async function ensureZXing(){
  if (window.ZXingBrowser && window.ZXing) return;
  // Charger d’abord la lib, puis le wrapper browser
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js');
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/umd/index.min.js');
  if (!(window.ZXingBrowser && window.ZXing)) {
    throw new Error('ZXing non chargé');
  }
}

async function ensureHeic2Any(){
  if(window.heic2any) return;
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
}
async function ensureChart(){
  if(window.Chart) return;
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js');
}

/* ===================== Thème clair/sombre ===================== */
(function initTheme(){
  const t = localStorage.getItem('qc_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
qs('#themeToggle')?.addEventListener('click', ()=>{
  const cur=document.documentElement.getAttribute('data-theme');
  const nxt=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',nxt);
  localStorage.setItem('qc_theme',nxt);
});

/* ============================ Tabs ============================ */
on(document,'click','.tabs .tab',(e,btn)=>{
  const target=btn.getAttribute('data-target');
  qsa('.tabs .tab').forEach(b=>b.classList.toggle('active',b===btn));
  qsa('.tabContent').forEach(s=>s.classList.toggle('active',s.id===target));
  if(target==='tabKPI'){ loadAndRenderKPI().catch(()=>{}); }
});

/* ==================== Valeurs par défaut ====================== */
qsa('input[type="date"]').forEach(i=>{ if(!i.value) i.value=todayStr(); });

/* =================== Radios OK/KO & KO box ==================== */
function updateKoVisibilityForGroup(container){
  const radios=qsa('input[type="radio"]',container);
  if(!radios.length) return;
  const checked=radios.find(r=>r.checked);
  const isKO=(checked?.value||'').toUpperCase()==='KO';
  const box=qs('.koDetails',container);
  if(box){
    box.classList.toggle('hidden',!isKO);
    qsa('input[type="file"],textarea',box).forEach(el=> el.required=isKO);
  }
}
on(document,'change','.control-item input[type="radio"]',(e,radio)=>{
  updateKoVisibilityForGroup(radio.closest('.control-item'));
});
qsa('.control-item').forEach(updateKoVisibilityForGroup);

/* ============================ Loader ========================== */
let _loader=0;
function showLoader(msg){
  const M=qs('#globalLoader'); if(!M) return;
  qs('#loaderMsg').textContent=msg||'Chargement…';
  M.style.display='flex'; _loader++;
}
function hideLoader(){
  const M=qs('#globalLoader'); if(!M) return;
  _loader=Math.max(0,_loader-1);
  if(!_loader) M.style.display='none';
}

/* ========================= SCAN CAMÉRA ======================== */
let SCAN={target:null, running:false};
function openScannerFor(inputId){
  SCAN.target=inputId;
  qs('#scannerModal').style.display='grid';
}
async function startScanner(){
  // Ouvre le modal si pas déjà ouvert
  qs('#scannerModal').style.display='grid';
  const inputId = SCAN.target;

  // 1) Tentative Quagga si dispo (self-host)
  try{
    await ensureQuagga();
    if (window.Quagga){
      try{ Quagga.stop(); }catch{}
      const videoEl=qs('#scannerVideo'); videoEl.setAttribute('playsinline','true');
      Quagga.init({
        inputStream:{ type:'LiveStream', target: videoEl, constraints:{ facingMode:'environment', width:{ideal:1280}, height:{ideal:720} } },
        decoder:{ readers:['ean_reader','code_128_reader','code_39_reader'] }, locate:true, locator:{halfSample:true,patchSize:'medium'}
      }, (err)=>{
        if(err) throw err;
        Quagga.start(); SCAN.running=true;
      });
      Quagga.offDetected?.();
      Quagga.onDetected((res)=>{
        const code=res?.codeResult?.code ? String(res.codeResult.code).trim() : '';
        if(code){
          document.getElementById(inputId).value=code;
          closeScanner();
        }
      });
      return; // ✅ Quagga OK
    }
  }catch(e){
    // on poursuit en fallback
  }

  // 2) Fallback ZXing (CDN stables)
  try{
    await ensureZXing();
    const videoEl=qs('#scannerVideo'); videoEl.setAttribute('playsinline','true');

    // Arrête Quagga si lancé (sécurité)
    try{ Quagga && Quagga.stop(); }catch{}

    // ZXing reader
    SCAN._zxingReader = new ZXingBrowser.BrowserMultiFormatReader();
    const devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
    const backCam = devices.find(d=>/back|rear|environment/i.test(d.label))?.deviceId || devices[0]?.deviceId;

    await SCAN._zxingReader.decodeFromVideoDevice(backCam, videoEl, (result, err, controls)=>{
      if(result && result.getText){
        document.getElementById(inputId).value = String(result.getText()).trim();
        controls.stop();
        closeScanner();
      }
      // err silencieux tant que pas décodé
    });
    SCAN.running = true;
  }catch(err){
    alert("Caméra indisponible ou permissions refusées. Vous pouvez charger une photo pour décoder.");
  }
}

function stopScanner(){ if(SCAN.running){ try{Quagga.stop();}catch{} SCAN.running=false; } }
function closeScanner(){ stopScanner(); qs('#scannerModal').style.display='none'; }
qs('#scannerStart')?.addEventListener('click',startScanner);
qs('#scannerStop')?.addEventListener('click',stopScanner);
qs('#scannerClose')?.addEventListener('click',closeScanner);
on(document,'click','button[data-scan]',(e,btn)=> openScannerFor(btn.getAttribute('data-scan')));

/* ==================== DÉCODAGE VIA FICHIER ==================== */
on(document,'change','input.barcode-photo',async(e,input)=>{
  const targetId=input.getAttribute('data-target');
  try{
    const code=await decodeBarcodeFromImageFile(input.files?.[0]);
    if(code) document.getElementById(targetId).value=code;
  }catch(err){ alert(err?.message||'Décodage impossible.'); }
  finally{ input.value=''; }
});
async function decodeBarcodeFromImageFile(file){
  if(!file) throw new Error('Aucun fichier.');
  await ensureQuagga();
  let blob=file;
  if(/image\/heic|image\/heif/i.test(file.type)||/\.heic$/i.test(file.name||'')){
    try{ await ensureHeic2Any(); blob=await heic2any({blob:file,toType:'image/jpeg',quality:0.92}); }catch{}
  }
  const dataURL=await readAsDataURL(blob);
  return new Promise((resolve,reject)=>{
    if(!window.Quagga){ reject(new Error('Quagga non chargé')); return; }
    Quagga.decodeSingle({
      src:dataURL,numOfWorkers:0,
      inputStream:{size:1600},
      decoder:{readers:['ean_reader','code_128_reader','code_39_reader']},
      locate:true
    },(result)=>{
      const code=result?.codeResult?.code ? String(result.codeResult.code).trim() : '';
      if(code) resolve(code);
      else reject(new Error('Aucun code-barres détecté (photo floue/sombre ?).'));
    });
  });
}
function readAsDataURL(blobOrFile){
  return new Promise((ok,ko)=>{
    const fr=new FileReader();
    fr.onload=()=>ok(fr.result);
    fr.onerror=ko;
    fr.readAsDataURL(blobOrFile);
  });
}

/* ================== COMPRESSION ≤ 600 KB ====================== */
function imageFromFile(file){return new Promise((ok,ko)=>{const fr=new FileReader();fr.onload=()=>{const img=new Image();img.onload=()=>ok(img);img.onerror=ko;img.src=fr.result;};fr.onerror=ko;fr.readAsDataURL(file);});}
async function resizeToLimit(file){
  let src=file;
  if(/image\/heic|image\/heif/i.test(file.type)||/\.heic$/i.test(file.name||'')){
    try{await ensureHeic2Any();src=await heic2any({blob:file,toType:'image/jpeg',quality:0.95});}catch{}
  }
  const img=await imageFromFile(src);
  const maxDim=CONFIG.MAX_IMAGE_DIM,mime='image/jpeg';
  let w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,sc=1;
  if(Math.max(w,h)>maxDim) sc=maxDim/Math.max(w,h);
  const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w*sc)); c.height=Math.max(1,Math.round(h*sc));
  c.getContext('2d',{alpha:false,desynchronized:true}).drawImage(img,0,0,c.width,c.height);
  let q=CONFIG.QUALITY,out=c.toDataURL(mime,q);
  const toKB=s=>Math.round((s.length*3/4)/1024);
  while(toKB(out)>CONFIG.MAX_FILE_SIZE_KB&&q>0.4){q=Math.max(0.4,q-0.08);out=c.toDataURL(mime,q);}
  return out;
}

/* ====================== BUILD PAYLOAD ======================== */
async function buildPayload(form){
  const date=qs('input[name="date_saisie"]',form).value.trim();
  const code=qs('input[name="code_barres"]',form).value.trim();
  const main=qs('input[name="photo_principale"]',form)?.files?.[0];
  const photo_principale=main?await resizeToLimit(main):null;

  const answers=[];
  for(const ci of qsa('.control-item',form)){
    const radios=qsa('input[type="radio"]',ci);
    if(!radios.length) continue;
    const name=radios[0].name;
    const checked=radios.find(r=>r.checked);
    const value=checked?checked.value:'OK';

    let photos=[], commentaire='';
    if(String(value).toUpperCase()==='KO'){
      const box=qs('.koDetails',ci);
      const files=[];
      qsa('input[type="file"]',box).forEach(i=>{if(i.files)files.push(...i.files);});
      for(const f of files)photos.push(await resizeToLimit(f));
      commentaire=(qs('textarea',box)?.value||'').trim();
    }
    answers.push({field:name,value,photos,commentaire});
  }
  return{date_jour:date,code_barres:code,photo_principale,answers};
}

/* ========================= SUBMIT ============================ */
on(document,'submit','form.qcForm',async(e,form)=>{
  e.preventDefault();
  let ok=true;
  qsa('.control-item',form).forEach(ci=>{
    const checked=qsa('input[type="radio"]',ci).find(r=>r.checked);
    if((checked?.value||'').toUpperCase()==='KO'){
      const box=qs('.koDetails',ci);
      const hasFile=qsa('input[type="file"]',box).some(i=>i.files&&i.files.length);
      const hasCom=(qs('textarea',box)?.value||'').trim().length>0;
      if(!hasFile||!hasCom)ok=false;
    }
  });
  if(!ok){alert('Pour chaque KO : photo(s) ET commentaire obligatoires.');return;}
  if(!CONFIG.WEBAPP_BASE_URL){alert('URL backend non configurée.');return;}
  const type=form.dataset.type;
  const url=new URL(CONFIG.WEBAPP_BASE_URL);url.searchParams.set('route','qc');url.searchParams.set('type',type);

  showLoader('Envoi en cours…');
  try{
    const payload=await buildPayload(form);
    const r=await fetch(url.toString(),{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:'payload='+encodeURIComponent(JSON.stringify(payload))
    });
    const js=await r.json();
    if(!js.ok){alert('Erreur backend: '+(js.error||'inconnue'));}
    else{
      alert('✔ Enregistré');
      qsa('.control-item',form).forEach(ci=>{
        const okR=qsa('input[type="radio"][value="OK"]',ci)[0];
        if(okR)okR.checked=true;
        updateKoVisibilityForGroup(ci);
        const box=qs(' .koDetails',ci);
        if(box){qsa('input[type="file"]',box).forEach(i=>i.value='');const ta=qs('textarea',box);if(ta)ta.value='';}
      });
      const codeEl=qs('input[name="code_barres"]',form);if(codeEl)codeEl.value='';
      const photoEl=qs('input[name="photo_principale"]',form);if(photoEl)photoEl.value='';
      const dateEl=qs('input[name="date_saisie"]',form);if(dateEl)dateEl.value=todayStr();
    }
  }catch(e){alert('Échec réseau: '+(e?.message||e));}
  finally{hideLoader();}
});

/* ========================== KPI ============================== */
let CHARTS=[];
async function loadAndRenderKPI(){
  if(!CONFIG.WEBAPP_BASE_URL){qs('#kpiResults').textContent='Backend non configuré';return;}
  await ensureChart();
  const url=new URL(CONFIG.WEBAPP_BASE_URL);url.searchParams.set('route','kpi');
  const box=qs('#kpiResults');box.textContent='Chargement KPI…';showLoader('Chargement KPI…');
  try{
    const js=await fetch(url.toString()).then(r=>r.json());
    if(!js.ok){box.textContent='Erreur KPI : '+(js.error||'inconnue');return;}
    renderKPI(js.kpi);
  }catch{box.textContent='Erreur KPI réseau.';}
  finally{hideLoader();}
}
function renderKPI(kpi){
  CHARTS.forEach(c=>{try{c.destroy()}catch{}});CHARTS=[];
  const wrap=qs('#kpiResults');wrap.innerHTML='';
  const TYPES=['Cartons','Palettes_Avant','Palettes_Destination'];
  const empty=()=>({summary:{total_entries:0,entries_with_any_KO:0,entries_with_any_KO_pct:0,total_KO_items:0,avg_KO_per_entry:0},per_question:{},by_date:[]});
  TYPES.forEach(t=>{
    const obj=(kpi&&kpi[t])?kpi[t]:empty();
    const sum=obj.summary||empty().summary,perQ=obj.per_question||{},series=Array.isArray(obj.by_date)?obj.by_date:[];
    const cardS=document.createElement('div');cardS.className='kpi-card';cardS.innerHTML=
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
    const cardT=document.createElement('div');cardT.className='kpi-card';cardT.innerHTML=
      `<h3>${t} — Par point</h3><table class="kpi"><thead><tr><th>Point</th><th>OK</th><th>KO</th><th>% KO</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Aucune donnée</td></tr>'}</tbody></table>`;
    wrap.appendChild(cardT);
    const labels=series.map(s=>s.date),data=series.map(s=>s.taux_ko_pct);
    const cardG=document.createElement('div');cardG.className='kpi-card';cardG.innerHTML=`<h3>${t} — Taux KO % par jour</h3><div class="chart"><canvas></canvas></div>`;
    wrap.appendChild(cardG);
    if(typeof Chart!=='undefined'){
      const ctx=qs('canvas',cardG).getContext('2d');
      const ch=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'% KO',data,tension:.2,pointRadius:3}]},
        options:{responsive:true,maintainAspectRatio:false,animation:false,scales:{y:{beginAtZero:true,ticks:{callback:v=>`${v}%`}}},plugins:{legend:{display:false},tooltip:{animation:false}}}});
      CHARTS.push(ch);
    } else {
      const p=document.createElement('p');p.textContent='Chart.js non chargé';cardG.appendChild(p);
    }
  });
}
qs('#btnKpiRefresh')?.addEventListener('click', ()=> loadAndRenderKPI().catch(()=>{}) );

/* ======================= Export CSV/XLSX ======================= */
function downloadBlob_(blob, filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},200);
}
async function doExport_(fmt){
  if(!CONFIG.WEBAPP_BASE_URL){alert('URL backend non configurée');return;}
  try{
    const url=new URL(CONFIG.WEBAPP_BASE_URL);
    url.searchParams.set('route','export');
    url.searchParams.set('format',fmt);
    showLoader('Génération export…');
    const r=await fetch(url.toString(),{method:'GET'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const blob=await r.blob();
    downloadBlob_(blob, `QC_${new Date().toISOString().slice(0,10)}.${fmt}`);
  }catch(e){alert('Erreur export: '+(e?.message||e));}
  finally{hideLoader();}
}
qs('#btnExportCsv')?.addEventListener('click', ()=> doExport_('csv'));
qs('#btnExportXlsx')?.addEventListener('click', ()=> doExport_('xlsx'));
