import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Telegraf, Markup } from "telegraf";
import { fileURLToPath } from "url";
import pg from "pg";
import { 
  Employee, 
  AttendanceRecord, 
  PenaltyRecord, 
  Settings, 
  DashboardStats 
} from "./src/types.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

// express.json() applied selectively below — NOT on the webhook path

// GMT+5 Uzbekistan time helper
function nowUZ(): Date {
  return new Date(Date.now() + 5 * 60 * 60 * 1000);
}

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com") || process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

// Initialize database tables
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS penalties (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY DEFAULT 'main',
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      telegram_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  // Insert default settings if not present
  const s = await pool.query("SELECT id FROM settings WHERE id = 'main'");
  if (s.rowCount === 0) {
    const defaultSettings: Settings = {
      adminIds: ["5624377303", "5523761749"],
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
      summerRate: 6500,
      summerOvertimeRate: 7500,
      winterRate: 6500,
      winterOvertimeRate: 7500,
      latenessPenaltyPerMinute: 1000
    };
    await pool.query("INSERT INTO settings (id, data) VALUES ('main', $1)", [defaultSettings]);
  } else if (process.env.TELEGRAM_BOT_TOKEN) {
    // Sync env token into DB on startup
    await pool.query(
      "UPDATE settings SET data = data || $1 WHERE id = 'main'",
      [JSON.stringify({ botToken: process.env.TELEGRAM_BOT_TOKEN })]
    );
  }

  console.log("Database initialized successfully.");
}

// DB helper functions
async function getEmployees(): Promise<Employee[]> {
  const r = await pool.query("SELECT data FROM employees ORDER BY (data->>'createdAt')::bigint ASC");
  return r.rows.map(row => row.data as Employee);
}

async function saveEmployee(emp: Employee) {
  await pool.query(
    "INSERT INTO employees (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2",
    [emp.id, emp]
  );
}

async function deleteEmployee(id: string) {
  await pool.query("DELETE FROM employees WHERE id = $1", [id]);
  await pool.query("DELETE FROM attendance WHERE data->>'employeeId' = $1", [id]);
  await pool.query("DELETE FROM penalties WHERE data->>'employeeId' = $1", [id]);
}

async function getAttendance(): Promise<AttendanceRecord[]> {
  const r = await pool.query("SELECT data FROM attendance ORDER BY data->>'date' DESC");
  return r.rows.map(row => row.data as AttendanceRecord);
}

async function saveAttendance(rec: AttendanceRecord) {
  await pool.query(
    "INSERT INTO attendance (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2",
    [rec.id, rec]
  );
}

async function getPenalties(): Promise<PenaltyRecord[]> {
  const r = await pool.query("SELECT data FROM penalties ORDER BY (data->>'timestamp')::bigint DESC");
  return r.rows.map(row => row.data as PenaltyRecord);
}

async function savePenalty(p: PenaltyRecord) {
  await pool.query(
    "INSERT INTO penalties (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2",
    [p.id, p]
  );
}

async function updatePenalty(p: PenaltyRecord) {
  await pool.query("UPDATE penalties SET data = $1 WHERE id = $2", [p, p.id]);
}

async function getSettings(): Promise<Settings> {
  const r = await pool.query("SELECT data FROM settings WHERE id = 'main'");
  return r.rows[0].data as Settings;
}

async function saveSettings(s: Settings) {
  await pool.query(
    "INSERT INTO settings (id, data) VALUES ('main', $1) ON CONFLICT (id) DO UPDATE SET data = $1",
    [s]
  );
}

// ---- DB-backed session helpers (replaces in-memory userSession) ----
async function setSession(telegramId: string, state: string) {
  await pool.query(
    "INSERT INTO user_sessions (telegram_id, state, updated_at) VALUES ($1, $2, $3) ON CONFLICT (telegram_id) DO UPDATE SET state = $2, updated_at = $3",
    [telegramId, state, Date.now()]
  );
}

async function getSession(telegramId: string): Promise<string | null> {
  const r = await pool.query("SELECT state FROM user_sessions WHERE telegram_id = $1", [telegramId]);
  return r.rows[0]?.state || null;
}

async function clearSession(telegramId: string) {
  await pool.query("DELETE FROM user_sessions WHERE telegram_id = $1", [telegramId]);
}

function isAdminUser(userId: string | undefined, username: string | undefined, settings: Settings): boolean {
  if (!userId) return false;
  const hardcoded = ["5624377303", "5523761749"];
  if (hardcoded.includes(userId)) return true;
  if (settings.adminIds?.includes(userId)) return true;
  if (username && settings.adminIds?.includes(username)) return true;
  return false;
}

// ----------------------------------------------------
// TELEGRAM BOT
// ----------------------------------------------------
let activeBot: Telegraf | null = null;
let botStatus: "Online" | "Offline" | "Error" = "Offline";
let botErrorDetails = "";
let botInfo: { username?: string; first_name?: string } | null = null;

