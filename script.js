/*
 * Shark Tooth Detector PWA – script.js (DOMContentLoaded safe)
 * 1. DOMContentLoaded まで待ってから要素取得
 * 2. 要素が存在しない場合は警告を出し停止
 * 3. Start Camera ボタンを確実に表示
 */

window.addEventListener("DOMContentLoaded", () => {
  // ====== DOM Elements ======
  const video = document.getElementById("cam");
  const canvas = document.getElementById("view");
  const statusLabel = document.getElementById("status");
  if (!video || !canvas || !statusLabel) {
    alert("必須の video / canvas / status 要素が見つかりません");
    return;
  }
  const ctx = canvas.getContext("2d");

  // ====== Start Button ======
  let startBtn = document.getElementById("start");
  if (!startBtn) {
    startBtn = document.createElement("button");
    startBtn.id = "start";
    startBtn.textContent = "Start Camera";
    Object.assign(startBtn.style, {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      padding: "12px 24px",
      fontSize: "18px",
      zIndex: 1000
    });
    document.body.appendChild(startBtn);
  }

  // video 要素に playsinline / muted を保証
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.autoplay = true;

  // ====== Globals ======
  let ortSession = null;
  let initialized = false;
  const scoreThreshold = 0.3;
  const modelInput = 640;

  // ====== Functions ======
  async function setupCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
    } catch (err) {
      console.error(err);
      throw new Error("Camera error: " + err.name);
    }

    // Canvas sizing
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error("Video dimensions 0");
    const ratio = vw / vh;
    const maxW = window.innerWidth;
    const maxH = window.innerHeight;
    if (maxW / maxH > ratio) {
      canvas.height = maxH;
      canvas.width = maxH * ratio;
    } else {
      canvas.width = maxW;
      canvas.height = maxW / ratio;
    }
  }

  async function loadModel() {
    statusLabel.textContent = "Loading model…";
    ortSession = await ort.InferenceSession.create("best.onnx", {
      executionProviders: ["wasm"],
      wasm: { simd: true }
    });
    statusLabel.textContent = "Model loaded";
  }

  function preprocess() {
    const tmp = preprocess.tmp || document.createElement("canvas");
    const tctx = preprocess.tctx || tmp.getContext("2d");
    preprocess.tmp = tmp;
    preprocess.tctx = tctx;
    tmp.width = modelInput;
    tmp.height = modelInput;

    const sw = video.videoWidth;
    const sh = video.videoHeight;
    const s = Math.min(modelInput / sw, modelInput / sh);
    const dw = sw * s;
    const dh = sh * s;
    const dx = (modelInput - dw) / 2;
    const dy = (modelInput - dh) / 2;
    tctx.fillStyle = "black";
    tctx.fillRect(0, 0, modelInput, modelInput);
    tctx.drawImage(video, 0, 0, sw, sh, dx, dy, dw, dh);

    const img = tctx.getImageData(0, 0, modelInput, modelInput);
    const arr = new Float32Array(modelInput * modelInput * 3);
    let j = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      arr[j++] = img.data[i + 2] / 255;
      arr[j++] = img.data[i + 1] / 255;
      arr[j++] = img.data[i] / 255;
    }
    const chw = new Float32Array(arr.length);
    for (let c = 0; c < 3; c++)
      for (let h = 0; h < modelInput; h++)
        for (let w = 0; w < modelInput; w++)
          chw[c * modelInput * modelInput + h * modelInput + w] =
            arr[h * modelInput * 3 + w * 3 + c];
    return new ort.Tensor("float32", chw, [1, 3, modelInput, modelInput]);
  }

  async function detectLoop() {
    if (!initialized) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const feeds = { images: preprocess() };
    const out = await ortSession.run(feeds);
    const d = out[Object.keys(out)[0]].data;
    const sx = canvas.width / modelInput;
    const sy = canvas.height / modelInput;
    let found = false;
    for (let i = 0; i < d.length; i += 6) {
      const score = d[i + 4];
      if (score < scoreThreshold) continue;
      found = true;
      const x1 = d[i] * sx;
      const y1 = d[i + 1] * sy;
      const x2 = d[i + 2] * sx;
      const y2 = d[i + 3] * sy;
      ctx.strokeStyle = "red";
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
    statusLabel.textContent = found ? "Detecting…" : "No tooth";
    requestAnimationFrame(detectLoop);
  }

  async function init() {
    try {
      statusLabel.textContent = "Requesting camera…";
      await setupCamera();
      statusLabel.textContent = "Camera OK";
      await loadModel();
      initialized = true;
      statusLabel.textContent = "Ready";
      detectLoop();
    } catch (e) {
      statusLabel.textContent = "⚠️ " + e.message;
      console.error(e);
    }
  }

  startBtn.addEventListener("click", () => {
    startBtn.style.display = "none";
    init();
  });
});
