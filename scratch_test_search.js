import browserClient from './services/browserbaseClient.js';
async function test() {
  const url = `https://lite.duckduckgo.com/lite/`;
  const res = await browserClient.sandboxNavigate(url, {
    actions: [
      { action: 'type', selector: 'input[name="q"]', text: 'Apple stock price' },
      { action: 'click', selector: 'input[type="submit"]' }
    ],
    closeAfter: true
  });
  console.log(res.text ? res.text.substring(0, 1000) : res.error);
}
test();
