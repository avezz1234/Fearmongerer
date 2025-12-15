const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const testSessionState = require('../../test_session_state');

function clampInt(value, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mark_attendance')
    .setDescription('Manually mark a user as present for the active test session.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to mark as present')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('How many minutes to credit (default: 1)')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    const user = interaction.options.getUser('user', true);
    const minutesRaw = interaction.options.getInteger('minutes', false);

    const minutes = minutesRaw == null
      ? 1
      : (clampInt(minutesRaw, { min: 1, max: 24 * 60 }) ?? null);

    if (!minutes) {
      await interaction.reply({
        content: 'Bad `minutes`. Use an integer between 1 and 1440.',
        ephemeral: true,
      });
      return;
    }

    const active = testSessionState.getActiveSession(guild.id);
    if (!active) {
      await interaction.reply({ content: 'No active test session right now.', ephemeral: true });
      return;
    }

    const seconds = minutes * 60;
    const updated = testSessionState.markAttendance(guild.id, user.id, seconds, Date.now());

    if (!updated) {
      await interaction.reply({ content: 'Failed to mark attendance (no active session?).', ephemeral: true });
      return;
    }

    await interaction.reply({
      content: `✅ Marked ${user} present for **${minutes}m** in active test session **${active.id || 'unknown'}**.`,
      ephemeral: true,
    });
  },
};
