/****************************************************
 * NEEXA ENGINE 2: KAIWA LIVE V2 (GEMINI 3.8 LIVE + AUDIOWORKLET VAD)
 * Audio-to-Audio Real-Time + Sapaan Awal Moshi-Moshi + Argo 30 Detik
 ****************************************************/

(function () {
 let wsLive = null;
 let audioCtxCapture = null;
 let audioCtxPlay = null;
 let mediaStreamKL = null;
 let workletNodeKL = null;
 let sourceNodeKL = null;
 let workletUrlBlob = null;
 let nextPlayTimeKL = 0;
 let activeSourcesKL = [];

 let timerDetikInterval = null;
 let detikBerjalanKL = 0;
 let aiSedangBicaraKL = false;
 let micManualMuteKL = false;
 let sudahCobaFallbackModel = false;
 let isListenerKLAttached = false;

 let currentUserBubbleKL = null;
 let currentUserTeksKL = "";
 let currentAiBubbleKL = null;
 let currentAiTeksKL = "";

 let menungguSalamPenutupMST_KL = false;
 let autoTutupTimerKL = null;
 let setupSudahSelesaiKL = false;
 let handshakeWatchdogKL = null;
 let alasanErrorTerakhirKL = "";

 // State Detektor Aktivitas Suara (Client-Side VAD khusus Gemini 3.8 Live)
 let userSedangBicaraVAD = false;
 let hitungFrameSuara = 0;
 let waktuTerakhirSuaraMs = 0;
 let preRollBufferB64 = [];

 function pasangListenerTombolKL() {
  if (isListenerKLAttached) return;
  const micBtn = document.getElementById('tombolMicUtama');
  if (!micBtn) return;

  micBtn.addEventListener('click', function () {
   const sesi = window.NEEXA_SESI;
   if (!sesi || !sesi.aktif || sesi.modeMesin !== "KL" || !setupSudahSelesaiKL) return;

   micManualMuteKL = !micManualMuteKL;
   if (micManualMuteKL && userSedangBicaraVAD) {
    akhiriGiliranSuaraUserVAD();
   }
   perbaruiStatusVisualMicKL();
  });
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

  if (!setupSudahSelesaiKL) {
   micWrap?.classList.remove('is-recording');
   micBtn.style.backgroundColor = "#94a3b8";
   micBtn.disabled = true;
   micBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
   return;
  }

  const modeAntiBocor = !sesi.bebasPotong;

  if (micManualMuteKL) {
   micWrap?.classList.remove('is-recording');
   micBtn.style.backgroundColor = "#64748b";
   micBtn.disabled = false;
   micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
   statusTeks.innerText = "🔇 Mikrofon di-mute sementara (Klik ikon untuk lanjut bicara)";
  } else if (aiSedangBicaraKL && modeAntiBocor) {
   micWrap?.classList.remove('is-recording');
   micBtn.style.backgroundColor = "#0284c7";
   micBtn.disabled = false;
   micBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
   statusTeks.innerText = "🛡️ AI sedang bicara (Mode Anti-Bocor menahan suara luar)";
  } else if (userSedangBicaraVAD) {
   micWrap?.classList.add('is-recording');
   micBtn.style.backgroundColor = "#dc2626";
   micBtn.disabled = false;
   micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
   statusTeks.innerText = "🎙️ Mendengar suara Anda... (Berhenti bicara sejenak agar AI menjawab)";
  } else {
   micWrap?.classList.add('is-recording');
   micBtn.style.backgroundColor = "#0d9488";
   micBtn.disabled = false;
   micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
   statusTeks.innerText = menungguSalamPenutupMST_KL
    ? "🎙️ Silakan ucapkan salam penutup wawancara Anda..."
    : "🟢 Sambungan Live Aktif — Langsung bicara (Klik ikon untuk Mute)";
  }
 }

 function hentikanAntreanSuaraAI() {
  activeSourcesKL.forEach(src => {
   try { src.stop(); } catch (e) {}
  });
  activeSourcesKL = [];
  if (audioCtxPlay) {
   nextPlayTimeKL = audioCtxPlay.currentTime;
  }
  aiSedangBicaraKL = false;
  perbaruiStatusVisualMicKL();
 }

 function putarPotonganPcm24k(base64Pcm) {
  if (!audioCtxPlay || !window.NEEXA_SESI.aktif) return;
  if (!base64Pcm || base64Pcm.length <= 4) return;
  if (audioCtxPlay.state === 'suspended') {
   audioCtxPlay.resume().catch(() => {});
  }

  const binStr = atob(base64Pcm);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);

  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
   float32[i] = int16[i] / 32768.0;
  }

  const audioBuffer = audioCtxPlay.createBuffer(1, float32.length, 24000);
  audioBuffer.getChannelData(0).set(float32);

  const source = audioCtxPlay.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtxPlay.destination);

  const now = audioCtxPlay.currentTime;
  if (nextPlayTimeKL < now) nextPlayTimeKL = now + 0.02;

  // Jika Mode Anti-Bocor aktif & user sempat memicu VAD tepat sebelum AI bicara, tutup giliran user dengan aman
  if (!window.NEEXA_SESI.bebasPotong && userSedangBicaraVAD) {
   userSedangBicaraVAD = false;
   hitungFrameSuara = 0;
  }

  aiSedangBicaraKL = true;
  perbaruiStatusVisualMicKL();

  source.start(nextPlayTimeKL);
  nextPlayTimeKL += audioBuffer.duration;
  activeSourcesKL.push(source);

  source.onended = function () {
   const idx = activeSourcesKL.indexOf(source);
   if (idx !== -1) activeSourcesKL.splice(idx, 1);
   if (activeSourcesKL.length === 0) {
    aiSedangBicaraKL = false;
    perbaruiStatusVisualMicKL();
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

 function kirimChunkPcmKeWS(b64Pcm) {
  if (!wsLive || wsLive.readyState !== WebSocket.OPEN) return;
  wsLive.send(JSON.stringify({
   realtimeInput: {
    audio: {
     mimeType: "audio/pcm;rate=16000",
     data: b64Pcm
    }
   }
  }));
 }

 function akhiriGiliranSuaraUserVAD() {
  if (!userSedangBicaraVAD) return;
  userSedangBicaraVAD = false;
  hitungFrameSuara = 0;
  preRollBufferB64 = [];

  if (wsLive && wsLive.readyState === WebSocket.OPEN) {
   wsLive.send(JSON.stringify({
    realtimeInput: {
     activityEnd: {}
    }
   }));
  }
  const statusTeks = document.getElementById('statusTeksInfo');
  if (statusTeks && window.NEEXA_SESI.aktif) {
   statusTeks.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> AI sedang merespons ucapan Anda...';
  }
 }

 function olahSampelMikrofonVAD(rawFloat, rateAsli) {
  const sesi = window.NEEXA_SESI;
  if (!sesi || !sesi.aktif || !setupSudahSelesaiKL) return;
  if (!wsLive || wsLive.readyState !== WebSocket.OPEN) return;
  if (micManualMuteKL) return;
  if (!sesi.bebasPotong && aiSedangBicaraKL) return;

  // Hitung kekuatan volume suara (RMS)
  let sumSq = 0;
  for (let i = 0; i < rawFloat.length; i++) {
   sumSq += rawFloat[i] * rawFloat[i];
  }
  const rms = Math.sqrt(sumSq / rawFloat.length);
  const ambangSuara = (sesi.bebasPotong && aiSedangBicaraKL) ? 0.028 : 0.011;
  const b64Pcm = konversiFloat32KeBase64Pcm16k(rawFloat, rateAsli);
  const skrgMs = Date.now();

  if (rms >= ambangSuara) {
   waktuTerakhirSuaraMs = skrgMs;
   hitungFrameSuara++;

   if (!userSedangBicaraVAD && hitungFrameSuara >= 2) {
    // Jika Mode Bebas Potong aktif & AI sedang bicara, hentikan suara AI lokal seketika
    if (sesi.bebasPotong && aiSedangBicaraKL) {
     hentikanAntreanSuaraAI();
     komitTranskripKeHistory('ai');
    }

    userSedangBicaraVAD = true;
    perbaruiStatusVisualMicKL();

    // 1. Kirim sinyal resmi activityStart ke Gemini 3.8 Live
    wsLive.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));

    // 2. Kirim pre-roll buffer (~350ms sebelumnya) agar suku kata pertama tidak terpotong
    while (preRollBufferB64.length > 0) {
     kirimChunkPcmKeWS(preRollBufferB64.shift());
    }
   }

   if (userSedangBicaraVAD) {
    kirimChunkPcmKeWS(b64Pcm);
   } else {
    preRollBufferB64.push(b64Pcm);
    if (preRollBufferB64.length > 9) preRollBufferB64.shift();
   }
  } else {
   hitungFrameSuara = 0;
   if (userSedangBicaraVAD) {
    // Tetap kirim ekor suara sampai hening selama 850ms, lalu kirim activityEnd
    kirimChunkPcmKeWS(b64Pcm);
    if (skrgMs - waktuTerakhirSuaraMs >= 850) {
     akhiriGiliranSuaraUserVAD();
    }
   } else {
    preRollBufferB64.push(b64Pcm);
    if (preRollBufferB64.length > 9) preRollBufferB64.shift();
   }
  }
 }

 async function mulaiAliranMikrofonKL() {
  if (mediaStreamKL && audioCtxCapture) {
   if (audioCtxCapture.state === 'suspended') await audioCtxCapture.resume();
   return;
  }

  mediaStreamKL = await navigator.mediaDevices.getUserMedia({
   audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
   }
  });

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtxCapture = new AudioContextClass();
  if (audioCtxCapture.state === 'suspended') {
   await audioCtxCapture.resume();
  }
  const rateAsli = audioCtxCapture.sampleRate;
  sourceNodeKL = audioCtxCapture.createMediaStreamSource(mediaStreamKL);

  // Gunakan AudioWorkletNode Modern (Bebas peringatan Deprecation di Konsol!)
  if (audioCtxCapture.audioWorklet) {
   const kodeWorklet = `
    class NeexaPcmProcessor extends AudioWorkletProcessor {
     constructor() {
      super();
      this._buf = new Float32Array(2048);
      this._idx = 0;
     }
     process(inputs) {
      const ch = inputs 0  && inputs 0  0 ;
      if (!ch) return true;
      for (let i = 0; i < ch.length; i++) {
       this._buf[this._idx++] = ch[i];
       if (this._idx >= 2048) {
        this.port.postMessage(this._buf.slice(0));
        this._idx = 0;
       }
      }
      return true;
     }
    }
    registerProcessor('neexa-pcm-processor', NeexaPcmProcessor);
   `;
   const blob = new Blob([kodeWorklet], { type: 'application/javascript' });
   workletUrlBlob = URL.createObjectURL(blob);
   await audioCtxCapture.audioWorklet.addModule(workletUrlBlob);

   workletNodeKL = new AudioWorkletNode(audioCtxCapture, 'neexa-pcm-processor');
   workletNodeKL.port.onmessage = function (ev) {
    olahSampelMikrofonVAD(ev.data, rateAsli);
   };
   sourceNodeKL.connect(workletNodeKL);
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
  userSedangBicaraVAD = false;
  hitungFrameSuara = 0;
  preRollBufferB64 = [];
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
   statusTeks.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Menghubungkan telepon AI Live${pakaiFallback ? ' (Jalur Cadangan)' : ''}...`;
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

  wsLive.onopen = async function () {
   try {
    await mulaiAliranMikrofonKL();
    if (wsLive && wsLive.readyState === WebSocket.OPEN) {
     wsLive.send(JSON.stringify({ neexaInit: true }));
    }
   } catch (errMic) {
    clearTimeout(handshakeWatchdogKL);
    alert("Gagal mengakses mikrofon untuk panggilan Live. Pastikan izin mikrofon aktif.");
    kirimBlackBox("Izin Mic KL Live", errMic.message);
    window.MesinKL.hentikan();
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
    return;
   }

   // 1. Setup Selesai -> Nyalakan Argo 30 Detik & AI LANGSUNG MENYAPA DULUAN ("Moshi moshi...")!
   if (msg.setupComplete !== undefined) {
    clearTimeout(handshakeWatchdogKL);
    setupSudahSelesaiKL = true;
    kirimAktivitas(pakaiFallback ? "Gemini 3.1 Flash Live (Fallback KL)" : "Gemini 3.8 Live (KL)");
    mulaiArgoWaktu30Detik();
    perbaruiStatusVisualMicKL();

    const isMST = sesi.produk.includes("-MST") || sesi.produk.startsWith("KL-MST");
    const pemicuSapaanAwal = isMST
     ? "（オンライン面接の通話がつながりました。面接官として最初に「もしもし、聞こえますか？そこに誰かいますか？」と声をかけ、続けて受験者に最初の挨拶を促してください。）"
     : "（電話がつながりました。最初に「もしもし！誰かいますか？聞こえますか？」のように自然な電話の第一声で話しかけ、設定された役割として最初の短い声かけをしてください。）";

    wsLive.send(JSON.stringify({
     clientContent: {
      turns: [{
       role: "user",
       parts: [{ text: pemicuSapaanAwal }]
      }],
      turnComplete: true
     }
    }));
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
    if (currentAiTeksKL.trim() !== '') komitTranskripKeHistory('ai');
    tambahAtauUpdateBubbleKL('user', transkripInput.text);
   }

   const transkripOutput = sc.outputTranscription || msg.outputTranscription;
   if (transkripOutput && transkripOutput.text) {
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
   menungguSalamPenutupMST_KL = false;
   sudahCobaFallbackModel = false;
   micManualMuteKL = false;
   aiSedangBicaraKL = false;
   userSedangBicaraVAD = false;
   currentUserBubbleKL = null;
   currentUserTeksKL = "";
   currentAiBubbleKL = null;
   currentAiTeksKL = "";

   const AudioContextClass = window.AudioContext || window.webkitAudioContext;
   audioCtxPlay = new AudioContextClass({ sampleRate: 24000 });
   audioCtxPlay.resume().catch(() => {});
   nextPlayTimeKL = 0;

   const totalMenitLabel = formatMenitDetik((Number(sesiConfig.maxPutaran) || 6) * 30);
   document.getElementById('activeProductDisplay').innerText = `📞 LIVE • ${sesiConfig.namaTema} (${sesiConfig.produk})`;
   document.getElementById('namaUserDiKaiwa').innerText = KAIWA_USER.nama;
   document.getElementById('progressBarKaiwa').style.width = '0%';
   document.getElementById('indikatorPutaran').innerText = `⏱️ Sisa Waktu: ${totalMenitLabel} • Argo: 0/${sesiConfig.maxPutaran} Blok`;

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
    ? `📞 <b>Wawancara Live Real-Time Terhubung</b> (${labelKeamanan})<br>Dengarkan sapaan awal Direktur, lalu langsung jawab tanpa perlu menekan tombol rekam!`
    : `📞 <b>Panggilan Kaiwa Live Aktif</b> (${labelKeamanan})<br>Dengarkan sapaan telepon dari AI Sensei, lalu langsung jawab seperti telepon biasa!`;
   chatContainer.appendChild(infoBanner);

   showView('kaiwaRoom');
   bukaKoneksiWebSocketKL(false);
  },

  komitAkhir: function () {
   if (userSedangBicaraVAD) akhiriGiliranSuaraUserVAD();
   komitSisaTranskripTertunda();
  },

  hentikan: function () {
   clearInterval(timerDetikInterval);
   clearTimeout(autoTutupTimerKL);
   clearTimeout(handshakeWatchdogKL);
   setupSudahSelesaiKL = false;
   userSedangBicaraVAD = false;
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
    workletNodeKL.port.onmessage = null;
    try { workletNodeKL.disconnect(); } catch (e) {}
    workletNodeKL = null;
   }
   if (workletUrlBlob) {
    try { URL.revokeObjectURL(workletUrlBlob); } catch (e) {}
    workletUrlBlob = null;
   }
   if (sourceNodeKL) {
    try { sourceNodeKL.disconnect(); } catch (e) {}
    sourceNodeKL = null;
   }
   if (mediaStreamKL) {
    mediaStreamKL.getTracks().forEach(t => t.stop());
    mediaStreamKL = null;
   }
   if (audioCtxCapture) {
    try { audioCtxCapture.close(); } catch (e) {}
    audioCtxCapture = null;
   }
   if (audioCtxPlay) {
    try { audioCtxPlay.close(); } catch (e) {}
    audioCtxPlay = null;
   }

   const micWrap = document.getElementById('micWrapper');
   if (micWrap) micWrap.classList.remove('is-recording');
  }
 };
})();
