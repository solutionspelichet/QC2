/* ================= CONFIG ================= */
var CONFIG = {
  WEBAPP_BASE_URL: "https://script.google.com/macros/s/AKfycbyy826nPPtVW-HpyUSqzhJ-Eoq42_-rXhYHW3WXi3rT9cZ61dW264c7DDnfagnrXjM7/exec",
  MAX_IMAGE_DIM: 1600,      // redimension long côté
  MAX_FILE_SIZE_KB: 600,    // taille cible max après compression
  QUALITY: 0.85             // qualité JPEG par défaut
};

/* ================= Utils ================= */
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

/* ================= Thème clair/sombre ================= */
(function(){
  const t = localStorage.getItem('qc_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
qs('#themeToggle')?.addEventListener('click', ()=>{
  const cur=document.documentElement.getAttribute('data-theme');
  const nxt=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',nxt);
  localStorage.setItem('qc_theme',nxt);
});

/* ================= Tabs ================= */
on(document,'click','.tabs .tab',(e,btn)=>{
  const target=btn.getAttribute('data-target');
  qsa('.tabs .tab').forEach(b=>b.classList.toggle('active',b===btn));
  qsa('.tabContent').forEach(s=>s.classList.toggle('active',s.id===target));
  if(target==='tabKPI'){ loadAndRenderKPI().catch(()=>{}); }
});

/* ================= Date par défaut ================= */
qsa('input[type="date"]').forEach(i=>{ if(!i.value) i.value=todayStr(); });

/* ================= Radios OK/KO ================= */
function updateKoVisibilityForGroup(container){
  const radios=qsa('input[type="radio"]',container);
  if(!radios.length) return;
  const checked=radios.find(r=>r.checked);
  const isKO=(checked?.value||'').toUpperCase()==='KO';
  const box=qs('.koDetails',container);
  if(box){
    box.classList.toggle('hidden',!isKO);
    qsa('input[type="file"],textarea',box).forEach(el=>el.required=isKO);
  }
}
on(document,'change','.control-item input[type="radio"]',(e,radio)=>{
  updateKoVisibilityForGroup(radio.closest('.control-item'));
});
qsa('.control-item').forEach(updateKoVisibilityForGroup);

/* ================= Loader ================= */
let _loader=0;
function showLoader(msg){ const M=qs('#globalLoader'); if(!M)return; qs('#loaderMsg').textContent=msg||'Chargement…'; M.style.display='flex'; _loader++; }
function hideLoader(){ const M=qs('#globalLoader'); if(!M)return; _loader=Math.max(0,_loader-1); if(!_loader)M.style.display='none'; }

/* ===================================================================== */
/* ============================ SCANNER ================================= */
/* ===================================================================== */
const hasBarcodeDetector = typeof window.BarcodeDetector==='function';
let ZX_READER=null;
function getZXReader(){
  if(!ZX_READER){
    if(window.ZXingBrowser&&ZXingBrowser.BrowserMultiFormatReader) ZX_READER=new ZXingBrowser.BrowserMultiFormatReader();
    else if(window.ZXing&&ZXing.BrowserMultiFormatReader) ZX_READER=new ZXing.BrowserMultiFormatReader();
  }
  return ZX_READER;
}
function setZXHints_(reader){
  const NS=(window.ZXingBrowser||window.ZXing);
  if(reader&&reader.setHints&&NS&&NS.DecodeHintType&&NS.BarcodeFormat){
    const hints=new Map();
    hints.set(NS.DecodeHintType.POSSIBLE_FORMATS,[NS.BarcodeFormat.EAN_13,NS.BarcodeFormat.CODE_128,NS.BarcodeFormat.CODE_39]);
    reader.setHints(hints);
  }
}
let BD=null;
async function getBarcodeDetector(){
  if(!hasBarcodeDetector) return null;
  if(!BD){
    try{BD=new BarcodeDetector({formats:['ean_13','code_128','code_39']});}
    catch{ try{BD=new BarcodeDetector({formats:['ean13','code128','code39']});}catch{BD=null;} }
  }
  return BD;
}

let SCAN={stream:null,target:null,running:false,raf:0};
function openScannerFor(id){SCAN.target=id;qs('#scannerModal').style.display='grid';}
async function startScanner(){
  try{
    const v=qs('#scannerVideo');v.setAttribute('playsinline','true');v.muted=true;
    const st=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    SCAN.stream=st;v.srcObject=st;await v.play();SCAN.running=true;
    const bd=await getBarcodeDetector();
    const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
    const step=async()=>{
      if(!SCAN.running) return;
      const w=v.videoWidth||640,h=v.videoHeight||480;
      if(w<2||h<2){ SCAN.raf=requestAnimationFrame(step); return; }
      canvas.width=w;canvas.height=h;ctx.drawImage(v,0,0,w,h);
      try{
        if(bd){
          const codes=await bd.detect(canvas);
          if(codes&&codes.length){ document.getElementById(SCAN.target).value=(codes[0].rawValue||'').trim(); closeScanner(); return; }
        }else{
          const reader=getZXReader(); setZXHints_(reader);
          try{
            const res=await reader.decodeFromCanvas(canvas);
            const txt=(res && (res.text || (res.getText&&res.getText())))?.trim();
            if(txt){ document.getElementById(SCAN.target).value=txt; closeScanner(); return; }
          }catch(_){}
        }
      }catch(_){}
      SCAN.raf=requestAnimationFrame(step);
    };
    step();
  }catch{
    alert("Caméra non accessible. Utilisez l’upload photo pour décoder.");
    stopScanner();
    const inputFile=qsa('input.barcode-photo').find(i=>i.getAttribute('data-target')===SCAN.target);
    if(inputFile) inputFile.click();
  }
}
function stopScanner(){SCAN.running=false;if(SCAN.raf)cancelAnimationFrame(SCAN.raf);if(SCAN.stream){SCAN.stream.getTracks().forEach(t=>{try{t.stop()}catch{}});SCAN.stream=null;}}
function closeScanner(){stopScanner();qs('#scannerModal').style.display='none';}
qs('#scannerStart')?.addEventListener('click',startScanner);
qs('#scannerStop')?.addEventListener('click',stopScanner);
qs('#scannerClose')?.addEventListener('click',closeScanner);
on(document,'click','button[data-scan]',(e,btn)=>openScannerFor(btn.getAttribute('data-scan')));

/* ===================================================================== */
/* ======== DÉCODAGE DEPUIS FICHIER (iPhone HEIC/HEIF → JPEG) ========= */
/* ===================================================================== */
on(document,'change','input.barcode-photo',async(e,input)=>{await decodeBarcodeFromFile(input,input.getAttribute('data-target'));});

async function decodeBarcodeFromFile(inputEl,targetId){
  const file=inputEl.files&&inputEl.files[0]; if(!file) return;
  try{
    const reader=getZXReader(); setZXHints_(reader);
    let dataURL = await readFileAsDataURL_(file);

    // Conversion HEIC/HEIF → JPEG si possible
    if(/image\/heic|image\/heif/i.test(file.type)||/\.heic$/i.test(file.name||"")){
      try{
        const blob=await heic2any({blob:file,toType:"image/jpeg",quality:0.92});
        dataURL = await readBlobAsDataURL_(blob);
      }catch(e){ console.warn('HEIC→JPEG impossible, on tente l’original', e); }
    }

    const img=await loadImage_(dataURL);
    const rotations=[0,90,180,270], scales=[1.0,0.85,0.7,0.55];
    for(const rot of rotations){
      for(const sc of scales){
        const c=canvasFromImageNormalize_(img,sc,1600,true,rot);
        try{
          const res=await reader.decodeFromCanvas(c);
          const txt=(res && (res.text || (res.getText&&res.getText())))?.trim();
          if(txt){ const t=document.getElementById(targetId); if(t) t.value=txt; return; }
        }catch(_){}
      }
    }
    alert("Aucun code-barres détecté. Essayez une photo nette et bien éclairée.");
  }catch(e){
    alert("Erreur décodage image : " + (e?.message||e));
  }
}
function readFileAsDataURL_(f){return new Promise((ok,ko)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=ko;fr.readAsDataURL(f);});}
function readBlobAsDataURL_(b){return new Promise((ok,ko)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=ko;fr.readAsDataURL(b);});}
function loadImage_(d){return new Promise((ok,ko)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=ko;i.src=d;});}
function canvasFromImageNormalize_(img,scale,maxDim,boost,rot){
  const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
  const sc=Math.min(1,maxDim/Math.max(iw,ih));
  const rw=iw*sc*scale, rh=ih*sc*scale;
  const rad=(rot||0)*Math.PI/180;
  const c=document.createElement('canvas');
  const swap=rot===90||rot===270;
  c.width=Math.max(1,Math.round(swap?rh:rw));
  c.height=Math.max(1,Math.round(swap?rw:rh));
  const ctx=c.getContext('2d',{alpha:false,desynchronized:true});
  ctx.save(); ctx.translate(c.width/2,c.height/2); ctx.rotate(rad); ctx.drawImage(img,-rw/2,-rh/2,rw,rh); ctx.restore();

  if(boost){
    const id=ctx.getImageData(0,0,c.width,c.height), d=id.data, gamma=0.9, contrast=1.25, mid=128;
    for(let i=0;i<d.length;i+=4){
      let r=d[i], g=d[i+1], b=d[i+2];
      r=255*Math.pow(r/255,gamma);
      g=255*Math.pow(g/255,gamma);
      b=255*Math.pow(b/255,gamma);
      r=(r-mid)*contrast+mid;
      g=(g-mid)*contrast+mid;
      b=(b-mid)*contrast+mid;
      d[i]=Math.min(255,Math.max(0,r));
      d[i+1]=Math.min(255,Math.max(0,g));
      d[i+2]=Math.min(255,Math.max(0,b));
    }
    ctx.putImageData(id,0,0);
  }
  return c;
}

