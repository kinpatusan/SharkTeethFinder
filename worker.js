// worker.js – runs YOLO inference off the UI thread
// --------------------------------------------------
// Message protocol (UI ⇄ Worker)
// init  : { type: 'init', modelUrl: 'best.onnx', numThreads: 2 }
// frame : { type: 'frame', bitmap: ImageBitmap }
// ready : { type: 'ready' }
// bbox  : { type: 'bbox', boxes: Float32Array }

importScripts('ort-web.min.js'); // ORT runtime (same folder)

let session = null;
let inputTensorDims = [1,3,640,640];

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'init') {
    const { modelUrl, numThreads = 1 } = e.data;
    session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      wasm: { simd: true, numThreads }
    });
    postMessage({ type: 'ready' });
  }

  else if (type === 'frame') {
    if (!session) return;
    const bmp = e.data.bitmap;
    const tensor = bitmapToTensor(bmp);
    bmp.close(); // Free GPU memory

    const out = await session.run({ images: tensor });
    // out key is first output (YOLO nms=True → [1,N,6] flat Float32Array)
    const boxes = out[Object.keys(out)[0]].data;
    postMessage({ type: 'bbox', boxes }, [boxes.buffer]);
  }
};

function bitmapToTensor(bitmap) {
  const { width, height } = bitmap;
  const off = new OffscreenCanvas(width, height);
  const ctx = off.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, width, height).data;
  const arr = new Float32Array(width * height * 3);
  let j = 0;
  for (let i = 0; i < img.length; i += 4) {
    arr[j++] = img[i + 2] / 255; // B
    arr[j++] = img[i + 1] / 255; // G
    arr[j++] = img[i] / 255;     // R
  }
  // HWC→CHW
  const chw = new Float32Array(arr.length);
  for (let c = 0; c < 3; ++c)
    for (let h = 0; h < height; ++h)
      for (let w = 0; w < width; ++w)
        chw[c * width * height + h * width + w] = arr[h * width * 3 + w * 3 + c];
  return new ort.Tensor('float32', chw, inputTensorDims);
}
