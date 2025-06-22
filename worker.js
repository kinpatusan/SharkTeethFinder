// worker.js – YOLO Inference Worker (GPU with WASM Fallback)
// -----------------------------------------------------------
// Message protocol
//   {type:'init', modelUrl:'best.onnx'} // numThreadsはGPU実行に不要
//   {type:'frame', bitmap:ImageBitmap}
//   → {type:'ready'}
//   → {type:'bbox', boxes:Float32Array}

importScripts('ort-web.min.js');

// ▼ ONNX Runtime Web v1.22.0
// WASMファイルのパス設定は、WebGPU/WebGL(JSEP)バックエンドでも
// 内部的に利用されるため、このまま維持します。
ort.env.wasm.wasmPaths = {
  // CPU WASM スレッド版 (フォールバック用)
  'ort-wasm-simd-threaded.wasm': './ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs' : './ort-wasm-simd-threaded.mjs',

  // JSEP (WebGPU/WebGL) 版
  'ort-wasm-simd-threaded.jsep.wasm': './ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs' : './ort-wasm-simd-threaded.jsep.mjs'
};

let session = null;
let inputDims = [1, 3, 640, 640];

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'init') {
    // GPU実行ではnumThreadsは不要なため、メッセージから削除
    const { modelUrl } = e.data;
    try {
      //【修正点①】実行バックエンドとして 'webgpu' を優先し、利用できない場合は 'webgl' を使用
      session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['webgpu', 'webgl'],
        graphOptimizationLevel: 'all' // パフォーマンス向上のため最適化を最大化
      });
      console.log(`Successfully created session with backend: ${session.executionProvider}`);
      postMessage({ type: 'ready' });

    } catch (error) {
      console.error('Failed to create GPU session, falling back to WASM.', error);
      //【修正点②】GPUでのセッション作成に失敗した場合、元のWASM実装にフォールバック
      try {
        session = await ort.InferenceSession.create(modelUrl, {
          executionProviders: ['wasm'],
          wasm: { simd: true, numThreads: 2 } // 元のコードと同じ設定
        });
        console.log(`Successfully created session with backend: ${session.executionProvider}`);
        postMessage({ type: 'ready' });
      } catch (wasmError) {
        console.error('Failed to create WASM session as a fallback.', wasmError);
      }
    }
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

// toTensor関数は前処理を行うもので、GPU/CPU共通で利用できるため変更不要です。
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