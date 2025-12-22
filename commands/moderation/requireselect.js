const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {
  setRequireSelectRule,
  clearRequireSelectRule,
  getRequireSelectRule,
} = require('../../requireselect_state');

const MEDIA_CHOICES = [
  { name: 'Embed (link preview / rich embed)', value: 'embed' },
  { name: 'Image', value: 'image' },
  { name: 'Video', value: 'video' },
  { name: 'Any attachment (file)', value: 'attachment' },
  { name: 'Sticker', value: 'sticker' },
];

function resolveTargetChannel(interaction) {
  const selected = interaction.options.getChannel('channel');
  const channel = selected ?? interaction.channel;
  if (!channel) return null;

  if (!channel.isTextBased || !channel.isTextBased()) {
    return null;
  }

  const guild = interaction.guild;
  if (guild && channel.guildId && channel.guildId !== guild.id) {
    return null;
  }

  return channel;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('requireselect')
    .setDescription('Require a specific kind of media in a channel (auto-deletes non-matching messages).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Enable/replace the required media type for a channel (defaults to current channel).')
        .addStringOption(option =>
          option
            .setName('media')
            .setDescription('Which kind of media must be present')
            .setRequired(true)
            .addChoices(...MEDIA_CHOICES),
        )
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel to apply this rule to (defaults to current channel)')
            .setRequired(false),
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
        .setDescription('Disable the requirement for a channel (defaults to current channel).')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel to clear (defaults to current channel)')
            .setRequired(false),
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
        .setName('view')
        .setDescription('View the current requirement for a channel (defaults to current channel).')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel to inspect (defaults to current channel)')
            .setRequired(false),
        )
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

    const channel = resolveTargetChannel(interaction);
    if (!channel) {
      await interaction.reply({
        content: 'Please choose a text-based channel from this server.',
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set') {
      const media = interaction.options.getString('media', true);
      setRequireSelectRule(guildId, channel.id, media, interaction.user.id);

      await interaction.reply({
        content: `✅ Now requiring **${media}** in ${channel}. Messages without the required media will be deleted. (Users with **Manage Messages** are ignored.)`,
        ephemeral,
      });
      return;
    }

    if (subcommand === 'clear') {
      const prior = getRequireSelectRule(guildId, channel.id);
      clearRequireSelectRule(guildId, channel.id);

      if (!prior) {
        await interaction.reply({
          content: `No /requireselect rule was set for ${channel}.`,
          ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: `✅ Cleared the /requireselect rule for ${channel}.`,
        ephemeral,
      });
      return;
    }

    if (subcommand === 'view') {
      const rule = getRequireSelectRule(guildId, channel.id);
      if (!rule || !rule.requiredType) {
        await interaction.reply({
          content: `No /requireselect rule is set for ${channel}.`,
          ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: `Current /requireselect for ${channel}: **${rule.requiredType}**`,
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
