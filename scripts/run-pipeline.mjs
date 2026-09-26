import fs from 'fs';
import path from 'path';
import { fetchDerivOHLCV, validateSymbols, KNOWN_GRANULARITIES_SECONDS } from './lib/deriv.mjs';
import { runMultiAgentAnalysis } from './lib/ai.mjs';
import { formatTelegramTradeAlert, sendTelegramMessage } from './lib/telegram.mjs';

function log(category, level, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${category}] ${message}`);
}

function readEnvList(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const derivToken = process.env.DERIV_TOKEN || '';
  const tgBotToken = process.env.TG_BOT_TOKEN || '';
  const tgChatId = process.env.TG_CHAT_ID || '';
  const symbols = readEnvList('SYMBOLS', ['R_75', 'R_100']);
  const candleCount = Number(process.env.CANDLE_COUNT) || 50;
  const triggerSource = process.env.TRIGGER_SOURCE || 'GITHUB_ACTIONS_CRON';

  // Granularity in seconds - THIS MUST MATCH the timeframe you compare
  // against on MT5. Default 1800s = M30, matching the pipeline's own "30m" label.
  const granularity = Number(process.env.CANDLE_GRANULARITY_SECONDS) || 1800;

  // Provider-agnostic AI config. AI_API_KEY/AI_MODEL/AI_PROVIDER are the
  // primary names; GEMINI_API_KEY is read as a fallback so existing secrets
  // named that way keep working without re-adding anything.
  const aiConfig = {
    provider: process.env.AI_PROVIDER || 'gemini',
    apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
    model: process.env.AI_MODEL || (
      (process.env.AI_PROVIDER || 'gemini') === 'gemini' ? 'gemini-3.5-flash' : ''
    ),
    baseUrl: process.env.AI_BASE_URL || '',
  };

  log('SYSTEM', 'info', `Pipeline start. Trigger=${triggerSource} Symbols=[${symbols.join(', ')}] Granularity=${granularity}s${KNOWN_GRANULARITIES_SECONDS[granularity] ? ` (${KNOWN_GRANULARITIES_SECONDS[granularity]})` : ' (non-standard - verify Deriv accepts this value)'}`);

  if (!tgBotToken || !tgChatId) {
    log('SYSTEM', 'warn', 'TG_BOT_TOKEN / TG_CHAT_ID not set - alerts will be computed but NOT delivered.');
  }
  if (!aiConfig.apiKey || !aiConfig.model) {
    log('SYSTEM', 'warn', `AI not fully configured (provider=${aiConfig.provider}) - using deterministic quantitative model for all symbols.`);
  }

  // Validate symbols against Deriv's own live list before burning a run on
  // a typo'd or renamed symbol that would otherwise silently fall back to fake data.
  const symbolCheck = await validateSymbols(symbols, (level, msg) => log('SYMBOL_CHECK', level, msg));
  if (symbolCheck.invalid.length > 0) {
    for (const bad of symbolCheck.invalid) {
      const suggestion = symbolCheck.suggestions[bad];
      log('SYMBOL_CHECK', 'error', `"${bad}" is not a currently active Deriv symbol.` + (suggestion ? ` Possible matches: ${suggestion.join(' | ')}` : ' No close match found - check https://api.deriv.com for the current symbol list.'));
    }
  }

  const results = [];
  let anySuccess = false;

  for (const symbol of symbols) {
    const symLog = (level, message) => log(symbol, level, message);
    try {
      symLog('info', `Processing ${symbol} (${results.length + 1}/${symbols.length})...`);

      const derivResult = await fetchDerivOHLCV(derivToken, symbol, candleCount, granularity, symLog);
      const analysis = await runMultiAgentAnalysis(derivResult.candles, derivResult.indicators, symbol, aiConfig, symLog);

      const alertText = formatTelegramTradeAlert(analysis, derivResult.source);
      const telegramResult = await sendTelegramMessage(alertText, tgBotToken, tgChatId, symLog);

      anySuccess = true;
      results.push({
        symbol,
        success: true,
        verdict: analysis.manager.verdict,
        confidence: analysis.manager.confidenceScore,
        engine: analysis.engine,
        dataSource: derivResult.source,
        granularitySeconds: granularity,
        telegramSent: telegramResult.success,
      });

      symLog(
        'success',
        `Done: ${analysis.manager.verdict} (${analysis.manager.confidenceScore}%) via ${analysis.engine}, data=${derivResult.source}. Telegram: ${
          telegramResult.success ? 'sent' : 'not sent'
        }`
      );
    } catch (err) {
      symLog('error', `Failed: ${err.message}`);
      results.push({ symbol, success: false, error: err.message });
    }
  }

  const statusPath = path.resolve(process.cwd(), 'status.json');
  const status = {
    lastRunAt: new Date().toISOString(),
    triggerSource,
    granularitySeconds: granularity,
    aiProvider: aiConfig.provider,
    aiModel: aiConfig.model || null,
    invalidSymbols: symbolCheck.invalid,
    results,
  };
  try {
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n', 'utf-8');
    log('SYSTEM', 'info', `Wrote ${statusPath}`);
  } catch (err) {
    log('SYSTEM', 'warn', `Could not write status.json: ${err.message}`);
  }

  if (!anySuccess) {
    log('SYSTEM', 'error', 'All symbols failed this run.');
    process.exitCode = 1;
  } else {
    log('SYSTEM', 'success', `Pipeline finished. ${results.filter((r) => r.success).length}/${symbols.length} succeeded.`);
  }
}

main().catch((err) => {
  log('SYSTEM', 'error', `Fatal error: ${err.stack || err.message}`);
  process.exitCode = 1;
});
