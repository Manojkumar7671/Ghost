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

// --- VOICE SYNTHESIS MATRIX ---
let ghostVoice = null;
function loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    // Prioritize premium British/Male voices for the 'Ghost' persona
    ghostVoice = voices.find(v => v.name.includes('Google UK English Male')) || 
                 voices.find(v => v.name.includes('Daniel')) || 
                 voices.find(v => v.lang === 'en-GB') || 
                 voices.find(v => v.lang === 'en-US') || 
                 voices[0];
}
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
}

function typeSubtitles(textToDisplay, textToSpeak = null) {
    const speakText = textToSpeak || textToDisplay;
    ghostSubtitles.style.opacity = 1;
    const glowColor = isAdminMode ? '#ff0032' : '#00ffcc';
    ghostSubtitles.style.textShadow = `0 0 15px ${glowColor}, 0 0 5px ${glowColor}`;
    
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(speakText);
        if (ghostVoice) msg.voice = ghostVoice;
        msg.rate = 1.05;
        msg.pitch = isAdminMode ? 0.8 : 1.0; 
        window.speechSynthesis.speak(msg);
    }

    let i = 0;
    ghostSubtitles.innerHTML = "";
    function typeChar() {
        if (i < textToDisplay.length) {
            ghostSubtitles.innerHTML += textToDisplay.charAt(i);
            i++;
            setTimeout(typeChar, 25); 
        } else {
            setTimeout(() => { ghostSubtitles.style.opacity = 0; }, 6000);
        }
    }
    typeChar();
}

// --- THEME & LOGIC ROUTING ---
function setTheme(isAdmin) {
    const mainColor = isAdmin ? '#ff0032' : '#00ffcc';
    statusIndicator.style.color = mainColor;
    statusIndicator.style.textShadow = `0 0 10px ${mainColor}`;
    statusIndicator.innerText = isAdmin ? "ADMIN // ACTIVE" : "GHOST // STANDBY";
    
    if (isAdmin) {
        disconnectBtn.classList.add('admin-mode');
        sidebarToggle.classList.add('admin-mode');
        authTitle.style.color = mainColor;
        authTitle.style.textShadow = `0 0 10px ${mainColor}`;
        ghostCodeBtn.classList.remove('hidden');
        sidebarTitleText.innerText = "ADMIN DATABANKS";
    } else {
        disconnectBtn.classList.remove('admin-mode');
        sidebarToggle.classList.remove('admin-mode');
        ghostCodeBtn.classList.add('hidden');
        isGhostCodeActive = false;
        sidebarTitleText.innerText = "SYSTEM LOGS";
        updateGhostCodeBtnUI();
    }

    chatInput.style.borderColor = mainColor;
    chatInput.style.color = mainColor;
    sidebar.style.borderLeftColor = mainColor;
    sidebarTitleText.style.color = mainColor;
    sidebarTitleText.style.textShadow = `0 0 5px ${mainColor}`;
    closeSidebar.style.color = mainColor;
    closeSidebar.style.textShadow = `0 0 5px ${mainColor}`;
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
        typeSubtitles("Admin access granted. High-power cognition online.", "Admin access granted. High-power cognition online.");
    } else {
        currentUser = inputVal;
        isAdminMode = false;
        setTheme(false);
        typeSubtitles(`Initialization complete. Welcome, ${currentUser}.`, `Initialization complete. Welcome to the Matrix, ${currentUser}. I am Ghost.`);
    }
    logToSidebar(`[AUTH] User '${currentUser}' authenticated.`);
}

authInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') initializeGhost(); });

// --- DOUBLE TAP LOGIC ---
document.addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('#sidebar')) return;
    if (!authOverlay.classList.contains('hidden')) return; 

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
    sidebarContentArea.innerHTML += `<br><br><span style="color:#555">[${timestamp}]</span><br>${text}`;
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
    typeSubtitles(`NemoClaw Sandbox is now ${state}.`, `Nemo claw matrix ${state}.`);
});

