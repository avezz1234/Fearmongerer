const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const POLLS_FILE = path.join(DATA_DIR, 'polls.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadPolls() {
  ensureDataDir();
  if (!fs.existsSync(POLLS_FILE)) return {};

  try {
    const raw = fs.readFileSync(POLLS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read polls.json, starting fresh:', error);
    return {};
  }
}

function savePolls(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(POLLS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write polls.json:', error);
  }
}

const NUMBER_EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

const data = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Create a reaction-based poll.')
  .addStringOption(option =>
    option
      .setName('question')
      .setDescription('Question to ask')
      .setRequired(true),
  );

for (let i = 1; i <= 10; i += 1) {
  data.addStringOption(option =>
    option
      .setName(`option${i}`)
      .setDescription(`Option ${i}`)
      .setRequired(i === 1),
  );
}

module.exports = {
  data,
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const questionRaw = interaction.options.getString('question', true);
    const question = questionRaw.trim();

    const options = [];
    for (let i = 1; i <= 10; i += 1) {
      const value = interaction.options.getString(`option${i}`);
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          options.push(trimmed);
        }
      }
    }

    if (options.length === 0) {
      await interaction.reply({
        content: 'You must provide at least one non-empty option.',
        ephemeral: true,
      });
      return;
    }

    if (options.length > NUMBER_EMOJIS.length) {
      options.length = NUMBER_EMOJIS.length;
    }

    const emojis = NUMBER_EMOJIS.slice(0, options.length);

    const optionLines = options.map((opt, index) => `${index + 1}. ${opt}`);
    const descriptionLines = [
      `**${question}**`,
      '',
      ...optionLines,
    ];
    const description = descriptionLines.join('\n');

    const embed = new EmbedBuilder()
      .setTitle('Poll')
      .setDescription(description)
      .setColor(0x5865f2)
      .setFooter({ text: `Poll created by ${interaction.user.tag}` })
      .setTimestamp();

    const message = await interaction.reply({ embeds: [embed], fetchReply: true });

    for (const emoji of emojis) {
      try {
        await message.react(emoji);
      } catch (error) {
        console.error('[poll] Failed to add reaction', emoji, error);
      }
    }

    const store = loadPolls();
    const guildId = interaction.guild.id;
    const ownerId = interaction.user.id;

    if (!store[guildId]) {
      store[guildId] = { pollsByMessageId: {} };
    } else if (!store[guildId].pollsByMessageId) {
      store[guildId].pollsByMessageId = {};
    }

    store[guildId].pollsByMessageId[message.id] = {
      messageId: message.id,
      channelId: message.channel.id,
      guildId,
      ownerId,
      question,
      options,
      emojis,
      createdAt: new Date().toISOString(),
      closed: false,
    };

    savePolls(store);
  },
};
