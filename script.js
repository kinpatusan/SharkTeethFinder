/*
 * Shark Tooth Detector PWA – script.js  (v3 – syntax‑fixed)
 * -------------------------------------------------------------
 * • デフォルト TH 0.65
 * • カメラ切替：背面カメラ / 背面超広角カメラ の 2 択表示
 *   - fallback: rear[0] = wide, rear[1] = ultra (存在すれば)
 * • 余分な duplicate コードを削除し、構文エラーを解消
 */

window.addEventListener("DOMContentLoaded", () => {
  // === DOM Elements ===
  const video  = document.getElementById("cam");
  const canvas = document.getElementById("view");
  const status = document.getElementById("status");
  if (!video || !canvas || !status) { alert("video / canvas / status missing"); return; }
  const ctx = canvas.getContext("2d");

  // --- Start Button ---
  let startBtn = document.getElementById("start");
  if (!startBtn) {
    startBtn = document.createElement("button");
    startBtn.id = "start";
    startBtn.textContent = "Start Camera";
    Object.assign(startBtn.style, {
      position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
      padding:"12px 24px", fontSize:"18px", zIndex:1000
    });
    document.body.appendChild(startBtn);
  }

  // --- UI (Slider + Camera Select) ---
  const ui = document.createElement("div");
  Object.assign(ui.style, {
    position:"fixed", top:"8px", left:"50%", transform:"translateX(-50%)",
    background:"rgba(0,0,0,.55)", padding:"6px 12px", borderRadius:"8px",
    color:"#fff", fontSize:"14px", zIndex:1000, whiteSpace:"nowrap"
  });
  ui.innerHTML = `TH: <span id="thrVal">0.65</span>
    <input id="thr" type="range" min="0.10" max="0.90" step="0.05" value="0.65" style="width:120px;vertical-align:middle;">
    &nbsp;| Camera: <select id="camSel" style="background:#222;color:#fff;border-radius:4px;padding:2px 4px;"></select>`;
  document.body.appendChild(ui);

  const slider     = document.getElementById("thr");
  const sliderText = document.getElementById("thrVal");
  const camSelect  = document.getElementById("camSel");

  video.setAttribute("playsinline","");
  video.setAttribute("muted","");
  video.autoplay = true;

  // === Globals ===
  let ortSession, ready=false, currentStream=null;
  let TH=parseFloat(slider.value);
  const INPUT=640;

  slider.oninput = e => { TH = parseFloat(e.target.value); sliderText.textContent = TH.toFixed(2); };

  // === Camera Helpers ===
  const listVideoInputs = async () => {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter(d => d.kind === "videoinput");
  };

  async function populateCameraList(){
    const all = await listVideoInputs();
    const rear = all.filter(c => /背面|rear|back/i.test(c.label));
    let ultra = rear.find(c => /超広角|ultra[- ]?wide/i.test(c.label));
    let wide  = rear.find(c => c !== ultra);
    if (!wide && rear[0])  wide  = rear[0];
    if (!ultra && rear[1]) ultra = rear[1];

    camSelect.innerHTML = "";
    const addOpt = (cam, label) => { if(!cam) return; const o=document.createElement("option"); o.value=cam.deviceId; o.textContent=label; camSelect.appendChild(o); };
    addOpt(wide,  "背面カメラ");
    addOpt(ultra, "背面超広角カメラ");
    camSelect.disabled = camSelect.options.length <= 1;
  }

  async function setupCamera(deviceId=null){
    if(currentStream) currentStream.getTracks().forEach(t=>t.stop());
    const constraints = deviceId ? { video:{ deviceId:{ exact:deviceId } }, audio:false }
                                 : { video:{ facingMode:"environment" }, audio:false };
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = currentStream; await video.play();
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  }

  camSelect.onchange = async e => { status.textContent = "Switching…"; await setupCamera(e.target.value); status.textContent = "Ready"; };

  // === Model ===
  async function loadModel(){ status.textContent="Loading model…"; ortSession=await ort.InferenceSession.create("best.onnx",{executionProviders:["wasm"],wasm:{simd:true}}); status.textContent="Model loaded"; }

  // === Preprocess ===
  function preprocess(){
    const tmp=preprocess.tmp||document.createElement("canvas"); const tctx=preprocess.tctx||tmp.getContext("2d"); preprocess.tmp=tmp; preprocess.tctx=tctx; tmp.width=tmp.height=INPUT;
    const sw=video.videoWidth, sh=video.videoHeight, s=Math.min(INPUT/sw,INPUT/sh), dw=sw*s, dh=sh*s, dx=(INPUT-dw)/2, dy=(INPUT-dh)/2;
    tctx.fillStyle="#000"; tctx.fillRect(0,0,INPUT,INPUT); tctx.drawImage(video,0,0,sw,sh,dx,dy,dw,dh);
    preprocess.meta={sw,sh,s,dx,dy};
    const img=tctx.getImageData(0,0,INPUT,INPUT).data; const arr=new Float32Array(INPUT*INPUT*3); let j=0; for(let i=0;i<img.length;i+=4){arr[j++]=img[i+2]/255;arr[j++]=img[i+1]/255;arr[j++]=img[i]/255;}
    const chw=new Float32Array(arr.length); for(let c=0;c<3;c++) for(let h=0;h<INPUT;h++) for(let w=0;w<INPUT;w++) chw[c*INPUT*INPUT+h*INPUT+w]=arr[h*INPUT*3+w*3+c];
    return new ort.Tensor("float32",chw,[1,3,INPUT,INPUT]);
  }

  // === Detection Loop ===
  async function detectLoop(){
    if(!ready) return;
    const tensor = preprocess();
    ctx.drawImage(video,0,0,video.videoWidth,video.videoHeight,0,0,canvas.width,canvas.height);
    const out=await ortSession.run({images:tensor}); const d=out[Object.keys(out)[0]].data;
    const {sw,sh,s,dx,dy}=preprocess.meta; const sx=canvas.width/sw, sy=canvas.height/sh; let found=false;
    for(let i=0;i<d.length;i+=6){ const conf=d[i+4]; if(conf<TH) continue; found=true; const vx1=(d[i]-dx)/s, vy1=(d[i+1]-dy)/s, vx2=(d[i+2]-dx)/s, vy2=(d[i+3]-dy)/s; const x1=vx1*sx, y1=vy1*sy, x2=vx2*sx, y2=vy2*sy; ctx.strokeStyle="red"; ctx.lineWidth=3; ctx.strokeRect(x1,y1,x2-x1,y2-y1); ctx.fillStyle="yellow"; ctx.font="14px sans-serif"; ctx.fillText(conf.toFixed(2),x1+4,y1+16);} status.textContent = found ? "Detecting…" : "No tooth"; requestAnimationFrame(detectLoop); }

  // === Init ===
  async function init(){ try{ status.textContent="Requesting camera…"; await setupCamera(); await populateCameraList(); status.textContent="Camera OK"; await loadModel(); ready=true; status.textContent="Ready"; detectLoop(); }catch(e){ status.textContent="⚠️ "+e.message; console.error(e);} }

  startBtn.addEventListener("click", () => { startBtn.style.display="none"; init(); });
});
