let currentUser = "Guest";
let isAdminMode = false;
const MASTER_PASSCODE = "knightfall"; 

const authLayer = document.getElementById('auth-layer');
const authInput = document.getElementById('auth-input');
const authBtn = document.getElementById('auth-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const sidebarHeader = document.getElementById('sidebar-header');

function forceUnlockAudio() {
    try {
        let silent = new SpeechSynthesisUtterance('');
        silent.volume = 0;
        window.speechSynthesis.speak(silent);
        if (window.speechSynthesis.resume) window.speechSynthesis.resume();
    } catch(e) {}
}

document.body.addEventListener('click', forceUnlockAudio, { once: true });
document.body.addEventListener('touchstart', forceUnlockAudio, { once: true });
document.body.addEventListener('keydown', forceUnlockAudio, { once: true });

authBtn.addEventListener('click', initializeGhost);
authInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') initializeGhost(); });

function setTheme(admin) {
    const color = admin ? '#ff0032' : '#00d4ff';
    const borderColor = admin ? 'rgba(255,0,50,0.4)' : 'rgba(0,212,255,0.4)';
    const bgColor = admin ? 'rgba(30,0,10,0.85)' : 'rgba(0,20,30,0.85)';
    const glow = admin ? '0 0 8px rgba(255,0,50,0.8)' : '0 0 8px rgba(0,212,255,0.8)';

    document.getElementById('status-indicator').style.color = color;
    document.getElementById('subtitle-display').style.color = color;
    document.getElementById('subtitle-display').style.borderColor = borderColor;
    document.getElementById('subtitle-display').style.background = bgColor;
    document.getElementById('subtitle-display').style.textShadow = glow;
    document.title = admin ? "Ghost OS // ADMIN" : "Ghost OS";
}

function initializeGhost() {
    const inputVal = authInput.value.trim();
    if (!inputVal) return;

    authLayer.classList.add('hidden');
    disconnectBtn.classList.add('visible');
    authInput.value = "";

    if (inputVal === MASTER_PASSCODE) {
        currentUser = "Master Manoj";
        isAdminMode = true;
        setTheme(true);
        sidebarHeader.innerHTML = '<strong style="color:#ff0032">ADMIN DATA MATRIX</strong><button id="close-sidebar" style="color:#ff0032">✕</button>';
        document.getElementById('close-sidebar').addEventListener('click', () => { codeSidebar.classList.remove('open'); });
        speakText("Admin access granted. Welcome back, Master Manoj. All systems online and unrestricted.");
    } else {
        currentUser = inputVal;
        isAdminMode = false;
        setTheme(false);
        sidebarHeader.innerHTML = '<strong>GHOST DATA MATRIX</strong><button id="close-sidebar">✕</button>';
        document.getElementById('close-sidebar').addEventListener('click', () => { codeSidebar.classList.remove('open'); });
        speakText(`Initialization complete. Welcome, ${currentUser}. I am Ghost, an AI architecture engineered by Manoj Kumar. How may I assist you today?`);
    }

    fetch('/api/auth', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ user: currentUser, status: 'ACTIVE' }) 
    }).catch(e => console.log("Database logging offline."));
}

disconnectBtn.addEventListener('click', () => {
    fetch('/api/auth', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ user: currentUser, status: 'INACTIVE' }) 
    }).catch(e => console.log("Database offline."));
    
    speakText("Logging off. Securing terminal.");
    authLayer.classList.remove('hidden');
    disconnectBtn.classList.remove('visible');
    currentUser = "Guest";
    isAdminMode = false;
    setTheme(false);
});