async function startTelegramBot(token: string) {
  if (activeBot) {
    try { await activeBot.stop(); } catch {}
    activeBot = null;
  }

  if (!token?.trim()) {
    botStatus = "Offline";
    botErrorDetails = "Bot Token kiritilmagan.";
    botInfo = null;
    return;
  }

  try {
    console.log(`Starting Telegram Bot with token [${token.substring(0, 8)}...]`);
    const bot = new Telegraf(token);
    const me = await bot.telegram.getMe();
    botInfo = { username: me.username, first_name: me.first_name };
    console.log(`Bot connected: @${me.username}`);

    bot.start(async (ctx) => {
      const tId = ctx.from.id.toString();
      const settings = await getSettings();

      if (isAdminUser(tId, ctx.from.username, settings)) {
        return ctx.replyWithHTML(
          `👋 Assalomu alaykum, <b>Admin</b>! Admin panelga xush kelibsiz.\n\nQuyidagi tugmalar orqali boshqaruvni amalga oshiring:`,
          Markup.inlineKeyboard([
            [Markup.button.callback("📊 Bugungi davomat hisobi", "admin_today_attendance")],
            [Markup.button.callback("📈 STATISTIKA - Xodimlar maoshi", "admin_overall_stats")],
            [Markup.button.callback("📋 Xodimlar ro'yxati & boshqaruv", "admin_employees_list")],
            [Markup.button.callback("➕ Xodim qo'shish", "admin_add_employee_hint")],
            [Markup.button.callback("🧹 Jarimani tozalash", "admin_clear_penalties")],
            [Markup.button.callback("🔄 Menyuni yangilash", "admin_refresh_menu")]
          ])
        );
      }

      const employees = await getEmployees();
      const matched = employees.find(e =>
        e.telegramId === tId ||
        e.telegramUsername?.toLowerCase() === ctx.from.username?.toLowerCase()
      );

      if (matched) {
        if (!matched.telegramId) matched.telegramId = tId;
        if (ctx.from.username) matched.telegramUsername = ctx.from.username;
        await saveEmployee(matched);

        return ctx.replyWithHTML(
          `Assalomu alaykum, <b>${matched.name}</b>! 👋\n\nIsh tartibingiz: <b>${matched.startTime} - ${matched.endTime}</b>\n\nKelish yoki ketish uchun tugma bosing va <b>Circular Video yoki selfi</b> yuboring!`,
          {
            reply_markup: {
              keyboard: [
                [{ text: "📥 Keldim (Check-In)" }, { text: "📤 Ketdim (Check-Out)" }],
                [{ text: "👤 Mening Profilim" }, { text: "ℹ️ Maosh va Tariflar" }]
              ],
              resize_keyboard: true
            }
          }
        );
      } else {
        return ctx.replyWithHTML(
          `Assalomu alaykum! 🖐\n\nTizimda sizning Telegram IDingiz (<code>${tId}</code>) topilmadi.\nAdmin panelda profilingiz qo'shilgandan so'ng, qayta /start bosing.`
        );
      }
    });

    bot.action("admin_today_attendance", async (ctx) => {
      try {
        const todayStr = nowUZ().toISOString().split("T")[0];
        const attendance = await getAttendance();
        const employees = await getEmployees();
        const todayAtt = attendance.filter(a => a.date === todayStr);

        let msg = `📊 <b>Bugungi davomat (${todayStr}):</b>\n\n`;
        if (todayAtt.length === 0) {
          msg += "Bugun hali hech kim kelmagan 🤷‍♂️";
        } else {
          todayAtt.forEach((att, idx) => {
            const emp = employees.find(e => e.id === att.employeeId);
            const name = emp ? emp.name : att.name;
            const inTime = att.checkIn ? new Date((att.checkIn + 5 * 3600) * 1000).toISOString().substring(11, 16) : "--:--";
            const outTime = att.checkOut ? new Date((att.checkOut + 5 * 3600) * 1000).toISOString().substring(11, 16) : "--:--";
            const late = att.latenessMinutes > 0 ? ` (⏱ ${att.latenessMinutes} daq kechikish)` : "";
            const smena = att.smenaNumber ? ` [Smena ${att.smenaNumber}]` : "";
            msg += `${idx + 1}. <b>${name}</b>${smena}:\n📥 ${inTime}${late}  📤 ${outTime}\n\n`;
          });
        }
        await ctx.answerCbQuery();
        await ctx.replyWithHTML(msg);
      } catch (err) { console.error(err); }
    });

    bot.action("admin_employees_list", async (ctx) => {
      try {
        const employees = await getEmployees();
        let msg = `📋 <b>Xodimlar ro'yxati:</b>\n\n`;
        if (employees.length === 0) {
          msg += "Hech qanday xodim topilmadi.";
          await ctx.answerCbQuery();
          return ctx.replyWithHTML(msg);
        }
        employees.forEach((emp, idx) => {
          const shift2 = emp.startTime2 ? ` & ${emp.startTime2}-${emp.endTime2}` : "";
          msg += `${idx + 1}. <b>${emp.name}</b>\n   ID: <code>${emp.telegramId || "Yo'q"}</code>\n   Vaqt: <b>${emp.startTime}-${emp.endTime}${shift2}</b>\n   Holat: ${emp.approved ? "✅" : "⏳"}\n\n`;
        });
        const deleteButtons = employees.map(emp => [
          Markup.button.callback(`❌ O'chirish: ${emp.name}`, `admin_delete_${emp.id}`)
        ]);
        await ctx.answerCbQuery();
        await ctx.replyWithHTML(msg, Markup.inlineKeyboard(deleteButtons));
      } catch (err) { console.error(err); }
    });

    bot.action(/^admin_delete_(.+)$/, async (ctx) => {
      try {
        const tId = ctx.from.id.toString();
        const settings = await getSettings();
        if (!isAdminUser(tId, ctx.from.username, settings)) {
          return ctx.answerCbQuery("Ruxsat yo'q! ⚠️");
        }
        const employeeId = (ctx.match as RegExpExecArray)[1];
        const employees = await getEmployees();
        const emp = employees.find(e => e.id === employeeId);
        if (!emp) return ctx.answerCbQuery("Topilmadi!");
        await deleteEmployee(employeeId);
        await ctx.answerCbQuery(`${emp.name} o'chirildi!`);
        await ctx.replyWithHTML(`❌ <b>${emp.name}</b> o'chirildi!`);
      } catch (err) { console.error(err); }
    });

    bot.action("admin_add_employee_hint", async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.replyWithHTML(
        `➕ <b>Xodim qo'shish:</b>\n\n` +
        `<code>/add &lt;telegram_id&gt; &lt;Ism&gt; &lt;Familiya&gt; &lt;boshlanish&gt; &lt;tugash&gt; [boshlanish2 tugash2]</code>\n\n` +
        `Misol:\n<code>/add 123456789 ESHMAT TOSHMATOV 09:00 18:00</code>`
      );
    });

    bot.action("admin_clear_penalties", async (ctx) => {
      try {
        const penalties = await getPenalties();
        const active = penalties.filter(p => !p.cleared);
        if (active.length === 0) {
          await ctx.answerCbQuery("Faol jarimalar yo'q!");
          return ctx.reply("🧹 Faol jarimalar mavjud emas.");
        }
        for (const p of active) {
          p.cleared = true;
          await updatePenalty(p);
        }
        await ctx.answerCbQuery("Tozalandi!");
        await ctx.reply("🧹 Barcha jarimalar tozalandi!");
      } catch (err) { console.error(err); }
    });

    bot.action("admin_overall_stats", async (ctx) => {
      try {
        const thisMonthStr = nowUZ().toISOString().substring(0, 7);
        const employees = await getEmployees();
        const attendance = await getAttendance();
        const penalties = await getPenalties();

        let msg = `📈 <b>Oylik hisobot (${thisMonthStr}):</b>\n\n`;
        if (employees.length === 0) {
          msg += "Xodimlar yo'q.";
        } else {
          for (const [idx, emp] of employees.entries()) {
            const empAtt = attendance.filter(a => a.employeeId === emp.id && a.date.startsWith(thisMonthStr));
            const empPen = penalties.filter(p => p.employeeId === emp.id && p.date.startsWith(thisMonthStr) && !p.cleared);
            const workedHours = Number((empAtt.reduce((s, a) => s + (a.workedMinutes || 0), 0) / 60).toFixed(1));
            const totalBase = empAtt.reduce((s, a) => s + (a.baseSalary || 0), 0);
            const totalOt = empAtt.reduce((s, a) => s + (a.overtimeSalary || 0), 0);
            const totalPen = empPen.reduce((s, p) => s + p.amount, 0);
            const totalNet = empAtt.reduce((s, a) => s + (a.finalSalary || 0), 0);
            msg += `👤 <b>${idx + 1}. ${emp.name}</b>\n📅 ${empAtt.length} kun | ⏳ ${workedHours} soat\n💵 Asosiy: ${totalBase.toLocaleString()} | ➕ OT: ${totalOt.toLocaleString()} | ➖ Jarima: ${totalPen.toLocaleString()}\n💰 Sof: <b>${totalNet.toLocaleString()} UZS</b>\n\n`;
          }
        }
        await ctx.answerCbQuery();
        await ctx.replyWithHTML(msg);
      } catch (err) { console.error(err); }
    });

    bot.action("admin_refresh_menu", async (ctx) => {
      await ctx.answerCbQuery("Yangilandi!");
      await ctx.replyWithHTML(
        `🔄 <b>Asosiy menyu:</b>`,
        Markup.inlineKeyboard([
          [Markup.button.callback("📊 Bugungi davomat hisobi", "admin_today_attendance")],
          [Markup.button.callback("📈 STATISTIKA - Xodimlar maoshi", "admin_overall_stats")],
          [Markup.button.callback("📋 Xodimlar ro'yxati & boshqaruv", "admin_employees_list")],
          [Markup.button.callback("➕ Xodim qo'shish", "admin_add_employee_hint")],
          [Markup.button.callback("🧹 Jarimani tozalash", "admin_clear_penalties")],
          [Markup.button.callback("🔄 Menyuni yangilash", "admin_refresh_menu")]
        ])
      );
    });

    bot.command("clear", async (ctx) => {
      const tId = ctx.from.id.toString();
      const settings = await getSettings();
      if (!isAdminUser(tId, ctx.from.username, settings)) {
        return ctx.reply("Ruxsat yo'q!");
      }
      await pool.query("DELETE FROM employees");
      await pool.query("DELETE FROM attendance");
      await pool.query("DELETE FROM penalties");
      await pool.query("DELETE FROM user_sessions");
      return ctx.reply("🧹 Barcha ma'lumotlar tozalandi!");
    });

    bot.command("add", async (ctx) => {
      const tId = ctx.from.id.toString();
      const settings = await getSettings();
      if (!isAdminUser(tId, ctx.from.username, settings)) {
        return ctx.reply("Ruxsat yo'q!");
      }

      const argsText = ctx.message.text.substring(5).trim();
      const parts = argsText.split(/\s+/);
      if (parts.length < 5) {
        return ctx.replyWithHTML(
          `⚠️ Format:\n<code>/add &lt;telegram_id&gt; &lt;Ism&gt; &lt;Familiya&gt; &lt;boshlanish&gt; &lt;tugash&gt;</code>\n\nMisol:\n<code>/add 123456789 ESHMAT TOSHMATOV 09:00 18:00</code>`
        );
      }

      const [employeeTelegramId, firstName, lastName, startTime1, endTime1, startTime2, endTime2] = parts;
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(startTime1) || !timeRegex.test(endTime1)) {
        return ctx.reply(`⚠️ Noto'g'ri vaqt formati: '${startTime1}' yoki '${endTime1}'`);
      }

      const employees = await getEmployees();
      const existing = employees.find(e => e.telegramId === employeeTelegramId);
      if (existing) return ctx.reply(`⚠️ Bu ID allaqachon mavjud: ${existing.name}`);

      const newEmp: Employee = {
        id: `emp_${Date.now()}`,
        name: `${firstName} ${lastName}`,
        telegramId: employeeTelegramId,
        telegramUsername: null,
        startTime: startTime1,
        endTime: endTime1,
        startTime2: startTime2 || undefined,
        endTime2: endTime2 || undefined,
        createdAt: Date.now(),
        salaryRateType: "hourly",
        baseSalaryRate: 6500,
        approved: true
      };

      await saveEmployee(newEmp);
      return ctx.replyWithHTML(`🎉 <b>${newEmp.name}</b> qo'shildi!\n🆔 <code>${employeeTelegramId}</code>\n⏰ ${startTime1} - ${endTime1}`);
    });

    bot.hears("ℹ️ Maosh va Tariflar", async (ctx) => {
      const s = await getSettings();
      ctx.replyWithHTML(
        `📋 <b>Joriy tariflar:</b>\n\n` +
        `☀️ Yozgi: <b>${s.summerRate.toLocaleString()} UZS/soat</b> (OT: ${s.summerOvertimeRate.toLocaleString()})\n` +
        `❄️ Qishki: <b>${s.winterRate.toLocaleString()} UZS/soat</b> (OT: ${s.winterOvertimeRate.toLocaleString()})\n` +
        `⚠️ Kechikish jarima: <b>${s.latenessPenaltyPerMinute.toLocaleString()} UZS/daqiqa</b>`
      );
    });

    bot.hears("👤 Mening Profilim", async (ctx) => {
      const tId = ctx.from.id.toString();
      const employees = await getEmployees();
      const emp = employees.find(e => e.telegramId === tId);
      if (!emp) return ctx.reply("Siz ro'yxatdan o'tmagansiz!");

      const monthStr = nowUZ().toISOString().substring(0, 7);
      const attendance = await getAttendance();
      const penalties = await getPenalties();
      const myAtt = attendance.filter(a => a.employeeId === emp.id && a.date.startsWith(monthStr));
      const myPen = penalties.filter(p => p.employeeId === emp.id && p.date.startsWith(monthStr));
      const penSum = myPen.reduce((s, p) => s + p.amount, 0);
      const earned = myAtt.reduce((s, a) => s + (a.finalSalary || 0), 0);

      ctx.replyWithHTML(
        `👤 <b>${emp.name}</b>\n📅 ${emp.startTime} - ${emp.endTime}\n💵 ${(emp.baseSalaryRate || 6500).toLocaleString()} UZS/soat\n\n` +
        `📊 <b>${monthStr}:</b>\n✅ ${myAtt.length} kun | ➖ Jarima: ${penSum.toLocaleString()} UZS\n💸 Ishlab topilgan: <b>${earned.toLocaleString()} UZS</b>`
      );
    });

    // ---- Check-In / Check-Out — now uses DB sessions ----
    bot.hears("📥 Keldim (Check-In)", async (ctx) => {
      await setSession(ctx.from.id.toString(), "waiting_for_checkin_media");
      ctx.reply("Circular video yoki rasm yuboring! 📸");
    });

    bot.hears("📤 Ketdim (Check-Out)", async (ctx) => {
      await setSession(ctx.from.id.toString(), "waiting_for_checkout_media");
      ctx.reply("Circular video yoki rasm yuboring! 📸");
    });

    bot.on(["video_note", "photo"], async (ctx) => {
      const tId = ctx.from.id.toString();
      const session = await getSession(tId);
      if (!session) return ctx.reply("Avval '📥 Keldim' yoki '📤 Ketdim' tugmasini bosing!");

      const employees = await getEmployees();
      const emp = employees.find(e => e.telegramId === tId);
      if (!emp) return ctx.reply("Siz tizimga ruxsat etilmagansiz.");

      let fileId = "";
      let isVideoNote = false;
      if ("video_note" in ctx.message && ctx.message.video_note) {
        fileId = ctx.message.video_note.file_id;
        isVideoNote = true;
      } else if ("photo" in ctx.message && ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      }

      const settings = await getSettings();
      const todayStr = nowUZ().toISOString().split("T")[0];
      const attendance = await getAttendance();

      const recordKeyShift1 = `${emp.id}_${todayStr}_1`;
      const recordKeyShift2 = `${emp.id}_${todayStr}_2`;
      const legacyKey = `${emp.id}_${todayStr}`;

      const r1 = attendance.find(a => a.id === recordKeyShift1);
      const r2 = attendance.find(a => a.id === recordKeyShift2);
      const rLegacy = attendance.find(a => a.id === legacyKey);

      if (session === "waiting_for_checkin_media") {
        const ongoing = attendance.find(a => a.employeeId === emp.id && a.date === todayStr && !a.isCompleted);
        if (ongoing) {
          await clearSession(tId);
          return ctx.reply("Siz allaqachon Check-In qilgansiz! Avval Check-Out qiling.");
        }

        let targetKey = "";
        let smenaNumber = 1;

        if (!r1 && !rLegacy) {
          targetKey = recordKeyShift1;
          smenaNumber = 1;
        } else if (emp.startTime2 && emp.endTime2 && !r2) {
          targetKey = recordKeyShift2;
          smenaNumber = 2;
        } else {
          await clearSession(tId);
          return ctx.reply("Bugungi barcha smenalar yakunlangan! 🚀");
        }

        const now = nowUZ();
        const checkInTimeSec = Math.floor((now.getTime() - 5 * 3600 * 1000) / 1000);
        const sTime = smenaNumber === 2 && emp.startTime2 ? emp.startTime2 : emp.startTime;
        const [sh, sm] = sTime.split(":").map(Number);
        const scheduled = new Date(now);
        scheduled.setUTCHours(sh, sm, 0, 0);

        let latenessMinutes = 0;
        let penaltyAmount = 0;
        if (now.getTime() > scheduled.getTime()) {
          latenessMinutes = Math.floor((now.getTime() - scheduled.getTime()) / 60000);
          penaltyAmount = latenessMinutes * settings.latenessPenaltyPerMinute;
        }

        const newRecord: AttendanceRecord = {
          id: targetKey,
          employeeId: emp.id,
          name: emp.name,
          date: todayStr,
          checkIn: checkInTimeSec,
          checkOut: null,
          checkInVideoId: fileId,
          checkOutVideoId: null,
          workedMinutes: 0,
          latenessMinutes,
          penaltyAmount,
          baseSalary: 0,
          overtimeSalary: 0,
          finalSalary: 0,
          isCompleted: false,
          smenaNumber
        };

        await saveAttendance(newRecord);

        if (latenessMinutes > 0) {
          await savePenalty({
            id: `p_late_${Date.now()}`,
            employeeId: emp.id,
            date: todayStr,
            minutesLate: latenessMinutes,
            amount: penaltyAmount,
            description: `${smenaNumber}-smenaga ${latenessMinutes} daqiqa kechikdi (${now.toISOString().substring(11, 16)})`,
            timestamp: Date.now(),
            cleared: false
          });
        }

        if (isVideoNote) {
          const admins = [...new Set(["5624377303", "5523761749", ...(settings.adminIds || [])])];
          for (const admin of admins) {
            if (/^\d+$/.test(admin) && admin !== tId) {
              try {
                await ctx.telegram.forwardMessage(admin, ctx.chat.id, ctx.message.message_id);
                await ctx.telegram.sendMessage(admin,
                  `📹 <b>Check-In video:</b>\n👤 ${emp.name}\n📅 ${todayStr} | Smena ${smenaNumber}`, { parse_mode: "HTML" });
              } catch {}
            }
          }
        }

        await clearSession(tId);
        const timeStr = now.toISOString().substring(11, 16);
        let reply = `✅ ${smenaNumber}-smena Check-In qayd etildi!\n⏰ <b>${timeStr}</b>\n`;
        if (latenessMinutes > 0) {
          reply += `⚠️ Kechikish: <b>${latenessMinutes} daqiqa</b>\n💸 Jarima: <b>${penaltyAmount.toLocaleString()} UZS</b>`;
        } else {
          reply += `🎉 Vaqtida! Baraka toping!`;
        }
        return ctx.replyWithHTML(reply);

      } else if (session === "waiting_for_checkout_media") {
        const ongoing = attendance.find(a => a.employeeId === emp.id && a.date === todayStr && !a.isCompleted);
        if (!ongoing) {
          await clearSession(tId);
          return ctx.reply("Avval '📥 Keldim' belgilang!");
        }

        const now = nowUZ();
        const checkOutTimeSec = Math.floor((now.getTime() - 5 * 3600 * 1000) / 1000);
        const workedMinutes = Math.floor((checkOutTimeSec - ongoing.checkIn!) / 60);
        const smenaNumber = ongoing.smenaNumber || 1;

        const uzMonth = now.getUTCMonth() + 1;
        const isWinter = [11, 12, 1, 2, 3].includes(uzMonth);
        const stdHours = isWinter ? 9 : 10;
        const normalRate = isWinter ? settings.winterRate : settings.summerRate;
        const otRate = isWinter ? settings.winterOvertimeRate : settings.summerOvertimeRate;
        const totalHours = workedMinutes / 60;

        let baseEarned = 0, otEarned = 0;
        if (totalHours > stdHours) {
          baseEarned = stdHours * normalRate;
          otEarned = (totalHours - stdHours) * otRate;
        } else {
          baseEarned = totalHours * normalRate;
        }

        ongoing.checkOut = checkOutTimeSec;
        ongoing.checkOutVideoId = fileId;
        ongoing.workedMinutes = workedMinutes;
        ongoing.baseSalary = Math.round(baseEarned);
        ongoing.overtimeSalary = Math.round(otEarned);
        ongoing.finalSalary = Math.max(0, ongoing.baseSalary + ongoing.overtimeSalary - ongoing.penaltyAmount);
        ongoing.isCompleted = true;

        await saveAttendance(ongoing);

        if (isVideoNote) {
          const admins = [...new Set(["5624377303", "5523761749", ...(settings.adminIds || [])])];
          for (const admin of admins) {
            if (/^\d+$/.test(admin) && admin !== tId) {
              try {
                await ctx.telegram.forwardMessage(admin, ctx.chat.id, ctx.message.message_id);
                await ctx.telegram.sendMessage(admin,
                  `📹 <b>Check-Out video:</b>\n👤 ${emp.name}\n📅 ${todayStr} | Smena ${smenaNumber}`, { parse_mode: "HTML" });
              } catch {}
            }
          }
        }

        await clearSession(tId);
        const timeStr = now.toISOString().substring(11, 16);
        const wH = Math.floor(workedMinutes / 60), wM = workedMinutes % 60;
        const monthStr = now.toISOString().substring(0, 7);
        const allAtt = await getAttendance();
        const myMonthAtt = allAtt.filter(a => a.employeeId === emp.id && a.date.startsWith(monthStr));

        return ctx.replyWithHTML(
          `✅ <b>${smenaNumber}-smena Check-Out!</b> 👋\n\n` +
          `⏰ Ketish: <b>${timeStr}</b>\n` +
          `⏳ Ishlagan: <b>${wH} soat ${wM} daqiqa</b>\n` +
          `💵 Asosiy: <b>${ongoing.baseSalary.toLocaleString()} UZS</b>\n` +
          `➕ OT: <b>${ongoing.overtimeSalary.toLocaleString()} UZS</b>\n` +
          `➖ Jarima: <b>${ongoing.penaltyAmount.toLocaleString()} UZS</b>\n` +
          `💰 Bugungi sof: <b>${ongoing.finalSalary.toLocaleString()} UZS</b>\n\n` +
          `📊 <b>${monthStr} oylik:</b>\n` +
          `📅 ${myMonthAtt.length} kun | 💸 Jami sof: <b>${myMonthAtt.reduce((s, a) => s + (a.finalSalary || 0), 0).toLocaleString()} UZS</b>`
        );
      }
    });

    bot.catch((err) => { console.error("Bot error:", err); });

    // ---- WEBHOOK (production) vs long-poll (local dev) ----
    const host = process.env.RENDER_EXTERNAL_HOSTNAME;
    if (host) {
      const webhookPath = `/webhook/${token}`;
      const webhookUrl = `https://${host}${webhookPath}`;
      await bot.telegram.setWebhook(webhookUrl);
      // MUST be registered BEFORE express.json() so Telegraf gets the raw body
      app.use(webhookPath, bot.webhookCallback(webhookPath));
      // Now add express.json() for all other API routes
      app.use(express.json());
      console.log(`Webhook set: ${webhookUrl}`);
    } else {
      // Local development — use long polling
      await bot.telegram.deleteWebhook();
      app.use(express.json()); // safe to add before launch in polling mode
      bot.launch();
      console.log("Bot launched in polling mode (local dev).");
    }

    activeBot = bot;
    botStatus = "Online";
    botErrorDetails = "";
    console.log("Bot ready!");
  } catch (error: any) {
    console.error("Failed to start bot:", error);
    botStatus = "Offline";
    botErrorDetails = error.message || "Ulanish xatosi.";
    botInfo = null;
  }
}

