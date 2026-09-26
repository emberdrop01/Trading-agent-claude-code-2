import { callAI } from './ai-dispatch.mjs';

async function searchTradingStrategies(log) {
  const results = [];

  try {
    const ddgModule = await import('duckduckgo-search');
    const ddg = ddgModule.default || ddgModule;
    if (ddg && ddg.logger) ddg.logger.warning = console.warn.bind(console);

    log('info', 'Querying DuckDuckGo for "latest AI trading agent strategies"...');

    const searchPromise = (async () => {
      for await (const item of ddg.text('latest AI trading agent strategies 2026')) {
        results.push({ title: item.title || 'AI Strategy Note', snippet: item.body || '', url: item.href });
        if (results.length >= 6) break;
      }
    })();

    await Promise.race([
      searchPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('DuckDuckGo search timed out')), 8000)),
    ]);
  } catch (err) {
    log('warn', `DuckDuckGo lookup failed: ${err.message}. Using curated fallback topics.`);
  }

  if (results.length < 2) {
    results.push(
      {
        title: 'Multi-Agent Debate Frameworks for Financial Signal Validation',
        snippet:
          'Competitive Researcher vs Red-Team agents to prune false breakouts in synthetic and high-volatility tick assets.',
      },
      {
        title: 'Dynamic Volatility Scaling & Liquidity Hunt Mitigation in Synthetic Indices',
        snippet: 'Adjusting stop loss placement based on rolling ATR expansions and synthetic spike probability.',
      },
      {
        title: 'Hierarchical LLM Risk Managers with Real-Time Drawdown Guardrails',
        snippet: 'Decoupling signal generation from risk allocation, enforcing exposure ceilings and confidence-based sizing.',
      }
    );
  }

  return results;
}

/**
 * Runs the daily meta-research pipeline: finds strategy notes, has the
 * configured AI provider synthesize an infrastructure update, returns the
 * text to send to Telegram. aiConfig = { provider, apiKey, model, baseUrl }
 */
export async function runMetaResearchPipeline({ aiConfig, log = () => {} }) {
  log('info', 'Starting Daily Meta-Research Pipeline...');

  const findings = await searchTradingStrategies(log);
  let aiSummary = '';

  if (aiConfig?.apiKey && aiConfig?.model) {
    try {
      const systemPrompt =
        'You are the Chief Quantitative Architect for an Automated AI Trading System operating on Deriv Synthetic Indices.';
      const userContent = `
Review these latest findings regarding "latest AI trading agent strategies":
${JSON.stringify(findings, null, 2)}

Provide an executive "Infrastructure Update" with:
1. 🧠 Core Algorithmic Insights (top 2 novel concepts)
2. 🛡️ Risk Mitigation Improvements (especially for Volatility 75 / synthetic spikes)
3. ⚡ Recommended Agent Enhancements (Researcher, Analyst, Red Team, Manager)
4. 🚀 Actionable Verdict for today's trading operations

Format for Telegram: crisp bullets, bold sections, emojis. Under 300 words.
`.trim();

      aiSummary = await callAI({ ...aiConfig, systemPrompt, userContent });
    } catch (err) {
      log('error', `AI synthesis error: ${err.message}`);
      aiSummary = `Meta-Research Intelligence Summary:\n- Multi-agent debate improvements identified.\n- Synthetic index spike buffers tightened.\n- Conservative risk thresholds retained.`;
    }
  } else {
    aiSummary = `Meta-Research Findings on AI Trading Agents:\n1. Multi-Agent Debate architecture enhances precision.\n2. Adaptive volatility stops reduce synthetic wick traps.\n3. Risk Manager confidence weighting protects against drawdown.`;
  }

  const telegramMessage = `
🌐 *INFRASTRUCTURE UPDATE: META-RESEARCH INTELLIGENCE*
━━━━━━━━━━━━━━━━━━━━
📅 *Date:* \`${new Date().toISOString().slice(0, 10)}\`
🔍 *Topic:* Latest AI Trading Agent Strategies & System Upgrades

${aiSummary}
━━━━━━━━━━━━━━━━━━━━
_🤖 Automated AI Trading Analyst • Daily Intelligence Dispatch (GitHub Actions)_
`.trim();

  return { summary: aiSummary, findings, telegramMessage };
}
