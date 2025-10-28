/* ===== CONFIG (unique) ===== */
(function(){
  if(!window.CONFIG){
    window.CONFIG = {
      WEBAPP_BASE_URL: "", // <-- colle ici ton URL /exec
      RESIZE_ENABLED: true,
      MAX_IMAGE_DIM: 1600,
      OUTPUT_MIME: "image/jpeg",
      QUALITY: 0.85,
      MAX_FILE_SIZE_KB: 600
    };
  }
})();

/* ===== Helpers ===== */
const qs = (s, el=document)=> el.querySelector(s);
const qsa= (s, el=document)=> Array.from(el.querySelectorAll(s));
function todayStr(){ const d=new Date(); const p=n=>n<10?'0'+n:n; return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }

let CHARTS = []; // KPI charts
let _scanner = { stream:null, reader:null, targetInputId:null, running:false };

/* ===== Loader ===== */
let _loader=0;
function showLoader(msg){
  let el=qs('#globalLoader');
  if(!el){ el=document.createElement('div'); el.id='globalLoader';
    el.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);z-index:9999';
    el.innerHTML=`<div style="background:#111;color:#fff;padding:14px 16px;border-radius:12px;min-width:220px;text-align:center">
      <div style="width:28px;height:28px;border:3px solid #999;border-top-color:#ff6a00;border-radius:50%;margin:0 auto 8px;animation:spin .8s linear infinite"></div>
      <div id="loaderMsg">${msg||'Chargement...'}</div>
    </div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(el);
  }
  qs('#loaderMsg', el).textContent = msg || 'Chargement...';
  el.style.display='flex'; _loader++;
}
function hideLoader(){ _loader=Math.max(0,_loader-1); const el=qs('#globalLoader'); if(el && !_loader) el.style.display='none'; }

/* ===== Fetch ===== */
function fetchWithTimeout(url, opts={}, ms=30000){
  return new Promise((res,rej)=>{
    const ctl=new AbortController(); const id=setTimeout(()=>{ctl.abort(); rej(new Error('Timeout'))}, ms);
    fetch(url, {...opts, signal:ctl.signal}).then(r=>{clearTimeout(id);res(r)}).catch(e=>{clearTimeout(id);rej(e)});
  });
}

/* ===== UI setup ===== */
function setupTheme(){
  const t=localStorage.getItem('qc_theme')||'light';
  document.documentElement.setAttribute('data-theme', t);
  const btn=qs('#themeToggle');
  if(btn) btn.addEventListener('click', ()=>{
    const cur=document.documentElement.getAttribute('data-theme');
    const nxt=cur==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme', nxt);
    localStorage.setItem('qc_theme', nxt);
  });
}
function setupTabs(){
  const tabs=qsa('.tabs .tab'); const sections=qsa('.tabContent');
  tabs.forEach(b=>b.addEventListener('click', ()=>{
    tabs.forEach(x=>x.classList.remove('active')); b.classList.add('active');
    const t=b.dataset.target;
    sections.forEach(s=> s.classList.toggle('active', s.id===t));
    if(t==='tabKPI') loadAndRenderKPI().catch(()=>{});
  }));
}
function setDefaults(){
  qsa('input[type="date"]').forEach(i=> { if(!i.value) i.value=todayStr(); });
  qsa('form.qcForm select').forEach(s=> { if(!s.value) s.value='OK'; });
}
function setupKO(){
  qsa('.qblock').forEach(block=>{
    const sel=qs('select',block), details=qs('.koDetails',block);
    if(!sel || !details) return;
    const sync=()=>{
      const isKO=(sel.value||'').toUpperCase()==='KO';
      details.classList.toggle('hidden', !isKO);
      qsa('input[type="file"]', details).forEach(f=> f.required=isKO);
      const ta=qs('textarea', details); if(ta) ta.required=isKO;
    };
    sel.addEventListener('change', sync); sync();
  });
}

/* ===== Images (≤600 Ko) ===== */
function fileToDataURL(file){ return new Promise((ok,ko)=>{ const fr=new FileReader(); fr.onload=()=>ok(fr.result); fr.onerror=ko; fr.readAsDataURL(file); }); }
function imageFromFile(file){
  return new Promise((ok,ko)=>{
    const fr=new FileReader();
    fr.onload=()=>{ const img=new Image(); img.onload=()=>ok(img); img.onerror=ko; img.src=fr.result; };
    fr.onerror=ko; fr.readAsDataURL(file);
  });
}
function guessExt(file){ const t=(file&&file.type)||''; if(t.includes('png')) return 'png'; if(t.includes('webp')) return 'webp'; if(t.includes('heic')||t.includes('heif')) return 'heic'; return 'jpg'; }
async function resizeToLimit(file){
  if(!CONFIG.RESIZE_ENABLED) return { dataUrl: await fileToDataURL(file), ext: guessExt(file) };
  const img = await imageFromFile(file);
  const maxDim=CONFIG.MAX_IMAGE_DIM||1600, mime=CONFIG.OUTPUT_MIME||'image/jpeg';
  let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height, scale=1;
  if(w>h && w>maxDim) scale=maxDim/w; if(h>=w && h>maxDim) scale=maxDim/h; if(scale<=0) scale=1;
  const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w*scale)); c.height=Math.max(1,Math.round(h*scale));
  const ctx=c.getContext('2d',{alpha:false,desynchronized:true}); ctx.drawImage(img,0,0,c.width,c.height);
  let q=CONFIG.QUALITY||0.85; let out=c.toDataURL(mime,q);
  const toKB=d=>Math.round((d.length*3/4)/1024); while(toKB(out)>(CONFIG.MAX_FILE_SIZE_KB||600) && q>0.4){ q=Math.max(0.4,q-0.08); out=c.toDataURL(mime,q); }
  return { dataUrl: out, ext: mime.split('/')[1]||'jpg' };
}
async function filesToDataURLsLimited(list){ const out=[]; for(const f of Array.from(list||[])) out.push(await resizeToLimit(f)); return out; }

/* ===== Build payload ===== */
async function buildPayload(form){
  const date=qs('input[name="date_saisie"]',form).value.trim();
  const code=qs('input[name="code_barres"]',form).value.trim();
  const main=qs('input[name="photo_principale"]',form).files[0];
  const photo_principale = main ? await resizeToLimit(main) : null;

  const answers=[];
  qsa('.qblock',form).forEach(b=>{
    const sel=qs('select',b); if(!sel) return;
    const field=sel.name, value=sel.value||'OK';
    const details=qs('.koDetails',b);
    let photos=[], commentaire='';
    if((value||'').toUpperCase()==='KO' && details){
      const files=qsa('input[type="file"]', details).flatMap(i=> Array.from(i.files||[]));
      if(files.length){ photos = await filesToDataURLsLimited(files); }
      const ta=qs('textarea', details); if(ta) commentaire=(ta.value||'').trim();
    }
    answers.push({field,value,photos,commentaire});
  });

  return { date_jour:date, code_barres:code, photo_principale, answers };
}

/* ===== Submit ===== */
async function postQC(form){
  const base=CONFIG.WEBAPP_BASE_URL;
  if(!base){ alert('URL backend non configurée'); throw new Error('No backend'); }
  const type=form.dataset.type;

  const url=new URL(base); url.searchParams.set('route','qc'); url.searchParams.set('type',type);
  const payload=await buildPayload(form);
  const btn=qs('button[type="submit"]',form); btn && (btn.disabled=true);

  showLoader('Envoi en cours…');
  try{
    const r = await fetchWithTimeout(url.toString(), {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:'payload='+encodeURIComponent(JSON.stringify(payload))
    }, 90000);
    const js=await r.json();
    if(!js.ok) { alert('Erreur backend: '+(js.error||'inconnue')); return; }
    alert('✔ Enregistré ('+(js.sheet||type)+')');
    // Reset minimal (date conservée)
    qsa('select',form).forEach(s=> s.value='OK');
    qsa('.koDetails',form).forEach(d=>{
      d.classList.add('hidden');
      qsa('input[type="file"]',d).forEach(i=> i.value='');
      const ta=qs('textarea',d); if(ta) ta.value='';
    });
    const code=qs('input[name="code_barres"]',form); if(code) code.value='';
    const photo=qs('input[name="photo_principale"]',form); if(photo) photo.value='';
  }catch(e){
    alert('Échec réseau: '+(e&&e.message||e));
  }finally{
    hideLoader(); btn && (btn.disabled=false);
  }
}
function setupForms(){
  qsa('form.qcForm').forEach(f=>{
    f.addEventListener('submit', async e=>{
      e.preventDefault();
      if(!qs('input[name="date_saisie"]',f).value || !qs('input[name="code_barres"]',f).value){
        alert('Date et code-barres sont obligatoires.'); return;
      }
      // Double-check KO
      let ok=true;
      qsa('.qblock',f).forEach(b=>{
        const sel=qs('select',b), isKO=(sel.value||'').toUpperCase()==='KO';
        if(isKO){
          const d=qs('.koDetails',b);
          const hasFile=qsa('input[type="file"]',d).some(i=>i.files&&i.files.length);
          const hasComment=(qs('textarea',d)?.value||'').trim().length>0;
          if(!hasFile || !hasComment) ok=false;
        }
      });
      if(!ok){ alert('Pour chaque KO: photo(s) et commentaire obligatoires.'); return; }
      await postQC(f);
    });
  });
}

/* ===== KPI ===== */
async function loadAndRenderKPI(){
  const base=CONFIG.WEBAPP_BASE_URL; if(!base){ qs('#kpiResults').textContent='Backend non configuré'; return; }
  const url=new URL(base); url.searchParams.set('route','kpi');
  const box=qs('#kpiResults'); box.textContent='Chargement KPI…';
  showLoader('Chargement KPI…');
  try{
    const js=await fetchWithTimeout(url.toString(), {}, 30000).then(r=>r.json());
    if(!js.ok){ box.textContent='Erreur KPI: '+(js.error||'inconnue'); return; }
    renderKPI(js.kpi);
  }catch{ box.textContent='Erreur KPI réseau.'; }
  finally{ hideLoader(); }
}
function renderKPI(kpi){
  CHARTS.forEach(c=>{ try{c.destroy()}catch{} }); CHARTS=[];
  const wrap=qs('#kpiResults'); wrap.innerHTML='';

  const TYPES=['Cartons','Palettes_Avant','Palettes_Destination'];
  const empty=()=>({summary:{total_entries:0,entries_with_any_KO:0,entries_with_any_KO_pct:0,total_KO_items:0,avg_KO_per_entry:0},per_question:{},by_date:[]});

  TYPES.forEach(t=>{
    const obj=(kpi&&kpi[t])?kpi[t]:empty(), sum=obj.summary||empty().summary, perQ=obj.per_question||{}, series=Array.isArray(obj.by_date)?obj.by_date:[];
    const cardS=document.createElement('div'); cardS.className='kpi-card'; cardS.innerHTML=
      `<h3>${t} — Synthèse</h3>
       <div><b>Contrôles</b>: ${sum.total_entries} &nbsp;|&nbsp; <b>≥1 KO</b>: ${sum.entries_with_any_KO} (${sum.entries_with_any_KO_pct}%) &nbsp;|&nbsp; <b>Total KO</b>: ${sum.total_KO_items} &nbsp;|&nbsp; <b>KO/entrée</b>: ${sum.avg_KO_per_entry}</div>`;
    wrap.appendChild(cardS);

    const rows = Object.keys(perQ).map(q=>{
      const it=perQ[q]||{OK:0,KO:0,ko_pct:0};
      return `<tr><td>${q}</td><td>${it.OK}</td><td>${it.KO}</td><td>${it.ko_pct}%</td></tr>`;
    }).join('');
    const cardT=document.createElement('div'); cardT.className='kpi-card'; cardT.innerHTML=
      `<h3>${t} — Par point</h3>
       <table class="kpi"><thead><tr><th>Point</th><th>OK</th><th>KO</th><th>% KO</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Aucune donnée</td></tr>'}</tbody></table>`;
    wrap.appendChild(cardT);

    const labels=series.map(s=>s.date), data=series.map(s=>s.taux_ko_pct);
    const cardG=document.createElement('div'); cardG.className='kpi-card'; cardG.innerHTML=`<h3>${t} — Taux KO % par jour</h3><div class="chart"><canvas></canvas></div>`;
    wrap.appendChild(cardG);
    if(typeof Chart!=='undefined'){
      const ctx=qs('canvas',cardG).getContext('2d');
      const ch=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'% KO',data,tension:.2,pointRadius:3}]},
        options:{responsive:true,maintainAspectRatio:false,animation:false,transitions:{active:{animation:{duration:0}}},
          scales:{y:{beginAtZero:true,ticks:{callback:v=>`${v}%`}}},plugins:{legend:{display:false},tooltip:{animation:false}}}});
      CHARTS.push(ch);
    } else { const p=document.createElement('p'); p.textContent='Chart.js non chargé'; cardG.appendChild(p); }
  });

  const total=(kpi?.Cartons?.summary?.total_entries||0)+(kpi?.Palettes_Avant?.summary?.total_entries||0)+(kpi?.Palettes_Destination?.summary?.total_entries||0);
  if(total===0){ const p=document.createElement('p'); p.textContent='Aucune donnée.'; wrap.appendChild(p); }
}

