// --- STATE & CONFIG ---
const MASTER_PASSCODE = "knightfall";
let currentUser = "Guest";
let isAdminMode = false;
let isGhostCodeActive = false;
let targetImageBase64 = null;
let isChatVisible = false;

// --- DOM ELEMENTS ---
const authOverlay = document.getElementById('auth-overlay');
const authInput = document.getElementById('authInput');
const authTitle = document.getElementById('auth-title');
const chatInterface = document.getElementById('chat-interface');
const chatInput = document.getElementById('chatInput');
const disconnectBtn = document.getElementById('disconnect-btn');
const ghostCodeBtn = document.getElementById('ghost-code-btn');
const statusIndicator = document.getElementById('status-indicator');
const ghostSubtitles = document.getElementById('ghost-subtitles');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const closeSidebar = document.getElementById('close-sidebar');
const sidebarTitleText = document.getElementById('sidebar-title-text');
const sidebarContentArea = document.getElementById('sidebar-content-area');

// --- THEME & LOGIC ROUTING ---
function setTheme(isAdmin) {
    const mainColor = isAdmin ? '#ff0032' : '#00ffcc';
    const mainGlow = isAdmin ? 'rgba(255,0,50,0.8)' : 'rgba(0,255,204,0.8)';
    
    // Status
    statusIndicator.style.color = mainColor;
    statusIndicator.style.textShadow = `0 0 10px ${mainColor}`;
    statusIndicator.innerText = isAdmin ? "ADMIN // ACTIVE" : "GHOST // STANDBY";
    
    // Buttons
    if (isAdmin) {
        disconnectBtn.classList.add('admin-mode');
        sidebarToggle.classList.add('admin-mode');
        authTitle.style.color = mainColor;
        authTitle.style.textShadow = `0 0 10px ${mainColor}`;
        ghostCodeBtn.classList.remove('hidden'); // UNLOCK GHOST CODE
        sidebarTitleText.innerText = "ADMIN DATABANKS";
    } else {
        disconnectBtn.classList.remove('admin-mode');
        sidebarToggle.classList.remove('admin-mode');
        ghostCodeBtn.classList.add('hidden'); // LOCK GHOST CODE
        isGhostCodeActive = false;
        sidebarTitleText.innerText = "SYSTEM LOGS";
        updateGhostCodeBtnUI();
    }

    // Chat UI & Sidebar styling
    chatInput.style.borderColor = mainColor;
    chatInput.style.color = mainColor;
    sidebar.style.borderLeftColor = mainColor;
    sidebarTitleText.style.color = mainColor;
    sidebarTitleText.style.textShadow = `0 0 5px ${mainColor}`;
    closeSidebar.style.color = mainColor;
    closeSidebar.style.textShadow = `0 0 5px ${mainColor}`;
}

// --- TYPEWRITER SUBTITLE EFFECT ---
let typeWriterTimeout;
function typeSubtitles(text) {
    clearTimeout(typeWriterTimeout);
    ghostSubtitles.style.opacity = 1;
    
    // Set glow color based on admin state
    const glowColor = isAdminMode ? '#ff0032' : '#00ffcc';
    ghostSubtitles.style.textShadow = `0 0 15px ${glowColor}, 0 0 5px ${glowColor}`;
    
    let i = 0;
    ghostSubtitles.innerHTML = "";
    
    // Vocal synthesis (Browser TTS)
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text);
        msg.rate = 1.05;
        msg.pitch = isAdminMode ? 0.8 : 1.0; 
        window.speechSynthesis.speak(msg);
    }

    function typeChar() {
        if (i < text.length) {
            ghostSubtitles.innerHTML += text.charAt(i);
            i++;
            typeWriterTimeout = setTimeout(typeChar, 25); // Typing speed
        } else {
            // Fade out after 6 seconds of completion
            typeWriterTimeout = setTimeout(() => {
                ghostSubtitles.style.opacity = 0;
            }, 6000);
        }
    }
    typeChar();
}

