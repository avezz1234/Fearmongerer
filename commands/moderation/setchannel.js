const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadChannels() {
  ensureDataDir();
  if (!fs.existsSync(CHANNELS_FILE)) return {};

  try {
    const raw = fs.readFileSync(CHANNELS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read channels.json, starting fresh:', error);
    return {};
  }
}

function saveChannels(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write channels.json:', error);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Configure which channel is used for command logs or DM forwarding.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('kind')
        .setDescription('What this channel will be used for')
        .setRequired(true)
        .addChoices(
          { name: 'Command logs', value: 'command_logs' },
          { name: 'DM forwarding', value: 'dm_forwarding' },
        ),
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to use for this purpose')
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const kind = interaction.options.getString('kind', true);
    const channel = interaction.options.getChannel('channel', true);

    if (!channel.isTextBased()) {
      await interaction.reply({
        content: 'Please select a text-based channel.',
        ephemeral: true,
      });
      return;
    }

    const store = loadChannels();
    store[kind] = channel.id;
    saveChannels(store);

    let label = kind;
    if (kind === 'command_logs') label = 'command log';
    if (kind === 'dm_forwarding') label = 'DM forwarding';

    await interaction.reply({
      content: `✅ Set ${label} channel to ${channel}.`,
      ephemeral: true,
    });
  },
};
