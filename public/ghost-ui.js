// ... [Keep your authentication, particle animation, and standard structures identical] ...

let cameraStream = null;
let screenStream = null;

// 🛑 AUTOMATED FRAME BUFFER CAPTURE FUNCTION 🛑
function captureFrame(videoElementId) {
    const video = document.getElementById(videoElementId);
    if (!video || video.readyState !== video.HAVE_CURRENT_DATA) return null;
    
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Strip the data header to leave the raw Base64 payload data string
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

async function startCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const videoElement = document.getElementById('camera-feed');
        videoElement.srcObject = cameraStream;
        videoElement.classList.add('active');
        statusIndicator.innerText = `GHOST // OPTICAL STREAM ACTIVE`;
    } catch (err) { speakText("Camera interface array mapping failure."); }
}

async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const videoElement = document.getElementById('screen-feed');
        videoElement.srcObject = screenStream;
        videoElement.classList.add('active');
        statusIndicator.innerText = `GHOST // SCREEN CAPTURE LIVE`;
    } catch (err) { speakText("Screen sync channel initialization canceled."); }
}

async function sendToCore(message) {
    isProcessing = true;
    if (handsFreeActive && recognition) recognition.stop(); 
    subtitleDisplay.classList.remove('visible'); 

    let finalPayload = message;
    if (attachedFileContent !== "") {
        finalPayload += `\n\n[SYSTEM NOTE: Attached file: ${attachedFileName}]\n\`\`\`\n${attachedFileContent}\n\`\`\``;
        attachedFileContent = ""; attachedFileName = ""; fileUpload.value = ""; 
    }

    // Capture visual matrix data if streams are live on-screen
    let targetImageBase64 = null;
    if (screenStream && document.getElementById('screen-feed').classList.contains('active')) {
        targetImageBase64 = captureFrame('screen-feed');
    } else if (cameraStream && document.getElementById('camera-feed').classList.contains('active')) {
        targetImageBase64 = captureFrame('camera-feed');
    }

    try {
        const response = await fetch('/api/chat', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: finalPayload, 
                user: currentUser,
                image: targetImageBase64 // Sent seamlessly to the server configuration routes
            }) 
        });
        const data = await response.json();
        if (data.success) handleGhostResponse(data.text);
        else speakText("System error. Investigating.");
    } catch (error) { speakText("Critical fault. Unable to reach core engine."); } finally { isProcessing = false; }
}

// ... [Keep standard handleGhostResponse and speakText modules exactly as they are] ...
