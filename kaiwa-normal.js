/****************************************************
 * NEEXA ENGINE 1: KAIWA NORMAL (KN - HTTP TURN-BASED)
 * Dipanggil otomatis oleh Dispatcher jika kode produk diawali "KN"
 ****************************************************/

(function () {
  let chatHistoryKN = [];
  let mediaRecorderKN = null;
  let localStreamKN = null;
  let audioChunksKN = [];
  let isRecordingKN = false;
 let audioPlayerKN = new Audio();
 let isAudioUnlockedKN = false;
 let isListenerAttached = false;

 // Perekam Khusus Arsip Kandidat Lulus Simulasi MST (Hemat 24kbps, Privat TSK)
 let mstAudioCtxKN = null;
 let mstMixDestKN = null;
 let mstRecorderKN = null;
 let mstChunksKN = [];
 let mstFinalBlobKN = null;
 let mstMimeKN = 'audio/webm';

  function pasangListenerMicSatuKali() {
    if (isListenerAttached) return;
    const micBtn = document.getElementById('tombolMicUtama');
    if (!micBtn) return;

    micBtn.addEventListener('click', handleKlikMicKN);
    isListenerAttached = true;
  }

  function tambahBubbleKN(pengirim, teks, allowHtml = false) {
    const chatContainer = document.getElementById('chatContainer');
    const row = document.createElement('div');
    row.className = `chat-row ${pengirim}`;

    const avatarImg = document.createElement('img');
    avatarImg.className = 'chat-avatar';
    avatarImg.src = (pengirim === 'user') ? KAIWA_USER.avatar : window.NEEXA_SESI.fotoTutor;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    if (allowHtml) bubble.innerHTML = teks;
    else bubble.textContent = teks;

    if (pengirim === 'user') {
      row.appendChild(bubble);
      row.appendChild(avatarImg);
    } else {
      row.appendChild(avatarImg);
      row.appendChild(bubble);
    }

    chatContainer.appendChild(row);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return bubble;
  }

  function resetTombolMicKN() {
    const micBtn = document.getElementById('tombolMicUtama');
    if (!micBtn) return;
    micBtn.style.backgroundColor = "#ef4444";
    micBtn.disabled = false;
    micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
  }

  async function handleKlikMicKN() {
    const sesi = window.NEEXA_SESI;
    if (!sesi.aktif || sesi.modeMesin !== "KN") return;

    const micBtn = document.getElementById('tombolMicUtama');
    const statusTeks = document.getElementById('statusTeksInfo');

    if (!isAudioUnlockedKN) {
      audioPlayerKN.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      audioPlayerKN.play().catch(() => {});
      isAudioUnlockedKN = true;
    }

    if (!isRecordingKN) {
      if (sesi.putaranSaatIni >= sesi.maxPutaran) {
        alert("Batas maksimal percakapan sudah tercapai. Silakan klik Buat Rapor Sesi.");
        return;
      }

      try {
        localStreamKN = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 44100 }
        });

        let options = {};
        if (MediaRecorder.isTypeSupported('audio/webm')) options = { mimeType: 'audio/webm' };
        else if (MediaRecorder.isTypeSupported('audio/mp4')) options = { mimeType: 'audio/mp4' };

    audioChunksKN = [];
    mediaRecorderKN = new MediaRecorder(localStreamKN, options);
    mediaRecorderKN.start();
    isRecordingKN = true;

    // Rekam jawaban kandidat ke pita arsip MST jika sedang Simulasi Penuh MST
    let micSrcMstTemp = null;
    try {
     if (mstAudioCtxKN && mstMixDestKN && mstRecorderKN) {
      if (mstAudioCtxKN.state === 'suspended') mstAudioCtxKN.resume().catch(() => {});
      micSrcMstTemp = mstAudioCtxKN.createMediaStreamSource(localStreamKN);
      micSrcMstTemp.connect(mstMixDestKN);
      if (mstRecorderKN.state === 'paused') mstRecorderKN.resume();
     }
    } catch (eMst) {}

    document.getElementById('micWrapper').classList.add('is-recording');
    micBtn.style.backgroundColor = "#b91c1c";
    micBtn.innerHTML = '<i class="fas fa-stop"></i>';
    statusTeks.innerText = "🔴 Sedang mendengarkan... (Tekan untuk stop)";

    mediaRecorderKN.ondataavailable = e => {
     if (e.data.size > 0) audioChunksKN.push(e.data);
    };

    mediaRecorderKN.onstop = async () => {
     try {
      if (mstRecorderKN && mstRecorderKN.state === 'recording') mstRecorderKN.pause();
      if (micSrcMstTemp) micSrcMstTemp.disconnect();
     } catch (eMstStop) {}
     document.getElementById('micWrapper').classList.remove('is-recording');
          micBtn.style.backgroundColor = "#94a3b8";
          micBtn.disabled = true;
          statusTeks.innerText = "⏳ Mengenali suara Anda...";

          if (localStreamKN) {
            localStreamKN.getTracks().forEach(track => track.stop());
            localStreamKN = null;
          }

          const audioBlob = new Blob(audioChunksKN, { type: options.mimeType || 'audio/webm' });
          audioChunksKN = [];
          await prosesPutaranAI(audioBlob);
        };
      } catch (err) {
        alert("Gagal mengakses mikrofon. Pastikan izin mikrofon di browser aktif.");
        kirimBlackBox("Izin Mikrofon KN", err.message);
      }
    } else {
      mediaRecorderKN.stop();
      isRecordingKN = false;
    }
  }

  async function prosesPutaranAI(audioBlob) {
    const sesi = window.NEEXA_SESI;
    if (!sesi.aktif) return;

    const statusTeks = document.getElementById('statusTeksInfo');
    const micBtn = document.getElementById('tombolMicUtama');
    const isMST = sesi.produk.includes("-MST") || sesi.produk.startsWith("MST");
    const sedangBalasPenutupMST = isMST && sesi.menungguSalamPenutupMST === true;
    const statusLastTurn = (!sedangBalasPenutupMST) && (sesi.putaranSaatIni + 1 >= sesi.maxPutaran);
    let activeEngineTracker = "Belum Diketahui";

    try {
      // 1. Telinga: Deepgram STT
      const resSTT = await fetch(WORKER_URL + 'api/stt?produk=' + encodeURIComponent(sesi.produk), {
        method: 'POST',
        headers: {
          'Content-Type': audioBlob.type || 'audio/webm',
          ...getWorkerAuthHeader()
        },
        body: audioBlob
      });
      if (!resSTT.ok) throw new Error("Gagal memproses STT.");

      const dataSTT = await resSTT.json();
      if (!sesi.apiUsage) {
        sesi.apiUsage = { sttDetik: 0, chatInput: 0, chatOutput: 0, chatTotal: 0, ttsChars: 0, evalInput: 0, evalOutput: 0, evalTotal: 0, liveInput: 0, liveOutput: 0, liveTotal: 0 };
      }
      if (dataSTT.neexaSttSec) {
        sesi.apiUsage.sttDetik = Math.round(((sesi.apiUsage.sttDetik || 0) + Number(dataSTT.neexaSttSec)) * 100) / 100;
      }
      const teksSiswa = dataSTT.results?.channels?.[0]?.alternatives?.[0]?.transcript;

      if (!teksSiswa) {
        statusTeks.innerText = "Suara tidak terdengar jelas, silakan coba bicara lagi.";
        resetTombolMicKN();
        return;
      }

      tambahBubbleKN('user', teksSiswa);

      const typingHtml = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
      const lastAiBubble = tambahBubbleKN('ai', typingHtml, true);
      statusTeks.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> AI Sensei menyiapkan jawaban & suara...';

      // 2. Otak + Mulut Terpadu (Opsi B)
      const resChatTts = await fetch(WORKER_URL + 'api/chat-tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getWorkerAuthHeader()
        },
        body: JSON.stringify({
          message: teksSiswa,
          history: chatHistoryKN,
          produk: sesi.produk,
          namaTema: sesi.namaTema,
          isLastTurn: statusLastTurn,
          gender: sesi.suaraTutor || "female",
          peranTutor: sesi.peranTutor || "",
          seedAcak: sesi.seedAcak || 77777,
          isClosingReply: sedangBalasPenutupMST,
          genderSiswa: KAIWA_USER.gender || ""
        })
      });
      if (!resChatTts.ok) throw new Error("Gagal memproses Chat-TTS.");

      const dataChat = await resChatTts.json();
      if (!sesi.aktif) return;

      if (dataChat.engine) activeEngineTracker = dataChat.engine;
      const cIn = Number(dataChat.tokenInput) || 0;
      const cOut = Number(dataChat.tokenOutput) || 0;
      const cTot = Number(dataChat.tokens) || (cIn + cOut);
      sesi.apiUsage.chatInput = (sesi.apiUsage.chatInput || 0) + cIn;
      sesi.apiUsage.chatOutput = (sesi.apiUsage.chatOutput || 0) + cOut;
      sesi.apiUsage.chatTotal = (sesi.apiUsage.chatTotal || 0) + cTot;
      sesi.apiUsage.ttsChars = (sesi.apiUsage.ttsChars || 0) + (Number(dataChat.ttsChars) || 0);
      sesi.totalTokenSesi = sesi.apiUsage.chatTotal;

      const teksAI = dataChat.choices[0].message.content;
      kirimAktivitas(activeEngineTracker + " (KN Chat+TTS)");

      sesi.historyPercakapan += `Siswa: ${teksSiswa}\nAI: ${teksAI}\n\n`;
      chatHistoryKN.push({ role: "user", parts: [{ text: teksSiswa }] });
      chatHistoryKN.push({ role: "model", parts: [{ text: teksAI }] });

      // PENTING: Untuk BLJ & KHD hemat memori 4 putaran; untuk MST simpan utuh agar AI ingat seluruh Jikoshoukai!
      if (!isMST && chatHistoryKN.length > 8) {
        chatHistoryKN.splice(0, 2);
      }

      lastAiBubble.textContent = teksAI;
      statusTeks.innerText = "🔊 Dengarkan AI berbicara...";

      sesi.putaranSaatIni++;

      // Deteksi apakah Direktur MST baru saja mengucapkan kalimat penutupan resmi wawancara
      let wawancaraResmiTuntas = false;
      if (sedangBalasPenutupMST) {
        // Kandidat sudah membalas salam penutup -> Kunci sesi menjadi 100% Tuntas Penuh!
        wawancaraResmiTuntas = true;
        sesi.maxPutaran = sesi.putaranSaatIni;
      } else if (isMST && (teksAI.includes("本日の面接はこれで終了") || teksAI.includes("面接はこれで終了"))) {
        // Direktur baru saja menutup wawancara -> Beri kandidat 1 giliran terakhir untuk mengucap salam penutup!
        sesi.menungguSalamPenutupMST = true;
        if (sesi.putaranSaatIni >= sesi.maxPutaran) {
          sesi.maxPutaran = sesi.putaranSaatIni + 1;
        }
      }

      document.getElementById('indikatorPutaran').innerText = `Putaran: ${sesi.putaranSaatIni} / ${sesi.maxPutaran}`;
      const persentase = Math.min(100, (sesi.putaranSaatIni / sesi.maxPutaran) * 100);
      document.getElementById('progressBarKaiwa').style.width = `${persentase}%`;

      const selesaiSesiSekarang = wawancaraResmiTuntas || (!sesi.menungguSalamPenutupMST && statusLastTurn);

      const akhiriGiliran = () => {
        if (!sesi.aktif) return;
        if (selesaiSesiSekarang) {
          statusTeks.innerHTML = `✅ <b>Sesi Selesai!</b> Silakan klik Buat Rapor Sesi.`;
          micBtn.style.backgroundColor = "#94a3b8";
          micBtn.disabled = true;
        } else if (sesi.menungguSalamPenutupMST) {
          resetTombolMicKN();
          statusTeks.innerText = "🎙️ Ucapkan salam penutup wawancara Anda untuk mengakhiri sesi.";
        } else {
          resetTombolMicKN();
          statusTeks.innerText = "Giliran Anda! Tekan mikrofon untuk membalas.";
        }
      };

      if (dataChat.audioContent) {
        audioPlayerKN.src = "data:audio/mp3;base64," + dataChat.audioContent;
        audioPlayerKN.play();
        audioPlayerKN.onended = akhiriGiliran;
      } else {
        akhiriGiliran();
      }

    } catch (err) {
      console.error(err);
      statusTeks.innerHTML = "⚠️ Koneksi terputus. Silakan coba bicara lagi.";
      kirimBlackBox("Proses AI KN", err.message, activeEngineTracker);
      resetTombolMicKN();
    }
  }

   // Ekspos MesinKN ke global window agar bisa dipanggil oleh Dispatcher index.html
  window.MesinKN = {
    mulai: function (sesiConfig) {
      pasangListenerMicSatuKali();
      chatHistoryKN = [];

      // Buat angka kunci pengacak unik untuk sesi ini & reset penanda penutup MST
      sesiConfig.seedAcak = Math.floor(Math.random() * 900000) + 100000;
      sesiConfig.menungguSalamPenutupMST = false;

   const isMST = sesiConfig.produk.includes("-MST") || sesiConfig.produk.startsWith("MST");
   const isSimulasiPenuhMST = isMST && !sesiConfig.produk.includes("MST-LAT");
   const statusTeks = document.getElementById('statusTeksInfo');

   // Siapkan perekam arsip MST 24kbps jika Simulasi Penuh
   this.hapusRekamanMST();
   if (isSimulasiPenuhMST) {
    try {
     const AC = window.AudioContext || window.webkitAudioContext;
     mstAudioCtxKN = new AC();
     mstMixDestKN = mstAudioCtxKN.createMediaStreamDestination();
     mstMimeKN = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm');
     mstChunksKN = [];
     mstRecorderKN = new MediaRecorder(mstMixDestKN.stream, { mimeType: mstMimeKN, audioBitsPerSecond: 24000 });
     mstRecorderKN.ondataavailable = ev => { if (ev.data && ev.data.size > 0) mstChunksKN.push(ev.data); };
     mstRecorderKN.start(1000);
     mstRecorderKN.pause();
    } catch (eInitMst) {}
   }

  document.getElementById('activeProductDisplay').innerText = sesiConfig.namaTema;
  document.getElementById('namaUserDiKaiwa').innerText = KAIWA_USER.nama;
  document.getElementById('progressBarKaiwa').style.width = '0%';
  document.getElementById('chatContainer').innerHTML = '';
  document.getElementById('indikatorPutaran').innerText = `Putaran: 0 / ${sesiConfig.maxPutaran}`;

  document.getElementById('micWrapper')?.classList.remove('kl-call-mode', 'kl-split-active');
  document.getElementById('btnTelpKiriKL')?.classList.remove('arrived-disabled');
  document.getElementById('btnSelesaiKaiwa')?.classList.remove('hidden');
  resetTombolMicKN();

   if (isMST) {
    statusTeks.innerText = "🎙️ Pewawancara menunggu salam pembuka Anda...";
    const chatContainer = document.getElementById('chatContainer');
    const bannerZoom = document.createElement('div');
    bannerZoom.style.cssText = "background:#eff6ff; border:1px dashed #93c5fd; color:#1e40af; padding:12px 15px; border-radius:12px; font-size:12px; text-align:center; line-height:1.5; font-weight:600;";
    bannerZoom.innerHTML = "💻 <b>Ruang Wawancara Online Terhubung</b><br>Pewawancara (Mensetsukan) telah hadir di layar dan menunggu Anda berbicara lebih dulu. Tekan mikrofon dan ucapkan salam pembuka wawancara online!";
    chatContainer.appendChild(bannerZoom);
   } else {
    statusTeks.innerText = "Tekan mikrofon SEKALI untuk membalas.";
    let sapaanAwal = `こんにちは！ Mari mulai latihan "${sesiConfig.namaTema}". Tekan mikrofon dan sapa saya.`;
    if (sesiConfig.produk.includes("KHD")) {
     sapaanAwal = `こんにちは！ Simulasi "${sesiConfig.namaTema}" dimulai. Silakan tekan mikrofon untuk memulai situasi.`;
    }
    setTimeout(() => {
     if (window.NEEXA_SESI.aktif) tambahBubbleKN('ai', sapaanAwal);
    }, 350);
   }

   showView('kaiwaRoom');
  },

  hentikan: function () {
   if (isRecordingKN && mediaRecorderKN) {
    mediaRecorderKN.onstop = null;
    try { mediaRecorderKN.stop(); } catch (e) {}
    isRecordingKN = false;
   }
   if (localStreamKN) {
    localStreamKN.getTracks().forEach(track => track.stop());
    localStreamKN = null;
   }
   if (mstRecorderKN && mstRecorderKN.state !== 'inactive') {
    try {
     mstRecorderKN.onstop = () => {
      if (mstChunksKN.length > 0) mstFinalBlobKN = new Blob(mstChunksKN, { type: mstMimeKN });
      if (mstAudioCtxKN) { try { mstAudioCtxKN.close(); } catch (e) {} mstAudioCtxKN = null; }
     };
     mstRecorderKN.stop();
    } catch (e) {}
   }
   const micWrap = document.getElementById('micWrapper');
   if (micWrap) micWrap.classList.remove('is-recording');
   audioPlayerKN.onended = null;
   try { audioPlayerKN.pause(); } catch (e) {}
  },

  ambilBlobRekamanMST: async function () {
   await new Promise(r => setTimeout(r, 250));
   if (!mstFinalBlobKN && mstChunksKN.length > 0) {
    mstFinalBlobKN = new Blob(mstChunksKN, { type: mstMimeKN });
   }
   return mstFinalBlobKN ? { blob: mstFinalBlobKN, mimeType: mstMimeKN } : null;
  },

  hapusRekamanMST: function () {
   mstChunksKN = [];
   mstFinalBlobKN = null;
   mstRecorderKN = null;
   mstMixDestKN = null;
   if (mstAudioCtxKN) { try { mstAudioCtxKN.close(); } catch (e) {} mstAudioCtxKN = null; }
  }
 };
})();
