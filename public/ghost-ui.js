// --- 3D/4D HOLOGRAPHIC THREE.JS VISUALIZER GLOBE ---
class GhostVisualizer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    
    this.state = 'idle'; // 'idle', 'listening', 'responding'
    this.micLevel = 0;
    
    this.initThree();
    this.animate();
    
    window.addEventListener('resize', () => this.onResize());
  }
  
  initThree() {
    const width = this.container.clientWidth || 600;
    const height = this.container.clientHeight || 420;
    
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.z = 6;
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);
    
    // Create particle sphere using IcosahedronGeometry
    this.geometry = new THREE.IcosahedronGeometry(2.2, 4); // Radius 2.2, detail 4
    this.originalVertices = [];
    
    const pos = this.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      this.originalVertices.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
    
    // Material for glowing particles
    this.material = new THREE.PointsMaterial({
      color: 0x00f0ff,
      size: 0.05,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    
    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);
    
    // Add subtle wireframe mesh underneath for extra structure
    const wireGeometry = new THREE.IcosahedronGeometry(1.98, 3);
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x00a8ff,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending
    });
    this.wireMesh = new THREE.Mesh(wireGeometry, wireMaterial);
    this.scene.add(this.wireMesh);
    
    this.clock = new THREE.Clock();
    
    // Color interpolation properties
    this.targetColor = new THREE.Color(0x00f0ff);
    this.currentColor = new THREE.Color(0x00f0ff);
  }
  
  setState(state) {
    this.state = state;
    if (state === 'idle') {
      this.targetColor.setHex(0x00f0ff); // Cyan
    } else if (state === 'listening') {
      this.targetColor.setHex(0x00a8ff); // Electric Blue
    } else if (state === 'responding') {
      this.targetColor.setHex(0x7000ff); // Deep Violet
    }
  }
  
  setMicLevel(level) {
    this.micLevel = level; // normalized 0 to 1
  }
  
  onResize() {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  
  animate() {
    requestAnimationFrame(() => this.animate());
    
    const time = this.clock.getElapsedTime();
    
    // Rotate elements
    let rotSpeed = 0.15;
    if (this.state === 'listening') rotSpeed = 0.3;
    else if (this.state === 'responding') rotSpeed = 0.55;
    
    this.points.rotation.y = time * rotSpeed;
    this.points.rotation.x = time * (rotSpeed * 0.5);
    this.wireMesh.rotation.y = -time * (rotSpeed * 0.7);
    
    // Interpolate colors
    this.currentColor.lerp(this.targetColor, 0.08);
    this.material.color.copy(this.currentColor);
    this.wireMesh.material.color.copy(this.currentColor);
    
    // Deform geometry
    const pos = this.geometry.attributes.position;
    const count = pos.count;
    
    for (let i = 0; i < count; i++) {
      const orig = this.originalVertices[i];
      
      let displacement = 0;
      if (this.state === 'idle') {
        // Small slow wave
        displacement = Math.sin(orig.x * 2.0 + time * 1.5) * Math.cos(orig.y * 2.0 + time * 1.5) * 0.08;
      } else if (this.state === 'listening') {
        // Pulses reactive to mic input volume
        displacement = Math.sin(orig.x * 4.0 + time * 8.0) * Math.cos(orig.y * 4.0 + time * 8.0) * (0.05 + this.micLevel * 0.85);
      } else if (this.state === 'responding') {
        // procedural voice waveform pattern
        displacement = Math.sin(orig.z * 5.0 + time * 14.0) * 0.22 + Math.cos(orig.y * 3.0 + time * 10.0) * 0.08;
      }
      
      // Offset position along vertex normal (since center is 0,0,0, normal is normalized orig vector)
      const normal = orig.clone().normalize();
      const newPos = orig.clone().add(normal.multiplyScalar(displacement));
      
      pos.setXYZ(i, newPos.x, newPos.y, newPos.z);
    }
    
    this.geometry.attributes.position.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}

function playClickSound(freq = 600, type = 'sine', duration = 0.05) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
    } catch (e) {}
}

