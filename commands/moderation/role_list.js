const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const IMPORTANT_PERMISSIONS = [
  { flag: PermissionFlagsBits.Administrator, label: 'Administrator' },
  { flag: PermissionFlagsBits.ManageGuild, label: 'Manage Guild' },
  { flag: PermissionFlagsBits.ManageRoles, label: 'Manage Roles' },
  { flag: PermissionFlagsBits.ManageChannels, label: 'Manage Channels' },
  { flag: PermissionFlagsBits.ModerateMembers, label: 'Timeout / Moderate Members' },
  { flag: PermissionFlagsBits.ManageMessages, label: 'Manage Messages' },
  { flag: PermissionFlagsBits.BanMembers, label: 'Ban Members' },
  { flag: PermissionFlagsBits.KickMembers, label: 'Kick Members' },
  { flag: PermissionFlagsBits.ViewAuditLog, label: 'View Audit Log' },
  { flag: PermissionFlagsBits.MentionEveryone, label: 'Mention @everyone/@here' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role_list')
    .setDescription('List all roles in this server and summarize their important permissions.')
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const roles = await guild.roles.fetch();

    const sorted = roles
      .filter(role => role && role.id !== guild.id)
      .sort((a, b) => b.position - a.position);

    if (!sorted.size) {
      await interaction.editReply('No roles found in this server (other than @everyone).');
      return;
    }

    const lines = [];

    for (const role of sorted.values()) {
      const perms = role.permissions;
      const labels = [];

      for (const { flag, label } of IMPORTANT_PERMISSIONS) {
        if (perms.has(flag)) {
          labels.push(label);
        }
      }

      const summary = labels.length ? labels.join(', ') : 'No key permissions (member-only role).';

      lines.push(`${role.toString()} — ${summary}`);
    }

    const chunks = [];
    let current = '';

    for (const line of lines) {
      const lineWithNl = `${line}\n`;
      if ((current + lineWithNl).length > 900) {
        chunks.push(current.trimEnd());
        current = '';
      }
      current += lineWithNl;
    }

    if (current.trim().length) {
      chunks.push(current.trimEnd());
    }

    const embed = new EmbedBuilder()
      .setTitle(`Roles in ${guild.name}`)
      .setColor(0x5865f2)
      .setDescription('Each role is listed with a summary of key permissions (not every single Discord permission bit).')
      .setTimestamp();

    if (chunks.length === 1) {
      embed.addFields({
        name: 'Roles',
        value: chunks[0],
        inline: false,
      });
    } else {
      chunks.forEach((chunk, index) => {
        embed.addFields({
          name: `Roles (part ${index + 1})`,
          value: chunk,
          inline: false,
        });
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
