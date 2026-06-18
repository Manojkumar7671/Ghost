const MASTER_PASSCODE = "knightfall";
let currentUser = "Guest";
let isAdminMode = false;
let isGhostCodeActive = false;
let targetImageBase64 = null;

const authLayer = document.getElementById('auth-layer');
const authInput = document.getElementById('authInput');
const inputArea = document.getElementById('input-area');
const chatInput = document.getElementById('chatInput');
const disconnectBtn = document.getElementById('disconnect-btn');
const ghostCodeBtn = document.getElementById('ghost-code-btn');
const statusIndicator = document.getElementById('status-indicator');
const micBtn = document.getElementById('mic-btn');

function speakText(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text);
        msg.rate = 1.0;
        window.speechSynthesis.speak(msg);
    }
}

function setTheme(isAdmin) {
    const color = isAdmin ? '#ff0032' : '#00ffcc';
    const subColor = isAdmin ? 'rgba(255,0,50,0.3)' : 'rgba(0,255,204,0.3)';
    
    if (statusIndicator) {
        statusIndicator.style.color = color;
        statusIndicator.innerText = isAdmin ? "ADMIN // MUTED (TEXT ONLY)" : "GHOST // ONLINE";
    }
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

if (ghostCodeBtn) {
    ghostCodeBtn.addEventListener('click', () => {
        isGhostCodeActive = !isGhostCodeActive;
        if (isGhostCodeActive) {
            ghostCodeBtn.innerText = "[GHOST CODE: ON]";
            ghostCodeBtn.style.color = "#cc00ff"; 
            ghostCodeBtn.style.borderColor = "rgba(204,0,255,0.5)";
            speakText("Ghost Code execution matrix activated.");
        } else {
            ghostCodeBtn.innerText = "[GHOST CODE: OFF]";
            ghostCodeBtn.style.color = isAdminMode ? "#ff0032" : "#00ffcc";
            ghostCodeBtn.style.borderColor = isAdminMode ? "rgba(255,0,50,0.4)" : "rgba(0,255,204,0.4)";
            speakText("Ghost Code matrix offline.");
        }
    });
}

// MICROPHONE LOGIC (Web Speech API)
let recognition;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onstart = () => {
        if (micBtn) micBtn.style.background = "rgba(204,0,255,0.3)";
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        chatInput.value = transcript;
        sendToCore(); // Auto-send when finished speaking
    };

    recognition.onend = () => {
        if (micBtn) micBtn.style.background = "transparent";
    };
    
    recognition.onerror = () => {
        if (micBtn) micBtn.style.background = "transparent";
        speakText("Vocal input matrix fault.");
    };
}

if (micBtn) {
    micBtn.addEventListener('click', () => {
        if (recognition) {
            recognition.start();
        } else {
            speakText("Microphone not supported on this device.");
        }
    });
}

function initializeGhost() {
    const inputVal = authInput ? authInput.value.trim() : "";
    if (!inputVal) return;

    if (authLayer) authLayer.style.display = 'none'; 
    if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
    if (inputArea) inputArea.style.display = 'flex'; 
    if (ghostCodeBtn) ghostCodeBtn.style.display = 'inline-block'; // REVEAL FOR EVERYONE
    
    if (chatInput) {
        chatInput.focus();
        chatInput.value = "";
    }

    if (inputVal === MASTER_PASSCODE) {
        currentUser = "Master Manoj";
        isAdminMode = true;
        setTheme(true);
        speakText("Admin access granted. High-power cognition online.");
    } else {
        currentUser = inputVal;
        isAdminMode = false;
        setTheme(false);
        speakText(`Welcome, ${currentUser}. Vision and execution modules online.`);
    }

    fetch('/api/auth', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ user: currentUser, status: 'ACTIVE' }) 
    }).catch(e => console.log("Database offline."));
}

if (authInput) {
    authInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') initializeGhost();
    });
}

if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
        currentUser = "Guest";
        isAdminMode = false;
        isGhostCodeActive = false;
        
        if (authLayer) authLayer.style.display = 'block';
        if (inputArea) inputArea.style.display = 'none'; 
        if (disconnectBtn) disconnectBtn.style.display = 'none';
        if (ghostCodeBtn) {
            ghostCodeBtn.style.display = 'none';
            ghostCodeBtn.innerText = "[GHOST CODE: OFF]";
        }
        
        if (authInput) {
            authInput.value = '';
            authInput.focus();
        }
        setTheme(false);
        if (statusIndicator) {
            statusIndicator.innerText = "GHOST // STANDBY";
        }
        speakText("Matrix disconnected.");
    });
}

async function sendToCore() {
    if (!chatInput || chatInput.value.trim() === '') return;
    const finalPayload = chatInput.value.trim();
    
    if (statusIndicator) statusIndicator.innerText = isAdminMode ? "ADMIN // TRANSMITTING..." : "GHOST // TRANSMITTING...";
    
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
            console.log(data.text); 
            speakText("Task executed.");
        }
    } catch (e) {
        speakText("System fault.");
    }
    
    chatInput.value = "";
    targetImageBase64 = null;
    setTheme(isAdminMode); 
}

if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendToCore();
    });
}