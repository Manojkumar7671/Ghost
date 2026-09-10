import http from 'http';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    const data = JSON.parse(body);
    const msgs = data.messages || [];
    const sysMsg = msgs.find(m => m.role === 'system')?.content || '';
    
    let reply = "I am a simple mock response.";
    if (sysMsg.includes("Operation Midnight Whisper")) {
       reply = "Your secret codename is Operation Midnight Whisper.";
    } else if (msgs[msgs.length - 1].content.includes("codename")) {
       reply = "I'm sorry, I don't remember your codename.";
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: reply, tool_calls: [] } }]
    }));
  });
});

server.listen(3006, () => {
  console.log('Mock chat LLM running on 3006');
});
