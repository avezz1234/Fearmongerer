const { SlashCommandBuilder } = require('discord.js');
const {
  addReverseAutomodWords,
  clearReverseAutomodRules,
} = require('../../automod_state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reverse_automod')
    .setDescription('Configure words/phrases that make the bot reply "Yay!" instead of moderating.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Add one or more words/phrases to trigger a Yay! reply.')
        .addStringOption(option =>
          option
            .setName('words')
            .setDescription('Word(s) or phrase(s) to celebrate; comma-separated is allowed.')
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
        .setDescription('Clear all reverse automod words for this server.')
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

      addReverseAutomodWords(guildId, parts, userId);

      const summary =
        parts.length === 1
          ? `Added **${parts[0]}** to the reverse automod list.`
          : `Added **${parts.length}** entries to the reverse automod list.`;

      await interaction.reply({
        content: `${summary} I will now reply "Yay!" when I see these word(s), without deleting any messages.`,
        ephemeral,
      });
      return;
    }

    if (subcommand === 'clear') {
      const guildId = interaction.guild.id;
      clearReverseAutomodRules(guildId);

      await interaction.reply({
        content:
          'Reverse automod has been reset for this server; no Yay! trigger words are currently configured.',
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
