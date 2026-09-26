import fs from 'fs';
import path from 'path';
import { setRepoSecret, setRepoVariable } from './lib/github-secrets.mjs';
import { KNOWN_PROVIDERS } from './lib/ai-dispatch.mjs';

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

const OFFSET_FILE = path.resolve(process.cwd(), 'telegram-offset.json');

function loadOffset() {
  try {
    return JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf-8')).offset || 0;
  } catch {
    return 0;
  }
}
function saveOffset(offset) {
  fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset }, null, 2) + '\n', 'utf-8');
}

async function sendReply(botToken, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
    });
  } catch (err) {
    log('warn', `Failed to send Telegram reply: ${err.message}`);
  }
}

const HELP_TEXT = `
*Remote config commands* (all except /help require your passphrase as the 2nd word):
/setaiprovider <passphrase> <provider>  — ${Object.keys(KNOWN_PROVIDERS).join(', ')}, anthropic, custom
/setaikey <passphrase> <apiKey>
/setaimodel <passphrase> <model>
/setaibaseurl <passphrase> <url>  — only needed when provider = custom
/setderivtoken <passphrase> <token>
/setsymbols <passphrase> <R_75,R_100>
/setgranularity <passphrase> <seconds>  — must match your MT5 comparison timeframe (1800=M30, 900=M15, 60=M1)
/help

Changes apply on the NEXT scheduled pipeline run, not instantly.
`.trim();

async function main() {
  const botToken = process.env.TG_BOT_TOKEN || '';
  const ownerChatId = process.env.TG_CHAT_ID || '';
  const passphrase = process.env.CONTROL_PASSPHRASE || '';
  const ghToken = process.env.GH_PAT || '';
  const repoFull = process.env.GITHUB_REPOSITORY || ''; // auto-provided by Actions: "owner/repo"
  const [owner, repo] = repoFull.split('/');

  if (!botToken || !ownerChatId) {
    log('SYSTEM', 'TG_BOT_TOKEN / TG_CHAT_ID not set - nothing to listen for. Exiting.');
    return;
  }

  const offset = loadOffset();
  const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset + 1}&timeout=0`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.ok) {
    log('ERROR', `Telegram getUpdates failed: ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }

  let maxUpdateId = offset;

  for (const update of data.result || []) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id);
    const msg = update.message;
    if (!msg || !msg.text) continue;

    const fromChatId = String(msg.chat?.id ?? '');
    if (fromChatId !== String(ownerChatId)) {
      log('SECURITY', `Ignoring message from unauthorized chat ${fromChatId}`);
      continue;
    }

    const parts = msg.text.trim().split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();

    if (cmd === '/help') {
      await sendReply(botToken, ownerChatId, HELP_TEXT);
      continue;
    }

    // Every other command is privileged.
    if (!ghToken || !owner || !repo) {
      log('SECURITY', 'GH_PAT / GITHUB_REPOSITORY not available - cannot execute privileged commands.');
      continue;
    }
    if (!passphrase) {
      log('SECURITY', 'CONTROL_PASSPHRASE not configured on this repo - ignoring all privileged commands.');
      continue;
    }

    const suppliedPass = parts[1];
    if (suppliedPass !== passphrase) {
      // Deliberately silent on mismatch - do not confirm the command exists
      // or that the passphrase was wrong, to a party who isn't you.
      log('SECURITY', `Rejected command ${cmd}: bad or missing passphrase.`);
      continue;
    }

    try {
      if (cmd === '/setaiprovider') {
        const provider = (parts[2] || '').toLowerCase();
        const known = [...Object.keys(KNOWN_PROVIDERS), 'anthropic', 'custom'];
        if (!known.includes(provider)) {
          await sendReply(botToken, ownerChatId, `Unknown provider "${provider}". Known: ${known.join(', ')}`);
          continue;
        }
        await setRepoSecret({ owner, repo, token: ghToken, name: 'AI_PROVIDER', value: provider });
        await sendReply(botToken, ownerChatId, `✅ AI_PROVIDER set to \`${provider}\`. Applies next scheduled run.`);
      } else if (cmd === '/setaikey') {
        const key = parts.slice(2).join(' ').trim();
        if (!key) {
          await sendReply(botToken, ownerChatId, 'Usage: /setaikey <passphrase> <apiKey>');
          continue;
        }
        await setRepoSecret({ owner, repo, token: ghToken, name: 'AI_API_KEY', value: key });
        await sendReply(botToken, ownerChatId, `✅ AI_API_KEY updated (${key.length} chars received). Applies next scheduled run.`);
      } else if (cmd === '/setaimodel') {
        const model = parts.slice(2).join(' ').trim();
        if (!model) {
          await sendReply(botToken, ownerChatId, 'Usage: /setaimodel <passphrase> <model>');
          continue;
        }
        await setRepoSecret({ owner, repo, token: ghToken, name: 'AI_MODEL', value: model });
        await sendReply(botToken, ownerChatId, `✅ AI_MODEL set to \`${model}\`.`);
      } else if (cmd === '/setaibaseurl') {
        const baseUrl = parts[2];
        if (!baseUrl) {
          await sendReply(botToken, ownerChatId, 'Usage: /setaibaseurl <passphrase> <url>');
          continue;
        }
        await setRepoSecret({ owner, repo, token: ghToken, name: 'AI_BASE_URL', value: baseUrl });
        await sendReply(botToken, ownerChatId, `✅ AI_BASE_URL updated.`);
      } else if (cmd === '/setderivtoken') {
        const token = parts[2] || '';
        await setRepoSecret({ owner, repo, token: ghToken, name: 'DERIV_TOKEN', value: token });
        await sendReply(botToken, ownerChatId, `✅ DERIV_TOKEN updated (${token.length} chars received).`);
      } else if (cmd === '/setsymbols') {
        const symbols = parts.slice(2).join(' ').replace(/\s+/g, '').toUpperCase();
        if (!symbols) {
          await sendReply(botToken, ownerChatId, 'Usage: /setsymbols <passphrase> <R_75,R_100>');
          continue;
        }
        await setRepoVariable({ owner, repo, token: ghToken, name: 'SYMBOLS', value: symbols });
        await sendReply(botToken, ownerChatId, `✅ SYMBOLS set to \`${symbols}\`.`);
      } else if (cmd === '/setgranularity') {
        const seconds = parts[2];
        if (!/^\d+$/.test(seconds || '')) {
          await sendReply(botToken, ownerChatId, 'Usage: /setgranularity <passphrase> <seconds>, e.g. 1800 for M30');
          continue;
        }
        await setRepoVariable({ owner, repo, token: ghToken, name: 'CANDLE_GRANULARITY_SECONDS', value: seconds });
        await sendReply(botToken, ownerChatId, `✅ CANDLE_GRANULARITY_SECONDS set to ${seconds}s.`);
      } else {
        // Unrecognized command - ignore silently, don't help an attacker enumerate commands.
      }
    } catch (err) {
      log('ERROR', `Command ${cmd} failed: ${err.message}`);
      await sendReply(botToken, ownerChatId, `❌ Command failed: ${err.message.slice(0, 200)}`);
    }
  }

  if (maxUpdateId > offset) {
    saveOffset(maxUpdateId);
    log('SYSTEM', `Processed Telegram updates up to ${maxUpdateId}`);
  } else {
    log('SYSTEM', 'No new Telegram messages.');
  }
}

main().catch((err) => {
  log('FATAL', err.stack || err.message);
  process.exitCode = 1;
});
