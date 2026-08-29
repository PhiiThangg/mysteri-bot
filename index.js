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
const PREFIX = (process.env.PREFIX || "sar").replace(/^!/, "").trim() || "sar";
const DATA_FILE = path.join(__dirname, "..", "data", "profiles.json");
const PERMISSION_FILE = path.join(__dirname, "..", "data", "pr_roles.json");
const PR_ADMIN_FILE = path.join(__dirname, "..", "data", "pr_admin_roles.json");
const SALARY_APPROVAL_FILE = path.join(__dirname, "..", "data", "salary_approvals.json");
const AUTORES_FILE = path.join(__dirname, "..", "data", "autores.json");
const KEYWORD_FILE = path.join(__dirname, "..", "data", "pr_keywords.json");
const AI_FILE = path.join(__dirname, "..", "data", "ai_settings.json");
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const DEFAULT_AI_MODEL = process.env.AI_MODEL || "llama-3.3-70b-versatile";
const IMAGE_DIR = path.join(__dirname, "..", "data", "images");
const TICKET_FILE = path.join(__dirname, "..", "data", "tickets.json");
const REACTBILL_FILE = path.join(__dirname, "..", "data", "reactbill.json");
const PROFILE_LINK_FILE = path.join(__dirname, "..", "data", "profile_links.json");
const REACTBILL_IMAGE_FILE = path.join(__dirname, "reactbill_image.png");
const REACTBILL_IMAGE_NAME = "reactbill_image.png";

const PAYMENT_FILE = path.join(__dirname, "..", "data", "payments.json");
const TEMPROLE_FILE = path.join(__dirname, "..", "data", "temproles.json");
const BOOKING_STATS_FILE = path.join(__dirname, "..", "data", "booking_stats.json");
const SALARY_FILE = path.join(__dirname, "..", "data", "salaries.json");
const CASH_FILE = path.join(__dirname, "..", "data", "cash.json");
const SHOP_FILE = path.join(__dirname, "..", "data", "shop.json");
const INVENTORY_FILE = path.join(__dirname, "..", "data", "inventory.json");
const LOG_CHANNELS_FILE = path.join(__dirname, "..", "data", "log_channels.json");
const ANTIRAID_FILE = path.join(__dirname, "..", "data", "antiraid.json");
const ANTINUKE_FILE = path.join(__dirname, "..", "data", "antinuke.json");
const AUTOROLE_FILE = path.join(__dirname, "..", "data", "autorole.json");
const WELCOME_FILE = path.join(__dirname, "..", "data", "welcome.json");
const SEPAY_WEBHOOK_SECRET = process.env.SEPAY_WEBHOOK_SECRET || "";
const SEPAY_BANK_ACCOUNT = process.env.SEPAY_BANK_ACCOUNT || "";
const SEPAY_BANK_CODE = process.env.SEPAY_BANK_CODE || "";
const PAYMENT_PREFIX = (process.env.PAYMENT_PREFIX || "PAY").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8) || "PAY";
const PAYMENT_EXPIRE_MINUTES = Math.max(5, Number(process.env.PAYMENT_EXPIRE_MINUTES) || 30);
const MIN_SALARY_AFTER_PAY = Math.max(0, Number(process.env.MIN_SALARY_AFTER_PAY) || 30000);
let runtimeConfigReload = { autoRole: false, welcome: false, autoRes: false };


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


// ===== GHI FILE JSON KHÔNG BLOCK EVENT LOOP =====
// fs.writeFileSync chặn TOÀN BỘ bot (mọi command/tin nhắn của mọi người) trong
// lúc ghi đĩa. Với bot nhiều người dùng cùng lúc, đổi sang ghi bất đồng bộ +
// atomic rename (ghi ra .tmp rồi rename) để không bao giờ có file half-written
// nếu process bị kill giữa chừng, đồng thời không làm treo event loop.
const pendingJsonWrites = new Map(); // filePath -> Promise (chờ ghi trước xong mới ghi tiếp, tránh ghi đè lộn xộn)
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
}

