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
    const loginOverlay = document.getElementById('loginOverlay');
    const authInput = document.getElementById('authInput');
    const appLayout = document.getElementById('app-layout');
    const userTag = document.getElementById('headerNameTag');
    const userRoleBadge = document.getElementById('userRoleBadge');
    const visitorGateOverlay = document.getElementById('visitorGateOverlay');
    const showUnlockBtn = document.getElementById('showUnlockBtn');
    const backToVisitorBtn = document.getElementById('backToVisitorBtn');
    const visitorContinueBtn = document.getElementById('visitorContinueBtn');
    const visitorNameInput = document.getElementById('visitorNameInput');
    const headerUnlockBtn = document.getElementById('headerUnlockBtn');
    const visitorModalUnlockBtn = document.getElementById('visitorModalUnlockBtn');
    const visitorModal = document.getElementById('visitorModal');
    const visitorModalCloseBtn = document.getElementById('visitorModalCloseBtn');
    const isLocalOrigin = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const chatLog = document.getElementById('chatLog');
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const attachBtn = document.getElementById('attachBtn');
    const attachmentInput = document.getElementById('attachmentInput');
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
    let currentSelectedTestKey = null;

    const ghostCodeStatus = document.getElementById('ghostCodeStatus');

    // --- PERSISTENT OWNER RECOGNITION & WORKSPACE ONBOARDING ---
    function renderWelcomeCard(name) {
        if (!chatLog) return;
        const welcomeUser = name || masterUser || 'Manoj';
        chatLog.innerHTML = `
            <div class="message-card ghost welcome-card">
                <div class="avatar">G</div>
                <div class="bubble">
                    <div class="welcome-heading">Welcome, ${welcomeUser}.</div>
                    <p class="welcome-sub">Ghost Operator is online and ready for technical direction.</p>
                    <div class="quick-action-pills">
                        <button type="button" class="quick-action-pill" data-prompt="Open Workspace">
                            <span class="pill-icon">🗄️</span> Open Workspace
                        </button>
                        <button type="button" class="quick-action-pill" data-prompt="Write code as text">
                            <span class="pill-icon">💻</span> Write code as text
                        </button>
                        <button type="button" class="quick-action-pill" data-prompt="Inspect Ghost repository">
                            <span class="pill-icon">🔍</span> Inspect Ghost repository
                        </button>
                    </div>
                </div>
            </div>
        `;

        const pills = chatLog.querySelectorAll('.quick-action-pill');
        pills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.preventDefault();
                const prompt = pill.getAttribute('data-prompt');
                if (prompt) {
                    if (prompt === 'Open Workspace') {
                        if (navPersonalCoreBtn) navPersonalCoreBtn.click();
                        return;
                    }
                    if (prompt === 'Inspect Ghost repository') {
                        if (navInspectRepoBtn) navInspectRepoBtn.click();
                        return;
                    }
                    userInput.value = prompt;
                    userInput.focus();
                }
            });
        });
    }

    function updateInitialGreeting(name) {
        renderWelcomeCard(name);
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
        renderWelcomeCard('Guest');
    }

    function hideVisitorGate() {
        if (visitorGateOverlay) visitorGateOverlay.style.display = 'none';
    }
    function showLoginOverlay() {
        if (loginOverlay) {
            loginOverlay.style.display = 'flex';
            loginOverlay.style.opacity = '1';
            loginOverlay.style.visibility = 'visible';
            if (authInput) {
                authInput.value = '';
                authInput.focus();
            }
        }
    }
    function hideLoginOverlay() {
        if (loginOverlay) {
            loginOverlay.style.display = 'none';
            loginOverlay.style.opacity = '0';
            loginOverlay.style.visibility = 'hidden';
        }
    }
    function getStoredOwnerName() {
        try {
            return (localStorage.getItem('ghost_owner_display_name') || '').trim();
        } catch (e) {
            return '';
        }
    }
    function saveOwnerName(name) {
        if (!name || typeof name !== 'string') return;
        const clean = name.trim().replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 40);
        if (clean) {
            try {
                localStorage.setItem('ghost_owner_display_name', clean);
            } catch (e) {}
        }
    }
    function showOwnerError(msg) {
        const errEl = document.getElementById('ownerAuthError');
        if (errEl) {
            errEl.innerText = msg;
            errEl.style.display = 'block';
        }
    }
    function clearOwnerError() {
        const errEl = document.getElementById('ownerAuthError');
        if (errEl) {
            errEl.innerText = '';
            errEl.style.display = 'none';
        }
    }
    function setOwnerHeader(name) {
        const displayName = capitalizeName(name) || 'Manoj';
        if (userTag) { userTag.innerText = displayName.toUpperCase(); userTag.style.color = 'var(--accent-primary)'; }
        if (userRoleBadge) userRoleBadge.innerText = '· Private local workspace';
        if (headerUnlockBtn) headerUnlockBtn.style.display = 'none';
        const inspectBtn = document.getElementById('inspectRepoBtn');
        if (inspectBtn) inspectBtn.style.display = 'inline-flex';
        const planBtn = document.getElementById('planDiffBtn');
        if (planBtn) planBtn.style.display = 'inline-flex';
        const personalBtn = document.getElementById('personalCoreBtn');
        if (personalBtn) personalBtn.style.display = 'inline-flex';
        const ccBtn = document.getElementById('controlCenterBtn');
        if (ccBtn) ccBtn.style.display = '';
        const capStatusBtn = document.getElementById('capabilityStatusBtn');
        if (capStatusBtn) capStatusBtn.style.display = '';
        const guidedShortcuts = document.getElementById('guidedComposerShortcuts');
        if (guidedShortcuts) guidedShortcuts.style.display = 'flex';
        if (ghostCodeStatus) {
            ghostCodeStatus.innerText = isGhostCodeActive ? "Ghost Code · Ready to draft a plan" : "Ghost Code · Off";
        }
    }
    function setVisitorHeader(visitorName) {
        const displayName = visitorName ? capitalizeName(visitorName) : 'GUEST';
        if (userTag) { userTag.innerText = displayName.toUpperCase(); userTag.style.color = ''; }
        if (userRoleBadge) userRoleBadge.innerText = '· Visitor';
        if (headerUnlockBtn) headerUnlockBtn.style.display = '';
        const inspectBtn = document.getElementById('inspectRepoBtn');
        if (inspectBtn) inspectBtn.style.display = 'none';
        const planBtn = document.getElementById('planDiffBtn');
        if (planBtn) planBtn.style.display = 'none';
        const personalBtn = document.getElementById('personalCoreBtn');
        if (personalBtn) personalBtn.style.display = 'none';
        const personalModal = document.getElementById('personalCoreModal');
        if (personalModal) personalModal.style.display = 'none';
        const ccBtn = document.getElementById('controlCenterBtn');
        if (ccBtn) ccBtn.style.display = 'none';
        const ccModal = document.getElementById('controlCenterModal');
        if (ccModal) ccModal.style.display = 'none';
        const capStatusBtn = document.getElementById('capabilityStatusBtn');
        if (capStatusBtn) capStatusBtn.style.display = 'none';
        const capStatusModal = document.getElementById('capabilityStatusModal');
        if (capStatusModal) capStatusModal.style.display = 'none';
        const guidedShortcuts = document.getElementById('guidedComposerShortcuts');
        if (guidedShortcuts) guidedShortcuts.style.display = 'none';
        currentSelectedTestKey = null;
        if (ghostCodeStatus) ghostCodeStatus.innerText = "Private workspace · Owner unlock required";
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
                isAdminMode = true;
                hideVisitorGate();
                hideLoginOverlay();
                const storedOwner = getStoredOwnerName();
                masterUser = storedOwner || capitalizeName(data.user || "Manoj");
                saveOwnerName(masterUser);
                setOwnerHeader(masterUser);
                appLayout.classList.add('active');
                updateInitialGreeting(masterUser);
                console.log('[Auth] Persistent session verified via HTTP-only cookie.');
            } else {
                masterUser = "Guest";
                isAdminMode = false;
                hideLoginOverlay();
                if (true) {
                    if (visitorGateOverlay) visitorGateOverlay.style.display = '';
                } else {
                    hideVisitorGate();
                    appLayout.classList.add('active');
                }
                setVisitorHeader();
            }
        } catch (e) {
            console.warn('[Auth] Persistent verification error:', e.message);
            masterUser = "Guest";
            isAdminMode = false;
            hideLoginOverlay();
            if (true) {
                if (visitorGateOverlay) visitorGateOverlay.style.display = '';
            } else {
                hideVisitorGate();
                appLayout.classList.add('active');
            }
            setVisitorHeader();
        }
    }
    checkPersistentAuth();

    // --- VISITOR GATE & UNLOCK WIRING (localhost only) ---
    function showOwnerAuthPrompt() {
        hideVisitorGate();
        if (visitorModal) visitorModal.style.display = 'none';
        storedClearanceKey = '';
        clearOwnerError();
        if (authInput) {
            authInput.value = '';
            authInput.placeholder = 'Enter clearance key...';
        }
        const loginSub = document.querySelector('#loginOverlay .login-sub');
        if (loginSub) loginSub.innerText = 'Owner Access';
        showLoginOverlay();
        if (authInput) authInput.focus();
    }

    if (showUnlockBtn) {
        showUnlockBtn.addEventListener('click', showOwnerAuthPrompt);
    }
    if (backToVisitorBtn) {
        backToVisitorBtn.addEventListener('click', () => {
            clearOwnerError();
            hideLoginOverlay();
            if (visitorGateOverlay) visitorGateOverlay.style.display = '';
        });
    }
    let greetingSent = false;
    async function submitVisitorForm() {
        const name = visitorNameInput ? visitorNameInput.value.trim().replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 40) : '';
        masterUser = capitalizeName(name) || 'Guest';
        try {
            await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name: masterUser, user: masterUser })
            });
        } catch (e) {
            console.error(e);
        }
        isAdminMode = false;
        hideVisitorGate();
        hideLoginOverlay();
        setVisitorHeader(masterUser);
        appLayout.classList.add('active');
        
        if (!greetingSent) {
            greetingSent = true;
            appendMessage('assistant', `Hi ${masterUser}, I'm Ghost — an autonomous AI agent platform built by Mathangi Manoj Kumar, a CS graduate (Chalapathi Institute of Engineering and Technology, 2026) focused on reliable, evidence-verified AI systems. He built me with a full plan-execute-verify-recover loop, multi-provider LLM routing, browser automation, and safety infrastructure like kill-switches and budget caps. He also built a real-time edge-vision vehicle detection system with 91.7% mAP, and a SAP S/4HANA knowledge assistant. He's AWS Academy and SAP Certified Associate certified. Ask me anything, or check out his work at github.com/Manojkumar7671.`);
        }
    }
    const visitorForm = document.getElementById('visitorForm');
    if (visitorForm) {
        visitorForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitVisitorForm();
        });
    }
    if (visitorContinueBtn) {
        visitorContinueBtn.addEventListener('click', submitVisitorForm);
    }
    if (headerUnlockBtn) {
        headerUnlockBtn.addEventListener('click', showOwnerAuthPrompt);
    }
    if (visitorModalUnlockBtn) {
        visitorModalUnlockBtn.addEventListener('click', showOwnerAuthPrompt);
    }
    if (visitorModalCloseBtn) {
        visitorModalCloseBtn.addEventListener('click', () => {
            if (visitorModal) visitorModal.style.display = 'none';
        });
    }

    // --- REPO INSPECTOR HANDLER & CARD RENDERER ---
    const inspectRepoBtn = document.getElementById('inspectRepoBtn');

    function renderRepoMapCard(data) {
        if (!chatLog) return;

        const cardContainer = document.createElement('div');
        cardContainer.className = 'chat-bubble assistant-message repo-map-card-wrapper';

        const card = document.createElement('div');
        card.className = 'repo-map-card';

        // 1. Header & ID
        const headerDiv = document.createElement('div');
        headerDiv.className = 'repo-card-header';

        const titleEl = document.createElement('h3');
        titleEl.textContent = `Repo Map: ${data.repository ? data.repository.name : 'Ghost'}`;
        titleEl.style.margin = '0 0 4px 0';
        titleEl.style.color = '#f8fafc';
        headerDiv.appendChild(titleEl);

        const subEl = document.createElement('div');
        subEl.style.fontSize = '11px';
        subEl.style.color = '#94a3b8';
        subEl.textContent = `Inspection ID: ${data.repository ? data.repository.inspectionId : 'N/A'} • Inspected: ${data.repository && data.repository.inspectedAt ? new Date(data.repository.inspectedAt).toLocaleTimeString() : 'now'}`;
        headerDiv.appendChild(subEl);

        if (data.repository && data.repository.isBoundedPartial) {
            const boundedBadge = document.createElement('div');
            boundedBadge.className = 'bounded-badge';
            boundedBadge.style.margin = '8px 0 0 0';
            boundedBadge.style.padding = '4px 8px';
            boundedBadge.style.background = 'rgba(234, 179, 8, 0.15)';
            boundedBadge.style.border = '1px solid rgba(234, 179, 8, 0.3)';
            boundedBadge.style.borderRadius = '4px';
            boundedBadge.style.color = '#fef08a';
            boundedBadge.style.fontSize = '11px';
            boundedBadge.style.fontWeight = '600';
            boundedBadge.textContent = `⚠️ Bounded Partial Inspection: ${data.repository.limitReason || 'Limit reached'}`;
            headerDiv.appendChild(boundedBadge);
        }
        card.appendChild(headerDiv);

        // 2. Summary Grid
        const summaryGrid = document.createElement('div');
        summaryGrid.style.display = 'grid';
        summaryGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
        summaryGrid.style.gap = '8px';
        summaryGrid.style.margin = '12px 0';

        const stats = [
            { label: 'Total Files', val: data.summary ? data.summary.totalFiles : 0 },
            { label: 'Total Directories', val: data.summary ? data.summary.totalDirectories : 0 },
            { label: 'Total Size', val: data.summary ? `${(data.summary.totalBytes / 1024).toFixed(1)} KB` : '0 KB' },
            { label: 'Max Depth', val: data.summary ? data.summary.maxDepthReached : 0 }
        ];

        stats.forEach(st => {
            const statBox = document.createElement('div');
            statBox.style.background = 'rgba(255, 255, 255, 0.04)';
            statBox.style.padding = '8px';
            statBox.style.borderRadius = '6px';
            statBox.style.border = '1px solid rgba(255, 255, 255, 0.08)';

            const lbl = document.createElement('div');
            lbl.style.fontSize = '10px';
            lbl.style.color = '#94a3b8';
            lbl.style.textTransform = 'uppercase';
            lbl.textContent = st.label;

            const val = document.createElement('div');
            val.style.fontSize = '14px';
            val.style.fontWeight = '600';
            val.style.color = '#e2e8f0';
            val.textContent = String(st.val);

            statBox.appendChild(lbl);
            statBox.appendChild(val);
            summaryGrid.appendChild(statBox);
        });
        card.appendChild(summaryGrid);

        // 3. Entry Points
        if (Array.isArray(data.entryPoints) && data.entryPoints.length > 0) {
            const epSection = document.createElement('div');
            epSection.style.margin = '10px 0';

            const epTitle = document.createElement('div');
            epTitle.style.fontWeight = '600';
            epTitle.style.fontSize = '12px';
            epTitle.style.color = '#cbd5e1';
            epTitle.style.marginBottom = '4px';
            epTitle.textContent = 'Key Entry Points & Artifacts:';
            epSection.appendChild(epTitle);

            const epList = document.createElement('ul');
            epList.style.margin = '0';
            epList.style.paddingLeft = '18px';
            epList.style.fontSize = '12px';
            epList.style.color = '#94a3b8';

            data.entryPoints.forEach(ep => {
                const li = document.createElement('li');
                li.textContent = `${ep.path} [${ep.type}] — Source: ${ep.source}`;
                epList.appendChild(li);
            });
            epSection.appendChild(epList);
            card.appendChild(epSection);
        }

        // 4. Architecture Map
        if (data.architectureMap && typeof data.architectureMap === 'object') {
            const archSection = document.createElement('div');
            archSection.style.margin = '10px 0';

            const archTitle = document.createElement('div');
            archTitle.style.fontWeight = '600';
            archTitle.style.fontSize = '12px';
            archTitle.style.color = '#cbd5e1';
            archTitle.style.marginBottom = '4px';
            archTitle.textContent = 'Architecture Topography:';
            archSection.appendChild(archTitle);

            const archGrid = document.createElement('div');
            archGrid.style.display = 'flex';
            archGrid.style.flexWrap = 'wrap';
            archGrid.style.gap = '6px';

            Object.entries(data.architectureMap).forEach(([cat, counts]) => {
                const tag = document.createElement('span');
                tag.style.background = 'rgba(99, 102, 241, 0.12)';
                tag.style.border = '1px solid rgba(99, 102, 241, 0.25)';
                tag.style.borderRadius = '4px';
                tag.style.padding = '3px 8px';
                tag.style.fontSize = '11px';
                tag.style.color = '#a5b4fc';
                tag.textContent = `${cat}/ (${counts.fileCount} files, ${counts.dirCount} dirs)`;
                archGrid.appendChild(tag);
            });
            archSection.appendChild(archGrid);
            card.appendChild(archSection);
        }

        // 5. Evidence & Limits
        if (data.limitsAndEvidence) {
            const evSection = document.createElement('div');
            evSection.style.margin = '10px 0';
            evSection.style.fontSize = '11px';
            evSection.style.color = '#64748b';
            evSection.textContent = `Evidence: Processed ${data.limitsAndEvidence.actualFilesInspected} files, ${data.limitsAndEvidence.actualDirectoriesInspected} dirs (${(data.limitsAndEvidence.actualBytesProcessed / 1024).toFixed(1)} KB) in ${data.limitsAndEvidence.elapsedMs}ms. Excluded items: ${data.exclusions ? data.exclusions.excludedCount : 0}.`;
            card.appendChild(evSection);
        }

        // 6. Mandatory Notice Banner
        const noticeBanner = document.createElement('div');
        noticeBanner.className = 'notice-banner';
        noticeBanner.style.background = 'rgba(59, 130, 246, 0.1)';
        noticeBanner.style.borderLeft = '3px solid #3b82f6';
        noticeBanner.style.padding = '8px 12px';
        noticeBanner.style.marginTop = '12px';
        noticeBanner.style.borderRadius = '0 4px 4px 0';
        noticeBanner.style.fontWeight = '500';
        noticeBanner.style.color = '#60a5fa';
        noticeBanner.style.fontSize = '12px';
        noticeBanner.textContent = data.disclaimer || 'Read-only map — no commands, file changes, or tests were run.';
        card.appendChild(noticeBanner);

        cardContainer.appendChild(card);
        chatLog.appendChild(cardContainer);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    function renderRepoErrorCard(errMsg) {
        if (!chatLog) return;

        const cardContainer = document.createElement('div');
        cardContainer.className = 'chat-bubble assistant-message repo-map-card-wrapper';

        const card = document.createElement('div');
        card.className = 'repo-map-card';
        card.style.borderColor = 'rgba(239, 68, 68, 0.3)';

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Repo Inspection Failed';
        titleEl.style.margin = '0 0 6px 0';
        titleEl.style.color = '#fca5a5';
        card.appendChild(titleEl);

        const msgEl = document.createElement('div');
        msgEl.style.fontSize = '12px';
        msgEl.style.color = '#f87171';
        msgEl.textContent = String(errMsg);
        card.appendChild(msgEl);

        const noticeBanner = document.createElement('div');
        noticeBanner.style.background = 'rgba(239, 68, 68, 0.1)';
        noticeBanner.style.borderLeft = '3px solid #ef4444';
        noticeBanner.style.padding = '8px 12px';
        noticeBanner.style.marginTop = '12px';
        noticeBanner.style.borderRadius = '0 4px 4px 0';
        noticeBanner.style.fontWeight = '500';
        noticeBanner.style.color = '#fca5a5';
        noticeBanner.style.fontSize = '12px';
        noticeBanner.textContent = 'Read-only map — no commands, file changes, or tests were run.';
        card.appendChild(noticeBanner);

        cardContainer.appendChild(card);
        chatLog.appendChild(cardContainer);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    async function executeRepoInspect() {
        const btn = navInspectRepoBtn || inspectRepoBtn;
        if (btn && btn.disabled) return;
        if (btn) btn.disabled = true;

        try {
            const res = await fetch(apiUrl('/api/repo/inspect'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (data.success) {
                renderRepoMapCard(data);
            } else {
                renderRepoErrorCard(data.error || 'Inspection failed');
            }
        } catch (err) {
            renderRepoErrorCard(err.message || 'Network error during inspection');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    if (inspectRepoBtn) {
        inspectRepoBtn.addEventListener('click', executeRepoInspect);
    }

    // --- HERMES-INSPIRED PLAN/DIFF WORKER V1 (Read-Only Proposal Renderer) ---
    const planDiffBtn = document.getElementById('planDiffBtn');
    let isPlanModeActive = false;
    let currentPlanRequestId = 0;

    function resetPlanDiffButtonState() {
        isPlanModeActive = false;
        if (planDiffBtn) {
            planDiffBtn.classList.remove('armed');
            planDiffBtn.textContent = 'Draft a plan';
            planDiffBtn.disabled = false;
        }
        userInput.placeholder = 'Ask Ghost or enter command...';
    }

    function armOrTriggerPlanDraft() {
        if (!isAdminMode) {
            if (visitorModal) visitorModal.style.display = 'flex';
            return;
        }
        const currentInput = userInput.value.trim();
        if (currentInput) {
            // Composer already has text -> execute plan draft immediately with current text
            isPlanModeActive = false;
            resetPlanDiffButtonState();
            executePlanDraft(currentInput);
        } else {
            // Composer is empty -> toggle armed plan mode
            isPlanModeActive = !isPlanModeActive;
            if (isPlanModeActive) {
                if (planDiffBtn) {
                    planDiffBtn.classList.add('armed');
                    planDiffBtn.textContent = 'Drafting Plan (Active)';
                }
                userInput.placeholder = 'Enter coding task or roadmap to plan (Plan/Diff active)...';
                userInput.focus();
            } else {
                resetPlanDiffButtonState();
            }
        }
    }

    function renderPlanDraftCard(plan, currentTask) {
        if (!chatLog || !plan) return;

        const cardContainer = document.createElement('div');
        cardContainer.className = 'chat-bubble assistant-message plan-draft-card-wrapper';

        const card = document.createElement('div');
        card.className = 'plan-draft-card';
        card.style.background = 'rgba(15, 23, 42, 0.75)';
        card.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        card.style.borderRadius = '8px';
        card.style.padding = '16px';
        card.style.maxWidth = '850px';
        card.style.width = '100%';

        // 1. Header with Status Badge
        const headerDiv = document.createElement('div');
        headerDiv.className = 'plan-card-header';
        headerDiv.style.display = 'flex';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.alignItems = 'center';
        headerDiv.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
        headerDiv.style.paddingBottom = '8px';
        headerDiv.style.marginBottom = '12px';

        const titleEl = document.createElement('h3');
        titleEl.textContent = '📋 Ghost Plan/Diff Proposal (V1)';
        titleEl.style.margin = '0';
        titleEl.style.fontSize = '14px';
        titleEl.style.color = '#f8fafc';
        headerDiv.appendChild(titleEl);

        const badgeEl = document.createElement('span');
        badgeEl.className = 'plan-status-badge';
        badgeEl.style.background = 'rgba(234, 179, 8, 0.15)';
        badgeEl.style.border = '1px solid rgba(234, 179, 8, 0.3)';
        badgeEl.style.color = '#facc15';
        badgeEl.style.borderRadius = '4px';
        badgeEl.style.padding = '2px 8px';
        badgeEl.style.fontSize = '11px';
        badgeEl.style.fontWeight = '600';
        badgeEl.textContent = plan.status || 'PLAN ONLY';
        headerDiv.appendChild(badgeEl);
        card.appendChild(headerDiv);

        // 2. Fixed Safety Notice Banner
        const safetyBanner = document.createElement('div');
        safetyBanner.className = 'plan-safety-banner';
        safetyBanner.style.background = 'rgba(239, 68, 68, 0.12)';
        safetyBanner.style.borderLeft = '3px solid #ef4444';
        safetyBanner.style.padding = '8px 12px';
        safetyBanner.style.marginBottom = '14px';
        safetyBanner.style.borderRadius = '0 4px 4px 0';
        safetyBanner.style.fontWeight = '600';
        safetyBanner.style.color = '#fca5a5';
        safetyBanner.style.fontSize = '12px';
        safetyBanner.textContent = plan.safetyNotice || 'PLAN ONLY — NO FILES CHANGED — NO COMMANDS EXECUTED — APPROVAL REQUIRED FOR ANY FUTURE EDIT OR TEST';
        card.appendChild(safetyBanner);

        // 3. Task Interpretation
        const displayedTask = plan.requestedTask || currentTask || plan.taskSummary;
        if (displayedTask) {
            const summaryDiv = document.createElement('div');
            summaryDiv.className = 'plan-summary-block';
            summaryDiv.style.marginBottom = '12px';
            summaryDiv.style.fontSize = '13px';
            summaryDiv.style.color = '#e2e8f0';
            summaryDiv.style.lineHeight = '1.5';
            summaryDiv.textContent = `Task: ${displayedTask}`;
            card.appendChild(summaryDiv);
        }

        // 3b. Approved Personal Core Context (distinct section)
        if (plan.approvedPersonalContext) {
            const ctxSec = document.createElement('div');
            ctxSec.className = 'plan-personal-context-block';
            ctxSec.style.background = 'rgba(99, 102, 241, 0.08)';
            ctxSec.style.border = '1px solid rgba(99, 102, 241, 0.2)';
            ctxSec.style.borderRadius = '6px';
            ctxSec.style.padding = '10px 12px';
            ctxSec.style.marginBottom = '12px';

            const ctxHeader = document.createElement('div');
            ctxHeader.style.display = 'flex';
            ctxHeader.style.alignItems = 'center';
            ctxHeader.style.gap = '6px';
            ctxHeader.style.marginBottom = '6px';

            const ctxTitle = document.createElement('span');
            ctxTitle.style.fontSize = '12px';
            ctxTitle.style.fontWeight = '600';
            ctxTitle.style.color = '#a5b4fc';
            ctxTitle.textContent = '👤 Approved Personal Core Context:';
            ctxHeader.appendChild(ctxTitle);
            ctxSec.appendChild(ctxHeader);

            const ctxContent = document.createElement('pre');
            ctxContent.style.margin = '0';
            ctxContent.style.fontFamily = 'var(--font-mono, monospace)';
            ctxContent.style.fontSize = '11px';
            ctxContent.style.color = '#c7d2fe';
            ctxContent.style.whiteSpace = 'pre-wrap';
            ctxContent.style.lineHeight = '1.4';
            ctxContent.textContent = plan.approvedPersonalContext;
            ctxSec.appendChild(ctxContent);

            card.appendChild(ctxSec);
        }

        // 4. Assumptions & Constraints
        if (Array.isArray(plan.assumptions) && plan.assumptions.length > 0) {
            const asmSec = document.createElement('div');
            asmSec.style.marginBottom = '12px';

            const asmTitle = document.createElement('div');
            asmTitle.style.fontSize = '12px';
            asmTitle.style.fontWeight = '600';
            asmTitle.style.color = '#94a3b8';
            asmTitle.style.marginBottom = '4px';
            asmTitle.textContent = 'Assumptions & Constraints:';
            asmSec.appendChild(asmTitle);

            const asmList = document.createElement('ul');
            asmList.style.margin = '0';
            asmList.style.paddingLeft = '20px';
            asmList.style.fontSize = '12px';
            asmList.style.color = '#cbd5e1';
            plan.assumptions.forEach(a => {
                const li = document.createElement('li');
                li.textContent = a;
                asmList.appendChild(li);
            });
            asmSec.appendChild(asmList);
            card.appendChild(asmSec);
        }

        // 5. Implementation Steps
        if (Array.isArray(plan.planSteps) && plan.planSteps.length > 0) {
            const stepSec = document.createElement('div');
            stepSec.style.marginBottom = '14px';

            const stepTitle = document.createElement('div');
            stepTitle.style.fontSize = '12px';
            stepTitle.style.fontWeight = '600';
            stepTitle.style.color = '#94a3b8';
            stepTitle.style.marginBottom = '4px';
            stepTitle.textContent = 'Implementation Steps:';
            stepSec.appendChild(stepTitle);

            const stepList = document.createElement('ol');
            stepList.style.margin = '0';
            stepList.style.paddingLeft = '20px';
            stepList.style.fontSize = '12px';
            stepList.style.color = '#cbd5e1';
            plan.planSteps.forEach(s => {
                const li = document.createElement('li');
                li.textContent = s;
                stepList.appendChild(li);
            });
            stepSec.appendChild(stepList);
            card.appendChild(stepSec);
        }

        // 6. Proposed File Changes & Diffs
        if (Array.isArray(plan.proposedFiles) && plan.proposedFiles.length > 0) {
            const filesSec = document.createElement('div');
            filesSec.style.marginBottom = '14px';

            const filesTitle = document.createElement('div');
            filesTitle.style.fontSize = '12px';
            filesTitle.style.fontWeight = '600';
            filesTitle.style.color = '#94a3b8';
            filesTitle.style.marginBottom = '6px';
            filesTitle.textContent = 'Proposed File Changes (Diff Preview):';
            filesSec.appendChild(filesTitle);

            plan.proposedFiles.forEach(file => {
                const fileBox = document.createElement('div');
                fileBox.className = 'proposed-file-box';
                fileBox.style.background = 'rgba(10, 15, 29, 0.7)';
                fileBox.style.border = '1px solid rgba(255, 255, 255, 0.08)';
                fileBox.style.borderRadius = '6px';
                fileBox.style.padding = '10px';
                fileBox.style.marginBottom = '8px';

                const fileHeader = document.createElement('div');
                fileHeader.style.display = 'flex';
                fileHeader.style.justifyContent = 'space-between';
                fileHeader.style.alignItems = 'center';
                fileHeader.style.marginBottom = '6px';

                const filePath = document.createElement('span');
                filePath.style.fontFamily = 'monospace';
                filePath.style.fontSize = '12px';
                filePath.style.color = '#38bdf8';
                filePath.textContent = file.path;
                fileHeader.appendChild(filePath);

                const statusTag = document.createElement('span');
                statusTag.style.fontSize = '10px';
                statusTag.style.padding = '2px 6px';
                statusTag.style.borderRadius = '3px';
                if (file.pathStatus === 'verified path') {
                    statusTag.style.background = 'rgba(34, 197, 94, 0.15)';
                    statusTag.style.color = '#4ade80';
                    statusTag.textContent = 'verified path';
                } else {
                    statusTag.style.background = 'rgba(148, 163, 184, 0.15)';
                    statusTag.style.color = '#94a3b8';
                    statusTag.textContent = 'suggested path — not verified';
                }
                fileHeader.appendChild(statusTag);
                fileBox.appendChild(fileHeader);

                if (file.reason) {
                    const reasonP = document.createElement('div');
                    reasonP.style.fontSize = '11px';
                    reasonP.style.color = '#94a3b8';
                    reasonP.style.marginBottom = '6px';
                    reasonP.textContent = `Reason: ${file.reason}`;
                    fileBox.appendChild(reasonP);
                }

                if (file.preview) {
                    const pre = document.createElement('pre');
                    pre.className = 'diff-preview-block';
                    pre.style.background = '#050811';
                    pre.style.border = '1px solid rgba(255, 255, 255, 0.05)';
                    pre.style.borderRadius = '4px';
                    pre.style.padding = '8px';
                    pre.style.fontSize = '11px';
                    pre.style.fontFamily = 'monospace';
                    pre.style.overflowX = 'auto';
                    pre.style.color = '#cbd5e1';
                    pre.style.whiteSpace = 'pre-wrap';
                    pre.textContent = file.preview;
                    fileBox.appendChild(pre);
                }
                filesSec.appendChild(fileBox);
            });
            card.appendChild(filesSec);
        }

        // 7. Risks & Mitigations
        if (Array.isArray(plan.risks) && plan.risks.length > 0) {
            const riskSec = document.createElement('div');
            riskSec.style.marginBottom = '12px';

            const riskTitle = document.createElement('div');
            riskTitle.style.fontSize = '12px';
            riskTitle.style.fontWeight = '600';
            riskTitle.style.color = '#fbbf24';
            riskTitle.style.marginBottom = '4px';
            riskTitle.textContent = 'Risks & Mitigations:';
            riskSec.appendChild(riskTitle);

            const riskList = document.createElement('ul');
            riskList.style.margin = '0';
            riskList.style.paddingLeft = '20px';
            riskList.style.fontSize = '12px';
            riskList.style.color = '#fef3c7';
            plan.risks.forEach(r => {
                const li = document.createElement('li');
                li.textContent = r;
                riskList.appendChild(li);
            });
            riskSec.appendChild(riskList);
            card.appendChild(riskSec);
        }

        // 8. Static Disclaimer Footer
        const disclaimerBanner = document.createElement('div');
        disclaimerBanner.className = 'plan-disclaimer-banner';
        disclaimerBanner.style.background = 'rgba(59, 130, 246, 0.08)';
        disclaimerBanner.style.borderLeft = '3px solid #3b82f6';
        disclaimerBanner.style.padding = '8px 12px';
        disclaimerBanner.style.marginTop = '12px';
        disclaimerBanner.style.borderRadius = '0 4px 4px 0';
        disclaimerBanner.style.color = '#93c5fd';
        disclaimerBanner.style.fontSize = '11px';
        disclaimerBanner.style.lineHeight = '1.4';
        disclaimerBanner.textContent = plan.disclaimer || 'Future edits and tests will require a separate, explicit owner approval workflow. This draft did not perform any action.';
        card.appendChild(disclaimerBanner);

        cardContainer.appendChild(card);
        chatLog.appendChild(cardContainer);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    async function executePlanDraft(taskPrompt) {
        if (!isAdminMode) {
            if (visitorModal) visitorModal.style.display = 'flex';
            return;
        }
        const prompt = (taskPrompt || '').trim();
        if (!prompt) return;

        currentPlanRequestId++;
        const requestId = currentPlanRequestId;

        appendMessage('user', `[Plan/Diff Request]: ${prompt}`);
        userInput.value = "";
        userInput.disabled = true;
        sendBtn.disabled = true;
        if (planDiffBtn) planDiffBtn.disabled = true;
        thinkingIndicator.classList.add('active');

        try {
            const res = await fetch(apiUrl('/api/plan/draft'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ task: prompt, requestId })
            });
            const data = await res.json();
            thinkingIndicator.classList.remove('active');

            // Stale response / race check
            if (requestId !== currentPlanRequestId) {
                console.warn(`[PlanDiff] Discarding stale plan response for request #${requestId} (active is #${currentPlanRequestId})`);
                return;
            }

            if (data.success) {
                renderPlanDraftCard(data, prompt);
            } else {
                appendMessage('ghost', data.error || "Failed to generate plan draft. Please try again.");
            }
        } catch (err) {
            thinkingIndicator.classList.remove('active');
            if (requestId === currentPlanRequestId) {
                appendMessage('ghost', `Plan draft error: ${err.message || 'Network failure'}`);
            }
        } finally {
            userInput.disabled = false;
            sendBtn.disabled = false;
            resetPlanDiffButtonState();
            userInput.focus();
        }
    }

    // Alias for backwards compatibility
    function triggerPlanDraft(customPrompt) {
        if (customPrompt && typeof customPrompt === 'string' && customPrompt.trim()) {
            executePlanDraft(customPrompt.trim());
        } else {
            armOrTriggerPlanDraft();
        }
    }

    if (planDiffBtn) {
        planDiffBtn.addEventListener('click', () => {
            armOrTriggerPlanDraft();
        });
    }

    // --- PERSONAL CORE V1 (Owner Memory, Goals, Continuity) ---
    const personalCoreBtn = document.getElementById('personalCoreBtn');
    const personalCoreModal = document.getElementById('personalCoreModal');
    const personalCoreCloseBtn = document.getElementById('personalCoreCloseBtn');
    const personalCoreNotice = document.getElementById('personalCoreNotice');

    const tabContinueBtn = document.getElementById('tabContinueBtn');
    const tabTasksBtn = document.getElementById('tabTasksBtn');
    const tabRememberBtn = document.getElementById('tabRememberBtn');
    const tabGoalsBtn = document.getElementById('tabGoalsBtn');
    const tabMemoriesBtn = document.getElementById('tabMemoriesBtn');
    const tabSkillsBtn = document.getElementById('tabSkillsBtn');

    const tabContentContinue = document.getElementById('tabContentContinue');
    const tabContentTasks = document.getElementById('tabContentTasks');
    const tabContentRemember = document.getElementById('tabContentRemember');
    const tabContentGoals = document.getElementById('tabContentGoals');
    const tabContentMemories = document.getElementById('tabContentMemories');
    const tabContentSkills = document.getElementById('tabContentSkills');
    const skillsListContainer = document.getElementById('skillsListContainer');

    const continuitySummaryText = document.getElementById('continuitySummaryText');
    const refreshContinueBtn = document.getElementById('refreshContinueBtn');

    // Task Ledger Elements
    const createTaskForm = document.getElementById('createTaskForm');
    const taskTitleInput = document.getElementById('taskTitleInput');
    const taskGoalSelect = document.getElementById('taskGoalSelect');
    const taskDescInput = document.getElementById('taskDescInput');
    const tasksListContainer = document.getElementById('tasksListContainer');
    const tasksCountBadge = document.getElementById('tasksCountBadge');
    const taskDetailSection = document.getElementById('taskDetailSection');
    const detailTaskTitle = document.getElementById('detailTaskTitle');
    const detailTaskStatus = document.getElementById('detailTaskStatus');
    const detailTaskGoalRow = document.getElementById('detailTaskGoalRow');
    const detailTaskGoal = document.getElementById('detailTaskGoal');
    const detailTaskDescRow = document.getElementById('detailTaskDescRow');
    const detailTaskDesc = document.getElementById('detailTaskDesc');
    const detailTaskBlockerRow = document.getElementById('detailTaskBlockerRow');
    const detailTaskBlocker = document.getElementById('detailTaskBlocker');
    const btnMarkPlanned = document.getElementById('btnMarkPlanned');
    const btnMarkBlocked = document.getElementById('btnMarkBlocked');
    const btnMarkCancelled = document.getElementById('btnMarkCancelled');
    const blockerInputRow = document.getElementById('blockerInputRow');
    const blockerReasonInput = document.getElementById('blockerReasonInput');
    const btnConfirmBlocker = document.getElementById('btnConfirmBlocker');
    const btnCancelBlockerInput = document.getElementById('btnCancelBlockerInput');
    const taskLedgerEventsList = document.getElementById('taskLedgerEventsList');

    const btnAskTaskAgent = document.getElementById('btnAskTaskAgent');
    const taskAgentStatusNote = document.getElementById('taskAgentStatusNote');
    const taskAgentProposalContainer = document.getElementById('taskAgentProposalContainer');

    const btnPrepareApprovalContract = document.getElementById('btnPrepareApprovalContract');
    const approvalContractStatusNote = document.getElementById('approvalContractStatusNote');
    const approvalContractContainer = document.getElementById('approvalContractContainer');

    const btnPreparePatchDraft = document.getElementById('btnPreparePatchDraft');
    const patchDraftStatusNote = document.getElementById('patchDraftStatusNote');
    const patchDraftContainer = document.getElementById('patchDraftContainer');

    let cachedTasks = [];
    let selectedTaskId = null;
    let isTaskAgentInFlight = false;
    let currentTaskAgentRequestId = 0;

    const saveMemoryForm = document.getElementById('saveMemoryForm');
    const memoryInputText = document.getElementById('memoryInputText');
    const memoryCharCount = document.getElementById('memoryCharCount');

    const createGoalForm = document.getElementById('createGoalForm');
    const goalTitleInput = document.getElementById('goalTitleInput');
    const goalStatusSelect = document.getElementById('goalStatusSelect');
    const goalNoteInput = document.getElementById('goalNoteInput');
    const goalsListContainer = document.getElementById('goalsListContainer');
    const goalsCountBadge = document.getElementById('goalsCountBadge');

    const memoriesListContainer = document.getElementById('memoriesListContainer');

    function showPersonalNotice(message, isError = false) {
        if (!personalCoreNotice) return;
        personalCoreNotice.textContent = message;
        personalCoreNotice.className = isError ? 'personal-core-notice error' : 'personal-core-notice success';
        personalCoreNotice.style.display = 'block';
        setTimeout(() => {
            if (personalCoreNotice) personalCoreNotice.style.display = 'none';
        }, 6000);
    }

    function switchPersonalTab(tabName) {
        const tabs = [
            { name: 'continue', btn: tabContinueBtn, panel: tabContentContinue },
            { name: 'tasks', btn: tabTasksBtn, panel: tabContentTasks },
            { name: 'remember', btn: tabRememberBtn, panel: tabContentRemember },
            { name: 'goals', btn: tabGoalsBtn, panel: tabContentGoals },
            { name: 'memories', btn: tabMemoriesBtn, panel: tabContentMemories },
            { name: 'skills', btn: tabSkillsBtn, panel: tabContentSkills }
        ];

        tabs.forEach(t => {
            if (t.btn && t.panel) {
                const isActive = t.name === tabName;
                t.btn.classList.toggle('active', isActive);
                t.btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
                t.panel.style.display = isActive ? 'block' : 'none';
                t.panel.classList.toggle('active', isActive);
                if (isActive && t.name === 'skills') loadSkillsV0();
            }
        });
    }

    async function loadPersonalOverview() {
        if (!continuitySummaryText) return;
        continuitySummaryText.textContent = 'Loading continuity context...';

        try {
            const res = await fetch(apiUrl('/api/personal/overview'), {
                method: 'GET',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success) {
                continuitySummaryText.textContent = data.continuationSummary || 'No saved context yet.';
                renderGoalsList(data.goals || []);
                renderMemoriesList(data.recentMemories || []);
                if (Array.isArray(data.tasks)) {
                    cachedTasks = data.tasks;
                    renderTasksList(data.tasks);
                }
            } else {
                continuitySummaryText.textContent = 'Unable to load Personal Core overview.';
            }
        } catch (err) {
            continuitySummaryText.textContent = `Error loading overview: ${err.message}`;
        }
    }

    async function loadGoals() {
        if (!goalsListContainer) return;
        try {
            const res = await fetch(apiUrl('/api/personal/goals'), {
                method: 'GET',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success) {
                renderGoalsList(data.goals || []);
            }
        } catch (err) {
            console.warn('[PersonalCore] Error loading goals:', err.message);
        }
    }

    function renderGoalsList(goals) {
        if (!goalsListContainer) return;
        goalsListContainer.innerHTML = '';
        if (goalsCountBadge) goalsCountBadge.textContent = String(goals.length);

        if (!goals || goals.length === 0) {
            goalsListContainer.innerHTML = '<div class="empty-state">No goals created yet. Add a goal above to track your work.</div>';
            return;
        }

        goals.forEach(goal => {
            const item = document.createElement('div');
            item.className = `personal-item goal-item status-${goal.status || 'active'}`;

            const info = document.createElement('div');
            info.className = 'goal-info';

            const titleRow = document.createElement('div');
            titleRow.className = 'goal-title-row';

            const title = document.createElement('span');
            title.className = 'goal-title';
            title.textContent = goal.title;
            titleRow.appendChild(title);

            const statusTag = document.createElement('span');
            statusTag.className = `status-tag ${goal.status}`;
            statusTag.textContent = goal.status;
            titleRow.appendChild(statusTag);

            info.appendChild(titleRow);

            if (goal.note) {
                const note = document.createElement('div');
                note.className = 'goal-note';
                note.textContent = goal.note;
                info.appendChild(note);
            }

            const date = document.createElement('div');
            date.className = 'item-date';
            date.textContent = `Created: ${new Date(goal.createdAt).toLocaleDateString()} ${new Date(goal.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            info.appendChild(date);

            item.appendChild(info);

            const actions = document.createElement('div');
            actions.className = 'item-actions';

            // Status changer select
            const statusSelect = document.createElement('select');
            statusSelect.className = 'personal-select status-select-mini';
            ['active', 'paused', 'done'].forEach(st => {
                const opt = document.createElement('option');
                opt.value = st;
                opt.textContent = st.charAt(0).toUpperCase() + st.slice(1);
                if (st === goal.status) opt.selected = true;
                statusSelect.appendChild(opt);
            });
            statusSelect.addEventListener('change', async () => {
                await updateGoalStatus(goal.id, statusSelect.value);
            });
            actions.appendChild(statusSelect);

            // Delete button
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-delete-item';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete goal';
            delBtn.addEventListener('click', async () => {
                await deleteGoalItem(goal.id);
            });
            actions.appendChild(delBtn);

            item.appendChild(actions);
            goalsListContainer.appendChild(item);
        });
    }

    async function updateGoalStatus(goalId, newStatus) {
        try {
            const res = await fetch(apiUrl(`/api/personal/goals/${encodeURIComponent(goalId)}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ status: newStatus })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showPersonalNotice(`Goal status updated to ${newStatus}.`);
                loadGoals();
                loadPersonalOverview();
            } else {
                showPersonalNotice(data.error || 'Failed to update goal.', true);
            }
        } catch (err) {
            showPersonalNotice(`Error: ${err.message}`, true);
        }
    }

    async function deleteGoalItem(goalId) {
        try {
            const res = await fetch(apiUrl(`/api/personal/goals/${encodeURIComponent(goalId)}`), {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showPersonalNotice('Goal deleted.');
                loadGoals();
                loadPersonalOverview();
            } else {
                showPersonalNotice(data.error || 'Failed to delete goal.', true);
            }
        } catch (err) {
            showPersonalNotice(`Error: ${err.message}`, true);
        }
    }

    async function loadMemories() {
        if (!memoriesListContainer) return;
        try {
            const res = await fetch(apiUrl('/api/personal/memories'), {
                method: 'GET',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success) {
                renderMemoriesList(data.memories || []);
            }
        } catch (err) {
            console.warn('[PersonalCore] Error loading memories:', err.message);
        }
    }

    function renderMemoriesList(memories) {
        if (!memoriesListContainer) return;
        memoriesListContainer.innerHTML = '';

        if (!memories || memories.length === 0) {
            memoriesListContainer.innerHTML = '<div class="empty-state">No explicit memories saved yet. Use the Remember tab to save personal context.</div>';
            return;
        }

        memories.forEach(mem => {
            const item = document.createElement('div');
            item.className = 'personal-item memory-item';

            const info = document.createElement('div');
            info.className = 'memory-info';

            const text = document.createElement('div');
            text.className = 'memory-text';
            text.textContent = mem.text;
            info.appendChild(text);

            const date = document.createElement('div');
            date.className = 'item-date';
            date.textContent = `Saved: ${new Date(mem.createdAt).toLocaleDateString()} ${new Date(mem.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            info.appendChild(date);

            item.appendChild(info);

            const actions = document.createElement('div');
            actions.className = 'item-actions';

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-delete-item';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete memory';
            delBtn.addEventListener('click', async () => {
                await deleteMemoryItem(mem.id);
            });
            actions.appendChild(delBtn);

            item.appendChild(actions);
            memoriesListContainer.appendChild(item);
        });
    }

    async function deleteMemoryItem(memoryId) {
        try {
            const res = await fetch(apiUrl(`/api/personal/memories/${encodeURIComponent(memoryId)}`), {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showPersonalNotice('Memory deleted.');
                loadMemories();
                loadPersonalOverview();
            } else {
                showPersonalNotice(data.error || 'Failed to delete memory.', true);
            }
        } catch (err) {
            showPersonalNotice(`Error: ${err.message}`, true);
        }
    }

    if (personalCoreBtn) {
        personalCoreBtn.addEventListener('click', () => {
            if (!isAdminMode) {
                if (visitorModal) visitorModal.style.display = 'flex';
                return;
            }
            if (personalCoreModal) {
                personalCoreModal.style.display = 'flex';
                switchPersonalTab('continue');
                loadPersonalOverview();
            }
        });
    }

    if (personalCoreCloseBtn) {
        personalCoreCloseBtn.addEventListener('click', () => {
            if (personalCoreModal) personalCoreModal.style.display = 'none';
        });
    }

    // --- TASK LEDGER V1 (Owner-Visible Tasks & Immutable Activity Ledger) ---

    async function populateGoalSelect() {
        if (!taskGoalSelect) return;
        try {
            const res = await fetch(apiUrl('/api/personal/goals'), {
                method: 'GET',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success && Array.isArray(data.goals)) {
                taskGoalSelect.innerHTML = '<option value="">-- No linked goal --</option>';
                data.goals.forEach(g => {
                    const opt = document.createElement('option');
                    opt.value = g.id;
                    opt.textContent = `${g.title} (${g.status})`;
                    taskGoalSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.warn('[PersonalCore] Error populating goals for task creation:', err.message);
        }
    }

    async function loadTasks() {
        if (!tasksListContainer) return;
        try {
            const res = await fetch(apiUrl('/api/personal/tasks'), {
                method: 'GET',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success && Array.isArray(data.tasks)) {
                cachedTasks = data.tasks;
                renderTasksList(data.tasks);
                populateGoalSelect();
                if (selectedTaskId) {
                    const currentSelected = data.tasks.find(t => t.id === selectedTaskId);
                    if (currentSelected) {
                        showTaskDetail(currentSelected);
                    }
                }
            } else {
                tasksListContainer.innerHTML = '<div class="empty-state">Unable to load tasks.</div>';
            }
        } catch (err) {
            console.warn('[PersonalCore] Error loading tasks:', err.message);
            tasksListContainer.innerHTML = '<div class="empty-state">Error loading tasks.</div>';
        }
    }

    function renderTasksList(tasks) {
        if (!tasksListContainer) return;
        tasksListContainer.innerHTML = '';
        if (tasksCountBadge) tasksCountBadge.textContent = String(tasks.length);

        if (!tasks || tasks.length === 0) {
            tasksListContainer.innerHTML = '<div class="empty-state">No tasks created yet. Use the form above to queue owner work.</div>';
            if (taskDetailSection) taskDetailSection.style.display = 'none';
            return;
        }

        tasks.forEach(task => {
            const item = document.createElement('div');
            item.className = `personal-item task-item status-${task.status || 'pending'}`;
            if (task.id === selectedTaskId) {
                item.classList.add('selected');
            }

            const info = document.createElement('div');
            info.className = 'goal-info';

            const titleRow = document.createElement('div');
            titleRow.className = 'goal-title-row';

            const title = document.createElement('span');
            title.className = 'goal-title';
            title.textContent = task.title;
            titleRow.appendChild(title);

            const statusTag = document.createElement('span');
            statusTag.className = `status-tag ${task.status || 'pending'}`;
            statusTag.textContent = task.status || 'pending';
            titleRow.appendChild(statusTag);

            info.appendChild(titleRow);

            if (task.goalTitle) {
                const goalRow = document.createElement('div');
                goalRow.className = 'goal-note';
                goalRow.textContent = `🎯 Goal: ${task.goalTitle}`;
                info.appendChild(goalRow);
            }

            if (task.status === 'blocked' && task.blockerReason) {
                const blockerRow = document.createElement('div');
                blockerRow.className = 'goal-note';
                blockerRow.style.color = '#fca5a5';
                blockerRow.textContent = `⚠️ Blocker: ${task.blockerReason}`;
                info.appendChild(blockerRow);
            }

            const date = document.createElement('div');
            date.className = 'item-date';
            date.textContent = `Created: ${new Date(task.createdAt).toLocaleDateString()} ${new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            info.appendChild(date);

            item.appendChild(info);

            item.addEventListener('click', () => {
                selectedTaskId = task.id;
                document.querySelectorAll('.task-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                showTaskDetail(task);
            });

            tasksListContainer.appendChild(item);
        });

        // Automatically show detail for the first task if none selected or if selected is present
        if (!selectedTaskId && tasks.length > 0) {
            selectedTaskId = tasks[0].id;
            const firstEl = tasksListContainer.querySelector('.task-item');
            if (firstEl) firstEl.classList.add('selected');
            showTaskDetail(tasks[0]);
        }
    }

    function showTaskDetail(task) {
        if (!taskDetailSection || !task) return;
        taskDetailSection.style.display = 'block';

        if (detailTaskTitle) detailTaskTitle.textContent = task.title;
        if (detailTaskStatus) {
            detailTaskStatus.textContent = task.status || 'pending';
            detailTaskStatus.className = `status-tag ${task.status || 'pending'}`;
        }

        if (detailTaskGoalRow && detailTaskGoal) {
            if (task.goalTitle) {
                detailTaskGoal.textContent = task.goalTitle;
                detailTaskGoalRow.style.display = 'block';
            } else {
                detailTaskGoalRow.style.display = 'none';
            }
        }

        if (detailTaskDescRow && detailTaskDesc) {
            if (task.description) {
                detailTaskDesc.textContent = task.description;
                detailTaskDescRow.style.display = 'block';
            } else {
                detailTaskDescRow.style.display = 'none';
            }
        }

        if (detailTaskBlockerRow && detailTaskBlocker) {
            if (task.status === 'blocked' && task.blockerReason) {
                detailTaskBlocker.textContent = task.blockerReason;
                detailTaskBlockerRow.style.display = 'block';
            } else {
                detailTaskBlockerRow.style.display = 'none';
            }
        }

        if (blockerInputRow) blockerInputRow.style.display = 'none';
        if (blockerReasonInput) blockerReasonInput.value = '';

        // Reset and configure Agent V0 proposal controls
        currentTaskAgentRequestId++;
        if (taskAgentProposalContainer) {
            taskAgentProposalContainer.style.display = 'none';
            taskAgentProposalContainer.innerHTML = '';
        }

        const isEligible = ['pending', 'planned', 'blocked'].includes(task.status);
        if (btnAskTaskAgent) {
            btnAskTaskAgent.disabled = !isEligible || isTaskAgentInFlight;
            btnAskTaskAgent.textContent = 'Ask Ghost Agent';
        }
        if (taskAgentStatusNote) {
            if (!isEligible) {
                taskAgentStatusNote.textContent = `Tasks in '${task.status}' status are not eligible for Ghost Agent proposals.`;
                taskAgentStatusNote.style.display = 'block';
            } else {
                taskAgentStatusNote.style.display = 'none';
            }
        }

        // Configure Approval Contract V1 controls
        if (approvalContractContainer) {
            approvalContractContainer.style.display = 'none';
            approvalContractContainer.innerHTML = '';
        }
        if (approvalContractStatusNote) approvalContractStatusNote.style.display = 'none';
        if (btnPrepareApprovalContract) {
            btnPrepareApprovalContract.disabled = !isEligible;
        }

        // Configure Patch Draft/Review V1 controls
        if (currentVolatileDraftMaterial && currentVolatileDraftMaterial.taskId !== task.id) {
            currentVolatileDraftMaterial = null;
        }
        if (patchDraftContainer) {
            patchDraftContainer.style.display = 'none';
            patchDraftContainer.innerHTML = '';
        }
        if (patchDraftStatusNote) patchDraftStatusNote.style.display = 'none';
        if (btnPreparePatchDraft) {
            btnPreparePatchDraft.disabled = !isEligible;
        }

        loadApprovalContract(task.id);
        loadPatchDraft(task.id);
        loadTaskEvents(task.id);
    }

    function renderTaskAgentProposal(data) {
        if (!taskAgentProposalContainer || !data || !data.proposal) return;
        const p = data.proposal;
        const modeLabel = data.mode === 'fallback' ? '⚠️ Fallback Proposal' : '✨ Agent V0.1 Analysis';
        const modeClass = data.mode === 'fallback' ? 'fallback' : 'generated';
        const proposalId = p.proposalId || 'prop_active';
        const grounding = p.groundingStatement || data.groundingStatement || '';

        taskAgentProposalContainer.innerHTML = `
            <div class="task-agent-proposal-card" data-proposal-id="${escapeHtml(proposalId)}">
                <div class="agent-proposal-banner">
                    ${data.safetyNotice || "PROPOSAL ONLY — NO ACTIONS EXECUTED — NO SILENT LEARNING — OWNER APPROVAL REQUIRED FOR ANY FUTURE WORK"}
                </div>
                ${grounding ? `<div class="agent-grounding-statement">${escapeHtml(grounding)}</div>` : ''}
                <div class="agent-proposal-meta-row">
                    <span class="agent-mode-tag ${modeClass}">${modeLabel}</span>
                    <span class="agent-proposal-time">${new Date(p.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="agent-proposal-content">
                    <div class="agent-field-block">
                        <div class="agent-field-label">Selected Task</div>
                        <div class="agent-field-value"><strong>[${escapeHtml((p.selectedTask && p.selectedTask.status) || '')}]</strong> ${escapeHtml((p.selectedTask && p.selectedTask.title) || '')}</div>
                    </div>
                    <div class="agent-field-block">
                        <div class="agent-field-label">Linked Goal</div>
                        <div class="agent-field-value">${escapeHtml(p.currentGoal || 'No linked goal')}</div>
                    </div>
                    <div class="agent-field-block highlight-block">
                        <div class="agent-field-label">Proposed Next Action</div>
                        <div class="agent-field-value proposed-action-text">${escapeHtml(p.proposedNextAction || '')}</div>
                    </div>
                    <div class="agent-field-block">
                        <div class="agent-field-label">Reasoning Summary</div>
                        <div class="agent-field-value">${escapeHtml(p.reasoningSummary || '')}</div>
                    </div>
                    <div class="agent-field-block">
                        <div class="agent-field-label">Expected Evidence</div>
                        <div class="agent-field-value">${escapeHtml(p.expectedEvidence || '')}</div>
                    </div>
                    <div class="agent-field-block">
                        <div class="agent-field-label">Blocker Analysis</div>
                        <div class="agent-field-value">${escapeHtml(p.blocker || 'None identified from approved context')}</div>
                    </div>
                    <div class="agent-field-block">
                        <div class="agent-field-label">Future Approval Required</div>
                        <div class="agent-field-value"><strong>Required for any future execution</strong> (No actions were executed)</div>
                    </div>
                </div>

                <!-- Explicit Owner Feedback Box -->
                <div class="agent-feedback-box" id="agentFeedbackBox_${escapeHtml(proposalId)}">
                    <div class="feedback-prompt-label">Was this proposal useful?</div>
                    <div class="feedback-rating-group" role="radiogroup" aria-label="Proposal usefulness rating">
                        <button type="button" class="btn-feedback-rating" data-rating="helpful" data-proposal-id="${escapeHtml(proposalId)}">Helpful</button>
                        <button type="button" class="btn-feedback-rating" data-rating="too_vague" data-proposal-id="${escapeHtml(proposalId)}">Too vague</button>
                        <button type="button" class="btn-feedback-rating" data-rating="incorrect" data-proposal-id="${escapeHtml(proposalId)}">Incorrect</button>
                    </div>
                    <div class="feedback-note-row">
                        <input type="text" id="feedbackNoteInput_${escapeHtml(proposalId)}" class="personal-input flex-grow feedback-note-input" placeholder="Optional note (maximum 240 characters)" maxlength="240" />
                        <button type="button" class="btn-secondary-action btn-save-feedback" id="btnSaveFeedback_${escapeHtml(proposalId)}" data-proposal-id="${escapeHtml(proposalId)}">Save feedback</button>
                    </div>
                    <div class="feedback-policy-notice">
                        Only feedback you save is used to refine future Agent proposals. It never authorizes actions or changes tasks.
                    </div>
                    <div id="feedbackStatusMessage_${escapeHtml(proposalId)}" class="feedback-status-message" style="display: none;"></div>
                </div>

                <div class="agent-proposal-footer">
                    <em>${escapeHtml(data.disclaimer || "Future work will require a separate, explicit owner approval workflow. This proposal did not perform any action.")}</em>
                </div>
            </div>
        `;
        taskAgentProposalContainer.style.display = 'block';

        wireFeedbackControls(proposalId);
    }

    function wireFeedbackControls(proposalId) {
        const box = document.getElementById(`agentFeedbackBox_${proposalId}`);
        if (!box) return;

        let selectedRating = null;
        let isSavingFeedback = false;

        const ratingBtns = box.querySelectorAll('.btn-feedback-rating');
        const noteInput = document.getElementById(`feedbackNoteInput_${proposalId}`);
        const saveBtn = document.getElementById(`btnSaveFeedback_${proposalId}`);
        const statusMsg = document.getElementById(`feedbackStatusMessage_${proposalId}`);

        ratingBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (isSavingFeedback) return;
                ratingBtns.forEach(b => {
                    b.classList.remove('selected');
                    b.setAttribute('aria-checked', 'false');
                });
                btn.classList.add('selected');
                btn.setAttribute('aria-checked', 'true');
                selectedRating = btn.getAttribute('data-rating');
                if (statusMsg) statusMsg.style.display = 'none';
            });
        });

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                if (isSavingFeedback) return;

                if (!selectedRating) {
                    if (statusMsg) {
                        statusMsg.textContent = 'Please select a rating (Helpful, Too vague, or Incorrect) before saving.';
                        statusMsg.className = 'feedback-status-message error';
                        statusMsg.style.display = 'block';
                    }
                    return;
                }

                if (!selectedTaskId) return;

                isSavingFeedback = true;
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving...';
                if (statusMsg) {
                    statusMsg.textContent = 'Recording feedback in activity ledger...';
                    statusMsg.className = 'feedback-status-message';
                    statusMsg.style.display = 'block';
                }

                const note = noteInput ? noteInput.value.trim() : '';

                try {
                    const res = await fetch(apiUrl('/api/task-agent/feedback'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            taskId: selectedTaskId,
                            proposalId,
                            rating: selectedRating,
                            note
                        })
                    });
                    const data = await res.json();

                    if (res.ok && data.success) {
                        const displayRating = selectedRating === 'too_vague' ? 'Too vague' : (selectedRating === 'incorrect' ? 'Incorrect' : 'Helpful');
                        if (statusMsg) {
                            statusMsg.textContent = `✓ Feedback saved: ${displayRating}${note ? ` ("${note}")` : ''}.`;
                            statusMsg.className = 'feedback-status-message success';
                            statusMsg.style.display = 'block';
                        }
                        ratingBtns.forEach(b => b.disabled = true);
                        if (noteInput) noteInput.disabled = true;
                        saveBtn.style.display = 'none';

                        showPersonalNotice('Explicit proposal feedback saved and recorded in activity ledger.');
                        loadTaskEvents(selectedTaskId);
                    } else {
                        if (statusMsg) {
                            statusMsg.textContent = data.error || 'Failed to save feedback.';
                            statusMsg.className = 'feedback-status-message error';
                            statusMsg.style.display = 'block';
                        }
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Save feedback';
                        isSavingFeedback = false;
                    }
                } catch (err) {
                    if (statusMsg) {
                        statusMsg.textContent = `Error: ${err.message}`;
                        statusMsg.className = 'feedback-status-message error';
                        statusMsg.style.display = 'block';
                    }
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save feedback';
                    isSavingFeedback = false;
                }
            });
        }
    }

    async function loadTaskEvents(taskId) {
        if (!taskLedgerEventsList || !taskId) return;
        taskLedgerEventsList.innerHTML = '<div class="loading-state">Loading activity ledger...</div>';

        try {
            const res = await fetch(apiUrl(`/api/personal/tasks/${encodeURIComponent(taskId)}/events`), {
                method: 'GET',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success && Array.isArray(data.events)) {
                renderTaskEventsList(data.events);
            } else {
                taskLedgerEventsList.innerHTML = '<div class="empty-state">Unable to load activity ledger.</div>';
            }
        } catch (err) {
            taskLedgerEventsList.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
        }
    }

    function renderTaskEventsList(events) {
        if (!taskLedgerEventsList) return;
        taskLedgerEventsList.innerHTML = '';

        if (!events || events.length === 0) {
            taskLedgerEventsList.innerHTML = '<div class="empty-state">No activity events recorded yet.</div>';
            return;
        }

        events.forEach(evt => {
            const item = document.createElement('div');
            item.className = `ledger-event-item event-${evt.eventType || 'generic'}`;

            const header = document.createElement('div');
            header.className = 'event-header';

            const badge = document.createElement('span');
            badge.className = 'event-type-badge';
            badge.textContent = String(evt.eventType || 'EVENT').toUpperCase();
            header.appendChild(badge);

            const timestamp = document.createElement('span');
            timestamp.textContent = new Date(evt.createdAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            header.appendChild(timestamp);

            item.appendChild(header);

            const detail = document.createElement('div');
            detail.className = 'event-detail-text';

            const d = evt.eventDetail || {};
            if (evt.eventType === 'task_created') {
                detail.textContent = `Task created with initial status "${d.initialStatus || 'pending'}".`;
                if (d.goalTitle) {
                    detail.textContent += ` Linked to goal "${d.goalTitle}".`;
                }
            } else if (evt.eventType === 'blocker_recorded') {
                detail.textContent = `Status changed from "${d.fromStatus}" to "blocked". Blocker: "${d.blockerReason || 'Unspecified'}".`;
            } else if (evt.eventType === 'task_cancelled') {
                detail.textContent = `Task cancelled by owner (previous status: "${d.fromStatus}").`;
                if (d.reason) detail.textContent += ` Reason: "${d.reason}".`;
            } else if (evt.eventType === 'status_changed') {
                detail.textContent = `Status changed from "${d.fromStatus}" to "${d.toStatus}".`;
            } else if (evt.eventType === 'agent_proposal_created') {
                detail.textContent = `Ghost Agent V0 proposed next action (${d.proposalMode || 'generated'}): ${d.proposedNextAction || d.summary || 'Next action proposed'}.`;
            } else if (evt.eventType === 'agent_proposal_feedback_recorded') {
                const ratingLabel = d.rating ? d.rating.replace('_', ' ').toUpperCase() : 'FEEDBACK';
                detail.textContent = `Owner feedback recorded: ${ratingLabel}${d.note ? ` — "${d.note}"` : ''}.`;
            } else if (evt.eventType === 'approval_contract_drafted') {
                if (d.action === 'patch_draft_proposed') {
                    detail.textContent = `Patch draft proposed (${d.draftId || ''}). Non-writing.`;
                } else {
                    detail.textContent = `Approval contract drafted: ${d.fileScopeCount || 0} file(s), ${d.commandScopeCount || 0} command(s)${d.executionExpiry ? ` (expires ${new Date(d.executionExpiry).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}.`;
                }
            } else if (evt.eventType === 'approval_contract_reviewed') {
                if (d.action === 'patch_draft_reviewed') {
                    detail.textContent = `Patch draft reviewed (${d.draftId || ''}). Non-writing.`;
                } else {
                    detail.textContent = `Owner reviewed approval contract (${d.contractId || ''}). Non-executing proposal.`;
                }
            } else if (evt.eventType === 'approval_contract_cancelled') {
                if (d.action === 'patch_draft_cancelled') {
                    detail.textContent = `Patch draft cancelled (${d.draftId || ''}).`;
                } else {
                    detail.textContent = `Approval contract cancelled by owner (${d.contractId || ''}).`;
                }
            } else if (evt.eventType === 'approval_contract_expired') {
                if (d.action === 'patch_draft_expired') {
                    detail.textContent = `Patch draft expired (${d.draftId || ''}).`;
                } else {
                    detail.textContent = `Approval contract expired (${d.contractId || ''}).`;
                }
            } else {
                detail.textContent = JSON.stringify(d);
            }

            item.appendChild(detail);
            taskLedgerEventsList.appendChild(item);
        });
    }

    // --- APPROVAL CONTRACT V1 METHODS ---
    async function loadApprovalContract(taskId) {
        if (!approvalContractContainer || !taskId) return;
        try {
            const res = await fetch(apiUrl(`/api/approval-contract/task/${encodeURIComponent(taskId)}`), {
                method: 'GET',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success && data.contract) {
                renderApprovalContractCard(data.contract);
            } else {
                approvalContractContainer.style.display = 'none';
                approvalContractContainer.innerHTML = '';
            }
        } catch (err) {
            console.warn('[ApprovalContract] Error loading contract:', err.message);
        }
    }

    function renderApprovalContractDraftForm(task) {
        if (!approvalContractContainer || !task) return;

        const defaultPurpose = `Approval contract proposal for '${task.title}'`;
        approvalContractContainer.innerHTML = `
            <div class="approval-contract-card draft-form-card">
                <div class="contract-safety-banner">
                    APPROVAL CONTRACT ONLY — NO FILES CHANGED — NO COMMANDS OR TESTS EXECUTED — NO WORKER STARTED — OWNER CANCELLATION AVAILABLE
                </div>
                <div class="contract-header-row">
                    <span class="contract-title">Draft Approval Contract</span>
                    <span class="contract-state-tag draft">Draft Mode</span>
                </div>
                <div class="contract-snapshot-summary">
                    <strong>Task Snapshot:</strong> [${escapeHtml(task.status)}] ${escapeHtml(task.title)}
                    ${task.goalTitle ? `<br/><span class="contract-subnote">🎯 Goal: ${escapeHtml(task.goalTitle)}</span>` : ''}
                    ${task.description ? `<br/><span class="contract-subnote">📝 ${escapeHtml(task.description)}</span>` : ''}
                </div>
                <form id="draftContractForm" class="contract-form">
                    <div class="contract-field-group">
                        <label for="contractPurposeInput" class="form-label">Purpose (max 500 chars):</label>
                        <input type="text" id="contractPurposeInput" class="personal-input" value="${escapeHtml(defaultPurpose)}" maxlength="500" required />
                    </div>
                    <div class="contract-field-group">
                        <label for="contractFileScopeInput" class="form-label">Proposed File Scope (comma or newline-separated relative repo paths):</label>
                        <textarea id="contractFileScopeInput" class="personal-textarea" rows="2" placeholder="e.g. services/approvalContract.js, public/ghost-ui.js"></textarea>
                    </div>
                    <div class="contract-field-group">
                        <label for="contractCommandScopeInput" class="form-label">Proposed Command/Test Scope (exact approved test identifier):</label>
                        <textarea id="contractCommandScopeInput" class="personal-textarea" rows="2" placeholder="e.g. approval_gated_test_worker_v0_test">approval_gated_test_worker_v0_test</textarea>
                    </div>
                    <div class="contract-field-group">
                        <label for="contractExpirySelect" class="form-label">Execution Expiry Window:</label>
                        <select id="contractExpirySelect" class="personal-select">
                            <option value="15">15 minutes</option>
                            <option value="30" selected>30 minutes (recommended)</option>
                            <option value="60">60 minutes</option>
                        </select>
                    </div>
                    <div class="contract-evidence-notice">
                        <strong>Evidence Contract:</strong> Future worker, if ever implemented, must return only a scoped diff, named test output, timestamps, and status. V1 produces no execution evidence.
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary-action" id="btnSubmitDraftContract">Draft Contract</button>
                        <button type="button" class="btn-secondary-action" id="btnDismissContractForm">Dismiss</button>
                    </div>
                    <div id="contractFormError" class="feedback-status-message error" style="display: none;"></div>
                </form>
            </div>
        `;
        approvalContractContainer.style.display = 'block';

        const form = document.getElementById('draftContractForm');
        const dismissBtn = document.getElementById('btnDismissContractForm');
        const errorBox = document.getElementById('contractFormError');

        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                approvalContractContainer.style.display = 'none';
                approvalContractContainer.innerHTML = '';
            });
        }

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const purposeInput = document.getElementById('contractPurposeInput');
                const fileScopeInput = document.getElementById('contractFileScopeInput');
                const commandScopeInput = document.getElementById('contractCommandScopeInput');
                const expirySelect = document.getElementById('contractExpirySelect');
                const submitBtn = document.getElementById('btnSubmitDraftContract');

                const purpose = purposeInput ? purposeInput.value.trim() : '';
                const rawFiles = fileScopeInput ? fileScopeInput.value : '';
                const rawCmds = commandScopeInput ? commandScopeInput.value : '';
                const expiryMinutes = expirySelect ? parseInt(expirySelect.value, 10) : 30;

                const proposedFileScope = rawFiles
                    .split(/[\n,]/)
                    .map(s => s.trim())
                    .filter(Boolean);

                const proposedCommandScope = rawCmds
                    .split(/[\n,]/)
                    .map(s => s.trim())
                    .filter(Boolean);

                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Drafting...';
                }
                if (errorBox) {
                    errorBox.style.display = 'none';
                    errorBox.textContent = '';
                }

                try {
                    const res = await fetch(apiUrl('/api/approval-contract/draft'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            taskId: task.id,
                            purpose,
                            proposedFileScope,
                            proposedCommandScope,
                            expiryMinutes
                        })
                    });
                    const data = await res.json();

                    if (res.ok && data.success && data.contract) {
                        showPersonalNotice('Approval contract drafted successfully.');
                        renderApprovalContractCard(data.contract);
                        loadTaskEvents(task.id);
                    } else {
                        if (errorBox) {
                            errorBox.textContent = data.error || 'Failed to draft approval contract.';
                            errorBox.style.display = 'block';
                        }
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Draft Contract';
                        }
                    }
                } catch (err) {
                    if (errorBox) {
                        errorBox.textContent = `Error: ${err.message}`;
                        errorBox.style.display = 'block';
                    }
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Draft Contract';
                    }
                }
            });
        }
    }

    function renderTestRunEvidence(run) {
        const evidenceContainer = document.getElementById('testRunEvidenceContainer');
        if (!evidenceContainer || !run) return;

        const isRunning = ['queued', 'running', 'cancel_requested'].includes(run.state);
        const stateClass = escapeHtml(run.state || 'running');
        const exitText = run.result && typeof run.result.exitCode === 'number' ? `Exit code: ${run.result.exitCode}` : (isRunning ? 'In progress' : 'Signal/Error');
        const durationText = run.result && typeof run.result.durationMs === 'number' ? `${run.result.durationMs}ms` : '—';
        const rawOutput = (run.result ? (run.result.stdout || '') + (run.result.stderr ? `\nSTDERR:\n${run.result.stderr}` : '') : '') || '(No output recorded)';

        evidenceContainer.innerHTML = `
            <div class="test-run-evidence-card ${stateClass}" data-run-id="${escapeHtml(run.id)}">
                <div class="test-run-header-row">
                    <div class="test-run-id-wrap">
                        <span>⚡ Run Evidence:</span>
                        <span class="contract-id-badge" id="runIdBadge">${escapeHtml(run.id)}</span>
                    </div>
                    <span class="test-run-state-tag ${stateClass}" id="runStateTag">${escapeHtml(run.state.toUpperCase())}</span>
                </div>
                <div class="test-run-facts-list">
                    <div class="test-run-fact-item">
                        <strong>Test:</strong> <code>${escapeHtml(run.testIdentifier)}</code>
                    </div>
                    <div class="test-run-fact-item">
                        <strong>Authority:</strong> <span>one reviewed contract + one explicit owner Start action</span>
                    </div>
                    <div class="test-run-fact-item">
                        <strong>Files changed by this worker:</strong> <span>0 (production_files_changed: 0 · production_file_write_authority: false)</span>
                    </div>
                    <div class="test-run-fact-item">
                        <strong>Security Boundary:</strong> <span>No deployment, Git, browser, Mac, or network actions were granted.</span>
                    </div>
                    <div class="test-run-fact-item">
                        <strong>Execution Facts:</strong> <span>${escapeHtml(exitText)} · Duration: ${escapeHtml(durationText)} ${run.result && run.result.output_truncated ? '· (Output Truncated at 12 KiB)' : ''}</span>
                    </div>
                </div>
                <details class="test-output-disclosure" id="testRunOutputDisclosure" ${run.state === 'succeeded' || run.state === 'failed' ? 'open' : ''}>
                    <summary class="ledger-disclosure-summary">
                        <span>View Test Execution Output</span>
                        <span>▾</span>
                    </summary>
                    <pre class="test-output-pre">${escapeHtml(rawOutput)}</pre>
                </details>
                <div class="worker-controls-row" style="margin-top: 6px;">
                    ${isRunning ? `
                        <button type="button" class="btn-cancel-worker" id="cancelTestRunBtn" data-run-id="${escapeHtml(run.id)}">Cancel run</button>
                    ` : ''}
                    <button type="button" class="btn-refresh-worker" id="refreshTestRunBtn" data-run-id="${escapeHtml(run.id)}">Refresh run evidence</button>
                </div>
            </div>
        `;
        evidenceContainer.style.display = 'block';

        const cancelRunBtn = document.getElementById('cancelTestRunBtn');
        const refreshRunBtn = document.getElementById('refreshTestRunBtn');

        if (cancelRunBtn) {
            cancelRunBtn.addEventListener('click', async () => {
                cancelRunBtn.disabled = true;
                cancelRunBtn.textContent = 'Cancelling...';
                try {
                    const res = await fetch(apiUrl(`/api/approval-test-runs/${encodeURIComponent(run.id)}/cancel`), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.run) {
                        showPersonalNotice('Test run cancellation requested.');
                        renderTestRunEvidence(data.run);
                        if (selectedTaskId) loadTaskEvents(selectedTaskId);
                    } else {
                        cancelRunBtn.disabled = false;
                        cancelRunBtn.textContent = 'Cancel run';
                    }
                } catch (err) {
                    cancelRunBtn.disabled = false;
                    cancelRunBtn.textContent = 'Cancel run';
                }
            });
        }

        if (refreshRunBtn) {
            refreshRunBtn.addEventListener('click', async () => {
                refreshRunBtn.disabled = true;
                refreshRunBtn.textContent = 'Refreshing...';
                try {
                    const res = await fetch(apiUrl(`/api/approval-test-runs/${encodeURIComponent(run.id)}`), {
                        credentials: 'include'
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.run) {
                        renderTestRunEvidence(data.run);
                    }
                } catch {}
                refreshRunBtn.disabled = false;
                refreshRunBtn.textContent = 'Refresh run evidence';
            });
        }
    }

    function renderApprovalContractCard(contract) {
        if (!approvalContractContainer || !contract) return;

        const isExpired = contract.state === 'expired' || (contract.executionExpiry && new Date(contract.executionExpiry) <= new Date());
        const stateDisplay = isExpired && contract.state !== 'cancelled' ? 'expired' : contract.state;
        const stateClass = stateDisplay;
        const snap = contract.taskSnapshot || {};

        const fileScopeTags = Array.isArray(contract.proposedFileScope) && contract.proposedFileScope.length > 0
            ? contract.proposedFileScope.map(f => `<span class="scope-tag file-tag">📄 ${escapeHtml(f)}</span>`).join('')
            : '<span class="scope-empty-text">None (Empty file scope)</span>';

        const commandScopeTags = Array.isArray(contract.proposedCommandScope) && contract.proposedCommandScope.length > 0
            ? contract.proposedCommandScope.map(c => `<span class="scope-tag cmd-tag">🧪 ${escapeHtml(c)}</span>`).join('')
            : '<span class="scope-empty-text">None (Empty command scope)</span>';

        const expiryDate = contract.executionExpiry ? new Date(contract.executionExpiry) : null;
        const expiryLabel = expiryDate
            ? (isExpired ? `Expired on ${expiryDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : `Expires on ${expiryDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)
            : 'No expiry set';

        approvalContractContainer.innerHTML = `
            <div class="approval-contract-card ${stateClass}" data-contract-id="${escapeHtml(contract.id)}">
                <div class="contract-safety-banner">
                    ${escapeHtml(contract.authority || "APPROVAL CONTRACT ONLY — NO FILES CHANGED — NO COMMANDS OR TESTS EXECUTED — NO WORKER STARTED — OWNER CANCELLATION AVAILABLE")}
                </div>
                <div class="contract-header-row">
                    <div class="contract-title-wrap">
                        <span class="contract-title">Approval Contract V1</span>
                        <span class="contract-id-badge">${escapeHtml(contract.id)}</span>
                    </div>
                    <span class="contract-state-tag ${stateClass}">${escapeHtml(stateDisplay.toUpperCase())}</span>
                </div>
                <div class="contract-content-body">
                    <div class="contract-field-block">
                        <div class="contract-field-label">Selected Task Snapshot</div>
                        <div class="contract-field-value">
                            <strong>[${escapeHtml(snap.status || '')}]</strong> ${escapeHtml(snap.title || '')}
                            ${snap.goalTitle ? `<br/><span class="contract-subnote">🎯 Goal: ${escapeHtml(snap.goalTitle)}</span>` : ''}
                            ${snap.blockerContext ? `<br/><span class="contract-subnote" style="color: #fca5a5;">⚠️ ${escapeHtml(snap.blockerContext)}</span>` : ''}
                        </div>
                    </div>
                    <div class="contract-field-block">
                        <div class="contract-field-label">Purpose</div>
                        <div class="contract-field-value">${escapeHtml(contract.purpose || '')}</div>
                    </div>
                    <div class="contract-field-block">
                        <div class="contract-field-label">Proposed File Scope (${contract.proposedFileScope ? contract.proposedFileScope.length : 0})</div>
                        <div class="contract-field-value scope-tag-container">${fileScopeTags}</div>
                    </div>
                    <div class="contract-field-block">
                        <div class="contract-field-label">Proposed Command/Test Scope (${contract.proposedCommandScope ? contract.proposedCommandScope.length : 0})</div>
                        <div class="contract-field-value scope-tag-container">${commandScopeTags}</div>
                    </div>
                    <div class="contract-field-block">
                        <div class="contract-field-label">Execution Expiry</div>
                        <div class="contract-field-value">${escapeHtml(expiryLabel)}</div>
                    </div>
                    <div class="contract-field-block evidence-block">
                        <div class="contract-field-label">Evidence Contract</div>
                        <div class="contract-field-value contract-evidence-text">${escapeHtml(contract.evidenceContract || "Future worker, if ever implemented, must return only a scoped diff, named test output, timestamps, and status. V1 produces no execution evidence.")}</div>
                    </div>
                </div>

                <!-- Action Controls for Contract -->
                <div class="contract-actions-bar">
                    ${stateDisplay === 'draft' ? `
                        <button type="button" class="btn-primary-action" id="btnReviewContract" data-contract-id="${escapeHtml(contract.id)}">Mark Reviewed</button>
                        <button type="button" class="btn-state-action btn-cancel-contract" id="btnCancelContract" data-contract-id="${escapeHtml(contract.id)}">Cancel Contract</button>
                    ` : ''}
                    ${stateDisplay === 'reviewed' ? `
                        <span class="contract-reviewed-notice">✓ Owner has reviewed this proposal. No worker is started.</span>
                        <button type="button" class="btn-state-action btn-cancel-contract" id="btnCancelContract" data-contract-id="${escapeHtml(contract.id)}">Cancel Contract</button>
                    ` : ''}
                    ${stateDisplay === 'cancelled' ? `
                        <span class="contract-cancelled-notice">✕ This approval contract was cancelled by owner.</span>
                    ` : ''}
                    ${stateDisplay === 'expired' ? `
                        <span class="contract-expired-notice">⏱ This approval contract has expired.</span>
                    ` : ''}
                </div>
                <div id="contractActionMessage" class="feedback-status-message" style="display: none;"></div>

                ${stateDisplay === 'reviewed' ? `
                    <!-- Approval-Gated Test Worker V0 Section -->
                    <div class="worker-v0-section" id="workerV0Section">
                        <div class="worker-v0-safety-banner">
                            TEST-ONLY WORKER V0 — NO PRODUCTION FILES CHANGED — NO BROAD SHELL, MAC, BROWSER, NETWORK, GIT, OR DEPLOYMENT ACCESS — EXPLICIT OWNER START AND CANCELLATION REQUIRED
                        </div>
                        <div class="worker-controls-row">
                            <button type="button" class="btn-start-worker" id="startTestRunBtn" data-contract-id="${escapeHtml(contract.id)}" ${isExpired || !(contract.proposedCommandScope && contract.proposedCommandScope[0] === 'approval_gated_test_worker_v0_test') ? 'disabled' : ''}>Start Test</button>
                            ${contract.proposedCommandScope && contract.proposedCommandScope[0] !== 'approval_gated_test_worker_v0_test' ? `
                                <span class="contract-subnote" style="color: #fca5a5;">⚠️ Scope Notice: V0 requires exact test 'approval_gated_test_worker_v0_test'.</span>
                            ` : ''}
                        </div>
                        <div id="testRunEvidenceContainer" class="test-run-evidence-container" style="display: none;"></div>
                    </div>
                ` : ''}
            </div>
        `;
        approvalContractContainer.style.display = 'block';

        // Attach listeners
        const btnReview = document.getElementById('btnReviewContract');
        const btnCancel = document.getElementById('btnCancelContract');
        const btnStartWorker = document.getElementById('startTestRunBtn');
        const actionMsg = document.getElementById('contractActionMessage');

        if (btnReview) {
            btnReview.addEventListener('click', async () => {
                btnReview.disabled = true;
                btnReview.textContent = 'Reviewing...';
                try {
                    const res = await fetch(apiUrl(`/api/approval-contract/${encodeURIComponent(contract.id)}/review`), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.contract) {
                        showPersonalNotice('Approval contract marked as reviewed.');
                        renderApprovalContractCard(data.contract);
                        if (selectedTaskId) loadTaskEvents(selectedTaskId);
                    } else {
                        if (actionMsg) {
                            actionMsg.textContent = data.error || 'Failed to review contract.';
                            actionMsg.className = 'feedback-status-message error';
                            actionMsg.style.display = 'block';
                        }
                        btnReview.disabled = false;
                        btnReview.textContent = 'Mark Reviewed';
                    }
                } catch (err) {
                    if (actionMsg) {
                        actionMsg.textContent = `Error: ${err.message}`;
                        actionMsg.className = 'feedback-status-message error';
                        actionMsg.style.display = 'block';
                    }
                    btnReview.disabled = false;
                    btnReview.textContent = 'Mark Reviewed';
                }
            });
        }

        if (btnCancel) {
            btnCancel.addEventListener('click', async () => {
                btnCancel.disabled = true;
                btnCancel.textContent = 'Cancelling...';
                try {
                    const res = await fetch(apiUrl(`/api/approval-contract/${encodeURIComponent(contract.id)}/cancel`), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.contract) {
                        showPersonalNotice('Approval contract cancelled.');
                        renderApprovalContractCard(data.contract);
                        if (selectedTaskId) loadTaskEvents(selectedTaskId);
                    } else {
                        if (actionMsg) {
                            actionMsg.textContent = data.error || 'Failed to cancel contract.';
                            actionMsg.className = 'feedback-status-message error';
                            actionMsg.style.display = 'block';
                        }
                        btnCancel.disabled = false;
                        btnCancel.textContent = 'Cancel Contract';
                    }
                } catch (err) {
                    if (actionMsg) {
                        actionMsg.textContent = `Error: ${err.message}`;
                        actionMsg.className = 'feedback-status-message error';
                        actionMsg.style.display = 'block';
                    }
                    btnCancel.disabled = false;
                    btnCancel.textContent = 'Cancel Contract';
                }
            });
        }

        if (btnStartWorker) {
            btnStartWorker.addEventListener('click', async () => {
                btnStartWorker.disabled = true;
                btnStartWorker.textContent = 'Starting test run...';
                try {
                    const res = await fetch(apiUrl(`/api/approval-test-runs/${encodeURIComponent(contract.id)}/start`), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.run) {
                        showPersonalNotice('Approved test run started.');
                        renderTestRunEvidence(data.run);
                        if (selectedTaskId) loadTaskEvents(selectedTaskId);
                    } else {
                        if (actionMsg) {
                            actionMsg.textContent = data.error || 'Failed to start test run.';
                            actionMsg.className = 'feedback-status-message error';
                            actionMsg.style.display = 'block';
                        }
                    }
                } catch (err) {
                    if (actionMsg) {
                        actionMsg.textContent = `Error: ${err.message}`;
                        actionMsg.className = 'feedback-status-message error';
                        actionMsg.style.display = 'block';
                    }
                }
                btnStartWorker.disabled = false;
                btnStartWorker.textContent = 'Start approved test run';
            });
        }

        // Check if there is an existing/latest test run for this contract
        if (stateDisplay === 'reviewed') {
            fetch(apiUrl(`/api/approval-test-runs/contract/${encodeURIComponent(contract.id)}/latest`), {
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                if (data && data.success && data.run) {
                    renderTestRunEvidence(data.run);
                }
            })
            .catch(() => {});
        }
    }

    // --- PATCH DRAFT / REVIEW V1 METHODS (Volatile Review Material Only) ---
    let currentVolatileDraftMaterial = null;

    async function loadPatchDraft(taskId) {
        if (!patchDraftContainer || !taskId) return;
        try {
            const res = await fetch(apiUrl(`/api/patch-draft/task/${encodeURIComponent(taskId)}`), {
                method: 'GET',
                credentials: 'include'
            });
            const data = await res.json();
            if (res.ok && data.success && data.draft) {
                const volatileMat = (currentVolatileDraftMaterial && currentVolatileDraftMaterial.taskId === taskId && currentVolatileDraftMaterial.draftId === data.draft.draftId)
                    ? currentVolatileDraftMaterial
                    : null;
                renderPatchDraftCard(data.draft, volatileMat);
            } else {
                currentVolatileDraftMaterial = null;
                patchDraftContainer.style.display = 'none';
                patchDraftContainer.innerHTML = '';
            }
        } catch (err) {
            console.warn('[PatchDraft] Error loading draft:', err.message);
        }
    }

    function renderPatchDraftForm(task) {
        if (!patchDraftContainer || !task) return;

        patchDraftContainer.innerHTML = `
            <div class="approval-contract-card draft-form-card">
                <div class="contract-safety-banner">
                    PATCH PROPOSAL ONLY — NO REPOSITORY FILES CHANGED — REVIEW SEALS THIS PROPOSAL BUT DOES NOT APPLY IT.
                </div>
                <div class="contract-header-row">
                    <span class="contract-title">Propose Patch Draft</span>
                    <span class="contract-state-tag draft">Draft Mode</span>
                </div>
                <div class="contract-snapshot-summary">
                    <strong>Task Snapshot:</strong> [${escapeHtml(task.status)}] ${escapeHtml(task.title)}
                </div>
                <form id="proposePatchDraftForm" class="contract-form">
                    <div class="contract-field-group">
                        <label for="patchDraftTargetPathInput" class="form-label">Exact Target File Path (relative to repository root):</label>
                        <input type="text" id="patchDraftTargetPathInput" class="personal-input" placeholder="e.g. public/index.html or tests/my_test.cjs" maxlength="200" required />
                    </div>
                    <div class="contract-field-group">
                        <label for="patchDraftProposedContentInput" class="form-label">Proposed Full File Content (max 64 KiB UTF-8):</label>
                        <textarea id="patchDraftProposedContentInput" class="personal-textarea" rows="6" placeholder="Paste the exact proposed replacement content for the target file..."></textarea>
                    </div>
                    <div class="contract-field-group">
                        <label for="patchDraftExpirySelect" class="form-label">Review Expiry Window:</label>
                        <select id="patchDraftExpirySelect" class="personal-select">
                            <option value="15">15 minutes</option>
                            <option value="30" selected>30 minutes (recommended)</option>
                            <option value="60">60 minutes</option>
                        </select>
                    </div>
                    <div class="contract-evidence-notice">
                        <strong>Non-Writing Guarantee:</strong> Proposing a patch reads the target file from server disk and derives a diff. No files are edited or created.
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary-action" id="btnSubmitPatchDraft">Propose Draft</button>
                        <button type="button" class="btn-secondary-action" id="btnDismissPatchDraftForm">Dismiss</button>
                    </div>
                    <div id="patchDraftFormError" class="feedback-status-message error" style="display: none;"></div>
                </form>
            </div>
        `;
        patchDraftContainer.style.display = 'block';

        const form = document.getElementById('proposePatchDraftForm');
        const dismissBtn = document.getElementById('btnDismissPatchDraftForm');
        const errorBox = document.getElementById('patchDraftFormError');

        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                patchDraftContainer.style.display = 'none';
                patchDraftContainer.innerHTML = '';
            });
        }

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const pathInput = document.getElementById('patchDraftTargetPathInput');
                const contentInput = document.getElementById('patchDraftProposedContentInput');
                const expirySelect = document.getElementById('patchDraftExpirySelect');
                const submitBtn = document.getElementById('btnSubmitPatchDraft');

                const targetPath = pathInput ? pathInput.value.trim() : '';
                const proposedAfterContent = contentInput ? contentInput.value : '';
                const expiryMinutes = expirySelect ? parseInt(expirySelect.value, 10) : 30;

                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Proposing...';
                }
                if (errorBox) {
                    errorBox.style.display = 'none';
                    errorBox.textContent = '';
                }

                try {
                    const res = await fetch(apiUrl('/api/patch-draft/propose'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            taskId: task.id,
                            targetPath,
                            proposedAfterContent,
                            expiryMinutes
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.draft) {
                        showPersonalNotice('Patch draft proposed successfully.');
                        currentVolatileDraftMaterial = {
                            draftId: data.draft.draftId,
                            taskId: task.id,
                            unifiedDiff: data.volatileReviewMaterial ? data.volatileReviewMaterial.unifiedDiff : null,
                            proposedAfterContent
                        };
                        renderPatchDraftCard(data.draft, currentVolatileDraftMaterial);
                        loadTaskEvents(task.id);
                    } else {
                        if (errorBox) {
                            errorBox.textContent = data.error || 'Failed to propose patch draft.';
                            errorBox.style.display = 'block';
                        }
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Propose Draft';
                        }
                    }
                } catch (err) {
                    if (errorBox) {
                        errorBox.textContent = `Error: ${err.message}`;
                        errorBox.style.display = 'block';
                    }
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Propose Draft';
                    }
                }
            });
        }
    }

    function renderPatchDraftCard(draft, volatileMaterial = null) {
        if (!patchDraftContainer || !draft) return;

        const isExpired = draft.status === 'expired' || (draft.expiresAt && new Date(draft.expiresAt) <= new Date());
        const stateDisplay = isExpired && draft.status !== 'cancelled' ? 'expired' : draft.status;
        const stateClass = stateDisplay;

        const diffToRender = (volatileMaterial && volatileMaterial.draftId === draft.draftId)
            ? volatileMaterial.unifiedDiff
            : null;

        patchDraftContainer.innerHTML = `
            <div class="approval-contract-card patch-draft-card ${stateClass}" data-draft-id="${escapeHtml(draft.draftId)}">
                <div class="contract-safety-banner">
                    ${escapeHtml(draft.safetyBanner || "PATCH PROPOSAL ONLY — NO REPOSITORY FILES CHANGED — REVIEW SEALS THIS PROPOSAL BUT DOES NOT APPLY IT.")}
                </div>
                <div class="contract-header-row">
                    <div class="contract-id-wrap">
                        <span class="contract-title">Patch Proposal:</span>
                        <span class="contract-id-badge" id="patchDraftIdBadge">${escapeHtml(draft.draftId)}</span>
                    </div>
                    <span class="contract-state-tag ${stateClass}" id="patchDraftStateTag">${escapeHtml(stateDisplay.toUpperCase())}</span>
                </div>

                <div class="contract-meta-grid">
                    <div class="contract-meta-item">
                        <strong>Target Path:</strong> <code>${escapeHtml(draft.canonicalTargetPath)}</code>
                    </div>
                    <div class="contract-meta-item">
                        <strong>Task ID:</strong> <span>${escapeHtml(draft.taskId)}</span>
                    </div>
                    <div class="contract-meta-item">
                        <strong>Before SHA-256:</strong> <code>${escapeHtml(draft.beforeContentSha256 || '—')}</code>
                    </div>
                    <div class="contract-meta-item">
                        <strong>After SHA-256:</strong> <code>${escapeHtml(draft.afterContentSha256 || '—')}</code>
                    </div>
                    ${draft.sealedHash ? `
                    <div class="contract-meta-item" style="grid-column: 1 / -1;">
                        <strong>Sealed Hash:</strong> <code>${escapeHtml(draft.sealedHash)}</code>
                    </div>
                    ` : ''}
                    <div class="contract-meta-item">
                        <strong>Review Expiry:</strong> <span>${draft.expiresAt ? new Date(draft.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + new Date(draft.expiresAt).toLocaleDateString() + ')' : '—'}</span>
                    </div>
                </div>

                ${diffToRender ? `
                <details class="test-output-disclosure" open style="margin-top: 6px;">
                    <summary class="ledger-disclosure-summary">
                        <span>Server-Derived Unified Diff (Live Session Memory)</span>
                        <span>▾</span>
                    </summary>
                    <pre class="patch-diff-pre">${escapeHtml(diffToRender)}</pre>
                </details>
                ` : (stateDisplay === 'draft' ? `
                <div class="contract-volatile-notice" style="font-size: 11px; color: #a1a1aa; padding: 6px 0;">
                    <em>Volatile diff is not stored on server. If you reloaded or switched sessions, propose a fresh draft to review.</em>
                </div>
                ` : '')}

                <div class="contract-actions-row" id="patchDraftActionsRow">
                    ${stateDisplay === 'draft' ? `
                        <button type="button" class="btn-review-draft" id="btnReviewPatchDraft" data-draft-id="${escapeHtml(draft.draftId)}">Seal &amp; Mark Reviewed</button>
                        <button type="button" class="btn-cancel-contract" id="btnCancelPatchDraft" data-draft-id="${escapeHtml(draft.draftId)}">Cancel Draft</button>
                    ` : ''}
                    ${stateDisplay === 'reviewed' ? `
                        <span class="contract-sealed-notice">🔒 Proposal sealed. Non-writing review recorded.</span>
                        <button type="button" class="btn-cancel-contract" id="btnCancelPatchDraft" data-draft-id="${escapeHtml(draft.draftId)}">Cancel Draft</button>
                    ` : ''}
                    ${['cancelled', 'expired', 'stale'].includes(stateDisplay) ? `
                        <span class="contract-terminal-notice">Draft is ${stateDisplay}. Full content purged.</span>
                    ` : ''}
                </div>
                <div id="patchDraftActionMessage" class="feedback-status-message" style="display: none;"></div>
            </div>
        `;
        patchDraftContainer.style.display = 'block';

        const btnReview = document.getElementById('btnReviewPatchDraft');
        const btnCancel = document.getElementById('btnCancelPatchDraft');
        const actionMsg = document.getElementById('patchDraftActionMessage');

        if (btnReview) {
            btnReview.addEventListener('click', async () => {
                if (!volatileMaterial || !volatileMaterial.proposedAfterContent || volatileMaterial.draftId !== draft.draftId) {
                    if (actionMsg) {
                        actionMsg.textContent = 'Volatile review content is not available in current session memory. Please propose a fresh draft.';
                        actionMsg.className = 'feedback-status-message error';
                        actionMsg.style.display = 'block';
                    }
                    return;
                }

                btnReview.disabled = true;
                btnReview.textContent = 'Sealing...';
                try {
                    const res = await fetch(apiUrl(`/api/patch-draft/${encodeURIComponent(draft.draftId)}/review`), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            proposedAfterContent: volatileMaterial.proposedAfterContent
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.draft) {
                        showPersonalNotice('Patch draft reviewed and sealed.');
                        currentVolatileDraftMaterial = null;
                        renderPatchDraftCard(data.draft, null);
                        if (selectedTaskId) loadTaskEvents(selectedTaskId);
                    } else {
                        if (actionMsg) {
                            actionMsg.textContent = data.error || 'Failed to review patch draft.';
                            actionMsg.className = 'feedback-status-message error';
                            actionMsg.style.display = 'block';
                        }
                        btnReview.disabled = false;
                        btnReview.textContent = 'Seal & Mark Reviewed';
                    }
                } catch (err) {
                    if (actionMsg) {
                        actionMsg.textContent = `Error: ${err.message}`;
                        actionMsg.className = 'feedback-status-message error';
                        actionMsg.style.display = 'block';
                    }
                    btnReview.disabled = false;
                    btnReview.textContent = 'Seal & Mark Reviewed';
                }
            });
        }

        if (btnCancel) {
            btnCancel.addEventListener('click', async () => {
                btnCancel.disabled = true;
                btnCancel.textContent = 'Cancelling...';
                try {
                    const res = await fetch(apiUrl(`/api/patch-draft/${encodeURIComponent(draft.draftId)}/cancel`), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.draft) {
                        showPersonalNotice('Patch draft cancelled.');
                        currentVolatileDraftMaterial = null;
                        renderPatchDraftCard(data.draft, null);
                        if (selectedTaskId) loadTaskEvents(selectedTaskId);
                    } else {
                        if (actionMsg) {
                            actionMsg.textContent = data.error || 'Failed to cancel patch draft.';
                            actionMsg.className = 'feedback-status-message error';
                            actionMsg.style.display = 'block';
                        }
                        btnCancel.disabled = false;
                        btnCancel.textContent = 'Cancel Draft';
                    }
                } catch (err) {
                    if (actionMsg) {
                        actionMsg.textContent = `Error: ${err.message}`;
                        actionMsg.className = 'feedback-status-message error';
                        actionMsg.style.display = 'block';
                    }
                    btnCancel.disabled = false;
                    btnCancel.textContent = 'Cancel Draft';
                }
            });
        }
    }

    if (btnPrepareApprovalContract) {
        btnPrepareApprovalContract.addEventListener('click', () => {
            if (!selectedTaskId) return;
            const targetTask = cachedTasks.find(t => t.id === selectedTaskId);
            if (!targetTask) return;
            renderApprovalContractDraftForm(targetTask);
        });
    }

    if (btnPreparePatchDraft) {
        btnPreparePatchDraft.addEventListener('click', () => {
            if (!selectedTaskId) return;
            const targetTask = cachedTasks.find(t => t.id === selectedTaskId);
            if (!targetTask) return;
            renderPatchDraftForm(targetTask);
        });
    }

    if (btnAskTaskAgent) {
        btnAskTaskAgent.addEventListener('click', async () => {
            if (isTaskAgentInFlight || !selectedTaskId) return;

            const targetTask = cachedTasks.find(t => t.id === selectedTaskId);
            if (!targetTask) return;

            if (!['pending', 'planned', 'blocked'].includes(targetTask.status)) {
                showPersonalNotice(`Task with status '${targetTask.status}' is not eligible for agent proposals.`, true);
                return;
            }

            isTaskAgentInFlight = true;
            btnAskTaskAgent.disabled = true;
            btnAskTaskAgent.textContent = 'Reasoning...';
            if (taskAgentStatusNote) {
                taskAgentStatusNote.textContent = 'Analyzing task and approved owner context...';
                taskAgentStatusNote.style.display = 'block';
            }

            const thisRequestId = ++currentTaskAgentRequestId;

            try {
                const res = await fetch(apiUrl('/api/task-agent/propose'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ taskId: selectedTaskId })
                });
                const data = await res.json();

                // Stale response protection
                if (thisRequestId !== currentTaskAgentRequestId) {
                    console.log('[TaskAgent] Discarding stale proposal response for request', thisRequestId);
                    return;
                }

                if (res.ok && data.success && data.proposal) {
                    renderTaskAgentProposal(data);
                    showPersonalNotice('Agent proposal generated and recorded in activity ledger.');
                    loadTaskEvents(selectedTaskId);
                } else {
                    if (taskAgentProposalContainer) {
                        taskAgentProposalContainer.innerHTML = `<div class="warning-banner">${escapeHtml(data.error || 'Failed to generate task proposal.')}</div>`;
                        taskAgentProposalContainer.style.display = 'block';
                    }
                    showPersonalNotice(data.error || 'Failed to generate task proposal.', true);
                }
            } catch (err) {
                if (thisRequestId === currentTaskAgentRequestId) {
                    if (taskAgentProposalContainer) {
                        taskAgentProposalContainer.innerHTML = `<div class="warning-banner">Error: ${escapeHtml(err.message)}</div>`;
                        taskAgentProposalContainer.style.display = 'block';
                    }
                    showPersonalNotice(`Proposal error: ${err.message}`, true);
                }
            } finally {
                if (thisRequestId === currentTaskAgentRequestId) {
                    isTaskAgentInFlight = false;
                    const currentTask = cachedTasks.find(t => t.id === selectedTaskId);
                    const stillEligible = currentTask && ['pending', 'planned', 'blocked'].includes(currentTask.status);
                    btnAskTaskAgent.disabled = !stillEligible;
                    btnAskTaskAgent.textContent = 'Ask Ghost Agent';
                    if (taskAgentStatusNote && stillEligible) {
                        taskAgentStatusNote.style.display = 'none';
                    }
                }
            }
        });
    }

    async function updateTaskStatus(taskId, newStatus, blockerReason = '') {
        if (!taskId) return;
        try {
            const body = { status: newStatus };
            if (blockerReason) body.blockerReason = blockerReason;

            const res = await fetch(apiUrl(`/api/personal/tasks/${encodeURIComponent(taskId)}/status`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showPersonalNotice(`Task status updated to ${newStatus}.`);
                if (blockerInputRow) blockerInputRow.style.display = 'none';
                if (blockerReasonInput) blockerReasonInput.value = '';
                await loadTasks();
                loadPersonalOverview();
            } else {
                showPersonalNotice(data.error || 'Failed to update task status.', true);
            }
        } catch (err) {
            showPersonalNotice(`Error: ${err.message}`, true);
        }
    }

    if (btnMarkPlanned) {
        btnMarkPlanned.addEventListener('click', () => {
            if (selectedTaskId) updateTaskStatus(selectedTaskId, 'planned');
        });
    }

    if (btnMarkCancelled) {
        btnMarkCancelled.addEventListener('click', () => {
            if (selectedTaskId) updateTaskStatus(selectedTaskId, 'cancelled');
        });
    }

    if (btnMarkBlocked) {
        btnMarkBlocked.addEventListener('click', () => {
            if (blockerInputRow) {
                blockerInputRow.style.display = blockerInputRow.style.display === 'none' ? 'block' : 'none';
                if (blockerReasonInput) blockerReasonInput.focus();
            }
        });
    }

    if (btnCancelBlockerInput) {
        btnCancelBlockerInput.addEventListener('click', () => {
            if (blockerInputRow) blockerInputRow.style.display = 'none';
            if (blockerReasonInput) blockerReasonInput.value = '';
        });
    }

    if (btnConfirmBlocker) {
        btnConfirmBlocker.addEventListener('click', () => {
            const reason = blockerReasonInput ? blockerReasonInput.value.trim() : '';
            if (!reason) {
                showPersonalNotice('Blocker reason is required.', true);
                return;
            }
            if (selectedTaskId) {
                updateTaskStatus(selectedTaskId, 'blocked', reason);
            }
        });
    }

    if (createTaskForm) {
        createTaskForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = taskTitleInput ? taskTitleInput.value.trim() : '';
            const description = taskDescInput ? taskDescInput.value.trim() : '';
            const goalId = taskGoalSelect ? taskGoalSelect.value.trim() : '';

            if (!title) return;

            const submitBtn = document.getElementById('submitTaskBtn');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const res = await fetch(apiUrl('/api/personal/tasks'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ title, description, goalId })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    showPersonalNotice('Task created successfully in pending status.');
                    if (taskTitleInput) taskTitleInput.value = '';
                    if (taskDescInput) taskDescInput.value = '';
                    if (taskGoalSelect) taskGoalSelect.value = '';
                    selectedTaskId = data.task ? data.task.id : null;
                    await loadTasks();
                    loadPersonalOverview();
                } else {
                    showPersonalNotice(data.error || 'Failed to create task.', true);
                }
            } catch (err) {
                showPersonalNotice(`Error: ${err.message}`, true);
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    [
        { btn: tabContinueBtn, tab: 'continue', loader: loadPersonalOverview },
        { btn: tabTasksBtn, tab: 'tasks', loader: loadTasks },
        { btn: tabRememberBtn, tab: 'remember' },
        { btn: tabGoalsBtn, tab: 'goals', loader: loadGoals },
        { btn: tabMemoriesBtn, tab: 'memories', loader: loadMemories }
    ].forEach(({ btn, tab, loader }) => {
        if (btn) {
            btn.addEventListener('click', () => {
                switchPersonalTab(tab);
                if (loader) loader();
            });
        }
    });

    if (refreshContinueBtn) {
        refreshContinueBtn.addEventListener('click', () => {
            loadPersonalOverview();
        });
    }

    if (memoryInputText && memoryCharCount) {
        memoryInputText.addEventListener('input', () => {
            memoryCharCount.textContent = String(memoryInputText.value.length);
        });
    }

    if (saveMemoryForm) {
        saveMemoryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = memoryInputText ? memoryInputText.value.trim() : '';
            if (!text) return;

            const submitBtn = document.getElementById('submitMemoryBtn');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const res = await fetch(apiUrl('/api/personal/memories'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ text })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    showPersonalNotice('Memory saved successfully.');
                    if (memoryInputText) memoryInputText.value = '';
                    if (memoryCharCount) memoryCharCount.textContent = '0';
                    loadPersonalOverview();
                } else {
                    showPersonalNotice(data.error || 'Failed to save memory.', true);
                }
            } catch (err) {
                showPersonalNotice(`Error: ${err.message}`, true);
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    if (createGoalForm) {
        createGoalForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = goalTitleInput ? goalTitleInput.value.trim() : '';
            const note = goalNoteInput ? goalNoteInput.value.trim() : '';
            const status = goalStatusSelect ? goalStatusSelect.value : 'active';

            if (!title) return;

            const submitBtn = document.getElementById('submitGoalBtn');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const res = await fetch(apiUrl('/api/personal/goals'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ title, note, status })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    showPersonalNotice('Goal created successfully.');
                    if (goalTitleInput) goalTitleInput.value = '';
                    if (goalNoteInput) goalNoteInput.value = '';
                    loadGoals();
                    loadPersonalOverview();
                } else {
                    showPersonalNotice(data.error || 'Failed to create goal.', true);
                }
            } catch (err) {
                showPersonalNotice(`Error: ${err.message}`, true);
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    // --- AUTHENTICATION HANDLER ---
    let isSubmittingAuth = false;
    async function submitOwnerLogin() {
        if (isSubmittingAuth || !authInput) return;
        clearOwnerError();
        const inputVal = authInput.value.trim();
        if (!inputVal) {
            showOwnerError('Please enter clearance key.');
            return;
        }

        const ownerUnlockBtn = document.getElementById('ownerUnlockBtn');
        isSubmittingAuth = true;
        if (ownerUnlockBtn) ownerUnlockBtn.disabled = true;
        if (authInput) authInput.disabled = true;

        try {
            const authRes = await fetch(apiUrl('/api/auth'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ authString: inputVal })
            });
            const authData = await authRes.json();

            if (authRes.ok && authData.success && authData.role === 'admin') {
                isAdminMode = true;
                const storedOwner = getStoredOwnerName();
                masterUser = storedOwner || capitalizeName(authData.user || "Manoj");
                saveOwnerName(masterUser);
                setOwnerHeader(masterUser);
                hideLoginOverlay();
                hideVisitorGate();
                appLayout.classList.add('active');
                updateInitialGreeting(masterUser);
                loadProjects();
                loadMemories();
                authInput.value = '';
            } else {
                isAdminMode = false;
                showOwnerError('Invalid clearance key. Access denied.');
                authInput.value = '';
                authInput.focus();
            }
        } catch (err) {
            isAdminMode = false;
            showOwnerError('Authentication failed. Please check connection and try again.');
            authInput.value = '';
            authInput.focus();
        } finally {
            isSubmittingAuth = false;
            if (ownerUnlockBtn) ownerUnlockBtn.disabled = false;
            if (authInput) authInput.disabled = false;
        }
    }

    const ownerLoginForm = document.getElementById('ownerLoginForm');
    if (ownerLoginForm) {
        ownerLoginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitOwnerLogin();
        });
    }
    const ownerUnlockBtn = document.getElementById('ownerUnlockBtn');
    if (ownerUnlockBtn) {
        ownerUnlockBtn.addEventListener('click', (e) => {
            e.preventDefault();
            submitOwnerLogin();
        });
    }
    if (authInput) {
        authInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitOwnerLogin();
            }
        });
    }

    // --- TOGGLES & ACTIONS ---
    if (ghostCodeBtn) {
        ghostCodeBtn.addEventListener('click', () => {
            if (typeof playClickSound === 'function') playClickSound(750, 'sine');
            isGhostCodeActive = !isGhostCodeActive;
            if (isGhostCodeActive) {
                ghostCodeBtn.classList.add('active');
                if (ghostCodeStatus) ghostCodeStatus.innerText = "Ghost Code · Ready to draft a plan";
            } else {
                ghostCodeBtn.classList.remove('active');
                if (ghostCodeStatus) ghostCodeStatus.innerText = "Ghost Code · Off";
            }
        });
    }


    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            renderWelcomeCard(masterUser);
            closeWorkspaceActions();
        });
    }

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
        html = html.replace(/```(?:[a-zA-Z0-9-]*\n)?([\s\S]*?)```/g, (match, code) => {
            return `<div class="code-wrapper" style="position:relative; margin:8px 0;"><button onclick="navigator.clipboard.writeText(this.nextElementSibling.innerText); this.innerText='Copied!'; setTimeout(()=>this.innerText='Copy', 2000);" style="position:absolute; top:8px; right:8px; background:#475569; color:#f8fafc; border:none; border-radius:4px; padding:4px 8px; font-size:11px; cursor:pointer; opacity:0.8; transition:opacity 0.2s;">Copy</button><pre style="padding:28px 12px 12px 12px; margin:0; background:#1e293b; border-radius:8px; overflow-x:auto;"><code>${code}</code></pre></div>`;
        });
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
            const isDownload = /download/i.test(displayLabel);
            const icon = isDownload ? ' ⬇️' : ' ↗';
            links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link" style="color:#38bdf8;text-decoration:underline;font-weight:500;">${displayLabel}${icon}</a>`);
            return placeholder;
        });

        // 2. Plain URLs (not inside href)
        html = html.replace(/(^|[^"])((?:https?):\/\/[^\s<>\)"'\`]+)/g, (match, prefix, rawUrl) => {
            const url = cleanUrl(rawUrl);
            const placeholder = `___LINK_PLACEHOLDER_${links.length}___`;
            links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link" style="color:#38bdf8;text-decoration:underline;font-weight:500;">${url} ↗</a>`);
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
    function submitComposer(event) {
        if (event && (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) return;
        if (event) event.preventDefault();
        if (isSubmitting) return;
        if (typeof playClickSound === 'function') playClickSound(600, 'sine');
        const val = userInput.value.trim();
        if (val || uploadedImageBase64 || uploadedFileText || uploadedFileBase64) {
            if (isPlanModeActive && val) {
                isPlanModeActive = false;
                resetPlanDiffButtonState();
                executePlanDraft(val);
            } else {
                processCommand(val);
            }
        }
    }

    sendBtn.addEventListener('click', submitComposer);

    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitComposer(e);
    });

    let activeRunId = null;
    let isSubmitting = false;

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
        if (isSubmitting) return;
        isSubmitting = true;

        if (textCommand) appendMessage('user', textCommand);
        userInput.value = "";
        userInput.disabled = true;
        sendBtn.disabled = true;
        thinkingIndicator.classList.add('active');

        const payload = {
            message: textCommand,
            user: masterUser,
            image: uploadedImageBase64 || null,
            fileContent: uploadedFileText || null,
            fileBase64: uploadedFileBase64 || null,
            fileName: uploadedFileName || null,
            ghostCodeMode: isGhostCodeActive
        };

        uploadedFileText = "";
        uploadedImageBase64 = "";
        uploadedFileBase64 = "";
        uploadedFileName = "";
        attachmentInput.value = "";

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        try {
            
            let targetUrl = apiUrl('/api/chat');
            if (payload.message && payload.message.trim().toLowerCase().startsWith('/copilot ')) {
                targetUrl = apiUrl('/api/coding-copilot');
                payload.message = payload.message.substring(9).trim();
            }

            
        var pipeWidget = document.getElementById('livePipelineWidget');
        var pipePlan = document.getElementById('pipePlan');
        var pipeExecute = document.getElementById('pipeExecute');
        var pipeVerify = document.getElementById('pipeVerify');
        var pipeStatusBadge = document.getElementById('pipeStatusBadge');
        if (pipeWidget) pipeWidget.style.display = 'flex';
        if (pipeStatusBadge) {
            pipeStatusBadge.innerText = 'Running';
            pipeStatusBadge.style.background = '#007aff';
        }
        if (pipePlan) pipePlan.style.color = 'black';
        
        var pipeInterval = null;
        if (pipeWidget) {
            let stage = 0;
            pipeInterval = setInterval(() => {
                stage++;
                if (stage === 1) {
                    if (pipePlan) pipePlan.style.color = 'gray';
                    if (pipeExecute) pipeExecute.style.color = 'black';
                } else if (stage === 2) {
                    if (pipeExecute) pipeExecute.style.color = 'gray';
                    if (pipeVerify) pipeVerify.style.color = 'black';
                }
            }, 3000);
        }
const response = await fetch(targetUrl, {

                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (pipeInterval) clearInterval(pipeInterval);
            if (pipeStatusBadge) {
                pipeStatusBadge.innerText = 'Idle';
                pipeStatusBadge.style.background = '#333';
            }
            if (pipePlan) pipePlan.style.color = 'gray';
            if (pipeExecute) pipeExecute.style.color = 'gray';
            if (pipeVerify) pipeVerify.style.color = 'gray';


            if (response.status === 401) {
                thinkingIndicator.classList.remove('active');
                showLoginOverlay();
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
                handleGhostResponse(data.text, data.execution, data);
                if (data.proposedTask && data.proposedTask.proposalId) {
                    renderProposedTaskCard(data.proposedTask);
                }
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
            if (pipeInterval) clearInterval(pipeInterval);
            if (pipeStatusBadge) {
                pipeStatusBadge.innerText = 'Idle';
                pipeStatusBadge.style.background = '#333';
            }
            if (pipePlan) pipePlan.style.color = 'gray';
            if (pipeExecute) pipeExecute.style.color = 'gray';
            if (pipeVerify) pipeVerify.style.color = 'gray';

            clearTimeout(timeoutId);
            thinkingIndicator.classList.remove('active');
            if (error.name === 'AbortError') {
                appendMessage('ghost', "That took too long — try again or simplify the request.");
            } else {
                appendMessage('ghost', "Critical failure: Server unreachable.");
            }
            activeRunId = null;
        } finally {
            clearTimeout(timeoutId);
            isSubmitting = false;
            userInput.disabled = false;
            sendBtn.disabled = false;
        }
    }

    function renderProposedTaskCard(proposedTask) {
        if (!chatLog || !proposedTask) return;

        const cardContainer = document.createElement('div');
        cardContainer.className = 'chat-bubble assistant-message proposed-task-card-wrapper';

        const card = document.createElement('div');
        card.className = 'proposed-task-card';

        const proposalId = proposedTask.proposalId;

        card.innerHTML = `
            <div class="proposed-task-header">
                <div class="proposed-task-title-row">
                    <span class="proposed-task-badge">📝 Proposed Task</span>
                    <span class="proposed-task-status-tag">Pending Confirmation</span>
                </div>
            </div>
            <div class="proposed-task-content">
                <div class="proposed-task-name">${escapeHtml(proposedTask.title)}</div>
                ${proposedTask.description ? `<p class="proposed-task-desc">${escapeHtml(proposedTask.description)}</p>` : ''}
            </div>
            <div class="proposed-task-notice">
                <span>Task is proposed only. It will not be saved or executed without your confirmation.</span>
            </div>
            <div class="proposed-task-actions" id="actions_${escapeHtml(proposalId)}">
                <button type="button" class="btn-primary-action btn-save-task" id="btnSaveTask_${escapeHtml(proposalId)}">Save Task</button>
                <button type="button" class="btn-secondary-action btn-dismiss-task" id="btnDismissTask_${escapeHtml(proposalId)}">Dismiss</button>
            </div>
            <div id="status_${escapeHtml(proposalId)}" class="proposed-task-feedback" style="display: none;"></div>
        `;

        cardContainer.appendChild(card);
        chatLog.appendChild(cardContainer);
        chatLog.scrollTop = chatLog.scrollHeight;

        const btnSave = card.querySelector(`#btnSaveTask_${proposalId}`);
        const btnDismiss = card.querySelector(`#btnDismissTask_${proposalId}`);
        const actionsDiv = card.querySelector(`#actions_${proposalId}`);
        const statusDiv = card.querySelector(`#status_${proposalId}`);

        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                btnSave.disabled = true;
                if (btnDismiss) btnDismiss.disabled = true;
                btnSave.textContent = 'Saving...';

                try {
                    const res = await fetch(apiUrl('/api/personal/tasks/confirm-proposal'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ proposalId })
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.task) {
                        if (actionsDiv) actionsDiv.style.display = 'none';
                        if (statusDiv) {
                            statusDiv.className = 'proposed-task-feedback success';
                            statusDiv.innerHTML = `🔒 <strong>Pending plan record created — no actions were executed.</strong><br><span style="font-size: 11px; color: #a1a1aa;">No code, tools, or automated actions have been executed.</span>`;
                            statusDiv.style.display = 'block';
                        }
                        showPersonalNotice('Task remembered in workspace.');
                        loadTasks();
                    } else {
                        if (actionsDiv) actionsDiv.style.display = 'none';
                        if (statusDiv) {
                            statusDiv.className = 'proposed-task-feedback error';
                            statusDiv.textContent = data.error || 'This task proposal is no longer available. Please restate your task in chat.';
                            statusDiv.style.display = 'block';
                        }
                    }
                } catch (err) {
                    if (actionsDiv) actionsDiv.style.display = 'none';
                    if (statusDiv) {
                        statusDiv.className = 'proposed-task-feedback error';
                        statusDiv.textContent = `Error: ${err.message}. Please restate your task in chat.`;
                        statusDiv.style.display = 'block';
                    }
                }
            });
        }

        if (btnDismiss) {
            btnDismiss.addEventListener('click', async () => {
                if (btnSave) btnSave.disabled = true;
                btnDismiss.disabled = true;
                btnDismiss.textContent = 'Dismissing...';

                try {
                    await fetch(apiUrl('/api/personal/tasks/dismiss-proposal'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ proposalId })
                    });
                } catch (e) {
                    // Ignore network errors on dismiss
                }

                if (actionsDiv) actionsDiv.style.display = 'none';
                if (statusDiv) {
                    statusDiv.className = 'proposed-task-feedback dim';
                    statusDiv.textContent = 'Task proposal dismissed. Nothing was saved.';
                    statusDiv.style.display = 'block';
                }
            });
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
            } else {
                approveBtn.innerText = "✓ Plan Executed";
                approveBtn.style.background = "var(--accent-emerald)";
            }
        };

        approveBtn.addEventListener('click', executePlan);
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
            } catch (e) {
                hitlDiv.innerHTML = `<span style="color: var(--accent-rose);">Network error.</span>`;
            }
        });

        document.getElementById(`rejectBtn_${actionId}`).addEventListener('click', () => {
            hitlDiv.innerHTML = `<span style="color: var(--accent-rose);">Action rejected by user.</span>`;
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

    function handleGhostResponse(fullText, execution = null, meta = null) {
        fullText = typeof fullText === 'string' ? fullText : '';
        const hasApprovalFlowEvidence = Boolean(meta && ((Array.isArray(meta.plan) && meta.plan.length > 0) || meta.actionRequired === true));
        const hasVerifiedExecutionEvidence = Boolean(hasApprovalFlowEvidence && execution && execution.state === 'succeeded' && Array.isArray(execution.artifacts) && execution.artifacts.length > 0);
        if (!hasVerifiedExecutionEvidence) {
            const looksLikeProvenanceClaim = /(Tool Execution (?:Results|Summary)|Execution Results|workspace_edit_file|workspace_run_command|Script Location|Current directory|file (?:was )?successfully written|requested example was written|run the newly created|\/downloads\/|~\/Ghost\/)/i.test(fullText);
            let sanitizedText = fullText
                .replace(/\[[^\]]+➔[^\]]+\]/g, '')
                .replace(/(?:Tool Execution (?:Results|Summary)|Execution Results|Script Location|Current directory|\[workspace_[^\]]+\]|(?:a )?script (?:was )?written to (?:a )?file|file (?:was )?successfully written|requested example was written|run the newly created)[:\s\.]*/gmi, '')
                .replace(/https?:\/\/localhost:\d+\/downloads\/[^\s)]+/gi, '')
                .replace(/\/downloads\/[^\s)]+/gi, '')
                .replace(/~\/Ghost\/[^\s)]+/gi, '')
                .replace(/^[ \t]*(?:File|Path):.*$/gmi, '')
                .trim();

            if (!sanitizedText || (looksLikeProvenanceClaim && !/```/.test(sanitizedText))) {
                sanitizedText = 'I can provide code or explain an error, but I cannot verify file writes, tool output, or command execution from this chat response.';
            }

            appendMessage('ghost', sanitizedText);
            return;
        }
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

    // --- COLLAPSIBLE SIDEBAR & RESPONSIVE DRAWER WIRING ---
    const appSidebar = document.getElementById('appSidebar');
    const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');

    const navChatBtn = document.getElementById('navChatBtn');
    const navPersonalCoreBtn = document.getElementById('navPersonalCoreBtn');
    const navInspectRepoBtn = document.getElementById('navInspectRepoBtn');
    const navSettingsBtn = document.getElementById('navSettingsBtn');

    let isSidebarCollapsed = false;
    let isMobileDrawerOpen = false;

    function setSidebarCollapsed(collapsed) {
        if (!appSidebar) return;
        isSidebarCollapsed = !!collapsed;
        appSidebar.classList.toggle('collapsed', isSidebarCollapsed);
        if (sidebarCollapseBtn) {
            sidebarCollapseBtn.setAttribute('aria-expanded', String(!isSidebarCollapsed));
            const label = isSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation';
            sidebarCollapseBtn.setAttribute('aria-label', label);
            sidebarCollapseBtn.title = label;
            const icon = sidebarCollapseBtn.querySelector('.collapse-icon');
            if (icon) icon.textContent = isSidebarCollapsed ? '▶' : '◀';
        }
    }

    function openMobileDrawer() {
        if (!appSidebar) return;
        isMobileDrawerOpen = true;
        appSidebar.classList.add('mobile-open');
        if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'true');
        if (sidebarBackdrop) {
            sidebarBackdrop.style.display = 'block';
            sidebarBackdrop.classList.add('active');
        }
    }

    function closeMobileDrawer() {
        if (!appSidebar) return;
        isMobileDrawerOpen = false;
        appSidebar.classList.remove('mobile-open');
        if (mobileMenuBtn) {
            mobileMenuBtn.setAttribute('aria-expanded', 'false');
            mobileMenuBtn.focus();
        }
        if (sidebarBackdrop) {
            sidebarBackdrop.classList.remove('active');
            sidebarBackdrop.style.display = 'none';
        }
    }

    if (sidebarCollapseBtn) {
        sidebarCollapseBtn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                closeMobileDrawer();
            } else {
                setSidebarCollapsed(!isSidebarCollapsed);
            }
        });
        sidebarCollapseBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (window.innerWidth <= 768) {
                    closeMobileDrawer();
                } else {
                    setSidebarCollapsed(!isSidebarCollapsed);
                }
            }
        });
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            if (isMobileDrawerOpen) {
                closeMobileDrawer();
            } else {
                openMobileDrawer();
            }
        });
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', () => {
            closeMobileDrawer();
        });
    }

    // --- WORKSPACE ACTIONS DISCLOSURE ---
    const workspaceActionsBtn = document.getElementById('workspaceActionsBtn');
    const workspaceActionsMenu = document.getElementById('workspaceActionsMenu');
    const workspaceActionsWrapper = document.getElementById('workspaceActionsWrapper');

    let isWorkspaceActionsOpen = false;

    function setWorkspaceActionsOpen(open) {
        if (!workspaceActionsMenu || !workspaceActionsBtn) return;
        isWorkspaceActionsOpen = !!open;
        workspaceActionsMenu.style.display = isWorkspaceActionsOpen ? 'flex' : 'none';
        workspaceActionsBtn.setAttribute('aria-expanded', String(isWorkspaceActionsOpen));
        if (isWorkspaceActionsOpen) {
            const firstVisibleItem = workspaceActionsMenu.querySelector('.menu-item:not([style*="display: none"])');
            if (firstVisibleItem) firstVisibleItem.focus();
        }
    }

    function closeWorkspaceActions() {
        if (!isWorkspaceActionsOpen) return;
        setWorkspaceActionsOpen(false);
        if (workspaceActionsBtn) workspaceActionsBtn.focus();
    }

    if (workspaceActionsBtn) {
        workspaceActionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setWorkspaceActionsOpen(!isWorkspaceActionsOpen);
        });
        workspaceActionsBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                setWorkspaceActionsOpen(true);
            }
        });
    }

    if (workspaceActionsMenu) {
        workspaceActionsMenu.addEventListener('click', (e) => {
            if (e.target.closest('.menu-item')) {
                setWorkspaceActionsOpen(false);
            }
        });
        workspaceActionsMenu.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeWorkspaceActions();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const items = Array.from(workspaceActionsMenu.querySelectorAll('.menu-item')).filter(el => getComputedStyle(el).display !== 'none');
                const currentIndex = items.indexOf(document.activeElement);
                if (items.length > 0) {
                    e.preventDefault();
                    if (e.key === 'ArrowDown') {
                        const nextIndex = (currentIndex + 1) % items.length;
                        items[nextIndex].focus();
                    } else {
                        const prevIndex = (currentIndex - 1 + items.length) % items.length;
                        items[prevIndex].focus();
                    }
                }
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (isWorkspaceActionsOpen && workspaceActionsWrapper && !workspaceActionsWrapper.contains(e.target)) {
            setWorkspaceActionsOpen(false);
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const capStatusModalEl = document.getElementById('capabilityStatusModal');
            if (capStatusModalEl && (capStatusModalEl.style.display === 'flex' || capStatusModalEl.style.display === 'block')) {
                closeCapabilityStatus();
                return;
            }
            const ccModalEl = document.getElementById('controlCenterModal');
            if (ccModalEl && (ccModalEl.style.display === 'flex' || ccModalEl.style.display === 'block')) {
                closeControlCenter();
                return;
            }
            if (isWorkspaceActionsOpen) {
                closeWorkspaceActions();
            } else if (isMobileDrawerOpen) {
                closeMobileDrawer();
            } else if (personalCoreModal && (personalCoreModal.style.display === 'flex' || personalCoreModal.style.display === 'block')) {
                personalCoreModal.style.display = 'none';
                if (navPersonalCoreBtn) navPersonalCoreBtn.focus();
            }
        }
    });

    function setActiveNav(activeId) {
        [navChatBtn, navPersonalCoreBtn, navInspectRepoBtn].forEach(btn => {
            if (btn) btn.classList.toggle('active', btn.id === activeId);
        });
    }

    if (navChatBtn) {
        navChatBtn.addEventListener('click', () => {
            setActiveNav('navChatBtn');
            renderWelcomeCard(masterUser);
            if (userInput) userInput.focus();
            if (window.innerWidth <= 768) closeMobileDrawer();
        });
    }

    if (navPersonalCoreBtn) {
        navPersonalCoreBtn.addEventListener('click', () => {
            setActiveNav('navPersonalCoreBtn');
            renderGuidedWorkspace();
            if (window.innerWidth <= 768) closeMobileDrawer();
        });
    }

    if (navInspectRepoBtn) {
        navInspectRepoBtn.addEventListener('click', () => {
            setActiveNav('navInspectRepoBtn');
            executeRepoInspect();
            if (window.innerWidth <= 768) closeMobileDrawer();
        });
    }

    if (navSettingsBtn) {
        navSettingsBtn.addEventListener('click', () => {
            appendMessage('ghost', 'Ghost settings: All operations are local to this machine. Personal Core and Task Ledger remain owner-only.');
            if (window.innerWidth <= 768) closeMobileDrawer();
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

    // --- GUIDED WORKSPACE V0 ---
    const GUIDED_STARTER_MAP = Object.freeze({
        my_tasks: 'what are my tasks?',
        my_goals: 'show me my goals',
        research_topic: 'research a topic',
        clear_context: 'clear chat context'
    });

    function populateGuidedStarter(key) {
        if (!Object.prototype.hasOwnProperty.call(GUIDED_STARTER_MAP, key)) {
            return;
        }
        const phrase = GUIDED_STARTER_MAP[key];
        if (userInput) {
            userInput.value = phrase;
            userInput.focus();
        }
    }

    const composerShortcutBtns = document.querySelectorAll('.guided-composer-shortcut-btn');
    composerShortcutBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-guidedkey');
            populateGuidedStarter(key);
        });
    });

    function renderGuidedWorkspace() {
        if (!chatLog) return;
        if (!isAdminMode) {
            chatLog.innerHTML = `
                <div class="guided-workspace-panel" style="padding: 24px; color: var(--text-main);">
                    <h2 style="margin-top: 0; font-size: 1.4rem; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">Guided Workspace</h2>
                    <p style="color: var(--text-dim); margin-bottom: 24px;">Welcome to Ghost Private Local AI Workspace. You are currently viewing in visitor mode.</p>
                    <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
                        <h3 style="margin-top: 0; font-size: 1.1rem;">Public Workspace Info</h3>
                        <p style="font-size: 0.9rem; color: var(--text-dim); margin-bottom: 0;">Ghost operates locally and privately. Unlock owner mode to access workspace features.</p>
                    </div>
                </div>
            `;
            return;
        }

        chatLog.innerHTML = `
            <div class="guided-workspace-panel" style="padding: 24px; color: var(--text-main); max-width: 800px; margin: 0 auto;">
                <h2 style="margin-top: 0; font-size: 1.4rem; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 20px;">Guided Workspace</h2>
                <p style="color: var(--text-dim); margin-bottom: 24px;">Discover existing safe workspace capabilities in plain language. Select any prompt starter to place it in chat, or open Control Center.</p>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
                    <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <h3 style="margin-top: 0; font-size: 1.1rem;">My Tasks</h3>
                            <p style="font-size: 0.9rem; color: var(--text-dim);">View your saved pending and planned work.</p>
                        </div>
                        <button type="button" class="btn-primary-action guided-starter-btn" data-guidedkey="my_tasks" style="margin-top: 12px; width: 100%;">Use Prompt Starter</button>
                    </div>

                    <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <h3 style="margin-top: 0; font-size: 1.1rem;">My Goals</h3>
                            <p style="font-size: 0.9rem; color: var(--text-dim);">Review the goals currently guiding this workspace.</p>
                        </div>
                        <button type="button" class="btn-primary-action guided-starter-btn" data-guidedkey="my_goals" style="margin-top: 12px; width: 100%;">Use Prompt Starter</button>
                    </div>

                    <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <h3 style="margin-top: 0; font-size: 1.1rem;">Research a Topic</h3>
                            <p style="font-size: 0.9rem; color: var(--text-dim);">Ask Ghost for a bounded, cited news or research briefing. You will provide the topic and explicitly send the request from normal chat.</p>
                        </div>
                        <button type="button" class="btn-primary-action guided-starter-btn" data-guidedkey="research_topic" style="margin-top: 12px; width: 100%;">Use Prompt Starter</button>
                    </div>

                    <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify: space-between;">
                        <div>
                            <h3 style="margin-top: 0; font-size: 1.1rem;">Clear This Chat Context</h3>
                            <p style="font-size: 0.9rem; color: var(--text-dim);">Remove only temporary chat context for this session. Tasks, goals, files, and Personal Core memories stay unchanged. Placed in chat input; context is not cleared until you explicitly send from normal chat.</p>
                        </div>
                        <button type="button" class="btn-primary-action guided-starter-btn" data-guidedkey="clear_context" style="margin-top: 12px; width: 100%;">Use Prompt Starter</button>
                    </div>

                    <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify: space-between;">
                        <div>
                            <h3 style="margin-top: 0; font-size: 1.1rem;">Control Center</h3>
                            <p style="font-size: 0.9rem; color: var(--text-dim);">Open the owner-only screen for the two existing approval-gated checks. No test runs automatically.</p>
                        </div>
                        <button type="button" class="btn-primary-action guided-cc-btn" style="margin-top: 12px; width: 100%;">Open Control Center</button>
                    </div>
                </div>
            </div>
        `;

        const starterBtns = chatLog.querySelectorAll('.guided-starter-btn');
        starterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.currentTarget.getAttribute('data-guidedkey');
                populateGuidedStarter(key);
            });
        });

        const ccBtn = chatLog.querySelector('.guided-cc-btn');
        if (ccBtn) {
            ccBtn.addEventListener('click', () => {
                if (!isAdminMode) return;
                openControlCenter();
            });
        }
    }

    // --- CAPABILITY STATUS V0 WIRING ---
    const CAPABILITY_STATUS_CATALOGUE = Object.freeze([
        {
            label: 'Available',
            capability: 'Text chat',
            copy: 'Responds to messages you explicitly send.'
        },
        {
            label: 'Available',
            capability: 'Owner tasks and goals',
            copy: 'Shows your saved task and goal views when requested.'
        },
        {
            label: 'Available',
            capability: 'Cited research',
            copy: 'Runs only after you explicitly send a bounded research request; it does not open articles or browse arbitrary URLs.'
        },
        {
            label: 'Needs Approval',
            capability: 'Allowlisted checks',
            copy: 'Only the two existing checks may run, and only after a separate expiring owner confirmation.'
        },
        {
            label: 'Disabled',
            capability: 'Automatic fetching',
            copy: 'No automatic research fetching or background refresh is active.'
        },
        {
            label: 'Not Configured',
            capability: 'Agent coordination',
            copy: 'No agent fleet, schedule, workflow, or background process is configured.'
        },
        {
            label: 'Unsupported',
            capability: 'High-risk control',
            copy: 'Browser, Mac/device, terminal, credentials, external messaging, payments, voice, and Hands-Free Mode are not available.'
        }
    ]);

    let _capStatusOpenerBtn = null;

    function renderCapabilityStatusCatalogue() {
        const container = document.getElementById('capabilityStatusCatalogue');
        if (!container) return;
        container.innerHTML = CAPABILITY_STATUS_CATALOGUE.map(item => `
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; padding: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: 600; font-size: 1rem;">${item.capability}</span>
                    <span style="font-size: 0.8rem; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.08); color: var(--text-main);">${item.label}</span>
                </div>
                <p style="margin: 0; font-size: 0.85rem; color: var(--text-dim);">${item.copy}</p>
            </div>
        `).join('');
    }

    function openCapabilityStatus(openerEl) {
        if (!isAdminMode) return;
        const modal = document.getElementById('capabilityStatusModal');
        if (!modal) return;
        _capStatusOpenerBtn = openerEl || document.activeElement;
        renderCapabilityStatusCatalogue();
        modal.style.display = 'flex';
        const closeBtn = document.getElementById('closeCapabilityStatusBtn');
        if (closeBtn) closeBtn.focus();
    }

    function closeCapabilityStatus() {
        const modal = document.getElementById('capabilityStatusModal');
        if (!modal) return;
        modal.style.display = 'none';
        if (_capStatusOpenerBtn && _capStatusOpenerBtn.isConnected) {
            _capStatusOpenerBtn.focus();
        }
    }

    const capabilityStatusBtn = document.getElementById('capabilityStatusBtn');
    const capabilityStatusModal = document.getElementById('capabilityStatusModal');
    const closeCapabilityStatusBtn = document.getElementById('closeCapabilityStatusBtn');

    if (capabilityStatusBtn) {
        capabilityStatusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openCapabilityStatus(capabilityStatusBtn);
        });
    }

    if (closeCapabilityStatusBtn) {
        closeCapabilityStatusBtn.addEventListener('click', () => {
            closeCapabilityStatus();
        });
    }

    if (capabilityStatusModal) {
        capabilityStatusModal.addEventListener('click', (e) => {
            if (e.target === capabilityStatusModal) {
                closeCapabilityStatus();
            }
        });
        capabilityStatusModal.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const focusables = Array.from(capabilityStatusModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => getComputedStyle(el).display !== 'none');
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        });
    }

    // --- CONTROL CENTER V0 WIRING ---
    const controlCenterBtn = document.getElementById('controlCenterBtn');
    const controlCenterModal = document.getElementById('controlCenterModal');
    const ccCloseBtn = document.getElementById('ccCloseBtn');
    const ccRefreshBtn = document.getElementById('ccRefreshBtn');

    const ccPreviewPanel = document.getElementById('ccPreviewPanel');
    const ccPreviewText = document.getElementById('ccPreviewText');
    const ccConfirmPrepareBtn = document.getElementById('ccConfirmPrepareBtn');
    const ccCancelPreviewBtn = document.getElementById('ccCancelPreviewBtn');

    const ccActiveProposalPanel = document.getElementById('ccActiveProposalPanel');
    const ccActiveProposalText = document.getElementById('ccActiveProposalText');
    const ccConfirmRunBtn = document.getElementById('ccConfirmRunBtn');
    const ccCancelProposalBtn = document.getElementById('ccCancelProposalBtn');

    const ccApprovalQueueData = document.getElementById('ccApprovalQueueData');

    // Frozen two-key mapping — no other keys allowed
    const CC_PREPARE_MAP = Object.freeze({
        session_context: 'prepare test: session context',
        golden_baseline: 'prepare test: golden baseline'
    });

    // Stores the element that opened the CC modal so focus can be returned on close
    let _ccOpenerBtn = null;

    function openControlCenter() {
        if (!isAdminMode) return;
        if (!controlCenterModal) return;
        _ccOpenerBtn = controlCenterBtn;
        controlCenterModal.style.display = 'flex';
        closeWorkspaceActions();
        if (ccCloseBtn) ccCloseBtn.focus();
        // No automatic queue/read request on open
    }

    function closeControlCenter() {
        if (!controlCenterModal) return;
        controlCenterModal.style.display = 'none';
        if (_ccOpenerBtn && _ccOpenerBtn.isConnected) {
            _ccOpenerBtn.focus();
        }
    }

    if (controlCenterBtn) {
        controlCenterBtn.addEventListener('click', () => {
            openControlCenter();
        });
    }

    if (ccCloseBtn) {
        ccCloseBtn.addEventListener('click', () => {
            closeControlCenter();
        });
    }

    // Tab containment inside the CC modal
    if (controlCenterModal) {
        controlCenterModal.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const focusable = Array.from(controlCenterModal.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter(el => el.offsetParent !== null);
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        });
    }

    // Explicit-only refresh — only on ccRefreshBtn click
    if (ccRefreshBtn) {
        ccRefreshBtn.addEventListener('click', () => {
            if (!isAdminMode) return;
            refreshControlCenter();
        });
    }

    // Prepare buttons — show local preview only, no request
    const prepareBtns = document.querySelectorAll('.cc-prepare-btn');
    prepareBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!isAdminMode) return;
            const testKey = e.currentTarget.getAttribute('data-testkey');
            // Reject unknown keys; never fall back to session_context
            if (!Object.prototype.hasOwnProperty.call(CC_PREPARE_MAP, testKey)) {
                currentSelectedTestKey = null;
                if (ccPreviewPanel) ccPreviewPanel.style.display = 'none';
                return;
            }
            currentSelectedTestKey = testKey;
            if (ccPreviewPanel) ccPreviewPanel.style.display = 'block';
            if (ccActiveProposalPanel) ccActiveProposalPanel.style.display = 'none';
            const label = testKey === 'golden_baseline' ? 'Golden Baseline' : 'Session Context';
            if (ccPreviewText) ccPreviewText.innerText = `You are about to prepare the fixed local test for ${label}.\nIt has a strict 30-second cap and raw output is suppressed.\nNothing has run yet.`;
        });
    });

    if (ccCancelPreviewBtn) {
        ccCancelPreviewBtn.addEventListener('click', () => {
            if (ccPreviewPanel) ccPreviewPanel.style.display = 'none';
            currentSelectedTestKey = null;
        });
    }

    async function sendControlCenterRequest(message) {
        try {
            const response = await fetch(apiUrl('/api/chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ message })
            });
            return await response.json();
        } catch (_e) {
            return { success: false, text: 'Control Center request could not be completed.' };
        }
    }

    if (ccConfirmPrepareBtn) {
        ccConfirmPrepareBtn.addEventListener('click', async () => {
            if (!isAdminMode) return;
            if (!currentSelectedTestKey) return;
            // Validate key against frozen map
            if (!Object.prototype.hasOwnProperty.call(CC_PREPARE_MAP, currentSelectedTestKey)) {
                currentSelectedTestKey = null;
                return;
            }
            const phrase = CC_PREPARE_MAP[currentSelectedTestKey];
            ccConfirmPrepareBtn.disabled = true;
            ccConfirmPrepareBtn.innerText = 'Preparing...';

            await sendControlCenterRequest(phrase);

            ccConfirmPrepareBtn.disabled = false;
            ccConfirmPrepareBtn.innerText = 'Send Prepare Request';
            if (ccPreviewPanel) ccPreviewPanel.style.display = 'none';
            currentSelectedTestKey = null;
            // No automatic refresh — use Refresh to view the current owner-safe queue.
            if (ccApprovalQueueData) ccApprovalQueueData.innerText = 'Use Refresh to view the current owner-safe queue.';
        });
    }

    if (ccConfirmRunBtn) {
        ccConfirmRunBtn.addEventListener('click', async () => {
            if (!isAdminMode) return;
            ccConfirmRunBtn.disabled = true;
            ccConfirmRunBtn.innerText = 'Running (up to 30s)...';
            if (ccCancelProposalBtn) ccCancelProposalBtn.disabled = true;

            await sendControlCenterRequest('confirm test run');

            ccConfirmRunBtn.disabled = false;
            ccConfirmRunBtn.innerText = 'Confirm and Run';
            if (ccCancelProposalBtn) ccCancelProposalBtn.disabled = false;
            // No automatic refresh — use Refresh to view the current owner-safe queue.
            if (ccApprovalQueueData) ccApprovalQueueData.innerText = 'Use Refresh to view the current owner-safe queue.';
        });
    }

    if (ccCancelProposalBtn) {
        ccCancelProposalBtn.addEventListener('click', async () => {
            if (!isAdminMode) return;
            ccCancelProposalBtn.disabled = true;
            await sendControlCenterRequest('cancel test proposal');
            ccCancelProposalBtn.disabled = false;
            // No automatic refresh — use Refresh to view the current owner-safe queue.
            if (ccApprovalQueueData) ccApprovalQueueData.innerText = 'Use Refresh to view the current owner-safe queue.';
        });
    }

    async function refreshControlCenter() {
        if (!isAdminMode) return;
        if (!ccApprovalQueueData) return;
        ccApprovalQueueData.innerText = 'Refreshing...';

        const data = await sendControlCenterRequest('show my approval queue');
        if (data.success && data.text) {
            ccApprovalQueueData.innerText = data.text;

            if (data.text.includes('Pending allowlisted test proposal')) {
                if (ccActiveProposalPanel) ccActiveProposalPanel.style.display = 'block';
                const match = data.text.match(/Pending allowlisted test proposal for `([^`]+)`/);
                const proposalName = match ? match[1] : 'Unknown';
                if (ccActiveProposalText) ccActiveProposalText.innerText = `Proposal active: ${proposalName}.`;
            } else {
                if (ccActiveProposalPanel) ccActiveProposalPanel.style.display = 'none';
            }
        } else {
            ccApprovalQueueData.innerText = 'Failed to load queue.';
        }
    }
});

    async function loadSkillsV0() {
        if (!skillsListContainer) return;
        skillsListContainer.innerHTML = '<div class="loading-state">Loading skills...</div>';
        try {
            const res = await fetch(apiUrl('/api/skills'), { credentials: 'include' });
            const data = await res.json();
            if (res.ok && data.success) {
                renderSkillsList(data.skills);
            } else {
                skillsListContainer.innerHTML = '<div class="loading-state">Failed to load skills.</div>';
            }
        } catch (err) {
            skillsListContainer.innerHTML = '<div class="loading-state">Error loading skills.</div>';
        }
    }

    function renderSkillsList(skills) {
        if (!skillsListContainer) return;
        skillsListContainer.innerHTML = '';
        if (!skills || skills.length === 0) {
            skillsListContainer.innerHTML = '<div class="empty-state">No skills available.</div>';
            return;
        }
        skills.forEach(skill => {
            const card = document.createElement('div');
            card.className = 'personal-item-card';
            card.style.borderLeft = '3px solid var(--accent-primary)';
            card.style.padding = '12px';
            card.style.marginBottom = '12px';
            card.style.backgroundColor = 'var(--surface-color)';
            card.style.borderRadius = '4px';

            const title = document.createElement('h4');
            title.textContent = skill.title;
            title.style.margin = '0 0 8px 0';

            const desc = document.createElement('p');
            desc.textContent = skill.whatItDoes;
            desc.style.margin = '0 0 8px 0';
            desc.style.fontSize = '0.9em';

            const limit = document.createElement('div');
            limit.style.fontSize = '0.85em';
            limit.style.color = 'var(--text-secondary)';
            limit.style.padding = '6px';
            limit.style.backgroundColor = 'var(--background-color)';
            limit.style.borderRadius = '4px';
            limit.style.border = '1px solid var(--border-color)';
            limit.innerHTML = '<strong>Limit:</strong> ' + skill.exactLimit;

            card.appendChild(title);
            card.appendChild(desc);
            card.appendChild(limit);
            skillsListContainer.appendChild(card);
        });
    }
