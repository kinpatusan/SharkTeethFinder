// shark-pwa/script.js（デバッグ機能強化版）

let video = null;
let canvas = null;
let ctx = null;
let model = null;
let initialized = false;
const modelWidth = 640;
const modelHeight = 640;

function showError(message) {
  const status = document.getElementById('status');
  status.innerHTML = `❌ <span style="color: red;">${message}</span>`;
  console.error(message);
}

function showReady() {
  const status = document.getElementById('status');
  status.innerHTML = `✅ <span style="color: lime;">Ready</span>`;
}

function vibrate() {
  if ("vibrate" in navigator) {
    navigator.vibrate(200);
  }
}

async function loadModel() {
  try {
    model = await ort.InferenceSession.create("./best.onnx");
    console.log("✅ Model loaded successfully.");
    console.log("Input Names:", model.inputNames);
    console.log("Output Names:", model.outputNames);
  } catch (e) {
    showError(`Model load failed: ${e.message}`);
    throw e;
  }
}

async function initCamera() {
  video = document.getElementById("video");
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d", { willReadFrequently: true }); // パフォーマンス向上のヒント

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError("Camera API is not supported on this device.");
    return;
  }

  try {
    await loadModel();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    video.srcObject = stream;
    
    video.onloadedmetadata = () => {
      video.play();
      setupCanvas();
      initialized = true;
      showReady();
      requestAnimationFrame(detectLoop);
    };

  } catch (err) {
    showError(`Camera error: ${err.message}`);
  }
}

function setupCanvas() {
    const videoRatio = video.videoWidth / video.videoHeight;
    const screenRatio = window.innerWidth / window.innerHeight;

    if (screenRatio > videoRatio) {
        canvas.height = window.innerHeight;
        canvas.width = window.innerHeight * videoRatio;
    } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerWidth / videoRatio;
    }
    console.log(`Canvas setup: ${canvas.width}x${canvas.height}`);
}


async function detectLoop() {
  if (!initialized || !model || video.paused || video.ended) {
    requestAnimationFrame(detectLoop);
    return;
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const inputTensor = preprocess(imageData);

  try {
    const feeds = { [model.inputNames[0]]: inputTensor };
    const outputMap = await model.run(feeds);
    const outputTensor = outputMap[model.outputNames[0]];

    // ★デバッグログ①: モデルの出力全体を確認
    console.log("--- Model Output ---");
    console.log("Dims:", outputTensor.dims);
    console.log("Data (first 30):", outputTensor.data.slice(0, 30));
    
    drawBoxes(outputTensor);

  } catch (err) {
    showError(`Detection error: ${err.message}`);
    console.error("Detection error detail:", err);
    initialized = false;
  }

  requestAnimationFrame(detectLoop);
}

function preprocess(imageData) {
  const { data, width, height } = imageData;
  
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = modelWidth;
  tempCanvas.height = modelHeight;
  const tempCtx = tempCanvas.getContext("2d");
  
  // 元のImageDataを直接描画
  const tempImg = new Image();
  const url = URL.createObjectURL(new Blob([imageData.data.buffer], { type: 'image/bmp' }));
  tempImg.src = url;

  tempCtx.drawImage(imageData.source, 0, 0, width, height, 0, 0, modelWidth, modelHeight);
  const resizedImageData = tempCtx.getImageData(0, 0, modelWidth, modelHeight);

  const float32Data = new Float32Array(modelWidth * modelHeight * 3);
  for (let i = 0; i < resizedImageData.data.length / 4; i++) {
    const j = i * 4;
    float32Data[i * 3] = resizedImageData.data[j] / 255.0;       // R
    float32Data[i * 3 + 1] = resizedImageData.data[j + 1] / 255.0; // G
    float32Data[i * 3 + 2] = resizedImageData.data[j + 2] / 255.0; // B
  }
  
  const transposedData = new Float32Array(modelWidth * modelHeight * 3);
  for (let c = 0; c < 3; c++) {
    for (let h = 0; h < modelHeight; h++) {
      for (let w = 0; w < modelWidth; w++) {
        transposedData[c * (modelWidth * modelHeight) + h * modelWidth + w] =
          float32Data[h * modelWidth * 3 + w * 3 + c];
      }
    }
  }

  return new ort.Tensor("float32", transposedData, [1, 3, modelHeight, modelWidth]);
}


function drawBoxes(tensor) {
  const data = tensor.data;
  const dims = tensor.dims;
  if (!data || data.length === 0) return;

  const numDetections = dims[1];
  const numCoords = dims[2];
  const scaleX = canvas.width / modelWidth;
  const scaleY = canvas.height / modelHeight;
  
  // ★デバッグ用: 信頼度の閾値を一時的に非常に低く設定
  const scoreThreshold = 0.1; 
  let drawnCount = 0;

  for (let i = 0; i < numDetections; i++) {
    const offset = i * numCoords;
    const score = data[offset + 4];
    
    // ★デバッグログ②: 全ての検出候補のスコアをチェック
    if (i < 5) { // 最初の5件だけログに出力
        console.log(`Detection candidate #${i}: score=${score.toFixed(4)}`);
    }

    if (score < scoreThreshold) {
      continue;
    }
    
    drawnCount++;
    detectionsMade = true;

    const x1 = data[offset] * scaleX;
    const y1 = data[offset + 1] * scaleY;
    const x2 = data[offset + 2] * scaleX;
    const y2 = data[offset + 3] * scaleY;
    
    ctx.strokeStyle = "#FF0000";
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    
    const label = `Shark Tooth (${score.toFixed(2)})`;
    ctx.fillStyle = "#FF0000";
    ctx.font = "18px 'Arial'";
    ctx.fillText(label, x1, y1 > 20 ? y1 - 10 : y1 + 20);
  }

  if (drawnCount > 0) {
    console.log(`🟥 ${drawnCount} boxes drawn.`);
    vibrate();
  }
}

document.addEventListener("DOMContentLoaded", initCamera);