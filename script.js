// shark-pwa/script.js（修正済み）

let video = null;
let canvas = null;
let ctx = null;
let model = null;
let initialized = false;
const modelWidth = 640;
const modelHeight = 640;

/**
 * エラーメッセージを画面に表示します。
 * @param {string} message - 表示するエラーメッセージ
 */
function showError(message) {
  const status = document.getElementById('status');
  status.innerHTML = `❌ <span style="color: red;">${message}</span>`;
  console.error(message);
}

/**
 * 準備完了の状態を画面に表示します。
 */
function showReady() {
  const status = document.getElementById('status');
  status.innerHTML = `✅ <span style="color: lime;">Ready</span>`;
}

/**
 * デバイスを振動させます。
 */
function vibrate() {
  if ("vibrate" in navigator) {
    navigator.vibrate(200); // 振動を少し短く調整
  }
}

/**
 * ONNXモデルを非同期で読み込みます。
 */
async function loadModel() {
  try {
    // onnxruntime-webのセッションを作成
    model = await ort.InferenceSession.create("./best.onnx");
    console.log("✅ Model loaded successfully.");
    console.log("Model input names:", model.inputNames);
    console.log("Model output names:", model.outputNames);
  } catch (e) {
    showError(`Model load failed: ${e.message}`);
    throw e; // エラーを投げて処理を中断
  }
}

/**
 * カメラを初期化し、ビデオストリームを開始します。
 */
async function initCamera() {
  video = document.getElementById("video");
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError("Camera API is not supported on this device.");
    return;
  }

  try {
    await loadModel();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment", // 背面カメラを優先
        width: { ideal: 1280 },   // 解像度を要求
        height: { ideal: 720 }
      }
    });
    video.srcObject = stream;
    await video.play();

    // videoのメタデータが読み込まれたら設定
    video.addEventListener('loadedmetadata', () => {
        setupCanvas();
        initialized = true;
        showReady();
        requestAnimationFrame(detectLoop);
    });

  } catch (err) {
    showError(`Camera error: ${err.message}`);
  }
}

/**
 * Canvasのサイズをビデオのサイズに合わせます。
 */
function setupCanvas() {
    // 画面サイズに合わせるのではなく、ビデオのアスペクト比を維持
    const videoRatio = video.videoWidth / video.videoHeight;
    const screenRatio = window.innerWidth / window.innerHeight;

    if (screenRatio > videoRatio) {
        canvas.height = window.innerHeight;
        canvas.width = window.innerHeight * videoRatio;
    } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerWidth / videoRatio;
    }
    video.width = canvas.width;
    video.height = canvas.height;

    console.log(`Canvas setup: ${canvas.width}x${canvas.height}`);
}


/**
 * リアルタイムで物体検出を行うメインループ。
 */
async function detectLoop() {
  if (!initialized || !model || video.paused || video.ended) {
    requestAnimationFrame(detectLoop);
    return;
  }

  // ビデオフレームをCanvasに描画
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Canvasから画像データを前処理してテンソルに変換
  const inputTensor = preprocess(ctx.getImageData(0, 0, canvas.width, canvas.height));

  try {
    const feeds = { [model.inputNames[0]]: inputTensor }; // 入力名を動的に取得
    const outputMap = await model.run(feeds);
    const outputTensor = outputMap[model.outputNames[0]]; // 出力名を動的に取得

    if (outputTensor && outputTensor.dims.length > 0 && outputTensor.data.length > 0) {
      drawBoxes(outputTensor);
    } else {
      console.log("🟨 No meaningful detection output.");
    }
  } catch (err) {
    showError(`Detection error: ${err.message}`);
    console.error("Detection error detail:", err);
    initialized = false; // エラー発生時はループを停止
  }

  requestAnimationFrame(detectLoop);
}

/**
 * 画像データをモデルの入力形式に前処理します。
 * @param {ImageData} imageData - Canvasから取得したImageDataオブジェクト
 * @returns {ort.Tensor} - ONNXモデル用の入力テンソル
 */
function preprocess(imageData) {
  const { data, width, height } = imageData;
  
  // 一時的なCanvasを作成して640x640にリサイズ
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = modelWidth;
  tempCanvas.height = modelHeight;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.drawImage(imageData.source, 0, 0, width, height, 0, 0, modelWidth, modelHeight);
  const resizedImageData = tempCtx.getImageData(0, 0, modelWidth, modelHeight);

  // ピクセルデータをFloat32Arrayに変換し、正規化
  const float32Data = new Float32Array(modelWidth * modelHeight * 3);
  let j = 0;
  for (let i = 0; i < resizedImageData.data.length; i += 4) {
    float32Data[j] = resizedImageData.data[i] / 255.0;     // R
    float32Data[j + 1] = resizedImageData.data[i + 1] / 255.0; // G
    float32Data[j + 2] = resizedImageData.data[i + 2] / 255.0; // B
    j += 3;
  }
  
  // テンソルの形状を (1, 3, H, W) に変更
  const tensor = new ort.Tensor("float32", float32Data, [1, 3, modelHeight, modelWidth]);
  const transposedData = new Float32Array(1 * 3 * modelHeight * modelWidth);
  let C = 3, H = modelHeight, W = modelWidth;
  for (let c = 0; c < C; ++c) {
    for (let h = 0; h < H; ++h) {
      for (let w = 0; w < W; ++w) {
        transposedData[c * H * W + h * W + w] = float32Data[h * W * C + w * C + c];
      }
    }
  }

  return new ort.Tensor("float32", transposedData, [1, 3, modelHeight, modelWidth]);
}


/**
 * 検出結果のバウンディングボックスを描画します。
 * @param {ort.Tensor} tensor - モデルからの出力テンソル
 */
function drawBoxes(tensor) {
  const data = tensor.data;   // Float32Array
  const dims = tensor.dims;   // [1, 300, 6]
  if (!data || data.length === 0) return;

  const numDetections = dims[1]; // 300
  const numCoords = dims[2];     // 6

  // スケール計算
  const scaleX = canvas.width / modelWidth;
  const scaleY = canvas.height / modelHeight;

  ctx.strokeStyle = "#FF0000"; // 明るい赤色
  ctx.lineWidth = 3;
  ctx.font = "18px 'Arial'";
  ctx.fillStyle = "#FF0000";

  let detectionsMade = false;

  for (let i = 0; i < numDetections; i++) {
    const offset = i * numCoords;
    const score = data[offset + 4];

    // スコアが閾値より低い場合はスキップ
    if (score < 0.4) { // 閾値を少し上げることを推奨
      continue;
    }
    detectionsMade = true;

    // 座標をスケールアップ
    const x1 = data[offset] * scaleX;
    const y1 = data[offset + 1] * scaleY;
    const x2 = data[offset + 2] * scaleX;
    const y2 = data[offset + 3] * scaleY;
    
    const classId = data[offset + 5];

    const w = x2 - x1;
    const h = y2 - y1;

    // バウンディングボックスを描画
    ctx.strokeRect(x1, y1, w, h);

    // ラベルとスコアを描画
    const label = `Shark Tooth (${score.toFixed(2)})`;
    ctx.fillText(label, x1, y1 > 20 ? y1 - 10 : y1 + h + 20);

    console.log(`🟥 Box drawn: score=${score.toFixed(2)}, class=${classId}`);
  }

  if (detectionsMade) {
    vibrate(); // 検出があった場合にのみ振動
  }
}


// DOMが読み込まれたら初期化処理を開始
document.addEventListener("DOMContentLoaded", initCamera);