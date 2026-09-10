const { Telegraf } = require('telegraf');
const axios = require('axios');
const mammoth = require('mammoth');
const aiService = require('../services/aiService');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// In-memory session store
const sessions = new Map();

// Middleware to ensure user session exists
bot.use(async (ctx, next) => {
  if (!ctx.chat) return next();
  const chatId = ctx.chat.id.toString();
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { state: 'idle', jobDescription: '' });
  }
  ctx.session = sessions.get(chatId);
  return next();
});

/**
 * Detect file type from mime type or file name extension.
 */
function detectFileType(mimeType, fileName) {
  mimeType = (mimeType || '').toLowerCase();
  fileName = (fileName || '').toLowerCase();

  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return 'pdf';
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    fileName.endsWith('.docx') || fileName.endsWith('.doc')
  ) return 'docx';
  if (mimeType === 'text/plain' || fileName.endsWith('.txt')) return 'txt';
  return null;
}

/**
 * Download a Telegram file and extract text from it.
 */
async function extractTextFromDocument(ctx, document) {
  const fileType = detectFileType(document.mime_type, document.file_name);

  if (!fileType) {
    return { error: 'Unsupported file format. Please upload a PDF, DOCX, or TXT file.' };
  }

  // Download file from Telegram servers
  const fileLink = await ctx.telegram.getFileLink(document.file_id);
  const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
  const fileBuffer = Buffer.from(response.data, 'binary');

  let text = '';

  if (fileType === 'pdf') {
    // pdf-parse v1.1.1 uses a default function export
    const pdfParse = require('pdf-parse');
    const pdfData = await pdfParse(fileBuffer);
    text = pdfData.text;
  } else if (fileType === 'docx') {
    const docxData = await mammoth.extractRawText({ buffer: fileBuffer });
    text = docxData.value;
  } else if (fileType === 'txt') {
    text = fileBuffer.toString('utf8');
  }

  if (!text || text.trim().length === 0) {
    return { error: 'Could not extract text from this document. It might be empty or image-based.' };
  }

  return { text: text.trim() };
}

// /start command
bot.start(async (ctx) => {
  ctx.session.state = 'awaiting_jd';
  ctx.session.jobDescription = '';
  await ctx.reply(
    '🚀 Welcome to HashiraMatch - AI ATS Bot!\n\n' +
    'Step 1: Send me the Job Description.\n' +
    'You can paste it as text OR upload a PDF/DOCX/TXT file.'
  );
});

// Handle TEXT messages
bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  if (ctx.session.state === 'awaiting_jd') {
    ctx.session.jobDescription = text;
    ctx.session.state = 'awaiting_resume';
    return ctx.reply(
      '✅ Job Description saved!\n\n' +
      'Step 2: Now upload the Resume.\n' +
      'Supported formats: PDF, DOCX, TXT'
    );
  }

  if (ctx.session.state === 'awaiting_resume') {
    return ctx.reply('I need a document file for the resume. Please upload a PDF, DOCX, or TXT file.');
  }

  // Default: reset
  ctx.session.state = 'awaiting_jd';
  ctx.session.jobDescription = '';
  return ctx.reply(
    'Let\'s start fresh!\n\nStep 1: Send me the Job Description (text or document).'
  );
});

// Handle DOCUMENT uploads (both JD and Resume)
bot.on('document', async (ctx) => {
  const document = ctx.message.document;

  // --- JD as document ---
  if (ctx.session.state === 'awaiting_jd') {
    try {
      await ctx.reply('⏳ Extracting Job Description from your file...');
      const result = await extractTextFromDocument(ctx, document);

      if (result.error) {
        return ctx.reply('❌ ' + result.error);
      }

      ctx.session.jobDescription = result.text;
      ctx.session.state = 'awaiting_resume';
      console.log('[Bot] JD extracted, length:', result.text.length);
      return ctx.reply(
        '✅ Job Description extracted and saved!\n\n' +
        'Step 2: Now upload the Resume.\n' +
        'Supported formats: PDF, DOCX, TXT'
      );
    } catch (err) {
      console.error('[Bot] Error extracting JD:', err.message);
      return ctx.reply('❌ Failed to read this document. Please try again or paste the JD as text.');
    }
  }

  // --- Resume as document ---
  if (ctx.session.state === 'awaiting_resume') {
    try {
      await ctx.reply('⏳ Analyzing your resume against the Job Description... Please wait.');

      const result = await extractTextFromDocument(ctx, document);
      if (result.error) {
        return ctx.reply('❌ ' + result.error);
      }

      console.log('[Bot] Resume extracted, length:', result.text.length);
      console.log('[Bot] Calling AI service...');

      // Call AI Service
      const aiResult = await aiService.evaluateResume(ctx.session.jobDescription, result.text);
      console.log('[Bot] AI result received, score:', aiResult.score);

      // Format response as plain text to avoid Telegram markdown issues
      let replyMsg = '';
      replyMsg += `📊 ATS MATCHING SCORE: ${aiResult.score}/100\n`;
      replyMsg += `${'━'.repeat(30)}\n\n`;

      replyMsg += `✅ KEY STRENGTHS:\n`;
      (aiResult.good_points || []).forEach((p, i) => {
        replyMsg += `  ${i + 1}. ${p}\n`;
      });

      replyMsg += `\n⚠️ AREAS FOR IMPROVEMENT:\n`;
      (aiResult.bad_points || []).forEach((p, i) => {
        replyMsg += `  ${i + 1}. ${p}\n`;
      });

      replyMsg += `\n📚 SUGGESTED COURSES & SKILLS:\n`;
      (aiResult.suggested_courses || []).forEach((c, i) => {
        replyMsg += `  ${i + 1}. ${c}\n`;
      });

      replyMsg += `\n${'━'.repeat(30)}\n`;
      replyMsg += `Send /start to evaluate another resume!`;

      // Reset session
      ctx.session.state = 'awaiting_jd';
      ctx.session.jobDescription = '';

      // Split if message is too long for Telegram (4096 char limit)
      if (replyMsg.length > 4000) {
        const mid = replyMsg.lastIndexOf('\n', 3900);
        await ctx.reply(replyMsg.substring(0, mid));
        await ctx.reply(replyMsg.substring(mid));
      } else {
        await ctx.reply(replyMsg);
      }

    } catch (error) {
      console.error('[Bot] Error processing resume:', error.message || error);
      await ctx.reply('❌ An error occurred while evaluating the resume.\n\nError: ' + (error.message || 'Unknown error') + '\n\nPlease send /start to try again.');
    }
    return;
  }

  // Not in the right state
  ctx.session.state = 'awaiting_jd';
  ctx.session.jobDescription = '';
  return ctx.reply('Let\'s start fresh!\n\nStep 1: Send me the Job Description (text or document).');
});

module.exports = bot;
