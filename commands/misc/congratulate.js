const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('congratulate')
    .setDescription('Responds with a congratulatory message.'),

  async execute(interaction) {
    // Keep behavior similar to /automod: server-only + ephemeral reply
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: "Yes, that's true!",
      ephemeral: false,
    });
  },
};
