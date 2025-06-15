// shark-pwa/script.js（YOLOv11 後処理済みモデル対応 + 描画安全化）

let video = null;
let canvas = null;
let ctx = null;
let model = null;
let initialized = false;

function showError(message) {
  const status = document.getElementById('status');
  status.innerHTML = `❌ <span style="color: red">${message}</span>`;
}

function showReady() {
  const status = document.getElementById('status');
  status.innerHTML = `✅ <span style="color: lime">Ready</span>`;
}

function vibrate() {
  if ("vibrate" in navigator) {
    navigator.vibrate(300);
  }
}

async function loadModel() {
  try {
    model = await ort.InferenceSession.create("./best.onnx");
    console.log("✅ Model loaded");
    console.log("Model input names:", model.inputNames);
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
    detectLoop();
  } catch (err) {
    showError("Camera error: " + err.message);
  }
}

async function detectLoop() {
  if (!initialized || !model) return;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const inputTensor = preprocess(canvas);
  console.log("✅ Preprocess done");

  try {
    const feeds = { images: inputTensor };
    const output = await model.run(feeds);
    console.log("✅ Model.run executed");
    const outputNames = Object.keys(output);
    if (outputNames.length === 0) {
      showError("No output from model");
      return;
    }
    const result = output[outputNames[0]];
    console.log("Result dims:", result.dims);
    if (!window.__shown_once && result?.data?.length) {
      alert("dims: " + result.dims + "\ndata[0~5]: " + Array.from(result.data).slice(0, 6).join(", "));
      window.__shown_once = true;
    }
    if (result && result.dims.length > 0) {
      vibrate();
      drawBoxes(result);
    }
  } catch (err) {
    showError("Detection error: " + err.message);
    console.error("Detection error detail:", err);
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
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;

  const maxBoxes = Math.min(dims[1], 300);
  let drawn = 0;

  for (let i = 0; i < maxBoxes; i++) {
    const offset = i * 6;
    const x1 = data[offset];
    const y1 = data[offset + 1];
    const x2 = data[offset + 2];
    const y2 = data[offset + 3];
    const score = data[offset + 4];

    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) continue;
    if (score < 0.3) continue;

    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 0 || h <= 0) continue;

    ctx.strokeRect(x1, y1, w, h);
    drawn++;
  }

  console.log("🟥 Boxes drawn:", drawn);
}

document.addEventListener("DOMContentLoaded", initCamera);
