const { SlashCommandBuilder } = require('discord.js');
const { setAfk } = require('../../afk_state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set your AFK status with a reason.')
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason you are AFK')
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const reasonRaw = interaction.options.getString('reason', true);
    const reason = reasonRaw.trim();

    const guild = interaction.guild;
    const user = interaction.user;
    const guildId = guild.id;
    const userId = user.id;

    let nicknameNote = '';
    try {
      const member = interaction.member ?? (await guild.members.fetch(userId));
      const currentName = member.nickname ?? member.user.username;
      const hasPrefix = currentName.startsWith('[AFK] ');

      if (!hasPrefix) {
        const newNickname = `[AFK] ${currentName}`;

        if (member.manageable) {
          await member.setNickname(newNickname, 'Set AFK status via /afk');
        } else {
          nicknameNote =
            ' (I could not update your nickname because I lack permission.)';
        }
      }
    } catch (error) {
      console.error('[afk] Failed to update nickname:', error);
      nicknameNote =
        ' (I could not update your nickname due to a permission or hierarchy issue.)';
    }

    setAfk(guildId, userId, {
      reason,
    });

    const message = reason
      ? `You are now marked as AFK: ${reason}${nicknameNote}`
      : `You are now marked as AFK.${nicknameNote}`;

    await interaction.reply({
      content: message,
      ephemeral: true,
    });
  },
};