// --- CORE COMMUNICATION LOOP ---
async function sendToCore() {
    if (chatInput.value.trim() === '') return;
    const payload = chatInput.value.trim();
    
    chatInterface.classList.remove('visible'); 
    isChatVisible = false;
    
    statusIndicator.innerText = isAdminMode ? "ADMIN // PROCESSING..." : "GHOST // PROCESSING...";
    typeSubtitles("Analyzing directive...", "Analyzing.");
    logToSidebar(`<span style="color:#00ffcc">[USER] ${payload}</span>`);

    try {
        const response = await fetch('/api/chat', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ message: payload, user: currentUser, image: targetImageBase64, ghostCodeMode: isGhostCodeActive }) 
        });
        const data = await response.json();
        
        if (data.success) {
            const fullText = data.text;
            
            // SIDEBAR ROUTING LOGIC: If it contains code or terminal output
            if (fullText.includes('\`\`\`') || fullText.includes('[NemoClaw Virtual Machine Online')) {
                const summary = "Execution complete. Terminal data routed to the sidebar matrix.";
                typeSubtitles(summary, summary); // Speak and type only the clean summary
                
                // Format the code block cleanly for the sidebar
                const formattedText = fullText
                    .replace(/\n/g, '<br>')
                    .replace(/\`\`\`python/g, '<div style="background:#111; border:1px solid #cc00ff; padding:10px; margin:10px 0; font-family:monospace; color:#eee;">')
                    .replace(/\`\`\`/g, '</div>');
                    
                logToSidebar(`<strong style="color:#cc00ff">[NEMOCLAW OUTPUT]</strong><br>${formattedText}`);
                
                // Auto-open the sidebar to reveal the payload
                setTimeout(() => { sidebar.classList.add('open'); }, 1500);
            } else {
                // Normal conversational response
                typeSubtitles(fullText, fullText);
                logToSidebar(`[GHOST]<br>${fullText}`);
            }
        }
    } catch (e) {
        typeSubtitles("System fault. Neural routing error.");
    }
    
    chatInput.value = "";
    targetImageBase64 = null;
    statusIndicator.innerText = isAdminMode ? "ADMIN // ACTIVE" : "GHOST // STANDBY";
}

chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendToCore(); });

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
});

// ==========================================
// --- THREE.JS WEBGL PARTICLE MATRIX ---
// ==========================================
const canvas = document.getElementById('bg-canvas');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.02); 

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

const particlesCount = 8000;
const posArray = new Float32Array(particlesCount * 3);
const phaseArray = new Float32Array(particlesCount);

for(let i = 0; i < particlesCount * 3; i+=3) {
    const radius = 12;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    posArray[i] = radius * Math.sin(phi) * Math.cos(theta); 
    posArray[i+1] = radius * Math.sin(phi) * Math.sin(theta); 
    posArray[i+2] = radius * Math.cos(phi); 
    phaseArray[i/3] = Math.random() * Math.PI * 2;
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
geometry.setAttribute('phase', new THREE.BufferAttribute(phaseArray, 1));

const material = new THREE.PointsMaterial({ size: 0.08, color: 0x00ffcc, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
const particleMesh = new THREE.Points(geometry, material);
scene.add(particleMesh);

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

const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const elapsedTime = clock.getElapsedTime();
    particleMesh.rotation.y = elapsedTime * 0.05;
    particleMesh.rotation.x = elapsedTime * 0.02;
    ringMesh.rotation.y = elapsedTime * -0.02;
    ringMesh.rotation.z = elapsedTime * 0.01;

    const positions = geometry.attributes.position.array;
    const phases = geometry.attributes.phase.array;
    for(let i = 0; i < particlesCount; i++) {
        const i3 = i * 3;
        const phase = phases[i];
        const pulse = Math.sin(elapsedTime * 2 + phase) * 0.03 + 1; 
        const x = positions[i3];
        const y = positions[i3+1];
        const z = positions[i3+2];
        const length = Math.sqrt(x*x + y*y + z*z);
        const targetRadius = 12 * pulse;
        positions[i3] = (x / length) * targetRadius;
        positions[i3+1] = (y / length) * targetRadius;
        positions[i3+2] = (z / length) * targetRadius;
    }
    geometry.attributes.position.needsUpdate = true;
    particleMesh.rotation.x += mouseY * 0.0005;
    particleMesh.rotation.y += mouseX * 0.0005;
    renderer.render(scene, camera);
}

let mouseX = 0, mouseY = 0;
document.addEventListener('mousemove', (e) => { mouseX = (e.clientX - window.innerWidth / 2); mouseY = (e.clientY - window.innerHeight / 2); });
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
animate();