import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import OpenAI from 'openai';

const { DISCORD_TOKEN, SILRA_API_KEY } = process.env;
const SILRA_BASE_URL = process.env.SILRA_BASE_URL || 'https://api.silra.cn/v1';
const MODEL = process.env.SILRA_MODEL?.trim();
const REQUEST_TIMEOUT_MS = Number(process.env.SILRA_TIMEOUT_MS || 90000);
const MAX_RETRIES = Number(process.env.SILRA_MAX_RETRIES || 2);

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment variables.');
  process.exit(1);
}

if (!SILRA_API_KEY) {
  console.error('Missing SILRA_API_KEY in environment variables.');
  process.exit(1);
}

if (!MODEL) {
  console.error('Missing SILRA_MODEL in environment variables.');
  console.error('Your provider requires an explicit model name (for example: gpt-4o-mini).');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function normalizeSilraBaseURL(url) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://api.silra.cn/v1';
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

const normalizedSilraBaseURL = normalizeSilraBaseURL(SILRA_BASE_URL);

const openai = new OpenAI({
  apiKey: SILRA_API_KEY,
  baseURL: normalizedSilraBaseURL
});

const MAX_MESSAGE_LENGTH = 2000;

const CHANNELS = {
  ceo: 'ceo',
  strategy: 'strategy',
  engineering: 'engineering',
  marketing: 'marketing',
  finance: 'finance'
};

const SYSTEM_PROMPTS = {
  strategy: `You are the Head of Strategy at an AI company.
Give concise strategic recommendations with priorities, risks, and measurable milestones.`,
  engineering: `You are the Head of Engineering at an AI company.
Give practical implementation guidance, architecture tradeoffs, and delivery risks.`,
  marketing: `You are the Head of Marketing at an AI company.
Give clear positioning, campaign ideas, channels, and KPIs for growth.`,
  finance: `You are the Head of Finance at an AI company.
Give budget implications, forecast assumptions, unit economics, and ROI-focused advice.`
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    error?.status === 408 ||
    error?.status === 429 ||
    (typeof error?.status === 'number' && error.status >= 500)
  );
}

async function askAI(systemPrompt, userInput) {
  const payload = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput }
    ]
  };

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const completion = await openai.chat.completions.create(
        payload,
        {
          timeout: REQUEST_TIMEOUT_MS
        }
      );

      const content = completion.choices?.[0]?.message?.content;

      if (typeof content === 'string') {
        return content.trim() || 'No response generated.';
      }

      if (Array.isArray(content)) {
        const text = content
          .map((part) => (typeof part?.text === 'string' ? part.text : ''))
          .join('\n')
          .trim();

        return text || 'No response generated.';
      }

      return 'No response generated.';
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES || !isRetryableError(error)) {
        throw error;
      }

      const delay = 1000 * (attempt + 1);
      console.warn(
        `AI request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms: ${error.message}`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

function splitMessage(text, maxLength = MAX_MESSAGE_LENGTH) {
  const source = String(text ?? '');
  if (!source) return ['No response generated.'];
  if (source.length <= maxLength) return [source];

  const chunks = [];
  let remaining = source;

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf('\n', maxLength);
    if (cut <= 0) cut = remaining.lastIndexOf(' ', maxLength);
    if (cut <= 0) cut = maxLength;

    const chunk = remaining.slice(0, cut).trim();
    chunks.push(chunk || remaining.slice(0, maxLength));
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
}

async function sendLongMessage(channel, text) {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

async function replyLongMessage(message, text) {
  const chunks = splitMessage(text);
  await message.reply(chunks[0]);

  for (const chunk of chunks.slice(1)) {
    await message.channel.send(chunk);
  }
}

async function getTextChannelByName(guild, name) {
  try {
    await guild.channels.fetch();
  } catch (error) {
    console.error(`Failed to fetch channels for guild ${guild.id}:`, error);
  }

  return (
    guild.channels.cache.find(
      (ch) => ch.isTextBased() && typeof ch.send === 'function' && ch.name === name
    ) || null
  );
}

async function handleCeoMessage(message) {
  const instruction = message.content?.trim();
  if (!instruction) {
    await replyLongMessage(message, 'Please send a text instruction for the CEO.');
    return;
  }

  await replyLongMessage(message, 'CEO instruction received. Executing...');

  const departments = [
    CHANNELS.strategy,
    CHANNELS.engineering,
    CHANNELS.marketing,
    CHANNELS.finance
  ];

  for (const department of departments) {
    const channel = await getTextChannelByName(message.guild, department);
    const systemPrompt = SYSTEM_PROMPTS[department];

    if (!channel) {
      console.warn(`Channel #${department} not found in guild ${message.guild.id}`);
      continue;
    }

    try {
      const response = await askAI(systemPrompt, instruction);
      await sendLongMessage(channel, response);
    } catch (error) {
      console.error(`Department generation failed for ${department}:`, error);
      await sendLongMessage(channel, 'Could not generate a response right now.');
    }
  }
}

async function handleDepartmentMessage(message, department) {
  const userInput = message.content?.trim();
  if (!userInput) {
    await replyLongMessage(message, 'Please send a text message for this department.');
    return;
  }

  try {
    const response = await askAI(SYSTEM_PROMPTS[department], userInput);
    await replyLongMessage(message, response);
  } catch (error) {
    console.error(`Department reply failed for ${department}:`, error);
    await replyLongMessage(message, 'Could not generate a response right now.');
  }
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Using Silra API baseURL: ${normalizedSilraBaseURL}`);
  console.log(`Using model: ${MODEL || '(provider default)'}`);
  console.log(`AI timeout: ${REQUEST_TIMEOUT_MS}ms, retries: ${MAX_RETRIES}`);
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const channelName = message.channel?.name;

    if (channelName === CHANNELS.ceo) {
      await handleCeoMessage(message);
      return;
    }

    const departmentChannels = [
      CHANNELS.strategy,
      CHANNELS.engineering,
      CHANNELS.marketing,
      CHANNELS.finance
    ];

    if (departmentChannels.includes(channelName)) {
      await handleDepartmentMessage(message, channelName);
    }
  } catch (error) {
    console.error('Unhandled messageCreate error:', error);
  }
});

client.login(DISCORD_TOKEN).catch((error) => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
