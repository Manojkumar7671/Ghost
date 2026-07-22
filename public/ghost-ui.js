document.addEventListener('DOMContentLoaded', () => {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        document.documentElement.classList.add('theme-batcave');
    }
    let availableVoices = [];
    window.speechSynthesis.onvoiceschanged = () => { availableVoices = window.speechSynthesis.getVoices(); };

    const loginOverlay = document.getElementById('loginOverlay');
    const authInput = document.getElementById('authInput');
    const appLayout = document.getElementById('app-layout');
    const userTag = document.getElementById('userTag');
    const chatLog = document.getElementById('chatLog');
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const attachBtn = document.getElementById('attachBtn');
    const attachmentInput = document.getElementById('attachmentInput');
    const micToggleBtn = document.getElementById('micToggleBtn');
    const thinkingIndicator = document.getElementById('thinking-indicator');
    const ghostCodeBtn = document.getElementById('ghostCodeBtn');
    const newChatBtn = document.getElementById('newChatBtn');

    const codeSidebar = document.getElementById('code-sidebar');
    const codeContent = document.getElementById('code-content');
    const closeSidebar = document.getElementById('closeSidebar');
    const appViewer = document.getElementById('app-viewer');
    const appIframe = document.getElementById('app-iframe');
    const closeAppViewer = document.getElementById('closeAppViewer');

    let masterUser = "Guest";
    let isAdminMode = false;
    let isGhostCodeActive = true;

    // --- AUTHENTICATION HANDLER ---
    authInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const inputVal = authInput.value.trim();
            if (!inputVal) return;

            const safeGuestName = inputVal.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 20) || "Guest";

            try {
                const authRes = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ authString: inputVal, user: safeGuestName })
                });
                const authData = await authRes.json();

                if (authData.success && authData.role === 'admin') {
                    userTag.innerText = `ADMIN // MASTER MANOJ`;
                    userTag.style.color = 'var(--accent-cyan)';
                    masterUser = "Master Manoj";
                    isAdminMode = true;
                    speakResponse("Welcome back, Master Manoj. All Ghost core systems are operational.");
                } else {
                    userTag.innerText = `VISITOR // ${safeGuestName.toUpperCase()}`;
                    masterUser = safeGuestName;
                    isAdminMode = false;
                    speakResponse(`Greetings ${safeGuestName}, I am Ghost. How may I assist you today?`);
                }
            } catch (error) {
                console.error("Auth routing failed.", error);
            }

            loginOverlay.style.opacity = '0';
            loginOverlay.style.visibility = 'hidden';
            appLayout.classList.add('active');
        }
    });

    // --- TOGGLES & ACTIONS ---
    ghostCodeBtn.addEventListener('click', () => {
        isGhostCodeActive = !isGhostCodeActive;
        if (isGhostCodeActive) {
            ghostCodeBtn.innerText = "[ GHOST CODE: ON ]";
            ghostCodeBtn.style.color = "var(--text-main)";
            speakResponse("Code matrix activated.");
        } else {
            ghostCodeBtn.innerText = "[ GHOST CODE: OFF ]";
            ghostCodeBtn.style.color = "var(--text-dim)";
            speakResponse("Code matrix offline.");
        }
    });

    newChatBtn.addEventListener('click', () => {
        chatLog.innerHTML = `
            <div class="message-card ghost">
                <div class="avatar">G</div>
                <div class="bubble">
                    Stream cleared. Systems ready for new command, ${masterUser}.
                </div>
            </div>
        `;
    });

    closeSidebar.addEventListener('click', () => codeSidebar.classList.remove('open'));
    closeAppViewer.addEventListener('click', () => {
        appViewer.classList.remove('open');
        setTimeout(() => appIframe.srcdoc = "", 400);
    });

    // --- CHAT MESSAGE UI RENDERING ---
    function appendMessage(sender, text) {
        const card = document.createElement('div');
        card.className = `message-card ${sender}`;

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.innerText = sender === 'user' ? 'U' : 'G';

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerText = text;

        card.appendChild(avatar);
        card.appendChild(bubble);
        chatLog.appendChild(card);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    // --- SPEECH SYNTHESIS & VOICE OUTPUT ---
    function setMicState(state) {
        micToggleBtn.className = `mic-btn ${state}`;
        if (state === 'listening') micToggleBtn.innerText = '🔴';
        else if (state === 'transcribing') micToggleBtn.innerText = '⏳';
        else if (state === 'speaking') micToggleBtn.innerText = '🔊';
        else micToggleBtn.innerText = '🎤';
    }

    function speakResponse(text) {
        if (!window.speechSynthesis) return;
        let cleanText = text.replace(/[\x60]{3}[\s\S]*?[\x60]{3}/g, '')
                            .replace(/<think>[\s\S]*?<\/think>/g, '')
                            .replace(/<search>[\s\S]*?<\/search>/g, '')
                            .replace(/\[.*?\]/g, '').trim();

        if (!cleanText) cleanText = "Execution complete.";
        window.speechSynthesis.cancel();
        setMicState('speaking');

        const utterance = new SpeechSynthesisUtterance(cleanText);
        if (availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
        let ukVoice = availableVoices.find(v => v.lang === 'en-GB' || v.name.includes('UK English')) || availableVoices.find(v => v.lang.includes('en'));
        if (ukVoice) utterance.voice = ukVoice;
        utterance.rate = 1.05;
        utterance.pitch = 0.95;

        utterance.onend = () => setMicState('idle');
        utterance.onerror = () => setMicState('idle');
        window.speechSynthesis.speak(utterance);
    }

    // --- BACKEND WHISPER RECORDING MATRIX ---
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

    micToggleBtn.addEventListener('click', () => {
        if (!isRecording) startRecording();
        else stopRecording();
    });

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstart = () => {
                isRecording = true;
                setMicState('listening');
            };

            mediaRecorder.onstop = async () => {
                isRecording = false;
                setMicState('transcribing');

                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64Audio = reader.result;
                    try {
                        const res = await fetch('/api/voice/transcribe', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ audioBase64: base64Audio })
                        });
                        const data = await res.json();
                        setMicState('idle');
                        if (data.success && data.text) {
                            userInput.value = data.text;
                            processCommand(data.text);
                        } else {
                            appendMessage('ghost', data.error || "Whisper audio transcription could not be completed.");
                        }
                    } catch (e) {
                        setMicState('idle');
                        appendMessage('ghost', "Error communicating with Whisper backend transcription service.");
                    }
                };
            };

            mediaRecorder.start();
        } catch (e) {
            setMicState('idle');
            appendMessage('ghost', "Microphone access denied or unavailable.");
        }
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    }

    // --- ATTACHMENTS & FILE BUFFERING ---
    let uploadedFileText = "", uploadedImageBase64 = "";
    attachBtn.addEventListener('click', () => attachmentInput.click());
    attachmentInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                uploadedImageBase64 = ev.target.result.split(',')[1];
                appendMessage('user', `[Attached Image: ${file.name}]`);
            };
            reader.readAsDataURL(file);
        } else if (file.type === 'application/pdf') {
            const fileReader = new FileReader();
            fileReader.onload = async function() {
                try {
                    const pdf = await pdfjsLib.getDocument(new Uint8Array(this.result)).promise;
                    let text = "";
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const content = await (await pdf.getPage(i)).getTextContent();
                        text += content.items.map(item => item.str).join(' ') + "\n";
                    }
                    uploadedFileText = text;
                    appendMessage('user', `[Attached PDF: ${file.name}]`);
                } catch (err) {
                    appendMessage('ghost', "Error parsing PDF attachment.");
                }
            };
            fileReader.readAsArrayBuffer(file);
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => {
                uploadedFileText = ev.target.result;
                appendMessage('user', `[Attached File: ${file.name}]`);
            };
            reader.readAsText(file);
        }
    });

    // --- CHAT COMMAND PROCESSOR ---
    sendBtn.addEventListener('click', () => {
        const val = userInput.value.trim();
        if (val || uploadedImageBase64 || uploadedFileText) processCommand(val);
    });

    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const val = userInput.value.trim();
            if (val || uploadedImageBase64 || uploadedFileText) processCommand(val);
        }
    });

    async function processCommand(textCommand) {
        if (textCommand) appendMessage('user', textCommand);
        userInput.value = "";
        thinkingIndicator.classList.add('active');

        const payload = {
            message: textCommand,
            user: masterUser,
            image: uploadedImageBase64 || null,
            fileContent: uploadedFileText || null,
            ghostCodeMode: isGhostCodeActive
        };

        uploadedFileText = "";
        uploadedImageBase64 = "";
        attachmentInput.value = "";

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            thinkingIndicator.classList.remove('active');

            if (data.success) {
                handleGhostResponse(data.text);
                if (data.actionRequired && data.actionId) {
                    renderHitlActionCard(data.actionId);
                }
            } else {
                appendMessage('ghost', "Matrix error: Backend disconnected.");
            }
        } catch (error) {
            thinkingIndicator.classList.remove('active');
            appendMessage('ghost', "Critical failure: Server unreachable.");
        }
    }

    function renderHitlActionCard(actionId) {
        const hitlDiv = document.createElement('div');
        hitlDiv.style.margin = '16px 0';
        hitlDiv.style.padding = '16px';
        hitlDiv.style.border = '1px solid var(--accent-rose)';
        hitlDiv.style.background = 'rgba(244, 63, 94, 0.1)';
        hitlDiv.style.borderRadius = '12px';

        hitlDiv.innerHTML = `
            <p style="color: var(--accent-rose); font-weight: 700; font-size: 12px; margin-bottom: 10px;">ACTION AUTHORIZATION REQUIRED</p>
            <button id="approveBtn_${actionId}" class="send-btn" style="margin-right: 10px;">AUTHORIZE</button>
            <button id="rejectBtn_${actionId}" class="btn-icon" style="color: var(--accent-rose);">REJECT</button>
        `;
        codeContent.appendChild(hitlDiv);
        codeSidebar.classList.add('open');

        document.getElementById(`approveBtn_${actionId}`).addEventListener('click', async () => {
            hitlDiv.innerHTML = `<span style="color: var(--accent-cyan);">Executing action...</span>`;
            try {
                const execRes = await fetch('/api/execute-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actionId })
                });
                const execData = await execRes.json();
                hitlDiv.innerHTML = `<span style="color: ${execData.success ? 'var(--accent-cyan)' : 'var(--accent-rose)'};">${execData.success ? execData.message : execData.error}</span>`;
                speakResponse(execData.success ? "Authorization accepted. Execution successful." : "Execution failed.");
            } catch (e) {
                hitlDiv.innerHTML = `<span style="color: var(--accent-rose);">Network error.</span>`;
            }
        });

        document.getElementById(`rejectBtn_${actionId}`).addEventListener('click', () => {
            hitlDiv.innerHTML = `<span style="color: var(--accent-rose);">Action rejected by user.</span>`;
            speakResponse("Action aborted.");
        });
    }

    function handleGhostResponse(fullText) {
        if (fullText.includes('[EXECUTE_OPEN_TAB:')) {
            const urlMatch = fullText.match(/\[EXECUTE_OPEN_TAB:(.*?)\]/);
            if (urlMatch && urlMatch[1]) window.open(urlMatch[1], '_blank');
            fullText = fullText.replace(/\[EXECUTE_OPEN_TAB:.*?\]/g, 'Opening web oracle tab.');
        }

        const codeRegex = /[\x60]{3}[a-z]*\n([\s\S]*?)[\x60]{3}/gi;
        let match, foundHtml = false, htmlContentToRender = "", spokenText = fullText;
        codeContent.innerHTML = '';

        while ((match = codeRegex.exec(fullText)) !== null) {
            let codeBlock = match[1].trim();
            let safeBlock = codeBlock.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            codeContent.innerHTML += `<pre><code>${safeBlock}</code></pre>`;
            if (codeBlock.includes('<!DOCTYPE html>') || (codeBlock.includes('<html') && codeBlock.includes('</html>'))) {
                foundHtml = true;
                htmlContentToRender = codeBlock.substring(codeBlock.indexOf('<!DOCTYPE html>') !== -1 ? codeBlock.indexOf('<!DOCTYPE html>') : codeBlock.indexOf('<html'));
            }
            spokenText = spokenText.replace(match[0], '');
        }

        if (codeContent.innerHTML !== '') codeSidebar.classList.add('open');
        if (foundHtml && htmlContentToRender) {
            appIframe.srcdoc = htmlContentToRender;
            appViewer.classList.add('open');
            if (spokenText.trim() === "") spokenText = "Interface rendered.";
        }

        appendMessage('ghost', spokenText.trim() || "Execution complete.");
        speakResponse(spokenText);
    }
});