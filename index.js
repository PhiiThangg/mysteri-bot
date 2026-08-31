require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  MessageFlags,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AuditLogEvent,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const chokidar = require("chokidar");
const { Octokit } = require("@octokit/rest");

const TOKEN = process.env.TOKEN;
const prefix = (process.env.prefix || "h").replace(/^!/, "").trim() || "h";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});

//autores: file dữ liệu + thư mục ảnh cho tính năng AutoRes (chuyển từ index.js)
const AUTORES_FILE = path.join(__dirname, "..", "data", "autores.json");
const IMAGE_DIR = path.join(__dirname, "..", "data", "images");

// railway
const DATA_DIR = path.join(__dirname, "..", "data");
const GITHUB_SYNC_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_SYNC_DELAY = 2 * 60 * 1000;
const githubClient = process.env.GITHUB_TOKEN
  ? new Octokit({ auth: process.env.GITHUB_TOKEN })
  : null;
let githubSyncTimer = null;
let githubSyncPending = false;
let githubSyncRunning = false;

function queueGitHubSync() {
  githubSyncPending = true;
  if (githubSyncTimer) clearTimeout(githubSyncTimer);
  console.log("[GitHub Sync] Có thay đổi data -> reset timer 2 phút.");
  githubSyncTimer = setTimeout(() => {
    githubSyncTimer = null;
    runGitHubDataSync().catch(error => {
      console.error("[GitHub Sync]", error?.response?.data || error?.message || error);
    });
  }, GITHUB_SYNC_DELAY);
}

function getGitHubDataPath(filePath) {
  const relativePath = path.relative(DATA_DIR, filePath).split(path.sep).join("/");
  return `data/${relativePath}`;
}

async function runGitHubDataSync() {
  if (!githubClient || !githubSyncPending || githubSyncRunning) return;
  githubSyncPending = false;
  githubSyncRunning = true;
  try {
    if (!process.env.GITHUB_OWNER || !process.env.GITHUB_REPO) {
      console.error("[GitHub Sync] Thiếu GITHUB_OWNER hoặc GITHUB_REPO.");
      return;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const ref = await githubClient.git.getRef({ owner, repo, ref: `heads/${GITHUB_SYNC_BRANCH}` });
    const baseCommitSha = ref.data.object.sha;
    const baseCommit = await githubClient.git.getCommit({ owner, repo, commit_sha: baseCommitSha });
    const treeResult = await githubClient.git.getTree({
      owner, repo, tree_sha: baseCommit.data.tree.sha, recursive: true,
    });

    const localFiles = new Map();
    const walk = dir => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) localFiles.set(getGitHubDataPath(full), full);
      }
    };
    walk(DATA_DIR);

    const existingDataPaths = new Set((treeResult.data.tree || [])
      .filter(item => item.type === "blob" && item.path.startsWith("data/"))
      .map(item => item.path));

    const tree = [];
    for (const [githubPath, filePath] of localFiles) {
      const blob = await githubClient.git.createBlob({
        owner, repo,
        content: fs.readFileSync(filePath).toString("base64"),
        encoding: "base64",
      });
      tree.push({ path: githubPath, mode: "100644", type: "blob", sha: blob.data.sha });
    }
    for (const githubPath of existingDataPaths) {
      if (!localFiles.has(githubPath)) {
        tree.push({ path: githubPath, mode: "100644", type: "blob", sha: null });
      }
    }
    if (!tree.length) {
      console.log("[GitHub Sync] Không có file data để sync.");
      return;
    }

    const newTree = await githubClient.git.createTree({
      owner, repo, base_tree: baseCommit.data.tree.sha, tree,
    });
    if (newTree.data.sha === baseCommit.data.tree.sha) {
      console.log("[GitHub Sync] Không có thay đổi thực tế để commit.");
      return;
    }

    const commit = await githubClient.git.createCommit({
      owner, repo,
      message: "Auto sync data (debounced 2m)",
      tree: newTree.data.sha,
      parents: [baseCommitSha],
    });
    await githubClient.git.updateRef({
      owner, repo, ref: `heads/${GITHUB_SYNC_BRANCH}`, sha: commit.data.sha, force: false,
    });
    console.log(`[GitHub Sync] Đã commit ${commit.data.sha} sau 2 phút hệ thống yên.`);
  } finally {
    githubSyncRunning = false;
    if (githubSyncPending && !githubSyncTimer) queueGitHubSync();
  }
}

function startGitHubDataWatcher() {
  if (!githubClient) {
    console.log("[GitHub Sync] GITHUB_TOKEN chưa được cấu hình, bỏ qua auto sync.");
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  chokidar.watch(DATA_DIR, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
  })
    .on("add", () => queueGitHubSync())
    .on("change", () => queueGitHubSync())
    .on("unlink", () => queueGitHubSync());
  console.log("[GitHub Sync] Theo dõi data/. Commit sau 2 phút kể từ lần thay đổi cuối.");
}

startGitHubDataWatcher();

// ================== //autores: TÍNH NĂNG AUTORES ==================
// Bot tự động trả lời khi có người gõ đúng trigger đã cấu hình theo từng server.
// Toàn bộ khối bên dưới thuộc tính năng AutoRes.

//autores: ghi file JSON bất đồng bộ, không chặn event loop (atomic write)
const pendingJsonWrites = new Map();
function writeJsonAsync(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const previous = pendingJsonWrites.get(filePath) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => fs.promises.mkdir(path.dirname(filePath), { recursive: true }))
    .then(() => fs.promises.writeFile(tmpPath, json, "utf8"))
    .then(() => fs.promises.rename(tmpPath, filePath))
    .catch(error => console.error(`[writeJsonAsync] Ghi ${filePath} thất bại:`, error.message || error));
  pendingJsonWrites.set(filePath, next);
  next.finally(() => {
    if (pendingJsonWrites.get(filePath) === next) pendingJsonWrites.delete(filePath);
  });
  return next;
}

