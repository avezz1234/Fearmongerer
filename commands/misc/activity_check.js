const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const activityState = require('../../activity_state');

function formatDurationFromSeconds(totalSeconds) {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function unixFromIso(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activity_check')
    .setDescription('Check a user\'s clock-in activity / total time.')
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to check (defaults to you)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const target = interaction.options.getUser('user', false) ?? interaction.user;
    const nowMs = Date.now();

    const entry = activityState.getUserActivity(guild.id, target.id);

    const totalBaseSeconds = entry && typeof entry.totalSeconds === 'number' ? entry.totalSeconds : 0;
    const currentSeconds = entry ? activityState.getCurrentSessionSeconds(entry, nowMs) : 0;
    const totalWithCurrent = totalBaseSeconds + currentSeconds;

    const clockedIn = Boolean(entry && entry.currentClockInAt);

    const startedUnix = entry && entry.currentClockInAt ? unixFromIso(entry.currentClockInAt) : null;
    const lastInUnix = entry && entry.lastClockInAt ? unixFromIso(entry.lastClockInAt) : null;
    const lastOutUnix = entry && entry.lastClockOutAt ? unixFromIso(entry.lastClockOutAt) : null;

    const embed = new EmbedBuilder()
      .setTitle('Activity Check')
      .setColor(clockedIn ? 0x002ecc71 : 0x005865f2)
      .addFields(
        { name: 'User', value: `${target}`, inline: true },
        { name: 'Status', value: clockedIn ? 'Clocked in' : 'Clocked out', inline: true },
        { name: 'Total time', value: `**${formatDurationFromSeconds(totalWithCurrent)}**`, inline: true },
      )
      .setTimestamp(new Date());

    if (clockedIn) {
      embed.addFields({
        name: 'Current session',
        value: startedUnix
          ? `${formatDurationFromSeconds(currentSeconds)} (since <t:${startedUnix}:F>)`
          : `${formatDurationFromSeconds(currentSeconds)} (since unknown time)`,
        inline: false,
      });
    } else if (entry && typeof entry.lastSessionSeconds === 'number' && entry.lastSessionSeconds > 0) {
      embed.addFields({
        name: 'Last session',
        value: formatDurationFromSeconds(entry.lastSessionSeconds),
        inline: false,
      });
    }

    const lines = [];
    if (lastInUnix) lines.push(`Last clock-in: <t:${lastInUnix}:F>`);
    if (lastOutUnix) lines.push(`Last clock-out: <t:${lastOutUnix}:F>`);
    if (lines.length) {
      embed.addFields({ name: 'Recent', value: lines.join('\n'), inline: false });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
