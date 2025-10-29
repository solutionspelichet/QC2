/* ====== CONFIG (utiliser var pour éviter le double-déclaré) ====== */
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

/* ====== Theme ====== */
(function(){ const t=localStorage.getItem('qc_theme')||'light'; document.documentElement.setAttribute('data-theme', t); })();
qs('#themeToggle').addEventListener('click', ()=>{
  const cur=document.documentElement.getAttribute('data-theme');
  const nxt=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',nxt);
  localStorage.setItem('qc_theme',nxt);
});

/* ====== Tabs ====== */
on(qs('#tabs'), 'click', '.tab', (e,btn)=>{
  const target=btn.getAttribute('data-target');
  qsa('.tabs .tab').forEach(b=> b.classList.toggle('active', b===btn));
  qsa('.tabContent').forEach(s=> s.classList.toggle('active', s.id===target));
  if(target==='tabKPI'){ loadAndRenderKPI().catch(()=>{}); }
});

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
function showLoader(msg){ qs('#loaderMsg').textContent=msg||'Chargement...'; qs('#globalLoader').style.display='flex'; _loader++; }
function hideLoader(){ _loader=Math.max(0,_loader-1); if(!_loader) qs('#globalLoader').style.display='none'; }

/* ====== ZXing reader ====== */
function getZXReader(){
  if(window.ZXingBrowser && ZXingBrowser.BrowserMultiFormatReader) return new ZXingBrowser.BrowserMultiFormatReader();
  if(window.ZXing && ZXing.BrowserMultiFormatReader) return new ZXing.BrowserMultiFormatReader();
  alert('ZXing non chargé'); throw new Error('ZXing missing');
}

/* ====== Scanner live ====== */
let SCAN={reader:null, stream:null, target:null, running:false};
function openScannerFor(id){ SCAN.target=id; qs('#scannerModal').style.display='grid'; }
async function startScanner(){
  try{
    if(!SCAN.reader) SCAN.reader=getZXReader();
    const NS=(window.ZXingBrowser||window.ZXing);
    if(SCAN.reader.setHints){
      const hints=new Map();
      hints.set(NS.DecodeHintType.POSSIBLE_FORMATS, [NS.BarcodeFormat.EAN_13, NS.BarcodeFormat.CODE_128, NS.BarcodeFormat.CODE_39]);
      SCAN.reader.setHints(hints);
    }
    const v=qs('#scannerVideo'); v.setAttribute('playsinline','true'); v.muted=true;
    const st=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}, width:1280, height:720}});
    SCAN.stream=st; v.srcObject=st; await v.play(); SCAN.running=true;
    const loop=async ()=>{
      if(!SCAN.running) return;
      try{
        const res=await SCAN.reader.decodeOnceFromVideoDevice(undefined,'scannerVideo');
        const val=(res&&res.text)?res.text.trim():'';
        if(val){ const inp=document.getElementById(SCAN.target); if(inp) inp.value=val; closeScanner(); return; }
      }catch(_){}
      setTimeout(loop,250);
    };
    loop();
  }catch(e){ alert('Caméra non accessible: '+(e&&e.message||e)); stopScanner(); }
}
function stopScanner(){ SCAN.running=false; try{SCAN.reader&&SCAN.reader.reset&&SCAN.reader.reset();}catch(_){}
  if(SCAN.stream){ SCAN.stream.getTracks().forEach(t=>{try{t.stop()}catch(_){}}); SCAN.stream=null; } }
function closeScanner(){ stopScanner(); qs('#scannerModal').style.display='none'; }
qs('#scannerStart').addEventListener('click', startScanner);
qs('#scannerStop').addEventListener('click', stopScanner);
qs('#scannerClose').addEventListener('click', closeScanner);

/* ====== Décodage depuis photo (upload) ====== */
on(document,'change','input.barcode-photo', async (e,input)=>{
  await decodeBarcodeFromFile(input, input.getAttribute('data-target'));
});

async function decodeBarcodeFromFile(inputEl, targetId){
  const file = inputEl.files && inputEl.files[0];
  if(!file) return;
  try{
    const reader = getZXReader();
    const NS=(window.ZXingBrowser||window.ZXing);
    if(reader.setHints){
      const hints=new Map();
      hints.set(NS.DecodeHintType.POSSIBLE_FORMATS,[NS.BarcodeFormat.EAN_13,NS.BarcodeFormat.CODE_128,NS.BarcodeFormat.CODE_39]);
      reader.setHints(hints);
    }

    const img = await imageFromFileRaw_(file);
    const scales=[1.0,0.8,0.6,0.45]; // multi-échelles pour aider ZXing
    for(const sc of scales){
      const canvas = canvasFromImageNormalize_(img, sc, 1600, true);
      try{
        if(reader.decodeFromCanvas){
          const res = await reader.decodeFromCanvas(canvas);
          const txt = (res&&res.text)?res.text.trim():'';
          if(txt){ const t=document.getElementById(targetId); if(t) t.value=txt; return; }
        }
      }catch(_){}
      try{
        const url=canvas.toDataURL('image/jpeg', 0.92);
        const tmp = await imageFromDataURL_(url);
        if(reader.decodeFromImage){
          const res=await reader.decodeFromImage(tmp);
          const txt=(res&&res.text)?res.text.trim():'';
          if(txt){ const t=document.getElementById(targetId); if(t) t.value=txt; return; }
        }else if(reader.decodeFromImageElement){
          const res=await reader.decodeFromImageElement(tmp);
          const txt=(res&&res.text)?res.text.trim():'';
          if(txt){ const t=document.getElementById(targetId); if(t) t.value=txt; return; }
        }
      }catch(_){}
    }
    alert("Aucun code-barres détecté sur l'image. Éclaire, recadre, évite le flou.");
  }catch(e){ alert('Échec décodage image: '+(e&&e.message||e)); }
}

