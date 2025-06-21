// script.js – UI thread (worker-based) for Shark-Tooth Detector PWA
// -----------------------------------------------------------------
// 2025-06 4:3 レターボックス版
// 変更点
//  1. 画面中央に 4:3 フレーム（Letterbox）を生成
//  2. 余白は半透明マスクで暗転表示 → 「ここは検知対象外」と示す
//  3. キャンバス／ビデオの動的リサイズを追加
//
// 必要要素
// <div id="wrap">
//   <video id="cam" autoplay playsinline muted></video>
//   <canvas id="view"></canvas>
//   <p id="status">Initializing…</p>
// </div>
// ※wrap は body 直下に置く。CSS は本スクリプト末尾参照

(() => {
  // ──────────────────────────────────
  // DOM 取得
  // ──────────────────────────────────
  const wrap   = document.getElementById('wrap');
  const video  = document.getElementById('cam');
  const canvas = document.getElementById('view');
  const status = document.getElementById('status');
  const ctx    = canvas.getContext('2d');

  // ──────────────────────────────────
  // UI (スライダー + カメラ選択)
  // ──────────────────────────────────
  const ui = document.createElement('div');
  Object.assign(ui.style, {
    position: 'fixed',
    top: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,.55)',
    padding: '6px 12px',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    zIndex: 1000,
    whiteSpace: 'nowrap'
  });
  ui.innerHTML = `
    TH: <span id="thrVal">0.70</span>
    <input id="thr" type="range" min="0.10" max="0.90" step="0.05" value="0.70" style="width:120px;vertical-align:middle;">
    &nbsp;| Camera:
    <select id="camSel" style="background:#222;color:#fff;border-radius:4px;padding:2px 4px;"></select>`;
  document.body.appendChild(ui);
  const slider    = document.getElementById('thr');
  const sliderVal = document.getElementById('thrVal');
  const camSel    = document.getElementById('camSel');

  let TH = 0.70;
  slider.oninput = e => {
    TH = parseFloat(e.target.value);
    sliderVal.textContent = TH.toFixed(2);
  };

  // ──────────────────────────────────
  // Web Worker
  // ──────────────────────────────────
  const wk = new Worker('worker.js');
  let workerReady = false;
  wk.onmessage = e => {
    const { type } = e.data;
    if (type === 'ready') {
      workerReady = true;
      status.textContent = 'Ready';
    } else if (type === 'bbox') {
      lastBoxes = new Float32Array(e.data.boxes); // copy back
      pending = false;
    }
  };
  wk.postMessage({ type: 'init', modelUrl: 'best.onnx', numThreads: 2 });

  // ──────────────────────────────────
  // カメラ検出 & 切替
  // ──────────────────────────────────
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
    const addOpt = (cam, label) => {
      if (!cam) return;
      const o = document.createElement('option');
      o.value = cam.deviceId;
      o.textContent = label;
      camSel.appendChild(o);
    };
    addOpt(wide, '背面カメラ');
    addOpt(ultra, '背面超広角カメラ');
    camSel.disabled = camSel.options.length <= 1;
  }
  async function setupCamera(deviceId = null) {
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    const constr = deviceId
      ? { video: { deviceId: { exact: deviceId } }, audio: false }
      : { video: { facingMode: 'environment' }, audio: false };
    currentStream = await navigator.mediaDevices.getUserMedia(constr);
    video.srcObject = currentStream;
    await video.play();
    resizeToFourThree(); // → canvas size 更新
  }
  camSel.onchange = async e => {
    status.textContent = 'Switching…';
    await setupCamera(e.target.value);
    status.textContent = 'Ready';
  };

  // ──────────────────────────────────
  // 4:3 フレーム計算 & リサイズ
  // ──────────────────────────────────
  function resizeToFourThree() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 画角比 (4:3) を基準に最大化
    let w = vw, h = (vw * 3) / 4;
    if (h > vh) {
      h = vh;
      w = (vh * 4) / 3;
    }

    // video と canvas のサイズ・位置を変更
    [video, canvas].forEach(el => {
      el.style.width  = `${w}px`;
      el.style.height = `${h}px`;
      el.style.left   = '50%';
      el.style.top    = '50%';
      el.style.transform = 'translate(-50%,-50%)';
      el.width  = w;
      el.height = h;
    });

    // wrap 全体に黒背景 (マスク色)
    wrap.style.background = 'black';
  }
  window.addEventListener('resize', resizeToFourThree);

  // ──────────────────────────────────
  // Letterbox 用 tmpCanvas (640×480)
  // ──────────────────────────────────
  const tmp = document.createElement('canvas');
  tmp.width = 640;
  tmp.height = 480; // 4:3

  const tctx = tmp.getContext('2d');

  function drawLetterbox() {
    const sw = video.videoWidth,
      sh = video.videoHeight;
    const s = Math.min(640 / sw, 480 / sh);  // 4:3 内に収める
    const dw = sw * s, dh = sh * s;
    const dx = (640 - dw) / 2,
      dy = (480 - dh) / 2;
    tctx.fillStyle = '#000';
    tctx.fillRect(0, 0, 640, 480);
    tctx.drawImage(video, 0, 0, sw, sh, dx, dy, dw, dh);
  }

  // ──────────────────────────────────
  // マスク描画関数
  // ──────────────────────────────────
  function drawMask() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = canvas.width;
    const h = canvas.height;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';

    if (vh / vw > 3 / 4) {
      // 上下に余白
      const pad = (vh - h) / 2;
      ctx.fillRect(0, 0, vw, pad);        // 上
      ctx.fillRect(0, vh - pad, vw, pad); // 下
    } else {
      // 左右に余白
      const pad = (vw - w) / 2;
      ctx.fillRect(0, 0, pad, vh);        // 左
      ctx.fillRect(vw - pad, 0, pad, vh); // 右
    }
    ctx.restore();
  }

  // ──────────────────────────────────
  // メインループ
  // ──────────────────────────────────
  let pending = false;
  let lastBoxes = null;

  async function loop() {
    if (video.readyState >= 2 && workerReady) {
      // 1) worker へフレーム送信
      if (!pending) {
        drawLetterbox();
        const bmp = await createImageBitmap(tmp);
        wk.postMessage({ type: 'frame', bitmap: bmp }, [bmp]);
        pending = true;
      }

      // 2) 画面へプレビュー描画
      ctx.drawImage(
        video,
        0,
        0,
        video.videoWidth,
        video.videoHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );

      // 3) 検出枠を重ねる
      if (lastBoxes) {
        const sw = video.videoWidth,
          sh = video.videoHeight;
        // tmpCanvas → 640×480 へ縮小したときの scale
        const s = Math.min(640 / sw, 480 / sh);
        const dx = (640 - sw * s) / 2;
        const dy = (480 - sh * s) / 2;
        const scaleX = canvas.width / sw;
        const scaleY = canvas.height / sh;

        const arr = lastBoxes;
        for (let i = 0; i < arr.length; i += 6) {
          const conf = arr[i + 4];
          if (conf < TH) continue;

          // tmpCanvas の座標 → video 座標へ戻す
          const vx1 = (arr[i] - dx) / s,
            vy1 = (arr[i + 1] - dy) / s;
          const vx2 = (arr[i + 2] - dx) / s,
            vy2 = (arr[i + 3] - dy) / s;

          const x1 = vx1 * scaleX,
            y1 = vy1 * scaleY,
            x2 = vx2 * scaleX,
            y2 = vy2 * scaleY;

          ctx.strokeStyle = 'red';
          ctx.lineWidth = 3;
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.fillStyle = 'yellow';
          ctx.font = '14px sans-serif';
          ctx.fillText(conf.toFixed(2), x1 + 4, y1 + 16);
        }
      }

      // 4) レターボックス マスク
      drawMask();
    }
    requestAnimationFrame(loop);
  }

  // ──────────────────────────────────
  // 初期化
  // ──────────────────────────────────
  (async () => {
    status.textContent = 'Requesting camera…';
    await setupCamera();
    await populateCamSel();
    status.textContent = 'Camera OK – loading model…';
    resizeToFourThree();
    loop();
  })();
})();

/* ============= (参考) 追加CSS =================
#wrap {
  position: fixed;
  inset: 0;
  overflow: hidden;        /* レターボックス時に外の要素を隠す */
}
video, canvas {
  object-fit: cover;       /* アスペクト比維持 */
}
#view {                    /* 描画用キャンバスを最前面へ 