/* ===================================================================== */
/* ==================== Compression images ≤600 KB ===================== */
function imageFromFile(file){return new Promise((ok,ko)=>{const fr=new FileReader();fr.onload=()=>{const img=new Image();img.onload=()=>ok(img);img.onerror=ko;img.src=fr.result;};fr.onerror=ko;fr.readAsDataURL(file);});}
async function resizeToLimit(file){
  let src=file;
  if(/image\/heic|image\/heif/i.test(file.type)||/\.heic$/i.test(file.name||"")){
    try{ src=await heic2any({ blob:file, toType:"image/jpeg", quality:0.95 }); }catch{}
  }
  const img=await imageFromFile(src);
  const maxDim=CONFIG.MAX_IMAGE_DIM, mime='image/jpeg';
  let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height, sc=1;
  if(Math.max(w,h)>maxDim) sc=maxDim/Math.max(w,h);
  const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w*sc)); c.height=Math.max(1,Math.round(h*sc));
  c.getContext('2d',{alpha:false,desynchronized:true}).drawImage(img,0,0,c.width,c.height);
  let q=CONFIG.QUALITY, out=c.toDataURL(mime,q);
  const toKB=s=>Math.round((s.length*3/4)/1024);
  while(toKB(out)>CONFIG.MAX_FILE_SIZE_KB && q>0.4){ q=Math.max(0.4,q-0.08); out=c.toDataURL(mime,q); }
  return out;
}

