const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const KI_BLACKLIST_ROLE_NAME = 'Killer Ideas Blacklist';
const KI_CHANNEL_ID = '1435579756601933878';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ki_blacklist')
    .setDescription('Toggle the Killer Ideas blacklist role for a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to add to or remove from the Killer Ideas blacklist.')
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
      r => r.name === KI_BLACKLIST_ROLE_NAME,
    );

    if (!role) {
      try {
        role = await guild.roles.create({
          name: KI_BLACKLIST_ROLE_NAME,
          color: 0x2b2d31,
          mentionable: false,
          reason: `Created automatically by /${interaction.commandName}`,
        });
      } catch (error) {
        console.error(
          '[ki_blacklist] Failed to create Killer Ideas blacklist role:',
          error,
        );
        await interaction.reply({
          content:
            'I could not create the Killer Ideas blacklist role. Please check my Manage Roles permission and role position.',
          ephemeral: true,
        });
        return;
      }
    }

    // Ensure channel overwrites are in place for the blacklist role
    try {
      const kiChannel = await guild.channels.fetch(KI_CHANNEL_ID);

      if (kiChannel) {
        await kiChannel.permissionOverwrites.edit(
          role,
          {
            SendMessages: false,
            SendMessagesInThreads: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
            AddReactions: false,
          },
          `Updated Killer Ideas blacklist permissions by ${interaction.user.tag}`,
        );
      }
    } catch (error) {
      console.error(
        '[ki_blacklist] Failed to apply overwrites on Killer Ideas channel:',
        error,
      );
      // Continue anyway; the role toggle is still useful even if overwrites fail
    }

    const alreadyBlacklisted = member.roles.cache.has(role.id);

    try {
      if (alreadyBlacklisted) {
        await member.roles.remove(
          role,
          `Removed from Killer Ideas blacklist by ${interaction.user.tag}`,
        );
        await interaction.reply({
          content: `Removed ${member.user.tag} from the Killer Ideas blacklist. They can use the Killer Ideas channel again.`,
          ephemeral: true,
        });
      } else {
        await member.roles.add(
          role,
          `Added to Killer Ideas blacklist by ${interaction.user.tag}`,
        );
        await interaction.reply({
          content:
            `Added ${member.user.tag} to the Killer Ideas blacklist. They can no longer post, comment, or react in the Killer Ideas channel.`,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error(
        '[ki_blacklist] Failed to toggle Killer Ideas blacklist role:',
        error,
      );
      await interaction.reply({
        content:
          "There was an error while updating that user's Killer Ideas blacklist status. Please check my role permissions and try again.",
        ephemeral: true,
      });
    }
  },
};
