export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    const openAiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    let academicPapers = [];
    try {
      const scholarRes = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(question)}&per_page=3`);
      const scholarData = await scholarRes.json();
      academicPapers = (scholarData.results || []).map(paper => ({
        title: paper.title || 'Untitled Academic Work',
        author: paper.publication_year ? `${paper.publication_year}` : 'Academic Source',
        link: paper.doi || paper.id || '#'
      }));
    } catch (e) { console.error(e); }

    const basePrompt = `Analyze the user's question and deliver a detailed, highly accurate response. 
    CRITICAL RULES:
    - Absolutely do not reference any AI brand identities like "According to ChatGPT", "Claude", or "Gemini". 
    - Blend the content seamlessly into a unified, clean answer.
    - If the user's question involves a cycle, process, workflow, sequence, or structural system loop, include a clean Mermaid.js flowchart snippet. Format it inside codeblocks like:
    \`\`\`mermaid
    graph TD
      A[Start] --> B(Step)
    \`\`\`
    Question: ${question}`;

    const [gptRes, claudeRes, geminiRes] = await Promise.allSettled([
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: basePrompt }] })
      }).then(r => r.json()),

      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1200, messages: [{ role: 'user', content: basePrompt }] })
      }).then(r => r.json()),

      fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: basePrompt }] }] })
      }).then(r => r.json())
    ]);

    const gptText = gptRes.status === 'fulfilled' ? gptRes.value.choices?.[0]?.message?.content || '' : '';
    const claudeText = claudeRes.status === 'fulfilled' ? claudeRes.value.content?.[0]?.text || '' : '';
    const geminiText = geminiRes.status === 'fulfilled' ? geminiRes.value.candidates?.[0]?.content?.parts?.[0]?.text || '' : '';

    const synthesisResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Merge the following computational texts into one authoritative, seamless answer. Ensure any visual data or Mermaid diagram blocks (\`\`\`mermaid ... \`\`\`) provided are preserved safely. Clean out any brand labels.\n\nText A: ${gptText}\n\nText B: ${claudeText}\n\nText C: ${geminiText}`
        }]
      })
    }).then(r => r.json());

    const finalizedAnswer = synthesisResponse.choices?.[0]?.message?.content || "Could not synthesize information.";

    return res.status(200).json({
      reply: finalizedAnswer,
      papers: academicPapers,
      imageSearchQuery: question.split(' ').slice(0, 3).join(',')
    });

  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
