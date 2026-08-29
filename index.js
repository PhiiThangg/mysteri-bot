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
const PREFIX = (process.env.PREFIX || "h").replace(/^!/, "").trim() || "h";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});

// ===== Railway -> GitHub: debounce 2 phút sau lần thay đổi cuối =====
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

// ===== QUẢN LÝ WARN (ĐỌC/GHI FILE warns.json) =====
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

// quan ly donate
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

// id role vip theo donate
const vipRoles = {
    1: "1529401042897211473",
    2: "1529401182156488764",
    3: "1529401284686250034",
    4: "1529401414537838592",
    5: "1529401569970491432"
};

// ham tu dong add role khi du donate
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

// Lưu trữ các timeout của giveaway đang chạy để có thể hủy khi dùng lệnh gastop
const activeGiveaways = new Map();

async function tempReply(message, content, time = 5000) {
    const msg = await message.reply(content);

    setTimeout(() => {
        msg.delete().catch(() => {});
    }, time);

    return msg;
}

// Hàm tạo hàng nút bấm cho lệnh hav (Đã gỡ emoji và đổi tên theo yêu cầu)
function getHavActionRow(targetId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`hav_uavatar_${targetId}`).setLabel("Avatar").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`hav_ubanner_${targetId}`).setLabel("Banner").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`hav_savatar_${targetId}`).setLabel("Server Avatar").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`hav_sbanner_${targetId}`).setLabel("Server Banner").setStyle(ButtonStyle.Secondary)
    );
}

// Hàm tạo embed trang chủ Help
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

// Hàm kết thúc giveaway chung
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

        await giveawayMsg.reply("❌ Không có ai tham gia giveaway này!");
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

client.once("ready", () => {
    console.log(`${client.user.tag} đã online!`);
});

