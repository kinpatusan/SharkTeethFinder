// script.js – Shark‑tooth detector PWA (UI thread)
// -----------------------------------------------------------------------------
// 2025‑06‑25  Portrait 4:3 full‑width, 1:1 detect, top/bottom mask – FINAL
// Default camera: 1× (ultra‑wide)
// -----------------------------------------------------------------------------
(() => {
  /* === DOM === */
  const video   = document.getElementById('cam');
  const canvas  = document.getElementById('overlay');
  const ctx     = canvas.getContext('2d');
  const camSel  = document.getElementById('camSel');

  /* === State === */
  let stream           = null;
  let currentDeviceId  = null;

  /* === Events === */
  camSel.addEventListener('change', () => {
    startCam(camSel.value);
  });

  /* === Helpers === */
  async function populateCamSel () {
    const devices = await navigator.mediaDevices.enumerateDevices();
    camSel.innerHTML = '';

    // — choose the ultra‑wide (1×) as default if present
    let defaultIndex = 0;

    devices
      .filter(d => d.kind === 'videoinput')
      .forEach((d, i) => {
        const opt = document.createElement('option');

        // --- Friendly label mapping ---------------------------------------
        let label = d.label || `Camera ${i + 1}`;
        if (label.includes('背面カメラ'))      label = '2×';   // tele / 2×
        if (label.includes('背面超広角'))      label = '1×';   // ultra‑wide / 1×

        opt.textContent = label;
        opt.value       = d.deviceId;
        camSel.appendChild(opt);

        // remember first 1× for default selection
        if (label.startsWith('1×') && defaultIndex === 0) {
          defaultIndex = camSel.options.length - 1;
        }
      });

    camSel.selectedIndex = defaultIndex;
    currentDeviceId      = camSel.value;
  }

  async function startCam (deviceId) {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    try {
      stream          = await navigator.mediaDevices.getUserMedia({
        video : { deviceId: { exact: deviceId } },
        audio : false,
      });
      video.srcObject = stream;
    } catch (err) {
      console.error('Unable to start camera:', err);
    }
  }

  async function init () {
    await populateCamSel();
    await startCam(currentDeviceId);
    // (detector initialisation etc. stays unchanged below)…
  }

  window.addEventListener('load', init);
})();
