const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const crypto = require('node:crypto');

const { createSelfRolePanel } = require('../../selfrole_state');

const MAX_ROLE_PAIRS = 12; // 12 roles + 12 descriptions = 24 options (under Discord's 25 option limit)

function truncate(text, maxLen) {
  const raw = typeof text === 'string' ? text : '';
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(0, maxLen - 1))}…`;
}

function cleanDescription(input) {
  const raw = typeof input === 'string' ? input : '';
  const singleLine = raw.replaceAll(/[\r\n]+/g, ' ').trim();
  return truncate(singleLine, 200);
}

const data = new SlashCommandBuilder()
  .setName('selfrole_setup')
  .setDescription('Post a self-role dropdown panel in this channel.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

for (let i = 1; i <= MAX_ROLE_PAIRS; i += 1) {
  data.addRoleOption(option =>
    option
      .setName(`role${i}`)
      .setDescription(`Role #${i} to include`)
      .setRequired(i === 1),
  );

  data.addStringOption(option =>
    option
      .setName(`description${i}`)
      .setDescription(`Optional description for role #${i}`)
      .setRequired(false),
  );
}

module.exports = {
  data,

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

    const pairs = [];
    for (let i = 1; i <= MAX_ROLE_PAIRS; i += 1) {
      const role = interaction.options.getRole(`role${i}`, i === 1);
      if (!role) {
        continue;
      }

      if (role.id === guild.id) {
        continue; // @everyone
      }

      if (role.managed) {
        continue;
      }

      const descRaw = interaction.options.getString(`description${i}`, false);
      const desc = cleanDescription(descRaw);
      pairs.push({ role, desc: desc || null });
    }

    if (!pairs.length) {
      await interaction.reply({
        content: 'No valid roles were provided.',
        ephemeral: true,
      });
      return;
    }

    const panelId = crypto.randomUUID();

    const lines = pairs
      .map(({ role, desc }) => (desc ? `${role}-*${desc}*` : `${role}`))
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('Self Roles')
      .setColor(0x002b2d31)
      .setDescription(
        `Use the dropdown menu to manage your self roles.\n\n${truncate(lines, 3800)}`,
      );

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`selfroles/${panelId}`)
      .setPlaceholder('Choose a role to add/remove…')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        pairs.map(({ role }) => ({
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

    // Post a tiny spacer message under the panel so the dropdown is less likely to open upward over the embed.
    await interaction.followUp({
      content: '\u200b',
      allowedMentions: { parse: [] },
      ephemeral: false,
    }).catch(() => null);

    createSelfRolePanel({
      id: panelId,
      guildId: guild.id,
      channelId: interaction.channelId,
      messageId: message.id,
      roleIds: pairs.map(p => p.role.id),
      createdBy: interaction.user?.id ?? null,
      createdAt: new Date().toISOString(),
    });
  },
};
