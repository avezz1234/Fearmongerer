const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const crypto = require('node:crypto');

const { createSelfRolePanel } = require('../../selfrole_state');

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseRoleIds(input) {
  const raw = typeof input === 'string' ? input : '';
  const matches = [];

  // Supports: <@&ROLE_ID> mentions, or bare numeric IDs.
  const re = /<@&(\d{5,})>|\b(\d{5,})\b/g;
  for (const match of raw.matchAll(re)) {
    const id = match[1] || match[2];
    if (id) matches.push(id);
  }

  return uniqueStrings(matches);
}

function truncate(text, maxLen) {
  const raw = typeof text === 'string' ? text : '';
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(0, maxLen - 1))}…`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('selfrole_setup')
    .setDescription('Post a self-role dropdown panel in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('roles')
        .setDescription('Role mentions/IDs to include (e.g. "<@&123> <@&456>")')
        .setRequired(true),
    ),

  async execute(interaction) {
    const channel = interaction.channel;

    if (!interaction.guild || !channel || !channel.isTextBased()) {
      await interaction.reply({
        content: 'This command can only be used in a server text channel.',
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    const raw = interaction.options.getString('roles', true);
    const parsedRoleIds = parseRoleIds(raw);

    if (!parsedRoleIds.length) {
      await interaction.reply({
        content: 'No roles were found. Provide role mentions like `<@&ROLE_ID>` or raw role IDs.',
        ephemeral: true,
      });
      return;
    }

    const roleIds = parsedRoleIds.slice(0, 25);
    const resolved = [];

    for (const id of roleIds) {
      if (id === guild.id) {
        // @everyone
        continue;
      }

      let role = guild.roles.cache.get(id) || null;
      if (!role) {
        role = await guild.roles.fetch(id).catch(() => null);
      }
      if (!role) {
        continue;
      }

      if (role.managed) {
        continue;
      }

      resolved.push(role);
    }

    if (!resolved.length) {
      await interaction.reply({
        content: 'None of the provided roles were valid/assignable by the bot.',
        ephemeral: true,
      });
      return;
    }

    const panelId = crypto.randomUUID();
    const displayRoles = resolved.slice(0, 25);

    const lines = displayRoles
      .map(role => `• ${role}`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('Role Info')
      .setColor(0x002b2d31)
      .setDescription(
        `Select a role from the menu below to **toggle** it on your account.\n\n${truncate(lines, 3800)}`,
      );

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`selfroles/${panelId}`)
      .setPlaceholder('Select Roles Here!')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        displayRoles.map(role => ({
          label: truncate(role.name, 100) || 'Role',
          value: role.id,
        })),
      );

    const row = new ActionRowBuilder().addComponents(menu);

    const message = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
      ephemeral: false,
    });

    createSelfRolePanel({
      id: panelId,
      guildId: guild.id,
      channelId: interaction.channelId,
      messageId: message.id,
      roleIds: displayRoles.map(r => r.id),
      createdBy: interaction.user?.id ?? null,
      createdAt: new Date().toISOString(),
    });
  },
};
