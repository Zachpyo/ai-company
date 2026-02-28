import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import OpenAI from 'openai';

const { DISCORD_TOKEN, SILRA_API_KEY } = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment variables.');
  process.exit(1);
}

if (!SILRA_API_KEY) {
  console.error('Missing SILRA_API_KEY in environment variables.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const openai = new OpenAI({
  apiKey: process.env.SILRA_API_KEY,
  baseURL: 'https://api.silra.cn/v1'
});

const MODEL = 'gpt-4o-mini';
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

async function askAI(systemPrompt, userInput) {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput }
    ]
  });

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

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
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
