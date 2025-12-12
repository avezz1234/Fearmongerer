const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const TICKET_BLACKLIST_ROLE_NAME = 'Ticket Blacklist';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket_blacklist')
    .setDescription('Toggle the ticket blacklist role for a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to add to or remove from the ticket blacklist.')
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
      r => r.name === TICKET_BLACKLIST_ROLE_NAME,
    );

    if (!role) {
      try {
        role = await guild.roles.create({
          name: TICKET_BLACKLIST_ROLE_NAME,
          color: 0x2b2d31,
          mentionable: false,
          reason: `Created automatically by /${interaction.commandName}`,
        });
      } catch (error) {
        console.error('[blacklist] Failed to create ticket blacklist role:', error);
        await interaction.reply({
          content:
            'I could not create the ticket blacklist role. Please check my Manage Roles permission and role position.',
          ephemeral: true,
        });
        return;
      }
    }

    const alreadyBlacklisted = member.roles.cache.has(role.id);

    try {
      if (alreadyBlacklisted) {
        await member.roles.remove(
          role,
          `Removed from ticket blacklist by ${interaction.user.tag}`,
        );
        await interaction.reply({
          content: `Removed ${member.user.tag} from the ticket blacklist. They can use the bot again.`,
          ephemeral: true,
        });
      } else {
        await member.roles.add(
          role,
          `Added to ticket blacklist by ${interaction.user.tag}`,
        );
        await interaction.reply({
          content: `Added ${member.user.tag} to the ticket blacklist. They can no longer use the ticket system.`,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error('[blacklist] Failed to toggle ticket blacklist role:', error);
      await interaction.reply({
        content:
          "There was an error while updating that user's ticket blacklist status. Please check my role permissions and try again.",
        ephemeral: true,
      });
    }
  },
};