// --- 1. NON-STOP PARTICLE SWARM ---
const container = document.getElementById('webgl-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const colors = {
    idle: new THREE.Color(0x00d4ff), idleAdmin: new THREE.Color(0xff0032),
    listening: new THREE.Color(0x0055ff), processing: new THREE.Color(0xffaa00),
    talking: new THREE.Color(0x00ffcc), talkingAdmin: new THREE.Color(0xff6600)
};
const geometry = new THREE.SphereGeometry(2, 64, 64); 
const material = new THREE.PointsMaterial({ color: colors.idle, size: 0.02, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
const coreParticles = new THREE.Points(geometry, material);
scene.add(coreParticles);

const positionAttribute = geometry.attributes.position;
const basePositions = [];
for (let i = 0; i < positionAttribute.count; i++) basePositions.push(new THREE.Vector3().fromBufferAttribute(positionAttribute, i));

let isProcessing = false; let isListening = false; let isTalking = false;

function animate() {
    requestAnimationFrame(animate);
    const time = Date.now() * 0.001; 
    let targetColor = isAdminMode ? colors.idleAdmin : colors.idle;
    let targetScale = 1.0 + Math.sin(time * 2) * 0.02; let amplitude = 1.0;

    if (isTalking) { targetColor = isAdminMode ? colors.talkingAdmin : colors.talking; targetScale = 1.05 + Math.sin(time * 5) * 0.03; amplitude = 2.0; } 
    else if (isProcessing) { targetColor = colors.processing; targetScale = 1.08 + Math.sin(time * 10) * 0.04; amplitude = 3.5; } 
    else if (isListening) { targetColor = colors.listening; targetScale = 0.98 + Math.sin(time * 8) * 0.02; amplitude = 1.5; }

    material.color.lerp(targetColor, 0.05);
    for (let i = 0; i < positionAttribute.count; i++) {
        const bp = basePositions[i];
        const noiseX = Math.sin(time * 2.0 + bp.y * 3.0) * 0.05; const noiseY = Math.cos(time * 2.5 + bp.z * 3.0) * 0.05; const noiseZ = Math.sin(time * 3.0 + bp.x * 3.0) * 0.05;
        positionAttribute.setXYZ(i, bp.x + noiseX * amplitude, bp.y + noiseY * amplitude, bp.z + noiseZ * amplitude);
    }
    positionAttribute.needsUpdate = true; 
    coreParticles.rotation.x += 0.001; coreParticles.rotation.y += isProcessing ? 0.02 : 0.002;
    coreParticles.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

// --- 2. UI INTERACTION ---
const inputLayer = document.getElementById('input-layer'); 
const commandInput = document.getElementById('command-input');
const codeSidebar = document.getElementById('code-sidebar'); 
const codeContent = document.getElementById('code-content');
const statusIndicator = document.getElementById('status-indicator');
const subtitleDisplay = document.getElementById('subtitle-display'); 
const fileUpload = document.getElementById('file-upload');

let lastTap = 0;
document.addEventListener('dblclick', toggleInput);
document.addEventListener('touchend', (e) => {
    const currentTime = new Date().getTime();
    if (currentTime - lastTap < 500 && currentTime - lastTap > 0) { toggleInput(); e.preventDefault(); }
    lastTap = currentTime;
});

function toggleInput() { inputLayer.classList.toggle('active'); if (inputLayer.classList.contains('active')) commandInput.focus(); }

commandInput.addEventListener('keydown', () => { 
    try { if (window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); isTalking = false; } } catch(e){}
});

let attachedFileContent = ""; let attachedFileName = "";
fileUpload.addEventListener('change', (e) => {
    if(e.target.files.length > 0) {
        const file = e.target.files[0];
        if (file.name.toLowerCase().endsWith('.pdf') || file.name.toLowerCase().endsWith('.docx')) {
            statusIndicator.innerText = `GHOST // ERROR: UNSUPPORTED FORMAT`;
            speakText("I apologize, but my native parsers cannot read binary PDF documents. Please upload plain text formats like .txt or .js");
            fileUpload.value = ""; return;
        }
        const reader = new FileReader();
        reader.onload = function(event) {
            attachedFileContent = event.target.result; attachedFileName = file.name;
            statusIndicator.innerText = `GHOST // FILE LOADED: ${file.name}`;
            speakText(`Data from ${file.name} loaded into the matrix. Awaiting instructions.`);
        };
        reader.readAsText(file);
    }
});

let availableVoices = []; 
try { window.speechSynthesis.onvoiceschanged = () => { availableVoices = window.speechSynthesis.getVoices(); }; } catch(e){}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
let handsFreeActive = false;

if (recognition) {
    recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US'; 
    recognition.onstart = () => { isListening = true; statusIndicator.innerText = `${isAdminMode ? 'ADMIN' : 'GHOST'} // LISTENING (${currentUser})`; };
    recognition.onresult = (event) => {
        isListening = false; statusIndicator.innerText = `${isAdminMode ? 'ADMIN' : 'GHOST'} // PROCESSING`;
        sendToCore(event.results[0][0].transcript);
    };
    recognition.onend = () => { isListening = false; }
    recognition.onerror = () => { isListening = false; statusIndicator.innerText = `${isAdminMode ? 'ADMIN' : 'GHOST'} // STANDBY (${currentUser})`; };
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#input-layer') || e.target.closest('#code-sidebar') || e.target.closest('.icon-btn') || e.target.closest('#auth-layer') || e.target.closest('#disconnect-btn')) return;
    try { if (window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); isTalking = false; } } catch(e){}
    if (recognition && !isProcessing) { handsFreeActive = true; try { recognition.start(); } catch(err) {} }
});

commandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && commandInput.value.trim() !== '') {
        try {
            window.speechSynthesis.cancel();
            let prime = new SpeechSynthesisUtterance('');
            prime.volume = 0;
            window.speechSynthesis.speak(prime);
        } catch(err){}
        sendToCore(commandInput.value.trim()); 
        commandInput.value = '';
    }
});

async function sendToCore(message) {
    isProcessing = true;
    if (handsFreeActive && recognition) recognition.stop(); 
    subtitleDisplay.classList.remove('visible'); 

    let finalPayload = message;
    if (attachedFileContent !== "") {
        finalPayload += `\n\n[SYSTEM NOTE: Attached file: ${attachedFileName}]\n\`\`\`\n${attachedFileContent}\n\`\`\``;
        attachedFileContent = ""; attachedFileName = ""; fileUpload.value = ""; 
    }

    try {
        const response = await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: finalPayload, user: currentUser }) 
        });
        const data = await response.json();
        if (data.success) handleGhostResponse(data.text);
        else speakText("System error. Investigating.");
    } catch (error) {
        speakText("Critical fault. Unable to reach core engine.");
    } finally {
        isProcessing = false;
    }
}

// 🛑 BULLETPROOF REGEX PARSER 🛑
function handleGhostResponse(rawText) {
    let spokenText = rawText; 
    let sidebarData = "";

    // Extract EVERYTHING inside Markdown code blocks (```)
    const codeBlockRegex = /```[\s\S]*?```/g;
    let codeBlocks = rawText.match(codeBlockRegex);

    if (codeBlocks) {
        // Rip the code out of the spoken text entirely
        spokenText = rawText.replace(codeBlockRegex, '').trim();
        
        // Push raw code content into the sidebar
        sidebarData = codeBlocks.map(block => {
            return block.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
        }).join('\n\n---\n\n');
    }

    if (sidebarData) {
        codeContent.innerText = sidebarData.trim(); 
        codeSidebar.classList.add('open');
        if (!spokenText) spokenText = isAdminMode ? "Data compiled in the admin matrix." : "Data compiled in the matrix.";
    }
    
    speakText(spokenText);
}

// BULLETPROOF AUDIO RENDERER
function speakText(text) {
    const cleanText = text.replace(/<[^>]*>?/gm, '').trim(); 
    if (!cleanText) return;

    subtitleDisplay.innerText = cleanText; 
    subtitleDisplay.classList.add('visible');
    statusIndicator.innerText = `${isAdminMode ? 'ADMIN' : 'GHOST'} // RESPONDING`;

    try {
        window.speechSynthesis.cancel(); 
        isTalking = true;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'en-GB'; utterance.volume = 1.0; 
        
        let voices = window.speechSynthesis.getVoices(); if (voices.length === 0) voices = availableVoices;
        const premiumVoices = ['Google UK English Male', 'Daniel', 'Oliver', 'Arthur'];
        const britishVoice = voices.find(v => premiumVoices.some(name => v.name.includes(name))) || voices.find(v => v.lang === 'en-GB' && v.name.includes('Male')) || voices.find(v => v.lang.startsWith('en-'));
        if (britishVoice) utterance.voice = britishVoice;
        
        utterance.pitch = 1.0; utterance.rate = 0.92; 
        
        utterance.onerror = () => { 
            isTalking = false; 
            statusIndicator.innerText = `${isAdminMode ? 'ADMIN' : 'GHOST'} // MUTED (TEXT ONLY)`; 
        };
        
        utterance.onend = () => {
            isTalking = false; 
            if (handsFreeActive && recognition) {
                statusIndicator.innerText = `${isAdminMode ? 'ADMIN' : 'GHOST'} // STANDBY (${currentUser})`;
                setTimeout(() => { try { recognition.start(); } catch(e){} }, 800);
            } else {
                statusIndicator.innerText = `${isAdminMode ? 'ADMIN' : 'GHOST'} // STANDBY (${currentUser})`;
            }
        };

        window.speechSynthesis.speak(utterance);
        if (window.speechSynthesis.resume) window.speechSynthesis.resume();
        
    } catch(audioError) {
        isTalking = false;
        statusIndicator.innerText = `${isAdminMode ? 'ADMIN' : 'GHOST'} // MUTED (TEXT ONLY)`; 
    }
}
