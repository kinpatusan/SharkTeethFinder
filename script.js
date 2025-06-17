// script.js – UI thread (worker-based) for Shark Tooth Detector PWA
// -----------------------------------------------------------------
// Requirements:
// • <video id="cam">  (hidden)
// • <canvas id="view">
// • <p id="status">Initializing…</p>
// • UI slider & camera <select> filled by this script
// • worker.js (same folder) + ort-web.min.js + best.onnx precached

(() => {
  const video  = document.getElementById('cam');
  const canvas = document.getElementById('view');
  const status = document.getElementById('status');
  const ctx = canvas.getContext('2d');

  // === UI elements (slider + camera select) ===
  const ui = document.createElement('div');
  Object.assign(ui.style, {
    position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,.55)', padding: '6px 12px', borderRadius: '8px',
    color: '#fff', fontSize: '14px', zIndex: 1000, whiteSpace: 'nowrap'
  });
  ui.innerHTML = `TH: <span id="thrVal">0.65</span>
    <input id="thr" type="range" min="0.10" max="0.90" step="0.05" value="0.65" style="width:120px;vertical-align:middle;">
    &nbsp;| Camera: <select id="camSel" style="background:#222;color:#fff;border-radius:4px;padding:2px 4px;"></select>`;
  document.body.appendChild(ui);
  const slider = document.getElementById('thr');
  const sliderVal = document.getElementById('thrVal');
  const camSel = document.getElementById('camSel');

  let TH = 0.65;
  slider.oninput = e => { TH = parseFloat(e.target.value); sliderVal.textContent = TH.toFixed(2); };

  // === Worker setup ===
  const wk = new Worker('worker.js');
  let workerReady = false;
  wk.onmessage = e => {
    const { type } = e.data;
    if (type === 'ready') {
      workerReady = true;
      status.textContent = 'Ready';
    }
    else if (type === 'bbox') {
      lastBoxes = new Float32Array(e.data.boxes); // copy back
      pending = false;
    }
  };
  wk.postMessage({ type: 'init', modelUrl: 'best.onnx', numThreads: 1 });

  // === Camera helpers ===
  let currentStream = null;
  async function listVideo() {
    const dev = await navigator.mediaDevices.enumerateDevices();
    return dev.filter(d => d.kind === 'videoinput');
  }
  async function populateCamSel() {
    const all = await listVideo();
    const rear = all.filter(c => /背面|rear|back/i.test(c.label));
    let ultra = rear.find(c => /超広角|ultra[- ]?wide/i.test(c.label));
    let wide  = rear.find(c => c !== ultra);
    if (!wide && rear[0]) wide = rear[0];
    if (!ultra && rear[1]) ultra = rear[1];
    camSel.innerHTML = '';
    const addOpt = (cam, label) => { if(!cam) return; const o=document.createElement('option'); o.value = cam.deviceId; o.textContent = label; camSel.appendChild(o); };
    addOpt(wide, '背面カメラ'); addOpt(ultra, '背面超広角カメラ');
    camSel.disabled = camSel.options.length <= 1;
  }
  async function setupCamera(deviceId=null) {
    if(currentStream) currentStream.getTracks().forEach(t=>t.stop());
    const constr = deviceId ? { video:{ deviceId:{exact:deviceId} }, audio:false } : { video:{ facingMode:'environment' }, audio:false };
    currentStream = await navigator.mediaDevices.getUserMedia(constr);
    video.srcObject = currentStream;
    await video.play();
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  camSel.onchange = async e => { status.textContent='Switching…'; await setupCamera(e.target.value); status.textContent='Ready'; };

  // === Letterbox helper ===
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = 640;
  const tctx = tmp.getContext('2d');

  function drawLetterbox() {
    const sw = video.videoWidth, sh = video.videoHeight;
    const s  = Math.min(640/sw, 640/sh);
    const dw = sw * s, dh = sh * s;
    const dx = (640 - dw) / 2, dy = (640 - dh) / 2;
    tctx.fillStyle = '#000';
    tctx.fillRect(0,0,640,640);
    tctx.drawImage(video, 0,0,sw,sh, dx,dy,dw,dh);
  }

  // === Main render loop ===
  let pending = false;
  let lastBoxes = null;
  async function loop() {
    if (video.readyState >= 2 && workerReady) {
      // 1. prepare frame for worker (every frame if not pending)
      if (!pending) {
        drawLetterbox();
        const bmp = await createImageBitmap(tmp);
        wk.postMessage({ type:'frame', bitmap:bmp }, [bmp]);
        pending = true;
      }
      // 2. draw camera to UI
      ctx.drawImage(video,0,0,video.videoWidth,video.videoHeight,0,0,canvas.width,canvas.height);
      // 3. draw boxes if any
      if (lastBoxes) {
        const sw = video.videoWidth, sh = video.videoHeight;
        const scaleX = canvas.width  / sw;
        const scaleY = canvas.height / sh;
        const arr = lastBoxes;
        for(let i=0;i<arr.length;i+=6){
          const conf = arr[i+4];
          if(conf<TH) continue;
          // reverse letterbox (same formula)
          const s = Math.min(640/sw, 640/sh);
          const dw = sw * s, dh = sh * s;
          const dx = (640 - dw)/2, dy = (640 - dh)/2;
          const vx1 = (arr[i]-dx)/s, vy1=(arr[i+1]-dy)/s;
          const vx2 = (arr[i+2]-dx)/s, vy2=(arr[i+3]-dy)/s;
          const x1 = vx1*scaleX, y1=vy1*scaleY, x2=vx2*scaleX, y2=vy2*scaleY;
          ctx.strokeStyle='red'; ctx.lineWidth=3; ctx.strokeRect(x1,y1,x2-x1,y2-y1);
          ctx.fillStyle='yellow'; ctx.font='14px sans-serif'; ctx.fillText(conf.toFixed(2), x1+4, y1+16);
        }
      }
    }
    requestAnimationFrame(loop);
  }

  // === Init sequence ===
  (async () => {
    status.textContent='Requesting camera…';
    await setupCamera();
    await populateCamSel();
    status.textContent='Camera OK – loading model…';
    // worker init already sent
    loop();
  })();
})();
