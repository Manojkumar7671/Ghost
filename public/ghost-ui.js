// --- 1. THREE.JS SPHERE SETUP ---
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

// Create the Core Sphere (Icosahedron looks highly technical as a wireframe)
const geometry = new THREE.IcosahedronGeometry(2, 3); // Radius 2, detail level 3
const material = new THREE.MeshBasicMaterial({ 
    color: 0x00ffcc, 
    wireframe: true,
    transparent: true,
    opacity: 0.3
});
const coreSphere = new THREE.Mesh(geometry, material);
scene.add(coreSphere);

// Animation variables
let targetScale = 1;
let currentScale = 1;
let isProcessing = false;

// Animation Loop
function animate() {
    requestAnimationFrame(animate);

    // Idle rotation
    coreSphere.rotation.x += 0.001;
    coreSphere.rotation.y += 0.002;

    // React to processing state (pulse faster and brighter when "thinking")
    if (isProcessing) {
        targetScale = 1.1 + Math.sin(Date.now() * 0.01) * 0.05;
        material.opacity = 0.8;
        coreSphere.rotation.y += 0.01;
    } else {
        targetScale = 1.0 + Math.sin(Date.now() * 0.002) * 0.02; // Slow idle breathing
        material.opacity = 0.3;
    }

    // Smooth scaling
    currentScale += (targetScale - currentScale) * 0.1;
    coreSphere.scale.set(currentScale, currentScale, currentScale);

    renderer.render(scene, camera);
}
animate();

// Handle Window Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});


// --- 2. CHAT UI & BACKEND INTEGRATION ---
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
            // Sending to your backend route
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            });

            const data = await response.json();
            
            if (data.success) {
                appendMessage(data.text, 'ghost');
            } else {
                appendMessage("SYSTEM ERROR: " + (data.text || "Connection failed."), 'ghost');
            }
        } catch (error) {
            console.error("Fetch error:", error);
            appendMessage("CRITICAL FAULT: Unable to reach core engine.", 'ghost');
        } finally {
            // Return sphere to idle state
            isProcessing = false;
        }
    }
});
