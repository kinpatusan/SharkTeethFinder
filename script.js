/*
 * Shark Tooth Detector PWA – script.js (stretch‑fill + bbox correct)
 * ---------------------------------------------------------------
 * 1. 映像を Canvas 全体にストレッチ描画（黒帯ゼロ）
 * 2. バウンディングボックスも同じストレッチ率で変換
 *    - 640 空間 → 元ビデオ座標 (レターボックス解除) → Canvas 座標
 */

window.addEventListener("DOMContentLoaded", () => {
  const video  = document.getElementById("cam");
  const canvas = document.getElementById("view");
  const status = document.getElementById("status");
  if (!video || !canvas || !status) { alert("video / canvas / status missing"); return; }
  const ctx = canvas.getContext("2d");

  // --- Start button ---
  let btn = document.getElementById("start");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "start";
    btn.textContent = "Start Camera";
    Object.assign(btn.style, { position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", padding:"12px 24px", fontSize:"18px", zIndex:1000 });
    document.body.appendChild(btn);
  }

  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.autoplay = true;

  // --- Globals ---
  let ortSession, ready=false;
  const TH=0.3, INPUT=640;

  // --- Camera ---
  async function camera(){
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
    video.srcObject=stream; await video.play();
    canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    Object.assign(status.style,{position:"fixed",bottom:"8px",left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,.5)",padding:"4px 8px",borderRadius:"6px",fontSize:"16px"});
  }

  // --- Model ---
  async function load(){ status.textContent="Loading model…"; ortSession=await ort.InferenceSession.create("best.onnx",{executionProviders:["wasm"],wasm:{simd:true}}); status.textContent="Model loaded"; }

  // --- Preprocess (letterbox→640) ---
  function preprocess(){
    const tmp=preprocess.tmp||document.createElement("canvas"); const tctx=preprocess.tctx||tmp.getContext("2d"); preprocess.tmp=tmp; preprocess.tctx=tctx; tmp.width=tmp.height=INPUT;
    const sw=video.videoWidth, sh=video.videoHeight; const s=Math.min(INPUT/sw, INPUT/sh); const dw=sw*s, dh=sh*s; const dx=(INPUT-dw)/2, dy=(INPUT-dh)/2;
    tctx.fillStyle="#000"; tctx.fillRect(0,0,INPUT,INPUT); tctx.drawImage(video,0,0,sw,sh,dx,dy,dw,dh);
    preprocess.meta={sw,sh,s,dx,dy};
    const img=tctx.getImageData(0,0,INPUT,INPUT).data; const arr=new Float32Array(INPUT*INPUT*3); let j=0; for(let i=0;i<img.length;i+=4){arr[j++]=img[i+2]/255;arr[j++]=img[i+1]/255;arr[j++]=img[i]/255;}
    const chw=new Float32Array(arr.length); for(let c=0;c<3;c++) for(let h=0;h<INPUT;h++) for(let w=0;w<INPUT;w++) chw[c*INPUT*INPUT+h*INPUT+w]=arr[h*INPUT*3+w*3+c];
    return new ort.Tensor("float32",chw,[1,3,INPUT,INPUT]);
  }

  // --- Loop ---
  async function loop(){
    if(!ready) return;
    const xTensor=preprocess();

    // 1. 映像をストレッチ描画
    ctx.drawImage(video,0,0,video.videoWidth,video.videoHeight,0,0,canvas.width,canvas.height);

    // 2. 推論
    const out=await ortSession.run({images:xTensor}); const det=out[Object.keys(out)[0]].data;

    // 3. 座標変換 (letterbox解除→canvasストレッチ)
    const {sw,sh,s,dx,dy}=preprocess.meta; const cScaleX=canvas.width/sw; const cScaleY=canvas.height/sh;
    let found=false;
    for(let i=0;i<det.length;i+=6){ const conf=det[i+4]; if(conf<TH) continue; found=true;
      const vx1=(det[i]-dx)/s, vy1=(det[i+1]-dy)/s; const vx2=(det[i+2]-dx)/s, vy2=(det[i+3]-dy)/s;
      const x1=vx1*cScaleX, y1=vy1*cScaleY, x2=vx2*cScaleX, y2=vy2*cScaleY;
      ctx.strokeStyle="red"; ctx.lineWidth=3; ctx.strokeRect(x1,y1,x2-x1,y2-y1);
    }
    status.textContent=found?"Detecting…":"No tooth";
    requestAnimationFrame(loop);
  }

  // --- Init ---
  async function init(){ try{status.textContent="Requesting camera…"; await camera(); status.textContent="Camera OK"; await load(); ready=true; status.textContent="Ready"; loop();} catch(e){ status.textContent="⚠️ "+e.message; console.error(e);} }
  btn.addEventListener("click",()=>{btn.style.display="none"; init();});
});
