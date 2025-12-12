const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadServersSafe() {
  ensureDataDir();
  if (!fs.existsSync(SERVERS_FILE)) return {};

  try {
    const raw = fs.readFileSync(SERVERS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[servers] Failed to read servers.json in forum_vote_toggles:', error);
    return {};
  }
}

function saveServersSafe(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[servers] Failed to write servers.json in forum_vote_toggles:', error);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forum_vote_toggles')
    .setDescription('Enable or disable forum auto-votes and backfill for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addBooleanOption(option =>
      option
        .setName('autovotes')
        .setDescription('Enable or disable auto up/down-vote reactions on new forum posts')
        .setRequired(false),
    )
    .addBooleanOption(option =>
      option
        .setName('backfill')
        .setDescription('Enable or disable the /forum_backfill_votes command')
        .setRequired(false),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const autoOpt = interaction.options.getBoolean('autovotes');
    const backfillOpt = interaction.options.getBoolean('backfill');

    const servers = loadServersSafe();
    if (!servers[guildId]) {
      servers[guildId] = {};
    }

    const cfg = servers[guildId];

    if (autoOpt !== null) {
      cfg.forumAutoVotesEnabled = autoOpt;
    }

    if (backfillOpt !== null) {
      cfg.forumBackfillEnabled = backfillOpt;
    }

    saveServersSafe(servers);

    const autoState =
      cfg.forumAutoVotesEnabled === false ? 'disabled' : 'enabled';
    const backfillState =
      cfg.forumBackfillEnabled === true ? 'enabled' : 'disabled';

    await interaction.reply({
      content: `Forum auto-votes are **${autoState}**; forum backfill votes are **${backfillState}**.`,
      ephemeral: true,
    });
  },
};
