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

// モデル読み込み（←ここが追加）
async function loadModel() {
  try {
    model = await ort.InferenceSession.create("./best.onnx");
    console.log("Model loaded");
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
    await loadModel(); // ← モデルを先に読み込み

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

  const inputTensor = preprocess(canvas); // ← 後述の関数が必要

  try {
    const feeds = { input: inputTensor };
    const output = await model.run(feeds);
    const boxes = output.output0; // モデルの出力名に応じて変更必要

    if (boxes && boxes.dims[0] > 0) {
      vibrate();
      drawBoxes(boxes); // ← 後述の関数が必要
    }
  } catch (err) {
    showError("Detection error: " + err.message);
  }

  requestAnimationFrame(detectLoop);
}

// === 追加で定義が必要な関数（サンプル） ===

// canvasからTensorに変換
function preprocess(canvas) {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const width = 224, height = 224; // モデル入力に合わせて調整
  const resized = tf.image.resizeBilinear(tf.browser.fromPixels(imgData), [height, width]);
  const tensor = resized.expandDims(0).toFloat().div(255);
  return new ort.Tensor("float32", tensor.dataSync(), [1, 3, height, width]);
}

// 推論結果のboxesを描画
function drawBoxes(boxes) {
  // 仮実装（出力形式に合わせて要調整）
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;
  for (let i = 0; i < boxes.data.length; i += 4) {
    const [x, y, w, h] = boxes.data.slice(i, i + 4);
    ctx.strokeRect(x, y, w, h);
  }
}

document.addEventListener("DOMContentLoaded", initCamera);
