const { SlashCommandBuilder } = require('discord.js');
const { addAutomodWords, clearAutomodRules } = require('../../automod_state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure server automod blocked words.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Add one or more words/phrases to the automod filter.')
        .addStringOption(option =>
          option
            .setName('words')
            .setDescription('Word(s) or phrase(s) to block; comma-separated is allowed.')
            .setRequired(true),
        )
        .addBooleanOption(option =>
          option
            .setName('ephemeral')
            .setDescription('Reply ephemerally (default true)')
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Clear all automod words for this server.')
        .addBooleanOption(option =>
          option
            .setName('ephemeral')
            .setDescription('Reply ephemerally (default true)')
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set') {
      const rawWords = interaction.options.getString('words', true);
      const parts = rawWords
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);

      if (parts.length === 0) {
        await interaction.reply({
          content: 'You must provide at least one non-empty word or phrase.',
          ephemeral: true,
        });
        return;
      }

      const guildId = interaction.guild.id;
      const userId = interaction.user.id;

      addAutomodWords(guildId, parts, userId);

      const summary =
        parts.length === 1
          ? `Added **${parts[0]}** to the automod filter.`
          : `Added **${parts.length}** entries to the automod filter.`;

      await interaction.reply({
        content: `${summary} I will now warn and remove messages that contain these word(s).`,
        ephemeral,
      });
      return;
    }

    if (subcommand === 'clear') {
      const guildId = interaction.guild.id;
      clearAutomodRules(guildId);

      await interaction.reply({
        content: 'Automod has been reset for this server; no blocked words are currently configured.',
        ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: 'Unknown subcommand.',
      ephemeral: true,
    });
  },
};
