// script.js – Shark‑tooth detector PWA (UI thread)
// -----------------------------------------------------------------------------
// 2025‑06‑25  Portrait 4:3 full‑width, 1:1 detect, top/bottom mask – FINAL
// Camera labels: 2× (tele) / 1× (ultra‑wide) and default to 1×
// 2025‑06‑26  🛠 Fix: message type mismatch (box→bbox) & frame payload (image→bitmap)
// -----------------------------------------------------------------------------
(() => {
  /* === DOM === */
  const video  = document.getElementById('cam');
  const canvas = document.getElementById('view');
  const status = document.getElementById('status');
  const ctx    = canvas.getContext('2d');

  const maskT = document.getElementById('maskT');
  const maskB = document.getElementById('maskB');
  // hide left/right masks
  document.getElementById('maskL').style.display = 'none';
  document.getElementById('maskR').style.display = 'none';

  /* === UI (threshold slider & camera picker) === */
  const ui = document.createElement('div');
  Object.assign(ui.style, {
    position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,.45)', padding: '4px 12px', borderRadius: '8px', color: '#fff',
    fontSize: '14px', zIndex: 1000, whiteSpace: 'nowrap'
  });
  ui.innerHTML = `TH: <span id="thrVal">0.65</span><input id="thr" type="range" min="0" max="1" step="0.05" value="0.65" style="width:120px;vertical-align:middle;">&nbsp;| Camera: <select id="camSel" style="background:#222;color:#fff;border-radius:4px;padding:2px 4px;"></select>`;
  document.body.appendChild(ui);
  const slider    = document.getElementById('thr');
  const sliderVal = document.getElementById('thrVal');
  const camSel    = document.getElementById('camSel');
  let TH = 0.65;
  slider.oninput = e => { TH = +e.target.value; sliderVal.textContent = TH.toFixed(2); };

  /* === Worker === */
  const wk = new Worker('worker.js');
  let workerReady = false;
  wk.onmessage = e => {
    if (e.data.type === 'ready') {
      workerReady = true;
      status.textContent = 'Ready';
    } else if (e.data.type === 'bbox') {          // <‑‑ fixed (was "box")
      lastBoxes = new Float32Array(e.data.boxes);
      pending = false;
    }
  };
  wk.postMessage({ type: 'init', modelUrl: 'best.onnx', numThreads: 2 });

  /* === Camera helpers === */
  let currentStream = null;
  async function listCams() {
    return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  }

  async function populateCamSel() {
    const cams = await listCams();
    camSel.innerHTML = '';

    // Identify rear‑wide (≈2×) / ultra‑wide (≈1×) by label, fallback to first two cams
    let rear = null, ultra = null;
    cams.forEach(c => {
      const l = c.label;
      if (/背面カメラ|Tele|Back Camera/i.test(l)) rear = c;
      else if (/背面超広角|Ultra|Wide/i.test(l)) ultra = c;
    });
    if (!rear && cams[0]) rear = cams[0];
    if (!ultra && cams[1]) ultra = cams[1];

    const add = (c, l) => {
      if (!c) return; const o = document.createElement('option'); o.value = c.deviceId; o.textContent = l; camSel.appendChild(o);
    };
    add(rear,  '2×');   // formerly 背面カメラ
    add(ultra, '1×');   // formerly 背面超広角

    // default to 1× if present
    const idx1x = Array.from(camSel.options).findIndex(o => o.textContent === '1×');
    camSel.selectedIndex = idx1x !== -1 ? idx1x : 0;
    camSel.disabled = camSel.options.length <= 1;
  }

  async function setupCamera(deviceId) {
    if (currentStream) {
      currentStream.getTracks().forEach(t => t.stop());
      currentStream = null;
    }
    try {
      const constraints = deviceId ? { video: { deviceId: { exact: deviceId } }, audio: false }
                                    : { video: { facingMode: { exact: 'environment' } }, audio: false };
      currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = currentStream;
      await video.play();
      layout.update(video.videoWidth, video.videoHeight);
    } catch (err) {
      console.error('Unable to start camera:', err);
      status.textContent = 'Camera error';
    }
  }
  camSel.onchange = async e => {
    status.textContent = 'Switching…';
    await setupCamera(e.target.value);
    status.textContent = 'Ready';
  };

  /* === Layout === */
  const layout = {
    scale: 1, offsetX: 0, offsetY: 0, detectTop: 0,
    update(w, h) {
      if (!w || !h) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const aspect = 3 / 4; // portrait 3:4
      const fitW = vw, fitH = vw / aspect;
      this.scale = fitW / w;
      this.offsetX = 0;
      this.offsetY = (vh - fitH) / 2;
      this.detectTop = this.offsetY + (fitH - 640 * this.scale) / 2; // assuming 640×640 model input
      canvas.width = vw; canvas.height = vh;
    },
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // grey out top / bottom outside detect area
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, canvas.width, this.detectTop);
      ctx.fillRect(0, this.detectTop + 640 * this.scale, canvas.width, canvas.height - (this.detectTop + 640 * this.scale));
    }
  };
  window.addEventListener('resize', () => layout.update(video.videoWidth, video.videoHeight));

  /* === Worker input === */
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = 640;
  const tctx = tmp.getContext('2d');
  function feedWorker() {
    const sw = video.videoWidth, sh = video.videoHeight;
    if (!sw || !sh) return;
    tctx.drawImage(video, 0, 0, sw, sh, 0, 0, 640, 640);
    const bmp = tmp.transferToImageBitmap();              // <‑‑ new
    wk.postMessage({ type: 'frame', bitmap: bmp }, [bmp]); // <‑‑ fixed (was image)
  }

  /* === Render loop === */
  let pending = false, lastBoxes = null;
  function drawBoxes() {
    if (!lastBoxes) return;
    const s = layout.scale;
    for (let i = 0; i < lastBoxes.length; i += 5) {
      const [x1, y1, x2, y2, score] = lastBoxes.slice(i, i + 5);
      if (score < TH) continue;
      ctx.strokeStyle = '#0f0'; ctx.lineWidth = 2;
      ctx.strokeRect(x1 * s + layout.offsetX, y1 * s + layout.offsetY, (x2 - x1) * s, (y2 - y1) * s);
      ctx.fillStyle = '#0f0'; ctx.fillText((score * 100).toFixed(1) + '%', x1 * s + layout.offsetX + 4, y1 * s + layout.offsetY + 16);
    }
  }

  function loop() {
    if (video.readyState >= 2 && workerReady) {
      if (!pending) { pending = true; feedWorker(); }
      layout.clear();
      drawBoxes();
    }
    requestAnimationFrame(loop);
  }

  /* === Init === */
  (async () => {
    status.textContent = 'Requesting camera…';
    try {
      await populateCamSel();
      await setupCamera(camSel.value); // start with default (1× if present)
    } catch (err) {
      console.error(err);
      status.textContent = 'Camera permission denied';
      return;
    }
    status.textContent = 'Loading model…';
    loop();
  })();
})();
