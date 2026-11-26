/****************************************************
 * NEEXA ENGINE 2: KAIWA LIVE V2 (GEMINI 3.8 LIVE + AUDIOWORKLET VAD)
 * Audio-to-Audio Real-Time + Sapaan Awal Moshi-Moshi + Argo 30 Detik
 ****************************************************/

(function () {
 let wsLive = null;
 let audioCtxKL = null;
 let mediaStreamKL = null;
 let workletNodeKL = null;
 let sourceNodeKL = null;
 let nextPlayTimeKL = 0;
 let activeSourcesKL = [];

 let panggilanSudahDimulaiKL = false;
 let sedangMenyambungKL = false;
 let setupSudahSelesaiKL = false;
 let timerDetikInterval = null;
 let detikBerjalanKL = 0;

 let aiSedangBicaraKL = false;
 let echoTailTimerKL = null;
 let micManualMuteKL = false;
 let sudahCobaFallbackModel = false;
 let isListenerKLAttached = false;
 let handshakeWatchdogKL = null;
 let alasanErrorTerakhirKL = "";

 let currentUserBubbleKL = null;
 let currentUserTeksKL = "";
 let currentAiBubbleKL = null;
 let currentAiTeksKL = "";

 let menungguSalamPenutupMST_KL = false;
 let autoTutupTimerKL = null;
 let timerGantung4DetikKL = null;
 let timerHeningTotalKL = null;
 let sudahCekHeningGiliranIni = false;
 let aiTurnSedangBerjalanKL = false;
 let waktuSuaraUserTerakhirMs = 0;

 let timerAfk45DetikKL = null;
 let sessionResumeHandleKL = "";
 let jumlahAutoReconnectKL = 0;
 let sedangAutoResumeKL = false;

 // Perekam Dua Arah (Suara Direktur AI + Suara Kandidat) Khusus Simulasi Penuh KL-MST
 let mstMixDestKL = null;
 let mstRecorderKL = null;
 let mstChunksKL = [];
 let mstFinalBlobKL = null;
 let mstMimeKL = 'audio/webm';

 function bersihkanTimerJedaPedagogiKL() {
  clearTimeout(timerGantung4DetikKL);
  clearTimeout(timerHeningTotalKL);
  clearTimeout(timerAfk45DetikKL);
  timerGantung4DetikKL = null;
  timerHeningTotalKL = null;
  timerAfk45DetikKL = null;
 }

 function apakahTeksMenggantung(teksRaw) {
  const t = String(teksRaw || '').trim().replace(/[。、…\.\?\!？！\s]+$/g, '');
  if (!t) return false;
  if (/(ですが|ますけど|けど|けれど|から|ので|たら|とき|時|前に|まえに|後で|あとで|えっと|あのう|あの|うーん)$/i.test(t)) {
   return true;
  }
  if (/[がはをにへとでし]$/.test(t) && !/(ました|ません|でした)$/.test(t)) {
   return true;
  }
  if (!/(です|ます|ました|ません|でした|だ|だった|ない|なかった|たい|しい|いい|かい|がい|らい|さい|った|んだ|る|う|く|ぐ|す|つ|ぬ|ぶ|む)$/.test(t)) {
   return true;
  }
  return false;
 }

 function jadwalkanCekGantung4Detik() {
  clearTimeout(timerGantung4DetikKL);
  clearTimeout(timerHeningTotalKL);
  clearTimeout(timerAfk45DetikKL);

  timerGantung4DetikKL = setTimeout(function cekUlangGantung() {
   const sesi = window.NEEXA_SESI;
   if (!sesi || !sesi.aktif || !setupSudahSelesaiKL || micManualMuteKL) return;
   if (aiSedangBicaraKL || aiTurnSedangBerjalanKL || currentAiTeksKL.trim() !== '') return;
   if (!wsLive || wsLive.readyState !== WebSocket.OPEN) return;

   const teksUserSkrg = currentUserTeksKL.trim();
   if (!teksUserSkrg) return;

   const lamaDiamMs = Date.now() - waktuSuaraUserTerakhirMs;
   if (lamaDiamMs < 3800) {
    timerGantung4DetikKL = setTimeout(cekUlangGantung, 4000 - lamaDiamMs);
    return;
   }

   if (apakahTeksMenggantung(teksUserSkrg)) {
    komitTranskripKeHistory('user');
    aiTurnSedangBerjalanKL = true;
    wsLive.send(JSON.stringify({
     clientContent: {
      turns: [{
       role: "user",
       parts: [{ text: "（相手が文の途中で4秒間止まりました。『ゆっくりで大丈夫』などの定型文は言わず、直前の言葉を受けて「えっ、〇〇がどうしましたか？」「うん、それで？」と自然に続きを聞き返してください。）" }]
      }],
      turnComplete: true
     }
    }));
   }
  }, 4200);
 }

 // Rem Pengaman Ganda: Sapaan di 16 detik hening, dan Auto-Cut di 45 detik hening jika lupa matikan mic!
 function jadwalkanCekHeningTotal16Detik() {
  clearTimeout(timerHeningTotalKL);
  clearTimeout(timerAfk45DetikKL);
  if (menungguSalamPenutupMST_KL) return;

  if (!sudahCekHeningGiliranIni) {
   timerHeningTotalKL = setTimeout(function cekUlangHening() {
    const sesi = window.NEEXA_SESI;
    if (!sesi || !sesi.aktif || !setupSudahSelesaiKL || micManualMuteKL) return;
    if (aiSedangBicaraKL || aiTurnSedangBerjalanKL || currentUserTeksKL.trim() !== '' || currentAiTeksKL.trim() !== '') return;
    if (!wsLive || wsLive.readyState !== WebSocket.OPEN) return;

    const lamaHeningMs = Date.now() - waktuSuaraUserTerakhirMs;
    if (waktuSuaraUserTerakhirMs > 0 && lamaHeningMs < 15000) {
     timerHeningTotalKL = setTimeout(cekUlangHening, 16000 - lamaHeningMs);
     return;
    }

    sudahCekHeningGiliranIni = true;
    aiTurnSedangBerjalanKL = true;
    wsLive.send(JSON.stringify({
     clientContent: {
      turns: [{
       role: "user",
       parts: [{ text: "（相手が16秒間無言です。「もしもし、聞こえていますか？質問が難しければもう一度言いましょうか？」と短く確認してください。）" }]
      }],
      turnComplete: true
     }
    }));
   }, 16000);
  } else {
   // Sudah pernah disapa AI tapi tetap hening 30 detik lagi (~46 detik total AFK) -> Tutup otomatis agar tiket siswa aman!
   timerAfk45DetikKL = setTimeout(() => {
    const sesi = window.NEEXA_SESI;
    if (!sesi || !sesi.aktif || micManualMuteKL || aiSedangBicaraKL) return;
    const lamaDiamTotal = Date.now() - waktuSuaraUserTerakhirMs;
    if (waktuSuaraUserTerakhirMs > 0 && lamaDiamTotal < 28000) return;

    komitSisaTranskripTertunda();
    if (sesi.historyPercakapan.trim() !== '' && typeof prosesSelesaiSesi === 'function') {
     const stInfo = document.getElementById('statusTeksInfo');
     if (stInfo) stInfo.innerHTML = '🛡️ <b>Tidak ada suara selama 45 detik.</b> Panggilan ditutup otomatis demi mengamankan tiket Anda...';
     prosesSelesaiSesi(false);
    }
   }, 30000);
  }
 }

 function pasangListenerTombolKL() {
  if (isListenerKLAttached) return;
  const micBtn = document.getElementById('tombolMicUtama');
  if (!micBtn) return;

  micBtn.addEventListener('click', async function () {
   const sesi = window.NEEXA_SESI;
   if (!sesi || !sesi.aktif || sesi.modeMesin !== "KL") return;
   if (sedangMenyambungKL) return;

   // KLIK PERTAMA DI DALAM RUANGAN: Buka Mikrofon Murni dari Sentuhan Jari & Aktifkan Live!
   if (!panggilanSudahDimulaiKL) {
    await aktifkanPanggilanDariKlikUser();
    return;
   }

   // KLIK BERIKUTNYA SAAT LIVE BERLANGSUNG: Jeda (Mute) / Lanjutkan Bicara
   if (!setupSudahSelesaiKL) return;
   micManualMuteKL = !micManualMuteKL;
   if (micManualMuteKL && wsLive && wsLive.readyState === WebSocket.OPEN) {
    wsLive.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
   }
   perbaruiStatusVisualMicKL();
  });

  const btnTutupMerah = document.getElementById('btnTelpKananKL');
  if (btnTutupMerah) {
   btnTutupMerah.addEventListener('click', function () {
    const sesi = window.NEEXA_SESI;
    if (!sesi || !sesi.aktif || sesi.modeMesin !== "KL") return;
    if (typeof sedangProsesRapor !== 'undefined' && sedangProsesRapor) return;

    komitSisaTranskripTertunda();

    if (sesi.historyPercakapan.trim() === "") {
     if (confirm("Belum ada percakapan yang terekam. Akhiri panggilan dan kembali ke halaman sebelumnya?")) {
      sesi.aktif = false;
      window.MesinKL.hentikan();
      showView('dashboard');
     }
     return;
    }

    // Langsung akhiri telepon & otomatis membuat Rapor!
    if (typeof prosesSelesaiSesi === 'function') {
     prosesSelesaiSesi(false);
    }
   });
  }

  isListenerKLAttached = true;
 }

 function formatMenitDetik(totalDetik) {
  const m = Math.floor(totalDetik / 60);
  const s = totalDetik % 60;
  return String(m).padStart(2, '0') + ":" + String(s).padStart(2, '0');
 }

 function tambahAtauUpdateBubbleKL(pengirim, potonganTeks) {
  const bersih = String(potonganTeks || '');
  if (!bersih) return;

  const chatContainer = document.getElementById('chatContainer');
  if (!chatContainer) return;

  if (pengirim === 'user') {
   currentUserTeksKL += bersih;
   if (!currentUserBubbleKL) {
    const row = document.createElement('div');
    row.className = 'chat-row user';
    const avatarImg = document.createElement('img');
    avatarImg.className = 'chat-avatar';
    avatarImg.src = KAIWA_USER.avatar;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    row.appendChild(bubble);
    row.appendChild(avatarImg);
    chatContainer.appendChild(row);
    currentUserBubbleKL = bubble;
   }
   currentUserBubbleKL.textContent = currentUserTeksKL.trim();
  } else {
   currentAiTeksKL += bersih;
   if (!currentAiBubbleKL) {
    const row = document.createElement('div');
    row.className = 'chat-row ai';
    const avatarImg = document.createElement('img');
    avatarImg.className = 'chat-avatar';
    avatarImg.src = window.NEEXA_SESI.fotoTutor;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    row.appendChild(avatarImg);
    row.appendChild(bubble);
    chatContainer.appendChild(row);
    currentAiBubbleKL = bubble;
   }
   currentAiBubbleKL.textContent = currentAiTeksKL.trim();
  }

  chatContainer.scrollTop = chatContainer.scrollHeight;
 }

 function komitTranskripKeHistory(pengirim) {
  const sesi = window.NEEXA_SESI;
  if (!sesi) return;

  if (pengirim === 'user' && currentUserTeksKL.trim() !== '') {
   sesi.historyPercakapan += `Siswa: ${currentUserTeksKL.trim()}\n`;
   currentUserTeksKL = "";
   currentUserBubbleKL = null;
  } else if (pengirim === 'ai' && currentAiTeksKL.trim() !== '') {
   const kalimatAI = currentAiTeksKL.trim();
   sesi.historyPercakapan += `AI: ${kalimatAI}\n\n`;
   currentAiTeksKL = "";
   currentAiBubbleKL = null;

   const isMST = sesi.produk.includes("-MST") || sesi.produk.startsWith("KL-MST");
   if (isMST) {
    if (menungguSalamPenutupMST_KL) {
     sesi.selesaiResmiKL = true;
     const stInfo = document.getElementById('statusTeksInfo');
     if (stInfo) stInfo.innerHTML = '✅ <b>Wawancara Live Selesai!</b> Menyimpan rapor otomatis...';
     clearTimeout(autoTutupTimerKL);
     autoTutupTimerKL = setTimeout(() => {
      if (sesi.aktif && typeof prosesSelesaiSesi === 'function') prosesSelesaiSesi(false);
     }, 2200);
    } else if (kalimatAI.includes("本日の面接はこれで終了") || kalimatAI.includes("面接はこれで終了")) {
     menungguSalamPenutupMST_KL = true;
    }
   }
  }
 }

 function komitSisaTranskripTertunda() {
  komitTranskripKeHistory('user');
  komitTranskripKeHistory('ai');
 }

 function perbaruiStatusVisualMicKL() {
  const sesi = window.NEEXA_SESI;
  const micBtn = document.getElementById('tombolMicUtama');
  const micWrap = document.getElementById('micWrapper');
  const statusTeks = document.getElementById('statusTeksInfo');
  if (!micBtn || !statusTeks || !sesi || !sesi.aktif) return;

  // Kondisi 1: Belum diklik sama sekali (Menunggu 1x klik pengaktifan dari siswa)
  if (!panggilanSudahDimulaiKL && !sedangMenyambungKL) {
   micWrap?.classList.remove('is-recording');
   micBtn.style.backgroundColor = "#10b981";
   micBtn.disabled = false;
   micBtn.innerHTML = '<i class="fas fa-phone-alt"></i>';
   statusTeks.innerHTML = "👆 <b>Tekan tombol hijau SEKALI</b> untuk mengaktifkan telepon Live";
   return;
  }

  // Kondisi 2: Sedang proses jabat tangan ke server Gemini Live
  if (sedangMenyambungKL || !setupSudahSelesaiKL) {
   micWrap?.classList.remove('is-recording');
   micBtn.style.backgroundColor = "#94a3b8";
   micBtn.disabled = true;
   micBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
   return;
  }

  const modeAntiBocor = !sesi.bebasPotong;

  // Kondisi 3: Siswa menekan tombol untuk Mute sementara
  if (micManualMuteKL) {
   micWrap?.classList.remove('is-recording');
   micBtn.style.backgroundColor = "#64748b";
   micBtn.disabled = false;
   micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
   statusTeks.innerText = "🔇 Dijeda (Mute) — Tekan tombol lagi untuk lanjut bicara";
   return;
  }

  // Kondisi 4: AI sedang mengeluarkan suara & Mode Aman Anti-Bocor aktif
  if (aiSedangBicaraKL && modeAntiBocor) {
   micWrap?.classList.remove('is-recording');
   micBtn.style.backgroundColor = "#0284c7";
   micBtn.disabled = false;
   micBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
   statusTeks.innerText = "🔊 Dengarkan AI berbicara... (Otomatis merah kembali setelah selesai)";
   return;
  }

  // Kondisi 5: KAIWA LIVE AKTIF BERLANGSUNG -> TOMBOL MERAH BERDENYUT!
  micWrap?.classList.add('is-recording');
  micBtn.style.backgroundColor = "#ef4444";
  micBtn.disabled = false;
  micBtn.innerHTML = '<i class="fas fa-microphone"></i>';

  if (aiSedangBicaraKL && !modeAntiBocor) {
   statusTeks.innerText = "🔴 LIVE AKTIF (Bebas Potong) — AI sedang bicara, klik tombol jika ingin Mute";
  } else if (menungguSalamPenutupMST_KL) {
   statusTeks.innerText = "🔴 LIVE AKTIF — Silakan ucapkan salam penutup wawancara Anda!";
  } else {
   statusTeks.innerText = "🔴 LIVE BERLANGSUNG — Silakan berbicara bahasa Jepang sekarang!";
  }
 }

 function cekSelesaiBicaraPenuhAI() {
  clearTimeout(echoTailTimerKL);
  // Selama server Gemini belum mengirim turnComplete ATAU masih ada antrean audio berputar, tahan tombol tetap biru (jangan berkedip!)
  if (aiTurnSedangBerjalanKL || activeSourcesKL.length > 0) return;

  echoTailTimerKL = setTimeout(() => {
   if (!aiTurnSedangBerjalanKL && activeSourcesKL.length === 0) {
    aiSedangBicaraKL = false;
    perbaruiStatusVisualMicKL();
    jadwalkanCekHeningTotal16Detik();
   }
  }, 260);
 }

 function hentikanAntreanSuaraAI() {
  clearTimeout(echoTailTimerKL);
  activeSourcesKL.forEach(src => {
   try { src.stop(); } catch (e) {}
  });
  activeSourcesKL = [];
  if (audioCtxKL) {
   nextPlayTimeKL = audioCtxKL.currentTime;
  }
  aiTurnSedangBerjalanKL = false;
  aiSedangBicaraKL = false;
  perbaruiStatusVisualMicKL();
 }

 function putarPotonganPcm24k(base64Pcm) {
  if (!audioCtxKL || !window.NEEXA_SESI.aktif) return;
  if (!base64Pcm || base64Pcm.length <= 4) return;
  if (audioCtxKL.state === 'suspended') {
   audioCtxKL.resume().catch(() => {});
  }

  bersihkanTimerJedaPedagogiKL();
  clearTimeout(echoTailTimerKL);

  const binStr = atob(base64Pcm);
  const evenLen = binStr.length - (binStr.length % 2);
  if (evenLen <= 0) return;

  const bytes = new Uint8Array(evenLen);
  for (let i = 0; i < evenLen; i++) bytes[i] = binStr.charCodeAt(i);

  const int16 = new Int16Array(bytes.buffer, 0, evenLen / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
   float32[i] = int16[i] / 32768.0;
  }

  const audioBuffer = audioCtxKL.createBuffer(1, float32.length, 24000);
  audioBuffer.getChannelData(0).set(float32);

 const source = audioCtxKL.createBufferSource();
 source.buffer = audioBuffer;
 source.connect(audioCtxKL.destination);
 if (mstMixDestKL) { try { source.connect(mstMixDestKL); } catch (e) {} }

  const now = audioCtxKL.currentTime;
  // Jitter Buffer 150ms pada awal kalimat agar suara AI mulus 100% tanpa tersendat-sendat!
  if (nextPlayTimeKL <= now) {
   nextPlayTimeKL = now + (activeSourcesKL.length === 0 ? 0.15 : 0.03);
  }

  if (!aiSedangBicaraKL) {
   aiSedangBicaraKL = true;
   perbaruiStatusVisualMicKL();
  }

  source.start(nextPlayTimeKL);
  nextPlayTimeKL += audioBuffer.duration;
  activeSourcesKL.push(source);

  source.onended = function () {
   const idx = activeSourcesKL.indexOf(source);
   if (idx !== -1) activeSourcesKL.splice(idx, 1);
   if (activeSourcesKL.length === 0) {
    cekSelesaiBicaraPenuhAI();
   }
  };
 }

 // Downsampler Anti-Aliasing (Boxcar Averaging) + Penguat Lembut agar konsonan ujung seperti "〜ですが" terdengar tajam!
 function konversiFloat32KeBase64Pcm16k(inputFloat32, sampleRateAsli) {
  let sampel16k;
  if (sampleRateAsli === 16000) {
   sampel16k = inputFloat32;
  } else {
   const rasio = sampleRateAsli / 16000;
   const panjangBaru = Math.floor(inputFloat32.length / rasio);
   sampel16k = new Float32Array(panjangBaru);
   for (let i = 0; i < panjangBaru; i++) {
    const start = Math.floor(i * rasio);
    const end = Math.min(inputFloat32.length, Math.floor((i + 1) * rasio));
    let sum = 0;
    let count = 0;
    for (let k = start; k < end; k++) {
     sum += inputFloat32[k];
     count++;
    }
    sampel16k[i] = count > 0 ? (sum / count) : inputFloat32[start];
   }
  }

  const pcm16 = new Int16Array(sampel16k.length);
  for (let i = 0; i < sampel16k.length; i++) {
   // Sedikit angkat artikulasi suara ujung kalimat (1.25x dengan pembatas anti-pecah)
   const boosted = sampel16k[i] * 1.25;
   const s = Math.max(-1, Math.min(1, boosted));
   pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
   binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
 }

 function kirimSampelKeGemini(rawFloat, rateAsli) {
  const sesi = window.NEEXA_SESI;
  if (!sesi || !sesi.aktif || !setupSudahSelesaiKL) return;
  if (!wsLive || wsLive.readyState !== WebSocket.OPEN) return;
  if (micManualMuteKL) return;

  const tahanSuaraLuar = (!sesi.bebasPotong) && aiSedangBicaraKL;

  if (!tahanSuaraLuar) {
   let sumSq = 0;
   for (let i = 0; i < rawFloat.length; i++) sumSq += rawFloat[i] * rawFloat[i];
   const rms = Math.sqrt(sumSq / rawFloat.length);
   if (rms > 0.012) {
    waktuSuaraUserTerakhirMs = Date.now();
    // Jika siswa kembali bersuara, batalkan timer hening agar AI tidak memotong pikiran siswa!
    clearTimeout(timerHeningTotalKL);
   }
  }

  const sampelFinal = tahanSuaraLuar ? new Float32Array(rawFloat.length) : rawFloat;
  const b64Pcm = konversiFloat32KeBase64Pcm16k(sampelFinal, rateAsli);

  wsLive.send(JSON.stringify({
   realtimeInput: {
    audio: {
     mimeType: "audio/pcm;rate=16000",
     data: b64Pcm
    }
   }
  }));
 }

 let timerAbuKiriKL = null;

 async function aktifkanPanggilanDariKlikUser() {
  const statusTeks = document.getElementById('statusTeksInfo');
  sedangMenyambungKL = true;

  // Picu animasi belah: Tombol Telepon Hijau geser ke kiri (lalu abu-abu) & Tombol Tutup Merah geser ke kanan!
  const micWrap = document.getElementById('micWrapper');
  const btnKiri = document.getElementById('btnTelpKiriKL');
  btnKiri?.classList.remove('arrived-disabled');
  micWrap?.classList.add('kl-split-active');
  clearTimeout(timerAbuKiriKL);
  timerAbuKiriKL = setTimeout(() => {
   btnKiri?.classList.add('arrived-disabled');
  }, 520);

  perbaruiStatusVisualMicKL();

  try {
   // 1. Buka Speaker & Mikrofon TEPAT di dalam klik tombol (100% diizinkan semua browser HP/Laptop!)
   const AudioContextClass = window.AudioContext || window.webkitAudioContext;
   audioCtxKL = new AudioContextClass();
   if (audioCtxKL.state === 'suspended') {
    await audioCtxKL.resume();
   }

   mediaStreamKL = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
   });

  const rateAsli = audioCtxKL.sampleRate;
  sourceNodeKL = audioCtxKL.createMediaStreamSource(mediaStreamKL);

  // Jika Simulasi Penuh KL-MST, rekam percakapan 2 arah dengan kompresi ringan 24kbps
  const prodAktifKL = String(window.NEEXA_SESI?.produk || '').toUpperCase();
  if (prodAktifKL.includes('MST') && !prodAktifKL.includes('MST-LAT')) {
   try {
    mstMixDestKL = audioCtxKL.createMediaStreamDestination();
    sourceNodeKL.connect(mstMixDestKL);
    mstMimeKL = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm');
    mstChunksKL = [];
    mstFinalBlobKL = null;
    mstRecorderKL = new MediaRecorder(mstMixDestKL.stream, { mimeType: mstMimeKL, audioBitsPerSecond: 24000 });
    mstRecorderKL.ondataavailable = ev => { if (ev.data && ev.data.size > 0) mstChunksKL.push(ev.data); };
    mstRecorderKL.start(1000);
   } catch (eRecKL) {}
  }

   try {
    if (!audioCtxKL.audioWorklet) throw new Error("FallbackSP");
    const kodeWorklet = "class NeexaPcm extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.i=0;}process(inp){const c=inp[0]&&inp[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.i++]=c[k];if(this.i>=2048){this.port.postMessage(this.b.slice(0));this.i=0;}}}return true;}}registerProcessor('neexa-pcm',NeexaPcm);";
    const dataUri = "data:text/javascript;base64," + btoa(kodeWorklet);
    await audioCtxKL.audioWorklet.addModule(dataUri);

    workletNodeKL = new AudioWorkletNode(audioCtxKL, 'neexa-pcm');
    workletNodeKL.port.onmessage = function (ev) {
     kirimSampelKeGemini(ev.data, rateAsli);
    };
    sourceNodeKL.connect(workletNodeKL);
   } catch (eWorklet) {
    const spNode = audioCtxKL.createScriptProcessor(2048, 1, 1);
    const silentGain = audioCtxKL.createGain();
    silentGain.gain.value = 0;
    spNode.onaudioprocess = function (ev) {
     kirimSampelKeGemini(ev.inputBuffer.getChannelData(0), rateAsli);
    };
    sourceNodeKL.connect(spNode);
    spNode.connect(silentGain);
    silentGain.connect(audioCtxKL.destination);
    workletNodeKL = {
     disconnect: function () {
      spNode.onaudioprocess = null;
      try { spNode.disconnect(); silentGain.disconnect(); } catch (e) {}
     }
    };
   }

   panggilanSudahDimulaiKL = true;
   sedangMenyambungKL = false;

   // 2. Sambungkan WebSocket ke Gemini 3.8 Live
   bukaKoneksiWebSocketKL(false);

  } catch (errMic) {
   sedangMenyambungKL = false;
   panggilanSudahDimulaiKL = false;
   clearTimeout(timerAbuKiriKL);
   document.getElementById('micWrapper')?.classList.remove('kl-split-active');
   document.getElementById('btnTelpKiriKL')?.classList.remove('arrived-disabled');
   if (audioCtxKL) {
    try { audioCtxKL.close(); } catch (e) {}
    audioCtxKL = null;
   }
   perbaruiStatusVisualMicKL();
   if (statusTeks) {
    statusTeks.innerText = "⚠️ Izin mikrofon ditolak browser. Aktifkan izin mikrofon di ikon gembok atas lalu tekan tombol lagi.";
   }
   alert("Gagal mengakses mikrofon (" + (errMic.name || "Error") + "). Pastikan izin mikrofon di browser sudah Diizinkan (Allow), lalu tekan tombol hijau sekali lagi.");
   kirimBlackBox("Izin Mic KL Klik", errMic.message);
  }
 }

 function mulaiArgoWaktu30Detik(resetNol = true) {
  if (resetNol) {
   detikBerjalanKL = 0;
   window.NEEXA_SESI.detikAktualKL = 0;
  }
  if (timerDetikInterval) return; // Jangan buat interval ganda saat auto-resume menit ke-10!

  const sesi = window.NEEXA_SESI;
  const maxDetikTotal = Math.max(30, (Number(sesi.maxPutaran) || 6) * 30);

  const updateTampilanTimer = () => {
   const sisaDetik = Math.max(0, maxDetikTotal - detikBerjalanKL);
   const blokTerpakai = detikBerjalanKL > 0 ? Math.min(sesi.maxPutaran, Math.ceil(detikBerjalanKL / 30)) : 0;
   sesi.putaranSaatIni = blokTerpakai;
   sesi.detikAktualKL = detikBerjalanKL;

   const elIndikator = document.getElementById('indikatorPutaran');
   if (elIndikator) {
    elIndikator.innerText = `⏱️ Sisa Waktu: ${formatMenitDetik(sisaDetik)} • Durasi: ${formatMenitDetik(detikBerjalanKL)}`;
   }
   const persentase = Math.min(100, (detikBerjalanKL / maxDetikTotal) * 100);
   const bar = document.getElementById('progressBarKaiwa');
   if (bar) bar.style.width = `${persentase}%`;
  };

  updateTampilanTimer();

  timerDetikInterval = setInterval(() => {
   if (!window.NEEXA_SESI.aktif) {
    clearInterval(timerDetikInterval);
    timerDetikInterval = null;
    return;
   }
   // Jika sedang proses menyambung ulang sinyal 1 detik, tahan argo agar tidak merugikan siswa
   if (!setupSudahSelesaiKL) return;

   detikBerjalanKL++;
   updateTampilanTimer();

   if (detikBerjalanKL >= maxDetikTotal) {
    clearInterval(timerDetikInterval);
    timerDetikInterval = null;
    window.NEEXA_SESI.putaranSaatIni = window.NEEXA_SESI.maxPutaran;
    window.NEEXA_SESI.detikAktualKL = maxDetikTotal;
    window.NEEXA_SESI.selesaiResmiKL = true;
    komitSisaTranskripTertunda();

    const stInfo = document.getElementById('statusTeksInfo');
    if (stInfo) stInfo.innerHTML = '⏰ <b>Batas Waktu Maksimal Tercapai!</b> Menyusun rapor evaluasi...';
    if (typeof prosesSelesaiSesi === 'function') {
     prosesSelesaiSesi(false);
    }
   }
  }, 1000);
 }

 function sambungUlangSesiPanjangKL() {
  const sesi = window.NEEXA_SESI;
  if (!sesi || !sesi.aktif || sedangAutoResumeKL) return;
  sedangAutoResumeKL = true;
  setupSudahSelesaiKL = false;
  komitSisaTranskripTertunda();

  if (wsLive) {
   wsLive.onclose = null;
   wsLive.onerror = null;
   try { wsLive.close(1000, "Session Resumption"); } catch (e) {}
   wsLive = null;
  }

  setTimeout(() => {
   sedangAutoResumeKL = false;
   if (sesi.aktif) bukaKoneksiWebSocketKL(sudahCobaFallbackModel, true);
  }, 350);
 }

 function bukaKoneksiWebSocketKL(pakaiFallback = false, isResumeSesi = false) {
  const sesi = window.NEEXA_SESI;
  const statusTeks = document.getElementById('statusTeksInfo');
  const emailBersih = String(KAIWA_USER.email || '').trim().toLowerCase();
  const authToken = `${emailBersih}|${KAIWA_USER.token || ''}`;

  setupSudahSelesaiKL = false;
  alasanErrorTerakhirKL = "";
  clearTimeout(handshakeWatchdogKL);
  perbaruiStatusVisualMicKL();

  const wsBase = WORKER_URL.replace(/^http/i, 'ws').replace(/\/$/, '');
  const paramsObj = {
   auth: authToken,
   produk: sesi.produk,
   namaTema: sesi.namaTema || '',
   gender: sesi.suaraTutor || 'female',
   genderSiswa: KAIWA_USER.gender || '',
   bargeIn: sesi.bebasPotong ? '1' : '0',
   seed: String(sesi.seedAcak || 77777),
   fallback: pakaiFallback ? '1' : '0'
  };
  if (isResumeSesi && sessionResumeHandleKL) {
   paramsObj.resumeHandle = sessionResumeHandleKL;
  }

  if (statusTeks) {
   statusTeks.innerHTML = isResumeSesi
    ? `<i class="fas fa-sync fa-spin"></i> Memperpanjang saluran telepon tanpa putus...`
    : `<i class="fas fa-circle-notch fa-spin"></i> Menyambungkan telepon Live${pakaiFallback ? ' (Jalur Cadangan)' : ''}...`;
  }

  wsLive = new WebSocket(`${wsBase}/api/live-ws?${new URLSearchParams(paramsObj).toString()}`);

  if (!pakaiFallback && !sudahCobaFallbackModel && !isResumeSesi) {
   handshakeWatchdogKL = setTimeout(() => {
    if (sesi.aktif && !setupSudahSelesaiKL) {
     sudahCobaFallbackModel = true;
     try { wsLive.close(); } catch (e) {}
     bukaKoneksiWebSocketKL(true, false);
    }
   }, 8000);
  }

  wsLive.onopen = function () {
   if (wsLive && wsLive.readyState === WebSocket.OPEN) {
    wsLive.send(JSON.stringify({ neexaInit: true }));
   }
  };

  wsLive.onmessage = async function (evt) {
   if (!sesi.aktif) return;
   let msg;
   try {
    let rawData = evt.data;
    if (typeof Blob !== 'undefined' && rawData instanceof Blob) {
     rawData = await rawData.text();
    } else if (rawData instanceof ArrayBuffer) {
     rawData = new TextDecoder().decode(rawData);
    }
    msg = JSON.parse(rawData);
   } catch (e) {
    return;
   }

   if (msg.neexaWsError) {
    alasanErrorTerakhirKL = `${msg.neexaWsError} (Kode ${msg.code || '-'})`;
    if (String(msg.neexaWsError).toLowerCase().includes('blocked') || String(msg.neexaWsError).toLowerCase().includes('api key')) {
     sudahCobaFallbackModel = true;
    }
    return;
   }

   // Tangkap Tiket Sambung Sesi Panjang (Session Resumption Handle) dari Google!
   if (msg.sessionResumptionUpdate && msg.sessionResumptionUpdate.newHandle) {
    sessionResumeHandleKL = msg.sessionResumptionUpdate.newHandle;
   }

   // Tangkap Peringatan goAway (~menit ke-9) -> Sambung ulang diam-diam saat AI tidak sedang bicara!
   if (msg.goAway !== undefined && sessionResumeHandleKL) {
    const tungguGiliranAman = setInterval(() => {
     if (!sesi.aktif) { clearInterval(tungguGiliranAman); return; }
     if (!aiSedangBicaraKL && !aiTurnSedangBerjalanKL) {
      clearInterval(tungguGiliranAman);
      sambungUlangSesiPanjangKL();
     }
    }, 500);
    return;
   }

   // Setup Selesai -> Nyalakan / Lanjutkan Argo Waktu
   if (msg.setupComplete !== undefined) {
    clearTimeout(handshakeWatchdogKL);
    setupSudahSelesaiKL = true;
    jumlahAutoReconnectKL = 0;
    waktuSuaraUserTerakhirMs = Date.now();
    if (!isResumeSesi) {
     kirimAktivitas(pakaiFallback ? "Gemini 3.1 Flash Live (Fallback KL)" : "Gemini 3.8 Live (KL)");
    }
    mulaiArgoWaktu30Detik(!isResumeSesi);
    perbaruiStatusVisualMicKL();
    return;
   }

   if (msg.usageMetadata) {
    if (!sesi.apiUsage) {
     sesi.apiUsage = { sttDetik: 0, chatInput: 0, chatOutput: 0, chatTotal: 0, ttsChars: 0, evalInput: 0, evalOutput: 0, evalTotal: 0, liveInput: 0, liveOutput: 0, liveTotal: 0 };
    }
    const u = msg.usageMetadata;
    const lIn = Number(u.promptTokenCount) || 0;
    const lOutRaw = (Number(u.responseTokenCount) || Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0);
    const lTotRaw = Number(u.totalTokenCount) || (lIn + lOutRaw);
    const lOut = lOutRaw > 0 ? lOutRaw : Math.max(0, lTotRaw - lIn);
    const lTot = lIn + lOut;

    sesi.apiUsage.liveInput = (sesi.apiUsage.liveInput || 0) + lIn;
    sesi.apiUsage.liveOutput = (sesi.apiUsage.liveOutput || 0) + lOut;
    sesi.apiUsage.liveTotal = (sesi.apiUsage.liveTotal || 0) + lTot;
    sesi.totalTokenSesi = sesi.apiUsage.liveTotal;
   }

   const sc = msg.serverContent || {};

   if (sc.interrupted) {
    hentikanAntreanSuaraAI();
    komitTranskripKeHistory('ai');
   }

   const transkripInput = sc.inputTranscription || msg.inputTranscription;
   if (transkripInput && transkripInput.text) {
    sudahCekHeningGiliranIni = false;
    waktuSuaraUserTerakhirMs = Date.now();
    if (currentAiTeksKL.trim() !== '') komitTranskripKeHistory('ai');
    tambahAtauUpdateBubbleKL('user', transkripInput.text);
    jadwalkanCekGantung4Detik();
   }

   const transkripOutput = sc.outputTranscription || msg.outputTranscription;
   if (transkripOutput && transkripOutput.text) {
    aiTurnSedangBerjalanKL = true;
    bersihkanTimerJedaPedagogiKL();
    if (currentUserTeksKL.trim() !== '') komitTranskripKeHistory('user');
    tambahAtauUpdateBubbleKL('ai', transkripOutput.text);
   }

   if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
    aiTurnSedangBerjalanKL = true;
    bersihkanTimerJedaPedagogiKL();
    sc.modelTurn.parts.forEach(part => {
     if (part.inlineData && part.inlineData.data && String(part.inlineData.mimeType || '').includes('audio/pcm')) {
      putarPotonganPcm24k(part.inlineData.data);
     }
    });
   }

   if (sc.turnComplete) {
    aiTurnSedangBerjalanKL = false;
    komitTranskripKeHistory('user');
    komitTranskripKeHistory('ai');
    cekSelesaiBicaraPenuhAI();
   }
  };

  wsLive.onerror = function () {
   if (!sesi.aktif) return;
   if (!pakaiFallback && !sudahCobaFallbackModel && !setupSudahSelesaiKL && !isResumeSesi) {
    clearTimeout(handshakeWatchdogKL);
    sudahCobaFallbackModel = true;
    try { wsLive.close(); } catch (e) {}
    bukaKoneksiWebSocketKL(true, false);
   }
  };

  wsLive.onclose = function (evt) {
   clearTimeout(handshakeWatchdogKL);
   if (!sesi.aktif || sedangAutoResumeKL) return;

   // 1. Jika belum sempat tersambung di awal -> coba fallback model
   if (!pakaiFallback && !sudahCobaFallbackModel && !setupSudahSelesaiKL && evt.code !== 1000 && !isResumeSesi) {
    sudahCobaFallbackModel = true;
    bukaKoneksiWebSocketKL(true, false);
    return;
   }

   // 2. Jika sinyal HP kedip/putus di tengah obrolan ATAU batas 10 menit -> Auto-Reconnect pakai Resume Handle (Maks 3x berturut-turut)!
   if (sessionResumeHandleKL && evt.code !== 1000 && jumlahAutoReconnectKL < 3) {
    jumlahAutoReconnectKL++;
    sambungUlangSesiPanjangKL();
    return;
   }

   komitSisaTranskripTertunda();
   document.getElementById('micWrapper')?.classList.remove('is-recording');
   const stInfo = document.getElementById('statusTeksInfo');
   if (stInfo && sesi.aktif) {
    stInfo.innerHTML = `⚠️ Sinyal telepon terputus. Tekan tombol <b>Tutup Telepon Merah (Kanan)</b> untuk melihat Rapor Anda.`;
   }
  };
 }

 window.MesinKL = {
  mulai: function (sesiConfig) {
   pasangListenerTombolKL();
   this.hentikan();

   sesiConfig.seedAcak = Math.floor(Math.random() * 900000) + 100000;
   sesiConfig.selesaiResmiKL = false;
   sesiConfig.detikAktualKL = 0;
   sessionResumeHandleKL = "";
   jumlahAutoReconnectKL = 0;
   sedangAutoResumeKL = false;
   panggilanSudahDimulaiKL = false;
   sedangMenyambungKL = false;
   setupSudahSelesaiKL = false;
   menungguSalamPenutupMST_KL = false;
   sudahCobaFallbackModel = false;
   micManualMuteKL = false;
   aiSedangBicaraKL = false;
   currentUserBubbleKL = null;
   currentUserTeksKL = "";
   currentAiBubbleKL = null;
   currentAiTeksKL = "";
   nextPlayTimeKL = 0;

   const totalMenitLabel = formatMenitDetik((Number(sesiConfig.maxPutaran) || 6) * 30);
   document.getElementById('activeProductDisplay').innerText = `📞 LIVE • ${sesiConfig.namaTema}`;
   document.getElementById('namaUserDiKaiwa').innerText = KAIWA_USER.nama;
   document.getElementById('progressBarKaiwa').style.width = '0%';
   document.getElementById('indikatorPutaran').innerText = `⏱️ Siap Tersambung • Durasi Maks: ${totalMenitLabel} (${sesiConfig.maxPutaran} Blok)`;

   // Siapkan panggung 3 tombol telepon Live & sembunyikan tombol Buat Rapor luar
   clearTimeout(timerAbuKiriKL);
   const micWrap = document.getElementById('micWrapper');
   micWrap?.classList.add('kl-call-mode');
   micWrap?.classList.remove('kl-split-active');
   document.getElementById('btnTelpKiriKL')?.classList.remove('arrived-disabled');
   document.getElementById('btnSelesaiKaiwa')?.classList.add('hidden');

   const chatContainer = document.getElementById('chatContainer');
   chatContainer.innerHTML = '';

   const isMST = sesiConfig.produk.includes("-MST") || sesiConfig.produk.startsWith("KL-MST");
   const infoBanner = document.createElement('div');
   infoBanner.style.cssText = isMST
    ? "background:#fff1f2; border:1px dashed #fda4af; color:#9f1239; padding:12px 15px; border-radius:12px; font-size:12px; text-align:center; line-height:1.5; font-weight:600;"
    : "background:#f0fdfa; border:1px dashed #5eead4; color:#115e59; padding:12px 15px; border-radius:12px; font-size:12px; text-align:center; line-height:1.5; font-weight:600;";

   const labelKeamanan = sesiConfig.bebasPotong
    ? "⚡ Mode Anti-Bocor: <b>DIMATIKAN</b> (Gunakan Headset)"
    : "🛡️ Mode Aman Anti Suara Bocor: <b>AKTIF</b>";

   infoBanner.innerHTML = isMST
    ? `📞 <b>Ruang Wawancara Live Siap</b> (${labelKeamanan})<br>Tekan tombol telepon hijau sekali di bawah. Saat tombol tengah <b>Merah Berdenyut</b>, langsung ucapkan salam pembuka!`
    : `📞 <b>Ruang Percakapan Live Siap</b> (${labelKeamanan})<br>Tekan tombol telepon hijau sekali di bawah. Saat tombol tengah <b>Merah Berdenyut</b>, langsung mulai bicara!`;
   chatContainer.appendChild(infoBanner);

   showView('kaiwaRoom');
   perbaruiStatusVisualMicKL();
  },

  komitAkhir: function () {
   komitSisaTranskripTertunda();
  },

  hentikan: function () {
   clearInterval(timerDetikInterval);
   timerDetikInterval = null;
   clearTimeout(autoTutupTimerKL);
   sessionResumeHandleKL = "";
   sedangAutoResumeKL = false;
   bersihkanTimerJedaPedagogiKL();
   sudahCekHeningGiliranIni = false;
   clearTimeout(handshakeWatchdogKL);
   clearTimeout(echoTailTimerKL);
   panggilanSudahDimulaiKL = false;
   sedangMenyambungKL = false;
   setupSudahSelesaiKL = false;
   komitSisaTranskripTertunda();

   if (wsLive) {
    wsLive.onclose = null;
    wsLive.onerror = null;
    wsLive.onmessage = null;
    try { wsLive.close(1000, "Sesi Selesai"); } catch (e) {}
    wsLive = null;
   }

   hentikanAntreanSuaraAI();

   if (workletNodeKL) {
    if (workletNodeKL.port) workletNodeKL.port.onmessage = null;
    try { workletNodeKL.disconnect(); } catch (e) {}
    workletNodeKL = null;
   }
   if (sourceNodeKL) {
    try { sourceNodeKL.disconnect(); } catch (e) {}
    sourceNodeKL = null;
   }
  if (mstRecorderKL && mstRecorderKL.state !== 'inactive') {
   try {
    mstRecorderKL.onstop = () => {
     if (mstChunksKL.length > 0) mstFinalBlobKL = new Blob(mstChunksKL, { type: mstMimeKL });
    };
    mstRecorderKL.stop();
   } catch (e) {}
  }
  mstMixDestKL = null;

  if (mediaStreamKL) {
   mediaStreamKL.getTracks().forEach(t => t.stop());
   mediaStreamKL = null;
  }
  if (audioCtxKL) {
   const ctxLama = audioCtxKL;
   audioCtxKL = null;
   setTimeout(() => { try { ctxLama.close(); } catch (e) {} }, 220);
  }

  const micWrap = document.getElementById('micWrapper');
  if (micWrap) micWrap.classList.remove('is-recording');
 },

 ambilBlobRekamanMST: async function () {
  await new Promise(r => setTimeout(r, 260));
  if (!mstFinalBlobKL && mstChunksKL.length > 0) {
   mstFinalBlobKL = new Blob(mstChunksKL, { type: mstMimeKL });
  }
  return mstFinalBlobKL ? { blob: mstFinalBlobKL, mimeType: mstMimeKL } : null;
 },

 hapusRekamanMST: function () {
  mstChunksKL = [];
  mstFinalBlobKL = null;
  mstRecorderKL = null;
  mstMixDestKL = null;
 }
 };
})();
