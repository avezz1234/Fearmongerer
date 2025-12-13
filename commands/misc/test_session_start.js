const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');

const testSessionState = require('../../test_session_state');

const TESTER_ROLE_ID = '1447218798112538654';

function parseStartTimeSpec(raw) {
  const input = String(raw || '').trim();
  const m = input.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) {
    return null;
  }

  const hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3].toLowerCase();

  if (!Number.isFinite(hour) || hour < 1 || hour > 12) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  if (meridiem !== 'am' && meridiem !== 'pm') return null;

  const hourText = String(hour);
  const minuteText = String(minute).padStart(2, '0');
  const suffix = meridiem.toUpperCase();
  const displayText = minute === 0 ? `${hourText} ${suffix}` : `${hourText}:${minuteText} ${suffix}`;

  const baseHour = hour % 12;
  const hour24 = meridiem === 'pm' ? baseHour + 12 : baseHour;

  return { hour24, minute, displayText };
}

function computeNextStartUnix(spec, nowMs) {
  if (!spec) return null;
  const hour24 = spec.hour24;
  const minute = spec.minute;
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return null;

  const scheduled = new Date(nowMs);
  scheduled.setHours(hour24, minute, 0, 0);

  if (scheduled.getTime() < nowMs) {
    scheduled.setDate(scheduled.getDate() + 1);
  }

  return Math.floor(scheduled.getTime() / 1000);
}

function parseDurationMinutes(raw) {
  const input = String(raw || '').trim().toLowerCase();
  if (!input) return null;

  // Accept: "90" (minutes), "90m", "2h", "1h30m"
  if (/^\d+$/.test(input)) {
    const mins = Number(input);
    return Number.isFinite(mins) && mins > 0 ? mins : null;
  }

  const m = input.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  if (!m) return null;

  const h = m[1] ? Number(m[1]) : 0;
  const mins = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(mins)) return null;

  const total = h * 60 + mins;
  return total > 0 ? total : null;
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Unknown';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

async function getTesterRole(guild) {
  if (!guild) return null;
  const cached = guild.roles.cache.get(TESTER_ROLE_ID);
  if (cached) return cached;
  const fetched = await guild.roles.fetch(TESTER_ROLE_ID).catch(() => null);
  return fetched || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test_session_start')
    .setDescription('Announce a test session and track tester attendance in a voice channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Voice/stage channel testers should join')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
    )
    .addStringOption(option =>
      option
        .setName('start_time')
        .setDescription('Example: 7 pm, 7:30 pm')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription('Example: 90m, 2h, 1h30m')
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    const sessionChannel = interaction.options.getChannel('channel', true);
    const startTimeRaw = interaction.options.getString('start_time', true);
    const durationRaw = interaction.options.getString('duration', true);

    const startTimeSpec = parseStartTimeSpec(startTimeRaw);
    if (!startTimeSpec) {
      await interaction.reply({
        content: 'Bad `start_time`. Use like `7 pm` or `7:30 pm` (am/pm required).',
        ephemeral: true,
      });
      return;
    }

    const startTimeText = startTimeSpec.displayText;
    const startAtUnix = computeNextStartUnix(startTimeSpec, Date.now());
    const startTimeValue = startAtUnix
      ? `<t:${startAtUnix}:F>\n(<t:${startAtUnix}:R>)`
      : startTimeText;

    const durationMinutes = parseDurationMinutes(durationRaw);
    if (!durationMinutes) {
      await interaction.reply({
        content: 'Bad `duration`. Use `90m`, `2h`, `1h30m`, or just minutes like `90`.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const testerRole = await getTesterRole(guild);
    if (!testerRole) {
      await interaction.editReply(
        'Tester role not found. Fix the role ID / permissions and retry.',
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Test Session')
      .setColor(0x2ecc71)
      .setDescription('A test session has been scheduled. Please join the channel at the start time.')
      .addFields(
        { name: 'Start time', value: startTimeValue, inline: true },
        { name: 'Duration', value: formatDuration(durationMinutes), inline: true },
        { name: 'Channel', value: sessionChannel.toString(), inline: false },
      )
      .setTimestamp(new Date());

    const announceChannel = interaction.channel;
    if (!announceChannel || !announceChannel.isTextBased()) {
      await interaction.editReply("Can't post the announcement here.");
      return;
    }

    const sent = await announceChannel.send({
      content: `<@&${testerRole.id}>`,
      embeds: [embed],
    });

    const session = testSessionState.startSession({
      guildId: guild.id,
      channelId: sessionChannel.id,
      startTimeText,
      startAtUnix,
      durationMinutes,
      announcedBy: interaction.user.id,
      announcementChannelId: announceChannel.id,
      announcementMessageId: sent.id,
    });

    // Snapshot current attendance so we don't miss anyone already in the channel.
    try {
      const presentIds = sessionChannel && sessionChannel.members
        ? Array.from(sessionChannel.members.keys())
        : [];
      testSessionState.syncAttendance(guild.id, presentIds, Date.now());
    } catch {
      // ignore snapshot failures
    }

    await interaction.editReply(
      `✅ Started test session **${session.id}**. Tracking attendance in ${sessionChannel} and posted announcement in ${announceChannel}.`,
    );
  },
};
