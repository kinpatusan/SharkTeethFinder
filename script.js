// camera.js

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

async function initCamera() {
  video = document.getElementById("video");
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError("Camera not supported on this device");
    return;
  }

  try {
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
  const input = preprocess(canvas);

  try {
    const outputs = await model.run(input);
    const boxes = outputs.boxes;

    if (boxes && boxes.detections.length > 0) {
      vibrate();
      drawBoxes(boxes.detections);
    }
  } catch (err) {
    showError("Detection error: " + err.message);
  }

  requestAnimationFrame(detectLoop);
}

document.addEventListener("DOMContentLoaded", initCamera);
