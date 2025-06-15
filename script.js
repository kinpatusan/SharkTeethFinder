/*
 * Shark Tooth Detector PWA – complete script.js
 * 修正版：
 *   1. Video フレームを正しく 640×640 にコピー (レターボックス)
 *   2. RGB→BGR にチャネル入替え
 *   3. scoreThreshold を定数で調整可能に (デフォルト 0.3)
 *   Tested on iPhone 14 Pro Max / Safari (iOS 17)
 */

// ====== DOM Elements ======
const video = document.getElementById("cam");     // <video id="cam">
const canvas = document.getElementById("view");   // <canvas id="view">
const statusLabel = document.getElementById("status");
const ctx = canvas.getContext("2d");

// ====== Globals ======
let ortSession = null;
let initialized = false;
const scoreThreshold = 0.3;      // <-- 必要に応じて調整してください
const modelInput = 640;          // YOLOv11n の入力解像度

// ====== Camera setup ======
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment", // 背面カメラ
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });
  video.srcObject = stream;
  await video.play();

  // Canvas サイズは端末画面にフィットさせつつアスペクト維持
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ratio = vw / vh;
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;
  if (maxW / maxH > ratio) {
    // 横が余る
    canvas.height = maxH;
    canvas.width = maxH * ratio;
  } else {
    // 縦が余る
    canvas.width = maxW;
    canvas.height = maxW / ratio;
  }
}

// ====== Model loader ======
async function loadModel() {
  statusLabel.textContent = "Loading model…";
  ortSession = await ort.InferenceSession.create("sharktooth_yolov11n.onnx", {
    executionProviders: ["wasm"],
    wasm: { numThreads: 1, simd: true }
  });
  statusLabel.textContent = "Model loaded";
}

// ====== Pre‑processing (returns ort.Tensor float32 [1,3,640,640]) ======
function preprocess() {
  // --- オフスクリーン Canvas ---
  const tempCanvas = preprocess.canvas || document.createElement("canvas");
  const tempCtx = preprocess.ctx || tempCanvas.getContext("2d");
  tempCanvas.width = modelInput;
  tempCanvas.height = modelInput;
  preprocess.canvas = tempCanvas;
  preprocess.ctx = tempCtx;

  // --- レターボックス描画 ---
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  const scale = Math.min(modelInput / srcW, modelInput / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  const dx = (modelInput - dw) / 2;
  const dy = (modelInput - dh) / 2;
  tempCtx.fillStyle = "black";
  tempCtx.fillRect(0, 0, modelInput, modelInput);
  tempCtx.drawImage(video, 0, 0, srcW, srcH, dx, dy, dw, dh);

  // --- ピクセル → Float32Array (BGR, 0‑1) ---
  const img = tempCtx.getImageData(0, 0, modelInput, modelInput);
  const float32 = new Float32Array(modelInput * modelInput * 3);
  let j = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    // BGR 順に格納 (Ultralytics YOLO 系モデルは BGR 前提)
    float32[j++] = img.data[i + 2] / 255; // B
    float32[j++] = img.data[i + 1] / 255; // G
    float32[j++] = img.data[i]     / 255; // R
  }

  // --- HWC → CHW 転置 ---
  const transposed = new Float32Array(float32.length);
  for (let c = 0; c < 3; ++c) {
    for (let h = 0; h < modelInput; ++h) {
      for (let w = 0; w < modelInput; ++w) {
        transposed[c * modelInput * modelInput + h * modelInput + w] =
          float32[h * modelInput * 3 + w * 3 + c];
      }
    }
  }
  return new ort.Tensor("float32", transposed, [1, 3, modelInput, modelInput]);
}

// ====== 推論ループ ======
async function detectLoop() {
  if (!initialized) return;

  // 1. 画面にビデオフレームを描画
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2. 前処理 → 推論
  const inputTensor = preprocess();
  const feeds = { images: inputTensor };   // 入力名は onnx export 時の名前に合わせる
  const output = await ortSession.run(feeds);
  const preds = output[Object.keys(output)[0]].data; // [1,300,6] flat

  // 3. 検出結果を描画
  const scaleX = canvas.width / modelInput;
  const scaleY = canvas.height / modelInput;
  let any = false;
  for (let i = 0; i < preds.length; i += 6) {
    const score = preds[i + 4];
    if (score < scoreThreshold) continue;
    any = true;
    const x1 = preds[i]     * scaleX;
    const y1 = preds[i + 1] * scaleY;
    const x2 = preds[i + 2] * scaleX;
    const y2 = preds[i + 3] * scaleY;
    const w  = x2 - x1;
    const h  = y2 - y1;
    // 赤枠
    ctx.lineWidth = 3;
    ctx.strokeStyle = "red";
    ctx.strokeRect(x1, y1, w, h);
    // ラベル
    ctx.fillStyle = "red";
    ctx.font = "16px sans-serif";
    ctx.fillText(`Shark Tooth ${score.toFixed(2)}`, x1, y1 - 6);
  }

  // 4. ハイライトが無い場合はステータスを変更
  statusLabel.textContent = any ? "Detecting…" : "No tooth";

  requestAnimationFrame(detectLoop);
}

// ====== 初期化 ======
async function init() {
  try {
    await setupCamera();
    await loadModel();
    initialized = true;
    statusLabel.textContent = "Ready";
    detectLoop();
  } catch (e) {
    console.error(e);
    statusLabel.textContent = "⚠️ " + e.message;
  }
}

window.addEventListener("DOMContentLoaded", init);