// ----------------------------------------------------
// REST API ROUTES
// ----------------------------------------------------

app.get("/api/stats", async (req, res) => {
  try {
    const todayStr = nowUZ().toISOString().split("T")[0];
    const thisMonthStr = todayStr.substring(0, 7);
    const [employees, attendance, penalties] = await Promise.all([getEmployees(), getAttendance(), getPenalties()]);

    res.json({
      dashboard: {
        totalEmployees: employees.length,
        todayActiveCount: attendance.filter(a => a.date === todayStr && a.checkIn).length,
        totalPenaltiesThisMonth: penalties.filter(p => p.date.startsWith(thisMonthStr)).reduce((s, p) => s + p.amount, 0),
        totalWagesThisMonth: attendance.filter(a => a.date.startsWith(thisMonthStr)).reduce((s, a) => s + (a.finalSalary || 0), 0),
        latenessWarningCountToday: attendance.filter(a => a.date === todayStr && a.latenessMinutes > 5).length
      } as DashboardStats,
      bot: { status: botStatus, error: botErrorDetails, info: botInfo }
    });
  } catch (err) { res.status(500).json({ error: "DB error" }); }
});

app.get("/api/employees", async (req, res) => {
  try { res.json(await getEmployees()); } catch { res.status(500).json({ error: "DB error" }); }
});

