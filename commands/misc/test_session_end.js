const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');

const testSessionState = require('../../test_session_state');
const tsState = require('../../ts_state');

const TESTER_ROLE_ID = '1447218798112538654';
const TS_AWARD_THRESHOLD_SECONDS = 5 * 60;

function formatDurationFromSeconds(totalSeconds) {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(seconds / 60);
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

function formatMemberList(lines) {
  let value = lines.join('\n');
  if (value.length <= 1024) return value;
  value = value.slice(0, 1010);
  return `${value}…`;
}

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName('test_session_end')
    .setDescription('End the active test session and report tester attendance.')
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const guild = interaction.guild;

    await interaction.deferReply({ ephemeral: false });

    const testerRole = await getTesterRole(guild);
    if (!testerRole) {
      await interaction.editReply('Tester role not found. Fix the role ID / permissions and retry.');
      return;
    }

    // Ensure role.members is fully populated.
    await guild.members.fetch().catch(() => null);

    const ended = testSessionState.endSession(guild.id, Date.now());
    if (!ended) {
      await interaction.editReply('No active test session right now.');
      return;
    }

    const participants = ended.participants && typeof ended.participants === 'object' ? ended.participants : {};
    const participantIds = new Set(Object.keys(participants));

    const testerMembers = Array.from(testerRole.members.values());

    const present = [];
    const absent = [];

    for (const member of testerMembers) {
      const entry = participants[member.id] || null;
      const totalSeconds = entry && typeof entry.totalSeconds === 'number' ? entry.totalSeconds : 0;
      if (participantIds.has(member.id) && totalSeconds > 0) {
        present.push({ member, totalSeconds });
      } else {
        absent.push(member);
      }
    }

    present.sort((a, b) => b.totalSeconds - a.totalSeconds);

    const sessionId = ended.id || null;
    const awarded = [];

    if (sessionId) {
      for (const item of present) {
        if (!item || !item.member) continue;
        if (typeof item.totalSeconds !== 'number') continue;
        if (item.totalSeconds < TS_AWARD_THRESHOLD_SECONDS) continue;

        const res = tsState.awardForSession(guild.id, item.member.id, sessionId, 1);
        if (res && res.awarded) {
          awarded.push(item.member);
        }
      }
    }

    const presentLines = present.slice(0, 25).map(item => {
      const dur = formatDurationFromSeconds(item.totalSeconds);
      return `• ${item.member.toString()} — ${dur}`;
    });

    if (present.length > 25) {
      presentLines.push(`… and ${present.length - 25} more`);
    }

    const absentLines = absent.slice(0, 25).map(member => `• ${member.toString()}`);
    if (absent.length > 25) {
      absentLines.push(`… and ${absent.length - 25} more`);
    }

    const startedAtMs = ended.announcedAt ? Date.parse(ended.announcedAt) : NaN;
    const endedAtMs = ended.endedAt ? Date.parse(ended.endedAt) : NaN;
    const startedUnix = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
    const endedUnix = Number.isFinite(endedAtMs) ? Math.floor(endedAtMs / 1000) : null;
    const plannedStartUnix = typeof ended.startAtUnix === 'number' ? ended.startAtUnix : null;

    const embed = new EmbedBuilder()
      .setTitle('Test Session Attendance')
      .setColor(0x005865f2)
      .addFields(
        { name: 'Session ID', value: ended.id || 'unknown', inline: true },
        { name: 'Channel', value: `<#${ended.channelId}>`, inline: true },
        { name: 'Duration (planned)', value: ended.durationMinutes ? `${ended.durationMinutes}m` : 'Unknown', inline: true },
        { name: 'Start time (planned)', value: plannedStartUnix ? `<t:${plannedStartUnix}:F>` : (ended.startTimeText || 'Unknown'), inline: true },
        { name: 'Announced at', value: startedUnix ? `<t:${startedUnix}:F>` : 'Unknown', inline: true },
        { name: 'Ended at', value: endedUnix ? `<t:${endedUnix}:F>` : 'Unknown', inline: true },
        { name: 'TS awarded (>= 5m)', value: awarded.length ? String(awarded.length) : '0', inline: true },
        { name: `Present (${present.length})`, value: presentLines.length ? formatMemberList(presentLines) : 'None', inline: false },
        { name: `Absent (${absent.length})`, value: absentLines.length ? formatMemberList(absentLines) : 'None', inline: false },
      )
      .setTimestamp(new Date());

    await interaction.editReply({ embeds: [embed] });
  },
};
