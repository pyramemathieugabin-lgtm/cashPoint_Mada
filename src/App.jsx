import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { api, queueOperation, getQueuedOperations, clearQueuedOperations, queueRequest, getQueuedRequests, removeQueuedRequest, cacheSet, cacheGet } from "./services";

const operators = ["YAS", "AIRTEL", "ORANGE"];
const types = ["DEPOT", "RETRAIT", "TRANSFERT", "CREDIT"];

const opLabel = { YAS: "Mvola", AIRTEL: "Airtel Money", ORANGE: "Orange Money" };
const typeLabel = { DEPOT: "Depot", RETRAIT: "Retrait", TRANSFERT: "Transfert", CREDIT: "Credit" };
const pageMeta = {
  accueil: { title: "Vue generale", subtitle: "Soldes et activite du jour" },
  historique: { title: "Journal", subtitle: "Mouvements recents" },
  caisse: { title: "Pilotage caisse", subtitle: "Cash et float par operateur" },
  rapport: { title: "Rapports", subtitle: "Indicateurs de performance" },
  tarifs: { title: "Regles tarifaires", subtitle: "Commissions et frais" },
};
const formatAr = (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`;
const formatArPdf = (v) => `${Number(v || 0).toLocaleString("fr-FR").replace(/[\u202F\u00A0]/g, " ")} Ar`;

const areSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const formatHistoryDate = (dateString) => {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (areSameDay(date, today)) return "Aujourd'hui";
  if (areSameDay(date, yesterday)) return "Hier";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
};
const getIsoWeekInfo = (dateInput) => {
  const date = new Date(dateInput);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  const week = String(weekNo).padStart(2, "0");
  return { key: `${utc.getUTCFullYear()}-W${week}`, year: utc.getUTCFullYear(), week: weekNo };
};

function App() {
  const [token, setToken] = useState(localStorage.getItem("cp_token") || "");
  const [isBooting, setIsBooting] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [activePage, setActivePage] = useState("accueil");
  const [mode, setMode] = useState("login");
  const [message, setMessage] = useState("");
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width:1025px)").matches);
  const [isTablet, setIsTablet] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width:481px) and (max-width:1024px)").matches);
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);

  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [user, setUser] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [period, setPeriod] = useState("daily");
  const [history, setHistory] = useState([]);
  const [historyFilter, setHistoryFilter] = useState("");

  const [tariffs, setTariffs] = useState([]);
  const [journals, setJournals] = useState([]);
  const [showTariffForm, setShowTariffForm] = useState(false);
  const [tariffForm, setTariffForm] = useState({ operator: "YAS", operationType: "DEPOT", minAmount: 100, maxAmount: 2000, operatorFee: 0, personalFee: 0, gainCumule: 0 });
  const [editingTariffId, setEditingTariffId] = useState(null);

  const [balances, setBalances] = useState([]);
  const [dayStarted, setDayStarted] = useState(false);
  const [reapproForm, setReapproForm] = useState({ operator: "YAS", cashAmount: 0, mobileAmount: 0 });
  const [showReapproForm, setShowReapproForm] = useState(false);
  const [showStartDayForm, setShowStartDayForm] = useState(false);
  const [startDayForm, setStartDayForm] = useState([
    { operator: "YAS", cashBalance: 0, mobileBalance: 0 },
    { operator: "AIRTEL", cashBalance: 0, mobileBalance: 0 },
    { operator: "ORANGE", cashBalance: 0, mobileBalance: 0 },
  ]);

  const [showOperationForm, setShowOperationForm] = useState(false);
  const [showReferenceEditor, setShowReferenceEditor] = useState(false);
  const [referenceEditorId, setReferenceEditorId] = useState(null);
  const [referenceEditorValue, setReferenceEditorValue] = useState("");
  const [opForm, setOpForm] = useState({ operator: "YAS", operationType: "DEPOT", customerPhone: "", customerName: "", reference: "", amount: "", includeWithdrawalFeeForTransfer: false });
  const [preview, setPreview] = useState(null);
  const [expandedJournalKey, setExpandedJournalKey] = useState(null);
  const [journalDateFilter, setJournalDateFilter] = useState("");
  const [selectedJournalDay, setSelectedJournalDay] = useState(null);
  const [reportView, setReportView] = useState("day");
  const [weekFilter, setWeekFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [selectedWeekReport, setSelectedWeekReport] = useState(null);
  const [selectedMonthReport, setSelectedMonthReport] = useState(null);
  const [selectedYearReport, setSelectedYearReport] = useState(null);

  const authReady = Boolean(token);
  const filteredHistory = useMemo(() => {
    const filter = historyFilter.trim().toLowerCase();
    if (!filter) return history;
    return history.filter((h) => {
      return [h.customerName, h.customerPhone].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(filter)
      );
    });
  }, [history, historyFilter]);

  const groupedHistory = useMemo(() => {
    const sorted = [...filteredHistory].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sorted.reduce((acc, item) => {
      const itemDate = new Date(item.createdAt);
      const key = `${itemDate.getFullYear()}-${itemDate.getMonth() + 1}-${itemDate.getDate()}`;
      const lastGroup = acc[acc.length - 1];
      if (lastGroup && lastGroup.key === key) {
        lastGroup.items.push(item);
      } else {
        acc.push({ key, label: formatHistoryDate(item.createdAt), items: [item] });
      }
      return acc;
    }, []);
  }, [filteredHistory]);

  const openStartDayModal = () => {
    const seed = operators.map((operator) => {
      const existing = balances.find((b) => b.operator === operator);
      return {
        operator,
        cashBalance: Number(existing?.cashBalance || 0),
        mobileBalance: Number(existing?.mobileBalance || 0),
      };
    });
    setStartDayForm(seed);
    setShowStartDayForm(true);
  };

  const openOperationModal = () => {
    if (!dayStarted) {
      setMessage("Demarrez d'abord la journee dans Caisse.");
      return;
    }
    setShowOperationForm(true);
  };

  const fetchAll = async () => {
    try {
      const [me, dash, cash, tariffList, hist, journalsList] = await Promise.all([
        api("/auth/me"),
        api("/dashboard"),
        api("/cashbox"),
        api("/tariffs"),
        api(`/operations/history?period=${period}`),
        api("/cashbox/journals"),
      ]);
      setUser(me);
      setDashboard(dash);
      setBalances(cash.operators || []);
      setDayStarted(Boolean(cash.dayStarted));
      setTariffs(tariffList);
      setHistory(hist);
      setJournals(Array.isArray(journalsList) ? journalsList : []);
      await cacheSet("snapshot", {
        me,
        dash,
        cash,
        tariffList,
        hist,
        journalsList,
      });
    } catch (error) {
      const snapshot = await cacheGet("snapshot");
      if (!snapshot) throw error;
      setUser(snapshot.me || null);
      setDashboard(snapshot.dash || null);
      setBalances(snapshot.cash?.operators || []);
      setDayStarted(Boolean(snapshot.cash?.dayStarted));
      setTariffs(snapshot.tariffList || []);
      setHistory(snapshot.hist || []);
      setJournals(Array.isArray(snapshot.journalsList) ? snapshot.journalsList : []);
      setMessage("Mode hors ligne: données locales affichées.");
    }
  };

  const trySync = async () => {
    if (!authReady || !navigator.onLine) return;
    const queuedRequests = await getQueuedRequests();
    for (const req of queuedRequests) {
      if (req.type === "operation") continue;
      try {
        await api(req.path, { method: req.method, body: JSON.stringify(req.body || {}) });
        await removeQueuedRequest(req.id);
      } catch (_error) {
        // keep queued for next retry
      }
    }
    const queue = await getQueuedOperations();
    if (!queue.length) return;
    const result = await api("/dashboard/sync", { method: "POST", body: JSON.stringify({ operations: queue.map((x) => x.payload) }) });
    await clearQueuedOperations();
    setMessage(`Synchronisation: ${result.synced} OK, ${result.duplicated} doublons, ${result.failed} erreurs`);
  };

  useEffect(() => { const t = setTimeout(() => setIsBooting(false), 900); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const desktopQuery = window.matchMedia("(min-width:1025px)");
    const tabletQuery = window.matchMedia("(min-width:481px) and (max-width:1024px)");
    const update = () => {
      const desktop = desktopQuery.matches;
      const tablet = tabletQuery.matches;
      setIsDesktop(desktop);
      setIsTablet(tablet);
      setSidebarOpen((current) => desktop || (current && tablet));
    };
    update();
    desktopQuery.addEventListener?.("change", update);
    tabletQuery.addEventListener?.("change", update);
    return () => {
      desktopQuery.removeEventListener?.("change", update);
      tabletQuery.removeEventListener?.("change", update);
    };
  }, []);

  useEffect(() => { if (!authReady) return; fetchAll().catch((e) => setMessage(e.message)); trySync().catch(() => {}); }, [authReady, period]);
  useEffect(() => { if (!authReady || !isOnline) return; trySync().then(fetchAll).catch(() => {}); }, [authReady, isOnline]);
  useEffect(() => {
    setSelectedJournalDay(null);
    setSelectedWeekReport(null);
    setSelectedMonthReport(null);
    setSelectedYearReport(null);
  }, [reportView]);

  useEffect(() => {
    if (!authReady || !opForm.amount) return setPreview(null);
    api("/operations/preview", {
      method: "POST",
      body: JSON.stringify({
        operator: opForm.operator,
        operationType: opForm.operationType,
        amount: Number(opForm.amount),
        includeWithdrawalFeeForTransfer: opForm.includeWithdrawalFeeForTransfer,
      }),
    }).then(setPreview).catch(() => setPreview(null));
  }, [opForm, authReady]);

  const onAuth = async (e) => {
    e.preventDefault();
    try {
      if (mode === "signup") await api("/auth/signup", { method: "POST", body: JSON.stringify({ ...authForm, role: "admin" }) });
      const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: authForm.email, password: authForm.password }) });
      localStorage.setItem("cp_token", login.token);
      setToken(login.token);
    } catch (error) { setMessage(error.message); }
  };

  const saveTariff = async (e) => {
    e.preventDefault();
    try {
      if (editingTariffId) await api(`/tariffs/${editingTariffId}`, { method: "PATCH", body: JSON.stringify(tariffForm) });
      else await api("/tariffs/upsert", { method: "POST", body: JSON.stringify(tariffForm) });
      setEditingTariffId(null);
      setShowTariffForm(false);
      await fetchAll();
    } catch (error) { setMessage(error.message); }
  };

  const onEditTariff = (t) => {
    setTariffForm({ operator: t.operator, operationType: t.operationType, minAmount: t.minAmount, maxAmount: t.maxAmount, operatorFee: t.operatorFee, personalFee: t.personalFee, gainCumule: t.gainCumule || 0 });
    setEditingTariffId(t.id);
    setShowTariffForm(true);
  };

  const onDeleteTariff = async (id) => {
    try { await api(`/tariffs/${id}`, { method: "DELETE" }); await fetchAll(); }
    catch (error) { setMessage(error.message); }
  };

  const saveOperation = async (e) => {
    e.preventDefault();
    const payload = {
      operator: opForm.operator,
      operationType: opForm.operationType,
      customerPhone: opForm.customerPhone,
      customerName: opForm.customerName || null,
      reference: opForm.reference || null,
      amount: Number(opForm.amount),
      includeWithdrawalFeeForTransfer: Boolean(opForm.includeWithdrawalFeeForTransfer),
      externalId: crypto.randomUUID(),
    };
    try {
      await queueOperation({ payload, createdAt: new Date().toISOString() });
      if (navigator.onLine) await trySync();
      setShowOperationForm(false);
      setOpForm({ operator: "YAS", operationType: "DEPOT", customerPhone: "", customerName: "", reference: "", amount: "", includeWithdrawalFeeForTransfer: false });
      await fetchAll();
    } catch (error) { setMessage(error.message); }
  };

  const onEditReference = (operation) => {
    setReferenceEditorId(operation.id);
    setReferenceEditorValue(operation.reference || "");
    setShowReferenceEditor(true);
  };

  const saveReference = async (e) => {
    e.preventDefault();
    try {
      if (!referenceEditorId) throw new Error("Aucune operation selectionnee.");
      if (!navigator.onLine) {
        await queueRequest({
          type: "request",
          method: "PATCH",
          path: `/operations/${referenceEditorId}/reference`,
          body: { reference: referenceEditorValue || null },
          createdAt: new Date().toISOString(),
        });
      } else {
        await api(`/operations/${referenceEditorId}/reference`, {
          method: "PATCH",
          body: JSON.stringify({ reference: referenceEditorValue || null }),
        });
      }
      setShowReferenceEditor(false);
      setReferenceEditorId(null);
      setReferenceEditorValue("");
      if (navigator.onLine) await trySync();
      await fetchAll();
    } catch (error) { setMessage(error.message); }
  };

  const cancelOperation = async (id) => {
    try {
      if (!navigator.onLine) {
        await queueRequest({ type: "request", method: "POST", path: `/operations/${id}/cancel`, body: {}, createdAt: new Date().toISOString() });
      } else {
        await api(`/operations/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      }
      if (navigator.onLine) await trySync();
      await fetchAll();
    } catch (error) { setMessage(error.message); }
  };

  const saveReappro = async (e) => {
    e.preventDefault();
    try {
      if (!navigator.onLine) {
        await queueRequest({ type: "request", method: "POST", path: "/cashbox/replenish", body: reapproForm, createdAt: new Date().toISOString() });
      } else {
        await api("/cashbox/replenish", { method: "POST", body: JSON.stringify(reapproForm) });
      }
      setShowReapproForm(false);
      if (navigator.onLine) await trySync();
      await fetchAll();
    }
    catch (error) { setMessage(error.message); }
  };

  const startDay = async (e) => {
    e.preventDefault();
    try {
      if (!navigator.onLine) {
        await queueRequest({ type: "request", method: "POST", path: "/cashbox/day/start", body: { operators: startDayForm }, createdAt: new Date().toISOString() });
      } else {
        await api("/cashbox/day/start", { method: "POST", body: JSON.stringify({ operators: startDayForm }) });
      }
      setShowStartDayForm(false);
      if (navigator.onLine) await trySync();
      await fetchAll();
    }
    catch (error) { setMessage(error.message); }
  };

  const closeDay = async () => {
    try {
      if (!navigator.onLine) {
        await queueRequest({ type: "request", method: "POST", path: "/cashbox/day/close", body: {}, createdAt: new Date().toISOString() });
      } else {
        await api("/cashbox/day/close", { method: "POST", body: JSON.stringify({}) });
      }
      if (navigator.onLine) await trySync();
      await fetchAll();
    }
    catch (error) { setMessage(error.message); }
  };

  const openJournalDay = async (dateValue) => {
    try {
      const day = await api(`/cashbox/journals/day/${dateValue}`);
      setSelectedJournalDay(day);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const exportDayDetailPdf = () => {
    if (!selectedJournalDay) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text(`Détail journée ${selectedJournalDay.date}`, 40, 38);
    doc.setFontSize(11);
    doc.text(`Bonus: ${formatArPdf(selectedJournalDay.totalBonus)} | Gain: ${formatArPdf(selectedJournalDay.totalGain)} | Frais perso: ${formatArPdf(selectedJournalDay.totalPersonalFee)} | Ops: ${selectedJournalDay.totalOps}`, 40, 58);

    autoTable(doc, {
      startY: 74,
      head: [["Opérateur", "Initial Cash", "Restant Cash", "Initial Float", "Restant Float", "Réappro Cash", "Réappro Float"]],
      body: selectedJournalDay.operators.map((op) => [
        opLabel[op.operator],
        formatArPdf(op.openingInitialCash),
        formatArPdf(op.closingFinalCash),
        formatArPdf(op.openingInitialMobile),
        formatArPdf(op.closingFinalMobile),
        formatArPdf(op.reapproCashAmount),
        formatArPdf(op.reapproMobileAmount),
      ]),
    });

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 14,
      head: [["Heure", "Opérateur", "Type", "Montant", "Téléphone", "Client", "Référence", "Gain", "Statut"]],
      body: selectedJournalDay.operations.map((h) => [
        new Date(h.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        opLabel[h.operator],
        h.kind === "TRANSACTION" ? `${typeLabel[h.operationType]} ${opLabel[h.operator]}` : h.kind,
        formatArPdf(h.amount),
        h.customerPhone || "-",
        h.customerName || "-",
        h.reference || "-",
        formatArPdf(h.gain),
        h.isCancelled ? "Annulée" : "Validée",
      ]),
    });

    doc.save(`detail-jour-${selectedJournalDay.date}.pdf`);
  };

  const exportWeekDetailPdf = () => {
    if (!selectedWeekReport) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text(`${selectedWeekReport.label}`, 40, 38);
    doc.setFontSize(11);
    doc.text(`Bonus: ${formatArPdf(selectedWeekReport.totalBonus)} | Gain: ${formatArPdf(selectedWeekReport.totalGain)} | Frais perso: ${formatArPdf(selectedWeekReport.totalPersonalFee)} | Ops: ${selectedWeekReport.totalOps}`, 40, 58);

    autoTable(doc, {
      startY: 74,
      head: [["Opérateur", "Initial Cash", "Restant Cash", "Initial Float", "Restant Float", "Réappro Cash", "Réappro Float"]],
      body: operators.map((operator) => {
        const first = selectedWeekReport.days[0]?.operators?.find((x) => x.operator === operator);
        const last = selectedWeekReport.days[selectedWeekReport.days.length - 1]?.operators?.find((x) => x.operator === operator);
        const reapproCash = selectedWeekReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.reapproCashAmount || 0), 0);
                    const reapproFloat = selectedWeekReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.reapproMobileAmount || 0), 0);
        return [
          opLabel[operator],
          formatArPdf(first?.openingInitialCash),
          formatArPdf(last?.closingFinalCash),
          formatArPdf(first?.openingInitialMobile),
          formatArPdf(last?.closingFinalMobile),
          formatArPdf(reapproCash),
          formatArPdf(reapproFloat),
        ];
      }),
    });

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 14,
      head: [["Jour", "Initial Cash", "Restant Cash", "Initial Float", "Restant Float", "Réappro", "Ops", "Gain", "Frais perso", "Bonus"]],
      body: selectedWeekReport.days.map((d) => [
        formatHistoryDate(d.date),
        formatArPdf(d.totalInitialCash),
        formatArPdf(d.totalFinalCash),
        formatArPdf(d.totalInitialMobile),
        formatArPdf(d.totalFinalMobile),
        formatArPdf(d.totalReapproAmount),
        String(d.totalOps),
        formatArPdf(d.totalGain),
        formatArPdf(d.totalPersonalFee),
        formatArPdf(Number(d.totalGain || 0) + Number(d.totalPersonalFee || 0)),
      ]),
    });

    doc.save(`detail-semaine-${selectedWeekReport.key}.pdf`);
  };

  const reportData = useMemo(() => {
    const reappro = history.filter((h) => h.kind === "REAPPRO");
    const tx = history.filter((h) => h.kind === "TRANSACTION");
    return {
      txCount: tx.length,
      reapproCount: reappro.length,
      gain: tx.reduce((s, x) => s + (x.gain || 0), 0),
      volume: tx.reduce((s, x) => s + (x.amount || 0), 0),
      reapproAmount: reappro.reduce((s, x) => s + (x.amount || 0), 0),
    };
  }, [history]);

  const globalOperatorAlerts = useMemo(() => balances
    .filter((b) => Number(b.cashBalance || 0) < Number(b.mobileBalance || 0))
    .map((b) => `${opLabel[b.operator]}: cash insuffisant`), [balances]);

  const weekBonus = useMemo(() => {
    const today = new Date();
    const day = today.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - diffToMonday);
    weekStart.setHours(0, 0, 0, 0);
    return journals
      .filter((j) => new Date(j.date) >= weekStart)
      .reduce((sum, j) => sum + Number(j.totalGain || 0) + Number(j.totalPersonalFee || 0), 0);
  }, [journals]);

  const filteredJournals = useMemo(() => {
    if (!journalDateFilter) return journals;
    return journals.filter((j) => new Date(j.date).toISOString().slice(0, 10) === journalDateFilter);
  }, [journals, journalDateFilter]);

  const weeklyReports = useMemo(() => {
    const groups = {};
    journals.forEach((j) => {
      const info = getIsoWeekInfo(j.date);
      if (!groups[info.key]) groups[info.key] = { key: info.key, label: `Semaine ${info.week} - ${info.year}`, days: [] };
      groups[info.key].days.push(j);
    });
    return Object.values(groups)
      .map((g) => {
        const days = [...g.days].sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstDay = days[0];
        return {
          ...g,
          days,
          totalOps: days.reduce((s, d) => s + Number(d.totalOps || 0), 0),
          totalGain: days.reduce((s, d) => s + Number(d.totalGain || 0), 0),
          totalPersonalFee: days.reduce((s, d) => s + Number(d.totalPersonalFee || 0), 0),
          totalBonus: days.reduce((s, d) => s + Number(d.totalGain || 0) + Number(d.totalPersonalFee || 0), 0),
          totalReapproAmount: days.reduce((s, d) => s + Number(d.totalReapproAmount || 0), 0),
          initialCashWeek: Number(firstDay?.totalInitialCash || 0),
          initialFloatWeek: Number(firstDay?.totalInitialMobile || 0),
        };
      })
      .sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [journals]);

  const monthlyReports = useMemo(() => {
    const groups = {};
    journals.forEach((j) => {
      const d = new Date(j.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!groups[key]) groups[key] = { key, label: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), days: [] };
      groups[key].days.push(j);
    });
    return Object.values(groups)
      .map((g) => {
        const days = [...g.days].sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstDay = days[0];
        return {
          ...g,
          days,
          totalOps: days.reduce((s, d) => s + Number(d.totalOps || 0), 0),
          totalGain: days.reduce((s, d) => s + Number(d.totalGain || 0), 0),
          totalPersonalFee: days.reduce((s, d) => s + Number(d.totalPersonalFee || 0), 0),
          totalBonus: days.reduce((s, d) => s + Number(d.totalGain || 0) + Number(d.totalPersonalFee || 0), 0),
          totalReapproAmount: days.reduce((s, d) => s + Number(d.totalReapproAmount || 0), 0),
          initialCashMonth: Number(firstDay?.totalInitialCash || 0),
          initialFloatMonth: Number(firstDay?.totalInitialMobile || 0),
        };
      })
      .sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [journals]);

  const filteredWeeklyReports = useMemo(() => {
    if (!weekFilter) return weeklyReports;
    return weeklyReports.filter((w) => w.key === weekFilter);
  }, [weeklyReports, weekFilter]);

  const filteredMonthlyReports = useMemo(() => {
    if (!monthFilter) return monthlyReports;
    return monthlyReports.filter((m) => m.key === monthFilter);
  }, [monthlyReports, monthFilter]);

  const yearlyReports = useMemo(() => {
    const groups = {};
    journals.forEach((j) => {
      const d = new Date(j.date);
      const key = String(d.getFullYear());
      if (!groups[key]) groups[key] = { key, label: `Année ${key}`, days: [] };
      groups[key].days.push(j);
    });
    return Object.values(groups)
      .map((g) => {
        const days = [...g.days].sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstDay = days[0];
        return {
          ...g,
          days,
          totalOps: days.reduce((s, d) => s + Number(d.totalOps || 0), 0),
          totalGain: days.reduce((s, d) => s + Number(d.totalGain || 0), 0),
          totalPersonalFee: days.reduce((s, d) => s + Number(d.totalPersonalFee || 0), 0),
          totalBonus: days.reduce((s, d) => s + Number(d.totalGain || 0) + Number(d.totalPersonalFee || 0), 0),
          totalReapproAmount: days.reduce((s, d) => s + Number(d.totalReapproAmount || 0), 0),
          initialCashYear: Number(firstDay?.totalInitialCash || 0),
          initialFloatYear: Number(firstDay?.totalInitialMobile || 0),
        };
      })
      .sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [journals]);

  const filteredYearlyReports = useMemo(() => {
    if (!yearFilter) return yearlyReports;
    return yearlyReports.filter((y) => y.key === yearFilter);
  }, [yearlyReports, yearFilter]);

  if (isBooting) return <main className="boot"><img src="/logo.png" alt="Cash Point" className="boot-logo" /></main>;

  if (!token) {
    return (
      <main className="auth-shell">
        <form className="auth-box" onSubmit={onAuth}>
          <h1>Cash Point</h1>
          <p>Solution de gestion de caisse mobile</p>
          {mode === "signup" && <input placeholder="Nom complet" value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} />}
          <input placeholder="Email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />
          <input type="password" placeholder="Mot de passe" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
          <button type="submit" className="btn primary">{mode === "signup" ? "Creer mon compte" : "Connexion"}</button>
          <button type="button" className="btn quiet" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "J'ai deja un compte" : "Ouvrir un compte"}</button>
          {message && <small>{message}</small>}
        </form>
      </main>
    );
  }

  const filteredTariffs = tariffs.filter((t) => t.operator === tariffForm.operator && t.operationType === tariffForm.operationType);

  // determine if small phone
  const isPhone = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width:480px)").matches;

  // no auto-open by default; user toggles via logo click

  const icons = {
    accueil: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 11.5L12 4l9 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 21V12h14v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    ),
    historique: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    ),
    caisse: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="7" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M16 3v4M8 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    ),
    rapport: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 14l3-3 4 4 5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    ),
    tarifs: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 7h14M5 17h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    ),
  };

  return (
    <main className={`app-shell ${sidebarOpen && isTablet ? "sidebar-open" : ""}`}>
      <aside className={`left-nav ${sidebarOpen ? "open" : "collapsed"} ${isPhone && sidebarOpen ? "mobile" : ""}`}>
        <div className="brand"><img src="/logo_cash.png" alt="logo" onClick={() => { if (!isDesktop) setSidebarOpen((s) => !s); }} /><div><strong>Cash Point</strong><span>{user?.name || "Utilisateur"}</span></div></div>
        <nav>
          {Object.keys(pageMeta).map((p) => (
            <button
              key={p}
              data-title={pageMeta[p].title}
              className={`nav-item ${activePage === p ? "current" : ""}`}
              onClick={() => {
                setActivePage(p);
                if (!isDesktop) setSidebarOpen(false);
              }}
            >
              <span className="nav-icon" aria-hidden>{icons[p]}</span>
              <span className="nav-text">{pageMeta[p].title}</span>
            </button>
          ))}
        </nav>
        <div className="left-actions">
          <span className={`net ${isOnline ? "on" : "off"}`}>{isOnline ? "En ligne" : "Hors ligne"}</span>
          <button className="btn quiet" onClick={() => { localStorage.removeItem("cp_token"); setToken(""); }}>Deconnexion</button>
        </div>
      </aside>

      <section className="work-area">
        <header className="hero-panel">
          <div>
            <h2>{pageMeta[activePage].title}</h2>
            <p>{pageMeta[activePage].subtitle}</p>
          </div>
          <button className="btn primary" onClick={openOperationModal}>+ Nouvelle operation</button>
        </header>

        {activePage === "accueil" && (
          <section className="view-grid">
            <article className="kpi card-ink kpi-merged">
              <div><h3>Gain total</h3><strong>{formatArPdf(dashboard?.totalGain || 0)}</strong><span>{dashboard?.operationCount || 0} operations</span></div>
              <div><h3>Frais Perso</h3><strong>{formatArPdf(dashboard?.totalPersonalFee || 0)}</strong></div>
              <div><h3>Bonus Total</h3><strong>{formatArPdf(dashboard?.totalBonus || 0)}</strong></div>
            </article>
            <article className="kpi card-soft"><h3>Nombre d'opérations</h3><strong>{dashboard?.operationCount || 0}</strong><span>Transactions de la période</span></article>
            {!!globalOperatorAlerts.length && <article className="alert-card">{globalOperatorAlerts.map((a, i) => <p key={i}>Alerte: {a}</p>)}</article>}
            {balances.map((b) => (
              <article key={b.id} className="operator-card">
                <header className={`badge ${b.operator.toLowerCase()}`}>{opLabel[b.operator]}</header>
                <div className="duo"><div><span>Float</span><strong>{formatArPdf(b.mobileBalance)}</strong></div><div><span>Cash</span><strong>{formatArPdf(b.cashBalance)}</strong></div></div>
              </article>
            ))}
          </section>
        )}

        {activePage === "historique" && (
          <section className="panel">
            <div className="row history-actions">
              <div className="search-field">
                <label>
                  Rechercher client / téléphone
                  <input
                    type="search"
                    value={historyFilter}
                    onChange={(e) => setHistoryFilter(e.target.value)}
                    placeholder="Nom ou numéro de client"
                  />
                </label>
              </div>
              <div className="history-summary">
                
                <strong>{reportData.txCount || 0}</strong> opération{reportData.txCount > 1 ? "s" : ""}
              </div>
            </div>
            <div className="row">
              <button className={`btn ${period === "daily" ? "primary" : "quiet"}`} onClick={() => setPeriod("daily")}>Aujourd'hui</button>
              <button className={`btn ${period === "semester" ? "primary" : "quiet"}`} onClick={() => setPeriod("semester")}>Semestriel</button>
            </div>
            <div className="list">
              <div className="list-row list-header">
                <span>Heure</span>
                <span>Operateur</span>
                <span>Type</span>
                <span>Montant</span>
                <span>Phone</span>
                <span>Client</span>
                <span>Référence</span>
                <span>Gain</span>
                <span>Action</span>
              </div>
              {groupedHistory.length === 0 ? (
                <div className="list-row empty-row">Aucune operation trouvee.</div>
              ) : groupedHistory.map((group) => (
                <div key={group.key}>
                  <div className="list-group-header">
                    <strong>{group.label}</strong> <span>({group.items.length} opération{group.items.length > 1 ? "s" : ""})</span>
                  </div>
                  {group.items.map((h) => {
                    const label = h.kind === "OPENING"
                      ? `Ouverture caisse ${opLabel[h.operator]}`
                      : h.kind === "REAPPRO"
                        ? `Reappro ${opLabel[h.operator]}`
                        : `${typeLabel[h.operationType]} ${opLabel[h.operator]}`;
                    const isMobileHistory = !isDesktop && !isTablet;
                    const canEditReference = h.kind === "TRANSACTION" && !h.isCancelled && (h.referenceEditCount ?? 0) < 2;
                    const timeLabel = new Date(h.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <div
                        className={`list-row ${h.isCancelled ? "cancelled-row" : ""} ${isMobileHistory ? "mobile-row" : ""} ${canEditReference ? "editable-row" : ""}`}
                        key={h.id}
                        onClick={() => canEditReference && onEditReference(h)}
                      >
                        {isMobileHistory ? (
                          <>
                            <div><span className="list-label">Heure</span><strong>{timeLabel}</strong></div>
                            <div><span className="list-label">Operateur</span><span>{opLabel[h.operator]}</span></div>
                            <div><span className="list-label">Type</span><span>{label}</span></div>
                            <div><span className="list-label">Montant</span><span>{formatArPdf(h.amount)}</span></div>
                            <div><span className="list-label">Téléphone</span><span>{h.customerPhone || "-"}</span></div>
                            <div><span className="list-label">Client</span><span>{h.customerName || "-"}</span></div>
                            <div><span className="list-label">Référence</span><span>{h.reference || "-"}</span></div>
                            <div><span className="list-label">Gain</span><strong>{formatArPdf(h.gain)}</strong></div>
                            <div><span className="list-label">Action</span><span className="history-action-cell">{h.canCancel ? <button className="btn danger" type="button" onClick={(e) => { e.stopPropagation(); cancelOperation(h.id); }}>Annuler</button> : (h.isCancelled ? "Annulee" : "-")}</span></div>
                          </>
                        ) : (
                          <>
                            <span>{timeLabel}</span>
                            <span>{opLabel[h.operator]}</span>
                            <span>{label}</span>
                            <span>{formatArPdf(h.amount)}</span>
                            <span>{h.customerPhone || "-"}</span>
                            <span>{h.customerName || "-"}</span>
                            <span>{h.reference || "-"}</span>
                            <strong>{formatArPdf(h.gain)}</strong>
                            <span className="history-action-cell">{h.canCancel ? <button className="btn danger" type="button" onClick={(e) => { e.stopPropagation(); cancelOperation(h.id); }}>Annuler</button> : (h.isCancelled ? "Annulee" : "-")}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        )}

        {activePage === "caisse" && (
          <section className="panel">
            <div className="row">
              {!dayStarted ? <button className="btn primary" onClick={openStartDayModal}>Demarrer la journee</button> : <><button className="btn quiet" onClick={closeDay}>Fermer la journee</button><button className="btn primary" onClick={() => setShowReapproForm(true)}>Reapprovisionner</button></>}
            </div>
            <div className="view-grid">{balances.map((b) => <article key={b.id} className="operator-card"><header className={`badge ${b.operator.toLowerCase()}`}>{opLabel[b.operator]}</header><div className="duo"><div><span>Float</span><strong>{formatArPdf(b.mobileBalance)}</strong></div><div><span>Cash</span><strong>{formatArPdf(b.cashBalance)}</strong></div></div></article>)}</div>
          </section>
        )}

        {activePage === "rapport" && (
          <section className="panel report-panel">
            <div className="row report-tabs">
              <button className={`btn ${reportView === "day" ? "primary" : "quiet"}`} type="button" onClick={() => setReportView("day")}>Par jour</button>
              <button className={`btn ${reportView === "week" ? "primary" : "quiet"}`} type="button" onClick={() => setReportView("week")}>Par semaine</button>
              <button className={`btn ${reportView === "month" ? "primary" : "quiet"}`} type="button" onClick={() => setReportView("month")}>Par mois</button>
              <button className={`btn ${reportView === "year" ? "primary" : "quiet"}`} type="button" onClick={() => setReportView("year")}>Par an</button>
            </div>

            {reportView === "day" && !selectedJournalDay && (
              <>
                <div className="report-week-card">
                  <span>Bonus total de la semaine actuelle</span>
                  <strong>{formatArPdf(weekBonus)}</strong>
                </div>
                <div className="row report-tools">
                  <label className="search-field">
                    <span>Rechercher par date</span>
                    <input type="date" value={journalDateFilter} onChange={(e) => setJournalDateFilter(e.target.value)} />
                  </label>
                  {journalDateFilter && <button className="btn quiet" type="button" onClick={() => setJournalDateFilter("")}>Effacer</button>}
                </div>
                <h3>Journaux enregistrés</h3>
                <div className="journal-table-wrap">
                  <table className="journal-list-table">
                    <thead><tr><th>Date</th><th>Initial Float</th><th>Restant Float</th><th>Initial Cash</th><th>Restant Cash</th><th>Op total</th><th>Gain total</th><th>Frais perso</th><th>Actions</th></tr></thead>
                    <tbody>
                      {filteredJournals.map((j, idx) => {
                        const dayKey = j.date ? new Date(j.date).toISOString().slice(0, 10) : `j-${idx}`;
                        return <tr key={dayKey} className="journal-row"><td>{formatHistoryDate(j.date)}</td><td>{formatArPdf(j.totalInitialMobile)}</td><td>{formatArPdf(j.totalFinalMobile)}</td><td>{formatArPdf(j.totalInitialCash)}</td><td>{formatArPdf(j.totalFinalCash)}</td><td>{j.totalOps}</td><td>{formatArPdf(j.totalGain)}</td><td>{formatArPdf(j.totalPersonalFee)}</td><td><button className="btn quiet" type="button" onClick={() => openJournalDay(dayKey)}>Details</button></td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {reportView === "day" && selectedJournalDay && (
              <>
                <div className="row between"><h3>Détails journée: {selectedJournalDay.date}</h3><div className="row"><button className="btn primary" type="button" onClick={exportDayDetailPdf}>Exporter PDF</button><button className="btn quiet" type="button" onClick={() => setSelectedJournalDay(null)}>Retour</button></div></div>
                <section className="view-grid report-kpis">
                  <article className="kpi card-ink"><h3>Bonus total</h3><strong>{formatArPdf(selectedJournalDay.totalBonus)}</strong></article>
                  <article className="kpi card-soft"><h3>Gain cumulé</h3><strong>{formatArPdf(selectedJournalDay.totalGain)}</strong></article>
                  <article className="kpi card-soft"><h3>Frais perso</h3><strong>{formatArPdf(selectedJournalDay.totalPersonalFee)}</strong></article>
                  <article className="kpi card-soft"><h3>Nombre d'opérations</h3><strong>{selectedJournalDay.totalOps}</strong></article>
                </section>
                <h4>Caisses par opérateur</h4>
                <div className="view-grid">
                  {selectedJournalDay.operators.map((op) => (
                    <article key={op.operator} className="operator-card">
                      <header className={`badge ${op.operator.toLowerCase()}`}>{opLabel[op.operator]}</header>
                      <div className="duo">
                        <div><span>Initial Float</span><strong>{formatArPdf(op.openingInitialMobile)}</strong></div>
                        <div><span>Restant Float</span><strong>{formatArPdf(op.closingFinalMobile)}</strong></div>
                        <div><span>Initial Cash</span><strong>{formatArPdf(op.openingInitialCash)}</strong></div>
                        <div><span>Restant Cash</span><strong>{formatArPdf(op.closingFinalCash)}</strong></div>
                        <div><span>Réappro Cash</span><strong>{formatArPdf(op.reapproCashAmount)}</strong></div>
                        <div><span>Réappro Float</span><strong>{formatArPdf(op.reapproMobileAmount)}</strong></div>
                      </div>
                    </article>
                  ))}
                </div>
                <h4>Liste des opérations du jour</h4>
                <div className="list">
                  <div className="list-row list-header">
                    <span>Heure</span><span>Opérateur</span><span>Type</span><span>Montant</span><span>Téléphone</span><span>Client</span><span>Référence</span><span>Gain</span><span>Statut</span>
                  </div>
                  {selectedJournalDay.operations.map((h) => (
                    <div key={h.id} className={`list-row ${h.isCancelled ? "cancelled-row" : ""}`}>
                      <span>{new Date(h.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                      <span>{opLabel[h.operator]}</span>
                      <span>{h.kind === "TRANSACTION" ? `${typeLabel[h.operationType]} ${opLabel[h.operator]}` : h.kind}</span>
                      <span>{formatArPdf(h.amount)}</span>
                      <span>{h.customerPhone || "-"}</span>
                      <span>{h.customerName || "-"}</span>
                      <span>{h.reference || "-"}</span>
                      <strong>{formatArPdf(h.gain)}</strong>
                      <span>{h.isCancelled ? "Annulée" : "Validée"}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {reportView === "week" && !selectedWeekReport && (
              <>
                <div className="row report-tools">
                  <label className="search-field"><span>Rechercher par semaine</span><input type="week" value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)} /></label>
                  {weekFilter && <button className="btn quiet" type="button" onClick={() => setWeekFilter("")}>Effacer</button>}
                </div>
                <h3>Rapports hebdomadaires</h3>
                <div className="journal-table-wrap">
                  <table className="journal-list-table">
                    <thead><tr><th>Semaine</th><th>Ops</th><th>Gain</th><th>Frais perso</th><th>Bonus</th><th>Réappro</th><th>Actions</th></tr></thead>
                    <tbody>
                      {filteredWeeklyReports.map((w) => <tr key={w.key} className="journal-row"><td>{w.label}</td><td>{w.totalOps}</td><td>{formatArPdf(w.totalGain)}</td><td>{formatArPdf(w.totalPersonalFee)}</td><td>{formatArPdf(w.totalBonus)}</td><td>{formatArPdf(w.totalReapproAmount)}</td><td><button className="btn quiet" type="button" onClick={() => setSelectedWeekReport(w)}>Details</button></td></tr>)}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {reportView === "week" && selectedWeekReport && (
              <>
                <div className="row between"><h3>Détails {selectedWeekReport.label}</h3><div className="row"><button className="btn primary" type="button" onClick={exportWeekDetailPdf}>Exporter PDF</button><button className="btn quiet" type="button" onClick={() => setSelectedWeekReport(null)}>Retour</button></div></div>
                <section className="view-grid report-kpis">
                  <article className="kpi card-soft"><h3>Caisse initiale semaine (Cash)</h3><strong>{formatArPdf(selectedWeekReport.initialCashWeek)}</strong></article>
                  <article className="kpi card-soft"><h3>Caisse initiale semaine (Float)</h3><strong>{formatArPdf(selectedWeekReport.initialFloatWeek)}</strong></article>
                  <article className="kpi card-soft"><h3>Réappro semaine</h3><strong>{formatArPdf(selectedWeekReport.totalReapproAmount)}</strong></article>
                  <article className="kpi card-ink"><h3>Bonus semaine</h3><strong>{formatArPdf(selectedWeekReport.totalBonus)}</strong></article>
                </section>
                <section className="view-grid report-kpis">
                  <article className="kpi card-soft"><h3>Gain semaine</h3><strong>{formatArPdf(selectedWeekReport.totalGain)}</strong></article>
                  <article className="kpi card-soft"><h3>Frais perso semaine</h3><strong>{formatArPdf(selectedWeekReport.totalPersonalFee)}</strong></article>
                  <article className="kpi card-soft"><h3>Nombre d'opérations</h3><strong>{selectedWeekReport.totalOps}</strong></article>
                  <article className="kpi card-soft"><h3>Nombre de jours</h3><strong>{selectedWeekReport.days.length}</strong></article>
                </section>
                <h4>Caisses par opérateur (début/fin semaine)</h4>
                <div className="view-grid">
                  {operators.map((operator) => {
                    const first = selectedWeekReport.days[0]?.operators?.find((x) => x.operator === operator);
                    const last = selectedWeekReport.days[selectedWeekReport.days.length - 1]?.operators?.find((x) => x.operator === operator);
                    const gain = selectedWeekReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.gain || 0), 0);
                    const pf = selectedWeekReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.personalFee || 0), 0);
                    const ops = selectedWeekReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.txCount || 0), 0);
                    const reapproCash = selectedWeekReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.reapproCashAmount || 0), 0);
                    const reapproFloat = selectedWeekReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.reapproMobileAmount || 0), 0);
                    return (
                      <article key={operator} className="operator-card">
                        <header className={`badge ${operator.toLowerCase()}`}>{opLabel[operator]}</header>
                        <div className="duo">
                          <div><span>Initial Cash</span><strong>{formatArPdf(first?.openingInitialCash)}</strong></div>
                          <div><span>Restant Cash</span><strong>{formatArPdf(last?.closingFinalCash)}</strong></div>
                          <div><span>Initial Float</span><strong>{formatArPdf(first?.openingInitialMobile)}</strong></div>
                          <div><span>Restant Float</span><strong>{formatArPdf(last?.closingFinalMobile)}</strong></div>
                          <div><span>Ops</span><strong>{ops}</strong></div>
                          <div><span>Réappro Cash</span><strong>{formatArPdf(reapproCash)}</strong></div>
                          <div><span>Réappro Float</span><strong>{formatArPdf(reapproFloat)}</strong></div>
                          <div><span>Bonus</span><strong>{formatArPdf(gain + pf)}</strong></div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <h4>Détail par jour</h4>
                <div className="journal-table-wrap"><table className="journal-list-table"><thead><tr><th>Jour</th><th>Initial Cash</th><th>Restant Cash</th><th>Initial Float</th><th>Restant Float</th><th>Réappro</th><th>Ops</th><th>Gain</th><th>Frais perso</th><th>Bonus</th></tr></thead><tbody>{selectedWeekReport.days.map((d) => <tr key={d.dateKey || d.date}><td>{formatHistoryDate(d.date)}</td><td>{formatArPdf(d.totalInitialCash)}</td><td>{formatArPdf(d.totalFinalCash)}</td><td>{formatArPdf(d.totalInitialMobile)}</td><td>{formatArPdf(d.totalFinalMobile)}</td><td>{formatArPdf(d.totalReapproAmount)}</td><td>{d.totalOps}</td><td>{formatArPdf(d.totalGain)}</td><td>{formatArPdf(d.totalPersonalFee)}</td><td>{formatArPdf(Number(d.totalGain || 0) + Number(d.totalPersonalFee || 0))}</td></tr>)}</tbody></table></div>
              </>
            )}

            {reportView === "month" && !selectedMonthReport && (
              <>
                <div className="row report-tools">
                  <label className="search-field"><span>Rechercher par mois</span><input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} /></label>
                  {monthFilter && <button className="btn quiet" type="button" onClick={() => setMonthFilter("")}>Effacer</button>}
                </div>
                <h3>Rapports mensuels</h3>
                <div className="journal-table-wrap"><table className="journal-list-table"><thead><tr><th>Mois</th><th>Ops</th><th>Gain</th><th>Frais perso</th><th>Bonus</th><th>Réappro</th><th>Actions</th></tr></thead><tbody>{filteredMonthlyReports.map((m) => <tr key={m.key} className="journal-row"><td>{m.label}</td><td>{m.totalOps}</td><td>{formatArPdf(m.totalGain)}</td><td>{formatArPdf(m.totalPersonalFee)}</td><td>{formatArPdf(m.totalBonus)}</td><td>{formatArPdf(m.totalReapproAmount)}</td><td><button className="btn quiet" type="button" onClick={() => setSelectedMonthReport(m)}>Details</button></td></tr>)}</tbody></table></div>
              </>
            )}

            {reportView === "month" && selectedMonthReport && (
              <>
                <div className="row between"><h3>Détails {selectedMonthReport.label}</h3><button className="btn quiet" type="button" onClick={() => setSelectedMonthReport(null)}>Retour</button></div>
                <section className="view-grid report-kpis">
                  <article className="kpi card-soft"><h3>Caisse initiale mois (Cash)</h3><strong>{formatArPdf(selectedMonthReport.initialCashMonth)}</strong></article>
                  <article className="kpi card-soft"><h3>Caisse initiale mois (Float)</h3><strong>{formatArPdf(selectedMonthReport.initialFloatMonth)}</strong></article>
                  <article className="kpi card-soft"><h3>Réappro mois</h3><strong>{formatArPdf(selectedMonthReport.totalReapproAmount)}</strong></article>
                  <article className="kpi card-ink"><h3>Bonus mois</h3><strong>{formatArPdf(selectedMonthReport.totalBonus)}</strong></article>
                </section>
                <section className="view-grid report-kpis">
                  <article className="kpi card-soft"><h3>Gain mois</h3><strong>{formatArPdf(selectedMonthReport.totalGain)}</strong></article>
                  <article className="kpi card-soft"><h3>Frais perso mois</h3><strong>{formatArPdf(selectedMonthReport.totalPersonalFee)}</strong></article>
                  <article className="kpi card-soft"><h3>Nombre d'opérations</h3><strong>{selectedMonthReport.totalOps}</strong></article>
                  <article className="kpi card-soft"><h3>Nombre de jours</h3><strong>{selectedMonthReport.days.length}</strong></article>
                </section>
                <h4>Caisses par opérateur (début/fin mois)</h4>
                <div className="view-grid">
                  {operators.map((operator) => {
                    const first = selectedMonthReport.days[0]?.operators?.find((x) => x.operator === operator);
                    const last = selectedMonthReport.days[selectedMonthReport.days.length - 1]?.operators?.find((x) => x.operator === operator);
                    const gain = selectedMonthReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.gain || 0), 0);
                    const pf = selectedMonthReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.personalFee || 0), 0);
                    const ops = selectedMonthReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.txCount || 0), 0);
                    const reapproCash = selectedMonthReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.reapproCashAmount || 0), 0);
                    const reapproFloat = selectedMonthReport.days.reduce((s, d) => s + Number(d.operators?.find((x) => x.operator === operator)?.reapproMobileAmount || 0), 0);
                    return (
                      <article key={operator} className="operator-card">
                        <header className={`badge ${operator.toLowerCase()}`}>{opLabel[operator]}</header>
                        <div className="duo">
                          <div><span>Initial Cash</span><strong>{formatArPdf(first?.openingInitialCash)}</strong></div>
                          <div><span>Restant Cash</span><strong>{formatArPdf(last?.closingFinalCash)}</strong></div>
                          <div><span>Initial Float</span><strong>{formatArPdf(first?.openingInitialMobile)}</strong></div>
                          <div><span>Restant Float</span><strong>{formatArPdf(last?.closingFinalMobile)}</strong></div>
                          <div><span>Ops</span><strong>{ops}</strong></div>
                          <div><span>Réappro Cash</span><strong>{formatArPdf(reapproCash)}</strong></div>
                          <div><span>Réappro Float</span><strong>{formatArPdf(reapproFloat)}</strong></div>
                          <div><span>Bonus</span><strong>{formatArPdf(gain + pf)}</strong></div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <h4>Détail par jour</h4>
                <div className="journal-table-wrap"><table className="journal-list-table"><thead><tr><th>Jour</th><th>Initial Cash</th><th>Restant Cash</th><th>Initial Float</th><th>Restant Float</th><th>Réappro</th><th>Ops</th><th>Gain</th><th>Frais perso</th><th>Bonus</th></tr></thead><tbody>{selectedMonthReport.days.map((d) => <tr key={d.dateKey || d.date}><td>{formatHistoryDate(d.date)}</td><td>{formatArPdf(d.totalInitialCash)}</td><td>{formatArPdf(d.totalFinalCash)}</td><td>{formatArPdf(d.totalInitialMobile)}</td><td>{formatArPdf(d.totalFinalMobile)}</td><td>{formatArPdf(d.totalReapproAmount)}</td><td>{d.totalOps}</td><td>{formatArPdf(d.totalGain)}</td><td>{formatArPdf(d.totalPersonalFee)}</td><td>{formatArPdf(Number(d.totalGain || 0) + Number(d.totalPersonalFee || 0))}</td></tr>)}</tbody></table></div>
              </>
            )}

            {reportView === "year" && !selectedYearReport && (
              <>
                <div className="row report-tools">
                  <label className="search-field"><span>Rechercher par année</span><input type="number" min="2000" max="2100" step="1" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} placeholder="2026" /></label>
                  {yearFilter && <button className="btn quiet" type="button" onClick={() => setYearFilter("")}>Effacer</button>}
                </div>
                <h3>Rapports annuels</h3>
                <div className="journal-table-wrap"><table className="journal-list-table"><thead><tr><th>Année</th><th>Ops</th><th>Gain</th><th>Frais perso</th><th>Bonus</th><th>Réappro</th><th>Actions</th></tr></thead><tbody>{filteredYearlyReports.map((y) => <tr key={y.key} className="journal-row"><td>{y.label}</td><td>{y.totalOps}</td><td>{formatArPdf(y.totalGain)}</td><td>{formatArPdf(y.totalPersonalFee)}</td><td>{formatArPdf(y.totalBonus)}</td><td>{formatArPdf(y.totalReapproAmount)}</td><td><button className="btn quiet" type="button" onClick={() => setSelectedYearReport(y)}>Details</button></td></tr>)}</tbody></table></div>
              </>
            )}

            {reportView === "year" && selectedYearReport && (
              <>
                <div className="row between"><h3>Détails {selectedYearReport.label}</h3><button className="btn quiet" type="button" onClick={() => setSelectedYearReport(null)}>Retour</button></div>
                <section className="view-grid report-kpis">
                  <article className="kpi card-soft"><h3>Caisse initiale année (Cash)</h3><strong>{formatArPdf(selectedYearReport.initialCashYear)}</strong></article>
                  <article className="kpi card-soft"><h3>Caisse initiale année (Float)</h3><strong>{formatArPdf(selectedYearReport.initialFloatYear)}</strong></article>
                  <article className="kpi card-soft"><h3>Réappro année</h3><strong>{formatArPdf(selectedYearReport.totalReapproAmount)}</strong></article>
                  <article className="kpi card-ink"><h3>Bonus année</h3><strong>{formatArPdf(selectedYearReport.totalBonus)}</strong></article>
                </section>
                <section className="view-grid report-kpis">
                  <article className="kpi card-soft"><h3>Gain année</h3><strong>{formatArPdf(selectedYearReport.totalGain)}</strong></article>
                  <article className="kpi card-soft"><h3>Frais perso année</h3><strong>{formatArPdf(selectedYearReport.totalPersonalFee)}</strong></article>
                  <article className="kpi card-soft"><h3>Nombre d'opérations</h3><strong>{selectedYearReport.totalOps}</strong></article>
                  <article className="kpi card-soft"><h3>Nombre de jours</h3><strong>{selectedYearReport.days.length}</strong></article>
                </section>
                <h4>Détail par jour</h4>
                <div className="journal-table-wrap"><table className="journal-list-table"><thead><tr><th>Jour</th><th>Initial Cash</th><th>Restant Cash</th><th>Initial Float</th><th>Restant Float</th><th>Réappro</th><th>Ops</th><th>Gain</th><th>Frais perso</th><th>Bonus</th></tr></thead><tbody>{selectedYearReport.days.map((d) => <tr key={d.dateKey || d.date}><td>{formatHistoryDate(d.date)}</td><td>{formatArPdf(d.totalInitialCash)}</td><td>{formatArPdf(d.totalFinalCash)}</td><td>{formatArPdf(d.totalInitialMobile)}</td><td>{formatArPdf(d.totalFinalMobile)}</td><td>{formatArPdf(d.totalReapproAmount)}</td><td>{d.totalOps}</td><td>{formatArPdf(d.totalGain)}</td><td>{formatArPdf(d.totalPersonalFee)}</td><td>{formatArPdf(Number(d.totalGain || 0) + Number(d.totalPersonalFee || 0))}</td></tr>)}</tbody></table></div>
              </>
            )}
          </section>
        )}

        {activePage === "tarifs" && (
          <section className="panel">
            <div className="row">
              {operators.map((o) => (
                <button
                  key={o}
                  className={`btn operator-btn ${o.toLowerCase()} ${
                    tariffForm.operator === o ? "active" : ""
                  }`}
                  onClick={() =>
                    setTariffForm({ ...tariffForm, operator: o })
                  }
                >
                  {opLabel[o]}
                </button>
              ))}
            </div>
            <div className="row">{types.map((t) => <button key={t} className={`btn ${tariffForm.operationType === t ? "primary" : "quiet"}`} onClick={() => setTariffForm({ ...tariffForm, operationType: t })}>{typeLabel[t]}</button>)}</div>
            <div className="row between"><strong>{opLabel[tariffForm.operator]} - {typeLabel[tariffForm.operationType]}</strong><button className="btn primary" onClick={() => setShowTariffForm(true)}>Ajouter tranche</button></div>
            <div className="list">{filteredTariffs.map((t) => <article className="tariff-row" key={t.id}><h4>{formatArPdf(t.minAmount)} a {formatArPdf(t.maxAmount)}</h4><p>Frais operateur: <strong>{formatArPdf(t.operatorFee)}</strong></p><p>Frais personnel: <strong>{formatArPdf(t.personalFee)}</strong></p><p>Gain cumulé: <strong>{formatArPdf(t.gainCumule || 0)}</strong></p><p>Frais client: <strong>{formatArPdf((t.operatorFee || 0) + (t.personalFee || 0))}</strong></p><div className="row"><button className="btn quiet" type="button" onClick={() => onEditTariff(t)}>Modifier</button><button className="btn danger" type="button" onClick={() => onDeleteTariff(t.id)}>Supprimer</button></div></article>)}</div>
          </section>
        )}

        {message && <p className="toast">{message}</p>}
      </section>

      {showOperationForm && (
        <div className="overlay" onClick={() => setShowOperationForm(false)}>
          <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={saveOperation}>
            <h3>Nouvelle operation</h3>
            <div className="form-grid">
              <label><span>Operateur</span><select value={opForm.operator} onChange={(e) => setOpForm({ ...opForm, operator: e.target.value })}>{operators.map((o) => <option key={o} value={o}>{opLabel[o]}</option>)}</select></label>
              <label>
                <span>Type</span>
                <select
                  value={opForm.operationType}
                  onChange={(e) =>
                    setOpForm({
                      ...opForm,
                      operationType: e.target.value,
                    })
                  }
                >
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {typeLabel[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label><span>Telephone client</span><input value={opForm.customerPhone} onChange={(e) => setOpForm({ ...opForm, customerPhone: e.target.value })} /></label>
              <label><span>Nom client</span><input value={opForm.customerName} onChange={(e) => setOpForm({ ...opForm, customerName: e.target.value })} /></label>
              <label><span>Reference (facultatif)</span><input value={opForm.reference} onChange={(e) => setOpForm({ ...opForm, reference: e.target.value })} /></label>
              <label><span>Montant</span><input type="number" value={opForm.amount} onChange={(e) => setOpForm({ ...opForm, amount: e.target.value })} /></label>
              {opForm.operationType === "TRANSFERT" && (
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={opForm.includeWithdrawalFeeForTransfer}
                    onChange={(e) =>
                      setOpForm({
                        ...opForm,
                        includeWithdrawalFeeForTransfer: e.target.checked,
                      })
                    }
                  />
                  <span>Ajouter un frais de retrait</span>
                </label>
              )}
            </div>
            <div className="preview-box">
              <p>
                Frais client :
                <strong> {formatArPdf(preview?.clientFee || 0)}</strong>
              </p>
              <p>
                Total à payér par le client :
                <strong> {formatArPdf(preview?.totalFee || 0)}</strong>
              </p>
              {opForm.operationType === "TRANSFERT" &&
                opForm.includeWithdrawalFeeForTransfer && (
                  <small className="extra-fee-note">
                    ✓ Frais de retrait ajouté
                  </small>
                )}

              <p>
                Gain cumulé :
                <strong> {formatArPdf(preview?.gain || 0)}</strong>
              </p>
            </div>
            <div className="row"><button type="button" className="btn quiet" onClick={() => setShowOperationForm(false)}>Annuler</button><button type="submit" className="btn primary">Enregistrer</button></div>
          </form>
        </div>
      )}

      {showTariffForm && (
        <div className="overlay" onClick={() => setShowTariffForm(false)}>
          <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={saveTariff}>
            <h3>{editingTariffId ? "Modifier tranche" : "Ajouter tranche"}</h3>
            <div className="form-grid">
              <label><span>Min</span><input type="number" value={tariffForm.minAmount} onChange={(e) => setTariffForm({ ...tariffForm, minAmount: Number(e.target.value) })} /></label>
              <label><span>Max</span><input type="number" value={tariffForm.maxAmount} onChange={(e) => setTariffForm({ ...tariffForm, maxAmount: Number(e.target.value) })} /></label>
              <label><span>Frais operateur</span><input type="number" value={tariffForm.operatorFee} onChange={(e) => setTariffForm({ ...tariffForm, operatorFee: Number(e.target.value) })} /></label>
              <label><span>Frais personnel</span><input type="number" value={tariffForm.personalFee} onChange={(e) => setTariffForm({ ...tariffForm, personalFee: Number(e.target.value) })} /></label>
              <label><span>Gain cumulé</span><input type="number" value={tariffForm.gainCumule} onChange={(e) => setTariffForm({ ...tariffForm, gainCumule: Number(e.target.value) })} /></label>
            </div>
            <div className="row"><button type="button" className="btn quiet" onClick={() => { setShowTariffForm(false); setEditingTariffId(null); }}>Annuler</button><button type="submit" className="btn primary">Valider</button></div>
          </form>
        </div>
      )}

      {showReferenceEditor && (
        <div className="overlay" onClick={() => setShowReferenceEditor(false)}>
          <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={saveReference}>
            <h3>Modifier la référence</h3>
            <div className="form-grid">
              <label><span>Référence</span><input value={referenceEditorValue} onChange={(e) => setReferenceEditorValue(e.target.value)} /></label>
            </div>
            <div className="row"><button type="button" className="btn quiet" onClick={() => setShowReferenceEditor(false)}>Annuler</button><button type="submit" className="btn primary">Enregistrer</button></div>
          </form>
        </div>
      )}

      {showReapproForm && (
        <div className="overlay" onClick={() => setShowReapproForm(false)}>
          <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={saveReappro}>
            <h3>Reapprovisionner</h3>
            <div className="form-grid">
              <label><span>Operateur</span><select value={reapproForm.operator} onChange={(e) => setReapproForm({ ...reapproForm, operator: e.target.value })}>{operators.map((o) => <option key={o} value={o}>{opLabel[o]}</option>)}</select></label>
              <label><span>Montant cash</span><input type="number" value={reapproForm.cashAmount} onChange={(e) => setReapproForm({ ...reapproForm, cashAmount: Number(e.target.value) })} /></label>
              <label><span>Montant float</span><input type="number" value={reapproForm.mobileAmount} onChange={(e) => setReapproForm({ ...reapproForm, mobileAmount: Number(e.target.value) })} /></label>
            </div>
            <div className="row"><button type="button" className="btn quiet" onClick={() => setShowReapproForm(false)}>Annuler</button><button type="submit" className="btn primary">Valider</button></div>
          </form>
        </div>
      )}

      {showStartDayForm && (
        <div className="overlay" onClick={() => setShowStartDayForm(false)}>
          <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={startDay}>
            <h3>Demarrer la journee</h3><p>Saisir les montants de depart</p>
            {startDayForm.map((row) => (
              <div className="form-grid" key={row.operator}>
                <label><span>{opLabel[row.operator]} - Cash</span><input type="number" value={row.cashBalance} onChange={(e) => setStartDayForm((prev) => prev.map((x) => (x.operator === row.operator ? { ...x, cashBalance: Number(e.target.value) } : x)))} /></label>
                <label><span>{opLabel[row.operator]} - Float</span><input type="number" value={row.mobileBalance} onChange={(e) => setStartDayForm((prev) => prev.map((x) => (x.operator === row.operator ? { ...x, mobileBalance: Number(e.target.value) } : x)))} /></label>
              </div>
            ))}
            <div className="row"><button type="button" className="btn quiet" onClick={() => setShowStartDayForm(false)}>Annuler</button><button type="submit" className="btn primary">Enregistrer</button></div>
          </form>
        </div>
      )}
    </main>
  );
}

export default App;








