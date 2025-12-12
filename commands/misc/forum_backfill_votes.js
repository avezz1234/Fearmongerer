const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');

const AUTO_VOTE_FORUM_CHANNEL_IDS = [
  '1435578911605002276',
  '1435579756601933878',
  '1435580083829080154',
];

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
    console.error('[servers] Failed to read servers.json in forum_backfill_votes:', error);
    return {};
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forum_backfill_votes')
    .setDescription('Backfill upvote/downvote reactions on existing forum posts.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    const guildId = guild.id;

    await interaction.deferReply({ ephemeral: true });

    const servers = loadServersSafe();
    const guildConfig = servers[guildId] || {};
    const backfillEnabled = guildConfig.forumBackfillEnabled ?? false;

    if (!backfillEnabled) {
      await interaction.editReply({
        content:
          'Forum backfill votes are currently disabled for this server. Use /forum_vote_toggles to enable them.',
        ephemeral: true,
      });
      return;
    }

    let threadsScanned = 0;
    let messagesReacted = 0;

    for (const forumId of AUTO_VOTE_FORUM_CHANNEL_IDS) {
      let forum;
      try {
        forum = await guild.channels.fetch(forumId);
      } catch {
        continue;
      }

      if (!forum || forum.type !== ChannelType.GuildForum) {
        continue;
      }

      try {
        const active = await forum.threads.fetchActive().catch(() => null);
        const archived = await forum.threads
          .fetchArchived({ limit: 100 })
          .catch(() => null);

        const allThreads = [
          ...(active?.threads?.values() ?? []),
          ...(archived?.threads?.values() ?? []),
        ];

        for (const thread of allThreads) {
          threadsScanned += 1;

          try {
            const starter = await thread.fetchStarterMessage().catch(() => null);
            if (!starter || starter.author?.bot) {
              continue;
            }

            try {
              await starter.react('⬆️');
            } catch {
              // ignore per-message upvote failures
            }

            try {
              await starter.react('⬇️');
            } catch {
              // ignore per-message downvote failures
            }

            messagesReacted += 1;
          } catch {
            // ignore per-thread failures
          }
        }
      } catch {
        // ignore per-forum failures
      }
    }

    await interaction.editReply({
      content: `Backfill complete. Scanned ${threadsScanned} threads and attempted to add reactions to ${messagesReacted} starter messages.`,
      ephemeral: true,
    });
  },
};
