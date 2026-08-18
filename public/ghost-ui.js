// --- API URL CONFIGURATION POINT ---
const apiBase = (window.VITE_GHOST_API_BASE ?? "").replace(/\/$/, "");
const apiUrl = (path) => `${apiBase}${path}`;

// --- // --- 3D/4D HOLOGRAPHIC THREE.JS VISUALIZER GLOBE ---
class GhostVisualizer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.state = 'idle'; // 'idle', 'listening', 'responding'
    this.micLevel = 0;
    this.timeSinceLastFrame = 0;
    this.isAnimating = false;
    this.frameId = null;

    this.initThree();

    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);

    this.visibilityHandler = () => {
      if (document.hidden) {
        this.pause();
      } else {
        this.resume();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.resume();
        } else {
          this.pause();
        }
      });
    }, { threshold: 0.1 });
    this.observer.observe(this.container);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.matches) {
      this.renderStatic();
    } else {
      this.start();
    }
  }

  initThree() {
    const width = this.container.clientWidth || 600;
    const height = this.container.clientHeight || 420;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.z = 6;

    // Disabled antialiasing and limit pixel ratio to 1 for GPU savings
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(1);
    this.container.appendChild(this.renderer.domElement);

    // Lower detail level from 4 to 2 to minimize vertex calculations
    this.geometry = new THREE.IcosahedronGeometry(2.2, 2);
    this.originalVertices = [];

    const pos = this.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      this.originalVertices.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }

    this.material = new THREE.PointsMaterial({
      color: 0x52525b,
      size: 0.06, // slightly larger particles since detail density is lower
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);

    // Wireframe structure
    const wireGeometry = new THREE.IcosahedronGeometry(1.98, 2);
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x27272a,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending
    });
    this.wireMesh = new THREE.Mesh(wireGeometry, wireMaterial);
    this.scene.add(this.wireMesh);

    this.clock = new THREE.Clock();
    this.targetColor = new THREE.Color(0x52525b);
    this.currentColor = new THREE.Color(0x52525b);
  }

  setState(state) {
    this.state = state;
    if (state === 'idle') {
      this.targetColor.setHex(0x52525b);
    } else if (state === 'listening') {
      this.targetColor.setHex(0x6b21a8);
    } else if (state === 'responding') {
      this.targetColor.setHex(0xa855f7);
    }
  }

  setMicLevel(level) {
    this.micLevel = level;
  }

  onResize() {
    if (!this.container || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  start() {
    if (this.isAnimating) return;
    this.isAnimating = true;
    this.clock.start();
    this.animate();
  }

  pause() {
    this.isAnimating = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  resume() {
    if (this.isAnimating) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.renderStatic();
      return;
    }
    this.start();
  }

  renderStatic() {
    this.pause();
    const pos = this.geometry.attributes.position;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      const orig = this.originalVertices[i];
      pos.setXYZ(i, orig.x, orig.y, orig.z);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.pause();
    window.removeEventListener('resize', this.resizeHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    if (this.observer) this.observer.disconnect();

    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }

    this.container = null;
    this.scene = null;
    this.camera = null;
    this.points = null;
    this.wireMesh = null;
  }

  animate() {
    if (!this.isAnimating) return;
    this.frameId = requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    this.timeSinceLastFrame += delta;

    const targetFPS = (this.state === 'idle') ? 15 : 30;
    const interval = 1 / targetFPS;

    if (this.timeSinceLastFrame >= interval) {
      this.timeSinceLastFrame = this.timeSinceLastFrame % interval;

      const time = this.clock.getElapsedTime();

      let rotSpeed = 0.15;
      if (this.state === 'listening') rotSpeed = 0.3;
      else if (this.state === 'responding') rotSpeed = 0.55;

      this.points.rotation.y = time * rotSpeed;
      this.points.rotation.x = time * (rotSpeed * 0.5);
      this.wireMesh.rotation.y = -time * (rotSpeed * 0.7);

      this.currentColor.lerp(this.targetColor, 0.08);
      this.material.color.copy(this.currentColor);
      if (this.wireMesh.material) {
        this.wireMesh.material.color.copy(this.currentColor);
      }

      const pos = this.geometry.attributes.position;
      const count = pos.count;

      // Zero-allocation inner loop
      for (let i = 0; i < count; i++) {
        const orig = this.originalVertices[i];

        let displacement = 0;
        if (this.state === 'idle') {
          displacement = Math.sin(orig.x * 2.0 + time * 1.5) * Math.cos(orig.y * 2.0 + time * 1.5) * 0.08;
        } else if (this.state === 'listening') {
          displacement = Math.sin(orig.x * 4.0 + time * 8.0) * Math.cos(orig.y * 4.0 + time * 8.0) * (0.05 + this.micLevel * 0.85);
        } else if (this.state === 'responding') {
          displacement = Math.sin(orig.z * 5.0 + time * 14.0) * 0.22 + Math.cos(orig.y * 3.0 + time * 10.0) * 0.08;
        }

        const len = Math.sqrt(orig.x * orig.x + orig.y * orig.y + orig.z * orig.z) || 1;
        const scale = 1 + displacement / len;

        pos.setXYZ(i, orig.x * scale, orig.y * scale, orig.z * scale);
      }

      this.geometry.attributes.position.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
    }
  }
}

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

    this.resizeHandler = () => this.onResize();
    this.onResize();
    window.addEventListener('resize', this.resizeHandler);

    this.phase = 0;
    this.isAnimating = true;
    this.frameId = null;

    this.visibilityHandler = () => {
      if (document.hidden) {
        this.pause();
      } else {
        this.resume();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.matches) {
      this.renderStatic();
    } else {
      this.animate();
    }
  }

  setState(state) {
    this.state = state;
  }

  setMicLevel(level) {
    this.micLevel = level;
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

  pause() {
    this.isAnimating = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  resume() {
    if (this.isAnimating) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.renderStatic();
      return;
    }
    this.isAnimating = true;
    this.animate();
  }

  renderStatic() {
    this.pause();
    this.phase = 0;
    this.drawFrame();
  }

  destroy() {
    this.pause();
    window.removeEventListener('resize', this.resizeHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.container = null;
    this.canvas = null;
    this.ctx = null;
  }

  drawFrame() {
    const width = this.width;
    const height = this.height;
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

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

  animate() {
    if (!this.isAnimating) return;
    this.frameId = requestAnimationFrame(() => this.animate());
    this.phase += 0.09;
    this.drawFrame();
  }
}

document.addEventListener('DOMContentLoaded', () => {
    let availableVoices = [];
    window.speechSynthesis.onvoiceschanged = () => { availableVoices = window.speechSynthesis.getVoices(); };


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
    function updateInitialGreeting(name) {
        let greetingText;
        if (!name || name === 'Admin' || name === 'Guest') {
            greetingText = "Welcome back. What are we building today?";
        } else {
            greetingText = `Hey, ${name}. What are we building today?`;
        }
        const firstBubble = document.querySelector('#chatLog .message-card.ghost .bubble');
        if (firstBubble && isAdminMode) {
            firstBubble.innerHTML = greetingText;
        }
    }

    function capitalizeName(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function showNeutralOnboarding() {
        const loginSub = document.querySelector('.login-sub');
        if (loginSub) {
            loginSub.innerText = "Welcome to Ghost. What should I call you?";
        }
        if (authInput) {
            authInput.placeholder = "Enter your name...";
        }
        const firstBubble = document.querySelector('#chatLog .message-card.ghost .bubble');
        if (firstBubble) {
            firstBubble.innerText = "Welcome to Ghost. What should I call you?";
        }
    }

    async function checkPersistentAuth() {
        try {
            const res = await fetch(apiUrl('/api/verify-auth'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (data.success && data.isAdmin) {
                masterUser = capitalizeName(data.user || "");
                isAdminMode = true;
                if (!masterUser) {
                    storedClearanceKey = "session_authorized";
                    loginOverlay.style.opacity = '1';
                    loginOverlay.style.visibility = 'visible';
                    authInput.placeholder = "What should I call you?";
                    document.querySelector('.login-sub').innerText = "Owner access authorized. What should I call you?";
                    authInput.focus();
                } else {
                    userTag.innerText = masterUser.toUpperCase();
                    userTag.style.color = 'var(--accent-primary)';
                    loginOverlay.style.opacity = '0';
                    loginOverlay.style.visibility = 'hidden';
                    appLayout.classList.add('active');
                    updateInitialGreeting(masterUser);
                }
                console.log('[Auth] Persistent session verified via HTTP-only cookie.');
            } else {
                masterUser = "Guest";
                isAdminMode = false;
                loginOverlay.style.opacity = '0';
                loginOverlay.style.visibility = 'hidden';
                appLayout.classList.add('active');
            }
        } catch (e) {
            console.warn('[Auth] Persistent verification error:', e.message);
            masterUser = "Guest";
            isAdminMode = false;
            loginOverlay.style.opacity = '0';
            loginOverlay.style.visibility = 'hidden';
            appLayout.classList.add('active');
        }
    }
    checkPersistentAuth();

    // --- AUTHENTICATION HANDLER ---
    let storedClearanceKey = '';
    authInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const inputVal = authInput.value.trim();
            if (!inputVal) return;

            if (!storedClearanceKey) {
                try {
                    const authRes = await fetch(apiUrl('/api/auth'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ authString: inputVal })
                    });
                    const authData = await authRes.json();

                    if (authData.success) {
                        storedClearanceKey = inputVal;
                        authInput.value = '';
                        authInput.placeholder = "What should I call you?";
                        document.querySelector('.login-sub').innerText = "Clearance key accepted. What should I call you?";
                    } else {
                        alert('Invalid clearance key.');
                    }
                } catch (err) {
                    alert('Authentication failed.');
                }
            } else {
                const chosenName = inputVal.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 20) || "";
                if (!chosenName) {
                    alert('Name cannot be empty.');
                    return;
                }
                try {
                    const payload = { user: chosenName };
                    if (storedClearanceKey !== 'session_authorized') {
                        payload.authString = storedClearanceKey;
                    }
                    const authRes = await fetch(apiUrl('/api/auth'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payload)
                    });
                    const authData = await authRes.json();
                    if (authData.success) {
                        masterUser = capitalizeName(authData.user || chosenName);
                        isAdminMode = true;
                        userTag.innerText = masterUser.toUpperCase();
                        userTag.style.color = 'var(--accent-primary)';
                        updateInitialGreeting(masterUser);
                        speakResponse(`Hey, ${masterUser}. What are we building today?`, true);
                        loginOverlay.style.opacity = '0';
                        loginOverlay.style.visibility = 'hidden';
                        appLayout.classList.add('active');
                        // Reload Projects and Memory
                        loadProjects();
                        loadMemories();
                    }
                } catch (err) {
                    alert('Failed to set name.');
                }
                storedClearanceKey = '';
            }
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
        if (window.ghostVisualizer) {
            window.ghostVisualizer.destroy();
            window.ghostVisualizer = null;
        }
        const isDesktopApp = !!(window.ghostDesktop && window.ghostDesktop.isDesktop) || window.navigator.userAgent.includes('Electron');
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

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

    async function enableHandsFreeMode() {
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
        await initAudioPipeline();
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
        cleanupAudioPipeline();
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

    function cleanUrl(rawUrl) {
        if (!rawUrl) return '';
        return rawUrl.trim()
            .replace(/[^\x21-\x7E]/g, '')
            .replace(/[)\]>;,.'"\\-]+$/, '')
            .replace(/^["'(]+/g, '');
    }

    function parseMarkdown(text) {
        if (!text) return '';
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Code blocks ```...```
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        // Inline code `...`
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bold **text**
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Italic *text*
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        const links = [];

        // 1. Markdown Links [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, rawUrl) => {
            const url = cleanUrl(rawUrl);
            const placeholder = `___LINK_PLACEHOLDER_${links.length}___`;
            const displayLabel = label.trim();
            links.push(`<a href="${url}" target="_blank" class="chat-download-link" style="color:#00f0ff;text-decoration:underline;font-weight:600;">${displayLabel} ⬇️</a>`);
            return placeholder;
        });

        // 2. Plain URLs (not inside href)
        html = html.replace(/(^|[^"])((?:https?):\/\/[^\s<>\)"'\`]+)/g, (match, prefix, rawUrl) => {
            const url = cleanUrl(rawUrl);
            const placeholder = `___LINK_PLACEHOLDER_${links.length}___`;
            links.push(`<a href="${url}" target="_blank" class="chat-download-link" style="color:#00f0ff;text-decoration:underline;font-weight:600;">${url} ⬇️</a>`);
            return prefix + placeholder;
        });

        // 3. Restore placeholders
        links.forEach((linkHtml, index) => {
            html = html.replace(`___LINK_PLACEHOLDER_${index}___`, linkHtml);
        });

        // Newlines
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    // --- CHAT MESSAGE UI RENDERING ---
    function appendMessage(sender, text) {
        const card = document.createElement('div');
        card.className = `message-card ${sender}`;

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.innerText = sender === 'user' ? 'U' : 'G';

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = parseMarkdown(text);

        card.appendChild(avatar);
        card.appendChild(bubble);
        chatLog.appendChild(card);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    // --- SPEECH SYNTHESIS & VOICE OUTPUT ---
    function setMicState(state) {
        if (micToggleBtn) {
            micToggleBtn.className = `mic-btn ${state}`;
            if (state === 'listening') micToggleBtn.innerText = '🔴';
            else if (state === 'transcribing') micToggleBtn.innerText = '⏳';
            else if (state === 'speaking') micToggleBtn.innerText = '🔊';
            else micToggleBtn.innerText = '🎤';
        }

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

    function speakResponse(text, skipAppend = false) {
        let cleanText = text.replace(/[\x60]{3}[\s\S]*?[\x60]{3}/g, '')
                            .replace(/<think>[\s\S]*?<\/think>/g, '')
                            .replace(/<search>[\s\S]*?<\/search>/g, '')
                            .replace(/\[.*?\]/g, '').trim();

        if (!cleanText) cleanText = "Execution complete.";

        // 1. Display immediately in chat bubble
        if (!skipAppend) {
            appendMessage('ghost', cleanText);
        }

        // 2. Speak in parallel (fire and forget)
        if (inputMode !== 'voice') {
            console.log('[TTS] Input mode is text, skipping voice audio output.');
            return;
        }
        if (!window.speechSynthesis) {
            console.error('[TTS] window.speechSynthesis is completely unsupported in this browser.');
            return;
        }

        try {
            window.speechSynthesis.cancel(); // Clear any stuck utterances

            // Stop any background recognition when speaking to prevent echoing as wake word
            if (recognitionInstance && recognitionActive) {
                try { recognitionInstance.stop(); } catch(e) {}
            }

            setMicState('speaking');

            const utterance = new SpeechSynthesisUtterance(cleanText);

            // Force load voices if empty
            if (availableVoices.length === 0) {
                availableVoices = window.speechSynthesis.getVoices();
            }

            let ukVoice = availableVoices.find(v => v.lang === 'en-GB' || v.name.includes('UK English'))
                          || availableVoices.find(v => v.lang.includes('en'));

            if (ukVoice) {
                utterance.voice = ukVoice;
                console.log(`[TTS] Using voice: ${ukVoice.name} (${ukVoice.lang})`);
            } else {
                console.error('[TTS] No English voice profile found on this OS! Aborting to prevent silent humming loop.');
                addMessageToChat('System', 'Voice profile missing! Please install an English TTS voice in your OS settings to use hands-free mode.', true);
                setMicState('idle');
                if (isHandsFreeActive) {
                    setTimeout(() => { if (isHandsFreeActive && !isRecording) triggerHandsFreeListening(); }, 400);
                }
                return;
            }

            utterance.rate = 1.05;
            utterance.pitch = 0.95;
            utterance.volume = 1.0;

            utterance.onstart = () => {
                console.log('[TTS] Speech started successfully.');
            };

            utterance.onend = () => {
                console.log('[TTS] Speech ended naturally.');
                setMicState('idle');
                if (isHandsFreeActive) {
                    setTimeout(() => {
                        if (isHandsFreeActive && !isRecording) {
                            triggerHandsFreeListening();
                        }
                    }, 400);
                }
            };

            utterance.onerror = (e) => {
                console.error('[TTS] Speech synthesis error:', e.error || e);
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

            // Failsafe: if speech doesn't start in 1 second, it's stuck.
            // Chrome on Mac sometimes gets stuck in a silent state.
            setTimeout(() => {
                if (window.speechSynthesis.pending && !window.speechSynthesis.speaking) {
                    console.error('[TTS] Failsafe triggered: Speech is stuck pending! Canceling.');
                    window.speechSynthesis.cancel();
                    utterance.onerror({ error: 'stuck_pending' });
                }
            }, 1000);

        } catch (err) {
            console.error('[TTS] Exception in speakResponse:', err);
        }
    }

    // --- AUDIO PIPELINE, WAKE-WORD & SILENCE DETECTION ---
    let mediaRecorder = null;
    class VoiceStateMachine {
        constructor() {
            this.state = 'idle'; // idle, listening, recording, transcribing, speaking, error
        }
        transition(newState) {
            console.log(`[VoiceStateMachine] Transition: ${this.state} -> ${newState}`);

            // Exit logic
            if (this.state === 'speaking' && newState !== 'speaking') {
                if (window.speechSynthesis) window.speechSynthesis.cancel();
            }
            if (this.state === 'recording' && newState !== 'recording') {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    try { mediaRecorder.stop(); } catch(e) {}
                }
            }

            this.state = newState;
            setMicState(newState);
        }
        isRecording() {
            return this.state === 'recording';
        }
        isSpeaking() {
            return this.state === 'speaking';
        }
    }

    const voiceState = new VoiceStateMachine();

    let audioChunks = [];
    let globalAudioContext = null;
    let globalAnalyser = null;
    let globalStream = null;
    let recognitionInstance = null;
    let audioLevelFrameId = null;

    function isRecording() { return voiceState.isRecording(); }
    let recognitionActive = false;

    function cleanupAudioPipeline() {
        console.log('[Audio Pipeline] Cleaning up audio pipeline...');
        // 1. Cancel requestAnimationFrame loop
        if (audioLevelFrameId) {
            cancelAnimationFrame(audioLevelFrameId);
            audioLevelFrameId = null;
        }

        // 2. Stop SpeechRecognition
        if (recognitionInstance) {
            try {
                recognitionInstance.onstart = null;
                recognitionInstance.onend = null;
                recognitionInstance.onerror = null;
                recognitionInstance.onresult = null;
                recognitionInstance.stop();
            } catch (e) { console.warn('Failed to stop recognition:', e); }
            recognitionInstance = null;
            recognitionActive = false;
        }

        // 3. Stop every media track
        if (globalStream) {
            globalStream.getTracks().forEach(track => {
                try { track.stop(); } catch(e) {}
            });
            globalStream = null;
        }

        // 4. Close AudioContext
        if (globalAudioContext) {
            try {
                if (globalAudioContext.state !== 'closed') {
                    globalAudioContext.close();
                }
            } catch (e) { console.warn('Failed to close AudioContext:', e); }
            globalAudioContext = null;
        }

        globalAnalyser = null;
        voiceState.transition('idle');
    }

    async function initAudioPipeline() {
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            appendMessage('ghost', "SpeechRecognition is not supported in this browser. Please use Chrome.");
            cleanupAudioPipeline();
            return;
        }
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
                    if (!isRecording()) {
                        triggerHandsFreeListening();
                    }
                }
            }

            function updateAudioLevels() {
                audioLevelFrameId = requestAnimationFrame(updateAudioLevels);
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
                if (isHandsFreeActive && !isRecording() && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
                    if (normalized > 0.035) {
                        console.log(`[Always-On Mic] Speech activity detected (${(normalized * 100).toFixed(1)}%). Auto-initiating recording.`);
                        triggerHandsFreeListening();
                    }
                }

                // SILENCE AUTO-SUBMIT: Conclude capture after 1.0 second of silence
                if (isRecording()) {
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
            cleanupAudioPipeline();
        }
    }

    function startWakeWordRecognition() {
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            console.warn('[Wake Recognizer] SpeechRecognition API not supported in this browser environment.');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognitionInstance = new SpeechRecognition();
        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;
        recognitionInstance.lang = 'en-US';

        recognitionInstance.onstart = () => {
            recognitionActive = true;
            console.log('[Wake Recognizer] Continuous voice recognition active.');
        };

        recognitionInstance.onresult = (event) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const text = event.results[i][0].transcript;
                const lowerText = text.toLowerCase();

                if (isHandsFreeActive) {
                    const liveTextEl = document.getElementById('handsFreeLiveText');
                    if (liveTextEl) {
                        liveTextEl.innerText = `Manoj: "${text}"`;
                    }
                    if (event.results[i].isFinal && text.trim().length > 0) {
                        if (!window.speechSynthesis || !window.speechSynthesis.speaking) {
                            console.log('[Hands-Free Voice] Final voice transcript captured:', text);
                            inputMode = 'voice';
                            processCommand(text);
                        }
                    }
                } else if (event.results[i].isFinal) {
                    console.log('[Wake Recognizer] Final stream token:', text);
                } else {
                    interimTranscript += lowerText;
                }

                // Look for wake words when hands-free is inactive
                if (!isHandsFreeActive && lowerText.includes('ghost') && !isRecording && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
                    console.log('[Wake Recognizer] Hot word match found! Activating hands-free mode.');
                    enableHandsFreeMode();
                    break;
                }
            }
        };

        recognitionInstance.onend = () => {
            recognitionActive = false;
            const isElectron = navigator.userAgent.toLowerCase().includes('electron');
            if (!isElectron && !isRecording && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
                setTimeout(() => {
                    try {
                        recognitionInstance.start();
                    } catch (e) {}
                }, 1000);
            }
        };

        recognitionInstance.onerror = (err) => {
            console.warn('[Wake Recognizer] Native SpeechRecognition notice:', err.error || err);
            recognitionActive = false;
        };

        try {
            recognitionInstance.start();
        } catch(e) {}
    }

    async function triggerHandsFreeListening() {
        if (isRecording()) return;
        console.log('[Audio Pipeline] Initializing active hands-free recording session.');
        inputMode = 'voice';

        voiceState.transition('recording');

        try {
            audioChunks = [];
            mediaRecorder = new MediaRecorder(globalStream);

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstart = () => {
                voiceState.transition('recording');
            };

            mediaRecorder.onstop = async () => {
                voiceState.transition('transcribing');
                setMicState('transcribing');

                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64Audio = reader.result;
                    try {
                        const res = await fetch(apiUrl('/api/voice/transcribe'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
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
        if (mediaRecorder && isRecording()) {
            mediaRecorder.stop();
        }
    }

    if (micToggleBtn) {
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
    }

    // --- ATTACHMENTS & FILE BUFFERING ---
    let uploadedFileText = "", uploadedImageBase64 = "", uploadedFileBase64 = "", uploadedFileName = "";
    attachBtn.addEventListener('click', () => attachmentInput.click());
    attachmentInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        uploadedFileName = file.name;
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                uploadedImageBase64 = ev.target.result.split(',')[1];
                appendMessage('user', `[Attached Image: ${file.name}]`);
            };
            reader.readAsDataURL(file);
        } else if (file.type === 'application/pdf') {
            const reader = new FileReader();
            reader.onload = (ev) => {
                uploadedFileBase64 = ev.target.result;
                appendMessage('user', `[Attached PDF: ${file.name}]`);
            };
            reader.readAsDataURL(file);
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
        if (val || uploadedImageBase64 || uploadedFileText || uploadedFileBase64) {
            inputMode = 'text';
            processCommand(val);
        }
    });

    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const val = userInput.value.trim();
            if (val || uploadedImageBase64 || uploadedFileText || uploadedFileBase64) {
                inputMode = 'text';
                processCommand(val);
            }
        }
    });

    let activeRunId = null;

    window.cancelActiveRun = async function() {
        try {
            await fetch(apiUrl(`/api/runs/cancel-active`), { method: 'POST', credentials: 'include' });
            appendMessage('ghost', "Run cancelled by user.");
            thinkingIndicator.classList.remove('active');
            activeRunId = null;
        } catch (e) {
            console.warn("Cancel failed:", e);
        }
    };

    async function processCommand(textCommand) {
        if (textCommand) appendMessage('user', textCommand);
        userInput.value = "";
        thinkingIndicator.classList.add('active');

        const payload = {
            message: textCommand,
            user: masterUser,
            image: uploadedImageBase64 || null,
            fileContent: uploadedFileText || null,
            fileBase64: uploadedFileBase64 || null,
            fileName: uploadedFileName || null,
            ghostCodeMode: isGhostCodeActive,
            handsFreeMode: isHandsFreeActive
        };

        uploadedFileText = "";
        uploadedImageBase64 = "";
        uploadedFileBase64 = "";
        uploadedFileName = "";
        attachmentInput.value = "";

        try {
            const response = await fetch(apiUrl('/api/chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (response.status === 401) {
                thinkingIndicator.classList.remove('active');
                loginOverlay.style.opacity = '1';
                loginOverlay.style.visibility = 'visible';
                appLayout.classList.remove('active');
                return;
            }

            if (response.status === 409) {
                thinkingIndicator.classList.remove('active');
                appendMessage('ghost', "A task is already running. Please wait for it to finish, or type `cancel that`.");
                return;
            }

            const data = await response.json();
            thinkingIndicator.classList.remove('active');

            if (data.success) {
                if (data.runId) activeRunId = data.runId;
                handleGhostResponse(data.text);
                if (data.plan && Array.isArray(data.plan) && data.plan.length > 0) {
                    renderAntigravityPlanCard(data.plan, textCommand);
                }
                if (data.actionRequired && data.actionId) {
                    renderHitlActionCard(data.actionId);
                }
                activeRunId = null;
            } else {
                appendMessage('ghost', data.error || "Matrix error: Backend disconnected.");
                activeRunId = null;
            }
        } catch (error) {
            thinkingIndicator.classList.remove('active');
            appendMessage('ghost', "Critical failure: Server unreachable.");
            activeRunId = null;
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
                    const response = await fetch(apiUrl('/api/execute-plan-step'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
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
                const execRes = await fetch(apiUrl('/api/execute-action'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
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

        speakResponse(spokenText);
    }

    // --- INITIALIZE MIC ON LOAD ---
    window.addEventListener('resize', () => {
        if (window.ghostVisualizer && typeof window.ghostVisualizer.onResize === 'function') {
            window.ghostVisualizer.onResize();
        }
    });

    // --- PROJECTS & MEMORIES WORKSPACE LOGIC ---
    let currentProjectId = null;
    const projectsList = document.getElementById('projectsList');
    const memoryList = document.getElementById('memoryList');
    const createProjectBtn = document.getElementById('createProjectBtn');
    const saveMemoryBtn = document.getElementById('saveMemoryBtn');

    async function loadProjects() {
        if (!projectsList) return;
        try {
            const res = await fetch(apiUrl('/api/projects'), { credentials: 'include' });
            const data = await res.json();
            if (res.status === 401 || data.error === 'Missing token.' || data.error === 'Unauthorized') {
                projectsList.innerHTML = '<div class="loading-text" style="font-size:11px; color:var(--text-sub); margin-bottom:6px;">Owner access is required for Projects and Memory.</div><div class="loading-text"><button class="unlock-btn" style="background:var(--accent-primary); border:none; padding:4px 8px; color:#fff; cursor:pointer; border-radius:3px; font-size:11px;">Unlock Ghost</button></div>';
                return;
            }
            if (res.status === 503 || data.error === 'DATABASE_UNAVAILABLE') {
                projectsList.innerHTML = '<div class="loading-text">⚠️ Storage not configured. (Local Preview)</div>';
                return;
            }
            if (!data.success || !data.projects) {
                projectsList.innerHTML = '<div class="loading-text">Failed to load projects.</div>';
                return;
            }
            if (data.projects.length === 0) {
                projectsList.innerHTML = '<div class="loading-text">No projects.</div>';
                return;
            }
            projectsList.innerHTML = '';
            data.projects.forEach(proj => {
                const item = document.createElement('div');
                item.className = 'project-item' + (currentProjectId === proj.id ? ' active' : '');
                item.innerHTML = `
                    <div class="project-name">${escapeHtml(proj.name)}</div>
                    <div class="project-desc">${proj.description ? escapeHtml(proj.description) : 'No description'}</div>
                    <button class="delete-btn" style="position:absolute; right:8px; top:8px; background:none; border:none; color:var(--text-dim); cursor:pointer;">✕</button>
                `;
                item.querySelector('.delete-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm('Are you sure you want to delete this project?')) return;
                    await deleteProject(proj.id);
                });
                item.addEventListener('click', () => {
                    currentProjectId = proj.id;
                    document.querySelectorAll('.project-item').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                });
                projectsList.appendChild(item);
            });
        } catch (e) {
            projectsList.innerHTML = '<div class="loading-text">Connection error.</div>';
        }
    }

    async function deleteProject(id) {
        try {
            const res = await fetch(apiUrl(`/api/projects/${id}`), { method: 'DELETE', credentials: 'include' });
            if (res.ok) {
                if (currentProjectId === id) currentProjectId = null;
                loadProjects();
            }
        } catch (e) { console.error(e); }
    }

    async function loadMemories() {
        if (!memoryList) return;
        try {
            const res = await fetch(apiUrl('/api/memory'), { credentials: 'include' });
            const data = await res.json();
            if (res.status === 401 || data.error === 'Missing token.' || data.error === 'Unauthorized') {
                memoryList.innerHTML = '<div class="loading-text" style="font-size:11px; color:var(--text-sub); margin-bottom:6px;">Owner access is required for Projects and Memory.</div><div class="loading-text"><button class="unlock-btn" style="background:var(--accent-primary); border:none; padding:4px 8px; color:#fff; cursor:pointer; border-radius:3px; font-size:11px;">Unlock Ghost</button></div>';
                return;
            }
            if (res.status === 503 || data.error === 'DATABASE_UNAVAILABLE') {
                memoryList.innerHTML = '<div class="loading-text">⚠️ Storage not configured. (Local Preview)</div>';
                return;
            }
            if (!data.success || !data.memories) {
                memoryList.innerHTML = '<div class="loading-text">Failed to load memory.</div>';
                return;
            }
            if (data.memories.length === 0) {
                memoryList.innerHTML = '<div class="loading-text">No saved notes.</div>';
                return;
            }
            memoryList.innerHTML = '';
            data.memories.forEach(mem => {
                const item = document.createElement('div');
                item.className = 'memory-item';
                item.innerHTML = `
                    <div class="memory-title">${escapeHtml(mem.title)} [${escapeHtml(mem.category)}]</div>
                    <div class="memory-content">${escapeHtml(mem.content)}</div>
                    <button class="delete-btn" style="position:absolute; right:8px; top:8px; background:none; border:none; color:var(--text-dim); cursor:pointer;">✕</button>
                `;
                item.querySelector('.delete-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm('Are you sure you want to delete this memory note?')) return;
                    await deleteMemory(mem.id);
                });
                memoryList.appendChild(item);
            });
        } catch (e) {
            memoryList.innerHTML = '<div class="loading-text">Connection error.</div>';
        }
    }

    async function deleteMemory(id) {
        try {
            const res = await fetch(apiUrl(`/api/memory/${id}`), { method: 'DELETE', credentials: 'include' });
            if (res.ok) loadMemories();
        } catch (e) { console.error(e); }
    }

    if (createProjectBtn) {
        createProjectBtn.addEventListener('click', async () => {
            const name = prompt('Enter project name:');
            if (!name) return;
            const description = prompt('Enter project description (optional):');
            const repoUrl = prompt('Enter repository URL (optional, http/https):');
            try {
                const res = await fetch(apiUrl('/api/projects'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ name, description, repoUrl })
                });
                const data = await res.json();
                if (data.success) loadProjects();
                else alert(data.error || 'Failed to create project');
            } catch (e) { alert('Connection error'); }
        });
    }

    if (saveMemoryBtn) {
        saveMemoryBtn.addEventListener('click', async () => {
            const title = prompt('Enter memory title:');
            if (!title) return;
            const content = prompt('Enter memory content:');
            if (!content) return;
            const category = prompt('Enter category (general, codebase, preference, todo):', 'general');
            try {
                const res = await fetch(apiUrl('/api/memory'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ projectId: currentProjectId, title, content, category })
                });
                const data = await res.json();
                if (data.success) loadMemories();
                else alert(data.error || 'Failed to save memory note');
            } catch (e) { alert('Connection error'); }
        });
    }

    function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Load projects and memories if logged in (check every second until initialized)
    const checkAuthTimer = setInterval(() => {
        if (isAdminMode) {
            loadProjects();
            loadMemories();
            clearInterval(checkAuthTimer);
        }
    }, 1000);

    // --- AUTONOMOUS CODING HANDLERS ---
    const connectRunnerBtn = document.getElementById('connectRunnerBtn');
    const startAgentTaskBtn = document.getElementById('startAgentTaskBtn');
    const runnerStatusDot = document.getElementById('runnerStatusDot');
    const runnerConnectionInfo = document.getElementById('runnerConnectionInfo');
    const copyStartCmdBtn = document.getElementById('copyStartCmdBtn');
    const runnerStartCmd = document.getElementById('runnerStartCmd');

    let isRunnerConnected = false;
    let isRunnerConnecting = false;
    let companionState = null; // 'unpaired' | 'pairing_ready' | 'pairing_error' | 'unavailable' | 'verified'

    async function checkRunnerStatus() {
        if (!isAdminMode) {
            if (connectRunnerBtn) {
                connectRunnerBtn.innerText = "Owner-only — Unlock Ghost";
                connectRunnerBtn.disabled = true;
            }
            if (ghostCodeBtn) {
                ghostCodeBtn.classList.remove('active');
                if (ghostCodeStatus) ghostCodeStatus.innerText = "Coding workspace locked";
            }
            if (runnerStatusDot) {
                runnerStatusDot.style.background = '#ff4d4d';
                runnerStatusDot.title = 'Workspace locked';
            }
            return;
        }

        if (isRunnerConnecting) {
            if (connectRunnerBtn) {
                connectRunnerBtn.innerText = "Connecting…";
                connectRunnerBtn.disabled = true;
            }
            return;
        }

        try {
            const res = await fetch(apiUrl('/api/runner/status'), { credentials: 'include' });
            const data = await res.json();
            isRunnerConnected = data.connected;

            if (isRunnerConnected) {
                companionState = 'verified';
                if (connectRunnerBtn) {
                    connectRunnerBtn.innerText = "Disconnect local Companion";
                    connectRunnerBtn.disabled = false;
                }
                if (runnerStatusDot) {
                    runnerStatusDot.style.background = '#2ecc71';
                    runnerStatusDot.title = 'Companion connected';
                }
                const helper = document.getElementById('runnerHelperText');
                if (helper) {
                    if (data.activeRun) {
                        helper.innerText = "Approved local task running.";
                    } else if (data.lastStatus === 'failed' || data.lastStatus === 'cancelled') {
                        helper.innerText = "No changes were confirmed.";
                    } else {
                        helper.innerText = "Local Companion verified — awaiting an approved task.";
                    }
                }
                startAgentTaskBtn.style.display = 'block';
                if (ghostCodeBtn) {
                    ghostCodeBtn.classList.add('active');
                    if (data.activeRun) {
                        if (ghostCodeStatus) ghostCodeStatus.innerText = "Code Execution Active";
                    } else if (window.isPlanApprovalRequired) {
                        if (ghostCodeStatus) ghostCodeStatus.innerText = "Plan approval required before changes";
                    } else {
                        if (ghostCodeStatus) ghostCodeStatus.innerText = "Awaiting an approved local task";
                    }
                }
            } else {
                if (connectRunnerBtn) {
                    connectRunnerBtn.innerText = "Connect local Companion";
                    connectRunnerBtn.disabled = false;
                }
                if (runnerStatusDot) {
                    runnerStatusDot.style.background = '#ff4d4d';
                    runnerStatusDot.title = 'Runner Offline';
                }
                const helper = document.getElementById('runnerHelperText');
                if (helper) {
                    if (companionState === 'pairing_ready') {
                        helper.innerText = "Companion setup ready — start the local Runner on this Mac to complete pairing.";
                    } else if (companionState === 'pairing_error') {
                        helper.innerText = "Couldn’t start Companion setup. No Mac access was granted. Try again after refreshing Ghost.";
                    } else if (companionState === 'failed_cancelled' || data.lastStatus === 'failed' || data.lastStatus === 'cancelled') {
                        helper.innerText = "No changes were confirmed.";
                    } else if (companionState === 'unavailable') {
                        helper.innerText = "Local Companion unavailable. No code has run.";
                    } else {
                        helper.innerText = "Runs only on this Mac for approved repositories.";
                    }
                }
                startAgentTaskBtn.style.display = 'none';
                if (ghostCodeBtn) {
                    ghostCodeBtn.classList.remove('active');
                    if (ghostCodeStatus) ghostCodeStatus.innerText = "Ready to draft a plan";
                }
            }
        } catch (err) {
            console.error('Error checking runner status:', err);
        }
    }

    if (connectRunnerBtn) {
        connectRunnerBtn.addEventListener('click', async () => {
            if (isRunnerConnected) {
                try {
                    await fetch('http://127.0.0.1:4185/api/cancel', { method: 'POST', mode: 'no-cors' });
                } catch (e) {}
                isRunnerConnected = false;
                companionState = 'unavailable';
                runnerConnectionInfo.style.display = 'none';
                checkRunnerStatus();
                return;
            }

            isRunnerConnecting = true;
            checkRunnerStatus();

            try {
                const res = await fetch(apiUrl('/api/runner/connect'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    credentials: 'include',
                    });

                let data = null;
                const contentType = res.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    data = await res.json();
                }

                if (res.ok && data && data.success) {
                    companionState = 'pairing_ready';
                    runnerConnectionInfo.style.display = 'block';
                    if (runnerStartCmd) {
                        runnerStartCmd.innerText = `RUNNER_TOKEN=${data.token} npm run runner:local`;
                    }
                } else {
                    companionState = 'pairing_error';
                }
            } catch (err) {
                companionState = 'pairing_error';
            } finally {
                isRunnerConnecting = false;
                checkRunnerStatus();
            }
        });
    }

    if (copyStartCmdBtn && runnerStartCmd) {
        copyStartCmdBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(runnerStartCmd.innerText.trim());
            copyStartCmdBtn.innerText = "Copied!";
            setTimeout(() => {
                copyStartCmdBtn.innerText = "Copy Command";
            }, 2000);
        });
    }

    let runnerStatusInterval = null;
    function startRunnerStatusPolling() {
        if (runnerStatusInterval) clearInterval(runnerStatusInterval);
        checkRunnerStatus();
        runnerStatusInterval = setInterval(() => {
            if (document.hidden || !isAdminMode) return;
            checkRunnerStatus();
        }, 20000);
    }
    function stopRunnerStatusPolling() {
        if (runnerStatusInterval) {
            clearInterval(runnerStatusInterval);
            runnerStatusInterval = null;
        }
    }

    startRunnerStatusPolling();

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopRunnerStatusPolling();
        } else {
            if (isAdminMode) startRunnerStatusPolling();
        }
    });

    if (startAgentTaskBtn) {
        startAgentTaskBtn.addEventListener('click', async () => {
            const goal = prompt('What coding goal should the autonomous agent accomplish?');
            if (!goal || !goal.trim()) return;

            const repoId = 'local-repo-connection';
            try {
                await fetch('/api/repo-connections', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ displayName: 'Ghost Local Approved Repo', allowedBranchPolicy: 'agent-*', status: 'active' })
                });

                const taskRes = await fetch('/api/agent-tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ goal, repoId })
                });
                const taskData = await taskRes.json();

                if (taskData.success) {
                    appendMessage('ghost', `Autonomous Coding Task created. Starting execution state machine...`);
                    const runRes = await fetch('/api/agent-runs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ taskId: taskData.task.id })
                    });
                    const runData = await runRes.json();
                    if (runData.success && runData.run.status === 'awaiting_plan_approval') {
                        window.isPlanApprovalRequired = true;
                        checkRunnerStatus();
                        const approved = confirm(`Agent Implementation Plan Generated:\n\n${runData.run.planSummary}\n\nDo you approve this plan?`);
                        const decision = approved ? 'approved' : 'rejected';
                        await fetch(`/api/approvals/${runData.run.approvalId}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ decision, runId: runData.run.runId })
                        });
                        window.isPlanApprovalRequired = false;
                        checkRunnerStatus();
                        appendMessage('ghost', `Plan ${decision}. Execution resumed on isolated companion runner.`);
                    }
                } else {
                    alert('Failed to create task: ' + (taskData.error || 'Unknown error'));
                }
            } catch (err) {
                alert('Task execution trigger failed: ' + err.message);
            }
        });
    }

    // --- QUICK ACTION HANDLER ---
    window.sendQuickAction = function(text) {
        if (typeof processCommand === 'function') {
            processCommand(text);
        }
    };

    // --- DOUBLE CLICK TO FOCUS MESSAGE INPUT ---
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
        chatContainer.addEventListener('dblclick', (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                userInput.focus();
            }
        });
    }

    // --- GLOBAL UNLOCK ACTION ---
    document.addEventListener('click', (e) => {
        if (e.target && e.target.classList.contains('unlock-btn')) {
            loginOverlay.style.opacity = '1';
            loginOverlay.style.visibility = 'visible';
            authInput.value = '';
            authInput.placeholder = "Enter clearance key...";
            document.querySelector('.login-sub').innerText = "Enter clearance key to initialize core interface";
            authInput.focus();
        }
    });
});