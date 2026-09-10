const { Telegraf } = require('telegraf');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const aiService = require('../services/aiService');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// In-memory session store since we aren't using a database
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

bot.start(async (ctx) => {
  ctx.session.state = 'awaiting_jd';
  ctx.reply('Welcome to the AI ATS Bot! 🚀\n\nTo begin evaluating a candidate, please send me the **Job Description** as a text message.', { parse_mode: 'Markdown' });
});

// Handle text messages (Job Description)
bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  if (ctx.session.state === 'awaiting_jd') {
    ctx.session.jobDescription = text;
    ctx.session.state = 'awaiting_resume';
    
    return ctx.reply(`Job Description saved! ✅\n\nNow, please upload the candidate's **Resume (in PDF format)** as a document attachment.`);
  } 
  
  if (ctx.session.state === 'awaiting_resume') {
    return ctx.reply('I am waiting for a Resume PDF. Please attach and send a document.');
  }

  // If idle or unknown state, reset
  ctx.session.state = 'awaiting_jd';
  return ctx.reply(`Let's start over. Please send me the **Job Description** as a text message.`, { parse_mode: 'Markdown' });
});

// Handle Document messages (Resume)
bot.on('document', async (ctx) => {
  if (ctx.session.state !== 'awaiting_resume') {
    return ctx.reply('Please send the Job Description first.');
  }

  const document = ctx.message.document;
  if (document.mime_type !== 'application/pdf') {
    return ctx.reply('❌ Please upload a valid PDF file for the resume.');
  }

  try {
    const statusMsg = await ctx.reply('⏳ Downloading and analyzing resume... This might take a few seconds.');

    // 1. Get file link from Telegram
    const fileLink = await ctx.telegram.getFileLink(document.file_id);
    
    // 2. Download the PDF as buffer
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(response.data, 'binary');

    // 3. Extract text using pdf-parse
    const pdfData = await pdfParse(pdfBuffer);
    const resumeText = pdfData.text;

    if (!resumeText || resumeText.trim().length === 0) {
      return ctx.reply('❌ Could not extract text from this PDF. It might be an image-based PDF.');
    }

    // 4. Call AI Service
    const aiResult = await aiService.evaluateResume(ctx.session.jobDescription, resumeText);

    // 5. Format and send response
    let replyMsg = `📊 **ATS Matching Score: ${aiResult.score}%**\n\n`;
    
    replyMsg += `✅ **Key Strengths (Matches):**\n`;
    aiResult.good_points.forEach(p => replyMsg += `- ${p}\n`);
    
    replyMsg += `\n⚠️ **Areas for Improvement (Missing):**\n`;
    aiResult.bad_points.forEach(p => replyMsg += `- ${p}\n`);
    
    replyMsg += `\n📚 **Suggested Courses/Skills to Learn:**\n`;
    aiResult.suggested_courses.forEach(c => replyMsg += `- ${c}\n`);

    // Reset session for next use
    ctx.session.state = 'awaiting_jd';
    ctx.session.jobDescription = '';

    await ctx.reply(replyMsg, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error processing document:', error);
    ctx.reply('❌ An error occurred while evaluating the resume. Please try again.');
  }
});

module.exports = bot;
