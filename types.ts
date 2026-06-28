import { useState, useEffect, FormEvent } from "react";
import { 
  Users, CheckSquare, Settings as SettingsIcon, AlertTriangle, 
  Clock, Bot, Video, UserCheck, Coins, DollarSign, Plus, 
  Trash2, RefreshCw, Search, X, Check, Save, FileText, Ban
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Employee, AttendanceRecord, PenaltyRecord, Settings, DashboardStats } from "./types";

export default function App() {
  // Navigation & filtering state
  const [activeTab, setActiveTab] = useState<"dashboard" | "employees" | "attendance" | "penalties" | "settings">("dashboard");
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().substring(0, 7)); // YYYY-MM
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Data persistence states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [penalties, setPenalties] = useState<PenaltyRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [botStatus, setBotStatus] = useState<{ status: string; error?: string; info?: { username?: string; first_name?: string } | null }>({ status: "Offline" });

  // Load state and feedback
  const [loading, setLoading] = useState<boolean>(true);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  // Modal forms
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [employeeForm, setEmployeeForm] = useState<Partial<Employee>>({
    name: "",
    startTime: "09:00",
    endTime: "18:00",
    startTime2: "",
    endTime2: "",
    salaryRateType: "monthly",
    baseSalaryRate: 4000000,
    telegramUsername: "",
    telegramId: "",
    approved: true
  });

  const [manualRecordModalOpen, setManualRecordModalOpen] = useState(false);
  const [manualRecordForm, setManualRecordForm] = useState({
    employeeId: "",
    date: new Date().toISOString().split("T")[0],
    checkIn: "09:00",
    checkOut: "18:00",
    notes: ""
  });

  const [penaltyModalOpen, setPenaltyModalOpen] = useState(false);
  const [penaltyForm, setPenaltyForm] = useState({
    employeeId: "",
    amount: "50000",
    description: "",
    date: new Date().toISOString().split("T")[0]
  });

  // Bot Token Testing States
  const [testToken, setTestToken] = useState("");
  const [tokenTestStatus, setTokenTestStatus] = useState<{ success?: boolean; text?: string; loading?: boolean }>({});

  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showNotification = (text: string, type: "success" | "error" = "success") => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 4000);
  };

  // API Call Helpers
  const fetchAllData = async () => {
    try {
      setLoading(true);
      const statsRes = await fetch("/api/stats");
      const statsData = await statsRes.json();
      setStats(statsData.dashboard);
      setBotStatus(statsData.bot);

      const empRes = await fetch("/api/employees");
      const empData = await empRes.json();
      setEmployees(empData);

      const attRes = await fetch("/api/attendance");
      const attData = await attRes.json();
      setAttendance(attData);

      const penRes = await fetch("/api/penalties");
      const penData = await penRes.json();
      setPenalties(penData);

      const setRes = await fetch("/api/settings");
      const setData = await setRes.json();
      setSettings(setData);
      setTestToken(setData.botToken || "");

      setErrorFeedback(null);
    } catch (err: any) {
      console.error("Error loading server dataset:", err);
      setErrorFeedback("Server bilan ulanishda xatolik yuz berdi. Iltimos qayta urinib ko'ring.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // CRUD handlers
  const saveEmployee = async () => {
    if (!employeeForm.name || !employeeForm.startTime || !employeeForm.endTime || !employeeForm.baseSalaryRate) {
      return showNotification("Ism, ish vaqti va stavka to'ldirilishi shart!", "error");
    }

    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(employeeForm)
      });
      if (res.ok) {
        showNotification("Xodim ma'lumotlari muvaffaqiyatli saqlandi! 🎉");
        setEmployeeModalOpen(false);
        fetchAllData();
      } else {
        const errJson = await res.json();
        showNotification(errJson.error || "Xatolik ro'y berdi", "error");
      }
    } catch (err) {
      showNotification("Serverga xabar yuborib bo'lmadi", "error");
    }
  };

  const deleteEmployee = async (id: string) => {
    if (!confirm("Haqiqatan ham ushbu xodimni va uning barcha davomat hamda jarima ma'lumotlarini o'chirmoqchimisiz?")) return;

    try {
      const res = await fetch(`/api/employees/${id}`, { method: "DELETE" });
      if (res.ok) {
        showNotification("Xodim tizimdan o'chirildi.");
        fetchAllData();
      }
    } catch (err) {
      showNotification("O'chirishda xatolik yuz berdi", "error");
    }
  };

  const saveManualRecord = async () => {
    if (!manualRecordForm.employeeId || !manualRecordForm.date || !manualRecordForm.checkIn) {
      return showNotification("Xodim, sana va kelish vaqti zarur!", "error");
    }

    try {
      const res = await fetch("/api/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manualRecordForm)
      });
      if (res.ok) {
        showNotification("Davomat qaydi muvaffaqiyatli kiritildi!");
        setManualRecordModalOpen(false);
        fetchAllData();
      } else {
        const err = await res.json();
        showNotification(err.error || "Xatolik", "error");
      }
    } catch (err) {
      showNotification("Saqlashda xatolik", "error");
    }
  };

  const createPenalty = async () => {
    if (!penaltyForm.employeeId || !penaltyForm.amount) {
      return showNotification("Xodim va jarima miqdori talab qilinadi!", "error");
    }

    try {
      const res = await fetch("/api/penalties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(penaltyForm)
      });
      if (res.ok) {
        showNotification("Joriy xodimga jarima belgilandi!");
        setPenaltyModalOpen(false);
        fetchAllData();
      }
    } catch (err) {
      showNotification("Saqlashda xatolik", "error");
    }
  };

  const clearPenalty = async (id: string) => {
    try {
      const res = await fetch(`/api/penalties/clear/${id}`, { method: "POST" });
      if (res.ok) {
        showNotification("Jarima bekor qilindi / to'landi deb belgilandi! ✅");
        fetchAllData();
      }
    } catch (err) {
      showNotification("Xatolik", "error");
    }
  };

  const testBotToken = async () => {
    if (!testToken) return showNotification("Token kiritilmadi!", "error");
    setTokenTestStatus({ loading: true });
    try {
      const res = await fetch("/api/settings/test-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: testToken })
      });
      const data = await res.json();
      if (data.success) {
        setTokenTestStatus({
          success: true,
          text: `Ulanish muvaffaqiyatli! Bot: @${data.username} (${data.first_name})`
        });
        showNotification("Telegram token to'g'ri va faol! ✅");
      } else {
        setTokenTestStatus({
          success: false,
          text: `Ulanish xatosi: ${data.error}`
        });
        showNotification("Ulanib bo'lmadi. Tokenni tekshiring.", "error");
      }
    } catch (err) {
      setTokenTestStatus({ success: false, text: "Tarmoq yoki server xatosi." });
    }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          botToken: testToken
        })
      });
      if (res.ok) {
        showNotification("Sozlamalar saqlandi, bot o'zgartirilgan bo'lsa qayta yuklanmoqda! ⚙️");
        fetchAllData();
      }
    } catch (err) {
      showNotification("Sozlamalarni saqlab bo'lmadi", "error");
    }
  };

  // Calculations for wages tables summary
  const getEmployeeSalaryStats = (empId: string) => {
    const empAtt = attendance.filter(a => a.employeeId === empId && a.date.startsWith(selectedMonth));
    const empPen = penalties.filter(p => p.employeeId === empId && p.date.startsWith(selectedMonth));
    
    const daysPresent = empAtt.length;
    const baseWages = empAtt.reduce((sum, a) => sum + (a.baseSalary || 0), 0);
    const overtimeWages = empAtt.reduce((sum, a) => sum + (a.overtimeSalary || 0), 0);
    const totalPenalties = empPen.reduce((sum, p) => sum + (p.cleared ? 0 : p.amount), 0);
    const finalEarned = Math.max(0, (baseWages + overtimeWages) - totalPenalties);

    return { daysPresent, baseWages, overtimeWages, totalPenalties, finalEarned };
  };

  // Filters and searches
  const filteredEmployees = employees.filter(e => 
    e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.telegramUsername && e.telegramUsername.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredAttendance = attendance.filter(a => {
    const matchesSearch = a.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesMonth = a.date.startsWith(selectedMonth);
    return matchesSearch && matchesMonth;
  });

  const filteredPenalties = penalties.filter(p => {
    const empName = employees.find(e => e.id === p.employeeId)?.name || "";
    const matchesSearch = empName.toLowerCase().includes(searchTerm.toLowerCase()) || p.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesMonth = p.date.startsWith(selectedMonth);
    return matchesSearch && matchesMonth;
  });

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#FAFAFB] text-[#2D3139]">
      {/* Dynamic Notification Popup */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg border text-sm font-medium ${
              notification.type === "success" 
                ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
                : "bg-rose-50 border-rose-100 text-rose-800"
            }`}
          >
            {notification.type === "success" ? <Check className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />}
            <span>{notification.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Sidebar ( Uzbek styling / High contrast green accents ) */}
      <aside className="w-full md:w-80 bg-white border-r border-[#EBECEF] p-6 flex flex-col justify-between shrink-0">
        <div>
          {/* App Brand Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-100">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg leading-tight tracking-tight text-[#111827]">
                Davomat & Maosh
              </h1>
              <p className="text-xs text-[#9CA3AF] font-medium uppercase tracking-wider font-mono">
                Boshqaruv Bot Paneli
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            {[
              { id: "dashboard", label: "Statistika & Bot", icon: Bot },
              { id: "employees", label: "Xodimlar Ro'yxati", icon: Users },
              { id: "attendance", label: "Davomat Jurnali", icon: CheckSquare },
              { id: "penalties", label: "Jarimalar & Kechikishlar", icon: AlertTriangle },
              { id: "settings", label: "Tizim Sozlamalari", icon: SettingsIcon },
            ].map((tab) => {
              const IconComp = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`tab_btn_${tab.id}`}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-150 text-left ${
                    isActive 
                      ? "bg-emerald-50 text-emerald-800 shadow-sm border border-emerald-100/50" 
                      : "text-[#5E6470] hover:bg-[#F4F5F7] hover:text-[#111827]"
                  }`}
                >
                  <IconComp className={`w-[18px] h-[18px] ${isActive ? "text-emerald-600" : "text-[#7B8190]"}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Dynamic Connected Bot Indicator */}
        <div className="mt-8 pt-6 border-t border-[#F0F1F3]">
          <div className="bg-[#FAFBFB] rounded-2xl p-4 border border-[#EBECEF]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#5E6470]">Ulanish statusi</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  botStatus.status === "Online" ? "bg-emerald-500 animate-pulse" : "bg-rose-400"
                }`} />
                <span className="text-xs font-mono font-bold text-[#111827]">
                  {botStatus.status === "Online" ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
            </div>

            {botStatus.status === "Online" && botStatus.info ? (
              <div>
                <p className="text-xs text-[#2D3139] truncate font-medium">
                  🤖 Bot: <span className="font-bold">@{botStatus.info.username}</span>
                </p>
                <p className="text-[10px] text-emerald-700 mt-1">
                  Telegram Polling faol! Kelish/ketish ishlamoqda.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-[11px] text-rose-600 leading-normal">
                  {botStatus.error || "Token topilmadi. Sozlamalarga o'ting."}
                </p>
                <button 
                  onClick={() => setActiveTab("settings")}
                  className="mt-2 text-xs text-emerald-600 hover:text-emerald-800 font-bold underline"
                >
                  Token sozlash &gt;
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto max-w-7xl mx-auto w-full">
        {/* Global Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-4 border-b border-[#F0F1F3]">
          <div>
            <h2 className="font-display font-bold text-2xl text-[#111827]">
              {activeTab === "dashboard" && "Tizim Ko'rsatkichlari & Statistika"}
              {activeTab === "employees" && "Xodimlar Boshqaruvi"}
              {activeTab === "attendance" && "Kelish-Ketish Davomat Jurnali"}
              {activeTab === "penalties" && "Jarimalarni Ro'yxatga Olish va Nazorat qilish"}
              {activeTab === "settings" && "Tizim va Telegram Bot Sozlamalari"}
            </h2>
            <p className="text-xs text-[#7B8190] mt-1">
              {new Date().toLocaleDateString("uz-UZ", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} joriy vaqti
            </p>
          </div>

          {/* Quick Toolbar Filters */}
          <div className="flex items-center gap-3">
            {/* Search Input Filter for non-settings */}
            {activeTab !== "settings" && (
              <div className="relative">
                <Search className="w-4 h-4 text-[#8C93A3] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Ism bo'yicha qidirish..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-white border border-[#EBECEF] rounded-xl text-xs text-[#2D3139] focus:outline-none focus:border-emerald-500 w-48 transition-all"
                />
              </div>
            )}

            {/* Monthly scope picker */}
            {(activeTab === "attendance" || activeTab === "penalties" || activeTab === "dashboard") && (
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-white border border-[#EBECEF] rounded-xl px-3 py-2 text-xs font-semibold text-[#2D3139] focus:outline-none focus:border-emerald-500 outline-none cursor-pointer"
              />
            )}

            <button 
              onClick={fetchAllData}
              className="p-2 bg-white hover:bg-[#F4F5F7] border border-[#EBECEF] rounded-xl transition-all text-[#5E6470]"
              title="Ma'lumotlarni yangilash"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------------------------- */}
        {/* TAB 1: DASHBOARD METRICS */}
        {/* ------------------------------------------------------------------------------- */}
        {activeTab === "dashboard" && stats && (
          <div className="space-y-8">
            {/* Stats Bento Grid Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: "Ro'yxatdagi jami xodimlar", value: stats.totalEmployees, suffix: " kishi", sub: "Faol va yangi nomzodlar", icon: Users, color: "emerald" },
                { label: "Bugun ishga kelgan faol", value: stats.todayActiveCount, suffix: " kishi", sub: "Chek-in qilganlar ko'rsatkichi", icon: UserCheck, color: "blue" },
                { label: "Shu oylik jarimalar summasi", value: stats.totalPenaltiesThisMonth.toLocaleString(), suffix: " UZS", sub: "Kechikishlar va jarimalar", icon: AlertTriangle, color: "amber" },
                { label: "Yig'ilgan oylik maoshlar(joriy oy)", value: stats.totalWagesThisMonth.toLocaleString(), suffix: " UZS", sub: "Xodimlar hisobidagi sof oylik", icon: Coins, color: "emerald-dark" }
              ].map((card, i) => {
                const IconComp = card.icon;
                return (
                  <div key={i} className="bg-white border border-[#EBECEF] rounded-3xl p-6 transition-all hover:shadow-lg hover:shadow-[#F0F1F3]/40">
                    <div className="flex justify-between items-start mb-4">
                      <span className="text-xs font-semibold text-[#7B8190] leading-snug">{card.label}</span>
                      <div className={`p-2 rounded-xl ${
                        card.color === "emerald" ? "bg-emerald-50 text-emerald-600" :
                        card.color === "blue" ? "bg-blue-50 text-blue-600" :
                        card.color === "amber" ? "bg-amber-50 text-amber-600" :
                        "bg-[#ECFDF5] text-emerald-700"
                      }`}>
                        <IconComp className="w-4 h-4" />
                      </div>
                    </div>
                    <div>
                      <span className="text-2xl font-bold font-mono tracking-tight text-[#111827]">
                        {card.value}
                      </span>
                      <span className="text-sm font-semibold text-[#111827]">{card.suffix}</span>
                      <p className="text-[11px] text-[#9CA3AF] mt-1">{card.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Actions & Setup Space */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column: Quick Bot Setup instructional placeholder */}
              <div className="bg-gradient-to-tr from-[#1E293B] to-[#0F172A] text-white rounded-3xl p-6 shadow-xl relative overflow-hidden lg:col-span-2">
                <div className="absolute right-0 bottom-0 translate-x-12 translate-y-12 opacity-5">
                  <Bot className="w-96 h-96" />
                </div>
                
                <h3 className="font-display font-medium text-xl mb-3 tracking-tight">
                  🇺🇿 Telegram Botni ishga tushirish bo'yicha yo'riqnoma
                </h3>
                <p className="text-sm text-slate-300 mb-6 leading-relaxed">
                  Xodimlar davomatini avtomatlashtirish, kruglyash (video-xabar) yordamida yuzni tekshirish va oyliklarni hisoblash uchun bepul Telegram botingizni ulab oling.
                </p>

                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 border border-emerald-500/30">
                      1
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">Bot oching (@BotFather)</p>
                      <p className="text-[11px] text-slate-300 mt-0.5">Telegramga kirib `@BotFather` orqali `/newbot` buyrug'ini yozing va Bot Token oling.</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 border border-emerald-500/30">
                      2
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">Panelga token kiritib ulaning</p>
                      <p className="text-[11px] text-slate-300 mt-0.5">Chap menyudagi "Sozlamalar" bo'limiga kirib Tokenni joylang va "Sinab ko'rish & Saqlash" bosing.</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 border border-emerald-500/30">
                      3
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">Xodimlarni botga taklif qiling</p>
                      <p className="text-[11px] text-slate-300 mt-0.5">Bot ulingach, xodimlaringiz Telegram orqali u yerdagi `/start` tugmasini bosib davomat qila olishadi.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex gap-3">
                  <button 
                    onClick={() => setActiveTab("settings")}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all shadow-md shadow-emerald-700/20"
                  >
                    Tokenni sozlash sahifasi
                  </button>
                  <button 
                    onClick={() => setActiveTab("employees")}
                    className="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 font-semibold text-xs px-5 py-2.5 rounded-xl transition-all"
                  >
                    Xodim qo'shish
                  </button>
                </div>
              </div>

              {/* Right Column: Mini Salary Summary box */}
              <div className="bg-white border border-[#EBECEF] rounded-3xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-xs font-bold text-[#8C93A3] uppercase tracking-wider">Bugungi Davomat holati</h4>
                    <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-mono">
                      Bugun
                    </span>
                  </div>

                  <div className="space-y-3.5">
                    {employees.slice(0, 4).map((emp, idx) => {
                      const todayStr = new Date().toISOString().split("T")[0];
                      const record = attendance.find(a => a.employeeId === emp.id && a.date === todayStr);

                      return (
                        <div key={idx} className="flex items-center justify-between py-2 border-b border-[#F4F5F7] last:border-0">
                          <div>
                            <p className="text-xs font-bold text-[#111827]">{emp.name}</p>
                            <p className="text-[10px] font-mono text-[#9CA3AF]">{emp.startTime} - {emp.endTime}</p>
                          </div>
                          <div>
                            {record ? (
                              <div className="text-right">
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl">
                                  {record.checkIn ? new Date(record.checkIn * 1000).toTimeString().substring(0, 5) : "--:--"}
                                </span>
                                <p className="text-[9px] text-[#9CA3AF] mt-0.5">Faol</p>
                              </div>
                            ) : (
                              <span className="text-[10px] bg-[#FAFBFB] text-[#7B8190] px-2.5 py-1 rounded-xl border border-[#EBECEF] font-semibold">
                                Kelmagan
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button 
                  onClick={() => setActiveTab("attendance")}
                  className="w-full mt-6 bg-[#FAFBFB] hover:bg-[#F4F5F7] text-[#2D3139] border border-[#EBECEF] rounded-2xl py-3 font-semibold text-xs transition-all text-center"
                >
                  Barcha davomat jurnali &gt;
                </button>
              </div>
            </div>

            {/* Monthly Accrued Wages by Employee (Uzbek Excel helper) */}
            <div className="bg-white border border-[#EBECEF] rounded-3xl p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h4 className="font-display font-medium text-base text-[#111827]">
                    💵 Xodimlar hisoblangan oyligi va jami to'lovi ({selectedMonth} oyi uchun)
                  </h4>
                  <p className="text-xs text-[#7B8190] mt-0.5">
                    Excel nusxalash uchun yig'ilgan so'nggi yakuniy hisob-kitoblar.
                  </p>
                </div>
                <div className="text-xs font-mono font-bold bg-amber-50 text-amber-800 border border-amber-100 px-3 py-1.5 rounded-xl">
                  {selectedMonth} oyi
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#F0F1F3]">
                      <th className="pb-3 text-xs font-bold text-[#8C93A3] uppercase">Xodim ismi</th>
                      <th className="pb-3 text-xs font-bold text-[#8C93A3] uppercase font-mono text-center">Kunlar</th>
                      <th className="pb-3 text-xs font-bold text-[#8C93A3] uppercase text-right">Baza stavka</th>
                      <th className="pb-3 text-xs font-bold text-[#8C93A3] uppercase text-right">Kelish-ketish oyligi</th>
                      <th className="pb-3 text-xs font-bold text-[#8C93A3] uppercase text-right">Qo'shilgan (Overtime)</th>
                      <th className="pb-3 text-xs font-bold text-[#8C93A3] uppercase text-right text-rose-600">Jariymalar</th>
                      <th className="pb-3 text-xs font-bold text-[#8C93A3] uppercase text-right text-emerald-700">TO'LANADIGAN SOF MAOSH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => {
                      const calculated = getEmployeeSalaryStats(emp.id);
                      return (
                        <tr key={emp.id} className="border-b border-[#F4F5F7] last:border-none hover:bg-[#FAFBFB]/50 transition-colors">
                          <td className="py-4">
                            <p className="text-xs font-bold text-[#111827]">{emp.name}</p>
                            <p className="text-[10px] text-[#9CA3AF] uppercase font-semibold mt-0.5">
                              {emp.salaryRateType === "hourly" ? "Soatbay tarif" : "Oylikbay tarif"}
                            </p>
                          </td>
                          <td className="py-4 text-xs font-mono font-bold text-center text-[#2D3139]">
                            {calculated.daysPresent} kun
                          </td>
                          <td className="py-4 text-xs font-mono font-semibold text-right text-[#5E6470]">
                            {emp.baseSalaryRate.toLocaleString()} UZS
                          </td>
                          <td className="py-4 text-xs font-mono font-semibold text-right text-[#5E6470]">
                            {calculated.baseWages.toLocaleString()} UZS
                          </td>
                          <td className="py-4 text-xs font-mono font-semibold text-right text-emerald-600">
                            +{calculated.overtimeWages.toLocaleString()} UZS
                          </td>
                          <td className="py-4 text-xs font-mono font-semibold text-right text-rose-500">
                            -{calculated.totalPenalties.toLocaleString()} UZS
                          </td>
                          <td className="py-4 text-xs font-mono font-bold text-right text-emerald-800 bg-[#ECFDF5]/30">
                            {calculated.finalEarned.toLocaleString()} UZS
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------------------- */}
        {/* TAB 2: EMPLOYEES CRUD */}
        {/* ------------------------------------------------------------------------------- */}
        {activeTab === "employees" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <p className="text-xs text-[#5E6470]">
                Jami topilgan xodimlar soni: <span className="font-bold underline">{filteredEmployees.length} ta xodim</span>
              </p>
              <button
                id="add_employee_btn"
                onClick={() => {
                  setEmployeeForm({
                    name: "",
                    startTime: "09:00",
                    endTime: "18:00",
                    startTime2: "",
                    endTime2: "",
                    salaryRateType: "monthly",
                    baseSalaryRate: 4000000,
                    telegramUsername: "",
                    telegramId: "",
                    approved: true
                  });
                  setSelectedEmployee(null);
                  setEmployeeModalOpen(true);
                }}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-5 py-3 rounded-xl transition-all shadow-md shadow-emerald-400/20"
              >
                <Plus className="w-4 h-4" />
                <span>Yangi Xodim Qo'shish</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredEmployees.map((emp) => (
                <div key={emp.id} className="bg-white border border-[#EBECEF] rounded-3xl p-6 hover:shadow-md transition-all relative">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-display font-bold text-base text-[#111827]">{emp.name}</h4>
                      <p className="text-[10px] font-mono text-[#9CA3AF] uppercase font-bold mt-0.5">Xodim ID: {emp.id}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setEmployeeForm(emp);
                          setSelectedEmployee(emp);
                          setEmployeeModalOpen(true);
                        }}
                        className="text-xs bg-gray-50 border border-gray-200 hover:bg-gray-100 text-[#5E6470] font-semibold px-3 py-1.5 rounded-xl transition-all"
                      >
                        Tahrirlash
                      </button>
                      <button
                        onClick={() => deleteEmployee(emp.id)}
                        className="text-xs bg-rose-50 border border-rose-100/50 hover:bg-rose-100 text-rose-700 font-semibold p-1.5 rounded-xl transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-4 border-y border-[#F4F5F7] text-xs">
                    <div>
                      <p className="text-[#9CA3AF] font-medium">Rejali ish vaqti:</p>
                      <p className="font-bold text-[#111827] mt-0.5 flex flex-col gap-1">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-emerald-600" />
                          1: {emp.startTime} - {emp.endTime}
                        </span>
                        {emp.startTime2 && (
                          <span className="flex items-center gap-1 text-slate-500 font-medium">
                            <Clock className="w-3 h-3 text-emerald-400" />
                            2: {emp.startTime2} - {emp.endTime2}
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#9CA3AF] font-medium">Tarif turi & stavka:</p>
                      <p className="font-bold text-[#111827] mt-0.5">
                        {emp.salaryRateType === "hourly" ? "Soatbay" : "Oylikbay"}: <span className="font-mono">{emp.baseSalaryRate.toLocaleString()} UZS</span>
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 flex flex-col gap-1.5 text-xs">
                    <p className="text-[#5E6470]">
                      Telegram username: <span className="font-bold text-[#111827]">{emp.telegramUsername ? `@${emp.telegramUsername}` : "Kiritilmagan"}</span>
                    </p>
                    <p className="text-[#5E6470]">
                      Telegram ID (raqami): <span className="font-bold text-[#111827]">{emp.telegramId || "Ulanmagan (start qilishi kerak)"}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------------------- */}
        {/* TAB 3: ATTENDANCE LOGS */}
        {/* ------------------------------------------------------------------------------- */}
        {activeTab === "attendance" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 border border-[#EBECEF] rounded-2xl">
              <div>
                <p className="text-xs font-bold text-[#111827]">Sana bo'yicha joriy tanlov oyi: <span className="underline font-mono">{selectedMonth}</span></p>
                <p className="text-[11px] text-[#7B8190] mt-0.5">Davomatlar bot orqali real vaqtda kelgan circular vidoe tasdiqlari bilan chiqadi.</p>
              </div>
              <button
                onClick={() => {
                  setManualRecordForm({
                    employeeId: employees[0]?.id || "",
                    date: new Date().toISOString().split("T")[0],
                    checkIn: "09:00",
                    checkOut: "18:00",
                    notes: "Admin qo'shdi (Correction)"
                  });
                  setManualRecordModalOpen(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-5 py-3 rounded-xl transition-all shadow-md shadow-emerald-400/20 self-start sm:self-auto"
              >
                Qo'lda davomat kiritish
              </button>
            </div>

            <div className="bg-white border border-[#EBECEF] rounded-3xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#FAFBFB] border-b border-[#EBECEF]">
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase">Sana</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase">Xodim</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase font-mono text-center">Kelish (Check-In)</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase font-mono text-center">Ketish (Check-Out)</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase text-right">Kechikish</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase text-right">Ishlagan daqiqasi</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase text-right text-emerald-800">Maosh summasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAttendance.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-xs text-[#9CA3AF] font-medium">
                          Ushbu oy uchun davomat qaydlari kiritilmagan.
                        </td>
                      </tr>
                    ) : (
                      filteredAttendance.map((record) => {
                        const inDate = record.checkIn ? new Date(record.checkIn * 1000) : null;
                        const outDate = record.checkOut ? new Date(record.checkOut * 1000) : null;

                        return (
                          <tr key={record.id} className="border-b border-[#F4F5F7] last:border-none hover:bg-[#FAFBFB]/70 transition-colors">
                            <td className="py-4 px-5 text-xs font-mono font-bold text-[#2D3139]">
                              {record.date}
                            </td>
                            <td className="py-4 px-5 text-xs">
                              <p className="font-bold text-[#111827]">{record.name}</p>
                              {record.notes && <p className="text-[9px] text-[#9CA3AF]">{record.notes}</p>}
                            </td>
                            <td className="py-4 px-5 text-center">
                              {inDate ? (
                                <div className="inline-flex flex-col items-center">
                                  <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-xl">
                                    {inDate.toTimeString().substring(0, 5)}
                                  </span>
                                  {record.checkInVideoId && (
                                    <span className="text-[8px] bg-sky-50 text-sky-700 border border-sky-100 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full mt-1 font-mono font-medium">
                                      <Video className="w-2 h-2" /> Video Check
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-[#9CA3AF]">—</span>
                              )}
                            </td>
                            <td className="py-4 px-5 text-center">
                              {outDate ? (
                                <div className="inline-flex flex-col items-center">
                                  <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-xl">
                                    {outDate.toTimeString().substring(0, 5)}
                                  </span>
                                  {record.checkOutVideoId && (
                                    <span className="text-[8px] bg-sky-50 text-sky-700 border border-sky-100 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full mt-1 font-mono font-medium">
                                      <Video className="w-2 h-2" /> Video Check
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-[#9CA3AF]">Aktiv (ketmagan)</span>
                              )}
                            </td>
                            <td className="py-4 px-5 text-right font-mono text-xs text-rose-500 font-bold">
                              {record.latenessMinutes > 0 ? `${record.latenessMinutes} daq` : "—"}
                            </td>
                            <td className="py-4 px-5 text-right font-mono text-xs font-semibold text-[#5E6470]">
                              {record.workedMinutes ? `${Math.floor(record.workedMinutes / 60)}s ${record.workedMinutes % 60}d` : "Noma'lum"}
                            </td>
                            <td className="py-4 px-5 text-right font-mono text-xs font-bold text-emerald-800">
                              {record.finalSalary.toLocaleString()} UZS
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------------------- */}
        {/* TAB 4: PENALTIES */}
        {/* ------------------------------------------------------------------------------- */}
        {activeTab === "penalties" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 border border-[#EBECEF] rounded-2xl">
              <div>
                <h4 className="text-xs font-bold text-[#111827]">Jariymalar va chegirishlar ro'yxat jurnali</h4>
                <p className="text-[11px] text-[#7B8190] mt-0.5">Tizim xodim kechikkanida uni avtomatik chegiradi. Bundan tashqari shaxsiy jarimalar unvoni yozilishi mumkin.</p>
              </div>
              <button
                onClick={() => {
                  setPenaltyForm({
                    employeeId: employees[0]?.id || "",
                    amount: "50000",
                    description: "O'z vaqtida javob bermagani uchun",
                    date: new Date().toISOString().split("T")[0]
                  });
                  setPenaltyModalOpen(true);
                }}
                className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-5 py-3 rounded-xl transition-all shadow-md shadow-rose-400/20 self-start sm:self-auto"
              >
                Yangi jarima yozish
              </button>
            </div>

            <div className="bg-white border border-[#EBECEF] rounded-3xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#FAFBFB] border-b border-[#EBECEF]">
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase">Sana</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase">Xodim</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase">Tafsilot (Sababi)</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase text-right text-rose-600">Jarima summasi</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase text-center">Status</th>
                      <th className="py-3 px-5 text-xs font-bold text-[#8C93A3] uppercase text-center">Amallar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPenalties.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-xs text-[#9CA3AF] font-medium">
                          Ushbu oyda hech bir xodimga nisbatan jarima qo'llanilmagan.
                        </td>
                      </tr>
                    ) : (
                      filteredPenalties.map((item) => {
                        const empObj = employees.find(e => e.id === item.employeeId);
                        return (
                          <tr key={item.id} className="border-b border-[#F4F5F7] last:border-none">
                            <td className="py-4 px-5 text-xs font-mono text-[#2D3139]">
                              {item.date}
                            </td>
                            <td className="py-4 px-5 text-xs font-bold text-[#111827]">
                              {empObj?.name || "O'chirilgan xodim"}
                            </td>
                            <td className="py-4 px-5 text-xs text-[#5E6470] max-w-xs truncate">
                              {item.description}
                            </td>
                            <td className="py-4 px-5 text-right font-mono text-xs text-rose-600 font-bold">
                              {item.amount.toLocaleString()} UZS
                            </td>
                            <td className="py-4 px-5 text-center">
                              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                                item.cleared 
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                                  : "bg-rose-50 text-rose-700 border border-rose-100 animate-pulse"
                              }`}>
                                {item.cleared ? "To'langan/O'chirilgan" : "FAOL"}
                              </span>
                            </td>
                            <td className="py-4 px-5 text-center">
                              {!item.cleared ? (
                                <button
                                  onClick={() => clearPenalty(item.id)}
                                  className="text-[11px] bg-white hover:bg-emerald-50 text-emerald-800 border border-[#EBECEF] hover:border-emerald-200 font-bold px-3 py-1.5 rounded-xl transition-all"
                                >
                                  Yopish / Bekor qilish
                                </button>
                              ) : (
                                <span className="text-[11px] text-[#9CA3AF] font-medium italic">Yopilgan</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------------------- */}
        {/* TAB 5: SETTINGS & TG TOKEN CONFIG */}
        {/* ------------------------------------------------------------------------------- */}
        {activeTab === "settings" && settings && (
          <div className="space-y-8">
            <div className="bg-white border border-[#EBECEF] rounded-3xl p-6 md:p-8">
              <h3 className="font-display font-bold text-lg mb-4 text-[#111827]">
                🤖 Telegram Bot Token Sozlash
              </h3>
              <p className="text-xs text-[#7B8190] leading-relaxed mb-6">
                Tizimning Telegram Botini faollashtirish uchun botingiz tokenini pastga joylashtiring. Token kiritilib saqlangach, bot kelish/ketish video-xabar (kruglyash) davomatini avtomatik qabul qilishni boshlaydi.
              </p>

              {/* Bot Connection test console */}
              <div className="space-y-4 mb-8 max-w-xl">
                <div>
                  <label className="block text-xs font-semibold text-[#2D3139] mb-1.5">
                    Telegram Bot Token (@BotFather yuborgan token):
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      placeholder="Masalan: 582928192:AAEj9Yh8f7..."
                      value={testToken}
                      onChange={(e) => setTestToken(e.target.value)}
                      className="flex-1 bg-white border border-[#EBECEF] rounded-xl px-4 py-3 text-xs text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={testBotToken}
                      disabled={tokenTestStatus.loading}
                      className="bg-[#FAFBFB] hover:bg-[#F4F5F7] text-xs font-bold text-[#111827] px-4 py-3 border border-[#EBECEF] rounded-xl transition-all"
                    >
                      {tokenTestStatus.loading ? "Tekshirilmoqda..." : "Ulanishni tekshirish"}
                    </button>
                  </div>
                </div>

                {tokenTestStatus.text && (
                  <div className={`p-4 rounded-xl border text-xs leading-normal font-sans ${
                    tokenTestStatus.success 
                      ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
                      : "bg-rose-50 border-rose-100 text-rose-800"
                  }`}>
                    <p className="font-semibold">{tokenTestStatus.success ? "Muvaffaqiyatli ulash:" : "Ulanishda xatolik:"}</p>
                    <p className="mt-1 font-medium">{tokenTestStatus.text}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Rates & Seasonal Wage configs */}
            <form onSubmit={saveSettings} className="bg-white border border-[#EBECEF] rounded-3xl p-6 md:p-8 space-y-6">
              <h3 className="font-display font-bold text-lg text-[#111827]">
                ⚙️ Mavsumiy Davomat va Maosh Tariflari
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-[#F4F5F7]">
                <div>
                  <h4 className="text-xs font-bold text-[#111827] uppercase tracking-wider mb-3 text-emerald-800">
                    ☀️ Yozgi Tarif (Aprel - Sentyabr)
                  </h4>
                  <div className="space-y-4 text-xs">
                    <div>
                      <label className="block text-[#5E6470] mb-1.5">Standart soatbay maosh stavkasi (UZS/soat):</label>
                      <input
                        type="number"
                        value={settings.summerRate}
                        onChange={(e) => setSettings({ ...settings, summerRate: Number(e.target.value) })}
                        className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-3 text-[#111827] focus:outline-none focus:border-emerald-500 font-mono font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[#5E6470] mb-1.5">Yozgi overtime stavka (Qo'shimcha ish vaqtlari uchun):</label>
                      <input
                        type="number"
                        value={settings.summerOvertimeRate}
                        onChange={(e) => setSettings({ ...settings, summerOvertimeRate: Number(e.target.value) })}
                        className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-3 text-[#111827] focus:outline-none focus:border-emerald-500 font-mono font-medium"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-[#111827] uppercase tracking-wider mb-3 text-sky-800">
                    ❄️ Qishki Tarif (Oktyabr - Mart)
                  </h4>
                  <div className="space-y-4 text-xs">
                    <div>
                      <label className="block text-[#5E6470] mb-1.5">Standart soatbay qishki maosh (UZS/soat):</label>
                      <input
                        type="number"
                        value={settings.winterRate}
                        onChange={(e) => setSettings({ ...settings, winterRate: Number(e.target.value) })}
                        className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-3 text-[#111827] focus:outline-none focus:border-emerald-500 font-mono font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[#5E6470] mb-1.5">Qishki overtime ish stavkasi (UZS/soat):</label>
                      <input
                        type="number"
                        value={settings.winterOvertimeRate}
                        onChange={(e) => setSettings({ ...settings, winterOvertimeRate: Number(e.target.value) })}
                        className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-3 text-[#111827] focus:outline-none focus:border-emerald-500 font-mono font-medium"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Lateness Penalty rates */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="text-xs">
                  <label className="block font-semibold text-[#111827] mb-1.5">
                    ⏱️ Kechikkan har bir daqiqa uchun jarima summasi (UZS / daqiqa):
                  </label>
                  <input
                    type="number"
                    value={settings.latenessPenaltyPerMinute}
                    onChange={(e) => setSettings({ ...settings, latenessPenaltyPerMinute: Number(e.target.value) })}
                    className="w-full max-w-md bg-white border border-[#EBECEF] rounded-xl px-4 py-3 text-[#111827] focus:outline-none focus:border-emerald-500 font-mono font-semibold"
                  />
                  <p className="text-[10px] text-[#9CA3AF] mt-1">Masalan, 500 bo'lsa xodim 10 daqiqaga kechiksa 5000 so'm jarima hisoblanadi.</p>
                </div>
              </div>

              {/* Action save buttons */}
              <div className="pt-6 border-t border-[#F4F5F7] flex justify-end gap-3">
                <button
                  type="submit"
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-6 py-3.5 rounded-xl transition-all shadow-md shadow-emerald-600/10"
                >
                  <Save className="w-4 h-4" />
                  <span>Mavjud barcha o'zgarishlarni saqlash</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------------------------- */}
      {/* MODAL 1: ADD / EDIT EMPLOYEE */}
      {/* ------------------------------------------------------------------------------- */}
      <AnimatePresence>
        {employeeModalOpen && (
          <div className="fixed inset-0 z-50 bg-[#111827]/30 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-xl border border-[#EBECEF] shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-center pb-4 border-b border-[#F4F5F7]">
                <h4 className="font-display font-bold text-lg text-[#111827]">
                  {selectedEmployee ? "📝 Xodim tahrirlash" : "👤 Yangi xodim qo'shish"}
                </h4>
                <button onClick={() => setEmployeeModalOpen(false)} className="text-[#5E6470] hover:bg-gray-100 p-2 rounded-xl">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="sm:col-span-2">
                  <label className="block text-[#5E6470] font-semibold mb-1">Xodim To'liq Ism-Sharifi:</label>
                  <input
                    type="text"
                    required
                    value={employeeForm.name}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500"
                    placeholder="Masalan: Alisher G'ofurov"
                  />
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">StartTime (Kelishi kutilgan vaqt):</label>
                  <input
                    type="text"
                    value={employeeForm.startTime}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, startTime: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                    placeholder="09:00"
                  />
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">EndTime (Ketishi kutilgan vaqt):</label>
                  <input
                    type="text"
                    value={employeeForm.endTime}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, endTime: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                    placeholder="18:00"
                  />
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Maosh to'lovi hisob turi:</label>
                  <select
                    value={employeeForm.salaryRateType}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, salaryRateType: e.target.value as any })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#2D3139] focus:outline-none focus:border-emerald-500"
                  >
                    <option value="monthly">Monthlybay (Oylik stavka)</option>
                    <option value="hourly">Hourlybay (Soatbay stavka)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Baza maosh stavka miqdori (UZS):</label>
                  <input
                    type="number"
                    value={employeeForm.baseSalaryRate}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, baseSalaryRate: Number(e.target.value) })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Telegram Username (optional):</label>
                  <input
                    type="text"
                    placeholder="@alisher_g"
                    value={employeeForm.telegramUsername || ""}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, telegramUsername: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Telegram ID (raqamli ID):</label>
                  <input
                    type="text"
                    placeholder="Masalan: 38291823"
                    value={employeeForm.telegramId || ""}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, telegramId: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">StartTime2 (2-smena boshlanishi - optional):</label>
                  <input
                    type="text"
                    placeholder="Masalan: 22:00"
                    value={employeeForm.startTime2 || ""}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, startTime2: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">EndTime2 (2-smena tugashi - optional):</label>
                  <input
                    type="text"
                    placeholder="Masalan: 02:00"
                    value={employeeForm.endTime2 || ""}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, endTime2: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-[#F4F5F7] flex justify-end gap-3 text-xs">
                <button
                  onClick={() => setEmployeeModalOpen(false)}
                  className="bg-white border border-[#EBECEF] hover:bg-gray-100 text-[#2D3139] font-bold px-5 py-3 rounded-xl transition-all"
                >
                  Bekor qilish
                </button>
                <button
                  onClick={saveEmployee}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-3 rounded-xl transition-all shadow-md shadow-emerald-400/20"
                >
                  Save (Saqlash)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: MANUAL ATTENDANCE CORRECTION */}
      <AnimatePresence>
        {manualRecordModalOpen && (
          <div className="fixed inset-0 z-50 bg-[#111827]/30 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-md border border-[#EBECEF] shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-center pb-4 border-b border-[#F4F5F7]">
                <h4 className="font-display font-bold text-base text-[#111827]">
                  ✍️ Davomat Ma'lumotlarini tuzatish
                </h4>
                <button onClick={() => setManualRecordModalOpen(false)} className="text-[#5E6470] hover:bg-gray-100 p-2 rounded-xl">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Xodimni tanlang:</label>
                  <select
                    value={manualRecordForm.employeeId}
                    onChange={(e) => setManualRecordForm({ ...manualRecordForm, employeeId: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#2D3139] focus:outline-none focus:border-emerald-500"
                  >
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Sana (Kun):</label>
                  <input
                    type="date"
                    value={manualRecordForm.date}
                    onChange={(e) => setManualRecordForm({ ...manualRecordForm, date: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#5E6470] font-semibold mb-1">Kelish (Check-In) vaqti:</label>
                    <input
                      type="text"
                      placeholder="08:50"
                      value={manualRecordForm.checkIn}
                      onChange={(e) => setManualRecordForm({ ...manualRecordForm, checkIn: e.target.value })}
                      className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[#5E6470] font-semibold mb-1">Ketish (Check-Out) vaqti:</label>
                    <input
                      type="text"
                      placeholder="18:00"
                      value={manualRecordForm.checkOut}
                      onChange={(e) => setManualRecordForm({ ...manualRecordForm, checkOut: e.target.value })}
                      className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Tuzatish tavsifi / Izoh:</label>
                  <input
                    type="text"
                    placeholder="Masalan: Kasal bo'lgani sababli, kechikish hisoblanmasin"
                    value={manualRecordForm.notes}
                    onChange={(e) => setManualRecordForm({ ...manualRecordForm, notes: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-[#F4F5F7] flex justify-end gap-3 text-xs">
                <button
                  onClick={() => setManualRecordModalOpen(false)}
                  className="bg-white border border-[#EBECEF] hover:bg-gray-100 text-[#2D3139] font-bold px-5 py-3 rounded-xl transition-all"
                >
                  Bekor qilish
                </button>
                <button
                  onClick={saveManualRecord}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-3 rounded-xl transition-all shadow-md shadow-emerald-400/20"
                >
                  Saqlash
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: PENALTY FORM CREATOR */}
      <AnimatePresence>
        {penaltyModalOpen && (
          <div className="fixed inset-0 z-50 bg-[#111827]/30 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-md border border-[#EBECEF] shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-center pb-4 border-b border-[#F4F5F7]">
                <h4 className="font-display font-bold text-base text-[#111827]">
                  ⚠️ Yangi Maoshdan chegirladigan Jarima Yozish
                </h4>
                <button onClick={() => setPenaltyModalOpen(false)} className="text-[#5E6470] hover:bg-gray-100 p-2 rounded-xl">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Xodimni tanlang:</label>
                  <select
                    value={penaltyForm.employeeId}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, employeeId: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#2D3139] focus:outline-none focus:border-emerald-500"
                  >
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Sana:</label>
                  <input
                    type="date"
                    value={penaltyForm.date}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, date: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Jarima Miqdori (UZS):</label>
                  <input
                    type="number"
                    value={penaltyForm.amount}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, amount: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500 font-mono font-bold text-rose-700"
                  />
                </div>

                <div>
                  <label className="block text-[#5E6470] font-semibold mb-1">Jarima sababi (Tavsif):</label>
                  <textarea
                    rows={3}
                    placeholder="Masalan: Mijoz bilan qo'pol suhbat yoki tozalik qoidalariga rioya qilmaslik..."
                    value={penaltyForm.description}
                    onChange={(e) => setPenaltyForm({ ...penaltyForm, description: e.target.value })}
                    className="w-full bg-white border border-[#EBECEF] rounded-xl px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-[#F4F5F7] flex justify-end gap-3 text-xs">
                <button
                  onClick={() => setPenaltyModalOpen(false)}
                  className="bg-white border border-[#EBECEF] hover:bg-gray-100 text-[#2D3139] font-bold px-5 py-3 rounded-xl transition-all"
                >
                  Bekor qilish
                </button>
                <button
                  onClick={createPenalty}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-6 py-3 rounded-xl transition-all shadow-md shadow-rose-400/20"
                >
                  Jarima yozish
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
