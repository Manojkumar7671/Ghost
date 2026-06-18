const MASTER_PASSCODE = "knightfall";
let currentUser = "Guest";
let isAdminMode = false;
let isGhostCodeActive = false;
let targetImageBase64 = null;
let isInputHidden = false;

// DOM Elements
const authLayer = document.getElementById('auth-layer');
const authInput = document.getElementById('authInput');
const hudContainer = document.getElementById('hud-container');
const inputArea = document.getElementById('input-area');
const chatInput = document.getElementById('chatInput');
const disconnectBtn = document.getElementById('disconnect-btn');
const ghostCodeBtn = document.getElementById('ghost-code-btn');
const statusIndicator = document.getElementById('status-indicator');
const micBtn = document.getElementById('mic-btn');
const floatingMicBtn = document.getElementById('floating-mic-btn');
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const closeSidebarBtn = document.getElementById('close-sidebar');
const chatHistory = document.getElementById('chat-history');
const subtitleOverlay = document.getElementById('subtitle-overlay');

// UI Controls
function speakText(text) {
    subtitleOverlay.innerText = text.replace(/```[\s\S]*?```/g, ''); // Don't show raw code in subtitles
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, 'Executing code block.'));
        msg.rate = 1.0;
        window.speechSynthesis.speak(msg);
        
        msg.onend = () => { setTimeout(() => { subtitleOverlay.innerText = ""; }, 2000); };
    }
}

function appendToLog(sender, text) {
    const div = document.createElement('div');
    div.className = sender === 'user' ? 'msg-user' : 'msg-ghost';
    
    // Convert markdown code blocks to HTML for the sidebar
    let formattedText = text.replace(/```python\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    formattedText = formattedText.replace(/```\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    div.innerHTML = sender === 'user' ? `> ${text}` : formattedText;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function setTheme(isAdmin) {
    const color = isAdmin ? '#ff0032' : '#00ffcc';
    if (statusIndicator) {
        statusIndicator.style.color = color;
        statusIndicator.innerText = isAdmin ? "ADMIN // ACTIVE" : "GHOST // ONLINE";
    }
    document.getElementById('sidebar-title').style.color = color;
}

// Sidebar Toggles
toggleSidebarBtn.addEventListener('click', () => sidebar.classList.add('open'));
closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));

// Ghost Code Toggle
ghostCodeBtn.addEventListener('click', () => {
    isGhostCodeActive = !isGhostCodeActive;
    if (isGhostCodeActive) {
        ghostCodeBtn.innerText = "[GHOST CODE: ON]";
        ghostCodeBtn.classList.add('active');
        speakText("Ghost Code execution matrix activated.");
    } else {
        ghostCodeBtn.innerText = "[GHOST CODE: OFF]";
        ghostCodeBtn.classList.remove('active');
        speakText("Ghost Code matrix offline.");
    }
});

// Double-Tap Logic to Hide UI
document.getElementById('bg-canvas').addEventListener('dblclick', () => {
    if (authLayer.style.display !== 'none') return; // Don't trigger on lock screen
    
    isInputHidden = !isInputHidden;
    if (isInputHidden) {
        inputArea.style.display = 'none';
        floatingMicBtn.style.display = 'flex';
    } else {
        inputArea.style.display = 'flex';
        floatingMicBtn.style.display = 'none';
        chatInput.focus();
    }
});

// Microphone Logic (Web Speech API)
let recognition;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    
    recognition.onstart = () => {
        micBtn.style.color = "#cc00ff";
        floatingMicBtn.style.color = "#cc00ff";
        floatingMicBtn.style.borderColor = "#cc00ff";
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        chatInput.value = transcript;
        sendToCore(); 
    };

    recognition.onend = () => {
        micBtn.style.color = "#00ffcc";
        floatingMicBtn.style.color = "#00ffcc";
        floatingMicBtn.style.borderColor = "#00ffcc";
    };
}

const startMic = () => {
    if (recognition) recognition.start();
    else speakText("Microphone offline.");
};
micBtn.addEventListener('click', startMic);
floatingMicBtn.addEventListener('click', startMic);

// Initialization Layer
function initializeGhost() {
    const inputVal = authInput.value.trim();
    if (!inputVal) return;

    authLayer.style.display = 'none'; 
    hudContainer.style.display = 'block';
    disconnectBtn.style.display = 'inline-block';
    ghostCodeBtn.style.display = 'inline-block';
    toggleSidebarBtn.style.display = 'inline-block';
    chatInput.focus();
    chatInput.value = "";

    // Clear history on new login
    chatHistory.innerHTML = '';

    if (inputVal === MASTER_PASSCODE) {
        currentUser = "Master Manoj";
        isAdminMode = true;
        setTheme(true);
        speakText("Admin access granted. High-power cognition online.");
        appendToLog('ghost', "Admin Matrix initialized. Welcome back, Master Manoj. All execution and vision modules online.");
    } else {
        currentUser = inputVal; 
        isAdminMode = false;
        setTheme(false);
        
        // THE RECRUITER WOW-FACTOR GREETING
        const greetingText = `Welcome, ${currentUser}. I am Ghost, an autonomous AI engineered by Manoj Kumar. My capabilities include secure cloud-based code execution, real-time web intelligence, and optical matrix analysis. You may utilize the toggle in the navigation bar to enable autonomous scripting. How may I assist you today?`;
        
        speakText(greetingText);
        appendToLog('ghost', greetingText);
        
        // Automatically slide open the sidebar so they see the text immediately
        setTimeout(() => { sidebar.classList.add('open'); }, 500);
    }

    fetch('/api/auth', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ user: currentUser, status: 'ACTIVE' }) 
    }).catch(() => {});
}

authInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') initializeGhost();
});

// Disconnect Protocol
disconnectBtn.addEventListener('click', () => {
    authLayer.style.display = 'block';
    hudContainer.style.display = 'none'; 
    disconnectBtn.style.display = 'none';
    ghostCodeBtn.style.display = 'none';
    toggleSidebarBtn.style.display = 'none';
    sidebar.classList.remove('open');
    chatHistory.innerHTML = '';
    
    authInput.value = '';
    authInput.focus();
    statusIndicator.innerText = "GHOST // STANDBY";
    statusIndicator.style.color = "#00ffcc";
    speakText("Matrix disconnected.");
});

// Transmission Engine
async function sendToCore() {
    if (!chatInput.value.trim()) return;
    const finalPayload = chatInput.value.trim();
    chatInput.value = "";
    
    appendToLog('user', finalPayload);
    
    const originalStatus = statusIndicator.innerText;
    statusIndicator.innerText = "TRANSMITTING...";
    
    try {
        const response = await fetch('/api/chat', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                message: finalPayload, 
                user: currentUser,
                image: targetImageBase64,
                ghostCodeMode: isGhostCodeActive 
            }) 
        });
        const data = await response.json();
        
        if (data.success) {
            appendToLog('ghost', data.text);
            sidebar.classList.add('open'); // Auto-open sidebar to show results
            speakText(data.text.replace(/\[.*?\]/g, '')); // Read output, skip bracket tags
        }
    } catch (e) {
        speakText("System fault during transmission.");
    }
    
    statusIndicator.innerText = originalStatus;
    targetImageBase64 = null;
}

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendToCore();
});