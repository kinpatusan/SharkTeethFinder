// shark-pwa/script.js（detectLoop実行確認ログと条件緩和 + ログ出力を画面に表示）

let video = null;
let canvas = null;
let ctx = null;
let model = null;
let initialized = false;

function showError(message) {
  const status = document.getElementById('status');
  status.innerHTML = `❌ <span style="color: red">${message}</span>`;
  log(`[ERROR] ${message}`);
}

function showReady() {
  const status = document.getElementById('status');
  status.innerHTML = `✅ <span style="color: lime">Ready</span>`;
  log("[INFO] Ready");
}

function vibrate() {
  if ("vibrate" in navigator) {
    navigator.vibrate(300);
    log("[INFO] Vibrate triggered");
  }
}

function log(msg) {
  console.log(msg);
  const logDiv = document.getElementById("log");
  if (logDiv) {
    logDiv.textContent += msg + "\n";
    if (logDiv.textContent.length > 10000) {
      logDiv.textContent = logDiv.textContent.slice(-5000);
    }
  }
}

async function loadModel() {
  try {
    model = await ort.InferenceSession.create("./best.onnx");
    log("✅ Model loaded");
    log("Model input names: " + model.inputNames);
    log("Model output names: " + model.outputNames);
  } catch (e) {
    showError("Model load failed: " + e.message);
  }
}

async function initCamera() {
  video = document.getElementById("video");
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError("Camera not supported on this device");
    return;
  }

  try {
    await loadModel();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    await video.play();
    video.width = window.innerWidth;
    video.height = window.innerHeight;
    canvas.width = video.width;
    canvas.height = video.height;
    initialized = true;
    showReady();
    requestAnimationFrame(detectLoop);
  } catch (err) {
    showError("Camera error: " + err.message);
  }
}

async function detectLoop() {
  log("🔁 detectLoop running");
  if (!model) {
    log("🚫 Model not ready");
    return;
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const inputTensor = preprocess(canvas);

  try {
    const feeds = { images: inputTensor };
    const output = await model.run(feeds);
    const result = output[Object.keys(output)[0]];
    log("Result dims: " + result.dims);
    log("Sample data[0~5]: " + Array.from(result.data).slice(0, 6).join(", "));

    log("🧪 全スコアログ:");
    for (let i = 0; i < Math.min(20, result.dims[1]); i++) {
      const score = result.data[i * 6 + 4];
      log(`Box ${i} → score: ${score.toFixed(3)}`);
    }

    if (result && result.dims.length > 0 && result.data.some(v => v !== 0)) {
      vibrate();
      drawBoxes(result);
    } else {
      log("🟨 No meaningful detection");
    }
  } catch (err) {
    showError("Detection error: " + err.message);
    log("Detection error detail: " + err);
  }

  requestAnimationFrame(detectLoop);
}

function preprocess(canvas) {
  const [w, h] = [640, 640];
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.drawImage(canvas, 0, 0, w, h);
  const imageData = tempCtx.getImageData(0, 0, w, h);
  const pixels = new Float32Array(w * h * 3);
  let p = 0;
  for (let i = 0; i < imageData.data.length; i += 4) {
    pixels[p++] = imageData.data[i] / 255.0;
    pixels[p++] = imageData.data[i + 1] / 255.0;
    pixels[p++] = imageData.data[i + 2] / 255.0;
  }
  return new ort.Tensor("float32", pixels, [1, 3, h, w]);
}

function drawBoxes(tensor) {
  const data = tensor.data;
  const dims = tensor.dims;
  if (!data || data.length === 0) return;

  const scaleX = canvas.width / 640;
  const scaleY = canvas.height / 640;

  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;

  const maxBoxes = Math.min(dims[1], 300);
  let drawn = 0;

  for (let i = 0; i < maxBoxes; i++) {
    const offset = i * 6;
    const x1 = data[offset] * scaleX;
    const y1 = data[offset + 1] * scaleY;
    const x2 = data[offset + 2] * scaleX;
    const y2 = data[offset + 3] * scaleY;
    const score = data[offset + 4];

    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) continue;
    if (score < 0.01) continue;

    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 0 || h <= 0 || w > canvas.width || h > canvas.height) continue;

    ctx.strokeRect(x1, y1, w, h);
    drawn++;
  }

  log("🟥 Boxes drawn: " + drawn);
}

document.addEventListener("DOMContentLoaded", initCamera);
