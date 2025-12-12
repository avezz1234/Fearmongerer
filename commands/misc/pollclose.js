const { SlashCommandBuilder } = require('discord.js');
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
    console.error('Failed to read polls.json for /pollclose:', error);
    return {};
  }
}

function savePolls(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(POLLS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write polls.json from /pollclose:', error);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pollclose')
    .setDescription('Close your most recent poll and show the top-voted answer.'),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    const store = loadPolls();
    const guildStore = store[guildId];

    if (!guildStore || !guildStore.pollsByMessageId) {
      await interaction.editReply('You have no recorded polls in this server.');
      return;
    }

    const allPolls = Object.values(guildStore.pollsByMessageId);
    const openPolls = allPolls.filter(poll => poll && poll.ownerId === userId && !poll.closed);

    if (openPolls.length === 0) {
      await interaction.editReply('You have no open polls in this server.');
      return;
    }

    let target = openPolls[0];
    let targetTs = target.createdAt ? Date.parse(target.createdAt) : -Infinity;

    for (const poll of openPolls) {
      const ts = poll.createdAt ? Date.parse(poll.createdAt) : -Infinity;
      if (!Number.isFinite(ts)) continue;
      if (ts > targetTs) {
        target = poll;
        targetTs = ts;
      }
    }

    const channel = await interaction.guild.channels.fetch(target.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      target.closed = true;
      target.closedAt = new Date().toISOString();
      target.closedBy = userId;
      guildStore.pollsByMessageId[target.messageId] = target;
      savePolls(store);

      await interaction.editReply('I could not find the original poll message. The poll has been marked as closed.');
      return;
    }

    const message = await channel.messages.fetch(target.messageId).catch(() => null);
    if (!message) {
      target.closed = true;
      target.closedAt = new Date().toISOString();
      target.closedBy = userId;
      guildStore.pollsByMessageId[target.messageId] = target;
      savePolls(store);

      await interaction.editReply('I could not fetch the original poll message. The poll has been marked as closed.');
      return;
    }

    const results = [];
    for (let i = 0; i < target.emojis.length; i += 1) {
      const emoji = target.emojis[i];
      const option = target.options[i];
      const reaction = message.reactions.cache.find(r => r.emoji.name === emoji);

      let count = reaction ? reaction.count : 0;

      if (reaction && message.author && interaction.client.user && message.author.id === interaction.client.user.id && count > 0) {
        count -= 1;
      }

      if (count < 0) count = 0;

      results.push({ emoji, option, count });
    }

    const maxCount = results.reduce((max, r) => (r.count > max ? r.count : max), 0);

    target.closed = true;
    target.closedAt = new Date().toISOString();
    target.closedBy = userId;
    guildStore.pollsByMessageId[target.messageId] = target;
    savePolls(store);

    if (maxCount === 0) {
      await interaction.editReply(`Poll closed, but there were no votes.\nQuestion: **${target.question}**`);
      return;
    }

    const winners = results.filter(r => r.count === maxCount);

    const link = `https://discord.com/channels/${guildId}/${target.channelId}/${target.messageId}`;

    if (winners.length === 1) {
      const winner = winners[0];
      await interaction.editReply(
        `Poll closed.\nQuestion: **${target.question}**\nWinning option: ${results.indexOf(winner) + 1}. ${winner.option} (${winner.count} vote(s)).\nPoll message: ${link}`,
      );
      return;
    }

    const winnerLines = winners.map(winner => {
      const index = results.indexOf(winner);
      return `${index + 1}. ${winner.option} (${winner.count} vote(s))`;
    });

    await interaction.editReply(
      `Poll closed with a tie.\nQuestion: **${target.question}**\nTop options:\n${winnerLines.join('\n')}\nPoll message: ${link}`,
    );
  },
};
