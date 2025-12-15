const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const tsState = require('../../ts_state');

function clampInt(value, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give_ts')
    .setDescription('Give TS to a user (admin only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to give TS to')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('How much TS to give')
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Admins only.', ephemeral: true });
      return;
    }

    const user = interaction.options.getUser('user', true);
    const amountRaw = interaction.options.getInteger('amount', true);
    const amount = clampInt(amountRaw, { min: 1, max: 1_000_000 });

    if (!amount) {
      await interaction.reply({ content: 'Bad `amount`. Use an integer between 1 and 1000000.', ephemeral: true });
      return;
    }

    const nextTs = tsState.addTs(interaction.guild.id, user.id, amount, { min: 0 });
    if (nextTs == null) {
      await interaction.reply({ content: 'Failed to update TS (unexpected).', ephemeral: true });
      return;
    }

    await interaction.reply({
      content: `✅ Gave **${amount} TS** to ${user}. New total: **${nextTs} TS**.`,
      ephemeral: true,
    });
  },
};
