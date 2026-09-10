const Groq = require('groq-sdk');

// Load all Groq API keys for round-robin failover
const GROQ_KEYS = [];
for (let i = 1; i <= 10; i++) {
  const key = process.env[`GROQ_API_KEY_${i}`];
  if (key) GROQ_KEYS.push(key);
}
let currentKeyIndex = 0;
console.log(`[AI] Loaded ${GROQ_KEYS.length} Groq API keys`);

const MODELS = [
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-20b',
];

const ATS_PROMPT = (jd, resume) => `You are an expert ATS (Applicant Tracking System), senior technical recruiter, and career advisor.
Evaluate the Resume against the Job Description with extreme detail.

Analyze these dimensions:
1. Skills Match - Hard skills, soft skills, tools, technologies
2. Experience Relevance - Years, domain, role level match
3. Education Fit - Degree, certifications, relevance
4. Keywords - ATS keyword optimization
5. Formatting & Presentation - Professional quality signals

### Job Description
${jd}

### Resume
${resume}

Return ONLY valid JSON. No text before or after. No markdown fences. Just pure JSON:
{
  "score": 72,
  "score_breakdown": {
    "skills_match": 75,
    "experience_relevance": 80,
    "education_fit": 60,
    "keyword_optimization": 70,
    "overall_presentation": 65
  },
  "good_points": ["strength 1 with specific detail", "strength 2", "strength 3", "strength 4", "strength 5"],
  "bad_points": ["gap 1 with specific detail", "gap 2", "gap 3", "gap 4"],
  "missing_keywords": ["keyword1", "keyword2", "keyword3"],
  "suggested_courses": [
    {"title": "Course Name", "platform": "Coursera", "url": "https://www.coursera.org/search?query=relevant+topic", "reason": "Why this helps"},
    {"title": "Course Name", "platform": "Udemy", "url": "https://www.udemy.com/courses/search/?q=relevant+topic", "reason": "Why this helps"},
    {"title": "Course Name", "platform": "LinkedIn Learning", "url": "https://www.linkedin.com/learning/search?keywords=relevant+topic", "reason": "Why this helps"},
    {"title": "Course Name", "platform": "YouTube/Free", "url": "https://www.youtube.com/results?search_query=relevant+topic+tutorial", "reason": "Why this helps"}
  ],
  "resume_tips": ["Actionable tip 1 to improve the resume", "Tip 2", "Tip 3"],
  "verdict": "One sentence overall verdict about the candidate's fit"
}

Rules:
- score: integer 0-100
- score_breakdown: 5 sub-scores each 0-100
- good_points: minimum 4 specific strengths
- bad_points: minimum 3 specific gaps
- missing_keywords: top ATS keywords missing from resume
- suggested_courses: minimum 4 courses with real platform search URLs
- resume_tips: minimum 3 actionable resume improvement tips
- verdict: one concise sentence`;

/**
 * Try Groq keys in round-robin with model fallback.
 */
async function evaluateResume(jd, resume) {
  const prompt = ATS_PROMPT(jd, resume);

  // Try each key starting from current index (round-robin)
  for (let k = 0; k < GROQ_KEYS.length; k++) {
    const keyIdx = (currentKeyIndex + k) % GROQ_KEYS.length;
    const apiKey = GROQ_KEYS[keyIdx];

    for (const model of MODELS) {
      try {
        const keyPreview = apiKey.substring(0, 8) + '...';
        console.log(`[AI] Trying model=${model} key=${keyPreview}`);

        const groq = new Groq({ apiKey });
        const chatCompletion = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: 'You are an ATS expert. Respond with valid JSON only. No markdown, no explanation, no think tags.' },
            { role: 'user', content: prompt }
          ],
          model: model,
          temperature: 0.3,
          max_tokens: 4096,
        });

        const responseText = chatCompletion.choices[0].message.content.trim();
        console.log(`[AI] Got response from ${model}, length: ${responseText.length}`);

        // Clean response
        let jsonStr = responseText;
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();
        const thinkMatch = jsonStr.match(/<\/think>\s*([\s\S]*)/);
        if (thinkMatch) jsonStr = thinkMatch[1].trim();

        const parsed = JSON.parse(jsonStr);

        if (typeof parsed.score === 'number' && Array.isArray(parsed.good_points)) {
          console.log(`[AI] ✅ Success! Score: ${parsed.score}`);
          // Advance round-robin for next call
          currentKeyIndex = (keyIdx + 1) % GROQ_KEYS.length;
          return parsed;
        }
      } catch (err) {
        console.error(`[AI] ❌ Failed model=${model}: ${(err.message || '').substring(0, 120)}`);
      }
    }
  }

  console.error('[AI] ALL providers failed.');
  return {
    score: 0,
    score_breakdown: { skills_match: 0, experience_relevance: 0, education_fit: 0, keyword_optimization: 0, overall_presentation: 0 },
    good_points: ['AI service temporarily unavailable'],
    bad_points: ['Please try again in a moment'],
    missing_keywords: [],
    suggested_courses: [],
    resume_tips: ['Please retry your evaluation'],
    verdict: 'Unable to analyze at this time.'
  };
}

module.exports = { evaluateResume };
