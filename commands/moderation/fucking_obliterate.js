const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_MESSAGES_PER_CHANNEL_FOR_REACTIONS = 1000; // safety cap per channel for reaction scrubbing
const EXPECTED_LAUNCH_CODE = '1400647379476283465';

// Step 2 & 3 helper: clear all messages/posts authored by the target user in this channel
async function clearUserMessagesInChannel(channel, targetUserId) {
  let lastId;
  let totalDeleted = 0;

  while (true) {
    const fetchOptions = { limit: 100 };
    if (lastId) {
      fetchOptions.before = lastId;
    }

    const fetched = await channel.messages.fetch(fetchOptions).catch(() => null);
    if (!fetched || fetched.size === 0) {
      break;
    }

    lastId = fetched.last().id;

    const messagesFromUser = fetched.filter(
      message => message.author?.id === targetUserId && !message.pinned,
    );

    if (messagesFromUser.size === 0) {
      continue;
    }

    const now = Date.now();

    const recent = messagesFromUser.filter(
      message => now - message.createdTimestamp < FOURTEEN_DAYS_MS,
    );
    const older = messagesFromUser.filter(
      message => now - message.createdTimestamp >= FOURTEEN_DAYS_MS,
    );

    if (recent.size > 0) {
      const deleted = await channel.bulkDelete(recent, true).catch(() => null);
      if (deleted) {
        totalDeleted += deleted.size;
      }
    }

    for (const message of older.values()) {
      try {
        await message.delete();
        totalDeleted += 1;
      } catch {
        // Ignore failures for individual messages
      }
    }
  }

  return totalDeleted;
}

// Step 4 helper: scrub all reactions by the target user in this channel
async function scrubReactionsFromChannel(channel, targetUserId) {
  let totalRemoved = 0;
  let lastId = null;
  let fetchedCount = 0;

  while (true) {
    const options = { limit: 100 };
    if (lastId) {
      options.before = lastId;
    }

    const messages = await channel.messages.fetch(options).catch(() => null);
    if (!messages || messages.size === 0) {
      break;
    }

    fetchedCount += messages.size;
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

    if (fetchedCount >= MAX_MESSAGES_PER_CHANNEL_FOR_REACTIONS) {
      break;
    }
  }

  return totalRemoved;
}

