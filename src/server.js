// Inside your playVoice function in index.html, update it to use the new spoken field:
async function playVoice(text, spoken) {
    orbState = 'speaking';
    handleAutomationTags(text);
    
    // Use the shortened spoken phrase if provided, otherwise fallback to full
    const phraseToSpeak = spoken || text;
    
    // UI displays full text in sidebar, but only speaks the concise phrase
    evaluateSidebar(text);
    
    // ... rest of your existing playVoice logic ...
    playNativeVoice(phraseToSpeak); 
}