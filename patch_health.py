import re

with open('server.js', 'r') as f:
    js = f.read()

# Replace health check
health_start = js.find("app.get('/health', async (req, res) => {")
health_end = js.find("});", health_start) + 3

new_health = """app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});"""

if health_start != -1:
    js = js[:health_start] + new_health + js[health_end:]

with open('server.js', 'w') as f:
    f.write(js)
