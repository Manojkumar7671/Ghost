const MASTER_PASSCODE = "knightfall";
let currentUser = "Guest";
let isAdminMode = false;
let isGhostCodeActive = false;
let targetImageBase64 = null;
let isInputHidden = false;
let isHandsFree = false; // Hands-Free Matrix State

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

// --- VOICE MATRIX INITIALIZATION ---
let ghostVoice = null;
function loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    // Hunt for a British/Jarvis style voice
    ghostVoice = voices.find(v => v.name.includes('Daniel') || v.name.includes('Google UK English Male') || (v.lang === 'en-GB' && v.name.includes('Male'))) 
                 || voices.find(v => v.lang === 'en-GB') 
                 || voices[0];
}
window.speechSynthesis.onvoiceschanged = loadVoices;
// Run once in case voices are already loaded
loadVoices();

// UI Controls
function speakText(text) {
    subtitleOverlay.innerText = text.replace(/```[\s\S]*?```/g, ''); 
    
    if ('speechSynthesis' in window) {
        // Temporarily kill mic so Ghost doesn't hear himself
        if (isHandsFree && recognition) {
            try { recognition.abort(); } catch(e){}
        }

        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, 'Executing code block.'));
        if (ghostVoice) msg.voice = ghostVoice;
        msg.rate = 1.0;
        msg.pitch = 0.9; // Slightly deeper tone
        window.speechSynthesis.speak(msg);
        
        msg.onend = () => { 
            setTimeout(() => { subtitleOverlay.innerText = ""; }, 2000); 
            // Auto-resume mic when Ghost stops speaking
            if (isHandsFree && recognition) {
                try { recognition.start(); } catch(e){}
            }
        };
    }
}

function appendToLog(sender, text) {
    const div = document.createElement('div');
    div.className = sender === 'user' ? 'msg-user' : 'msg-ghost';
    
    let formattedText = text.replace(/```python\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    formattedText = formattedText.replace(/```\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    div.innerHTML = sender === 'user' ? `> ${text}` : formattedText;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function setTheme(isAdmin) {
    const color = isAdmin ? '#ff0032' : '#00ffcc';
    const subColor = isAdmin ? 'rgba(255,0,50,0.3)' : 'rgba(0,255,204,0.3)';
    
    if (statusIndicator) {
        statusIndicator.style.color = color;
        statusIndicator.innerText = isAdmin ? "ADMIN // ACTIVE" : "GHOST // ONLINE";
    }
    document.getElementById('sidebar-title').style.color = color;
    if (disconnectBtn) {
        disconnectBtn.style.color = color;
        disconnectBtn.style.borderColor = subColor;
    }
    if (chatInput) {
        chatInput.style.borderColor = subColor;
        chatInput.style.color = color;
    }
    if (micBtn) {
        micBtn.style.borderColor = subColor;
        micBtn.style.color = color;
    }
    document.getElementById('attach-btn').style.borderColor = subColor;
    document.getElementById('attach-btn').style.color = color;
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
    if (authLayer.style.display !== 'none') return; 
    
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

// --- MICROPHONE MATRIX (HANDS-FREE ENGINE) ---
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
        micBtn.style.color = isAdminMode ? "#ff0032" : "#00ffcc";
        floatingMicBtn.style.color = isAdminMode ? "#ff0032" : "#00ffcc";
        floatingMicBtn.style.borderColor = isAdminMode ? "rgba(255,0,50,0.4)" : "rgba(0,255,204,0.4)";
        
        // Keep mic alive if hands-free is active and Ghost isn't currently speaking
        if (isHandsFree && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
            try { recognition.start(); } catch(e){}
        }
    };
}

const toggleMic = () => {
    if (!recognition) {
        speakText("Microphone offline.");
        return;
    }
    
    isHandsFree = !isHandsFree;
    if (isHandsFree) {
        speakText("Hands-free matrix online.");
        micBtn.style.background = "rgba(204,0,255,0.2)";
        floatingMicBtn.style.background = "rgba(204,0,255,0.2)";
        setTimeout(() => { try { recognition.start(); } catch(e){} }, 1500);
    } else {
        speakText("Hands-free matrix offline.");
        micBtn.style.background = "transparent";
        floatingMicBtn.style.background = "rgba(0,255,204,0.1)";
        try { recognition.abort(); } catch(e){}
    }
};

micBtn.addEventListener('click', toggleMic);
floatingMicBtn.addEventListener('click', toggleMic);

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
        
        const greetingText = `Welcome, ${currentUser}. I am Ghost, an autonomous AI engineered by Manoj Kumar. My capabilities include secure cloud-based code execution, real-time web intelligence, and optical matrix analysis. You may utilize the toggle in the navigation bar to enable autonomous scripting. How may I assist you today?`;
        
        speakText(greetingText);
        appendToLog('ghost', greetingText);
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
    
    isHandsFree = false;
    try { recognition.abort(); } catch(e){}
    micBtn.style.background = "transparent";
    floatingMicBtn.style.background = "rgba(0,255,204,0.1)";

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
            sidebar.classList.add('open'); 
            speakText(data.text.replace(/\[.*?\]/g, '')); 
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