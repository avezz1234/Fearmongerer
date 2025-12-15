const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Show ticket rules, guidelines, and recording recommendations.')
    .setDMPermission(false),
  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Ticket Rules & Guidelines')
      .setColor(0x003498db)
      .setDescription('Please read and follow these rules when submitting a ticket.')
      .addFields(
        {
          name: 'Rules',
          value: [
            '• Do **NOT** misuse tickets.',
            '• Provide as much information as possible.',
            '• Do not appeal unappealable bans.',
            '• Do **NOT** delete evidence.',
            '• Ensure what you report is against the game rules.',
          ].join('\n'),
        },
        {
          name: 'Punishments for breaking rules',
          value: 'Warnings, mutes, bans, or a permanent ticket blacklist.',
        },
        {
          name: 'How does the ticket system work?',
          value: [
            '• When you submit a ticket, staff will review it.',
            '• You will **NOT** see a ticket channel unless staff need more info.',
            '• Use `/my_tickets` to check your ticket status.',
            '• Submitting false tickets may result in punishment.',
          ].join('\n'),
        },
        {
          name: 'Recommended recording software',
          value: [
            '[OBS Studio](https://obsproject.com)',
            '[Medal](https://medal.tv)',
          ].join('\n'),
        },
        {
          name: 'Recommended hosting services',
          value: [
            '[YouTube](https://www.youtube.com)',
            '[Medal](https://medal.tv)',
            '',
            'Note: medal.tv share links are temporary, please press the **Post** button instead.',
          ].join('\n'),
        },
      );

    await interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