function imageFromFileRaw_(file){
  return new Promise((ok,ko)=>{
    const fr=new FileReader();
    fr.onload=()=>{ const img=new Image(); img.onload=()=>ok(img); img.onerror=ko; img.src=fr.result; };
    fr.onerror=ko; fr.readAsDataURL(file);
  });
}
function imageFromDataURL_(dataURL){
  return new Promise((ok,ko)=>{ const img=new Image(); img.onload=()=>ok(img); img.onerror=ko; img.src=dataURL; });
}
function canvasFromImageNormalize_(img, scale, maxDim, boostContrast){
  const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
  let w=iw, h=ih;
  const maxSide=Math.max(w,h);
  if(maxSide>maxDim){ const sc=maxDim/maxSide; w=Math.round(w*sc); h=Math.round(h*sc); }
  w=Math.round(w*scale); h=Math.round(h*scale);
  if(w<8||h<8){ w=Math.max(8,w); h=Math.max(8,h); }
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d',{alpha:false, desynchronized:true});
  ctx.drawImage(img,0,0,w,h);
  if(boostContrast){
    const id=ctx.getImageData(0,0,w,h), d=id.data, gamma=0.9, contrast=1.2, mid=128;
    for(let i=0;i<d.length;i+=4){
      let r=d[i], g=d[i+1], b=d[i+2];
      r=255*Math.pow(r/255,gamma); g=255*Math.pow(g/255,gamma); b=255*Math.pow(b/255,gamma);
      r=(r-mid)*contrast+mid; g=(g-mid)*contrast+mid; b=(b-mid)*contrast+mid;
      d[i]=Math.max(0,Math.min(255,r)); d[i+1]=Math.max(0,Math.min(255,g)); d[i+2]=Math.max(0,Math.min(255,b));
    }
    ctx.putImageData(id,0,0);
  }
  return c;
}

/* ====== Compression images (≤ 600 Ko) ====== */
function fileToDataURL(file){ return new Promise((ok,ko)=>{ const fr=new FileReader(); fr.onload=()=>ok(fr.result); fr.onerror=ko; fr.readAsDataURL(file); }); }
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
  return out; // dataURL
}
async function filesToDataURLsLimited(list){ const out=[]; for(const f of Array.from(list||[])) out.push(await resizeToLimit(f)); return out; }

/* ====== Build payload JSON ====== */
// --- PATCH buildPayload (remplace entièrement la fonction) ---
async function buildPayload(form){
  const date = qs('input[name="date_saisie"]', form).value.trim();
  const code = qs('input[name="code_barres"]', form).value.trim();

  // photo principale (compressée)
  const main = qs('input[name="photo_principale"]', form).files[0];
  const photo_principale = main ? await resizeToLimit(main) : null;

  const answers = [];
  const blocks = qsa('.qblock', form);

  // Utiliser for...of pour pouvoir await
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
          // compression <= 600 Ko par image
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
      alert('✔ Enregistré'); // reset léger mais on reste sur l’onglet
      // reset contrôlé
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
  const base=CONFIG.WEBAPP_BASE_URL; const box=qs('#kpiResults'); if(!base){ box.textContent='Backend non configuré'; return; }
  const url=new URL(base); url.searchParams.set('route','kpi');
  box.textContent='Chargement KPI…'; showLoader('Chargement KPI…');
  try{
    const js=await fetch(url.toString()).then(r=>r.json());
    if(!js.ok){ box.textContent='Erreur KPI : '+(js.error||'inconnue'); return; }
    renderKPI(js.kpi);
  }catch{ box.textContent='Erreur KPI réseau.'; }
  finally{ hideLoader(); }
}
function renderKPI(kpi){
  CHARTS.forEach(c=>{try{c.destroy()}catch{}}); CHARTS=[];
  const wrap=qs('#kpiResults'); wrap.innerHTML='';
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
qs('#btnKpiRefresh')?.addEventListener('click', ()=> loadAndRenderKPI().catch(()=>{}) );
