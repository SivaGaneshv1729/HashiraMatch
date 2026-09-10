const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const originalLoad = Module._load;

let groqText = '';
let groqFails = false;
let geminiText = '';
let geminiFails = false;

function installMocks() {
  Module._load = function (request, parent, isMain) {
    if (request === 'groq-sdk') {
      return class Groq {
        get chat() {
          return {
            completions: {
              create: async () => {
                if (groqFails) throw new Error('Groq API error');
                return { choices: [{ message: { content: groqText } }] };
              }
            }
          };
        }
      };
    }
    if (request === '@google/generative-ai') {
      return {
        GoogleGenerativeAI: function () {
          return {
            getGenerativeModel: () => ({
              generateContent: async () => {
                if (geminiFails) throw new Error('Gemini API error');
                return { response: { text: () => geminiText } };
              }
            })
          };
        }
      };
    }
    return originalLoad.apply(this, arguments);
  };
}

function freshAI() {
  delete require.cache[require.resolve('../services/aiService')];
  return require('../services/aiService');
}

test('returns parsed JSON when Groq succeeds', async () => {
  installMocks();
  const ai = freshAI();
  groqText = '{"score":60,"good_points":["a"],"bad_points":["b"],"suggested_courses":["c"]}';
  const r = await ai.evaluateResume('jd', 'res');
  assert.strictEqual(r.score, 60);
  assert.deepStrictEqual(r.good_points, ['a']);
});

test('falls back to Gemini when Groq fails and parses its output', async () => {
  const ai = freshAI();
  groqFails = true;
  groqText = '';
  geminiFails = false;
  geminiText = '```json\n{"score":45,"good_points":["x"],"bad_points":["y"],"suggested_courses":["z"]}\n```';
  const r = await ai.evaluateResume('jd', 'res');
  assert.strictEqual(r.score, 45);
});

test('returns fallback object when both providers fail (never rejects)', async () => {
  const ai = freshAI();
  groqFails = true;
  geminiFails = true;
  const r = await ai.evaluateResume('jd', 'res');
  assert.strictEqual(r.score, 0);
  assert.ok(Array.isArray(r.good_points));
});

test('returns fallback when Groq returns invalid JSON', async () => {
  const ai = freshAI();
  groqFails = false;
  groqText = 'not json at all';
  geminiFails = true;
  const r = await ai.evaluateResume('jd', 'res');
  assert.strictEqual(r.score, 0);
});

test('returns fallback when Gemini returns invalid JSON', async () => {
  const ai = freshAI();
  groqFails = true;
  geminiFails = false;
  geminiText = 'also not json';
  const r = await ai.evaluateResume('jd', 'res');
  assert.strictEqual(r.score, 0);
});

groqFails = false;
geminiFails = false;