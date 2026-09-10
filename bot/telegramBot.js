const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const mammoth = require('mammoth');
const aiService = require('../services/aiService');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// In-memory session store
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      state: 'idle',
      jobDescription: '',
      results: [],       // store multiple resume results
      resumeCount: 0,
    });
  }
  return sessions.get(chatId);
}

// Middleware
bot.use(async (ctx, next) => {
  if (!ctx.chat) return next();
  ctx.session = getSession(ctx.chat.id.toString());
  return next();
});

// Helper: detect file type
function detectFileType(mimeType, fileName) {
  mimeType = (mimeType || '').toLowerCase();
  fileName = (fileName || '').toLowerCase();
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return 'pdf';
  if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword' || fileName.endsWith('.docx') || fileName.endsWith('.doc')) return 'docx';
  if (mimeType === 'text/plain' || fileName.endsWith('.txt')) return 'txt';
  return null;
}

// Helper: extract text from document
async function extractTextFromDocument(ctx, document) {
  const fileType = detectFileType(document.mime_type, document.file_name);
  if (!fileType) return { error: 'Unsupported format. Please upload PDF, DOCX, or TXT.' };

  const fileLink = await ctx.telegram.getFileLink(document.file_id);
  const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
  const fileBuffer = Buffer.from(response.data, 'binary');

  let text = '';
  if (fileType === 'pdf') {
    const pdfParse = require('pdf-parse');
    const pdfData = await pdfParse(fileBuffer);
    text = pdfData.text;
  } else if (fileType === 'docx') {
    const docxData = await mammoth.extractRawText({ buffer: fileBuffer });
    text = docxData.value;
  } else {
    text = fileBuffer.toString('utf8');
  }

  if (!text || text.trim().length === 0) return { error: 'Could not extract text. File might be empty or image-based.' };
  return { text: text.trim() };
}

