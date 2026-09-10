require('dotenv').config();
const express = require('express');
const bot = require('./bot/telegramBot');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Basic health check route
app.get('/', (req, res) => {
  res.send('HashiraMatch ATS Bot Backend is running.');
});

async function launchBotWithRetry(maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await bot.launch();
      console.log('✅ Telegram Bot is running...');
      return;
    } catch (err) {
      console.error(`❌ Bot launch attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries) {
        const wait = attempt * 2000;
        console.log(`   Retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  console.error('❌ Could not connect to Telegram after all retries. Check your network and bot token.');
  process.exit(1);
}

async function startServer() {
  try {
    // Start Express Server
    app.listen(PORT, () => {
      console.log(`✅ Express server listening on port ${PORT}`);
    });

    // Launch Telegram Bot with retry
    await launchBotWithRetry();

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
