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
// 2. EXTERNAL SERVICES INITIALIZATION
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing critical Supabase environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ==========================================
// 3. API ROUTES (Must be BEFORE static files)
// ==========================================

// Authentication Route
app.post('/api/auth', async (req, res) => {
    const { email, password, action } = req.body; // action can be 'login' or 'signup'

    try {
        if (!email || !password) {
            return res.status(400).json({ success: false, error: "Email and password are required." });
        }

        if (action === 'signup') {
            const { data, error } = await supabase.auth.signUp({ email, password });
            if (error) throw error;
            return res.status(200).json({ success: true, user: data.user, session: data.session });
        } else {
            // Default to login execution
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            return res.status(200).json({ success: true, user: data.user, session: data.session });
        }
    } catch (error) {
        console.error('Authentication failure:', error.message);
        return res.status(400).json({ success: false, error: error.message });
    }
});

// Core AI Orchestration Route (Placeholder for Groq / Tavily / Gemini)
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        // AI execution framework logic goes here
        return res.status(200).json({ success: true, reply: "Ghost core operational. Protocol active." });
    } catch (error) {
        console.error('AI Processing error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint for Render monitoring
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: "healthy", timestamp: new Date() });
});

// ==========================================
// 4. STATIC ASSET SERVING (Must be at the BOTTOM)
// ==========================================

// Serve static assets from the 'public' directory (HTML, CSS, client-side JS, 3D assets)
app.use(express.static(path.join(__dirname, 'public')));

// Fallback catch-all handler to serve index.html for client-side SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 5. SERVER EXECUTION
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ghost Core: Active and listening on port ${PORT}`);
});
