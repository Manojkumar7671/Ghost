import os, re

for r, d, f in os.walk('.'):
    if 'node_modules' in r or '.git' in r: continue
    if 'index.html' in f:
        p = os.path.join(r, 'index.html')
        with open(p, 'r') as file: c = file.read()
        
        moab_script = """
<script>
    // 1. THE DOM ANNIHILATOR
    const observer = new MutationObserver(() => {
        const enemies = document.querySelectorAll('#messages, .chat-box, #statusText, #typing, .glass-panel, [id*="transcript"]');
        enemies.forEach(el => el.remove()); 
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.body.style.setProperty('background', '#000000', 'important');

    // 2. THE AUDIO CONTEXT ANCHOR
    let audioCtx;
    function unlockAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            gain.gain.value = 0; 
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
        }
    }

    // 3. THE UNKILLABLE MIC LOOP
    function startIndestructibleMic() {
        unlockAudio();
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
            window.ghostRec = new SpeechRec();
            window.ghostRec.continuous = true;
            window.ghostRec.interimResults = false;
            
            window.ghostRec.onend = () => {
                console.warn("[Ghost OS] Mic drop. Restarting...");
                setTimeout(() => { try { window.ghostRec.start(); } catch(e) {} }, 50);
            };
            
            try { window.ghostRec.start(); } catch(e) {}
        }
    }

    document.addEventListener('click', startIndestructibleMic, { once: true });
</script>
"""
        c = re.sub(r'