app.post("/api/employees", async (req, res) => {
  try {
    const input = req.body as Partial<Employee>;
    if (!input.name || !input.startTime || !input.endTime || !input.baseSalaryRate) {
      return res.status(400).json({ error: "Majburiy maydonlar to'ldirilmagan!" });
    }
    const payload: Employee = {
      id: input.id || `emp_${Date.now()}`,
      name: input.name,
      telegramId: input.telegramId || null,
      telegramUsername: input.telegramUsername?.replace("@", "") || null,
      startTime: input.startTime,
      endTime: input.endTime,
      createdAt: input.createdAt || Date.now(),
      salaryRateType: input.salaryRateType || "hourly",
      baseSalaryRate: Number(input.baseSalaryRate || 6500),
      approved: input.approved !== undefined ? input.approved : true
    };
    await saveEmployee(payload);
    res.json(payload);
  } catch { res.status(500).json({ error: "DB error" }); }
});

app.delete("/api/employees/:id", async (req, res) => {
  try { await deleteEmployee(req.params.id); res.json({ success: true }); }
  catch { res.status(500).json({ error: "DB error" }); }
});

app.get("/api/attendance", async (req, res) => {
  try { res.json(await getAttendance()); } catch { res.status(500).json({ error: "DB error" }); }
});

