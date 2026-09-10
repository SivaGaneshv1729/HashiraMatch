const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const { getInstances, resetInstances } = require('./mock-telegraf');

const originalLoad = Module._load;

const FAKE_RESULT = {
  score: 82,
  good_points: ['Matches Node.js', 'Has experience with APIs'],
  bad_points: ['Missing AWS knowledge'],
  suggested_courses: ['AWS Certified Developer']
};

let failAI = false;
let docText = 'FAKE RESUME TEXT LINE';
const docData = { text: docText };

function installFullEnv() {
  Module._load = function (request, parent, isMain) {
    if (request === 'telegraf') {
      return { Telegraf: require('./mock-telegraf')._constructor };
    }
    if (request.endsWith(('aiService')) || request.endsWith('services\\aiService.js') || request.endsWith('services/aiService.js')) {
      return {
        evaluateResume: async () => {
          if (failAI) throw new Error('Simulated AI failure');
          return JSON.parse(JSON.stringify(FAKE_RESULT));
        }
      };
    }
    if (request === 'pdf-parse') {
      return async () => ({ text: docData.text });
    }
    if (request === 'mammoth') {
      return { extractRawText: async () => ({ value: docData.text }) };
    }
    if (request === 'axios') {
      return { get: async () => ({ data: Buffer.from('fake-file-bytes') }) };
    }
    return originalLoad.apply(this, arguments);
  };
}

function makeCtx(bot, chatId, overrides = {}) {
  const ctx = {
    chat: { id: chatId },
    session: undefined,
    reply: async (text, opts) => { ctx.lastReply = text; return { text, opts }; },
    telegram: {
      getFileLink: async () => ({ href: 'https://fake/file.pdf' })
    },
    message: { text: '', document: null }
  };
  Object.assign(ctx, overrides);
  return ctx;
}

// Runs the session middleware then an arbitrary handler, mirroring real Telegraf.
async function handle(bot, ctx, handler) {
  await new Promise((resolve, reject) => {
    bot.useHandlers[0](ctx, () => Promise.resolve(handler(ctx)).then(resolve, reject));
  });
}

// Walks a fresh chat through /start + JD text so it lands in awaiting_resume.
async function reachAwaitingResume(bot, ctx) {
  await handle(bot, ctx, bot.startHandler);
  ctx.message.text = 'Some Job Description';
  await handle(bot, ctx, bot.onHandlers['text']);
  assert.strictEqual(ctx.session.state, 'awaiting_resume');
}

test('start sets state to awaiting_jd and replies with welcome', async () => {
  resetInstances();
  installFullEnv();
  const bot = require('../bot/telegramBot');
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2001);
  await handle(inst, ctx, inst.startHandler);
  assert.strictEqual(ctx.session.state, 'awaiting_jd');
  assert.match(ctx.lastReply, /Job Description/);
});

test('text in awaiting_jd stores JD and moves to awaiting_resume', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2002);
  await handle(inst, ctx, inst.startHandler);
  ctx.message.text = 'This is the job description.';
  await handle(inst, ctx, inst.onHandlers['text']);
  assert.strictEqual(ctx.session.state, 'awaiting_resume');
  assert.strictEqual(ctx.session.jobDescription, 'This is the job description.');
});

test('text in awaiting_resume tells user to send PDF', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2003);
  await reachAwaitingResume(inst, ctx);
  ctx.message.text = 'some random text';
  await handle(inst, ctx, inst.onHandlers['text']);
  assert.strictEqual(ctx.session.state, 'awaiting_resume');
  assert.match(ctx.lastReply, /PDF/);
});

test('text in idle resets to awaiting_jd', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2004);
  await handle(inst, ctx, inst.onHandlers['text']);
  assert.strictEqual(ctx.session.state, 'awaiting_jd');
});

test('document when idle resets to awaiting_jd', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2005);
  await handle(inst, ctx, inst.onHandlers['document']);
  assert.strictEqual(ctx.session.state, 'awaiting_jd');
  assert.match(ctx.lastReply, /Job Description/i);
});

test('JD can be uploaded as a document in awaiting_jd', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 20011);
  await handle(inst, ctx, inst.startHandler);
  ctx.message.document = { mime_type: 'application/pdf', file_id: 'jd-doc' };
  await handle(inst, ctx, inst.onHandlers['document']);
  assert.strictEqual(ctx.session.state, 'awaiting_resume');
  assert.strictEqual(ctx.session.jobDescription.trim(), 'FAKE RESUME TEXT LINE');
});

test('document with non-PDF mime is rejected and state preserved', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2006);
  await reachAwaitingResume(inst, ctx);
  ctx.message.document = { mime_type: 'application/octet-stream' };
  await handle(inst, ctx, inst.onHandlers['document']);
  assert.match(ctx.lastReply, /PDF/);
  assert.strictEqual(ctx.session.state, 'awaiting_resume');
});

test('full resume flow formats ATS result and resets session', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2007);
  await reachAwaitingResume(inst, ctx);
  ctx.message.document = { mime_type: 'application/pdf', file_id: 'abc123' };
  await handle(inst, ctx, inst.onHandlers['document']);
  const finalReply = ctx.lastReply;
  assert.match(finalReply, /ATS MATCHING SCORE: 82\/100/);
  assert.match(finalReply, /KEY STRENGTHS/);
  assert.match(finalReply, /AREAS FOR IMPROVEMENT/);
  assert.match(finalReply, /SUGGESTED COURSES/);
  assert.match(finalReply, /AWS Certified Developer/);
  assert.strictEqual(ctx.session.state, 'awaiting_jd');
  assert.strictEqual(ctx.session.jobDescription, '');
});

test('document with image-based PDF (empty text) reports cannot extract', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2008);
  await reachAwaitingResume(inst, ctx);
  docData.text = '   ';
  try {
    ctx.message.document = { mime_type: 'application/pdf', file_id: 'img1' };
    await handle(inst, ctx, inst.onHandlers['document']);
    assert.match(ctx.lastReply, /Could not extract text/);
  } finally {
    docData.text = 'FAKE RESUME TEXT LINE';
  }
  assert.strictEqual(ctx.session.state, 'awaiting_resume');
});

test('AI service failure replies error (state is NOT reset - documents bug)', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2009);
  await reachAwaitingResume(inst, ctx);
  failAI = true;
  try {
    ctx.message.document = { mime_type: 'application/pdf', file_id: 'fail1' };
    await handle(inst, ctx, inst.onHandlers['document']);
    assert.match(ctx.lastReply, /An error occurred/);
    // NOTE: catch block does not reset session, so user stays awaiting_resume (stuck).
    assert.strictEqual(ctx.session.state, 'awaiting_resume');
    assert.strictEqual(ctx.session.jobDescription, 'Some Job Description');
  } finally {
    failAI = false;
  }
});

test('document download failure replies error', async () => {
  const inst = getInstances()[0];
  const ctx = makeCtx(inst, 2010);
  await reachAwaitingResume(inst, ctx);
  const orig = ctx.telegram.getFileLink;
  ctx.telegram.getFileLink = async () => { throw new Error('network down'); };
  ctx.message.document = { mime_type: 'application/pdf', file_id: 'dl1' };
  await handle(inst, ctx, inst.onHandlers['document']);
  assert.match(ctx.lastReply, /An error occurred/);
  ctx.telegram.getFileLink = orig;
  // Still stuck in awaiting_resume after failure (bug).
  assert.strictEqual(ctx.session.state, 'awaiting_resume');
});
