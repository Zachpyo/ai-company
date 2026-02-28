import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import OpenAI from 'openai';

const { DISCORD_TOKEN, OPENAI_API_KEY } = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment variables.');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment variables.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const CHANNELS = {
  ceo: 'ceo',
  strategy: 'strategy',
  engineering: 'engineering',
  marketing: 'marketing',
  finance: 'finance'
};

const SYSTEM_PROMPTS = {
  strategy: `You are the Head of Strategy at an AI company.
Respond with concise strategic direction, priorities, risks, and measurable milestones.
Keep it practical and action-oriented.`,

  engineering: `You are the Head of Engineering at an AI company.
Respond with implementation plans, architecture concerns, timelines, and technical risks.
Be specific and execution-focused.`,

  marketing: `You are the Head of Marketing at an AI company.
Respond with positioning, messaging, channels, campaign ideas, and KPIs.
Keep it clear and growth-oriented.`,

  finance: `You are the Head of Finance at an AI company.
Respond with budget implications, forecast assumptions, unit economics, and ROI considerations.
Be concise and numbers-minded.`
};

async function askAI(systemPrompt, userInput) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput }
    ]
  });

  return completion.choices?.[0]?.message?.content?.trim() || 'No response generated.';
}

function getTextChannelByName(guild, name) {
  return guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.name === name
  );
}

async function handleCeoInstruction(message) {
  await message.reply('CEO instruction received. Executing...');

  const departmentOrder = [
    CHANNELS.strategy,
    CHANNELS.engineering,
    CHANNELS.marketing,
    CHANNELS.finance
  ];

  for (const deptName of departmentOrder) {
    const channel = getTextChannelByName(message.guild, deptName);
    const systemPrompt = SYSTEM_PROMPTS[deptName];

    if (!channel) {
      console.warn(`Channel #${deptName} not found in guild ${message.guild.id}`);
      continue;
    }

    try {
      const response = await askAI(systemPrompt, message.content);
      await channel.send(response);
    } catch (error) {
      console.error(`Failed to process department ${deptName}:`, error);
      await channel.send('Could not generate a response right now.');
    }
  }
}

async function handleDepartmentMessage(message, departmentName) {
  try {
    const response = await askAI(SYSTEM_PROMPTS[departmentName], message.content);
    await message.reply(response);
  } catch (error) {
    console.error(`Department response failed for ${departmentName}:`, error);
    await message.reply('Could not generate a response right now.');
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const channelName = message.channel?.name;

  if (channelName === CHANNELS.ceo) {
    await handleCeoInstruction(message);
    return;
  }

  const isDepartment = [
    CHANNELS.strategy,
    CHANNELS.engineering,
    CHANNELS.marketing,
    CHANNELS.finance
  ].includes(channelName);

  if (isDepartment) {
    await handleDepartmentMessage(message, channelName);
  }
});

client.login(DISCORD_TOKEN);
