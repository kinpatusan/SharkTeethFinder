// script.js – UI thread (worker‑based) for Shark Tooth Detector PWA
// -----------------------------------------------------------------------------
// 2025‑06‑23  Portrait‑center update (fixed aspect)
//   • 4:3 プレビューを画面中央に縦センタリング
//   • 高さ計算を width * 3 / 4 に修正 (本来の 4:3 比率)
// -----------------------------------------------------------------------------
(() => {
  /* ───────── DOM ───────── */
  const video  = document.getElementById('cam');
  const canvas = document.getElementById('view');
  const status = document.getElementById('status');
  const ctx    = canvas.getContext('2d');

  const maskL = document.getElementById('maskL');
  const maskR = document.getElementById('maskR');
  const maskT = document.getElementById('maskT');
  const maskB = document.getElementById('maskB');

  /* ───────── UI (TH slider & camera select) ───────── */
  const ui = document.createElement('div');
  Object.assign(ui.style, {
    position:'fixed',top:'8px',left:'50%',transform:'translateX(-50%)',
    background:'rgba(0,0,0,.55)',padding:'6px 12px',borderRadius:'8px',
    color:'#fff',fontSize:'14px',zIndex:1000,whiteSpace:'nowrap'
  });
  ui.innerHTML = `TH: <span id="thrVal">0.65</span>
    <input id="thr" type="range" min="0.10" max="0.90" step="0.05" value="0.65" style="width:120px;vertical-align:middle;">
    &nbsp;| Camera: <select id="camSel" style="background:#222;color:#fff;border-radius:4px;padding:2px 4px;"></select>`;
  document.body.appendChild(ui);
  const slider=document.getElementById('thr');
  const sliderVal=document.getElementById('thrVal');
  const camSel=document.getElementById('camSel');
  let TH=0.65; slider.oninput=e=>{TH=+e.target.value;sliderVal.textContent=TH.toFixed(2);};

  /* ───────── Worker setup ───────── */
  const wk=new Worker('worker.js');
  let workerReady=false;
  wk.onmessage=e=>{
    if(e.data.type==='ready'){workerReady=true;status.textContent='Ready';}
    else if(e.data.type==='bbox'){lastBoxes=new Float32Array(e.data.boxes);pending=false;}
  };
  wk.postMessage({type:'init',modelUrl:'best.onnx',numThreads:2});

  /* ───────── Camera helpers ───────── */
  let currentStream=null;
  async function listCams(){return(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');}
  async function populateCamSel(){
    const cams=await listCams();
    const rear=cams.filter(c=>/rear|back|背面/i.test(c.label));
    const wide=rear[0]||cams[0];
    const ultra=rear.find(c=>/ultra[- ]?wide|超広角/i.test(c.label));
    camSel.innerHTML='';
    const add=(c,l)=>{if(!c)return;const o=document.createElement('option');o.value=c.deviceId;o.textContent=l;camSel.appendChild(o);} ;
    add(wide,'背面カメラ'); add(ultra,'背面超広角');
    camSel.disabled=camSel.options.length<=1;
  }
  async function setupCamera(deviceId){
    if(currentStream)currentStream.getTracks().forEach(t=>t.stop());
    const constr=deviceId?{video:{deviceId:{exact:deviceId}},audio:false}:{video:{facingMode:'environment'},audio:false};
    currentStream=await navigator.mediaDevices.getUserMedia(constr);
    video.srcObject=currentStream;
    await video.play();
    updateLayout(video.videoWidth,video.videoHeight);
  }
  camSel.onchange=async e=>{status.textContent='Switching…';await setupCamera(e.target.value);status.textContent='Ready';};

  /* ───────── Layout & mask ───────── */
  let lastKey='';
  function updateLayout(sw,sh){
    if(!sw||!sh) return null;

    // 1) canvas サイズ (4:3)
    if(window.innerWidth < window.innerHeight){
      canvas.width  = window.innerWidth;
      canvas.height = Math.round(canvas.width * 3 / 4); // ★ 正しい 4:3 比率
    }else{
      canvas.height = window.innerHeight;
      canvas.width  = Math.round(canvas.height * 4 / 3);
    }

    // 2) 画面中央に縦方向オフセット
    const offsetY=Math.max((window.innerHeight - canvas.height)/2,0);
    canvas.style.top=`${offsetY}px`;

    // 3) 4:3 内枠サイズ
    const sUI=Math.min(canvas.width/sw, canvas.height/sh);
    const dw=sw*sUI, dh=sh*sUI;
    const dx=(canvas.width - dw)/2;
    const dy=(canvas.height- dh)/2;

    // 4) マスク位置（必要時のみ更新）
    const key=`${dx}|${dy}|${dw}|${dh}|${canvas.width}|${canvas.height}|${offsetY}`;
    if(key!==lastKey){
      const fullH=window.innerHeight;
      maskL.style.cssText=`left:0;top:0;width:${dx}px;height:${fullH}px;`;
      maskR.style.cssText=`left:${dx+dw}px;top:0;width:${canvas.width-dx-dw}px;height:${fullH}px;`;
      maskT.style.cssText=`left:${dx}px;top:0;width:${dw}px;height:${offsetY+dy}px;`;
      maskB.style.cssText=`left:${dx}px;top:${offsetY+dy+dh}px;width:${dw}px;height:${fullH-(offsetY+dy+dh)}px;`;
      lastKey=key;
    }
    return {dx,dy,dw,dh,sUI};
  }
  window.addEventListener('resize',()=>updateLayout(video.videoWidth,video.videoHeight));

  /* ───────── Worker input canvas (640×640) ───────── */
  const tmp=document.createElement('canvas');tmp.width=tmp.height=640;const tctx=tmp.getContext('2d');
  function drawLetterbox(){const sw=video.videoWidth,sh=video.videoHeight;const s=Math.min(640/sw,640/sh);const dw=sw*s,dh=sh*s;const dx=(640-dw)/2,dy=(640-dh)/2;tctx.drawImage(video,0,0,sw,sh,dx,dy,dw,dh);} 

  /* ───────── Render loop ───────── */
  let pending=false,lastBoxes=null;
  async function loop(){
    if(video.readyState>=2 && workerReady){
      const sw=video.videoWidth,sh=video.videoHeight;
      const layout=updateLayout(sw,sh);
      if(layout){const{dx,dy,dw,dh,sUI}=layout;
        // worker へ
        if(!pending){drawLetterbox();const bmp=await createImageBitmap(tmp);wk.postMessage({type:'frame',bitmap:bmp},[bmp]);pending=true;}
        // 背景
        const sCover=Math.max(canvas.width/sw,canvas.height/sh);
        const dwC=sw*sCover, dhC=sh*sCover;
        ctx.drawImage(video,0,0,sw,sh,(canvas.width-dwC)/2,(canvas.height-dhC)/2,dwC,dhC);
        // BBox
        if(lastBoxes){const arr=lastBoxes;const sL=Math.min(640/sw,640/sh);const dwL=sw*sL,dhL=sh*sL;const dxL=(640-dwL)/2,dyL=(640-dhL)/2;ctx.lineWidth=3;ctx.strokeStyle='red';ctx.fillStyle='yellow';ctx.font='14px sans-serif';for(let i=0;i<arr.length;i+=6){const conf=arr[i+4];if(conf<TH)continue;const vx1=(arr[i]-dxL)/sL,vy1=(arr[i+1]-dyL)/sL;const vx2=(arr[i+2]-dxL)/sL,vy2=(arr[i+3]-dyL)/sL;const x1=dx+vx1*sUI,y1=dy+vy1*sUI,x2=dx+vx2*sUI,y2=dy+vy2*sUI;ctx.strokeRect(x1,y1,x2-x1,y2-y1);ctx.fillText((conf*100).toFixed(1)+'%',x1+4,y1+16);}}}
    }
    requestAnimationFrame
