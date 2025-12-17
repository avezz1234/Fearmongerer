const { SlashCommandBuilder } = require('discord.js');

const activityState = require('../../activity_state');

const CLOCK_ROLE_ID = '1449793668339994737';

function unixFromIso(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clock_in')
    .setDescription('Clock in (assign the on-duty role and start tracking time).')
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
      console.error('[clock_in] Failed to fetch member:', error);
      await interaction.editReply('Could not fetch your server member record.');
      return;
    }

    try {
      if (!member.roles.cache.has(CLOCK_ROLE_ID)) {
        await member.roles.add(CLOCK_ROLE_ID, `Clock in: ${interaction.user.tag}`);
      }
    } catch (error) {
      console.error('[clock_in] Failed to add role:', error);
      await interaction.editReply('I could not assign the clock-in role. Check my role permissions / role hierarchy.');
      return;
    }

    const res = activityState.clockIn(guild.id, userId, nowMs);
    if (!res) {
      await interaction.editReply('Failed to clock you in (unexpected).');
      return;
    }

    const startedUnix = res.entry.currentClockInAt ? unixFromIso(res.entry.currentClockInAt) : null;

    if (res.status === 'already_clocked_in') {
      const since = startedUnix ? `<t:${startedUnix}:F> (<t:${startedUnix}:R>)` : 'an unknown time';
      await interaction.editReply(`You are already clocked in (since ${since}).`);
      return;
    }

    const nowUnix = Math.floor(nowMs / 1000);
    await interaction.editReply(`✅ Clocked in at <t:${nowUnix}:F> (<t:${nowUnix}:R>).`);
  },
};