/* ===================== Construction payload ===================== */
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
    if(value==='KO'){
      const box=qs('.koDetails',ci);
      const files=[];
      qsa('input[type="file"]',box).forEach(i=>{ if(i.files) files.push(...i.files); });
      for(const f of files) photos.push(await resizeToLimit(f));
      commentaire=(qs('textarea',box)?.value||'').trim();
    }
    answers.push({ field:name, value, photos, commentaire });
  }
  return { date_jour:date, code_barres:code, photo_principale, answers };
}

/* ===================== Submit ===================== */
on(document,'submit','form.qcForm',async(e,form)=>{
  e.preventDefault();

  // Vérifier KO => photo(s) + commentaire
  let ok=true;
  qsa('.control-item',form).forEach(ci=>{
    const checked=qsa('input[type="radio"]',ci).find(r=>r.checked);
    if((checked?.value||'').toUpperCase()==='KO'){
      const box=qs('.koDetails',ci);
      const hasFile=qsa('input[type="file"]',box).some(i=> i.files && i.files.length);
      const hasCom=(qs('textarea',box)?.value||'').trim().length>0;
      if(!hasFile || !hasCom) ok=false;
    }
  });
  if(!ok){ alert('Pour chaque KO : photo(s) ET commentaire obligatoires.'); return; }

  if(!CONFIG.WEBAPP_BASE_URL){ alert('URL backend non configurée.'); return; }
  const type=form.dataset.type;
  const url=new URL(CONFIG.WEBAPP_BASE_URL); url.searchParams.set('route','qc'); url.searchParams.set('type',type);

  showLoader('Envoi en cours…');
  try{
    const payload=await buildPayload(form);
    const r=await fetch(url.toString(),{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:'payload='+encodeURIComponent(JSON.stringify(payload))
    });
    const js=await r.json();
    if(!js.ok){ alert('Erreur backend: '+(js.error||'inconnue')); }
    else{
      alert('✔ Enregistré');
      // Reset soft
      qsa('.control-item',form).forEach(ci=>{
        const okR=qsa('input[type="radio"][value="OK"]',ci)[0];
        if(okR) okR.checked=true;
        updateKoVisibilityForGroup(ci);
        const box=qs('.koDetails',ci);
        if(box){
          qsa('input[type="file"]',box).forEach(i=> i.value='');
          const ta=qs('textarea',box); if(ta) ta.value='';
        }
      });
      const codeEl=qs('input[name="code_barres"]',form); if(codeEl) codeEl.value='';
      const photoEl=qs('input[name="photo_principale"]',form); if(photoEl) photoEl.value='';
      const dateEl=qs('input[name="date_saisie"]',form); if(dateEl) dateEl.value=todayStr();
    }
  }catch(e){ alert('Échec réseau: '+(e?.message||e)); }
  finally{ hideLoader(); }
});

