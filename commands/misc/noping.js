const { SlashCommandBuilder } = require('discord.js');
const { setNoPingRule } = require('../../noping_state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('noping')
    .setDescription('Auto-respond when others ping you about a specific topic.')
    .addStringOption(option =>
      option
        .setName('parse_for')
        .setDescription('Word or phrase to look for in messages pinging you')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('response')
        .setDescription('What the bot should say to people pinging you')
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const parseForRaw = interaction.options.getString('parse_for', true);
    const responseRaw = interaction.options.getString('response', true);
    const parseFor = parseForRaw.trim();
    const response = responseRaw.trim();

    if (!parseFor.length) {
      await interaction.reply({
        content: 'You must provide a non-empty value for the **parse_for** field.',
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    setNoPingRule(guildId, userId, parseFor, response);

    const base = `I will reply when someone pings you and mentions **${parseFor}**.`;
    const extra = response.length ? '' : ' (Using a default message.)';

    await interaction.reply({
      content: `${base}${extra}`,
      ephemeral: true,
    });
  },
};
