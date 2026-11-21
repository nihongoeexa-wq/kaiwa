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

 function bersihkanTimerJedaPedagogiKL() {
  clearTimeout(timerGantung4DetikKL);
  clearTimeout(timerHeningTotalKL);
  timerGantung4DetikKL = null;
  timerHeningTotalKL = null;
 }

 function jadwalkanCekGantung4Detik() {
  clearTimeout(timerGantung4DetikKL);
  clearTimeout(timerHeningTotalKL);

  timerGantung4DetikKL = setTimeout(() => {
   const sesi = window.NEEXA_SESI;
   if (!sesi || !sesi.aktif || !setupSudahSelesaiKL || micManualMuteKL) return;
   if (aiSedangBicaraKL || currentAiTeksKL.trim() !== '') return;
   if (!wsLive || wsLive.readyState !== WebSocket.OPEN) return;

   // Jika tepat 4 detik setelah kata terakhir siswa AI belum merespons (karena kalimat siswa menggantung/buntung), senggol AI sekarang!
   if (currentUserTeksKL.trim() !== '') {
    komitTranskripKeHistory('user');
    wsLive.send(JSON.stringify({
     clientContent: {
      turns: [{
       role: "user",
       parts: [{ text: "（相手が発話の途中や不完全な語尾で4秒間黙って止まりました。[PROTOKOL SKENARIO 2]に従い、役割として自然に「えっ、それでどうなりましたか？」「〇〇がどうかしましたか？」のように続きを促してください。）" }]
      }],
      turnComplete: true
     }
    }));
   }
  }, 4000);
 }

 function jadwalkanCekHeningTotal9Detik() {
  clearTimeout(timerHeningTotalKL);
  if (sudahCekHeningGiliranIni || menungguSalamPenutupMST_KL) return;

  timerHeningTotalKL = setTimeout(() => {
   const sesi = window.NEEXA_SESI;
   if (!sesi || !sesi.aktif || !setupSudahSelesaiKL || micManualMuteKL) return;
   if (aiSedangBicaraKL || currentUserTeksKL.trim() !== '' || currentAiTeksKL.trim() !== '') return;
   if (!wsLive || wsLive.readyState !== WebSocket.OPEN) return;

   sudahCekHeningGiliranIni = true;
   wsLive.send(JSON.stringify({
    clientContent: {
     turns: [{
      role: "user",
      parts: [{ text: "（相手がしばらく無言です。電話が聞こえているか、または質問が難しかったか、役割に合わせて短く優しく声をかけてください。）" }]
     }],
     turnComplete: true
    }
   }));
  }, 9000);
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

 function hentikanAntreanSuaraAI() {
  clearTimeout(echoTailTimerKL);
  activeSourcesKL.forEach(src => {
   try { src.stop(); } catch (e) {}
  });
  activeSourcesKL = [];
  if (audioCtxKL) {
   nextPlayTimeKL = audioCtxKL.currentTime;
  }
  aiSedangBicaraKL = false;
  perbaruiStatusVisualMicKL();
 }

 function putarPotonganPcm24k(base64Pcm) {
  if (!audioCtxKL || !window.NEEXA_SESI.aktif) return;
  if (!base64Pcm || base64Pcm.length <= 4) return;
  if (audioCtxKL.state === 'suspended') {
   audioCtxKL.resume().catch(() => {});
  }

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

  const now = audioCtxKL.currentTime;
  if (nextPlayTimeKL < now) nextPlayTimeKL = now + 0.02;

  bersihkanTimerJedaPedagogiKL();
  aiSedangBicaraKL = true;
  perbaruiStatusVisualMicKL();

  source.start(nextPlayTimeKL);
  nextPlayTimeKL += audioBuffer.duration;
  activeSourcesKL.push(source);

  source.onended = function () {
   const idx = activeSourcesKL.indexOf(source);
   if (idx !== -1) activeSourcesKL.splice(idx, 1);
   if (activeSourcesKL.length === 0) {
    echoTailTimerKL = setTimeout(() => {
     if (activeSourcesKL.length === 0) {
      aiSedangBicaraKL = false;
      perbaruiStatusVisualMicKL();
      jadwalkanCekHeningTotal9Detik();
     }
    }, 180);
   }
  };
 }

 function konversiFloat32KeBase64Pcm16k(inputFloat32, sampleRateAsli) {
  let sampel16k = inputFloat32;
  if (sampleRateAsli !== 16000) {
   const rasio = sampleRateAsli / 16000;
   const panjangBaru = Math.round(inputFloat32.length / rasio);
   sampel16k = new Float32Array(panjangBaru);
   for (let i = 0; i < panjangBaru; i++) {
    const pos = i * rasio;
    const idxBawah = Math.floor(pos);
    const idxAtas = Math.min(idxBawah + 1, inputFloat32.length - 1);
    const fraksi = pos - idxBawah;
    sampel16k[i] = inputFloat32[idxBawah] * (1 - fraksi) + inputFloat32[idxAtas] * fraksi;
   }
  }

  const pcm16 = new Int16Array(sampel16k.length);
  for (let i = 0; i < sampel16k.length; i++) {
   const s = Math.max(-1, Math.min(1, sampel16k[i]));
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

  // Saat Mode Aman Anti-Bocor aktif & AI sedang bicara, kirim sinyal hening murni (0) agar pantulan speaker tidak memotong AI
  const tahanSuaraLuar = (!sesi.bebasPotong) && aiSedangBicaraKL;
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

 function mulaiArgoWaktu30Detik() {
  clearInterval(timerDetikInterval);
  detikBerjalanKL = 0;

  const sesi = window.NEEXA_SESI;
  const maxDetikTotal = Math.max(30, (Number(sesi.maxPutaran) || 6) * 30);

  const updateTampilanTimer = () => {
   const sisaDetik = Math.max(0, maxDetikTotal - detikBerjalanKL);
   const blokTerpakai = detikBerjalanKL > 0 ? Math.min(sesi.maxPutaran, Math.ceil(detikBerjalanKL / 30)) : 0;
   sesi.putaranSaatIni = blokTerpakai;

   const elIndikator = document.getElementById('indikatorPutaran');
   if (elIndikator) {
    elIndikator.innerText = `⏱️ Sisa Waktu: ${formatMenitDetik(sisaDetik)} • Argo: ${blokTerpakai}/${sesi.maxPutaran} Blok`;
   }
   const persentase = Math.min(100, (detikBerjalanKL / maxDetikTotal) * 100);
   const bar = document.getElementById('progressBarKaiwa');
   if (bar) bar.style.width = `${persentase}%`;
  };

  updateTampilanTimer();

  timerDetikInterval = setInterval(() => {
   if (!window.NEEXA_SESI.aktif) {
    clearInterval(timerDetikInterval);
    return;
   }
   detikBerjalanKL++;
   updateTampilanTimer();

   if (detikBerjalanKL >= maxDetikTotal) {
    clearInterval(timerDetikInterval);
    window.NEEXA_SESI.putaranSaatIni = window.NEEXA_SESI.maxPutaran;
    window.NEEXA_SESI.selesaiResmiKL = true;
    komitSisaTranskripTertunda();

    const stInfo = document.getElementById('statusTeksInfo');
    if (stInfo) stInfo.innerHTML = '⏰ <b>Batas Waktu Live Tercapai!</b> Menyusun rapor evaluasi...';
    if (typeof prosesSelesaiSesi === 'function') {
     prosesSelesaiSesi(false);
    }
   }
  }, 1000);
 }

 function bukaKoneksiWebSocketKL(pakaiFallback = false) {
  const sesi = window.NEEXA_SESI;
  const statusTeks = document.getElementById('statusTeksInfo');
  const emailBersih = String(KAIWA_USER.email || '').trim().toLowerCase();
  const authToken = `${emailBersih}|${KAIWA_USER.token || ''}`;

  setupSudahSelesaiKL = false;
  alasanErrorTerakhirKL = "";
  clearTimeout(handshakeWatchdogKL);
  perbaruiStatusVisualMicKL();

  const wsBase = WORKER_URL.replace(/^http/i, 'ws').replace(/\/$/, '');
  const params = new URLSearchParams({
   auth: authToken,
   produk: sesi.produk,
   namaTema: sesi.namaTema || '',
   gender: sesi.suaraTutor || 'female',
   genderSiswa: KAIWA_USER.gender || '',
   bargeIn: sesi.bebasPotong ? '1' : '0',
   seed: String(sesi.seedAcak || 77777),
   fallback: pakaiFallback ? '1' : '0'
  });

  if (statusTeks) {
   statusTeks.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Menyambungkan telepon Live${pakaiFallback ? ' (Jalur Cadangan)' : ''}...`;
  }

  wsLive = new WebSocket(`${wsBase}/api/live-ws?${params.toString()}`);

  if (!pakaiFallback && !sudahCobaFallbackModel) {
   handshakeWatchdogKL = setTimeout(() => {
    if (sesi.aktif && !setupSudahSelesaiKL) {
     sudahCobaFallbackModel = true;
     try { wsLive.close(); } catch (e) {}
     bukaKoneksiWebSocketKL(true);
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
    console.error("Detail Error Gemini Live:", alasanErrorTerakhirKL);
    if (String(msg.neexaWsError).toLowerCase().includes('blocked') || String(msg.neexaWsError).toLowerCase().includes('api key')) {
     sudahCobaFallbackModel = true;
    }
    return;
   }

   // Setup Selesai -> Tombol Berubah MERAH BERDENYUT & Siswa Dipersilakan Bicara Duluan!
   if (msg.setupComplete !== undefined) {
    clearTimeout(handshakeWatchdogKL);
    setupSudahSelesaiKL = true;
    kirimAktivitas(pakaiFallback ? "Gemini 3.1 Flash Live (Fallback KL)" : "Gemini 3.8 Live (KL)");
    mulaiArgoWaktu30Detik();
    perbaruiStatusVisualMicKL();
    return;
   }

   if (msg.usageMetadata && msg.usageMetadata.totalTokenCount) {
    sesi.totalTokenSesi = Math.max(sesi.totalTokenSesi, Number(msg.usageMetadata.totalTokenCount) || 0);
   }

   const sc = msg.serverContent || {};

   if (sc.interrupted) {
    hentikanAntreanSuaraAI();
    komitTranskripKeHistory('ai');
   }

   const transkripInput = sc.inputTranscription || msg.inputTranscription;
   if (transkripInput && transkripInput.text) {
    sudahCekHeningGiliranIni = false;
    if (currentAiTeksKL.trim() !== '') komitTranskripKeHistory('ai');
    tambahAtauUpdateBubbleKL('user', transkripInput.text);
    jadwalkanCekGantung4Detik();
   }

   const transkripOutput = sc.outputTranscription || msg.outputTranscription;
   if (transkripOutput && transkripOutput.text) {
    bersihkanTimerJedaPedagogiKL();
    if (currentUserTeksKL.trim() !== '') komitTranskripKeHistory('user');
    tambahAtauUpdateBubbleKL('ai', transkripOutput.text);
   }

   if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
    sc.modelTurn.parts.forEach(part => {
     if (part.inlineData && part.inlineData.data && String(part.inlineData.mimeType || '').includes('audio/pcm')) {
      putarPotonganPcm24k(part.inlineData.data);
     }
    });
   }

   if (sc.turnComplete) {
    komitTranskripKeHistory('user');
    komitTranskripKeHistory('ai');
   }
  };

  wsLive.onerror = function () {
   if (!sesi.aktif) return;
   if (!pakaiFallback && !sudahCobaFallbackModel && !setupSudahSelesaiKL) {
    clearTimeout(handshakeWatchdogKL);
    sudahCobaFallbackModel = true;
    try { wsLive.close(); } catch (e) {}
    bukaKoneksiWebSocketKL(true);
   }
  };

  wsLive.onclose = function (evt) {
   clearTimeout(handshakeWatchdogKL);
   if (!sesi.aktif) return;
   if (!pakaiFallback && !sudahCobaFallbackModel && !setupSudahSelesaiKL && evt.code !== 1000) {
    sudahCobaFallbackModel = true;
    bukaKoneksiWebSocketKL(true);
    return;
   }
   komitSisaTranskripTertunda();
   document.getElementById('micWrapper')?.classList.remove('is-recording');
   const stInfo = document.getElementById('statusTeksInfo');
   if (stInfo && sesi.aktif) {
    const ket = alasanErrorTerakhirKL || evt.reason || '';
    stInfo.innerHTML = `⚠️ Telepon terputus${ket ? ' [' + ket + ']' : ''}. Silakan klik <b>Buat Rapor Sesi</b>.`;
   }
  };
 }

 window.MesinKL = {
  mulai: function (sesiConfig) {
   pasangListenerTombolKL();
   this.hentikan();

   sesiConfig.seedAcak = Math.floor(Math.random() * 900000) + 100000;
   sesiConfig.selesaiResmiKL = false;
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
   clearTimeout(autoTutupTimerKL);
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
   if (mediaStreamKL) {
    mediaStreamKL.getTracks().forEach(t => t.stop());
    mediaStreamKL = null;
   }
   if (audioCtxKL) {
    try { audioCtxKL.close(); } catch (e) {}
    audioCtxKL = null;
   }

   const micWrap = document.getElementById('micWrapper');
   if (micWrap) micWrap.classList.remove('is-recording');
  }
 };
})();