app.post("/api/attendance/manual", async (req, res) => {
  try {
    const input = req.body;
    if (!input.employeeId || !input.date || !input.checkIn) {
      return res.status(400).json({ error: "Xodim, sana va kirish vaqti majburiy!" });
    }
    const employees = await getEmployees();
    const emp = employees.find(e => e.id === input.employeeId);
    if (!emp) return res.status(404).json({ error: "Xodim topilmadi!" });

    const dateBase = new Date(input.date);
    const [inH, inM] = input.checkIn.split(":").map(Number);
    const checkInSec = Math.floor(new Date(dateBase.setHours(inH, inM, 0)).getTime() / 1000);

    let checkOutSec: number | null = null;
    let workedMinutes = 0;
    if (input.checkOut) {
      const [outH, outM] = input.checkOut.split(":").map(Number);
      checkOutSec = Math.floor(new Date(new Date(input.date).setHours(outH, outM, 0)) / 1000);
      workedMinutes = Math.floor((checkOutSec - checkInSec) / 60);
    }

    const [startH, startM] = emp.startTime.split(":").map(Number);
    const scheduledSec = Math.floor(new Date(new Date(input.date).setHours(startH, startM, 0)) / 1000);
    const latenessMinutes = checkInSec > scheduledSec ? Math.floor((checkInSec - scheduledSec) / 60) : 0;
    const settings = await getSettings();
    const penaltyAmount = latenessMinutes * settings.latenessPenaltyPerMinute;

    const isWinter = [11, 12, 1, 2, 3].includes(new Date(input.date).getMonth() + 1);
    const stdH = isWinter ? 9 : 10;
    const normalRate = isWinter ? settings.winterRate : settings.summerRate;
    const otRate = isWinter ? settings.winterOvertimeRate : settings.summerOvertimeRate;
    const totalH = workedMinutes / 60;
    let baseSalary = 0, overtimeSalary = 0;
    if (totalH > stdH) { baseSalary = stdH * normalRate; overtimeSalary = (totalH - stdH) * otRate; }
    else { baseSalary = totalH * normalRate; }

    const payload: AttendanceRecord = {
      id: `${input.employeeId}_${input.date}`,
      employeeId: emp.id, name: emp.name, date: input.date,
      checkIn: checkInSec, checkOut: checkOutSec,
      checkInVideoId: input.checkInVideoId || null, checkOutVideoId: input.checkOutVideoId || null,
      workedMinutes, latenessMinutes, penaltyAmount,
      baseSalary: Math.round(baseSalary), overtimeSalary: Math.round(overtimeSalary),
      finalSalary: Math.round(Math.max(0, baseSalary + overtimeSalary - penaltyAmount)),
      isCompleted: !!checkOutSec, notes: input.notes || "Admin orqali kiritildi"
    };

    await saveAttendance(payload);
    res.json(payload);
  } catch (err) { console.error(err); res.status(500).json({ error: "DB error" }); }
});