// --- INITIALIZATION ---
function initializeGhost() {
    const inputVal = authInput.value.trim();
    if (!inputVal) return;

    authOverlay.style.opacity = '0';
    setTimeout(() => authOverlay.classList.add('hidden'), 500);
    
    disconnectBtn.classList.remove('hidden');
    sidebarToggle.classList.remove('hidden');
    authInput.value = "";

    if (inputVal === MASTER_PASSCODE) {
        currentUser = "Master Manoj";
        isAdminMode = true;
        setTheme(true);
        typeSubtitles("Admin access granted. High-power cognition online. Ready for execution, Master Manoj.");
    } else {
        currentUser = inputVal;
        isAdminMode = false;
        setTheme(false);
        typeSubtitles(`Initialization complete. Welcome to the Matrix, ${currentUser}. I am Ghost.`);
    }

    logToSidebar(`[AUTH] User '${currentUser}' authenticated.`);
}

authInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') initializeGhost();
});

// --- DOUBLE TAP LOGIC ---
document.addEventListener('dblclick', (e) => {
    // Prevent double tap from triggering if clicking buttons or inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('#sidebar')) return;
    
    if (!authOverlay.classList.contains('hidden')) return; // Don't trigger on login screen

    isChatVisible = !isChatVisible;
    if (isChatVisible) {
        chatInterface.classList.add('visible');
        chatInput.focus();
    } else {
        chatInterface.classList.remove('visible');
        chatInput.blur();
    }
});

// --- SIDEBAR LOGIC ---
sidebarToggle.addEventListener('click', () => { sidebar.classList.add('open'); });
closeSidebar.addEventListener('click', () => { sidebar.classList.remove('open'); });

function logToSidebar(text) {
    const timestamp = new Date().toLocaleTimeString();
    sidebarContentArea.innerHTML += `<br><span style="color:#555">[${timestamp}]</span> ${text}`;
    sidebarContentArea.scrollTop = sidebarContentArea.scrollHeight;
}

// --- GHOST CODE TOGGLE ---
function updateGhostCodeBtnUI() {
    if (isGhostCodeActive) {
        ghostCodeBtn.innerText = "[GHOST CODE: ON]";
        ghostCodeBtn.classList.add('ghost-code-on');
    } else {
        ghostCodeBtn.innerText = "[GHOST CODE: OFF]";
        ghostCodeBtn.classList.remove('ghost-code-on');
    }
}

ghostCodeBtn.addEventListener('click', () => {
    isGhostCodeActive = !isGhostCodeActive;
    updateGhostCodeBtnUI();
    const state = isGhostCodeActive ? "ACTIVATED" : "OFFLINE";
    typeSubtitles(`NemoClaw Sandbox execution matrix is now ${state}.`);
    logToSidebar(`[SYSTEM] Ghost Code Matrix -> ${state}`);
});

// --- CORE COMMUNICATION LOOP ---
async function sendToCore() {
    if (chatInput.value.trim() === '') return;
    const payload = chatInput.value.trim();
    
    chatInterface.classList.remove('visible'); // Auto-hide chat box on send
    isChatVisible = false;
    
    statusIndicator.innerText = isAdminMode ? "ADMIN // PROCESSING..." : "GHOST // PROCESSING...";
    ghostSubtitles.style.opacity = 1;
    ghostSubtitles.innerText = "Analyzing directive...";

    logToSidebar(`[USER] ${payload}`);

    try {
        const response = await fetch('/api/chat', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                message: payload, 
                user: currentUser,
                image: targetImageBase64,
                ghostCodeMode: isGhostCodeActive 
            }) 
        });
        const data = await response.json();
        
        if (data.success) {
            typeSubtitles(data.text);
            logToSidebar(`[GHOST] Response generated (${data.text.length} chars)`);
        }
    } catch (e) {
        typeSubtitles("System fault. Neural routing error.");
        logToSidebar(`[ERROR] Matrix routing fault.`);
    }
    
    chatInput.value = "";
    targetImageBase64 = null;
    statusIndicator.innerText = isAdminMode ? "ADMIN // ACTIVE" : "GHOST // STANDBY";
}

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendToCore();
});

// --- DISCONNECT ---
disconnectBtn.addEventListener('click', () => {
    currentUser = "Guest";
    isAdminMode = false;
    isGhostCodeActive = false;
    
    authOverlay.classList.remove('hidden');
    setTimeout(() => authOverlay.style.opacity = '1', 50);
    
    disconnectBtn.classList.add('hidden');
    sidebarToggle.classList.add('hidden');
    ghostCodeBtn.classList.add('hidden');
    chatInterface.classList.remove('visible');
    sidebar.classList.remove('open');
    isChatVisible = false;
    
    authInput.value = '';
    authInput.focus();
    
    setTheme(false);
    ghostSubtitles.style.opacity = 0;
    statusIndicator.innerText = "GHOST // OFFLINE";
});


