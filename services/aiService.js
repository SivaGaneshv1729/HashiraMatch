const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize both AI clients
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const ATS_PROMPT = (jd, resume) => `You are an expert ATS (Applicant Tracking System) and senior technical recruiter.
Your task is to evaluate the following Resume against the provided Job Description (JD).

Analyze keyword matches, skills alignment, experience relevance, education fit, and overall suitability.

### Job Description
${jd}

### Resume
${resume}

You MUST return ONLY a valid JSON object. No extra text, no markdown, no explanation. Just pure JSON:
{"score": 72, "good_points": ["point1", "point2", "point3"], "bad_points": ["point1", "point2", "point3"], "suggested_courses": ["course1", "course2", "course3"]}

Rules:
- score: number between 0 and 100
- good_points: at least 3 strengths that match the JD
- bad_points: at least 3 gaps or weaknesses
- suggested_courses: at least 3 specific courses, certifications, or skills to learn (include platform names like Coursera, Udemy, LinkedIn Learning where possible)`;

/**
 * Try Groq first (fast), fall back to Gemini if it fails.
 */
async function evaluateResume(jd, resume) {
  const prompt = ATS_PROMPT(jd, resume);

  // --- Attempt 1: Groq (Llama 3.3 70B) ---
  try {
    console.log('[AI] Trying Groq...');
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    });

    const responseText = chatCompletion.choices[0].message.content;
    console.log('[AI] Groq responded successfully');
    return JSON.parse(responseText);
  } catch (groqError) {
    console.error('[AI] Groq failed:', groqError.message || groqError);
  }

  // --- Attempt 2: Gemini (fallback) ---
  try {
    console.log('[AI] Falling back to Gemini...');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    console.log('[AI] Gemini responded successfully');

    // Clean markdown code fences if present
    let jsonStr = responseText;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    return JSON.parse(jsonStr);
  } catch (geminiError) {
    console.error('[AI] Gemini also failed:', geminiError.message || geminiError);
  }

  // --- Both failed: return a fallback response ---
  console.error('[AI] All providers failed. Returning fallback.');
  return {
    score: 0,
    good_points: ['Unable to analyze - AI service temporarily unavailable'],
    bad_points: ['Unable to analyze - please try again in a moment'],
    suggested_courses: ['Please retry your evaluation']
  };
}

module.exports = { evaluateResume };
