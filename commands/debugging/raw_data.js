const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function safeReadJson(filename) {
  try {
    const fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const raw = fs.readFileSync(fullPath, 'utf8');
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error(`[raw-data] Failed to read ${filename}:`, error);
    return null;
  }
}

function filterByUserId(value, userId) {
  if (typeof value === 'string') {
    return value === userId ? value : undefined;
  }

  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  if (Array.isArray(value)) {
    const filteredItems = value
      .map(item => filterByUserId(item, userId))
      .filter(item => item !== undefined);

    return filteredItems.length > 0 ? filteredItems : undefined;
  }

  const result = {};

  for (const [key, child] of Object.entries(value)) {
    let childResult = filterByUserId(child, userId);

    if (childResult === undefined && key === userId) {
      childResult = child;
    }

    if (childResult !== undefined) {
      result[key] = childResult;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raw_data')
    .setDescription('Dump all stored raw data associated with you.'),

  async execute(interaction) {
    const user = interaction.user ?? interaction.member?.user ?? null;
    const userId = user ? user.id : null;

    if (!userId) {
      await interaction.reply({
        content: 'Could not determine your user ID to look up data.',
        ephemeral: true,
      });
      return;
    }

    const files = [
      'afk.json',
      'noping.json',
      'notes.json',
      'warnings.json',
      'moderations.json',
      'polls.json',
      'automod.json',
      'user_data.json',
      'servers.json',
      'channels.json',
    ];

    const payload = {};

    for (const filename of files) {
      const store = safeReadJson(filename);
      if (!store) {
        continue;
      }

      const filtered = filterByUserId(store, userId);
      if (filtered !== undefined) {
        payload[filename] = filtered;
      }
    }

    let raw;
    try {
      raw = JSON.stringify(payload);
    } catch (error) {
      console.error('[raw-data] Failed to stringify payload:', error);
      await interaction.reply({
        content: 'There was an error while preparing your raw data dump.',
        ephemeral: true,
      });
      return;
    }

    if (!raw || raw === '{}' || raw === 'null') {
      await interaction.reply({
        content: 'No stored data was found that references your user ID.',
        ephemeral: true,
      });
      return;
    }

    // Prefer spitting the data directly in an embed unless it would blow past size limits.
    const directLimit = 4000;

    if (raw.length <= directLimit) {
      const embed = new EmbedBuilder()
        .setTitle('Raw Data')
        .setColor(0x002b2d31)
        .setDescription(raw);

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    try {
      const buffer = Buffer.from(raw, 'utf8');
      const attachment = new AttachmentBuilder(buffer, {
        name: `raw-data-${userId}.json`,
      });

      const embed = new EmbedBuilder()
        .setTitle('Raw Data')
        .setColor(0x002b2d31)
        .setDescription('Raw data dump attached as JSON file (full, unindented content).');

      await interaction.reply({
        embeds: [embed],
        files: [attachment],
        ephemeral: true,
      });
    } catch (error) {
      console.error('[raw-data] Failed to send attachment:', error);
      await interaction.reply({
        content:
          'There was an error sending the raw data dump attachment. Try again later.',
        ephemeral: true,
      });
    }
  },
};
