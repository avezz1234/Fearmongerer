const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const crypto = require('node:crypto');

const anonPollState = require('../../anom_poll_state');
const { buildAnonPollEmbed, buildAnonPollComponents } = require('../../anom_poll_lib');

function clampInt(value, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}

const data = new SlashCommandBuilder()
  .setName('anom_poll')
  .setDescription('Create an anonymous (hidden) poll with buttons and optional auto-close timer.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addStringOption(option =>
    option
      .setName('question')
      .setDescription('Question to ask')
      .setRequired(true),
  );

for (let i = 1; i <= 10; i += 1) {
  data.addStringOption(option =>
    option
      .setName(`option${i}`)
      .setDescription(`Option ${i}`)
      .setRequired(i === 1),
  );
}

// Optional config options MUST come after required options.
data.addStringOption(option =>
  option
    .setName('title')
    .setDescription('Embed title for the poll (optional)')
    .setRequired(false),
);

data.addIntegerOption(option =>
  option
    .setName('amount_of_buttons')
    .setDescription('How many choice buttons to use (1-10). Defaults to # of provided options.')
    .setRequired(false),
);

data.addIntegerOption(option =>
  option
    .setName('timer')
    .setDescription('Auto-close after N minutes (optional)')
    .setRequired(false),
);

module.exports = {
  data,

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const guildId = interaction.guild.id;
    const channelId = interaction.channelId;

    const question = interaction.options.getString('question', true).trim();
    const titleRaw = interaction.options.getString('title', false);
    const title = typeof titleRaw === 'string' && titleRaw.trim().length
      ? titleRaw.trim().slice(0, 256)
      : null;

    const options = [];
    for (let i = 1; i <= 10; i += 1) {
      const value = interaction.options.getString(`option${i}`);
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          options.push(trimmed);
        }
      }
    }

    if (!options.length) {
      await interaction.reply({ content: 'You must provide at least one non-empty option.', ephemeral: true });
      return;
    }

    const buttonsRaw = interaction.options.getInteger('amount_of_buttons', false);
    const timerRaw = interaction.options.getInteger('timer', false);

    const desiredButtons = buttonsRaw == null
      ? options.length
      : (clampInt(buttonsRaw, { min: 1, max: 10 }) ?? null);

    if (!desiredButtons) {
      await interaction.reply({ content: 'Bad `amount_of_buttons`. Use an integer between 1 and 10.', ephemeral: true });
      return;
    }

    if (desiredButtons > options.length) {
      await interaction.reply({ content: `You requested ${desiredButtons} buttons but only provided ${options.length} option(s).`, ephemeral: true });
      return;
    }

    options.length = desiredButtons;

    const timerMinutes = timerRaw == null
      ? null
      : (clampInt(timerRaw, { min: 1, max: 24 * 60 }) ?? null);

    if (timerRaw != null && !timerMinutes) {
      await interaction.reply({ content: 'Bad `timer`. Use minutes between 1 and 1440.', ephemeral: true });
      return;
    }

    const pollId = crypto.randomUUID();
    const closesAtMs = timerMinutes ? Date.now() + timerMinutes * 60 * 1000 : null;

    const draftPoll = {
      id: pollId,
      guildId,
      channelId,
      messageId: 'pending',
      ownerId: interaction.user.id,
      title,
      question,
      options,
      votes: {},
      createdAt: new Date().toISOString(),
      closesAtMs,
      closed: false,
      closedAt: null,
      closedBy: null,
    };

    const embed = buildAnonPollEmbed(draftPoll);
    const components = buildAnonPollComponents(draftPoll);

    const message = await interaction.reply({
      embeds: [embed],
      components,
      fetchReply: true,
    });

    anonPollState.createAnonPoll({
      pollId,
      guildId,
      channelId,
      messageId: message.id,
      ownerId: interaction.user.id,
      title,
      question,
      options,
      closesAtMs,
    });
  },
};
