const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  setUserDataValue,
  getUserDataValue,
  getAllUserDataForUser,
  deleteUserDataValue,
} = require('../../user_data_state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('data')
    .setDescription('Store and retrieve arbitrary per-user data.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Store a value under a key for yourself.')
        .addStringOption(option =>
          option
            .setName('key')
            .setDescription('Key name (e.g. note, token_label).')
            .setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName('value')
            .setDescription('Arbitrary string or JSON to store.')
            .setRequired(true),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('get')
        .setDescription('Get a stored value (or all values) for yourself.')
        .addStringOption(option =>
          option
            .setName('key')
            .setDescription('Key to fetch; leave empty to return everything.')
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete a stored key for yourself.')
        .addStringOption(option =>
          option
            .setName('key')
            .setDescription('Key to delete.')
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set') {
      const key = interaction.options.getString('key', true);
      const value = interaction.options.getString('value', true);

      setUserDataValue(guildId, userId, key, value, userId);

      const embed = new EmbedBuilder()
        .setTitle('Data Stored')
        .setColor(0x002b2d31)
        .addFields(
          { name: 'Key', value: key, inline: true },
          { name: 'Value', value: value, inline: false },
        );

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'get') {
      const key = interaction.options.getString('key', false);

      if (key) {
        const record = getUserDataValue(guildId, userId, key);
        if (!record) {
          await interaction.reply({
            content: `No stored data found for key \`${key}\`.`,
            ephemeral: true,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('Stored Data')
          .setColor(0x002b2d31)
          .addFields(
            { name: 'Key', value: key, inline: true },
            { name: 'Value', value: record.value ?? '', inline: false },
          );

        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
        return;
      }

      const all = getAllUserDataForUser(guildId, userId);
      const keys = Object.keys(all);

      if (keys.length === 0) {
        await interaction.reply({
          content: 'You have no stored data in this server.',
          ephemeral: true,
        });
        return;
      }

      const payload = {};
      for (const k of keys) {
        const rec = all[k];
        payload[k] = rec && typeof rec === 'object' ? rec.value ?? null : rec;
      }

      const json = JSON.stringify(payload);

      const embed = new EmbedBuilder()
        .setTitle('All Stored Data')
        .setColor(0x002b2d31)
        .setDescription(json);

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'delete') {
      const key = interaction.options.getString('key', true);
      const existed = deleteUserDataValue(guildId, userId, key);

      if (!existed) {
        await interaction.reply({
          content: `No stored data found for key \`${key}\`.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `Deleted stored data for key \`${key}\`.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: 'Unknown subcommand.',
      ephemeral: true,
    });
  },
};
