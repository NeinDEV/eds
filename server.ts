import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { Telegraf, Markup } from "telegraf";
import { fileURLToPath } from "url";
import { 
  Employee, 
  AttendanceRecord, 
  PenaltyRecord, 
  Settings, 
  DashboardStats 
} from "./src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// GMT+5 Uzbekistan time helper — Render runs UTC, so we offset by 5 hours
function nowUZ(): Date {
  return new Date(Date.now() + 5 * 60 * 60 * 1000);
}

// File-based Storage DB path (Configurable via Render env for persistent disk)
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "db.json");

// Define Initial Default DB
interface DatabaseSchema {
  employees: Employee[];
  attendance: AttendanceRecord[];
  penalties: PenaltyRecord[];
  settings: Settings;
}

const DEFAULT_DB: DatabaseSchema = {
  employees: [
    {
      id: "emp_1",
      name: "Musoxon Shovkatov",
      telegramId: "123456789",
      telegramUsername: "musoxon_sh",
      startTime: "09:00",
      endTime: "18:00",
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      salaryRateType: "monthly",
      baseSalaryRate: 4500000,
      approved: true
    },
    {
      id: "emp_2",
      name: "Otabek Elmurodov",
      telegramId: "987654321",
      telegramUsername: "otabek_elm",
      startTime: "08:00",
      endTime: "17:00",
      createdAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
      salaryRateType: "hourly",
      baseSalaryRate: 15000,
      approved: true
    },
    {
      id: "emp_3",
      name: "Zuhra Karimova",
      telegramId: null,
      telegramUsername: "zuhra_karim",
      startTime: "09:00",
      endTime: "18:00",
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      salaryRateType: "monthly",
      baseSalaryRate: 4000000,
      approved: true
    },
    {
      id: "emp_4",
      name: "Jasur Alimov",
      telegramId: null,
      telegramUsername: null,
      startTime: "10:00",
      endTime: "19:00",
      createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
      salaryRateType: "hourly",
      baseSalaryRate: 12000,
      approved: false
    }
  ],
  attendance: [
    {
      id: "emp_1_2026-06-22",
      employeeId: "emp_1",
      name: "Musoxon Shovkatov",
      date: "2026-06-22",
      checkIn: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000) - 8 * 3600,
      checkOut: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000) + 1 * 3600,
      checkInVideoId: "file_note_checkin_1",
      checkOutVideoId: "file_note_checkout_1",
      workedMinutes: 540,
      latenessMinutes: 0,
      penaltyAmount: 0,
      baseSalary: 150000,
      overtimeSalary: 0,
      finalSalary: 150000,
      isCompleted: true
    },
    {
      id: "emp_2_2026-06-22",
      employeeId: "emp_2",
      name: "Otabek Elmurodov",
      date: "2026-06-22",
      checkIn: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000) - 7.8 * 3600,
      checkOut: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000) + 1 * 3600,
      checkInVideoId: "file_note_checkin_2",
      checkOutVideoId: "file_note_checkout_2",
      workedMinutes: 528,
      latenessMinutes: 12,
      penaltyAmount: 6000,
      baseSalary: 132000,
      overtimeSalary: 0,
      finalSalary: 126000,
      isCompleted: true
    }
  ],
  penalties: [
    {
      id: "p_1",
      employeeId: "emp_2",
      date: "2026-06-22",
      minutesLate: 12,
      amount: 6000,
      description: "Ishga 12 daqiqa kechikib keldi (08:12)",
      timestamp: Date.now() - 24 * 60 * 60 * 1000,
      cleared: false
    }
  ],
  settings: {
    adminIds: ["musoxon_sh", "123456789", "5624377303", "5523761749"],
    botToken: "",
    summerRate: 6500,
    summerOvertimeRate: 7500,
    winterRate: 6500,
    winterOvertimeRate: 7500,
    latenessPenaltyPerMinute: 1000
  }
};

// In-memory cache layer to minimize database file I/O operations
let dbMemoryCache: DatabaseSchema | null = null;

function readDb(): DatabaseSchema {
  if (dbMemoryCache) {
    return dbMemoryCache;
  }
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2), "utf-8");
      dbMemoryCache = DEFAULT_DB;
      return DEFAULT_DB;
    }
    const data = fs.readFileSync(DB_PATH, "utf-8");
    dbMemoryCache = JSON.parse(data) as DatabaseSchema;
    return dbMemoryCache;
  } catch (error) {
    console.error("Read DB Error, returning defaults:", error);
    dbMemoryCache = DEFAULT_DB;
    return DEFAULT_DB;
  }
}

function writeDb(data: DatabaseSchema) {
  dbMemoryCache = data;
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Write DB Error:", error);
  }
}

function isAdminUser(userId: string | undefined, username: string | undefined): boolean {
  if (!userId) return false;
  const hardcodedAdmins = ["5624377303", "5523761749"];
  if (hardcodedAdmins.includes(userId)) return true;
  
  const db = readDb();
  if (db.settings.adminIds) {
    if (db.settings.adminIds.includes(userId)) return true;
    if (username && db.settings.adminIds.includes(username)) return true;
  }
  return false;
}

// ----------------------------------------------------
// TELEGRAM BOT RUNTIME CONTROLLER
// ----------------------------------------------------
let activeBot: Telegraf | null = null;
let botStatus: "Online" | "Offline" | "Error" = "Offline";
let botErrorDetails = "";
let botInfo: { username?: string, first_name?: string } | null = null;