// --- DESKTOP WHITE AUDIO WAVEFORM VISUALIZER (ELECTRON ONLY) ---
class GhostWaveformVisualizer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.state = 'idle'; // 'idle', 'listening', 'responding'
    this.micLevel = 0;

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);

    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    this.phase = 0;
    this.animate();
  }

  setState(state) {
    this.state = state;
  }

  setMicLevel(level) {
    this.micLevel = level; // normalized 0.0 to 1.0
  }

  onResize() {
    if (!this.container || !this.canvas) return;
    this.width = this.container.clientWidth || 300;
    this.height = this.container.clientHeight || 160;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.scale(dpr, dpr);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.phase += 0.09;

    const width = this.width;
    const height = this.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);

    // Dark sleek container background
    ctx.fillStyle = 'rgba(15, 15, 18, 0.95)';
    ctx.fillRect(0, 0, width, height);

    const barCount = 56;
    const barGap = 3;
    const barWidth = Math.max(2, (width - 32 - (barCount * barGap)) / barCount);
    const startX = (width - (barCount * (barWidth + barGap))) / 2;
    const centerY = height / 2;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';

    for (let i = 0; i < barCount; i++) {
      const x = startX + i * (barWidth + barGap);
      const normPos = (i - barCount / 2) / (barCount / 2);
      const envelope = Math.cos(normPos * Math.PI * 0.45);

      let targetAmp = 0.08;

      if (this.state === 'listening') {
        const noise = Math.sin(i * 0.45 + this.phase * 2.2) * Math.cos(i * 0.25 - this.phase * 1.1);
        targetAmp = 0.08 + (0.85 * this.micLevel * Math.abs(noise) + 0.12 * Math.abs(noise)) * envelope;
      } else if (this.state === 'responding') {
        const wave = Math.sin(i * 0.35 + this.phase * 3.2) * Math.cos(i * 0.15 + this.phase * 1.5);
        targetAmp = 0.12 + Math.abs(wave) * 0.72 * envelope;
      } else {
        const idleWave = Math.sin(i * 0.2 + this.phase * 0.8) * 0.06;
        targetAmp = 0.08 + Math.abs(idleWave) * envelope;
      }

      targetAmp = Math.min(1.0, Math.max(0.04, targetAmp));
      const barHeight = Math.max(4, targetAmp * (height - 24));

      ctx.shadowBlur = targetAmp > 0.3 ? 8 : 0;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, centerY - barHeight / 2, barWidth, barHeight, barWidth / 2);
      } else {
        ctx.rect(x, centerY - barHeight / 2, barWidth, barHeight);
      }
      ctx.fill();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
    let availableVoices = [];
    window.speechSynthesis.onvoiceschanged = () => { availableVoices = window.speechSynthesis.getVoices(); };

    // DUAL VISUALIZER PLATFORM MOUNT: Desktop Waveform vs Render Web 4D Particle Globe
    const isDesktopApp = !!(window.ghostDesktop && window.ghostDesktop.isDesktop) || window.navigator.userAgent.includes('Electron');
    const visualizerElem = document.getElementById('visualizerContainer');

    if (visualizerElem) {
        if (isDesktopApp) {
            console.log('[Visualizer] Desktop environment detected — mounting GhostWaveformVisualizer (white audio waveform spikes).');
            window.ghostVisualizer = new GhostWaveformVisualizer('visualizerContainer');
        } else if (typeof THREE !== 'undefined') {
            console.log('[Visualizer] Web environment detected — mounting GhostVisualizer (4D Three.js particle sphere).');
            window.ghostVisualizer = new GhostVisualizer('visualizerContainer');
        }
    }

    const loginOverlay = document.getElementById('loginOverlay');
    const authInput = document.getElementById('authInput');
    const appLayout = document.getElementById('app-layout');
    const userTag = document.getElementById('userTag');
    const chatLog = document.getElementById('chatLog');
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const attachBtn = document.getElementById('attachBtn');
    const attachmentInput = document.getElementById('attachmentInput');
    const micToggleBtn = document.getElementById('micToggleBtn');
    const thinkingIndicator = document.getElementById('thinking-indicator');
    const ghostCodeBtn = document.getElementById('ghostCodeBtn');
    const newChatBtn = document.getElementById('newChatBtn');

    const codeSidebar = document.getElementById('code-sidebar');
    const codeContent = document.getElementById('code-content');
    const closeSidebar = document.getElementById('closeSidebar');
    const appViewer = document.getElementById('app-viewer');
    const appIframe = document.getElementById('app-iframe');
    const closeAppViewer = document.getElementById('closeAppViewer');

    let masterUser = "Guest";
    let isAdminMode = false;
    let isGhostCodeActive = true;
    let isHandsFreeActive = false;
    let inputMode = 'text';

    const handsFreeBtn = document.getElementById('handsFreeBtn');
    const ghostCodeStatus = document.getElementById('ghostCodeStatus');
    const handsFreeStatus = document.getElementById('handsFreeStatus');

    // --- PERSISTENT OWNER RECOGNITION ---
    async function checkPersistentAuth() {
        const storedToken = localStorage.getItem('ghost_owner_clearance');
        if (!storedToken) return;

        try {
            const res = await fetch('/api/verify-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: storedToken })
            });
            const data = await res.json();
            if (data.success && data.isAdmin) {
                userTag.innerText = `ADMIN // MASTER MANOJ`;
                userTag.style.color = 'var(--accent-primary)';
                masterUser = "Master Manoj";
                isAdminMode = true;
                loginOverlay.style.opacity = '0';
                loginOverlay.style.visibility = 'hidden';
                appLayout.classList.add('active');
                console.log('[Auth] Persistent owner recognition verified for Master Manoj.');
            }
        } catch (e) {
            console.warn('[Auth] Persistent clearance verification error:', e.message);
        }
    }
    checkPersistentAuth();

    // --- AUTHENTICATION HANDLER ---
    authInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const inputVal = authInput.value.trim();
            if (!inputVal) return;

            const safeGuestName = inputVal.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 20) || "Guest";

            try {
                const authRes = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ authString: inputVal, user: safeGuestName })
                });
                const authData = await authRes.json();

                if (authData.success && authData.role === 'admin') {
                    userTag.innerText = `ADMIN // MASTER MANOJ`;
                    userTag.style.color = 'var(--accent-primary)';
                    masterUser = "Master Manoj";
                    isAdminMode = true;
                    localStorage.setItem('ghost_owner_clearance', inputVal);
                    speakResponse("Welcome back, Master Manoj. All Ghost core systems are operational.");
                } else {
                    userTag.innerText = `VISITOR // ${safeGuestName.toUpperCase()}`;
                    masterUser = safeGuestName;
                    isAdminMode = false;
                    speakResponse(`Greetings ${safeGuestName}, I am Ghost. How may I assist you today?`);
                }
            } catch (error) {
                console.error("Auth routing failed.", error);
            }

            loginOverlay.style.opacity = '0';
            loginOverlay.style.visibility = 'hidden';
            appLayout.classList.add('active');
        }
    });

    // --- TOGGLES & ACTIONS ---
    if (ghostCodeBtn) {
        ghostCodeBtn.addEventListener('click', () => {
            playClickSound(750, 'sine');
            isGhostCodeActive = !isGhostCodeActive;
            if (isGhostCodeActive) {
                ghostCodeBtn.classList.add('active');
                if (ghostCodeStatus) ghostCodeStatus.innerText = "ON // Code Execution Active";
                speakResponse("Ghost Code matrix activated.");
            } else {
                ghostCodeBtn.classList.remove('active');
                if (ghostCodeStatus) ghostCodeStatus.innerText = "OFF // Code Execution Disabled";
                speakResponse("Ghost Code matrix offline.");
            }
        });
    }

    const handsFreeOverlay = document.getElementById('handsFreeOverlay');
    const exitHandsFreeBtn = document.getElementById('exitHandsFreeBtn');
    const handsFreeLiveText = document.getElementById('handsFreeLiveText');

    function mountVisualizer(containerId) {
        const isDesktopApp = !!(window.ghostDesktop && window.ghostDesktop.isDesktop) || window.navigator.userAgent.includes('Electron');
        const container = document.getElementById(containerId);
        if (!container) return;

        if (isDesktopApp) {
            console.log('[Visualizer] Desktop environment — mounting GhostWaveformVisualizer into ' + containerId);
            window.ghostVisualizer = new GhostWaveformVisualizer(containerId);
        } else if (typeof THREE !== 'undefined') {
            console.log('[Visualizer] Web environment — mounting GhostVisualizer into ' + containerId);
            window.ghostVisualizer = new GhostVisualizer(containerId);
        }
    }

    // Default sidebar mount on startup
    mountVisualizer('visualizerContainer');

    function enableHandsFreeMode() {
        isHandsFreeActive = true;
        inputMode = 'voice';
        if (handsFreeBtn) handsFreeBtn.classList.add('active');
        if (handsFreeStatus) handsFreeStatus.innerText = "ON // Spoken Interaction Active";
        if (handsFreeOverlay) handsFreeOverlay.classList.add('active');

        // Remount visualizer full-screen
        mountVisualizer('fullscreenVisualizerContainer');
        if (window.ghostVisualizer) window.ghostVisualizer.setState('listening');

        if (handsFreeLiveText) handsFreeLiveText.innerText = "Hands-Free Mode Active. Speak anytime — mic is always on!";
        speakResponse("Hands-free mode enabled. Mic is open. Speak anytime to command Ghost.");
    }

    function disableHandsFreeMode() {
        isHandsFreeActive = false;
        inputMode = 'text';
        if (handsFreeBtn) handsFreeBtn.classList.remove('active');
        if (handsFreeStatus) handsFreeStatus.innerText = "OFF // Spoken Audio Idle";
        if (handsFreeOverlay) handsFreeOverlay.classList.remove('active');

        // Remount visualizer back in sidebar
        mountVisualizer('visualizerContainer');
        if (window.ghostVisualizer) window.ghostVisualizer.setState('idle');

        speakResponse("Hands-free mode disabled.");
    }

    if (handsFreeBtn) {
        handsFreeBtn.addEventListener('click', () => {
            playClickSound(1000, 'sine');
            if (!isHandsFreeActive) enableHandsFreeMode();
            else disableHandsFreeMode();
        });
    }

    if (exitHandsFreeBtn) {
        exitHandsFreeBtn.addEventListener('click', () => {
            playClickSound(500, 'sine');
            disableHandsFreeMode();
        });
    }

    newChatBtn.addEventListener('click', () => {
        chatLog.innerHTML = `
            <div class="message-card ghost">
                <div class="avatar">G</div>
                <div class="bubble">
                    Stream cleared. Systems ready for new command, ${masterUser}.
                </div>
            </div>
        `;
    });

    closeSidebar.addEventListener('click', () => codeSidebar.classList.remove('open'));
    closeAppViewer.addEventListener('click', () => {
        appViewer.classList.remove('open');
        setTimeout(() => appIframe.srcdoc = "", 400);
    });

    // --- CHAT MESSAGE UI RENDERING ---
    function appendMessage(sender, text) {
        const card = document.createElement('div');
        card.className = `message-card ${sender}`;

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.innerText = sender === 'user' ? 'U' : 'G';

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerText = text;

        card.appendChild(avatar);
        card.appendChild(bubble);
        chatLog.appendChild(card);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    // --- SPEECH SYNTHESIS & VOICE OUTPUT ---
    function setMicState(state) {
        micToggleBtn.className = `mic-btn ${state}`;
        if (state === 'listening') micToggleBtn.innerText = '🔴';
        else if (state === 'transcribing') micToggleBtn.innerText = '⏳';
        else if (state === 'speaking') micToggleBtn.innerText = '🔊';
        else micToggleBtn.innerText = '🎤';

        if (window.ghostVisualizer) {
            if (state === 'listening') window.ghostVisualizer.setState('listening');
            else if (state === 'speaking') window.ghostVisualizer.setState('responding');
            else if (state === 'transcribing') window.ghostVisualizer.setState('responding');
            else window.ghostVisualizer.setState('idle');
        }

        // Restart wake-word recognition if returning to idle
        if (state === 'idle' && !isRecording && !recognitionActive) {
            startWakeWordRecognition();
        }
    }

    function speakResponse(text) {
        if (inputMode !== 'voice') {
            console.log('[TTS] Input mode is text, skipping voice audio output.');
            return;
        }
        if (!window.speechSynthesis) return;
        let cleanText = text.replace(/[\x60]{3}[\s\S]*?[\x60]{3}/g, '')
                            .replace(/<think>[\s\S]*?<\/think>/g, '')
                            .replace(/<search>[\s\S]*?<\/search>/g, '')
                            .replace(/\[.*?\]/g, '').trim();

        if (!cleanText) cleanText = "Execution complete.";
        window.speechSynthesis.cancel();
        
        // Stop any background recognition when speaking to prevent echoing as wake word
        if (recognitionInstance && recognitionActive) {
            try { recognitionInstance.stop(); } catch(e) {}
        }
        
        setMicState('speaking');

        const utterance = new SpeechSynthesisUtterance(cleanText);
        if (availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
        let ukVoice = availableVoices.find(v => v.lang === 'en-GB' || v.name.includes('UK English')) || availableVoices.find(v => v.lang.includes('en'));
        if (ukVoice) utterance.voice = ukVoice;
        utterance.rate = 1.05;
        utterance.pitch = 0.95;

        utterance.onend = () => {
            setMicState('idle');
            if (isHandsFreeActive) {
                console.log('[Hands-Free Loop] TTS playback ended. Automatically re-opening mic for continuous conversation.');
                setTimeout(() => {
                    if (isHandsFreeActive && !isRecording) {
                        triggerHandsFreeListening();
                    }
                }, 400);
            }
        };
        utterance.onerror = () => {
            setMicState('idle');
            if (isHandsFreeActive) {
                setTimeout(() => {
                    if (isHandsFreeActive && !isRecording) {
                        triggerHandsFreeListening();
                    }
                }, 400);
            }
        };
        window.speechSynthesis.speak(utterance);
    }

    // --- AUDIO PIPELINE, WAKE-WORD & SILENCE DETECTION ---
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let globalAudioContext = null;
    let globalAnalyser = null;
    let globalStream = null;
    let recognitionInstance = null;
    let recognitionActive = false;

    async function initAudioPipeline() {
        try {
            console.log('[Audio Pipeline] Requesting microphone access...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            globalStream = stream;
            console.log('[Audio Pipeline] Microphone access granted.');

            globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = globalAudioContext.createMediaStreamSource(stream);
            globalAnalyser = globalAudioContext.createAnalyser();
            globalAnalyser.fftSize = 256;
            source.connect(globalAnalyser);

            const dataArray = new Uint8Array(globalAnalyser.frequencyBinCount);
            let silenceStart = null;

    function bargeInInterrupt() {
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
            console.log('[Barge-In Interrupt] User voice detected during TTS playback. HARD STOPPING audio output!');
            window.speechSynthesis.cancel();
            setMicState('listening');
            if (handsFreeLiveText) handsFreeLiveText.innerText = "Barge-in detected! Listening to Manoj...";
            if (!isRecording) {
                triggerHandsFreeListening();
            }
        }
    }

    function updateAudioLevels() {
        requestAnimationFrame(updateAudioLevels);
        if (!globalAnalyser) return;

        globalAnalyser.getByteFrequencyData(dataArray);
        let total = 0;
        for (let i = 0; i < dataArray.length; i++) {
            total += dataArray[i];
        }
        const average = total / dataArray.length;
        const normalized = average / 255; // 0 to 1

        if (window.ghostVisualizer) {
            window.ghostVisualizer.setMicLevel(normalized);
        }

        // BARGE-IN INTERRUPT: Hard stop TTS if user speaks during playback
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
            if (normalized > 0.04) {
                bargeInInterrupt();
            }
            return;
        }

        // ALWAYS-ON MIC: Auto-record when speech is detected in Hands-Free Mode (zero button clicks)
        if (isHandsFreeActive && !isRecording && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
            if (normalized > 0.035) {
                console.log(`[Always-On Mic] Speech activity detected (${(normalized * 100).toFixed(1)}%). Auto-initiating recording.`);
                triggerHandsFreeListening();
            }
        }

        // SILENCE AUTO-SUBMIT: Conclude capture after 1.0 second of silence
        if (isRecording) {
            if (normalized < 0.015) {
                if (!silenceStart) {
                    silenceStart = Date.now();
                } else if (Date.now() - silenceStart > 1000) { // 1.0 second silence
                    console.log('[Always-On Mic] 1.0s silence threshold reached. Concluding capture and submitting transcript.');
                    stopRecording();
                    silenceStart = null;
                }
            } else {
                silenceStart = null;
            }
        }
    }
    updateAudioLevels();

            startWakeWordRecognition();
        } catch (e) {
            console.error('[Audio Pipeline Error] Failed to initialize microphone capture:', e);
            appendMessage('ghost', "Microphone access is required for wake-word and hands-free control. Please check system permissions.");
        }
    }

    function startWakeWordRecognition() {
        const isElectron = navigator.userAgent.toLowerCase().includes('electron');
        if (isElectron) {
            console.log('[Wake Recognizer] Running inside Electron. Skipping webkitSpeechRecognition to use high-performance local volume trigger instead.');
            return;
        }

        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            console.warn('[Wake Recognizer] SpeechRecognition API not supported in this browser.');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognitionInstance = new SpeechRecognition();
        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;
        recognitionInstance.lang = 'en-US';

        recognitionInstance.onstart = () => {
            recognitionActive = true;
            console.log('[Wake Recognizer] Continuous wake-word recognition active.');
        };

        recognitionInstance.onresult = (event) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const text = event.results[i][0].transcript.toLowerCase();
                if (event.results[i].isFinal) {
                    console.log('[Wake Recognizer] Final stream token:', text);
                } else {
                    interimTranscript += text;
                }

                // Look for wake words (ghost, hey ghost, wake up)
                if (text.includes('ghost') && !isRecording && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
                    console.log('[Wake Recognizer] Hot word match found! Starting active voice control.');
                    try { recognitionInstance.stop(); } catch(e) {}
                    triggerHandsFreeListening();
                    break;
                }
            }
        };

        recognitionInstance.onend = () => {
            recognitionActive = false;
            // Loop continuous listening if idle
            setTimeout(() => {
                if (!isRecording && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
                    try {
                        recognitionInstance.start();
                    } catch (e) {
                        // Suppress already started warnings
                    }
                }
            }, 500);
        };

        recognitionInstance.onerror = (err) => {
            console.error('[Wake Recognizer Error]', err);
        };

        try {
            recognitionInstance.start();
        } catch(e) {}
    }

    async function triggerHandsFreeListening() {
        if (isRecording) return;
        console.log('[Audio Pipeline] Initializing active hands-free recording session.');
        inputMode = 'voice';

        if (window.speechSynthesis) window.speechSynthesis.cancel();

        try {
            audioChunks = [];
            mediaRecorder = new MediaRecorder(globalStream);

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstart = () => {
                isRecording = true;
                setMicState('listening');
            };

            mediaRecorder.onstop = async () => {
                isRecording = false;
                setMicState('transcribing');

                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64Audio = reader.result;
                    try {
                        const res = await fetch('/api/voice/transcribe', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ audioBase64: base64Audio })
                        });
                        const data = await res.json();
                        setMicState('idle');
                        if (data.success && data.text) {
                            userInput.value = data.text;
                            processCommand(data.text);
                        } else {
                            appendMessage('ghost', data.error || "Whisper audio transcription could not be completed.");
                        }
                    } catch (e) {
                        setMicState('idle');
                        appendMessage('ghost', "Error communicating with Whisper backend transcription service.");
                    }
                };
            };

            mediaRecorder.start();
        } catch (err) {
            console.error('[Audio Pipeline] Failed to start hands-free record:', err);
            setMicState('idle');
        }
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
        }
    }

    micToggleBtn.addEventListener('click', () => {
        if (!isRecording) {
            if (recognitionInstance) {
                try { recognitionInstance.stop(); } catch(e) {}
            }
            triggerHandsFreeListening();
        } else {
            stopRecording();
        }
    });

    // --- ATTACHMENTS & FILE BUFFERING ---
    let uploadedFileText = "", uploadedImageBase64 = "";
    attachBtn.addEventListener('click', () => attachmentInput.click());
    attachmentInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                uploadedImageBase64 = ev.target.result.split(',')[1];
                appendMessage('user', `[Attached Image: ${file.name}]`);
            };
            reader.readAsDataURL(file);
        } else if (file.type === 'application/pdf') {
            const fileReader = new FileReader();
            fileReader.onload = async function() {
                try {
                    const pdf = await pdfjsLib.getDocument(new Uint8Array(this.result)).promise;
                    let text = "";
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const content = await (await pdf.getPage(i)).getTextContent();
                        text += content.items.map(item => item.str).join(' ') + "\n";
                    }
                    uploadedFileText = text;
                    appendMessage('user', `[Attached PDF: ${file.name}]`);
                } catch (err) {
                    appendMessage('ghost', "Error parsing PDF attachment.");
                }
            };
            fileReader.readAsArrayBuffer(file);
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => {
                uploadedFileText = ev.target.result;
                appendMessage('user', `[Attached File: ${file.name}]`);
            };
            reader.readAsText(file);
        }
    });

    // --- CHAT COMMAND PROCESSOR ---
    sendBtn.addEventListener('click', () => {
        playClickSound(600, 'sine');
        const val = userInput.value.trim();
        if (val || uploadedImageBase64 || uploadedFileText) {
            inputMode = 'text';
            processCommand(val);
        }
    });

    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const val = userInput.value.trim();
            if (val || uploadedImageBase64 || uploadedFileText) {
                inputMode = 'text';
                processCommand(val);
            }
        }
    });

    async function processCommand(textCommand) {
        if (textCommand) appendMessage('user', textCommand);
        userInput.value = "";
        thinkingIndicator.classList.add('active');

        const payload = {
            message: textCommand,
            user: masterUser,
            image: uploadedImageBase64 || null,
            fileContent: uploadedFileText || null,
            ghostCodeMode: isGhostCodeActive,
            handsFreeMode: isHandsFreeActive
        };

        uploadedFileText = "";
        uploadedImageBase64 = "";
        attachmentInput.value = "";

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            thinkingIndicator.classList.remove('active');

            if (data.success) {
                handleGhostResponse(data.text);
                if (data.plan && Array.isArray(data.plan) && data.plan.length > 0) {
                    renderAntigravityPlanCard(data.plan, textCommand);
                }
                if (data.actionRequired && data.actionId) {
                    renderHitlActionCard(data.actionId);
                }
            } else {
                appendMessage('ghost', "Matrix error: Backend disconnected.");
            }
        } catch (error) {
            thinkingIndicator.classList.remove('active');
            appendMessage('ghost', "Critical failure: Server unreachable.");
        }
    }

    function renderAntigravityPlanCard(planSteps, originalGoal) {
        const card = document.createElement('div');
        card.className = 'plan-card';

        let stepsHtml = planSteps.map((step, idx) => `
            <div class="step-item" id="planStep_${idx}">
                <div class="step-info">
                    <span class="step-number">Step ${idx + 1}</span>
                    <span>${step.description || step.task || 'Execute task action'}</span>
                </div>
                <span class="step-badge pending" id="stepBadge_${idx}">Pending</span>
            </div>
        `).join('');

        card.innerHTML = `
            <div class="plan-card-header">
                <span class="plan-card-title">📐 IMPLEMENTATION PLAN</span>
                <span style="font-size: 11px; color: var(--text-muted);">${planSteps.length} Steps Identified</span>
            </div>
            <div class="plan-steps-list">
                ${stepsHtml}
            </div>
            <button class="btn-approve-plan" id="approvePlanBtn">Approve & Execute Plan</button>
        `;

        chatLog.appendChild(card);
        chatLog.scrollTop = chatLog.scrollHeight;

        const approveBtn = card.querySelector('#approvePlanBtn');

        const executePlan = async () => {
            approveBtn.disabled = true;
            approveBtn.innerText = "Executing Plan...";

            let planHasFailed = false;
            let failedStepNumber = 0;
            let failureReason = "";

            for (let i = 0; i < planSteps.length; i++) {
                const badge = card.querySelector(`#stepBadge_${i}`);
                if (badge) {
                    badge.className = 'step-badge in_progress';
                    badge.innerText = 'Executing';
                }

                try {
                    const response = await fetch('/api/execute-plan-step', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            step: planSteps[i],
                            goal: originalGoal,
                            stepIndex: i
                        })
                    });
                    const resData = await response.json();

                    const outputText = (resData.output || resData.error || '').toLowerCase();
                    const isSuccess = resData.success === true && !outputText.includes('failed') && !outputText.includes('timeout') && !outputText.includes('error');

                    if (isSuccess) {
                        if (badge) {
                            badge.className = 'step-badge completed';
                            badge.innerText = 'Completed ✓';
                        }
                    } else {
                        planHasFailed = true;
                        failedStepNumber = i + 1;
                        failureReason = resData.error || resData.output || 'Step execution timed out or failed';
                        if (badge) {
                            badge.className = 'step-badge failed';
                            badge.innerText = 'Failed ✗';
                        }
                        break;
                    }
                } catch (err) {
                    planHasFailed = true;
                    failedStepNumber = i + 1;
                    failureReason = err.message;
                    if (badge) {
                        badge.className = 'step-badge failed';
                        badge.innerText = 'Failed ✗';
                    }
                    break;
                }
            }

            if (planHasFailed) {
                approveBtn.innerText = `❌ Plan Failed at Step ${failedStepNumber}`;
                approveBtn.style.background = "#f43f5e";
                appendMessage('ghost', `[Plan Execution Error]: Step ${failedStepNumber} failed: ${failureReason}. Ghost could not complete the requested action.`);
                speakResponse(`I could not complete the plan because step ${failedStepNumber} failed.`);
            } else {
                approveBtn.innerText = "✓ Plan Executed";
                approveBtn.style.background = "var(--accent-emerald)";
                speakResponse("Implementation plan executed successfully.");
            }
        };

        if (isHandsFreeActive) {
            approveBtn.innerText = "Executing (Hands-Free)...";
            executePlan();
        } else {
            approveBtn.addEventListener('click', executePlan);
        }
    }

    function renderHitlActionCard(actionId) {
        const hitlDiv = document.createElement('div');
        hitlDiv.style.margin = '16px 0';
        hitlDiv.style.padding = '16px';
        hitlDiv.style.border = '1px solid var(--accent-rose)';
        hitlDiv.style.background = 'rgba(244, 63, 94, 0.1)';
        hitlDiv.style.borderRadius = '12px';

        hitlDiv.innerHTML = `
            <p style="color: var(--accent-rose); font-weight: 700; font-size: 12px; margin-bottom: 10px;">ACTION AUTHORIZATION REQUIRED</p>
            <button id="approveBtn_${actionId}" class="send-btn" style="margin-right: 10px;">AUTHORIZE</button>
            <button id="rejectBtn_${actionId}" class="btn-icon" style="color: var(--accent-rose);">REJECT</button>
        `;
        codeContent.appendChild(hitlDiv);
        codeSidebar.classList.add('open');

        document.getElementById(`approveBtn_${actionId}`).addEventListener('click', async () => {
            hitlDiv.innerHTML = `<span style="color: var(--accent-cyan);">Executing action...</span>`;
            try {
                const execRes = await fetch('/api/execute-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actionId })
                });
                const execData = await execRes.json();
                hitlDiv.innerHTML = `<span style="color: ${execData.success ? 'var(--accent-cyan)' : 'var(--accent-rose)'};">${execData.success ? execData.message : execData.error}</span>`;
                speakResponse(execData.success ? "Authorization accepted. Execution successful." : "Execution failed.");
            } catch (e) {
                hitlDiv.innerHTML = `<span style="color: var(--accent-rose);">Network error.</span>`;
            }
        });

        document.getElementById(`rejectBtn_${actionId}`).addEventListener('click', () => {
            hitlDiv.innerHTML = `<span style="color: var(--accent-rose);">Action rejected by user.</span>`;
            speakResponse("Action aborted.");
        });
    }

    function highlightCode(codeText, lang) {
        let esc = codeText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        let tokens = [];
        let id = 0;
        
        // Match string literals and comments to preserve them from inner keyword highlighting
        esc = esc.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\s\S]*?\/\*[\s\S]*?\*\/|\/\/.*|#.*)/g, (match) => {
            const tokenId = `__TOKEN_HL_${id++}__`;
            let color = '#00ffaa'; // string (emerald green)
            if (match.startsWith('//') || match.startsWith('/*') || match.startsWith('#')) {
                color = '#4d6d7b'; // comment (slate gray)
            }
            tokens.push({ id: tokenId, html: `<span style="color: ${color}">${match}</span>` });
            return tokenId;
        });

        // Highlight Keywords
        esc = esc.replace(/\b(const|let|var|function|return|import|export|from|class|extends|new|if|else|for|while|try|catch|async|await|def|print|elif|with|as|pass|lambda)\b/g, '<span style="color: #ff0055">$1</span>');
        
        // Highlight Numbers
        esc = esc.replace(/\b(\d+)\b/g, '<span style="color: #7000ff">$1</span>');
        
        // Highlight Built-ins & Globals
        esc = esc.replace(/\b(console|document|window|process|require|module|self|global|this|arguments)\b/g, '<span style="color: #00f0ff">$1</span>');

        // Restore preserved string literals and comments
        for (let t of tokens) {
            esc = esc.replace(t.id, t.html);
        }
        
        return esc;
    }

    function handleGhostResponse(fullText) {
        if (fullText.includes('[EXECUTE_OPEN_TAB:')) {
            const urlMatch = fullText.match(/\[EXECUTE_OPEN_TAB:(.*?)\]/);
            if (urlMatch && urlMatch[1]) window.open(urlMatch[1], '_blank');
            fullText = fullText.replace(/\[EXECUTE_OPEN_TAB:.*?\]/g, 'Opening web oracle tab.');
        }

        // Match backticks and language tag
        const codeRegex = /[\x60]{3}([a-zA-Z0-9_-]*)\n([\s\S]*?)[\x60]{3}/gi;
        let match, foundHtml = false, htmlContentToRender = "", spokenText = fullText;
        codeContent.innerHTML = '';

        while ((match = codeRegex.exec(fullText)) !== null) {
            let lang = match[1] || 'code';
            let codeBlock = match[2].trim();
            
            // Try to extract a filename from the code comments
            let filename = 'Source Code';
            const firstLine = codeBlock.split('\n')[0].trim();
            const fileMatch = firstLine.match(/(?:\/\/|#)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
            if (fileMatch && fileMatch[1]) {
                filename = fileMatch[1];
            }

            // Create visual code container matching premium batcave theme
            let blockContainer = document.createElement('div');
            blockContainer.className = 'code-block-container';
            blockContainer.style.marginBottom = '20px';

            let header = document.createElement('div');
            header.className = 'code-block-header';
            
            let label = document.createElement('span');
            label.innerText = `${filename} (${lang})`;
            
            let copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.innerText = 'Copy';
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(codeBlock);
                copyBtn.innerText = 'Copied!';
                copyBtn.style.color = 'var(--accent-cyan)';
                setTimeout(() => {
                    copyBtn.innerText = 'Copy';
                    copyBtn.style.color = '';
                }, 2000);
            });
            
            header.appendChild(label);
            header.appendChild(copyBtn);
            
            let pre = document.createElement('pre');
            let code = document.createElement('code');
            code.innerHTML = highlightCode(codeBlock, lang);
            pre.appendChild(code);
            
            blockContainer.appendChild(header);
            blockContainer.appendChild(pre);
            
            codeContent.appendChild(blockContainer);

            if (codeBlock.includes('<!DOCTYPE html>') || (codeBlock.includes('<html') && codeBlock.includes('</html>'))) {
                foundHtml = true;
                htmlContentToRender = codeBlock.substring(codeBlock.indexOf('<!DOCTYPE html>') !== -1 ? codeBlock.indexOf('<!DOCTYPE html>') : codeBlock.indexOf('<html'));
            }
            spokenText = spokenText.replace(match[0], '');
        }

        if (codeContent.innerHTML !== '') codeSidebar.classList.add('open');
        if (foundHtml && htmlContentToRender) {
            appIframe.srcdoc = htmlContentToRender;
            appViewer.classList.add('open');
            if (spokenText.trim() === "") spokenText = "Interface rendered.";
        }

        appendMessage('ghost', spokenText.trim() || "Execution complete.");
        speakResponse(spokenText);
    }

    // --- INITIALIZE MIC ON LOAD ---
    window.addEventListener('resize', () => {
        if (window.ghostVisualizer && typeof window.ghostVisualizer.onResize === 'function') {
            window.ghostVisualizer.onResize();
        }
    });
    initAudioPipeline();

    // --- DOUBLE CLICK TO FOCUS MESSAGE INPUT ---
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
        chatContainer.addEventListener('dblclick', (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                userInput.focus();
            }
        });
    }
});