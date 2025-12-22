const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a DM to a user through the bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('User to DM')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('text')
        .setDescription('Message text to send')
        .setRequired(true),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target', true);
    const text = interaction.options.getString('text', true);

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    await interaction.deferReply({ ephemeral });

    try {
      await targetUser.send(text);
      await interaction.editReply(`✅ Sent DM to **${targetUser.tag}**.`);
    } catch (error) {
      console.error('Error executing /dm:', error);
      await interaction.editReply('I could not send that DM (the user may have DMs disabled or blocked the bot).');
    }
  },
};
