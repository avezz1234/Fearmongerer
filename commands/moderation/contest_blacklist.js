const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const CONTEST_BLACKLIST_ROLE_NAME = 'Contest_Blacklist';
const CONTEST_CATEGORY_ID = '1447210838212739072';

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageRoles,
  data: new SlashCommandBuilder()
    .setName('contest_blacklist')
    .setDescription('Toggle the Contest_Blacklist role for a user.')
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to add to or remove from the contest blacklist.')
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
      r => r.name === CONTEST_BLACKLIST_ROLE_NAME,
    );

    if (!role) {
      try {
        role = await guild.roles.create({
          name: CONTEST_BLACKLIST_ROLE_NAME,
          color: 0x002b2d31,
          mentionable: false,
          reason: `Created automatically by /${interaction.commandName}`,
        });
      } catch (error) {
        console.error(
          '[contest_blacklist] Failed to create Contest_Blacklist role:',
          error,
        );
        await interaction.reply({
          content:
            'I could not create the Contest_Blacklist role. Please check my Manage Roles permission and role position.',
          ephemeral: true,
        });
        return;
      }
    }

    // Ensure overwrites are in place for all channels in the contest category
    try {
      const contestCategory = await guild.channels.fetch(CONTEST_CATEGORY_ID);

      if (contestCategory) {
        const reason = `Updated contest blacklist permissions by ${interaction.user.tag}`;
        const channelsInCategory = guild.channels.cache.filter(
          channel => channel.parentId === contestCategory.id,
        );

        for (const channel of channelsInCategory.values()) {
          if (channel.isTextBased && channel.isTextBased()) {
            await channel.permissionOverwrites.edit(
              role,
              {
                ViewChannel: false,
                SendMessages: false,
                SendMessagesInThreads: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
                AddReactions: false,
              },
              reason,
            );
          } else {
            await channel.permissionOverwrites.edit(
              role,
              { ViewChannel: false },
              reason,
            );
          }
        }
      }
    } catch (error) {
      console.error(
        '[contest_blacklist] Failed to apply overwrites on contest category channels:',
        error,
      );
      // Continue anyway; the role toggle is still useful even if overwrites fail
    }

    const alreadyBlacklisted = member.roles.cache.has(role.id);

    try {
      if (alreadyBlacklisted) {
        await member.roles.remove(
          role,
          `Removed from Contest_Blacklist by ${interaction.user.tag}`,
        );
        if (ephemeral) {
          await interaction.reply({
            content: `Removed ${member.user.tag} from the Contest_Blacklist. They can see and interact with contest channels again.`,
            ephemeral: true,
          });
        } else {
          const embed = new EmbedBuilder()
            .setTitle('Contest Blacklist Updated')
            .setColor(0x002b2d31)
            .addFields(
              { name: 'Action', value: 'Removed from contest blacklist', inline: false },
              { name: 'Target', value: `${member.user.tag} (<@${member.user.id}>)`, inline: false },
              { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
            )
            .setTimestamp(new Date());
          await interaction.reply({ embeds: [embed], ephemeral: false });
        }
      } else {
        await member.roles.add(
          role,
          `Added to Contest_Blacklist by ${interaction.user.tag}`,
        );
        if (ephemeral) {
          await interaction.reply({
            content:
              `Added ${member.user.tag} to the Contest_Blacklist. They can no longer see or interact with contest channels in that category.`,
            ephemeral: true,
          });
        } else {
          const embed = new EmbedBuilder()
            .setTitle('Contest Blacklist Updated')
            .setColor(0x002b2d31)
            .addFields(
              { name: 'Action', value: 'Added to contest blacklist', inline: false },
              { name: 'Target', value: `${member.user.tag} (<@${member.user.id}>)`, inline: false },
              { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
            )
            .setTimestamp(new Date());
          await interaction.reply({ embeds: [embed], ephemeral: false });
        }
      }
    } catch (error) {
      console.error(
        '[contest_blacklist] Failed to toggle Contest_Blacklist role:',
        error,
      );
      await interaction.reply({
        content:
          "There was an error while updating that user's contest blacklist status. Please check my role permissions and try again.",
        ephemeral: true,
      });
    }
  },
};
