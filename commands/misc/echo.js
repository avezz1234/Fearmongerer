const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('echo')
    .setDescription('Echo text, attachments, or an embed publicly while confirming to you ephemerally.')
    .addStringOption(option =>
      option
        .setName('text')
        .setDescription('Text to echo publicly')
        .setRequired(false),
    )
    .addAttachmentOption(option =>
      option
        .setName('attachment')
        .setDescription('Optional image or video to echo')
        .setRequired(false),
    )
    .addBooleanOption(option =>
      option
        .setName('embed')
        .setDescription('If true, send the text (and image, if provided) as an embed')
        .setRequired(false),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const text = interaction.options.getString('text') ?? '';
    const attachment = interaction.options.getAttachment('attachment') ?? null;
    const asEmbed = interaction.options.getBoolean('embed') ?? false;

    if (!text && !attachment) {
      await interaction.reply({
        content: 'You must provide text or an attachment to echo.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: 'Your message has been echoed publicly.',
      ephemeral: true,
    });

    const channel = interaction.channel;
    if (!channel) {
      return;
    }

    const files = [];
    if (attachment) {
      files.push(attachment);
    }

    if (asEmbed) {
      const embed = new EmbedBuilder()
        .setDescription(text || '(no text content)')
        .setColor(0x5865f2);

      if (attachment && attachment.contentType && attachment.name) {
        const contentType = attachment.contentType;
        if (typeof contentType === 'string' && contentType.startsWith('image/')) {
          embed.setImage(`attachment://${attachment.name}`);
        }
      }

      await channel.send({
        embeds: [embed],
        files: files.length ? files : undefined,
      });
      return;
    }

    const content = text || null;

    await channel.send({
      content,
      files: files.length ? files : undefined,
    });
  },
};
