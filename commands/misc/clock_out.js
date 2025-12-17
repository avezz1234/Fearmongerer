const { SlashCommandBuilder } = require('discord.js');

const activityState = require('../../activity_state');

const CLOCK_ROLE_ID = '1449793668339994737';

function formatDurationFromSeconds(totalSeconds) {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clock_out')
    .setDescription('Clock out (remove the on-duty role and stop tracking time).')
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const nowMs = Date.now();
    const userId = interaction.user.id;

    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch (error) {
      console.error('[clock_out] Failed to fetch member:', error);
      await interaction.editReply('Could not fetch your server member record.');
      return;
    }

    // Always try to remove the role, even if we weren't clocked in.
    try {
      if (member.roles.cache.has(CLOCK_ROLE_ID)) {
        await member.roles.remove(CLOCK_ROLE_ID, `Clock out: ${interaction.user.tag}`);
      }
    } catch (error) {
      console.error('[clock_out] Failed to remove role:', error);
      await interaction.editReply('I could not remove the clock-in role. Check my role permissions / role hierarchy.');
      return;
    }

    const res = activityState.clockOut(guild.id, userId, nowMs);
    if (!res) {
      await interaction.editReply('Failed to clock you out (unexpected).');
      return;
    }

    if (res.status === 'not_clocked_in') {
      await interaction.editReply('You were not clocked in. (Role removed if you had it.)');
      return;
    }

    const delta = typeof res.deltaSeconds === 'number' ? res.deltaSeconds : 0;
    const total = res.entry ? res.entry.totalSeconds : 0;

    await interaction.editReply(
      `✅ Clocked out. Session: **${formatDurationFromSeconds(delta)}**. Total tracked: **${formatDurationFromSeconds(total)}**.`,
    );
  },
};
