const MASTER_PASSCODE = "knightfall";
let currentUser = "Guest";
let isAdminMode = false;
let isGhostCodeActive = false;
let targetImageBase64 = null;

// Core DOM Nodes
const authLayer = document.getElementById('auth-layer') || document.querySelector('.auth-layer');
const authInput = document.getElementById('authInput') || document.querySelector('input[type="password"]');
const chatInput = document.getElementById('chatInput') || document.querySelector('input[type="text"]');
const chatContainer = document.getElementById('chat-container') || document.getElementById('chat-history');
const disconnectBtn = document.getElementById('disconnect-btn');
const ghostCodeBtn = document.getElementById('ghost-code-btn');
const statusIndicator = document.getElementById('status-indicator');
const sidebarHeader = document.getElementById('sidebar-header');

// Vocal Output Matrix
function speakText(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text);
        msg.rate = 1.0;
        window.speechSynthesis.speak(msg);
    }
}

// Theme Override Protocol
function setTheme(isAdmin) {
    const color = isAdmin ? '#ff0032' : '#00ffcc';
    if (statusIndicator) {
        statusIndicator.style.color = color;
        statusIndicator.innerText = isAdmin ? "ADMIN // MUTED (TEXT ONLY)" : "GHOST // STANDBY";
    }
    if (disconnectBtn) {
        disconnectBtn.style.color = color;
        disconnectBtn.style.borderColor = color;
    }
    if (chatInput) {
        chatInput.style.borderColor = color;
        chatInput.style.color = color;
    }
}

// Ghost Code Toggle Trigger
if (ghostCodeBtn) {
    ghostCodeBtn.addEventListener('click', () => {
        isGhostCodeActive = !isGhostCodeActive;
        if (isGhostCodeActive) {
            ghostCodeBtn.innerText = "[GHOST CODE: ON]";
            ghostCodeBtn.style.color = "#cc00ff"; 
            ghostCodeBtn.style.borderColor = "#cc00ff";
            ghostCodeBtn.style.background = "rgba(204,0,255,0.2)";
            ghostCodeBtn.style.textShadow = "0 0 8px #cc00ff";
            speakText("Ghost Code execution matrix activated.");
        } else {
            ghostCodeBtn.innerText = "[GHOST CODE: OFF]";
            ghostCodeBtn.style.color = "#00ffcc";
            ghostCodeBtn.style.borderColor = "#00ffcc";
            ghostCodeBtn.style.background = "rgba(0,255,204,0.1)";
            ghostCodeBtn.style.textShadow = "0 0 5px #00ffcc";
            speakText("Ghost Code matrix offline.");
        }
    });
}

// Authorization Sequence
function initializeGhost() {
    const inputVal = authInput ? authInput.value.trim() : "";
    if (!inputVal) return;

    if (authLayer) authLayer.style.display = 'none'; 
    if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
    if (chatInput) {
        chatInput.focus();
        chatInput.value = "";
    }

    if (inputVal === MASTER_PASSCODE) {
        currentUser = "Master Manoj";
        isAdminMode = true;
        setTheme(true);
        
        // BULLETPROOF BUTTON REVEAL
        if (ghostCodeBtn) ghostCodeBtn.style.display = 'inline-block'; 
        
        speakText("Admin access granted. High-power cognition online.");
    } else {
        currentUser = inputVal;
        isAdminMode = false;
        setTheme(false);
        
        // GUEST LOCKOUT
        if (ghostCodeBtn) ghostCodeBtn.style.display = 'none'; 
        isGhostCodeActive = false; 
        
        speakText(`Initialization complete. Welcome, ${currentUser}. Vision modules standby.`);
    }

    fetch('/api/auth', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ user: currentUser, status: 'ACTIVE' }) 
    }).catch(e => console.log("Database logging offline."));
}

if (authInput) {
    authInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') initializeGhost();
    });
}

// Disconnect Protocol
if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
        currentUser = "Guest";
        isAdminMode = false;
        isGhostCodeActive = false;
        if (authLayer) authLayer.style.display = 'block';
        if (disconnectBtn) disconnectBtn.style.display = 'none';
        if (ghostCodeBtn) ghostCodeBtn.style.display = 'none';
        if (authInput) {
            authInput.value = '';
            authInput.focus();
        }
        setTheme(false);
        if (statusIndicator) {
            statusIndicator.innerText = "GHOST // OFFLINE";
            statusIndicator.style.color = "#888";
        }
        speakText("Matrix disconnected.");
    });
}

// Execution Loop to server.js
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
            // Render logic handled here (assuming you have a render output function)
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