function loadSalaryData() {
  try {
    const data = JSON.parse(fs.readFileSync(SALARY_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveSalaryData(data) {
  fs.mkdirSync(path.dirname(SALARY_FILE), { recursive: true });
  writeJsonAsync(SALARY_FILE, data);
}
let salaryData = loadSalaryData();

function loadCashData() {
  try {
    const data = JSON.parse(fs.readFileSync(CASH_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveCashData(data) {
  fs.mkdirSync(path.dirname(CASH_FILE), { recursive: true });
  writeJsonAsync(CASH_FILE, data);
}
let cashData = loadCashData();
function getGuildCash(guildId) {
  const id = String(guildId);
  if (!cashData[id] || typeof cashData[id] !== "object") cashData[id] = {};
  return cashData[id];
}
function getCashBalance(guildId, userId) {
  const guild = getGuildCash(guildId);
  return Number(guild[userId] || 0);
}
function setCashBalance(guildId, userId, amount) {
  const guild = getGuildCash(guildId);
  guild[userId] = Math.max(0, Math.floor(Number(amount) || 0));
}
function cashMoney(value) { return `${Number(value || 0).toLocaleString("vi-VN")} cash`; }

// ===== SHOP (mua bằng Cash) & INVENTORY =====
function loadShopData() {
  try {
    const data = JSON.parse(fs.readFileSync(SHOP_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveShopData(data) {
  fs.mkdirSync(path.dirname(SHOP_FILE), { recursive: true });
  writeJsonAsync(SHOP_FILE, data);
}
let shopData = loadShopData();
function getGuildShop(guildId) {
  const id = String(guildId);
  if (!shopData[id] || !Array.isArray(shopData[id].items)) shopData[id] = { items: [] };
  return shopData[id];
}
function findShopItemByName(guildId, name) {
  const shop = getGuildShop(guildId);
  const lower = String(name || "").trim().toLowerCase();
  return shop.items.find(i => i.name.toLowerCase() === lower) || null;
}

function loadInventoryData() {
  try {
    const data = JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveInventoryData(data) {
  fs.mkdirSync(path.dirname(INVENTORY_FILE), { recursive: true });
  writeJsonAsync(INVENTORY_FILE, data);
}
let inventoryData = loadInventoryData();
function getGuildInventory(guildId) {
  const id = String(guildId);
  if (!inventoryData[id] || typeof inventoryData[id] !== "object") inventoryData[id] = {};
  return inventoryData[id];
}
function getUserInventory(guildId, userId) {
  const guildInv = getGuildInventory(guildId);
  if (!Array.isArray(guildInv[userId])) guildInv[userId] = [];
  return guildInv[userId];
}

// ===== KÊNH LOG (Lương / Ticket / React Bill) =====
function loadLogChannels() {
  try {
    const data = JSON.parse(fs.readFileSync(LOG_CHANNELS_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveLogChannels(data) {
  fs.mkdirSync(path.dirname(LOG_CHANNELS_FILE), { recursive: true });
  writeJsonAsync(LOG_CHANNELS_FILE, data);
}
let logChannelsData = loadLogChannels();
function getGuildLogChannels(guildId) {
  const id = String(guildId);
  if (!logChannelsData[id] || typeof logChannelsData[id] !== "object") logChannelsData[id] = {};
  return logChannelsData[id];
}
const LOG_TYPES = { luong: "💰 Lương", ticket: "🎫 Ticket", reactbill: "🧾 React Bill", security: "🛡️ Anti-Raid/Anti-Nuke", backup: "💾 Backup Server" };

async function sendLogMessage(guild, type, payload) {
  if (!guild) return;
  const cfg = getGuildLogChannels(guild.id);
  const channelId = cfg[type];
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send(payload).catch(error => console.error(`[Log:${type}]`, error?.message || error));
}

// ===== BACKUP SERVER DISCORD =====
// Lưu snapshot roles/channels/permission overwrites/thông tin server để có thể
// khôi phục lại khi server bị nuke hoặc cấu hình sai. Không backup tin nhắn.
const BACKUP_FILE = path.join(__dirname, "..", "data", "server_backups.json");
function loadBackupData() {
  try {
    const data = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveBackupData(data) {
  fs.mkdirSync(path.dirname(BACKUP_FILE), { recursive: true });
  writeJsonAsync(BACKUP_FILE, data);
}
let backupData = loadBackupData();
function getGuildBackups(guildId) {
  const id = String(guildId);
  if (!backupData[id] || typeof backupData[id] !== "object") backupData[id] = {};
  return backupData[id];
}
function createBackupId() {
  return `bk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const MAX_BACKUPS_PER_GUILD = 10;

async function buildGuildBackup(guild, note, authorId) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id) // @everyone xử lý riêng
    .sort((a, b) => b.position - a.position)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      permissions: r.permissions.bitfield.toString(),
      position: r.position,
      hoist: r.hoist,
      mentionable: r.mentionable,
    }));

  const channels = guild.channels.cache
    .filter(c => c.type !== ChannelType.GuildDirectory)
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map(c => ({
      id: c.id,
      type: c.type,
      name: c.name,
      parentId: c.parentId || null,
      position: c.rawPosition ?? 0,
      topic: c.topic || null,
      nsfw: c.nsfw || false,
      rateLimitPerUser: c.rateLimitPerUser || 0,
      bitrate: c.bitrate || null,
      userLimit: c.userLimit || null,
      overwrites: c.permissionOverwrites?.cache
        ? [...c.permissionOverwrites.cache.values()].map(ow => ({
            id: ow.id,
            type: ow.type,
            allow: ow.allow.bitfield.toString(),
            deny: ow.deny.bitfield.toString(),
          }))
        : [],
    }));

  return {
    id: createBackupId(),
    note: note || "",
    createdBy: authorId,
    createdAt: new Date().toISOString(),
    guild: {
      name: guild.name,
      iconURL: guild.iconURL({ size: 512 }) || null,
      verificationLevel: guild.verificationLevel,
      afkTimeout: guild.afkTimeout,
      afkChannelId: guild.afkChannelId || null,
      everyonePermissions: guild.roles.everyone.permissions.bitfield.toString(),
    },
    roles,
    channels,
  };
}

async function createServerBackup(guild, note, authorId) {
  const backup = await buildGuildBackup(guild, note, authorId);
  const list = getGuildBackups(guild.id);
  list[backup.id] = backup;

  // Giới hạn số backup lưu trữ mỗi server, tự xóa bản cũ nhất khi vượt ngưỡng.
  const ids = Object.keys(list).sort((a, b) => new Date(list[a].createdAt) - new Date(list[b].createdAt));
  while (ids.length > MAX_BACKUPS_PER_GUILD) {
    delete list[ids.shift()];
  }

  saveBackupData(backupData);
  return backup;
}

// Khôi phục backup vào CHÍNH server đã tạo backup đó.
// Chiến lược: nếu role/channel cùng id còn tồn tại -> cập nhật lại cho khớp.
// Nếu không còn (đã bị xóa) -> tạo mới, và ánh xạ id cũ -> id mới để áp
// permission overwrites đúng role khi tạo channel.
async function restoreGuildBackup(guild, backup, progressCb) {
  const roleIdMap = new Map(); // id cũ trong backup -> role hiện tại trong guild
  const report = { rolesUpdated: 0, rolesCreated: 0, channelsUpdated: 0, channelsCreated: 0, errors: [] };

  await guild.roles.fetch();
  await guild.channels.fetch();

  // 1) KHÔI PHỤC ROLE (theo thứ tự position cao -> thấp để giữ đúng thứ bậc)
  const sortedRoles = [...backup.roles].sort((a, b) => b.position - a.position);
  for (const r of sortedRoles) {
    try {
      let role = guild.roles.cache.get(r.id);
      const permissions = BigInt(r.permissions);
      if (role) {
        await role.edit({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions }).catch(() => {});
        report.rolesUpdated++;
      } else {
        role = await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions, reason: "Khôi phục backup server" });
        report.rolesCreated++;
      }
      roleIdMap.set(r.id, role.id);
    } catch (error) {
      report.errors.push(`Role "${r.name}": ${error.message || error}`);
    }
  }
  progressCb?.("roles");

  // 2) KHÔI PHỤC CATEGORY TRƯỚC (để channel con có parent hợp lệ)
  const channelIdMap = new Map();
  const categories = backup.channels.filter(c => c.type === ChannelType.GuildCategory);
  const others = backup.channels.filter(c => c.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position);

  function buildOverwrites(list) {
    return list
      .map(ow => {
        const isRole = ow.type === 0;
        const mappedId = isRole ? (roleIdMap.get(ow.id) || (guild.roles.cache.has(ow.id) ? ow.id : null)) : ow.id;
        if (!mappedId) return null;
        return { id: mappedId, type: ow.type, allow: BigInt(ow.allow), deny: BigInt(ow.deny) };
      })
      .filter(Boolean);
  }

  for (const c of categories) {
    try {
      let channel = guild.channels.cache.get(c.id);
      const overwrites = buildOverwrites(c.overwrites);
      if (channel) {
        await channel.edit({ name: c.name, permissionOverwrites: overwrites }).catch(() => {});
        report.channelsUpdated++;
      } else {
        channel = await guild.channels.create({ name: c.name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: "Khôi phục backup server" });
        report.channelsCreated++;
      }
      channelIdMap.set(c.id, channel.id);
    } catch (error) {
      report.errors.push(`Category "${c.name}": ${error.message || error}`);
    }
  }
  progressCb?.("categories");

  // 3) KHÔI PHỤC CÁC KÊNH CÒN LẠI
  for (const c of others) {
    try {
      const parentId = c.parentId ? (channelIdMap.get(c.parentId) || (guild.channels.cache.has(c.parentId) ? c.parentId : null)) : null;
      const overwrites = buildOverwrites(c.overwrites);
      let channel = guild.channels.cache.get(c.id);

      const options = { name: c.name, parent: parentId, permissionOverwrites: overwrites };
      if (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) {
        options.topic = c.topic || undefined;
        options.nsfw = c.nsfw;
        options.rateLimitPerUser = c.rateLimitPerUser;
      }
      if (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) {
        if (c.bitrate) options.bitrate = c.bitrate;
        if (c.userLimit) options.userLimit = c.userLimit;
      }

      if (channel) {
        await channel.edit(options).catch(() => {});
        report.channelsUpdated++;
      } else {
        channel = await guild.channels.create({ ...options, type: c.type, reason: "Khôi phục backup server" });
        report.channelsCreated++;
      }
      channelIdMap.set(c.id, channel.id);
    } catch (error) {
      report.errors.push(`Channel "${c.name}": ${error.message || error}`);
    }
  }
  progressCb?.("channels");

  return report;
}

// ===== ANTI-RAID (chống raid hàng loạt tài khoản join) =====
function loadAntiRaidData() {
  try {
    const data = JSON.parse(fs.readFileSync(ANTIRAID_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveAntiRaidData(data) {
  fs.mkdirSync(path.dirname(ANTIRAID_FILE), { recursive: true });
  writeJsonAsync(ANTIRAID_FILE, data);
}
let antiRaidData = loadAntiRaidData();
function getGuildAntiRaid(guildId) {
  const id = String(guildId);
  if (!antiRaidData[id] || typeof antiRaidData[id] !== "object") {
    antiRaidData[id] = {
      enabled: false,
      joinThreshold: 5,      // số lượng join
      joinWindowSec: 10,     // ...trong khoảng bao nhiêu giây thì coi là raid
      lockdownMinutes: 10,   // raid mode kéo dài bao lâu
      action: "kick",        // "kick" | "ban" — áp dụng cho member bị xử lý khi raid mode / tài khoản quá mới
      minAccountAgeHours: 0, // 0 = tắt lọc tài khoản mới; > 0 = tài khoản mới hơn N giờ luôn bị xử lý
      lockdownUntil: 0,
    };
  }
  return antiRaidData[id];
}
const raidJoinTracker = new Map(); // guildId -> [timestamps]

// ===== ANTI-NUKE (chống hành vi phá server từ tài khoản có quyền) =====
function loadAntiNukeData() {
  try {
    const data = JSON.parse(fs.readFileSync(ANTINUKE_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveAntiNukeData(data) {
  fs.mkdirSync(path.dirname(ANTINUKE_FILE), { recursive: true });
  writeJsonAsync(ANTINUKE_FILE, data);
}
let antiNukeData = loadAntiNukeData();
function getGuildAntiNuke(guildId) {
  const id = String(guildId);
  if (!antiNukeData[id] || typeof antiNukeData[id] !== "object") {
    antiNukeData[id] = {
      enabled: false,
      threshold: 3,       // số hành động nguy hiểm
      windowSec: 30,       // ...trong khoảng bao nhiêu giây
      action: "strip",     // "strip" (gỡ hết role) | "kick" | "ban"
      whitelistUserIds: [],
      whitelistRoleIds: [],
    };
  }
  const cfg = antiNukeData[id];
  if (!Array.isArray(cfg.whitelistUserIds)) cfg.whitelistUserIds = [];
  if (!Array.isArray(cfg.whitelistRoleIds)) cfg.whitelistRoleIds = [];
  return cfg;
}
const nukeActionTracker = new Map(); // guildId -> Map(executorId -> [timestamps])
const DANGEROUS_AUDIT_EVENTS = new Set([
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberKick,
  AuditLogEvent.WebhookCreate,
]);

function isGuildOwner(message) {
  return Boolean(message.guild && message.guild.ownerId === message.author.id);
}

// Anti-Raid/Anti-Nuke là cấu hình nhạy cảm: chỉ Owner, Administrator thật sự,
// hoặc PR Admin (quyền cao nhất trong hệ thống PR của bot) mới được đụng vào.
function canManageSecurity(message) {
  if (isGuildOwner(message)) return true;
  if (message.member?.permissions?.has("Administrator")) return true;
  return hasPRAdminRole(message);
}

function loadAutoRoleData() {
  try {
    const data = JSON.parse(fs.readFileSync(AUTOROLE_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveAutoRoleData(data) {
  fs.mkdirSync(path.dirname(AUTOROLE_FILE), { recursive: true });
  writeJsonAsync(AUTOROLE_FILE, data);
}
let autoRoleData = loadAutoRoleData();
function getGuildAutoRole(guildId) {
  const id = String(guildId);
  if (!autoRoleData[id] || typeof autoRoleData[id] !== "object") autoRoleData[id] = {};
  return autoRoleData[id];
}

async function handleAutoRoleSlash(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "autorole") return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const sub = interaction.options.getSubcommand();
  const cfg = getGuildAutoRole(interaction.guild.id);

  if (sub === "set") {
    const role = interaction.options.getRole("role", true);
    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);

    if (!me) {
      await interaction.reply({ content: "❌ Không lấy được thông tin bot trong server.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!me.permissions.has("ManageRoles")) {
      await interaction.reply({ content: "❌ Bot cần quyền **Manage Roles** để cấp AutoRole.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (role.managed) {
      await interaction.reply({ content: "❌ Không thể dùng role Managed/Integration làm AutoRole.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!role.editable || role.position >= me.roles.highest.position) {
      await interaction.reply({ content: `❌ Bot không thể cấp ${role}. Hãy kéo role của bot lên cao hơn role này.`, flags: MessageFlags.Ephemeral });
      return true;
    }

    cfg.roleId = role.id;
    saveAutoRoleData(autoRoleData);
    await interaction.reply({ content: `✅ Đã đặt AutoRole thành ${role}. Thành viên mới vào server sẽ tự nhận role này.` });
    return true;
  }

  if (sub === "off") {
    if (!cfg.roleId) {
      await interaction.reply({ content: "ℹ️ Server này chưa bật AutoRole.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const oldRole = interaction.guild.roles.cache.get(cfg.roleId);
    delete cfg.roleId;
    saveAutoRoleData(autoRoleData);
    await interaction.reply({ content: `🛑 Đã tắt AutoRole${oldRole ? ` (${oldRole})` : ""}.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (sub === "view") {
    if (!cfg.roleId) {
      await interaction.reply({ content: "ℹ️ Server này chưa cài AutoRole.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const role = interaction.guild.roles.cache.get(cfg.roleId);
    await interaction.reply({
      content: role ? `🤖 AutoRole hiện tại: ${role}` : `⚠️ AutoRole đang trỏ tới role không còn tồn tại.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

async function applyAutoRole(member) {
  if (!member?.guild) return;
  if (runtimeConfigReload.autoRole) {
    autoRoleData = loadAutoRoleData();
    runtimeConfigReload.autoRole = false;
  }
  const cfg = autoRoleData[String(member.guild.id)];
  if (!cfg?.roleId) return;

  const role = member.guild.roles.cache.get(cfg.roleId) || await member.guild.roles.fetch(cfg.roleId).catch(() => null);
  if (!role || role.managed) return;

  const me = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
  if (!me || !me.permissions.has("ManageRoles") || !role.editable || role.position >= me.roles.highest.position) {
    console.warn(`[AutoRole] Không thể cấp role ${cfg.roleId} tại guild ${member.guild.id}. Kiểm tra Manage Roles và hierarchy.`);
    return;
  }

  if (member.roles.cache.has(role.id)) return;
  await member.roles.add(role, "AutoRole khi thành viên tham gia server").catch(error => {
    console.warn(`[AutoRole] Không thể cấp role cho ${member.user?.tag || member.id}:`, error.message || error);
  });
}

// ===== THÔNG BÁO CHÀO MỪNG THÀNH VIÊN MỚI (sar tb wlc) =====
function loadWelcomeData() {
  try {
    const data = JSON.parse(fs.readFileSync(WELCOME_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function saveWelcomeData(data) {
  fs.mkdirSync(path.dirname(WELCOME_FILE), { recursive: true });
  writeJsonAsync(WELCOME_FILE, data);
}
let welcomeData = loadWelcomeData();
function getGuildWelcome(guildId) {
  const id = String(guildId);
  if (!welcomeData[id] || typeof welcomeData[id] !== "object") welcomeData[id] = {};
  return welcomeData[id];
}

const DEFAULT_WELCOME_MESSAGE =
  "🎉 Chào mừng {user} đã đến với **{server}**!\nBạn là thành viên thứ **#{membercount}** của server.";

function formatWelcomeMessage(template, member) {
  const text = (template && String(template).trim()) || DEFAULT_WELCOME_MESSAGE;
  return text
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{username\}/g, member.user?.username || member.displayName || "bạn")
    .replace(/\{server\}/g, member.guild?.name || "server")
    .replace(/\{membercount\}/g, String(member.guild?.memberCount ?? "?"));
}

function buildWelcomeEmbed(member, cfg) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setDescription(formatWelcomeMessage(cfg.message, member))
    .setFooter({ text: `${member.guild.name} • Thành viên thứ ${member.guild.memberCount}` })
    .setTimestamp();
  const bannerUrl = member.guild.bannerURL?.({ extension: "png", size: 1024 });
  const imageUrl = cfg.imageUrl || bannerUrl;
  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

async function sendWelcomeMessage(member) {
  if (!member?.guild) return;
  if (runtimeConfigReload.welcome) {
    welcomeData = loadWelcomeData();
    runtimeConfigReload.welcome = false;
  }
  const cfg = welcomeData[String(member.guild.id)];
  if (!cfg?.enabled || !cfg.channelId) return;

  const channel =
    member.guild.channels.cache.get(cfg.channelId) ||
    (await member.guild.channels.fetch(cfg.channelId).catch(() => null));
  if (!channel || !channel.isTextBased?.()) return;

  const me = member.guild.members.me || (await member.guild.members.fetchMe().catch(() => null));
  if (me && !channel.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages)) return;

  await channel.send({ embeds: [buildWelcomeEmbed(member, cfg)] }).catch(error => {
    console.warn(`[Welcome] Không thể gửi tin chào tại guild ${member.guild.id}:`, error.message || error);
  });
}

function welcomeHelpText(cfg, guild) {
  const channel = cfg.channelId ? guild.channels.cache.get(cfg.channelId) : null;
  return [
    "**👋 THÔNG BÁO CHÀO MỪNG (WELCOME)**",
    `Trạng thái: ${cfg.enabled && cfg.channelId ? "🟢 Đang bật" : "🔴 Đang tắt"}${channel ? ` — kênh ${channel}` : ""}`,
    "",
    "`sar tb wlc set #kenh` — đặt kênh gửi tin chào (tự động bật)",
    "`sar tb wlc msg Nội dung` — đặt nội dung tin chào, hỗ trợ `{user}` `{username}` `{server}` `{membercount}`",
    "`sar tb wlc img <link>` — đặt ảnh/gif lớn cho tin chào (hoặc đính kèm ảnh/gif cùng lệnh)",
    "`sar tb wlc img off` — gỡ ảnh/gif riêng, dùng lại banner server (nếu có)",
    "`sar tb wlc on` / `sar tb wlc off` — bật / tắt",
    "`sar tb wlc test` — gửi thử tin chào vào kênh đã đặt",
    "`sar tb wlc view` — xem cấu hình hiện tại",
  ].join("\n");
}

async function handleWelcomeCommand(message, args, messageRawValue) {
  const cfg = getGuildWelcome(message.guild.id);
  const sub = (args[0] || "").toLowerCase();

  if (!sub) {
    return message.channel.send(welcomeHelpText(cfg, message.guild));
  }

  if (sub === "set") {
    const raw = (args[1] || "").trim();
    const channel =
      message.mentions.channels.first() ||
      (raw ? message.guild.channels.cache.get(raw.replace(/[<#>]/g, "")) : null);
    if (!channel || !channel.isTextBased?.()) {
      return message.channel.send("Dùng: `sar tb wlc set #kenh`");
    }
    const me = message.guild.members.me || (await message.guild.members.fetchMe().catch(() => null));
    if (me && !channel.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages)) {
      return message.channel.send(`❌ Bot không có quyền gửi tin nhắn tại ${channel}.`);
    }
    cfg.channelId = channel.id;
    cfg.enabled = true;
    saveWelcomeData(welcomeData);
    return message.channel.send(`✅ Đã đặt kênh chào mừng thành viên mới: ${channel}. Đã tự động bật.`);
  }

  if (sub === "img" || sub === "gif") {
    const second = (args[1] || "").trim();
    if (second.toLowerCase() === "off") {
      delete cfg.imageUrl;
      saveWelcomeData(welcomeData);
      return message.channel.send("🗑️ Đã gỡ ảnh/gif riêng, tin chào dùng lại banner server (nếu có).");
    }

    const attachment = message.attachments.first();
    const url = attachment?.url || second;
    if (!url || !/^https?:\/\//i.test(url)) {
      return message.channel.send(
        "Dùng: `sar tb wlc img <link ảnh/gif>` hoặc đính kèm ảnh/gif cùng lệnh `sar tb wlc img`."
      );
    }
    cfg.imageUrl = url;
    saveWelcomeData(welcomeData);
    return message.channel.send("✅ Đã đặt ảnh/gif cho tin chào mừng.");
  }

  if (sub === "msg" || sub === "message") {
    const value = (messageRawValue || "").trim();
    if (!value) {
      return message.channel.send(
        "Dùng: `sar tb wlc msg Nội dung...` (hỗ trợ `{user}` `{username}` `{server}` `{membercount}`)"
      );
    }
    cfg.message = value;
    saveWelcomeData(welcomeData);
    return message.channel.send("✅ Đã cập nhật nội dung tin chào mừng.");
  }

  if (sub === "on") {
    if (!cfg.channelId) return message.channel.send("❌ Chưa đặt kênh. Dùng `sar tb wlc set #kenh` trước.");
    cfg.enabled = true;
    saveWelcomeData(welcomeData);
    return message.channel.send("✅ Đã bật thông báo chào mừng thành viên mới.");
  }

  if (sub === "off") {
    cfg.enabled = false;
    saveWelcomeData(welcomeData);
    return message.channel.send("🛑 Đã tắt thông báo chào mừng thành viên mới.");
  }

  if (sub === "view") {
    return message.channel.send(welcomeHelpText(cfg, message.guild));
  }

  if (sub === "test") {
    if (!cfg.channelId) return message.channel.send("❌ Chưa đặt kênh. Dùng `sar tb wlc set #kenh` trước.");
    const channel =
      message.guild.channels.cache.get(cfg.channelId) ||
      (await message.guild.channels.fetch(cfg.channelId).catch(() => null));
    if (!channel || !channel.isTextBased?.()) return message.channel.send("❌ Không tìm thấy kênh đã đặt.");
    await channel.send({ embeds: [buildWelcomeEmbed(message.member, cfg)] });
    return message.channel.send(`✅ Đã gửi thử tin chào vào ${channel}.`);
  }

  return message.channel.send("Không hiểu lệnh con. Dùng `sar tb wlc set|msg|on|off|view|test`.");
}

function getGuildSalary(guildId) {
  if (!salaryData[guildId] || typeof salaryData[guildId] !== "object") salaryData[guildId] = { entries: [] };
  if (!Array.isArray(salaryData[guildId].entries)) salaryData[guildId].entries = [];
  return salaryData[guildId];
}
function salaryWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(d.getDate() + diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
function salaryEntriesForWeek(guildId, userId, date = new Date()) {
  const { start, end } = salaryWeekRange(date);
  const targetId = String(userId);
  return getGuildSalary(guildId).entries.filter(e => {
    if (!e || String(e.userId) !== targetId) return false;
    const time = Date.parse(e.at);
    // Entry cũ không có timestamp vẫn được tính thay vì làm bảng lương trống.
    return !Number.isFinite(time) || (time >= start.getTime() && time <= end.getTime());
  });
}
function salaryMoney(value) { return `${Number(value || 0).toLocaleString("vi-VN")} đ`; }
// Lương ròng (net) trong tuần hiện tại của 1 player — dùng chung cho bảng lương
// và tính năng thanh toán bill bằng lương (sar/pay luong).
function calcNetSalaryWeek(guildId, userId) {
  const entries = salaryEntriesForWeek(guildId, userId);
  const workAmount = entries.filter(e => e.type === "work").reduce((a, e) => a + Number(e.amount || 0), 0);
  const donate = entries.filter(e => e.type === "donate").reduce((a, e) => a + Number(e.amount || 0), 0);
  const advance = entries.filter(e => e.type === "advance" || e.type === "deduct").reduce((a, e) => a + Number(e.amount || 0), 0);
  return workAmount + donate - advance;
}
function parseMoney(value) {
  const n = Number(String(value || "").replace(/[^0-9-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}
function parseHours(value) {
  const m = String(value || "").replace(",", ".").match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : NaN;
}
function escapeXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function salarySvg(data) {
  const W = 1000, H = 1180;
  const money = n => Number(n || 0).toLocaleString("vi-VN");
  const lines = (items, x, y, max = 5) => items.slice(0, max).map((it, i) => `<text x="${x}" y="${y + i * 34}" class="body">◆ ${escapeXml(it)}</text>`).join("");
  const avatar = data.avatarUrl ? `<defs><clipPath id="avatarClip"><circle cx="132" cy="142" r="60"/></clipPath></defs><circle cx="132" cy="142" r="68" fill="#0b1018" stroke="#d6a93a" stroke-width="3"/><image href="${escapeXml(data.avatarUrl)}" x="72" y="82" width="120" height="120" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>` : `<circle cx="132" cy="142" r="60" fill="#20252d"/>`;
  const morning = data.morning;
  const night = data.night;
  const rows1 = morning.items.length ? lines(morning.items, 128, 360, 8) : `<text x="128" y="360" class="muted">— chưa có bill —</text>`;
  const rows2 = night.items.length ? lines(night.items, 128, 590, 8) : `<text x="128" y="590" class="muted">— chưa có bill —</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05090f"/><stop offset="0.55" stop-color="#101923"/><stop offset="1" stop-color="#070b12"/></linearGradient></defs>
  <rect width="1000" height="1180" fill="url(#bg)"/>
  <rect x="42" y="42" width="916" height="1096" rx="8" fill="none" stroke="#d6a93a" stroke-width="4"/>
  <text x="240" y="88" class="label">BẢNG LƯƠNG CÁ NHÂN</text>
  ${avatar}
  <text x="240" y="140" class="title">${escapeXml(data.profileName)}</text>
  <text x="240" y="177" class="sub">@${escapeXml(data.username)} • ${escapeXml(data.date)}</text>
  <line x1="70" y1="235" x2="930" y2="235" stroke="#8f7227" stroke-width="2"/>
  <rect x="70" y="285" width="860" height="210" rx="18" fill="#080e17" stroke="#9a7928" stroke-width="2"/>
  <text x="94" y="328" class="section">CA SÁNG</text><line x1="94" y1="342" x2="906" y2="342" stroke="#a17e2a"/>
  ${rows1}<rect x="90" y="438" width="820" height="44" rx="8" fill="#211b0d"/><text x="112" y="468" class="total">Tổng ${morning.hours}h</text><text x="875" y="468" class="total right">${money(morning.amount)} đ</text>
  <rect x="70" y="515" width="860" height="210" rx="18" fill="#080e17" stroke="#9a7928" stroke-width="2"/>
  <text x="94" y="558" class="section">CA ĐÊM</text><line x1="94" y1="572" x2="906" y2="572" stroke="#a17e2a"/>
  ${rows2}<rect x="90" y="668" width="820" height="44" rx="8" fill="#211b0d"/><text x="112" y="698" class="total">Tổng ${night.hours}h</text><text x="875" y="698" class="total right">${money(night.amount)} đ</text>
  <rect x="70" y="745" width="860" height="220" rx="18" fill="#080e17" stroke="#9a7928" stroke-width="2"/>
  <text x="94" y="788" class="section">CHI TIẾT THU NHẬP</text><line x1="94" y1="802" x2="906" y2="802" stroke="#a17e2a"/>
  <text x="110" y="850" class="body big">Tiền giờ (Sáng + Đêm)</text><text x="875" y="850" class="body big right">${money(data.workAmount)} đ</text>
  <text x="110" y="892" class="muted big">Donate</text><text x="875" y="892" class="blue big right">${money(data.donate)} đ</text>
  <text x="110" y="934" class="muted big">Đã ứng / dùng</text><text x="875" y="934" class="orange big right">${money(data.advance)} đ</text>
  <rect x="70" y="995" width="860" height="105" rx="18" fill="#2a200b" stroke="#d6a93a" stroke-width="3"/>
  <text x="500" y="1028" class="label center">LƯƠNG THỰC NHẬN</text><text x="500" y="1080" class="salary center">${money(data.net)} VND</text>
  <style>
  .label{font:700 18px "DejaVu Sans",Arial,sans-serif;fill:#d9ad43;letter-spacing:1px}.title{font:800 40px "DejaVu Sans",Arial,sans-serif;fill:#f3ead6}.sub{font:18px "DejaVu Sans",Arial,sans-serif;fill:#9aa6b5}.section{font:800 20px "DejaVu Sans",Arial,sans-serif;fill:#e1b64e}.body{font:18px "DejaVu Sans",Arial,sans-serif;fill:#e5e0d5}.big{font-size:21px}.muted{font:18px "DejaVu Sans",Arial,sans-serif;fill:#8190a3}.total{font:700 20px "DejaVu Sans",Arial,sans-serif;fill:#e6c56c}.right{text-anchor:end}.blue{fill:#6bb7ff}.orange{fill:#e5ae4d}.salary{font:800 45px "DejaVu Sans",Arial,sans-serif;fill:#c99d3c}.center{text-anchor:middle}
  </style></svg>`;
}
async function makeSalaryAttachment(data) {
  const avatarDataUri = await avatarDataUriFromUrl(data.avatarUrl);
  const svg = salarySvg({ ...data, avatarUrl: avatarDataUri });
  try {
    // Bắt sharp/fontconfig dùng font Unicode được đóng gói cùng bot.
    // Không phụ thuộc font có sẵn trên VPS/hosting.
    const fontConfig = path.join(__dirname, "fonts.conf");
    if (fs.existsSync(fontConfig)) {
      process.env.FONTCONFIG_FILE = fontConfig;
      process.env.FONTCONFIG_PATH = __dirname;
    }
    const sharp = require("sharp");
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return new AttachmentBuilder(buffer, { name: "bang-luong.png" });
  } catch (error) {
    console.warn("sharp chưa có, gửi bảng lương SVG thay thế:", error.message || error);
    return new AttachmentBuilder(Buffer.from(svg), { name: "bang-luong.svg" });
  }
}
function buildSalaryView(guildId, user, profile = null) {
  const entries = salaryEntriesForWeek(guildId, user.id);
  const workEntries = entries.filter(e => e.type === "work");
  const morning = workEntries.filter(e => (e.shift || "sang") === "sang");
  const night = workEntries.filter(e => (e.shift || "sang") === "dem");
  const sum = arr => arr.reduce((a, e) => a + Number(e.amount || 0), 0);
  const hours = arr => arr.reduce((a, e) => a + Number(e.hours || 0), 0);
  const donate = entries.filter(e => e.type === "donate").reduce((a,e)=>a+Number(e.amount||0),0);
  const advance = entries.filter(e => e.type === "advance" || e.type === "deduct").reduce((a,e)=>a+Number(e.amount||0),0);
  const workAmount = sum(morning) + sum(night);
  const net = workAmount + donate - advance;
  const itemText = e => `${e.hours || 0}h — ${salaryMoney(e.amount)}${e.note ? ` • ${e.note}` : ""}`;
  const { start, end } = salaryWeekRange();

  // Dùng tên Discord làm tên chính của bảng lương. Profile cũ có thể chứa
  // displayName là custom emoji / dữ liệu cũ nên không nên để nó phá giao diện.
  const profileName = String(user.username || `Player ${user.id}`);
  return {
    profileName,
    username: user.username || `Player ${user.id}`,
    date: new Date().toLocaleDateString("vi-VN"),
    week: `${start.toLocaleDateString("vi-VN")} - ${end.toLocaleDateString("vi-VN")}`,
    avatarUrl: user.displayAvatarURL({ extension: "png", size: 256 }),
    morning: { items: morning.map(itemText), hours: hours(morning), amount: sum(morning) },
    night: { items: night.map(itemText), hours: hours(night), amount: sum(night) },
    workAmount, donate, advance, net,
  };
}

async function avatarDataUriFromUrl(url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn("Không tải được avatar Discord cho bảng lương:", error.message || error);
    return null;
  }
}

function loadPayments() { try { const data = JSON.parse(fs.readFileSync(PAYMENT_FILE, "utf8")); return data && typeof data === "object" ? data : {}; } catch { return {}; } }
function savePayments(data) { writeJsonAsync(PAYMENT_FILE, data); }
// Lưu các role tạm thời (srole @User @Role <thời gian>) đang chờ tự gỡ, dạng
// { [entryId]: { guildId, userId, roleId, expiresAt, addedBy, roleLabel } }.
// Nhờ có file này mà nếu bot restart giữa lúc đang đếm giờ, khi khởi động lại
// bot vẫn quét thấy và gỡ role đúng hạn (hoặc gỡ ngay nếu đã quá hạn lúc restart).
function loadTempRoles() { try { const data = JSON.parse(fs.readFileSync(TEMPROLE_FILE, "utf8")); return data && typeof data === "object" ? data : {}; } catch { return {}; } }
function saveTempRoles(data) { writeJsonAsync(TEMPROLE_FILE, data); }
function loadBookingStats() { try { const data = JSON.parse(fs.readFileSync(BOOKING_STATS_FILE, "utf8")); return data && typeof data === "object" ? data : {}; } catch { return {}; } }
function saveBookingStats(data) { writeJsonAsync(BOOKING_STATS_FILE, data); }
let bookingStats = loadBookingStats();
function getBookingStats(guildId, userId) {
  if (!bookingStats[guildId] || typeof bookingStats[guildId] !== "object") bookingStats[guildId] = {};
  if (!bookingStats[guildId][userId] || typeof bookingStats[guildId][userId] !== "object") bookingStats[guildId][userId] = { hours: 0, amount: 0 };
  const stat = bookingStats[guildId][userId];
  stat.hours = Number.isFinite(Number(stat.hours)) ? Number(stat.hours) : 0;
  stat.amount = Number.isFinite(Number(stat.amount)) ? Number(stat.amount) : 0;
  return stat;
}
function addBookingStats(guildId, userId, hours, amount) {
  const stat = getBookingStats(guildId, userId);
  stat.hours = Math.max(0, stat.hours + Number(hours || 0));
  stat.amount = Math.max(0, stat.amount + Number(amount || 0));
  saveBookingStats(bookingStats);
  return stat;
}
let paymentData = loadPayments();
let tempRoleData = loadTempRoles();
function generatePaymentCode() { let code; do code = `${PAYMENT_PREFIX}${crypto.randomBytes(4).toString("hex").toUpperCase()}`; while (paymentData[code]); return code; }
function formatVnd(amount) { return `${Number(amount).toLocaleString("vi-VN")} VNĐ`; }
function buildVietQrUrl(amount, code) {
  if (!SEPAY_BANK_ACCOUNT || !SEPAY_BANK_CODE) return null;
  const params = new URLSearchParams({ acc: SEPAY_BANK_ACCOUNT, bank: SEPAY_BANK_CODE, amount: String(amount), des: code, template: "compact" });
  return `https://vietqr.app/img?${params.toString()}`;
}
function buildPaymentPayload(payment) {
  const paid = payment.status === "paid", expired = payment.status === "expired", refunded = payment.status === "refunded";
  const pending = !paid && !expired && !refunded;
  const isCash = payment.type === "cash";
  const paidBySalary = paid && payment.paidVia === "salary";
  const embed = new EmbedBuilder()
    .setColor(refunded ? 0x99aab5 : paid ? 0x57f287 : expired ? 0xed4245 : 0xfee75c)
    .setTitle(isCash ? "💵 NẠP CASH" : "💳 THANH TOÁN")
    .setDescription(
      refunded ? "↩️ **Bill đã được refund.**"
      : paidBySalary ? "✅ **Đã thanh toán bằng lương!**"
      : paid ? (isCash ? "✅ **Nạp Cash thành công!**" : "✅ **Thanh toán thành công!**")
      : expired ? "❌ **Đơn thanh toán đã hết hạn.**"
      : "⏳ **Đang chờ thanh toán...**"
    )
    .addFields(
      { name: "💰 Số tiền", value: `**${formatVnd(payment.amount)}**`, inline: true },
      ...(paidBySalary
        ? [{ name: "🧾 Lương còn lại (tuần)", value: `**${salaryMoney(payment.salaryRemaining ?? 0)}**`, inline: true }]
        : isCash
        ? [{ name: "💵 Cash nhận", value: `**${Math.floor(payment.amount).toLocaleString("vi-VN")} cash**`, inline: true }]
        : [{ name: "⏱️ Số giờ", value: `**${payment.hours || 0} giờ**`, inline: true }]),
      { name: "🧾 Mã thanh toán", value: `\`${payment.code}\``, inline: true },
      { name: "👤 Người nhận", value: `<@${payment.payerId || payment.userId}>`, inline: true },
    );
  if (!paidBySalary) embed.setFooter({ text: pending ? "Quét QR, hoặc bấm nút bên dưới để trả bằng lương." : "Quét QR và giữ nguyên nội dung chuyển khoản." });
  if (paid && !paidBySalary) embed.addFields({ name: "🏦 Mã giao dịch", value: payment.referenceCode ? `\`${payment.referenceCode}\`` : "Đã xác nhận", inline: true });
  const qrUrl = buildVietQrUrl(payment.amount, payment.code);
  if (qrUrl && pending) embed.setImage(qrUrl);
  const components = [];
  if (pending) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`paysalary:${payment.code}`).setLabel("💰 Trả bằng lương").setStyle(ButtonStyle.Secondary)
    ));
  }
  return { embeds: [embed], components };
}
async function updatePaymentMessage(payment) {
  if (!payment.guildId || !payment.channelId || !payment.messageId) return;
  const guild = await client.guilds.fetch(payment.guildId).catch(() => null);
  const channel = await guild?.channels.fetch(payment.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const msg = await channel.messages.fetch(payment.messageId).catch(() => null);
  if (msg) await msg.edit(buildPaymentPayload(payment)).catch(error => console.error("Cập nhật payment message thất bại:", error.message || error));
}
function verifySePayHmac(req, rawBody) {
  if (!SEPAY_WEBHOOK_SECRET) return false;
  const signature = req.headers["x-sepay-signature"], timestamp = req.headers["x-sepay-timestamp"];
  if (typeof signature !== "string" || typeof timestamp !== "string") return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", SEPAY_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Áp dụng hiệu lực khi 1 payment được xác nhận thành công (qua SePay webhook
// hoặc qua nút "Trả bằng lương"): cộng cash/giờ + tự động cộng lương React Bill.
// Trả về danh sách userId đã được cộng lương từ React Bill (nếu có) để báo trong chat.
async function applyPaymentSuccess(payment) {
  if (payment.statsApplied) return [];
  const targetId = payment.payerId || payment.userId;
  if (payment.type === "cash") {
    const currentCash = getCashBalance(payment.guildId, targetId);
    setCashBalance(payment.guildId, targetId, currentCash + Math.floor(payment.amount));
    saveCashData(cashData);
    payment.cashApplied = Math.floor(payment.amount);
  } else {
    addBookingStats(payment.guildId, targetId, payment.hours, payment.amount);
  }

  // Bill được tạo từ panel booking React Bill -> cộng thẳng giờ + lương cho từng player đã chọn.
  let reactBillSalaryPlayerIds = [];
  if (payment.reactBillId) {
    try {
      const rbCfg = getGuildReactBill(payment.guildId);
      const bill = rbCfg.bills[payment.reactBillId];
      if (bill) {
        const salaryEntries = addReactBillPlayerSalaries(payment.guildId, bill, payment.userId);
        reactBillSalaryPlayerIds = salaryEntries.map(e => e.userId);
        payment.reactBillSalaryPlayerIds = reactBillSalaryPlayerIds;
      }
    } catch (error) {
      console.error("[React Bill Salary] Lỗi khi cộng lương tự động:", error);
    }
  }

  payment.statsApplied = true;
  return reactBillSalaryPlayerIds;
}
function paymentWebhookHandler(req, res) {
  let body = ""; req.setEncoding("utf8");
  req.on("data", chunk => { body += chunk; if (body.length > 1_000_000) req.destroy(); });
  req.on("end", async () => {
    try {
      if (!verifySePayHmac(req, body)) { res.writeHead(401, {"Content-Type":"application/json; charset=utf-8"}); return res.end(JSON.stringify({success:false,message:"Invalid signature"})); }
      let payload; try { payload = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, {"Content-Type":"application/json; charset=utf-8"}); return res.end(JSON.stringify({success:false,message:"Invalid JSON"})); }
      console.log("[SePay webhook]", {id:payload.id, code:payload.code, content:payload.content, transferType:payload.transferType, transferAmount:payload.transferAmount, referenceCode:payload.referenceCode});
      if (payload.transferType !== "in") { res.writeHead(200, {"Content-Type":"application/json; charset=utf-8"}); return res.end(JSON.stringify({success:true})); }
      const transactionId = String(payload.id ?? payload.referenceCode ?? "");
      if (!transactionId || Object.values(paymentData).some(p => p.transactionId === transactionId)) { res.writeHead(200, {"Content-Type":"application/json; charset=utf-8"}); return res.end(JSON.stringify({success:true})); }
      const code = String(payload.code || "").trim().toUpperCase(), content = String(payload.content || "").toUpperCase();
      const payment = Object.values(paymentData).find(p => p.status === "pending" && (code === String(p.code).toUpperCase() || content.includes(String(p.code).toUpperCase())));
      if (!payment) { res.writeHead(200, {"Content-Type":"application/json; charset=utf-8"}); return res.end(JSON.stringify({success:true})); }
      const receivedAmount = Number(payload.transferAmount);
      if (!Number.isFinite(receivedAmount) || receivedAmount < Number(payment.amount)) { console.warn(`[SePay] Sai số tiền cho ${payment.code}: nhận ${receivedAmount}, cần ${payment.amount}`); res.writeHead(200, {"Content-Type":"application/json; charset=utf-8"}); return res.end(JSON.stringify({success:true})); }
      payment.status = "paid"; payment.paidVia = "bank"; payment.transactionId = transactionId; payment.referenceCode = String(payload.referenceCode || ""); payment.paidAmount = receivedAmount; payment.paidAt = new Date().toISOString();
      await applyPaymentSuccess(payment);
      savePayments(paymentData); await updatePaymentMessage(payment);
      const guild = await client.guilds.fetch(payment.guildId).catch(() => null), channel = await guild?.channels.fetch(payment.channelId).catch(() => null);
      if (channel?.isTextBased?.()) {
        let msg = `✅ <@${payment.userId}> **${payment.code}** đã thanh toán thành công **${formatVnd(receivedAmount)}**.`;
        if (payment.reactBillSalaryPlayerIds?.length) {
          msg += `\n💰 Đã tự động cộng lương cho: ${payment.reactBillSalaryPlayerIds.map(id => `<@${id}>`).join(", ")}.`;
        }
        await channel.send(msg).catch(() => {});
      }
      res.writeHead(200, {"Content-Type":"application/json; charset=utf-8"}); return res.end(JSON.stringify({success:true}));
    } catch (error) { console.error("SePay webhook error:", error); res.writeHead(500, {"Content-Type":"application/json; charset=utf-8"}); return res.end(JSON.stringify({success:false,message:"Internal error"})); }
  });
}


// ===== RENDER / SEPAY WEBHOOK SERVER =====
// Render Web Service cần ứng dụng lắng nghe HTTP port.
// Endpoint /webhook/sepay sẽ được dùng để nhận giao dịch từ SePay.
const WEB_PORT = Number(process.env.PORT) || 3000;

const webServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Discord Profile Bot is online.");
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, discord: client?.isReady?.() === true }));
  }

  if (req.method === "POST" && req.url === "/webhook/sepay") {
    return paymentWebhookHandler(req, res);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.mkdirSync(IMAGE_DIR, { recursive: true });

function loadPRRoles() {
  try {
    const data = JSON.parse(fs.readFileSync(PERMISSION_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function savePRRoles(data) {
  writeJsonAsync(PERMISSION_FILE, data);
}

let prRoles = loadPRRoles();

function loadPRAdminRoles() {
  try {
    const data = JSON.parse(fs.readFileSync(PR_ADMIN_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function savePRAdminRoles(data) {
  fs.mkdirSync(path.dirname(PR_ADMIN_FILE), { recursive: true });
  writeJsonAsync(PR_ADMIN_FILE, data);
}

let prAdminRoles = loadPRAdminRoles();

function loadSalaryApprovals() {
  try {
    const data = JSON.parse(fs.readFileSync(SALARY_APPROVAL_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveSalaryApprovals(data) {
  fs.mkdirSync(path.dirname(SALARY_APPROVAL_FILE), { recursive: true });
  writeJsonAsync(SALARY_APPROVAL_FILE, data);
}

let salaryApprovals = loadSalaryApprovals();

// Reload approvals from disk before handling a button. This is important after
// Railway/container restarts: the Discord message can still exist while the
// in-memory object was created before the latest file was written.
function reloadSalaryApprovalsFromDisk() {
  salaryApprovals = loadSalaryApprovals();
  return salaryApprovals;
}

function extractMentionId(text) {
  const match = String(text || "").match(/<@!?(\d+)>/);
  return match ? match[1] : null;
}

function parseMoneyValue(text) {
  const raw = String(text || "").replace(/[^0-9-]/g, "");
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function recoverSalaryApprovalFromMessage(interaction, approvalId) {
  const embeds = interaction.message?.embeds || [];
  const embed = embeds[0];
  if (!embed) return null;

  const fields = new Map((embed.fields || []).map(f => [String(f.name || "").trim(), String(f.value || "").trim()]));
  const playerField = fields.get("👤 Player") || fields.get("Player");
  const amountField = fields.get("💵 Số tiền") || fields.get("Số tiền");
  const hoursField = fields.get("⏱️ Số giờ") || fields.get("Số giờ");
  const shiftField = fields.get("🌙 Ca") || fields.get("Ca");
  const noteField = fields.get("📝 Ghi chú") || fields.get("Ghi chú");
  const description = String(embed.description || "");

  const userId = extractMentionId(playerField);
  const by = extractMentionId(description);
  const amount = parseMoneyValue(amountField);
  const hoursMatch = String(hoursField || "").match(/-?\d+(?:[.,]\d+)?/);
  const hours = hoursMatch ? Number(hoursMatch[0].replace(",", ".")) : 0;
  const shift = /đêm/i.test(shiftField || "") ? "dem" : "sang";
  const note = noteField && noteField !== "Không có" ? noteField : "";

  if (!userId || !amount || amount <= 0) return null;

  return {
    id: crypto.randomUUID(),
    approvalId,
    userId: String(userId),
    type: "work",
    shift,
    hours: Number.isFinite(hours) ? hours : 0,
    amount,
    note,
    at: embed.timestamp || new Date().toISOString(),
    by: String(by || interaction.user.id),
    status: "pending",
    recoveredFromMessage: true,
  };
}

function getConfiguredPRAdminRoles(guildId) {
  if (!prAdminRoles[guildId] || !Array.isArray(prAdminRoles[guildId])) prAdminRoles[guildId] = [];
  return prAdminRoles[guildId];
}

function hasPRAdminRole(context) {
  const guild = context?.guild || context?.member?.guild;
  const member = context?.member;
  if (!guild || !member) return false;
  if (member.permissions?.has("ManageGuild")) return true;
  const allowed = getConfiguredPRAdminRoles(guild.id);
  return member.roles.cache.some(role => allowed.includes(role.id));
}

function hasPRAccess(context) {
  return hasPRAdminRole(context) || hasPRManagerRole(context);
}

function getSalaryApprovalConfig(guildId) {
  if (!salaryApprovals[guildId] || typeof salaryApprovals[guildId] !== "object") salaryApprovals[guildId] = {};
  return salaryApprovals[guildId];
}

function getConfiguredSalaryApprovalChannel(guildId) {
  return getSalaryApprovalConfig(guildId).channelId || null;
}

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

chokidar.watch([AUTOROLE_FILE, WELCOME_FILE, AUTORES_FILE], {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
}).on("change", filePath => {
  if (filePath === AUTOROLE_FILE) runtimeConfigReload.autoRole = true;
  if (filePath === WELCOME_FILE) runtimeConfigReload.welcome = true;
  if (filePath === AUTORES_FILE) runtimeConfigReload.autoRes = true;
});

function loadPRKeywords() {
  try {
    const data = JSON.parse(fs.readFileSync(KEYWORD_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function savePRKeywords(data) {
  writeJsonAsync(KEYWORD_FILE, data);
}

let prKeywords = loadPRKeywords();

function loadAISettings() {
  try {
    const data = JSON.parse(fs.readFileSync(AI_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveAISettings(data) {
  writeJsonAsync(AI_FILE, data);
}

let aiSettings = loadAISettings();
const aiHistories = new Map();

function getGuildAI(guildId) {
  if (!aiSettings[guildId]) {
    aiSettings[guildId] = {
      enabled: false,
      model: DEFAULT_AI_MODEL,
      prompt: "Bạn là một bot Discord thân thiện, tự nhiên, trả lời ngắn gọn bằng tiếng Việt khi phù hợp. Không tự nhận mình là người thật.",
    };
  }
  const record = aiSettings[guildId];
  if (typeof record.enabled !== "boolean") record.enabled = false;
  if (!record.model || record.model.startsWith("gpt-")) record.model = DEFAULT_AI_MODEL;
  if (!record.prompt) record.prompt = "Bạn là một bot Discord thân thiện, tự nhiên, trả lời ngắn gọn bằng tiếng Việt khi phù hợp. Không tự nhận mình là người thật.";
  return record;
}

function aiHistoryKey(message) {
  return `${message.guild.id}:${message.channel.id}:${message.author.id}`;
}

function pushAIHistory(key, role, content) {
  if (!content) return;
  const list = aiHistories.get(key) || [];
  list.push({ role, content: String(content).slice(0, 4000) });
  while (list.length > 10) list.shift();
  aiHistories.set(key, list);
}

function aiHelp() {
  return [
    "**🤖 AI REPLY — GROQ**",
    "",
    "`sar ai on` — bật AI Reply",
    "`sar ai off` — tắt AI Reply",
    "`sar ai status` — xem trạng thái AI",
    '`sar ai prompt "Nội dung prompt"` — đổi tính cách AI',
    '`sar ai model "llama-3.3-70b-versatile"` — đổi model',
    "`sar ai clear` — xóa lịch sử chat AI",
    "",
    "💬 Khi AI bật, hãy **reply trực tiếp vào tin nhắn của bot** để bot trả lời.",
    "🔑 API dùng `GROQ_API_KEY` trong `.env`.",
  ].join("\n");
}

function clearAIHistory(guildId) {
  const prefix = `${guildId}:`;
  for (const key of aiHistories.keys()) {
    if (key.startsWith(prefix)) aiHistories.delete(key);
  }
}

async function askGroq({ model, prompt, history, botMessage, userMessage }) {
  if (!GROQ_API_KEY) throw new Error("Thiếu GROQ_API_KEY trong .env");

  const messages = [
    { role: "system", content: String(prompt || "") },
    ...(history || []).map(item => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || ""),
    })),
  ];

  if (botMessage) {
    messages.push({ role: "assistant", content: String(botMessage) });
  }
  messages.push({ role: "user", content: String(userMessage || "") });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_AI_MODEL,
      messages,
      max_tokens: 500,
      temperature: 0.8,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Groq API: ${detail}`);
  }

  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Groq API không trả về nội dung");
  return answer;
}

function loadTickets() {
  try {
    const data = JSON.parse(fs.readFileSync(TICKET_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveTickets(data) {
  writeJsonAsync(TICKET_FILE, data);
}

let ticketData = loadTickets();

function loadReactBillData() {
  try {
    const data = JSON.parse(fs.readFileSync(REACTBILL_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveReactBillData(data) {
  writeJsonAsync(REACTBILL_FILE, data);
}

let reactBillData = loadReactBillData();

function getGuildReactBill(guildId) {
  if (!reactBillData[guildId]) reactBillData[guildId] = { channelId: null, counter: 0, bills: {} };
  const cfg = reactBillData[guildId];
  if (!cfg.bills || typeof cfg.bills !== "object") cfg.bills = {};
  if (typeof cfg.counter !== "number") cfg.counter = 0;
  return cfg;
}

function loadProfileLinks() {
  try {
    const data = JSON.parse(fs.readFileSync(PROFILE_LINK_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveProfileLinks(data) {
  writeJsonAsync(PROFILE_LINK_FILE, data);
}

let profileLinks = loadProfileLinks();

function getGuildProfileLinks(guildId) {
  if (!profileLinks[guildId] || typeof profileLinks[guildId] !== "object") profileLinks[guildId] = {};
  return profileLinks[guildId];
}

function getProfileKey(profile) {
  if (!profile) return null;
  return Object.entries(profiles).find(([, p]) => p === profile)?.[0] || null;
}

function findProfileByKey(key) {
  return key ? profiles[key] || null : null;
}

function findProfileForUser(guildId, profileName, userId) {
  const key = normalizeName(profileName);
  const links = getGuildProfileLinks(guildId);
  const linkedKey = links[userId]?.[key];
  if (linkedKey) {
    const linkedProfile = findProfileByKey(linkedKey);
    if (linkedProfile) return linkedProfile;
  }

  // Fallback: profile được liên kết trực tiếp với Discord user.
  // Cách này giúp React Bill vẫn tìm đúng profile sau khi bot restart
  // hoặc khi file profile_links.json được tạo từ phiên bản cũ.
  const directLinked = Object.values(profiles).find(profile =>
    normalizeName(profile.name || "") === key && profile.linkedUserId === userId
  );
  if (directLinked) return directLinked;

  // Nếu profile do chính player tạo thì cũng coi đó là liên kết hợp lệ.
  return Object.values(profiles).find(profile =>
    normalizeName(profile.name || "") === key && profile.ownerId === userId
  ) || null;
}

function findProfilesByName(name) {
  const key = normalizeName(name);
  return Object.entries(profiles)
    .filter(([, profile]) => normalizeName(profile.name || "") === key)
    .map(([profileKey, profile]) => ({ profileKey, profile }));
}

function nextProfileStorageKey(name, ownerId) {
  const base = normalizeName(name);
  if (!profiles[base]) return base;
  let key = `${base}__${ownerId}`;
  let n = 2;
  while (profiles[key]) key = `${base}__${ownerId}_${n++}`;
  return key;
}


function getGuildTickets(guildId) {
  if (!ticketData[guildId]) {
    ticketData[guildId] = {
      channelId: null,
      supportRoleId: null,
      supportRoleIds: [],
      panelMessageId: null,
      title: "🎫 CONTACT CENTER",
      description: "Chọn loại ticket bạn muốn mở.",
      buttons: [
        { id: "support", label: "Support", emoji: "🛠️" },
        { id: "apply", label: "Apply", emoji: "📝" },
        { id: "booking", label: "Booking", emoji: "📅" },
      ],
      welcome: "🎫 Ticket đã được mở!\n\nVui lòng mô tả yêu cầu của bạn. Support sẽ hỗ trợ bạn sớm nhất có thể.",
      welcomeByType: {},
      counter: 0,
      threads: {},
      claimCounts: {},
    };
  }
  const cfg = ticketData[guildId];
  if (!Array.isArray(cfg.buttons)) cfg.buttons = [];
  if (!Array.isArray(cfg.supportRoleIds)) cfg.supportRoleIds = [];
  if (cfg.supportRoleId && !cfg.supportRoleIds.includes(cfg.supportRoleId)) cfg.supportRoleIds.push(cfg.supportRoleId);
  if (!cfg.threads || typeof cfg.threads !== "object") cfg.threads = {};
  if (!cfg.claimCounts || typeof cfg.claimCounts !== "object") cfg.claimCounts = {};
  if (typeof cfg.counter !== "number") cfg.counter = 0;
  if (!cfg.title) cfg.title = "🎫 CONTACT CENTER";
  if (!cfg.description) cfg.description = "Chọn loại ticket bạn muốn mở.";
  if (!cfg.welcome) cfg.welcome = "🎫 Ticket đã được mở!\\n\\nVui lòng mô tả yêu cầu của bạn. Support sẽ hỗ trợ bạn sớm nhất có thể.";
  if (!cfg.welcomeByType || typeof cfg.welcomeByType !== "object") cfg.welcomeByType = {};
  // Normalize legacy custom emoji strings such as "<emoji_44:ID>booking"
  // into Discord's valid "<:booking:ID>" format.
  if (Array.isArray(cfg.buttons)) {
    let changed = false;
    for (const btn of cfg.buttons) {
      if (!btn || typeof btn.emoji !== "string") continue;
      const before = btn.emoji;
      btn.emoji = btn.emoji.replace(/<emoji_\\d+:(\\d+)>([A-Za-z0-9_]+)\\b/g, "<:$2:$1>");
      if (btn.emoji !== before) changed = true;
    }
    if (changed) saveTickets(ticketData);
  }
  return cfg;
}

function ticketHelp() {
  return [
    "**🎫 TICKET**",
    "`!tic setup #channel` — tạo/cập nhật panel",
    "`!tic role add @Support` — thêm Support role",
    "`!tic role remove @Support` — xóa Support role",
    "`!tic role list` — xem các Support role",
    "`!tic send` — gửi lại panel vào kênh đã setup",
    "`!tic title \\\"Tiêu đề\\\"` — sửa tiêu đề panel",
    "`!tic desc \\\"Nội dung\\\"` — sửa nội dung panel",
    "`!tic welcome \\\"Nội dung\\\"` — sửa tin nhắn mặc định khi mở ticket",
    "`!tic welcome <booking/apply/support> | Nội dung` — sửa tin nhắn chào riêng cho 1 loại ticket",
    "`!tic welcome <booking/apply/support> | reset` — gỡ tin nhắn riêng, dùng lại mặc định",
    "`!tic welcome list` — xem tin nhắn chào của từng loại ticket",
    "`!ticb add id \\\"Tên\\\" emoji` — thêm nút",
    "`!ticb edit id \\\"Tên mới\\\" emoji` — sửa nút",
    "`!ticb remove id` — xóa nút",
    "`!ticb list` — xem các nút",
    "`!tic status` — xem cấu hình",
    "`!tic claim` — xem số ticket bạn đã claim",
    "`!tic rclaim` — reset số ticket claim của mọi người",
    "`!ticb ...` — quản lý các nút của panel ticket",
  ].join("\n");
}

function buildTicketPanel(cfg) {
  const embed = new EmbedBuilder()
    .setColor(0xFFFDD0)
    .setTitle(cfg.title)
    .setDescription(cfg.description);

  const buttons = cfg.buttons.slice(0, 5).map(btn => {
    const b = new ButtonBuilder()
      .setCustomId(`ticket_open:${btn.id}`)
      .setLabel(String(btn.label).slice(0, 80))
      .setStyle(ButtonStyle.Secondary);
    if (btn.emoji) {
      try { b.setEmoji(btn.emoji); } catch {}
    }
    return b;
  });

  const components = buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
  return { embeds: [embed], components };
}

function ticketManager(message, cfg) {
  const roleIds = Array.isArray(cfg?.supportRoleIds) ? cfg.supportRoleIds : (cfg?.supportRoleId ? [cfg.supportRoleId] : []);
  return hasPRManagerRole(message) || roleIds.some(roleId => message.member?.roles?.cache?.has(roleId));
}

function sanitizeThreadPart(value) {
  return String(value || "ticket").toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ticket";
}

async function sendTicketPanel(message, cfg) {
  if (!cfg.channelId) return message.channel.send("❌ Chưa setup kênh ticket. Dùng `!tic setup #channel` và thêm role bằng `!tic role add @Support`.");
  const channel = await message.guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return message.channel.send("❌ Không tìm thấy kênh ticket đã setup.");
  const payload = buildTicketPanel(cfg);
  if (cfg.panelMessageId) {
    const old = await channel.messages.fetch(cfg.panelMessageId).catch(() => null);
    if (old) {
      await old.edit(payload);
      return message.channel.send("✅ Đã cập nhật panel ticket cũ.");
    }
  }
  const sent = await channel.send(payload);
  cfg.panelMessageId = sent.id;
  saveTickets(ticketData);
  return message.channel.send(`✅ Đã gửi panel ticket vào ${channel}.`);
}

async function handleTicketButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("ticket_")) return false;
  if (!interaction.guild) return true;

  if (interaction.customId === "ticket_claim") {
    const cfg = getGuildTickets(interaction.guild.id);
    const record = cfg.threads[interaction.channelId];
    if (!record) {
      await interaction.reply({ content: "❌ Không tìm thấy dữ liệu ticket này.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!ticketManager({ member: interaction.member }, cfg)) {
      await interaction.reply({ content: "⛔ Chỉ Support hoặc PR Manager mới có thể claim ticket.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (record.claimedBy) {
      const claimedMember = await interaction.guild.members.fetch(record.claimedBy).catch(() => null);
      await interaction.reply({
        content: `⚠️ Ticket này đã được claim bởi ${claimedMember || `<@${record.claimedBy}>`}.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    record.claimedBy = interaction.user.id;
    record.claimedAt = new Date().toISOString();
    if (!cfg.claimCounts || typeof cfg.claimCounts !== "object") cfg.claimCounts = {};
    cfg.claimCounts[interaction.user.id] = Number(cfg.claimCounts[interaction.user.id] || 0) + 1;
    saveTickets(ticketData);

    const thread = interaction.channel;
    if (thread?.isThread?.() && record.messageId) {
      const ticketMessage = await thread.messages.fetch(record.messageId).catch(() => null);
      if (ticketMessage) {
        const type = cfg.buttons.find(x => x.id === record.typeId);
        const claimLabel = `Claimed: ${interaction.user.username}`.slice(0, 80);
        const claimedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket_claim").setLabel(claimLabel).setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
        );
        await ticketMessage.edit({ components: [claimedRow] }).catch(() => {});
      }
    }

    await interaction.reply({ content: `✅ ${interaction.user} đã claim **${cfg.buttons.find(x => x.id === record.typeId)?.label || "ticket"}** này.` });
    return true;
  }

  if (interaction.customId === "ticket_close") {
    const cfg = getGuildTickets(interaction.guild.id);
    const record = cfg.threads[interaction.channelId];
    const member = interaction.member;
    const allowed = record && (record.ownerId === interaction.user.id || ticketManager({ member }, cfg));
    if (!allowed) {
      await interaction.reply({ content: "⛔ Bạn không có quyền đóng ticket này.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply({ content: "🔒 Đang đóng ticket...", flags: MessageFlags.Ephemeral });
    const thread = interaction.channel;
    if (thread.isThread()) {
      await thread.setLocked(true, "Ticket closed").catch(() => {});
      await thread.setArchived(true, "Ticket closed").catch(() => {});
    }
    await sendLogMessage(interaction.guild, "ticket", {
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔒 Đóng Ticket")
        .addFields(
          { name: "Ticket", value: thread?.name ? `#${thread.name}` : `<#${interaction.channelId}>`, inline: true },
          { name: "Đóng bởi", value: `${interaction.user}`, inline: true },
        ).setTimestamp()],
    });
    return true;
  }

  if (!interaction.customId.startsWith("ticket_open:")) return false;
  const buttonId = interaction.customId.slice("ticket_open:".length);
  const cfg = getGuildTickets(interaction.guild.id);
  const type = cfg.buttons.find(x => x.id === buttonId);
  if (!type) {
    await interaction.reply({ content: "❌ Loại ticket này không còn tồn tại.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!cfg.channelId || interaction.channelId !== cfg.channelId) {
    await interaction.reply({ content: "❌ Panel ticket không hợp lệ.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!cfg.supportRoleIds?.length) {
    await interaction.reply({ content: "❌ Ticket chưa được cấu hình Support role.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const parent = interaction.channel;
  try {
    cfg.counter += 1;
    const number = String(cfg.counter).padStart(3, "0");
    const ticketTypeName = String(type.id || type.label || "ticket")
      .toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "ticket";
    const thread = await parent.threads.create({
      name: `${ticketTypeName}-${number}`,
      autoArchiveDuration: 1440,
      type: 12,
      invitable: false,
      reason: `${type.label} ticket by ${interaction.user.tag}`,
    });

    await thread.members.add(interaction.user.id).catch(() => {});
    const supportRoleIds = Array.isArray(cfg.supportRoleIds) ? cfg.supportRoleIds : [];
    const mentionedRoleIds = [];
    const addedMemberIds = new Set();
    for (const roleId of supportRoleIds) {
      const supportRole = interaction.guild.roles.cache.get(roleId);
      if (!supportRole) continue;
      mentionedRoleIds.push(roleId);
      for (const member of supportRole.members.values()) {
        if (addedMemberIds.has(member.id)) continue;
        addedMemberIds.add(member.id);
        await thread.members.add(member.id).catch(() => {});
      }
    }

    cfg.threads[thread.id] = {
      ownerId: interaction.user.id,
      typeId: type.id,
      createdAt: new Date().toISOString(),
      claimedBy: null,
      claimedAt: null,
      messageId: null,
    };
    saveTickets(ticketData);

    const claimLabel = `Claim ${type.label}`.slice(0, 80);
    const ticketRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket_claim").setLabel(claimLabel).setEmoji("🙋").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    );
    const welcomeText = (cfg.welcomeByType && cfg.welcomeByType[type.id]) || cfg.welcome;
    const ticketMessage = await thread.send({
      content: `${interaction.user} ${mentionedRoleIds.map(roleId => `<@&${roleId}>`).join(" ")}`,
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`${type.emoji || "🎫"} ${type.label} Ticket`).setDescription(welcomeText)],
      components: [ticketRow],
    });
    cfg.threads[thread.id].messageId = ticketMessage.id;
    saveTickets(ticketData);

    await interaction.editReply(`✅ Đã mở ${type.label} ticket: ${thread}`);
    await sendLogMessage(interaction.guild, "ticket", {
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎫 Mở Ticket mới")
        .addFields(
          { name: "Loại", value: `${type.emoji || "🎫"} ${type.label}`, inline: true },
          { name: "Ticket", value: `${thread}`, inline: true },
          { name: "Mở bởi", value: `${interaction.user}`, inline: true },
        ).setTimestamp()],
    });
  } catch (error) {
    console.error("Ticket create thất bại:", error);
    await interaction.editReply("❌ Không thể tạo ticket. Kiểm tra quyền **Manage Threads**, **Create Private Threads** và **Send Messages in Threads** của bot.");
  }
  return true;
}

async function handleTicketCommand(message, args, rawValue = null) {
  const sub = (args.shift() || "").toLowerCase();
  const cfg = getGuildTickets(message.guild.id);
  const manager = hasPRManagerRole(message);
  if (!sub) return message.channel.send(ticketHelp());
  if (["setup", "send", "title", "desc", "welcome", "button", "role"].includes(sub) && !manager) {
    return message.channel.send("⛔ Bạn không có quyền quản lý Ticket. Cần PR Manager.");
  }

  if (sub === "claim") {
    const count = Number(cfg.claimCounts?.[message.author.id] || 0);
    return message.channel.send(`🎫 Bạn đã claim **${count} ticket**.`);
  }

  if (sub === "rclaim") {
    if (!manager) return message.channel.send("⛔ Bạn không có quyền reset số ticket claim. Cần PR Manager.");
    cfg.claimCounts = {};
    saveTickets(ticketData);
    return message.channel.send("✅ Đã reset số ticket claim của mọi người về **0**.");
  }

  if (sub === "setup") {
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get((args[0] || "").replace(/[<#>]/g, ""));
    if (!channel || !channel.isTextBased()) return message.channel.send("Dùng: `!tic setup #ticket-channel`");
    cfg.channelId = channel.id;
    saveTickets(ticketData);
    return sendTicketPanel(message, cfg);
  }

  if (sub === "send") return sendTicketPanel(message, cfg);
  if (sub === "title" || sub === "desc") {
    let value = rawValue !== null ? String(rawValue).trim() : args.join(" ").trim();

    // Cho phép nội dung ticket có xuống dòng trực tiếp hoặc dùng \\n.
    // Ví dụ:
    // !tic desc "Dòng 1
    // Dòng 2
    // Dòng 3"
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\n/g, "\n");
    if (!value) return message.channel.send(`Dùng: \`sar ticket ${sub} "Nội dung"\``);
    if (sub === "title") cfg.title = value;
    if (sub === "desc") cfg.description = value;
    saveTickets(ticketData);
    return message.channel.send(`✅ Đã cập nhật ${sub === "desc" ? "nội dung" : sub} ticket.`);
  }

  if (sub === "welcome") {
    let value = rawValue !== null ? String(rawValue).trim() : args.join(" ").trim();

    // Hỗ trợ: !tic welcome <booking/apply/support> | Nội dung
    // để đặt tin nhắn chào riêng cho từng loại ticket. Nếu không có
    // "<type> |" ở đầu thì coi như đang sửa tin nhắn chào mặc định
    // (dùng cho các loại ticket chưa có tin nhắn riêng).
    const firstWord = value.split(/\s+/, 1)[0]?.toLowerCase() || "";

    if (firstWord === "list") {
      const lines = cfg.buttons.map(btn => {
        const custom = cfg.welcomeByType[btn.id];
        return `**${btn.emoji || "🎫"} ${btn.label}** (\`${btn.id}\`)${custom ? "" : " — _dùng mặc định_"}\n${custom || cfg.welcome}`;
      });
      return message.channel.send([
        "**🎫 Welcome theo loại ticket**",
        `**Mặc định**\n${cfg.welcome}`,
        ...lines,
      ].join("\n\n").slice(0, 1900));
    }

    let typeId = null;
    const pipeIndex = value.indexOf("|");
    if (pipeIndex !== -1) {
      const maybeType = value.slice(0, pipeIndex).trim().toLowerCase();
      if (cfg.buttons.some(b => b.id === maybeType)) {
        typeId = maybeType;
        value = value.slice(pipeIndex + 1).trim();
      }
    }

    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }

    if (typeId && value.toLowerCase() === "reset") {
      delete cfg.welcomeByType[typeId];
      saveTickets(ticketData);
      return message.channel.send(`✅ Đã gỡ tin nhắn chào riêng cho **${typeId}**, sẽ dùng lại tin nhắn mặc định.`);
    }

    if (!value) {
      return message.channel.send('Dùng: `!tic welcome "Nội dung"` (mặc định) hoặc `!tic welcome <booking/apply/support> | Nội dung` (riêng cho 1 loại).');
    }

    if (typeId) {
      cfg.welcomeByType[typeId] = value;
      saveTickets(ticketData);
      return message.channel.send(`✅ Đã cập nhật tin nhắn chào riêng cho loại ticket **${typeId}**.`);
    }

    cfg.welcome = value;
    saveTickets(ticketData);
    return message.channel.send("✅ Đã cập nhật tin nhắn chào mặc định của ticket.");
  }

  if (sub === "role") {
    const action = (args.shift() || "").toLowerCase();
    const role = message.mentions.roles.first() || message.guild.roles.cache.get((args[0] || "").replace(/[<@&>]/g, ""));
    if (action === "list") {
      if (!cfg.supportRoleIds.length) return message.channel.send("🎫 Chưa có Support role nào.");
      const lines = cfg.supportRoleIds.map((id, i) => `${i + 1}. ${message.guild.roles.cache.get(id) || `<@&${id}>`}`);
      return message.channel.send(`**🛠️ Support Roles**\n${lines.join("\n")}`);
    }
    if (!["add", "remove"].includes(action) || !role) return message.channel.send("Dùng: `!tic role add @Support` / `!tic role remove @Support` / `!tic role list`");
    if (role.id === message.guild.id || role.managed) return message.channel.send("❌ Không thể dùng role @everyone hoặc role managed/integration.");
    if (action === "add") {
      if (cfg.supportRoleIds.includes(role.id)) return message.channel.send("ℹ️ Role này đã có trong danh sách Support.");
      cfg.supportRoleIds.push(role.id);
      saveTickets(ticketData);
      return message.channel.send(`✅ Đã thêm ${role} vào Support roles.`);
    }
    const index = cfg.supportRoleIds.indexOf(role.id);
    if (index < 0) return message.channel.send("❌ Role này chưa có trong danh sách Support.");
    cfg.supportRoleIds.splice(index, 1);
    saveTickets(ticketData);
    return message.channel.send(`✅ Đã xóa ${role} khỏi Support roles.`);
  }

  if (sub === "status") {
    const channel = cfg.channelId ? message.guild.channels.cache.get(cfg.channelId) : null;
    const roles = cfg.supportRoleIds.map(id => message.guild.roles.cache.get(id) || `<@&${id}>`);
    const customWelcomeCount = Object.keys(cfg.welcomeByType || {}).length;
    return message.channel.send(`**🎫 Ticket Status**\nKênh: ${channel || "chưa setup"}\nSupport: ${roles.length ? roles.join(" ") : "chưa setup"}\nPanel: ${cfg.panelMessageId ? "đã có" : "chưa có"}\nNút: ${cfg.buttons.length}\nWelcome riêng: ${customWelcomeCount}/${cfg.buttons.length} loại (\`!tic welcome list\` để xem)`);
  }

  if (sub === "button") {
    const action = (args.shift() || "").toLowerCase();
    if (action === "list") {
      if (!cfg.buttons.length) return message.channel.send("🎫 Chưa có nút nào.");
      return message.channel.send(cfg.buttons.map((b, i) => `${i + 1}. \`${b.id}\` — ${b.emoji || ""} ${b.label}`).join("\n"));
    }
    if (action === "remove") {
      const id = (args.shift() || "").toLowerCase();
      const index = cfg.buttons.findIndex(b => b.id === id);
      if (index < 0) return message.channel.send("❌ Không tìm thấy nút đó.");
      cfg.buttons.splice(index, 1); saveTickets(ticketData);
      return message.channel.send("✅ Đã xóa nút. Dùng `!tic send` để cập nhật panel.");
    }
    if (action === "add" || action === "edit") {
      const id = (args.shift() || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const label = args.shift();
      const emoji = args.shift() || "";
      if (!id || !label) return message.channel.send(`Dùng: \`sar ticket button ${action} support "Support" 🛠️\``);
      const existing = cfg.buttons.find(b => b.id === id);
      if (action === "add" && existing) return message.channel.send("❌ ID nút đã tồn tại.");
      if (action === "edit" && !existing) return message.channel.send("❌ Không tìm thấy nút đó.");
      const record = existing || { id, label, emoji };
      record.label = label; record.emoji = emoji;
      if (!existing) cfg.buttons.push(record);
      if (cfg.buttons.length > 5) { cfg.buttons.pop(); return message.channel.send("❌ Discord chỉ cho tối đa 5 nút trong một hàng."); }
      saveTickets(ticketData);
      return message.channel.send(`✅ Đã ${existing ? "sửa" : "thêm"} nút **${label}**. Dùng \`!tic send\` để cập nhật panel.`);
    }
    return message.channel.send(ticketHelp());
  }
  return message.channel.send(ticketHelp());
}

function stripProfileDescriptionEmoji(value) {
  let text = String(value ?? "");

  // Discord custom emoji: <:name:id> / <a:name:id>
  text = text.replace(/<a?:[A-Za-z0-9_~\-]+:\d+>/g, "");

  // Unicode emoji/pictographs, flags, keycaps, variation selectors and ZWJ sequences.
  // Keep normal letters, numbers, punctuation and Vietnamese text.
  try {
    text = text.replace(/(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*|[0-9#*]\uFE0F?\u20E3)/gu, "");
  } catch {
    // Fallback for older Node runtimes.
    text = text
      .replace(/[\u{1F000}-\u{1FAFF}]/gu, "")
      .replace(/[\u{1FC00}-\u{1FFFD}]/gu, "")
      .replace(/[\u{2600}-\u{27BF}]/gu, "")
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
      .replace(/[\uFE0E\uFE0F\u200D\u20E3]/g, "");
  }

  return text.replace(/[ \t]{2,}/g, " ").replace(/\n[ \t]+/g, "\n").trim();
}

function sanitizeProfileDescriptions(data) {
  // Đã bỏ việc tự động xóa emoji khỏi description — emoji giờ được giữ nguyên.
  return data;
}

function loadProfiles() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveProfiles(data) {
  sanitizeProfileDescriptions(data);
  writeJsonAsync(DATA_FILE, data);
}

// ===== EMBED ĐÃ SHOW: TỰ ĐỒNG BỘ THEO PROFILE =====
// Mỗi lần sar show được dùng, bot lưu messageId/channelId.
// Khi profile thay đổi, tất cả embed đã đăng ký sẽ được cập nhật.
function ensureShownMessages(profile) {
  if (!Array.isArray(profile.shownMessages)) profile.shownMessages = [];
  return profile.shownMessages;
}

function registerShownMessage(profile, message, current = 0) {
  const list = ensureShownMessages(profile);
  const exists = list.find(x => x.guildId === message.guildId && x.channelId === message.channelId && x.messageId === message.id);
  if (exists) {
    exists.current = current;
  } else {
    list.push({
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      current,
    });
  }
  // Không giới hạn số message đã show.
  // Mục đích là để khi profile được sửa, mọi bản profile cũ đã từng được bot
  // gửi lên vẫn có thể được sync lại, không chỉ 100 message gần nhất.
  profile.shownMessages = list;
}

function findProfileByShownMessage(message) {
  if (!message?.reference?.messageId || !message.guildId) return null;
  const messageId = message.reference.messageId;
  const channelId = message.channelId;
  return Object.values(profiles).find(profile =>
    Array.isArray(profile.shownMessages) && profile.shownMessages.some(entry =>
      entry.guildId === message.guildId && entry.channelId === channelId && entry.messageId === messageId
    )
  ) || null;
}

function clampProfileIndex(profile, index) {
  const total = profile.images.length;
  if (!total) return 0;
  return Math.max(0, Math.min(Number.isInteger(index) ? index : 0, total - 1));
}

async function updateShownMessage(profile, entry) {
  try {
    const channel = await client.channels.fetch(entry.channelId);
    if (!channel || !channel.isTextBased()) return true;

    const target = await channel.messages.fetch(entry.messageId);
    if (!target) return true;

    entry.current = clampProfileIndex(profile, entry.current);
    const media = profileFiles(profile, entry.current);

    // Tạo embed mới từ dữ liệu profile hiện tại. Nếu file local của ảnh cũ
    // không còn tồn tại, giữ URL ảnh đang có trong embed cũ để việc cập nhật
    // nội dung (title/description/color/emoji) vẫn chắc chắn thành công.
    const nextEmbed = buildEmbed(profile, entry.current, media.names);
    const oldEmbed = target.embeds?.[0];

    if (!media.names.avatar && oldEmbed?.thumbnail?.url && profile.avatar) {
      nextEmbed.setThumbnail(oldEmbed.thumbnail.url);
    }
    if (!media.names.image && oldEmbed?.image?.url && profile.images.length) {
      nextEmbed.setImage(oldEmbed.image.url);
    }

    const payload = profileV2Payload(profile, entry.current, media);
    if (!media.files.length) delete payload.files;

    await target.edit(payload);
    return true;
  } catch (error) {
    // Message bị xóa / channel không còn truy cập được thì bỏ khỏi danh sách theo dõi.
    if (error?.code === 10008 || error?.code === 10003 || error?.code === 50001 || error?.code === 50013) {
      return false;
    }
    console.error(`Không thể cập nhật embed cũ ${entry.messageId}:`, error.message || error);
    return true;
  }
}

// Đồng bộ lại các message profile đang được bot theo dõi sau khi dữ liệu thay đổi.
async function syncProfileEverywhere(profile) {
  // Chỉ sync các message thuộc ĐÚNG profile đang được cập nhật.
  // Không quét hoặc sửa các profile khác.
  const list = ensureShownMessages(profile);
  if (!list.length) return;

  const kept = [];
  for (const entry of list) {
    const ok = await updateShownMessage(profile, entry);
    if (ok) kept.push(entry);
  }

  profile.shownMessages = kept;
  saveProfiles(profiles);
}

// Không để nhiều lệnh sửa cùng một profile chạy sync chồng lên nhau.
const profileSyncQueues = new Map();

function runProfileSyncNow(profile) {
  const key = normalizeName(profile.name);
  const previous = profileSyncQueues.get(key) || Promise.resolve();

  const next = previous
    .catch(() => {})
    .then(() => syncProfileEverywhere(profile));

  profileSyncQueues.set(key, next);

  next.finally(() => {
    if (profileSyncQueues.get(key) === next) {
      profileSyncQueues.delete(key);
    }
  }).catch(() => {});

  return next;
}

// Debounce: nếu sửa profile nhiều lần liên tiếp, không sync ngay từng lần.
// Mỗi lệnh sửa sẽ reset lại đồng hồ đếm 1 phút; chỉ khi không còn lệnh sửa
// nào mới trong 1 phút thì bot mới thực sự resync các embed cũ đã show.
const PROFILE_SYNC_DEBOUNCE_MS = 2 * 60 * 1000;
const profileSyncTimers = new Map();

function queueProfileSync(profile, guildId) {
  const key = normalizeName(profile.name);

  const existingTimer = profileSyncTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    profileSyncTimers.delete(key);
    runProfileSyncNow(profile).catch(error => {
      console.error(`Debounced sync thất bại cho ${profile.name}:`, error.message || error);
    });
  }, PROFILE_SYNC_DEBOUNCE_MS);
  if (typeof timer.unref === "function") timer.unref();

  profileSyncTimers.set(key, timer);

  return Promise.resolve();
}

// ===== TỰ ĐỘNG CẬP NHẬT PROFILE CŨ =====
// Giữ nguyên dữ liệu cũ nhưng bổ sung các trường của PR5 mới.
function normalizeProfileColor(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const text = value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(text)) return parseInt(text, 16);
  }
  return 0x5865f2;
}

function migrateProfiles() {
  const migrationFile = path.join(__dirname, "..", "data", "profiles.json");

  if (!fs.existsSync(migrationFile)) {
    return {};
  }

  try {
    const previous = JSON.parse(fs.readFileSync(migrationFile, "utf8"));

    if (!previous || typeof previous !== "object") {
      return {};
    }

    // Keep existing profile data unchanged. This function exists only to migrate
    // older profile formats when present, so an already-normal object is returned.
    if (!Array.isArray(previous)) {
      return previous;
    }

    const migrated = {};
    for (const item of previous) {
      if (!item || typeof item !== "object") continue;

      const key =
        item.key ??
        item.id ??
        item.name ??
        item.profileName;

      if (!key) continue;

      migrated[String(key)] = item;
    }

    return migrated;
  } catch (err) {
    console.error("[migrateProfiles] Không đọc được profiles.json:", err.message);
    return {};
  }
}

let profiles = sanitizeProfileDescriptions(migrateProfiles(loadProfiles()));
for (const profile of Object.values(profiles)) {
  if (!profile || typeof profile !== "object") continue;
  delete profile.gender;
  delete profile.genderBoardMessage;
}

function normalizeName(name) {
  return name.trim().toLowerCase();
}

function findProfile(name) {
  if (!name) return null;
  const key = normalizeName(name);
  if (profiles[key]) return profiles[key];
  return findProfilesByName(name)[0]?.profile || null;
}

// ===== STEAL EMOJI (sar steal) =====
function extractCustomEmojis(text) {
  if (!text) return [];
  const results = [];
  const seen = new Set();
  const regex = /<(a?):([A-Za-z0-9_]{2,32}):(\d+)>/g;
  let match;
  while ((match = regex.exec(String(text)))) {
    const [, animatedFlag, name, id] = match;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({ animated: animatedFlag === "a", name, id });
  }
  return results;
}

function sanitizeEmojiName(name) {
  let clean = String(name || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32);
  while (clean.length < 2) clean += "_";
  return clean || "emoji";
}

async function stealSingleEmoji(guild, emoji, newName) {
  const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}`;
  const finalName = sanitizeEmojiName(newName || emoji.name);
  return guild.emojis.create({ attachment: url, name: finalName });
}

async function handleStealEmoji(message, args) {
  const me = message.guild.members.me || (await message.guild.members.fetchMe().catch(() => null));
  let canManageEmojis = true;
  if (me) {
    try {
      const flag = PermissionsBitField.Flags.ManageGuildExpressions ?? PermissionsBitField.Flags.ManageEmojisAndStickers;
      canManageEmojis = flag ? me.permissions.has(flag) : true;
    } catch {
      canManageEmojis = true;
    }
  }
  if (me && !canManageEmojis) {
    return message.channel.send("❌ Bot cần quyền **Manage Expressions/Emoji** để thêm custom emoji vào server.");
  }

  const explicitEmoji = args[0] ? extractCustomEmojis(args[0])[0] : null;
  let targets = [];

  if (explicitEmoji) {
    targets = [{ emoji: explicitEmoji, newName: args[1] }];
  } else if (message.reference) {
    const replied = await message.fetchReference().catch(() => null);
    if (!replied) return message.channel.send("❌ Không tìm thấy tin nhắn được reply.");
    const found = extractCustomEmojis(replied.content);
    if (!found.length) return message.channel.send("❌ Tin nhắn được reply không có custom emoji nào.");
    targets = found.slice(0, 10).map(emoji => ({ emoji, newName: null }));
  } else {
    return message.channel.send(
      "Dùng: `sar steal <:emoji:id> [tên_mới]` hoặc reply vào tin nhắn chứa emoji rồi gõ `sar steal`."
    );
  }

  const results = [];
  for (const { emoji, newName } of targets) {
    try {
      const created = await stealSingleEmoji(message.guild, emoji, newName);
      results.push(`✅ Đã thêm ${created} (\`:${created.name}:\`)`);
    } catch (error) {
      results.push(`❌ Lỗi khi thêm \`${emoji.name}\`: ${error.message || error}`);
    }
  }
  return message.channel.send(results.join("\n"));
}

function parseArgs(text) {
  const args = [];
  // Cho phép nội dung trong dấu quote có xuống dòng thật
  // và hỗ trợ \n / \r\n được viết thành newline.
  const re = /"([^"]*)"|\'([^\']*)\'|(\S+)/gs;
  let match;
  while ((match = re.exec(String(text || ""))) !== null) {
    const value = match[1] ?? match[2] ?? match[3];
    args.push(String(value).replace(/\\r?\\n/g, "\n"));
  }
  return args;
}

function isImageAttachment(a) {
  if (a.contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(a.name || "");
}

function getAttachments(message) {
  return [...message.attachments.values()].filter(isImageAttachment);
}

function getConfiguredPRRoles(guildId) {
  if (!prRoles[guildId] || !Array.isArray(prRoles[guildId])) {
    prRoles[guildId] = [];
  }
  return prRoles[guildId];
}

function hasPRManagerRole(context) {
  const guild = context?.guild || context?.member?.guild;
  const member = context?.member;
  if (!guild || !member) return false;
  if (hasPRAdminRole(context)) return true;
  if (member.permissions?.has("ManageGuild")) return true;

  const allowed = getConfiguredPRRoles(guild.id);
  return member.roles.cache.some(role => allowed.includes(role.id));
}

function canEditProfile(profile, message) {
  // Chủ profile có thể sửa profile của mình. Admin/PR Manager có thể sửa tất cả.
  return profile.ownerId === message.author.id || hasPRManagerRole(message);
}

function canManagePRRoles(message) {
  return Boolean(message.member?.permissions?.has("ManageGuild"));
}

function getRoleFromMessage(message, args) {
  const mentioned = message.mentions.roles.first();
  if (mentioned) return mentioned;

  const raw = (args[0] || "").replace(/[<@&>]/g, "");
  return message.guild.roles.cache.get(raw) || null;
}

// ===== USER ROLE MANAGER =====
// Cho phép Manage Roles hoặc PR Manager cấp/gỡ role cho member.
function canManageUserRoles(message) {
  if (!message.guild || !message.member) return false;
  return Boolean(
    message.member.permissions?.has("ManageRoles") ||
    hasPRManagerRole(message)
  );
}

function getMemberFromMessage(message, value) {
  const mentioned = message.mentions.members.first();
  if (mentioned) return mentioned;

  const raw = String(value || "").replace(/[<@!>]/g, "");
  return message.guild.members.cache.get(raw) || null;
}

function getAssignableUserRole(message, value) {
  const guild = message.guild;
  const raw = String(value || "").trim();
  const idRaw = raw.replace(/[<@&>]/g, "");

  // 1. Mention hoặc ID chính xác.
  let role = guild.roles.cache.get(idRaw) || null;

  // 2. Tên trùng khớp chính xác (không phân biệt hoa/thường).
  if (!role && raw) {
    const lower = raw.toLowerCase();
    role = guild.roles.cache.find(r => r.name.toLowerCase() === lower) || null;

    // 3. Chỉ cần vài chữ đầu của tên role (không cần tag role).
    if (!role) {
      const candidates = guild.roles.cache.filter(r => r.name.toLowerCase().startsWith(lower));
      if (candidates.size === 1) {
        role = candidates.first();
      } else if (candidates.size > 1) {
        return { role: null, reason: "ambiguous", candidates: [...candidates.values()].map(r => r.name) };
      }
    }
  }

  if (!role) return { role: null, reason: "not_found" };
  if (role.id === guild.id) return { role, reason: "everyone" };
  if (role.managed) return { role, reason: "managed" };

  const me = guild.members.me;
  if (!me) return { role, reason: "bot_member" };
  if (!me.permissions.has("ManageRoles")) return { role, reason: "bot_permission" };
  if (role.position >= me.roles.highest.position) return { role, reason: "hierarchy" };

  return { role, reason: null };
}

function userRoleHelp() {
  return [
    "**👤 ROLE MANAGER**",
    '`srole @User role1,role2,...` — cấp 1 hoặc nhiều role cho member; nếu member **đã có sẵn** role nào trong danh sách, bot sẽ **tự gỡ** role đó (toggle) thay vì báo lỗi',
    '`srole @User role1,role2 10m` — cấp tạm thời, tự động gỡ sau thời gian chỉ định (`h` giờ / `m` phút / `s` giây, ví dụ `2h`, `30m`, `45s`)',
    '`srole remove @User @Role` — gỡ role khỏi member',
    '`srole list @User` — xem role của member',
    "",
    "💡 Không cần tag role — chỉ cần gõ vài chữ đầu của tên role (ví dụ `vip` sẽ khớp role \"VIP Member\"). Nếu vài chữ đầu trùng nhiều role, bot sẽ báo rõ để ghi cụ thể hơn.",
    "🔐 Cần **Manage Roles** hoặc **PR Manager**.",
    "⚠️ Bot chỉ cấp/gỡ được role nằm thấp hơn role cao nhất của bot.",
  ].join("\n");
}

// Giới hạn của setTimeout trong Node (~24.8 ngày). Không cho đặt thời gian dài hơn mức này.
const MAX_TIMEOUT_MS = 2147483647;

// Gỡ 1 role tạm thời đã hết hạn: xoá entry khỏi file trước (tránh xử lý trùng
// giữa timer và sweep định kỳ), rồi mới gỡ role thật trên Discord.
async function removeExpiredTempRole(entryId, reason) {
  const entry = tempRoleData[entryId];
  if (!entry) return;
  delete tempRoleData[entryId];
  saveTempRoles(tempRoleData);
  try {
    const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(entry.userId).catch(() => null) : null;
    if (member && member.roles.cache.has(entry.roleId)) {
      await member.roles.remove(entry.roleId, reason || "Hết thời gian role tạm thời (srole)");
    }
  } catch (error) {
    console.error("[srole] Lỗi khi tự gỡ role tạm thời:", error);
  }
}

// Đặt hẹn giờ gỡ role dựa trên entry đã lưu trong tempRoleData (bền qua restart:
// gọi lại hàm này cho mọi entry còn sống lúc bot khởi động là đủ để tiếp tục đếm giờ).
// Nếu thời lượng còn lại vượt quá MAX_TIMEOUT_MS, tự chia nhỏ ra nhiều lần hẹn.
function scheduleTempRoleTimer(entryId) {
  const entry = tempRoleData[entryId];
  if (!entry) return;
  const delay = Date.parse(entry.expiresAt) - Date.now();
  if (delay <= 0) { removeExpiredTempRole(entryId); return; }
  setTimeout(() => {
    if (!tempRoleData[entryId]) return; // đã bị gỡ/huỷ bởi sweep hoặc timer khác
    if (Date.parse(tempRoleData[entryId].expiresAt) - Date.now() <= 0) {
      removeExpiredTempRole(entryId);
    } else {
      scheduleTempRoleTimer(entryId); // thời lượng dài hơn MAX_TIMEOUT_MS -> hẹn tiếp phần còn lại
    }
  }, Math.min(delay, MAX_TIMEOUT_MS)).unref();
}

// Chạy 1 lần khi bot sẵn sàng: dọn các role tạm thời đã hết hạn trong lúc bot
// tắt/restart, và tiếp tục đếm giờ cho các role tạm thời còn hạn.
function resumeTempRoleTimers() {
  for (const entryId of Object.keys(tempRoleData)) {
    scheduleTempRoleTimer(entryId);
  }
}

// `srole @User role1,role2,... (thời gian)(h/m/s)` — cấp 1 hoặc nhiều role
// cùng lúc (không cần tag role, chỉ cần vài chữ đầu của tên), có thể kèm
// thời gian (vd: 2h, 30m, 45s) để bot tự động gỡ role sau khi hết hạn.
async function handleTempRoleAssign(message, args) {
  if (!args.length) return message.channel.send(userRoleHelp());

  const member = getMemberFromMessage(message, args[0]);
  if (!member) {
    return message.channel.send("❌ Không tìm thấy member. Dùng: `srole @User role1,role2 (thời gian)(h/m/s)`");
  }

  let roleArgs = args.slice(1);
  // Token cuối cùng dạng số+đơn vị (10h/30m/45s) được hiểu là thời gian tự gỡ role.
  const lastToken = roleArgs[roleArgs.length - 1] || "";
  const durationMatch = /^(\d+)(h|m|s)$/i.exec(lastToken);
  if (durationMatch) roleArgs = roleArgs.slice(0, -1);

  const roleQueries = roleArgs.join(" ").split(",").map(s => s.trim()).filter(Boolean);
  if (!roleQueries.length) {
    return message.channel.send("❌ Thiếu role. Dùng: `srole @User role1,role2 (thời gian)(h/m/s)`");
  }

  if (!canManageUserRoles(message)) {
    return message.channel.send("⛔ Bạn cần **Manage Roles** hoặc **PR Manager** để quản lý role.");
  }

  let durationMs = null;
  let durationLabel = "";
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    if (amount <= 0) return message.channel.send("❌ Thời gian phải lớn hơn 0.");
    durationMs = unit === "h" ? amount * 3600000 : unit === "m" ? amount * 60000 : amount * 1000;
    durationLabel = `${amount} ${unit === "h" ? "giờ" : unit === "m" ? "phút" : "giây"}`;
    if (durationMs > MAX_TIMEOUT_MS) {
      return message.channel.send("❌ Thời gian tối đa hỗ trợ là khoảng 24 ngày.");
    }
  }

  const granted = [];
  const removed = [];
  const failed = [];

  for (const query of roleQueries) {
    const { role, reason, candidates } = getAssignableUserRole(message, query);

    if (reason === "ambiguous") {
      const preview = candidates.slice(0, 5).join(", ") + (candidates.length > 5 ? ",..." : "");
      failed.push(`\`${query}\` — trùng ${candidates.length} role (${preview}). Ghi rõ hơn.`);
      continue;
    }
    if (!role) { failed.push(`\`${query}\` — không tìm thấy role.`); continue; }
    if (reason === "everyone") { failed.push(`${role} — không thể cấp/gỡ role @everyone.`); continue; }
    if (reason === "managed") { failed.push(`${role} — role do bot/integration quản lý.`); continue; }
    if (reason === "bot_member") { failed.push(`${role} — không xác định được role cao nhất của bot.`); continue; }
    if (reason === "bot_permission") { failed.push(`${role} — bot chưa có quyền Manage Roles.`); continue; }
    if (reason === "hierarchy") { failed.push(`${role} — đang ngang/cao hơn role cao nhất của bot.`); continue; }

    // Member đã có sẵn role này -> srole đóng vai trò toggle: gỡ luôn thay vì báo lỗi.
    if (member.roles.cache.has(role.id)) {
      try {
        await member.roles.remove(role, `srole toggle-off bởi ${message.author.tag}`);
        // Dọn luôn hẹn giờ tự gỡ (nếu role này từng được cấp tạm thời) để tránh xử lý thừa sau này.
        for (const [entryId, entry] of Object.entries(tempRoleData)) {
          if (entry.guildId === message.guild.id && entry.userId === member.id && entry.roleId === role.id) {
            delete tempRoleData[entryId];
          }
        }
        saveTempRoles(tempRoleData);
        removed.push(role);
      } catch (error) {
        console.error("srole toggle-off thất bại:", error);
        failed.push(`${role} — lỗi khi gỡ role.`);
      }
      continue;
    }

    try {
      await member.roles.add(role, `srole bởi ${message.author.tag}${durationLabel ? ` (${durationLabel})` : ""}`);

      if (durationMs) {
        const entryId = crypto.randomUUID();
        tempRoleData[entryId] = {
          guildId: message.guild.id,
          userId: member.id,
          roleId: role.id,
          roleLabel: role.name,
          addedBy: message.author.id,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + durationMs).toISOString(),
        };
        saveTempRoles(tempRoleData);
        scheduleTempRoleTimer(entryId);
      }

      granted.push(role);
    } catch (error) {
      console.error("srole command thất bại:", error);
      failed.push(`${role} — lỗi khi cấp role.`);
    }
  }

  const lines = [];
  if (granted.length) {
    lines.push(
      `✅ Đã cấp cho ${member}: ${granted.map(r => `${r}`).join(", ")}` +
      (durationLabel ? ` — tự động gỡ sau **${durationLabel}**.` : ".")
    );
  }
  if (removed.length) {
    lines.push(`🗑️ Đã gỡ khỏi ${member} (do đã có sẵn): ${removed.map(r => `${r}`).join(", ")}.`);
  }
  if (failed.length) {
    lines.push(`⚠️ Không xử lý được:\n${failed.map(f => `• ${f}`).join("\n")}`);
  }
  if (!lines.length) lines.push("❌ Không có role nào được xử lý.");

  return message.channel.send(lines.join("\n"));
}

async function handleUserRoleCommand(message, command, args) {
  const sub = String(command || "").toLowerCase();

  if (!sub) return message.channel.send(userRoleHelp());

  const member = getMemberFromMessage(message, args[0]);
  if (!member) {
    return message.channel.send("❌ Không tìm thấy member. Dùng: `srole @User @Role`");
  }

  if (sub === "list") {
    const roles = member.roles.cache
      .filter(role => role.id !== message.guild.id)
      .sort((a, b) => b.position - a.position);

    if (!roles.size) {
      return message.channel.send(`👤 ${member} hiện không có role nào.`);
    }

    return message.channel.send(
      `👤 **Role của ${member.user.tag}:**\n${roles.map(role => `• ${role}`).join("\n")}`
    );
  }

  if (sub !== "add" && sub !== "remove") {
    return message.channel.send(userRoleHelp());
  }

  if (!canManageUserRoles(message)) {
    return message.channel.send("⛔ Bạn cần **Manage Roles** hoặc **PR Manager** để quản lý role.");
  }

  const { role, reason, candidates } = getAssignableUserRole(message, args[1]);
  if (reason === "ambiguous") {
    const preview = candidates.slice(0, 5).join(", ") + (candidates.length > 5 ? ",..." : "");
    return message.channel.send(`❌ \`${args[1]}\` trùng ${candidates.length} role (${preview}). Ghi rõ hơn hoặc tag thẳng role.`);
  }
  if (!role) {
    return message.channel.send("❌ Không tìm thấy role. Dùng: `srole @User @Role`");
  }

  if (reason === "everyone") {
    return message.channel.send("❌ Không thể cấp/gỡ role @everyone.");
  }
  if (reason === "managed") {
    return message.channel.send("❌ Không thể cấp/gỡ role được quản lý bởi bot/integration.");
  }
  if (reason === "bot_member") {
    return message.channel.send("❌ Không thể xác định role cao nhất của bot.");
  }
  if (reason === "bot_permission") {
    return message.channel.send("❌ Bot chưa có quyền **Manage Roles**.");
  }
  if (reason === "hierarchy") {
    return message.channel.send(`❌ Role ${role} đang ngang hoặc cao hơn role cao nhất của bot.`);
  }

  try {
    if (sub === "add") {
      if (member.roles.cache.has(role.id)) {
        return message.channel.send(`ℹ️ ${member} đã có role ${role}.`);
      }
      await member.roles.add(role, `srole bởi ${message.author.tag}`);
      return message.channel.send(`✅ Đã cấp ${role} cho ${member}.`);
    }

    if (!member.roles.cache.has(role.id)) {
      return message.channel.send(`ℹ️ ${member} chưa có role ${role}.`);
    }
    await member.roles.remove(role, `srole remove bởi ${message.author.tag}`);
    for (const [entryId, entry] of Object.entries(tempRoleData)) {
      if (entry.guildId === message.guild.id && entry.userId === member.id && entry.roleId === role.id) {
        delete tempRoleData[entryId];
      }
    }
    saveTempRoles(tempRoleData);
    return message.channel.send(`✅ Đã gỡ ${role} khỏi ${member}.`);
  } catch (error) {
    console.error("User role command thất bại:", error);
    return message.channel.send("❌ Không thể thay đổi role. Kiểm tra quyền Manage Roles và thứ tự role của bot.");
  }
}

function normalizeProfileLine(value) {
  return String(value ?? "")
    // Convert escaped newlines saved as literal \\n into real line breaks.
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "    ");
}

function profileText(profile) {
  const lines = [];
  if (profile.location) lines.push(normalizeProfileLine(profile.location));
  if (profile.description) lines.push(normalizeProfileLine(profile.description));
  if (profile.game) lines.push(normalizeProfileLine(profile.game));
  if (profile.priceGame) lines.push(normalizeProfileLine(profile.priceGame));
  if (profile.priceSing) lines.push(normalizeProfileLine(profile.priceSing));
  if (profile.dealCam) lines.push(normalizeProfileLine(profile.dealCam));
  return lines.join("\n") || "Chưa có thông tin.";
}

function buildEmbed(profile, index = 0, attachmentNames = {}) {
  const total = profile.images.length;

  const embed = new EmbedBuilder()
    .setColor(profile.color || 0x5865f2)
    .setTitle(profile.displayName || profile.name)
    .setDescription(
      `**${profile.nickname || "Chưa có biệt danh"}**\n\n${profileText(profile)}`
    );

  if (profile.avatar) {
    embed.setThumbnail(
      attachmentNames.avatar
        ? `attachment://${attachmentNames.avatar}`
        : profile.avatar
    );
  }

  if (total > 0) {
    embed.setImage(
      attachmentNames.image
        ? `attachment://${attachmentNames.image}`
        : profile.images[index]
    );
  } else {
    embed.setFooter({ text: "Chưa có ảnh profile" });
  }

  return embed;
}

function safeFileName(name) {
  return String(name || "profile")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60);
}

function localImagePath(value) {
  if (!value || !value.startsWith("local:")) return null;
  return path.join(IMAGE_DIR, path.basename(value.slice(6)));
}

function localImageName(value) {
  if (!value || !value.startsWith("local:")) return null;
  return path.basename(value.slice(6));
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

async function saveAttachmentToDisk(baseName, type, attachment) {
  const base = safeFileName(baseName);
  const ext = extensionFromAttachment(attachment);
  const fileName =
    `${base}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
  const filePath = path.join(IMAGE_DIR, fileName);

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Download ảnh thất bại: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return `local:${fileName}`;
}

async function saveAttachmentLocally(profile, type, attachment) {
  return saveAttachmentToDisk(profile.name, type, attachment);
}

function profileFiles(profile, index = 0) {
  const files = [];
  const names = {};

  const avatarPath = localImagePath(profile.avatar);
  if (avatarPath && fs.existsSync(avatarPath)) {
    const name = path.basename(avatarPath);
    files.push(new AttachmentBuilder(avatarPath).setName(name));
    names.avatar = name;
  }

  const imagePath = localImagePath(profile.images[index]);
  if (imagePath && fs.existsSync(imagePath)) {
    const name = path.basename(imagePath);
    files.push(new AttachmentBuilder(imagePath).setName(name));
    names.image = name;
  }

  return { files, names };
}

function removeLocalImage(value) {
  const filePath = localImagePath(value);
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

function buildProfileComponentsV2(profile, index = 0, attachmentNames = {}) {
  const total = profile.images.length;
  const current = total ? Math.max(0, Math.min(index, total - 1)) : 0;
  const imageUrl = total
    ? (attachmentNames.image ? `attachment://${attachmentNames.image}` : profile.images[current])
    : null;

  const text = new TextDisplayBuilder().setContent(
    `# ${profile.displayName || profile.name}\n` +
    `**${profile.nickname || "Chưa có biệt danh"}**\n\n` +
    `${profileText(profile)}`
  );

  const section = new SectionBuilder().addTextDisplayComponents(text);

  const avatarUrl = profile.avatar
    ? (attachmentNames.avatar ? `attachment://${attachmentNames.avatar}` : profile.avatar)
    : (imageUrl || "https://cdn.discordapp.com/embed/avatars/0.png");
  section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));

  const container = new ContainerBuilder()
    .setAccentColor(profile.color || 0x5865f2)
    .addSectionComponents(section);

  if (imageUrl) {
    const gallery = new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(imageUrl)
        .setDescription(`${profile.displayName || profile.name} - ảnh ${current + 1}/${total}`)
    );
    container.addMediaGalleryComponents(gallery);
  }

  if (total > 0 && total > 1) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true)
    );

    const previous = new ButtonBuilder()
      .setCustomId("pr_prev")
      .setLabel("≪")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current <= 0);

    const counter = new ButtonBuilder()
      .setCustomId("pr_counter")
      .setLabel(`${current + 1}/${total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const next = new ButtonBuilder()
      .setCustomId("pr_next")
      .setLabel("≫")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current >= total - 1);

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(previous, counter, next)
    );
  }

  return container;
}

function profileV2Payload(profile, index = 0, media = { files: [], names: {} }) {
  return {
    components: [buildProfileComponentsV2(profile, index, media.names)],
    files: media.files,
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildButtons(profile, index) {
  const total = profile.images.length;

  const previous = new ButtonBuilder()
    .setCustomId("pr_prev")
    .setEmoji("◀️")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(total <= 1);

  const counter = new ButtonBuilder()
    .setCustomId("pr_counter")
    .setLabel(`${total ? index + 1 : 0}/${total}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const next = new ButtonBuilder()
    .setCustomId("pr_next")
    .setEmoji("▶️")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(total <= 1);

  return new ActionRowBuilder().addComponents(previous, counter, next);
}

function buildListEmbeds(ownerId = null) {
  const arr = Object.values(profiles).filter(
    (p) => !ownerId || p.ownerId === ownerId
  );

  return arr.slice(0, 10).map((p) => {
    const e = new EmbedBuilder()
      .setColor(p.color || 0x5865f2)
      .setTitle(p.name)
      .setDescription(
        `**${p.nickname || "Chưa có biệt danh"}**\n\n${profileText(p)}`
      );

    if (p.avatar) e.setThumbnail(p.avatar);
    if (p.images.length) e.setImage(p.images[0]);

    return e;
  });
}

function helpPages() {
  return [
    {
      title: "📖 PROFILE BOT — PROFILE",
      description: [
        "**👤 TẠO / XEM / QUẢN LÝ**",
        '`sar add "name"` — tạo profile mới',
        '`sar del "name"` — xóa profile',
        '`sar s "name"` — xem profile, dùng ◀️ ▶️ để chuyển ảnh',
        '`sar l` — hiển thị tất cả profile',
        "",
        "**✏️ CHỈNH TOÀN BỘ PROFILE — 1 LỆNH**",
        '`sar des "name"` — chỉnh toàn bộ profile theo 6 dòng: name / nickname / địa điểm / game / giá game / cam',
        "Bỏ trống 1 dòng = giữ nguyên giá trị cũ của trường đó.",
        "",
        "**🔗 LIÊN KẾT PROFILE VỚI PLAYER**",
        '`sar set "pr5" @User` — liên kết profile với 1 player',
        '`sar unset "pr5" @User` — hủy liên kết',
        '`sar links` — xem danh sách các liên kết hiện có',
      ].join("\n"),
    },
    {
      title: "🖼️ PROFILE — ẢNH & GIAO DIỆN",
      description: [
        "**🖼️ QUẢN LÝ ẢNH**",
        '`sar turl "name"` + đính kèm ảnh — đặt avatar nhỏ ở góc phải',
        '`sar addpic <số>` + đính kèm ảnh — chèn ảnh vào vị trí; reply vào tin nhắn profile',
        '`sar delpic "name" <số>` — xóa 1 ảnh theo số thứ tự',
        '`sar delpic all "name"` — xóa toàn bộ ảnh lớn',
        "",
        "**🎨 GIAO DIỆN EMBED**",
        '`sar color "name" #ff69b4` — đổi màu embed theo mã hex',
        '`sar co "name" reset` — reset về màu mặc định',
        '`sar rs "name"` — tìm lại embed cũ nếu bị trôi màn hình',
        "",
        "**🧩 STEAL EMOJI**",
        '`sar steal <:emoji:id> [tên_mới]` — thêm custom emoji vào server; hoặc reply vào tin nhắn chứa emoji rồi gõ `sar steal`',
        '`/steal emoji:<:emoji:id> name:<tên_mới>` — thêm custom emoji (bản slash command)',
      ].join("\n"),
    },
    {
      title: "📊 HPROFILE, TIỆN ÍCH & CASH",
      description: [
        "**📊 XEM CHỈ SỐ BOOK — HPROFILE**",
        '`sprofile` — xem số giờ + số tiền mình đã book',
        '`sprofile @User` — xem chỉ số book của 1 player khác',
        "",
        "**💰 XEM LƯƠNG NHANH — SLUONG** *(ai cũng dùng được)*",
        '`sluong` — gửi bảng lương tuần của mình vào DM',
        '`sluong @User` — gửi bảng lương của 1 player khác vào DM *(PR Manager)*',
        "",
        "**🎲 TIỆN ÍCH NGẪU NHIÊN**",
        '`srd <số 1> <số 2>` — random 1 số trong khoảng cho trước',
        '`spick lựa chọn 1, lựa chọn 2, ...` — random 1 trong nhiều lựa chọn',
        "",
        "**💵 CASH**",
        '`scash` — xem số dư Cash của mình',
        '`scash @User` — xem số dư Cash của 1 player',
        '`scash add @User <số tiền>` — cộng Cash cho player',
        '`scash del @User <số tiền>` — trừ Cash của player',
        '`/pay cash <số tiền> <tag>` — tạo bill nạp Cash theo tỉ lệ 1:1, chỉ cộng tiền khi thanh toán thành công',
        `Mỗi bill QR đều có nút **💰 Trả bằng lương**: người trả có thể bấm nút này để trừ thẳng vào lương tuần thay vì chuyển khoản (lương còn lại sau khi trừ không được thấp hơn ${MIN_SALARY_AFTER_PAY.toLocaleString("vi-VN")}đ).`,
        "",
        "**🛒 SHOP — MUA BẰNG CASH** *(PR Manager thêm/xóa vật phẩm)*",
        '`sshop` — xem shop (đánh số, có nút **Buy!** riêng từng món, phân trang 5 món/trang)',
        '`sshop add "Tên vật phẩm" <giá> [emoji]` — thêm vật phẩm mới; nếu không truyền emoji thì đính kèm 1 ảnh thay thế',
        '`sshop del "Tên vật phẩm"` — xóa vật phẩm khỏi shop',
        '`sshop buy "Tên vật phẩm"` — mua vật phẩm, trừ Cash và lưu vào kho đồ',
        "",
        "**🎒 KHO ĐỒ — INVENTORY**",
        '`sinv` — xem kho đồ (các vật phẩm đã mua) của mình',
        '`sinv @User` — xem kho đồ của 1 player khác *(PR Manager)*',
      ].join("\n"),
    },
    {
      title: "🤖 AUTORES",
      description: [
        "Bot tự động trả lời khi có người gõ đúng trigger đã cấu hình.",
        "",
        "**📝 TẠO TRIGGER**",
        '`sar a "trigger" | nội dung` — tạo trigger kèm nội dung',
        '`sar a "trigger"` — tạo trigger không có nội dung',
        "",
        "**✏️ CHỈNH NỘI DUNG / ẢNH**",
        '`sar content "trigger" | nội dung mới` — sửa nội dung trigger',
        '`sar iurl "profile"` + 1 hoặc nhiều ảnh — thêm ảnh vào danh sách ảnh lớn của profile',
        '`sar iurl "trigger"` + 1 ảnh — thêm/thay ảnh cho trigger AutoRes (tự chuyển type sang embed)',
        '`sar del "trigger"` — xóa trigger',
      ].join("\n"),
    },
    {
      title: "🔐 QUYỀN",
      description: [
        "**👤 ROLE MANAGER**",
        '`srole @User @Role` — cấp role cho member',
        '`srole @User @Role 10m` — cấp role tạm thời (đơn vị h/m/s), tự động gỡ khi hết hạn',
        '`srole remove @User @Role` — gỡ role khỏi member',
        '`srole list @User` — xem danh sách role của member',
        "",
        "**👑 PR ADMIN**",
        '`sar pradmin add @Role` — cấp quyền PR Admin cho role',
        '`sar pradmin remove @Role` — gỡ quyền PR Admin',
        '`sar pradmin list` — xem các role đang có quyền PR Admin',
        '`sar luongchannel #kenh` — đặt kênh để PR Admin duyệt lương',
        "",
        "**🔐 PR MANAGER**",
        '`sar roleadd @Role` — cấp quyền sửa PR cho role',
        '`sar roleremove @Role` — gỡ quyền sửa PR',
        '`sar roles` — xem các role đang có quyền sửa PR',
        "",
        "**📋 KÊNH LOG** *(Manage Server)*",
        '`sar logchannel luong #kenh` — đặt kênh log các thao tác lương (duyệt cộng, ứng, trừ, donate, reset)',
        '`sar logchannel ticket #kenh` — đặt kênh log mở/đóng ticket',
        '`sar logchannel reactbill #kenh` — đặt kênh log tạo/dừng React Bill',
        '`sar logchannel security #kenh` — đặt kênh cảnh báo Anti-Raid / Anti-Nuke',
        '`sar logchannel backup #kenh` — đặt kênh log khi tạo/khôi phục Backup Server',
        '`sar logchannel list` — xem các kênh log hiện đang được cấu hình',
        "",
        "**🛡️ ANTI-RAID / ANTI-NUKE**",
        "Xem chi tiết ở trang Help riêng **🛡️ ANTI-RAID & ANTI-NUKE**.",
        "",
        "**💾 BACKUP SERVER** *(Owner, Administrator hoặc PR Admin)*",
        '`sar backup create [ghi chú]` — chụp lại toàn bộ role, kênh, phân quyền hiện tại của server',
        '`sar backup list` — xem danh sách backup đã lưu (tối đa 10 bản gần nhất)',
        '`sar backup info <id>` — xem chi tiết 1 bản backup',
        '`sar backup restore <id>` — khôi phục role/kênh/phân quyền về đúng như backup (có bước xác nhận trước khi thực hiện)',
        '`sar backup delete <id>` — xóa 1 bản backup',
        "ℹ️ Backup không lưu tin nhắn. Restore sẽ tạo lại role/kênh đã bị xóa và ghi đè role/kênh còn tồn tại về đúng backup, không xóa role/kênh phát sinh sau đó.",
        "",
        "ℹ️ PR Admin có quyền cao hơn PR Manager. Mọi thao tác cộng lương đều cần PR Admin xác nhận trước khi có hiệu lực.",
      ].join("\n"),
    },
    {
      title: "🛡️ ANTI-RAID & ANTI-NUKE",
      description: [
        "**🛡️ ANTI-RAID** *(Owner, Administrator hoặc PR Admin)* — chống raid hàng loạt tài khoản join server",
        '`sar antiraid on` / `sar antiraid off` — bật / tắt',
        '`sar antiraid config <join> <giây> <lockdown phút>` — VD `sar antiraid config 5 10 15`: 5 join trong 10s thì khoá server 15 phút',
        '`sar antiraid action kick|ban` — hành động áp dụng khi phát hiện raid',
        '`sar antiraid minage <giờ>` — tự động xử lý tài khoản Discord mới hơn N giờ khi vừa join (0 = tắt)',
        '`sar antiraid` (không kèm gì) — xem trạng thái cấu hình hiện tại',
        "",
        "**🛡️ ANTI-NUKE** *(Owner, Administrator hoặc PR Admin)* — chống hành vi phá server từ tài khoản có quyền",
        '`sar antinuke on` / `sar antinuke off` — bật / tắt',
        '`sar antinuke config <số hành động> <giây>` — VD `sar antinuke config 3 30`: 3 hành động phá server trong 30s từ 1 tài khoản thì bị xử lý',
        '`sar antinuke action strip|kick|ban` — gỡ toàn bộ role / kick / ban tài khoản vi phạm',
        '`sar antinuke whitelist add @User` (hoặc `@Role`) — miễn trừ khỏi Anti-Nuke',
        '`sar antinuke whitelist remove @User` (hoặc `@Role`) — gỡ khỏi whitelist',
        '`sar antinuke` (không kèm gì) — xem trạng thái cấu hình hiện tại',
        "Theo dõi: xoá kênh, xoá role, ban, kick, tạo webhook. Chủ server (Owner) luôn được miễn trừ.",
        "",
        '`sar logchannel security #kenh` — đặt kênh cảnh báo chung cho cả Anti-Raid và Anti-Nuke',
      ].join("\n"),
    },
    {
      title: "👋 THÔNG BÁO CHÀO MỪNG (TB WLC)",
      description: [
        "Tự động gửi tin chào (embed) vào 1 kênh khi có thành viên mới join server.",
        "",
        '`sar tb wlc set #kenh` — đặt kênh gửi tin chào (tự động bật)',
        '`sar tb wlc msg Nội dung` — đặt nội dung tin chào, hỗ trợ `{user}` `{username}` `{server}` `{membercount}`',
        '`sar tb wlc img <link>` — đặt ảnh/gif lớn cho tin chào (hoặc đính kèm ảnh/gif cùng lệnh)',
        '`sar tb wlc img off` — gỡ ảnh/gif riêng, dùng lại banner server (nếu có)',
        '`sar tb wlc on` / `sar tb wlc off` — bật / tắt',
        '`sar tb wlc test` — gửi thử tin chào vào kênh đã đặt (dùng chính bạn làm thành viên mẫu)',
        '`sar tb wlc view` — xem cấu hình hiện tại',
        "",
        "Không đặt nội dung riêng thì bot dùng mẫu mặc định kèm avatar thành viên và banner server (nếu có).",
      ].join("\n"),
    },
    {
      title: "🎫 TICKET — PANEL & THREAD",
      description: [
        "**🎫 SETUP PANEL**",
        '`!tic setup #channel` — tạo panel ticket trong 1 kênh',
        '`!tic role add @Support` — thêm role được xem là Support',
        '`!tic role remove @Support` — bỏ 1 role Support',
        '`!tic role list` — xem danh sách role Support',
        '`!tic send` — gửi hoặc cập nhật lại panel',
        '`!tic title "Tiêu đề"` — sửa tiêu đề panel',
        '`!tic desc "Nội dung"` — sửa nội dung panel',
        '`!tic welcome "Nội dung"` — sửa nội dung chào mặc định khi ticket vừa mở',
        '`!tic welcome <booking/apply/support> | Nội dung` — sửa nội dung chào riêng cho 1 loại ticket',
        '`!tic welcome <booking/apply/support> | reset` — gỡ nội dung riêng, dùng lại mặc định',
        '`!tic welcome list` — xem nội dung chào của từng loại ticket',
        "",
        "**🔘 NÚT MỞ TICKET**",
        '`!ticb add support "Support" 🛠️` — thêm 1 nút mở ticket',
        '`!ticb edit support "Hỗ trợ" 🔧` — sửa tên/emoji của nút',
        '`!ticb remove support` — xóa nút',
        '`!ticb list` — xem danh sách nút hiện có',
        "",
        "Mỗi nút khi bấm sẽ mở ra 1 **Private Thread** riêng trong cùng kênh panel.",
      ].join("\n"),
    },
    {
      title: "🧾 REACT BILL",
      description: [
        "**🧾 BILL**",
        '`/reactbill setup #channel` — chọn kênh dùng React Bill *(PR Manager)*',
        '`/reactbill create` — tạo Bill trong ticket (dành cho Support/SUP); có thể chọn `ping_role` để bot tự ping nhắc role đó mỗi 1 phút, tối đa 3 lần (tin ping cũ tự xóa sau 1 phút)',
        "",
        "Player bấm nút **React Bill** → bot tự đưa PR5 của player đó vào ticket theo đúng thứ tự đã react.",
        "**Huỷ React** — chỉ xóa PR5 của chính player bấm.",
        "**Dừng Bill** — khóa Bill lại, không nhận react mới.",
      ].join("\n"),
    },
    {
      title: "💰 /luong — XEM & QUẢN LÝ",
      description: [
        "**👀 XEM LƯƠNG**",
        '`/luong` — xem bảng lương tuần hiện tại',
        '`/luong action:Xem` — xem bảng lương (tương đương lệnh trên)',
        "",
        "**➕ CỘNG CA / LƯƠNG** *(PR Manager)*",
        '`/luong action:Cộng ca player:@Player tien:40000 gio:2 ca:Sáng ghi_chu:làm ca sáng` — cộng 1 ca làm việc cho player',
        "",
        "**💸 ỨNG / ➖ TRỪ / 💙 DONATE** *(PR Manager)*",
        '`/luong action:Ứng player:@Player tien:50000 ghi_chu:...` — cho player ứng trước tiền lương',
        '`/luong action:Trừ player:@Player tien:50000 ghi_chu:...` — trừ tiền lương của player',
        '`/luong action:Donate player:@Player tien:50000 ghi_chu:...` — ghi nhận donate cho player',
        '`/luong action:Reset 1 thành viên player:@Player` — xóa toàn bộ dữ liệu lương của riêng 1 player (không thể hoàn tác)',
        '`/luong action:Reset toàn bộ` — xóa toàn bộ dữ liệu lương của mọi player trong server (cẩn thận, không thể hoàn tác)',
        "",
        "**📢 GỬI THẲNG VÀO KÊNH**",
        '`/stinhluong` — gửi bảng lương của bạn thẳng vào kênh hiện tại (mọi người đều thấy)',
        '`/stinhluong player:@Player` — gửi bảng lương của player đó vào kênh *(PR Manager)*',
        '`sar stinhluong @Player` — bản gõ lệnh (prefix) tương đương, bỏ trống @Player = xem lương của bạn',
        "",
        "ℹ️ `sang` = ca sáng, `dem` = ca đêm. Mọi thao tác cộng/trừ/ứng/donate/reset chỉ dành cho **PR Manager** hoặc người có quyền **Manage Server**.",
      ].join("\n"),
    },
    {
      title: "🧠 AI — REPLY CHAT",
      description: [
        "**💬 CÁCH DÙNG**",
        "Reply trực tiếp vào 1 tin nhắn do bot gửi → AI sẽ trả lời tiếp câu chuyện.",
        "",
        "**⚙️ CẤU HÌNH**",
        '`sar ai on` — bật AI',
        '`sar ai off` — tắt AI',
        '`sar ai status` — xem trạng thái AI hiện tại',
        '`sar ai prompt "Bạn là bot thân thiện..."` — đổi tính cách/system prompt của AI',
        '`sar ai model "llama-3.3-70b-versatile"` — đổi model AI đang dùng',
        '`sar ai clear` — xóa prompt tùy chỉnh, quay về mặc định',
      ].join("\n"),
    },
  ];
}

function buildHelpButtons(page, total, ownerId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pr_help_prev:${ownerId}`)
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId("pr_help_counter")
      .setLabel(`${page + 1}/${total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`pr_help_next:${ownerId}`)
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= total - 1),
  );
}

function buildHelpPageSelect(page, total, ownerId) {
  const pages = helpPages();
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`pr_help_select:${ownerId}`)
    .setPlaceholder("📖 Chọn trang Help")
    .addOptions(pages.map((item, index) => ({
      label: item.title.replace(/^[^ ]+ /, "").slice(0, 100),
      value: String(index),
      description: `Xem nội dung trang ${index + 1}`.slice(0, 100),
      default: index === page,
    })));

  return new ActionRowBuilder().addComponents(menu);
}

function buildHelpEmbed(page, total) {
  const data = helpPages()[page];
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(data.title)
    .setDescription(data.description)
    .setFooter({ text: `Help • Trang ${page + 1}/${total}` });
}

async function sendHelp(message) {
  const pages = helpPages();
  let page = 0;
  const sent = await message.channel.send({
    embeds: [buildHelpEmbed(page, pages.length)],
    components: [
      buildHelpPageSelect(page, pages.length, message.author.id),
      buildHelpButtons(page, pages.length, message.author.id),
    ],
  });

  const collector = sent.createMessageComponentCollector({ time: 15 * 60 * 1000 });
  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: "Chỉ người dùng lệnh `sar h` mới được chuyển trang.", flags: MessageFlags.Ephemeral });
    }

    if (interaction.customId.startsWith("pr_help_prev:")) {
      page = Math.max(0, page - 1);
    } else if (interaction.customId.startsWith("pr_help_next:")) {
      page = Math.min(pages.length - 1, page + 1);
    } else if (interaction.customId.startsWith("pr_help_select:")) {
      const selected = Number(interaction.values?.[0]);
      if (Number.isInteger(selected) && selected >= 0 && selected < pages.length) page = selected;
    } else {
      return interaction.deferUpdate();
    }

    await interaction.update({
      embeds: [buildHelpEmbed(page, pages.length)],
      components: [
        buildHelpPageSelect(page, pages.length, message.author.id),
        buildHelpButtons(page, pages.length, message.author.id),
      ],
    });
  });

  collector.on("end", async () => {
    try {
      const navRow = buildHelpButtons(page, pages.length, message.author.id);
      navRow.components.forEach(button => button.setDisabled(true));
      const selectRow = buildHelpPageSelect(page, pages.length, message.author.id);
      selectRow.components[0].setDisabled(true);
      await sent.edit({ components: [selectRow, navRow] });
    } catch {}
  });
}

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

function getGuildPRKeywords(guildId) {
  if (!prKeywords[guildId] || typeof prKeywords[guildId] !== "object") {
    prKeywords[guildId] = {};
  }
  return prKeywords[guildId];
}

function syncProfileNameTriggers(guildId) {
  const guildKeywords = getGuildPRKeywords(guildId);
  let changed = false;

  for (const profile of Object.values(profiles)) {
    const name = String(profile?.name || "").trim();
    const trigger = normalizeTrigger(name);
    if (!trigger) continue;

    // Chỉ bổ sung trigger còn thiếu. Không ghi đè keyword thủ công đã có.
    if (!guildKeywords[trigger]) {
      guildKeywords[trigger] = name;
      changed = true;
    }
  }

  if (changed) savePRKeywords(prKeywords);
  return changed;
}

async function syncAllProfileNameTriggers() {
  let changedGuilds = 0;
  for (const guild of client.guilds.cache.values()) {
    if (syncProfileNameTriggers(guild.id)) changedGuilds++;
  }
  console.log(`[Profile Trigger] Đã đồng bộ trigger cho profile cũ: ${changedGuilds} server có thay đổi.`);
}

function findKeywordProfile(guildId, keyword) {
  const key = normalizeTrigger(keyword);
  if (!key) return null;
  const profileName = getGuildPRKeywords(guildId)[key];
  return profileName ? findProfile(profileName) : null;
}

function findKeywordEntry(guildId, keyword) {
  const key = normalizeTrigger(keyword);
  if (!key) return null;
  const profileName = getGuildPRKeywords(guildId)[key];
  return profileName ? { key, profileName, profile: findProfile(profileName) } : null;
}

// Chống xử lý keyword trùng do cùng một message/event bị dispatch nhiều lần.
const keywordResponseLocks = new Map();

function keywordResponseKey(message) {
  return message?.id || `${message?.guild?.id || "0"}:${message?.channel?.id || "0"}:${message?.author?.id || "0"}:${normalizeTrigger(message?.content || "")}`;
}

function acquireKeywordResponseLock(message, ttlMs = 4000) {
  const key = keywordResponseKey(message);
  const now = Date.now();
  const existing = keywordResponseLocks.get(key);
  if (existing && existing > now) return false;

  keywordResponseLocks.set(key, now + ttlMs);

  // Dọn lock cũ để Map không phình theo thời gian.
  if (keywordResponseLocks.size > 500) {
    for (const [lockKey, expiresAt] of keywordResponseLocks) {
      if (expiresAt <= now) keywordResponseLocks.delete(lockKey);
    }
  }

  return true;
}

async function sendKeywordProfile(message, profile) {
  let current = 0;
  let media = profileFiles(profile, current);

  const payload = profileV2Payload(profile, current, media);
  if (!media.files.length) delete payload.files;
  const sent = await message.channel.send(payload);

  registerShownMessage(profile, sent, current);
  saveProfiles(profiles);

  // Không tạo collector cho profile. Nút profile được xử lý bởi
  // interactionCreate toàn cục bên dưới, nên vẫn hoạt động sau khi bot restart.
}

// ===== NÚT PROFILE BỀN SAU KHI BOT RESTART =====
// Collector chỉ tồn tại trong RAM. Sau khi bot tắt/bật lại, collector cũ mất nên
// các nút ◀️/▶️ trên embed cũ sẽ không còn ai xử lý. Ta dựa vào shownMessages
// đã lưu trong profiles.json để xử lý button interaction ở cấp client.
async function handleProfileButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (interaction.customId !== "pr_prev" && interaction.customId !== "pr_next") return false;
  if (!interaction.guildId || !interaction.channelId || !interaction.message) return false;

  let foundProfile = null;
  let foundEntry = null;

  for (const profile of Object.values(profiles)) {
    const entry = ensureShownMessages(profile).find((x) =>
      x.guildId === interaction.guildId &&
      x.channelId === interaction.channelId &&
      x.messageId === interaction.message.id
    );
    if (entry) {
      foundProfile = profile;
      foundEntry = entry;
      break;
    }
  }

  if (!foundProfile || !foundEntry) {
    await interaction.reply({
      content: "⚠️ Embed profile này chưa được bot ghi nhận. Dùng `sar resync \"Tên profile\"` để bot đăng lại board.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!Array.isArray(foundProfile.images) || foundProfile.images.length <= 1) {
    const media = profileFiles(foundProfile, 0);
    const payload = profileV2Payload(foundProfile, 0, media);
    if (!media.files.length) delete payload.files;
    await interaction.update(payload);
    return true;
  }

  const total = foundProfile.images.length;
  let current = clampProfileIndex(foundProfile, foundEntry.current);

  if (interaction.customId === "pr_prev") {
    current = (current - 1 + total) % total;
  } else {
    current = (current + 1) % total;
  }

  const media = profileFiles(foundProfile, current);
  foundEntry.current = current;
  saveProfiles(profiles);

  const payload = profileV2Payload(foundProfile, current, media);
  if (!media.files.length) delete payload.files;
  await interaction.update(payload);

  return true;
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

function autoResHelp() {
  return [
    "**🤖 AUTORES**",
    '`/ar create` → chọn trigger + type, sau đó Text mở form Content; Embed mở form Content/Title/Desc/Color/Footer`',
    '',
    '`/ar content "hello" "Xin chào 👋"`',
    '`/ar title "hello" "Tiêu đề"`',
    '`/ar desc "hello" "Mô tả"`',
    '`/ar color "hello" #ff69b4`',
    '`/ar footer "hello" "Footer"`',
    '`/ar thumb "hello"` + ảnh',
    '`/ar image "hello"` + ảnh',
    '`/ar type "hello" text|embed`',
    '`/ar mode "hello" exact|contains`',
    '`/ar on "hello"` / `/ar off "hello"`',
    '`/ar list`',
    '`/ar delete "hello"`',
  ].join("\n");
}

async function handleAutoResCommand(message, args) {
  const sub = (args.shift() || "").toLowerCase();
  if (!sub) return message.channel.send(autoResHelp());

  const guildData = getGuildAutoRes(message.guild.id);
  const trigger = args[0];
  const record = trigger ? findAutoRes(message.guild.id, trigger) : null;
  const needsManager = ["create", "delete", "content", "title", "desc", "color", "footer", "thumb", "image", "type", "mode", "on", "off"].includes(sub);

  if (needsManager && !hasPRManagerRole(message)) {
    return message.channel.send("⛔ Bạn không có quyền quản lý AutoRes. Cần PR Manager.");
  }

  if (sub === "create") {
    const type = (args[args.length - 1] || "").toLowerCase();
    if (!["text", "embed"].includes(type)) return message.channel.send('Dùng: `/ar create` → chọn trigger + type, sau đó Text mở form Content; Embed mở form Content/Title/Desc/Color/Footer` hoặc ');
    args.pop();
    const key = normalizeTrigger(args.join(" "));
    if (!key) return message.channel.send('Dùng: `/ar create "hello" text|embed`');
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
    return message.channel.send(`✅ Đã tạo AutoRes **${guildData[key].trigger}** dạng **${type}**.`);
  }

  if (sub === "list") {
    const entries = Object.values(guildData);
    if (!entries.length) return message.channel.send("🤖 Server chưa có AutoRes nào.");
    const lines = entries.map((r, i) => `${i + 1}. ${r.enabled ? "🟢" : "🔴"} **${r.trigger}** — ${r.type} — ${r.mode}`);
    return message.channel.send(`**🤖 AutoRes (${entries.length})**\n${lines.join("\n")}`);
  }

  if (sub === "delete") {
    if (!record) return message.channel.send("Không tìm thấy AutoRes.");
    removeLocalImage(record.embed.thumbnail);
    removeLocalImage(record.embed.image);
    delete guildData[normalizeTrigger(trigger)];
    saveAutoRes(autoRes);
    return message.channel.send(`🗑️ Đã xóa AutoRes **${record.trigger}**.`);
  }

  if (!record) return message.channel.send('Không tìm thấy AutoRes. Dùng `/ar list` để xem danh sách.');

  if (sub === "on" || sub === "off") {
    record.enabled = sub === "on";
    saveAutoRes(autoRes);
    return message.channel.send(`${record.enabled ? "🟢 Đã bật" : "🔴 Đã tắt"} AutoRes **${record.trigger}**.`);
  }

  if (sub === "type") {
    const type = (args[1] || "").toLowerCase();
    if (!["text", "embed"].includes(type)) return message.channel.send('Dùng: `/ar type "hello" text|embed`');
    record.type = type;
    saveAutoRes(autoRes);
    return message.channel.send(`✅ AutoRes **${record.trigger}** giờ là **${type}**.`);
  }

  if (sub === "mode") {
    const mode = (args[1] || "").toLowerCase();
    if (!["exact", "contains"].includes(mode)) return message.channel.send('Dùng: `/ar mode "hello" exact|contains`');
    record.mode = mode;
    saveAutoRes(autoRes);
    return message.channel.send(`✅ Trigger **${record.trigger}** dùng mode **${mode}**.`);
  }

  if (sub === "content") {
    record.content = args.slice(1).join(" ").trim();
    saveAutoRes(autoRes);
    return message.channel.send(`✅ Đã cập nhật nội dung AutoRes **${record.trigger}**.`);
  }

  if (sub === "title" || sub === "desc" || sub === "footer") {
    const value = args.slice(1).join(" ").trim();
    const field = sub === "desc" ? "description" : sub;
    record.embed[field] = value;
    saveAutoRes(autoRes);
    return message.channel.send(`✅ Đã cập nhật ${field} cho **${record.trigger}**.`);
  }

  if (sub === "color") {
    const value = (args[1] || "").trim().toLowerCase();
    if (value === "reset") record.embed.color = 0x5865f2;
    else if (/^#?[0-9a-f]{6}$/i.test(value)) record.embed.color = parseInt(value.replace("#", ""), 16);
    else return message.channel.send('Dùng: `/ar color "hello" #ff69b4` hoặc `reset`');
    saveAutoRes(autoRes);
    return message.channel.send(`🎨 Đã cập nhật màu AutoRes **${record.trigger}**.`);
  }

  if (sub === "thumb" || sub === "image") {
    const attachment = getAttachments(message)[0];
    if (!attachment) return message.channel.send(`Hãy đính kèm ảnh cùng lệnh: \`/ar ${sub} "${record.trigger}"\``);
    try {
      const field = sub === "thumb" ? "thumbnail" : "image";
      const old = record.embed[field];
      const stored = await saveAutoResAttachment(record.trigger, field, attachment);
      record.embed[field] = stored;
      removeLocalImage(old);
      saveAutoRes(autoRes);
      return message.channel.send(`✅ Đã cập nhật ${sub === "thumb" ? "thumbnail" : "image"} cho AutoRes **${record.trigger}**.`);
    } catch (error) {
      console.error(error);
      return message.channel.send("❌ Không thể lưu ảnh AutoRes.");
    }
  }

  return message.channel.send(autoResHelp());
}

function findMatchingAutoRes(guildId, content) {
  if (runtimeConfigReload.autoRes) {
    autoRes = loadAutoRes();
    runtimeConfigReload.autoRes = false;
  }
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


function getTicketRecord(guildId, channelId) {
  const cfg = getGuildTickets(guildId);
  return { cfg, record: cfg.threads[channelId] || null };
}

function buildReactBillEmbed(bill) {
  const players = bill.players || [];
  const lines = players.length
    ? players.map((p, i) => {
        const profileName = p.profileName || "Chưa có tên profile";
        return `**${String(i + 1).padStart(2, "0")}. ${profileName}**\\n↳ <@${p.userId}> ✦ ${profileName}`;
      }).join("\n")
    : "Chưa có ai tham gia React Bill.";

  const embed = new EmbedBuilder()
    .setColor(bill.status === "active" ? 0x57f287 : 0xed4245)
    .setTitle("🧾 REACT BILL")
    .setDescription([
      `**Chủ trì:** <@${bill.createdBy}>`,
      `**Trạng thái:** ${bill.status === "active" ? "🟩 Đang nhận React" : "🟥 Đã kết thúc"}`,
      "",
      `**Danh sách tham gia (${players.length}):**`,
      lines,
      "",
    ].join("\n"));

  // Tất cả React Bill dùng chung một ảnh cố định.
  // Ảnh được gửi kèm message nên không phụ thuộc link bên ngoài.
  if (fs.existsSync(REACTBILL_IMAGE_FILE)) {
    embed.setThumbnail(`attachment://${REACTBILL_IMAGE_NAME}`);
  }

  return embed;
}

function buildReactBillPayload(bill) {
  const payload = {
    content: bill.request
      ? `🌸 **Yêu cầu:** ${bill.request}`
      : null,
    embeds: [buildReactBillEmbed(bill)],
    components: buildReactBillButtons(bill),
  };

  // Phải gửi lại attachment mỗi lần tạo/cập nhật Embed để thumbnail
  // `attachment://reactbill_image.png` luôn còn hiệu lực.
  if (fs.existsSync(REACTBILL_IMAGE_FILE)) {
    payload.files = [new AttachmentBuilder(REACTBILL_IMAGE_FILE, {
      name: REACTBILL_IMAGE_NAME,
    })];
  }

  return payload;
}

function buildReactBillButtons(bill) {
  const active = bill.status === "active";
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`reactbill_react:${bill.id}`).setLabel("React Bill").setStyle(ButtonStyle.Success).setDisabled(!active),
    new ButtonBuilder().setCustomId(`reactbill_cancel:${bill.id}`).setLabel("Huỷ React").setStyle(ButtonStyle.Secondary).setDisabled(!active),
    new ButtonBuilder().setCustomId(`reactbill_stop:${bill.id}`).setLabel("Dừng Bill").setStyle(ButtonStyle.Danger).setDisabled(!active),
  )];
}

async function updateReactBillMessage(guild, bill) {
  const channel = await guild.channels.fetch(bill.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !bill.messageId) return;
  const msg = await channel.messages.fetch(bill.messageId).catch(() => null);
  if (!msg) return;
  await msg.edit(buildReactBillPayload(bill)).catch(() => {});
}

// Giá theo khung giờ Việt Nam:
// - 07:00 -> 22:00 (giờ bắt đầu trong khoảng [7,22)): 25.000đ/giờ/người
// - 22:00 -> 07:00 (giờ bắt đầu trong khoảng [22,24) hoặc [0,7)): 30.000đ/giờ/người
// Lấy nguyên mức giá theo giờ BẮT ĐẦU book, không tách giá khi vắt qua mốc.
function reactBillHourlyRate(startHour) {
  const h = Number(startHour);
  return (h >= 7 && h < 22) ? 25000 : 30000;
}

// Ca làm việc của player dùng chung mốc giờ với giá khách (07:00 - 22:00 là ca sáng).
// Lương player: 20.000đ/giờ ca sáng, 25.000đ/giờ ca đêm.
function reactBillSalaryShift(startHour) {
  const h = Number(startHour);
  return (h >= 7 && h < 22) ? "sang" : "dem";
}
function reactBillSalaryRate(shift) {
  return shift === "dem" ? 25000 : 20000;
}

// Trần hợp lý để validate khi nhập tay qua modal, tránh gõ nhầm số quá lớn.
const REACT_BILL_MAX_HOURS = 48;

function buildBookingPanelPayload(bill) {
  const players = bill.players || [];
  const selectedPlayers = new Set((bill.selectedPlayerIds || []).map(String));
  const hasHours = Number.isInteger(bill.selectedHours) && bill.selectedHours > 0;
  const hasStart = Number.isInteger(bill.selectedStartHour);
  const readyToBook = players.length > 0 && selectedPlayers.size > 0 && hasHours && hasStart;

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(`🗂️ Panel Booking — ${bill.id}`)
    .setDescription(players.length
      ? "Chủ ticket / SUP / PR Manager: chọn player, số giờ, giờ bắt đầu rồi bấm **Book** để tạo QR thanh toán.\nBỏ chọn player nào thì card của người đó sẽ được gỡ khỏi ticket."
      : "Chưa có player nào React Bill. Panel sẽ tự cập nhật khi có người React ở kênh Bill.");

  embed.addFields({
    name: "💵 Bảng giá (giờ Việt Nam)",
    value: "25.000đ/giờ/người: 07:00 → 22:00\n30.000đ/giờ/người: 22:00 → 07:00",
  });

  if (hasHours && hasStart && selectedPlayers.size > 0) {
    const rate = reactBillHourlyRate(bill.selectedStartHour);
    const total = rate * bill.selectedHours * selectedPlayers.size;
    const startLabel = `${String(bill.selectedStartHour).padStart(2, "0")}:00`;
    embed.addFields({
      name: "💰 Giá dự kiến",
      value: `${rate.toLocaleString("vi-VN")}đ/giờ/người × ${bill.selectedHours} giờ × ${selectedPlayers.size} player, bắt đầu **${startLabel}**\n= **${total.toLocaleString("vi-VN")}đ**`,
    });
  }

  if (!players.length) {
    return { embeds: [embed], components: [] };
  }

  const playerOptions = players.slice(0, 25).map(p => ({
    label: String(p.profileName || "Chưa có tên profile").slice(0, 100),
    value: String(p.userId),
    default: selectedPlayers.has(String(p.userId)),
  }));
  const playerMenu = new StringSelectMenuBuilder()
    .setCustomId(`reactbill_panel_players:${bill.id}`)
    .setPlaceholder("Chọn player để đưa vào ticket")
    .setMinValues(0)
    .setMaxValues(playerOptions.length)
    .addOptions(playerOptions);

  const hourButton = new ButtonBuilder()
    .setCustomId(`reactbill_panel_hours_btn:${bill.id}`)
    .setLabel(hasHours && hasStart
      ? `${bill.selectedHours} giờ, bắt đầu ${String(bill.selectedStartHour).padStart(2, "0")}:00 (bấm để đổi)`
      : "Nhập số giờ & giờ bắt đầu")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(bill.status !== "active");

  const bookButton = new ButtonBuilder()
    .setCustomId(`reactbill_panel_book:${bill.id}`)
    .setLabel("Book & Tạo QR")
    .setStyle(ButtonStyle.Success)
    .setDisabled(bill.status !== "active" || !readyToBook);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(playerMenu),
      new ActionRowBuilder().addComponents(hourButton),
      new ActionRowBuilder().addComponents(bookButton),
    ],
  };
}

async function ensureBookingPanel(ticketChannel, bill) {
  const payload = buildBookingPanelPayload(bill);
  if (bill.panelMessageId) {
    const existing = await ticketChannel.messages.fetch(bill.panelMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => {});
      return existing;
    }
  }
  const sent = await ticketChannel.send(payload).catch(() => null);
  if (sent) bill.panelMessageId = sent.id;
  return sent;
}

async function sendBillProfileCard(thread, profile, bill, playerRecord) {
  const media = profileFiles(profile, 0);
  const payload = profileV2Payload(profile, 0, media);
  if (!media.files.length) delete payload.files;
  const sent = await thread.send(payload);
  registerShownMessage(profile, sent, 0);
  playerRecord.profileMessageId = sent.id;
  playerRecord.profileKey = getProfileKey(profile);
  saveProfiles(profiles);
  return sent;
}

// Ping role nhắc React Bill: gửi ngay 1 lần, rồi lặp lại mỗi 1 phút, tối đa 3 lần.
// Mỗi tin ping tự xoá sau 1 phút. Tự dừng nếu bill bị dừng/xoá giữa chừng.
// Chạy trong memory nên nếu bot restart giữa chừng thì chuỗi ping hiện tại sẽ mất
// (không ảnh hưởng dữ liệu bill, chỉ mất phần nhắc nhở).
function startReactBillRolePings(guild, bill) {
  if (!bill.pingRoleId) return;
  const maxPings = 3;
  let count = 0;
  const sendPing = async () => {
    const freshCfg = getGuildReactBill(guild.id);
    const freshBill = freshCfg.bills[bill.id];
    if (!freshBill || freshBill.status !== "active" || !freshBill.pingRoleId || count >= maxPings) return;
    count += 1;
    try {
      const channel = await guild.channels.fetch(freshBill.channelId).catch(() => null);
      if (channel?.isTextBased?.()) {
        const pingMsg = await channel.send({
          content: `<@&${freshBill.pingRoleId}> 🔔 Nhắc **${freshBill.id}** đang chờ React! (${count}/${maxPings})`,
          allowedMentions: { roles: [freshBill.pingRoleId] },
        });
        setTimeout(() => { pingMsg.delete().catch(() => {}); }, 60 * 1000).unref();
      }
    } catch (error) {
      console.error("[React Bill Ping] Lỗi khi gửi ping:", error);
    }
    if (count < maxPings) setTimeout(sendPing, 60 * 1000).unref();
  };
  sendPing();
}
async function handleReactBillSlash(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "reactbill") return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  // ACK interaction ngay lập tức để tránh Discord lỗi 10062 (Unknown interaction)
  // khi các thao tác fetch/send mất hơn 3 giây.
  await interaction.deferReply();

  // Slash command có thể cung cấp GuildMember dạng API/partial. Fetch member thật
  // để chắc chắn roles.cache và permissions phản ánh role PR Manager vừa cấu hình.
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
  const sub = interaction.options.getSubcommand(false);
  const cfg = getGuildReactBill(interaction.guild.id);

  if (sub === "setup") {
    const setupChannel = interaction.options.getChannel("channel");
    if (!hasPRManagerRole({ guild: interaction.guild, member })) {
      await interaction.editReply({ content: "⛔ Chỉ PR Manager mới được setup React Bill." });
      return true;
    }
    const channel = setupChannel;
    if (!channel?.isTextBased?.()) {
      await interaction.editReply({ content: "❌ Hãy chọn một text channel." });
      return true;
    }
    cfg.channelId = channel.id;
    saveReactBillData(reactBillData);
    await interaction.editReply({ content: `✅ React Bill channel đã được set thành ${channel}.` });
    return true;
  }

  if (!cfg.channelId) {
    await interaction.editReply({ content: "❌ Chưa setup React Bill channel. Dùng `/reactbill setup #channel`." });
    return true;
  }

  const ticket = getTicketRecord(interaction.guild.id, interaction.channelId);
  if (!ticket.record) {
    await interaction.editReply({ content: "❌ `/reactbill` chỉ dùng bên trong ticket." });
    return true;
  }
  if (!ticketManager({ member }, ticket.cfg)) {
    await interaction.editReply({ content: "⛔ Chỉ SUP/Support hoặc PR Manager mới được yêu cầu Bill." });
    return true;
  }

  const requestText = interaction.options.getString("yeu_cau", true).trim();
  const pingRole = interaction.options.getRole("ping_role");

  const billCfg = getGuildReactBill(interaction.guild.id);
  billCfg.counter += 1;
  const billId = `BILL-${String(billCfg.counter).padStart(3, "0")}`;
  const bill = {
    id: billId,
    ticketId: interaction.channelId,
    requesterId: ticket.record.ownerId,
    createdBy: interaction.user.id,
    request: requestText,
    status: "active",
    players: [],
    createdAt: new Date().toISOString(),
    channelId: billCfg.channelId,
    messageId: null,
    panelMessageId: null,
    selectedPlayerIds: [],
    selectedHours: null,
    selectedStartHour: null,
    pingRoleId: pingRole ? pingRole.id : null,
  };
  billCfg.bills[billId] = bill;
  saveReactBillData(reactBillData);

  const billChannel = await interaction.guild.channels.fetch(billCfg.channelId).catch(() => null);
  if (!billChannel?.isTextBased?.()) {
    delete billCfg.bills[billId];
    saveReactBillData(reactBillData);
    await interaction.editReply({ content: "❌ React Bill channel không còn tồn tại hoặc bot không truy cập được." });
    return true;
  }

  const sent = await billChannel.send(buildReactBillPayload(bill));
  bill.messageId = sent.id;
  saveReactBillData(reactBillData);
  startReactBillRolePings(interaction.guild, bill);
  await interaction.editReply({ content: `✅ Đã tạo **${billId}** tại ${billChannel}.${pingRole ? ` Sẽ ping ${pingRole} mỗi 1 phút, 3 lần.` : ""}` });
  await sendLogMessage(interaction.guild, "reactbill", {
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🧾 Tạo React Bill")
      .addFields(
        { name: "Bill", value: bill.id, inline: true },
        { name: "Ticket", value: `<#${bill.ticketId}>`, inline: true },
        { name: "Tạo bởi", value: `${interaction.user}`, inline: true },
        { name: "Yêu cầu", value: requestText },
      ).setTimestamp()],
  });
  return true;
}

async function handleReactBillButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("reactbill_")) return false;
  if (!interaction.guild) return true;
  const match = interaction.customId.match(/^reactbill_(react|cancel|stop):(.+)$/);
  if (!match) return false;
  const [, action, billId] = match;

  // ACK ngay để tránh DiscordAPIError[10062] khi fetch/delete/send mất quá 3 giây.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = getGuildReactBill(interaction.guild.id);
  const bill = cfg.bills[billId];
  if (!bill) {
    await interaction.editReply({ content: "❌ Bill này không còn tồn tại." });
    return true;
  }

  if (action === "stop") {
    const ticketCfg = getGuildTickets(interaction.guild.id);
    if (!ticketManager({ member: interaction.member }, ticketCfg)) {
      await interaction.editReply({ content: "⛔ Chỉ SUP/Support hoặc PR Manager mới được Dừng Bill." });
      return true;
    }
    if (bill.status !== "active") {
      await interaction.editReply({ content: "⚠️ Bill này đã dừng rồi." });
      return true;
    }
    bill.status = "stopped";
    bill.stoppedBy = interaction.user.id;
    bill.stoppedAt = new Date().toISOString();
    saveReactBillData(reactBillData);
    await updateReactBillMessage(interaction.guild, bill);
    await interaction.editReply({ content: `🛑 ${bill.id} đã dừng. Không nhận React mới nữa.` });
    await sendLogMessage(interaction.guild, "reactbill", {
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🛑 Dừng React Bill")
        .addFields(
          { name: "Bill", value: bill.id, inline: true },
          { name: "Ticket", value: `<#${bill.ticketId}>`, inline: true },
          { name: "Dừng bởi", value: `${interaction.user}`, inline: true },
        ).setTimestamp()],
    });
    return true;
  }

  if (bill.status !== "active") {
    await interaction.editReply({ content: "🛑 Bill này đã dừng, không thể React/Huỷ React nữa." });
    return true;
  }

  const ticketChannel = await interaction.guild.channels.fetch(bill.ticketId).catch(() => null);
  if (!ticketChannel?.isThread?.()) {
    await interaction.editReply({ content: "❌ Ticket của Bill không còn truy cập được." });
    return true;
  }

  if (action === "react") {
    if (bill.players.some(p => p.userId === interaction.user.id)) {
      await interaction.editReply({ content: "⚠️ Bạn đã React Bill này rồi." });
      return true;
    }
    // profile_links.json lưu theo dạng: { userId: { profileName: profileKey } }.
    // Phiên bản cũ lại đọc linked.profileName nên luôn nhận undefined và React Bill
    // báo "chưa được liên kết" dù PR Manager đã dùng `sar pr link`.
    const linked = getGuildProfileLinks(interaction.guild.id)[interaction.user.id];
    const linkedEntries = Object.entries(linked || {});

    let profileName = null;
    let profile = null;

    if (linkedEntries.length === 1) {
      const [nameKey, profileKey] = linkedEntries[0];
      const linkedProfile = findProfileByKey(profileKey);
      if (linkedProfile) {
        profileName = linkedProfile.name || nameKey;
        profile = linkedProfile;
      }
    } else if (linkedEntries.length > 1) {
      // Nếu player có nhiều profile, ưu tiên profile do chính player sở hữu.
      const owned = linkedEntries.find(([, profileKey]) => {
        const candidate = findProfileByKey(profileKey);
        return candidate?.ownerId === interaction.user.id;
      });
      const selected = owned || linkedEntries[0];
      if (selected) {
        const [nameKey, profileKey] = selected;
        const linkedProfile = findProfileByKey(profileKey);
        if (linkedProfile) {
          profileName = linkedProfile.name || nameKey;
          profile = linkedProfile;
        }
      }
    }

    // Fallback cho dữ liệu profile_links cũ / profile có linkedUserId.
    if (!profile) {
      const directLinked = Object.values(profiles).find(candidate =>
        candidate?.linkedUserId === interaction.user.id
      );
      if (directLinked) {
        profile = directLinked;
        profileName = directLinked.name;
      }
    }

    if (!profile) {
      await interaction.editReply({ content: `❌ Bạn chưa được liên kết với profile. Hãy nhờ PR Manager dùng \`sar pr link "<profile>" @Bạn\`.` });
      return true;
    }

    const playerRecord = { userId: interaction.user.id, profileName, reactedAt: new Date().toISOString(), profileMessageId: null, profileKey: getProfileKey(profile) };
    bill.players.push(playerRecord);
    try {
      saveReactBillData(reactBillData);
      await ensureBookingPanel(ticketChannel, bill);
      saveReactBillData(reactBillData);
      await updateReactBillMessage(interaction.guild, bill);
      await interaction.editReply(`✅ Bạn đã React **${bill.id}**. PR5 của bạn đã xuất hiện trong panel chọn player ở ticket, chờ chủ ticket/SUP/PR Manager chọn.`);
    } catch (error) {
      bill.players = bill.players.filter(p => p !== playerRecord);
      saveReactBillData(reactBillData);
      console.error("React Bill panel update failed:", error);
      await interaction.editReply("❌ Không thể cập nhật panel chọn player trong ticket. Kiểm tra quyền gửi message trong ticket.");
    }
    return true;
  }

  if (action === "cancel") {
    const player = bill.players.find(p => p.userId === interaction.user.id);
    if (!player) {
      await interaction.editReply({ content: "⚠️ Bạn chưa React Bill này." });
      return true;
    }
    // Nếu player đang được chọn hiển thị trong ticket thì gỡ card + gỡ khỏi danh sách đã chọn.
    const msg = player.profileMessageId ? await ticketChannel.messages.fetch(player.profileMessageId).catch(() => null) : null;
    if (msg) await msg.delete().catch(() => {});
    bill.players = bill.players.filter(p => p.userId !== interaction.user.id);
    bill.selectedPlayerIds = (bill.selectedPlayerIds || []).filter(id => id !== interaction.user.id);
    saveReactBillData(reactBillData);
    await ensureBookingPanel(ticketChannel, bill);
    saveReactBillData(reactBillData);
    await updateReactBillMessage(interaction.guild, bill);
    await interaction.editReply({ content: `❌ Đã huỷ React **${bill.id}**, gỡ PR5 khỏi panel/ticket (nếu đang hiển thị).` });
    return true;
  }

  return false;
}

function parseReactBillPanelCustomId(customId) {
  const prefix = "reactbill_panel_players:";
  if (customId.startsWith(prefix)) return { kind: "players", billId: customId.slice(prefix.length) };
  return null;
}

async function handleReactBillPanelSelect(interaction) {
  if (!interaction.isStringSelectMenu()) return false;
  const parsed = parseReactBillPanelCustomId(interaction.customId);
  if (!parsed) return false;
  const { billId } = parsed;
  if (!interaction.guild) return true;

  const cfg = getGuildReactBill(interaction.guild.id);
  const bill = cfg.bills[billId];
  if (!bill) {
    await interaction.reply({ content: "❌ Bill này không còn tồn tại.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const ticket = getTicketRecord(interaction.guild.id, interaction.channelId);
  if (!ticket.record) {
    await interaction.reply({ content: "❌ Không tìm thấy ticket này.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  // Chỉ chủ ticket hoặc SUP/PR Manager mới được thao tác panel.
  const allowed = ticket.record.ownerId === interaction.user.id || ticketManager({ member: interaction.member }, ticket.cfg);
  if (!allowed) {
    await interaction.reply({ content: "⛔ Chỉ chủ ticket hoặc SUP/PR Manager mới được thao tác panel này.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (bill.status !== "active") {
    await interaction.reply({ content: "🛑 Bill này đã dừng, không thể thao tác panel nữa.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  await interaction.deferUpdate().catch(() => {});
  const ticketChannel = interaction.channel;

  const newValues = new Set((interaction.values || []).map(String));
  const previousValues = new Set((bill.selectedPlayerIds || []).map(String));

  // Bỏ chọn -> gỡ profile card đã gửi trước đó khỏi ticket.
  for (const userId of previousValues) {
    if (newValues.has(userId)) continue;
    const player = bill.players.find(p => p.userId === userId);
    if (player?.profileMessageId) {
      const msg = await ticketChannel.messages.fetch(player.profileMessageId).catch(() => null);
      if (msg) await msg.delete().catch(() => {});
      player.profileMessageId = null;
    }
  }

  // Chọn mới -> gửi profile card vào ticket.
  for (const userId of newValues) {
    if (previousValues.has(userId)) continue;
    const player = bill.players.find(p => p.userId === userId);
    if (!player) continue;
    const profile = player.profileKey ? findProfileByKey(player.profileKey) : null;
    if (!profile) continue;
    try {
      await sendBillProfileCard(ticketChannel, profile, bill, player);
    } catch (error) {
      console.error("React Bill panel gửi profile lỗi:", error);
    }
  }

  bill.selectedPlayerIds = Array.from(newValues);
  saveReactBillData(reactBillData);
  await interaction.editReply(buildBookingPanelPayload(bill)).catch(() => {});
  return true;
}

// Kiểm tra quyền thao tác panel: chủ ticket hoặc SUP/PR Manager.
// Dùng chung cho nút mở modal và cho modal submit.
async function checkReactBillPanelAccess(interaction, billId) {
  const cfg = getGuildReactBill(interaction.guild.id);
  const bill = cfg.bills[billId];
  if (!bill) return { ok: false, message: "❌ Bill này không còn tồn tại." };

  const ticket = getTicketRecord(interaction.guild.id, interaction.channelId);
  if (!ticket.record) return { ok: false, message: "❌ Không tìm thấy ticket này." };

  const allowed = ticket.record.ownerId === interaction.user.id || ticketManager({ member: interaction.member }, ticket.cfg);
  if (!allowed) return { ok: false, message: "⛔ Chỉ chủ ticket hoặc SUP/PR Manager mới được thao tác panel này." };

  if (bill.status !== "active") return { ok: false, message: "🛑 Bill này đã dừng, không thể thao tác panel nữa." };

  return { ok: true, bill };
}

// Bấm nút "⏰ Nhập số giờ & giờ bắt đầu" -> mở modal nhập tay tự do.
async function handleReactBillPanelHoursButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("reactbill_panel_hours_btn:")) return false;
  if (!interaction.guild) return true;
  const billId = interaction.customId.slice("reactbill_panel_hours_btn:".length);

  const access = await checkReactBillPanelAccess(interaction, billId);
  if (!access.ok) {
    await interaction.reply({ content: access.message, flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  const { bill } = access;

  const modal = new ModalBuilder()
    .setCustomId(`reactbill_panel_hours_modal:${billId}`)
    .setTitle("Đặt giờ book");

  const hoursInput = new TextInputBuilder()
    .setCustomId("hours")
    .setLabel(`Số giờ book (số nguyên, 1-${REACT_BILL_MAX_HOURS})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3)
    .setPlaceholder("Ví dụ: 3");
  if (Number.isInteger(bill.selectedHours)) hoursInput.setValue(String(bill.selectedHours));

  const startInput = new TextInputBuilder()
    .setCustomId("startHour")
    .setLabel("Giờ bắt đầu (0-23, giờ Việt Nam)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2)
    .setPlaceholder("Ví dụ: 21");
  if (Number.isInteger(bill.selectedStartHour)) startInput.setValue(String(bill.selectedStartHour));

  modal.addComponents(
    new ActionRowBuilder().addComponents(hoursInput),
    new ActionRowBuilder().addComponents(startInput),
  );

  await interaction.showModal(modal);
  return true;
}

// Xử lý submit modal: validate số nguyên, cập nhật bill, render lại panel.
async function handleReactBillPanelHoursModal(interaction) {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith("reactbill_panel_hours_modal:")) return false;
  if (!interaction.guild) return true;
  const billId = interaction.customId.slice("reactbill_panel_hours_modal:".length);

  const access = await checkReactBillPanelAccess(interaction, billId);
  if (!access.ok) {
    await interaction.reply({ content: access.message, flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  const { bill } = access;

  const hoursRaw = interaction.fields.getTextInputValue("hours").trim();
  const startRaw = interaction.fields.getTextInputValue("startHour").trim();
  const hours = Number(hoursRaw);
  const startHour = Number(startRaw);

  if (!Number.isInteger(hours) || hours <= 0 || hours > REACT_BILL_MAX_HOURS) {
    await interaction.reply({ content: `❌ Số giờ phải là số nguyên từ 1 đến ${REACT_BILL_MAX_HOURS}.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    await interaction.reply({ content: "❌ Giờ bắt đầu phải là số nguyên từ 0 đến 23.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  bill.selectedHours = hours;
  bill.selectedStartHour = startHour;
  saveReactBillData(reactBillData);

  await ensureBookingPanel(interaction.channel, bill);
  saveReactBillData(reactBillData);

  const rate = reactBillHourlyRate(startHour);
  const startLabel = `${String(startHour).padStart(2, "0")}:00`;
  await interaction.reply({
    content: `✅ Đã đặt **${hours} giờ**, bắt đầu **${startLabel}** (${rate.toLocaleString("vi-VN")}đ/giờ/người).`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
  return true;
}

async function handleReactBillPanelBook(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("reactbill_panel_book:")) return false;
  if (!interaction.guild) return true;
  const billId = interaction.customId.slice("reactbill_panel_book:".length);

  const cfg = getGuildReactBill(interaction.guild.id);
  const bill = cfg.bills[billId];
  if (!bill) {
    await interaction.reply({ content: "❌ Bill này không còn tồn tại.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const ticket = getTicketRecord(interaction.guild.id, interaction.channelId);
  if (!ticket.record) {
    await interaction.reply({ content: "❌ Không tìm thấy ticket này.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  // Chỉ chủ ticket hoặc SUP/PR Manager mới được Book.
  const allowed = ticket.record.ownerId === interaction.user.id || ticketManager({ member: interaction.member }, ticket.cfg);
  if (!allowed) {
    await interaction.reply({ content: "⛔ Chỉ chủ ticket hoặc SUP/PR Manager mới được Book.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (bill.status !== "active") {
    await interaction.reply({ content: "🛑 Bill này đã dừng.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (!bill.selectedPlayerIds?.length) {
    await interaction.reply({ content: "⚠️ Hãy chọn ít nhất 1 player trước khi Book.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  if (!Number.isInteger(bill.selectedHours) || bill.selectedHours <= 0) {
    await interaction.reply({ content: "⚠️ Hãy chọn số giờ trước khi Book.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  if (!Number.isInteger(bill.selectedStartHour)) {
    await interaction.reply({ content: "⚠️ Hãy chọn giờ bắt đầu trước khi Book.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  if (!SEPAY_BANK_ACCOUNT || !SEPAY_BANK_CODE || !SEPAY_WEBHOOK_SECRET) {
    await interaction.reply({ content: "❌ Bot chưa cấu hình SePay.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rate = reactBillHourlyRate(bill.selectedStartHour);
  const numPlayers = bill.selectedPlayerIds.length;
  const amount = rate * bill.selectedHours * numPlayers;

  const code = generatePaymentCode();
  const payment = {
    code,
    userId: interaction.user.id,
    payerId: ticket.record.ownerId,
    guildId: interaction.guild.id,
    channelId: interaction.channelId,
    messageId: null,
    amount,
    hours: bill.selectedHours,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PAYMENT_EXPIRE_MINUTES * 60 * 1000).toISOString(),
    transactionId: null,
    referenceCode: null,
    statsApplied: false,
    refundedAt: null,
    reactBillId: bill.id,
  };
  paymentData[code] = payment;
  savePayments(paymentData);

  const ticketChannel = interaction.channel;
  const sent = await ticketChannel.send(buildPaymentPayload(payment)).catch(() => null);
  if (sent) {
    payment.messageId = sent.id;
    savePayments(paymentData);
  }

  bill.lastBookingCode = code;
  saveReactBillData(reactBillData);

  const startLabel = `${String(bill.selectedStartHour).padStart(2, "0")}:00`;
  await interaction.editReply(
    `✅ Đã tạo bill **${code}**: ${rate.toLocaleString("vi-VN")}đ/giờ/người × **${bill.selectedHours} giờ** × **${numPlayers} player**, bắt đầu **${startLabel}** = **${amount.toLocaleString("vi-VN")}đ**. QR đã gửi vào ticket.`
  );
  return true;
}


async function sendSalaryToPlayerDM(guild, targetUser) {
  const profile = Object.values(profiles).find(p => p?.linkedUserId === targetUser.id || p?.ownerId === targetUser.id);
  const data = buildSalaryView(guild.id, targetUser, profile);
  const attachment = await makeSalaryAttachment(data);
  const dm = await targetUser.createDM();
  await dm.send({
    content: `💰 **Bảng lương tuần của bạn**\n${data.week}`,
    files: [attachment],
  });
  return data;
}

async function handleSalaryPrefix(message, args) {
  if (!message.guild) return message.channel.send("❌ Lệnh này chỉ dùng trong server.");

  const targetUser = message.mentions.users.first() || message.author;
  if (targetUser.id !== message.author.id && !hasPRManagerRole(message)) {
    return message.channel.send("⛔ Chỉ PR Manager mới được xem lương của người khác.");
  }
  try {
    await sendSalaryToPlayerDM(message.guild, targetUser);
    return message.channel.send(`📩 Đã gửi bảng lương tuần của ${targetUser} vào DM.`);
  } catch (error) {
    console.error("Gửi bảng lương DM thất bại:", error);
    return message.channel.send(`❌ Không thể gửi DM cho ${targetUser}. Có thể player đã tắt tin nhắn riêng.`);
  }
}

// ===== sar stinhluong — GỬI BẢNG LƯƠNG THẲNG VÀO KÊNH (prefix) =====
// Bản prefix của /stinhluong: gửi bảng lương thẳng vào kênh hiện tại thay vì DM.
async function handleSalaryDirectPrefix(message, args) {
  if (!message.guild) return message.channel.send("❌ Lệnh này chỉ dùng trong server.");

  const targetUser = message.mentions.users.first() || message.author;
  if (targetUser.id !== message.author.id && !hasPRManagerRole(message)) {
    return message.channel.send("⛔ Chỉ PR Manager mới được xem lương của người khác.");
  }

  try {
    const profile = Object.values(profiles).find(p => p?.linkedUserId === targetUser.id || p?.ownerId === targetUser.id);
    const data = buildSalaryView(message.guild.id, targetUser, profile);
    const attachment = await makeSalaryAttachment(data);
    return message.channel.send({ content: `💰 **Bảng lương của ${targetUser}:** ${data.week}`, files: [attachment] });
  } catch (error) {
    console.error("Gửi bảng lương vào kênh thất bại:", error);
    return message.channel.send("❌ Không thể gửi bảng lương vào kênh.");
  }
}

// Sau khi bill React Bill thanh toán thành công -> cộng thẳng giờ + lương cho từng player đã chọn,
// KHÔNG qua duyệt (khác với /luong add thông thường phải PR Admin xác nhận).
function addReactBillPlayerSalaries(guildId, bill, requesterId) {
  const playerIds = bill.selectedPlayerIds || [];
  if (!playerIds.length) return [];

  const shift = reactBillSalaryShift(bill.selectedStartHour);
  const rate = reactBillSalaryRate(shift);
  const hours = Number(bill.selectedHours) || 0;
  const amount = rate * hours;
  const startLabel = Number.isInteger(bill.selectedStartHour) ? `${String(bill.selectedStartHour).padStart(2, "0")}:00` : "?";
  const note = `React Bill ${bill.id} — book ${hours}h lúc ${startLabel} (đã thanh toán)`;

  const cfg = getGuildSalary(guildId);
  const addedEntries = [];
  for (const userId of playerIds) {
    const entry = {
      id: crypto.randomUUID(),
      userId: String(userId),
      type: "work",
      shift,
      hours,
      amount,
      note,
      at: new Date().toISOString(),
      by: String(requesterId),
      reactBillId: bill.id,
    };
    cfg.entries.push(entry);
    addedEntries.push(entry);
  }
  saveSalaryData(salaryData);
  return addedEntries;
}

async function sendSalaryApprovalRequest(interaction, entry, targetUser, amount, hours, shift, note) {
  const channelId = getConfiguredSalaryApprovalChannel(interaction.guild.id);
  if (!channelId) return { ok: false, message: "❌ Chưa cấu hình kênh xác nhận lương. Người có **Manage Server** dùng `sar luongchannel #kenh` trước." };
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, message: "❌ Kênh xác nhận lương đã bị xóa/không hợp lệ. Hãy cấu hình lại bằng `sar luongchannel #kenh`." };

  const approvalId = crypto.randomUUID();
  salaryApprovals[interaction.guild.id].pending = salaryApprovals[interaction.guild.id].pending || {};
  salaryApprovals[interaction.guild.id].pending[approvalId] = { ...entry, approvalId };
  saveSalaryApprovals(salaryApprovals);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("💰 YÊU CẦU XÁC NHẬN CỘNG LƯƠNG")
    .setDescription(`PR Manager <@${interaction.user.id}> yêu cầu cộng lương cho ${targetUser}.`)
    .addFields(
      { name: "👤 Player", value: `${targetUser} (${targetUser.tag})`, inline: true },
      { name: "💵 Số tiền", value: salaryMoney(amount), inline: true },
      { name: "⏱️ Số giờ", value: `${hours || 0}h`, inline: true },
      { name: "🌙 Ca", value: shift === "dem" ? "Đêm" : "Sáng", inline: true },
      { name: "📝 Ghi chú", value: note || "Không có", inline: false },
      { name: "🆔 Yêu cầu", value: `\`${approvalId}\``, inline: false },
    )
    .setFooter({ text: "Chỉ PR Admin mới được xác nhận hoặc từ chối." })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`salary_approve:${approvalId}`).setLabel("Xác nhận").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`salary_reject:${approvalId}`).setLabel("Từ chối").setStyle(ButtonStyle.Danger),
  );

  try {
    await channel.send({ embeds: [embed], components: [row] });
    return { ok: true, approvalId };
  } catch (error) {
    delete salaryApprovals[interaction.guild.id].pending[approvalId];
    saveSalaryApprovals(salaryApprovals);
    console.error("Gửi yêu cầu xác nhận lương thất bại:", error);
    return { ok: false, message: "❌ Bot không thể gửi vào kênh xác nhận lương. Kiểm tra quyền View Channel/Send Messages/Embed Links." };
  }
}

async function handleSalaryApprovalButton(interaction) {
  if (!interaction.isButton()) return false;
  const match = interaction.customId.match(/^salary_(approve|reject):(.+)$/);
  if (!match) return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ Chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
  if (!hasPRAdminRole({ guild: interaction.guild, member })) {
    await interaction.reply({ content: "⛔ Chỉ **PR Admin** mới được xác nhận hoặc từ chối cộng lương.", flags: MessageFlags.Ephemeral });
    return true;
  }

  // ACK ngay để việc đọc/ghi file hoặc chỉnh message không làm interaction hết hạn.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  reloadSalaryApprovalsFromDisk();
  const guildData = getSalaryApprovalConfig(interaction.guild.id);
  guildData.pending = guildData.pending || {};
  let entry = guildData.pending[match[2]];

  // Request cũ có thể còn trên Discord nhưng pending record đã mất. Khôi phục từ Embed.
  if (!entry) {
    const recovered = recoverSalaryApprovalFromMessage(interaction, match[2]);
    if (recovered) {
      guildData.pending[match[2]] = recovered;
      entry = recovered;
      saveSalaryApprovals(salaryApprovals);
      console.log(`[Salary Approval] Đã khôi phục yêu cầu ${match[2]} từ message.`);
    }
  }

  if (!entry) {
    await interaction.editReply({ content: "⚠️ Không tìm thấy yêu cầu này. Có thể message thuộc phiên bản cũ không còn dữ liệu." });
    return true;
  }

  // Reject luôn là trạng thái cuối. Approved thì kiểm tra xem tiền đã thực sự được ghi chưa.
  if (match[1] === "reject") {
    if (entry.status === "approved") {
      await interaction.editReply({ content: `ℹ️ Yêu cầu \`${match[2]}\` đã được PR Admin xác nhận trước đó.` });
      return true;
    }
    if (entry.status === "rejected") {
      await interaction.editReply({ content: `ℹ️ Yêu cầu \`${match[2]}\` đã bị từ chối trước đó.` });
      return true;
    }
    entry.status = "rejected";
    entry.reviewedBy = String(interaction.user.id);
    entry.reviewedAt = new Date().toISOString();
    saveSalaryApprovals(salaryApprovals);
    await interaction.message.edit({
      content: `❌ **Đã từ chối** yêu cầu cộng lương \`${match[2]}\` bởi ${interaction.user}.`,
      embeds: interaction.message.embeds?.length ? interaction.message.embeds : [],
      components: [],
    }).catch(() => {});
    await interaction.editReply({ content: "❌ Đã từ chối yêu cầu cộng lương." });
    return true;
  }

  const cfg = getGuildSalary(interaction.guild.id);
  const approvalKey = String(entry.approvalId || match[2]);
  // Idempotency: không cộng lương lần 2 nếu request đã được xử lý trước đó.
  let existing = cfg.entries.find(e => String(e.approvalId || "") === approvalKey);
  if (!existing && entry.id) existing = cfg.entries.find(e => String(e.id) === String(entry.id));

  if (!existing) {
    const finalEntry = { ...entry };
    delete finalEntry.status;
    delete finalEntry.reviewedBy;
    delete finalEntry.reviewedAt;
    delete finalEntry.recoveredFromMessage;
    finalEntry.approvalId = approvalKey;
    cfg.entries.push(finalEntry);
    saveSalaryData(salaryData);
    existing = finalEntry;
    console.log(`[Salary Approval] Đã cộng lương ${salaryMoney(finalEntry.amount)} cho ${finalEntry.userId}, approval=${approvalKey}`);
  } else {
    console.log(`[Salary Approval] Request ${approvalKey} đã có trong salaryData, không cộng lần 2.`);
  }

  entry.status = "approved";
  entry.reviewedBy = String(interaction.user.id);
  entry.reviewedAt = entry.reviewedAt || new Date().toISOString();
  saveSalaryApprovals(salaryApprovals);

  await sendLogMessage(interaction.guild, "luong", {
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("💰 Cộng lương — Đã duyệt")
      .addFields(
        { name: "Player", value: `<@${existing.userId}>`, inline: true },
        { name: "Số tiền", value: salaryMoney(existing.amount), inline: true },
        { name: "Duyệt bởi", value: `${interaction.user}`, inline: true },
      ).setTimestamp()],
  });

  await interaction.message.edit({
    content: `✅ **Đã xác nhận cộng lương** ${salaryMoney(existing.amount)} cho <@${existing.userId}> bởi ${interaction.user}.`,
    embeds: interaction.message.embeds?.length ? interaction.message.embeds : [],
    components: [],
  }).catch(error => console.warn("[Salary Approval] Không thể khóa nút trên message:", error?.message || error));
  await interaction.editReply({ content: `✅ Đã xác nhận cộng lương ${salaryMoney(existing.amount)} cho <@${existing.userId}>.` });
  return true;
}

async function handleSalarySlash(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "luong") return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const action = interaction.options.getString("action") || "view";

  if (action === "view") {
    const targetUser = interaction.options.getUser("player") || interaction.user;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
    if (targetUser.id !== interaction.user.id && !hasPRManagerRole({ guild: interaction.guild, member })) {
      await interaction.reply({ content: "⛔ Chỉ PR Manager mới được xem lương của người khác.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferReply();
    const profile = Object.values(profiles).find(p => p?.linkedUserId === targetUser.id || p?.ownerId === targetUser.id);
    const data = buildSalaryView(interaction.guild.id, targetUser, profile);
    const attachment = await makeSalaryAttachment(data);
    await interaction.editReply({ content: `💰 **Bảng lương của ${targetUser}:** ${data.week}`, files: [attachment] });
    return true;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
  if (!hasPRManagerRole({ guild: interaction.guild, member })) {
    await interaction.reply({ content: "⛔ Chỉ PR Manager mới được quản lý lương.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const cfg = getGuildSalary(interaction.guild.id);

  if (action === "reset") {
    const count = cfg.entries.length;
    cfg.entries = [];
    saveSalaryData(salaryData);
    await sendLogMessage(interaction.guild, "luong", {
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🗑️ Reset toàn bộ bảng lương")
        .addFields(
          { name: "Số bản ghi đã xoá", value: String(count), inline: true },
          { name: "Thực hiện bởi", value: `${interaction.user}`, inline: true },
        ).setTimestamp()],
    });
    await interaction.reply(`🗑️ Đã **reset toàn bộ bảng lương** của server. Đã xoá **${count}** bản ghi lương của tất cả player.`);
    return true;
  }

  if (action === "reset_player") {
    const targetUser = interaction.options.getUser("player", true);
    const before = cfg.entries.length;
    cfg.entries = cfg.entries.filter(e => String(e.userId) !== String(targetUser.id));
    const removed = before - cfg.entries.length;
    saveSalaryData(salaryData);
    await sendLogMessage(interaction.guild, "luong", {
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🗑️ Reset lương 1 thành viên")
        .addFields(
          { name: "Player", value: `${targetUser}`, inline: true },
          { name: "Số bản ghi đã xoá", value: String(removed), inline: true },
          { name: "Thực hiện bởi", value: `${interaction.user}`, inline: true },
        ).setTimestamp()],
    });
    await interaction.reply(`🗑️ Đã **reset lương** của ${targetUser}. Đã xoá **${removed}** bản ghi.`);
    return true;
  }

  const targetUser = interaction.options.getUser("player", true);
  const amount = interaction.options.getInteger("tien", true);
  const note = interaction.options.getString("ghi_chu") || "";

  if (!Number.isFinite(amount) || amount <= 0) {
    await interaction.reply({ content: "❌ Số tiền không hợp lệ.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === "add") {
    const hours = interaction.options.getNumber("gio") ?? 0;
    const shift = interaction.options.getString("ca") || "sang";
    const entry = { id: crypto.randomUUID(), userId: String(targetUser.id), type: "work", shift, hours: Number.isFinite(hours) ? hours : 0, amount, note, at: new Date().toISOString(), by: String(interaction.user.id), status: "pending" };
    const approval = await sendSalaryApprovalRequest(interaction, entry, targetUser, amount, entry.hours, entry.shift, note);
    if (!approval.ok) {
      await interaction.reply({ content: approval.message, flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply(`🕐 Đã gửi yêu cầu cộng **${salaryMoney(amount)}** cho ${targetUser} đến kênh xác nhận. Chờ **PR Admin** duyệt.`);
    return true;
  }
  if (action === "ung") {
    cfg.entries.push({ id: crypto.randomUUID(), userId: targetUser.id, type: "advance", shift: "sang", hours: 0, amount, note, at: new Date().toISOString(), by: interaction.user.id });
    saveSalaryData(salaryData);
    await sendLogMessage(interaction.guild, "luong", {
      embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("💸 Ứng lương")
        .addFields(
          { name: "Player", value: `${targetUser}`, inline: true },
          { name: "Số tiền", value: salaryMoney(amount), inline: true },
          { name: "Thực hiện bởi", value: `${interaction.user}`, inline: true },
          { name: "Ghi chú", value: note || "*(không có)*" },
        ).setTimestamp()],
    });
    await interaction.reply(`💸 Đã ghi **ứng ${salaryMoney(amount)}** cho ${targetUser}.`);
    return true;
  }
  if (action === "tru") {
    cfg.entries.push({ id: crypto.randomUUID(), userId: targetUser.id, type: "deduct", shift: "sang", hours: 0, amount, note, at: new Date().toISOString(), by: interaction.user.id });
    saveSalaryData(salaryData);
    await sendLogMessage(interaction.guild, "luong", {
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("➖ Trừ lương")
        .addFields(
          { name: "Player", value: `${targetUser}`, inline: true },
          { name: "Số tiền", value: salaryMoney(amount), inline: true },
          { name: "Thực hiện bởi", value: `${interaction.user}`, inline: true },
          { name: "Ghi chú", value: note || "*(không có)*" },
        ).setTimestamp()],
    });
    await interaction.reply(`➖ Đã trừ **${salaryMoney(amount)}** của ${targetUser}.`);
    return true;
  }
  if (action === "donate") {
    cfg.entries.push({ id: crypto.randomUUID(), userId: targetUser.id, type: "donate", shift: "sang", hours: 0, amount, note, at: new Date().toISOString(), by: interaction.user.id });
    saveSalaryData(salaryData);
    await sendLogMessage(interaction.guild, "luong", {
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("💙 Donate lương")
        .addFields(
          { name: "Player", value: `${targetUser}`, inline: true },
          { name: "Số tiền", value: salaryMoney(amount), inline: true },
          { name: "Thực hiện bởi", value: `${interaction.user}`, inline: true },
          { name: "Ghi chú", value: note || "*(không có)*" },
        ).setTimestamp()],
    });
    await interaction.reply(`💙 Đã cộng donate **${salaryMoney(amount)}** cho ${targetUser}.`);
    return true;
  }

  await interaction.reply({ content: "❌ Action không hợp lệ.", flags: MessageFlags.Ephemeral });
  return true;
}

// ===== /stinhluong — GỬI BẢNG LƯƠNG THẲNG VÀO KÊNH =====
// Khác với /luong action:Xem (trả lời interaction), lệnh này chủ động
// channel.send() bảng lương như 1 tin nhắn thường trong kênh.
async function handleSalaryDirectSlash(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "stinhluong") return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const targetUser = interaction.options.getUser("player") || interaction.user;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
  if (targetUser.id !== interaction.user.id && !hasPRManagerRole({ guild: interaction.guild, member })) {
    await interaction.reply({ content: "⛔ Chỉ PR Manager mới được xem lương của người khác.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const profile = Object.values(profiles).find(p => p?.linkedUserId === targetUser.id || p?.ownerId === targetUser.id);
    const data = buildSalaryView(interaction.guild.id, targetUser, profile);
    const attachment = await makeSalaryAttachment(data);
    await interaction.channel.send({ content: `💰 **Bảng lương của ${targetUser}:** ${data.week}`, files: [attachment] });
    await interaction.editReply({ content: "✅ Đã gửi bảng lương vào kênh." });
  } catch (error) {
    console.error("Gửi bảng lương vào kênh thất bại:", error);
    await interaction.editReply({ content: "❌ Không thể gửi bảng lương vào kênh." });
  }
  return true;
}

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
    await interaction.reply({ content: "❌ Phiên tạo AutoRes đã hết hạn. Hãy dùng lại `/ar create`.", flags: MessageFlags.Ephemeral });
    return true;
  }
  pendingAutoResCreates.delete(token);

  if (pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId) {
    await interaction.reply({ content: "⛔ Bạn không thể dùng form AutoRes này.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const guildData = getGuildAutoRes(interaction.guild.id);
  const key = normalizeTrigger(pending.trigger);
  if (guildData[key]) {
    await interaction.reply({ content: "⚠️ AutoRes này đã tồn tại.", flags: MessageFlags.Ephemeral });
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
      await interaction.reply({ content: "❌ Màu không hợp lệ. Dùng `#ff69b4` hoặc để trống.", flags: MessageFlags.Ephemeral });
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
    content: `✅ Đã tạo AutoRes **${pending.trigger}** dạng **${pending.type}**${content ? " và đã đặt content." : "."}`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleAutoResSlash(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "ar") return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const action = interaction.options.getSubcommand();
  const managerActions = ["create", "edit", "delete", "on", "off"];
  if (managerActions.includes(action)) {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
    if (!hasPRManagerRole({ guild: interaction.guild, member })) {
      await interaction.reply({ content: "⛔ Bạn không có quyền quản lý AutoRes. Cần PR Manager.", flags: MessageFlags.Ephemeral });
      return true;
    }
  }

  const guildData = getGuildAutoRes(interaction.guild.id);

  if (action === "list") {
    const entries = Object.values(guildData);
    if (!entries.length) {
      await interaction.reply("🤖 Server chưa có AutoRes nào.");
      return true;
    }
    const lines = entries.map((r, i) => `${i + 1}. ${r.enabled ? "🟢" : "🔴"} **${r.trigger}** — ${r.type} — ${r.mode}`);
    await interaction.reply(`**🤖 AutoRes (${entries.length})**\n${lines.join("\n")}`);
    return true;
  }

  const trigger = interaction.options.getString("trigger", true).trim();
  const key = normalizeTrigger(trigger);
  const record = key ? findAutoRes(interaction.guild.id, trigger) : null;

  if (action === "create") {
    const type = interaction.options.getString("type", true);
    if (!key) {
      await interaction.reply({ content: "❌ Trigger không được để trống.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (guildData[key]) {
      await interaction.reply({ content: "⚠️ AutoRes này đã tồn tại.", flags: MessageFlags.Ephemeral });
      return true;
    }

    // Discord không hỗ trợ ẩn/hiện option slash theo giá trị của option trước đó.
    // Vì vậy sau khi chọn type, bot mở Modal tương ứng: Text chỉ có Content;
    // Embed có đủ Content/Title/Description/Color/Footer.
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
    await interaction.reply({ content: "❌ Không tìm thấy AutoRes. Dùng `/ar list` để xem danh sách.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === "delete") {
    removeLocalImage(record.embed.thumbnail);
    removeLocalImage(record.embed.image);
    delete guildData[normalizeTrigger(record.trigger)];
    saveAutoRes(autoRes);
    await interaction.reply(`🗑️ Đã xóa AutoRes **${record.trigger}**.`);
    return true;
  }

  if (action === "on" || action === "off") {
    record.enabled = action === "on";
    saveAutoRes(autoRes);
    await interaction.reply(`${record.enabled ? "🟢 Đã bật" : "🔴 Đã tắt"} AutoRes **${record.trigger}**.`);
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
        await interaction.reply({ content: "❌ Màu không hợp lệ. Ví dụ `#ff69b4` hoặc `reset`.", flags: MessageFlags.Ephemeral });
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
      await interaction.reply({ content: "❌ Không thể lưu ảnh AutoRes.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!changed.length) {
      await interaction.reply({ content: "ℹ️ Không có thông tin nào được thay đổi.", flags: MessageFlags.Ephemeral });
      return true;
    }

    saveAutoRes(autoRes);
    await interaction.reply(`✅ Đã cập nhật **${record.trigger}**: ${changed.join(", ")}.`);
    return true;
  }

  return true;
}

async function handlePaySalaryButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("paysalary:")) return false;
  const code = interaction.customId.slice("paysalary:".length);
  const payment = paymentData[code];
  if (!payment) { await interaction.reply({ content: `❌ Không tìm thấy bill **${code}**.`, flags: MessageFlags.Ephemeral }); return true; }
  if (payment.guildId !== interaction.guild?.id) { await interaction.reply({ content: "❌ Bill này không thuộc server hiện tại.", flags: MessageFlags.Ephemeral }); return true; }
  if (payment.status === "paid") { await interaction.reply({ content: `⚠️ Bill **${code}** đã được thanh toán rồi.`, flags: MessageFlags.Ephemeral }); return true; }
  if (payment.status !== "pending") { await interaction.reply({ content: `❌ Bill **${code}** không còn ở trạng thái chờ thanh toán.`, flags: MessageFlags.Ephemeral }); return true; }

  const targetId = payment.payerId || payment.userId;
  // Chỉ chính người phải trả bill (hoặc PR Manager) mới được bấm trừ lương của họ.
  if (interaction.user.id !== targetId && !hasPRManagerRole({ guild: interaction.guild, member: interaction.member })) {
    await interaction.reply({ content: "⛔ Chỉ người phải thanh toán bill này (hoặc PR Manager) mới bấm được nút này.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Lương ròng trong tuần hiện tại của người trả. Không cho phép trừ nếu
  // sau khi trừ, lương còn lại thấp hơn mức tối thiểu (mặc định 30.000đ).
  const currentNet = calcNetSalaryWeek(payment.guildId, targetId);
  const remaining = currentNet - payment.amount;
  if (remaining < MIN_SALARY_AFTER_PAY) {
    await interaction.editReply(
      `❌ Không thể thanh toán bằng lương.\n` +
      `Lương hiện tại của <@${targetId}>: **${salaryMoney(currentNet)}**\n` +
      `Sau khi trừ **${formatVnd(payment.amount)}** sẽ còn: **${salaryMoney(remaining)}**\n` +
      `Lương không được thấp hơn mức tối thiểu **${salaryMoney(MIN_SALARY_AFTER_PAY)}**.`
    );
    return true;
  }

  const cfg = getGuildSalary(payment.guildId);
  const salaryEntryId = crypto.randomUUID();
  cfg.entries.push({
    id: salaryEntryId,
    userId: String(targetId),
    type: "deduct",
    shift: "sang",
    hours: 0,
    amount: payment.amount,
    note: `Thanh toán bill ${payment.code} bằng lương`,
    at: new Date().toISOString(),
    by: String(interaction.user.id),
  });
  saveSalaryData(salaryData);

  payment.status = "paid";
  payment.paidVia = "salary";
  payment.paidAt = new Date().toISOString();
  payment.salaryEntryId = salaryEntryId;
  payment.salaryRemaining = remaining;
  const reactBillSalaryPlayerIds = await applyPaymentSuccess(payment);
  savePayments(paymentData);
  await updatePaymentMessage(payment);

  let msg = `✅ Đã thanh toán bill **${payment.code}** bằng lương — trừ **${formatVnd(payment.amount)}**, lương còn lại **${salaryMoney(remaining)}**.`;
  if (reactBillSalaryPlayerIds.length) {
    msg += `\n💰 Đã tự động cộng lương cho: ${reactBillSalaryPlayerIds.map(id => `<@${id}>`).join(", ")}.`;
  }
  await interaction.editReply(msg);
  return true;
}
async function handlePaySlash(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "pay") return false;
  if (!interaction.guild) { await interaction.reply({ content: "❌ Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral }); return true; }
  const sub = interaction.options.getSubcommand(false);
  if (sub === "create") {
    if (!SEPAY_BANK_ACCOUNT || !SEPAY_BANK_CODE || !SEPAY_WEBHOOK_SECRET) { await interaction.reply({ content: "❌ Bot chưa cấu hình SePay.", flags: MessageFlags.Ephemeral }); return true; }
    const amount = interaction.options.getInteger("so_tien", true);
    const hours = interaction.options.getNumber("so_gio", true);
    const payer = interaction.options.getUser("nguoi_thanh_toan", true);
    if (amount < 1000 || amount > 2000000000) { await interaction.reply({ content: "❌ Số tiền phải từ **1.000đ** đến **2.000.000.000đ**.", flags: MessageFlags.Ephemeral }); return true; }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 10000) { await interaction.reply({ content: "❌ Số giờ phải lớn hơn 0 và không quá 10.000 giờ.", flags: MessageFlags.Ephemeral }); return true; }
    await interaction.deferReply();
    const code = generatePaymentCode();
    const payment = { code, userId: interaction.user.id, payerId: payer.id, guildId: interaction.guild.id, channelId: interaction.channelId, messageId: null, amount, hours, status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + PAYMENT_EXPIRE_MINUTES * 60 * 1000).toISOString(), transactionId: null, referenceCode: null, statsApplied: false, refundedAt: null };
    paymentData[code] = payment; savePayments(paymentData);
    const sent = await interaction.editReply(buildPaymentPayload(payment));
    payment.messageId = sent.id; savePayments(paymentData); return true;
  }
  if (sub === "cash") {
    if (!hasPRManagerRole({ guild: interaction.guild, member: interaction.member })) { await interaction.reply({ content: "⛔ Chỉ PR Manager hoặc Manage Server mới được tạo bill nạp Cash.", flags: MessageFlags.Ephemeral }); return true; }
    if (!SEPAY_BANK_ACCOUNT || !SEPAY_BANK_CODE || !SEPAY_WEBHOOK_SECRET) { await interaction.reply({ content: "❌ Bot chưa cấu hình SePay.", flags: MessageFlags.Ephemeral }); return true; }
    const amount = interaction.options.getInteger("so_tien", true);
    const payer = interaction.options.getUser("nguoi_nhan", true);
    if (amount < 1000 || amount > 2000000000) { await interaction.reply({ content: "❌ Số tiền phải từ **1.000đ** đến **2.000.000.000đ**.", flags: MessageFlags.Ephemeral }); return true; }
    await interaction.deferReply();
    const code = generatePaymentCode();
    const payment = { code, type: "cash", userId: interaction.user.id, payerId: payer.id, guildId: interaction.guild.id, channelId: interaction.channelId, messageId: null, amount, hours: 0, status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + PAYMENT_EXPIRE_MINUTES * 60 * 1000).toISOString(), transactionId: null, referenceCode: null, statsApplied: false, cashApplied: 0, refundedAt: null };
    paymentData[code] = payment; savePayments(paymentData);
    const sent = await interaction.editReply(buildPaymentPayload(payment));
    payment.messageId = sent.id; savePayments(paymentData); return true;
  }
  if (sub === "refund") {
    const code = String(interaction.options.getString("bill", true)).trim().toUpperCase();
    const payment = paymentData[code];
    if (!payment) { await interaction.reply({ content: `❌ Không tìm thấy bill **${code}**.`, flags: MessageFlags.Ephemeral }); return true; }
    if (payment.guildId !== interaction.guild.id) { await interaction.reply({ content: "❌ Bill này không thuộc server hiện tại.", flags: MessageFlags.Ephemeral }); return true; }
    if (payment.status !== "paid") { await interaction.reply({ content: `❌ Bill **${code}** chưa thanh toán thành công nên không thể refund.`, flags: MessageFlags.Ephemeral }); return true; }
    if (payment.refundedAt) { await interaction.reply({ content: `❌ Bill **${code}** đã refund rồi.`, flags: MessageFlags.Ephemeral }); return true; }
    const targetId = payment.payerId || payment.userId;
    // Nếu trước đó trả bằng lương, hoàn lại khoản lương đã trừ trước.
    let salaryRefundNote = "";
    if (payment.paidVia === "salary" && payment.salaryEntryId) {
      const cfg = getGuildSalary(payment.guildId);
      const idx = cfg.entries.findIndex(e => e.id === payment.salaryEntryId);
      if (idx !== -1) cfg.entries.splice(idx, 1);
      saveSalaryData(salaryData);
      salaryRefundNote = ` (đã hoàn **${formatVnd(payment.amount)}** lương)`;
    }
    if (payment.type === "cash") {
      const currentCash = getCashBalance(payment.guildId, targetId);
      const refundCash = Math.floor(payment.cashApplied || payment.amount || 0);
      setCashBalance(payment.guildId, targetId, Math.max(0, currentCash - refundCash));
      saveCashData(cashData);
      payment.cashApplied = 0;
      payment.status = "refunded"; payment.refundedAt = new Date().toISOString(); payment.refundedBy = interaction.user.id; payment.statsApplied = false;
      savePayments(paymentData); await updatePaymentMessage(payment);
      await interaction.reply(`↩️ Đã refund bill Cash **${code}** và trừ **${refundCash.toLocaleString("vi-VN")} cash** khỏi <@${targetId}>${salaryRefundNote}.`);
      return true;
    }
    const stat = getBookingStats(payment.guildId, targetId);
    stat.hours = Math.max(0, stat.hours - Number(payment.hours || 0));
    stat.amount = Math.max(0, stat.amount - Number(payment.amount || 0));
    saveBookingStats(bookingStats);
    payment.status = "refunded"; payment.refundedAt = new Date().toISOString(); payment.refundedBy = interaction.user.id; payment.statsApplied = false;
    savePayments(paymentData); await updatePaymentMessage(payment);
    await interaction.reply(`↩️ Đã refund bill **${code}** cho <@${targetId}> và trừ **${payment.hours || 0} giờ** + **${formatVnd(payment.amount)}** khỏi sprofile${salaryRefundNote}.`);
    return true;
  }
  return false;
}

client.once("clientReady", async () => {
  console.log(`Đăng nhập: ${client.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
  // Đồng bộ trigger theo tên cho toàn bộ profile cũ sau mỗi lần bot khởi động.
  // Profile mới vẫn tự tạo trigger ngay trong lệnh create.
  try {
    await syncAllProfileNameTriggers();
  } catch (error) {
    console.error("[Profile Trigger] Đồng bộ profile cũ thất bại:", error);
  }

  // Tiếp tục đếm giờ (hoặc gỡ ngay nếu đã quá hạn trong lúc bot tắt) cho các
  // role tạm thời tạo bằng `srole` từ trước khi bot restart.
  resumeTempRoleTimers();

  const reactBillCommand = new SlashCommandBuilder()
    .setName("reactbill")
    .setDescription("Setup hoặc tạo React Bill")
    .addSubcommand(sub => sub
      .setName("setup")
      .setDescription("Chọn kênh React Bill")
      .addChannelOption(opt => opt.setName("channel").setDescription("Kênh React Bill").setRequired(true)))
    .addSubcommand(sub => sub
      .setName("create")
      .setDescription("Tạo một React Bill trong ticket")
      .addStringOption(opt =>
        opt
          .setName("yeu_cau")
          .setDescription("Nội dung yêu cầu hiển thị trên React Bill")
          .setRequired(true)
          .setMaxLength(1000)
      )
      .addRoleOption(opt =>
        opt
          .setName("ping_role")
          .setDescription("Role sẽ được ping nhắc React (mỗi 1 phút, 3 lần, tin ping cũ tự xoá sau 1 phút)")
          .setRequired(false)
      ));

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set([
        reactBillCommand.toJSON(),
        new SlashCommandBuilder().setName("pay").setDescription("Tạo và quản lý thanh toán chuyển khoản")
          .addSubcommand(sub => sub.setName("create").setDescription("Tạo QR thanh toán")
            .addIntegerOption(opt => opt.setName("so_tien").setDescription("Số tiền cần thanh toán (VNĐ)").setRequired(true).setMinValue(1000).setMaxValue(2000000000))
            .addNumberOption(opt => opt.setName("so_gio").setDescription("Số giờ book").setRequired(true).setMinValue(0.1).setMaxValue(10000))
            .addUserOption(opt => opt.setName("nguoi_thanh_toan").setDescription("Người được cộng giờ + tiền sau khi thanh toán").setRequired(true))
          )
          .addSubcommand(sub => sub.setName("cash").setDescription("Tạo bill nạp Cash 1:1")
            .addIntegerOption(opt => opt.setName("so_tien").setDescription("Số tiền nạp Cash (VNĐ)").setRequired(true).setMinValue(1000).setMaxValue(2000000000))
            .addUserOption(opt => opt.setName("nguoi_nhan").setDescription("Người sẽ nhận Cash sau khi thanh toán").setRequired(true)))
          .addSubcommand(sub => sub.setName("refund").setDescription("Refund bill đã thanh toán")
            .addStringOption(opt => opt.setName("bill").setDescription("Mã bill").setRequired(true)))
          .toJSON()
,
        new SlashCommandBuilder().setName("autorole").setDescription("Quản lý AutoRole cho thành viên mới")
          .addSubcommand(sub => sub.setName("set").setDescription("Đặt role tự động cho thành viên mới")
            .addRoleOption(opt => opt.setName("role").setDescription("Role sẽ tự động cấp").setRequired(true)))
          .addSubcommand(sub => sub.setName("off").setDescription("Tắt AutoRole"))
          .addSubcommand(sub => sub.setName("view").setDescription("Xem AutoRole hiện tại"))
          .toJSON(),
        new SlashCommandBuilder().setName("luong").setDescription("Xem và quản lý bảng lương")
          .addStringOption(opt => opt.setName("action").setDescription("Thao tác (bỏ trống = xem lương)").addChoices(
            { name: "Xem", value: "view" }, { name: "Cộng ca", value: "add" }, { name: "Ứng", value: "ung" }, { name: "Trừ", value: "tru" }, { name: "Donate", value: "donate" }, { name: "Reset 1 thành viên", value: "reset_player" }, { name: "Reset toàn bộ", value: "reset" }
          ))
          .addUserOption(opt => opt.setName("player").setDescription("Người chơi"))
          .addIntegerOption(opt => opt.setName("tien").setDescription("Số tiền (dùng khi quản lý)").setMinValue(1))
          .addNumberOption(opt => opt.setName("gio").setDescription("Số giờ (dùng khi cộng ca)").setMinValue(0))
          .addStringOption(opt => opt.setName("ca").setDescription("Ca làm").addChoices({ name: "Sáng", value: "sang" }, { name: "Đêm", value: "dem" }))
          .addStringOption(opt => opt.setName("ghi_chu").setDescription("Ghi chú"))
          .toJSON(),
        new SlashCommandBuilder().setName("stinhluong").setDescription("Gửi bảng lương thẳng vào kênh")
          .addUserOption(opt => opt.setName("player").setDescription("Người chơi (bỏ trống = xem lương của bạn)"))
          .toJSON(),
      ]);
    } catch (error) {
      console.error(`Không đăng ký /reactbill ở ${guild.name}:`, error.message || error);
    }
  }
});

async function handleAntiRaidJoin(member) {
  const guild = member.guild;
  const cfg = getGuildAntiRaid(guild.id);
  if (!cfg.enabled) return;

  const now = Date.now();
  let tracker = raidJoinTracker.get(guild.id);
  if (!tracker) { tracker = []; raidJoinTracker.set(guild.id, tracker); }
  tracker.push(now);
  while (tracker.length && now - tracker[0] > cfg.joinWindowSec * 1000) tracker.shift();

  const wasInLockdown = cfg.lockdownUntil && now < cfg.lockdownUntil;
  if (!wasInLockdown && tracker.length >= cfg.joinThreshold) {
    cfg.lockdownUntil = now + cfg.lockdownMinutes * 60 * 1000;
    saveAntiRaidData(antiRaidData);
    await sendLogMessage(guild, "security", {
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🚨 ANTI-RAID: Phát hiện raid!")
        .setDescription(
          `Có **${tracker.length}** thành viên join trong **${cfg.joinWindowSec}s**.\n` +
          `Đã kích hoạt **lockdown ${cfg.lockdownMinutes} phút** — mọi thành viên mới join trong lúc này sẽ tự động bị **${cfg.action === "ban" ? "ban" : "kick"}**.`
        ).setTimestamp()],
    });
  }

  const inLockdown = cfg.lockdownUntil && now < cfg.lockdownUntil;
  const accountAgeMs = now - member.user.createdTimestamp;
  const isNewAccount = cfg.minAccountAgeHours > 0 && accountAgeMs < cfg.minAccountAgeHours * 3600 * 1000;

  if (!inLockdown && !isNewAccount) return;
  const reason = inLockdown ? "Anti-Raid: server đang trong chế độ lockdown" : "Anti-Raid: tài khoản Discord quá mới";
  try {
    if (cfg.action === "ban") await member.ban({ reason });
    else await member.kick(reason);
    await sendLogMessage(guild, "security", {
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(`🛡️ Anti-Raid: Đã ${cfg.action === "ban" ? "ban" : "kick"} thành viên mới`)
        .addFields(
          { name: "Thành viên", value: `${member.user.tag} (${member.id})`, inline: true },
          { name: "Lý do", value: reason, inline: true },
        ).setTimestamp()],
    });
  } catch (error) {
    console.error("[Anti-Raid] Không thể xử lý thành viên:", error.message || error);
  }
}

async function punishNuker(guild, executorId, cfg, entry) {
  const member = await guild.members.fetch(executorId).catch(() => null);
  const actionLabel = cfg.action === "ban" ? "ban" : cfg.action === "kick" ? "kick" : "gỡ toàn bộ role";
  try {
    if (member) {
      if (cfg.action === "ban") {
        await guild.members.ban(executorId, { reason: "Anti-Nuke: hành vi phá server bất thường" });
      } else if (cfg.action === "kick") {
        await member.kick("Anti-Nuke: hành vi phá server bất thường");
      } else {
        const removable = member.roles.cache.filter(r => r.id !== guild.id && r.editable);
        await member.roles.remove(removable, "Anti-Nuke: hành vi phá server bất thường").catch(() => {});
      }
    }
  } catch (error) {
    console.error("[Anti-Nuke] Không thể xử lý tài khoản nghi vấn:", error.message || error);
  }

  await sendLogMessage(guild, "security", {
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🚨 ANTI-NUKE: Phát hiện hành vi phá server!")
      .addFields(
        { name: "Tài khoản", value: `<@${executorId}> (${executorId})`, inline: true },
        { name: "Hành động gần nhất", value: String(entry?.action ?? "?"), inline: true },
        { name: "Đã xử lý", value: actionLabel, inline: true },
      ).setTimestamp()],
  });
}

async function handleAntiNukeAuditEntry(entry, guild) {
  const cfg = getGuildAntiNuke(guild.id);
  if (!cfg.enabled) return;
  if (!DANGEROUS_AUDIT_EVENTS.has(entry.action)) return;

  const executorId = entry.executorId;
  if (!executorId) return;
  if (executorId === guild.ownerId) return;
  if (client.user && executorId === client.user.id) return;
  if (cfg.whitelistUserIds.includes(executorId)) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (member && member.roles.cache.some(role => cfg.whitelistRoleIds.includes(role.id))) return;

  const now = Date.now();
  let guildTracker = nukeActionTracker.get(guild.id);
  if (!guildTracker) { guildTracker = new Map(); nukeActionTracker.set(guild.id, guildTracker); }
  let history = guildTracker.get(executorId) || [];
  history = history.filter(t => now - t < cfg.windowSec * 1000);
  history.push(now);
  guildTracker.set(executorId, history);

  if (history.length >= cfg.threshold) {
    guildTracker.set(executorId, []);
    await punishNuker(guild, executorId, cfg, entry);
  }
}

client.on("guildMemberAdd", async (member) => {
  try {
    await applyAutoRole(member);
  } catch (error) {
    console.error("AutoRole guildMemberAdd thất bại:", error);
  }
  try {
    await handleAntiRaidJoin(member);
  } catch (error) {
    console.error("Anti-Raid guildMemberAdd thất bại:", error);
  }
  try {
    await sendWelcomeMessage(member);
  } catch (error) {
    console.error("Welcome guildMemberAdd thất bại:", error);
  }
});

client.on("guildAuditLogEntryCreate", async (entry, guild) => {
  try {
    await handleAntiNukeAuditEntry(entry, guild);
  } catch (error) {
    console.error("Anti-Nuke guildAuditLogEntryCreate thất bại:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    // Autocomplete dùng chung cho mọi slash option tên "profile".
    // Chỉ cần option được đăng ký với .setAutocomplete(true).
    if (interaction.isAutocomplete()) {
      // Chỉ PR Manager mới được dùng autocomplete của các slash quản trị.
      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
        if (!hasPRManagerRole({ guild: interaction.guild, member })) {
          await interaction.respond([]);
          return;
        }
      }
      const focused = interaction.options.getFocused(true);
      if (focused?.name === "profile") {
        const query = normalizeName(String(focused.value || ""));
        const choices = Object.entries(profiles)
          .filter(([, profile]) => {
            const name = normalizeName(profile?.name || "");
            const owner = String(profile?.ownerId || "");
            return !query || name.includes(query) || owner.includes(query);
          })
          .slice(0, 25)
          .map(([profileKey, profile]) => {
            const name = String(profile?.name || profileKey);
            const displayName = String(profile?.displayName || "").trim();
            const label = displayName && normalizeName(displayName) !== normalizeName(name)
              ? `${name} — ${displayName}`
              : name;
            return {
              name: label.slice(0, 100),
              value: String(profileKey).slice(0, 100),
            };
          });
        await interaction.respond(choices);
        return;
      }
      await interaction.respond([]);
      return;
    }
    // Khóa toàn bộ slash command + modal quản trị cho PR Manager.
    // Các button/profile navigation không nằm trong guard này để người dùng vẫn
    // có thể bấm chuyển ảnh profile, React Bill, đóng ticket... theo quyền riêng.
    // Modal nhập giờ của panel React Bill được loại trừ: chủ ticket (khách hàng,
    // không có role PR Manager) cũng phải thao tác được panel này. Quyền được
    // kiểm tra riêng bên trong handleReactBillPanelHoursModal.
    const isReactBillHoursModal = interaction.isModalSubmit() && interaction.customId.startsWith("reactbill_panel_hours_modal:");
    if ((interaction.isChatInputCommand() || interaction.isModalSubmit()) && !isReactBillHoursModal) {
      if (!interaction.guild) {
        await interaction.reply({ content: "❌ Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
      if (!hasPRAccess({ guild: interaction.guild, member })) {
        await interaction.reply({ content: "⛔ Chỉ **PR Manager / PR Admin** mới được sử dụng lệnh này.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
    }

    if (await handlePaySlash(interaction)) return;
    if (await handlePaySalaryButton(interaction)) return;
    if (await handleAutoRoleSlash(interaction)) return;
    if (await handleSalaryApprovalButton(interaction)) return;
    if (await handleSalarySlash(interaction)) return;
    if (await handleSalaryDirectSlash(interaction)) return;
    if (await handleReactBillSlash(interaction)) return;
    if (await handleReactBillButton(interaction)) return;
    if (await handleReactBillPanelSelect(interaction)) return;
    if (await handleReactBillPanelHoursButton(interaction)) return;
    if (await handleReactBillPanelHoursModal(interaction)) return;
    if (await handleReactBillPanelBook(interaction)) return;
    if (await handleTicketButton(interaction)) return;
    await handleProfileButtonInteraction(interaction);
  } catch (error) {
    console.error("Profile button interaction thất bại:", error);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "❌ Không thể chuyển ảnh profile.", flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: "❌ Không thể chuyển ảnh profile.", flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
});

function handleCashCommand(message, args = []) {
  if (!message.guild) return message.channel.send("Lệnh này chỉ dùng trong server.");
  const sub = (args[0] || "").toLowerCase();
  if (sub === "add" || sub === "del") {
    if (!hasPRManagerRole(message)) return message.channel.send("⛔ Chỉ PR Manager mới được cộng/trừ Cash.");
    const target = message.mentions.users.first();
    const amount = Number(args.find(a => /^\d+(?:\.\d+)?$/.test(a)) || 0);
    if (!target || !Number.isFinite(amount) || amount <= 0) return message.channel.send(`Dùng: \`scash ${sub} @User <số tiền>\``);
    const before = getCashBalance(message.guild.id, target.id);
    const after = sub === "add" ? before + Math.floor(amount) : Math.max(0, before - Math.floor(amount));
    setCashBalance(message.guild.id, target.id, after);
    saveCashData(cashData);
    return message.channel.send(`${sub === "add" ? "💵 Đã cộng" : "💸 Đã trừ"} **${cashMoney(Math.floor(amount))}** ${sub === "add" ? "cho" : "của"} ${target}.\nSố dư: **${cashMoney(after)}**`);
  }
  const target = message.mentions.users.first();
  if (target) {
    if (!hasPRManagerRole(message)) return message.channel.send("⛔ Chỉ PR Manager mới được xem Cash của người khác.");
    return message.channel.send(`💵 **Cash của ${target}: ${cashMoney(getCashBalance(message.guild.id, target.id))}**`);
  }
  return message.channel.send(`💵 **Cash của ${message.author}: ${cashMoney(getCashBalance(message.guild.id, message.author.id))}**`);
}

const SHOP_PAGE_SIZE = 5;

function shopItemLine(item, indexOnPage) {
  const num = String(indexOnPage + 1).padStart(2, "0");
  const icon = item.type === "emoji" ? item.value : "🖼️";
  return `**${num}.** ${icon} **${item.name}**\nGiá: **${Number(item.price).toLocaleString("vi-VN")}** 💰`;
}

// Dựng shop dạng Components V2: mỗi vật phẩm là 1 Section (text + nút Buy! bên phải),
// có phân trang bằng ActionRow bên dưới. `disabled=true` dùng khi collector hết hạn.
function buildShopContainer(guildId, page, disabled = false) {
  const shop = getGuildShop(guildId);
  const items = shop.items;
  const totalPages = Math.max(1, Math.ceil(items.length / SHOP_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = items.slice(safePage * SHOP_PAGE_SIZE, safePage * SHOP_PAGE_SIZE + SHOP_PAGE_SIZE);

  const container = new ContainerBuilder().setAccentColor(0x5865f2);

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("# 🛒 SHOP"));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  if (!items.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Shop hiện chưa có vật phẩm nào.\nPR Manager dùng `sshop add "Tên vật phẩm" <giá> [emoji]` (hoặc đính kèm ảnh) để thêm.')
    );
    return { container, totalPages: 1, page: 0 };
  }

  pageItems.forEach((item, i) => {
    const text = new TextDisplayBuilder().setContent(shopItemLine(item, i));
    const buyBtn = new ButtonBuilder()
      .setCustomId(`shop_buy:${item.id}`)
      .setLabel("Buy!")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled);
    const section = new SectionBuilder().addTextDisplayComponents(text).setButtonAccessory(buyBtn);
    container.addSectionComponents(section);
  });

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `• Sử dụng nút **Buy!** để mua vật phẩm!\n` +
      `Trang **${safePage + 1}/${totalPages}** — Tổng **${items.length}** vật phẩm`
    )
  );

  if (totalPages > 1) {
    const prev = new ButtonBuilder().setCustomId("shop_prev").setLabel("«").setStyle(ButtonStyle.Secondary).setDisabled(disabled || safePage <= 0);
    const counter = new ButtonBuilder().setCustomId("shop_counter").setLabel(`${safePage + 1}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true);
    const next = new ButtonBuilder().setCustomId("shop_next").setLabel("»").setStyle(ButtonStyle.Secondary).setDisabled(disabled || safePage >= totalPages - 1);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(prev, counter, next));
  }

  return { container, totalPages, page: safePage };
}

async function handleShopCommand(message, args = []) {
  if (!message.guild) return message.channel.send("Lệnh này chỉ dùng trong server.");
  const sub = (args[0] || "").toLowerCase();

  if (sub === "add") {
    if (!hasPRManagerRole(message)) return message.channel.send("⛔ Chỉ PR Manager mới được thêm vật phẩm vào shop.");
    const name = args[1];
    const price = Number(args[2]);
    const emojiArg = args[3];
    if (!name || !Number.isFinite(price) || price <= 0) {
      return message.channel.send('Dùng: `sshop add "Tên vật phẩm" <giá> [emoji]` (nếu không có emoji, nhớ đính kèm 1 ảnh).');
    }
    if (findShopItemByName(message.guild.id, name)) {
      return message.channel.send(`❌ Vật phẩm **${name}** đã tồn tại trong shop. Dùng \`sshop del "${name}"\` nếu muốn xóa rồi thêm lại.`);
    }

    const attachments = getAttachments(message);
    let type, value;
    if (attachments.length) {
      type = "image";
      try {
        value = await saveAttachmentToDisk(name, "shop", attachments[0]);
      } catch (error) {
        console.error("sshop add:", error);
        return message.channel.send("❌ Không tải được ảnh, thử lại sau.");
      }
    } else if (emojiArg) {
      type = "emoji";
      value = emojiArg;
    } else {
      return message.channel.send('❌ Cần thêm emoji ở cuối lệnh hoặc đính kèm 1 ảnh.\nDùng: `sshop add "Tên vật phẩm" <giá> [emoji]`');
    }

    const shop = getGuildShop(message.guild.id);
    const item = {
      id: crypto.randomUUID(),
      name,
      price: Math.floor(price),
      type,
      value,
      addedBy: message.author.id,
      addedAt: new Date().toISOString(),
    };
    shop.items.push(item);
    saveShopData(shopData);
    return message.channel.send(`✅ Đã thêm **${name}** vào shop — giá **${cashMoney(item.price)}**${type === "emoji" ? ` ${value}` : " *(ảnh)*"}.`);
  }

  if (sub === "del" || sub === "remove") {
    if (!hasPRManagerRole(message)) return message.channel.send("⛔ Chỉ PR Manager mới được xóa vật phẩm khỏi shop.");
    const name = args.slice(1).join(" ");
    if (!name) return message.channel.send('Dùng: `sshop del "Tên vật phẩm"`');
    const shop = getGuildShop(message.guild.id);
    const idx = shop.items.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
    if (idx === -1) return message.channel.send(`❌ Không tìm thấy vật phẩm **${name}** trong shop.`);
    const [removed] = shop.items.splice(idx, 1);
    if (removed.type === "image") removeLocalImage(removed.value);
    saveShopData(shopData);
    return message.channel.send(`🗑️ Đã xóa **${removed.name}** khỏi shop.`);
  }

  if (sub === "buy") {
    const name = args.slice(1).join(" ");
    if (!name) return message.channel.send('Dùng: `sshop buy "Tên vật phẩm"`');
    const item = findShopItemByName(message.guild.id, name);
    if (!item) return message.channel.send(`❌ Không tìm thấy vật phẩm **${name}** trong shop. Dùng \`sshop\` để xem danh sách.`);

    const balance = getCashBalance(message.guild.id, message.author.id);
    if (balance < item.price) {
      return message.channel.send(`❌ Không đủ Cash để mua **${item.name}**.\nCần **${cashMoney(item.price)}**, bạn đang có **${cashMoney(balance)}**.`);
    }

    const after = balance - item.price;
    setCashBalance(message.guild.id, message.author.id, after);
    saveCashData(cashData);

    const inv = getUserInventory(message.guild.id, message.author.id);
    inv.push({
      itemId: item.id,
      name: item.name,
      type: item.type,
      value: item.value,
      price: item.price,
      boughtAt: new Date().toISOString(),
    });
    saveInventoryData(inventoryData);

    const summary = `🛒 Bạn đã mua **${item.name}** với giá **${cashMoney(item.price)}**.\nSố dư còn lại: **${cashMoney(after)}**\nDùng \`sinv\` để xem kho đồ của bạn.`;

    if (item.type === "image") {
      const imagePath = localImagePath(item.value);
      if (imagePath && fs.existsSync(imagePath)) {
        return message.channel.send({ content: summary, files: [new AttachmentBuilder(imagePath).setName(path.basename(imagePath))] });
      }
    }
    return message.channel.send(`${item.type === "emoji" ? `${item.value} ` : ""}${summary}`);
  }

  // Mặc định: hiển thị shop dạng Components V2 — đánh số, nút Buy! riêng từng món, phân trang.
  let page = 0;
  const first = buildShopContainer(message.guild.id, page);
  const sent = await message.channel.send({
    components: [first.container],
    flags: MessageFlags.IsComponentsV2,
  });
  let totalPages = first.totalPages;
  page = first.page;

  const collector = sent.createMessageComponentCollector({ time: 15 * 60 * 1000 });
  collector.on("collect", async (interaction) => {
    if (interaction.customId === "shop_prev" || interaction.customId === "shop_next") {
      if (interaction.user.id !== message.author.id) {
        return interaction.reply({ content: "Chỉ người dùng lệnh `sshop` mới được chuyển trang.", flags: MessageFlags.Ephemeral });
      }
      page = interaction.customId === "shop_prev" ? Math.max(0, page - 1) : Math.min(totalPages - 1, page + 1);
      const rebuilt = buildShopContainer(message.guild.id, page);
      page = rebuilt.page;
      totalPages = rebuilt.totalPages;
      return interaction.update({ components: [rebuilt.container], flags: MessageFlags.IsComponentsV2 });
    }

    if (interaction.customId.startsWith("shop_buy:")) {
      const itemId = interaction.customId.slice("shop_buy:".length);
      const shop = getGuildShop(message.guild.id);
      const item = shop.items.find(i => i.id === itemId);
      if (!item) return interaction.reply({ content: "❌ Vật phẩm không còn tồn tại trong shop.", flags: MessageFlags.Ephemeral });

      const balance = getCashBalance(message.guild.id, interaction.user.id);
      if (balance < item.price) {
        return interaction.reply({
          content: `❌ Không đủ Cash để mua **${item.name}**.\nCần **${cashMoney(item.price)}**, bạn đang có **${cashMoney(balance)}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const after = balance - item.price;
      setCashBalance(message.guild.id, interaction.user.id, after);
      saveCashData(cashData);

      const inv = getUserInventory(message.guild.id, interaction.user.id);
      inv.push({
        itemId: item.id,
        name: item.name,
        type: item.type,
        value: item.value,
        price: item.price,
        boughtAt: new Date().toISOString(),
      });
      saveInventoryData(inventoryData);

      return interaction.reply({
        content: `🛒 Bạn đã mua **${item.name}** với giá **${cashMoney(item.price)}**.\nSố dư còn lại: **${cashMoney(after)}**\nDùng \`sinv\` để xem kho đồ của bạn.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  });

  collector.on("end", async () => {
    try {
      const final = buildShopContainer(message.guild.id, page, true);
      await sent.edit({ components: [final.container], flags: MessageFlags.IsComponentsV2 });
    } catch {}
  });
}

function handleInventoryCommand(message, args = []) {
  if (!message.guild) return message.channel.send("Lệnh này chỉ dùng trong server.");
  const target = message.mentions.users.first();
  if (target && target.id !== message.author.id && !hasPRManagerRole(message)) {
    return message.channel.send("⛔ Chỉ PR Manager mới được xem kho đồ của người khác.");
  }
  const owner = target || message.author;
  const inv = getUserInventory(message.guild.id, owner.id);
  if (!inv.length) {
    return message.channel.send(`🎒 **${owner.username}** chưa sở hữu vật phẩm nào. Dùng \`sshop\` để xem shop.`);
  }

  const grouped = new Map();
  for (const entry of inv) {
    if (!grouped.has(entry.name)) grouped.set(entry.name, { ...entry, qty: 0 });
    grouped.get(entry.name).qty += 1;
  }

  const lines = [...grouped.values()].map(e => `${e.type === "emoji" ? e.value : "🖼️"} **${e.name}** x${e.qty}`);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎒 KHO ĐỒ — ${owner.username}`)
    .setThumbnail(owner.displayAvatarURL({ dynamic: true }))
    .setDescription(lines.join("\n"));
  return message.channel.send({ embeds: [embed] });
}


function hprofileSvg(data) {
  const W = 1000, H = 620;
  const money = n => Number(n || 0).toLocaleString("vi-VN");
  const avatar = data.avatarUrl
    ? `<defs><clipPath id="hpAvatar"><circle cx="150" cy="145" r="72"/></clipPath></defs><circle cx="150" cy="145" r="82" fill="#0b1018" stroke="#d6a93a" stroke-width="3"/><image href="${escapeXml(data.avatarUrl)}" x="78" y="73" width="144" height="144" preserveAspectRatio="xMidYMid slice" clip-path="url(#hpAvatar)"/>`
    : `<circle cx="150" cy="145" r="72" fill="#20252d"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="hpBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05090f"/><stop offset="0.55" stop-color="#101923"/><stop offset="1" stop-color="#070b12"/></linearGradient></defs>
  <rect width="1000" height="620" fill="url(#hpBg)"/>
  <rect x="35" y="35" width="930" height="550" rx="18" fill="none" stroke="#d6a93a" stroke-width="4"/>
  ${avatar}
  <text x="275" y="105" class="label">HPROFILE</text>
  <text x="275" y="158" class="title">${escapeXml(data.username)}</text>
  <text x="275" y="195" class="sub">THỐNG KÊ BOOK</text>
  <line x1="75" y1="255" x2="925" y2="255" stroke="#8f7227" stroke-width="2"/>
  <rect x="75" y="300" width="400" height="190" rx="20" fill="#080e17" stroke="#9a7928" stroke-width="2"/>
  <rect x="525" y="300" width="400" height="190" rx="20" fill="#080e17" stroke="#9a7928" stroke-width="2"/>
  <text x="275" y="350" class="section center">SỐ GIỜ ĐÃ BOOK</text>
  <text x="275" y="430" class="value center">${escapeXml(data.hours)} GIỜ</text>
  <text x="725" y="350" class="section center">TIỀN ĐÃ DÙNG</text>
  <text x="725" y="430" class="value center">${escapeXml(money(data.amount))} VNĐ</text>
  <rect x="75" y="515" width="850" height="42" rx="10" fill="#211b0d"/>
  <text x="500" y="543" class="footer center">Chỉ tính bill pay đã thanh toán thành công.</text>
  <style>
  .label{font:700 20px "DejaVu Sans",Arial,sans-serif;fill:#d9ad43;letter-spacing:2px}.title{font:800 42px "DejaVu Sans",Arial,sans-serif;fill:#f3ead6}.sub{font:18px "DejaVu Sans",Arial,sans-serif;fill:#9aa6b5}.section{font:800 19px "DejaVu Sans",Arial,sans-serif;fill:#e1b64e}.value{font:800 42px "DejaVu Sans",Arial,sans-serif;fill:#f0e2bf}.footer{font:16px "DejaVu Sans",Arial,sans-serif;fill:#9aa6b5}.center{text-anchor:middle}
  </style></svg>`;
}

async function makeHProfileAttachment(data) {
  const avatarDataUri = await avatarDataUriFromUrl(data.avatarUrl);
  const svg = hprofileSvg({ ...data, avatarUrl: avatarDataUri });
  try {
    const fontConfig = path.join(__dirname, "fonts.conf");
    if (fs.existsSync(fontConfig)) {
      process.env.FONTCONFIG_FILE = fontConfig;
      process.env.FONTCONFIG_PATH = __dirname;
    }
    const sharp = require("sharp");
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return new AttachmentBuilder(buffer, { name: "sprofile.png" });
  } catch (error) {
    console.warn("sharp chưa có cho sprofile, gửi SVG thay thế:", error.message || error);
    return new AttachmentBuilder(Buffer.from(svg), { name: "sprofile.svg" });
  }
}

async function handleHCloseCommand(message) {
  if (!message.guild) return message.channel.send("❌ Lệnh này chỉ dùng trong server.");
  const channel = message.channel;
  if (!channel?.isThread?.()) return message.channel.send("❌ `sclose` chỉ dùng bên trong ticket.");
  const cfg = getGuildTickets(message.guild.id);
  const record = cfg.threads?.[channel.id];
  if (!record) return message.channel.send("❌ Đây không phải ticket do bot quản lý.");
  const allowed = record.ownerId === message.author.id || ticketManager(message, cfg);
  if (!allowed) return message.channel.send("⛔ Bạn không có quyền đóng ticket này.");
  await message.channel.send("🔒 Đang đóng ticket...").catch(() => {});
  await channel.setLocked(true, "Ticket closed by sclose").catch(() => {});
  await channel.setArchived(true, "Ticket closed by sclose").catch(() => {});
  await sendLogMessage(message.guild, "ticket", {
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔒 Đóng Ticket")
      .addFields(
        { name: "Ticket", value: channel.name ? `#${channel.name}` : `<#${channel.id}>`, inline: true },
        { name: "Đóng bởi", value: `${message.author}`, inline: true },
      ).setTimestamp()],
  });
}


client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content || "";
  const lowerContent = content.toLowerCase();
  const ticketPrefix = lowerContent.startsWith("!ticb") ? "!ticb" : lowerContent.startsWith("!tic") ? "!tic" : null;
  const rolePrefix = /^!role(?:\s|$)/i.test(content) ? "!role" : null;
  const normalizedPrefix = PREFIX.toLowerCase();
  const isQuickSalary = /^sluong(?:\s|$)/i.test(content);
  const isHPing = /^sping(?:\s|$)/i.test(content);
  const isStandaloneHProfile = /^sprofile(?:\s|$)/i.test(content);
  const isStandaloneHClose = /^sclose(?:\s|$)/i.test(content);
  const isStandaloneCash = /^scash(?:\s|$)/i.test(content);
  const isStandaloneShop = /^sshop(?:\s|$)/i.test(content);
  const isStandaloneInventory = /^sinv(?:\s|$)/i.test(content);
  const isRandomNumber = /^srd(?:\s|$)/i.test(content);
  const isRandomPick = /^spick(?:\s|$)/i.test(content);
  const isHRole = /^srole(?:\s|$)/i.test(content);
  const isMainPrefix =
    lowerContent === normalizedPrefix ||
    lowerContent.startsWith(`${normalizedPrefix} `);

  if (isStandaloneHProfile) {
    const rest = content.replace(/^sprofile\s*/i, "").trim();
    const target = message.mentions.users.first() || message.author;
    if (rest && !message.mentions.users.first()) return message.channel.send("Dùng: `sprofile` hoặc `sprofile @User`");
    const stat = getBookingStats(message.guild.id, target.id);
    const attachment = await makeHProfileAttachment({
      username: target.username,
      hours: stat.hours,
      amount: stat.amount,
      avatarUrl: target.displayAvatarURL({ extension: "png", size: 256 }),
    });
    return message.channel.send({ files: [attachment] });
  }

  if (isStandaloneHClose) {
    return handleHCloseCommand(message);
  }

  if (isHPing) {
    const startedAt = Date.now();
    const pingMessage = await message.channel.send("🏓 Đang đo độ trễ...");
    const responseLatency = Date.now() - startedAt;
    const gatewayPing = Math.round(client.ws.ping);
    return pingMessage.edit(`🏓 **Pong!**\n📡 Phản hồi bot: **${responseLatency}ms**\n🌐 Gateway: **${gatewayPing}ms**`);
  }

  if (isStandaloneCash) {
    const cashArgs = parseArgs(content.replace(/^scash\s*/i, ""));
    return handleCashCommand(message, cashArgs);
  }

  if (isStandaloneShop) {
    const shopArgs = parseArgs(content.replace(/^sshop\s*/i, ""));
    return handleShopCommand(message, shopArgs);
  }

  if (isStandaloneInventory) {
    const invArgs = parseArgs(content.replace(/^sinv\s*/i, ""));
    return handleInventoryCommand(message, invArgs);
  }

  if (isRandomNumber) {
    const randomArgs = parseArgs(content.replace(/^srd\s*/i, ""));
    if (randomArgs.length !== 2) {
      return message.channel.send("Dùng: `srd <số 1> <số 2>`");
    }

    const a = Number(randomArgs[0]);
    const b = Number(randomArgs[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      return message.channel.send("❌ Hai giá trị phải là số nguyên.");
    }

    const min = Math.min(a, b);
    const max = Math.max(a, b);
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return message.channel.send(`🎲 Số ngẫu nhiên: **${result}**\nKhoảng: **${min} → ${max}**`);
  }

  if (isRandomPick) {
    const rest = content.replace(/^spick\s*/i, "").trim();
    // Tách theo dấu phẩy, tự bỏ ngoặc () bao quanh nếu người dùng gõ kiểu (lựa chọn 1),(lựa chọn 2).
    const options = rest
      .split(",")
      .map(item => item.trim().replace(/^\((.*)\)$/, "$1").trim())
      .filter(Boolean);

    if (options.length < 2) {
      return message.channel.send("Dùng: `spick lựa chọn 1, lựa chọn 2, lựa chọn 3, ...` (tối thiểu 2 lựa chọn, phân tách bằng dấu phẩy)");
    }

    const winnerIndex = Math.floor(Math.random() * options.length);
    const winner = options[winnerIndex];
    const list = options.map((opt, i) => `${i === winnerIndex ? "👉" : "◦"} ${opt}`).join("\n");
    return message.channel.send(`🎯 **Kết quả:** ${winner}\n\n${list}`);
  }

  if (!isMainPrefix && !ticketPrefix && !rolePrefix && !isHRole && !isQuickSalary && !isStandaloneCash && !isStandaloneHClose) {
    const settings = getGuildAI(message.guild.id);
    if (settings.enabled && message.reference?.messageId && GROQ_API_KEY) {
      try {
        const referenced = await message.channel.messages.fetch(message.reference.messageId);
        if (referenced?.author?.id === client.user.id) {
          const key = aiHistoryKey(message);
          const history = aiHistories.get(key) || [];
          await message.channel.sendTyping();
          const answer = await askGroq({
            model: settings.model,
            prompt: settings.prompt,
            history,
            botMessage: referenced.content || referenced.embeds?.[0]?.description || "",
            userMessage: content,
          });
          pushAIHistory(key, "user", content);
          pushAIHistory(key, "assistant", answer);
          await message.reply(answer);
          return;
        }
      } catch (error) {
        console.error("AI Reply thất bại:", error);
        if (error?.message?.includes("GROQ_API_KEY")) {
          return message.channel.send("❌ AI chưa được cấu hình API key.");
        }
        return message.channel.send("❌ AI đang lỗi khi trả lời. Kiểm tra terminal để xem chi tiết.");
      }
    }

    const keywordProfile = findKeywordProfile(message.guild.id, content);
    if (keywordProfile) {
      // Một message chỉ được phép tạo đúng 1 profile card.
      // Guard này cũng chặn trường hợp Discord/event loop xử lý cùng event lại lần nữa.
      if (!acquireKeywordResponseLock(message)) return;

      try {
        await sendKeywordProfile(message, keywordProfile);
      } catch (error) {
        console.error("Profile keyword gửi thất bại:", error);
      }
      return;
    }

    const matched = findMatchingAutoRes(message.guild.id, content);
    if (!matched) return;
    try {
      await message.channel.send(autoResPayload(matched));
    } catch (error) {
      console.error("AutoRes gửi thất bại:", error);
    }
    return;
  }

  if (!isMainPrefix && !ticketPrefix && !rolePrefix && !isHRole && !isQuickSalary && !isStandaloneCash && !isStandaloneHClose) return;

  // Toàn bộ lệnh prefix chỉ dành cho PR Manager. Các keyword/AutoRes trigger
  // thông thường vẫn public vì chúng không phải command quản trị.
  // sluong (xem lương nhanh, gửi DM) cũng public — ai cũng dùng được.
  if (!isStandaloneCash && !isStandaloneHClose && !isQuickSalary) {
    const member = message.member;
    if (!hasPRManagerRole({ guild: message.guild, member })) {
      return message.channel.send("⛔ Chỉ **PR Manager** mới được sử dụng lệnh này.");
    }
  }

  if (isQuickSalary) {
    const quickArgs = parseArgs(content.replace(/^sluong\s*/i, ""));
    return handleSalaryPrefix(message, quickArgs);
  }

  if (isHRole) {
    const rest = content.replace(/^srole\s*/i, "").trim();
    if (!rest) return message.channel.send(userRoleHelp());
    const roleArgs = parseArgs(rest);
    const firstToken = (roleArgs[0] || "").toLowerCase();
    if (firstToken === "remove" || firstToken === "list") {
      const sub = roleArgs.shift();
      return handleUserRoleCommand(message, sub, roleArgs);
    }
    return handleTempRoleAssign(message, roleArgs);
  }

  if (rolePrefix) {
    const rawRole = content.slice(rolePrefix.length).trim();
    if (!rawRole) return handleUserRoleCommand(message, "", []);
    const roleArgs = parseArgs(rawRole);
    const roleCommand = (roleArgs.shift() || "").toLowerCase();
    return handleUserRoleCommand(message, roleCommand, roleArgs);
  }

  const raw = ticketPrefix
    ? content.slice(ticketPrefix.length).trim()
    : content.slice(PREFIX.length).trim();

  // `sar edit "profile"` dùng nội dung xuống dòng để cập nhật profile theo thứ tự:
  // 1 name, 2 nick, 3 location, 4 game, 5 description, 6 giá game, 7 giá hát, 8 dealCam.
  // Dòng trống = giữ nguyên giá trị cũ.
  let multilineProfileEdit = null;
  if (!ticketPrefix && /^edit(?:\s|$)/i.test(raw)) {
    // Bóc tách theo dòng thay vì regex 1 cụm: dòng đầu tiên luôn là tên profile
    // (chấp nhận có/không ngoặc kép, ngoặc đơn, hoặc bất kỳ dấu bao quanh nào,
    // kể cả tên có khoảng trắng), các dòng còn lại luôn được coi là nội dung.
    const afterEdit = raw.replace(/^edit\s*/i, "");
    const lines = afterEdit.split(/\r?\n/);
    let firstLine = (lines.shift() ?? "").trim();
    const quotedMatch =
      firstLine.match(/^"([^"]+)"$/) ||
      firstLine.match(/^'([^']+)'$/) ||
      firstLine.match(/^<([^>]+)>$/);
    const profileName = (quotedMatch ? quotedMatch[1] : firstLine).trim();

    if (profileName) {
      multilineProfileEdit = {
        profileName,
        values: lines,
      };
    }
  }

  if (!raw) {
    if (ticketPrefix === "!tic") return handleTicketCommand(message, []);
    if (ticketPrefix === "!ticb") return handleTicketCommand(message, ["button"]);
    return sendHelp(message);
  }

  const args = parseArgs(raw);
  let command = (args.shift() || "").toLowerCase();

  // ===== VIẾT TẮT LỆNH sar =====
  // Lệnh đầy đủ vẫn hoạt động; alias chỉ là cách viết ngắn hơn.
  const HAR_ALIASES = {
    c: "create",
    cr: "create",
    del: "delete",
    d: "delete",
    i: "img",
    delpic: "remove-img",
    ri: "remove-img",
    turl: "avt",
    s: "show",
    l: "list",
    n: "name",
    nk: "nick",
    lc: "loc",
    ds: "des",
    gm: "game",
    cm: "cam",
    co: "color",
    col: "color",
    ci: "clear-img",
    rs: "resync",
    h: "help",
  };

  // Các lệnh đặc biệt theo cú pháp người dùng yêu cầu.
  if (!ticketPrefix && command === "del" && (args[0] || "").toLowerCase() === "des") {
    args.shift();
    command = "delete-des";
  }

  if (!ticketPrefix && HAR_ALIASES[command]) command = HAR_ALIASES[command];

  // Giữ nguyên toàn bộ whitespace/newline cho !tic desc và !tic welcome.
  // parseArgs() vốn dùng để tách tham số nên sẽ làm mất newline nếu chỉ dùng args.join(" ").
  let ticketRawValue = null;
  if (ticketPrefix === "!tic" && (command === "desc" || command === "welcome")) {
    const match = raw.match(/^(desc|welcome)\s+([\s\S]*)$/i);
    if (match) ticketRawValue = match[2];
  }

  // Giữ nguyên whitespace/newline cho nội dung tin chào mừng: `sar tb wlc msg ...`.
  let wlcMessageRawValue = null;
  if (!ticketPrefix && command === "tb") {
    const match = raw.match(/^tb\s+wlc\s+(?:msg|message)\s+([\s\S]*)$/i);
    if (match) wlcMessageRawValue = match[1];
  }

  try {

    // ===== TICKET PREFIX RIÊNG =====
    if (ticketPrefix === "!tic") {
      return handleTicketCommand(message, [command, ...args], ticketRawValue);
    }

    if (ticketPrefix === "!ticb") {
      return handleTicketCommand(message, ["button", command, ...args]);
    }

    if (command === "help") return sendHelp(message);

    if (!ticketPrefix && command === "tb" && (args[0] || "").toLowerCase() === "wlc") {
      args.shift();
      return handleWelcomeCommand(message, args, wlcMessageRawValue);
    }

    if (!ticketPrefix && command === "steal") {
      return handleStealEmoji(message, args);
    }
    if (command === "luong" || command === "salary") return handleSalaryPrefix(message, args);
    if (command === "stinhluong") return handleSalaryDirectPrefix(message, args);
    if (command === "tic") return handleTicketCommand(message, args);
    if (command === "ticb") return handleTicketCommand(message, ["button", ...args]);

    // ===== PR ADMIN =====
    if (command === "pradmin") {
      if (!canManagePRRoles(message)) return message.channel.send("⛔ Chỉ người có quyền **Manage Server** mới được quản lý PR Admin.");
      const sub = String(args.shift() || "list").toLowerCase();
      const allowed = getConfiguredPRAdminRoles(message.guild.id);
      if (sub === "list") {
        const mentions = allowed.map(id => message.guild.roles.cache.get(id)).filter(Boolean).map(role => `• ${role}`);
        return message.channel.send(mentions.length ? `👑 **PR Admin:**\n${mentions.join("\n")}` : "👑 Chưa có role PR Admin.");
      }
      const role = getRoleFromMessage(message, args);
      if (!role) return message.channel.send(`Dùng: \`sar pradmin ${sub} @Role\``);
      if (role.id === message.guild.id || role.managed) return message.channel.send("❌ Role không hợp lệ.");
      if (sub === "add") {
        if (allowed.includes(role.id)) return message.channel.send(`ℹ️ ${role} đã là PR Admin.`);
        allowed.push(role.id); savePRAdminRoles(prAdminRoles);
        return message.channel.send(`👑 Đã cấp **PR Admin** cho ${role}.`);
      }
      if (sub === "remove" || sub === "del") {
        const i = allowed.indexOf(role.id);
        if (i === -1) return message.channel.send(`ℹ️ ${role} chưa là PR Admin.`);
        allowed.splice(i, 1); savePRAdminRoles(prAdminRoles);
        return message.channel.send(`✅ Đã gỡ **PR Admin** của ${role}.`);
      }
      return message.channel.send("Dùng: `sar pradmin add @Role`, `sar pradmin remove @Role`, `sar pradmin list`");
    }

    // ===== KÊNH XÁC NHẬN LƯƠNG =====
    if (command === "luongchannel") {
      if (!canManagePRRoles(message)) return message.channel.send("⛔ Chỉ người có quyền **Manage Server** mới được cấu hình kênh xác nhận lương.");
      const channel = message.mentions.channels.first();
      if (!channel || !channel.isTextBased()) return message.channel.send("Dùng: `sar luongchannel #kenh`");
      const cfg = getSalaryApprovalConfig(message.guild.id);
      cfg.channelId = channel.id;
      saveSalaryApprovals(salaryApprovals);
      return message.channel.send(`✅ Kênh xác nhận lương: ${channel}`);
    }

    // ===== KÊNH LOG (LƯƠNG / TICKET / REACT BILL) =====
    if (command === "logchannel") {
      if (!canManagePRRoles(message)) return message.channel.send("⛔ Chỉ người có quyền **Manage Server** mới được cấu hình kênh log.");
      const type = (args.shift() || "").toLowerCase();
      const logCfg = getGuildLogChannels(message.guild.id);

      if (type === "list") {
        const lines = Object.entries(LOG_TYPES).map(([key, label]) => `${label}: ${logCfg[key] ? `<#${logCfg[key]}>` : "*(chưa đặt)*"}`);
        return message.channel.send(`📋 **Kênh log hiện tại:**\n${lines.join("\n")}`);
      }
      if (!LOG_TYPES[type]) {
        return message.channel.send('Dùng: `sar logchannel <luong|ticket|reactbill> #kenh` hoặc `sar logchannel list`');
      }
      const channel = message.mentions.channels.first();
      if (!channel || !channel.isTextBased()) return message.channel.send(`Dùng: \`sar logchannel ${type} #kenh\``);
      logCfg[type] = channel.id;
      saveLogChannels(logChannelsData);
      return message.channel.send(`✅ Kênh log ${LOG_TYPES[type]}: ${channel}`);
    }

    // ===== ANTI-RAID =====
    if (command === "antiraid") {
      if (!canManageSecurity(message)) return message.channel.send("⛔ Chỉ **chủ server (Owner)**, **Administrator**, hoặc **PR Admin** mới được cấu hình Anti-Raid.");
      const cfg = getGuildAntiRaid(message.guild.id);
      const sub = (args.shift() || "status").toLowerCase();

      if (sub === "on") {
        cfg.enabled = true;
        saveAntiRaidData(antiRaidData);
        return message.channel.send("✅ Đã **bật** Anti-Raid.");
      }
      if (sub === "off") {
        cfg.enabled = false;
        cfg.lockdownUntil = 0;
        saveAntiRaidData(antiRaidData);
        return message.channel.send("✅ Đã **tắt** Anti-Raid.");
      }
      if (sub === "config") {
        const threshold = Number(args[0]);
        const windowSec = Number(args[1]);
        const lockdownMinutes = Number(args[2]);
        if (![threshold, windowSec, lockdownMinutes].every(n => Number.isFinite(n) && n > 0)) {
          return message.channel.send("Dùng: `sar antiraid config <số join> <giây> <lockdown phút>` — VD: `sar antiraid config 5 10 15`");
        }
        cfg.joinThreshold = Math.floor(threshold);
        cfg.joinWindowSec = Math.floor(windowSec);
        cfg.lockdownMinutes = Math.floor(lockdownMinutes);
        saveAntiRaidData(antiRaidData);
        return message.channel.send(`✅ Anti-Raid: **${cfg.joinThreshold} join / ${cfg.joinWindowSec}s** sẽ kích hoạt lockdown **${cfg.lockdownMinutes} phút**.`);
      }
      if (sub === "action") {
        const action = (args[0] || "").toLowerCase();
        if (action !== "kick" && action !== "ban") return message.channel.send("Dùng: `sar antiraid action kick` hoặc `sar antiraid action ban`");
        cfg.action = action;
        saveAntiRaidData(antiRaidData);
        return message.channel.send(`✅ Anti-Raid sẽ **${action === "ban" ? "ban" : "kick"}** thành viên khi phát hiện raid.`);
      }
      if (sub === "minage") {
        const hours = Number(args[0]);
        if (!Number.isFinite(hours) || hours < 0) return message.channel.send("Dùng: `sar antiraid minage <số giờ>` (0 = tắt lọc tài khoản mới)");
        cfg.minAccountAgeHours = Math.floor(hours);
        saveAntiRaidData(antiRaidData);
        return message.channel.send(cfg.minAccountAgeHours > 0
          ? `✅ Tài khoản Discord mới hơn **${cfg.minAccountAgeHours} giờ** sẽ luôn bị xử lý khi join.`
          : "✅ Đã tắt lọc theo tuổi tài khoản.");
      }

      const lockdownActive = cfg.lockdownUntil && Date.now() < cfg.lockdownUntil;
      return message.channel.send(
        `🛡️ **ANTI-RAID** — ${cfg.enabled ? "🟢 Đang bật" : "🔴 Đang tắt"}\n` +
        `• Ngưỡng raid: **${cfg.joinThreshold} join / ${cfg.joinWindowSec}s**\n` +
        `• Lockdown: **${cfg.lockdownMinutes} phút**${lockdownActive ? " *(🚨 đang trong lockdown)*" : ""}\n` +
        `• Hành động: **${cfg.action === "ban" ? "Ban" : "Kick"}**\n` +
        `• Lọc tài khoản mới: **${cfg.minAccountAgeHours > 0 ? `< ${cfg.minAccountAgeHours} giờ` : "tắt"}**\n\n` +
        "Dùng: `sar antiraid on/off`, `sar antiraid config <join> <giây> <lockdown phút>`, `sar antiraid action kick/ban`, `sar antiraid minage <giờ>`"
      );
    }

    // ===== ANTI-NUKE =====
    if (command === "antinuke") {
      if (!canManageSecurity(message)) return message.channel.send("⛔ Chỉ **chủ server (Owner)**, **Administrator**, hoặc **PR Admin** mới được cấu hình Anti-Nuke.");
      const cfg = getGuildAntiNuke(message.guild.id);
      const sub = (args.shift() || "status").toLowerCase();

      if (sub === "on") {
        cfg.enabled = true;
        saveAntiNukeData(antiNukeData);
        return message.channel.send("✅ Đã **bật** Anti-Nuke.");
      }
      if (sub === "off") {
        cfg.enabled = false;
        saveAntiNukeData(antiNukeData);
        return message.channel.send("✅ Đã **tắt** Anti-Nuke.");
      }
      if (sub === "config") {
        const threshold = Number(args[0]);
        const windowSec = Number(args[1]);
        if (![threshold, windowSec].every(n => Number.isFinite(n) && n > 0)) {
          return message.channel.send("Dùng: `sar antinuke config <số hành động> <giây>` — VD: `sar antinuke config 3 30`");
        }
        cfg.threshold = Math.floor(threshold);
        cfg.windowSec = Math.floor(windowSec);
        saveAntiNukeData(antiNukeData);
        return message.channel.send(`✅ Anti-Nuke: **${cfg.threshold} hành động nguy hiểm / ${cfg.windowSec}s** từ 1 tài khoản sẽ bị xử lý.`);
      }
      if (sub === "action") {
        const action = (args[0] || "").toLowerCase();
        if (!["strip", "kick", "ban"].includes(action)) return message.channel.send("Dùng: `sar antinuke action strip|kick|ban`");
        cfg.action = action;
        saveAntiNukeData(antiNukeData);
        return message.channel.send(`✅ Anti-Nuke sẽ **${action === "strip" ? "gỡ toàn bộ role" : action === "ban" ? "ban" : "kick"}** tài khoản vi phạm.`);
      }
      if (sub === "whitelist") {
        const action2 = (args.shift() || "").toLowerCase();
        const role = message.mentions.roles.first();
        const user = message.mentions.users.first();
        if (!["add", "remove"].includes(action2) || (!role && !user)) {
          return message.channel.send("Dùng: `sar antinuke whitelist add/remove @User` hoặc `@Role`");
        }
        const list = role ? cfg.whitelistRoleIds : cfg.whitelistUserIds;
        const targetId = role ? role.id : user.id;
        if (action2 === "add") {
          if (!list.includes(targetId)) list.push(targetId);
        } else {
          const i = list.indexOf(targetId);
          if (i !== -1) list.splice(i, 1);
        }
        saveAntiNukeData(antiNukeData);
        return message.channel.send(`✅ Đã ${action2 === "add" ? "thêm" : "gỡ"} ${role || user} khỏi whitelist Anti-Nuke.`);
      }

      return message.channel.send(
        `🛡️ **ANTI-NUKE** — ${cfg.enabled ? "🟢 Đang bật" : "🔴 Đang tắt"}\n` +
        `• Ngưỡng: **${cfg.threshold} hành động nguy hiểm / ${cfg.windowSec}s**\n` +
        `• Hành động xử lý: **${cfg.action === "strip" ? "Gỡ toàn bộ role" : cfg.action === "ban" ? "Ban" : "Kick"}**\n` +
        `• Whitelist User: ${cfg.whitelistUserIds.length ? cfg.whitelistUserIds.map(id => `<@${id}>`).join(", ") : "*(trống)*"}\n` +
        `• Whitelist Role: ${cfg.whitelistRoleIds.length ? cfg.whitelistRoleIds.map(id => `<@&${id}>`).join(", ") : "*(trống)*"}\n\n` +
        "Dùng: `sar antinuke on/off`, `sar antinuke config <số hành động> <giây>`, `sar antinuke action strip/kick/ban`, `sar antinuke whitelist add/remove @User|@Role`"
      );
    }

    // ===== BACKUP SERVER DISCORD =====
    if (command === "backup") {
      if (!canManageSecurity(message)) {
        return message.channel.send("⛔ Chỉ **chủ server (Owner)**, **Administrator**, hoặc **PR Admin** mới được dùng lệnh Backup.");
      }
      const sub = (args.shift() || "list").toLowerCase();
      const guild = message.guild;
      const list = getGuildBackups(guild.id);

      if (sub === "create") {
        const note = args.join(" ").trim();
        const progress = await message.channel.send("⏳ Đang tạo backup server (roles, channels, permissions)...");
        try {
          const backup = await createServerBackup(guild, note, message.author.id);
          await progress.edit(
            `✅ **Đã tạo backup:** \`${backup.id}\`\n` +
            `• Roles: **${backup.roles.length}**\n` +
            `• Channels: **${backup.channels.length}**\n` +
            `${note ? `• Ghi chú: ${note}\n` : ""}` +
            `\nDùng \`sar backup restore ${backup.id}\` để khôi phục khi cần.`
          );
          await sendLogMessage(guild, "backup", {
            embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("💾 Đã tạo Backup Server")
              .addFields(
                { name: "Backup ID", value: `\`${backup.id}\``, inline: true },
                { name: "Tạo bởi", value: `${message.author}`, inline: true },
                { name: "Roles / Channels", value: `${backup.roles.length} / ${backup.channels.length}`, inline: true },
              ).setTimestamp()],
          });
        } catch (error) {
          console.error("[Backup] create:", error);
          await progress.edit("❌ Tạo backup thất bại. Kiểm tra bot có đủ quyền **Manage Roles/Channels** không.");
        }
        return;
      }

      if (sub === "list") {
        const entries = Object.values(list).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (!entries.length) return message.channel.send("📋 Server chưa có backup nào. Dùng `sar backup create` để tạo.");
        const lines = entries.map(b =>
          `\`${b.id}\` — ${new Date(b.createdAt).toLocaleString("vi-VN")} · ${b.roles.length} role / ${b.channels.length} kênh${b.note ? ` · _${b.note}_` : ""}`
        );
        return message.channel.send(`📋 **Backup của server (tối đa ${MAX_BACKUPS_PER_GUILD} bản gần nhất):**\n${lines.join("\n")}`);
      }

      if (sub === "info") {
        const id = args[0];
        const backup = list[id];
        if (!backup) return message.channel.send("❌ Không tìm thấy backup với ID đó. Dùng `sar backup list` để xem danh sách.");
        return message.channel.send({
          embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`💾 Backup ${backup.id}`)
            .setThumbnail(backup.guild.iconURL || null)
            .addFields(
              { name: "Tên server lúc backup", value: backup.guild.name, inline: true },
              { name: "Tạo lúc", value: new Date(backup.createdAt).toLocaleString("vi-VN"), inline: true },
              { name: "Tạo bởi", value: `<@${backup.createdBy}>`, inline: true },
              { name: "Roles", value: String(backup.roles.length), inline: true },
              { name: "Channels", value: String(backup.channels.length), inline: true },
              { name: "Ghi chú", value: backup.note || "*(không có)*" },
            )],
        });
      }

      if (sub === "delete" || sub === "del") {
        const id = args[0];
        if (!list[id]) return message.channel.send("❌ Không tìm thấy backup với ID đó.");
        delete list[id];
        saveBackupData(backupData);
        return message.channel.send(`🗑️ Đã xóa backup \`${id}\`.`);
      }

      if (sub === "restore") {
        const id = args[0];
        const backup = list[id];
        if (!backup) return message.channel.send("❌ Không tìm thấy backup với ID đó. Dùng `sar backup list` để xem danh sách.");

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("backup_restore_confirm").setLabel("⚠️ Xác nhận khôi phục").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("backup_restore_cancel").setLabel("Hủy").setStyle(ButtonStyle.Secondary),
        );
        const confirmMsg = await message.channel.send({
          content:
            `⚠️ **CẢNH BÁO**: Khôi phục \`${backup.id}\` (backup lúc ${new Date(backup.createdAt).toLocaleString("vi-VN")}) sẽ:\n` +
            `• Tạo lại role/kênh đã bị xóa kể từ lúc backup\n` +
            `• Ghi đè tên/màu/quyền của role & kênh còn tồn tại về đúng như trong backup\n` +
            `• **KHÔNG** xóa role/kênh phát sinh sau backup, không khôi phục tin nhắn\n\n` +
            `${message.author} xác nhận trong vòng 60s:`,
          components: [confirmRow],
        });

        let choice;
        try {
          choice = await confirmMsg.awaitMessageComponent({
            filter: i => i.user.id === message.author.id,
            time: 60_000,
          });
        } catch {
          await confirmMsg.edit({ content: "⌛ Hết thời gian xác nhận, đã hủy khôi phục.", components: [] });
          return;
        }

        if (choice.customId === "backup_restore_cancel") {
          await choice.update({ content: "❌ Đã hủy khôi phục backup.", components: [] });
          return;
        }

        await choice.update({ content: "⏳ Đang khôi phục... (roles → categories → channels)", components: [] });
        try {
          const report = await restoreGuildBackup(guild, backup, phase => {
            confirmMsg.edit({ content: `⏳ Đang khôi phục... (${phase})`, components: [] }).catch(() => {});
          });
          const summary =
            `✅ **Khôi phục xong \`${backup.id}\`**\n` +
            `• Roles: cập nhật ${report.rolesUpdated}, tạo mới ${report.rolesCreated}\n` +
            `• Channels: cập nhật ${report.channelsUpdated}, tạo mới ${report.channelsCreated}` +
            (report.errors.length ? `\n⚠️ ${report.errors.length} lỗi nhỏ (bỏ qua): ${report.errors.slice(0, 3).join("; ")}${report.errors.length > 3 ? "..." : ""}` : "");
          await confirmMsg.edit({ content: summary, components: [] });
          await sendLogMessage(guild, "backup", {
            embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("♻️ Đã khôi phục Backup Server")
              .addFields(
                { name: "Backup ID", value: `\`${backup.id}\``, inline: true },
                { name: "Khôi phục bởi", value: `${message.author}`, inline: true },
                { name: "Kết quả", value: `Role +${report.rolesCreated}/~${report.rolesUpdated} · Channel +${report.channelsCreated}/~${report.channelsUpdated}` },
              ).setTimestamp()],
          });
        } catch (error) {
          console.error("[Backup] restore:", error);
          await confirmMsg.edit({ content: "❌ Khôi phục thất bại giữa chừng. Kiểm tra log console để biết chi tiết.", components: [] });
        }
        return;
      }

      return message.channel.send(
        "Dùng: `sar backup create [ghi chú]`, `sar backup list`, `sar backup info <id>`, `sar backup restore <id>`, `sar backup delete <id>`"
      );
    }

    // ===== QUẢN LÝ ROLE CÓ QUYỀN SỬA PR =====
    if (command === "roleadd" || command === "roleremove" || command === "roles") {
      if (command !== "roles" && !canManagePRRoles(message)) {
        return message.channel.send("⛔ Chỉ người có quyền **Manage Server** mới được quản lý role PR.");
      }

      const allowed = getConfiguredPRRoles(message.guild.id);

      if (command === "roles") {
        if (!allowed.length) {
          return message.channel.send("🔐 Hiện chưa có role nào được cấp quyền sửa PR.");
        }
        const mentions = allowed
          .map(id => message.guild.roles.cache.get(id))
          .filter(Boolean)
          .map(role => `• ${role}`);
        if (!mentions.length) {
          return message.channel.send("🔐 Hiện chưa có role PR hợp lệ. Các role cũ có thể đã bị xóa.");
        }
        return message.channel.send(`🔐 **Role có quyền sửa PR:**\n${mentions.join("\n")}`);
      }

      const role = getRoleFromMessage(message, args);
      if (!role) {
        return message.channel.send(`Dùng: \`sar ${command} @Role\``);
      }
      if (role.id === message.guild.id) {
        return message.channel.send("❌ Không thể cấp quyền cho @everyone.");
      }
      if (role.managed) {
        return message.channel.send("❌ Không thể cấp quyền cho role được quản lý bởi bot/integration.");
      }

      if (command === "roleadd") {
        if (allowed.includes(role.id)) {
          return message.channel.send(`ℹ️ ${role} đã có quyền sửa PR.`);
        }
        allowed.push(role.id);
        savePRRoles(prRoles);
        return message.channel.send(`✅ Đã cấp quyền sửa PR cho ${role}.`);
      }

      const index = allowed.indexOf(role.id);
      if (index === -1) {
        return message.channel.send(`ℹ️ ${role} chưa có quyền sửa PR.`);
      }
      allowed.splice(index, 1);
      savePRRoles(prRoles);
      return message.channel.send(`✅ Đã gỡ quyền sửa PR của ${role}.`);
    }


    if (["set", "unset", "links"].includes(command)) {
      if (!message.guild) return message.channel.send("Lệnh này chỉ dùng trong server.");
      const links = getGuildProfileLinks(message.guild.id);

      if (!hasPRManagerRole(message)) return message.channel.send("⛔ Chỉ PR Manager mới được quản lý liên kết PR.");

      if (command === "set") {
        const profileName = args.shift();
        const target = message.mentions.users.first();
        if (!profileName || !target) return message.channel.send('Dùng: `sar set "pr5" @User`');
        const candidates = findProfilesByName(profileName);
        if (!candidates.length) return message.channel.send(`❌ Không tìm thấy profile **${profileName}**.`);

        let chosen = candidates.find(x => x.profile.ownerId === target.id);
        if (!chosen && candidates.length === 1) chosen = candidates[0];
        if (!chosen) return message.channel.send(`⚠️ Có nhiều profile **${profileName}**. Profile của @${target.username} chưa được xác định.`);

        if (!links[target.id] || typeof links[target.id] !== "object") links[target.id] = {};
        links[target.id][normalizeName(profileName)] = chosen.profileKey;
        chosen.profile.linkedUserId = target.id;
        saveProfiles(profiles);
        saveProfileLinks(profileLinks);
        return message.channel.send(`🔗 Đã liên kết **${chosen.profile.name}** với ${target}.`);
      }

      if (command === "unset") {
        const profileName = args.shift();
        const target = message.mentions.users.first();
        if (!profileName || !target) return message.channel.send('Dùng: `sar unset "pr5" @User`');
        const key = normalizeName(profileName);
        if (!links[target.id]?.[key]) return message.channel.send(`⚠️ ${target} chưa được liên kết với **${profileName}**.`);
        const linkedKey = links[target.id][key];
        delete links[target.id][key];
        if (!Object.keys(links[target.id]).length) delete links[target.id];
        const linkedProfile = findProfileByKey(linkedKey);
        if (linkedProfile && linkedProfile.linkedUserId === target.id) {
          delete linkedProfile.linkedUserId;
          saveProfiles(profiles);
        }
        saveProfileLinks(profileLinks);
        return message.channel.send(`🗑️ Đã hủy liên kết **${profileName}** khỏi ${target}.`);
      }

      const lines = [];
      for (const [userId, map] of Object.entries(links)) {
        for (const [profileName, profileKey] of Object.entries(map || {})) {
          const profile = findProfileByKey(profileKey);
          lines.push(`• **${profile?.name || profileName}** → <@${userId}>`);
        }
      }
      return message.channel.send(lines.length ? `**🔗 PR Links**\n${lines.join("\n")}` : "🔗 Chưa có liên kết PR nào.");
    }

    if (command === "resync") {
      const name = args.join(" ").trim();
      const profile = findProfile(name);
      if (!profile) return message.channel.send("Không tìm thấy profile.");
      if (!canEditProfile(profile, message)) {
        return message.channel.send("Bạn không có quyền resync profile này.");
      }

      await message.channel.send(`🔄 Đang resync **${profile.name}**...`);
      try {
        await syncProfileEverywhere(profile);
        return message.channel.send(`✅ Đã resync **${profile.name}**.`);
      } catch (error) {
        console.error(`Resync ${profile.name} thất bại:`, error);
        return message.channel.send("❌ Resync thất bại. Xem terminal để biết chi tiết.");
      }
    }


    if (command === "ai") {
      if (!hasPRManagerRole(message)) {
        return message.channel.send("⛔ Chỉ PR Manager mới được quản lý AI.");
      }

      const sub = (args.shift() || "help").toLowerCase();
      const settings = getGuildAI(message.guild.id);

      if (sub === "on" || sub === "off") {
        if (!GROQ_API_KEY) {
          return message.channel.send("❌ Chưa có `GROQ_API_KEY` trong `.env`. Thêm Groq API key rồi khởi động lại bot.");
        }
        settings.enabled = sub === "on";
        saveAISettings(aiSettings);
        return message.channel.send(`${settings.enabled ? "🟢 Đã bật" : "🔴 Đã tắt"} AI Reply.`);
      }


  if (sub === "status") {
        return message.channel.send([
          "**🤖 AI Status**",
          `• Trạng thái: ${settings.enabled ? "🟢 Bật" : "🔴 Tắt"}`,
          `• Model: \`${settings.model}\``,
          `• Prompt: ${settings.prompt}`,
          `• API key: ${GROQ_API_KEY ? "🟢 Đã cấu hình" : "🔴 Chưa có"}`,
        ].join("\n"));
      }

      if (sub === "prompt") {
        const prompt = args.join(" ").trim();
        if (!prompt) return message.channel.send('Dùng: `sar ai prompt "Nội dung prompt"`');
        settings.prompt = prompt.slice(0, 8000);
        saveAISettings(aiSettings);
        return message.channel.send("✅ Đã cập nhật tính cách/prompt cho AI.");
      }

      if (sub === "model") {
        const model = args.join(" ").trim();
        if (!model) return message.channel.send('Dùng: `sar ai model "tên-model"`');
        settings.model = model.slice(0, 100);
        saveAISettings(aiSettings);
        return message.channel.send(`✅ AI sẽ dùng model \`${settings.model}\`.`);
      }

      if (sub === "clear") {
        clearAIHistory(message.guild.id);
        return message.channel.send("🧹 Đã xóa lịch sử hội thoại AI trong server.");
      }

      return message.channel.send(aiHelp());
    }

    if (command === "edit") {
      if (!multilineProfileEdit) {
        return message.channel.send([
          "Dùng:",
          "```text",
          'sar edit "pr5"',
          "Sang",
          "mắm",
          "hà tĩnh",
          "vlr",
          "yêu em yêu cả lối về",
          "50k/h",
          "100k/bài",
          "cam deal",
          "```",
          "Thứ tự: name → nick → location → game → description → giá game → giá hát → dealCam.",
          "Dòng trống sẽ giữ nguyên giá trị cũ.",
        ].join("\n"));
      }

      const profile = findProfile(multilineProfileEdit.profileName);
      if (!profile) return message.channel.send("Không tìm thấy profile.");
      if (!canEditProfile(profile, message)) return message.channel.send("Bạn không có quyền sửa profile này.");

      const values = multilineProfileEdit.values;
      const fields = ["displayName", "nickname", "location", "game", "description", "priceGame", "priceSing", "dealCam"];

      // Chỉ áp dụng những dòng có nội dung; dòng trống (hoặc không điền) giữ nguyên field tương ứng.
      for (let i = 0; i < fields.length; i++) {
        if (values[i] === undefined || !String(values[i]).trim()) continue;
        const value = String(values[i]).trim();
        profile[fields[i]] = value;
      }

      saveProfiles(profiles);
      await queueProfileSync(profile, message.guild.id);
      return message.channel.send(`✅ Đã cập nhật profile **${profile.name}** theo 8 dòng.`);
    }

    // ===== CHÈN / THÊM ẢNH PROFILE =====
    if (command === "addpic") {
      const attachments = getAttachments(message);
      if (!attachments.length) return message.channel.send("❌ Hãy đính kèm ít nhất 1 tệp ảnh.");

      let numberArg = null;
      let profileName = "";
      if (/^\d+$/.test(args[0] || "")) {
        numberArg = Number(args.shift());
        profileName = args.join(" ").trim();
      } else {
        profileName = args.join(" ").trim();
        if (/^\d+$/.test(args[args.length - 1] || "")) numberArg = Number(args.pop());
      }

      const profile = profileName ? findProfile(profileName) : findProfileByShownMessage(message);
      if (!profile) return message.channel.send("❌ Không xác định được profile. Reply vào tin nhắn profile rồi dùng `sar addpic <số>` hoặc dùng `sar addpic <profile> <số>`." );
      if (!canEditProfile(profile, message)) return message.channel.send("Bạn không có quyền sửa profile này.");
      if (!Number.isInteger(numberArg) || numberArg < 1 || numberArg > profile.images.length + 1) {
        return message.channel.send(`❌ Vị trí phải từ **1** đến **${profile.images.length + 1}**.`);
      }
      try {
        let insertAt = numberArg - 1;
        for (const attachment of attachments) {
          const stored = await saveAttachmentLocally(profile, "img", attachment);
          profile.images.splice(insertAt, 0, stored);
          insertAt++;
        }
        saveProfiles(profiles);
        await queueProfileSync(profile, message.guild.id);
        return message.channel.send(`✅ Đã chèn **${attachments.length}** ảnh vào vị trí **${numberArg}** của profile **${profile.name}**.`);
      } catch (error) {
        console.error("Chèn ảnh profile thất bại:", error);
        return message.channel.send("❌ Không thể lưu ảnh. Hãy thử upload lại.");
      }
    }

    // ===== THÊM ẢNH LỚN CHO PROFILE HOẶC ẢNH CHO TRIGGER =====
    // sar iurl "tên" — tự nhận diện: nếu là profile thì thêm ảnh lớn (nhiều ảnh),
    // nếu là trigger AutoRes thì thêm/thay ảnh embed cho trigger đó (1 ảnh).
    if (command === "iurl") {
      const targetName = args.join(" ").trim();
      if (!targetName) return message.channel.send(`❌ Dùng: \`sar iurl "profile hoặc trigger"\` + đính kèm ảnh.`);

      const profile = findProfile(targetName);
      if (profile) {
        if (!canEditProfile(profile, message)) return message.channel.send("Bạn không có quyền sửa profile này.");
        const attachments = getAttachments(message);
        if (!attachments.length) return message.channel.send(`❌ Hãy đính kèm ít nhất 1 ảnh: \`sar iurl "${profile.name}"\``);
        try {
          for (const attachment of attachments) {
            const stored = await saveAttachmentLocally(profile, "img", attachment);
            profile.images.push(stored);
          }
          saveProfiles(profiles);
          await queueProfileSync(profile, message.guild.id);
          return message.channel.send(`✅ Đã thêm **${attachments.length}** ảnh lớn cho profile **${profile.name}**. Tổng: **${profile.images.length}**.`);
        } catch (error) {
          console.error("Thêm ảnh lớn profile thất bại:", error);
          return message.channel.send("❌ Không thể lưu ảnh. Hãy thử upload lại.");
        }
      }

      const autoResRecord = findAutoRes(message.guild.id, targetName);
      if (autoResRecord) {
        if (!hasPRManagerRole(message)) return message.channel.send("⛔ Bạn không có quyền quản lý AutoRes. Cần PR Manager.");
        const attachments = getAttachments(message);
        if (!attachments.length) return message.channel.send(`❌ Hãy đính kèm 1 ảnh: \`sar iurl "${autoResRecord.trigger}"\``);
        try {
          const old = autoResRecord.embed.image;
          const stored = await saveAutoResAttachment(autoResRecord.trigger, "image", attachments[0]);
          autoResRecord.embed.image = stored;
          if (autoResRecord.type !== "embed") autoResRecord.type = "embed";
          removeLocalImage(old);
          saveAutoRes(autoRes);
          return message.channel.send(`✅ Đã cập nhật ảnh cho trigger **${autoResRecord.trigger}**.`);
        } catch (error) {
          console.error("Thêm ảnh trigger thất bại:", error);
          return message.channel.send("❌ Không thể lưu ảnh. Hãy thử upload lại.");
        }
      }

      return message.channel.send(`❌ Không tìm thấy profile hoặc trigger nào tên **${targetName}**.`);
    }

    // ===== TẠO PROFILE BẰNG sar add =====
    // sar add "profile" -> tạo profile.
    // sar a "trigger" | nội dung -> tạo AutoRes (kèm nội dung).
    // sar a "trigger" -> tạo riêng trigger, chưa có nội dung.
    if (command === "add") {
      if (!hasPRManagerRole(message)) {
        return message.channel.send("Bạn không có quyền tạo profile. Hãy là chủ profile hiện có hoặc được cấp role PR Manager.");
      }
      const name = args.join(" ").trim();
      if (!name) return message.channel.send(`Dùng: \`sar add "name"\``);
      const sameOwner = findProfilesByName(name).some(({ profile }) => profile.ownerId === message.author.id);
      if (sameOwner) return message.channel.send("Bạn đã có profile tên này rồi.");

      const key = nextProfileStorageKey(name, message.author.id);
      profiles[key] = {
        name, displayName: "", nickname: "", location: "", description: "",
        game: "", priceGame: "", priceSing: "", dealCam: "", avatar: "", images: [], ownerId: message.author.id,
        shownMessages: [], color: 0x5865f2, createdAt: Date.now(),
      };
      saveProfiles(profiles);
      const guildKeywords = getGuildPRKeywords(message.guild.id);
      const trigger = normalizeTrigger(name);
      if (trigger && !guildKeywords[trigger]) {
        guildKeywords[trigger] = name;
        savePRKeywords(prKeywords);
      }
      await queueProfileSync(profiles[key], message.guild.id);
      return message.channel.send(`✅ Đã tạo profile **${name}**.\n🔑 Trigger tự động: \`${trigger}\``);
    }

    // ===== AUTORES LỆNH MỚI =====
    if (command === "a" || command === "content") {
      if (!hasPRManagerRole(message)) return message.channel.send("⛔ Bạn không có quyền quản lý AutoRes. Cần PR Manager.");
      const pipe = raw.indexOf("|");
      const left = pipe >= 0 ? raw.slice(0, pipe).trim() : raw.trim();
      const right = pipe >= 0 ? raw.slice(pipe + 1).trim() : "";
      const parsed = parseArgs(left);
      const action = (parsed.shift() || "").toLowerCase();
      const trigger = parsed.join(" ").trim();
      if (!trigger) return message.channel.send(action === "a" ? 'Dùng: `sar a "tên trigger" | nội dung` hoặc `sar a "tên trigger"`' : 'Dùng: `sar content "tên trigger" | nội dung mới`');
      const key = normalizeTrigger(trigger);
      if (!key) return message.channel.send("❌ Tên trigger không hợp lệ.");
      const guildData = getGuildAutoRes(message.guild.id);
      if (action === "a") {
        if (guildData[key]) return message.channel.send("⚠️ Trigger này đã tồn tại.");
        guildData[key] = normalizeAutoResRecord({ trigger, type: "text", mode: "exact", enabled: true, content: right, embed: { title: "", description: "", color: 0x5865f2, thumbnail: "", image: "", footer: "" }, createdAt: Date.now(), createdBy: message.author.id });
        saveAutoRes(autoRes);
        return message.channel.send(`✅ Đã tạo trigger **${trigger}**${right ? " và thêm nội dung." : "."}`);
      }
      const record = findAutoRes(message.guild.id, trigger);
      if (!record) return message.channel.send(`❌ Không tìm thấy trigger **${trigger}**.`);
      if (action === "content") {
        if (!right) return message.channel.send('❌ Nội dung không được để trống. Dùng: `sar content "trigger" | nội dung mới`');
        record.content = right; record.type = "text"; saveAutoRes(autoRes);
        return message.channel.send(`✅ Đã sửa nội dung trigger **${record.trigger}**.`);
      }
    }

    if (command === "create") {
      if (!hasPRManagerRole(message)) {
        return message.channel.send("Bạn không có quyền tạo profile. Hãy là chủ profile hiện có hoặc được cấp role PR Manager.");
      }
      const name = args.join(" ").trim();
      if (!name) return message.channel.send(`Dùng: \`sar c "name"\``);

      const key = nextProfileStorageKey(name, message.author.id);
      const sameOwner = findProfilesByName(name).some(({ profile }) => profile.ownerId === message.author.id);
      if (sameOwner) return message.channel.send("Bạn đã có profile tên này rồi.");

      profiles[key] = {
        name,
        displayName: "",
        nickname: "",
        location: "",
        description: "",
        game: "",
        priceGame: "",
        priceSing: "",
        dealCam: "",
        avatar: "",
        images: [],
        ownerId: message.author.id,
        shownMessages: [],
        color: 0x5865f2,
        createdAt: Date.now(),
      };

      saveProfiles(profiles);
      // Tự tạo trigger theo đúng tên profile để người dùng chỉ cần nhắn tên profile.
      const guildKeywords = getGuildPRKeywords(message.guild.id);
      const trigger = normalizeTrigger(name);
      if (trigger && !guildKeywords[trigger]) {
        guildKeywords[trigger] = name;
        savePRKeywords(prKeywords);
      }
      await queueProfileSync(profiles[key], message.guild.id);
      return message.channel.send(`✅ Đã tạo profile **${name}**.\n🔑 Trigger tự động: \`${trigger}\``);
    }

    if (command === "color") {
      const name = args.shift();
      const value = (args.shift() || "").trim().toLowerCase();
      const profile = findProfile(name);
      if (!profile) return message.channel.send("Không tìm thấy profile.");
      if (!canEditProfile(profile, message)) {
        return message.channel.send("Bạn không có quyền sửa profile này.");
      }

      if (value === "reset") {
        profile.color = 0x5865f2;
        saveProfiles(profiles);
        await queueProfileSync(profile, message.guild.id);
        return message.channel.send(`✅ Đã reset màu của **${profile.name}**.`);
      }

      if (!/^#?[0-9a-f]{6}$/i.test(value)) {
        return message.channel.send('Dùng: `sar co "name" #ff69b4` hoặc `sar co "name" reset`');
      }

      profile.color = parseInt(value.replace("#", ""), 16);
      saveProfiles(profiles);
      await queueProfileSync(profile, message.guild.id);
      return message.channel.send(`🎨 Đã đổi màu của **${profile.name}** thành **#${value.replace("#", "").toUpperCase()}**.`);
    }

    if (command === "delete-des") {
      const name = args.join(" ").trim();
      const profile = findProfile(name);
      if (!profile) return message.channel.send("Không tìm thấy profile.");
      if (!canEditProfile(profile, message)) return message.channel.send("Bạn không có quyền sửa profile này.");

      profile.description = "";
      saveProfiles(profiles);
      await queueProfileSync(profile, message.guild.id);
      return message.channel.send(`🗑️ Đã xóa description của **${profile.name}**.`);
    }

    if (command === "delete") {
      const name = args.join(" ").trim();
      if (!name) return message.channel.send('Dùng: `sar del "tên profile/trigger"`');
      const autoRecord = findAutoRes(message.guild.id, name);
      if (autoRecord) {
        const guildData = getGuildAutoRes(message.guild.id);
        removeLocalImage(autoRecord.embed?.thumbnail); removeLocalImage(autoRecord.embed?.image);
        delete guildData[normalizeTrigger(autoRecord.trigger)]; saveAutoRes(autoRes);
        return message.channel.send(`🗑️ Đã xóa trigger **${autoRecord.trigger}**.`);
      }
      const profile = findProfile(name);
      if (!profile) return message.channel.send("Không tìm thấy profile hoặc trigger.");
      if (!canEditProfile(profile, message)) return message.channel.send("Bạn không có quyền sửa profile này.");
      removeLocalImage(profile.avatar); for (const image of profile.images) removeLocalImage(image);
      delete profiles[normalizeName(profile.name)]; saveProfiles(profiles);
      return message.channel.send(`🗑️ Đã xóa profile **${profile.name}**.`);
    }

    if (command === "show") {
      const prefix = args.join(" ").trim();
      if (!prefix) return message.channel.send('Dùng: `sar show <tên bắt đầu>`\nVí dụ: `sar show eth` → eth1, eth2, eth3');

      // Tìm tất cả profile có tên bắt đầu bằng chuỗi người dùng nhập.
      // Không phân biệt hoa/thường và vẫn hỗ trợ tên có dấu/khoảng trắng.
      const normalizedPrefix = normalizeName(prefix);
      const matches = Object.values(profiles)
        .filter(profile => normalizeName(profile.name || "").startsWith(normalizedPrefix))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "vi", { numeric: true, sensitivity: "base" }));

      if (!matches.length) return message.channel.send(`❌ Không tìm thấy profile bắt đầu bằng **${prefix}**.`);

      for (const profile of matches) {
        await sendKeywordProfile(message, profile);
      }
      return;
    }

    if (command === "list") {
      let arr = Object.values(profiles);
      arr.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "vi", { numeric: true, sensitivity: "base" }));
      if (!arr.length) {
        return message.channel.send("Chưa có profile nào.");
      }

      await message.channel.send(`📚 **Profiles: ${arr.length}**`);
      for (const profile of arr) {
        const media = profileFiles(profile, 0);
        const payload = profileV2Payload(profile, 0, media);
        if (!media.files.length) delete payload.files;
        const sent = await message.channel.send(payload);
        registerShownMessage(profile, sent, 0);
      }
      saveProfiles(profiles);
      return;
    }

    const fields = {
      name: "name",
      nick: "nickname",
      loc: "location",
      des: "description",
      game: "game",
      cam: "dealCam",
    };

    if (fields[command]) {
      const name = args.shift();
      const value = args.join(" ").trim();

      if (!name || !value) {
        return message.channel.send(`Dùng: \`sar ${command} "Juliet 2" nội dung\``);
      }

      const profile = findProfile(name);
      if (!profile) return message.channel.send("Không tìm thấy profile.");
      if (!canEditProfile(profile, message)) return message.channel.send("Bạn không có quyền sửa profile này.");

      if (command === "name") {
        // Chỉ đổi tên HIỂN THỊ. Tên profile/biến vẫn giữ nguyên.
        profile.displayName = value;
      } else {
        profile[fields[command]] = value;
      }

      saveProfiles(profiles);
      await queueProfileSync(profile, message.guild.id);

      return message.channel.send(`✅ Đã cập nhật **${command === "name" ? "tên hiển thị" : command}** cho profile **${profile.name}**.`);
    }

    if (command === "avt" || command === "img") {
      const name = args.join(" ").trim();
      const profile = findProfile(name);
      if (!profile) return message.channel.send("Không tìm thấy profile.");
      if (!canEditProfile(profile, message)) {
        return message.channel.send("Bạn không có quyền sửa profile này.");
      }

      const attachments = getAttachments(message);
      if (!attachments.length) {
        return message.channel.send(
          `Hãy đính kèm ảnh cùng lệnh: \`sar ${command} "${profile.name}"\``
        );
      }

      try {
        if (command === "avt") {
          const oldAvatar = profile.avatar;
          profile.avatar = await saveAttachmentLocally(
            profile,
            "avatar",
            attachments[0]
          );
          removeLocalImage(oldAvatar);

          saveProfiles(profiles);
          await queueProfileSync(profile, message.guild.id);
          return message.channel.send("✅ Đã cập nhật avatar.");
        }

        for (const attachment of attachments) {
          const stored = await saveAttachmentLocally(profile, "img", attachment);
          profile.images.push(stored);
        }

        saveProfiles(profiles);
        await queueProfileSync(profile, message.guild.id);
        return message.channel.send(
          `✅ Đã thêm **${attachments.length}** ảnh lớn. Tổng: **${profile.images.length}**.`
        );
      } catch (error) {
        console.error(error);
        return message.channel.send(
          "❌ Không thể lưu ảnh. Hãy thử upload lại hoặc kiểm tra kết nối Internet của máy chạy bot."
        );
      }
    }

    if (command === "remove-img") {
      let name;
      let numberArg;

      // Hỗ trợ: sar delpic "pr5" 2 / sar delpic 2 "pr5"
      // và: sar delpic all "pr5" / sar delpic "pr5" all
      if ((args[0] || "").toLowerCase() === "all") {
        args.shift();
        name = args.join(" ").trim();
        numberArg = "all";
      } else if ((args[args.length - 1] || "").toLowerCase() === "all") {
        numberArg = "all";
        args.pop();
        name = args.join(" ").trim();
      } else if (/^\d+$/.test(args[0] || "")) {
        numberArg = args.shift();
        name = args.join(" ").trim();
      } else {
        name = args.shift();
        numberArg = args.shift();
        if (args.length) name = [name, ...args].join(" ").trim();
      }

      const profile = findProfile(name);
      if (!profile) return message.channel.send("Không tìm thấy profile.");
      if (!canEditProfile(profile, message)) return message.channel.send("Bạn không có quyền sửa profile này.");

      if (String(numberArg).toLowerCase() === "all") {
        for (const image of profile.images) removeLocalImage(image);
        profile.images = [];
        saveProfiles(profiles);
        await queueProfileSync(profile, message.guild.id);
        return message.channel.send(`🗑️ Đã xóa toàn bộ ảnh của **${profile.name}**.`);
      }

      const number = Number(numberArg);
      if (!Number.isInteger(number) || number < 1 || number > profile.images.length) {
        return message.channel.send(`Số ảnh phải từ 1 đến ${profile.images.length}.`);
      }

      const removed = profile.images.splice(number - 1, 1)[0];
      removeLocalImage(removed);
      saveProfiles(profiles);
      await queueProfileSync(profile, message.guild.id);
      return message.channel.send(`🗑️ Đã xóa ảnh số ${number} của **${profile.name}**.`);
    }

    if (command === "clear-img") {
      const name = args.join(" ").trim();
      const profile = findProfile(name);
      if (!profile) return message.channel.send("Không tìm thấy profile.");
      if (!canEditProfile(profile, message)) return message.channel.send("Bạn không có quyền sửa profile này.");

      for (const image of profile.images) removeLocalImage(image);
      profile.images = [];
      saveProfiles(profiles);
      await queueProfileSync(profile, message.guild.id);
      return message.channel.send("🗑️ Đã xóa toàn bộ ảnh lớn.");
    }

    return message.channel.send(`Không hiểu lệnh \`${command}\`. Dùng \`sar help\`.`);
  } catch (error) {
    console.error(error);
    return message.channel.send("❌ Có lỗi xảy ra khi xử lý lệnh.");
  }
});

webServer.listen(WEB_PORT, "0.0.0.0", () => {
  console.log(`HTTP server đang lắng nghe cổng ${WEB_PORT}`);
});

setInterval(async () => {
  const now = Date.now(); let changed = false;
  for (const payment of Object.values(paymentData)) {
    if (payment.status === "pending" && payment.expiresAt && Date.parse(payment.expiresAt) <= now) {
      payment.status = "expired"; payment.expiredAt = new Date().toISOString(); changed = true; await updatePaymentMessage(payment);
    }
  }
  if (changed) savePayments(paymentData);
}, 60 * 1000).unref();

// Lớp an toàn bổ sung cho srole: quét định kỳ để gỡ mọi role tạm thời đã quá
// hạn mà vì lý do gì đó (lỗi khi schedule, restart giữa chừng...) chưa được
// timer chính xử lý.
setInterval(async () => {
  const now = Date.now();
  for (const entryId of Object.keys(tempRoleData)) {
    const entry = tempRoleData[entryId];
    if (entry && Date.parse(entry.expiresAt) <= now) {
      await removeExpiredTempRole(entryId);
    }
  }
}, 60 * 1000).unref();

client.login(TOKEN);