client.on("messageCreate", async (message) => {

    if (message.author.bot) return;

    // ===== PING / REPLY BOT =====
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

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ===== BAN =====
    if (command === "ban") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
            return tempReply(
                message,
                `❌ Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Cấm thành viên.`
            );

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "❌ Hãy mention người cần ban.");

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

    // ===== UNBAN =====
    if (command === "unban") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
            return tempReply(
                message,
                `❌ Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Cấm thành viên (Unban).`
            );

        const userId = args[0];

        if (!userId)
            return tempReply(message, "❌ Hãy nhập ID của người cần unban. (Ví dụ: `hunban 123456789012345678`)");

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
            return tempReply(message, "❌ Không tìm thấy ID này trong danh sách bị ban hoặc ID không hợp lệ!");
        }
    }

    // ===== KICK =====
    if (command === "kick") {

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "❌ Hãy mention người cần kick.");

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

    // ===== MUTE =====
    if (command === "mute") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return tempReply(
                message,
                `❌ Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Hạn chế thành viên`
            );

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "❌ Hãy mention người cần mute.");

        const minutes = parseInt(args[1]);

        if (isNaN(minutes))
            return tempReply(message, "❌ Hãy nhập số phút.");

        const reason = args.slice(2).join(" ") || "Không có lý do.";

        await member.timeout(minutes * 60 * 1000, reason);

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle("🔇 Mute thành công")
            .setDescription(`${member} đã bị mute.`)
            .addFields(
                { name: "⏱️ Thời gian", value: `${minutes} phút`, inline: true },
                { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                { name: "📝 Lý do", value: reason }
            );

        return message.reply({ embeds: [embed] });
    }

    // ===== WARN =====
    if (command === "warn") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return tempReply(
                message,
                `❌ Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Cảnh báo thành viên`
            );

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "❌ Hãy mention người cần warn.");

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
            .setTitle("⚠️ Thành viên đã bị cảnh cáo")
            .setDescription(`${member} đã nhận một cảnh cáo.`)
            .addFields(
                { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                { name: "📝 Lý do", value: reason, inline: true },
                { name: "📊 Tổng Warn", value: `${warns[member.id].length}`, inline: true }
            );

        return message.reply({ embeds: [embed] });
    }

    // ===== REMOVE WARN (hrwarn) =====
    if (command === "rwarn") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return tempReply(
                message,
                `❌ Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Cảnh báo thành viên`
            );

        const member = message.mentions.members.first();

        if (!member)
            return tempReply(message, "❌ Hãy mention người cần xóa warn.");

        if (!warns[member.id] || warns[member.id].length === 0)
            return tempReply(message, "❌ Thành viên này không có warn nào để xóa.");

        const index = parseInt(args[1]) - 1;

        if (isNaN(index) || index < 0 || !warns[member.id][index])
            return tempReply(message, `❌ Số thứ tự warn không hợp lệ. Hãy dùng \`${prefix}hcwarn @user\` để xem đúng số thứ tự.`);

        const removed = warns[member.id].splice(index, 1)[0];

        if (warns[member.id].length === 0) {
            delete warns[member.id];
        }

        saveWarns();

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle("🗑️ Xóa cảnh cáo thành công")
            .setDescription(`Đã xóa cảnh cáo số **${index + 1}** của ${member}.`)
            .addFields(
                { name: "📝 Lý do cũ", value: removed.reason, inline: true },
                { name: "📊 Tổng Warn còn lại", value: `${warns[member.id] ? warns[member.id].length : 0}`, inline: true }
            );

        return message.reply({ embeds: [embed] });
    }

    // ===== CHECK WARN (hcwarn) =====
    if (command === "cwarn") {

        const member = message.mentions.members.first() || message.member;

        if (!warns[member.id] || warns[member.id].length === 0) {
            const embed = new EmbedBuilder()
                .setColor("#481f86")
                .setTitle("📊 Thông tin cảnh cáo")
                .setDescription(`✅ ${member} hiện không có cảnh cáo nào.`);
                
            return message.reply({ embeds: [embed] });
        }

        const embed = new EmbedBuilder()
            .setColor("#481f86")
            .setTitle(`📊 Lịch sử cảnh cáo của ${member.user.tag}`)
            .setDescription(`Tổng số cảnh cáo: **${warns[member.id].length}**`);

        warns[member.id].forEach((w, index) => {
            embed.addFields({
                name: `⚠️ Lần ${index + 1}`,
                value: `**Lý do:** ${w.reason}\n**Moderator:** ${w.moderator}\n**Thời gian:** ${w.date}`
            });
        });

        return message.reply({ embeds: [embed] });
    }

    // ===== GIVEAWAY START (hgastart) =====
    if (command === "gastart") {

        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
            return tempReply(message, "❌ Bạn không có quyền quản lý tin nhắn để tạo giveaway!");

        const timeArg = args[0];
        const winArg = args[1];
        const title = args.slice(2).join(" ");

        if (!timeArg || !winArg || !title)
            return tempReply(message, `❌ Sai cú pháp! Hãy sử dụng: \`${prefix}gastart <time> <win> <title>\`!`);

        const timeRegex = /^(\d+)([smhd])$/i;
        const match = timeArg.match(timeRegex);
        if (!match)
            return tempReply(message, "❌ Thời gian không hợp lệ! Dùng định dạng như: `30s`, `5m`, `2h`, `1d`.");

        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        let ms = 0;

        if (unit === 's') ms = value * 1000;
        else if (unit === 'm') ms = value * 60 * 1000;
        else if (unit === 'h') ms = value * 60 * 60 * 1000;
        else if (unit === 'd') ms = value * 24 * 60 * 60 * 1000;

        if (ms <= 0) return tempReply(message, "❌ Thời gian phải lớn hơn 0!");

        const winnerCount = parseInt(winArg.replace(/w/gi, ''));
        if (isNaN(winnerCount) || winnerCount <= 0)
            return tempReply(message, "❌ Số lượng người thắng không hợp lệ! (Ví dụ: `1` hoặc `1w`)");

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

    // ===== GIVEAWAY STOP (hgastop) =====
    if (command === "gastop") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
            return tempReply(message, "❌ Bạn không có quyền quản lý tin nhắn để dừng giveaway!");

        const messageId = args[0];
        if (!messageId)
            return tempReply(message, `❌ Vui lòng nhập ID tin nhắn của giveaway! (Ví dụ: \`${prefix}gastop <message_id>\`)`);

        const gaData = activeGiveaways.get(messageId);
        if (!gaData)
            return tempReply(message, "❌ Không tìm thấy giveaway đang chạy với ID này (hoặc giveaway này đã kết thúc trước đó).");

        clearTimeout(gaData.timeoutId);

        const channel = await client.channels.fetch(gaData.channelId).catch(() => null);
        if (!channel) {
            activeGiveaways.delete(messageId);
            return tempReply(message, "❌ Không tìm thấy kênh chứa giveaway này.");
        }

        await finishGiveaway(channel, messageId, gaData.title, gaData.creator, gaData.winnerCount, gaData.giveawayMsg);
        return tempReply(message, "✅ Đã dừng giveaway và công bố người chiến thắng thành công!");
    }

    // ===== GIVEAWAY REROLL (hgareroll) =====
    if (command === "gareroll") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
            return tempReply(message, "❌ Bạn không có quyền quản lý tin nhắn để quay lại người thắng giveaway!");

        const messageId = args[0];
        if (!messageId)
            return tempReply(message, `❌ Vui lòng nhập ID tin nhắn của giveaway! (Ví dụ: \`${prefix}gareroll <message_id>\`)`);

        const fetchedMsg = await message.channel.messages.fetch(messageId).catch(() => null);
        if (!fetchedMsg)
            return tempReply(message, "❌ Không tìm thấy tin nhắn giveaway với ID này trong kênh hiện tại.");

        const embed = fetchedMsg.embeds[0];
        if (!embed)
            return tempReply(message, "❌ Tin nhắn này không chứa thông tin giveaway hợp lệ.");

        const title = embed.title || "Giveaway";
        
        const desc = embed.description || "";
        const creatorMatch = desc.match(/(?:\*\*Tổ chức bởi\*\*|Tổ chức bởi)\s*:\s*(<@!?\d+>)/);
        const creator = creatorMatch ? creatorMatch[1] : "Người tổ chức";

        const reaction = fetchedMsg.reactions.cache.get("1531654953461088447") || fetchedMsg.reactions.cache.first();
        if (!reaction)
            return tempReply(message, "❌ Không tìm thấy lượt tương tác (reaction) nào trên tin nhắn này.");

        const users = await reaction.users.fetch();
        const participantArray = Array.from(users.filter(u => !u.bot).keys());

        if (participantArray.length === 0)
            return tempReply(message, "❌ Không có người tham gia hợp lệ nào trong giveaway này để quay lại!");

        const randomUserId = participantArray[Math.floor(Math.random() * participantArray.length)];
        const winnerMention = `<@${randomUserId}>`;

        return message.reply(`Reroll! Chúc mừng, ${winnerMention} đã thắng giveaway **${title}** tổ chức bởi ${creator}`);
    }

    // ===== YÊU CẦU XEM AVATAR (hav) =====
    if (command === "hav") {
        const repliedMessage = message.reference ? await message.fetchReference().catch(() => null) : null;
        const targetUser = repliedMessage ? repliedMessage.author : (message.mentions.users.first() || message.author);

        if (targetUser.bot)
            return tempReply(message, "❌ Không thể yêu cầu xem avatar của bot!");

        // Nếu tự xem chính mình (không tag ai, không reply ai hoặc tag chính mình)
        if (targetUser.id === message.author.id) {
            const fetchedTarget = await targetUser.fetch().catch(() => targetUser);
            const avatarURL = fetchedTarget.displayAvatarURL({ size: 1024, dynamic: true });

            const embed = new EmbedBuilder()
                .setColor("#481f86")
                .setTitle(`Avatar của ${fetchedTarget.tag}`)
                .setImage(avatarURL)
                .setFooter({ text: `Yêu cầu bởi ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            const row = getHavActionRow(fetchedTarget.id);

            return message.reply({ embeds: [embed], components: [row] });
        }

        // Xem avatar người khác -> Cần chấp thuận
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

    // ===== ROLE (hrole) =====
    else if (command === "role") {
        if (message.author.id !== OWNER_ID && !message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("❌ Không có quyền")
                .setDescription(`Bạn không có quyền để sử dụng lệnh này!\n\n📌 Quyền hạn: Quản lý vai trò (Manage Roles).`);
            return message.reply({ embeds: [errEmbed] });
        }

        const targetMember = message.mentions.members.first();
        let roleQuery = "";

        if (targetMember) {
            roleQuery = args.slice(1).join(" ");
        } else {
            roleQuery = args.join(" ");
        }

        if (!roleQuery) {
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("❌ Thiếu thông tin")
                .setDescription(`Hãy nhập tên role hoặc mention thành viên!\n\n📌 Ví dụ: \`${prefix}role Cư dân\` hoặc \`${prefix}role @user Cư dân \``);
            return message.reply({ embeds: [errEmbed] });
        }

        const memberToModify = targetMember || message.member;

        // Tìm kiếm role khớp một phần tên (không phân biệt hoa thường)
        const roleToModify = message.guild.roles.cache.find(r => 
            r.name.toLowerCase().includes(roleQuery.toLowerCase())
        );

        if (!roleToModify) {
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("❌ Không tìm thấy role")
                .setDescription(`Không tìm thấy role nào có tên chứa từ khóa: "**${roleQuery}**"!`);
            return message.reply({ embeds: [errEmbed] });
        }

        // Kiểm tra vị trí phân cấp role (Role của bot phải cao hơn role muốn cấp)
        const botMember = message.guild.members.cache.get(client.user.id);
        if (roleToModify.position >= botMember.roles.highest.position) {
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("❌ Lỗi phân cấp")
                .setDescription(`Tôi không thể thêm/gỡ role này vì vị trí của nó cao hơn hoặc bằng role cao nhất của bot!`);
            return message.reply({ embeds: [errEmbed] });
        }

        try {
            if (memberToModify.roles.cache.has(roleToModify.id)) {
                // Nếu thành viên đã có role -> Tiến hành gỡ
                await memberToModify.roles.remove(roleToModify);
                const embed = new EmbedBuilder()
                    .setColor("#481f86")
                    .setTitle("<a:tikhong:1542901135088812092> Gỡ Role thành công")
                    .setDescription(`Đã gỡ role ${roleToModify} khỏi ${memberToModify}.`)
                    .addFields(
                        { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                        { name: "<a:hoatim:1529735587026964491> Role", value: roleToModify.name, inline: true }
                    );
                return message.reply({ embeds: [embed] });
            } else {
                // Nếu thành viên chưa có role -> Tiến hành thêm
                await memberToModify.roles.add(roleToModify);
                const embed = new EmbedBuilder()
                    .setColor("#481f86")
                    .setTitle("<a:tikhong:1542901135088812092> Thêm Role thành công")
                    .setDescription(`Đã thêm role ${roleToModify} cho ${memberToModify}.`)
                    .addFields(
                        { name: "<a:camap:1529737268892274890> Moderator", value: message.author.tag, inline: true },
                        { name: "<a:hoatim:1529735587026964491> Role", value: roleToModify.name, inline: true }
                    );
                return message.reply({ embeds: [embed] });
            }
        } catch (error) {
            console.error(error);
            const errEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("❌ Đã xảy ra lỗi")
                .setDescription(`Không thể thay đổi role! Hãy đảm bảo bot có quyền **Manage Roles** và thứ hạng role của bot nằm ở trên cùng.`);
            return message.reply({ embeds: [errEmbed] });
        }
    }

// ===== DN (Ghi donate & Tự động cấp Role VIP) =====
if (command === "dn") {
        if (
            !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) &&
            !message.member.permissions.has(PermissionsBitField.Flags.Administrator)
        ) {
            return tempReply(message, "❌ Lệnh ghi donate chỉ các Support/Admin được dùng.");
        }

        const member = message.mentions.members.first();
        if (!member)
            return tempReply(message, `❌ Hãy mention thành viên cần ghi donate. (Ví dụ: \`${prefix}dn @user 50k\` hoặc \`${prefix}dn @user 5tr\`)`);

        const rawAmount = args[1];
        if (!rawAmount)
            return tempReply(message, `❌ Vui lòng nhập số tiền donate! (Ví dụ: \`${prefix}dn @user 50k\` hoặc \`${prefix}dn @user 5tr\`)`);

        // Xử lý chuỗi tiền tệ (hỗ trợ k, tr, m và số thường)
        let cleanAmount = rawAmount.toLowerCase().replace(/,/g, '').replace(/\./g, '');
        let multiplier = 1;

        if (cleanAmount.endsWith('k')) {
            multiplier = 1000;
            cleanAmount = cleanAmount.slice(0, -1);
        } else if (cleanAmount.endsWith('tr') || cleanAmount.endsWith('m')) {
            multiplier = 1000000;
            cleanAmount = cleanAmount.endsWith('tr') ? cleanAmount.slice(0, -2) : cleanAmount.slice(0, -1);
        }

        const amount = parseInt(cleanAmount) * multiplier;
        if (isNaN(amount) || amount <= 0)
            return tempReply(message, "❌ Số tiền donate không hợp lệ! (Ví dụ: `10k`, `100k`, `1tr`, `10tr`)");

        // Cập nhật tổng tiền donate của user vào object
        if (!donates[member.id]) {
            donates[member.id] = 0;
        }
        donates[member.id] += amount;
        saveDonates();

        // Tự động kiểm tra và cấp role VIP nếu đạt mốc
        await checkAndAssignVIP(member, donates[member.id]);

        // Format số tiền có dấu phẩy ngăn cách hàng nghìn
        const formattedAmount = amount.toLocaleString("en-US");
        const formattedTotal = donates[member.id].toLocaleString("en-US");

        // Giữ lại tin nhắn lệnh và phản hồi kèm tag người chạy lệnh
        return message.reply(`✅ ${message.author} Đã ghi donate cho ${member} : **+${formattedAmount}** (tổng: **${formattedTotal}**)`);
    }

    // ===== XOADN (Xóa/Trừ bớt donate) =====
    if (command === "xoadn") {
        if (
            !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) &&
            !message.member.permissions.has(PermissionsBitField.Flags.Administrator)
        ) {
            return tempReply(message, "❌ Lệnh xóa donate chỉ các Support/Admin được dùng.");
        }

        const member = message.mentions.members.first();
        if (!member)
            return tempReply(message, `❌ Hãy mention thành viên cần xóa/trừ donate. (Ví dụ: \`${prefix}xoadn @user 30k\` hoặc \`${prefix}xoadn @user 1tr\`)`);

        const rawAmount = args[1];
        if (!rawAmount)
            return tempReply(message, `❌ Vui lòng nhập số tiền cần trừ! (Ví dụ: \`${prefix}xoadn @user 30k\` hoặc \`${prefix}xoadn @user 1tr\`)`);

        // Xử lý chuỗi tiền tệ (hỗ trợ k, tr, m và số thường)
        let cleanAmount = rawAmount.toLowerCase().replace(/,/g, '').replace(/\./g, '');
        let multiplier = 1;

        if (cleanAmount.endsWith('k')) {
            multiplier = 1000;
            cleanAmount = cleanAmount.slice(0, -1);
        } else if (cleanAmount.endsWith('tr') || cleanAmount.endsWith('m')) {
            multiplier = 1000000;
            cleanAmount = cleanAmount.endsWith('tr') ? cleanAmount.slice(0, -2) : cleanAmount.slice(0, -1);
        }

        const amount = parseInt(cleanAmount) * multiplier;
        if (isNaN(amount) || amount <= 0)
            return tempReply(message, "❌ Số tiền không hợp lệ! (Ví dụ: `30k`, `100k`, `1tr`)");

        // Kiểm tra xem user có dữ liệu donate chưa
        if (!donates[member.id] || donates[member.id] <= 0) {
            return tempReply(message, `❌ Thành viên ${member} hiện không có lịch sử donate nào để trừ!`);
        }

        // Trừ tiền donate (không để tổng tiền bị âm dưới 0)
        donates[member.id] -= amount;
        if (donates[member.id] < 0) {
            donates[member.id] = 0;
        }
        saveDonates();

        // (Tùy chọn) Có thể gọi lại hàm checkAndAssignVIP nếu muốn hạ cấp role khi tụt mốc, 
        // nhưng hiện tại để đơn giản hệ thống chỉ trừ tiền và lưu file.

        // Format số tiền có dấu phẩy ngăn cách hàng nghìn
        const formattedAmount = amount.toLocaleString("en-US");
        const formattedTotal = donates[member.id].toLocaleString("en-US");

        // Giữ lại tin nhắn lệnh và phản hồi theo đúng định dạng yêu cầu
        return message.reply(`✅ ${message.author} Đã xóa donate cho ${member} : **-${formattedAmount}** (tổng: **${formattedTotal}**)`);
    }

    // ===== HELP (CÓ MENU TƯƠNG TÁC) =====
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

