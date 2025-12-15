const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const tsState = require('../../ts_state');

const TESTER_ROLE_ID = '1447218798112538654';

async function getTesterRole(guild) {
  if (!guild) return null;
  const cached = guild.roles.cache.get(TESTER_ROLE_ID);
  if (cached) return cached;
  const fetched = await guild.roles.fetch(TESTER_ROLE_ID).catch(() => null);
  return fetched || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ts_setup')
    .setDescription('Initialize TS tracking for all members with the tester role (does not wipe existing TS).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    await interaction.deferReply({ ephemeral: true });

    const testerRole = await getTesterRole(guild);
    if (!testerRole) {
      await interaction.editReply('Tester role not found. Fix the role ID / permissions and retry.');
      return;
    }

    // Ensure role.members is fully populated.
    await guild.members.fetch().catch(() => null);

    const testerMembers = Array.from(testerRole.members.values());

    let created = 0;
    let existing = 0;

    for (const member of testerMembers) {
      const res = tsState.ensureTester(guild.id, member.id);
      if (!res) {
        continue;
      }

      if (res.created) {
        created += 1;
      } else {
        existing += 1;
      }
    }

    await interaction.editReply(
      `✅ TS setup complete. Tracked **${created + existing}** tester(s) (created **${created}**, already had **${existing}**).`,
    );
  },
};
