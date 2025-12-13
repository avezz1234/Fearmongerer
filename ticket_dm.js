const { EmbedBuilder } = require('discord.js');

function truncateText(value, maxLen) {
  const text = value == null ? '' : String(value);
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

function parseUserIdFromTag(tagText) {
  const raw = typeof tagText === 'string' ? tagText : '';
  const m = raw.match(/\((\d{15,25})\)/);
  return m ? m[1] : null;
}

async function dmTicketPresenter(client, stored, { decision, reason }) {
  try {
    if (!stored) return;
    const type = stored.type;
    if (type !== 'report' && type !== 'appeal') return;

    const presenterId = stored.reporterId || parseUserIdFromTag(stored.reporterTag);
    if (!presenterId) return;

    const presenter = await client.users.fetch(presenterId).catch(() => null);
    if (!presenter) return;

    const safeReasonRaw =
      reason && String(reason).trim().length ? String(reason).trim() : 'None provided';
    const safeReason = truncateText(safeReasonRaw, 1024);

    const normalizedDecision = decision === 'Denied' ? 'Denied' : 'Accepted';
    const status = normalizedDecision === 'Denied' ? 'DENIED' : 'ACCEPTED';
    const color = normalizedDecision === 'Accepted' ? 0x2ecc71 : 0xe74c3c;

    if (type === 'report') {
      const rulebreaker = stored.rulebreaker || 'Unknown';
      const evidence = stored.evidence ? truncateText(stored.evidence, 1024) : null;

      const embed = new EmbedBuilder()
        .setTitle('Ticket Decision')
        .setColor(color)
        .setDescription(`Your report ticket has been **${status}**.`)
        .addFields(
          { name: 'Type', value: 'Report', inline: true },
          { name: 'Decision', value: normalizedDecision, inline: true },
          { name: 'Reported user', value: truncateText(rulebreaker, 1024), inline: false },
          ...(evidence ? [{ name: 'Evidence', value: evidence, inline: false }] : []),
          { name: 'Reason', value: safeReason, inline: false },
        )
        .setTimestamp(new Date());

      await presenter.send({ embeds: [embed] }).catch(() => null);
      return;
    }

    if (type === 'appeal') {
      const accountName =
        stored.robloxUsername || stored.reporterName || stored.reporterTag || presenter.tag;

      const embed = new EmbedBuilder()
        .setTitle('Ticket Decision')
        .setColor(color)
        .setDescription(`Your appeal ticket has been **${status}**.`)
        .addFields(
          { name: 'Type', value: 'Appeal', inline: true },
          { name: 'Decision', value: normalizedDecision, inline: true },
          { name: 'Account', value: truncateText(accountName, 1024), inline: false },
          { name: 'Reason', value: safeReason, inline: false },
        )
        .setTimestamp(new Date());

      await presenter.send({ embeds: [embed] }).catch(() => null);
    }
  } catch {
    // ignore DM failures
  }
}

module.exports = { dmTicketPresenter };
