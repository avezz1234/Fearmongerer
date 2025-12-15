const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');

const testSessionState = require('../../test_session_state');
const { TEST_SESSION_TIMEZONE } = require('../../constants');

const TESTER_ROLE_ID = '1447218798112538654';

function isValidIanaTimeZone(timeZone) {
  if (!timeZone) return false;
  try {
    // Throws RangeError for invalid zones.
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getZonedDateParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = dtf.formatToParts(date);
  const out = {};
  for (const p of parts) {
    if (p.type === 'year') out.year = Number(p.value);
    if (p.type === 'month') out.month = Number(p.value);
    if (p.type === 'day') out.day = Number(p.value);
    if (p.type === 'hour') out.hour = Number(p.value);
    if (p.type === 'minute') out.minute = Number(p.value);
    if (p.type === 'second') out.second = Number(p.value);
  }

  return out;
}

function getTimeZoneOffsetMs(utcMs, timeZone) {
  const zoned = getZonedDateParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(
    zoned.year,
    (zoned.month || 1) - 1,
    zoned.day || 1,
    zoned.hour || 0,
    zoned.minute || 0,
    zoned.second || 0,
  );
  return asUtc - utcMs;
}

function utcMsFromZonedLocal(y, m, d, hour24, minute, timeZone) {
  const localAsUtc = Date.UTC(y, m - 1, d, hour24, minute, 0, 0);

  // Fixed-point iteration (handles DST transitions in most cases).
  let utcMs = localAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const offsetMs = getTimeZoneOffsetMs(utcMs, timeZone);
    utcMs = localAsUtc - offsetMs;
  }

  return utcMs;
}

function computeNextStartUnixInTimeZone(spec, nowMs, timeZone) {
  if (!spec) return null;
  const hour24 = spec.hour24;
  const minute = spec.minute;
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return null;
  if (!isValidIanaTimeZone(timeZone)) return null;

  const nowZoned = getZonedDateParts(new Date(nowMs), timeZone);
  if (!nowZoned.year || !nowZoned.month || !nowZoned.day) return null;

  const todayUtcMs = utcMsFromZonedLocal(
    nowZoned.year,
    nowZoned.month,
    nowZoned.day,
    hour24,
    minute,
    timeZone,
  );

  let candidateUtcMs = todayUtcMs;
  if (candidateUtcMs < nowMs) {
    // Add one calendar day.
    const tomorrow = new Date(Date.UTC(nowZoned.year, nowZoned.month - 1, nowZoned.day) + 24 * 60 * 60 * 1000);
    candidateUtcMs = utcMsFromZonedLocal(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
      hour24,
      minute,
      timeZone,
    );
  }

  return Math.floor(candidateUtcMs / 1000);
}

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

    const timeZone = String(TEST_SESSION_TIMEZONE || '').trim();
    if (!isValidIanaTimeZone(timeZone)) {
      await interaction.reply({
        content: 'Misconfigured test session timezone. Set `TEST_SESSION_TIMEZONE` in constants.js to a valid IANA timezone (example: `America/New_York`).',
        ephemeral: true,
      });
      return;
    }

    const startTimeSpec = parseStartTimeSpec(startTimeRaw);
    if (!startTimeSpec) {
      await interaction.reply({
        content: 'Bad `start_time`. Use like `7 pm` or `7:30 pm` (am/pm required).',
        ephemeral: true,
      });
      return;
    }

    const startTimeText = startTimeSpec.displayText;

    let startAtUnix = null;
    try {
      startAtUnix = computeNextStartUnixInTimeZone(startTimeSpec, Date.now(), timeZone);
    } catch (error) {
      console.error('[test-session] Failed to compute start time in configured timezone; falling back to host-local time:', error);
      startAtUnix = null;
    }

    // Fallback path (should never throw) so the command cannot crash the bot.
    if (!startAtUnix) {
      startAtUnix = computeNextStartUnix(startTimeSpec, Date.now());
    }

    if (!startAtUnix) {
      await interaction.reply({
        content: 'Could not compute a planned start timestamp from `start_time`. Please retry.',
        ephemeral: true,
      });
      return;
    }

    const startTimeValue = `<t:${startAtUnix}:F>\n(<t:${startAtUnix}:R>)`;

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
      .setColor(0x002ecc71)
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
