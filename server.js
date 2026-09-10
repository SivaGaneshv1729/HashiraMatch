require('dotenv').config();
const express = require('express');
const bot = require('./bot/telegramBot');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Basic health check route
app.get('/', (req, res) => {
  res.send('ATS Bot Backend is running.');
});

async function startServer() {
  try {
    // Start Express Server
    app.listen(PORT, () => {
      console.log(`✅ Express server listening on port ${PORT}`);
    });

    // Launch Telegram Bot
    bot.launch();
    console.log('✅ Telegram Bot is running...');

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
