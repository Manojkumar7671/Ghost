const MODELS = {
  fast: 'llama-3.1-8b-instant',
  default: 'llama-3.3-70b-versatile',
  reasoning: 'deepseek-r1-distill-llama-70b',
  creative: 'llama-3.3-70b-versatile',
  heavy: 'deepseek-r1-distill-llama-70b'
};
function route(message='') {
  const m = message.toLowerCase();
  if (m.length<40 && /^(hi|hello|hey|ok|yes|no|sure|thanks)/.test(m)) return {model:MODELS.fast, reason:'simple'};
  if (/code|debug|error|fix|build|script|function|implement|hack|security/.test(m)) return {model:MODELS.reasoning, reason:'code'};
  if (/write|draft|blog|tweet|post|story|email|content/.test(m)) return {model:MODELS.creative, reason:'creative'};
  if (/analyze|research|strategy|plan|explain|compare|deep|learn|study/.test(m)) return {model:MODELS.heavy, reason:'heavy'};
  return {model:MODELS.default, reason:'default'};
}
module.exports = { route, MODELS };
