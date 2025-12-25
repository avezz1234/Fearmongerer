const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const MAX_MESSAGES_PER_CHANNEL = 1000; // Safety cap per channel to avoid extreme rate limiting

async function scrubReactionsFromChannel(channel, targetUserId) {
  let totalRemoved = 0;
  let lastId = null;
  let fetched = 0;

  while (true) {
    const options = { limit: 100 };
    if (lastId) {
      options.before = lastId;
    }

    const messages = await channel.messages.fetch(options).catch(() => null);
    if (!messages || messages.size === 0) {
      break;
    }

    fetched += messages.size;
    lastId = messages.last().id;

    for (const message of messages.values()) {
      if (!message.reactions || !message.reactions.cache || message.reactions.cache.size === 0) {
        continue;
      }

      for (const reaction of message.reactions.cache.values()) {
        try {
          const users = await reaction.users.fetch();
          if (users.has(targetUserId)) {
            await reaction.users.remove(targetUserId);
            totalRemoved += 1;
          }
        } catch {
          // Ignore individual reaction failures and keep going
        }
      }
    }

    if (fetched >= MAX_MESSAGES_PER_CHANNEL) {
      break;
    }
  }

  return totalRemoved;
}

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageMessages,
  data: new SlashCommandBuilder()
    .setName('react_scrub')
    .setDescription('Remove all reactions by a specific user across this server.')
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User whose reactions will be removed')
        .setRequired(true),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
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

    const targetUser = interaction.options.getUser('user', true);

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions || !callerPermissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: 'You do not have permission to use this command. (Manage Messages required.)',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral });

    const guild = interaction.guild;
    const me = guild.members.me;

    if (!me) {
      await interaction.editReply('I could not resolve my own member in this guild; cannot safely check permissions.');
      return;
    }

    let totalRemoved = 0;
    let channelsChecked = 0;

    for (const channel of guild.channels.cache.values()) {
      try {
        if (!channel || !channel.isTextBased()) {
          continue;
        }

        const perms = channel.permissionsFor(me);
        if (!perms) {
          continue;
        }

        if (
          !perms.has(PermissionFlagsBits.ViewChannel) ||
          !perms.has(PermissionFlagsBits.ReadMessageHistory) ||
          !perms.has(PermissionFlagsBits.ManageMessages)
        ) {
          continue;
        }

        channelsChecked += 1;
        const removedInChannel = await scrubReactionsFromChannel(channel, targetUser.id);
        totalRemoved += removedInChannel;
      } catch {
        // Ignore channel-level failures and continue with others
      }
    }

    if (channelsChecked === 0) {
      await interaction.editReply(
        'I was not able to access any text channels with the required permissions to scrub reactions.',
      );
      return;
    }

    if (totalRemoved === 0) {
      await interaction.editReply(
        `I did not find any reactions from **${targetUser.tag}** to remove in the channels I can access.`,
      );
      return;
    }

    await interaction.editReply(
      `Done. I removed **${totalRemoved}** reactions from **${targetUser.tag}** across **${channelsChecked}** channels I could access. For very large servers or very old messages, you may need to run this again or accept that some reactions might remain due to API limits.`,
    );
  },
};
