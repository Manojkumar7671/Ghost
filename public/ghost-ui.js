// --- 1. THREE.JS PARTICLE SPHERE SETUP ---
const container = document.getElementById('webgl-container');
const scene = new THREE.Scene();

// Camera setup
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

// Create the Particle Sphere (Dense point cloud like the video)
// High segment count creates the dense dot look
const geometry = new THREE.SphereGeometry(2, 64, 64); 
const material = new THREE.PointsMaterial({ 
    color: 0x00ffcc, // Matrix green
    size: 0.02,      // Small particles
    transparent: true,
    opacity: 0.7
});
const coreParticles = new THREE.Points(geometry, material);
scene.add(coreParticles);

// Animation variables
let targetScale = 1;
let currentScale = 1;
let isProcessing = false;

// Animation Loop
function animate() {
    requestAnimationFrame(animate);

    // Idle rotation
    coreParticles.rotation.x += 0.001;
    coreParticles.rotation.y += 0.002;

    // React to processing state (spin faster, pulse, and get brighter)
    if (isProcessing) {
        targetScale = 1.05 + Math.sin(Date.now() * 0.01) * 0.03;
        material.opacity = 1.0;
        coreParticles.rotation.y += 0.015; // Spin faster while thinking
    } else {
        targetScale = 1.0 + Math.sin(Date.now() * 0.002) * 0.02; // Slow idle breathing
        material.opacity = 0.7;
    }

    // Smooth scaling
    currentScale += (targetScale - currentScale) * 0.1;
    coreParticles.scale.set(currentScale, currentScale, currentScale);

    renderer.render(scene, camera);
}
animate();

// Handle Window Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});


// --- 2. VOICE SYNTHESIS SETUP ---
// Load voices so they are ready
let availableVoices = [];
window.speechSynthesis.onvoiceschanged = () => {
    availableVoices = window.speechSynthesis.getVoices();
};

function speakText(text) {
    // Strip out HTML tags (like <br>) so it doesn't read them out loud
    const cleanText = text.replace(/<[^>]*>?/gm, '');
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Try to find a British male voice for that Jarvis/Alfred vibe
    const britishVoice = availableVoices.find(v => v.lang === 'en-GB' && v.name.includes('Male')) 
                      || availableVoices.find(v => v.lang === 'en-GB');
                      
    if (britishVoice) {
        utterance.voice = britishVoice;
    }
    
    utterance.rate = 1.0;
    utterance.pitch = 0.9; // Slightly deeper
    
    window.speechSynthesis.speak(utterance);
}


// --- 3. CHAT UI & BACKEND INTEGRATION ---
const inputField = document.getElementById('command-input');
const chatLog = document.getElementById('chat-log');

function appendMessage(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    msgDiv.classList.add(sender === 'boss' ? 'boss-msg' : 'ghost-msg');
    
    // Format response (basic handling for newlines)
    msgDiv.innerHTML = text.replace(/\n/g, '<br>');
    
    chatLog.appendChild(msgDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}

inputField.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && inputField.value.trim() !== '') {
        const message = inputField.value.trim();
        inputField.value = '';
        
        appendMessage(`> ${message}`, 'boss');
        
        // Trigger sphere processing animation
        isProcessing = true;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            });

            const data = await response.json();
            
            if (data.success) {
                appendMessage(data.text, 'ghost');
                speakText(data.text); // Trigger the voice!
            } else {
                appendMessage("SYSTEM ERROR: " + (data.text || "Connection failed."), 'ghost');
                speakText("System error, Boss. I am investigating.");
            }
        } catch (error) {
            console.error("Fetch error:", error);
            appendMessage("CRITICAL FAULT: Unable to reach core engine.", 'ghost');
            speakText("Critical fault. Unable to reach core engine.");
        } finally {
            // Return sphere to idle state
            isProcessing = false;
        }
    }
});
