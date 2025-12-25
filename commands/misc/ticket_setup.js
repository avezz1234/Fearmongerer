const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName('ticket_setup')
    .setDescription('Post the ticket creation panel in this channel.')
    .setDMPermission(false),
  async execute(interaction) {
    const channel = interaction.channel;

    if (!interaction.guild || !channel || !channel.isTextBased()) {
      await interaction.reply({
        content: 'This command can only be used in a server text channel.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Create a Ticket')
      .setDescription(
        'Press a button below to create a ticket.\n\n' +
          '- **Report Rulebreaker**: Report a player breaking the rules.\n' +
          '- **Appeal Ban**: Request to appeal a ban (No appealing unappealable bans).\n' +
          '- **Other Support**: Any other issues not covered above.',
      )
      .setFooter({ text: 'Please read the rules before submitting a ticket!' })
      .setColor(0x003498db);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tickets:button:report:submit')
        .setLabel('Report Rulebreaker')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('tickets:button:appeal:submit')
        .setLabel('Appeal Ban')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('tickets:button:other:submit')
        .setLabel('Other Support')
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: false,
    });
  },
};