app.get("/api/penalties", async (req, res) => {
  try { res.json(await getPenalties()); } catch { res.status(500).json({ error: "DB error" }); }
});

app.post("/api/penalties", async (req, res) => {
  try {
    const p = req.body;
    if (!p.employeeId || !p.amount) return res.status(400).json({ error: "Majburiy maydonlar!" });
    const penalty: PenaltyRecord = {
      id: `p_${Date.now()}`,
      employeeId: p.employeeId,
      date: p.date || nowUZ().toISOString().split("T")[0],
      minutesLate: Number(p.minutesLate || 0),
      amount: Number(p.amount),
      description: p.description || "Admin tomonidan yozildi",
      timestamp: Date.now(),
      cleared: false
    };
    await savePenalty(penalty);
    res.json(penalty);
  } catch { res.status(500).json({ error: "DB error" }); }
});

app.post("/api/penalties/clear/:id", async (req, res) => {
  try {
    const penalties = await getPenalties();
    const p = penalties.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Topilmadi" });
    p.cleared = true;
    await updatePenalty(p);
    res.json(p);
  } catch { res.status(500).json({ error: "DB error" }); }
});

app.get("/api/settings", async (req, res) => {
  try { res.json(await getSettings()); } catch { res.status(500).json({ error: "DB error" }); }
});

