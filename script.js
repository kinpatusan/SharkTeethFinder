/*
 * Shark Tooth Detector PWA – script.js (offset‑free / accurate bbox)
 * --------------------------------------------------------------
 * ・DOMContentLoaded 待ち
 * ・Start Camera ボタン（ユーザージェスチャ確保）
 * ・640×640 レターボックス画像をそのまま canvas に拡大描画
 *   → 余白・スケール誤差を 0 にし、左右端でもバウンディングボックスが一致
 * ・ort.min.js を先に読み込む前提（index.html に CDN <script> を追加）
 */

window.addEventListener("DOMContentLoaded", () => {
  // ===== DOM Elements =====
  const video = document.getElementById("cam");
  const canvas = document.getElementById("view");
  const statusLabel = document.getElementById("status");
  if (!video || !canvas || !statusLabel) {
    alert("必須の video / canvas / status 要素が見つかりません");
    return;
  }
  const ctx = canvas.getContext("2d");

  // ===== Start Button =====
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

  // video 属性
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.autoplay = true;

  // ===== Globals =====
  let ortSession = null;
  let initialized = false;
  const scoreThreshold = 0.3;
  const modelInput = 640; // 640×640 YOLO

  // ===== Camera =====
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

    // Canvas をフル画面に拡大
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    // ステータスメッセージはオーバーレイ表示に切替え
    Object.assign(statusLabel.style, {
      position: "fixed",
      bottom: "8px",
      left: "50%",
      transform: "translateX(-50%)",
      margin: 0,
      padding: "4px 8px",
      background: "rgba(0,0,0,0.5)",
      borderRadius: "6px",
      fontSize: "16px"
    }); // 下にステータス行確保
  }

  // ===== Model =====
  async function loadModel() {
    statusLabel.textContent = "Loading model…";
    ortSession = await ort.InferenceSession.create("best.onnx", {
      executionProviders: ["wasm"],
      wasm: { simd: true }
    });
    statusLabel.textContent = "Model loaded";
  }

  // ===== Preprocess =====
  function preprocess() {
    const tmp = preprocess.tmp || document.createElement("canvas");
    const tctx = preprocess.tctx || tmp.getContext("2d");
    preprocess.tmp = tmp;
    preprocess.tctx = tctx;
    tmp.width = modelInput;
    tmp.height = modelInput;

    // 元解像度
    const sw = video.videoWidth;
    const sh = video.videoHeight;
    const scale = Math.min(modelInput / sw, modelInput / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (modelInput - dw) / 2;
    const dy = (modelInput - dh) / 2;

    // レターボックス貼り付け
    tctx.fillStyle = "black";
    tctx.fillRect(0, 0, modelInput, modelInput);
    tctx.drawImage(video, 0, 0, sw, sh, dx, dy, dw, dh);

    // RGB→BGR, HWC→CHW
    const img = tctx.getImageData(0, 0, modelInput, modelInput);
    const arr = new Float32Array(img.data.length / 4 * 3);
    let j = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      arr[j++] = img.data[i + 2] / 255; // B
      arr[j++] = img.data[i + 1] / 255; // G
      arr[j++] = img.data[i] / 255;     // R
    }
    const chw = new Float32Array(arr.length);
    for (let c = 0; c < 3; c++)
      for (let h = 0; h < modelInput; h++)
        for (let w = 0; w < modelInput; w++)
          chw[c * modelInput * modelInput + h * modelInput + w] =
            arr[h * modelInput * 3 + w * 3 + c];
    return new ort.Tensor("float32", chw, [1, 3, modelInput, modelInput]);
  }

  // ===== Detect Loop =====
  async function detectLoop() {
    if (!initialized) return;

    // 1. 推論前処理 & 640→Canvas 描画
    const feeds = { images: preprocess() };
    ctx.drawImage(preprocess.tmp, 0, 0, canvas.width, canvas.height);

    // 2. 推論
    const out = await ortSession.run(feeds);
    const det = out[Object.keys(out)[0]].data; // flat [N,6]

    // 3. bbox 描画 (単純拡大)
    const scaleX = canvas.width  / modelInput;
    const scaleY = canvas.height / modelInput;

    let found = false;
    for (let i = 0; i < det.length; i += 6) {
      const score = det[i + 4];
      if (score < scoreThreshold) continue;
      found = true;
      const x1 = det[i]     * scaleX;
      const y1 = det[i + 1] * scaleY;
      const x2 = det[i + 2] * scaleX;
      const y2 = det[i + 3] * scaleY;
      ctx.strokeStyle = "red";
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
    statusLabel.textContent = found ? "Detecting…" : "No tooth";
    requestAnimationFrame(detectLoop);
  }

  // ===== Init =====
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
