// --- 1. NON-STOP PARTICLE SWARM SPHERE ---
const container = document.getElementById('webgl-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const geometry = new THREE.SphereGeometry(2, 64, 64); 
const material = new THREE.PointsMaterial({ 
    color: 0x00d4ff, 
    size: 0.02,      
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending 
});
const coreParticles = new THREE.Points(geometry, material);
scene.add(coreParticles);

const positionAttribute = geometry.attributes.position;
const basePositions = [];
for (let i = 0; i < positionAttribute.count; i++) {
    basePositions.push(new THREE.Vector3().fromBufferAttribute(positionAttribute, i));
}

let targetScale = 1;
let currentScale = 1;
let isProcessing = false;

function animate() {
    requestAnimationFrame(animate);
    const time = Date.now() * 0.001; 

    for (let i = 0; i < positionAttribute.count; i++) {
        const bp = basePositions[i];
        const noiseX = Math.sin(time * 2.0 + bp.y * 3.0) * 0.05;
        const noiseY = Math.cos(time * 2.5 + bp.z * 3.0) * 0.05;
        const noiseZ = Math.sin(time * 3.0 + bp.x * 3.0) * 0.05;
        const amplitude = isProcessing ? 3.5 : 1.0;

        positionAttribute.setXYZ(i, bp.x + noiseX * amplitude, bp.y + noiseY * amplitude, bp.z + noiseZ * amplitude);
    }
    positionAttribute.needsUpdate = true; 

    coreParticles.rotation.x += 0.001;
    coreParticles.rotation.y += 0.002;

    if (isProcessing) {
        targetScale = 1.08 + Math.sin(time * 10) * 0.04;
        material.opacity = 1.0;
        coreParticles.rotation.y += 0.02; 
    } else {
        targetScale = 1.0 + Math.sin(time * 2) * 0.02; 
        material.opacity = 0.6;
    }

    currentScale += (targetScale - currentScale) * 0.1;
    coreParticles.scale.set(currentScale, currentScale, currentScale);
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- 2. UI INTERACTION (DOUBLE TAP, SIDEBAR & SUBTITLES) ---
const inputLayer = document.getElementById('input-layer');
const commandInput = document.getElementById('command-input');
const codeSidebar = document.getElementById('code-sidebar');
const codeContent = document.getElementById('code-content');
const closeSidebarBtn = document.getElementById('close-sidebar');
const fileUpload = document.getElementById('file-upload');
const statusIndicator = document.getElementById('status-indicator');
const subtitleDisplay = document.getElementById('subtitle-display');

let lastTap = 0;
document.addEventListener('dblclick', toggleInput);
document.addEventListener('touchend', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 500 && tapLength > 0) { toggleInput(); e.preventDefault(); }
    lastTap = currentTime;
});

function toggleInput() {
    inputLayer.classList.toggle('active');
    if (inputLayer.classList.contains('active')) commandInput.focus();
}

closeSidebarBtn.addEventListener('click', () => { codeSidebar.classList.remove('open'); });

fileUpload.addEventListener('change', (e) => {
    if(e.target.files.length > 0) {
        statusIndicator.innerText = `FILE LOADED: ${e.target.files[0].name}`;
    }
});

// --- 3. HANDS-FREE VOICE & ENGINE API ---
let availableVoices = [];
window.speechSynthesis.onvoiceschanged = () => { availableVoices = window.speechSynthesis.getVoices(); };

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition ? new SpeechRecognition() : null;
let handsFreeActive = false;

if (recognition) {
    recognition.continuous = false; 
    recognition.interimResults = false;
    recognition.onstart = () => { statusIndicator.innerText = "LISTENING..."; };
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        statusIndicator.innerText = `PROCESSING: "${transcript}"`;
        sendToCore(transcript);
    };
    recognition.onerror = () => { statusIndicator.innerText = "MIC ERROR / SILENCE"; };
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#input-layer') || e.target.closest('#code-sidebar')) return;
    if (recognition && !isProcessing && !window.speechSynthesis.speaking) {
        handsFreeActive = true;
        try { recognition.start(); } catch(e) {} 
    }
});

commandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && commandInput.value.trim() !== '') {
        sendToCore(commandInput.value.trim());
        commandInput.value = '';
    }
});

async function sendToCore(message) {
    isProcessing = true;
    if (handsFreeActive && recognition) recognition.stop(); 
    subtitleDisplay.classList.remove('visible'); 

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message, history: [] }) // Empty history prevents backend crash
        });
        const data = await response.json();
        
        if (data.success) {
            handleGhostResponse(data.text);
        } else {
            speakText("System error, Boss. I am investigating.");
        }
    } catch (error) {
        speakText("Critical fault. Unable to reach core engine.");
    } finally {
        isProcessing = false;
    }
}

function handleGhostResponse(rawText) {
    const codeBlockRegex = /```[\s\S]*?```/g;
    let codeBlocks = rawText.match(codeBlockRegex);
    let spokenText = rawText.replace(codeBlockRegex, 'I have sent the data to your sidebar, Boss.'); 

    if (codeBlocks) {
        const cleanCode = codeBlocks.map(block => block.replace(/```\w*\n?|```/g, '')).join('\n\n---\n\n');
        codeContent.innerText = cleanCode;
        codeSidebar.classList.add('open');
    }

    speakText(spokenText);
}

function speakText(text) {
    const cleanText = text.replace(/<[^>]*>?/gm, '').trim(); 
    if (!cleanText) return;

    subtitleDisplay.innerText = cleanText;
    subtitleDisplay.classList.add('visible');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const britishVoice = availableVoices.find(v => v.lang === 'en-GB' && v.name.includes('Male')) 
                      || availableVoices.find(v => v.lang === 'en-GB');
    if (britishVoice) utterance.voice = britishVoice;
    utterance.rate = 1.0;
    utterance.pitch = 0.9;

    utterance.onend = () => {
        subtitleDisplay.classList.remove('visible');
        if (handsFreeActive && recognition) {
            statusIndicator.innerText = "AWAITING AUDIO...";
            setTimeout(() => { try { recognition.start(); } catch(e){} }, 500);
        } else {
            statusIndicator.innerText = "SYSTEM STANDBY";
        }
    };

    window.speechSynthesis.speak(utterance);
}
