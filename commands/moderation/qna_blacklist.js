const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const QNA_BLACKLIST_ROLE_NAME = 'QNA Blacklist';
const QNA_CHANNEL_ID = '1445937629911711835';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('qna_blacklist')
    .setDescription('Toggle the QNA blacklist role for a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to add to or remove from the QNA blacklist.')
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
      r => r.name === QNA_BLACKLIST_ROLE_NAME,
    );

    if (!role) {
      try {
        role = await guild.roles.create({
          name: QNA_BLACKLIST_ROLE_NAME,
          color: 0x2b2d31,
          mentionable: false,
          reason: `Created automatically by /${interaction.commandName}`,
        });
      } catch (error) {
        console.error(
          '[qna_blacklist] Failed to create QNA blacklist role:',
          error,
        );
        await interaction.reply({
          content:
            'I could not create the QNA blacklist role. Please check my Manage Roles permission and role position.',
          ephemeral: true,
        });
        return;
      }
    }

    // Ensure channel overwrites are in place for the blacklist role
    try {
      const qnaChannel = await guild.channels.fetch(QNA_CHANNEL_ID);

      if (qnaChannel) {
        await qnaChannel.permissionOverwrites.edit(
          role,
          {
            SendMessages: false,
            SendMessagesInThreads: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
            AddReactions: false,
          },
          `Updated QNA blacklist permissions by ${interaction.user.tag}`,
        );
      }
    } catch (error) {
      console.error(
        '[qna_blacklist] Failed to apply overwrites on QNA channel:',
        error,
      );
      // Continue anyway; the role toggle is still useful even if overwrites fail
    }

    const alreadyBlacklisted = member.roles.cache.has(role.id);

    try {
      if (alreadyBlacklisted) {
        await member.roles.remove(
          role,
          `Removed from QNA blacklist by ${interaction.user.tag}`,
        );
        await interaction.reply({
          content: `Removed ${member.user.tag} from the QNA blacklist. They can use the QNA channel again.`,
          ephemeral: true,
        });
      } else {
        await member.roles.add(
          role,
          `Added to QNA blacklist by ${interaction.user.tag}`,
        );
        await interaction.reply({
          content:
            `Added ${member.user.tag} to the QNA blacklist. They can no longer post, comment, or react in the QNA channel.`,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error(
        '[qna_blacklist] Failed to toggle QNA blacklist role:',
        error,
      );
      await interaction.reply({
        content:
          "There was an error while updating that user's QNA blacklist status. Please check my role permissions and try again.",
        ephemeral: true,
      });
    }
  },
};
