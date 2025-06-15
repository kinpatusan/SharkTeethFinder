/*
 * Shark Tooth Detector PWA – script.js (stretch‑fill)
 * -------------------------------------------------
 * 画面全体に “引き延ばして” 表示するモード。
 *   - ビデオを canvas 幅×高さいっぱいに drawImage
 *   - アスペクト比無視なので左右黒帯ゼロ＆上下黒帯ゼロ
 *   - バウンディングボックスは同じストレッチ倍率で変換
 * モデル入力は 640×640 の正方形で変更なし。
 */

window.addEventListener("DOMContentLoaded", () => {
  const video  = document.getElementById("cam");
  const canvas = document.getElementById("view");
  const status = document.getElementById("status");
  if (!video || !canvas || !status) { alert("video / canvas / status missing"); return; }
  const ctx = canvas.getContext("2d");

  // — Start button —
  let btn = document.getElementById("start");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "start";
    btn.textContent = "Start Camera";
    Object.assign(btn.style, {
      position: "absolute", top: "50%", left: "50%",
      transform: "translate(-50%,-50%)", padding: "12px 24px",
      fontSize: "18px", zIndex: 1000
    });
    document.body.appendChild(btn);
  }

  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.autoplay = true;

  // — Globals —
  let ortSession, ready = false;
  const TH = 0.3, INPUT = 640;

  // — Camera setup —
  async function camera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    await video.play();

    // canvas full‑screen
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    Object.assign(status.style, {
      position: "fixed", bottom: "8px", left: "50%",
      transform: "translateX(-50%)", background: "rgba(0,0,0,.5)",
      padding: "4px 8px", borderRadius: "6px", fontSize: "16px"
    });
  }

  // — Model —
  async function load() {
    status.textContent = "Loading model…";
    ortSession = await ort.InferenceSession.create("best.onnx", {
      executionProviders: ["wasm"], wasm: { simd: true }
    });
    status.textContent = "Model loaded";
  }

  // — Preprocess (letterbox→640×640) —
  function preprocess() {
    const tmp  = preprocess.tmp  || document.createElement("canvas");
    const tctx = preprocess.tctx || tmp.getContext("2d");
    preprocess.tmp  = tmp;
    preprocess.tctx = tctx;

    tmp.width = tmp.height = INPUT;

    const sw = video.videoWidth, sh = video.videoHeight;
    const s  = Math.min(INPUT / sw, INPUT / sh);
    const dw = sw * s, dh = sh * s;
    const dx = (INPUT - dw) / 2, dy = (INPUT - dh) / 2;

    tctx.fillStyle = "#000";
    tctx.fillRect(0, 0, INPUT, INPUT);
    tctx.drawImage(video, 0, 0, sw, sh, dx, dy, dw, dh);

    const img = tctx.getImageData(0, 0, INPUT, INPUT).data;
    const arr = new Float32Array(INPUT * INPUT * 3);
    let j = 0;
    for (let i = 0; i < img.length; i += 4) {
      arr[j++] = img[i + 2] / 255; // B
      arr[j++] = img[i + 1] / 255; // G
      arr[j++] = img[i]     / 255; // R
    }
    const chw = new Float32Array(arr.length);
    for (let c = 0; c < 3; ++c)
      for (let h = 0; h < INPUT; ++h)
        for (let w = 0; w < INPUT; ++w)
          chw[c * INPUT * INPUT + h * INPUT + w] = arr[h * INPUT * 3 + w * 3 + c];
    return new ort.Tensor("float32", chw, [1, 3, INPUT, INPUT]);
  }

  // — Detect / draw loop (stretch‑fill) —
  async function loop() {
    if (!ready) return;

    const xTensor = preprocess();

    // 1. 映像を canvas 全体にストレッチ表示（アスペクト比無視）
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, canvas.width, canvas.height);

    // 2. 推論
    const out  = await ortSession.run({ images: xTensor });
    const data = out[Object.keys(out)[0]].data;

    // 3. 640 → canvas のストレッチ倍率（同率で変換）
    const sx = canvas.width  / INPUT;
    const sy = canvas.height / INPUT;

    let found = false;
    for (let i = 0; i < data.length; i += 6) {
      const conf = data[i + 4];
      if (conf < TH) continue;
      found = true;
      const x1 = data[i]     * sx;
      const y1 = data[i + 1] * sy;
      const x2 = data[i + 2] * sx;
      const y2 = data[i + 3] * sy;
      ctx.strokeStyle = "red";
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
    status.textContent = found ? "Detecting…" : "No tooth";

    requestAnimationFrame(loop);
  }

  // — Init —
  async function init() {
    try {
      status.textContent = "Requesting camera…";
      await camera();
      status.textContent = "Camera OK";
      await load();
      ready = true;
      status.textContent = "Ready";
      loop();
    } catch (e) {
      status.textContent = "⚠️ " + e.message;
      console.error(e);
    }
  }

  btn.addEventListener("click", () => { btn.style.display = "none"; init(); });
});
