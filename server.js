const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// 1. GLOBAL MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json());

// ==========================================
// 2. DATABASE INITIALIZATION
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ==========================================
// 3. API ROUTES
// ==========================================

// Authentication Bypass Route (Fixes the 400 Error)
app.post('/api/auth', async (req, res) => {
    // We completely removed the email/password check. 
    // The server instantly unlocks the frontend.
    console.log("Ghost Core: System unlocked. No credentials required.");
    return res.status(200).json({ 
        success: true, 
        message: "Authentication bypassed. Welcome to Ghost OS.",
        session: "active_guest"
    });
});

// Core AI Orchestration Route
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        // Your AI routing logic goes here
        return res.status(200).json({ success: true, reply: "Ghost core operational. I am listening." });
    } catch (error) {
        console.error('AI Processing error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: "healthy", timestamp: new Date() });
});

// ==========================================
// 4. STATIC ASSET SERVING
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 5. SERVER EXECUTION
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ghost Core: Active and listening on port ${PORT}`);
});
