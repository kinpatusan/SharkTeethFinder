/*
 * Shark Tooth Detector PWA – script.js (slider‑tuned TH + NMS‑0.6 model)
 * ---------------------------------------------------------------------
 * 1. 画面いっぱいストレッチ描画＋bbox補正はそのまま
 * 2. UI に “Confidence Threshold” スライダーを追加
 *    - range 0.10–0.90, デフォルト 0.50
 *    - 動かすと即座に TH が変わり赤枠フィルタリングが更新される
 * 3. ONNX モデルファイル名を best_iou06.onnx に変更（yolo export iou=0.6）
 */

window.addEventListener("DOMContentLoaded", () => {
  // === DOM Elements ===
  const video  = document.getElementById("cam");
  const canvas = document.getElementById("view");
  const status = document.getElementById("status");
  if (!video || !canvas || !status) { alert("video / canvas / status missing"); return; }
  const ctx = canvas.getContext("2d");

  // --- Start Button (for iOS user gesture) ---
  let startBtn = document.getElementById("start");
  if (!startBtn) {
    startBtn = document.createElement("button");
    startBtn.id = "start";
    startBtn.textContent = "Start Camera";
    Object.assign(startBtn.style, {
      position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
      padding:"12px 24px", fontSize:"18px", zIndex:1000
    });
    document.body.appendChild(startBtn);
  }

  // --- Threshold Slider UI ---
  let slider = document.getElementById("thr");
  let sliderLabel = document.getElementById("thrVal");
  if (!slider) {
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      position:"fixed", top:"8px", left:"50%", transform:"translateX(-50%)",
      background:"rgba(0,0,0,.5)", padding:"6px 12px", borderRadius:"8px",
      color:"#fff", fontSize:"14px", zIndex:1000
    });
    wrapper.innerHTML = `<label style="white-space:nowrap;">TH: <span id="thrVal">0.50</span></label>
      <input id="thr" type="range" min="0.10" max="0.90" step="0.05" value="0.50" style="width:120px; vertical-align:middle;">`;
    document.body.appendChild(wrapper);
    slider = document.getElementById("thr");
    sliderLabel = document.getElementById("thrVal");
  }

  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.autoplay = true;

  // === Globals ===
  let ortSession, ready = false;
  let TH = parseFloat(slider.value);   // 初期 0.50
  const INPUT = 640;

  slider.oninput = e => {
    TH = parseFloat(e.target.value);
    sliderLabel.textContent = TH.toFixed(2);
  };

  // === Camera ===
  async function setupCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    await video.play();
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    Object.assign(status.style, {
      position:"fixed", bottom:"8px", left:"50%", transform:"translateX(-50%)",
      background:"rgba(0,0,0,.5)", padding:"4px 8px", borderRadius:"6px", fontSize:"16px"
    });
  }

  // === Model (NMS IoU 0.6 でエクスポートした ONNX) ===
  async function loadModel() {
    status.textContent = "Loading model…";
    ortSession = await ort.InferenceSession.create("best_iou06.onnx", {
      executionProviders:["wasm"], wasm:{ simd:true }
    });
    status.textContent = "Model loaded";
  }

  // === Preprocess: letterbox → 640×640 ===
  function preprocess() {
    const tmp  = preprocess.tmp  || document.createElement("canvas");
    const tctx = preprocess.tctx || tmp.getContext("2d");
    preprocess.tmp  = tmp; preprocess.tctx = tctx;
    tmp.width = tmp.height = INPUT;

    const sw = video.videoWidth, sh = video.videoHeight;
    const s  = Math.min(INPUT/sw, INPUT/sh);
    const dw = sw * s, dh = sh * s;
    const dx = (INPUT - dw) / 2, dy = (INPUT - dh) / 2;

    tctx.fillStyle = "#000";
    tctx.fillRect(0, 0, INPUT, INPUT);
    tctx.drawImage(video, 0, 0, sw, sh, dx, dy, dw, dh);

    preprocess.meta = { sw, sh, s, dx, dy };

    const img = tctx.getImageData(0, 0, INPUT, INPUT).data;
    const arr = new Float32Array(INPUT * INPUT * 3);
    let j = 0;
    for (let i = 0; i < img.length; i += 4) {
      arr[j++] = img[i + 2] / 255;
      arr[j++] = img[i + 1] / 255;
      arr[j++] = img[i]     / 255;
    }
    const chw = new Float32Array(arr.length);
    for (let c = 0; c < 3; ++c)
      for (let h = 0; h < INPUT; ++h)
        for (let w = 0; w < INPUT; ++w)
          chw[c * INPUT * INPUT + h * INPUT + w] = arr[h * INPUT * 3 + w * 3 + c];
    return new ort.Tensor("float32", chw, [1, 3, INPUT, INPUT]);
  }

  // === Main loop ===
  async function detectLoop() {
    if (!ready) return;

    const xTensor = preprocess();

    // 1. Draw stretched video
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, canvas.width, canvas.height);

    // 2. Inference
    const out  = await ortSession.run({ images: xTensor });
    const det  = out[Object.keys(out)[0]].data;

    // 3. Convert bbox
    const { sw, sh, s, dx, dy } = preprocess.meta;
    const scaleX = canvas.width  / sw;
    const scaleY = canvas.height / sh;

    let found = false;
    for (let i = 0; i < det.length; i += 6) {
      const conf = det[i + 4];
      if (conf < TH) continue;
      found = true;
      const vx1 = (det[i]     - dx) / s;
      const vy1 = (det[i + 1] - dy) / s;
      const vx2 = (det[i + 2] - dx) / s;
      const vy2 = (det[i + 3] - dy) / s;

      const x1 = vx1 * scaleX;
      const y1 = vy1 * scaleY;
      const x2 = vx2 * scaleX;
      const y2 = vy2 * scaleY;

      ctx.strokeStyle = "red";
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      ctx.fillStyle = "yellow";
      ctx.font = "14px sans-serif";
      ctx.fillText(conf.toFixed(2), x1 + 4, y1 + 16);
    }

    status.textContent = found ? "Detecting…" : "No tooth";
    requestAnimationFrame(detectLoop);
  }

  // === Init ===
  async function init() {
    try {
      status.textContent = "Requesting camera…";
      await setupCamera();
      status.textContent = "Camera OK";
      await loadModel();
      ready = true;
      status.textContent = "Ready";
      detectLoop();
    } catch (e) {
      status.textContent = "⚠️ " + e.message;
      console.error(e);
    }
  }

  startBtn.addEventListener("click", () => {
    startBtn.style.display = "none";
    init();
  });
});
