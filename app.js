/*** CONFIGURATION PRINCIPALE ***/
const CONFIG = {
  WEBAPP_BASE_URL: "https://script.google.com/macros/s/AKfycbyy826nPPtVW-HpyUSqzhJ-Eoq42_-rXhYHW3WXi3rT9cZ61dW264c7DDnfagnrXjM7/exec",
  MAX_IMAGE_DIM: 1600,
  MAX_FILE_SIZE_KB: 600,
  QUALITY: 0.85
};

/*** OUTILS DE BASE ***/
const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));
const todayStr = () => {
  const d = new Date();
  const pad = (n) => (n < 10 ? "0" + n : n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/*** INIT THEMES ***/
(function () {
  const theme = localStorage.getItem("qc_theme") || "light";
  document.documentElement.setAttribute("data-theme", theme);
})();
qs("#themeToggle").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("qc_theme", next);
});

/*** BASCULE ONGLET ***/
on(qs("#tabs"), "click", ".tab", (e, btn) => {
  const target = btn.getAttribute("data-target");
  qsa(".tab").forEach((b) => b.classList.toggle("active", b === btn));
  qsa(".tabContent").forEach((t) => t.classList.toggle("active", t.id === target));
});

/*** OUTILS ÉVÉNEMENTS ***/
function on(el, ev, selOrFn, maybeFn) {
  if (typeof selOrFn === "function") el.addEventListener(ev, selOrFn);
  else
    el.addEventListener(ev, (e) => {
      const t = e.target.closest(selOrFn);
      if (t) maybeFn(e, t);
    });
}

/*** DATE PAR DÉFAUT ET OK AUTO ***/
qsa('input[type="date"]').forEach((i) => {
  if (!i.value) i.value = todayStr();
});
qsa("form.qcForm select").forEach((s) => {
  if (!s.value) s.value = "OK";
});

/*** KO → CHAMPS SUPPLÉMENTAIRES ***/
on(document, "change", ".qblock select", (e, sel) => {
  const block = sel.closest(".qblock");
  const details = qs(".koDetails", block);
  if (!details) return;
  const isKO = (sel.value || "").toUpperCase() === "KO";
  details.classList.toggle("hidden", !isKO);
  qsa('input[type="file"], textarea', details).forEach((el) => (el.required = isKO));
});

/*** GESTION LOADER ***/
let loaderCount = 0;
function showLoader(msg) {
  qs("#loaderMsg").textContent = msg || "Chargement...";
  qs("#globalLoader").style.display = "flex";
  loaderCount++;
}
function hideLoader() {
  loaderCount = Math.max(0, loaderCount - 1);
  if (!loaderCount) qs("#globalLoader").style.display = "none";
}

/*** ZXING SCANNER ***/
let SCAN = { reader: null, stream: null, target: null, running: false };
function getZXReader() {
  if (window.ZXingBrowser && ZXingBrowser.BrowserMultiFormatReader)
    return new ZXingBrowser.BrowserMultiFormatReader();
  if (window.ZXing && ZXing.BrowserMultiFormatReader)
    return new ZXing.BrowserMultiFormatReader();
  alert("ZXing non chargé !");
  throw new Error("ZXing manquant");
}

/*** SCANNER (LIVE CAMERA) ***/
function openScannerFor(id) {
  SCAN.target = id;
  qs("#scannerModal").style.display = "grid";
}
async function startScanner() {
  try {
    if (!SCAN.reader) SCAN.reader = getZXReader();
    const NS = window.ZXingBrowser || window.ZXing;
    const hints = new Map();
    hints.set(NS.DecodeHintType.POSSIBLE_FORMATS, [
      NS.BarcodeFormat.EAN_13,
      NS.BarcodeFormat.CODE_128,
      NS.BarcodeFormat.CODE_39
    ]);
    SCAN.reader.setHints(hints);

    const v = qs("#scannerVideo");
    const st = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: 1280, height: 720 }
    });
    SCAN.stream = st;
    v.srcObject = st;
    await v.play();
    SCAN.running = true;

    const loop = async () => {
      if (!SCAN.running) return;
      try {
        const res = await SCAN.reader.decodeOnceFromVideoDevice(undefined, "scannerVideo");
        const val = (res && res.text) ? res.text.trim() : "";
        if (val) {
          const inp = document.getElementById(SCAN.target);
          if (inp) inp.value = val;
          closeScanner();
          return;
        }
      } catch (_) {}
      setTimeout(loop, 250);
    };
    loop();
  } catch (e) {
    alert("Caméra non accessible : " + e.message);
    stopScanner();
  }
}
function stopScanner() {
  SCAN.running = false;
  if (SCAN.reader && SCAN.reader.reset) SCAN.reader.reset();
  if (SCAN.stream) {
    SCAN.stream.getTracks().forEach((t) => t.stop());
    SCAN.stream = null;
  }
}
function closeScanner() {
  stopScanner();
  qs("#scannerModal").style.display = "none";
}
qs("#scannerStart").addEventListener("click", startScanner);
qs("#scannerStop").addEventListener("click", stopScanner);
qs("#scannerClose").addEventListener("click", closeScanner);

