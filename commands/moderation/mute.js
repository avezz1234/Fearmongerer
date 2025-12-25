const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  requiredPermissions: PermissionFlagsBits.ModerateMembers,
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout a member for a period and DM them the reason.')
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('Member to mute (timeout)')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('Duration in minutes (default 10, max 40320 ≈ 28 days)')
        .setMinValue(1)
        .setMaxValue(40320),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the mute')
        .setRequired(false),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target', true);
    const minutes = interaction.options.getInteger('minutes') ?? 10;
    const reason = interaction.options.getString('reason') ?? 'No reason provided.';

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({
        content: 'You do not have permission to use this command. (Moderate Members required.)',
        ephemeral: true,
      });
      return;
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      await interaction.reply({ content: 'I could not find that member in this server.', ephemeral: true });
      return;
    }

    if (!member.moderatable) {
      await interaction.reply({ content: 'I cannot mute that member (insufficient permissions or higher role).', ephemeral: true });
      return;
    }

    const clampedMinutes = Math.min(Math.max(minutes, 1), 40320);
    const now = Date.now();
    const durationMs = clampedMinutes * 60_000;
    const expiresAt = now + durationMs;
    const expiresAtUnix = Math.floor(expiresAt / 1000);

    await interaction.deferReply({ ephemeral });

    try {
      try {
        const embed = new EmbedBuilder()
          .setTitle(`You have been muted in ${interaction.guild.name}`)
          .setColor(0x00ffcc00)
          .setDescription(reason)
          .addFields(
            { name: 'Duration', value: `${clampedMinutes} minute(s)`, inline: true },
            { name: 'Expires', value: `<t:${expiresAtUnix}:F> (<t:${expiresAtUnix}:R>)`, inline: true },
          )
          .setTimestamp();

        await targetUser.send({ embeds: [embed] });
      } catch {
      }

      await member.timeout(durationMs, `${reason} | Muted by ${interaction.user.tag}`);

      if (ephemeral) {
        await interaction.editReply(
          `✅ Muted **${targetUser.tag}** for ${clampedMinutes} minute(s). Expires <t:${expiresAtUnix}:F> (<t:${expiresAtUnix}:R>). Reason: ${reason}`,
        );
      } else {
        const publicEmbed = new EmbedBuilder()
          .setTitle('Member Timed Out')
          .setColor(0x00f1c40f)
          .addFields(
            { name: 'Target', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
            { name: 'Duration', value: `${clampedMinutes} minute(s)`, inline: true },
            { name: 'Expires', value: `<t:${expiresAtUnix}:F> (<t:${expiresAtUnix}:R>)`, inline: true },
            { name: 'Reason', value: reason, inline: false },
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [publicEmbed] });
      }
    } catch (error) {
      console.error('Error executing /mute:', error);
      await interaction.editReply('There was an error while trying to mute that member.');
    }
  },
};