// ===== XỬ LÝ SỰ KIỆN TƯƠNG TÁC (MENU & BUTTON) =====
client.on("interactionCreate", async (interaction) => {
    // 1. Xử lý Select Menu (Help)
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

    // 2. Xử lý Button
    if (interaction.isButton()) {
        const customId = interaction.customId;

        // Xử lý Chấp nhận / Từ chối yêu cầu xem avatar người khác
        if (customId.startsWith("av_accept_") || customId.startsWith("av_deny_")) {
            const parts = customId.split("_");
            const action = parts[1]; // accept hoặc deny
            const targetUserId = parts[2];
            const requesterId = parts[3];

            if (interaction.user.id !== targetUserId) {
                return interaction.reply({
                    content: "❌ Bạn không phải là người được yêu cầu xem avatar nên không thể bấm nút này!",
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
                    .setDescription(`✅ Đã chấp nhận yêu cầu xem avatar từ <@${requesterId}>`)
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
                    .setDescription(`❌ ${interaction.user} đã **từ chối** yêu cầu xem avatar từ <@${requesterId}>`)
                    .setTimestamp();

                return interaction.update({
                    content: `<@${requesterId}>`,
                    embeds: [deniedEmbed],
                    components: []
                });
            }
        }

        // Xử lý các nút chuyển đổi (Avatar, Banner, Server Avatar, Server Banner)
        if (
            customId.startsWith("hav_uavatar_") ||
            customId.startsWith("hav_ubanner_") ||
            customId.startsWith("hav_savatar_") ||
            customId.startsWith("hav_sbanner_")
        ) {
            const parts = customId.split("_");
            const type = parts[1]; // uavatar, ubanner, savatar, sbanner
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
                if (!fetchedTarget) return interaction.reply({ content: "❌ Không tìm thấy thông tin người dùng!", ephemeral: true });
                newEmbed.setTitle(`Avatar cá nhân của ${fetchedTarget.tag}`);
                newEmbed.setImage(fetchedTarget.displayAvatarURL({ size: 1024, dynamic: true }));
            } 
            else if (type === "ubanner") {
                if (!fetchedTarget) return interaction.reply({ content: "❌ Không tìm thấy thông tin người dùng!", ephemeral: true });
                const bannerURL = fetchedTarget.bannerURL({ size: 1024, dynamic: true });
                if (!bannerURL) {
                    return interaction.reply({ content: `❌ Người dùng **${fetchedTarget.tag}** không có banner cá nhân!`, ephemeral: true });
                }
                newEmbed.setTitle(`Banner cá nhân của ${fetchedTarget.tag}`);
                newEmbed.setImage(bannerURL);
            } 
            else if (type === "savatar") {
                if (!member) return interaction.reply({ content: "❌ Không tìm thấy thành viên này trong server!", ephemeral: true });
                const serverAvatar = member.displayAvatarURL({ size: 1024, dynamic: true });
                newEmbed.setTitle(`Server Avatar của ${member.user.tag}`);
                newEmbed.setImage(serverAvatar);
            } 
            else if (type === "sbanner") {
                if (!member) return interaction.reply({ content: "❌ Không tìm thấy thành viên này trong server!", ephemeral: true });
                const serverBanner = member.bannerURL({ size: 1024, dynamic: true });
                if (!serverBanner) {
                    return interaction.reply({ content: `❌ Thành viên **${member.user.tag}** không có Server Banner riêng trong server này!`, ephemeral: true });
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