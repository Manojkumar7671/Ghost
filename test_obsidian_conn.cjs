const https = require('https');

const OBSIDIAN_AGENT = new https.Agent({ rejectUnauthorized: false });
const apiKey = '5cc75b9f28a37f38d84a720abdc39d576c6b31cb2a06e28405157b6a551b0809';

async function testObsidian() {
    console.log('--- Testing Obsidian Connection (Bypass Sandbox) ---');
    const req = https.request({
      hostname: '127.0.0.1',
      port: 27124,
      path: '/vault/',
      method: 'GET',
      agent: OBSIDIAN_AGENT,
      timeout: 2000,
      headers:  { Authorization: `Bearer ${apiKey}`, 'Accept': 'application/json' }
    }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
            console.log('Status Code:', res.statusCode);
            if (res.statusCode === 200) {
                try {
                    const json = JSON.parse(data);
                    console.log('Success! Found files:', json.files ? json.files.length : json.length || 0);
                } catch(e) {
                    console.log('Success, but could not parse response.');
                }
            } else {
                console.log('Error Response:', data.substring(0, 100));
            }
        });
    });
    
    req.on('error', (e) => console.log('Connection Failed. Is Obsidian running?', e.message));
    req.on('timeout', () => { req.destroy(); console.log('Connection timed out.'); });
    req.end();
}

testObsidian();
