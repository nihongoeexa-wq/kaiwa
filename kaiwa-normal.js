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

        document.getElementById('micWrapper').classList.add('is-recording');
        micBtn.style.backgroundColor = "#b91c1c";
        micBtn.innerHTML = '<i class="fas fa-stop"></i>';
        statusTeks.innerText = "🔴 Sedang mendengarkan... (Tekan untuk stop)";

        mediaRecorderKN.ondataavailable = e => {
          if (e.data.size > 0) audioChunksKN.push(e.data);
        };

        mediaRecorderKN.onstop = async () => {
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
    const statusLastTurn = (sesi.putaranSaatIni + 1 >= sesi.maxPutaran);
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

      // 2. Otak + Mulut Terpadu (Opsi B: Gemini 3.5 Flash-Lite + Google Chirp3-HD)
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
          gender: sesi.suaraTutor || "female"
        })
      });
      if (!resChatTts.ok) throw new Error("Gagal memproses Chat-TTS.");

      const dataChat = await resChatTts.json();
      if (!sesi.aktif) return; // Jika sesi sudah ditutup oleh sensor layar saat menunggu AI

      if (dataChat.engine) activeEngineTracker = dataChat.engine;
      if (dataChat.tokens) sesi.totalTokenSesi += Number(dataChat.tokens);

      const teksAI = dataChat.choices[0].message.content;
      kirimAktivitas(activeEngineTracker + " (KN Chat+TTS)");

      sesi.historyPercakapan += `Siswa: ${teksSiswa}\nAI: ${teksAI}\n\n`;
      chatHistoryKN.push({ role: "user", parts: [{ text: teksSiswa }] });
      chatHistoryKN.push({ role: "model", parts: [{ text: teksAI }] });
      if (chatHistoryKN.length > 8) chatHistoryKN.splice(0, 2);

      lastAiBubble.textContent = teksAI;
      statusTeks.innerText = "🔊 Dengarkan AI Sensei bicara...";

      sesi.putaranSaatIni++;
      document.getElementById('indikatorPutaran').innerText = `Putaran: ${sesi.putaranSaatIni} / ${sesi.maxPutaran}`;
      const persentase = (sesi.putaranSaatIni / sesi.maxPutaran) * 100;
      document.getElementById('progressBarKaiwa').style.width = `${persentase}%`;

      const akhiriGiliran = () => {
        if (!sesi.aktif) return;
        if (statusLastTurn) {
          statusTeks.innerHTML = `✅ <b>Target Selesai!</b> Silakan klik Buat Rapor Sesi.`;
          micBtn.style.backgroundColor = "#94a3b8";
          micBtn.disabled = true;
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

      document.getElementById('activeProductDisplay').innerText = `${sesiConfig.namaTema} (${sesiConfig.produk})`;
      document.getElementById('namaUserDiKaiwa').innerText = KAIWA_USER.nama;
      document.getElementById('progressBarKaiwa').style.width = '0%';
      document.getElementById('chatContainer').innerHTML = '';
      document.getElementById('indikatorPutaran').innerText = `Putaran: 0 / ${sesiConfig.maxPutaran}`;
      document.getElementById('statusTeksInfo').innerText = "Tekan mikrofon SEKALI untuk membalas.";
      resetTombolMicKN();

      // Sesuaikan kalimat pembuka awal berdasarkan kategori BLJ / KHD / MST
      let sapaanAwal = `こんにちは！ Mari mulai latihan "${sesiConfig.namaTema}". Tekan mikrofon dan sapa saya.`;
      if (sesiConfig.produk.includes("MST")) {
        sapaanAwal = "失礼いたします。本日は面接にお越しいただき、ありがとうございます。まずは自己紹介をお願いします。";
      } else if (sesiConfig.produk.includes("KHD")) {
        sapaanAwal = `こんにちは！ Simulasi "${sesiConfig.namaTema}" dimulai. Silakan tekan mikrofon untuk memulai situasi.`;
      }

      setTimeout(() => {
        if (window.NEEXA_SESI.aktif) tambahBubbleKN('ai', sapaanAwal);
      }, 350);

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
      const micWrap = document.getElementById('micWrapper');
      if (micWrap) micWrap.classList.remove('is-recording');
      audioPlayerKN.onended = null;
      try { audioPlayerKN.pause(); } catch (e) {}
    }
  };
})();
