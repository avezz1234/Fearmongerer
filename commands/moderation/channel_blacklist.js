const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageRoles,
  data: new SlashCommandBuilder()
    .setName('channel_blacklist')
    .setDescription('Toggle a (CHANNEL) Blacklist role for a user, hiding a specific channel.')
    .setDMPermission(false)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to blacklist the user from')
        .setRequired(true),
    )
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to add to or remove from the blacklist for this channel')
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

    const targetUser = interaction.options.getUser('user', true);
    const channel = interaction.options.getChannel('channel', true);

    if (!channel || channel.guildId !== guild.id) {
      await interaction.reply({
        content: 'Please choose a channel from this server.',
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

    const rawName =
      typeof channel.name === 'string' && channel.name.trim().length
        ? channel.name.trim()
        : 'Channel';
    const roleName = `${rawName} Blacklist`;

    let role = guild.roles.cache.find(r => r.name === roleName);

    if (!role) {
      try {
        role = await guild.roles.create({
          name: roleName,
          color: 0x002b2d31,
          mentionable: false,
          reason: `Created automatically by /${interaction.commandName} for #${rawName}`,
        });
      } catch (error) {
        console.error('[channel_blacklist] Failed to create blacklist role:', error);
        await interaction.reply({
          content:
            'I could not create the blacklist role. Please check my Manage Roles permission and role position.',
          ephemeral: true,
        });
        return;
      }
    }

    // Ensure channel overwrites are in place for the blacklist role so the user cannot view the channel.
    try {
      const reason = `Updated ${roleName} permissions by ${interaction.user.tag}`;

      const baseOverwrite = {
        ViewChannel: false,
      };

      let overwrite = baseOverwrite;

      if (typeof channel.isTextBased === 'function' && channel.isTextBased()) {
        overwrite = {
          ...baseOverwrite,
          SendMessages: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
          AddReactions: false,
        };
      }

      await channel.permissionOverwrites.edit(role, overwrite, reason);
    } catch (error) {
      console.error('[channel_blacklist] Failed to apply overwrites on channel:', error);
      // Continue; the role toggle is still useful even if overwrites fail.
    }

    const alreadyBlacklisted = member.roles.cache.has(role.id);

    try {
      if (alreadyBlacklisted) {
        await member.roles.remove(
          role,
          `Removed from ${roleName} by ${interaction.user.tag}`,
        );
        if (ephemeral) {
          await interaction.reply({
            content: `Removed ${member.user.tag} from **${roleName}**. They can see ${channel} again (unless other roles block it).`,
            ephemeral: true,
          });
        } else {
          const embed = new EmbedBuilder()
            .setTitle('Channel Blacklist Updated')
            .setColor(0x002b2d31)
            .addFields(
              { name: 'Action', value: 'Removed from blacklist', inline: true },
              { name: 'Target', value: `${member.user.tag} (<@${member.user.id}>)`, inline: true },
              { name: 'Channel', value: `${channel}`, inline: true },
              { name: 'Role', value: roleName, inline: false },
              { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
            )
            .setTimestamp(new Date());
          await interaction.reply({ embeds: [embed], ephemeral: false });
        }
      } else {
        await member.roles.add(
          role,
          `Added to ${roleName} by ${interaction.user.tag}`,
        );
        if (ephemeral) {
          await interaction.reply({
            content: `Added ${member.user.tag} to **${roleName}**. They can no longer view or interact with ${channel}.`,
            ephemeral: true,
          });
        } else {
          const embed = new EmbedBuilder()
            .setTitle('Channel Blacklist Updated')
            .setColor(0x002b2d31)
            .addFields(
              { name: 'Action', value: 'Added to blacklist', inline: true },
              { name: 'Target', value: `${member.user.tag} (<@${member.user.id}>)`, inline: true },
              { name: 'Channel', value: `${channel}`, inline: true },
              { name: 'Role', value: roleName, inline: false },
              { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
            )
            .setTimestamp(new Date());
          await interaction.reply({ embeds: [embed], ephemeral: false });
        }
      }
    } catch (error) {
      console.error('[channel_blacklist] Failed to toggle blacklist role:', error);
      await interaction.reply({
        content:
          "There was an error while updating that user's blacklist status for this channel. Please check my role permissions and try again.",
        ephemeral: true,
      });
    }
  },
};
