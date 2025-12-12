const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gethex')
    .setDescription('Get the hex color of a role.')
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role to inspect')
        .setRequired(true),
    )
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const role = interaction.options.getRole('role', true);
    const hex = role.hexColor ?? '#000000';

    await interaction.reply({
      content: `Hex color for ${role} is \`${hex}\`.`,
      ephemeral: true,
    });
  },
};
