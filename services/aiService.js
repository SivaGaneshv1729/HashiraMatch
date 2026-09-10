const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Evaluates a resume against a job description using Gemini.
 * @param {string} jd - The job description text.
 * @param {string} resume - The resume text.
 * @returns {Promise<Object>} The parsed JSON result.
 */
async function evaluateResume(jd, resume) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
You are an expert ATS (Applicant Tracking System) and senior technical recruiter. 
Your task is to evaluate the following Resume against the provided Job Description (JD).

### Job Description
${jd}

### Resume
${resume}

You must return a raw JSON object (without markdown code blocks, just the JSON string) with the following structure:
{
  "score": <number between 0 and 100 representing the match percentage>,
  "good_points": [<array of strings explaining what matches well in the resume>],
  "bad_points": [<array of strings explaining what is missing or doesn't match>],
  "suggested_courses": [<array of strings suggesting specific courses/topics the candidate should learn to improve their match>]
}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Attempt to extract JSON if the model added markdown blocks by mistake
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('\`\`\`json')) {
      jsonStr = jsonStr.substring(7, jsonStr.length - 3).trim();
    } else if (jsonStr.startsWith('\`\`\`')) {
      jsonStr = jsonStr.substring(3, jsonStr.length - 3).trim();
    }

    const parsedData = JSON.parse(jsonStr);
    return parsedData;

  } catch (error) {
    console.error("Error in evaluateResume:", error);
    throw error;
  }
}

module.exports = {
  evaluateResume
};
