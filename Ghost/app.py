from flask import Flask, render_template_string, request, redirect, url_for, session

app = Flask(__name__)
app.secret_key = 'ghost_secure_session_matrix_key'

# Simple mock database for verification
USER_DATA = {
    "admin": "password123"
}

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ghost OS - Terminal Login</title>
    <style>
        body {
            background-color: #0d1117;
            color: #c9d1d9;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .login-card {
            background-color: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 24px;
            width: 320px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        }
        h2 { margin-top: 0; color: #58a6ff; text-align: center; font-size: 1.5rem; }
        .form-group { margin-bottom: 16px; }
        label { display: block; margin-bottom: 6px; font-size: 14px; }
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 8px;
            box-sizing: border-box;
            background-color: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            color: #c9d1d9;
        }
        input:focus { border-color: #58a6ff; outline: none; }
        button {
            width: 100%;
            padding: 8px;
            background-color: #238636;
            color: #ffffff;
            border: 1px solid rgba(240,246,252,0.1);
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
        }
        button:hover { background-color: #2ea44f; }
        .error { color: #f85149; font-size: 14px; margin-bottom: 16px; text-align: center; }
    </style>
</head>
<body>
    <div class="login-card">
        <h2>System Access</h2>
        {% if error %}
            <div class="error">{{ error }}</div>
        {% endif %}
        <form method="POST">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" required autocomplete="off">
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit">Authenticate</button>
        </form>
    </div>
</body>
</html>
"""

@app.route('/', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if username in USER_DATA and USER_DATA[username] == password:
            session['user'] = username
            return redirect(url_for('dashboard'))
        else:
            error = "Invalid matrix credentials."
            
    return render_template_string(HTML_TEMPLATE, error=error)

@app.route('/dashboard')
def dashboard():
    if 'user' not in session:
        return redirect(url_for('login'))
    return f"<h1>Access Granted</h1><p>Welcome back, {session['user']}. Terminal environment initialized.</p>"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