//autores: quyền AutoRes
function hasAutoResManagerRole(context) {
  const guild = context?.guild || context?.member?.guild;
  const member = context?.member;
  if (!guild || !member) return false;
  return Boolean(
    member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

//autores: ảnh đính kèm/tên file dùng chung
function isImageAttachment(a) {
  if (a.contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(a.name || "");
}

function getAttachments(message) {
  return [...message.attachments.values()].filter(isImageAttachment);
}

function safeFileName(name) {
  return String(name || "autores")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60);
}

function localImagePath(value) {
  if (!value || !value.startsWith("local:")) return null;
  return path.join(IMAGE_DIR, path.basename(value.slice(6)));
}

function extensionFromAttachment(attachment) {
  const ext = path.extname(attachment.name || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return ext;
  const type = attachment.contentType || "";
  if (type.includes("png")) return ".png";
  if (type.includes("jpeg")) return ".jpg";
  if (type.includes("gif")) return ".gif";
  if (type.includes("webp")) return ".webp";
  return ".png";
}

function removeLocalImage(value) {
  const filePath = localImagePath(value);
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

function normalizeProfileColor(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const text = value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(text)) return parseInt(text, 16);
  }
  return 0x5865f2;
}

//autores: đọc/ghi dữ liệu autores.json + tự đồng bộ khi file bị thay đổi từ tiến trình khác
function loadAutoRes() {
  try {
    const data = JSON.parse(fs.readFileSync(AUTORES_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveAutoRes(data) {
  writeJsonAsync(AUTORES_FILE, data);
}

let autoRes = loadAutoRes();

fs.watchFile(AUTORES_FILE, { interval: 2000 }, () => {
  const fresh = loadAutoRes();
  if (fresh && typeof fresh === "object") autoRes = fresh;
});

//autores: các hàm lõi thao tác trigger
function normalizeTrigger(value) {
  return String(value || "").trim().toLowerCase();
}

function getGuildAutoRes(guildId) {
  if (!autoRes[guildId] || typeof autoRes[guildId] !== "object") autoRes[guildId] = {};
  return autoRes[guildId];
}

function findAutoRes(guildId, trigger) {
  const key = normalizeTrigger(trigger);
  if (!key) return null;
  return getGuildAutoRes(guildId)[key] || null;
}

function normalizeAutoResRecord(record) {
  record.type = record.type === "embed" ? "embed" : "text";
  record.mode = record.mode === "contains" ? "contains" : "exact";
  record.enabled = record.enabled !== false;
  record.content = String(record.content || "");
  if (!record.embed || typeof record.embed !== "object") record.embed = {};
  record.embed.title = String(record.embed.title || "");
  record.embed.description = String(record.embed.description || "");
  record.embed.color = normalizeProfileColor(record.embed.color);
  record.embed.thumbnail = String(record.embed.thumbnail || "");
  record.embed.image = String(record.embed.image || "");
  record.embed.footer = String(record.embed.footer || "");
  return record;
}

function safeAutoResFileName(trigger, type, attachment) {
  const ext = extensionFromAttachment(attachment);
  return `${safeFileName(trigger)}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
}

async function saveAutoResAttachment(trigger, type, attachment) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const fileName = safeAutoResFileName(trigger, type, attachment);
  const filePath = path.join(IMAGE_DIR, fileName);
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Download ảnh thất bại: HTTP ${response.status}`);
  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
  return `local:${fileName}`;
}

function buildAutoResEmbed(record, attachmentNames = {}) {
  const e = record.embed || {};
  const embed = new EmbedBuilder().setColor(e.color || 0x5865f2);
  if (e.title) embed.setTitle(e.title);
  if (e.description) embed.setDescription(e.description);
  if (e.footer) embed.setFooter({ text: e.footer });
  if (e.thumbnail) embed.setThumbnail(attachmentNames.thumbnail ? `attachment://${attachmentNames.thumbnail}` : e.thumbnail);
  if (e.image) embed.setImage(attachmentNames.image ? `attachment://${attachmentNames.image}` : e.image);
  return embed;
}

function autoResFiles(record) {
  const files = [];
  const names = {};
  for (const [key, value] of [["thumbnail", record.embed.thumbnail], ["image", record.embed.image]]) {
    const filePath = localImagePath(value);
    if (filePath && fs.existsSync(filePath)) {
      const name = path.basename(filePath);
      files.push(new AttachmentBuilder(filePath).setName(name));
      names[key] = name;
    }
  }
  return { files, names };
}

function autoResPayload(record) {
  const media = record.type === "embed" ? autoResFiles(record) : { files: [], names: {} };
  const payload = {};
  if (record.content) payload.content = record.content;
  if (record.type === "embed") {
    payload.embeds = [buildAutoResEmbed(record, media.names)];
    payload.files = media.files;
  }
  return payload;
}

function findMatchingAutoRes(guildId, content) {
  const text = normalizeTrigger(content);
  if (!text) return null;

  const entries = Object.values(getGuildAutoRes(guildId));
  for (const rawRecord of entries) {
    const record = normalizeAutoResRecord(rawRecord);
    if (!record.enabled) continue;

    const trigger = normalizeTrigger(record.trigger);
    if (!trigger) continue;

    // Text AutoRes bắt buộc phải có nội dung; Embed có thể chỉ dùng embed.
    if (record.type === "text" && !String(record.content || "").trim()) continue;

    if (record.mode === "contains" ? text.includes(trigger) : text === trigger) {
      return record;
    }
  }
  return null;
}

//autores help
function autoResHelp(message) {
    return new EmbedBuilder()
        .setColor("#481f86")
        .setDescription([
            "# <a:helukiti:1529927128747872386>    AUTORESPONDER <a:helukiti:1529927128747872386>",
            "",
            '<:hoa_mini:1529258852686500021> `har create "hello" text|embed` — tạo trigger mới',
            '<:hoa_mini:1529258852686500021> `har content "hello" nội dung` — sửa nội dung (text)',
            '<:hoa_mini:1529258852686500021> `har title "hello" tiêu đề` — sửa title (embed)',
            '<:hoa_mini:1529258852686500021> `har desc "hello" mô tả` — sửa description (embed)',
            '<:hoa_mini:1529258852686500021> `har color "hello" #HEXCOLOR` — sửa màu embed',
            '<:hoa_mini:1529258852686500021> `har footer "hello" footer` — sửa footer (embed)',
            '<:hoa_mini:1529258852686500021> `har thumb "hello" + ảnh` — sửa thumbnail (embed)',
            '<:hoa_mini:1529258852686500021> `har image "hello" + ảnh` — sửa ảnh lớn (embed)',
            '<:hoa_mini:1529258852686500021> `har type "hello" text|embed` — đổi loại',
            '<:hoa_mini:1529258852686500021> `har mode "hello" exact|contains` — đổi cách khớp',
            '<:hoa_mini:1529258852686500021> `har on "hello" / har off "hello"` — bật/tắt',
            '<:hoa_mini:1529258852686500021> `har list` — danh sách trigger',
            '<:hoa_mini:1529258852686500021> `har delete "hello"` — xóa trigger',
            "",
            "<a:hoatim:1529735587026964491>    Ngoài ra có thể dùng slash command `/ar` với các subcommand tương tự."
        ].join("\n"));
}

// parseArgs: tách "..." thành 1 phần tử, còn lại tách theo khoảng trắng
function parseAutoResArgs(input) {
  const args = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    args.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return args;
}

async function handleAutoResCommand(message, rawArgs) {
  if (!message.guild) return message.channel.send("Lệnh này chỉ dùng trong server.");
  const args = [...rawArgs];
  const sub = (args.shift() || "").toLowerCase();
if (!sub) return message.channel.send({
    embeds: [autoResHelp(message)]
});

  const guildData = getGuildAutoRes(message.guild.id);
  const trigger = args[0];
  const record = trigger ? findAutoRes(message.guild.id, trigger) : null;
  const needsManager = ["create", "delete", "content", "title", "desc", "color", "footer", "thumb", "image", "type", "mode", "on", "off"].includes(sub);

  if (needsManager && !hasAutoResManagerRole(message)) {
    return message.channel.send("<a:joe_deo:1543982900352000010> Bạn không có quyền AutoRes.");
  }

  if (sub === "create") {
    const type = (args[args.length - 1] || "").toLowerCase();
    if (!["text", "embed"].includes(type)) return message.channel.send(`Dùng: \`${prefix}ar create "hello" text|embed\``);
    args.pop();
    const key = normalizeTrigger(args.join(" "));
    if (!key) return message.channel.send(`Dùng: \`${prefix}ar create "hello" text|embed\``);
    if (guildData[key]) return message.channel.send("AutoRes này đã tồn tại.");
    guildData[key] = normalizeAutoResRecord({
      trigger: args.join(" ").trim(),
      type,
      mode: "exact",
      enabled: true,
      content: "",
      embed: { title: "", description: "", color: 0x5865f2, thumbnail: "", image: "", footer: "" },
      createdAt: Date.now(),
      createdBy: message.author.id,
    });
    saveAutoRes(autoRes);
    return message.channel.send(`<a:daucheck:1543227340648087614> Đã tạo AutoRes **${guildData[key].trigger}** dạng **${type}**.`);
  }

  if (sub === "list") {
    const entries = Object.values(guildData);
    if (!entries.length) return message.channel.send("<a:bow3:1543226020512014427> Server chưa có AutoRes nào.");
    const lines = entries.map((r, i) => `${i + 1}. ${r.enabled ? "<a:daucheck:1543227340648087614>" : "<a:dau_x:1543980848888549458>"} **${r.trigger}** — ${r.type} — ${r.mode}`);
    return message.channel.send(`**<a:bow3:1543226020512014427> AutoRes (${entries.length})**\n${lines.join("\n")}`);
  }

  if (sub === "delete") {
    if (!record) return message.channel.send("Không tìm thấy AutoRes.");
    removeLocalImage(record.embed.thumbnail);
    removeLocalImage(record.embed.image);
    delete guildData[normalizeTrigger(trigger)];
    saveAutoRes(autoRes);
    return message.channel.send(`<a:milk2:1543226670276808714> Đã xóa AutoRes **${record.trigger}**.`);
  }

  if (!record) return message.channel.send(`Không tìm thấy AutoRes. Dùng \`${prefix}ar list\` để xem danh sách.`);

  if (sub === "on" || sub === "off") {
    record.enabled = sub === "on";
    saveAutoRes(autoRes);
    return message.channel.send(`${record.enabled ? "<a:daucheck:1543227340648087614> Đã bật" : "<a:dau_x:1543980848888549458> Đã tắt"} AutoRes **${record.trigger}**.`);
  }

  if (sub === "type") {
    const type = (args[1] || "").toLowerCase();
    if (!["text", "embed"].includes(type)) return message.channel.send(`Dùng: \`${prefix}ar type "hello" text|embed\``);
    record.type = type;
    saveAutoRes(autoRes);
    return message.channel.send(`<a:daucheck:1543227340648087614> AutoRes **${record.trigger}** giờ là **${type}**.`);
  }

  if (sub === "mode") {
    const mode = (args[1] || "").toLowerCase();
    if (!["exact", "contains"].includes(mode)) return message.channel.send(`Dùng: \`${prefix}ar mode "hello" exact|contains\``);
    record.mode = mode;
    saveAutoRes(autoRes);
    return message.channel.send(`<a:daucheck:1543227340648087614> Trigger **${record.trigger}** dùng mode **${mode}**.`);
  }

  if (sub === "content") {
    record.content = args.slice(1).join(" ").trim();
    saveAutoRes(autoRes);
    return message.channel.send(`<a:daucheck:1543227340648087614> Đã cập nhật nội dung AutoRes **${record.trigger}**.`);
  }

  if (sub === "title" || sub === "desc" || sub === "footer") {
    const value = args.slice(1).join(" ").trim();
    const field = sub === "desc" ? "description" : sub;
    record.embed[field] = value;
    saveAutoRes(autoRes);
    return message.channel.send(`<a:daucheck:1543227340648087614> Đã cập nhật ${field} cho **${record.trigger}**.`);
  }

  if (sub === "color") {
    const value = (args[1] || "").trim().toLowerCase();
    if (value === "reset") record.embed.color = 0x5865f2;
    else if (/^#?[0-9a-f]{6}$/i.test(value)) record.embed.color = parseInt(value.replace("#", ""), 16);
    else return message.channel.send(`Dùng: \`${prefix}ar color "hello" #HEXCOLOR\` hoặc \`reset\``);
    saveAutoRes(autoRes);
    return message.channel.send(`<a:butmau:1543977031153356912> Đã cập nhật màu AutoRes **${record.trigger}**.`);
  }

  if (sub === "thumb" || sub === "image") {
    const attachment = getAttachments(message)[0];
    if (!attachment) return message.channel.send(`Hãy đính kèm ảnh cùng lệnh: \`${prefix}ar ${sub} "${record.trigger}"\``);
    try {
      const field = sub === "thumb" ? "thumbnail" : "image";
      const old = record.embed[field];
      const stored = await saveAutoResAttachment(record.trigger, field, attachment);
      record.embed[field] = stored;
      removeLocalImage(old);
      saveAutoRes(autoRes);
      return message.channel.send(`<a:daucheck:1543227340648087614> Đã cập nhật ${sub === "thumb" ? "thumbnail" : "image"} cho AutoRes **${record.trigger}**.`);
    } catch (error) {
      console.error(error);
      return message.channel.send("<a:milk1:1543226643961610352> Không thể lưu ảnh AutoRes.");
    }
  }

return message.channel.send({
    embeds: [autoResHelp(message)]
});
}

//autores: slash command "/ar" — tạo bằng modal, còn lại bằng option
const pendingAutoResCreates = new Map();

function buildAutoResCreateModal(type, token, trigger) {
  const modal = new ModalBuilder()
    .setCustomId(`ar_create_modal:${token}`)
    .setTitle(type === "embed" ? "Tạo AutoRes Embed" : "Tạo AutoRes Text");

  if (type === "text") {
    const contentInput = new TextInputBuilder()
      .setCustomId("content")
      .setLabel("Nội dung AutoRes")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000);
    modal.addComponents(new ActionRowBuilder().addComponents(contentInput));
    return modal;
  }

  const fields = [
    ["content", "Content", TextInputStyle.Paragraph, false, 4000],
    ["title", "Title", TextInputStyle.Short, false, 256],
    ["desc", "Description", TextInputStyle.Paragraph, false, 4000],
    ["color", "Color HEX (vd #ff69b4)", TextInputStyle.Short, false, 20],
    ["footer", "Footer", TextInputStyle.Short, false, 2048],
  ];
  for (const [id, label, style, required, maxLength] of fields) {
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(style)
      .setRequired(required)
      .setMaxLength(maxLength);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

async function handleAutoResCreateModal(interaction) {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith("ar_create_modal:")) return false;
  const token = interaction.customId.slice("ar_create_modal:".length);
  const pending = pendingAutoResCreates.get(token);
  if (!pending) {
    await interaction.reply({ content: "<a:milk1:1543226643961610352> Phiên tạo AutoRes đã hết hạn. Hãy dùng lại `/ar create`.", flags: MessageFlags.Ephemeral });
    return true;
  }
  pendingAutoResCreates.delete(token);

  if (pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId) {
    await interaction.reply({ content: "<a:joe_deo:1543982900352000010> Bạn không thể dùng form AutoRes này.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const guildData = getGuildAutoRes(interaction.guild.id);
  const key = normalizeTrigger(pending.trigger);
  if (guildData[key]) {
    await interaction.reply({ content: "<:pink_warning:1543983381279146055> AutoRes này đã tồn tại.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const content = interaction.fields.getTextInputValue("content")?.trim() || "";
  const title = pending.type === "embed" ? (interaction.fields.getTextInputValue("title")?.trim() || "") : "";
  const desc = pending.type === "embed" ? (interaction.fields.getTextInputValue("desc")?.trim() || "") : "";
  const colorValue = pending.type === "embed" ? (interaction.fields.getTextInputValue("color")?.trim().toLowerCase() || "") : "";
  const footer = pending.type === "embed" ? (interaction.fields.getTextInputValue("footer")?.trim() || "") : "";

  let color = 0x5865f2;
  if (pending.type === "embed" && colorValue) {
    if (colorValue === "reset") color = 0x5865f2;
    else if (/^#?[0-9a-f]{6}$/i.test(colorValue)) color = parseInt(colorValue.replace("#", ""), 16);
    else {
      await interaction.reply({ content: "<a:milk1:1543226643961610352> Màu không hợp lệ. Dùng `#ff69b4` hoặc để trống.", flags: MessageFlags.Ephemeral });
      return true;
    }
  }

  guildData[key] = normalizeAutoResRecord({
    trigger: pending.trigger,
    type: pending.type,
    mode: "exact",
    enabled: true,
    content,
    embed: { title, description: desc, color, thumbnail: "", image: "", footer },
    createdAt: Date.now(),
    createdBy: interaction.user.id,
  });
  saveAutoRes(autoRes);

  await interaction.reply({
    content: `<a:daucheck:1543227340648087614> Đã tạo AutoRes **${pending.trigger}** dạng **${pending.type}**${content ? " và đã đặt content." : "."}`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleAutoResSlash(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "ar") return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "<a:milk1:1543226643961610352> Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const action = interaction.options.getSubcommand();
  const managerActions = ["create", "edit", "delete", "on", "off"];
  if (managerActions.includes(action)) {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
    if (!hasAutoResManagerRole({ guild: interaction.guild, member })) {
      await interaction.reply({ content: "<a:joe_deo:1543982900352000010> Bạn không có quyền AutoRes.", flags: MessageFlags.Ephemeral });
      return true;
    }
  }

  const guildData = getGuildAutoRes(interaction.guild.id);

  if (action === "list") {
    const entries = Object.values(guildData);
    if (!entries.length) {
      await interaction.reply("<a:hok:1528801736448409632> Server chưa có AutoRes nào.");
      return true;
    }
    const lines = entries.map((r, i) => `${i + 1}. ${r.enabled ? "<a:daucheck:1543227340648087614>" : "<a:dau_x:1543980848888549458>"} **${r.trigger}** — ${r.type} — ${r.mode}`);
    await interaction.reply(`**<a:hok:1528801736448409632> AutoRes (${entries.length})**\n${lines.join("\n")}`);
    return true;
  }

  const trigger = interaction.options.getString("trigger", true).trim();
  const key = normalizeTrigger(trigger);
  const record = key ? findAutoRes(interaction.guild.id, trigger) : null;

  if (action === "create") {
    const type = interaction.options.getString("type", true);
    if (!key) {
      await interaction.reply({ content: "<a:milk1:1543226643961610352> Trigger không được để trống.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (guildData[key]) {
      await interaction.reply({ content: "<:pink_warning:1543983381279146055>  AutoRes này đã tồn tại.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const token = `${interaction.user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    pendingAutoResCreates.set(token, {
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      trigger,
      type,
      createdAt: Date.now(),
    });
    setTimeout(() => pendingAutoResCreates.delete(token), 5 * 60 * 1000);

    await interaction.showModal(buildAutoResCreateModal(type, token, trigger));
    return true;
  }

  if (!record) {
    await interaction.reply({ content: "<a:milk1:1543226643961610352> Không tìm thấy AutoRes. Dùng `/ar list` để xem danh sách.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === "delete") {
    removeLocalImage(record.embed.thumbnail);
    removeLocalImage(record.embed.image);
    delete guildData[normalizeTrigger(record.trigger)];
    saveAutoRes(autoRes);
    await interaction.reply(`<a:milk2:1543226670276808714> Đã xóa AutoRes **${record.trigger}**.`);
    return true;
  }

  if (action === "on" || action === "off") {
    record.enabled = action === "on";
    saveAutoRes(autoRes);
    await interaction.reply(`${record.enabled ? "<a:daucheck:1543227340648087614> Đã bật" : "<a:dau_x:1543980848888549458> Đã tắt"} AutoRes **${record.trigger}**.`);
    return true;
  }

  if (action === "edit") {
    let changed = [];
    const content = interaction.options.getString("content");
    const title = interaction.options.getString("title");
    const desc = interaction.options.getString("desc");
    const color = interaction.options.getString("color");
    const footer = interaction.options.getString("footer");
    const type = interaction.options.getString("type");
    const mode = interaction.options.getString("mode");
    const thumbnail = interaction.options.getAttachment("thumbnail");
    const image = interaction.options.getAttachment("image");

    if (content !== null) { record.content = content.trim(); changed.push("content"); }
    if (title !== null) { record.embed.title = title.trim(); changed.push("title"); }
    if (desc !== null) { record.embed.description = desc.trim(); changed.push("desc"); }
    if (footer !== null) { record.embed.footer = footer.trim(); changed.push("footer"); }
    if (type !== null) { record.type = type; changed.push("type"); }
    if (mode !== null) { record.mode = mode; changed.push("mode"); }

    if (color !== null) {
      const value = color.trim().toLowerCase();
      if (value === "reset") record.embed.color = 0x5865f2;
      else if (/^#?[0-9a-f]{6}$/i.test(value)) record.embed.color = parseInt(value.replace("#", ""), 16);
      else {
        await interaction.reply({ content: "<a:milk1:1543226643961610352> Màu không hợp lệ. Ví dụ `#ff69b4` hoặc `reset`.", flags: MessageFlags.Ephemeral });
        return true;
      }
      changed.push("color");
    }

    try {
      if (thumbnail) {
        const old = record.embed.thumbnail;
        record.embed.thumbnail = await saveAutoResAttachment(record.trigger, "thumbnail", thumbnail);
        removeLocalImage(old);
        changed.push("thumbnail");
      }
      if (image) {
        const old = record.embed.image;
        record.embed.image = await saveAutoResAttachment(record.trigger, "image", image);
        removeLocalImage(old);
        changed.push("image");
      }
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: "<a:milk1:1543226643961610352> Không thể lưu ảnh AutoRes.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!changed.length) {
      await interaction.reply({ content: "<a:ghichep:1543982509623083149> Không có thông tin nào được thay đổi.", flags: MessageFlags.Ephemeral });
      return true;
    }

    saveAutoRes(autoRes);
    await interaction.reply(`<a:daucheck:1543227340648087614>
 Đã cập nhật **${record.trigger}**: ${changed.join(", ")}.`);
    return true;
  }

  return true;
}

// ================== //autores: HẾT KHỐI TÍNH NĂNG AUTORES ==================

// doc, ghi file warn
let warns = {};
const warnsFile = "./warns.json";

if (fs.existsSync(warnsFile)) {
    try {
        warns = JSON.parse(fs.readFileSync(warnsFile, "utf8"));
    } catch (err) {
        warns = {};
    }
}

function saveWarns() {
    fs.writeFileSync(warnsFile, JSON.stringify(warns, null, 2));
}

// quan ly donate (bỏ)
let donates = {};
const donatesFile = "./donates.json";

if (fs.existsSync(donatesFile)) {
    try {
        donates = JSON.parse(fs.readFileSync(donatesFile, "utf8"));
    } catch (err) {
        donates = {};
    }
}

function saveDonates() {
    fs.writeFileSync(donatesFile, JSON.stringify(donates, null, 2));
}

// id role vip theo donate (bỏ)
const vipRoles = {
    1: "1529401042897211473",
    2: "1529401182156488764",
    3: "1529401284686250034",
    4: "1529401414537838592",
    5: "1529401569970491432"
};

// ham tu dong add role khi du donate (bỏ)
async function checkAndAssignVIP(member, totalAmount) {
    let targetTier = 0;
    if (totalAmount >= 300000) targetTier = 5;
    else if (totalAmount >= 200000) targetTier = 4;
    else if (totalAmount >= 100000) targetTier = 3;
    else if (totalAmount >= 65000) targetTier = 2;
    else if (totalAmount >= 30000) targetTier = 1;

    if (targetTier === 0) return;

    const roleId = vipRoles[targetTier];
    if (!roleId) return;

    const role = member.guild.roles.cache.get(roleId);
    if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(() => {});
    }
}

// timeout cua ga
const activeGiveaways = new Map();

async function tempReply(message, content, time = 5000) {
    const msg = await message.reply(content);

    setTimeout(() => {
        msg.delete().catch(() => {});
    }, time);

    return msg;
}

// nut av
function getHavActionRow(targetId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`hav_uavatar_${targetId}`).setLabel("Avatar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`hav_ubanner_${targetId}`).setLabel("Banner").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`hav_savatar_${targetId}`).setLabel("Server Avatar").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`hav_sbanner_${targetId}`).setLabel("Server Banner").setStyle(ButtonStyle.Secondary)
    );
}

// embed help
function getHomeEmbed(guild, client, prefix) {
    return new EmbedBuilder()
        .setColor("#481f86")
        .setAuthor({ 
            name: guild.name, 
            iconURL: guild.iconURL({ dynamic: true }) 
        })
        .setDescription(
            `## **Danh sách các lệnh của bot**\n` +
            `## <a:trangtim:1529563713516998779> prefix : \`${prefix}\`\n` +
            `**__Bot được dev bởi :__ <@1530444381343973378> dzai vai lon**`
        )
        .setFooter({ text: `Tổng 4 danh mục lệnh`, iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
}

// ham ket thuc chung cua ga
async function finishGiveaway(channel, messageId, title, creator, winnerCount, giveawayMsg) {
    const fetchedMsg = await channel.messages.fetch(messageId).catch(() => null);
    if (!fetchedMsg) return;

    const reaction = fetchedMsg.reactions.cache.get("1531654953461088447") || fetchedMsg.reactions.cache.first();
    let participantArray = [];

    if (reaction) {
        const users = await reaction.users.fetch();
        participantArray = Array.from(users.filter(u => !u.bot).keys());
    }

    if (participantArray.length === 0) {
        const endedEmbed = new EmbedBuilder()
            .setColor("#ff4d4d")
            .setAuthor({ 
                name: channel.guild.name, 
                iconURL: channel.guild.iconURL({ dynamic: true }) 
            })
            .setTitle(title)
            .setThumbnail(creator.displayAvatarURL({ dynamic: true }))
            .setDescription(
                `<a:trangtim:1529563713516998779> **Thời gian** : \`Đã kết thúc\`\n` +
                `<a:trangtim:1529563713516998779> **Tổ chức bởi** : ${creator}\n` +
                `<a:trangtim:1529563713516998779> **Người chiến thắng** : Không có ai tham gia!`
            )
            .setImage("https://media.discordapp.net/attachments/1530129148683485184/1531566259181981746/image.png?ex=6a69adbb&is=6a685c3b&hm=8c6d9b3a9ffb76983485372ea7beec3db4cf98cc46f820820a99eec40016bb98&=&format=webp&quality=lossless")
            .setFooter({ text: `${winnerCount} người thắng | Kết thúc lúc`, iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        await giveawayMsg.edit({ 
            content: "# <a:myshwing1:1531676766203019426> **__Giveaway kết thúc__** <a:myshwing2:1531676769814581312>", 
            embeds: [endedEmbed] 
        }).catch(() => {});

        await giveawayMsg.reply("<a:milk1:1543226643961610352> Không có ai tham gia giveaway này!");
        activeGiveaways.delete(messageId);
        return;
    }

    const winners = [];
    const actualWinnersCount = Math.min(winnerCount, participantArray.length);

    for (let i = 0; i < actualWinnersCount; i++) {
        const randomIndex = Math.floor(Math.random() * participantArray.length);
        winners.push(participantArray.splice(randomIndex, 1)[0]);
    }

    const winnerMentions = winners.map(id => `<@${id}>`).join(", ");

    const endedEmbed = new EmbedBuilder()
        .setColor("#481f86")
        .setAuthor({ 
            name: channel.guild.name, 
            iconURL: channel.guild.iconURL({ dynamic: true }) 
        })
        .setTitle(title)
        .setThumbnail(creator.displayAvatarURL({ dynamic: true }))
        .setDescription(
            `<a:trangtim:1529563713516998779> **Thời gian** : \`Đã kết thúc\`\n` +
            `<a:trangtim:1529563713516998779> **Tổ chức bởi** : ${creator}\n` +
            `<a:trangtim:1529563713516998779> **Người chiến thắng** : ${winnerMentions}`
        )
        .setImage("https://media.discordapp.net/attachments/1530129148683485184/1531566259181981746/image.png?ex=6a69adbb&is=6a685c3b&hm=8c6d9b3a9ffb76983485372ea7beec3db4cf98cc46f820820a99eec40016bb98&=&format=webp&quality=lossless")
        .setFooter({ text: `${winnerCount} người thắng | Kết thúc lúc`, iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

    await giveawayMsg.edit({ 
        content: "# <a:myshwing1:1531676766203019426> **__Giveaway kết thúc__** <a:myshwing2:1531676769814581312>", 
        embeds: [endedEmbed] 
    }).catch(() => {});

    await giveawayMsg.reply(`Chúc mừng ${winnerMentions} đã thắng giveaway **${title}** tổ chức bởi ${creator}`);
    activeGiveaways.delete(messageId);
}

client.once("ready", async () => {
    console.log(`${client.user.tag} đã online!`);

    //autores: đăng ký slash command "/ar" cho từng server
    const arCommand = new SlashCommandBuilder()
        .setName("ar")
        .setDescription("Quản lý AutoRes (tự động trả lời theo trigger)")
        .addSubcommand(sub => sub.setName("create").setDescription("Tạo AutoRes mới")
            .addStringOption(opt => opt.setName("trigger").setDescription("Từ khóa kích hoạt").setRequired(true))
            .addStringOption(opt => opt.setName("type").setDescription("Loại phản hồi").setRequired(true)
                .addChoices({ name: "Text", value: "text" }, { name: "Embed", value: "embed" })))
        .addSubcommand(sub => sub.setName("edit").setDescription("Sửa AutoRes")
            .addStringOption(opt => opt.setName("trigger").setDescription("Trigger cần sửa").setRequired(true))
            .addStringOption(opt => opt.setName("content").setDescription("Nội dung"))
            .addStringOption(opt => opt.setName("title").setDescription("Tiêu đề embed"))
            .addStringOption(opt => opt.setName("desc").setDescription("Mô tả embed"))
            .addStringOption(opt => opt.setName("color").setDescription("Màu HEX (vd #ff69b4) hoặc reset"))
            .addStringOption(opt => opt.setName("footer").setDescription("Footer embed"))
            .addStringOption(opt => opt.setName("type").setDescription("Loại phản hồi")
                .addChoices({ name: "Text", value: "text" }, { name: "Embed", value: "embed" }))
            .addStringOption(opt => opt.setName("mode").setDescription("Cách khớp trigger")
                .addChoices({ name: "Chính xác", value: "exact" }, { name: "Chứa chuỗi", value: "contains" }))
            .addAttachmentOption(opt => opt.setName("thumbnail").setDescription("Ảnh thumbnail (embed)"))
            .addAttachmentOption(opt => opt.setName("image").setDescription("Ảnh lớn (embed)")))
        .addSubcommand(sub => sub.setName("delete").setDescription("Xóa AutoRes")
            .addStringOption(opt => opt.setName("trigger").setDescription("Trigger cần xóa").setRequired(true)))
        .addSubcommand(sub => sub.setName("on").setDescription("Bật AutoRes")
            .addStringOption(opt => opt.setName("trigger").setDescription("Trigger cần bật").setRequired(true)))
        .addSubcommand(sub => sub.setName("off").setDescription("Tắt AutoRes")
            .addStringOption(opt => opt.setName("trigger").setDescription("Trigger cần tắt").setRequired(true)))
        .addSubcommand(sub => sub.setName("list").setDescription("Xem danh sách AutoRes"));

    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.commands.create(arCommand.toJSON());
        } catch (error) {
            console.error(`[AutoRes] Không đăng ký /ar ở ${guild.name}:`, error.message || error);
        }
    }
});

client.on("messageCreate", async (message) => {

    if (message.author.bot) return;

    // ping bot
    const replied =
        message.reference &&
        (await message.fetchReference().catch(() => null));

    if (
        message.mentions.has(client.user) ||
        (replied && replied.author.id === client.user.id)
    ) {

        const reply = await message.reply(
            `Xin chào ${message.author} | Mình là bot của server, prefix ở server là: \`${prefix}\`. Có thể xem các lệnh tại \`${prefix}help\`.`
        );

        setTimeout(() => {
            reply.delete().catch(() => { });
        }, 5000);

        return;
    }

    //autores: kiểm tra trigger tự động trả lời trước, không phụ thuộc prefix
    if (message.guild) {
        const matched = findMatchingAutoRes(message.guild.id, message.content);
        if (matched) {
            try {
                await message.channel.send(autoResPayload(matched));
            } catch (error) {
                console.error("AutoRes gửi thất bại:", error);
            }
            return;
        }
    }

    if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    //autores: lệnh prefix "${prefix}ar <sub> ..."
    if (command === "ar") {
        return handleAutoResCommand(message, parseAutoResArgs(message.content.slice(prefix.length + command.length).trim()));
    }

    // ban
    if (command === "ban") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
            return tempReply(
                message,
                `<a:milk1:1543226643961610352> Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Cấm thành viên.`
            );

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "<a:milk1:1543226643961610352> Hãy mention người cần ban.");

        const reason = args.slice(1).join(" ") || "Không có lý do.";

        await member.ban({ reason });

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle("🔨 Ban thành công")
            .setDescription(`${member} đã bị ban.`)
            .addFields(
                { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                { name: "📝 Lý do", value: reason, inline: true }
            );

        return message.reply({ embeds: [embed] });
    }

    // unban
    if (command === "unban") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
            return tempReply(
                message,
                `<a:milk1:1543226643961610352> Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Cấm thành viên (Unban).`
            );

        const userId = args[0];

        if (!userId)
            return tempReply(message, "<a:milk1:1543226643961610352> Hãy nhập ID của người cần unban. (Ví dụ: `hunban 123456789012345678`)");

        const reason = args.slice(1).join(" ") || "Không có lý do.";

        try {
            await message.guild.members.unban(userId, reason);

            const embed = new EmbedBuilder()
                .setColor("#481f86")
                .setTitle("🔓 Unban thành công")
                .setDescription(`Đã gỡ ban thành công cho người dùng có ID: \`${userId}\``)
                .addFields(
                    { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                    { name: "📝 Lý do", value: reason, inline: true }
                );

            return message.reply({ embeds: [embed] });
        } catch (error) {
            return tempReply(message, "<a:milk1:1543226643961610352> Không tìm thấy ID này trong danh sách bị ban hoặc ID không hợp lệ!");
        }
    }

    // kick
    if (command === "kick") {

              if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers))
            return tempReply(
                message,
                `<a:milk1:1543226643961610352> Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Kick thành viên (kick).`
            );

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "<a:milk1:1543226643961610352> Hãy mention người cần kick.");

        const reason = args.slice(1).join(" ") || "Không có lý do.";

        await member.kick(reason);

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle("👢 Kick thành công")
            .setDescription(`${member} đã bị kick.`)
            .addFields(
                { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                { name: "📝 Lý do", value: reason, inline: true }
            );

        return message.reply({ embeds: [embed] });
    }

    // mute
if (command === "mute") {

    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return tempReply(
            message,
            `<a:milk1:1543226643961610352> Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Hạn chế thành viên`
        );

    const member = message.mentions.members.first();

    if (!member)
        return tempReply(message, "<a:milk1:1543226643961610352> Hãy mention người cần mute.");

    const timeArg = args[1];

    if (!timeArg)
        return tempReply(
            message,
            "<a:milk1:1543226643961610352> Hãy nhập thời gian.\nVí dụ: `hmute @user 30s`, `hmute @user 10m`, `hmute @user 36h`."
        );

    // Hỗ trợ: s = giây, m = phút, h = giờ
    const match = timeArg.match(/^(\d+)(s|m|h)$/i);

    if (!match)
        return tempReply(
            message,
            "<a:milk1:1543226643961610352> Thời gian không hợp lệ.\nDùng `s` = giây, `m` = phút, `h` = giờ."
        );

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();

    let durationMs;

    if (unit === "s") {
        durationMs = amount * 1000;
    } else if (unit === "m") {
        durationMs = amount * 60 * 1000;
    } else {
        durationMs = amount * 60 * 60 * 1000;
    }

    // Discord giới hạn timeout tối đa 28 ngày
    if (
        durationMs <= 0 ||
        durationMs > 28 * 24 * 60 * 60 * 1000
    ) {
        return tempReply(
            message,
            "<a:milk1:1543226643961610352> Thời gian mute phải từ 1 giây đến tối đa 28 ngày."
        );
    }

    const reason = args.slice(2).join(" ") || "Không có lý do.";

    try {
        await member.timeout(durationMs, reason);

        let unitName;

        if (unit === "s") {
            unitName = "giây";
        } else if (unit === "m") {
            unitName = "phút";
        } else {
            unitName = "giờ";
        }

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle("🔇 Mute thành công")
            .setDescription(`${member} đã bị mute.`)
            .addFields(
                {
                    name: "⏱️ Thời gian",
                    value: `${amount} ${unitName}`,
                    inline: true
                },
                {
                    name: "<a:camap:1529737268892274890> Moderator",
                    value: message.author.tag,
                    inline: true
                },
                {
                    name: "📝 Lý do",
                    value: reason
                }
            );

        return message.reply({ embeds: [embed] });

    } catch (error) {
        console.error("[MUTE ERROR]", error);

        return tempReply(
            message,
            "<a:milk1:1543226643961610352> Không thể mute thành viên này. Hãy kiểm tra quyền `Moderate Members` và vị trí role của bot."
        );
    }
}

// unmute
    if (command === "unmute") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return tempReply(
                message,
                `<a:milk1:1543226643961610352> Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Hạn chế thành viên (Moderate Members)`
            );

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "<a:milk1:1543226643961610352> Hãy mention người cần unmute.");

        const reason = args.slice(1).join(" ") || "Không có lý do.";

        try {

            await member.timeout(null, reason);

            const embed = new EmbedBuilder()
                .setColor("#481f86")
                .setTitle("🔊 Unmute thành công")
                .setDescription(`${member} đã được gỡ mute.`)
                .addFields(
                    {
                        name: "<a:camap:1529737268892274890> Moderator",
                        value: message.author.tag,
                        inline: true
                    },
                    {
                        name: "📝 Lý do",
                        value: reason,
                        inline: true
                    }
                );

            return message.reply({ embeds: [embed] });

        } catch (error) {
            console.error("[UNMUTE ERROR]", error);

            return tempReply(
                message,
                "<a:milk1:1543226643961610352> Không thể unmute thành viên này. Hãy kiểm tra quyền `Moderate Members` và vị trí role của bot."
            );
        }
    }

    // warn
    if (command === "warn") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return tempReply(
                message,
                `<a:milk1:1543226643961610352> Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Cảnh báo thành viên`
            );

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "<a:milk1:1543226643961610352> Hãy mention người cần warn.");

        const reason = args.slice(1).join(" ") || "Không có lý do.";

        if (!warns[member.id])
            warns[member.id] = [];

        warns[member.id].push({
            moderator: message.author.tag,
            reason: reason,
            date: new Date().toLocaleString("vi-VN")
        });

        saveWarns();

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle("<:pink_warning:1543983381279146055>  Thành viên đã bị cảnh cáo")
            .setDescription(`${member} đã nhận một cảnh cáo.`)
            .addFields(
                { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                { name: "📝 Lý do", value: reason, inline: true },
                { name: "📊 Tổng Warn", value: `${warns[member.id].length}`, inline: true }
            );

        return message.reply({ embeds: [embed] });
    }

    // xoa warn
    if (command === "rwarn") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return tempReply(
                message,
                `<a:milk1:1543226643961610352> Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Cảnh báo thành viên`
            );

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "<a:milk1:1543226643961610352> Hãy mention người cần xóa warn.");

        if (!warns[member.id] || warns[member.id].length === 0)
            return tempReply(message, "<a:milk1:1543226643961610352> Thành viên này không có warn nào để xóa.");

        const index = parseInt(args[1]) - 1;

        if (isNaN(index) || index < 0 || !warns[member.id][index])
            return tempReply(message, `<a:milk1:1543226643961610352> Hãy dùng \`${prefix}hcwarn @user\` để xem đúng số thứ tự.`);

        const removed = warns[member.id].splice(index, 1)[0];

        if (warns[member.id].length === 0) {
            delete warns[member.id];
        }

        saveWarns();

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle("<a:milk2:1543226670276808714> Xóa cảnh cáo thành công")
            .setDescription(`Đã xóa cảnh cáo số **${index + 1}** của ${member}.`)
            .addFields(
                { name: "📝 Lý do cũ", value: removed.reason, inline: true },
                { name: "📊 Tổng Warn còn lại", value: `${warns[member.id] ? warns[member.id].length : 0}`, inline: true }
            );

        return message.reply({ embeds: [embed] });
    }

    // cwarn check warn
    if (command === "cwarn") {

        const member = message.mentions.members.first() || message.member;

        if (!warns[member.id] || warns[member.id].length === 0) {
            const embed = new EmbedBuilder()
                .setColor("#481f86")
                .setTitle("📊 Thông tin cảnh cáo")
                .setDescription(`<a:tikhong:1542901135088812092> ${member} hiện không có cảnh cáo nào.`);
                
            return message.reply({ embeds: [embed] });
        }

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle(`📊 Lịch sử cảnh cáo của ${member.user.tag}`)
            .setDescription(`Tổng số cảnh cáo: **${warns[member.id].length}**`);

        warns[member.id].forEach((w, index) => {
            embed.addFields({
                name: `<:pink_warning:1543983381279146055>  Lần ${index + 1}`,
                value: `**Lý do:** ${w.reason}\n**Moderator:** ${w.moderator}\n**Thời gian:** ${w.date}`
            });
        });

        return message.reply({ embeds: [embed] });
    }

// lock
    if (command === "lock") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("<a:milk1:1543226643961610352> Không có quyền")
                .setDescription(
                    "Bạn không có quyền để sử dụng lệnh này!\n\n" +
                    "📌 Quyền hạn: Quản lý kênh (Manage Channels)."
                );

            return message.reply({ embeds: [errEmbed] });
        }

        const targetChannel = message.mentions.channels.first() || message.channel;
        const botMember = message.guild.members.me;

        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("<a:milk1:1543226643961610352> Bot thiếu quyền")
                .setDescription("Bot cần quyền **Manage Channels** để khóa kênh.");

            return message.reply({ embeds: [errEmbed] });
        }

        try {
            await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
                SendMessages: false
            }, { reason: `Locked by ${message.author.tag}` });

            const embed = new EmbedBuilder()
                .setColor("#481f86")
                .setTitle("<a:tikhong:1542901135088812092> Khóa kênh thành công")
                .setDescription(
                    `Đã khóa kênh ${targetChannel}.`
                )
                .addFields(
                    {
                        name: "<a:camap:1529737268892274890> Moderator",
                        value: message.author.tag,
                        inline: true
                    },
                    {
                        name: "<a:hoatim:1529735587026964491> Kênh",
                        value: targetChannel.name,
                        inline: true
                    }
                )
                .setTimestamp();

            return message.reply({ embeds: [embed] });

        } catch (error) {
            console.error("[LOCK ERROR]", error);
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("<a:milk1:1543226643961610352> Không thể khóa kênh")
                .setDescription("Đã xảy ra lỗi khi khóa kênh này.");

            return message.reply({ embeds: [errEmbed] });
        }
    }

    // unlock
    if (command === "unlock") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("<a:milk1:1543226643961610352> Không có quyền")
                .setDescription(
                    "Bạn không có quyền để sử dụng lệnh này!\n\n" +
                    "📌 Quyền hạn: Quản lý kênh (Manage Channels)."
                );

            return message.reply({ embeds: [errEmbed] });
        }

        const targetChannel = message.mentions.channels.first() || message.channel;
        const botMember = message.guild.members.me;

        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("<a:milk1:1543226643961610352> Bot thiếu quyền")
                .setDescription("Bot cần quyền **Manage Channels** để mở khóa kênh.");

            return message.reply({ embeds: [errEmbed] });
        }

        try {
            await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
                SendMessages: null
            }, { reason: `Unlocked by ${message.author.tag}` });

            const embed = new EmbedBuilder()
                .setColor("#481f86")
                .setTitle("<a:tikhong:1542901135088812092> Mở khóa kênh thành công")
                .setDescription(
                    `Đã mở khóa kênh ${targetChannel}.`
                )
                .addFields(
                    {
                        name: "<a:camap:1529737268892274890> Moderator",
                        value: message.author.tag,
                        inline: true
                    },
                    {
                        name: "<a:hoatim:1529735587026964491> Kênh",
                        value: targetChannel.name,
                        inline: true
                    }
                )
                .setTimestamp();

            return message.reply({ embeds: [embed] });

        } catch (error) {
            console.error("[UNLOCK ERROR]", error);
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("<a:milk1:1543226643961610352> Không thể mở khóa kênh")
                .setDescription("Đã xảy ra lỗi khi mở khóa kênh này.");

            return message.reply({ embeds: [errEmbed] });
        }
    }

    // ga start
    if (command === "gastart") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
            return tempReply(message, "<a:milk1:1543226643961610352> Bạn không có quyền quản lý tin nhắn để tạo giveaway!");

        const timeArg = args[0];
        const winArg = args[1];
        const title = args.slice(2).join(" ");

        if (!timeArg || !winArg || !title)
            return tempReply(message, `<a:milk1:1543226643961610352> Sai cú pháp! Hãy sử dụng: \`${prefix}gastart <time> <win> <title>\`!`);

        const timeRegex = /^(\d+)([smhd])$/i;
        const match = timeArg.match(timeRegex);
        if (!match)
            return tempReply(message, "<a:milk1:1543226643961610352> Thời gian không hợp lệ! Dùng định dạng như: `30s`, `5m`, `2h`, `1d`.");

        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        let ms = 0;

        if (unit === 's') ms = value * 1000;
        else if (unit === 'm') ms = value * 60 * 1000;
        else if (unit === 'h') ms = value * 60 * 60 * 1000;
        else if (unit === 'd') ms = value * 24 * 60 * 60 * 1000;

        if (ms <= 0) return tempReply(message, "<a:milk1:1543226643961610352> Thời gian phải lớn hơn 0!");

        const winnerCount = parseInt(winArg.replace(/w/gi, ''));
        if (isNaN(winnerCount) || winnerCount <= 0)
            return tempReply(message, "<a:milk1:1543226643961610352> Số lượng người thắng không hợp lệ! (Ví dụ: `1` hoặc `1w`)");

        message.delete().catch(() => {});

        const endTime = Date.now() + ms;
        const creator = message.author;
        const guild = message.guild;

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setAuthor({ 
                name: guild.name, 
                iconURL: guild.iconURL({ dynamic: true }) 
            })
            .setTitle(title)
            .setThumbnail(creator.displayAvatarURL({ dynamic: true }))
            .setDescription(
                `<a:trangtim:1529563713516998779> **Thời gian** : <t:${Math.floor(endTime / 1000)}:R> ⏰\n` +
                `<a:trangtim:1529563713516998779> **Tổ chức bởi** : ${creator}`
            )
            .setImage("https://media.discordapp.net/attachments/1530129148683485184/1531566259181981746/image.png?ex=6a69adbb&is=6a685c3b&hm=8c6d9b3a9ffb76983485372ea7beec3db4cf98cc46f820820a99eec40016bb98&=&format=webp&quality=lossless")
            .setFooter({ text: `${winnerCount} người thắng | Bắt đầu lúc`, iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        const giveawayMsg = await message.channel.send({ 
            content: "# <a:myshwing1:1531676766203019426> **__Giveaway bắt đầu__** <a:myshwing2:1531676769814581312>", 
            embeds: [embed] 
        });

        await giveawayMsg.react("1531654953461088447").catch(() => {});

        const timeoutId = setTimeout(() => {
            finishGiveaway(message.channel, giveawayMsg.id, title, creator, winnerCount, giveawayMsg);
        }, ms);

        activeGiveaways.set(giveawayMsg.id, {
            timeoutId,
            channelId: message.channel.id,
            title,
            creator,
            winnerCount,
            giveawayMsg
        });

        return;
    }

    // ga stop
    if (command === "gastop") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
            return tempReply(message, "<a:milk1:1543226643961610352> Bạn không có quyền quản lý tin nhắn để dừng giveaway!");

        const messageId = args[0];
        if (!messageId)
            return tempReply(message, `<a:milk1:1543226643961610352> Vui lòng nhập ID tin nhắn của giveaway! (Ví dụ: \`${prefix}gastop <message_id>\`)`);

        const gaData = activeGiveaways.get(messageId);
        if (!gaData)
            return tempReply(message, "<a:milk1:1543226643961610352> Không tìm thấy giveaway đang chạy với ID này (hoặc giveaway này đã kết thúc trước đó).");

        clearTimeout(gaData.timeoutId);

        const channel = await client.channels.fetch(gaData.channelId).catch(() => null);
        if (!channel) {
            activeGiveaways.delete(messageId);
            return tempReply(message, "<a:milk1:1543226643961610352> Không tìm thấy kênh chứa giveaway này.");
        }

        await finishGiveaway(channel, messageId, gaData.title, gaData.creator, gaData.winnerCount, gaData.giveawayMsg);
        return tempReply(message, "<a:daucheck:1543227340648087614> Đã dừng giveaway và công bố người chiến thắng thành công!");
    }

    // ga rr
    if (command === "gareroll") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
            return tempReply(message, "<a:milk1:1543226643961610352> Bạn không có quyền quản lý tin nhắn để quay lại người thắng giveaway!");

        const messageId = args[0];
        if (!messageId)
            return tempReply(message, `<a:milk1:1543226643961610352> Vui lòng nhập ID tin nhắn của giveaway! (Ví dụ: \`${prefix}gareroll <message_id>\`)`);

        const fetchedMsg = await message.channel.messages.fetch(messageId).catch(() => null);
        if (!fetchedMsg)
            return tempReply(message, "<a:milk1:1543226643961610352> Không tìm thấy tin nhắn giveaway với ID này trong kênh hiện tại.");

        const embed = fetchedMsg.embeds[0];
        if (!embed)
            return tempReply(message, "<a:milk1:1543226643961610352> Tin nhắn này không chứa thông tin giveaway hợp lệ.");

        const title = embed.title || "Giveaway";
        
        const desc = embed.description || "";
        const creatorMatch = desc.match(/(?:\*\*Tổ chức bởi\*\*|Tổ chức bởi)\s*:\s*(<@!?\d+>)/);
        const creator = creatorMatch ? creatorMatch[1] : "Người tổ chức";

        const reaction = fetchedMsg.reactions.cache.get("1531654953461088447") || fetchedMsg.reactions.cache.first();
        if (!reaction)
            return tempReply(message, "<a:milk1:1543226643961610352> Không tìm thấy lượt tương tác (reaction) nào trên tin nhắn này.");

        const users = await reaction.users.fetch();
        const participantArray = Array.from(users.filter(u => !u.bot).keys());

        if (participantArray.length === 0)
            return tempReply(message, "<a:milk1:1543226643961610352> Không có người tham gia hợp lệ nào trong giveaway này để quay lại!");

        const randomUserId = participantArray[Math.floor(Math.random() * participantArray.length)];
        const winnerMention = `<@${randomUserId}>`;

        return message.reply(`Reroll! Chúc mừng, ${winnerMention} đã thắng giveaway **${title}** tổ chức bởi ${creator}`);
    }

    // av
    if (command === "av") {
        const repliedMessage = message.reference ? await message.fetchReference().catch(() => null) : null;
        const targetUser = repliedMessage ? repliedMessage.author : (message.mentions.users.first() || message.author);

        if (targetUser.bot)
            return tempReply(message, "<a:milk1:1543226643961610352> Không thể yêu cầu xem avatar của bot!");

        // soi av cua minh
        if (targetUser.id === message.author.id) {
            const fetchedTarget = await targetUser.fetch().catch(() => targetUser);
            const avatarURL = fetchedTarget.displayAvatarURL({ size: 1024, dynamic: true });

            const embed = new EmbedBuilder()
                .setColor("#481f86")
                .setTitle(`Avatar của ${fetchedTarget.tag}`)
                .setImage(avatarURL)
                .setFooter({
    text: `Người yêu cầu: @${message.author.username}`,
    iconURL: message.author.displayAvatarURL({ dynamic: true })
})
                .setTimestamp();

            const row = getHavActionRow(fetchedTarget.id);

            return message.reply({ embeds: [embed], components: [row] });
        }

        // soi av acp
        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle("Yêu cầu xem avatar")
            .setDescription(`${message.author} muốn xem avatar của bạn. Bạn có đồng ý không?`)
            .setFooter({ text: `Yêu cầu bởi ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`av_accept_${targetUser.id}_${message.author.id}`)
                .setLabel("Chấp nhận")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`av_deny_${targetUser.id}_${message.author.id}`)
                .setLabel("Từ chối")
                .setStyle(ButtonStyle.Danger)
        );

        return message.reply({
            content: `${targetUser}`,
            embeds: [embed],
            components: [row]
        });
    }

// role & temp
else if (command === "role") {

    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        const errEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("<a:milk1:1543226643961610352> Không có quyền")
            .setDescription(
                "Bạn không có quyền để sử dụng lệnh này!\n\n" +
                "📌 Quyền hạn: Quản lý vai trò (Manage Roles)."
            );

        return message.reply({ embeds: [errEmbed] });
    }

    const targetMember = message.mentions.members.first();

    let queryArgs = targetMember ? args.slice(1) : [...args];

    if (queryArgs.length === 0) {
        const errEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("❌ Thiếu thông tin")
            .setDescription(
                `Hãy nhập tên role hoặc thời gian!\n\n` +
                `📌 Ví dụ: \`${prefix}role Cư dân\`\n` +
                `📌 Ví dụ Temp Role: \`${prefix}role @user Cư dân 10m\``
            );

        return message.reply({ embeds: [errEmbed] });
    }

    let durationMs = 0;
    let timeString = "";
    const lastArg = queryArgs[queryArgs.length - 1];
    const timeRegex = /^(\d+)([smhd])$/i;
    const timeMatch = lastArg.match(timeRegex);

    if (timeMatch) {
        const value = parseInt(timeMatch[1]);
        const unit = timeMatch[2].toLowerCase();

        if (unit === 's') durationMs = value * 1000;
        else if (unit === 'm') durationMs = value * 60 * 1000;
        else if (unit === 'h') durationMs = value * 60 * 60 * 1000;
        else if (unit === 'd') durationMs = value * 24 * 60 * 60 * 1000;

        timeString = lastArg;
        queryArgs.pop(); 
    }

    const roleQuery = queryArgs.join(" ").trim();

    if (!roleQuery) {
        const errEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("❌ Thiếu tên role")
            .setDescription("Vui lòng nhập tên role cần thêm/gỡ!");
        return message.reply({ embeds: [errEmbed] });
    }

    const memberToModify = targetMember || message.member;

    const roleToModify = message.guild.roles.cache.find(
        role => 
            role.name.toLowerCase().startsWith(roleQuery.toLowerCase()) || 
            role.name.toLowerCase().includes(roleQuery.toLowerCase())
    );

    if (!roleToModify) {
        const errEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("❌ Không tìm thấy role")
            .setDescription(`Không tìm thấy role nào phù hợp với **${roleQuery}**!`);

        return message.reply({ embeds: [errEmbed] });
    }

    const botMember = message.guild.members.me;

    if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        const errEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("❌ Bot thiếu quyền")
            .setDescription("Bot cần quyền **Manage Roles** để thực hiện lệnh này.");

        return message.reply({ embeds: [errEmbed] });
    }

    if (roleToModify.id === message.guild.id || roleToModify.managed) {
        const errEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("❌ Role không hợp lệ")
            .setDescription("Không thể thêm hoặc gỡ role này.");

        return message.reply({ embeds: [errEmbed] });
    }

    // phan cap
    if (roleToModify.position >= botMember.roles.highest.position) {
        const errEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("❌ Lỗi phân cấp role")
            .setDescription("Bot không thể thêm/gỡ role này vì role đó cao hơn hoặc ngang bằng role cao nhất của bot.");

        return message.reply({ embeds: [errEmbed] });
    }

    try {
        // go role
        if (memberToModify.roles.cache.has(roleToModify.id)) {
            await memberToModify.roles.remove(roleToModify, `Role removed by ${message.author.tag}`);

            const embed = new EmbedBuilder()
                .setColor("#481f86")
                .setTitle("❌ Gỡ Role thành công")
                .setDescription(`Đã gỡ role ${roleToModify} khỏi ${memberToModify}.`)
                .addFields(
                    { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                    { name: "<a:hoatim:1529735587026964491> Role", value: roleToModify.name, inline: true }
                )
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        // add role 
        await memberToModify.roles.add(roleToModify, `Role added by ${message.author.tag}`);

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle("<a:tikhong:1542901135088812092> Thêm Role thành công")
            .setDescription(`Đã thêm role ${roleToModify} cho ${memberToModify}.` + (timeString ? `\n⏱️ **Thời hạn:** ${timeString}` : ""))
            .addFields(
                { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                { name: "<a:hoatim:1529735587026964491> Role", value: roleToModify.name, inline: true }
            )
            .setTimestamp();

        message.reply({ embeds: [embed] });

// Temp Role
        if (durationMs > 0) {
            setTimeout(async () => {
                try {
                    // Fetch lại member để đảm bảo dữ liệu mới nhất
                    const freshMember = await message.guild.members.fetch(memberToModify.id).catch(() => null);
                    if (freshMember && freshMember.roles.cache.has(roleToModify.id)) {
                        await freshMember.roles.remove(roleToModify, "Temporary role expired.");
                        
                        // Tạo embed thông báo hết giờ (không bị ping role hay user)
                        const expireEmbed = new EmbedBuilder()
                            .setColor("#481f86")
                            .setTitle("<a:milk1:1543226643961610352> Hết thời gian Temp Role")
                            .setDescription(`Đã tự động gỡ role cho thành viên sau thời gian đã định.`)
                            .addFields(
                                { name: "<a:hoatim:1529735587026964491> Role", value: roleToModify.name, inline: true },
                                { name: "<a:camap:1529737268892274890> Thành viên", value: freshMember.user.tag, inline: true },
                                { name: "<a:milk2:1543226670276808714> Thời hạn", value: timeString, inline: true }
                            )
                            .setTimestamp();

                        message.channel.send({ embeds: [expireEmbed] }).catch(() => {});
                    }
                } catch (err) {
                    console.error("[TEMP ROLE EXPIRED ERROR]", err);
                }
            }, durationMs);
        }

    } catch (error) {
        console.error("[ROLE ERROR]", error);
        const errEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("❌ Lỗi")
            .setDescription("Đã xảy ra lỗi khi cấp hoặc gỡ role.");
        return message.reply({ embeds: [errEmbed] });
    }
}


    // help
    if (command === "help") {
        const embed = getHomeEmbed(message.guild, client, prefix);

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("help_menu")
                .setPlaceholder("Chọn danh mục")
                .addOptions([
                    {
                        label: "Quản trị (Moderation)",
                        description: "Các lệnh ban, unban, kick, mute",
                        value: "help_mod",
                        emoji: "<a:saodoto:1529738089918890106>"
                    },
                    {
                        label: "Cảnh cáo (Warn)",
                        description: "Các lệnh warn, hcwarn, hrwarn",
                        value: "help_warn",
                        emoji: "<a:saohongto:1529736991598575626>"
                    },
                    {
                        label: "Giveaway",
                        description: "Lệnh tạo và quản lý giveaway",
                        value: "help_ga",
                        emoji: "<a:saotimto:1529563552464244939>"
                    },
                    {
                        label: "User",
                        description: "Lệnh thuộc user",
                        value: "help_user",
                        emoji: "<a:saoxanhto:1529737259518263386>"
                    }
                ])
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

});

// nut help
client.on("interactionCreate", async (interaction) => {
    //autores: xử lý slash "/ar" và modal tạo AutoRes
    if (await handleAutoResSlash(interaction)) return;
    if (await handleAutoResCreateModal(interaction)) return;

    // xu ly select nut help
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "help_menu") {
            const selected = interaction.values[0];

            if (selected === "help_mod") {
                const embed = new EmbedBuilder()
                    .setColor("#481f86")
                    .setAuthor({ 
                        name: interaction.guild.name, 
                        iconURL: interaction.guild.iconURL({ dynamic: true }) 
                    })
                    .setTitle("<a:hoatim:1529735587026964491> Danh sách lệnh Quản trị")
                    .setDescription(
                        `### \`${prefix}ban\`\n` +
                        `* **Mô tả** : Cấm thành viên khỏi server.\n` +
                        `* **Lệnh** : \`${prefix}ban @user [lý do]\`\n\n` +
                        `### \`${prefix}unban\`\n` +
                        `* **Mô tả** : Gỡ cấm thành viên.\n` +
                        `* **Lệnh** : \`${prefix}unban <ID> [lý do]\`\n\n` +
                        `### \`${prefix}kick\`\n` +
                        `* **Mô tả** : Đuổi thành viên khỏi server.\n` +
                        `* **Lệnh** : \`${prefix}kick @user [lý do]\`\n\n` +
                        `### \`${prefix}mute\`\n` +
                        `* **Mô tả** : Hạn chế (timeout) thành viên.\n` +
                        `* **Lệnh** : \`${prefix}mute @user <phút> [lý do]\``+
                                                `### \`${prefix}mute\`\n` +
                        `* **Mô tả** : Quản lý vai trò hàng loạt cho thành viên.\n` +
                        `* **Lệnh** : \`${prefix}role @user <tên role>\``
                    )
                    .setFooter({ text: `Tổng 4 danh mục lệnh`, iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (selected === "help_warn") {
                const embed = new EmbedBuilder()
                    .setColor("#481f86")
                    .setAuthor({ 
                        name: interaction.guild.name, 
                        iconURL: interaction.guild.iconURL({ dynamic: true }) 
                    })
                    .setTitle("<a:saohongto:1529736991598575626> Danh sách lệnh Cảnh cáo")
                    .setDescription(
                        `### \`${prefix}warn\`\n` +
                        `* **Mô tả** : Cảnh cáo thành viên.\n` +
                        `* **Lệnh** : \`${prefix}warn @user [lý do]\`\n\n` +
                        `### \`${prefix}cwarn\`\n` +
                        `* **Mô tả** : Xem lịch sử cảnh cáo của thành viên.\n` +
                        `* **Lệnh** : \`${prefix}cwarn [@user]\`\n\n` +
                        `### \`${prefix}rwarn\`\n` +
                        `* **Mô tả** : Xóa cảnh cáo của thành viên.\n` +
                        `* **Lệnh** : \`${prefix}rwarn @user <số thứ tự>\``
                    )
                    .setFooter({ text: `Tổng 4 danh mục lệnh`, iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (selected === "help_ga") {
                const embed = new EmbedBuilder()
                    .setColor("#481f86")
                    .setAuthor({ 
                        name: interaction.guild.name, 
                        iconURL: interaction.guild.iconURL({ dynamic: true }) 
                    })
                    .setTitle("<a:phao:1531654953461088447> Danh sách lệnh Giveaway")
                    .setDescription(
                        `### \`${prefix}gastart\`\n` +
                        `* **Mô tả** : Tạo ra giveaway.\n` +
                        `* **Lệnh** : \`${prefix}gastart <time> <win> <title>\`\n\n` +
                        `### \`${prefix}gareroll\`\n` +
                        `* **Mô tả** : Chọn lại người chiến thắng.\n` +
                        `* **Lệnh** : \`${prefix}gareroll <message_id>\`\n\n` +
                        `### \`${prefix}gastop\`\n` +
                        `* **Mô tả** : Dừng giveaway đang chạy.\n` +
                        `* **Lệnh** : \`${prefix}gastop <message_id>\``
                    )
                    .setFooter({ text: `Tổng 4 danh mục lệnh`, iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
                        if (selected === "help_user") {
                const embed = new EmbedBuilder()
                    .setColor("#481f86")
                    .setAuthor({ 
                        name: interaction.guild.name, 
                        iconURL: interaction.guild.iconURL({ dynamic: true }) 
                    })
                    .setTitle("<a:camap:1529737268892274890> Danh sách lệnh User")
                    .setDescription(
                        `### \`${prefix}avatar\`\n` +
                        `* **Mô tả** : Xem avatar của bạn hoặc yêu cầu xem của người khác.\n` +
                        `* **Lệnh** : \`${prefix}avatar <@user> | ${prefix}av <@user>\`\n\n` 
                    )
                    .setFooter({ text: `Tổng 4 danh mục lệnh`, iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
        return;
    }

    // xu ly nut
    if (interaction.isButton()) {
        const customId = interaction.customId;

        // soi av (acp/deny)
        if (customId.startsWith("av_accept_") || customId.startsWith("av_deny_")) {
            const parts = customId.split("_");
            const action = parts[1]; // accept hoặc deny
            const targetUserId = parts[2];
            const requesterId = parts[3];

            if (interaction.user.id !== targetUserId) {
                return interaction.reply({
                    content: "<a:milk1:1543226643961610352> Bạn không phải là người được yêu cầu xem avatar nên không thể bấm nút này!",
                    ephemeral: true
                });
            }

            if (action === "accept") {
                const targetUserObj = await client.users.fetch(targetUserId).catch(() => null);
                const fetchedTarget = targetUserObj ? await targetUserObj.fetch().catch(() => targetUserObj) : null;
                const avatarURL = fetchedTarget ? fetchedTarget.displayAvatarURL({ size: 1024, dynamic: true }) : interaction.user.displayAvatarURL({ size: 1024, dynamic: true });

                const acceptedEmbed = new EmbedBuilder()
                    .setColor("#481f86")
                    .setAuthor({ name: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                    .setTitle(`Avatar của ${fetchedTarget ? fetchedTarget.tag : interaction.user.tag}`)
                    .setImage(avatarURL)
                    .setDescription(`<a:tikhong:1542901135088812092> Đã chấp nhận yêu cầu xem avatar từ <@${requesterId}>`)
                    .setFooter({ text: `Được yêu cầu bởi ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                const row = getHavActionRow(targetUserId);

                return interaction.update({
                    content: `<@${requesterId}>`,
                    embeds: [acceptedEmbed],
                    components: [row]
                });
            } else if (action === "deny") {
                const deniedEmbed = new EmbedBuilder()
                    .setColor("#ff4d4d")
                    .setTitle("Yêu cầu xem avatar")
                    .setDescription(`<a:milk1:1543226643961610352> ${interaction.user} đã **từ chối** yêu cầu xem avatar từ <@${requesterId}>`)
                    .setTimestamp();

                return interaction.update({
                    content: `<@${requesterId}>`,
                    embeds: [deniedEmbed],
                    components: []
                });
            }
        }

        // nut doi  Banner, Server Avatar, Server Banner
        if (
            customId.startsWith("hav_uavatar_") ||
            customId.startsWith("hav_ubanner_") ||
            customId.startsWith("hav_savatar_") ||
            customId.startsWith("hav_sbanner_")
        ) {
            const parts = customId.split("_");
            const type = parts[1]; // uavatar, ubanner, svavatar,svbanner
            const targetUserId = parts[2];

            const targetUserObj = await client.users.fetch(targetUserId).catch(() => null);
            const fetchedTarget = targetUserObj ? await targetUserObj.fetch().catch(() => targetUserObj) : null;
            const guild = interaction.guild;
            const member = await guild.members.fetch(targetUserId).catch(() => null);

            const newEmbed = new EmbedBuilder()
                .setColor("#481f86")
                .setAuthor({ name: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
                .setFooter({ text: `Yêu cầu bởi ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            if (type === "uavatar") {
                if (!fetchedTarget) return interaction.reply({ content: "<a:milk1:1543226643961610352> Không tìm thấy thông tin người dùng!", ephemeral: true });
                newEmbed.setTitle(`Avatar cá nhân của ${fetchedTarget.tag}`);
                newEmbed.setImage(fetchedTarget.displayAvatarURL({ size: 1024, dynamic: true }));
            } 
            else if (type === "ubanner") {
                if (!fetchedTarget) return interaction.reply({ content: "<a:milk1:1543226643961610352> Không tìm thấy thông tin người dùng!", ephemeral: true });
                const bannerURL = fetchedTarget.bannerURL({ size: 1024, dynamic: true });
                if (!bannerURL) {
                    return interaction.reply({ content: `<a:milk1:1543226643961610352> Người dùng **${fetchedTarget.tag}** không có banner cá nhân!`, ephemeral: true });
                }
                newEmbed.setTitle(`Banner cá nhân của ${fetchedTarget.tag}`);
                newEmbed.setImage(bannerURL);
            } 
            else if (type === "savatar") {
                if (!member) return interaction.reply({ content: "<a:milk1:1543226643961610352> Không tìm thấy thành viên này trong server!", ephemeral: true });
                const serverAvatar = member.displayAvatarURL({ size: 1024, dynamic: true });
                newEmbed.setTitle(`Server Avatar của ${member.user.tag}`);
                newEmbed.setImage(serverAvatar);
            } 
            else if (type === "sbanner") {
                if (!member) return interaction.reply({ content: "<a:milk1:1543226643961610352> Không tìm thấy thành viên này trong server!", ephemeral: true });
                const serverBanner = member.bannerURL({ size: 1024, dynamic: true });
                if (!serverBanner) {
                    return interaction.reply({ content: `<a:milk1:1543226643961610352> Thành viên **${member.user.tag}** không có Server Banner riêng trong server này!`, ephemeral: true });
                }
                newEmbed.setTitle(`Server Banner của ${member.user.tag}`);
                newEmbed.setImage(serverBanner);
            }

            const row = getHavActionRow(targetUserId);
            return interaction.update({
                embeds: [newEmbed],
                components: [row]
            });
        }
    }
});

client.login(TOKEN);