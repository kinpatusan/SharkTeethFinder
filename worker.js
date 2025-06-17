// worker.js – YOLO Inference Worker (WASM v1.22.0)
// -----------------------------------------------
// Message protocol
//   {type:'init', modelUrl:'best.onnx', numThreads:2}
//   {type:'frame', bitmap:ImageBitmap}
//   → {type:'ready'}
//   → {type:'bbox', boxes:Float32Array}

importScripts('ort-web.min.js');

// ▼ v1.22.0 では .wasm が /shark-pwa/ 直下の場合、パスを上書き
// ▼ v1.22.0 : .wasm と併せて .mjs（ローダ）も動的 import される
ort.env.wasm.wasmPaths = {
  // CPU WASM スレッド版
  'ort-wasm-simd-threaded.wasm': './ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs' : './ort-wasm-simd-threaded.mjs',

  // JSEP (WebGPU/WebNN) 版 – 使わない場合は 404 回避用にだけ置く
  'ort-wasm-simd-threaded.jsep.wasm': './ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs' : './ort-wasm-simd-threaded.jsep.mjs'
};

let session = null;
let inputDims = [1, 3, 640, 640];

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'init') {
    const { modelUrl, numThreads = 2 } = e.data;
    session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      wasm: { simd: true, numThreads }
    });
    postMessage({ type: 'ready' });
  }

  else if (type === 'frame') {
    if (!session) return;
    const bmp = e.data.bitmap;
    const tensor = toTensor(bmp);
    bmp.close();

    const out = await session.run({ images: tensor });
    const boxes = out[Object.keys(out)[0]].data; // Float32Array
    postMessage({ type: 'bbox', boxes }, [boxes.buffer]);
  }
};

function toTensor(bitmap) {
  const { width, height } = bitmap;
  const off = new OffscreenCanvas(width, height);
  const ctx = off.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, width, height).data;
  const arr = new Float32Array(width * height * 3);
  let j = 0;
  for (let i = 0; i < img.length; i += 4) {
    arr[j++] = img[i + 2] / 255;
    arr[j++] = img[i + 1] / 255;
    arr[j++] = img[i]     / 255;
  }
  const chw = new Float32Array(arr.length);
  for (let c = 0; c < 3; ++c)
    for (let h = 0; h < height; ++h)
      for (let w = 0; w < width; ++w)
        chw[c * width * height + h * width + w] = arr[h * width * 3 + w * 3 + c];
  return new ort.Tensor('float32', chw, inputDims);
}