// Helper: generate score bar
function scoreBar(score) {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${score}%`;
}

// Helper: format the detailed ATS result
function formatResult(aiResult, resumeName, index) {
  let msg = '';
  msg += `${'━'.repeat(32)}\n`;
  msg += `📄 RESUME ${index}: ${resumeName}\n`;
  msg += `${'━'.repeat(32)}\n\n`;

  // Overall Score with visual bar
  msg += `📊 OVERALL ATS SCORE\n`;
  msg += `   ${scoreBar(aiResult.score)}\n\n`;

  // Score Breakdown
  if (aiResult.score_breakdown) {
    const sb = aiResult.score_breakdown;
    msg += `📈 SCORE BREAKDOWN\n`;
    msg += `   Skills Match:      ${scoreBar(sb.skills_match || 0)}\n`;
    msg += `   Experience:        ${scoreBar(sb.experience_relevance || 0)}\n`;
    msg += `   Education:         ${scoreBar(sb.education_fit || 0)}\n`;
    msg += `   Keywords:          ${scoreBar(sb.keyword_optimization || 0)}\n`;
    msg += `   Presentation:      ${scoreBar(sb.overall_presentation || 0)}\n\n`;
  }

  // Verdict
  if (aiResult.verdict) {
    msg += `🎯 VERDICT: ${aiResult.verdict}\n\n`;
  }

  // Strengths
  msg += `✅ KEY STRENGTHS\n`;
  (aiResult.good_points || []).forEach((p, i) => { msg += `   ${i + 1}. ${p}\n`; });

  // Weaknesses
  msg += `\n⚠️ GAPS & IMPROVEMENTS NEEDED\n`;
  (aiResult.bad_points || []).forEach((p, i) => { msg += `   ${i + 1}. ${p}\n`; });

  // Missing Keywords
  if (aiResult.missing_keywords && aiResult.missing_keywords.length > 0) {
    msg += `\n🔑 MISSING ATS KEYWORDS\n`;
    msg += `   ${aiResult.missing_keywords.join(', ')}\n`;
  }

  // Resume Tips
  if (aiResult.resume_tips && aiResult.resume_tips.length > 0) {
    msg += `\n💡 RESUME TIPS\n`;
    aiResult.resume_tips.forEach((t, i) => { msg += `   ${i + 1}. ${t}\n`; });
  }

  // Courses
  msg += `\n📚 RECOMMENDED COURSES\n`;
  const courses = aiResult.suggested_courses || [];
  courses.forEach((c, i) => {
    if (typeof c === 'string') {
      msg += `   ${i + 1}. ${c}\n`;
    } else {
      msg += `   ${i + 1}. ${c.title || 'Course'} (${c.platform || 'Online'})\n`;
      if (c.url) msg += `      🔗 ${c.url}\n`;
      if (c.reason) msg += `      💬 ${c.reason}\n`;
    }
  });

  return msg;
}

// ============= COMMANDS =============

bot.start(async (ctx) => {
  ctx.session.state = 'awaiting_jd';
  ctx.session.jobDescription = '';
  ctx.session.results = [];
  ctx.session.resumeCount = 0;

  await ctx.reply(
    '🚀 Welcome to HashiraMatch - AI ATS Evaluator!\n\n' +
    'I compare resumes against job descriptions using AI and give you:\n' +
    '📊 Detailed ATS matching score with breakdown\n' +
    '✅ Key strengths & ⚠️ gaps analysis\n' +
    '🔑 Missing ATS keywords\n' +
    '📚 Recommended courses with direct links\n' +
    '💡 Resume improvement tips\n\n' +
    'You can evaluate MULTIPLE resumes against ONE job description!\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 Start Evaluation', 'begin_eval')],
      [Markup.button.callback('ℹ️ How It Works', 'how_it_works')],
    ])
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    '📖 HashiraMatch Commands:\n\n' +
    '/start - Start fresh evaluation\n' +
    '/help - Show this help message\n' +
    '/status - Check current session status\n\n' +
    'Supported file formats: PDF, DOCX, TXT'
  );
});

bot.command('status', async (ctx) => {
  const s = ctx.session;
  let status = `📋 Session Status:\n`;
  status += `   State: ${s.state}\n`;
  status += `   JD Loaded: ${s.jobDescription ? 'Yes (' + s.jobDescription.length + ' chars)' : 'No'}\n`;
  status += `   Resumes Evaluated: ${s.resumeCount}\n`;
  await ctx.reply(status);
});

// ============= BUTTON CALLBACKS =============

bot.action('begin_eval', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.state = 'awaiting_jd';
  ctx.session.jobDescription = '';
  ctx.session.results = [];
  ctx.session.resumeCount = 0;
  await ctx.reply(
    '📝 Step 1: Send the Job Description\n\n' +
    'You can either:\n' +
    '• Paste the JD as text\n' +
    '• Upload a PDF/DOCX/TXT file containing the JD'
  );
});

bot.action('how_it_works', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '🔍 How HashiraMatch Works:\n\n' +
    '1️⃣ You provide a Job Description\n' +
    '2️⃣ You upload one or more Resumes\n' +
    '3️⃣ Our AI analyzes each resume against the JD\n' +
    '4️⃣ You get a detailed report with:\n' +
    '   • ATS score (0-100) with 5 sub-scores\n' +
    '   • Strengths & weaknesses analysis\n' +
    '   • Missing ATS keywords to add\n' +
    '   • Specific course recommendations with links\n' +
    '   • Resume formatting tips\n\n' +
    '🔄 You can upload multiple resumes to compare!',
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 Start Now', 'begin_eval')],
    ])
  );
});

bot.action('add_another', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.state = 'awaiting_resume';
  await ctx.reply(
    `📄 Upload another resume (PDF/DOCX/TXT).\n` +
    `Resumes evaluated so far: ${ctx.session.resumeCount}`
  );
});

bot.action('new_jd', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.state = 'awaiting_jd';
  ctx.session.jobDescription = '';
  ctx.session.results = [];
  ctx.session.resumeCount = 0;
  await ctx.reply('🔄 Starting fresh! Send me a new Job Description (text or file).');
});

bot.action('show_summary', async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.session.results.length === 0) {
    return ctx.reply('No results to summarize yet.');
  }

  let summary = '📊 COMPARISON SUMMARY\n';
  summary += '━'.repeat(32) + '\n\n';

  // Sort by score descending
  const sorted = [...ctx.session.results].sort((a, b) => b.score - a.score);
  sorted.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    summary += `${medal} ${r.name}: ${scoreBar(r.score)}\n`;
  });

  summary += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  summary += `Best match: ${sorted[0].name} (${sorted[0].score}%)\n`;

  await ctx.reply(summary, Markup.inlineKeyboard([
    [Markup.button.callback('📄 Add Another Resume', 'add_another')],
    [Markup.button.callback('🔄 New Job Description', 'new_jd')],
  ]));
});

// ============= TEXT HANDLER =============

bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  if (ctx.session.state === 'awaiting_jd') {
    ctx.session.jobDescription = text;
    ctx.session.state = 'awaiting_resume';
    return ctx.reply(
      '✅ Job Description saved!\n\n' +
      '📄 Step 2: Upload a Resume (PDF/DOCX/TXT)\n\n' +
      'You can upload multiple resumes one by one — I\'ll evaluate each one against this JD!',
      Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Change JD', 'new_jd')],
      ])
    );
  }

  if (ctx.session.state === 'awaiting_resume') {
    return ctx.reply('📎 Please upload a resume document (PDF, DOCX, or TXT file).');
  }

  ctx.session.state = 'awaiting_jd';
  return ctx.reply(
    'Let\'s start! Send me the Job Description.',
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 Start Evaluation', 'begin_eval')],
    ])
  );
});

// ============= DOCUMENT HANDLER =============

bot.on('document', async (ctx) => {
  const document = ctx.message.document;

  // --- JD as document ---
  if (ctx.session.state === 'awaiting_jd') {
    try {
      await ctx.reply('⏳ Extracting Job Description...');
      const result = await extractTextFromDocument(ctx, document);
      if (result.error) return ctx.reply('❌ ' + result.error);

      ctx.session.jobDescription = result.text;
      ctx.session.state = 'awaiting_resume';
      console.log('[Bot] JD extracted, length:', result.text.length);
      return ctx.reply(
        '✅ Job Description extracted!\n\n' +
        '📄 Step 2: Upload a Resume (PDF/DOCX/TXT)\n' +
        'You can upload multiple resumes — I\'ll evaluate each one!',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Change JD', 'new_jd')],
        ])
      );
    } catch (err) {
      console.error('[Bot] Error extracting JD:', err.message);
      return ctx.reply('❌ Failed to read this file. Try pasting the JD as text instead.');
    }
  }

  // --- Resume as document ---
  if (ctx.session.state === 'awaiting_resume') {
    try {
      const resumeName = document.file_name || `Resume_${ctx.session.resumeCount + 1}`;
      await ctx.reply(`⏳ Analyzing "${resumeName}" against the Job Description...\nThis may take 10-15 seconds.`);

      const result = await extractTextFromDocument(ctx, document);
      if (result.error) return ctx.reply('❌ ' + result.error);

      console.log(`[Bot] Resume "${resumeName}" extracted, length: ${result.text.length}`);
      console.log('[Bot] Calling AI service...');

      const aiResult = await aiService.evaluateResume(ctx.session.jobDescription, result.text);
      console.log('[Bot] AI result received, score:', aiResult.score);

      ctx.session.resumeCount++;
      ctx.session.results.push({ name: resumeName, score: aiResult.score });

      // Format and send the detailed result
      const formattedResult = formatResult(aiResult, resumeName, ctx.session.resumeCount);

      // Split long messages (Telegram 4096 char limit)
      const chunks = [];
      let current = '';
      formattedResult.split('\n').forEach(line => {
        if ((current + line + '\n').length > 3900) {
          chunks.push(current);
          current = '';
        }
        current += line + '\n';
      });
      if (current) chunks.push(current);

      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }

      // Action buttons after result
      const buttons = [
        [Markup.button.callback('📄 Evaluate Another Resume', 'add_another')],
      ];
      if (ctx.session.resumeCount > 1) {
        buttons.push([Markup.button.callback('📊 Compare All Resumes', 'show_summary')]);
      }
      buttons.push([Markup.button.callback('🔄 New Job Description', 'new_jd')]);

      await ctx.reply(
        `✅ Evaluation complete! (${ctx.session.resumeCount} resume${ctx.session.resumeCount > 1 ? 's' : ''} evaluated)`,
        Markup.inlineKeyboard(buttons)
      );

    } catch (error) {
      console.error('[Bot] Error processing resume:', error.message || error);
      await ctx.reply(
        '❌ Error: ' + (error.message || 'Unknown error') + '\n\nPlease try again.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Try Again', 'add_another')],
          [Markup.button.callback('📝 Start Over', 'new_jd')],
        ])
      );
    }
    return;
  }

  // Default
  ctx.session.state = 'awaiting_jd';
  return ctx.reply(
    'Send me a Job Description first!',
    Markup.inlineKeyboard([[Markup.button.callback('📝 Start', 'begin_eval')]])
  );
});

module.exports = bot;
