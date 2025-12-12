const { SlashCommandBuilder } = require('discord.js');
const { clearAfk } = require('../../afk_state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unafk')
    .setDescription('Clear your AFK status and remove the [AFK] prefix from your nickname.'),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    const user = interaction.user;
    const guildId = guild.id;
    const userId = user.id;

    clearAfk(guildId, userId);

    try {
      const member = interaction.member ?? (await guild.members.fetch(userId));
      const currentName = member.nickname ?? member.user.username;

      if (currentName.startsWith('[AFK] ')) {
        const newNickname = currentName.slice('[AFK] '.length);

        if (member.manageable) {
          await member.setNickname(newNickname, 'Clear AFK status via /unafk');
        }
      }
    } catch (error) {
      console.error('[afk] Failed to clear nickname on /unafk:', error);
    }

    await interaction.reply({
      content: 'Your AFK status has been cleared.',
      ephemeral: true,
    });
  },
};