// Step 5 helper: delete messages that mention the target user in this channel
async function deleteMentionMessagesInChannel(channel, targetUserId) {
  let lastId;
  let totalDeleted = 0;

  while (true) {
    const fetchOptions = { limit: 100 };
    if (lastId) {
      fetchOptions.before = lastId;
    }

    const fetched = await channel.messages.fetch(fetchOptions).catch(() => null);
    if (!fetched || fetched.size === 0) {
      break;
    }

    lastId = fetched.last().id;

    const messagesToDelete = fetched.filter(message => {
      if (message.pinned) return false;

      const mentionsTargetViaMentions =
        !!message.mentions &&
        !!message.mentions.users &&
        typeof message.mentions.users.has === 'function' &&
        message.mentions.users.has(targetUserId);

      const content = message.content ?? '';
      const mentionsTargetViaContent =
        content.includes(`<@${targetUserId}>`) ||
        content.includes(`<@!${targetUserId}>`);

      return mentionsTargetViaMentions || mentionsTargetViaContent;
    });

    if (messagesToDelete.size === 0) {
      continue;
    }

    const now = Date.now();

    const recent = messagesToDelete.filter(
      message => now - message.createdTimestamp < FOURTEEN_DAYS_MS,
    );
    const older = messagesToDelete.filter(
      message => now - message.createdTimestamp >= FOURTEEN_DAYS_MS,
    );

    if (recent.size > 0) {
      const deleted = await channel.bulkDelete(recent, true).catch(() => null);
      if (deleted) {
        totalDeleted += deleted.size;
      }
    }

    for (const message of older.values()) {
      try {
        await message.delete();
        totalDeleted += 1;
      } catch {
        // Ignore failures for individual messages
      }
    }
  }

  return totalDeleted;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fucking_obliterate')
    .setDescription('INSANELY nuclear moderation action.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to obliterate')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('confirm')
        .setDescription('Type NUKE IT to confirm.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('launch_code')
        .setDescription('Launch code.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason (optional).')
        .setRequired(false),
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('user', true);
    const confirmation = interaction.options.getString('confirm', true);
    const customReason = interaction.options.getString('reason');
    const providedLaunchCode = interaction.options.getString('launch_code', true);

    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    if (confirmation !== 'NUKE IT') {
      await interaction.reply({
        content:
          'This command is INSANELY nuclear, please be very sure that it is necessary. To confirm, please type "NUKE IT" exactly in the `confirm` field. Command cancelled.',
        ephemeral: true,
      });
      return;
    }

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You do not have permission to use this command. (Administrator required.)',
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));

    if (!me) {
      await interaction.reply({
        content: 'I could not determine my own member in this server to check permissions.',
        ephemeral: true,
      });
      return;
    }

    if (targetUser.id === guild.ownerId) {
      await interaction.reply({
        content: 'I cannot obliterate the server owner.',
        ephemeral: true,
      });
      return;
    }

    if (targetUser.id === me.id) {
      await interaction.reply({
        content: 'Nice try, but I cannot obliterate myself.',
        ephemeral: true,
      });
      return;
    }

    if (providedLaunchCode !== EXPECTED_LAUNCH_CODE) {
      await interaction.reply({
        content: 'Invalid launch code. Nuclear sequence aborted.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    // Step 1: Ban user
    let banResultText = 'Ban not attempted.';
    try {
      const member = await guild.members.fetch(targetUser.id).catch(() => null);
      if (member && member.bannable) {
        const baseReason =
          customReason && customReason.trim().length
            ? customReason.trim()
            : 'Nuclear obliteration via /fucking_obliterate';
        await member.ban({
          reason: `${baseReason} | Nuked by ${interaction.user.tag}`,
        });
        banResultText = 'User banned successfully.';
      } else {
        banResultText =
          'I could not ban that user (they may already be gone, or I lack sufficient permissions / role hierarchy).';
      }
    } catch {
      banResultText =
        'Ban attempt failed due to an error or permission issue; please verify ban status manually.';
    }

    let channelsScanned = 0;
    let totalUserMessagesDeleted = 0;
    let totalReactionsRemoved = 0;
    let totalMentionMessagesDeleted = 0;

    try {
      const channels = await guild.channels.fetch();

      for (const channel of channels.values()) {
        if (!channel || !channel.isTextBased()) {
          continue;
        }

        const perms = channel.permissionsFor(me);
        if (
          !perms ||
          !perms.has(PermissionFlagsBits.ViewChannel) ||
          !perms.has(PermissionFlagsBits.ReadMessageHistory) ||
          !perms.has(PermissionFlagsBits.ManageMessages)
        ) {
          continue;
        }

        channelsScanned += 1;

        // Step 2 & 3: clear messages + remove posts (all authored content)
        try {
          const deletedHere = await clearUserMessagesInChannel(channel, targetUser.id);
          totalUserMessagesDeleted += deletedHere;
        } catch {
          // Ignore per-channel failures for authored messages
        }

        // Step 4: scrub reactions
        try {
          const reactionsRemovedHere = await scrubReactionsFromChannel(channel, targetUser.id);
          totalReactionsRemoved += reactionsRemovedHere;
        } catch {
          // Ignore per-channel failures for reactions
        }

        // Step 5: scrub mentions
        try {
          const mentionsDeletedHere = await deleteMentionMessagesInChannel(
            channel,
            targetUser.id,
          );
          totalMentionMessagesDeleted += mentionsDeletedHere;
        } catch {
          // Ignore per-channel failures for mentions
        }
      }

      const lines = [];

      lines.push(`✅ Nuclear obliteration complete for **${targetUser.tag}**.`);
      lines.push(`• Step 1 — Ban user: ${banResultText}`);
      lines.push(
        `• Step 2–3 — Cleared **${totalUserMessagesDeleted}** message(s)/post(s) authored by that user across **${channelsScanned}** channel(s) I could access.`,
      );
      lines.push(
        `• Step 4 — Scrubbed **${totalReactionsRemoved}** reaction(s) from that user across those channels.`,
      );
      lines.push(
        `• Step 5 — Deleted **${totalMentionMessagesDeleted}** message(s) that mentioned that user (where I had permission).`,
      );
      lines.push('');
      lines.push(
        'Note: Discord API limits (especially the 14-day bulk-delete rule and rate limits) mean very old content or content in channels I cannot see may remain. For very large servers you may need to run this more than once.',
      );

      await interaction.editReply(lines.join('\n'));
    } catch (error) {
      console.error('Error executing /fucking_obliterate:', error);
      const message =
        'There was an error while trying to obliterate that user. Some actions may have partially completed; please check logs and server state.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};
