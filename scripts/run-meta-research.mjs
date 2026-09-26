import { runMetaResearchPipeline } from './lib/research.mjs';
import { sendTelegramMessage } from './lib/telegram.mjs';

function log(category, level, message) {
  console.log(`[${new Date().toISOString()}] [${category}] ${message}`);
}

async function main() {
  const tgBotToken = process.env.TG_BOT_TOKEN || '';
  const tgChatId = process.env.TG_CHAT_ID || '';

  const aiConfig = {
    provider: process.env.AI_PROVIDER || 'gemini',
    apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
    model: process.env.AI_MODEL || (
      (process.env.AI_PROVIDER || 'gemini') === 'gemini' ? 'gemini-3.5-flash' : ''
    ),
    baseUrl: process.env.AI_BASE_URL || '',
  };

  const researchLog = (level, message) => log('RESEARCH', level, message);

  const { telegramMessage } = await runMetaResearchPipeline({ aiConfig, log: researchLog });
  const tgResult = await sendTelegramMessage(telegramMessage, tgBotToken, tgChatId, researchLog);

  log('SYSTEM', tgResult.success ? 'success' : 'warn', `Meta-research finished. Telegram: ${tgResult.success ? 'sent' : 'not sent'}`);
}

main().catch((err) => {
  log('SYSTEM', 'error', `Fatal error: ${err.stack || err.message}`);
  process.exitCode = 1;
});