// ==========================================
// --- THREE.JS WEBGL PARTICLE MATRIX ---
// ==========================================
const canvas = document.getElementById('bg-canvas');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.02); // Deep space fade

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

// 1. Core Sphere (Dense, fluid particles)
const particlesCount = 8000;
const posArray = new Float32Array(particlesCount * 3);
const phaseArray = new Float32Array(particlesCount); // For fluid pulsing

for(let i = 0; i < particlesCount * 3; i+=3) {
    // Generate points on a sphere
    const radius = 12;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    posArray[i] = radius * Math.sin(phi) * Math.cos(theta); // x
    posArray[i+1] = radius * Math.sin(phi) * Math.sin(theta); // y
    posArray[i+2] = radius * Math.cos(phi); // z

    phaseArray[i/3] = Math.random() * Math.PI * 2;
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
geometry.setAttribute('phase', new THREE.BufferAttribute(phaseArray, 1));

// Custom material for glowing, soft points
const material = new THREE.PointsMaterial({
    size: 0.08,
    color: 0x00ffcc,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

const particleMesh = new THREE.Points(geometry, material);
scene.add(particleMesh);

// 2. Outer Ring (Atmospheric dust)
const ringGeo = new THREE.BufferGeometry();
const ringCount = 2000;
const ringPos = new Float32Array(ringCount * 3);
for(let i = 0; i < ringCount * 3; i+=3) {
    const radius = 16 + Math.random() * 8;
    const theta = Math.random() * Math.PI * 2;
    const ySpread = (Math.random() - 0.5) * 4;

    ringPos[i] = radius * Math.cos(theta);
    ringPos[i+1] = ySpread;
    ringPos[i+2] = radius * Math.sin(theta);
}
ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
const ringMat = new THREE.PointsMaterial({ size: 0.05, color: 0x00ffcc, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending });
const ringMesh = new THREE.Points(ringGeo, ringMat);
scene.add(ringMesh);

camera.position.z = 35;

// Dynamic Theme Observer for 3D Particles
const observer = new MutationObserver(() => {
    const statusColor = statusIndicator.style.color;
    if (statusColor === 'rgb(255, 0, 50)' || statusColor === '#ff0032') {
        material.color.setHex(0xff0032);
        ringMat.color.setHex(0xff0032);
    } else {
        material.color.setHex(0x00ffcc);
        ringMat.color.setHex(0x00ffcc);
    }
});
observer.observe(statusIndicator, { attributes: true, attributeFilter: ['style'] });

// Animation Loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const elapsedTime = clock.getElapsedTime();

    // Rotate Meshes
    particleMesh.rotation.y = elapsedTime * 0.05;
    particleMesh.rotation.x = elapsedTime * 0.02;
    ringMesh.rotation.y = elapsedTime * -0.02;
    ringMesh.rotation.z = elapsedTime * 0.01;

    // Organic Breathing Effect on Core Sphere
    const positions = geometry.attributes.position.array;
    const phases = geometry.attributes.phase.array;
    for(let i = 0; i < particlesCount; i++) {
        const i3 = i * 3;
        const phase = phases[i];
        
        // Calculate pulse scale based on time and individual particle phase
        const pulse = Math.sin(elapsedTime * 2 + phase) * 0.03 + 1; 
        
        // Base radius mapping
        const x = positions[i3];
        const y = positions[i3+1];
        const z = positions[i3+2];
        
        // Normalize vector to maintain spherical shape while pulsing
        const length = Math.sqrt(x*x + y*y + z*z);
        const targetRadius = 12 * pulse;
        
        positions[i3] = (x / length) * targetRadius;
        positions[i3+1] = (y / length) * targetRadius;
        positions[i3+2] = (z / length) * targetRadius;
    }
    geometry.attributes.position.needsUpdate = true;

    // Mouse Parallax interaction
    particleMesh.rotation.x += mouseY * 0.0005;
    particleMesh.rotation.y += mouseX * 0.0005;

    renderer.render(scene, camera);
}

// Mouse Tracking for Parallax
let mouseX = 0;
let mouseY = 0;
document.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX - window.innerWidth / 2);
    mouseY = (event.clientY - window.innerHeight / 2);
});

// Resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();