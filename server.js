const express = require('express');
const app = express();
const path = require('path');

app.use(express.json());

// Main Chat Endpoint
app.post('/api/chat', (req, res) => {
    console.log("Ghost received:", req.body);
    res.json({ 
        success: true, 
        text: "System active. I am listening.", 
        audio_b64: [] 
    });
});

// Fallback to UI
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = 3000;
app.listen(PORT, () => console.log('Ghost OS Active on Port ' + PORT));
