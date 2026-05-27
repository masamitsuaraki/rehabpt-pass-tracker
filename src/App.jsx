import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "rehabpt-pass-tracker-v1";
const CLINIC_NAME = "RehabPT";

const defaultTemplates = {
  hbotExpiringSoon:
    "Hi {firstName}, this is RehabPT. Your HBOT pass is coming up for renewal on {expirationDate}. Please let us know if you would like to continue for the next cycle. Thank you!",
  hbotExpired:
    "Hi {firstName}, this is RehabPT. Your HBOT pass has expired. Please let us know if you would like to renew for the next cycle. Thank you!",
  softwaveLowRemaining:
    "Hi {firstName}, this is RehabPT. You have {remainingSessions} SoftWave sessions remaining. Please let us know if you would like to schedule your next visit or renew your package. Thank you!",
  softwaveCompleted:
    "Hi {firstName}, this is RehabPT. You have completed your current SoftWave package. Please let us know if you would like to continue with another package. Thank you!",
};

const emptyData = {
  hbot: [],
  softwave: [],
  settings: { templates: defaultTemplates },
};

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      hbot: Array.isArray(saved?.hbot) ? saved.hbot : [],
      softwave: Array.isArray(saved?.softwave) ? saved.softwave : [],
      settings: {
        templates: { ...defaultTemplates, ...(saved?.settings?.templates || {}) },
      },
    };
  } catch {
    return emptyData;
  }
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toInputDate(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : parseLocalDate(date);
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function formatDate(value) {
  const date = typeof value === "string" ? parseLocalDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function todayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffInclusive(start, end) {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  if (!s || !e || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

function calculateOriginalEnd(startDate) {
  const start = parseLocalDate(startDate);
  if (!start) return "";
  return toInputDate(new Date(start.getFullYear(), start.getMonth() + 1, start.getDate() - 1));
}

function hbotBreakDays(patient) {
  return (patient.breaks || []).reduce(
    (total, item) => total + diffInclusive(item.startDate, item.endDate),
    0,
  );
}

function calculateAdjustedEnd(patient) {
  const originalEnd = patient.originalEndDate || calculateOriginalEnd(patient.passStartDate);
  const date = parseLocalDate(originalEnd);
  if (!date) return "";
  return toInputDate(addDays(date, hbotBreakDays(patient)));
}

function getHbotStatus(patient) {
  const current = todayDate();
  const isOnBreak = (patient.breaks || []).some((item) => {
    const start = parseLocalDate(item.startDate);
    const end = parseLocalDate(item.endDate);
    return start && end && current >= start && current <= end;
  });
  if (isOnBreak) return "On Break";

  const adjusted = parseLocalDate(patient.adjustedEndDate || calculateAdjustedEnd(patient));
  if (!adjusted) return "Active";
  if (current > adjusted) return "Expired";
  if (current >= addDays(adjusted, -7)) return "Expiring Soon";
  return "Active";
}

function softwaveUsed(patient) {
  return (patient.sessionHistory || []).length;
}

function softwaveRemaining(patient) {
  return Math.max(0, (patient.packageSize || 8) - softwaveUsed(patient));
}

function getSoftwaveStatus(patient) {
  const remaining = softwaveRemaining(patient);
  if (remaining === 0) return "Completed";
  if (remaining <= 2) return "Low Remaining";
  return "Active";
}

function getStatus(patient, service) {
  return service === "hbot" ? getHbotStatus(patient) : getSoftwaveStatus(patient);
}

function statusClass(status) {
  if (status === "Active") return "active";
  if (status === "On Break") return "break";
  if (status === "Expired" || status === "Completed") return "danger";
  return "warning";
}

function latestNote(patient) {
  const note = (patient.notes || [])[0];
  if (!note) return "";
  return note.text.length > 110 ? `${note.text.slice(0, 110)}...` : note.text;
}

function firstName(fullName) {
  return (fullName || "").trim().split(/\s+/)[0] || "there";
}

function serviceLabel(service) {
  return service === "hbot" ? "HBOT" : "SoftWave";
}

function reminderInfo(patient, service) {
  if (!patient) return null;
  if (service === "hbot") {
    const status = getHbotStatus(patient);
    if (status === "Expiring Soon") return ["hbotExpiringSoon", "HBOT Expiring Soon"];
    if (status === "Expired") return ["hbotExpired", "HBOT Expired"];
  } else {
    const status = getSoftwaveStatus(patient);
    if (status === "Low Remaining") return ["softwaveLowRemaining", "SoftWave Low Remaining"];
    if (status === "Completed") return ["softwaveCompleted", "SoftWave Completed"];
  }
  return null;
}

function buildReminderMessage(patient, service, templates) {
  const info = reminderInfo(patient, service);
  if (!info) return "";
  return templates[info[0]]
    .replaceAll("{firstName}", firstName(patient.name))
    .replaceAll("{fullName}", patient.name)
    .replaceAll("{expirationDate}", formatDate(patient.adjustedEndDate))
    .replaceAll("{remainingSessions}", String(softwaveRemaining(patient)))
    .replaceAll("{clinicName}", CLINIC_NAME);
}

function normalizeHbotPatient(patient) {
  return {
    ...patient,
    originalEndDate: calculateOriginalEnd(patient.passStartDate),
    adjustedEndDate: calculateAdjustedEnd({
      ...patient,
      originalEndDate: calculateOriginalEnd(patient.passStartDate),
    }),
  };
}

export default function App() {
  const [data, setData] = useState(loadData);
  const [service, setService] = useState("hbot");
  const [view, setView] = useState("tracker");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [focusPatientId, setFocusPatientId] = useState("");
  const didLoad = useRef(false);

  useEffect(() => {
    if (!didLoad.current) {
      didLoad.current = true;
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    if (!focusPatientId || view !== "tracker" || modal) return;
    const card = document.querySelector(`[data-patient-id="${CSS.escape(focusPatientId)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("patient-card-focus");
    const timer = setTimeout(() => card.classList.remove("patient-card-focus"), 1700);
    setFocusPatientId("");
    return () => clearTimeout(timer);
  }, [focusPatientId, view, modal]);

  const patients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...data[service]]
      .filter((patient) => {
        const status = getStatus(patient, service);
        const phone = patient.phone || "";
        const matchesSearch =
          !query ||
          patient.name.toLowerCase().includes(query) ||
          phone.toLowerCase().includes(query);
        return matchesSearch && (statusFilter === "all" || status === statusFilter);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, search, service, statusFilter]);

  const statuses =
    service === "hbot"
      ? ["Active", "Expiring Soon", "Expired", "On Break"]
      : ["Active", "Low Remaining", "Completed"];

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  }

  function updatePatient(id, updater) {
    setData((current) => ({
      ...current,
      [service]: current[service].map((patient) => {
        if (patient.id !== id) return patient;
        const next = structuredClone(patient);
        updater(next);
        return service === "hbot" ? normalizeHbotPatient(next) : next;
      }),
    }));
  }

  function findPatient(id) {
    return data[service].find((patient) => patient.id === id);
  }

  function addPatient(formData) {
    const name = String(formData.get("name") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    if (!name) return;
    const base = {
      id: uid(),
      name,
      phone,
      notes: [],
      reminderLog: [],
      createdAt: new Date().toISOString(),
    };

    setData((current) => {
      if (service === "hbot") {
        const passStartDate = String(formData.get("passStartDate") || "");
        const patient = normalizeHbotPatient({ ...base, passStartDate, breaks: [] });
        return { ...current, hbot: [...current.hbot, patient] };
      }
      return {
        ...current,
        softwave: [
          ...current.softwave,
          { ...base, packageSize: 8, sessionHistory: [], lastSessionDate: "" },
        ],
      };
    });
    setModal(null);
    showToast(`${name} added to ${serviceLabel(service)}.`);
  }

  function saveHbot(id, formData) {
    updatePatient(id, (patient) => {
      patient.name = String(formData.get("name") || "").trim();
      patient.phone = String(formData.get("phone") || "").trim();
      patient.passStartDate = String(formData.get("passStartDate") || "");
    });
    showToast("HBOT patient saved.");
  }

  function saveSoftwave(id, formData) {
    updatePatient(id, (patient) => {
      patient.name = String(formData.get("name") || "").trim();
      patient.phone = String(formData.get("phone") || "").trim();
      patient.packageSize = Math.max(1, Number(formData.get("packageSize")) || 8);
    });
    showToast("SoftWave patient saved.");
  }

  function saveBreak(id, breakId, formData) {
    const startDate = String(formData.get("startDate") || "");
    const endDate = String(formData.get("endDate") || "");
    if (parseLocalDate(endDate) < parseLocalDate(startDate)) {
      showToast("Break end date must be on or after start date.");
      return;
    }
    updatePatient(id, (patient) => {
      const item = {
        id: breakId || uid(),
        startDate,
        endDate,
        reason: String(formData.get("reason") || "").trim(),
      };
      const breaks = patient.breaks || [];
      const index = breaks.findIndex((entry) => entry.id === breakId);
      patient.breaks = index >= 0 ? breaks.map((entry) => (entry.id === breakId ? item : entry)) : [item, ...breaks];
    });
    setModal({ type: "patient", id });
    showToast("Break saved and pass end date updated.");
  }

  function deleteBreak(id, breakId) {
    updatePatient(id, (patient) => {
      patient.breaks = (patient.breaks || []).filter((item) => item.id !== breakId);
    });
    showToast("Break deleted and pass end date updated.");
  }

  function addNote(id, formData) {
    const text = String(formData.get("note") || "").trim();
    if (!text) return;
    updatePatient(id, (patient) => {
      patient.notes = patient.notes || [];
      patient.notes.unshift({ id: uid(), dateTime: new Date().toISOString(), text });
    });
    showToast("Note added.");
  }

  function addSession(id) {
    updatePatient(id, (patient) => {
      if (softwaveRemaining(patient) <= 0) return;
      patient.sessionHistory = patient.sessionHistory || [];
      patient.sessionHistory.unshift({ id: uid(), dateTime: new Date().toISOString() });
      patient.lastSessionDate = toInputDate(new Date());
    });
    showToast("Session logged.");
  }

  function undoSession(id) {
    updatePatient(id, (patient) => {
      patient.sessionHistory = patient.sessionHistory || [];
      patient.sessionHistory.shift();
      const last = patient.sessionHistory[0];
      patient.lastSessionDate = last ? toInputDate(new Date(last.dateTime)) : "";
    });
    showToast("Last session undone.");
  }

  function renewSoftwave(id) {
    updatePatient(id, (patient) => {
      patient.packageSize = (patient.packageSize || 8) + 8;
    });
    showToast("8 sessions added to SoftWave package.");
  }

  async function openReminder(id) {
    const patient = findPatient(id);
    const message = buildReminderMessage(patient, service, data.settings.templates);
    setModal({ type: "reminder", id });
    try {
      await navigator.clipboard?.writeText(message);
      showToast("Reminder copied to clipboard.");
    } catch {
      showToast("Message ready to copy.");
    }
  }

  function markReminderSent(id) {
    const patient = findPatient(id);
    const info = reminderInfo(patient, service);
    if (!patient || !info) return;
    const message = buildReminderMessage(patient, service, data.settings.templates);
    updatePatient(id, (item) => {
      item.reminderLog = item.reminderLog || [];
      item.reminderLog.unshift({
        id: uid(),
        dateTime: new Date().toISOString(),
        service: serviceLabel(service),
        reminderType: info[1],
        message,
      });
    });
    setView("tracker");
    setModal(null);
    setFocusPatientId(id);
    showToast("Reminder marked as sent.");
  }

  function deletePatient(id) {
    const patient = findPatient(id);
    if (!patient || !window.confirm(`Delete ${patient.name} from ${serviceLabel(service)}?`)) return;
    setData((current) => ({
      ...current,
      [service]: current[service].filter((item) => item.id !== id),
    }));
    setModal(null);
    showToast("Patient deleted.");
  }

  function saveSettings(formData) {
    const templates = Object.fromEntries(
      Object.keys(defaultTemplates).map((key) => [key, String(formData.get(key) || "")]),
    );
    setData((current) => ({ ...current, settings: { templates } }));
    showToast("Settings saved.");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-row">
            <h1 className="brand-title">RehabPT Pass Tracker</h1>
          </div>
          <div className="nav-actions">
            <div className="segmented" aria-label="Service switch">
              <button
                className={service === "hbot" ? "active" : ""}
                onClick={() => {
                  setService("hbot");
                  setView("tracker");
                  setSearch("");
                  setStatusFilter("all");
                }}
              >
                HBOT
              </button>
              <button
                className={service === "softwave" ? "active" : ""}
                onClick={() => {
                  setService("softwave");
                  setView("tracker");
                  setSearch("");
                  setStatusFilter("all");
                }}
              >
                SoftWave
              </button>
            </div>
            <button className="ghost-btn" onClick={() => setView("settings")}>
              Settings
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {view === "settings" ? (
          <Settings
            templates={data.settings.templates}
            onBack={() => setView("tracker")}
            onReset={() => {
              setData((current) => ({ ...current, settings: { templates: defaultTemplates } }));
              showToast("Templates reset to defaults.");
            }}
            onSave={saveSettings}
          />
        ) : (
          <Tracker
            allPatients={data[service]}
            patients={patients}
            search={search}
            service={service}
            statusFilter={statusFilter}
            statuses={statuses}
            onAddPatient={() => setModal({ type: "add" })}
            onAddSession={addSession}
            onOpenPatient={(id) => setModal({ type: "patient", id })}
            onReminder={openReminder}
            onSearch={setSearch}
            onStatusFilter={setStatusFilter}
          />
        )}
      </main>

      {modal?.type === "add" && (
        <AddPatientModal
          service={service}
          onClose={() => setModal(null)}
          onSubmit={(formData) => addPatient(formData)}
        />
      )}
      {modal?.type === "patient" && (
        <PatientModal
          patient={findPatient(modal.id)}
          service={service}
          onAddBreak={(id) => setModal({ type: "break", id })}
          onAddNote={addNote}
          onAddSession={addSession}
          onClose={() => setModal(null)}
          onDeleteBreak={deleteBreak}
          onDeletePatient={deletePatient}
          onEditBreak={(id, breakId) => setModal({ type: "break", id, breakId })}
          onRenewSoftwave={renewSoftwave}
          onSaveHbot={saveHbot}
          onSaveSoftwave={saveSoftwave}
          onUndoSession={undoSession}
        />
      )}
      {modal?.type === "break" && (
        <BreakModal
          patient={findPatient(modal.id)}
          breakId={modal.breakId}
          onBack={() => setModal({ type: "patient", id: modal.id })}
          onClose={() => setModal(null)}
          onSave={(formData) => saveBreak(modal.id, modal.breakId, formData)}
        />
      )}
      {modal?.type === "reminder" && (
        <ReminderModal
          patient={findPatient(modal.id)}
          service={service}
          templates={data.settings.templates}
          onClose={() => setModal(null)}
          onCopy={async () => {
            await navigator.clipboard?.writeText(
              buildReminderMessage(findPatient(modal.id), service, data.settings.templates),
            );
            showToast("Reminder copied to clipboard.");
          }}
          onMarkSent={() => markReminderSent(modal.id)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Tracker(props) {
  const {
    allPatients,
    patients,
    search,
    service,
    statusFilter,
    statuses,
    onAddPatient,
    onAddSession,
    onOpenPatient,
    onReminder,
    onSearch,
    onStatusFilter,
  } = props;

  return (
    <>
      <section className="toolbar">
        <label className="field">
          <span>Search {serviceLabel(service)} patients</span>
          <input
            className="input"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Name or phone number"
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select
            className="select"
            value={statusFilter}
            onChange={(event) => onStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-btn" onClick={onAddPatient}>
          Add Patient
        </button>
      </section>

      <Summary patients={allPatients} service={service} statuses={statuses} />

      {patients.length ? (
        <section className="cards-grid">
          {patients.map((patient) =>
            service === "hbot" ? (
              <HbotCard
                key={patient.id}
                patient={patient}
                onOpen={onOpenPatient}
                onReminder={onReminder}
              />
            ) : (
              <SoftwaveCard
                key={patient.id}
                patient={patient}
                onAddSession={onAddSession}
                onOpen={onOpenPatient}
                onReminder={onReminder}
              />
            ),
          )}
        </section>
      ) : (
        <section className="empty-state">
          <h2>No {serviceLabel(service)} patients found</h2>
          <p>Add a patient or adjust search and filters.</p>
        </section>
      )}
    </>
  );
}

function Summary({ patients, service, statuses }) {
  return (
    <section className="summary-grid">
      <div className="summary-card">
        <strong>{patients.length}</strong>
        <span>Total {serviceLabel(service)}</span>
      </div>
      {statuses.slice(0, 3).map((status) => (
        <div className="summary-card" key={status}>
          <strong>{patients.filter((patient) => getStatus(patient, service) === status).length}</strong>
          <span>{status}</span>
        </div>
      ))}
    </section>
  );
}

function HbotCard({ patient, onOpen, onReminder }) {
  const status = getHbotStatus(patient);
  const reminder = reminderInfo(patient, "hbot");
  const breakDays = hbotBreakDays(patient);
  const note = latestNote(patient);

  return (
    <article className="patient-card" data-patient-id={patient.id}>
      <div className="card-head">
        <div>
          <h2 className="patient-name">{patient.name}</h2>
          <p className="phone">{patient.phone || "No phone number"}</p>
        </div>
        <span className={`badge ${statusClass(status)}`}>{status}</span>
      </div>
      <div className="details-grid">
        <div className="detail-item">
          <span>Start</span>
          <strong>{formatDate(patient.passStartDate)}</strong>
        </div>
        <div className="detail-item">
          <span>{breakDays ? "Adjusted End" : "End"}</span>
          <strong>{formatDate(patient.adjustedEndDate)}</strong>
        </div>
        {breakDays > 0 && (
          <div className="detail-item">
            <span>Break Days</span>
            <strong>{breakDays}</strong>
          </div>
        )}
      </div>
      {note && <p className="note-preview">{note}</p>}
      <div className="card-actions">
        {reminder && (
          <button className="small-btn" onClick={() => onReminder(patient.id)}>
            Reminder
          </button>
        )}
        <button className="small-btn" onClick={() => onOpen(patient.id)}>
          Open/Edit
        </button>
      </div>
    </article>
  );
}

function SoftwaveCard({ patient, onAddSession, onOpen, onReminder }) {
  const status = getSoftwaveStatus(patient);
  const reminder = reminderInfo(patient, "softwave");
  const note = latestNote(patient);

  return (
    <article className="patient-card" data-patient-id={patient.id}>
      <div className="card-head">
        <div>
          <h2 className="patient-name">{patient.name}</h2>
          <p className="phone">{patient.phone || "No phone number"}</p>
        </div>
        <span className={`badge ${statusClass(status)}`}>{status}</span>
      </div>
      <div className="details-grid">
        <div className="detail-item">
          <span>Used Sessions</span>
          <strong>{softwaveUsed(patient)}</strong>
        </div>
        <div className="detail-item">
          <span>Remaining</span>
          <strong>{softwaveRemaining(patient)}</strong>
        </div>
        {patient.lastSessionDate && (
          <div className="detail-item">
            <span>Last Session</span>
            <strong>{formatDate(patient.lastSessionDate)}</strong>
          </div>
        )}
      </div>
      {note && <p className="note-preview">{note}</p>}
      <div className="card-actions">
        {reminder && (
          <button className="small-btn" onClick={() => onReminder(patient.id)}>
            Reminder
          </button>
        )}
        <button className="small-btn" onClick={() => onAddSession(patient.id)}>
          +1 Session
        </button>
        <button className="small-btn" onClick={() => onOpen(patient.id)}>
          Open/Edit
        </button>
      </div>
    </article>
  );
}

function AddPatientModal({ service, onClose, onSubmit }) {
  return (
    <Modal title={`Add ${serviceLabel(service)} Patient`} subtitle="Only patient name is required." onClose={onClose}>
      <form
        className="modal-body"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Patient Name</span>
            <input required name="name" className="input" />
          </label>
          <label className="field">
            <span>Phone Number</span>
            <input name="phone" className="input" />
          </label>
          {service === "hbot" && (
            <label className="field full">
              <span>
                Pass Start Date <em>optional</em>
              </span>
              <input name="passStartDate" type="date" className="input" />
            </label>
          )}
        </div>
        <div className="modal-actions">
          <button className="primary-btn" type="submit">
            Add Patient
          </button>
          <button className="ghost-btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PatientModal(props) {
  const { patient, service, onClose, onDeletePatient } = props;
  if (!patient) return null;
  const status = getStatus(patient, service);

  return (
    <Modal
      wide
      title={patient.name}
      subtitle={
        <>
          {serviceLabel(service)} detail · <span className={`badge ${statusClass(status)}`}>{status}</span>
        </>
      }
      onClose={onClose}
    >
      <div className="modal-body">
        {service === "hbot" ? <HbotDetail {...props} /> : <SoftwaveDetail {...props} />}
        <Notes patient={patient} onAddNote={props.onAddNote} />
        <ReminderLog patient={patient} />
        <div className="modal-actions">
          <button className="danger-btn" onClick={() => onDeletePatient(patient.id)}>
            Delete Patient
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HbotDetail({ patient, onAddBreak, onDeleteBreak, onEditBreak, onSaveHbot }) {
  return (
    <>
      <form
        className="section"
        onSubmit={(event) => {
          event.preventDefault();
          onSaveHbot(patient.id, new FormData(event.currentTarget));
        }}
      >
        <h3>Patient and Pass</h3>
        <div className="form-grid">
          <label className="field">
            <span>Patient Name</span>
            <input required name="name" className="input" defaultValue={patient.name} />
          </label>
          <label className="field">
            <span>Phone Number</span>
            <input required name="phone" className="input" defaultValue={patient.phone} />
          </label>
          <label className="field">
            <span>Pass Start Date</span>
            <input name="passStartDate" type="date" className="input" defaultValue={patient.passStartDate || ""} />
          </label>
          <label className="field">
            <span>Original Pass End Date</span>
            <input readOnly className="input" value={formatDate(patient.originalEndDate)} />
          </label>
          <label className="field">
            <span>Adjusted Pass End Date</span>
            <input readOnly className="input" value={formatDate(patient.adjustedEndDate)} />
          </label>
        </div>
        <div className="inline-actions">
          <button className="primary-btn" type="submit">
            Save Changes
          </button>
          <button className="ghost-btn" type="button" onClick={() => onAddBreak(patient.id)}>
            Add Break
          </button>
        </div>
      </form>

      <section className="section">
        <h3>Break History</h3>
        <div className="row-list">
          {(patient.breaks || []).length ? (
            patient.breaks.map((item) => (
              <div className="history-row" key={item.id}>
                <div>
                  <strong>
                    {formatDate(item.startDate)} to {formatDate(item.endDate)} ·{" "}
                    {diffInclusive(item.startDate, item.endDate)} days
                  </strong>
                  <p>{item.reason || "No reason added."}</p>
                </div>
                <div className="inline-actions">
                  <button className="small-btn" onClick={() => onEditBreak(patient.id, item.id)}>
                    Edit
                  </button>
                  <button className="small-btn" onClick={() => onDeleteBreak(patient.id, item.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="note-preview">No breaks added.</p>
          )}
        </div>
      </section>
    </>
  );
}

function SoftwaveDetail({ patient, onAddSession, onRenewSoftwave, onSaveSoftwave, onUndoSession }) {
  return (
    <>
      <form
        className="section"
        onSubmit={(event) => {
          event.preventDefault();
          onSaveSoftwave(patient.id, new FormData(event.currentTarget));
        }}
      >
        <h3>Patient and Package</h3>
        <div className="form-grid">
          <label className="field">
            <span>Patient Name</span>
            <input required name="name" className="input" defaultValue={patient.name} />
          </label>
          <label className="field">
            <span>Phone Number</span>
            <input required name="phone" className="input" defaultValue={patient.phone} />
          </label>
          <label className="field">
            <span>Package Size</span>
            <input name="packageSize" type="number" min="1" className="input" defaultValue={patient.packageSize || 8} />
          </label>
          <div className="detail-item">
            <span>Remaining Sessions</span>
            <strong>{softwaveRemaining(patient)}</strong>
          </div>
        </div>
        <div className="inline-actions">
          <button className="primary-btn" type="submit">
            Save Changes
          </button>
          <button className="ghost-btn" type="button" onClick={() => onAddSession(patient.id)}>
            +1 Session
          </button>
          <button className="ghost-btn" type="button" onClick={() => onUndoSession(patient.id)}>
            Undo Last
          </button>
          <button className="ghost-btn" type="button" onClick={() => onRenewSoftwave(patient.id)}>
            Renew 8-Pack
          </button>
        </div>
      </form>

      <section className="section">
        <h3>Session History</h3>
        <div className="row-list">
          {(patient.sessionHistory || []).length ? (
            patient.sessionHistory.map((item) => (
              <div className="history-row" key={item.id}>
                <div>
                  <strong>{formatDateTime(item.dateTime)}</strong>
                  <p>Session logged</p>
                </div>
              </div>
            ))
          ) : (
            <p className="note-preview">No sessions logged.</p>
          )}
        </div>
      </section>
    </>
  );
}

function Notes({ patient, onAddNote }) {
  return (
    <section className="section">
      <h3>Internal Admin Notes</h3>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onAddNote(patient.id, new FormData(event.currentTarget));
          event.currentTarget.reset();
        }}
      >
        <label className="field full">
          <span>Add Note</span>
          <textarea required name="note" className="textarea" placeholder="Internal note only" />
        </label>
        <div className="full">
          <button className="primary-btn" type="submit">
            Add Note
          </button>
        </div>
      </form>
      <div className="row-list">
        {(patient.notes || []).map((note) => (
          <div className="history-row" key={note.id}>
            <div>
              <strong>{formatDateTime(note.dateTime)}</strong>
              <p>{note.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReminderLog({ patient }) {
  return (
    <section className="section">
      <h3>Reminder Log</h3>
      <div className="row-list">
        {(patient.reminderLog || []).length ? (
          patient.reminderLog.map((item) => (
            <div className="history-row" key={item.id}>
              <div>
                <strong>
                  {formatDateTime(item.dateTime)} · {item.reminderType}
                </strong>
                <p>{item.message}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="note-preview">No reminders marked as sent.</p>
        )}
      </div>
    </section>
  );
}

function BreakModal({ patient, breakId, onBack, onClose, onSave }) {
  const item = (patient?.breaks || []).find((entry) => entry.id === breakId);
  return (
    <Modal
      title={`${item ? "Edit" : "Add"} HBOT Break`}
      subtitle="Break days automatically extend the adjusted pass end date."
      onClose={onClose}
    >
      <form
        className="modal-body"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(new FormData(event.currentTarget));
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Break Start Date</span>
            <input required name="startDate" type="date" className="input" defaultValue={item?.startDate || ""} />
          </label>
          <label className="field">
            <span>Break End Date</span>
            <input required name="endDate" type="date" className="input" defaultValue={item?.endDate || ""} />
          </label>
          <label className="field full">
            <span>Reason / Note</span>
            <textarea name="reason" className="textarea" defaultValue={item?.reason || ""} />
          </label>
        </div>
        <div className="modal-actions">
          <button className="primary-btn" type="submit">
            Save Break
          </button>
          <button className="ghost-btn" type="button" onClick={onBack}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReminderModal({ patient, service, templates, onClose, onCopy, onMarkSent }) {
  if (!patient) return null;
  const info = reminderInfo(patient, service);
  const message = buildReminderMessage(patient, service, templates);
  return (
    <Modal title="Manual Reminder" subtitle={`${patient.name} · ${info?.[1] || ""}`} onClose={onClose}>
      <div className="modal-body">
        <label className="field">
          <span>Generated Message</span>
          <textarea readOnly className="textarea" value={message} />
        </label>
        <div className="modal-actions">
          <button className="primary-btn" onClick={onMarkSent}>
            Mark as Sent
          </button>
          <button className="ghost-btn" onClick={onCopy}>
            Copy Message
          </button>
          <a className="ghost-btn" href={`sms:${encodeURIComponent(patient.phone)}?&body=${encodeURIComponent(message)}`}>
            Open SMS
          </a>
        </div>
      </div>
    </Modal>
  );
}

function Settings({ templates, onBack, onReset, onSave }) {
  return (
    <section className="settings-page">
      <div className="toolbar">
        <div>
          <h2 className="modal-title">Settings</h2>
          <p className="modal-subtitle">
            Edit manual reminder templates. Supported variables: {"{firstName}"}, {"{fullName}"},{" "}
            {"{expirationDate}"}, {"{remainingSessions}"}, {"{clinicName}"}
          </p>
        </div>
        <span />
        <button className="ghost-btn" onClick={onBack}>
          Back to Tracker
        </button>
      </div>
      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(new FormData(event.currentTarget));
        }}
      >
        <div className="template-grid">
          <TemplateField name="hbotExpiringSoon" label="HBOT Expiring Soon" value={templates.hbotExpiringSoon} />
          <TemplateField name="hbotExpired" label="HBOT Expired" value={templates.hbotExpired} />
          <TemplateField name="softwaveLowRemaining" label="SoftWave Low Remaining" value={templates.softwaveLowRemaining} />
          <TemplateField name="softwaveCompleted" label="SoftWave Completed" value={templates.softwaveCompleted} />
        </div>
        <div className="inline-actions">
          <button className="primary-btn" type="submit">
            Save Settings
          </button>
          <button className="ghost-btn" type="button" onClick={onReset}>
            Reset Defaults
          </button>
        </div>
      </form>
    </section>
  );
}

function TemplateField({ name, label, value }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea className="textarea" name={name} defaultValue={value} />
    </label>
  );
}

function Modal({ children, onClose, subtitle, title, wide = false }) {
  return (
    <div className="modal-backdrop">
      <section className={`modal ${wide ? "wide" : ""}`}>
        <header className="modal-header">
          <div>
            <h2 className="modal-title">{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button className="small-btn" onClick={onClose}>
            Close
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