/*** DÉCODAGE D’IMAGE DEPUIS FICHIER ***/
on(document, "change", "input.barcode-photo", async (e, input) => {
  await decodeBarcodeFromFile(input, input.getAttribute("data-target"));
});

async function decodeBarcodeFromFile(inputEl, targetId) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  try {
    const reader = getZXReader();
    const NS = window.ZXingBrowser || window.ZXing;
    const hints = new Map();
    hints.set(NS.DecodeHintType.POSSIBLE_FORMATS, [
      NS.BarcodeFormat.EAN_13,
      NS.BarcodeFormat.CODE_128,
      NS.BarcodeFormat.CODE_39
    ]);
    reader.setHints(hints);

    const img = await imageFromFileRaw_(file);
    const scales = [1.0, 0.8, 0.6, 0.45];
    for (const sc of scales) {
      const canvas = canvasFromImageNormalize_(img, sc, 1600, true);
      try {
        const res = await reader.decodeFromCanvas(canvas);
        const txt = (res && res.text) ? res.text.trim() : "";
        if (txt) {
          const t = document.getElementById(targetId);
          if (t) t.value = txt;
          return;
        }
      } catch (_) {}
    }
    alert("Aucun code-barres détecté sur l’image (essaie plus net et bien éclairé).");
  } catch (e) {
    alert("Erreur de décodage : " + e.message);
  }
}

function imageFromFileRaw_(file) {
  return new Promise((ok, ko) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = ko;
      img.src = fr.result;
    };
    fr.onerror = ko;
    fr.readAsDataURL(file);
  });
}

function canvasFromImageNormalize_(img, scale, maxDim, boostContrast) {
  const iw = img.naturalWidth || img.width,
    ih = img.naturalHeight || img.height;
  let w = iw,
    h = ih;
  const maxSide = Math.max(w, h);
  if (maxSide > maxDim) {
    const sc = maxDim / maxSide;
    w = Math.round(w * sc);
    h = Math.round(h * sc);
  }
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { alpha: false });
  ctx.drawImage(img, 0, 0, w, h);
  if (boostContrast) {
    const d = ctx.getImageData(0, 0, w, h);
    const data = d.data;
    const contrast = 1.3,
      gamma = 0.9;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      r = 255 * Math.pow(r / 255, gamma);
      g = 255 * Math.pow(g / 255, gamma);
      b = 255 * Math.pow(b / 255, gamma);
      const mid = 128;
      r = (r - mid) * contrast + mid;
      g = (g - mid) * contrast + mid;
      b = (b - mid) * contrast + mid;
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }
    ctx.putImageData(d, 0, 0);
  }
  return c;
}

/*** ENVOI DU FORMULAIRE ***/
on(document, "submit", "form.qcForm", async (e, form) => {
  e.preventDefault();
  try {
    showLoader("Envoi en cours...");
    const type = form.dataset.type;
    const fd = new FormData(form);
    const resp = await fetch(`${CONFIG.WEBAPP_BASE_URL}?route=qc&type=${type}`, {
      method: "POST",
      body: fd
    });
    const json = await resp.json();
    hideLoader();
    if (json.ok) {
      alert("✅ Données envoyées !");
      form.reset();
      qsa('input[type="date"]', form).forEach((i) => (i.value = todayStr()));
      qsa("select", form).forEach((s) => (s.value = "OK"));
    } else {
      alert("Erreur : " + (json.error || "inconnue"));
    }
  } catch (err) {
    hideLoader();
    alert("Erreur réseau : " + err.message);
  }
});
