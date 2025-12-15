const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');

const MAX_FETCH_MESSAGES = 500;
const MAX_EMBEDS = 10;
const MAX_LINE_CHARS = 220;

function clip(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function formatOneLine(msg) {
  const authorLabel = msg.author?.bot ? 'Bot' : 'User';
  const unix = Math.floor((msg.createdTimestamp || Date.now()) / 1000);

  let body = (msg.content || '').replace(/\s+/g, ' ').trim();

  const attachmentCount = msg.attachments ? msg.attachments.size : 0;
  const embedCount = Array.isArray(msg.embeds) ? msg.embeds.length : 0;

  if (!body && (attachmentCount > 0 || embedCount > 0)) {
    const parts = [];
    if (attachmentCount > 0) parts.push(`attachment x${attachmentCount}`);
    if (embedCount > 0) parts.push(`embed x${embedCount}`);
    body = `[${parts.join(', ')}]`;
  }

  if (!body) {
    body = '(no text)';
  }

  body = clip(body, MAX_LINE_CHARS);
  return `• <t:${unix}:g> **${authorLabel}**: ${body}`;
}

function chunkLinesIntoEmbeds(lines, { title, color }) {
  const embeds = [];
  let chunk = [];
  let chunkLen = 0;

  const flush = () => {
    if (!chunk.length) return;
    embeds.push(
      new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(chunk.join('\n')),
    );
    chunk = [];
    chunkLen = 0;
  };

  for (const line of lines) {
    const nextLen = chunkLen + line.length + (chunk.length ? 1 : 0);
    if (nextLen > 3800) {
      flush();
    }
    chunk.push(line);
    chunkLen += line.length + (chunk.length ? 1 : 0);

    if (embeds.length >= MAX_EMBEDS - 1) {
      break;
    }
  }

  flush();
  return embeds;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm_history')
    .setDescription('Show a user\'s DM history with the bot (ephemeral).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to show DM history for')
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({ content: 'No permission.', ephemeral: true });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);

    await interaction.deferReply({ ephemeral: true });

    const dmChannel = await targetUser.createDM().catch(() => null);
    if (!dmChannel) {
      await interaction.editReply("Can't open DM with that user.");
      return;
    }

    const all = [];
    let beforeId = null;

    while (all.length < MAX_FETCH_MESSAGES) {
      const opts = { limit: 100 };
      if (beforeId) opts.before = beforeId;

      const batch = await dmChannel.messages.fetch(opts).catch(() => null);
      if (!batch || batch.size === 0) break;

      for (const msg of batch.values()) {
        all.push(msg);
      }

      beforeId = batch.last().id;
      if (batch.size < 100) break;
    }

    if (all.length === 0) {
      await interaction.editReply('No DM history found.');
      return;
    }

    // Oldest -> newest
    all.sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));

    const lines = all.map(formatOneLine);

    const summary = new EmbedBuilder()
      .setTitle(`DM History: ${targetUser.tag}`)
      .setColor(0x005865f2)
      .addFields(
        { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
        { name: 'Messages fetched', value: String(all.length), inline: true },
        { name: 'Note', value: `Showing up to ${MAX_FETCH_MESSAGES} most recent DMs. Long lines are clipped.`, inline: false },
      )
      .setTimestamp(new Date());

    const detailEmbeds = chunkLinesIntoEmbeds(lines, {
      title: 'DM Messages',
      color: 0x002b2d31,
    });

    const embeds = [summary, ...detailEmbeds].slice(0, MAX_EMBEDS);
    await interaction.editReply({ embeds });
  },
};
