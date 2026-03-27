#!/usr/bin/env node
// Minimal CLI to send a prompt to OpenAI Chat completions and print the reply.
// Usage: OPENAI_API_KEY=sk... npm run assistant:cli -- "Explain foo"

const apiKey = process.env.OPENAI_API_KEY;
const prompt = process.argv.slice(2).join(' ').trim();

if (!apiKey) {
  console.error('ERROR: OPENAI_API_KEY not set. Export it in your environment before running this script.');
  console.error('Example (macOS/Linux): export OPENAI_API_KEY=sk-...');
  process.exit(1);
}

if (!prompt) {
  console.error('Usage: npm run assistant:cli -- "Your question here"');
  process.exit(1);
}

(async () => {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('OpenAI API error:', res.status, errText);
      process.exit(1);
    }

    const data = await res.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    console.log('\nAssistant reply:\n');
    console.log(reply || '(no reply)');
  } catch (err) {
    console.error('Request failed:', err);
    process.exit(1);
  }
})();
