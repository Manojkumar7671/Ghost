// --- 1. NEON BLUE PARTICLE SPHERE ---
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
    color: 0x00d4ff, // Arc Reactor Neon Blue
    size: 0.02,      
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending // Makes the blue glow intensely
});
const coreParticles = new THREE.Points(geometry, material);
scene.add(coreParticles);

let targetScale = 1;
let currentScale = 1;
let isProcessing = false;

function animate() {
    requestAnimationFrame(animate);
    coreParticles.rotation.x += 0.001;
    coreParticles.rotation.y += 0.002;

    if (isProcessing) {
        targetScale = 1.08 + Math.sin(Date.now() * 0.01) * 0.04;
        material.opacity = 1.0;
        coreParticles.rotation.y += 0.02; 
    } else {
        targetScale = 1.0 + Math.sin(Date.now() * 0.002) * 0.02; 
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


// --- 2. UI INTERACTION (DOUBLE TAP & SIDEBAR) ---
const inputLayer = document.getElementById('input-layer');
const commandInput = document.getElementById('command-input');
const codeSidebar = document.getElementById('code-sidebar');
const codeContent = document.getElementById('code-content');
const closeSidebarBtn = document.getElementById('close-sidebar');
const fileUpload = document.getElementById('file-upload');
const statusIndicator = document.getElementById('status-indicator');

// Double Tap to toggle text input
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
        // UI hook for file. Needs backend processing logic to actually send to LLM.
        statusIndicator.innerText = `FILE LOADED: ${e.target.files[0].name}`;
    }
});


// --- 3. HANDS-FREE VOICE & ENGINE API ---
let availableVoices = [];
window.speechSynthesis.onvoiceschanged = () => { availableVoices = window.speechSynthesis.getVoices(); };

// Set up Speech Recognition (Web Speech API)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition ? new SpeechRecognition() : null;
let handsFreeActive = false;

if (recognition) {
    recognition.continuous = false; // Stops when you stop talking
    recognition.interimResults = false;

    recognition.onstart = () => { statusIndicator.innerText = "LISTENING..."; };
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        statusIndicator.innerText = `PROCESSING: "${transcript}"`;
        sendToCore(transcript);
    };

    recognition.onerror = () => { statusIndicator.innerText = "MIC ERROR / SILENCE"; };
}

// Single tap activates hands-free mic (browsers require a click to start audio)
document.addEventListener('click', (e) => {
    // Ignore clicks if they are on the input box or sidebar
    if (e.target.closest('#input-layer') || e.target.closest('#code-sidebar')) return;
    
    if (recognition && !isProcessing && !window.speechSynthesis.speaking) {
        handsFreeActive = true;
        try { recognition.start(); } catch(e) {} // Catch error if already started
    }
});

// Text input fallback
commandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && commandInput.value.trim() !== '') {
        sendToCore(commandInput.value.trim());
        commandInput.value = '';
    }
});

async function sendToCore(message) {
    isProcessing = true;
    if (handsFreeActive && recognition) recognition.stop(); // Stop listening while processing

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message })
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
    // 1. Extract code blocks to put in the sidebar
    const codeBlockRegex = /```[\s\S]*?```/g;
    let codeBlocks = rawText.match(codeBlockRegex);
    let spokenText = rawText.replace(codeBlockRegex, 'I have sent the data to your sidebar, Boss.'); // Remove code from speech

    if (codeBlocks) {
        // Clean up markdown ticks for display
        const cleanCode = codeBlocks.map(block => block.replace(/```\w*\n?|```/g, '')).join('\n\n---\n\n');
        codeContent.innerText = cleanCode;
        codeSidebar.classList.add('open');
    }

    // 2. Speak the remaining text
    speakText(spokenText);
}

function speakText(text) {
    const cleanText = text.replace(/<[^>]*>?/gm, ''); // Strip HTML
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    const britishVoice = availableVoices.find(v => v.lang === 'en-GB' && v.name.includes('Male')) 
                      || availableVoices.find(v => v.lang === 'en-GB');
    if (britishVoice) utterance.voice = britishVoice;
    
    utterance.rate = 1.0;
    utterance.pitch = 0.9;

    // Restart listening after he finishes speaking if hands-free is active
    utterance.onend = () => {
        if (handsFreeActive && recognition) {
            statusIndicator.innerText = "AWAITING AUDIO...";
            setTimeout(() => { try { recognition.start(); } catch(e){} }, 500);
        } else {
            statusIndicator.innerText = "SYSTEM STANDBY";
        }
    };

    window.speechSynthesis.speak(utterance);
}
