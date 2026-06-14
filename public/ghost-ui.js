// --- 1. NON-STOP PARTICLE SWARM & COLOR MORPHING ---
const container = document.getElementById('webgl-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const colors = {
    idle: new THREE.Color(0x00d4ff),
    listening: new THREE.Color(0x0055ff),
    processing: new THREE.Color(0xffaa00),
    talking: new THREE.Color(0x00ffcc)
};

const geometry = new THREE.SphereGeometry(2, 64, 64); 
const material = new THREE.PointsMaterial({ 
    color: colors.idle, size: 0.02, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending 
});
const coreParticles = new THREE.Points(geometry, material);
scene.add(coreParticles);

const positionAttribute = geometry.attributes.position;
const basePositions = [];
for (let i = 0; i < positionAttribute.count; i++) {
    basePositions.push(new THREE.Vector3().fromBufferAttribute(positionAttribute, i));
}

let isProcessing = false;
let isListening = false;
let isTalking = false;

function animate() {
    requestAnimationFrame(animate);
    const time = Date.now() * 0.001; 

    let targetColor = colors.idle;
    let targetScale = 1.0 + Math.sin(time * 2) * 0.02;
    let amplitude = 1.0;

    if (isTalking) {
        targetColor = colors.talking;
        targetScale = 1.05 + Math.sin(time * 5) * 0.03;
        amplitude = 2.0;
    } else if (isProcessing) {
        targetColor = colors.processing;
        targetScale = 1.08 + Math.sin(time * 10) * 0.04;
        amplitude = 3.5;
    } else if (isListening) {
        targetColor = colors.listening;
        targetScale = 0.98 + Math.sin(time * 8) * 0.02;
        amplitude = 1.5;
    }

    material.color.lerp(targetColor, 0.05);
    
    for (let i = 0; i < positionAttribute.count; i++) {
        const bp = basePositions[i];
        const noiseX = Math.sin(time * 2.0 + bp.y * 3.0) * 0.05;
        const noiseY = Math.cos(time * 2.5 + bp.z * 3.0) * 0.05;
        const noiseZ = Math.sin(time * 3.0 + bp.x * 3.0) * 0.05;
        positionAttribute.setXYZ(i, bp.x + noiseX * amplitude, bp.y + noiseY * amplitude, bp.z + noiseZ * amplitude);
    }
    positionAttribute.needsUpdate = true; 

    coreParticles.rotation.x += 0.001;
    coreParticles.rotation.y += isProcessing ? 0.02 : 0.002;
    coreParticles.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- 2. UI INTERACTION & INTERRUPTION LOGIC ---
const inputLayer = document.getElementById('input-layer');
const commandInput = document.getElementById('command-input');
const codeSidebar = document.getElementById('code-sidebar');
const codeContent = document.getElementById('code-content');
const closeSidebarBtn = document.getElementById('close-sidebar');
const statusIndicator = document.getElementById('status-indicator');
const subtitleDisplay = document.getElementById('subtitle-display');

let lastTap = 0;
document.addEventListener('dblclick', toggleInput);
document.addEventListener('touchend', (e) => {
    const currentTime = new Date().getTime();
    if (currentTime - lastTap < 500 && currentTime - lastTap > 0) { toggleInput(); e.preventDefault(); }
    lastTap = currentTime;
});

function toggleInput() {
    inputLayer.classList.toggle('active');
    if (inputLayer.classList.contains('active')) commandInput.focus();
}

closeSidebarBtn.addEventListener('click', () => { codeSidebar.classList.remove('open'); });

commandInput.addEventListener('keydown', () => {
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        isTalking = false;
        subtitleDisplay.classList.remove('visible');
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
    
    recognition.onstart = () => { 
        isListening = true;
        statusIndicator.innerText = "GHOST // LISTENING"; 
    };
    
    recognition.onspeechstart = () => {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            isTalking = false;
            subtitleDisplay.classList.remove('visible');
        }
    };

    recognition.onresult = (event) => {
        isListening = false;
        const transcript = event.results[0][0].transcript;
        statusIndicator.innerText = `GHOST // PROCESSING`;
        sendToCore(transcript);
    };
    recognition.onend = () => { isListening = false; }
    recognition.onerror = () => { isListening = false; statusIndicator.innerText = "GHOST // STANDBY"; };
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#input-layer') || e.target.closest('#code-sidebar')) return;
    if (recognition && !isProcessing) {
        window.speechSynthesis.cancel(); 
        isTalking = false;
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
            body: JSON.stringify({ message: message, history: [] }) 
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
    let spokenText = rawText;
    let sidebarData = "";

    const matrixSplit = rawText.split(/(?:^|\n)matrix(?:\n|$)/i);
    
    if (matrixSplit.length > 1) {
        spokenText = matrixSplit[0];
        sidebarData = matrixSplit.slice(1).join('\n').trim();
    } else {
        const codeBlockRegex = /```[\s\S]*?```/g;
        let codeBlocks = rawText.match(codeBlockRegex);
        if (codeBlocks) {
            spokenText = rawText.replace(codeBlockRegex, '');
            sidebarData = codeBlocks.map(block => block.replace(/```\w*\n?|```/g, '')).join('\n\n---\n\n');
        }
    }

    if (sidebarData) {
        codeContent.innerText = sidebarData.trim();
        codeSidebar.classList.add('open');
        if (!spokenText.trim()) spokenText = "I have compiled the data in the sidebar, Boss.";
    }

    speakText(spokenText);
}

function speakText(text) {
    const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/matrix/gi, '').trim(); 
    if (!cleanText) return;

    isTalking = true;
    statusIndicator.innerText = "GHOST // RESPONDING";
    subtitleDisplay.innerText = cleanText;
    subtitleDisplay.classList.add('visible');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Force the utterance language engine to UK English immediately
    utterance.lang = 'en-GB';

    let voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) voices = availableVoices;

    // Aggressive British targeting: looks for specific OS native UK voices first
    const preferredVoices = ['Google UK English Male', 'Daniel', 'Microsoft George', 'Microsoft Ryan'];
    
    const britishVoice = voices.find(v => preferredVoices.some(name => v.name.includes(name)))
                      || voices.find(v => v.lang === 'en-GB' && v.name.includes('Male'))
                      || voices.find(v => v.lang === 'en-GB' || v.lang === 'en-UK')
                      || voices.find(v => v.lang.startsWith('en-')); // Final fallback to any English
                      
    if (britishVoice) {
        utterance.voice = britishVoice;
    }
    
    utterance.pitch = 1.0; 
    utterance.rate = 1.0; 

    utterance.onend = () => {
        isTalking = false;
        subtitleDisplay.classList.remove('visible');
        if (handsFreeActive && recognition) {
            statusIndicator.innerText = "GHOST // STANDBY";
            setTimeout(() => { try { recognition.start(); } catch(e){} }, 500);
        } else {
            statusIndicator.innerText = "GHOST // STANDBY";
        }
    };

    utterance.onerror = (event) => {
        console.error("SpeechSynthesis Error:", event.error);
        isTalking = false;
        subtitleDisplay.classList.remove('visible');
        statusIndicator.innerText = "GHOST // AUDIO BLOCKED";
    };

    window.speechSynthesis.speak(utterance);
}
