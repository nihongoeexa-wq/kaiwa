/****************************************************
 * NEEXA ENGINE 2: KAIWA LIVE (KL - WEBSOCKET GEMINI 3.8 LIVE)
 * Audio-to-Audio Real-Time + Transkrip Chat + Argo 30 Detik
 * Dipanggil otomatis oleh Dispatcher jika kode produk diawali "KL"
 ****************************************************/

(function () {
 let wsLive = null;
 let audioCtxCapture = null;
 let audioCtxPlay = null;
 let mediaStreamKL = null;
 let processorNodeKL = null;
 let sourceNodeKL = null;
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

 function pasangListenerTombolKL() {
  if (isListenerKLAttached) return;
  const micBtn = document.getElementById('tombolMicUtama');
  if (!micBtn) return;

  micBtn.addEventListener('click', function () {
   const sesi = window.NEEXA_SESI;
   if (!sesi || !sesi.aktif || sesi.modeMesin !== "KL") return;

   micManualMuteKL = !micManualMuteKL;
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

   // Deteksi Penutupan Resmi Direktur pada Wawancara Live (KL-MST)
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
   statusTeks.innerText = "🛡️ AI sedang bicara (Mode Anti-Bocor aktif menahan suara luar)";
  } else if (aiSedangBicaraKL && !modeAntiBocor) {
   micWrap?.classList.add('is-recording');
   micBtn.style.backgroundColor = "#0d9488";
   micBtn.disabled = false;
   micBtn.innerHTML = '<i class="fas fa-Assistive-listening-systems fa-wave-square"></i>';
   statusTeks.innerText = "🔊 AI berbicara (Bebas potong aktif • Klik tombol jika ingin Mute)";
  } else {
   micWrap?.classList.add('is-recording');
   micBtn.style.backgroundColor = "#0d9488";
   micBtn.disabled = false;
   micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
   statusTeks.innerText = menungguSalamPenutupMST_KL
    ? "🎙️ Silakan ucapkan salam penutup wawancara Anda..."
    : "🟢 Sambungan Live Aktif — Langsung bicara tanpa tahan tombol (Klik untuk Mute)";
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

 async function mulaiAliranMikrofonKL() {
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
  const rateAsli = audioCtxCapture.sampleRate;

  sourceNodeKL = audioCtxCapture.createMediaStreamSource(mediaStreamKL);
  processorNodeKL = audioCtxCapture.createScriptProcessor(4096, 1, 1);

  processorNodeKL.onaudioprocess = function (e) {
   const sesi = window.NEEXA_SESI;
   if (!sesi || !sesi.aktif || !wsLive || wsLive.readyState !== WebSocket.OPEN) return;
   if (micManualMuteKL) return;

   // Fitur Keamanan Anti Suara Bocor: tahan pengiriman mic selama AI sedang berbicara
   if (!sesi.bebasPotong && aiSedangBicaraKL) return;

   const rawFloat = e.inputBuffer.getChannelData(0);
   const b64Pcm = konversiFloat32KeBase64Pcm16k(rawFloat, rateAsli);

   wsLive.send(JSON.stringify({
    realtimeInput: {
     mediaChunks: [{
      mimeType: "audio/pcm;rate=16000",
      data: b64Pcm
     }]
    }
   }));
  };

  sourceNodeKL.connect(processorNodeKL);
  processorNodeKL.connect(audioCtxCapture.destination);
 }

 function mulaiArgoWaktu30Detik() {
  clearInterval(timerDetikInterval);
  detikBerjalanKL = 0;

  const sesi = window.NEEXA_SESI;
  const maxDetikTotal = Math.max(30, (Number(sesi.maxPutaran) || 6) * 30);

  const updateTampilanTimer = () => {
   const sisaDetik = Math.max(0, maxDetikTotal - detikBerjalanKL);
   // Argo per 30 detik (begitu panggilan tersambung & berjalan, minimal 1 blok 30 detik dihitung setiap kelipatan 30 dtk)
   const blokTerpakai = detikBerjalanKL > 0 ? Math.min(sesi.maxPutaran, Math.ceil(detikBerjalanKL / 30)) : 0;
   sesi.putaranSaatIni = blokTerpakai;

   const elIndikator = document.getElementById('indikatorPutaran');
   if (elIndikator) {
    elIndikator.innerText = `⏱️ Sisa Waktu: ${formatMenitDetik(sisaDetik)} • Argo: ${blokTerpakai}/${sesi.maxPutaran} Blok (30 dtk)`;
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
   statusTeks.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menghubungkan saluran telepon AI Live...';
  }

  wsLive = new WebSocket(`${wsBase}/api/live-ws?${params.toString()}`);

  wsLive.onopen = async function () {
   try {
    await mulaiAliranMikrofonKL();
   } catch (errMic) {
    alert("Gagal mengakses mikrofon untuk panggilan Live. Pastikan izin mikrofon aktif.");
    kirimBlackBox("Izin Mic KL Live", errMic.message);
    window.MesinKL.hentikan();
    return;
   }
  };

  wsLive.onmessage = function (evt) {
   if (!sesi.aktif) return;
   let msg;
   try {
    msg = JSON.parse(evt.data);
   } catch (e) {
    return;
   }

   // 1. Setup Selesai -> Mulai Argo Timer & Sapaan Awal (Kecuali MST wajib disapa kandidat duluan!)
   if (msg.setupComplete !== undefined) {
    kirimAktivitas(pakaiFallback ? "Gemini 3.1 Flash Live (Fallback KL)" : "Gemini 3.8 Live (KL)");
    mulaiArgoWaktu30Detik();
    perbaruiStatusVisualMicKL();

    const isMST = sesi.produk.includes("-MST") || sesi.produk.startsWith("KL-MST");
    if (isMST) {
     if (statusTeks) statusTeks.innerText = "🎙️ Telepon Wawancara Terhubung! Ucapkan salam pembuka Anda lebih dulu...";
    } else {
     // Pancing AI menyapa duluan dengan ramah sesuai peran skenario
     wsLive.send(JSON.stringify({
      clientContent: {
       turns: [{
        role: "user",
        parts: [{ text: "（電話がつながりました。設定された役割として、最初の一言の挨拶と最初の質問を自然な日本語で短く話しかけてください。）" }]
       }],
       turnComplete: true
      }
     }));
    }
    return;
   }

   // 2. Catat Pemakaian Token dari Metadata Gemini Live
   if (msg.usageMetadata && msg.usageMetadata.totalTokenCount) {
    sesi.totalTokenSesi = Math.max(sesi.totalTokenSesi, Number(msg.usageMetadata.totalTokenCount) || 0);
   }

   const sc = msg.serverContent;
   if (!sc) return;

   // Jika Mode Bebas Potong aktif & user menyela AI
   if (sc.interrupted) {
    hentikanAntreanSuaraAI();
    komitTranskripKeHistory('ai');
   }

   // Transkrip Suara Siswa -> Balon Chat Kanan
   if (sc.inputTranscription && sc.inputTranscription.text) {
    if (currentAiTeksKL.trim() !== '') komitTranskripKeHistory('ai');
    tambahAtauUpdateBubbleKL('user', sc.inputTranscription.text);
   }

   // Transkrip Suara AI -> Balon Chat Kiri
   if (sc.outputTranscription && sc.outputTranscription.text) {
    if (currentUserTeksKL.trim() !== '') komitTranskripKeHistory('user');
    tambahAtauUpdateBubbleKL('ai', sc.outputTranscription.text);
   }

   // Potongan Suara Audio PCM 24kHz dari Gemini 3.8 Live
   if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
    sc.modelTurn.parts.forEach(part => {
     if (part.inlineData && part.inlineData.data && String(part.inlineData.mimeType || '').includes('audio/pcm')) {
      putarPotonganPcm24k(part.inlineData.data);
     }
    });
   }

   // Giliran Bicara AI Selesai -> Simpan Kalimat ke History Rapor
   if (sc.turnComplete) {
    komitTranskripKeHistory('user');
    komitTranskripKeHistory('ai');
   }
  };

  wsLive.onerror = function () {
   if (!sesi.aktif) return;
   if (!pakaiFallback && !sudahCobaFallbackModel && detikBerjalanKL < 3) {
    sudahCobaFallbackModel = true;
    try { wsLive.close(); } catch (e) {}
    bukaKoneksiWebSocketKL(true);
   }
  };

  wsLive.onclose = function (evt) {
   if (!sesi.aktif) return;
   if (!pakaiFallback && !sudahCobaFallbackModel && detikBerjalanKL < 3 && evt.code !== 1000) {
    sudahCobaFallbackModel = true;
    bukaKoneksiWebSocketKL(true);
    return;
   }
   komitSisaTranskripTertunda();
   const stInfo = document.getElementById('statusTeksInfo');
   if (stInfo && sesi.aktif) {
    stInfo.innerHTML = '⚠️ Sambungan telepon terputus. Silakan klik <b>Buat Rapor Sesi</b> untuk menyimpan hasil.';
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
   currentUserBubbleKL = null;
   currentUserTeksKL = "";
   currentAiBubbleKL = null;
   currentAiTeksKL = "";

   const AudioContextClass = window.AudioContext || window.webkitAudioContext;
   audioCtxPlay = new AudioContextClass({ sampleRate: 24000 });
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
    ? `📞 <b>Wawancara Live Real-Time Terhubung</b> (${labelKeamanan})<br>Direktur Jepang menunggu di saluran telepon. Langsung ucapkan salam pembuka tanpa perlu menekan tombol rekam!`
    : `📞 <b>Panggilan Kaiwa Live Aktif</b> (${labelKeamanan})<br>Mengobrol langsung layaknya telepon asli. Teks percakapan akan tertulis otomatis di layar ini.`;
   chatContainer.appendChild(infoBanner);

   showView('kaiwaRoom');
   bukaKoneksiWebSocketKL(false);
  },

  komitAkhir: function () {
   komitSisaTranskripTertunda();
  },

  hentikan: function () {
   clearInterval(timerDetikInterval);
   clearTimeout(autoTutupTimerKL);
   komitSisaTranskripTertunda();

   if (wsLive) {
    wsLive.onclose = null;
    wsLive.onerror = null;
    wsLive.onmessage = null;
    try { wsLive.close(1000, "Sesi Selesai"); } catch (e) {}
    wsLive = null;
   }

   hentikanAntreanSuaraAI();

   if (processorNodeKL) {
    processorNodeKL.onaudioprocess = null;
    try { processorNodeKL.disconnect(); } catch (e) {}
    processorNodeKL = null;
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