/* ===== Scanner (iPhone-friendly) ===== */
function openScannerFor(id){ _scanner.targetInputId=id; qs('#scannerModal').style.display='grid'; }
function closeScanner(){ stopScanner(); qs('#scannerModal').style.display='none'; }
async function startScanner(){
  try{
    if(!_scanner.reader){
      if(window.ZXingBrowser && ZXingBrowser.BrowserMultiFormatReader) _scanner.reader=new ZXingBrowser.BrowserMultiFormatReader();
      else if(window.ZXing && ZXing.BrowserMultiFormatReader) _scanner.reader=new ZXing.BrowserMultiFormatReader();
      else { alert('ZXing non chargé'); return; }
    }
    const video=qs('#scannerVideo'); video.setAttribute('playsinline','true'); video.muted=true;
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
    _scanner.stream=stream; video.srcObject=stream; await video.play();

    // Hints/formats
    const NS=(window.ZXingBrowser||window.ZXing);
    if(_scanner.reader.setHints){
      const hints=new Map(); hints.set(NS.DecodeHintType.POSSIBLE_FORMATS,[NS.BarcodeFormat.EAN_13,NS.BarcodeFormat.CODE_128,NS.BarcodeFormat.CODE_39]);
      _scanner.reader.setHints(hints);
    }
    _scanner.running=true;

    const tick=async()=>{
      if(!_scanner.running) return;
      try{
        const res=await _scanner.reader.decodeOnceFromVideoDevice(undefined,'scannerVideo');
        const val=(res && (res.text || res.getText && res.getText()) || '').trim();
        if(val){ const input=document.getElementById(_scanner.targetInputId); if(input) input.value=val; closeScanner(); return; }
      }catch(_){}
      setTimeout(tick,250);
    };
    setTimeout(tick,250);
  }catch(e){
    alert("Caméra non accessible. Autorise l'accès dans Safari. Détail: "+(e&&e.message||e)); stopScanner();
  }
}
function stopScanner(){
  _scanner.running=false;
  try{ _scanner.reader && _scanner.reader.reset && _scanner.reader.reset(); }catch(_){}
  if(_scanner.stream){ _scanner.stream.getTracks().forEach(t=>{try{t.stop()}catch(_){}}); _scanner.stream=null; }
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', ()=>{
  setupTheme(); setupTabs(); setDefaults(); setupKO(); setupForms();

  // Boutons scanner
  qsa('button[data-scan]').forEach(b=> b.addEventListener('click', ()=> openScannerFor(b.getAttribute('data-scan')) ));
  const bS=qs('#scannerStart'), bP=qs('#scannerStop'), bC=qs('#scannerClose');
  if(bS) bS.addEventListener('click', startScanner);
  if(bP) bP.addEventListener('click', stopScanner);
  if(bC) bC.addEventListener('click', closeScanner);

  // Si on arrive sur KPI
  if(qs('#tabKPI').classList.contains('active')) loadAndRenderKPI().catch(()=>{});
});