/* ===================== KPI + Export ===================== */
let CHARTS=[];
async function loadAndRenderKPI(){
  if(!CONFIG.WEBAPP_BASE_URL){ qs('#kpiResults').textContent='Backend non configuré'; return; }
  const url=new URL(CONFIG.WEBAPP_BASE_URL); url.searchParams.set('route','kpi');
  const box=qs('#kpiResults'); box.textContent='Chargement KPI…'; showLoader('Chargement KPI…');
  try{
    const js=await fetch(url.toString()).then(r=>r.json());
    if(!js.ok){ box.textContent='Erreur KPI : '+(js.error||'inconnue'); return; }
    renderKPI(js.kpi);
  }catch{ box.textContent='Erreur KPI réseau.'; }
  finally{ hideLoader(); }
}
function renderKPI(kpi){
  CHARTS.forEach(c=>{ try{c.destroy();}catch{} }); CHARTS=[];
  const wrap=qs('#kpiResults'); wrap.innerHTML='';
  const TYPES=['Cartons','Palettes_Avant','Palettes_Destination'];
  const empty=()=>({summary:{total_entries:0,entries_with_any_KO:0,entries_with_any_KO_pct:0,total_KO_items:0,avg_KO_per_entry:0},per_question:{},by_date:[]});

  TYPES.forEach(t=>{
    const obj=(kpi&&kpi[t])?kpi[t]:empty();
    const sum=obj.summary||empty().summary, perQ=obj.per_question||{}, series=Array.isArray(obj.by_date)?obj.by_date:[];
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
qs('#btnKpiRefresh')?.addEventListener('click', ()=> loadAndRenderKPI().catch(()=>{}) );

/* ===================== Export CSV / XLSX ===================== */
function downloadBlob_(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 200);
}
async function doExport_(fmt){ // 'csv' | 'xlsx'
  if(!CONFIG.WEBAPP_BASE_URL){ alert('URL backend non configurée'); return; }
  try{
    const url=new URL(CONFIG.WEBAPP_BASE_URL);
    url.searchParams.set('route','export');
    url.searchParams.set('format',fmt);
    showLoader('Génération export…');
    const r=await fetch(url.toString(), { method:'GET' });
    if(!r.ok) throw new Error('HTTP '+r.status);
    const blob=await r.blob();
    downloadBlob_(blob, `QC_${new Date().toISOString().slice(0,10)}.${fmt}`);
  }catch(e){
    alert('Erreur export: '+(e?.message||e));
  }finally{
    hideLoader();
  }
}
qs('#btnExportCsv')?.addEventListener('click', ()=> doExport_('csv'));
qs('#btnExportXlsx')?.addEventListener('click', ()=> doExport_('xlsx'));
