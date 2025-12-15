const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const CHOICE_LABELS = ['A','B','C','D','E','F','G','H','I','J'];

function getVoteCounts(poll) {
  const options = Array.isArray(poll?.options) ? poll.options : [];
  const counts = Array(options.length).fill(0);

  const votes = poll && poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
  for (const idx of Object.values(votes)) {
    if (typeof idx === 'number' && idx >= 0 && idx < counts.length) {
      counts[idx] += 1;
    }
  }

  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const uniqueVoters = Object.keys(votes).length;
  return { counts, totalVotes, uniqueVoters };
}

function renderBar(percent, width) {
  const w = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 10;
  const pct = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const filled = Math.round((pct / 100) * w);
  return `${'▓'.repeat(filled)}${'░'.repeat(Math.max(0, w - filled))}`;
}

function buildAnonPollEmbed(poll) {
  const kind = poll?.kind === 'public' ? 'public' : 'anon';
  const configuredTitle = typeof poll?.title === 'string' ? poll.title.trim().slice(0, 256) : '';
  const baseTitle = configuredTitle || (kind === 'public' ? 'Poll' : 'Anonymous Poll');
  const question = typeof poll?.question === 'string' ? poll.question.trim() : '';
  const options = Array.isArray(poll?.options) ? poll.options : [];
  const pollId = typeof poll?.id === 'string' ? poll.id : 'unknown';
  const { counts, totalVotes, uniqueVoters } = getVoteCounts(poll);

  const choiceLines = options.map((opt, i) => {
    const label = CHOICE_LABELS[i] || String(i + 1);
    return `**${label}** ${opt}`;
  });

  const resultLines = options.map((opt, i) => {
    const label = CHOICE_LABELS[i] || String(i + 1);
    const count = counts[i] || 0;
    const pct = totalVotes ? (count / totalVotes) * 100 : 0;
    const bar = renderBar(pct, 10);
    return `**${label}** ${bar} | ${pct.toFixed(1)}% (${count})`;
  });

  const settings = [];
  if (kind === 'public') {
    settings.push('Public Poll');
    settings.push('Participants can view votes');
  } else {
    settings.push('Hidden Poll');
  }
  settings.push('1 allowed choice');
  if (typeof poll?.closesAtMs === 'number') {
    const closesAtUnix = Math.floor(poll.closesAtMs / 1000);
    settings.push(`Auto closes <t:${closesAtUnix}:R>`);
  }

  const descParts = [
    '**Question**',
    question || '(no question)',
    '',
    '**Choices**',
    choiceLines.length ? choiceLines.join('\n') : '(no choices)',
    '',
    poll?.closed ? '**Result (final)**' : '**Result**',
    resultLines.length ? resultLines.join('\n') : '(no results)',
    `*${totalVotes} vote(s) from ${uniqueVoters} user(s)*`,
    '',
    '**Settings**',
    settings.join('\n'),
  ];

  const embed = new EmbedBuilder()
    .setTitle(poll?.closed ? `${baseTitle} — Result` : baseTitle)
    .setColor(poll?.closed ? 0x002ecc71 : 0x005865f2)
    .setDescription(descParts.join('\n'))
    .setFooter({ text: `Poll ID: ${pollId.slice(0, 8)}` })
    .setTimestamp(new Date());

  return embed;
}

function buildAnonPollComponents(poll) {
  const pollId = typeof poll?.id === 'string' ? poll.id : 'unknown';
  const options = Array.isArray(poll?.options) ? poll.options : [];
  const disabled = !!poll?.closed;

  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonsInRow = 0;

  for (let i = 0; i < options.length; i += 1) {
    const label = CHOICE_LABELS[i] || String(i + 1);
    const btn = new ButtonBuilder()
      .setCustomId(`polls/${pollId}/vote/${i}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(label)
      .setDisabled(disabled);

    currentRow.addComponents(btn);
    buttonsInRow += 1;

    if (buttonsInRow >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      buttonsInRow = 0;
    }
  }

  if (buttonsInRow > 0) {
    rows.push(currentRow);
  }

  const participantsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`polls/${pollId}/participants`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Participants')
      .setDisabled(false),
  );

  rows.push(participantsRow);
  return rows;
}

module.exports = {
  buildAnonPollEmbed,
  buildAnonPollComponents,
  getVoteCounts,
};