async function startTelegramBot(token: string) {
  if (activeBot) {
    try {
      console.log("Shutting down active Telegram bot...");
      await activeBot.stop();
    } catch (err) {
      console.error("Error stopping old bot instance:", err);
    }
    activeBot = null;
  }

  if (!token || token.trim() === "") {
    botStatus = "Offline";
    botErrorDetails = "Bot Token kiritilmagan. Iltimos Sozlamalar bo'limidan token kiriting.";
    botInfo = null;
    return;
  }

  try {
    console.log(`Starting Telegram Bot with token [${token.substring(0, 8)}...]`);
    const bot = new Telegraf(token);
    
    const me = await bot.telegram.getMe();
    botInfo = { username: me.username, first_name: me.first_name };
    console.log(`Bot connected successfully: @${me.username}`);

    bot.start(async (ctx) => {
      const fromUser = ctx.from;
      const tId = fromUser.id.toString();
      const db = readDb();

      if (isAdminUser(tId, fromUser.username)) {
        return ctx.replyWithHTML(
          `👋 Assalomu alaykum, <b>Admin</b>! Admin panelga xush kelibsiz.\n\n` +
          `Quyidagi tugmalar orqali kompaniya davomatini va xodimlarini nazorat qilishingiz mumkin:`,
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

      const matchedEmployee = db.employees.find(e => e.telegramId === tId || e.telegramUsername?.toLowerCase() === fromUser.username?.toLowerCase());
      
      if (matchedEmployee) {
        if (!matchedEmployee.telegramId) {
          matchedEmployee.telegramId = tId;
        }
        if (fromUser.username) {
          matchedEmployee.telegramUsername = fromUser.username;
        }
        writeDb(db);

        const welcomeMsg = `Assalomu alaykum, <b>${matchedEmployee.name}</b>! 👋\n\n` +
          `Siz ushbu profilga muvaffaqiyatli bog'landingiz.\n` +
          `Ish tartibingiz: <b>${matchedEmployee.startTime} - ${matchedEmployee.endTime}</b>\n\n` +
          `Kelish yoki ketish vaqtini qayd qilish uchun quyidagi tugmalardan birini ishlating va shaxsingizni tasdiqlash uchun <b>Circular Video (kruglyash) yoki selfi</b> rasmini yuboring!`;

        return ctx.replyWithHTML(welcomeMsg, {
          reply_markup: {
            keyboard: [
              [{ text: "📥 Keldim (Check-In)" }, { text: "📤 Ketdim (Check-Out)" }],
              [{ text: "👤 Mening Profilim" }, { text: "ℹ️ Maosh va Tariflar" }]
            ],
            resize_keyboard: true
          }
        });
      } else {
        const guestMsg = `Assalomu alaykum! 🖐\n\n` +
          `Tizimda sizning telegram IDingiz (<code>${tId}</code>) yoki Telegram usernamesingiz topilmadi.\n` +
          `Iltimos, Davomat boshqaruv panelida admin sizning profilingizni qo'shganini tekshiring hamda usernameingiz <b>@${fromUser.username || "yo'q"}</b> yoki telegram IDingiz <code>${tId}</code> panelga kiritilganligini so'rang!\n\n` +
          `Admin panel orqali profilingiz kiritilgach, boti qayta '/start' qilishingiz mumkin.`;
        return ctx.replyWithHTML(guestMsg);
      }
    });

    bot.action("admin_today_attendance", async (ctx) => {
      try {
        const db = readDb();
        const todayStr = nowUZ().toISOString().split("T")[0];
        const todaysAttendance = db.attendance.filter(a => a.date === todayStr);

        let msg = `📊 <b>Bugungi davomat hisobi (${todayStr}):</b>\n\n`;
        if (todaysAttendance.length === 0) {
          msg += "Bugun hali hech kim kelmagan 🤷‍♂️";
        } else {
          todaysAttendance.forEach((att, idx) => {
            const emp = db.employees.find(e => e.id === att.employeeId);
            const name = emp ? emp.name : att.name;
            // Display times in UZ timezone (checkIn/Out are UTC unix seconds, add 5h offset)
            const inTime = att.checkIn ? new Date((att.checkIn + 5 * 3600) * 1000).toISOString().substring(11, 16) : "--:--";
            const outTime = att.checkOut ? new Date((att.checkOut + 5 * 3600) * 1000).toISOString().substring(11, 16) : "--:--";
            const lateness = att.latenessMinutes > 0 ? ` (⏱ Kechikish: ${att.latenessMinutes} daq)` : "";
            const smena = att.smenaNumber ? ` [Smena ${att.smenaNumber}]` : "";
            
            msg += `${idx + 1}. <b>${name}</b>${smena}:\n` +
                   `📥 Keldi: <b>${inTime}</b>${lateness}\n` +
                   `📤 Ketdi: <b>${outTime}</b>\n\n`;
          });
        }
        
        await ctx.answerCbQuery();
        await ctx.replyWithHTML(msg);
      } catch (err) {
        console.error("Error in admin_today_attendance handler:", err);
      }
    });

    bot.action("admin_employees_list", async (ctx) => {
      try {
        const db = readDb();
        let msg = `📋 <b>Xodimlar ro'yxati & boshqaruv:</b>\n\n`;
        if (db.employees.length === 0) {
          msg += "Hech qanday xodim topilmadi.";
          await ctx.answerCbQuery();
          await ctx.replyWithHTML(msg);
        } else {
          db.employees.forEach((emp, idx) => {
            const shift2 = emp.startTime2 ? ` & ${emp.startTime2}-${emp.endTime2}` : "";
            const status = emp.approved ? "✅ Tasdiqlangan" : "⏳ Tasdiqlanmagan";
            msg += `${idx + 1}. <b>${emp.name}</b> (ID: <code>${emp.id}</code>)\n` +
                   `   Telegram ID: <code>${emp.telegramId || "Yo'q"}</code>\n` +
                   `   Ish vaqti: <b>${emp.startTime}-${emp.endTime}${shift2}</b>\n` +
                   `   Tarif: Soatbay (${(emp.baseSalaryRate || 6500).toLocaleString()} UZS)\n` +
                   `   Holat: ${status}\n\n`;
          });

          const deleteButtons = db.employees.map(emp => [
            Markup.button.callback(`❌ O'chirish: ${emp.name}`, `admin_delete_${emp.id}`)
          ]);

          await ctx.answerCbQuery();
          await ctx.replyWithHTML(msg, Markup.inlineKeyboard(deleteButtons));
        }
      } catch (err) {
        console.error("Error in admin_employees_list handler:", err);
      }
    });

    bot.action(/^admin_delete_(.+)$/, async (ctx) => {
      try {
        const fromUser = ctx.from;
        if (!fromUser) return;
        const tId = fromUser.id.toString();
        
        if (!isAdminUser(tId, fromUser.username)) {
          await ctx.answerCbQuery("Sizda xodimni o'chirish huquqi yo'q! ⚠️");
          return;
        }

        const match = ctx.match as RegExpExecArray | null;
        const employeeId = match ? match[1] : null;
        if (!employeeId) {
          await ctx.answerCbQuery("O'chirish uchun xodim ID topilmadi! ⚠️");
          return;
        }

        const db = readDb();
        const empIndex = db.employees.findIndex(e => e.id === employeeId);
        if (empIndex === -1) {
          await ctx.answerCbQuery("Xodim allaqachon o'chirilgan yoki topilmadi! 🤷‍♂️");
          return;
        }

        const deletedEmp = db.employees[empIndex];
        db.employees.splice(empIndex, 1);
        writeDb(db);

        await ctx.answerCbQuery(`${deletedEmp.name} o'chirildi! ✔️`);
        await ctx.replyWithHTML(`❌ Xodim <b>${deletedEmp.name}</b> muvaffaqiyatli o'chirildi!`);
      } catch (err) {
        console.error("Error in admin_delete callback handler:", err);
      }
    });

    bot.action("admin_add_employee_hint", async (ctx) => {
      try {
        const msg = `➕ <b>Xodim qo'shish yo'riqnomasi:</b>\n\n` +
          `Admin sifatida yangi xodimlarni quyidagi formatdagi buyruq orqali to'g'ridan-to'g'ri botda ro'yxatdan o'tkazishingiz mumkin:\n\n` +
          `<code>/add &lt;user_id&gt; &lt;FIRSTNAME&gt; &lt;LASTNAME&gt; &lt;Start_time1&gt; &lt;end_time1&gt; [&lt;start_time2&gt; &lt;endtime2&gt;]</code>\n\n` +
          `<b>Misollar:</b>\n` +
          `• Bitta smena:\n` +
          `<code>/add 123456789 ESHMAT TOSHMATOV 09:00 18:00</code>\n\n` +
          `• Ikkita smenali xodim (Double Shift):\n` +
          `<code>/add 5523761749 MUSOXON SHAVKATOV 10:00 18:00 22:00 2:00</code>`;
        
        await ctx.answerCbQuery();
        await ctx.replyWithHTML(msg);
      } catch (err) {
        console.error("Error in admin_add_employee_hint handler:", err);
      }
    });

    bot.action("admin_clear_penalties", async (ctx) => {
      try {
        const db = readDb();
        const activePenalties = db.penalties.filter(p => !p.cleared);

        if (activePenalties.length === 0) {
          await ctx.answerCbQuery("Faol jarimalar topilmadi!");
          await ctx.reply("🧹 Jami jarimalar toza! Faol (to'lanmagan) jarimalar mavjud emas.");
          return;
        }

        activePenalties.forEach(p => {
          p.cleared = true;
        });
        writeDb(db);

        await ctx.answerCbQuery("Barcha jarimalar tozalandi!");
        await ctx.reply("🧹 Barcha faol jarimalar muvaffaqiyatli tozalandi (bekor qilindi)!");
      } catch (err) {
        console.error("Error in admin_clear_penalties handler:", err);
      }
    });

    bot.action("admin_overall_stats", async (ctx) => {
      try {
        const db = readDb();
        const thisMonthStr = nowUZ().toISOString().substring(0, 7); // YYYY-MM
        
        let msg = `📈 <b>Xodimlar ish vaqti va oylik hisoboti (${thisMonthStr}):</b>\n\n`;
        
        if (db.employees.length === 0) {
          msg += "Ro'yxatda hech qanday xodim mavjud emas.";
        } else {
          db.employees.forEach((emp, idx) => {
            const empAtt = db.attendance.filter(a => a.employeeId === emp.id && a.date.startsWith(thisMonthStr));
            const empPen = db.penalties.filter(p => p.employeeId === emp.id && p.date.startsWith(thisMonthStr) && !p.cleared);
            
            const daysCount = empAtt.length;
            const totalMinutes = empAtt.reduce((sum, a) => sum + (a.workedMinutes || 0), 0);
            const workedHours = Number((totalMinutes / 60).toFixed(1));
            
            const totalBase = empAtt.reduce((sum, a) => sum + (a.baseSalary || 0), 0);
            const totalOvertime = empAtt.reduce((sum, a) => sum + (a.overtimeSalary || 0), 0);
            const totalPenalty = empPen.reduce((sum, p) => sum + p.amount, 0);
            const finalWithdrawn = empAtt.reduce((sum, a) => sum + (a.finalSalary || 0), 0);
            
            msg += `👤 <b>${idx + 1}. ${emp.name}</b>\n` +
                   `📅 Ish kunlari: <b>${daysCount} kun</b>\n` +
                   `⏳ Jami ish vaqti: <b>${workedHours} soat</b>\n` +
                   `💵 To'langan asosiy: <b>${totalBase.toLocaleString()} UZS</b>\n` +
                   `➕ Overtime (qo'shimcha): <b>${totalOvertime.toLocaleString()} UZS</b>\n` +
                   `➖ Jarimalar (kechikish): <b>${totalPenalty.toLocaleString()} UZS</b>\n` +
                   `💰 Yakuniy sof oylik: <b>${finalWithdrawn.toLocaleString()} UZS</b>\n\n`;
          });
        }
        
        await ctx.answerCbQuery();
        await ctx.replyWithHTML(msg);
      } catch (err) {
        console.error("Error in admin_overall_stats handler:", err);
      }
    });

    bot.action("admin_refresh_menu", async (ctx) => {
      try {
        await ctx.answerCbQuery("Menyu yangilandi!");
        await ctx.replyWithHTML(
          `🔄 <b>Asosiy menuniz yangilandi:</b>\n\n` +
          `Quyidagi tugmalar orqali kompaniya davomatini va xodimlarini nazorat qilishingiz mumkin:`,
          Markup.inlineKeyboard([
            [Markup.button.callback("📊 Bugungi davomat hisobi", "admin_today_attendance")],
            [Markup.button.callback("📈 STATISTIKA - Xodimlar maoshi", "admin_overall_stats")],
            [Markup.button.callback("📋 Xodimlar ro'yxati & boshqaruv", "admin_employees_list")],
            [Markup.button.callback("➕ Xodim qo'shish", "admin_add_employee_hint")],
            [Markup.button.callback("🧹 Jarimani tozalash", "admin_clear_penalties")],
            [Markup.button.callback("🔄 Menyuni yangilash", "admin_refresh_menu")]
          ])
        );
      } catch (err) {
        console.error("Error in admin_refresh_menu handler:", err);
      }
    });

    bot.command("clear", async (ctx) => {
      const fromUser = ctx.from;
      const tId = fromUser.id.toString();
      
      if (!isAdminUser(tId, fromUser.username)) {
        return ctx.reply("Sizda ushbu buyruqni bajarish uchun ruxsat yo'q. Faqat adminlar bazani tozalay oladi!");
      }

      try {
        const db = readDb();
        const currentAdminIds = db.settings.adminIds || [];
        const currentToken = db.settings.botToken || "";
        
        const freshDb: DatabaseSchema = {
          employees: [],
          attendance: [],
          penalties: [],
          settings: {
            ...DEFAULT_DB.settings,
            adminIds: currentAdminIds.length > 0 ? currentAdminIds : DEFAULT_DB.settings.adminIds,
            botToken: currentToken
          }
        };

        writeDb(freshDb);
        return ctx.reply("🧹 Barcha ma'lumotlar jurnali (xodimlar, davomat qaydlari va jarimalar) muvaffaqiyatli tozalandi!");
      } catch (err) {
        console.error("Error in /clear command handler:", err);
        return ctx.reply("Bazani tozalashda xatolik yuz berdi.");
      }
    });

    bot.command("add", async (ctx) => {
      const fromUser = ctx.from;
      const tId = fromUser.id.toString();
      
      if (!isAdminUser(tId, fromUser.username)) {
        return ctx.reply("Sizda ushbu buyruqni bajarish uchun ruxsat yo'q. Faqat adminlar xodim qo'sha oladi!");
      }

      const argsText = ctx.message.text.substring(5).trim();
      if (!argsText) {
        return ctx.replyWithHTML(
          `⚠️ <b>Xodim qo'shish uchun ma'lumotlar yetarli emas!</b>\n\n` +
          `Format:\n` +
          `<code>/add &lt;telegram_id&gt; &lt;Ism&gt; &lt;Familiya&gt; &lt;Ish_boshlash_1&gt; &lt;Tugash_1&gt; [&lt;Ish_boshlash_2&gt; &lt;Tugash_2&gt;]</code>\n\n` +
          `Masalan:\n` +
          `<code>/add 5523761749 MUSOXON SHAVKATOV 10:00 18:00 22:00 2:00</code>`
        );
      }

      const parts = argsText.split(/\s+/);
      if (parts.length < 5) {
        return ctx.replyWithHTML(
          `⚠️ <b>Noto'g'ri format!</b> Hammasi bo'lib kamida telegram_id, ism, familiya va 1-smena vaqtlari kiritilishi kerak.\n` +
          `Format: <code>/add &lt;user_id&gt; &lt;FIRSTNAME&gt; &lt;LASTNAME&gt; &lt;Start_time1&gt; &lt;end_time1&gt; [start_time2 endtime2]</code>`
        );
      }

      const employeeTelegramId = parts[0];
      const firstName = parts[1];
      const lastName = parts[2];
      const startTime1 = parts[3];
      const endTime1 = parts[4];
      const startTime2 = parts[5] || undefined;
      const endTime2 = parts[6] || undefined;

      const employeeName = `${firstName} ${lastName}`;

      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(startTime1) || !timeRegex.test(endTime1)) {
        return ctx.reply(`⚠️ Noto'g'ri vaqt formati (masalan HH:MM, 10:00 yoki 18:00 bo'lishi kerak): '${startTime1}' yoki '${endTime1}'`);
      }

      if (startTime2 && endTime2) {
        if (!timeRegex.test(startTime2) || !timeRegex.test(endTime2)) {
          return ctx.reply(`⚠️ 2-smena vaqt formati noto'g'ri (HH:MM shaklida kiritilishi lozim): '${startTime2}' yoki '${endTime2}'`);
        }
      }

      const db = readDb();
      
      const existing = db.employees.find(e => e.telegramId === employeeTelegramId);
      if (existing) {
        return ctx.reply(`⚠️ Ushbu telegram ID-ga ega xodim allaqachon mavjud: ${existing.name}`);
      }

      const newEmp: Employee = {
        id: `emp_${Date.now()}`,
        name: employeeName,
        telegramId: employeeTelegramId,
        telegramUsername: null,
        startTime: startTime1,
        endTime: endTime1,
        startTime2: startTime2,
        endTime2: endTime2,
        createdAt: Date.now(),
        salaryRateType: "hourly",
        baseSalaryRate: 6500,
        approved: true
      };

      db.employees.push(newEmp);
      writeDb(db);

      let successMsg = `🎉 <b>Yangi xodim muvaffaqiyatli qo'shildi!</b>\n\n` +
        `👤 Ism: <b>${employeeName}</b>\n` +
        `🆔 Telegram ID: <code>${employeeTelegramId}</code>\n` +
        `⏰ 1-smena: <b>${startTime1} - ${endTime1}</b>\n`;
      
      if (startTime2 && endTime2) {
        successMsg += `⏰ 2-smena (Double): <b>${startTime2} - ${endTime2}</b>\n`;
      }

      successMsg += `\nKompaniya xodimi ushbu botga a'zo bo'lgach, unga start menyusi ochiladi.`;
      
      return ctx.replyWithHTML(successMsg);
    });

    bot.hears("ℹ️ Maosh va Tariflar", (ctx) => {
      const db = readDb();
      const s = db.settings;
      const rateMsg = `📋 <b>Tizimdagi joriy tariflar:</b>\n\n` +
        `☀️ Yozgi tarif: <b>${s.summerRate.toLocaleString()} UZS / soat</b>\n` +
        `☀️ Yozgi overtime tarif (qo'shimcha ish vaqti): <b>${s.summerOvertimeRate.toLocaleString()} UZS / soat</b>\n\n` +
        `❄️ Qishki tarif: <b>${s.winterRate.toLocaleString()} UZS / soat</b>\n` +
        `❄️ Qishki overtime tarif: <b>${s.winterOvertimeRate.toLocaleString()} UZS / soat</b>\n\n` +
        `⚠️ Kechikish uchun jarima tarifi: <b>${s.latenessPenaltyPerMinute.toLocaleString()} UZS / daqiqa</b>`;
      ctx.replyWithHTML(rateMsg);
    });

    bot.hears("👤 Mening Profilim", (ctx) => {
      const tId = ctx.from.id.toString();
      const db = readDb();
      const emp = db.employees.find(e => e.telegramId === tId);

      if (!emp) {
        return ctx.reply("Siz ro'yxatdan o'tmagansiz!");
      }

      const monthStr = nowUZ().toISOString().substring(0, 7); // YYYY-MM UZ time
      const myAtt = db.attendance.filter(a => a.employeeId === emp.id && a.date.startsWith(monthStr));
      const totalDays = myAtt.length;
      const myPenalties = db.penalties.filter(p => p.employeeId === emp.id && p.date.startsWith(monthStr));
      const penaltySum = myPenalties.reduce((sum, p) => sum + p.amount, 0);
      const activeUnpaidEarnings = myAtt.reduce((sum, a) => sum + (a.finalSalary || 0), 0);

      const profileMsg = `👤 <b>Sizning profilingiz:</b>\n\n` +
        `📎 Ism-sharif: <b>${emp.name}</b>\n` +
        `📅 Ish vaqti: <b>${emp.startTime} - ${emp.endTime}</b>\n` +
        `💰 Tarif turi: <b>Soatbay</b>\n` +
        `💵 Baza stavka: <b>${(emp.baseSalaryRate || 6500).toLocaleString()} UZS / soat</b>\n\n` +
        `📊 <b>Shu oydagi natijalaringiz (${monthStr}):</b>\n` +
        `✅ Qatnashgan kunlaringiz: <b>${totalDays} kun</b>\n` +
        `⚠️ Ushbu oydagi jarimalar summasi: <b>${penaltySum.toLocaleString()} UZS</b>\n` +
        `💸 Ishlab topilgan joriy oylik: <b>${activeUnpaidEarnings.toLocaleString()} UZS</b> (Jarima chegirilgan)`;

      ctx.replyWithHTML(profileMsg);
    });

    const userSession: Record<string, "waiting_for_checkin_media" | "waiting_for_checkout_media"> = {};

    bot.hears("📥 Keldim (Check-In)", (ctx) => {
      const tId = ctx.from.id.toString();
      userSession[tId] = "waiting_for_checkin_media";
      ctx.reply("Iltimos, keldiyingizni tasdiqlash uchun circular video-xabar (kruglyash) yoki rasmingizni yuboring! 📸");
    });

    bot.hears("📤 Ketdim (Check-Out)", (ctx) => {
      const tId = ctx.from.id.toString();
      userSession[tId] = "waiting_for_checkout_media";
      ctx.reply("Iltimos, ketishingizni tasdiqlash uchun circular video-xabar (kruglyash) yoki rasmingizni yuboring! 📸");
    });

    bot.on(["video_note", "photo"], async (ctx) => {
      const tId = ctx.from.id.toString();
      const session = userSession[tId];
      if (!session) {
        return ctx.reply("Iltimos, avval menyudan tugmalardan birini bosing: '📥 Keldim' yoki '📤 Ketdim'!");
      }

      const db = readDb();
      const emp = db.employees.find(e => e.telegramId === tId);
      if (!emp) {
        return ctx.reply("Siz tizimga ruxsat etilmagansiz.");
      }

      let fileId = "";
      let isVideoNote = false;
      if (ctx.message && "video_note" in ctx.message && ctx.message.video_note) {
        fileId = ctx.message.video_note.file_id;
        isVideoNote = true;
      } else if (ctx.message && "photo" in ctx.message && ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      }

      // Use UZ time for today's date string
      const todayStr = nowUZ().toISOString().split("T")[0];
      
      const recordKeyShift1 = `${emp.id}_${todayStr}_1`;
      const recordKeyShift2 = `${emp.id}_${todayStr}_2`;
      const legacyKey = `${emp.id}_${todayStr}`;

      const idx1 = db.attendance.findIndex(a => a.id === recordKeyShift1);
      const idx2 = db.attendance.findIndex(a => a.id === recordKeyShift2);
      const idxLegacy = db.attendance.findIndex(a => a.id === legacyKey);

      let targetRecordKey = "";
      let targetRecordIndex = -1;
      let smenaNumber = 1;

      if (session === "waiting_for_checkin_media") {
        let ongoingIndex = db.attendance.findIndex(a => a.employeeId === emp.id && a.date === todayStr && !a.isCompleted);
        if (ongoingIndex === -1 && idxLegacy !== -1 && !db.attendance[idxLegacy].isCompleted) {
          ongoingIndex = idxLegacy;
        }

        if (ongoingIndex !== -1) {
          userSession[tId] = undefined as any;
          return ctx.reply("Siz allaqachon kelishingizni (Check-In) qayd etgansiz! Iltimos, avval ketishingizni (Check-Out) qayd eting.");
        }

        const r1 = idx1 !== -1 ? db.attendance[idx1] : (idxLegacy !== -1 ? db.attendance[idxLegacy] : null);

        if (!r1) {
          targetRecordKey = recordKeyShift1;
          smenaNumber = 1;
        } else {
          if (emp.startTime2 && emp.endTime2) {
            const r2 = idx2 !== -1 ? db.attendance[idx2] : null;
            if (!r2) {
              targetRecordKey = recordKeyShift2;
              smenaNumber = 2;
            } else {
              userSession[tId] = undefined as any;
              return ctx.reply("Siz bugungi barcha smenalarni (1-smena va 2-smena) allaqachon yakunladingiz! 🚀");
            }
          } else {
            userSession[tId] = undefined as any;
            return ctx.reply("Siz bugun allaqachon kelish va ketishingizni (Check-In/Out) yakunlagansiz!");
          }
        }

        targetRecordIndex = db.attendance.findIndex(a => a.id === targetRecordKey);

        // Use UZ time for check-in timestamp and lateness calculation
        const now = nowUZ();
        const checkInTimeSec = Math.floor((now.getTime() - 5 * 60 * 60 * 1000) / 1000); // store as real UTC unix

        const sTime = (smenaNumber === 2 && emp.startTime2) ? emp.startTime2 : emp.startTime;
        const [startHour, startMin] = sTime.split(":").map(Number);
        
        // Build scheduled time in UZ timezone for comparison
        const scheduledTime = new Date(now);
        scheduledTime.setUTCHours(startHour, startMin, 0, 0);

        let latenessMinutes = 0;
        let penaltyAmount = 0;

        if (now.getTime() > scheduledTime.getTime()) {
          latenessMinutes = Math.floor((now.getTime() - scheduledTime.getTime()) / 60000);
          penaltyAmount = latenessMinutes * db.settings.latenessPenaltyPerMinute;
        }

        const newRecord: AttendanceRecord = {
          id: targetRecordKey,
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

        if (targetRecordIndex !== -1) {
          db.attendance[targetRecordIndex] = newRecord;
        } else {
          db.attendance.push(newRecord);
        }

        if (latenessMinutes > 0 && penaltyAmount > 0) {
          const timeDisplayUZ = now.toISOString().substring(11, 16);
          db.penalties.push({
            id: `p_late_${Date.now()}`,
            employeeId: emp.id,
            date: todayStr,
            minutesLate: latenessMinutes,
            amount: penaltyAmount,
            description: `${smenaNumber}-smenaga ish vaqtidan ${latenessMinutes} daqiqa kechikib keldi (${timeDisplayUZ})`,
            timestamp: Date.now(),
            cleared: false
          });
        }

        writeDb(db);
        userSession[tId] = undefined as any;

        if (isVideoNote) {
          const admins = ["5624377303", "5523761749", ...(db.settings.adminIds || [])];
          for (const admin of admins) {
            if (admin && /^\d+$/.test(admin) && admin !== tId) {
              try {
                await ctx.telegram.forwardMessage(admin, ctx.chat.id, ctx.message.message_id);
                await ctx.telegram.sendMessage(admin, `📹 <b>Yangi video-xabar (kruglyash) keldi:</b>\n` +
                  `Xodim: <b>${emp.name}</b>\n` +
                  `Sana: <b>${todayStr}</b>\n` +
                  `Smena: <b>${smenaNumber}-smena</b>\n` +
                  `Holat: <b>Kelish (Check-In)</b>`, { parse_mode: "HTML" });
              } catch (err) {
                console.error(`Failed to forward video note to admin ${admin}:`, err);
              }
            }
          }
        }

        const timeStr = now.toISOString().substring(11, 16); // HH:MM in UZ time
        let textResponse = `${smenaNumber}-smenaga kelish qayd etildi! ✅\n` +
          `⏰ Vaqt: <b>${timeStr}</b>\n`;
        
        if (latenessMinutes > 0) {
          textResponse += `⚠️ Kechikish: <b>${latenessMinutes} daqiqa</b>\n` +
            `💸 Jarima: <b>${penaltyAmount.toLocaleString()} UZS</b>`;
        } else {
          textResponse += `🎉 Vaqtida kelish! Tasdiqlandi. Baraka toping!`;
        }

        return ctx.replyWithHTML(textResponse);

      } else if (session === "waiting_for_checkout_media") {
        let ongoingIndex = db.attendance.findIndex(a => a.employeeId === emp.id && a.date === todayStr && !a.isCompleted);
        if (ongoingIndex === -1 && idxLegacy !== -1 && !db.attendance[idxLegacy].isCompleted) {
          ongoingIndex = idxLegacy;
        }

        if (ongoingIndex === -1) {
          userSession[tId] = undefined as any;
          return ctx.reply("Siz hali bugun kelganingizni belgilamagansiz. Avval '📥 Keldim' belgilashini rasmiylashtiring.");
        }

        const record = db.attendance[ongoingIndex];
        smenaNumber = record.smenaNumber || 1;

        // Use UZ time for checkout
        const now = nowUZ();
        const checkOutTimeSec = Math.floor((now.getTime() - 5 * 60 * 60 * 1000) / 1000); // store as real UTC unix
        
        record.checkOut = checkOutTimeSec;
        record.checkOutVideoId = fileId;

        const diffInSec = checkOutTimeSec - record.checkIn!;
        const workedMinutes = Math.floor(diffInSec / 60);
        record.workedMinutes = workedMinutes;

        // Use UZ month for winter/summer rule
        const uzMonth = now.getUTCMonth() + 1;
        const isWinterRule = [11, 12, 1, 2, 3].includes(uzMonth);
        const standardHoursLimit = isWinterRule ? 9 : 10;
        const totalHours = workedMinutes / 60;
        const currentNormalRate = isWinterRule ? (db.settings.winterRate || 6500) : (db.settings.summerRate || 6500);
        const currentOtRate = isWinterRule ? (db.settings.winterOvertimeRate || 7500) : (db.settings.summerOvertimeRate || 7500);

        let baseEarned = 0;
        let overtimeEarned = 0;

        if (totalHours > standardHoursLimit) {
          baseEarned = standardHoursLimit * currentNormalRate;
          const otHours = totalHours - standardHoursLimit;
          overtimeEarned = otHours * currentOtRate;
        } else {
          baseEarned = totalHours * currentNormalRate;
        }

        record.baseSalary = Math.round(baseEarned);
        record.overtimeSalary = Math.round(overtimeEarned);
        
        const totalRawSalary = record.baseSalary + record.overtimeSalary;
        const totalPenalty = record.penaltyAmount;
        record.finalSalary = Math.max(0, totalRawSalary - totalPenalty);
        record.isCompleted = true;

        writeDb(db);
        userSession[tId] = undefined as any;

        if (isVideoNote) {
          const admins = ["5624377303", "5523761749", ...(db.settings.adminIds || [])];
          for (const admin of admins) {
            if (admin && /^\d+$/.test(admin) && admin !== tId) {
              try {
                await ctx.telegram.forwardMessage(admin, ctx.chat.id, ctx.message.message_id);
                await ctx.telegram.sendMessage(admin, `📹 <b>Yangi video-xabar (kruglyash) keldi:</b>\n` +
                  `Xodim: <b>${emp.name}</b>\n` +
                  `Sana: <b>${todayStr}</b>\n` +
                  `Smena: <b>${smenaNumber}-smena</b>\n` +
                  `Holat: <b>Ketish (Check-Out)</b>`, { parse_mode: "HTML" });
              } catch (err) {
                console.error(`Failed to forward video note to admin ${admin}:`, err);
              }
            }
          }
        }

        const timeStr = now.toISOString().substring(11, 16); // HH:MM in UZ time
        const workedHrs = Math.floor(workedMinutes / 60);
        const workedMins = workedMinutes % 60;

        const monthStr = now.toISOString().substring(0, 7); // YYYY-MM in UZ time
        const myAtt = db.attendance.filter(a => a.employeeId === emp.id && a.date.startsWith(monthStr));
        const monthDays = myAtt.length;
        const monthBaseWages = myAtt.reduce((sum, a) => sum + (a.baseSalary || 0), 0);
        const monthOtWages = myAtt.reduce((sum, a) => sum + (a.overtimeSalary || 0), 0);
        const monthPenalties = myAtt.reduce((sum, a) => sum + (a.penaltyAmount || 0), 0);
        const monthNetWages = myAtt.reduce((sum, a) => sum + (a.finalSalary || 0), 0);

        const checkoutResponse = `<b>✅ ${smenaNumber}-smenadan ketish qayd etildi!</b> 👋\n\n` +
          `📌 <b>BUGUNGI ISH HAQI:</b>\n` +
          `⏰ Ketish vaqti: <b>${timeStr}</b>\n` +
          `⏳ Ishlangan vaqt: <b>${workedHrs} soat ${workedMins} daqiqa</b>\n` +
          `💵 Baza tarif: <b>${record.baseSalary.toLocaleString()} UZS</b> (${currentNormalRate.toLocaleString()} UZS/soat)\n` +
          `➕ Overtime: <b>${record.overtimeSalary.toLocaleString()} UZS</b> (${currentOtRate.toLocaleString()} UZS/soat)\n` +
          `➖ Jarima (kechikish): <b>${record.penaltyAmount.toLocaleString()} UZS</b>\n` +
          `💰 Bugungi yakuniy sof maosh: <b>${record.finalSalary.toLocaleString()} UZS</b>\n\n` +
          `📊 <b>SHU OYDAGI KO'RSATKICHLARINGIZ (${monthStr}):</b>\n` +
          `📅 Ishlangan jami kun: <b>${monthDays} kun</b>\n` +
          `💳 Jami baza maosh: <b>${monthBaseWages.toLocaleString()} UZS</b>\n` +
          `➕ Jami overtime: <b>${monthOtWages.toLocaleString()} UZS</b>\n` +
          `➖ Jami kechikish jarimalari: <b>${monthPenalties.toLocaleString()} UZS</b>\n` +
          `💸 Jami ishlab topilgan sof maosh: <b>${monthNetWages.toLocaleString()} UZS</b>`;

        return ctx.replyWithHTML(checkoutResponse);
      }
    });

    bot.catch((err, ctx) => {
      console.error(`Telegram Bot encountered error for update:`, err);
    });

    bot.launch();
    console.log("Telegram Bot fully polled & launched gracefully!");
    activeBot = bot;
    botStatus = "Online";
    botErrorDetails = "";
  } catch (error: any) {
    console.error("Failed to start Telegram Bot:", error);
    botStatus = "Offline";
    botErrorDetails = error.message || "Ulanish xatosi. Token to'g'ri kiritilganligiga va internetga ishonch hosil qiling.";
    botInfo = null;
  }
}

// Auto-run bot on startup if token is ready in persist or environment variables
const db = readDb();
const initialSettings = db.settings;
const botTokenFromEnv = process.env.TELEGRAM_BOT_TOKEN;

if (botTokenFromEnv && initialSettings.botToken !== botTokenFromEnv) {
  initialSettings.botToken = botTokenFromEnv;
  db.settings.botToken = botTokenFromEnv;
  writeDb(db);
}

const activeToken = botTokenFromEnv || initialSettings.botToken;
if (activeToken) {
  startTelegramBot(activeToken).catch(err => {
    console.error("Auto startup Bot failed:", err);
  });
}

// ----------------------------------------------------
// REST API ROUTES
// ----------------------------------------------------

app.get("/api/stats", (req, res) => {
  const db = readDb();
  const todayStr = nowUZ().toISOString().split("T")[0];
  const thisMonthStr = todayStr.substring(0, 7);

  const totalEmployees = db.employees.length;
  const todayActiveCount = db.attendance.filter(a => a.date === todayStr && a.checkIn).length;
  
  const thisMonthPenalties = db.penalties.filter(p => p.date.startsWith(thisMonthStr));
  const totalPenaltiesThisMonth = thisMonthPenalties.reduce((sum, p) => sum + p.amount, 0);

  const thisMonthAtt = db.attendance.filter(a => a.date.startsWith(thisMonthStr));
  const totalWagesThisMonth = thisMonthAtt.reduce((sum, a) => sum + (a.finalSalary || 0), 0);

  const latenessWarningCountToday = db.attendance.filter(a => a.date === todayStr && a.latenessMinutes > 5).length;

  const dashboard: DashboardStats = {
    totalEmployees,
    todayActiveCount,
    totalPenaltiesThisMonth,
    totalWagesThisMonth,
    latenessWarningCountToday
  };

  res.json({
    dashboard,
    bot: {
      status: botStatus,
      error: botErrorDetails,
      info: botInfo
    }
  });
});

app.get("/api/employees", (req, res) => {
  const db = readDb();
  res.json(db.employees);
});

app.post("/api/employees", (req, res) => {
  const db = readDb();
  const empInput = req.body as Partial<Employee>;

  if (!empInput.name || !empInput.startTime || !empInput.endTime || !empInput.baseSalaryRate) {
    return res.status(400).json({ error: "Ism, ish soatlari va stavka to'ldirilishi shart!" });
  }

  const id = empInput.id || `emp_${Date.now()}`;
  const existingIndex = db.employees.findIndex(e => e.id === id);

  const payload: Employee = {
    id,
    name: empInput.name,
    telegramId: empInput.telegramId || null,
    telegramUsername: empInput.telegramUsername ? empInput.telegramUsername.replace("@", "") : null,
    startTime: empInput.startTime,
    endTime: empInput.endTime,
    createdAt: empInput.createdAt || Date.now(),
    salaryRateType: empInput.salaryRateType || "hourly",
    baseSalaryRate: Number(empInput.baseSalaryRate || 6500),
    approved: empInput.approved !== undefined ? empInput.approved : true
  };

  if (existingIndex !== -1) {
    db.employees[existingIndex] = payload;
  } else {
    db.employees.push(payload);
  }

  writeDb(db);
  res.json(payload);
});

app.delete("/api/employees/:id", (req, res) => {
  const db = readDb();
  const id = req.params.id;
  db.employees = db.employees.filter(e => e.id !== id);
  db.attendance = db.attendance.filter(a => a.employeeId !== id);
  db.penalties = db.penalties.filter(p => p.employeeId !== id);
  writeDb(db);
  res.json({ success: true });
});

app.get("/api/attendance", (req, res) => {
  const db = readDb();
  res.json(db.attendance);
});

app.post("/api/attendance/manual", (req, res) => {
  const db = readDb();
  const input = req.body;
  
  if (!input.employeeId || !input.date || !input.checkIn) {
    return res.status(400).json({ error: "Xodim, sana va kirish vaqti majburiy!" });
  }

  const emp = db.employees.find(e => e.id === input.employeeId);
  if (!emp) {
    return res.status(404).json({ error: "Xodim topilmadi!" });
  }

  const recordId = `${input.employeeId}_${input.date}`;
  const existingIdx = db.attendance.findIndex(a => a.id === recordId);

  const dateBase = new Date(input.date);
  const [inH, inM] = input.checkIn.split(":").map(Number);
  const checkInSec = Math.floor(new Date(dateBase.setHours(inH, inM, 0)).getTime() / 1000);

  let checkOutSec: number | null = null;
  let workedMinutes = 0;
  if (input.checkOut) {
    const [outH, outM] = input.checkOut.split(":").map(Number);
    checkOutSec = Math.floor(new Date(dateBase.setHours(outH, outM, 0)).getTime() / 1000);
    workedMinutes = Math.floor((checkOutSec - checkInSec) / 60);
  }

  const [startH, startM] = emp.startTime.split(":").map(Number);
  const scheduledTime = new Date(dateBase);
  scheduledTime.setHours(startH, startM, 0);

  const checkInTimeReal = new Date(checkInSec * 1000);
  let latenessMinutes = 0;
  let penaltyAmount = 0;

  if (checkInTimeReal.getTime() > scheduledTime.getTime()) {
    latenessMinutes = Math.floor((checkInTimeReal.getTime() - scheduledTime.getTime()) / 60000);
    penaltyAmount = latenessMinutes * db.settings.latenessPenaltyPerMinute;
  }

  const isWinter = [11, 12, 1, 2, 3].includes(new Date(input.date).getMonth() + 1);
  const [empStartH, empStartM] = emp.startTime.split(":").map(Number);
  const [empEndH, empEndM] = emp.endTime.split(":").map(Number);
  const shiftDurationMinutes = (empEndH * 60 + empEndM) - (empStartH * 60 + empStartM);

  let baseSalary = 0;
  let overtimeSalary = 0;

  if (checkOutSec) {
    const isWinterRule = [11, 12, 1, 2, 3].includes(new Date(input.date).getMonth() + 1);
    const standardHoursLimit = isWinterRule ? 9 : 10;
    const totalHours = workedMinutes / 60;
    const currentNormalRate = isWinterRule ? (db.settings.winterRate || 6500) : (db.settings.summerRate || 6500);
    const currentOtRate = isWinterRule ? (db.settings.winterOvertimeRate || 7500) : (db.settings.summerOvertimeRate || 7500);

    if (totalHours > standardHoursLimit) {
      baseSalary = standardHoursLimit * currentNormalRate;
      const otHours = totalHours - standardHoursLimit;
      overtimeSalary = otHours * currentOtRate;
    } else {
      baseSalary = totalHours * currentNormalRate;
    }
  }

  const finalSalary = Math.max(0, (baseSalary + overtimeSalary) - penaltyAmount);

  const payload: AttendanceRecord = {
    id: recordId,
    employeeId: emp.id,
    name: emp.name,
    date: input.date,
    checkIn: checkInSec,
    checkOut: checkOutSec,
    checkInVideoId: input.checkInVideoId || null,
    checkOutVideoId: input.checkOutVideoId || null,
    workedMinutes,
    latenessMinutes,
    penaltyAmount,
    baseSalary: Math.round(baseSalary),
    overtimeSalary: Math.round(overtimeSalary),
    finalSalary: Math.round(finalSalary),
    isCompleted: !!checkOutSec,
    notes: input.notes || "Admin orqali kiritildi"
  };

  if (existingIdx !== -1) {
    db.attendance[existingIdx] = payload;
  } else {
    db.attendance.push(payload);
  }

  writeDb(db);
  res.json(payload);
});

app.get("/api/penalties", (req, res) => {
  const db = readDb();
  res.json(db.penalties);
});

app.post("/api/penalties", (req, res) => {
  const db = readDb();
  const p = req.body;

  if (!p.employeeId || !p.amount) {
    return res.status(400).json({ error: "Suma va xodim kiritilishi shart!" });
  }

  const newPenalty: PenaltyRecord = {
    id: `p_${Date.now()}`,
    employeeId: p.employeeId,
    date: p.date || nowUZ().toISOString().split("T")[0],
    minutesLate: Number(p.minutesLate || 0),
    amount: Number(p.amount),
    description: p.description || "Ushbu jarima admin tomonidan yozildi",
    timestamp: Date.now(),
    cleared: false
  };

  db.penalties.push(newPenalty);
  writeDb(db);
  res.json(newPenalty);
});

app.post("/api/penalties/clear/:id", (req, res) => {
  const db = readDb();
  const id = req.params.id;
  const pIdx = db.penalties.findIndex(p => p.id === id);
  if (pIdx !== -1) {
    db.penalties[pIdx].cleared = true;
    writeDb(db);
    return res.json(db.penalties[pIdx]);
  }
  res.status(404).json({ error: "Jarima topilmadi" });
});

app.get("/api/settings", (req, res) => {
  const db = readDb();
  res.json(db.settings);
});

app.post("/api/settings", async (req, res) => {
  const db = readDb();
  const newSet = req.body as Settings;
  
  const oldToken = db.settings.botToken;
  db.settings = {
    ...db.settings,
    ...newSet
  };
  
  writeDb(db);

  if (newSet.botToken !== oldToken) {
    console.log("Bot token changed. Auto reloading bot runtime...");
    await startTelegramBot(newSet.botToken || "");
  }

  res.json({ success: true, settings: db.settings });
});

app.post("/api/settings/test-token", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: "Token bo'sh!" });
  }

  try {
    const testBot = new Telegraf(token);
    const me = await testBot.telegram.getMe();
    res.json({ success: true, username: me.username, first_name: me.first_name });
  } catch (error: any) {
    res.json({ success: false, error: error.message || "Ulanish muvaffaqiyatsiz bo'ldi." });
  }
});

// Serve frontend assets in production / fallback to Vite in dev
async function runServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server fully assembled and running on: http://localhost:${PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Set a different PORT env var.`);
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  });

  // Graceful shutdown (important on Render — SIGTERM is sent before container stops)
  const shutdown = async () => {
    console.log("Shutting down gracefully...");
    if (activeBot) {
      try { await activeBot.stop("SIGTERM"); } catch {}
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

runServer();
ENDOFFILE
echo "done"