app.post("/api/settings", async (req, res) => {
  try {
    const current = await getSettings();
    const oldToken = current.botToken;
    const updated = { ...current, ...req.body };
    await saveSettings(updated);
    if (updated.botToken !== oldToken) {
      console.log("Token changed, restarting bot...");
      const activeToken = process.env.TELEGRAM_BOT_TOKEN || updated.botToken || "";
      await startTelegramBot(activeToken);
    }
    res.json({ success: true, settings: updated });
  } catch { res.status(500).json({ error: "DB error" }); }
});

app.post("/api/settings/test-token", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, error: "Token bo'sh!" });
  try {
    const testBot = new Telegraf(token);
    const me = await testBot.telegram.getMe();
    res.json({ success: true, username: me.username, first_name: me.first_name });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// SERVER STARTUP
// ----------------------------------------------------
async function runServer() {
  await initDb();

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("❌ TELEGRAM_BOT_TOKEN environment variable is not set!");
  } else {
    // Always sync env token into DB so dashboard/settings stay in sync
    await pool.query(
      "UPDATE settings SET data = data || $1 WHERE id = 'main'",
      [JSON.stringify({ botToken: token })]
    );
    try { await startTelegramBot(token); }
    catch (err) { console.error("Bot startup failed:", err); }
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "..");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on: http://localhost:${PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("Server error:", err.code === "EADDRINUSE" ? `Port ${PORT} busy` : err);
    process.exit(1);
  });

  const shutdown = async () => {
    console.log("Shutting down...");
    if (activeBot) { try { await activeBot.stop("SIGTERM"); } catch {} }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

runServer();
