const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const SUGGESTION_BLACKLIST_ROLE_NAME = 'Suggestion Blacklist';
const SUGGESTION_FORUM_CHANNEL_ID = '1435578911605002276';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestion_blacklist')
    .setDescription('Toggle the suggestion blacklist role for a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to add to or remove from the suggestion blacklist.')
        .setRequired(true),
    ),
  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
      await interaction.reply({
        content: 'You must specify a user to blacklist or unblacklist.',
        ephemeral: true,
      });
      return;
    }

    if (targetUser.id === interaction.user.id) {
      await interaction.reply({
        content: 'You cannot use this command on yourself.',
        ephemeral: true,
      });
      return;
    }

    let member;
    try {
      member = await guild.members.fetch(targetUser.id);
    } catch {
      member = null;
    }

    if (!member) {
      await interaction.reply({
        content: 'I could not find that user in this server.',
        ephemeral: true,
      });
      return;
    }

    let role = guild.roles.cache.find(
      r => r.name === SUGGESTION_BLACKLIST_ROLE_NAME,
    );

    if (!role) {
      try {
        role = await guild.roles.create({
          name: SUGGESTION_BLACKLIST_ROLE_NAME,
          color: 0x2b2d31,
          mentionable: false,
          reason: `Created automatically by /${interaction.commandName}`,
        });
      } catch (error) {
        console.error(
          '[suggestion_blacklist] Failed to create suggestion blacklist role:',
          error,
        );
        await interaction.reply({
          content:
            'I could not create the suggestion blacklist role. Please check my Manage Roles permission and role position.',
          ephemeral: true,
        });
        return;
      }
    }

    // Ensure channel overwrites are in place for the blacklist role
    try {
      const forumChannel = await guild.channels.fetch(SUGGESTION_FORUM_CHANNEL_ID);

      if (forumChannel) {
        await forumChannel.permissionOverwrites.edit(
          role,
          {
            SendMessages: false,
            SendMessagesInThreads: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
            AddReactions: false,
          },
          `Updated suggestion blacklist permissions by ${interaction.user.tag}`,
        );
      }
    } catch (error) {
      console.error(
        '[suggestion_blacklist] Failed to apply overwrites on suggestion forum:',
        error,
      );
      // Continue anyway; the role toggle is still useful even if overwrites fail
    }

    const alreadyBlacklisted = member.roles.cache.has(role.id);

    try {
      if (alreadyBlacklisted) {
        await member.roles.remove(
          role,
          `Removed from suggestion blacklist by ${interaction.user.tag}`,
        );
        await interaction.reply({
          content: `Removed ${member.user.tag} from the suggestion blacklist. They can post in the suggestions forum again.`,
          ephemeral: true,
        });
      } else {
        await member.roles.add(
          role,
          `Added to suggestion blacklist by ${interaction.user.tag}`,
        );
        await interaction.reply({
          content:
            `Added ${member.user.tag} to the suggestion blacklist. They can no longer post, comment, or react in the suggestions forum.`,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error(
        '[suggestion_blacklist] Failed to toggle suggestion blacklist role:',
        error,
      );
      await interaction.reply({
        content:
          "There was an error while updating that user's suggestion blacklist status. Please check my role permissions and try again.",
        ephemeral: true,
      });
    }
  },
};
